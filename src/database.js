import { DatabaseSync } from "node:sqlite";

import {
  ROULETTE_NUMBERS,
  canonicalRouletteNumber,
  eliminateNumber,
} from "./domain.js";
import {
  VIRTUAL_BET_MODEL,
  calculateNextVirtualStake,
  settleVirtualBet,
} from "./virtual-bettor.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function asNonEmptyText(value, fallback, label) {
  const candidate = value ?? fallback;
  if (typeof candidate !== "string" || candidate.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return candidate.trim();
}

function asTimestamp(value, fallback, label) {
  const candidate = value ?? fallback;
  const date = candidate instanceof Date ? candidate : new Date(candidate);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`${label} must be a valid date`);
  }
  return date.toISOString();
}

function asPrice(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const price = Number(value);
  if (!Number.isFinite(price)) {
    throw new TypeError("price must be a finite number");
  }
  return price;
}

function rawCellFromPayload(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return null;
  }
  const candidate = rawPayload.rr?.c ?? rawPayload.c;
  if (candidate === null || candidate === undefined || candidate === "") {
    return null;
  }
  const rawCell = Number(candidate);
  return Number.isInteger(rawCell) && rawCell >= 0 && rawCell <= 37
    ? rawCell
    : null;
}

function serializeJson(value, label) {
  if (value === undefined) {
    return null;
  }

  try {
    return JSON.stringify(value);
  } catch (error) {
    throw new TypeError(`${label} must be JSON-serializable`, {
      cause: error,
    });
  }
}

function deserializeJson(value) {
  if (value === null || value === undefined) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizedLimit(value, fallback = DEFAULT_LIMIT) {
  const limit = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new RangeError(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return limit;
}

function normalizedGapSeconds(value, fallback = 135) {
  const seconds = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86_400) {
    throw new RangeError("gapThresholdSeconds must be an integer between 1 and 86400");
  }
  return seconds;
}

function numericRoundId(value) {
  if (value === null || value === undefined) return null;
  const candidate = String(value).trim();
  if (!/^\d+$/.test(candidate)) return null;
  return BigInt(candidate);
}

function storedResultsAreAdjacent(left, right, gapThresholdMs) {
  const crossedInvalidCycle =
    left.cycle_status === "invalid_gap" &&
    left.cycle_id !== null &&
    Number(left.cycle_id) !== Number(right.cycle_id);
  if (crossedInvalidCycle) return false;

  const leftRoundId = numericRoundId(left.external_round_id);
  const rightRoundId = numericRoundId(right.external_round_id);
  if (leftRoundId !== null && rightRoundId !== null) {
    return rightRoundId === leftRoundId + 1n;
  }

  const elapsed = Date.parse(right.settled_at) - Date.parse(left.settled_at);
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= gapThresholdMs;
}

function normalizeEvent(event, index, now) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new TypeError(`events[${index}] must be an object`);
  }

  const observedAt = asTimestamp(event.observedAt, now, "observedAt");
  const externalRoundIdValue =
    event.externalRoundId ?? event.external_round_id ?? null;
  const externalRoundId =
    externalRoundIdValue === null
      ? null
      : asNonEmptyText(
          String(externalRoundIdValue),
          undefined,
          "externalRoundId",
        );

  return {
    source: asNonEmptyText(event.source, "buleto", "source"),
    instrument: asNonEmptyText(
      event.instrument,
      "default",
      "instrument",
    ),
    settledAt: asTimestamp(event.settledAt, observedAt, "settledAt"),
    resultNumber: canonicalRouletteNumber(event.resultNumber),
    price: asPrice(event.price),
    observedAt,
    externalRoundId,
    origin: asNonEmptyText(
      event.origin,
      externalRoundId === null ? "last-results" : "round",
      "origin",
    ),
    rawCell: rawCellFromPayload(event.rawPayload),
    fingerprint: asNonEmptyText(
      event.fingerprint,
      undefined,
      "fingerprint",
    ),
    rawPayload: serializeJson(event.rawPayload, "rawPayload"),
    inputIndex: index,
  };
}

function mapRoundResult(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    source: row.source,
    instrument: row.instrument,
    settledAt: row.settled_at,
    resultNumber: Number(row.result_number),
    number: Number(row.result_number),
    price: row.price === null ? null : Number(row.price),
    observedAt: row.observed_at,
    externalRoundId: row.external_round_id,
    rawCell: row.raw_cell === null ? null : Number(row.raw_cell),
    fingerprint: row.fingerprint,
    rawPayload: deserializeJson(row.raw_payload),
    cycleId: row.cycle_id == null ? null : Number(row.cycle_id),
    continuityEpoch: Number(row.continuity_epoch ?? 0),
    wasNew:
      row.was_new === null || row.was_new === undefined
        ? null
        : Boolean(row.was_new),
    remainingAfter:
      row.remaining_after === null || row.remaining_after === undefined
        ? null
        : Number(row.remaining_after),
    createdAt: row.created_at,
  };
}

function mapIncident(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    kind: row.kind,
    source: row.source,
    instrument: row.instrument,
    message: row.message,
    incidentKey: row.incident_key ?? null,
    detectedAt: row.detected_at,
    details: deserializeJson(row.details_json),
    cycleId: row.cycle_id == null ? null : Number(row.cycle_id),
    createdAt: row.created_at,
  };
}

function mapVirtualBetSession(row) {
  if (!row) return null;
  const nextStake = row.next_stake == null ? null : Number(row.next_stake);
  const totalStaked = Number(row.total_staked);
  const projectedGrossPayout =
    nextStake === null
      ? null
      : nextStake * Number(row.gross_payout_multiplier);
  const projectedNetIfHit =
    nextStake === null
      ? null
      : projectedGrossPayout - totalStaked - nextStake;

  return {
    id: Number(row.id),
    source: row.source,
    instrument: row.instrument,
    continuityEpoch: Number(row.continuity_epoch),
    targetNumber: Number(row.target_number),
    status: row.status,
    triggerRoundsMissed: Number(row.trigger_rounds_missed),
    activatedAfterResultId: Number(row.activated_after_result_id),
    attemptCount: Number(row.attempt_count),
    missCount: Number(row.miss_count),
    totalStaked,
    nextStake,
    lastBetResultId:
      row.last_bet_result_id == null ? null : Number(row.last_bet_result_id),
    completedResultId:
      row.completed_result_id == null ? null : Number(row.completed_result_id),
    grossPayout: Number(row.gross_payout),
    netResult: row.net_result == null ? null : Number(row.net_result),
    selectedAt: row.armed_at,
    startedAt: row.started_at ?? null,
    armedAt: row.armed_at,
    lastEventAt: row.last_event_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    model: {
      modelVersion: row.model_version,
      initialStake: Number(row.initial_stake),
      stakeStep: Number(row.stake_step),
      maxStake: Number(row.max_stake),
      grossPayoutMultiplier: Number(row.gross_payout_multiplier),
      payoutIncludesStake: Boolean(row.payout_includes_stake),
    },
    projectedTotalLossIfMiss:
      nextStake === null ? null : totalStaked + nextStake,
    projectedGrossPayout,
    projectedNetIfHit,
    capped:
      nextStake === null ? false : nextStake === Number(row.max_stake),
    recoveryPossible:
      projectedNetIfHit === null ? null : projectedNetIfHit >= 0,
  };
}

function emitLog(logger, level, payload, message) {
  try {
    logger?.[level]?.(payload, message);
  } catch {
    // Logging must never change ingestion semantics.
  }
}

export class RouletteDatabase {
  constructor({ path = ":memory:", logger = null, gapThresholdSeconds = 135 } = {}) {
    if (typeof path !== "string" || path.trim() === "") {
      throw new TypeError("path must be a non-empty string");
    }

    this.logger = logger;
    this.gapThresholdMs = normalizedGapSeconds(gapThresholdSeconds) * 1_000;
    this.closed = false;
    this.sqlite = new DatabaseSync(path);

    try {
      this.sqlite.exec("PRAGMA foreign_keys = ON");
      this.sqlite.exec("PRAGMA busy_timeout = 5000");
      this.sqlite.exec("PRAGMA journal_mode = WAL");
      this.#migrate();
    } catch (error) {
      this.sqlite.close();
      this.closed = true;
      throw error;
    }
  }

