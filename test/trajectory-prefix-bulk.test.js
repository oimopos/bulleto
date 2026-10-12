import test from "node:test";
import assert from "node:assert/strict";

import { createDatabase } from "../src/database.js";
import { predictAdaptiveTrajectoryShadow } from "../src/trajectory-shadow-adaptive.js";

const SOURCE = "buleto";
const INSTRUMENT = "XPM/RUB";
const CURRENT_START_MS = Date.parse("2026-10-11T12:00:00.000Z");
const CURRENT_LOCK_MS = CURRENT_START_MS + 51_000;
const HISTORY_COUNT = 501;
const CANDIDATE_LIMIT = 500;

function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function cells() {
  return Array.from({ length: 38 }, (_, code) => ({
    c: code,
    vt: 6 - code / 100,
    vf: 5.99 - code / 100,
  }));
}

function bands() {
  return cells().map((cell) => ({
    wireCell: cell.c,
    number: cell.c === 37 ? 0 : cell.c,
    lower: cell.vf,
    upper: cell.vt,
  }));
}

function legacyPrefix(database, trajectoryId, startsAt, cutoffAt, createdBefore) {
  const rows = database.sqlite
    .prepare(`
      SELECT id, factor_at, price, received_at, created_at
      FROM round_trajectory_ticks
      WHERE trajectory_id = ?
        AND factor_at <= ?
        AND received_at <= ?
        AND (? IS NULL OR created_at < ?)
      ORDER BY factor_at, received_at, id
    `)
    .all(trajectoryId, cutoffAt, cutoffAt, createdBefore, createdBefore);
  const latestByTimestamp = new Map();
  for (const row of rows) latestByTimestamp.set(row.factor_at, row);
  const prefix = [...latestByTimestamp.values()].map((row) => ({
    at: row.factor_at,
    price: Number(row.price),
  }));
  let maxGapMs = null;
  if (prefix.length > 1) {
    maxGapMs = 0;
    for (let index = 1; index < prefix.length; index += 1) {
      maxGapMs = Math.max(
        maxGapMs,
        Date.parse(prefix[index].at) - Date.parse(prefix[index - 1].at),
      );
    }
  }
  const coverage = {
    tickCount: prefix.length,
    firstAt: prefix[0]?.at ?? null,
    lastAt: prefix.at(-1)?.at ?? null,
    maxGapMs,
  };
  if (prefix.length < 3) {
    return {
      usable: false,
      reason: "fewer_than_three_distinct_timestamps",
      prefix,
      coverage,
    };
  }
  const startsMs = Date.parse(startsAt);
  const cutoffMs = Date.parse(cutoffAt);
  const firstMs = Date.parse(prefix[0].at);
  const lastMs = Date.parse(prefix.at(-1).at);
  if (!(cutoffMs > startsMs) || !(lastMs > firstMs)) {
    return { usable: false, reason: "non_positive_prefix_span", prefix, coverage };
  }
  if (firstMs > startsMs + 5_000) {
    return {
      usable: false,
      reason: "prefix_starts_after_round_tolerance",
      prefix,
      coverage,
    };
  }
  if (lastMs < cutoffMs - 5_000) {
    return {
      usable: false,
      reason: "prefix_ends_before_cutoff_tolerance",
      prefix,
      coverage,
    };
  }
  if (maxGapMs > 5_000) {
    return {
      usable: false,
      reason: "prefix_gap_exceeds_tolerance",
      prefix,
      coverage,
    };
  }
  return {
    usable: true,
    reason: null,
    prefix,
    coverage,
    lockPrice: prefix.at(-1).price,
  };
}

function forecastAttempt(roundId, currentPrice) {
  return {
    source: SOURCE,
    instrument: INSTRUMENT,
    externalRoundId: roundId,
    horizonSeconds: 8,
    bettingClosesAt: iso(CURRENT_START_MS + 60_000),
    roundEndsAt: iso(CURRENT_START_MS + 100_000),
    factorAt: iso(CURRENT_LOCK_MS),
    lockedAt: iso(CURRENT_LOCK_MS),
    currentPrice,
    startPrice: 5.35,
    currentNumber: 11,
    predictedPrice: currentPrice + 0.01,
    predictedNumber: 7,
    rankedNumbers: [7, 11, 19],
    cells: cells(),
    features: {
      samples: [
        { dt: iso(CURRENT_LOCK_MS - 4_000), v: currentPrice - 0.004 },
        { dt: iso(CURRENT_LOCK_MS - 2_000), v: currentPrice - 0.002 },
        { dt: iso(CURRENT_LOCK_MS), v: currentPrice },
      ],
      windowSeconds: 4,
      slopePerSecond: 0.001,
      secondsToEnd: 49,
    },
    modelVersion: "preclose-linear-v1",
  };
}