  #assertOpen() {
    if (this.closed) {
      throw new Error("database is closed");
    }
  }

  #migrate() {
    const startingVersion = Number(
      this.sqlite.prepare("PRAGMA user_version").get().user_version,
    );
    this.sqlite.exec(`
      BEGIN IMMEDIATE;

      CREATE TABLE IF NOT EXISTS cycles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        instrument TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('active', 'completed', 'invalid_gap')
        ),
        origin TEXT NOT NULL,
        started_at TEXT NOT NULL,
        last_event_at TEXT NOT NULL,
        completed_at TEXT,
        survivor_number INTEGER CHECK (
          survivor_number IS NULL OR survivor_number BETWEEN 0 AND 36
        ),
        event_count INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
        eliminated_count INTEGER NOT NULL DEFAULT 0 CHECK (
          eliminated_count BETWEEN 0 AND 36
        ),
        created_at TEXT NOT NULL,
        CHECK (
          (status = 'active' AND completed_at IS NULL AND survivor_number IS NULL)
          OR
          (status = 'completed' AND completed_at IS NOT NULL AND survivor_number IS NOT NULL)
          OR
          (status = 'invalid_gap' AND completed_at IS NOT NULL AND survivor_number IS NULL)
        )
      );

      CREATE UNIQUE INDEX IF NOT EXISTS cycles_one_active_stream
        ON cycles(source, instrument)
        WHERE status = 'active';

      CREATE INDEX IF NOT EXISTS cycles_completed_at_idx
        ON cycles(completed_at DESC)
        WHERE status = 'completed';

      CREATE TABLE IF NOT EXISTS round_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        instrument TEXT NOT NULL,
        settled_at TEXT NOT NULL,
        result_number INTEGER NOT NULL CHECK (result_number BETWEEN 0 AND 36),
        price REAL,
        observed_at TEXT NOT NULL,
        external_round_id TEXT,
        raw_cell INTEGER CHECK (raw_cell IS NULL OR raw_cell BETWEEN 0 AND 37),
        fingerprint TEXT NOT NULL UNIQUE,
        raw_payload TEXT,
        cycle_id INTEGER REFERENCES cycles(id),
        continuity_epoch INTEGER NOT NULL DEFAULT 0 CHECK (continuity_epoch >= 0),
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS round_results_settled_at_idx
        ON round_results(settled_at DESC, id DESC);

      CREATE INDEX IF NOT EXISTS round_results_number_history_idx
        ON round_results(source, instrument, result_number, settled_at DESC);

      CREATE INDEX IF NOT EXISTS round_results_stream_time_idx
        ON round_results(source, instrument, settled_at, id);

      CREATE UNIQUE INDEX IF NOT EXISTS round_results_external_round_idx
        ON round_results(source, instrument, external_round_id)
        WHERE external_round_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS round_results_cycle_id_idx
        ON round_results(cycle_id, id);

      CREATE TABLE IF NOT EXISTS cycle_numbers (
        cycle_id INTEGER NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
        number INTEGER NOT NULL CHECK (number BETWEEN 0 AND 36),
        eliminated_at TEXT,
        eliminated_by_result_id INTEGER REFERENCES round_results(id),
        PRIMARY KEY (cycle_id, number),
        CHECK (
          (eliminated_at IS NULL AND eliminated_by_result_id IS NULL)
          OR
          (eliminated_at IS NOT NULL AND eliminated_by_result_id IS NOT NULL)
        )
      );

      CREATE TABLE IF NOT EXISTS cycle_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cycle_id INTEGER NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
        round_result_id INTEGER NOT NULL UNIQUE REFERENCES round_results(id),
        result_number INTEGER NOT NULL CHECK (result_number BETWEEN 0 AND 36),
        eliminated INTEGER NOT NULL CHECK (eliminated IN (0, 1)),
        remaining_count INTEGER NOT NULL CHECK (remaining_count BETWEEN 1 AND 36),
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS cycle_events_cycle_id_idx
        ON cycle_events(cycle_id, id);

      CREATE TABLE IF NOT EXISTS incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        source TEXT NOT NULL,
        instrument TEXT NOT NULL,
        message TEXT,
        incident_key TEXT,
        detected_at TEXT NOT NULL,
        details_json TEXT,
        cycle_id INTEGER REFERENCES cycles(id),
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS incidents_detected_at_idx
        ON incidents(detected_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS stream_state (
        source TEXT NOT NULL,
        instrument TEXT NOT NULL,
        continuity_epoch INTEGER NOT NULL DEFAULT 0 CHECK (continuity_epoch >= 0),
        PRIMARY KEY (source, instrument)
      );

      COMMIT;
    `);

    // Later migrations add durable gap idempotency and scope external round
    // identifiers per instrument. Fresh databases already have the columns;
    // older databases are upgraded in place before indexes are rebuilt.
    const incidentColumns = this.sqlite.prepare("PRAGMA table_info(incidents)").all();
    if (!incidentColumns.some((column) => column.name === "incident_key")) {
      this.sqlite.exec("ALTER TABLE incidents ADD COLUMN incident_key TEXT");
    }
    const resultColumns = this.sqlite.prepare("PRAGMA table_info(round_results)").all();
    const addedContinuityEpoch = !resultColumns.some(
      (column) => column.name === "continuity_epoch",
    );
    if (addedContinuityEpoch) {
      this.sqlite.exec(
        "ALTER TABLE round_results ADD COLUMN continuity_epoch INTEGER NOT NULL DEFAULT 0 CHECK (continuity_epoch >= 0)",
      );
    }
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS stream_state (
        source TEXT NOT NULL,
        instrument TEXT NOT NULL,
        continuity_epoch INTEGER NOT NULL DEFAULT 0 CHECK (continuity_epoch >= 0),
        PRIMARY KEY (source, instrument)
      );
      DROP INDEX IF EXISTS round_results_external_round_idx;
      CREATE UNIQUE INDEX round_results_external_round_idx
        ON round_results(source, instrument, external_round_id)
        WHERE external_round_id IS NOT NULL;
      DROP INDEX IF EXISTS incidents_key_idx;
      CREATE UNIQUE INDEX incidents_key_idx
        ON incidents(source, instrument, incident_key)
        WHERE incident_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS round_results_number_history_idx
        ON round_results(source, instrument, result_number, settled_at DESC);
      CREATE INDEX IF NOT EXISTS round_results_stream_time_idx
        ON round_results(source, instrument, settled_at, id);
      CREATE INDEX IF NOT EXISTS round_results_continuity_idx
        ON round_results(source, instrument, continuity_epoch, settled_at, id);
    `);

    if (addedContinuityEpoch || startingVersion < 6) {
      this.#backfillContinuityEpochs();
    } else {
      this.sqlite.exec(`
        INSERT INTO stream_state (source, instrument, continuity_epoch)
        SELECT source, instrument, MAX(continuity_epoch)
        FROM round_results
        GROUP BY source, instrument
        ON CONFLICT(source, instrument) DO UPDATE SET
          continuity_epoch = MAX(stream_state.continuity_epoch, excluded.continuity_epoch)
      `);
    }
    this.sqlite.exec(`
      BEGIN IMMEDIATE;

      CREATE TABLE IF NOT EXISTS virtual_bet_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        instrument TEXT NOT NULL,
        continuity_epoch INTEGER NOT NULL CHECK (continuity_epoch >= 0),
        target_number INTEGER NOT NULL CHECK (target_number BETWEEN 0 AND 36),
        status TEXT NOT NULL CHECK (
          status IN ('armed', 'active', 'completed', 'invalid_gap')
        ),
        trigger_rounds_missed INTEGER NOT NULL CHECK (trigger_rounds_missed >= 0),
        activated_after_result_id INTEGER NOT NULL REFERENCES round_results(id),
        model_version TEXT NOT NULL,
        initial_stake INTEGER NOT NULL CHECK (initial_stake > 0),
        stake_step INTEGER NOT NULL CHECK (stake_step > 0),
        max_stake INTEGER NOT NULL CHECK (max_stake > 0),
        gross_payout_multiplier INTEGER NOT NULL CHECK (gross_payout_multiplier > 0),
        payout_includes_stake INTEGER NOT NULL CHECK (payout_includes_stake IN (0, 1)),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        miss_count INTEGER NOT NULL DEFAULT 0 CHECK (miss_count >= 0),
        total_staked INTEGER NOT NULL DEFAULT 0 CHECK (total_staked >= 0),
        next_stake INTEGER CHECK (next_stake IS NULL OR next_stake > 0),
        last_bet_result_id INTEGER REFERENCES round_results(id),
        completed_result_id INTEGER REFERENCES round_results(id),
        gross_payout INTEGER NOT NULL DEFAULT 0 CHECK (gross_payout >= 0),
        net_result INTEGER,
        armed_at TEXT NOT NULL,
        last_event_at TEXT NOT NULL,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        CHECK (
          (status IN ('armed', 'active') AND completed_at IS NULL AND next_stake IS NOT NULL)
          OR
          (status IN ('completed', 'invalid_gap') AND completed_at IS NOT NULL AND next_stake IS NULL)
        )
      );

      CREATE UNIQUE INDEX IF NOT EXISTS virtual_bet_sessions_one_live_stream_idx
        ON virtual_bet_sessions(source, instrument)
        WHERE status IN ('armed', 'active');

      CREATE INDEX IF NOT EXISTS virtual_bet_sessions_stream_history_idx
        ON virtual_bet_sessions(source, instrument, id DESC);

      CREATE TABLE IF NOT EXISTS virtual_bets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES virtual_bet_sessions(id) ON DELETE CASCADE,
        round_result_id INTEGER NOT NULL UNIQUE REFERENCES round_results(id),
        attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
        stake INTEGER NOT NULL CHECK (stake > 0),
        result_number INTEGER NOT NULL CHECK (result_number BETWEEN 0 AND 36),
        outcome TEXT NOT NULL CHECK (outcome IN ('miss', 'hit')),
        gross_payout INTEGER NOT NULL CHECK (gross_payout >= 0),
        total_staked_after INTEGER NOT NULL CHECK (total_staked_after > 0),
        net_after INTEGER NOT NULL,
        next_stake_after INTEGER CHECK (
          next_stake_after IS NULL OR next_stake_after > 0
        ),
        recovery_possible INTEGER NOT NULL CHECK (recovery_possible IN (0, 1)),
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(session_id, attempt_number)
      );

      CREATE INDEX IF NOT EXISTS virtual_bets_session_idx
        ON virtual_bets(session_id, attempt_number);

      PRAGMA user_version = 7;
      COMMIT;
    `);
  }

  #backfillContinuityEpochs() {
    const streams = this.sqlite
      .prepare(`
        SELECT DISTINCT source, instrument
        FROM round_results
        ORDER BY source, instrument
      `)
      .all();
    const updateResult = this.sqlite.prepare(
      "UPDATE round_results SET continuity_epoch = ? WHERE id = ?",
    );
    const saveState = this.sqlite.prepare(`
      INSERT INTO stream_state (source, instrument, continuity_epoch)
      VALUES (?, ?, ?)
      ON CONFLICT(source, instrument) DO UPDATE SET
        continuity_epoch = excluded.continuity_epoch
    `);

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      for (const stream of streams) {
        const incidentBoundaries = this.sqlite
          .prepare(`
            SELECT (
              SELECT rr.id
              FROM round_results AS rr
              WHERE rr.source = incidents.source
                AND rr.instrument = incidents.instrument
                AND rr.created_at >= incidents.created_at
              ORDER BY rr.created_at, rr.id
              LIMIT 1
            ) AS boundary_id
            FROM incidents
            WHERE source = ? AND instrument = ?
            ORDER BY created_at, id
          `)
          .all(stream.source, stream.instrument);
        const boundaryIds = new Set(
          incidentBoundaries
            .filter((item) => item.boundary_id !== null)
            .map((item) => Number(item.boundary_id)),
        );
        const trailingGapCount = incidentBoundaries.filter(
          (item) => item.boundary_id === null,
        ).length;
        const rows = this.sqlite
          .prepare(`
            SELECT
              rr.id,
              rr.settled_at,
              rr.external_round_id,
              rr.cycle_id,
              c.status AS cycle_status
            FROM round_results AS rr
            LEFT JOIN cycles AS c ON c.id = rr.cycle_id
            WHERE rr.source = ? AND rr.instrument = ?
            ORDER BY rr.settled_at, rr.id
          `)
          .iterate(stream.source, stream.instrument);
        let epoch = 0;
        let previous = null;
        for (const row of rows) {
          if (
            previous &&
            (
              boundaryIds.has(Number(row.id)) ||
              !storedResultsAreAdjacent(previous, row, this.gapThresholdMs)
            )
          ) {
            epoch += 1;
          }
          updateResult.run(epoch, Number(row.id));
          previous = row;
        }
        epoch += trailingGapCount;
        saveState.run(stream.source, stream.instrument, epoch);
      }
      this.sqlite.exec("COMMIT");
    } catch (error) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // Preserve the migration error.
      }
      throw error;
    }
  }

  #transaction(operation) {
    this.#assertOpen();
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // Preserve the original failure.
      }
      throw error;
    }
  }

  #createCycle(source, instrument, origin, startedAt, createdAt) {
    const insert = this.sqlite
      .prepare(`
        INSERT INTO cycles (
          source,
          instrument,
          origin,
          status,
          started_at,
          last_event_at,
          created_at
        ) VALUES (?, ?, ?, 'active', ?, ?, ?)
      `)
      .run(source, instrument, origin, startedAt, startedAt, createdAt);
    const cycleId = Number(insert.lastInsertRowid);
    const insertNumber = this.sqlite.prepare(`
      INSERT INTO cycle_numbers (cycle_id, number)
      VALUES (?, ?)
    `);

    for (const number of ROULETTE_NUMBERS) {
      insertNumber.run(cycleId, number);
    }

    return cycleId;
  }

  #activeCycleId(source, instrument) {
    const row = this.sqlite
      .prepare(`
        SELECT id
        FROM cycles
        WHERE source = ? AND instrument = ? AND status = 'active'
      `)
      .get(source, instrument);
    return row ? Number(row.id) : null;
  }

  #continuityEpoch(source, instrument) {
    this.sqlite
      .prepare(`
        INSERT INTO stream_state (source, instrument, continuity_epoch)
        VALUES (?, ?, 0)
        ON CONFLICT(source, instrument) DO NOTHING
      `)
      .run(source, instrument);
    const row = this.sqlite
      .prepare(`
        SELECT continuity_epoch
        FROM stream_state
        WHERE source = ? AND instrument = ?
      `)
      .get(source, instrument);
    return Number(row.continuity_epoch);
  }

  #advanceContinuityEpoch(source, instrument) {
    const row = this.sqlite
      .prepare(`
        INSERT INTO stream_state (source, instrument, continuity_epoch)
        VALUES (?, ?, 1)
        ON CONFLICT(source, instrument) DO UPDATE SET
          continuity_epoch = continuity_epoch + 1
        RETURNING continuity_epoch
      `)
      .get(source, instrument);
    return Number(row.continuity_epoch);
  }

  #liveVirtualBetSessionRow(source, instrument) {
    return this.sqlite
      .prepare(`
        SELECT
          sessions.*,
          (
            SELECT MIN(bets.occurred_at)
            FROM virtual_bets AS bets
            WHERE bets.session_id = sessions.id
          ) AS started_at
        FROM virtual_bet_sessions AS sessions
        WHERE sessions.source = ?
          AND sessions.instrument = ?
          AND sessions.status IN ('armed', 'active')
        LIMIT 1
      `)
      .get(source, instrument);
  }

  #latestResultInEpoch(source, instrument, continuityEpoch, excludeResultId = null) {
    return this.sqlite
      .prepare(`
        SELECT *
        FROM round_results
        WHERE source = ?
          AND instrument = ?
          AND continuity_epoch = ?
          AND (? IS NULL OR id <> ?)
        ORDER BY settled_at DESC, id DESC
        LIMIT 1
      `)
      .get(
        source,
        instrument,
        continuityEpoch,
        excludeResultId,
        excludeResultId,
      );
  }

  #longestVirtualCandidate(
    source,
    instrument,
    continuityEpoch,
    excludeResultId = null,
  ) {
    const row = this.sqlite
      .prepare(`
        WITH numbers(result_number) AS (
          VALUES ${ROULETTE_NUMBERS.map((number) => `(${number})`).join(", ")}
        ),
        ordered AS (
          SELECT
            id,
            result_number,
            settled_at,
            ROW_NUMBER() OVER (ORDER BY settled_at, id) AS position
          FROM round_results
          WHERE source = ?
            AND instrument = ?
            AND continuity_epoch = ?
            AND (? IS NULL OR id <> ?)
        ),
        totals AS (
          SELECT COUNT(*) AS total_rounds
          FROM ordered
        ),
        last_seen AS (
          SELECT
            result_number,
            COUNT(*) AS occurrence_count,
            MAX(position) AS last_position
          FROM ordered
          GROUP BY result_number
        )
        SELECT
          numbers.result_number,
          COALESCE(last_seen.occurrence_count, 0) AS occurrence_count,
          last_seen.last_position,
          totals.total_rounds - COALESCE(last_seen.last_position, 0)
            AS rounds_since_last,
          ordered.id AS last_result_id,
          ordered.settled_at AS last_seen_at
        FROM numbers
        CROSS JOIN totals
        LEFT JOIN last_seen
          ON last_seen.result_number = numbers.result_number
        LEFT JOIN ordered
          ON ordered.result_number = last_seen.result_number
         AND ordered.position = last_seen.last_position
        WHERE totals.total_rounds > 0
        ORDER BY
          rounds_since_last DESC,
          CASE WHEN last_seen.last_position IS NULL THEN 0 ELSE 1 END,
          last_seen.last_position,
          numbers.result_number
        LIMIT 1
      `)
      .get(
        source,
        instrument,
        continuityEpoch,
        excludeResultId,
        excludeResultId,
      );

    if (!row) return null;
    const roundsSinceLast = Number(row.rounds_since_last);
    return {
      number: Number(row.result_number),
      roundsSinceLast,
      occurrenceCount: Number(row.occurrence_count),
      lastSeenAt: row.last_seen_at,
      lastResultId:
        row.last_result_id === null ? null : Number(row.last_result_id),
      lastPosition:
        row.last_position === null ? null : Number(row.last_position),
      continuityEpoch,
      eligible: roundsSinceLast >= VIRTUAL_BET_MODEL.triggerThreshold,
    };
  }

  #armVirtualBettorInTransaction(
    source,
    instrument,
    now,
    { excludeResultId = null } = {},
  ) {
    const live = this.#liveVirtualBetSessionRow(source, instrument);
    if (live) return live;

    const continuityEpoch = this.#continuityEpoch(source, instrument);
    const boundary = this.#latestResultInEpoch(
      source,
      instrument,
      continuityEpoch,
      excludeResultId,
    );
    if (!boundary) return null;

    const candidate = this.#longestVirtualCandidate(
      source,
      instrument,
      continuityEpoch,
      excludeResultId,
    );
    if (!candidate?.eligible) return null;

    const initialStake = calculateNextVirtualStake(0);
    const insertion = this.sqlite
      .prepare(`
        INSERT INTO virtual_bet_sessions (
          source,
          instrument,
          continuity_epoch,
          target_number,
          status,
          trigger_rounds_missed,
          activated_after_result_id,
          model_version,
          initial_stake,
          stake_step,
          max_stake,
          gross_payout_multiplier,
          payout_includes_stake,
          next_stake,
          armed_at,
          last_event_at,
          created_at
        ) VALUES (?, ?, ?, ?, 'armed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        source,
        instrument,
        continuityEpoch,
        candidate.number,
        candidate.roundsSinceLast,
        Number(boundary.id),
        VIRTUAL_BET_MODEL.modelVersion,
        VIRTUAL_BET_MODEL.initialStake,
        VIRTUAL_BET_MODEL.stakeStep,
        VIRTUAL_BET_MODEL.maxStake,
        VIRTUAL_BET_MODEL.grossPayoutMultiplier,
        VIRTUAL_BET_MODEL.payoutIncludesStake ? 1 : 0,
        initialStake,
        boundary.settled_at,
        boundary.settled_at,
        now,
      );
    return this.sqlite
      .prepare("SELECT * FROM virtual_bet_sessions WHERE id = ?")
      .get(Number(insertion.lastInsertRowid));
  }

  #isChronologicalTail(resultRow) {
    const latest = this.#latestResultInEpoch(
      resultRow.source,
      resultRow.instrument,
      Number(resultRow.continuity_epoch),
    );
    return latest !== undefined && Number(latest.id) === Number(resultRow.id);
  }

  #settleVirtualBettorInTransaction(resultRow, now) {
    const live = this.#liveVirtualBetSessionRow(
      resultRow.source,
      resultRow.instrument,
    );
    if (
      !live ||
      Number(live.continuity_epoch) !== Number(resultRow.continuity_epoch) ||
      Number(live.activated_after_result_id) === Number(resultRow.id)
    ) {
      return null;
    }

    const settlement = settleVirtualBet({
      targetNumber: Number(live.target_number),
      resultNumber: Number(resultRow.result_number),
      stake: Number(live.next_stake),
      priorTotalStaked: Number(live.total_staked),
      // Continue an already armed session with the exact rules persisted when
      // it started, even if a later deployment changes the global defaults.
      model: {
        initialStake: Number(live.initial_stake),
        stakeStep: Number(live.stake_step),
        maxStake: Number(live.max_stake),
        grossPayoutMultiplier: Number(live.gross_payout_multiplier),
        payoutIncludesStake: Boolean(live.payout_includes_stake),
      },
    });
    const attemptNumber = Number(live.attempt_count) + 1;

    this.sqlite
      .prepare(`
        INSERT INTO virtual_bets (
          session_id,
          round_result_id,
          attempt_number,
          stake,
          result_number,
          outcome,
          gross_payout,
          total_staked_after,
          net_after,
          next_stake_after,
          recovery_possible,
          occurred_at,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        Number(live.id),
        Number(resultRow.id),
        attemptNumber,
        Number(live.next_stake),
        Number(resultRow.result_number),
        settlement.outcome,
        settlement.grossPayout,
        settlement.totalStaked,
        settlement.netResult,
        settlement.nextStake,
        settlement.recoveryPossible ? 1 : 0,
        resultRow.settled_at,
        now,
      );

    if (settlement.outcome === "hit") {
      this.sqlite
        .prepare(`
          UPDATE virtual_bet_sessions
          SET
            status = 'completed',
            attempt_count = ?,
            total_staked = ?,
            next_stake = NULL,
            last_bet_result_id = ?,
            completed_result_id = ?,
            gross_payout = ?,
            net_result = ?,
            last_event_at = ?,
            completed_at = ?
          WHERE id = ? AND status IN ('armed', 'active')
        `)
        .run(
          attemptNumber,
          settlement.totalStaked,
          Number(resultRow.id),
          Number(resultRow.id),
          settlement.grossPayout,
          settlement.netResult,
          resultRow.settled_at,
          resultRow.settled_at,
          Number(live.id),
        );
    } else {
      this.sqlite
        .prepare(`
          UPDATE virtual_bet_sessions
          SET
            status = 'active',
            attempt_count = ?,
            miss_count = miss_count + 1,
            total_staked = ?,
            next_stake = ?,
            last_bet_result_id = ?,
            gross_payout = 0,
            net_result = ?,
            last_event_at = ?
          WHERE id = ? AND status IN ('armed', 'active')
        `)
        .run(
          attemptNumber,
          settlement.totalStaked,
          settlement.nextStake,
          Number(resultRow.id),
          settlement.netResult,
          resultRow.settled_at,
          Number(live.id),
        );
    }

    return settlement;
  }

  #processVirtualBettorResult(resultRow, now) {
    const isTail = this.#isChronologicalTail(resultRow);
    if (isTail && !this.#liveVirtualBetSessionRow(resultRow.source, resultRow.instrument)) {
      this.#armVirtualBettorInTransaction(resultRow.source, resultRow.instrument, now, {
        excludeResultId: Number(resultRow.id),
      });
    }

    if (isTail) {
      this.#settleVirtualBettorInTransaction(resultRow, now);
    }

    if (!this.#liveVirtualBetSessionRow(resultRow.source, resultRow.instrument)) {
      this.#armVirtualBettorInTransaction(resultRow.source, resultRow.instrument, now);
    }
  }

  #invalidateVirtualBettorForGap(source, instrument, detectedAt) {
    this.sqlite
      .prepare(`
        UPDATE virtual_bet_sessions
        SET
          status = 'invalid_gap',
          next_stake = NULL,
          gross_payout = 0,
          net_result = -total_staked,
          last_event_at = ?,
          completed_at = ?
        WHERE source = ?
          AND instrument = ?
          AND status IN ('armed', 'active')
      `)
      .run(detectedAt, detectedAt, source, instrument);
  }

  #remainingNumbers(cycleId) {
    return this.sqlite
      .prepare(`
        SELECT number
        FROM cycle_numbers
        WHERE cycle_id = ? AND eliminated_at IS NULL
        ORDER BY number
      `)
      .all(cycleId)
      .map((row) => Number(row.number));
  }

  #hydrateCycle(row) {
    if (!row) {
      return null;
    }

    const cycleId = Number(row.id);
    const numbers = this.sqlite
      .prepare(`
        SELECT
          cn.number,
          cn.eliminated_at,
          COUNT(ce.id) AS occurrence_count,
          MIN(ce.occurred_at) AS first_seen_at
        FROM cycle_numbers AS cn
        LEFT JOIN cycle_events AS ce
          ON ce.cycle_id = cn.cycle_id
         AND ce.result_number = cn.number
        WHERE cn.cycle_id = ?
        GROUP BY cn.number, cn.eliminated_at
        ORDER BY cn.number
      `)
      .all(cycleId)
      .map((item) => ({
        number: Number(item.number),
        occurrenceCount: Number(item.occurrence_count),
        eliminated: item.eliminated_at !== null,
        firstSeenAt: item.first_seen_at,
      }));
    const remainingNumbers = numbers
      .filter((item) => !item.eliminated)
      .map((item) => item.number);
    const eliminatedNumbers = numbers
      .filter((item) => item.eliminated)
      .map((item) => item.number);

    return {
      id: cycleId,
      source: row.source,
      instrument: row.instrument,
      status: row.status,
      integrityStatus: row.status === "invalid_gap" ? "gap" : "ok",
      origin: row.origin,
      startedAt: row.started_at,
      lastEventAt: row.last_event_at,
      completedAt: row.completed_at,
      survivorNumber:
        row.survivor_number === null ? null : Number(row.survivor_number),
      eventCount: Number(row.event_count),
      eliminatedCount: Number(row.eliminated_count),
      totalDraws: Number(row.event_count),
      uniqueCount: Number(row.eliminated_count),
      remainingCount: remainingNumbers.length,
      remainingNumbers,
      eliminatedNumbers,
      numbers,
    };
  }

  #cycleById(cycleId) {
    const row = this.sqlite
      .prepare("SELECT * FROM cycles WHERE id = ?")
      .get(cycleId);
    return this.#hydrateCycle(row);
  }

  #classifyHistoricalEventsInTransaction(events) {
    const outcome = {
      received: events.length,
      known: 0,
      enriched: 0,
      prehistory: 0,
      unknownWithinCoverage: 0,
      afterCoverage: 0,
      missingGroups: new Map(),
    };
    if (events.length === 0) return outcome;

    const findKnown = this.sqlite.prepare(`
      SELECT *
      FROM round_results
      WHERE fingerprint = ?
         OR (
           ? IS NOT NULL
           AND source = ?
           AND instrument = ?
           AND external_round_id = ?
         )
      ORDER BY CASE WHEN fingerprint = ? THEN 0 ELSE 1 END
      LIMIT 1
    `);
    const enrichKnown = this.sqlite.prepare(`
      UPDATE round_results
      SET
        external_round_id = COALESCE(external_round_id, ?),
        raw_cell = COALESCE(?, raw_cell),
        raw_payload = COALESCE(?, raw_payload)
      WHERE id = ?
    `);
    const coverageByStream = new Map();

    for (const event of events) {
      const existing = findKnown.get(
        event.fingerprint,
        event.externalRoundId,
        event.source,
        event.instrument,
        event.externalRoundId,
        event.fingerprint,
      );
      if (existing) {
        outcome.known += 1;
        if (event.externalRoundId !== null) {
          outcome.enriched += Number(
            enrichKnown.run(
              event.externalRoundId,
              event.rawCell,
              event.rawPayload,
              Number(existing.id),
            ).changes,
          );
        }
        continue;
      }

      const streamKey = `${event.source}\u0000${event.instrument}`;
      let coverage = coverageByStream.get(streamKey);
      if (!coverage) {
        const continuityEpoch = this.#continuityEpoch(
          event.source,
          event.instrument,
        );
        const row = this.sqlite
          .prepare(`
            SELECT
              (
                SELECT settled_at
                FROM round_results
                WHERE source = ?
                  AND instrument = ?
                  AND continuity_epoch = ?
                ORDER BY settled_at, id
                LIMIT 1
              ) AS earliest_settled_at,
              (
                SELECT settled_at
                FROM round_results
                WHERE source = ?
                  AND instrument = ?
                  AND continuity_epoch = ?
                ORDER BY settled_at DESC, id DESC
                LIMIT 1
              ) AS latest_settled_at
          `)
          .get(
            event.source,
            event.instrument,
            continuityEpoch,
            event.source,
            event.instrument,
            continuityEpoch,
          );
        coverage = {
          source: event.source,
          instrument: event.instrument,
          continuityEpoch,
          earliestSettledAt: row.earliest_settled_at,
          latestSettledAt: row.latest_settled_at,
        };
        coverageByStream.set(streamKey, coverage);
      }

      if (
        coverage.earliestSettledAt === null ||
        event.settledAt < coverage.earliestSettledAt
      ) {
        outcome.prehistory += 1;
        continue;
      }
      if (event.settledAt > coverage.latestSettledAt) {
        outcome.afterCoverage += 1;
        continue;
      }

      outcome.unknownWithinCoverage += 1;
      let group = outcome.missingGroups.get(streamKey);
      if (!group) {
        group = { ...coverage, events: [] };
        outcome.missingGroups.set(streamKey, group);
      }
      group.events.push(event);
    }

    return outcome;
  }

  #lateHistoricalGap(group, now) {
    const identities = group.events
      .map((event) =>
        event.externalRoundId === null
          ? `fingerprint:${event.fingerprint}`
          : `round:${event.externalRoundId}`,
      )
      .sort();
    return this.#normalizeGap(
      {
        source: group.source,
        instrument: group.instrument,
        reason: "late-history-within-coverage",
        incidentKey: `late-history\u0000${identities.join("\u0001")}`,
        detectedAt: now,
        from: group.earliestSettledAt,
        to: group.latestSettledAt,
        continuityEpoch: group.continuityEpoch,
        message:
          "Обнаружен ранее неизвестный исторический результат внутри сохранённой последовательности.",
        historicalResults: group.events.map((event) => ({
          fingerprint: event.fingerprint,
          externalRoundId: event.externalRoundId,
          settledAt: event.settledAt,
          resultNumber: event.resultNumber,
        })),
      },
      now,
    );
  }

  #normalizeGap(details, now) {
    if (!details || typeof details !== "object" || Array.isArray(details)) {
      throw new TypeError("gap details must be an object");
    }
    return {
      kind: "gap",
      source: asNonEmptyText(details.source, "buleto", "source"),
      instrument: asNonEmptyText(details.instrument, "default", "instrument"),
      message:
        details.message === undefined || details.message === null
          ? null
          : String(details.message),
      incidentKey:
        details.incidentKey === undefined || details.incidentKey === null
          ? null
          : asNonEmptyText(String(details.incidentKey), undefined, "incidentKey"),
      detectedAt: asTimestamp(
        details.detectedAt ?? details.observedAt,
        now,
        "detectedAt",
      ),
      detailsJson: serializeJson(details, "gap details"),
    };
  }

  #markGapInTransaction(incident, now) {
    if (incident.incidentKey !== null) {
      const existing = this.sqlite
        .prepare(`
          SELECT *
          FROM incidents
          WHERE source = ? AND instrument = ? AND incident_key = ?
        `)
        .get(incident.source, incident.instrument, incident.incidentKey);
      if (existing) {
        return {
          row: existing,
          cycleId: existing.cycle_id == null ? null : Number(existing.cycle_id),
          duplicate: true,
        };
      }
    }

    const cycleId = this.#activeCycleId(incident.source, incident.instrument);
    if (cycleId !== null) {
      this.sqlite
        .prepare(`
          UPDATE cycles
          SET
            status = 'invalid_gap',
            last_event_at = ?,
            completed_at = ?,
            survivor_number = NULL
          WHERE id = ? AND status = 'active'
        `)
        .run(incident.detectedAt, incident.detectedAt, cycleId);
    }

    const insertion = this.sqlite
      .prepare(`
        INSERT INTO incidents (
          kind,
          source,
          instrument,
          message,
          incident_key,
          detected_at,
          details_json,
          cycle_id,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        incident.kind,
        incident.source,
        incident.instrument,
        incident.message,
        incident.incidentKey,
        incident.detectedAt,
        incident.detailsJson,
        cycleId,
        now,
      );
    this.#invalidateVirtualBettorForGap(
      incident.source,
      incident.instrument,
      incident.detectedAt,
    );
    const continuityEpoch = this.#advanceContinuityEpoch(
      incident.source,
      incident.instrument,
    );
    return {
      row: this.sqlite
        .prepare("SELECT * FROM incidents WHERE id = ?")
        .get(Number(insertion.lastInsertRowid)),
      cycleId,
      duplicate: false,
      continuityEpoch,
    };
  }

  #mapGapOutcome(outcome) {
    if (!outcome) return null;
    return {
      ...mapIncident(outcome.row),
      invalidatedCycle:
        outcome.cycleId === null ? null : this.#cycleById(outcome.cycleId),
      duplicate: outcome.duplicate,
    };
  }

  ingestBatch(events, { gapBefore = null, historicalEvents = [] } = {}) {
    this.#assertOpen();
    if (!Array.isArray(events)) {
      throw new TypeError("events must be an array");
    }
    if (!Array.isArray(historicalEvents)) {
      throw new TypeError("historicalEvents must be an array");
    }

    if (
      events.length === 0 &&
      historicalEvents.length === 0 &&
      gapBefore === null
    ) {
      return {
        received: 0,
        inserted: 0,
        duplicates: 0,
        results: [],
        completedCycles: [],
        state: this.getDashboardState(),
      };
    }

    const now = new Date().toISOString();
    const normalizedGap = gapBefore === null ? null : this.#normalizeGap(gapBefore, now);
    const normalizedEvents = events
      .map((event, index) => normalizeEvent(event, index, now))
      .sort(
        (left, right) =>
          left.settledAt.localeCompare(right.settledAt) ||
          left.observedAt.localeCompare(right.observedAt) ||
          left.inputIndex - right.inputIndex,
      );
    const normalizedHistoricalEvents = historicalEvents
      .map((event, index) => normalizeEvent(event, index, now))
      .sort(
        (left, right) =>
          left.settledAt.localeCompare(right.settledAt) ||
          left.observedAt.localeCompare(right.observedAt) ||
          left.inputIndex - right.inputIndex,
      );

    let transactionResult;
    try {
      transactionResult = this.#transaction(() => {
        const historicalOutcome = this.#classifyHistoricalEventsInTransaction(
          normalizedHistoricalEvents,
        );
        const gapOutcomes = [];
        if (normalizedGap !== null) {
          gapOutcomes.push(this.#markGapInTransaction(normalizedGap, now));
        } else {
          for (const group of historicalOutcome.missingGroups.values()) {
            gapOutcomes.push(
              this.#markGapInTransaction(this.#lateHistoricalGap(group, now), now),
            );
          }
        }
        const gapOutcome = gapOutcomes[0] ?? null;
        let duplicateCount = 0;
        const insertedResults = [];
        const completedCycleIds = [];
        const continuityEpochs = new Map();
        const insertResult = this.sqlite.prepare(`
          INSERT INTO round_results (
            source,
            instrument,
            settled_at,
            result_number,
            price,
            observed_at,
            external_round_id,
            raw_cell,
            fingerprint,
            raw_payload,
            continuity_epoch,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT DO NOTHING
        `);

        for (const event of normalizedEvents) {
          const streamKey = `${event.source}\u0000${event.instrument}`;
          let continuityEpoch = continuityEpochs.get(streamKey);
          if (continuityEpoch === undefined) {
            continuityEpoch = this.#continuityEpoch(event.source, event.instrument);
            continuityEpochs.set(streamKey, continuityEpoch);
          }
          const insertion = insertResult.run(
            event.source,
            event.instrument,
            event.settledAt,
            event.resultNumber,
            event.price,
            event.observedAt,
            event.externalRoundId,
            event.rawCell,
            event.fingerprint,
            event.rawPayload,
            continuityEpoch,
            now,
          );

          if (Number(insertion.changes) === 0) {
            duplicateCount += 1;
            const existing = this.sqlite
              .prepare(`
                SELECT *
                FROM round_results
                WHERE fingerprint = ?
                   OR (
                     ? IS NOT NULL
                     AND source = ?
                     AND instrument = ?
                     AND external_round_id = ?
                   )
                ORDER BY CASE WHEN fingerprint = ? THEN 0 ELSE 1 END
                LIMIT 1
              `)
              .get(
                event.fingerprint,
                event.externalRoundId,
                event.source,
                event.instrument,
                event.externalRoundId,
                event.fingerprint,
              );

            if (existing && event.externalRoundId !== null) {
              this.sqlite
                .prepare(`
                  UPDATE round_results
                  SET
                    external_round_id = COALESCE(external_round_id, ?),
                    raw_cell = COALESCE(?, raw_cell),
                    raw_payload = COALESCE(?, raw_payload)
                  WHERE id = ?
                `)
                .run(
                  event.externalRoundId,
                  event.rawCell,
                  event.rawPayload,
                  Number(existing.id),
                );
            }
            continue;
          }

          const resultId = Number(insertion.lastInsertRowid);
          let cycleId = this.#activeCycleId(event.source, event.instrument);
          if (cycleId === null) {
            cycleId = this.#createCycle(
              event.source,
              event.instrument,
              event.origin,
              event.settledAt,
              now,
            );
          }

          const transition = eliminateNumber(
            this.#remainingNumbers(cycleId),
            event.resultNumber,
          );

          if (transition.eliminated) {
            this.sqlite
              .prepare(`
                UPDATE cycle_numbers
                SET eliminated_at = ?, eliminated_by_result_id = ?
                WHERE cycle_id = ? AND number = ? AND eliminated_at IS NULL
              `)
              .run(event.settledAt, resultId, cycleId, event.resultNumber);
          }

          this.sqlite
            .prepare(`
              INSERT INTO cycle_events (
                cycle_id,
                round_result_id,
                result_number,
                eliminated,
                remaining_count,
                occurred_at,
                created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `)
            .run(
              cycleId,
              resultId,
              event.resultNumber,
              transition.eliminated ? 1 : 0,
              transition.remainingCount,
              event.settledAt,
              now,
            );

          this.sqlite
            .prepare("UPDATE round_results SET cycle_id = ? WHERE id = ?")
            .run(cycleId, resultId);

          if (transition.completed) {
            this.sqlite
              .prepare(`
                UPDATE cycles
                SET
                  status = 'completed',
                  last_event_at = ?,
                  completed_at = ?,
                  survivor_number = ?,
                  event_count = event_count + 1,
                  eliminated_count = eliminated_count + ?
                WHERE id = ? AND status = 'active'
              `)
              .run(
                event.settledAt,
                event.settledAt,
                transition.survivorNumber,
                transition.eliminated ? 1 : 0,
                cycleId,
              );
            completedCycleIds.push(cycleId);
          } else {
            this.sqlite
              .prepare(`
                UPDATE cycles
                SET
                  last_event_at = ?,
                  event_count = event_count + 1,
                  eliminated_count = eliminated_count + ?
                WHERE id = ? AND status = 'active'
              `)
              .run(
                event.settledAt,
                transition.eliminated ? 1 : 0,
                cycleId,
              );
          }

          const storedRow = this.sqlite
            .prepare(`
              SELECT
                rr.*,
                ce.eliminated AS was_new,
                ce.remaining_count AS remaining_after
              FROM round_results AS rr
              LEFT JOIN cycle_events AS ce ON ce.round_result_id = rr.id
              WHERE rr.id = ?
            `)
            .get(resultId);
          this.#processVirtualBettorResult(storedRow, now);
          insertedResults.push(mapRoundResult(storedRow));
        }

        return {
          received: events.length,
          inserted: insertedResults.length,
          duplicates: duplicateCount,
          results: insertedResults,
          completedCycleIds,
          gapOutcome,
          gapOutcomes,
          historicalOutcome,
        };
      });
    } catch (error) {
      emitLog(
        this.logger,
        "error",
        { error, received: events.length },
        "roulette batch ingestion failed",
      );
      throw error;
    }

    const completedCycles = transactionResult.completedCycleIds.map((cycleId) =>
      this.#cycleById(cycleId),
    );
    const response = {
      received: transactionResult.received,
      inserted: transactionResult.inserted,
      duplicates: transactionResult.duplicates,
      results: transactionResult.results,
      completedCycles,
      gap: this.#mapGapOutcome(transactionResult.gapOutcome),
      gaps: transactionResult.gapOutcomes.map((outcome) =>
        this.#mapGapOutcome(outcome),
      ),
      historical: {
        received: transactionResult.historicalOutcome.received,
        known: transactionResult.historicalOutcome.known,
        enriched: transactionResult.historicalOutcome.enriched,
        prehistory: transactionResult.historicalOutcome.prehistory,
        unknownWithinCoverage:
          transactionResult.historicalOutcome.unknownWithinCoverage,
        afterCoverage: transactionResult.historicalOutcome.afterCoverage,
      },
      state: this.getDashboardState(),
    };

    emitLog(
      this.logger,
      "info",
      {
        received: response.received,
        inserted: response.inserted,
        duplicates: response.duplicates,
      },
      "roulette batch ingested",
    );

    return response;
  }

  ingestBatchAfterGap(details, events, { historicalEvents = [] } = {}) {
    return this.ingestBatch(events, { gapBefore: details, historicalEvents });
  }

  getDashboardState() {
    this.#assertOpen();
    const activeRows = this.sqlite
      .prepare(`
        SELECT *
        FROM cycles
        WHERE status = 'active'
        ORDER BY last_event_at DESC, id DESC
      `)
      .all();
    const activeCycles = activeRows.map((row) => this.#hydrateCycle(row));
    const completedRow = this.sqlite
      .prepare(`
        SELECT *
        FROM cycles
        WHERE status = 'completed'
        ORDER BY completed_at DESC, id DESC
        LIMIT 1
      `)
      .get();
    const latestCycleRow = this.sqlite
      .prepare(`
        SELECT *
        FROM cycles
        ORDER BY last_event_at DESC, id DESC
        LIMIT 1
      `)
      .get();
    const latestResultRow = this.sqlite
      .prepare(`
        SELECT
          rr.*,
          ce.eliminated AS was_new,
          ce.remaining_count AS remaining_after
        FROM round_results AS rr
        LEFT JOIN cycle_events AS ce ON ce.round_result_id = rr.id
        ORDER BY rr.settled_at DESC, rr.id DESC
        LIMIT 1
      `)
      .get();
    const recentIncidentRows = this.sqlite
      .prepare("SELECT * FROM incidents ORDER BY detected_at DESC, id DESC LIMIT 10")
      .all();
    const totals = this.sqlite
      .prepare(`
        SELECT
          (SELECT COUNT(*) FROM round_results) AS results,
          (SELECT COUNT(*) FROM cycles) AS cycles,
          (SELECT COUNT(*) FROM cycles WHERE status = 'completed') AS completed_cycles,
          (SELECT COUNT(*) FROM cycles WHERE status = 'invalid_gap') AS invalid_cycles,
          (SELECT COUNT(*) FROM incidents) AS incidents
      `)
      .get();

    return {
      activeCycle: activeCycles[0] ?? null,
      activeCycles,
      latestCycle: this.#hydrateCycle(latestCycleRow),
      latestCompletedCycle: this.#hydrateCycle(completedRow),
      latestResult: mapRoundResult(latestResultRow),
      recentIncidents: recentIncidentRows.map(mapIncident),
      totals: {
        results: Number(totals.results),
        cycles: Number(totals.cycles),
        completedCycles: Number(totals.completed_cycles),
        invalidCycles: Number(totals.invalid_cycles),
        incidents: Number(totals.incidents),
      },
    };
  }

  getLatestResult(source = "buleto", instrument = "default") {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const row = this.sqlite
      .prepare(`
        SELECT
          rr.*,
          ce.eliminated AS was_new,
          ce.remaining_count AS remaining_after
        FROM round_results AS rr
        LEFT JOIN cycle_events AS ce ON ce.round_result_id = rr.id
        WHERE rr.source = ? AND rr.instrument = ?
        ORDER BY rr.settled_at DESC, rr.id DESC
        LIMIT 1
      `)
      .get(safeSource, safeInstrument);
    return mapRoundResult(row);
  }

  getNumberStats(source = "buleto", instrument = "default") {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const rows = this.sqlite
      .prepare(`
        WITH ordered AS (
          SELECT
            result_number,
            settled_at,
            ROW_NUMBER() OVER (ORDER BY settled_at, id) AS position,
            COUNT(*) OVER () AS total_rounds
          FROM round_results
          WHERE source = ? AND instrument = ?
        )
        SELECT
          result_number,
          COUNT(*) AS occurrence_count,
          MAX(settled_at) AS last_seen_at,
          MAX(total_rounds) - MAX(position) AS rounds_since_last
        FROM ordered
        GROUP BY result_number
        ORDER BY result_number
      `)
      .all(safeSource, safeInstrument);
    const byNumber = new Map(rows.map((row) => [Number(row.result_number), row]));

    return ROULETTE_NUMBERS.map((number) => {
      const row = byNumber.get(number);
      return {
        number,
        occurrenceCount: row ? Number(row.occurrence_count) : 0,
        lastSeenAt: row?.last_seen_at ?? null,
        roundsSinceLast: row ? Number(row.rounds_since_last) : null,
      };
    });
  }

  initializeVirtualBettor(source = "buleto", instrument = "default") {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const now = new Date().toISOString();
    this.#transaction(() => {
      this.#armVirtualBettorInTransaction(
        safeSource,
        safeInstrument,
        now,
      );
    });
    return this.getVirtualBettorState(safeSource, safeInstrument);
  }

  getVirtualBetSessions(
    source = "buleto",
    instrument = "default",
    limit = 20,
  ) {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const safeLimit = normalizedLimit(limit, 20);
    return this.sqlite
      .prepare(`
        SELECT
          sessions.*,
          (
            SELECT MIN(bets.occurred_at)
            FROM virtual_bets AS bets
            WHERE bets.session_id = sessions.id
          ) AS started_at
        FROM virtual_bet_sessions AS sessions
        WHERE sessions.source = ? AND sessions.instrument = ?
        ORDER BY sessions.id DESC
        LIMIT ?
      `)
      .all(safeSource, safeInstrument, safeLimit)
      .map(mapVirtualBetSession);
  }

  getVirtualBettorState(source = "buleto", instrument = "default") {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const epochRow = this.sqlite
      .prepare(`
        SELECT continuity_epoch
        FROM stream_state
        WHERE source = ? AND instrument = ?
      `)
      .get(safeSource, safeInstrument);
    const continuityEpoch = Number(epochRow?.continuity_epoch ?? 0);
    const liveRow = this.#liveVirtualBetSessionRow(safeSource, safeInstrument);
    const recentRows = this.sqlite
      .prepare(`
        SELECT
          sessions.*,
          (
            SELECT MIN(bets.occurred_at)
            FROM virtual_bets AS bets
            WHERE bets.session_id = sessions.id
          ) AS started_at
        FROM virtual_bet_sessions AS sessions
        WHERE sessions.source = ?
          AND sessions.instrument = ?
          AND sessions.status IN ('completed', 'invalid_gap')
        ORDER BY sessions.id DESC
        LIMIT 10
      `)
      .all(safeSource, safeInstrument);
    const lifetime = this.sqlite
      .prepare(`
        SELECT
          COUNT(DISTINCT sessions.id) AS total_sessions,
          COUNT(DISTINCT CASE WHEN sessions.status = 'completed' THEN sessions.id END)
            AS completed_sessions,
          COUNT(DISTINCT CASE WHEN sessions.status = 'invalid_gap' THEN sessions.id END)
            AS invalidated_sessions,
          COUNT(bets.id) AS total_bets,
          COALESCE(SUM(CASE WHEN bets.outcome = 'hit' THEN 1 ELSE 0 END), 0)
            AS winning_bets,
          COALESCE(SUM(CASE WHEN bets.outcome = 'miss' THEN 1 ELSE 0 END), 0)
            AS losing_bets,
          COALESCE(SUM(bets.stake), 0) AS total_staked,
          COALESCE(SUM(bets.gross_payout), 0) AS gross_payout
        FROM virtual_bet_sessions AS sessions
        LEFT JOIN virtual_bets AS bets ON bets.session_id = sessions.id
        WHERE sessions.source = ? AND sessions.instrument = ?
      `)
      .get(safeSource, safeInstrument);
    const totalStaked = Number(lifetime.total_staked);
    const grossPayout = Number(lifetime.gross_payout);

    return {
      mode: "simulation",
      executionEnabled: false,
      status: liveRow?.status ?? "waiting",
      triggerThreshold: VIRTUAL_BET_MODEL.triggerThreshold,
      model: { ...VIRTUAL_BET_MODEL },
      longestCandidate: this.#longestVirtualCandidate(
        safeSource,
        safeInstrument,
        continuityEpoch,
      ),
      activeSession: mapVirtualBetSession(liveRow),
      recentSessions: recentRows.map(mapVirtualBetSession),
      lifetime: {
        totalSessions: Number(lifetime.total_sessions),
        completedSessions: Number(lifetime.completed_sessions),
        invalidatedSessions: Number(lifetime.invalidated_sessions),
        totalBets: Number(lifetime.total_bets),
        winningBets: Number(lifetime.winning_bets),
        losingBets: Number(lifetime.losing_bets),
        totalStaked,
        grossPayout,
        netResult: grossPayout - totalStaked,
      },
    };
  }

  getRepeatedTriples(
    source = "buleto",
    instrument = "default",
    limit = 20,
  ) {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const safeLimit = normalizedLimit(limit);
    return this.sqlite
      .prepare(`
        WITH ordered AS (
          SELECT
            result_number AS first_number,
            LEAD(result_number, 1) OVER stream_order AS second_number,
            LEAD(result_number, 2) OVER stream_order AS third_number,
            LEAD(settled_at, 2) OVER stream_order AS occurred_at
          FROM round_results
          WHERE source = ? AND instrument = ?
          WINDOW stream_order AS (
            PARTITION BY continuity_epoch
            ORDER BY settled_at, id
          )
        )
        SELECT
          first_number,
          second_number,
          third_number,
          COUNT(*) AS occurrence_count,
          MIN(occurred_at) AS first_occurred_at,
          MAX(occurred_at) AS last_occurred_at
        FROM ordered
        WHERE second_number IS NOT NULL AND third_number IS NOT NULL
        GROUP BY first_number, second_number, third_number
        HAVING COUNT(*) >= 2
        ORDER BY
          occurrence_count DESC,
          last_occurred_at DESC,
          first_number,
          second_number,
          third_number
        LIMIT ?
      `)
      .all(safeSource, safeInstrument, safeLimit)
      .map((row) => ({
        numbers: [
          Number(row.first_number),
          Number(row.second_number),
          Number(row.third_number),
        ],
        occurrenceCount: Number(row.occurrence_count),
        firstOccurredAt: row.first_occurred_at,
        lastOccurredAt: row.last_occurred_at,
      }));
  }

  enrichKnownResults(events) {
    this.#assertOpen();
    if (!Array.isArray(events)) throw new TypeError("events must be an array");
    if (events.length === 0) return { received: 0, enriched: 0 };

    const now = new Date().toISOString();
    const normalizedEvents = events.map((event, index) => normalizeEvent(event, index, now));
    const outcome = this.#transaction(() =>
      this.#classifyHistoricalEventsInTransaction(normalizedEvents),
    );
    return { received: outcome.received, enriched: outcome.enriched };
  }

  getRecentResults(limit = DEFAULT_LIMIT) {
    this.#assertOpen();
    const safeLimit = normalizedLimit(limit);
    return this.sqlite
      .prepare(`
        SELECT
          rr.*,
          ce.eliminated AS was_new,
          ce.remaining_count AS remaining_after
        FROM round_results AS rr
        LEFT JOIN cycle_events AS ce ON ce.round_result_id = rr.id
        ORDER BY rr.settled_at DESC, rr.id DESC
        LIMIT ?
      `)
      .all(safeLimit)
      .map(mapRoundResult);
  }

  getCompletedCycles(limit = DEFAULT_LIMIT) {
    this.#assertOpen();
    const safeLimit = normalizedLimit(limit);
    return this.sqlite
      .prepare(`
        SELECT *
        FROM cycles
        WHERE status = 'completed'
        ORDER BY completed_at DESC, id DESC
        LIMIT ?
      `)
      .all(safeLimit)
      .map((row) => this.#hydrateCycle(row));
  }

  markGap(details = {}) {
    this.#assertOpen();
    const now = new Date().toISOString();
    const incident = this.#normalizeGap(details, now);
    const outcome = this.#transaction(() => this.#markGapInTransaction(incident, now));
    const mapped = this.#mapGapOutcome(outcome);
    emitLog(this.logger, "warn", mapped, "roulette result gap recorded");
    return mapped;
  }

  close() {
    if (this.closed) {
      return;
    }
    this.sqlite.close();
    this.closed = true;
  }
}

export function createDatabase(options = {}) {
  return new RouletteDatabase(options);
}