test("bulk trajectory prefix loading is differential-equivalent to 500 legacy queries", () => {
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(CURRENT_LOCK_MS + 2_000),
  });
  const bandsJson = JSON.stringify(bands());
  const insertTrajectory = database.sqlite.prepare(`
    INSERT INTO round_trajectories (
      schema_version, source, instrument, external_round_id,
      starts_at, betting_closes_at, betting_stops_at, round_ends_at,
      start_price, bottom_price, top_price, bands_json,
      first_received_at, created_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 5.35, 5, 6.1, ?, ?, ?)
  `);
  const insertTick = database.sqlite.prepare(`
    INSERT INTO round_trajectory_ticks (
      trajectory_id, factor_at, price, received_at, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `);
  const insertResult = database.sqlite.prepare(`
    INSERT INTO round_results (
      source, instrument, settled_at, result_number, price, observed_at,
      external_round_id, raw_cell, fingerprint, raw_payload,
      continuity_epoch, created_at
    ) VALUES (?, ?, ?, 7, ?, ?, ?, 7, ?, '{}', 0, ?)
  `);

  function insertRound(roundId, startsAtMs, index, { withResult = true } = {}) {
    const firstAt = iso(startsAtMs + 1_000);
    const trajectoryId = Number(insertTrajectory.run(
      SOURCE,
      INSTRUMENT,
      roundId,
      iso(startsAtMs),
      iso(startsAtMs + 60_000),
      iso(startsAtMs + 70_000),
      iso(startsAtMs + 100_000),
      bandsJson,
      firstAt,
      firstAt,
    ).lastInsertRowid);
    const offset = (index % 9) * 0.00005;
    for (const seconds of [1, 6, 11, 16, 21, 26, 31, 36, 41, 46, 51]) {
      const at = iso(startsAtMs + seconds * 1_000);
      insertTick.run(
        trajectoryId,
        at,
        5.35 + seconds * 0.001 + offset,
        at,
        at,
      );
    }
    const cutoffAt = iso(startsAtMs + 51_000);
    const correctedLockPrice = 5.4015 + offset;
    insertTick.run(
      trajectoryId,
      cutoffAt,
      correctedLockPrice,
      cutoffAt,
      cutoffAt,
    );
    insertTick.run(
      trajectoryId,
      cutoffAt,
      9 + offset,
      iso(startsAtMs + 52_000),
      iso(startsAtMs + 52_000),
    );
    if (withResult) {
      insertTick.run(
        trajectoryId,
        iso(startsAtMs + 46_000),
        8 + offset,
        iso(startsAtMs + 46_000),
        iso(CURRENT_LOCK_MS),
      );
    }
    if (withResult) {
      const completedAt = iso(startsAtMs + 100_000);
      insertResult.run(
        SOURCE,
        INSTRUMENT,
        completedAt,
        correctedLockPrice + ((index % 7) - 3) * 0.003,
        completedAt,
        roundId,
        `bulk-history-${index}`,
        completedAt,
      );
    }
    return { trajectoryId, cutoffAt, correctedLockPrice };
  }

  try {
    database.sqlite.exec("BEGIN IMMEDIATE");
    for (let index = 0; index < HISTORY_COUNT; index += 1) {
      const startsAtMs =
        CURRENT_START_MS - (HISTORY_COUNT - index) * 120_000;
      insertRound(`bulk-history-${index}`, startsAtMs, index);
    }
    const current = insertRound(
      "bulk-current",
      CURRENT_START_MS,
      0,
      { withResult: false },
    );
    database.sqlite.exec("COMMIT");

    const lockedAt = iso(CURRENT_LOCK_MS);
    const candidates = database.sqlite.prepare(`
      SELECT
        trajectories.*,
        results.id AS result_id,
        results.price AS result_price,
        results.settled_at AS result_settled_at,
        results.observed_at AS result_observed_at,
        results.created_at AS result_created_at,
        MAX(
          results.settled_at,
          results.observed_at,
          results.created_at
        ) AS completed_at
      FROM round_trajectories AS trajectories
      JOIN round_results AS results
        ON results.source = trajectories.source
       AND results.instrument = trajectories.instrument
       AND results.external_round_id = trajectories.external_round_id
      WHERE trajectories.source = ?
        AND trajectories.instrument = ?
        AND trajectories.id <> ?
        AND trajectories.created_at < ?
        AND results.price IS NOT NULL
        AND results.settled_at < ?
        AND results.observed_at < ?
        AND results.created_at < ?
      ORDER BY completed_at DESC, results.id DESC
      LIMIT ?
    `).all(
      SOURCE,
      INSTRUMENT,
      current.trajectoryId,
      lockedAt,
      lockedAt,
      lockedAt,
      lockedAt,
      CANDIDATE_LIMIT,
    );
    assert.equal(candidates.length, CANDIDATE_LIMIT);

    const history = candidates.map((candidate) => {
      const cutoffAt = iso(Date.parse(candidate.round_ends_at) - 49_000);
      const prefix = legacyPrefix(
        database,
        Number(candidate.id),
        candidate.starts_at,
        cutoffAt,
        lockedAt,
      );
      assert.equal(prefix.usable, true);
      const candidateBands = JSON.parse(candidate.bands_json);
      return {
        id: String(candidate.id),
        lockedAt: cutoffAt,
        completedAt: candidate.completed_at,
        prefix: prefix.prefix,
        cellWidths: candidateBands.map((band) => band.upper - band.lower),
        lockPrice: prefix.lockPrice,
        endPrice: Number(candidate.result_price),
      };
    });
    const currentPrefix = legacyPrefix(
      database,
      current.trajectoryId,
      iso(CURRENT_START_MS),
      lockedAt,
      null,
    );
    assert.equal(currentPrefix.usable, true);
    const expected = predictAdaptiveTrajectoryShadow({
      current: {
        id: String(current.trajectoryId),
        lockedAt,
        prefix: currentPrefix.prefix,
        cellWidths: bands().map((band) => band.upper - band.lower),
      },
      history,
      learningRows: [],
    });
    assert.equal(expected.status, "ready");
    assert.equal(expected.sample.historyCount, CANDIDATE_LIMIT);
    assert.equal(expected.adaptive.experts.length, 3);

    let tickPrefixSelectCount = 0;
    const originalPrepare = database.sqlite.prepare.bind(database.sqlite);
    database.sqlite.prepare = (sql) => {
      if (/\bFROM\s+(?:requested\s+JOIN\s+)?round_trajectory_ticks\b/i.test(sql)) {
        tickPrefixSelectCount += 1;
      }
      return originalPrepare(sql);
    };
    assert.deepEqual(
      database.recordPrecloseForecast(
        forecastAttempt("bulk-current", current.correctedLockPrice),
      ),
      { inserted: true, roundId: "bulk-current" },
    );
    assert.equal(
      tickPrefixSelectCount,
      2,
      "one current-prefix query plus one bulk history-prefix query",
    );

    const stored = database.sqlite.prepare(`
      SELECT *
      FROM forecast_trajectory_shadows
      ORDER BY forecast_id DESC
      LIMIT 1
    `).get();
    const integration = JSON.parse(stored.integration_json);
    assert.equal(stored.status, expected.status);
    assert.equal(stored.direction, expected.direction);
    assert.deepEqual(JSON.parse(stored.probabilities_json), expected.probabilities);
    assert.equal(
      Number(stored.expected_delta_cell_widths),
      expected.expectedDeltaCellWidths,
    );
    assert.deepEqual(JSON.parse(stored.sample_json), expected.sample);
    assert.deepEqual(JSON.parse(stored.nearest_ids_json), expected.nearestIds);
    assert.deepEqual(JSON.parse(stored.parameters_json), expected.parameters);
    assert.deepEqual(JSON.parse(stored.current_prefix_json), currentPrefix.prefix);
    assert.equal(integration.candidateLimit, CANDIDATE_LIMIT);
    assert.equal(integration.queriedCandidateCount, CANDIDATE_LIMIT);
    assert.equal(integration.usableHistoryCount, CANDIDATE_LIMIT);
    assert.equal(integration.excludedCoverageCount, 0);
    assert.deepEqual(integration.adaptive, expected.adaptive);
  } finally {
    if (database.sqlite.isTransaction) database.sqlite.exec("ROLLBACK");
    database.close();
  }
});
