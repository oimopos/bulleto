import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { createDatabase } from "../src/database.js";

const BASE_TIME = Date.parse("2026-09-21T00:00:00.000Z");

function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function event(resultNumber, fingerprint, offsetSeconds = 0, extra = {}) {
  const settledAt = new Date(BASE_TIME + offsetSeconds * 1_000).toISOString();
  return {
    source: "buleto",
    instrument: "PRIMECOIN(XPM)/RUB",
    settledAt,
    resultNumber,
    price: 5.4 + offsetSeconds / 10_000,
    observedAt: settledAt,
    fingerprint,
    rawPayload: { c: resultNumber },
    ...extra,
  };
}

function precloseForecast(externalRoundId, overrides = {}) {
  const bettingClosesAt = new Date(BASE_TIME + 60_000).toISOString();
  const lockedAt = new Date(BASE_TIME + 51_000).toISOString();
  const factorAt = lockedAt;
  return {
    source: "buleto",
    instrument: "PRIMECOIN(XPM)/RUB",
    externalRoundId,
    horizonSeconds: 8,
    bettingClosesAt,
    roundEndsAt: new Date(BASE_TIME + 100_000).toISOString(),
    factorAt,
    lockedAt,
    currentPrice: 5.4,
    startPrice: 5.35,
    currentNumber: 11,
    predictedPrice: 5.41,
    predictedNumber: 7,
    rankedNumbers: [7, 11, 19],
    cells: Array.from({ length: 38 }, (_, code) => ({
      c: code,
      vt: 6 - code / 100,
      vf: 5.99 - code / 100,
    })),
    features: {
      samples: [
        { dt: new Date(BASE_TIME + 47_000).toISOString(), v: 5.38 },
        { dt: new Date(BASE_TIME + 49_000).toISOString(), v: 5.39 },
        { dt: factorAt, v: 5.4 },
      ],
      windowSeconds: 4,
      slopePerSecond: 0.005,
      secondsToEnd: 46,
    },
    modelVersion: "preclose-linear-v1",
    ...overrides,
  };
}

function startPriceForecast(externalRoundId, overrides = {}) {
  const base = precloseForecast(externalRoundId);
  const factorAt = overrides.factorAt ?? base.factorAt;
  const roundEndsAt = overrides.roundEndsAt ?? base.roundEndsAt;
  const features = {
    ...base.features,
    windowSeconds: 12,
    secondsToEnd: (Date.parse(roundEndsAt) - Date.parse(factorAt)) / 1_000,
    ...(overrides.features ?? {}),
  };
  const currentPrice = overrides.currentPrice ?? base.currentPrice;
  const startPrice = overrides.startPrice ?? base.startPrice;
  return {
    ...base,
    ...overrides,
    currentPrice,
    startPrice,
    predictedPrice: overrides.predictedPrice ?? startPrice,
    currentNumber: overrides.currentNumber ?? 0,
    predictedNumber: overrides.predictedNumber ?? 0,
    rankedNumbers: overrides.rankedNumbers ?? [0, 36, 35],
    modelVersion: "start-price-v2",
    features: {
      ...features,
      predictionBasis: features.predictionBasis ?? "start_price",
      shadow:
        features.shadow ??
        {
          modelVersion: "linear-trend-12s-to-ed-v1",
          projectedPrice:
            currentPrice + features.slopePerSecond * features.secondsToEnd,
        },
    },
  };
}

function roundTrajectory(
  externalRoundId,
  {
    startsAtMs = BASE_TIME,
    bettingClosesAtMs = startsAtMs + 60_000,
    bettingStopsAtMs = startsAtMs + 70_000,
    endsAtMs = startsAtMs + 100_000,
    receivedAtMs = startsAtMs + 50_000,
    startPrice = 5.35,
    bottomPrice = 5,
    topPrice = 6.1,
    cells = precloseForecast(externalRoundId).cells,
    factors = [],
  } = {},
) {
  return {
    schemaVersion: 1,
    source: "buleto",
    instrument: "PRIMECOIN(XPM)/RUB",
    receivedAt: iso(receivedAtMs),
    round: {
      externalRoundId: String(externalRoundId),
      status: 2,
      startsAt: iso(startsAtMs),
      bettingClosesAt: iso(bettingClosesAtMs),
      bettingStopsAt: iso(bettingStopsAtMs),
      endsAt: iso(endsAtMs),
      startPrice,
      bottomPrice,
      topPrice,
      cellBands: cells.map((cell) => ({
        wireCell: cell.c,
        number: cell.c === 37 ? 0 : cell.c,
        lower: cell.vf,
        upper: cell.vt,
      })),
    },
    factors: factors.map((factor) => ({
      at: iso(factor.atMs),
      price: factor.price,
      receivedAt: iso(factor.receivedAtMs ?? factor.atMs),
    })),
  };
}

function replaceConsensusTableWithV13Schema(database) {
  database.sqlite.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN IMMEDIATE;
    ALTER TABLE forecast_consensus_snapshots
      RENAME TO forecast_consensus_snapshots_v14_source;
    CREATE TABLE forecast_consensus_snapshots (
      forecast_id INTEGER PRIMARY KEY REFERENCES round_forecasts(id),
      schema_version INTEGER NOT NULL CHECK (schema_version = 1),
      algorithm_version TEXT NOT NULL CHECK (
        algorithm_version = 'consensus-borda-v1'
      ),
      status TEXT NOT NULL CHECK (
        status IN ('combined', 'model_fallback', 'pair_fallback', 'unavailable')
      ),
      top3_json TEXT NOT NULL CHECK (json_valid(top3_json)),
      inputs_used_json TEXT NOT NULL CHECK (json_valid(inputs_used_json)),
      pair_sample_size INTEGER CHECK (
        pair_sample_size IS NULL OR pair_sample_size >= 0
      ),
      derived_from_snapshot_at TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      CHECK (json_type(top3_json) = 'array'),
      CHECK (json_type(inputs_used_json) = 'array'),
      CHECK (
        (status = 'unavailable' AND json_array_length(top3_json) = 0)
        OR
        (status <> 'unavailable' AND json_array_length(top3_json) = 3)
      ),
      CHECK (
        status = 'unavailable'
        OR (
          json_type(top3_json, '$[0]') = 'integer'
          AND json_type(top3_json, '$[1]') = 'integer'
          AND json_type(top3_json, '$[2]') = 'integer'
          AND json_extract(top3_json, '$[0]') BETWEEN 0 AND 36
          AND json_extract(top3_json, '$[1]') BETWEEN 0 AND 36
          AND json_extract(top3_json, '$[2]') BETWEEN 0 AND 36
          AND json_extract(top3_json, '$[0]') <> json_extract(top3_json, '$[1]')
          AND json_extract(top3_json, '$[0]') <> json_extract(top3_json, '$[2]')
          AND json_extract(top3_json, '$[1]') <> json_extract(top3_json, '$[2]')
        )
      ),
      CHECK (
        (status = 'combined' AND inputs_used_json = '["model","pair"]')
        OR
        (status = 'model_fallback' AND inputs_used_json = '["model"]')
        OR
        (status = 'pair_fallback' AND inputs_used_json = '["pair"]')
        OR
        (status = 'unavailable' AND inputs_used_json = '[]')
      ),
      CHECK (
        (status = 'combined' AND reason = 'frozen_model_and_pair')
        OR
        (status = 'model_fallback' AND reason IN (
          'pair_not_ready',
          'invalid_pair_ranking',
          'empty_pair_ranking',
          'pair_snapshot_model_mismatch'
        ))
        OR
        (status = 'pair_fallback' AND reason = 'model_unavailable')
        OR
        (status = 'unavailable' AND reason IN (
          'incomplete_model_ranking',
          'invalid_model_ranking'
        ))
      ),
      CHECK (
        status NOT IN ('combined', 'pair_fallback')
        OR (pair_sample_size IS NOT NULL AND pair_sample_size > 0)
      ),
      CHECK (derived_from_snapshot_at <= created_at)
    );
    INSERT INTO forecast_consensus_snapshots (
      forecast_id, schema_version, algorithm_version, status,
      top3_json, inputs_used_json, pair_sample_size,
      derived_from_snapshot_at, reason, created_at
    )
    SELECT
      forecast_id, schema_version, algorithm_version, status,
      top3_json, inputs_used_json, pair_sample_size,
      derived_from_snapshot_at, reason, created_at
    FROM forecast_consensus_snapshots_v14_source;
    DROP TABLE forecast_consensus_snapshots_v14_source;
    PRAGMA user_version = 13;
    COMMIT;
    PRAGMA foreign_keys = ON;
  `);
}

function markResultsCreatedAtObservation(database, fingerprintPrefix) {
  database.sqlite
    .prepare(`
      UPDATE round_results
      SET created_at = observed_at
      WHERE fingerprint LIKE ?
    `)
    .run(`${fingerprintPrefix}%`);
}

function markForecastSettlementsCreatedAtSettlement(database) {
  database.sqlite
    .prepare("UPDATE forecast_settlements SET created_at = settled_at")
    .run();
}

function cloneSettledAdaptiveForecast(
  database,
  {
    templateForecastId,
    externalRoundId,
    settledAt,
    observedAt = settledAt,
    createdAt = observedAt,
    settlementCreatedAt = createdAt,
    price = 5.36,
    rawCell = 23,
  },
) {
  const templateSnapshotId = Number(
    database.sqlite
      .prepare("SELECT snapshot_id FROM round_forecasts WHERE id = ?")
      .get(templateForecastId).snapshot_id,
  );
  const snapshot = database.sqlite
    .prepare(`
      INSERT INTO forecast_snapshots (
        source, instrument, external_round_id, horizon_seconds,
        betting_closes_at, round_ends_at, factor_at, locked_at,
        lead_time_ms, persisted_at, persisted_lead_time_ms,
        current_price, start_price, current_number,
        cells_json, features_json, created_at
      )
      SELECT
        source, instrument, ?, horizon_seconds,
        betting_closes_at, round_ends_at, factor_at, locked_at,
        lead_time_ms, persisted_at, persisted_lead_time_ms,
        current_price, start_price, current_number,
        cells_json, features_json, created_at
      FROM forecast_snapshots
      WHERE id = ?
    `)
    .run(externalRoundId, templateSnapshotId);
  const forecast = database.sqlite
    .prepare(`
      INSERT INTO round_forecasts (
        snapshot_id, model_version, predicted_price, predicted_number,
        ranked_numbers_json, created_at
      )
      SELECT ?, model_version, predicted_price, predicted_number,
             ranked_numbers_json, created_at
      FROM round_forecasts
      WHERE id = ?
    `)
    .run(Number(snapshot.lastInsertRowid), templateForecastId);
  const forecastId = Number(forecast.lastInsertRowid);
  database.sqlite
    .prepare(`
      INSERT INTO forecast_trajectory_shadows (
        forecast_id, trajectory_id, schema_version, model_version,
        status, reason, cutoff_at, lock_price, median_cell_width,
        direction, probabilities_json, expected_delta_cell_widths,
        sample_json, nearest_ids_json, parameters_json,
        current_prefix_json, integration_json, created_at
      )
      SELECT ?, trajectory_id, schema_version, model_version,
             status, reason, cutoff_at, lock_price, median_cell_width,
             direction, probabilities_json, expected_delta_cell_widths,
             sample_json, nearest_ids_json, parameters_json,
             current_prefix_json, integration_json, created_at
      FROM forecast_trajectory_shadows
      WHERE forecast_id = ?
    `)
    .run(forecastId, templateForecastId);
  const canonicalNumber = rawCell === 37 ? 0 : rawCell;
  const result = database.sqlite
    .prepare(`
      INSERT INTO round_results (
        source, instrument, settled_at, result_number, price, observed_at,
        external_round_id, raw_cell, fingerprint, raw_payload,
        continuity_epoch, created_at
      ) VALUES ('buleto', 'PRIMECOIN(XPM)/RUB', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `)
    .run(
      settledAt,
      canonicalNumber,
      price,
      observedAt,
      externalRoundId,
      rawCell,
      `adaptive-learning-${externalRoundId}`,
      JSON.stringify({ c: rawCell }),
      createdAt,
    );
  database.sqlite
    .prepare(`
      INSERT INTO forecast_settlements (
        forecast_id, round_result_id, actual_number, settled_at,
        top1_hit, top3_hit, current_cell_hit, created_at
      ) VALUES (?, ?, ?, ?, 0, 0, 0, ?)
    `)
    .run(
      forecastId,
      Number(result.lastInsertRowid),
      canonicalNumber,
      settledAt,
      settlementCreatedAt,
    );
  return forecastId;
}

function virtualTriggerEvents(
  prefix,
  targetNumber = 1,
  fillerNumber = 2,
  extra = {},
) {
  const otherNumbers = Array.from({ length: 37 }, (_, number) => number).filter(
    (number) => number !== targetNumber,
  );
  const rotation = otherNumbers.indexOf(fillerNumber);
  const rotated =
    rotation < 0
      ? otherNumbers
      : [...otherNumbers.slice(rotation), ...otherNumbers.slice(0, rotation)];
  return [
    event(targetNumber, `${prefix}-target`, 0, extra),
    ...Array.from({ length: 200 }, (_, index) =>
      event(rotated[index % rotated.length], `${prefix}-miss-${index}`, index + 1, extra),
    ),
  ];
}

test("schema contains all persistence tables", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const tables = database.sqlite
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `)
      .all()
      .map((row) => row.name);

    assert.deepEqual(tables, [
      "cycle_events",
      "cycle_numbers",
      "cycles",
      "follower_top5_attempts",
      "follower_top5_sessions",
      "forecast_consensus_snapshots",
      "forecast_pair_snapshots",
      "forecast_settlements",
      "forecast_snapshots",
      "forecast_trajectory_shadows",
      "incident_resolutions",
      "incidents",
      "round_forecasts",
      "round_results",
      "round_trajectories",
      "round_trajectory_ticks",
      "stream_state",
      "virtual_bankrolls",
      "virtual_bet_sessions",
      "virtual_bets",
    ]);
    assert.equal(database.sqlite.prepare("PRAGMA user_version").get().user_version, 15);
    assert.deepEqual(
      database.sqlite
        .prepare("PRAGMA table_info(forecast_pair_snapshots)")
        .all()
        .map((column) => column.name),
      [
        "forecast_id",
        "schema_version",
        "status",
        "history_cutoff_at",
        "captured_at",
        "history_max_result_id",
        "anchor_result_id",
        "anchor_number",
        "anchor_settled_at",
        "anchor_continuity_epoch",
        "sample_size",
        "observed_follower_count",
        "pair_top3_json",
        "model_top3_json",
        "overlap_numbers_json",
        "overlap_count",
        "same_top1",
        "exact_order",
        "created_at",
      ],
    );
    assert.deepEqual(
      database.sqlite
        .prepare("PRAGMA table_info(forecast_consensus_snapshots)")
        .all()
        .map((column) => column.name),
      [
        "forecast_id",
        "schema_version",
        "algorithm_version",
        "status",
        "top3_json",
        "inputs_used_json",
        "pair_sample_size",
        "derived_from_snapshot_at",
        "reason",
        "created_at",
      ],
    );
  } finally {
    database.close();
  }
});

test("round trajectory persistence is strict, idempotent, and append-only for corrections", () => {
  let clockMs = BASE_TIME + 50_500;
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(clockMs),
  });
  const initial = roundTrajectory("trajectory-1", {
    receivedAtMs: BASE_TIME + 50_000,
    factors: [
      { atMs: BASE_TIME + 1_000, price: 5.31 },
      { atMs: BASE_TIME + 10_000, price: 5.32 },
    ],
  });

  try {
    assert.deepEqual(database.recordRoundTrajectory(initial), {
      inserted: true,
      trajectoryId: 1,
      ticksInserted: 2,
    });
    assert.deepEqual(database.recordRoundTrajectory(initial), {
      inserted: false,
      trajectoryId: 1,
      ticksInserted: 0,
    });

    clockMs = BASE_TIME + 51_500;
    const correction = roundTrajectory("trajectory-1", {
      receivedAtMs: BASE_TIME + 51_000,
      factors: [
        {
          atMs: BASE_TIME + 10_000,
          price: 5.325,
          receivedAtMs: BASE_TIME + 51_000,
        },
      ],
    });
    assert.deepEqual(database.recordRoundTrajectory(correction), {
      inserted: false,
      trajectoryId: 1,
      ticksInserted: 1,
    });
    assert.deepEqual(
      database.sqlite
        .prepare(`
          SELECT factor_at, price, received_at
          FROM round_trajectory_ticks
          ORDER BY id
        `)
        .all()
        .map((row) => ({ ...row })),
      [
        {
          factor_at: iso(BASE_TIME + 1_000),
          price: 5.31,
          received_at: iso(BASE_TIME + 1_000),
        },
        {
          factor_at: iso(BASE_TIME + 10_000),
          price: 5.32,
          received_at: iso(BASE_TIME + 10_000),
        },
        {
          factor_at: iso(BASE_TIME + 10_000),
          price: 5.325,
          received_at: iso(BASE_TIME + 51_000),
        },
      ],
    );

    clockMs = BASE_TIME + 52_500;
    assert.throws(
      () =>
        database.recordRoundTrajectory(
          roundTrajectory("trajectory-1", {
            receivedAtMs: BASE_TIME + 52_000,
            topPrice: 6.2,
          }),
        ),
      {
        name: "RangeError",
        message: /immutable metadata mismatch/,
      },
    );
    assert.equal(
      database.sqlite.prepare("SELECT COUNT(*) AS count FROM round_trajectory_ticks").get()
        .count,
      3,
    );

    assert.throws(
      () =>
        database.recordRoundTrajectory(
          roundTrajectory("trajectory-future", {
            receivedAtMs: BASE_TIME + 53_000,
          }),
        ),
      /receivedAt cannot be in the future/,
    );
    assert.equal(
      database.sqlite.prepare("SELECT COUNT(*) AS count FROM round_trajectories").get()
        .count,
      1,
    );
  } finally {
    database.close();
  }
});

test("version 13 creates one live follower tracker at the current tail", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-v13-follower-"));
  const path = join(directory, "tracker.sqlite");
  const training = [9, 1, 9, 2, 9, 3, 9, 4, 9, 5, 9];
  let clockCalls = 0;
  const clock = () => {
    clockCalls += 1;
    return new Date(BASE_TIME + 60_000);
  };
  let database = createDatabase({ path, clock });
  try {
    database.ingestBatch(
      training.map((number, index) => event(number, `v13-follower-${index}`, index)),
    );
    database.sqlite.exec(`
      DROP TABLE follower_top5_attempts;
      DROP TABLE follower_top5_sessions;
      PRAGMA user_version = 12;
    `);
    database.close();

    database = createDatabase({ path, clock });
    const migrated = database.getFollowerTop5TrackerState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(database.sqlite.prepare("PRAGMA user_version").get().user_version, 15);
    assert.equal(migrated.status, "armed");
    assert.equal(migrated.currentSession.sourceNumber, 9);
    assert.deepEqual(migrated.currentSession.fixedNumbers, [5, 4, 3, 2, 1]);
    assert.equal(migrated.lifetime.totalSessions, 1);
    assert.equal(clockCalls, 1);

    const sessionId = migrated.currentSession.id;
    database.close();
    database = createDatabase({ path, clock });
    assert.equal(
      database.getFollowerTop5TrackerState(
        "buleto",
        "PRIMECOIN(XPM)/RUB",
      ).currentSession.id,
      sessionId,
    );
    assert.equal(clockCalls, 1, "an existing session must not consume the clock");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pre-close forecasts enforce the five-second lock boundary and fresh factors", () => {
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(BASE_TIME + 52_000),
  });
  try {
    const valid = precloseForecast("forecast-valid-t-minus-6");
    assert.deepEqual(database.recordPrecloseForecast(valid), {
      inserted: true,
      roundId: "forecast-valid-t-minus-6",
    });

    const state = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.executionEnabled, false);
    assert.deepEqual(state.captureLeadSeconds, { min: 8, max: 10 });
    assert.equal(state.minimumPersistedLeadSeconds, 5);
    assert.equal(state.latest.roundId, "forecast-valid-t-minus-6");
    assert.equal(state.latest.leadSeconds, 9);
    assert.equal(state.latest.availableLeadSeconds, 8);
    assert.equal(state.latest.factorAt, valid.factorAt);
    assert.equal(state.latest.lockedAt, valid.lockedAt);
    assert.equal(state.latest.settlement, null);
    assert.equal(state.latest.pairHistory.status, "no_anchor");
    assert.equal(state.latest.pairHistory.historyMaxResultId, null);
    assert.equal(state.latest.pairHistory.anchor, null);
    assert.equal(state.latest.pairHistory.sampleSize, 0);
    assert.deepEqual(state.latest.pairHistory.top3, []);
    assert.deepEqual(state.latest.pairHistory.comparison, {
      modelTop3: valid.rankedNumbers,
      pairTop3: [],
      overlapNumbers: [],
      overlapCount: 0,
      sameTop1: null,
      exactOrder: false,
    });
    assert.deepEqual(state.latest.consensus, {
      status: "model_fallback",
      top3: valid.rankedNumbers,
      algorithmVersion: "consensus-borda-v1",
      pairSampleSize: 0,
      derivedFromSnapshotAt: new Date(BASE_TIME + 52_000).toISOString(),
      inputsUsed: ["model"],
      reason: "pair_not_ready",
    });

    const lateLockedAt = new Date(
      Date.parse(valid.bettingClosesAt) - 7_999,
    ).toISOString();
    assert.throws(
      () =>
        database.recordPrecloseForecast(
          precloseForecast("forecast-too-late", {
            factorAt: lateLockedAt,
            lockedAt: lateLockedAt,
          }),
        ),
      /pre-bcd horizon window/,
    );

    assert.throws(
      () =>
        database.recordPrecloseForecast(
          precloseForecast("forecast-future-factor", {
            factorAt: new Date(Date.parse(valid.lockedAt) + 1).toISOString(),
          }),
        ),
      /factor must be fresh and observed before lock/,
    );
    assert.throws(
      () =>
        database.recordPrecloseForecast(
          precloseForecast("forecast-stale-factor", {
            factorAt: new Date(Date.parse(valid.lockedAt) - 5_001).toISOString(),
          }),
        ),
      /factor must be fresh and observed before lock/,
    );

    const lateDatabase = createDatabase({
      path: ":memory:",
      clock: () => new Date(Date.parse(valid.bettingClosesAt) - 4_999),
    });
    try {
      assert.throws(
        () => lateDatabase.recordPrecloseForecast(valid),
        /durably stored at least five seconds/,
      );
    } finally {
      lateDatabase.close();
    }

    assert.equal(
      database.sqlite.prepare("SELECT COUNT(*) AS count FROM forecast_snapshots").get()
        .count,
      1,
    );
    assert.equal(
      database.sqlite.prepare("SELECT COUNT(*) AS count FROM round_forecasts").get()
        .count,
      1,
    );
  } finally {
    database.close();
  }
});

test("pre-close forecast freezes an insufficient trajectory shadow instead of using partial coverage", () => {
  let clockMs = BASE_TIME + 50_500;
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(clockMs),
  });
  const attempt = precloseForecast("trajectory-partial");

  try {
    database.recordRoundTrajectory(
      roundTrajectory("trajectory-partial", {
        receivedAtMs: BASE_TIME + 50_000,
        factors: [
          { atMs: BASE_TIME + 1_000, price: 5.31 },
          { atMs: BASE_TIME + 30_000, price: 5.34 },
          { atMs: BASE_TIME + 50_000, price: 5.4 },
        ],
      }),
    );
    clockMs = BASE_TIME + 52_000;
    assert.equal(database.recordPrecloseForecast(attempt).inserted, true);

    const state = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    const latest = state.latest;
    assert.equal(
      latest.trajectoryShadow.version,
      "trajectory-shadow-adaptive-v2",
    );
    assert.equal(latest.trajectoryShadow.status, "insufficient_current");
    assert.equal(
      latest.trajectoryShadow.reason,
      "prefix_gap_exceeds_tolerance",
    );
    assert.equal(latest.trajectoryShadow.direction, null);
    assert.equal(latest.trajectoryShadow.probabilities, null);
    assert.equal(latest.trajectoryShadow.numberArea, null);
    assert.equal(latest.trajectoryShadow.displayRange, null);
    assert.equal(latest.trajectoryShadow.adaptive, null);
    assert.equal(latest.trajectoryShadow.evaluation, null);
    assert.deepEqual(latest.trajectoryShadow.integration.currentCoverage, {
      tickCount: 3,
      firstAt: iso(BASE_TIME + 1_000),
      lastAt: iso(BASE_TIME + 50_000),
      maxGapMs: 29_000,
    });
    assert.equal(
      database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM forecast_trajectory_shadows")
        .get().count,
      1,
    );
    assert.deepEqual(state.trajectoryMetrics, {
      modelVersion: "trajectory-shadow-adaptive-v2",
      displayRangeVersion: "trajectory-display-range-v1",
      readyCount: 0,
      settledCount: 0,
      pendingCount: 0,
      evaluatedCount: 0,
      ungradableCount: 0,
      displayRangeHits: 0,
      q50ExactHits: 0,
      fullCorridorHits: 0,
      displayRangeRate: null,
      q50ExactRate: null,
      fullCorridorRate: null,
      coverageRate: null,
    });
  } finally {
    database.close();
  }
});

test("trajectory shadow freezes a correction-aware past-only READY prediction and evaluates it", () => {
  const currentStartMs = BASE_TIME + 4_000_000;
  const currentLockedMs = currentStartMs + 51_000;
  const currentEndMs = currentStartMs + 100_000;
  let clockMs = BASE_TIME;
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(clockMs),
  });
  const numberAreaCells = Array.from({ length: 38 }, (_, wireCell) => ({
    c: wireCell,
    vt: 5.6 - wireCell / 100,
    vf: 5.59 - wireCell / 100,
  }));
  const completePrefix = (startsAtMs) => [
    ...[1, 5, 10, 15, 20, 25, 30, 35, 40, 45].map((seconds) => ({
      atMs: startsAtMs + seconds * 1_000,
      price: 5.3 + seconds * 0.0006,
    })),
    { atMs: startsAtMs + 50_000, price: 5.33 },
    {
      atMs: startsAtMs + 50_000,
      price: 5.34,
      receivedAtMs: startsAtMs + 51_000,
    },
  ];

  try {
    const historicalResults = [];
    for (let index = 0; index < 30; index += 1) {
      const roundId = `trajectory-history-${index}`;
      const startsAtMs = currentStartMs - (30 - index) * 120_000;
      const cutoffMs = startsAtMs + 51_000;
      const endsAtMs = startsAtMs + 100_000;
      clockMs = cutoffMs + 100;
      database.recordRoundTrajectory(
        roundTrajectory(roundId, {
          startsAtMs,
          receivedAtMs: cutoffMs,
          factors: completePrefix(startsAtMs),
        }),
      );
      clockMs = cutoffMs + 1_100;
      database.recordRoundTrajectory(
        roundTrajectory(roundId, {
          startsAtMs,
          receivedAtMs: cutoffMs + 1_000,
          factors: [
            {
              atMs: startsAtMs + 50_000,
              price: 5.9,
              receivedAtMs: cutoffMs + 1_000,
            },
          ],
        }),
      );
      historicalResults.push(
        event(7, `trajectory-history-${index}`, 0, {
          externalRoundId: roundId,
          settledAt: iso(endsAtMs),
          observedAt: iso(endsAtMs),
          price: index >= 26 ? 5.22 : 5.36,
        }),
      );
    }
    database.ingestBatch(historicalResults);
    markResultsCreatedAtObservation(database, "trajectory-history-");
    const historyMaxResultId = Number(
      database.sqlite
        .prepare(`
          SELECT MAX(id) AS id
          FROM round_results
          WHERE fingerprint LIKE 'trajectory-history-%'
        `)
        .get().id,
    );

    const poisonRoundId = "trajectory-same-cutoff-poison";
    const poisonStartMs = currentStartMs - 60_000;
    clockMs = poisonStartMs + 51_100;
    database.recordRoundTrajectory(
      roundTrajectory(poisonRoundId, {
        startsAtMs: poisonStartMs,
        receivedAtMs: poisonStartMs + 51_000,
        factors: completePrefix(poisonStartMs),
      }),
    );
    clockMs = poisonStartMs + 52_000;
    assert.equal(
      database.recordPrecloseForecast(
        precloseForecast(poisonRoundId, {
          bettingClosesAt: iso(poisonStartMs + 60_000),
          roundEndsAt: iso(poisonStartMs + 100_000),
          factorAt: iso(poisonStartMs + 51_000),
          lockedAt: iso(poisonStartMs + 51_000),
          currentPrice: 5.34,
          startPrice: 5.35,
        }),
      ).inserted,
      true,
    );
    database.ingestBatch([
      event(19, "trajectory-same-cutoff-poison", 0, {
        externalRoundId: poisonRoundId,
        settledAt: iso(poisonStartMs + 100_000),
        observedAt: iso(currentLockedMs),
        price: 5.0,
      }),
    ]);
    database.sqlite
      .prepare(`
        UPDATE round_results
        SET created_at = observed_at
        WHERE fingerprint = 'trajectory-same-cutoff-poison'
      `)
      .run();
    assert.deepEqual(
      database.settlePrecloseForecasts("buleto", "PRIMECOIN(XPM)/RUB"),
      { settled: 1 },
    );
    markForecastSettlementsCreatedAtSettlement(database);
    const poisonResultId = Number(
      database.sqlite
        .prepare(`
          SELECT id
          FROM round_results
          WHERE fingerprint = 'trajectory-same-cutoff-poison'
        `)
        .get().id,
    );
    assert.ok(poisonResultId > historyMaxResultId);

    const currentRoundId = "trajectory-current-ready";
    clockMs = currentLockedMs + 100;
    database.recordRoundTrajectory(
      roundTrajectory(currentRoundId, {
        startsAtMs: currentStartMs,
        receivedAtMs: currentLockedMs,
        cells: numberAreaCells,
        factors: completePrefix(currentStartMs),
      }),
    );
    clockMs = currentLockedMs + 1_100;
    database.recordRoundTrajectory(
      roundTrajectory(currentRoundId, {
        startsAtMs: currentStartMs,
        receivedAtMs: currentLockedMs + 1_000,
        cells: numberAreaCells,
        factors: [
          {
            atMs: currentStartMs + 50_000,
            price: 5.9,
            receivedAtMs: currentLockedMs + 1_000,
          },
        ],
      }),
    );

    const attempt = precloseForecast(currentRoundId, {
      bettingClosesAt: iso(currentStartMs + 60_000),
      roundEndsAt: iso(currentEndMs),
      factorAt: iso(currentLockedMs),
      lockedAt: iso(currentLockedMs),
      currentPrice: 5.34,
      startPrice: 5.35,
      cells: numberAreaCells,
    });
    clockMs = currentLockedMs + 2_000;
    assert.deepEqual(database.recordPrecloseForecast(attempt), {
      inserted: true,
      roundId: currentRoundId,
    });
    const currentForecastId = Number(
      database.sqlite
        .prepare(`
          SELECT forecasts.id
          FROM round_forecasts AS forecasts
          JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
          WHERE snapshots.external_round_id = ?
        `)
        .get(currentRoundId).id,
    );

    let latest = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    ).latest;
    const shadow = latest.trajectoryShadow;
    assert.equal(shadow.version, "trajectory-shadow-adaptive-v2");
    assert.equal(shadow.status, "ready");
    assert.equal(shadow.reason, null);
    assert.equal(shadow.direction, "up");
    assert.ok(shadow.probabilities.up > shadow.probabilities.down);
    assert.equal(shadow.probabilities.flat, 0);
    assert.ok(
      Math.abs(
        shadow.probabilities.up +
          shadow.probabilities.down +
          shadow.probabilities.flat -
          1,
      ) < 1e-12,
    );
    assert.equal(shadow.sample.historyCount, 30);
    assert.equal(shadow.sample.eligibleCount, 30);
    assert.equal(shadow.sample.neighborCount, 10);
    assert.equal(shadow.sample.requiredHistory, 30);
    assert.equal(shadow.sample.requiredNeighbors, 10);
    assert.equal(shadow.nearestIds.length, 20);
    assert.equal(shadow.adaptive.trainingCount, 0);
    assert.equal(shadow.adaptive.eligibleLearningRowCount, 0);
    assert.equal(shadow.adaptive.experts.length, 3);
    assert.deepEqual(shadow.adaptive.currentWeights, {
      "local-12x10-r3": 1 / 3,
      "balanced-16x15-r4": 1 / 3,
      "broad-20x20-r5": 1 / 3,
    });
    assert.equal(shadow.adaptive.learningCutoffAt, iso(currentLockedMs));
    assert.equal(shadow.integration.candidateLimit, 500);
    assert.equal(shadow.integration.queriedCandidateCount, 30);
    assert.equal(shadow.integration.usableHistoryCount, 30);
    assert.equal(shadow.integration.excludedCoverageCount, 0);
    assert.equal(shadow.integration.historyMaxResultId, historyMaxResultId);
    assert.equal(shadow.integration.historyCutoffAt, iso(currentLockedMs));
    assert.equal(shadow.integration.learningLimit, 500);
    assert.equal(shadow.integration.queriedLearningRowCount, 0);
    assert.equal(shadow.integration.usableLearningRowCount, 0);
    assert.equal(shadow.integration.excludedLearningRowCount, 0);
    assert.deepEqual(shadow.integration.currentCoverage, {
      tickCount: 11,
      firstAt: iso(currentStartMs + 1_000),
      lastAt: iso(currentStartMs + 50_000),
      maxGapMs: 5_000,
    });
    assert.equal(shadow.currentPrefix.at(-1).price, 5.34);
    assert.equal(shadow.lockPrice, 5.34);
    assert.ok(Math.abs(shadow.medianCellWidth - 0.01) < 1e-12);
    assert.ok(shadow.expectedDeltaCellWidths < 0);
    assert.equal(shadow.numberArea.version, "trajectory-number-area-v1");
    assert.equal(
      shadow.numberArea.basis,
      "weighted-neighbor-delta-q20-q50-q80",
    );
    assert.deepEqual(shadow.numberArea.current, { wireCell: 25, number: 25 });
    assert.deepEqual(
      {
        wireCell: shadow.numberArea.typical.wireCell,
        number: shadow.numberArea.typical.number,
      },
      { wireCell: 23, number: 23 },
    );
    assert.ok(Math.abs(shadow.numberArea.typical.price - 5.36) < 1e-12);
    assert.equal(shadow.numberArea.typical.direction, "up");
    assert.equal(shadow.numberArea.typical.agreesWithDirection, true);
    assert.deepEqual(shadow.numberArea.corridor.top, {
      wireCell: 23,
      number: 23,
    });
    assert.deepEqual(shadow.numberArea.corridor.bottom, {
      wireCell: 37,
      number: 0,
    });
    assert.deepEqual(
      shadow.numberArea.corridor.cells.slice(-4),
      [
        { wireCell: 34, number: 34 },
        { wireCell: 35, number: 35 },
        { wireCell: 36, number: 36 },
        { wireCell: 37, number: 0 },
      ],
      "the lower zero must remain a positional cell after 36",
    );
    assert.equal(shadow.numberArea.corridor.clippedTop, false);
    assert.equal(shadow.numberArea.corridor.clippedBottom, false);
    assert.deepEqual(shadow.integration.numberArea, shadow.numberArea);
    assert.deepEqual(shadow.displayRange, {
      version: "trajectory-display-range-v1",
      policy: "q50-centered-contiguous-max6-v1",
      maxCells: 6,
      top: { wireCell: 23, number: 23 },
      bottom: { wireCell: 28, number: 28 },
      cells: [23, 24, 25, 26, 27, 28].map((wireCell) => ({
        wireCell,
        number: wireCell,
      })),
    });
    assert.deepEqual(shadow.integration.displayRange, shadow.displayRange);
    assert.deepEqual(shadow.integration.adaptive, shadow.adaptive);
    assert.equal(shadow.evaluation, null);

    const frozenShadow = {
      ...database.sqlite
        .prepare("SELECT * FROM forecast_trajectory_shadows WHERE forecast_id = ?")
        .get(currentForecastId),
    };
    database.ingestBatch([
      event(23, "trajectory-current-result", 0, {
        externalRoundId: currentRoundId,
        settledAt: iso(currentEndMs),
        observedAt: iso(currentEndMs),
        price: 5.36,
      }),
    ]);
    assert.deepEqual(
      database.settlePrecloseForecasts("buleto", "PRIMECOIN(XPM)/RUB"),
      { settled: 1 },
    );
    assert.deepEqual(
      {
        ...database.sqlite
          .prepare("SELECT * FROM forecast_trajectory_shadows WHERE forecast_id = ?")
          .get(currentForecastId),
      },
      frozenShadow,
      "settlement must not mutate the frozen shadow",
    );
    markForecastSettlementsCreatedAtSettlement(database);

    latest = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    ).latest;
    assert.equal(latest.trajectoryShadow.evaluation.actualPrice, 5.36);
    assert.equal(latest.trajectoryShadow.evaluation.rawCell, 23);
    assert.equal(latest.trajectoryShadow.evaluation.actualDirection, "up");
    assert.equal(latest.trajectoryShadow.evaluation.directionHit, true);
    assert.equal(latest.trajectoryShadow.evaluation.displayRangeHit, true);
    assert.equal(latest.trajectoryShadow.evaluation.q50ExactHit, true);
    assert.equal(latest.trajectoryShadow.evaluation.fullCorridorHit, true);
    assert.ok(
      Math.abs(latest.trajectoryShadow.evaluation.deltaCellWidths - 2) < 1e-9,
    );

    const currentResultId = latest.trajectoryShadow.evaluation.resultId;
    const setCurrentZero = database.sqlite.prepare(`
      UPDATE round_results
      SET result_number = 0, raw_cell = ?
      WHERE id = ?
    `);
    database.sqlite
      .prepare("UPDATE forecast_settlements SET actual_number = 0 WHERE forecast_id = ?")
      .run(currentForecastId);
    setCurrentZero.run(37, currentResultId);
    latest = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    ).latest;
    assert.equal(latest.trajectoryShadow.evaluation.actualNumber, 0);
    assert.equal(latest.trajectoryShadow.evaluation.rawCell, 37);
    assert.equal(latest.trajectoryShadow.evaluation.displayRangeHit, false);
    assert.equal(latest.trajectoryShadow.evaluation.q50ExactHit, false);
    assert.equal(latest.trajectoryShadow.evaluation.fullCorridorHit, true);

    setCurrentZero.run(0, currentResultId);
    latest = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    ).latest;
    assert.equal(latest.trajectoryShadow.evaluation.rawCell, 0);
    assert.equal(latest.trajectoryShadow.evaluation.fullCorridorHit, false);

    database.sqlite
      .prepare("UPDATE round_results SET raw_cell = NULL WHERE id = ?")
      .run(currentResultId);
    latest = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(latest.latest.trajectoryShadow.evaluation.rawCell, null);
    assert.equal(latest.latest.trajectoryShadow.evaluation.displayRangeHit, null);
    assert.equal(latest.trajectoryMetrics.ungradableCount, 1);

    setCurrentZero.run(37, currentResultId);
    database.sqlite
      .prepare("UPDATE forecast_settlements SET actual_number = 23 WHERE forecast_id = ?")
      .run(currentForecastId);
    latest = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(latest.latest.trajectoryShadow.evaluation.rawCell, null);
    assert.equal(latest.latest.trajectoryShadow.evaluation.displayRangeHit, null);
    assert.equal(latest.latest.trajectoryShadow.evaluation.q50ExactHit, null);
    assert.equal(latest.latest.trajectoryShadow.evaluation.fullCorridorHit, null);
    assert.equal(latest.trajectoryMetrics.evaluatedCount, 0);
    assert.equal(latest.trajectoryMetrics.ungradableCount, 1);

    database.sqlite
      .prepare("UPDATE round_results SET result_number = 23, raw_cell = 23 WHERE id = ?")
      .run(currentResultId);
    const restoredCurrentState = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.deepEqual(restoredCurrentState.trajectoryMetrics, {
      modelVersion: "trajectory-shadow-adaptive-v2",
      displayRangeVersion: "trajectory-display-range-v1",
      readyCount: 1,
      settledCount: 1,
      pendingCount: 0,
      evaluatedCount: 1,
      ungradableCount: 0,
      displayRangeHits: 1,
      q50ExactHits: 1,
      fullCorridorHits: 1,
      displayRangeRate: 1,
      q50ExactRate: 1,
      fullCorridorRate: 1,
      coverageRate: 1,
    });
    markResultsCreatedAtObservation(database, "trajectory-current-result");

    const legacyIntegration = JSON.parse(
      database.sqlite
        .prepare(
          "SELECT integration_json FROM forecast_trajectory_shadows WHERE forecast_id = ?",
        )
        .get(currentForecastId).integration_json,
    );
    delete legacyIntegration.adaptive;
    delete legacyIntegration.displayRange;
    database.sqlite
      .prepare(`
        UPDATE forecast_trajectory_shadows
        SET model_version = 'trajectory-shadow-knn-v1', integration_json = ?
        WHERE forecast_id = ?
      `)
      .run(JSON.stringify(legacyIntegration), currentForecastId);
    latest = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    ).latest;
    assert.equal(latest.trajectoryShadow.version, "trajectory-shadow-knn-v1");
    assert.equal(latest.trajectoryShadow.status, "ready");
    assert.notEqual(latest.trajectoryShadow.numberArea, null);
    assert.equal(latest.trajectoryShadow.displayRange, null);
    assert.equal(latest.trajectoryShadow.adaptive, null);

    delete legacyIntegration.numberArea;
    database.sqlite
      .prepare(
        "UPDATE forecast_trajectory_shadows SET integration_json = ? WHERE forecast_id = ?",
      )
      .run(JSON.stringify(legacyIntegration), currentForecastId);
    latest = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    ).latest;
    assert.equal(latest.trajectoryShadow.version, "trajectory-shadow-knn-v1");
    assert.equal(latest.trajectoryShadow.numberArea, null);
    assert.equal(latest.trajectoryShadow.integration.numberArea, null);

    database.sqlite
      .prepare(`
        UPDATE forecast_trajectory_shadows
        SET model_version = ?, integration_json = ?
        WHERE forecast_id = ?
      `)
      .run(
        frozenShadow.model_version,
        frozenShadow.integration_json,
        currentForecastId,
      );
    const tamperedIntegration = JSON.parse(frozenShadow.integration_json);
    tamperedIntegration.adaptive.currentWeights["local-12x10-r3"] = 1;
    database.sqlite
      .prepare(
        "UPDATE forecast_trajectory_shadows SET integration_json = ? WHERE forecast_id = ?",
      )
      .run(JSON.stringify(tamperedIntegration), currentForecastId);
    const tamperedState = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(
      tamperedState.latest.trajectoryShadow,
      null,
      "tampered adaptive weights must fail closed",
    );
    assert.equal(
      tamperedState.trajectoryMetrics.readyCount,
      0,
      "tampered adaptive snapshots must be excluded from aggregate metrics",
    );
    database.sqlite
      .prepare(
        "UPDATE forecast_trajectory_shadows SET integration_json = ? WHERE forecast_id = ?",
      )
      .run(frozenShadow.integration_json, currentForecastId);
    const tamperedRangeIntegration = JSON.parse(frozenShadow.integration_json);
    tamperedRangeIntegration.displayRange.bottom = {
      ...tamperedRangeIntegration.displayRange.cells.at(-2),
    };
    database.sqlite
      .prepare(
        "UPDATE forecast_trajectory_shadows SET integration_json = ? WHERE forecast_id = ?",
      )
      .run(JSON.stringify(tamperedRangeIntegration), currentForecastId);
    const tamperedRangeState = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(tamperedRangeState.latest.trajectoryShadow, null);
    assert.equal(tamperedRangeState.trajectoryMetrics.readyCount, 0);
    database.sqlite
      .prepare(
        "UPDATE forecast_trajectory_shadows SET integration_json = ? WHERE forecast_id = ?",
      )
      .run(frozenShadow.integration_json, currentForecastId);

    const assertCurrentSnapshotRejected = (message) => {
      const state = database.getPrecloseForecastState(
        "buleto",
        "PRIMECOIN(XPM)/RUB",
      );
      assert.equal(state.latest.trajectoryShadow, null, message);
      assert.equal(
        state.trajectoryMetrics.readyCount,
        0,
        `${message}: aggregate metrics must use the same validator`,
      );
    };

    const forgedEnsembleIntegration = JSON.parse(frozenShadow.integration_json);
    forgedEnsembleIntegration.adaptive.ensembleWeights = {
      "local-12x10-r3": 0.5,
      "balanced-16x15-r4": 0.3,
      "broad-20x20-r5": 0.2,
    };
    for (const expert of forgedEnsembleIntegration.adaptive.experts) {
      expert.ensembleWeight =
        forgedEnsembleIntegration.adaptive.ensembleWeights[expert.id];
    }
    database.sqlite
      .prepare(
        "UPDATE forecast_trajectory_shadows SET integration_json = ? WHERE forecast_id = ?",
      )
      .run(JSON.stringify(forgedEnsembleIntegration), currentForecastId);
    assertCurrentSnapshotRejected(
      "ensemble weights must be the ready experts' renormalized learned weights",
    );
    database.sqlite
      .prepare(
        "UPDATE forecast_trajectory_shadows SET integration_json = ? WHERE forecast_id = ?",
      )
      .run(frozenShadow.integration_json, currentForecastId);

    const partialReadyIntegration = JSON.parse(frozenShadow.integration_json);
    const broadExpert = partialReadyIntegration.adaptive.experts[2];
    broadExpert.status = "insufficient_neighbors";
    broadExpert.direction = null;
    broadExpert.probabilities = null;
    broadExpert.expectedDeltaCellWidths = null;
    broadExpert.deltaRangeCellWidths = null;
    broadExpert.nearestIds = [];
    broadExpert.sample = {
      historyCount: 30,
      eligibleCount: 30,
      excludedNotPastCount: 0,
      withinDistanceCount: 0,
      neighborCount: 0,
      requiredHistory: 30,
      requiredNeighbors: 10,
    };
    partialReadyIntegration.adaptive.ensembleWeights = {
      "local-12x10-r3": 0.6,
      "balanced-16x15-r4": 0.4,
      "broad-20x20-r5": 0,
    };
    for (const expert of partialReadyIntegration.adaptive.experts) {
      expert.ensembleWeight =
        partialReadyIntegration.adaptive.ensembleWeights[expert.id];
    }
    database.sqlite
      .prepare(
        "UPDATE forecast_trajectory_shadows SET integration_json = ? WHERE forecast_id = ?",
      )
      .run(JSON.stringify(partialReadyIntegration), currentForecastId);
    assertCurrentSnapshotRejected(
      "partial-ready experts cannot carry forged ensemble weights or stale top-level output",
    );
    database.sqlite
      .prepare(
        "UPDATE forecast_trajectory_shadows SET integration_json = ? WHERE forecast_id = ?",
      )
      .run(frozenShadow.integration_json, currentForecastId);

    const tamperedProbabilities = JSON.parse(frozenShadow.probabilities_json);
    const probabilityShift = Math.min(0.01, tamperedProbabilities.up / 2);
    tamperedProbabilities.up -= probabilityShift;
    tamperedProbabilities.down += probabilityShift;
    database.sqlite
      .prepare(
        "UPDATE forecast_trajectory_shadows SET probabilities_json = ? WHERE forecast_id = ?",
      )
      .run(JSON.stringify(tamperedProbabilities), currentForecastId);
    assertCurrentSnapshotRejected(
      "top-level probabilities must equal the frozen weighted expert output",
    );
    database.sqlite
      .prepare(
        "UPDATE forecast_trajectory_shadows SET probabilities_json = ? WHERE forecast_id = ?",
      )
      .run(frozenShadow.probabilities_json, currentForecastId);

    const tamperedQ50Integration = JSON.parse(frozenShadow.integration_json);
    const tamperedCorridor = tamperedQ50Integration.numberArea.corridor;
    const originalMedian = tamperedCorridor.medianDeltaCellWidths;
    const medianShift = originalMedian < tamperedCorridor.upperDeltaCellWidths
      ? Math.min(0.001, (tamperedCorridor.upperDeltaCellWidths - originalMedian) / 2)
      : -Math.min(0.001, (originalMedian - tamperedCorridor.lowerDeltaCellWidths) / 2);
    assert.notEqual(medianShift, 0);
    const tamperedMedian = originalMedian + medianShift;
    tamperedCorridor.medianDeltaCellWidths = tamperedMedian;
    tamperedQ50Integration.numberArea.typical.deltaCellWidths = tamperedMedian;
    tamperedQ50Integration.numberArea.typical.price =
      frozenShadow.lock_price + tamperedMedian * frozenShadow.median_cell_width;
    tamperedQ50Integration.numberArea.typical.direction =
      tamperedMedian > 0.5 ? "up" : tamperedMedian < -0.5 ? "down" : "flat";
    tamperedQ50Integration.numberArea.typical.agreesWithDirection =
      tamperedQ50Integration.numberArea.typical.direction ===
      frozenShadow.direction;
    database.sqlite
      .prepare(
        "UPDATE forecast_trajectory_shadows SET integration_json = ? WHERE forecast_id = ?",
      )
      .run(JSON.stringify(tamperedQ50Integration), currentForecastId);
    assertCurrentSnapshotRejected(
      "the frozen q50 must equal the weighted expert median",
    );
    database.sqlite
      .prepare(
        "UPDATE forecast_trajectory_shadows SET integration_json = ? WHERE forecast_id = ?",
      )
      .run(frozenShadow.integration_json, currentForecastId);

    const shiftedAreaIntegration = JSON.parse(frozenShadow.integration_json);
    const shiftPoint = (point) => ({
      wireCell: point.wireCell - 1,
      number: point.wireCell - 1 === 37 ? 0 : point.wireCell - 1,
    });
    shiftedAreaIntegration.numberArea.current = shiftPoint(
      shiftedAreaIntegration.numberArea.current,
    );
    shiftedAreaIntegration.numberArea.typical = {
      ...shiftedAreaIntegration.numberArea.typical,
      ...shiftPoint(shiftedAreaIntegration.numberArea.typical),
    };
    shiftedAreaIntegration.numberArea.corridor.top = shiftPoint(
      shiftedAreaIntegration.numberArea.corridor.top,
    );
    shiftedAreaIntegration.numberArea.corridor.bottom = shiftPoint(
      shiftedAreaIntegration.numberArea.corridor.bottom,
    );
    shiftedAreaIntegration.numberArea.corridor.cells =
      shiftedAreaIntegration.numberArea.corridor.cells.map(shiftPoint);
    shiftedAreaIntegration.displayRange.top = shiftPoint(
      shiftedAreaIntegration.displayRange.top,
    );
    shiftedAreaIntegration.displayRange.bottom = shiftPoint(
      shiftedAreaIntegration.displayRange.bottom,
    );
    shiftedAreaIntegration.displayRange.cells =
      shiftedAreaIntegration.displayRange.cells.map(shiftPoint);
    database.sqlite
      .prepare(
        "UPDATE forecast_trajectory_shadows SET integration_json = ? WHERE forecast_id = ?",
      )
      .run(JSON.stringify(shiftedAreaIntegration), currentForecastId);
    assertCurrentSnapshotRejected(
      "a coherent but shifted number area must remain anchored to frozen bands",
    );
    database.sqlite
      .prepare(
        "UPDATE forecast_trajectory_shadows SET integration_json = ? WHERE forecast_id = ?",
      )
      .run(frozenShadow.integration_json, currentForecastId);

    const invalidLearningForecastId = cloneSettledAdaptiveForecast(database, {
      templateForecastId: currentForecastId,
      externalRoundId: "adaptive-cross-field-poison",
      settledAt: iso(currentEndMs + 1_000),
    });
    database.sqlite
      .prepare(`
        UPDATE forecast_snapshots
        SET current_price = current_price + 0.01
        WHERE id = (
          SELECT snapshot_id FROM round_forecasts WHERE id = ?
        )
      `)
      .run(invalidLearningForecastId);
    const invalidLearningState = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(invalidLearningState.latest.id, invalidLearningForecastId);
    assert.equal(invalidLearningState.latest.trajectoryShadow, null);
    assert.equal(invalidLearningState.trajectoryMetrics.readyCount, 1);

    const nextStartMs = currentStartMs + 120_000;
    const nextLockedMs = nextStartMs + 51_000;
    const nextEndMs = nextStartMs + 100_000;
    const nextRoundId = "trajectory-adaptive-next";
    clockMs = nextLockedMs + 100;
    database.recordRoundTrajectory(
      roundTrajectory(nextRoundId, {
        startsAtMs: nextStartMs,
        receivedAtMs: nextLockedMs,
        cells: numberAreaCells,
        factors: completePrefix(nextStartMs),
      }),
    );
    clockMs = nextLockedMs + 2_000;
    assert.equal(
      database.recordPrecloseForecast(
        precloseForecast(nextRoundId, {
          bettingClosesAt: iso(nextStartMs + 60_000),
          roundEndsAt: iso(nextEndMs),
          factorAt: iso(nextLockedMs),
          lockedAt: iso(nextLockedMs),
          currentPrice: 5.34,
          startPrice: 5.35,
          cells: numberAreaCells,
        }),
      ).inserted,
      true,
    );
    let nextState = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    const nextShadow = nextState.latest.trajectoryShadow;
    assert.equal(nextShadow.version, "trajectory-shadow-adaptive-v2");
    assert.equal(nextShadow.status, "ready");
    assert.equal(nextShadow.integration.queriedLearningRowCount, 1);
    assert.equal(nextShadow.integration.usableLearningRowCount, 1);
    assert.equal(nextShadow.adaptive.trainingCount, 1);
    assert.equal(nextShadow.adaptive.eligibleLearningRowCount, 1);
    assert.equal(nextShadow.adaptive.lastTrainingCompletedAt, iso(currentEndMs));
    assert.deepEqual(
      nextShadow.adaptive.experts.map((expert) => expert.id),
      ["local-12x10-r3", "balanced-16x15-r4", "broad-20x20-r5"],
    );
    assert.equal(nextState.trajectoryMetrics.readyCount, 2);
    assert.equal(nextState.trajectoryMetrics.settledCount, 1);
    assert.equal(nextState.trajectoryMetrics.pendingCount, 1);

    const nextForecastId = nextState.latest.id;
    const fullCorridorCells = new Set(
      nextShadow.numberArea.corridor.cells.map((cell) => cell.wireCell),
    );
    const outsideWireCell = Array.from({ length: 38 }, (_, index) => index).find(
      (wireCell) => !fullCorridorCells.has(wireCell),
    );
    assert.notEqual(outsideWireCell, undefined);
    database.ingestBatch([
      event(
        outsideWireCell === 37 ? 0 : outsideWireCell,
        "trajectory-adaptive-next-result",
        0,
        {
          externalRoundId: nextRoundId,
          settledAt: iso(nextEndMs),
          observedAt: iso(nextEndMs),
          price: 5.36,
          rawPayload: { c: outsideWireCell },
        },
      ),
    ]);
    markResultsCreatedAtObservation(database, "trajectory-adaptive-next-result");
    assert.deepEqual(
      database.settlePrecloseForecasts("buleto", "PRIMECOIN(XPM)/RUB"),
      { settled: 1 },
    );
    markForecastSettlementsCreatedAtSettlement(database);
    nextState = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.deepEqual(nextState.trajectoryMetrics, {
      modelVersion: "trajectory-shadow-adaptive-v2",
      displayRangeVersion: "trajectory-display-range-v1",
      readyCount: 2,
      settledCount: 2,
      pendingCount: 0,
      evaluatedCount: 2,
      ungradableCount: 0,
      displayRangeHits: 1,
      q50ExactHits: 1,
      fullCorridorHits: 1,
      displayRangeRate: 0.5,
      q50ExactRate: 0.5,
      fullCorridorRate: 0.5,
      coverageRate: 1,
    });

    const finalStartMs = nextStartMs + 120_000;
    const finalLockedMs = finalStartMs + 51_000;
    const finalEndMs = finalStartMs + 100_000;
    database.sqlite.exec("BEGIN IMMEDIATE");
    try {
      cloneSettledAdaptiveForecast(database, {
        templateForecastId: nextForecastId,
        externalRoundId: "adaptive-cap-late-available",
        settledAt: iso(nextEndMs),
        observedAt: iso(finalLockedMs - 1_000),
        createdAt: iso(finalLockedMs - 1_000),
      });
      for (let index = 0; index < 501; index += 1) {
        cloneSettledAdaptiveForecast(database, {
          templateForecastId: nextForecastId,
          externalRoundId: `adaptive-cap-${index}`,
          settledAt: iso(nextEndMs + 1_000),
        });
      }
      cloneSettledAdaptiveForecast(database, {
        templateForecastId: nextForecastId,
        externalRoundId: "adaptive-same-cutoff-excluded",
        settledAt: iso(nextEndMs + 1_000),
        observedAt: iso(nextEndMs + 1_000),
        createdAt: iso(nextEndMs + 1_000),
        settlementCreatedAt: iso(finalLockedMs),
      });
      database.sqlite.exec("COMMIT");
    } catch (error) {
      database.sqlite.exec("ROLLBACK");
      throw error;
    }

    const finalRoundId = "trajectory-adaptive-cap-current";
    clockMs = finalLockedMs + 100;
    database.recordRoundTrajectory(
      roundTrajectory(finalRoundId, {
        startsAtMs: finalStartMs,
        receivedAtMs: finalLockedMs,
        cells: numberAreaCells,
        factors: completePrefix(finalStartMs),
      }),
    );
    clockMs = finalLockedMs + 2_000;
    assert.equal(
      database.recordPrecloseForecast(
        precloseForecast(finalRoundId, {
          bettingClosesAt: iso(finalStartMs + 60_000),
          roundEndsAt: iso(finalEndMs),
          factorAt: iso(finalLockedMs),
          lockedAt: iso(finalLockedMs),
          currentPrice: 5.34,
          startPrice: 5.35,
          cells: numberAreaCells,
        }),
      ).inserted,
      true,
    );
    const finalIntegration = JSON.parse(
      database.sqlite
        .prepare(`
          SELECT trajectory_shadows.integration_json
          FROM forecast_trajectory_shadows AS trajectory_shadows
          JOIN round_forecasts AS forecasts
            ON forecasts.id = trajectory_shadows.forecast_id
          JOIN forecast_snapshots AS snapshots
            ON snapshots.id = forecasts.snapshot_id
          WHERE snapshots.external_round_id = ?
        `)
        .get(finalRoundId).integration_json,
    );
    assert.equal(finalIntegration.learningLimit, 500);
    assert.equal(finalIntegration.queriedLearningRowCount, 500);
    assert.equal(finalIntegration.usableLearningRowCount, 500);
    assert.equal(finalIntegration.adaptive.trainingCount, 500);
    assert.equal(finalIntegration.adaptive.eligibleLearningRowCount, 500);
    assert.equal(
      finalIntegration.adaptive.lastTrainingCompletedAt,
      iso(finalLockedMs - 1_000),
      "the cap must keep the latest strictly pre-lock availability, not the latest settled_at",
    );
  } finally {
    database.close();
  }
});

test("start-price v2 round-trips its prediction basis and frozen OLS shadow", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-start-price-v2-"));
  const path = join(directory, "forecast.sqlite");
  const attempt = startPriceForecast("start-price-v2-round-trip");
  const expectedShadowPrice =
    attempt.currentPrice +
    attempt.features.slopePerSecond * attempt.features.secondsToEnd;
  let database = createDatabase({
    path,
    clock: () => new Date(BASE_TIME + 52_000),
  });

  try {
    assert.deepEqual(database.recordPrecloseForecast(attempt), {
      inserted: true,
      roundId: "start-price-v2-round-trip",
    });
    const storedFeatures = JSON.parse(
      database.sqlite
        .prepare("SELECT features_json FROM forecast_snapshots")
        .get().features_json,
    );
    assert.deepEqual(
      {
        samples: storedFeatures.samples,
        sampleCount: storedFeatures.sampleCount,
        windowSeconds: storedFeatures.windowSeconds,
        slopePerSecond: storedFeatures.slopePerSecond,
        secondsToEnd: storedFeatures.secondsToEnd,
        predictionBasis: storedFeatures.predictionBasis,
        shadowModelVersion: storedFeatures.shadow?.modelVersion,
        shadowProjectedPrice: storedFeatures.shadow?.projectedPrice,
      },
      {
        samples: attempt.features.samples,
        sampleCount: attempt.features.samples.length,
        windowSeconds: attempt.features.windowSeconds,
        slopePerSecond: attempt.features.slopePerSecond,
        secondsToEnd: attempt.features.secondsToEnd,
        predictionBasis: "start_price",
        shadowModelVersion: "linear-trend-12s-to-ed-v1",
        shadowProjectedPrice: expectedShadowPrice,
      },
    );

    database.close();
    database = createDatabase({
      path,
      clock: () => new Date(BASE_TIME + 52_000),
    });
    const latest = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    ).latest;
    assert.equal(latest.modelVersion, "start-price-v2");
    assert.equal(latest.projectedPrice, attempt.startPrice);
    assert.equal(latest.features.predictionBasis, "start_price");
    assert.equal(
      latest.features.shadow.modelVersion,
      "linear-trend-12s-to-ed-v1",
    );
    assert.equal(latest.features.shadow.projectedPrice, expectedShadowPrice);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("corrupt start-price v2 invariants reject without partial persistence", () => {
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(BASE_TIME + 52_000),
  });
  const wrongPrice = startPriceForecast("start-v2-wrong-price", {
    predictedPrice: 5.351,
  });
  const wrongBasis = startPriceForecast("start-v2-wrong-basis", {
    features: { predictionBasis: "ols_projection" },
  });
  const wrongShadowModel = startPriceForecast("start-v2-wrong-shadow-model", {
    features: {
      shadow: {
        modelVersion: "another-model",
        projectedPrice: 5.63,
      },
    },
  });
  const wrongShadowPrice = startPriceForecast("start-v2-wrong-shadow-price", {
    features: {
      shadow: {
        modelVersion: "linear-trend-12s-to-ed-v1",
        projectedPrice: 5.64,
      },
    },
  });
  const wrongFrozenTail = startPriceForecast("start-v2-wrong-frozen-tail", {
    features: {
      samples: [
        { dt: new Date(BASE_TIME + 47_000).toISOString(), v: 5.38 },
        { dt: new Date(BASE_TIME + 49_000).toISOString(), v: 5.39 },
        { dt: new Date(BASE_TIME + 51_000).toISOString(), v: 5.401 },
      ],
    },
  });
  const wrongRanking = startPriceForecast("start-v2-wrong-ranking", {
    predictedNumber: 7,
    rankedNumbers: [7, 11, 19],
  });
  const wrongCurrentNumber = startPriceForecast("start-v2-wrong-current-number", {
    currentNumber: 11,
  });
  const wrongWindow = startPriceForecast("start-v2-wrong-window", {
    features: { windowSeconds: 4 },
  });
  const wrongHorizon = startPriceForecast("start-v2-wrong-horizon", {
    features: { secondsToEnd: 48 },
  });
  const wrongSlope = startPriceForecast("start-v2-wrong-slope", {
    features: { slopePerSecond: 0.006 },
  });
  const unorderedSamples = startPriceForecast("start-v2-unordered-samples", {
    features: {
      samples: [
        { dt: new Date(BASE_TIME + 49_000).toISOString(), v: 5.39 },
        { dt: new Date(BASE_TIME + 47_000).toISOString(), v: 5.38 },
        { dt: new Date(BASE_TIME + 51_000).toISOString(), v: 5.4 },
      ],
    },
  });
  const duplicateSamples = startPriceForecast("start-v2-duplicate-samples", {
    features: {
      samples: [
        { dt: new Date(BASE_TIME + 47_000).toISOString(), v: 5.38 },
        { dt: new Date(BASE_TIME + 47_000).toISOString(), v: 5.39 },
        { dt: new Date(BASE_TIME + 51_000).toISOString(), v: 5.4 },
      ],
    },
  });
  const outOfWindowSample = startPriceForecast("start-v2-old-sample", {
    features: {
      samples: [
        { dt: new Date(BASE_TIME + 38_999).toISOString(), v: 5.38 },
        { dt: new Date(BASE_TIME + 49_000).toISOString(), v: 5.39 },
        { dt: new Date(BASE_TIME + 51_000).toISOString(), v: 5.4 },
      ],
    },
  });

  try {
    for (const [attempt, pattern] of [
      [wrongPrice, /must predict its frozen start price/],
      [wrongBasis, /must declare start_price basis/],
      [wrongShadowModel, /must include the frozen OLS shadow/],
      [wrongShadowPrice, /OLS shadow does not match/],
      [wrongFrozenTail, /samples must end at the frozen current price/],
      [wrongRanking, /ranking must match its frozen cells and start price/],
      [wrongCurrentNumber, /current number must match its frozen cells and current price/],
      [wrongWindow, /factor window must be 12 seconds/],
      [wrongHorizon, /secondsToEnd must match its frozen timestamps/],
      [wrongSlope, /slope must match its frozen OLS samples/],
      [unorderedSamples, /strictly increasing with distinct timestamps/],
      [duplicateSamples, /strictly increasing with distinct timestamps/],
      [outOfWindowSample, /inside the frozen factor window/],
    ]) {
      assert.throws(() => database.recordPrecloseForecast(attempt), pattern);
    }
    for (const table of [
      "forecast_snapshots",
      "round_forecasts",
      "forecast_pair_snapshots",
      "forecast_consensus_snapshots",
    ]) {
      assert.equal(
        database.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
        0,
        `${table} must remain empty after every rejected v2 forecast`,
      );
    }
  } finally {
    database.close();
  }
});

test("forecast consensus constraints and mapper reject corrupt persisted snapshots", () => {
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(BASE_TIME + 52_000),
  });
  try {
    database.recordPrecloseForecast(precloseForecast("consensus-integrity"));
    assert.throws(
      () =>
        database.sqlite
          .prepare(`
            UPDATE forecast_consensus_snapshots
            SET inputs_used_json = '[]'
          `)
          .run(),
      /CHECK constraint failed/,
    );
    assert.notEqual(
      database.getPrecloseForecastState("buleto", "PRIMECOIN(XPM)/RUB")
        .latest.consensus,
      null,
    );

    database.sqlite.exec("PRAGMA ignore_check_constraints = ON");
    try {
      database.sqlite
        .prepare(`
          UPDATE forecast_consensus_snapshots
          SET top3_json = '[7,7,19]'
        `)
        .run();
    } finally {
      database.sqlite.exec("PRAGMA ignore_check_constraints = OFF");
    }
    assert.equal(
      database.getPrecloseForecastState("buleto", "PRIMECOIN(XPM)/RUB")
        .latest.consensus,
      null,
      "invalid persisted combinations are never exposed",
    );
  } finally {
    database.close();
  }
});

test("pre-close forecast rolls back when the transaction finishes inside the five-second boundary", () => {
  let clockCalls = 0;
  const database = createDatabase({
    path: ":memory:",
    clock: () => {
      clockCalls += 1;
      return new Date(BASE_TIME + (clockCalls === 1 ? 52_000 : 56_000));
    },
  });
  try {
    assert.throws(
      () => database.recordPrecloseForecast(precloseForecast("commit-too-late")),
      /transaction must finish at least five seconds/,
    );
    for (const table of [
      "forecast_snapshots",
      "round_forecasts",
      "forecast_pair_snapshots",
      "forecast_consensus_snapshots",
    ]) {
      assert.equal(
        database.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
        0,
        `${table} must roll back with the late transaction`,
      );
    }
  } finally {
    database.close();
  }
});

test("trajectory shadow failure cannot roll back the primary forecast transaction", () => {
  const errors = [];
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(BASE_TIME + 52_000),
    logger: {
      error(payload, message) {
        errors.push({ payload, message });
      },
    },
  });

  try {
    database.sqlite.exec(`
      CREATE TRIGGER reject_trajectory_shadow
      BEFORE INSERT ON forecast_trajectory_shadows
      BEGIN
        SELECT RAISE(ABORT, 'shadow sabotage');
      END;
    `);

    assert.deepEqual(
      database.recordPrecloseForecast(precloseForecast("shadow-isolated")),
      { inserted: true, roundId: "shadow-isolated" },
    );
    for (const table of [
      "forecast_snapshots",
      "round_forecasts",
      "forecast_pair_snapshots",
      "forecast_consensus_snapshots",
    ]) {
      assert.equal(
        database.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
        1,
        `${table} must remain committed after the shadow failure`,
      );
    }
    assert.equal(
      database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM forecast_trajectory_shadows")
        .get().count,
      0,
    );
    assert.equal(
      database.getPrecloseForecastState("buleto", "PRIMECOIN(XPM)/RUB")
        .latest.trajectoryShadow,
      null,
    );
    assert.equal(errors.length, 1);
    assert.equal(
      errors[0].message,
      "trajectory shadow persistence failed after primary forecast commit",
    );
    assert.match(errors[0].payload.error.message, /shadow sabotage/);
  } finally {
    database.close();
  }
});

test("pre-close forecast recording is idempotent across database reopen", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-preclose-"));
  const path = join(directory, "preclose.sqlite");
  const attempt = precloseForecast("forecast-persisted");
  let database = createDatabase({
    path,
    clock: () => new Date(BASE_TIME + 52_000),
  });
  try {
    assert.equal(database.recordPrecloseForecast(attempt).inserted, true);
    const storedConsensus = {
      ...database.sqlite.prepare("SELECT * FROM forecast_consensus_snapshots").get(),
    };
    assert.equal(database.recordPrecloseForecast(attempt).inserted, false);
    assert.deepEqual(
      { ...database.sqlite.prepare("SELECT * FROM forecast_consensus_snapshots").get() },
      storedConsensus,
    );
    database.close();

    database = createDatabase({
      path,
      clock: () => new Date(BASE_TIME + 52_000),
    });
    assert.equal(database.recordPrecloseForecast(attempt).inserted, false);
    assert.equal(
      database.sqlite.prepare("SELECT COUNT(*) AS count FROM forecast_snapshots").get()
        .count,
      1,
    );
    assert.equal(
      database.sqlite.prepare("SELECT COUNT(*) AS count FROM round_forecasts").get()
        .count,
      1,
    );
    assert.equal(
      database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM forecast_consensus_snapshots")
        .get().count,
      1,
    );
    assert.deepEqual(
      { ...database.sqlite.prepare("SELECT * FROM forecast_consensus_snapshots").get() },
      storedConsensus,
    );
    assert.equal(
      database.getPrecloseForecastState("buleto", "PRIMECOIN(XPM)/RUB")
        .latest.roundId,
      "forecast-persisted",
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("forecast pair snapshot fixes deterministic anchor, ranking, ties, and overlap at lock", () => {
  let clockMs = BASE_TIME + 40_000;
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(clockMs),
  });
  const numbers = [9, 12, 9, 16, 9, 32, 9, 12, 9, 16, 9, 32, 9, 12, 9];
  const attempt = precloseForecast("7015", {
    predictedNumber: 12,
    rankedNumbers: [12, 16, 7],
  });

  try {
    database.ingestBatch(
      numbers.map((number, index) =>
        event(number, `pair-ready-${index}`, index, {
          externalRoundId: String(7000 + index),
        }),
      ),
    );
    markResultsCreatedAtObservation(database, "pair-ready-");
    const anchorRow = database.sqlite
      .prepare(`
        SELECT id, settled_at, continuity_epoch
        FROM round_results
        WHERE fingerprint = 'pair-ready-14'
      `)
      .get();

    clockMs = BASE_TIME + 52_000;
    assert.deepEqual(database.recordPrecloseForecast(attempt), {
      inserted: true,
      roundId: "7015",
    });

    const state = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    const pairHistory = state.latest.pairHistory;
    assert.equal(pairHistory.schemaVersion, 1);
    assert.equal(pairHistory.status, "ready");
    assert.equal(pairHistory.historyCutoffAt, attempt.lockedAt);
    assert.equal(pairHistory.capturedAt, new Date(clockMs).toISOString());
    assert.equal(pairHistory.historyMaxResultId, Number(anchorRow.id));
    assert.deepEqual(pairHistory.anchor, {
      resultId: Number(anchorRow.id),
      number: 9,
      settledAt: anchorRow.settled_at,
      continuityEpoch: Number(anchorRow.continuity_epoch),
    });
    assert.equal(pairHistory.sampleSize, 7);
    assert.equal(pairHistory.observedFollowerCount, 3);
    assert.deepEqual(pairHistory.top3, [
      {
        rank: 1,
        number: 12,
        occurrenceCount: 3,
        share: 3 / 7,
        firstOccurredAt: new Date(BASE_TIME + 1_000).toISOString(),
        lastOccurredAt: new Date(BASE_TIME + 13_000).toISOString(),
      },
      {
        rank: 2,
        number: 32,
        occurrenceCount: 2,
        share: 2 / 7,
        firstOccurredAt: new Date(BASE_TIME + 5_000).toISOString(),
        lastOccurredAt: new Date(BASE_TIME + 11_000).toISOString(),
      },
      {
        rank: 3,
        number: 16,
        occurrenceCount: 2,
        share: 2 / 7,
        firstOccurredAt: new Date(BASE_TIME + 3_000).toISOString(),
        lastOccurredAt: new Date(BASE_TIME + 9_000).toISOString(),
      },
    ]);
    assert.deepEqual(pairHistory.comparison, {
      modelTop3: [12, 16, 7],
      pairTop3: [12, 32, 16],
      overlapNumbers: [12, 16],
      overlapCount: 2,
      sameTop1: true,
      exactOrder: false,
    });
    assert.deepEqual(state.latest.consensus, {
      status: "combined",
      top3: [12, 16, 32],
      algorithmVersion: "consensus-borda-v1",
      pairSampleSize: 7,
      derivedFromSnapshotAt: new Date(clockMs).toISOString(),
      inputsUsed: ["model", "pair"],
      reason: "frozen_model_and_pair",
    });

    const storedBefore = {
      ...database.sqlite.prepare("SELECT * FROM forecast_pair_snapshots").get(),
    };
    const storedConsensusBefore = {
      ...database.sqlite.prepare("SELECT * FROM forecast_consensus_snapshots").get(),
    };
    assert.deepEqual(database.recordPrecloseForecast(attempt), {
      inserted: false,
      roundId: "7015",
    });
    assert.deepEqual(
      { ...database.sqlite.prepare("SELECT * FROM forecast_pair_snapshots").get() },
      storedBefore,
      "a duplicate forecast cannot replace its pair snapshot",
    );
    assert.deepEqual(
      { ...database.sqlite.prepare("SELECT * FROM forecast_consensus_snapshots").get() },
      storedConsensusBefore,
      "a duplicate forecast cannot replace its consensus snapshot",
    );

    clockMs = BASE_TIME + 200_000;
    database.ingestBatch([
      event(32, "pair-ready-later-result", 99, { externalRoundId: "7015" }),
      event(9, "pair-ready-later-anchor", 110, { externalRoundId: "7016" }),
      event(16, "pair-ready-later-follower", 120, { externalRoundId: "7017" }),
    ]);
    assert.deepEqual(
      database.settlePrecloseForecasts("buleto", "PRIMECOIN(XPM)/RUB"),
      { settled: 1 },
    );
    assert.deepEqual(
      { ...database.sqlite.prepare("SELECT * FROM forecast_pair_snapshots").get() },
      storedBefore,
      "later ingestion and settlement must not rewrite the locked snapshot",
    );
    assert.deepEqual(
      { ...database.sqlite.prepare("SELECT * FROM forecast_consensus_snapshots").get() },
      storedConsensusBefore,
      "settlement must not rewrite the consensus snapshot",
    );
    const settledState = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.deepEqual(settledState.latest.pairHistory, pairHistory);
    assert.deepEqual(settledState.latest.consensus, state.latest.consensus);
    assert.equal(settledState.latest.settlement.actualNumber, 32);
  } finally {
    database.close();
  }
});

test("start-price v2 keeps a ready pair diagnostic but freezes model-authoritative Top3", () => {
  let clockMs = BASE_TIME + 40_000;
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(clockMs),
  });
  const numbers = [9, 12, 9, 16, 9, 32, 9, 12, 9, 16, 9, 32, 9, 12, 9];
  const attempt = startPriceForecast("7015");

  try {
    database.ingestBatch(
      numbers.map((number, index) =>
        event(number, `start-v2-pair-ready-${index}`, index, {
          externalRoundId: String(7000 + index),
        }),
      ),
    );
    markResultsCreatedAtObservation(database, "start-v2-pair-ready-");
    clockMs = BASE_TIME + 52_000;
    assert.equal(database.recordPrecloseForecast(attempt).inserted, true);

    const latest = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    ).latest;
    assert.equal(latest.pairHistory.status, "ready");
    assert.equal(latest.pairHistory.sampleSize, 7);
    assert.deepEqual(
      latest.pairHistory.top3.map((item) => item.number),
      [12, 32, 16],
    );
    assert.deepEqual(latest.pairHistory.comparison, {
      modelTop3: attempt.rankedNumbers,
      pairTop3: [12, 32, 16],
      overlapNumbers: [],
      overlapCount: 0,
      sameTop1: false,
      exactOrder: false,
    });
    assert.deepEqual(latest.consensus, {
      status: "model_fallback",
      top3: attempt.rankedNumbers,
      algorithmVersion: "model-authoritative-v1",
      pairSampleSize: 7,
      derivedFromSnapshotAt: new Date(clockMs).toISOString(),
      inputsUsed: ["model"],
      reason: "authoritative_model",
    });

    const storedPair = database.sqlite
      .prepare("SELECT * FROM forecast_pair_snapshots")
      .get();
    assert.equal(storedPair.status, "ready");
    assert.equal(storedPair.pair_top3_json, JSON.stringify([
      {
        number: 12,
        occurrenceCount: 3,
        firstOccurredAt: new Date(BASE_TIME + 1_000).toISOString(),
        lastOccurredAt: new Date(BASE_TIME + 13_000).toISOString(),
      },
      {
        number: 32,
        occurrenceCount: 2,
        firstOccurredAt: new Date(BASE_TIME + 5_000).toISOString(),
        lastOccurredAt: new Date(BASE_TIME + 11_000).toISOString(),
      },
      {
        number: 16,
        occurrenceCount: 2,
        firstOccurredAt: new Date(BASE_TIME + 3_000).toISOString(),
        lastOccurredAt: new Date(BASE_TIME + 9_000).toISOString(),
      },
    ]));
    assert.deepEqual(
      {
        algorithmVersion: database.sqlite
          .prepare("SELECT algorithm_version FROM forecast_consensus_snapshots")
          .get().algorithm_version,
        status: database.sqlite
          .prepare("SELECT status FROM forecast_consensus_snapshots")
          .get().status,
        top3: JSON.parse(
          database.sqlite
            .prepare("SELECT top3_json FROM forecast_consensus_snapshots")
            .get().top3_json,
        ),
        reason: database.sqlite
          .prepare("SELECT reason FROM forecast_consensus_snapshots")
          .get().reason,
      },
      {
        algorithmVersion: "model-authoritative-v1",
        status: "model_fallback",
        top3: attempt.rankedNumbers,
        reason: "authoritative_model",
      },
    );
  } finally {
    database.close();
  }
});

test("forecast consensus remains immutable when its frozen source snapshot later diverges", () => {
  let clockMs = BASE_TIME + 40_000;
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(clockMs),
  });

  try {
    database.ingestBatch(
      [9, 12, 9, 16, 9].map((number, index) =>
        event(number, `pair-consensus-mismatch-${index}`, index, {
          externalRoundId: String(9100 + index),
        }),
      ),
    );
    markResultsCreatedAtObservation(database, "pair-consensus-mismatch-");
    clockMs = BASE_TIME + 52_000;
    database.recordPrecloseForecast(
      precloseForecast("9105", {
        predictedNumber: 12,
        rankedNumbers: [12, 16, 7],
      }),
    );
    const storedConsensus = {
      ...database.sqlite.prepare("SELECT * FROM forecast_consensus_snapshots").get(),
    };
    assert.equal(storedConsensus.algorithm_version, "consensus-borda-v1");
    assert.equal(storedConsensus.top3_json, "[12,16,7]");

    database.sqlite.exec(`
      UPDATE forecast_pair_snapshots
      SET pair_top3_json = '[{"number":32,"occurrenceCount":2,"firstOccurredAt":null,"lastOccurredAt":null}]',
          overlap_numbers_json = '[]',
          overlap_count = 0,
          same_top1 = 0,
          exact_order = 0
    `);
    const latest = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    ).latest;

    assert.equal(latest.pairHistory.status, "ready");
    assert.deepEqual(latest.pairHistory.comparison.modelTop3, [12, 16, 7]);
    assert.deepEqual(latest.pairHistory.comparison.pairTop3, [32]);
    assert.deepEqual(latest.rankedNumbers, [12, 16, 7]);
    assert.deepEqual(latest.consensus, {
      status: "combined",
      top3: [12, 16, 7],
      algorithmVersion: "consensus-borda-v1",
      pairSampleSize: 2,
      derivedFromSnapshotAt: new Date(clockMs).toISOString(),
      inputsUsed: ["model", "pair"],
      reason: "frozen_model_and_pair",
    });
    assert.deepEqual(
      { ...database.sqlite.prepare("SELECT * FROM forecast_consensus_snapshots").get() },
      storedConsensus,
      "reads never recalculate or rewrite a persisted consensus",
    );
  } finally {
    database.close();
  }
});

test("forecast pair snapshot never creates a transition across an integrity gap", () => {
  let clockMs = BASE_TIME + 40_000;
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(clockMs),
  });

  try {
    database.ingestBatch([
      event(9, "pair-gap-left", 0, { externalRoundId: "8100" }),
    ]);
    database.ingestBatchAfterGap(
      {
        source: "buleto",
        instrument: "PRIMECOIN(XPM)/RUB",
        reason: "round-result-not-confirmed-by-snapshot",
        incidentKey: "pair-gap-boundary",
        detectedAt: new Date(BASE_TIME + 5_000).toISOString(),
      },
      [
        event(12, "pair-gap-right-first", 10, { externalRoundId: "8101" }),
        event(9, "pair-gap-anchor", 20, { externalRoundId: "8102" }),
      ],
    );
    markResultsCreatedAtObservation(database, "pair-gap-");
    clockMs = BASE_TIME + 52_000;
    database.recordPrecloseForecast(precloseForecast("8103"));

    const pairHistory = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    ).latest.pairHistory;
    assert.equal(pairHistory.status, "no_samples");
    assert.equal(pairHistory.anchor.number, 9);
    assert.equal(pairHistory.anchor.continuityEpoch, 1);
    assert.equal(pairHistory.sampleSize, 0);
    assert.equal(pairHistory.observedFollowerCount, 0);
    assert.deepEqual(pairHistory.top3, []);
    assert.deepEqual(pairHistory.comparison.pairTop3, []);
    assert.equal(pairHistory.comparison.sameTop1, null);
    assert.equal(pairHistory.comparison.exactOrder, false);
    assert.deepEqual(
      database.sqlite
        .prepare("SELECT continuity_epoch FROM round_results ORDER BY settled_at, id")
        .all()
        .map((row) => Number(row.continuity_epoch)),
      [0, 1, 1],
    );
  } finally {
    database.close();
  }
});

test("forecast pair snapshot rejects a stale numeric anchor when a round id was skipped", () => {
  let clockMs = BASE_TIME + 40_000;
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(clockMs),
  });

  try {
    database.ingestBatch([
      event(9, "pair-skipped-0", 1, { externalRoundId: "8200" }),
      event(4, "pair-skipped-1", 2, { externalRoundId: "8201" }),
      event(9, "pair-skipped-anchor", 3, { externalRoundId: "8202" }),
    ]);
    markResultsCreatedAtObservation(database, "pair-skipped-");
    const historyMaxResultId = Number(
      database.sqlite.prepare("SELECT MAX(id) AS id FROM round_results").get().id,
    );
    clockMs = BASE_TIME + 52_000;
    database.recordPrecloseForecast(precloseForecast("8204"));

    const pairHistory = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    ).latest.pairHistory;
    assert.equal(pairHistory.status, "no_anchor");
    assert.equal(pairHistory.historyMaxResultId, historyMaxResultId);
    assert.equal(pairHistory.anchor, null);
    assert.equal(pairHistory.sampleSize, 0);
    assert.deepEqual(pairHistory.top3, []);
    assert.equal(pairHistory.comparison.sameTop1, null);
  } finally {
    database.close();
  }
});

test("forecast pair cutoff excludes future-observed and future-created results", () => {
  let clockMs = BASE_TIME + 40_000;
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(clockMs),
  });

  try {
    database.ingestBatch([
      event(9, "pair-cutoff-valid-0", 1, { externalRoundId: "9000" }),
      event(4, "pair-cutoff-valid-1", 2, { externalRoundId: "9001" }),
      event(9, "pair-cutoff-anchor", 3, { externalRoundId: "9002" }),
    ]);
    markResultsCreatedAtObservation(database, "pair-cutoff-valid-");
    markResultsCreatedAtObservation(database, "pair-cutoff-anchor");
    const anchorId = Number(
      database.sqlite
        .prepare("SELECT id FROM round_results WHERE fingerprint = 'pair-cutoff-anchor'")
        .get().id,
    );

    clockMs = BASE_TIME + 52_000;
    database.ingestBatch([
      event(12, "pair-cutoff-future-observed", 4, {
        externalRoundId: "9003",
        observedAt: new Date(BASE_TIME + 52_000).toISOString(),
      }),
      event(16, "pair-cutoff-future-created", 5, {
        externalRoundId: "9004",
      }),
    ]);
    database.sqlite
      .prepare(`
        UPDATE round_results
        SET created_at = ?
        WHERE fingerprint = 'pair-cutoff-future-observed'
      `)
      .run(new Date(BASE_TIME + 40_000).toISOString());

    database.recordPrecloseForecast(
      precloseForecast("9003", {
        predictedNumber: 4,
        rankedNumbers: [4, 12, 16],
      }),
    );
    const pairHistory = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    ).latest.pairHistory;
    assert.equal(pairHistory.status, "ready");
    assert.equal(pairHistory.historyMaxResultId, anchorId);
    assert.equal(pairHistory.anchor.resultId, anchorId);
    assert.equal(pairHistory.anchor.number, 9);
    assert.equal(pairHistory.sampleSize, 1);
    assert.equal(pairHistory.observedFollowerCount, 1);
    assert.deepEqual(pairHistory.top3.map((item) => item.number), [4]);
    assert.deepEqual(pairHistory.comparison, {
      modelTop3: [4, 12, 16],
      pairTop3: [4],
      overlapNumbers: [4],
      overlapCount: 1,
      sameTop1: true,
      exactOrder: false,
    });
    assert.deepEqual(
      database.getPrecloseForecastState("buleto", "PRIMECOIN(XPM)/RUB")
        .latest.consensus,
      {
        status: "combined",
        top3: [4, 12, 16],
        algorithmVersion: "consensus-borda-v1",
        pairSampleSize: 1,
        derivedFromSnapshotAt: new Date(clockMs).toISOString(),
        inputsUsed: ["model", "pair"],
        reason: "frozen_model_and_pair",
      },
    );
  } finally {
    database.close();
  }
});

test("versions 11 and 12 do not backfill derived snapshots for version 10 forecasts", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-pair-v10-"));
  const path = join(directory, "legacy-forecast.sqlite");
  const attempt = precloseForecast("legacy-forecast");
  let database = createDatabase({
    path,
    clock: () => new Date(BASE_TIME + 52_000),
  });

  try {
    assert.equal(database.recordPrecloseForecast(attempt).inserted, true);
    database.sqlite.exec(`
      DROP TABLE forecast_consensus_snapshots;
      DROP TABLE forecast_pair_snapshots;
      PRAGMA user_version = 10;
    `);
    database.close();

    database = createDatabase({
      path,
      clock: () => new Date(BASE_TIME + 52_000),
    });
    assert.equal(database.sqlite.prepare("PRAGMA user_version").get().user_version, 15);
    assert.equal(
      Number(
        database.sqlite
          .prepare("SELECT COUNT(*) AS count FROM forecast_pair_snapshots")
          .get().count,
      ),
      0,
    );
    assert.equal(
      database.getPrecloseForecastState("buleto", "PRIMECOIN(XPM)/RUB")
        .latest.pairHistory,
      null,
    );
    assert.equal(
      database.getPrecloseForecastState("buleto", "PRIMECOIN(XPM)/RUB")
        .latest.consensus,
      null,
    );
    assert.equal(
      Number(
        database.sqlite
          .prepare("SELECT COUNT(*) AS count FROM forecast_consensus_snapshots")
          .get().count,
      ),
      0,
    );
    assert.equal(database.recordPrecloseForecast(attempt).inserted, false);
    assert.equal(
      Number(
        database.sqlite
          .prepare("SELECT COUNT(*) AS count FROM forecast_pair_snapshots")
          .get().count,
      ),
      0,
      "reading or replaying a legacy forecast must not backfill mutable history",
    );
    assert.equal(
      Number(
        database.sqlite
          .prepare("SELECT COUNT(*) AS count FROM forecast_consensus_snapshots")
          .get().count,
      ),
      0,
      "reading or replaying a legacy forecast must not backfill consensus",
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("version 12 does not backfill consensus for legacy version 11 forecasts", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-consensus-v11-"));
  const path = join(directory, "legacy-consensus.sqlite");
  const attempt = precloseForecast("legacy-consensus");
  let database = createDatabase({
    path,
    clock: () => new Date(BASE_TIME + 52_000),
  });

  try {
    assert.equal(database.recordPrecloseForecast(attempt).inserted, true);
    assert.equal(
      database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM forecast_consensus_snapshots")
        .get().count,
      1,
    );
    database.sqlite.exec(`
      DROP TABLE forecast_consensus_snapshots;
      PRAGMA user_version = 11;
    `);
    database.close();

    database = createDatabase({
      path,
      clock: () => new Date(BASE_TIME + 52_000),
    });
    assert.equal(database.sqlite.prepare("PRAGMA user_version").get().user_version, 15);
    assert.equal(
      database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM forecast_consensus_snapshots")
        .get().count,
      0,
    );
    const latest = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    ).latest;
    assert.notEqual(latest.pairHistory, null);
    assert.equal(latest.consensus, null);

    assert.equal(database.recordPrecloseForecast(attempt).inserted, false);
    assert.equal(
      database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM forecast_consensus_snapshots")
        .get().count,
      0,
      "reading or replaying a legacy forecast must not create a consensus",
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("version 14 migration preserves a legacy Borda consensus row exactly", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-consensus-v13-"));
  const path = join(directory, "legacy-borda.sqlite");
  const attempt = precloseForecast("legacy-borda-v13");
  let database = createDatabase({
    path,
    clock: () => new Date(BASE_TIME + 52_000),
  });

  try {
    assert.equal(database.recordPrecloseForecast(attempt).inserted, true);
    replaceConsensusTableWithV13Schema(database);
    assert.equal(database.sqlite.prepare("PRAGMA user_version").get().user_version, 13);
    const legacySchema = database.sqlite
      .prepare(`
        SELECT sql
        FROM sqlite_master
        WHERE type = 'table' AND name = 'forecast_consensus_snapshots'
      `)
      .get().sql;
    assert.match(legacySchema, /algorithm_version = 'consensus-borda-v1'/);
    assert.doesNotMatch(legacySchema, /model-authoritative-v1/);
    const legacyRow = {
      ...database.sqlite.prepare("SELECT * FROM forecast_consensus_snapshots").get(),
    };
    assert.equal(legacyRow.algorithm_version, "consensus-borda-v1");
    const legacyBytes = JSON.stringify(legacyRow);

    database.close();
    database = createDatabase({
      path,
      clock: () => new Date(BASE_TIME + 52_000),
    });

    assert.equal(database.sqlite.prepare("PRAGMA user_version").get().user_version, 15);
    const migratedRow = {
      ...database.sqlite.prepare("SELECT * FROM forecast_consensus_snapshots").get(),
    };
    assert.equal(JSON.stringify(migratedRow), legacyBytes);
    assert.deepEqual(migratedRow, legacyRow);
    assert.deepEqual(
      database.getPrecloseForecastState("buleto", "PRIMECOIN(XPM)/RUB")
        .latest.consensus,
      {
        status: "model_fallback",
        top3: attempt.rankedNumbers,
        algorithmVersion: "consensus-borda-v1",
        pairSampleSize: 0,
        derivedFromSnapshotAt: new Date(BASE_TIME + 52_000).toISOString(),
        inputsUsed: ["model"],
        reason: "pair_not_ready",
      },
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("version 15 adds empty trajectory tables without backfilling legacy forecasts", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-trajectory-v14-"));
  const path = join(directory, "legacy-forecast.sqlite");
  let database = createDatabase({
    path,
    clock: () => new Date(BASE_TIME + 52_000),
  });

  try {
    assert.equal(
      database.recordPrecloseForecast(precloseForecast("legacy-before-v15"))
        .inserted,
      true,
    );
    database.sqlite.exec(`
      DROP TABLE forecast_trajectory_shadows;
      DROP TABLE round_trajectory_ticks;
      DROP TABLE round_trajectories;
      PRAGMA user_version = 14;
    `);
    database.close();

    database = createDatabase({
      path,
      clock: () => new Date(BASE_TIME + 52_000),
    });
    assert.equal(database.sqlite.prepare("PRAGMA user_version").get().user_version, 15);
    assert.equal(
      database.sqlite.prepare("SELECT COUNT(*) AS count FROM round_trajectories").get()
        .count,
      0,
    );
    assert.equal(
      database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM forecast_trajectory_shadows")
        .get().count,
      0,
    );
    const latest = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    ).latest;
    assert.equal(latest.roundId, "legacy-before-v15");
    assert.equal(latest.trajectoryShadow, null);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pre-close settlement requires the exact stream and round and reports hit metrics", () => {
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(BASE_TIME + 52_000),
  });
  try {
    database.recordPrecloseForecast(precloseForecast("forecast-top1"));
    database.recordPrecloseForecast(precloseForecast("forecast-top3"));
    database.recordPrecloseForecast(
      precloseForecast("forecast-current", {
        rankedNumbers: [7, 19, 22],
      }),
    );
    database.recordPrecloseForecast(
      precloseForecast("forecast-anonymous", {
        roundEndsAt: new Date(BASE_TIME + 300_000).toISOString(),
      }),
    );
    database.recordPrecloseForecast(precloseForecast("forecast-pending"));

    database.ingestBatch([
      event(7, "forecast-result-top1", 200, {
        externalRoundId: "forecast-top1",
      }),
      event(19, "forecast-result-top3", 201, {
        externalRoundId: "forecast-top3",
      }),
      event(11, "forecast-result-current", 202, {
        externalRoundId: "forecast-current",
      }),
      event(11, "forecast-result-wrong-instrument", 203, {
        instrument: "OTHER",
        externalRoundId: "forecast-pending",
      }),
      event(11, "forecast-result-wrong-source", 204, {
        source: "other-source",
        externalRoundId: "forecast-pending",
      }),
      event(7, "forecast-result-anonymous", 299),
    ]);

    assert.deepEqual(
      database.settlePrecloseForecasts("buleto", "PRIMECOIN(XPM)/RUB"),
      { settled: 4 },
    );
    assert.deepEqual(
      database.settlePrecloseForecasts("buleto", "PRIMECOIN(XPM)/RUB"),
      { settled: 0 },
      "settlement is idempotent",
    );

    assert.deepEqual(
      database.sqlite
        .prepare(`
          SELECT
            snapshots.external_round_id,
            settlements.top1_hit,
            settlements.top3_hit,
            settlements.current_cell_hit
          FROM forecast_settlements AS settlements
          JOIN round_forecasts AS forecasts ON forecasts.id = settlements.forecast_id
          JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
          ORDER BY snapshots.external_round_id
        `)
        .all()
        .map((row) => ({
          roundId: row.external_round_id,
          top1Hit: Number(row.top1_hit),
          top3Hit: Number(row.top3_hit),
          currentCellHit: Number(row.current_cell_hit),
        })),
      [
        {
          roundId: "forecast-anonymous",
          top1Hit: 1,
          top3Hit: 1,
          currentCellHit: 0,
        },
        {
          roundId: "forecast-current",
          top1Hit: 0,
          top3Hit: 0,
          currentCellHit: 1,
        },
        {
          roundId: "forecast-top1",
          top1Hit: 1,
          top3Hit: 1,
          currentCellHit: 0,
        },
        {
          roundId: "forecast-top3",
          top1Hit: 0,
          top3Hit: 1,
          currentCellHit: 0,
        },
      ],
    );

    const state = database.getPrecloseForecastState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.latest.roundId, "forecast-pending");
    assert.equal(state.latest.settlement, null);
    assert.deepEqual(state.metrics, {
      forecastCount: 5,
      settledCount: 4,
      pendingCount: 1,
      top1Hits: 2,
      top3Hits: 3,
      currentCellHits: 1,
      top1Rate: 1 / 2,
      top3Rate: 3 / 4,
      currentCellRate: 1 / 4,
    });
  } finally {
    database.close();
  }
});

test("pre-close hit history preserves ranked combinations and isolates streams", () => {
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(BASE_TIME + 52_000),
  });
  try {
    database.recordPrecloseForecast(precloseForecast("history-hit-old"));
    database.recordPrecloseForecast(precloseForecast("history-miss"));
    database.recordPrecloseForecast(
      precloseForecast("history-hit-new", {
        predictedNumber: 19,
        rankedNumbers: [19, 7, 11],
        modelVersion: "preclose-linear-v2",
      }),
    );
    database.recordPrecloseForecast(
      precloseForecast("history-other-instrument", { instrument: "OTHER" }),
    );
    database.recordPrecloseForecast(
      precloseForecast("history-other-source", { source: "other-source" }),
    );

    database.ingestBatch([
      event(11, "history-result-hit-old", 200, {
        externalRoundId: "history-hit-old",
      }),
      event(22, "history-result-miss", 201, {
        externalRoundId: "history-miss",
      }),
      event(7, "history-result-hit-new", 202, {
        externalRoundId: "history-hit-new",
      }),
      event(7, "history-result-other-instrument", 203, {
        instrument: "OTHER",
        externalRoundId: "history-other-instrument",
      }),
      event(7, "history-result-other-source", 204, {
        source: "other-source",
        externalRoundId: "history-other-source",
      }),
    ]);

    assert.deepEqual(
      database.settlePrecloseForecasts("buleto", "PRIMECOIN(XPM)/RUB"),
      { settled: 3 },
    );
    assert.deepEqual(database.settlePrecloseForecasts("buleto", "OTHER"), {
      settled: 1,
    });
    assert.deepEqual(database.settlePrecloseForecasts("other-source", "PRIMECOIN(XPM)/RUB"), {
      settled: 1,
    });

    assert.deepEqual(
      database.getPrecloseForecastHits("buleto", "PRIMECOIN(XPM)/RUB"),
      [
        {
          roundId: "history-hit-new",
          rankedNumbers: [19, 7, 11],
          actualNumber: 7,
          lockedAt: new Date(BASE_TIME + 51_000).toISOString(),
          settledAt: new Date(BASE_TIME + 202_000).toISOString(),
          modelVersion: "preclose-linear-v2",
        },
        {
          roundId: "history-hit-old",
          rankedNumbers: [7, 11, 19],
          actualNumber: 11,
          lockedAt: new Date(BASE_TIME + 51_000).toISOString(),
          settledAt: new Date(BASE_TIME + 200_000).toISOString(),
          modelVersion: "preclose-linear-v1",
        },
      ],
    );
    assert.deepEqual(
      database.getPrecloseForecastHits("buleto", "PRIMECOIN(XPM)/RUB", 1),
      [
        {
          roundId: "history-hit-new",
          rankedNumbers: [19, 7, 11],
          actualNumber: 7,
          lockedAt: new Date(BASE_TIME + 51_000).toISOString(),
          settledAt: new Date(BASE_TIME + 202_000).toISOString(),
          modelVersion: "preclose-linear-v2",
        },
      ],
    );
    assert.equal(database.getPrecloseForecastHits("buleto", "OTHER").length, 1);
    assert.equal(
      database.getPrecloseForecastHits("other-source", "PRIMECOIN(XPM)/RUB").length,
      1,
    );
    assert.throws(
      () => database.getPrecloseForecastHits("buleto", "PRIMECOIN(XPM)/RUB", 0),
      /limit must be an integer between 1 and 500/,
    );
    assert.throws(
      () => database.getPrecloseForecastHits("buleto", "PRIMECOIN(XPM)/RUB", 501),
      /limit must be an integer between 1 and 500/,
    );
  } finally {
    database.close();
  }
});

test("version 5 history is backfilled into continuity epochs before migration completes", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-v5-"));
  const path = join(directory, "legacy.sqlite");
  const legacy = new DatabaseSync(path);
  try {
    legacy.exec(`
      CREATE TABLE cycles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        instrument TEXT NOT NULL,
        status TEXT NOT NULL,
        origin TEXT NOT NULL,
        started_at TEXT NOT NULL,
        last_event_at TEXT NOT NULL,
        completed_at TEXT,
        survivor_number INTEGER,
        event_count INTEGER NOT NULL DEFAULT 0,
        eliminated_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE round_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        instrument TEXT NOT NULL,
        settled_at TEXT NOT NULL,
        result_number INTEGER NOT NULL,
        price REAL,
        observed_at TEXT NOT NULL,
        external_round_id TEXT,
        raw_cell INTEGER,
        fingerprint TEXT NOT NULL UNIQUE,
        raw_payload TEXT,
        cycle_id INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE TABLE incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        source TEXT NOT NULL,
        instrument TEXT NOT NULL,
        message TEXT,
        detected_at TEXT NOT NULL,
        details_json TEXT,
        cycle_id INTEGER,
        created_at TEXT NOT NULL
      );
      PRAGMA user_version = 5;
    `);
    const insert = legacy.prepare(`
      INSERT INTO round_results (
        source, instrument, settled_at, result_number, price, observed_at,
        external_round_id, raw_cell, fingerprint, raw_payload, cycle_id, created_at
      ) VALUES ('buleto', 'PRIMECOIN(XPM)/RUB', ?, ?, 5.4, ?, NULL, ?, ?, NULL, NULL, ?)
    `);
    [1, 2, 3, 1, 2, 3].forEach((number, index) => {
      const time = new Date(BASE_TIME + index * 1_000).toISOString();
      insert.run(time, number, time, number, `legacy-${index}`, time);
    });
    const gapTime = new Date(BASE_TIME + 2_000).toISOString();
    legacy.prepare(`
      INSERT INTO incidents (
        kind, source, instrument, message, detected_at, details_json, cycle_id, created_at
      ) VALUES ('gap', 'buleto', 'PRIMECOIN(XPM)/RUB', 'legacy gap', ?, NULL, NULL, ?)
    `).run(gapTime, gapTime);
  } finally {
    legacy.close();
  }

  const database = createDatabase({ path });
  try {
    assert.equal(database.sqlite.prepare("PRAGMA user_version").get().user_version, 15);
    assert.deepEqual(
      database.sqlite
        .prepare("SELECT continuity_epoch FROM round_results ORDER BY settled_at, id")
        .all()
        .map((row) => Number(row.continuity_epoch)),
      [0, 0, 1, 1, 1, 1],
    );
    assert.equal(
      database
        .getRepeatedTriples("buleto", "PRIMECOIN(XPM)/RUB", 20)
        .some((item) => item.numbers.join(",") === "1,2,3"),
      false,
    );
    assert.equal(
      database.sqlite.prepare("SELECT COUNT(*) AS count FROM virtual_bet_sessions").get()
        .count,
      0,
    );
    assert.equal(
      database.sqlite.prepare("SELECT COUNT(*) AS count FROM virtual_bets").get().count,
      0,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("version 9 reconciles a proven contiguous shutdown boundary without deleting its audit", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-v9-reconcile-"));
  const path = join(directory, "shutdown-gap.sqlite");
  let database = createDatabase({ path, gapThresholdSeconds: 135 });
  try {
    database.ingestBatch([
      event(20, "reconcile-left-1", 0, { externalRoundId: "4090229" }),
      event(14, "reconcile-left-2", 90, { externalRoundId: "4090230" }),
      event(14, "reconcile-left-3", 180, { externalRoundId: "4090231" }),
    ]);
    database.ingestBatchAfterGap(
      {
        source: "buleto",
        instrument: "PRIMECOIN(XPM)/RUB",
        reason: "shutdown-with-unconfirmed-round-result",
        incidentKey: "shutdown-reconcile-once",
        detectedAt: new Date(BASE_TIME + 270_100).toISOString(),
        message: "planned restart before snapshot confirmation",
      },
      [
        event(31, "reconcile-right-1", 270, { externalRoundId: "4090232" }),
        event(35, "reconcile-right-2", 360, { externalRoundId: "4090233" }),
      ],
    );
    assert.equal(database.getDashboardState().totals.results, 5);
    assert.equal(database.getDashboardState().totals.invalidCycles, 1);
    database.sqlite.exec("PRAGMA user_version = 8");
    database.close();

    database = createDatabase({ path, gapThresholdSeconds: 135 });
    const state = database.getDashboardState();
    assert.equal(database.sqlite.prepare("PRAGMA user_version").get().user_version, 15);
    assert.equal(state.totals.results, 5, "raw results are never recreated or deleted");
    assert.equal(state.totals.cycles, 1);
    assert.equal(state.totals.invalidCycles, 0);
    assert.equal(state.totals.incidents, 1, "the original incident remains as audit");
    assert.equal(state.recentIncidents.length, 0, "a resolved incident is not an active warning");
    assert.equal(state.activeCycle.id, 1);
    assert.equal(state.activeCycle.eventCount, 5);
    assert.equal(state.activeCycle.eliminatedCount, 4);
    assert.deepEqual(
      database.sqlite
        .prepare("SELECT continuity_epoch FROM round_results ORDER BY settled_at, id")
        .all()
        .map((row) => Number(row.continuity_epoch)),
      [0, 0, 0, 0, 0],
    );
    assert.equal(
      Number(
        database.sqlite
          .prepare("SELECT continuity_epoch FROM stream_state")
          .get().continuity_epoch,
      ),
      0,
    );
    assert.deepEqual(
      database.sqlite
        .prepare(`
          SELECT result_number, eliminated, remaining_count
          FROM cycle_events
          ORDER BY occurred_at, id
        `)
        .all()
        .map((row) => ({
          number: Number(row.result_number),
          eliminated: Number(row.eliminated),
          remaining: Number(row.remaining_count),
        })),
      [
        { number: 20, eliminated: 1, remaining: 36 },
        { number: 14, eliminated: 1, remaining: 35 },
        { number: 14, eliminated: 0, remaining: 35 },
        { number: 31, eliminated: 1, remaining: 34 },
        { number: 35, eliminated: 1, remaining: 33 },
      ],
    );
    assert.equal(
      database
        .getPairStats("buleto", "PRIMECOIN(XPM)/RUB")
        .some((item) => item.numbers[0] === 14 && item.numbers[1] === 31),
      true,
    );
    const resolution = database.sqlite
      .prepare("SELECT * FROM incident_resolutions")
      .get();
    assert.equal(resolution.resolution, "reconciled_contiguous");
    const evidence = JSON.parse(resolution.evidence_json);
    assert.equal(evidence.left.externalRoundId, "4090231");
    assert.equal(evidence.right.externalRoundId, "4090232");
    assert.equal(evidence.elapsedMs, 90_000);

    database.close();
    database = createDatabase({ path, gapThresholdSeconds: 135 });
    assert.equal(
      Number(database.sqlite.prepare("SELECT COUNT(*) AS count FROM incident_resolutions").get().count),
      1,
      "reopening is idempotent",
    );
    assert.equal(database.getDashboardState().totals.cycles, 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("version 9 reconciles consecutive shutdown gaps from newest to oldest", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-v9-chain-"));
  const path = join(directory, "shutdown-chain.sqlite");
  let database = createDatabase({ path, gapThresholdSeconds: 135 });
  try {
    database.ingestBatch([
      event(1, "chain-left", 0, { externalRoundId: "700" }),
    ]);
    database.ingestBatchAfterGap(
      {
        source: "buleto",
        instrument: "PRIMECOIN(XPM)/RUB",
        reason: "shutdown-with-unconfirmed-round-result",
        incidentKey: "shutdown-chain-1",
        detectedAt: new Date(BASE_TIME + 90_100).toISOString(),
      },
      [event(2, "chain-middle", 90, { externalRoundId: "701" })],
    );
    database.ingestBatchAfterGap(
      {
        source: "buleto",
        instrument: "PRIMECOIN(XPM)/RUB",
        reason: "shutdown-with-unconfirmed-round-result",
        incidentKey: "shutdown-chain-2",
        detectedAt: new Date(BASE_TIME + 180_100).toISOString(),
      },
      [event(3, "chain-right", 180, { externalRoundId: "702" })],
    );
    assert.equal(database.getDashboardState().totals.cycles, 3);
    database.sqlite.exec("PRAGMA user_version = 8");
    database.close();

    database = createDatabase({ path, gapThresholdSeconds: 135 });
    const state = database.getDashboardState();
    assert.equal(state.totals.results, 3);
    assert.equal(state.totals.cycles, 1);
    assert.equal(state.totals.invalidCycles, 0);
    assert.equal(state.totals.incidents, 2);
    assert.equal(state.recentIncidents.length, 0);
    assert.equal(state.activeCycle.eventCount, 3);
    assert.deepEqual(
      database.sqlite
        .prepare("SELECT DISTINCT continuity_epoch FROM round_results")
        .all()
        .map((row) => Number(row.continuity_epoch)),
      [0],
    );
    assert.equal(
      Number(database.sqlite.prepare("SELECT COUNT(*) AS count FROM incident_resolutions").get().count),
      2,
    );
    assert.deepEqual(
      database.sqlite
        .prepare("SELECT DISTINCT cycle_id FROM incidents ORDER BY cycle_id")
        .all()
        .map((row) => Number(row.cycle_id)),
      [1],
      "resolved incident references follow the surviving derived cycle",
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("version 9 leaves ambiguous and real gaps untouched", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-v9-real-gaps-"));
  const path = join(directory, "real-gaps.sqlite");
  let database = createDatabase({ path, gapThresholdSeconds: 135 });
  try {
    database.ingestBatch([
      event(4, "real-jump-left", 0, {
        instrument: "JUMP",
        externalRoundId: "100",
      }),
      event(6, "real-reason-left", 0, {
        instrument: "REASON",
        externalRoundId: "200",
      }),
    ]);
    database.ingestBatchAfterGap(
      {
        source: "buleto",
        instrument: "JUMP",
        reason: "shutdown-with-unconfirmed-round-result",
        incidentKey: "real-round-id-jump",
        detectedAt: new Date(BASE_TIME + 90_100).toISOString(),
      },
      [
        event(5, "real-jump-right", 90, {
          instrument: "JUMP",
          externalRoundId: "102",
        }),
      ],
    );
    database.ingestBatchAfterGap(
      {
        source: "buleto",
        instrument: "REASON",
        reason: "round-result-not-confirmed-by-snapshot",
        incidentKey: "real-authoritative-reason",
        detectedAt: new Date(BASE_TIME + 90_100).toISOString(),
      },
      [
        event(7, "real-reason-right", 90, {
          instrument: "REASON",
          externalRoundId: "201",
        }),
      ],
    );
    database.sqlite.exec("PRAGMA user_version = 8");
    database.close();

    database = createDatabase({ path, gapThresholdSeconds: 135 });
    assert.equal(
      Number(database.sqlite.prepare("SELECT COUNT(*) AS count FROM incident_resolutions").get().count),
      0,
    );
    assert.equal(database.getDashboardState().totals.results, 4);
    assert.equal(database.getDashboardState().totals.cycles, 4);
    assert.equal(database.getDashboardState().totals.invalidCycles, 2);
    assert.equal(database.getDashboardState().recentIncidents.length, 2);
    for (const instrument of ["JUMP", "REASON"]) {
      assert.deepEqual(
        database.sqlite
          .prepare(`
            SELECT continuity_epoch
            FROM round_results
            WHERE instrument = ?
            ORDER BY settled_at, id
          `)
          .all(instrument)
          .map((row) => Number(row.continuity_epoch)),
        [0, 1],
      );
    }
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ingestion stores canonical zero and preserves raw cell 37 for audit", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const payload = { id: "round-1", s: 5, rr: { dt: 1, c: 37, v: 5.4 } };
    const ingested = database.ingestBatch([
      event(0, "fp-zero", 0, {
        externalRoundId: "round-1",
        rawPayload: payload,
      }),
    ]);

    assert.equal(ingested.inserted, 1);
    assert.equal(ingested.duplicates, 0);
    assert.equal(ingested.results[0].resultNumber, 0);
    assert.equal(ingested.results[0].rawCell, 37);
    assert.equal(ingested.results[0].externalRoundId, "round-1");
    assert.deepEqual(ingested.results[0].rawPayload, payload);
    assert.equal(ingested.state.activeCycle.remainingCount, 36);
    assert.equal(ingested.state.activeCycle.remainingNumbers.includes(0), false);
    assert.equal(ingested.state.activeCycle.integrityStatus, "ok");
    assert.equal(ingested.state.activeCycle.origin, "round");
    assert.equal(ingested.state.activeCycle.totalDraws, 1);
    assert.equal(ingested.state.activeCycle.uniqueCount, 1);
    assert.deepEqual(
      ingested.state.activeCycle.numbers.find((item) => item.number === 0),
      {
        number: 0,
        occurrenceCount: 1,
        eliminated: true,
        firstSeenAt: "2026-09-21T00:00:00.000Z",
      },
    );

    const stored = database.sqlite
      .prepare("SELECT result_number, raw_cell FROM round_results")
      .get();
    assert.equal(stored.result_number, 0);
    assert.equal(stored.raw_cell, 37);
  } finally {
    database.close();
  }
});

test("number statistics always cover 0 through 36 and use the latest saved result", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const emptyStats = database.getNumberStats("buleto", "PRIMECOIN(XPM)/RUB");
    assert.equal(emptyStats.length, 37);
    assert.deepEqual(
      emptyStats.map((item) => item.number),
      Array.from({ length: 37 }, (_, number) => number),
    );
    assert.ok(emptyStats.every((item) => item.occurrenceCount === 0));
    assert.ok(emptyStats.every((item) => item.lastSeenAt === null));
    assert.ok(emptyStats.every((item) => item.roundsSinceLast === null));

    database.ingestBatch([
      event(37, "history-zero", 0),
      event(7, "history-seven-early", 10),
      event(7, "history-seven-latest", 40),
      event(7, "history-seven-late-ingest", 20),
      event(9, "history-other-stream", 50, { instrument: "OTHER" }),
    ]);
    database.ingestBatch([event(7, "history-seven-latest", 90)]);

    const stats = database.getNumberStats("buleto", "PRIMECOIN(XPM)/RUB");
    assert.deepEqual(stats[0], {
      number: 0,
      occurrenceCount: 1,
      lastSeenAt: "2026-09-21T00:00:00.000Z",
      roundsSinceLast: 3,
    });
    assert.deepEqual(stats[7], {
      number: 7,
      occurrenceCount: 3,
      lastSeenAt: "2026-09-21T00:00:40.000Z",
      roundsSinceLast: 0,
    });
    assert.deepEqual(stats[9], {
      number: 9,
      occurrenceCount: 0,
      lastSeenAt: null,
      roundsSinceLast: null,
    });
    assert.deepEqual(database.getNumberStats("buleto", "OTHER")[9], {
      number: 9,
      occurrenceCount: 1,
      lastSeenAt: "2026-09-21T00:00:50.000Z",
      roundsSinceLast: 0,
    });
  } finally {
    database.close();
  }
});

test("pair statistics preserve order, count overlaps, and include every observed pair", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const numbers = [3, 20, 3, 20, 3, 7, 7, 7];
    database.ingestBatch(
      numbers.map((number, index) => event(number, `pair-${index}`, index)),
    );

    assert.deepEqual(
      database.getPairStats("buleto", "PRIMECOIN(XPM)/RUB"),
      [
        {
          numbers: [7, 7],
          occurrenceCount: 2,
          firstOccurredAt: "2026-09-21T00:00:06.000Z",
          lastOccurredAt: "2026-09-21T00:00:07.000Z",
        },
        {
          numbers: [20, 3],
          occurrenceCount: 2,
          firstOccurredAt: "2026-09-21T00:00:02.000Z",
          lastOccurredAt: "2026-09-21T00:00:04.000Z",
        },
        {
          numbers: [3, 20],
          occurrenceCount: 2,
          firstOccurredAt: "2026-09-21T00:00:01.000Z",
          lastOccurredAt: "2026-09-21T00:00:03.000Z",
        },
        {
          numbers: [3, 7],
          occurrenceCount: 1,
          firstOccurredAt: "2026-09-21T00:00:05.000Z",
          lastOccurredAt: "2026-09-21T00:00:05.000Z",
        },
      ],
    );
  } finally {
    database.close();
  }
});

test("pair statistics count only known continuations after a selected number", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const numbers = [3, 20, 3, 20, 3, 7, 3];
    database.ingestBatch(
      numbers.map((number, index) => event(number, `follower-${index}`, index)),
    );

    const followers = database
      .getPairStats("buleto", "PRIMECOIN(XPM)/RUB")
      .filter((item) => item.numbers[0] === 3);
    const sampleSize = followers.reduce(
      (total, item) => total + item.occurrenceCount,
      0,
    );

    assert.equal(sampleSize, 3);
    assert.deepEqual(
      followers.map((item) => ({
        number: item.numbers[1],
        occurrenceCount: item.occurrenceCount,
        share: item.occurrenceCount / sampleSize,
      })),
      [
        { number: 20, occurrenceCount: 2, share: 2 / 3 },
        { number: 7, occurrenceCount: 1, share: 1 / 3 },
      ],
    );
  } finally {
    database.close();
  }
});

test("pair statistics cover history beyond the latest 500 results", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const numbers = [31, 32, ...Array.from({ length: 501 }, () => 7)];
    database.ingestBatch(
      numbers.map((number, index) => event(number, `long-pair-${index}`, index)),
    );

    assert.deepEqual(
      database
        .getPairStats("buleto", "PRIMECOIN(XPM)/RUB")
        .find((item) => item.numbers[0] === 31 && item.numbers[1] === 32),
      {
        numbers: [31, 32],
        occurrenceCount: 1,
        firstOccurredAt: "2026-09-21T00:00:01.000Z",
        lastOccurredAt: "2026-09-21T00:00:01.000Z",
      },
    );
  } finally {
    database.close();
  }
});

test("an integrity gap prevents pair statistics from joining continuity epochs", () => {
  const database = createDatabase({ path: ":memory:" });
  const gap = {
    source: "buleto",
    instrument: "PRIMECOIN(XPM)/RUB",
    incidentKey: "pair-gap",
    detectedAt: "2026-09-21T00:00:02.000Z",
    message: "known missing result",
  };
  try {
    database.ingestBatch([
      event(1, "gap-pair-0", 0),
      event(2, "gap-pair-1", 1),
    ]);
    database.ingestBatchAfterGap(gap, [
      event(3, "gap-pair-2", 2),
      event(1, "gap-pair-3", 3),
      event(2, "gap-pair-4", 4),
      event(3, "gap-pair-5", 5),
    ]);

    assert.deepEqual(
      database.getPairStats("buleto", "PRIMECOIN(XPM)/RUB"),
      [
        {
          numbers: [1, 2],
          occurrenceCount: 2,
          firstOccurredAt: "2026-09-21T00:00:01.000Z",
          lastOccurredAt: "2026-09-21T00:00:04.000Z",
        },
        {
          numbers: [2, 3],
          occurrenceCount: 1,
          firstOccurredAt: "2026-09-21T00:00:05.000Z",
          lastOccurredAt: "2026-09-21T00:00:05.000Z",
        },
        {
          numbers: [3, 1],
          occurrenceCount: 1,
          firstOccurredAt: "2026-09-21T00:00:03.000Z",
          lastOccurredAt: "2026-09-21T00:00:03.000Z",
        },
      ],
    );
  } finally {
    database.close();
  }
});

test("top-5 hit curve uses one complete cohort and accumulates fixed-list hits", () => {
  const database = createDatabase({ path: ":memory:" });
  const training = [9, 1, 9, 1, 9, 2, 9, 2, 9, 3, 9, 3, 9, 4, 9, 4, 9, 5, 9, 5];
  const evaluation = [
    9, 1, ...Array.from({ length: 19 }, () => 30),
    9, 6, 30, 2, ...Array.from({ length: 17 }, () => 30),
    9, 7, ...Array.from({ length: 8 }, () => 30), 3, ...Array.from({ length: 10 }, () => 30),
    9, 8, ...Array.from({ length: 19 }, () => 30),
  ];
  try {
    database.ingestBatch(
      training.map((number, index) => event(number, `curve-train-${index}`, index)),
    );
    database.ingestBatchAfterGap(
      {
        source: "buleto",
        instrument: "PRIMECOIN(XPM)/RUB",
        incidentKey: "curve-gap",
        detectedAt: new Date(BASE_TIME + training.length * 1_000).toISOString(),
        message: "known missing result",
      },
      evaluation.map((number, index) =>
        event(number, `curve-eval-${index}`, training.length + index + 1),
      ),
    );

    const curve = database.getFollowerTop5HitCurve(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    const sourceNine = curve.bySource.find((item) => item.sourceNumber === 9);

    assert.equal(curve.algorithmVersion, "follower-top5-walk-forward-v1");
    assert.equal(curve.cohort, "anchors-with-complete-20-round-window");
    assert.equal(curve.historyResultCount, training.length + evaluation.length);
    assert.equal(curve.continuitySegmentCount, 2);
    assert.deepEqual({
      eligibleCount: curve.overall.eligibleCount,
      points: curve.overall.points,
    }, {
      eligibleCount: 4,
      points: [
        { horizon: 1, hitCount: 1, eligibleCount: 4, rate: 0.25 },
        { horizon: 2, hitCount: 1, eligibleCount: 4, rate: 0.25 },
        { horizon: 3, hitCount: 2, eligibleCount: 4, rate: 0.5 },
        { horizon: 5, hitCount: 2, eligibleCount: 4, rate: 0.5 },
        { horizon: 10, hitCount: 3, eligibleCount: 4, rate: 0.75 },
        { horizon: 20, hitCount: 3, eligibleCount: 4, rate: 0.75 },
      ],
    });
    assert.equal(curve.overall.allPoints.length, 20);
    assert.equal(
      curve.overall.allPoints.every((point) => point.eligibleCount === 4),
      true,
    );
    assert.deepEqual(
      curve.overall.allPoints.map((point) => point.hitCount),
      [1, 1, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
    );
    assert.equal(sourceNine.eligibleCount, 4);
    assert.deepEqual(
      sourceNine.points.map(({ horizon, hitCount, eligibleCount, rate }) => ({
        horizon,
        hitCount,
        eligibleCount,
        rate,
      })),
      [
        { horizon: 1, hitCount: 1, eligibleCount: 4, rate: 0.25 },
        { horizon: 2, hitCount: 1, eligibleCount: 4, rate: 0.25 },
        { horizon: 3, hitCount: 2, eligibleCount: 4, rate: 0.5 },
        { horizon: 5, hitCount: 2, eligibleCount: 4, rate: 0.5 },
        { horizon: 10, hitCount: 3, eligibleCount: 4, rate: 0.75 },
        { horizon: 20, hitCount: 3, eligibleCount: 4, rate: 0.75 },
      ],
    );

    database.ingestBatch([
      event(
        0,
        "curve-cache-invalidation",
        training.length + evaluation.length + 1,
      ),
    ]);
    assert.equal(
      database.getFollowerTop5HitCurve(
        "buleto",
        "PRIMECOIN(XPM)/RUB",
      ).historyResultCount,
      training.length + evaluation.length + 1,
    );
  } finally {
    database.close();
  }
});

test("top-5 hit curve neither learns from future epochs nor changes a frozen prediction", () => {
  const database = createDatabase({ path: ":memory:" });
  const training = [9, 1, 9, 2, 9, 3, 9, 4, 9, 5];
  const evaluation = [9, 6, ...Array.from({ length: 19 }, () => 30)];
  const later = [9, 6, 9, 6, 9, 6, 9, 6, 9, 6, 9, 6];
  try {
    database.ingestBatch(
      training.map((number, index) => event(number, `no-look-train-${index}`, index)),
    );
    database.ingestBatchAfterGap(
      {
        source: "buleto",
        instrument: "PRIMECOIN(XPM)/RUB",
        incidentKey: "no-look-gap-1",
        detectedAt: new Date(BASE_TIME + training.length * 1_000).toISOString(),
        message: "known missing result",
      },
      evaluation.map((number, index) =>
        event(number, `no-look-eval-${index}`, training.length + index + 1),
      ),
    );
    database.ingestBatchAfterGap(
      {
        source: "buleto",
        instrument: "PRIMECOIN(XPM)/RUB",
        incidentKey: "no-look-gap-2",
        detectedAt: new Date(
          BASE_TIME + (training.length + evaluation.length + 1) * 1_000,
        ).toISOString(),
        message: "known missing result",
      },
      later.map((number, index) =>
        event(
          number,
          `no-look-later-${index}`,
          training.length + evaluation.length + index + 2,
        ),
      ),
    );

    const sourceNine = database
      .getFollowerTop5HitCurve("buleto", "PRIMECOIN(XPM)/RUB")
      .bySource.find((item) => item.sourceNumber === 9);

    assert.equal(sourceNine.eligibleCount, 1);
    assert.equal(sourceNine.points.every((point) => point.hitCount === 0), true);
    assert.equal(sourceNine.points.every((point) => point.rate === 0), true);
  } finally {
    database.close();
  }
});

test("top-5 hit curve never creates a transition across a known gap", () => {
  const database = createDatabase({ path: ":memory:" });
  const training = [9, 1, 9, 2, 9, 3, 9, 4, 9, 5, 9];
  const evaluation = [6, 30, 9, 1, ...Array.from({ length: 19 }, () => 30)];
  try {
    database.ingestBatch(
      training.map((number, index) => event(number, `curve-boundary-${index}`, index)),
    );
    database.ingestBatchAfterGap(
      {
        source: "buleto",
        instrument: "PRIMECOIN(XPM)/RUB",
        incidentKey: "curve-boundary-gap",
        detectedAt: new Date(BASE_TIME + training.length * 1_000).toISOString(),
        message: "known missing result",
      },
      evaluation.map((number, index) =>
        event(number, `curve-boundary-eval-${index}`, training.length + index + 1),
      ),
    );

    const sourceNine = database
      .getFollowerTop5HitCurve("buleto", "PRIMECOIN(XPM)/RUB")
      .bySource.find((item) => item.sourceNumber === 9);

    assert.equal(sourceNine.eligibleCount, 1);
    assert.equal(sourceNine.points[0].hitCount, 1);
    assert.equal(sourceNine.points[0].rate, 1);
  } finally {
    database.close();
  }
});

test("fixed top-5 paper tracker records misses, closes on hit, and respects batch barriers", () => {
  const database = createDatabase({ path: ":memory:" });
  const training = [9, 1, 9, 2, 9, 3, 9, 4, 9, 5, 9];
  try {
    database.ingestBatch(
      training.map((number, index) => event(number, `paper-train-${index}`, index)),
    );
    const armed = database.getFollowerTop5TrackerState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.deepEqual(
      {
        schemaVersion: armed.schemaVersion,
        algorithmVersion: armed.algorithmVersion,
        mode: armed.mode,
        executionEnabled: armed.executionEnabled,
        trackingMode: armed.trackingMode,
        topCount: armed.topCount,
        minimumObservedFollowerCount: armed.minimumObservedFollowerCount,
      },
      {
        schemaVersion: 1,
        algorithmVersion: "follower-top5-live-v1",
        mode: "simulation",
        executionEnabled: false,
        trackingMode: "persisted-batch-aware",
        topCount: 5,
        minimumObservedFollowerCount: 5,
      },
    );
    assert.equal(armed.status, "armed");
    assert.equal(armed.currentSession.sourceNumber, 9);
    assert.deepEqual(armed.currentSession.fixedNumbers, [5, 4, 3, 2, 1]);
    assert.equal(armed.currentSession.attemptCount, 0);

    database.ingestBatch(
      [8, 3, 7, 9].map((number, index) =>
        event(number, `paper-batch-${index}`, training.length + index),
      ),
    );
    const reset = database.getFollowerTop5TrackerState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(reset.status, "armed");
    assert.equal(reset.currentSession.sourceNumber, 9);
    assert.equal(reset.currentSession.attemptCount, 0);
    assert.deepEqual(reset.currentSession.fixedNumbers, [8, 5, 4, 3, 2]);
    assert.deepEqual(
      database.sqlite
        .prepare(`
          SELECT attempt_number, result_number, outcome, hit_rank
          FROM follower_top5_attempts
          ORDER BY id
        `)
        .all()
        .map((row) => ({
          attemptNumber: Number(row.attempt_number),
          resultNumber: Number(row.result_number),
          outcome: row.outcome,
          hitRank: row.hit_rank == null ? null : Number(row.hit_rank),
        })),
      [
        { attemptNumber: 1, resultNumber: 8, outcome: "miss", hitRank: null },
        { attemptNumber: 2, resultNumber: 3, outcome: "hit", hitRank: 3 },
      ],
    );
    assert.equal(reset.lastCompletedSession.attemptCount, 2);
    assert.equal(reset.lastCompletedSession.hitNumber, 3);
    assert.equal(reset.lifetime.trackedRounds, 2);
    assert.equal(reset.lifetime.hits, 1);
    assert.equal(reset.lifetime.misses, 1);

    database.ingestBatch([
      event(6, "paper-live-miss", training.length + 4),
    ]);
    const missed = database.getFollowerTop5TrackerState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(missed.status, "active");
    assert.equal(missed.currentSession.attemptCount, 1);
    assert.equal(missed.currentSession.missCount, 1);
    assert.equal(missed.currentSession.nextAttemptNumber, 2);
    assert.deepEqual(missed.currentSession.fixedNumbers, [8, 5, 4, 3, 2]);
    assert.deepEqual(missed.currentSession.attempts, [
      {
        attemptNumber: 1,
        resultId: missed.currentSession.attempts[0].resultId,
        resultNumber: 6,
        outcome: "miss",
        hitRank: null,
        settledAt: new Date(
          BASE_TIME + (training.length + 4) * 1_000,
        ).toISOString(),
      },
    ]);

    database.ingestBatch([
      event(5, "paper-live-hit", training.length + 5),
    ]);
    const hit = database.getFollowerTop5TrackerState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(hit.currentSession, null);
    assert.equal(hit.status, "waiting_training");
    assert.equal(hit.lastCompletedSession.hitNumber, 5);
    assert.equal(hit.lastCompletedSession.attemptCount, 2);
    assert.equal(hit.lifetime.trackedRounds, 4);
    assert.equal(hit.lifetime.hits, 2);
    assert.equal(hit.lifetime.misses, 2);
  } finally {
    database.close();
  }
});

test("fixed top-5 paper tracker invalidates a run at a gap without grading catch-up rows", () => {
  const database = createDatabase({ path: ":memory:" });
  const training = [9, 1, 9, 2, 9, 3, 9, 4, 9, 5, 9];
  try {
    database.ingestBatch(
      training.map((number, index) => event(number, `paper-gap-train-${index}`, index)),
    );
    const miss = event(8, "paper-gap-miss", training.length);
    database.ingestBatch([miss]);
    database.ingestBatch([miss]);

    database.ingestBatchAfterGap(
      {
        source: "buleto",
        instrument: "PRIMECOIN(XPM)/RUB",
        incidentKey: "paper-tracker-gap",
        detectedAt: new Date(BASE_TIME + (training.length + 1) * 1_000).toISOString(),
        message: "known missing result",
      },
      [1, 9].map((number, index) =>
        event(number, `paper-gap-catchup-${index}`, training.length + index + 2),
      ),
    );

    const state = database.getFollowerTop5TrackerState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "armed");
    assert.equal(state.currentSession.sourceNumber, 9);
    assert.equal(state.currentSession.attemptCount, 0);
    assert.equal(state.lifetime.trackedRounds, 1);
    assert.equal(state.lifetime.hits, 0);
    assert.equal(state.lifetime.misses, 1);
    assert.equal(state.lifetime.invalidatedSessions, 1);
    assert.equal(
      database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM follower_top5_attempts")
        .get().count,
      1,
    );
  } finally {
    database.close();
  }
});

test("fixed top-5 paper tracker ignores retrograde inserts before its chronological boundary", () => {
  const database = createDatabase({ path: ":memory:" });
  const training = [9, 1, 9, 2, 9, 3, 9, 4, 9, 5, 9];
  try {
    database.ingestBatch(
      training.map((number, index) => event(number, `paper-order-${index}`, index)),
    );
    const armed = database.getFollowerTop5TrackerState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    const sessionId = armed.currentSession.id;

    database.ingestBatch([
      event(8, "paper-order-before-anchor", training.length - 1.5),
    ]);
    let state = database.getFollowerTop5TrackerState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.currentSession.id, sessionId);
    assert.equal(state.currentSession.attemptCount, 0);
    assert.equal(state.lastAttempt, null);

    database.ingestBatch([
      event(8, "paper-order-forward", training.length + 1),
    ]);
    state = database.getFollowerTop5TrackerState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.currentSession.attemptCount, 1);
    const firstAttemptId = state.lastAttempt.resultId;

    database.ingestBatch([
      event(7, "paper-order-before-attempt", training.length + 0.5),
    ]);
    state = database.getFollowerTop5TrackerState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.currentSession.id, sessionId);
    assert.equal(state.currentSession.attemptCount, 1);
    assert.equal(state.lastAttempt.resultId, firstAttemptId);
    assert.equal(
      database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM follower_top5_attempts")
        .get().count,
      1,
    );
  } finally {
    database.close();
  }
});

test("fixed top-5 paper tracker preserves its frozen list across restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-follower-paper-"));
  const path = join(directory, "tracker.sqlite");
  const training = [9, 1, 9, 2, 9, 3, 9, 4, 9, 5, 9];
  let database = createDatabase({ path });
  try {
    database.ingestBatch(
      training.map((number, index) => event(number, `paper-reopen-${index}`, index)),
    );
    database.ingestBatch([
      event(8, "paper-reopen-miss", training.length),
    ]);
    const before = database.getFollowerTop5TrackerState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    database.close();

    database = createDatabase({ path });
    const after = database.getFollowerTop5TrackerState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(after.currentSession.id, before.currentSession.id);
    assert.deepEqual(
      after.currentSession.fixedNumbers,
      before.currentSession.fixedNumbers,
    );
    assert.equal(after.currentSession.attemptCount, 1);
    assert.equal(after.lifetime.trackedRounds, 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fixed top-5 paper tracker keeps a tail gap cancelled across restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-follower-tail-gap-"));
  const path = join(directory, "tracker.sqlite");
  const training = [9, 1, 9, 2, 9, 3, 9, 4, 9, 5, 9];
  let database = createDatabase({ path });
  try {
    database.ingestBatch(
      training.map((number, index) => event(number, `paper-tail-gap-${index}`, index)),
    );
    database.markGap({
      source: "buleto",
      instrument: "PRIMECOIN(XPM)/RUB",
      incidentKey: "paper-tail-gap",
      detectedAt: new Date(BASE_TIME + training.length * 1_000).toISOString(),
      message: "known missing result",
    });
    let state = database.getFollowerTop5TrackerState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "gap");
    assert.equal(state.currentSession, null);
    assert.equal(state.lifetime.invalidatedSessions, 1);

    database.close();
    database = createDatabase({ path });
    state = database.getFollowerTop5TrackerState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "gap");
    assert.equal(state.currentSession, null);
    assert.equal(state.lifetime.invalidatedSessions, 1);

    database.ingestBatch(
      [1, 9].map((number, index) =>
        event(number, `paper-tail-gap-next-${index}`, training.length + index + 1),
      ),
    );
    state = database.getFollowerTop5TrackerState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "armed");
    assert.equal(state.currentSession.sourceNumber, 9);
    assert.equal(state.currentSession.attemptCount, 0);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fixed top-5 paper tracker follows a reconciled anchor epoch across restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-follower-reconcile-"));
  const path = join(directory, "tracker.sqlite");
  const training = [9, 1, 9, 2, 9, 3, 9, 4, 9, 5, 9];
  let database = createDatabase({ path, gapThresholdSeconds: 135 });
  try {
    database.ingestBatch(
      training.map((number, index) =>
        event(number, `paper-reconcile-left-${index}`, index, {
          externalRoundId: String(6_000 + index),
        }),
      ),
    );
    database.ingestBatchAfterGap(
      {
        source: "buleto",
        instrument: "PRIMECOIN(XPM)/RUB",
        reason: "shutdown-with-unconfirmed-round-result",
        incidentKey: "paper-reconcile-gap",
        detectedAt: new Date(
          BASE_TIME + training.length * 1_000 + 100,
        ).toISOString(),
        message: "planned restart before snapshot confirmation",
      },
      [8, 9].map((number, index) =>
        event(
          number,
          `paper-reconcile-right-${index}`,
          training.length + index,
          { externalRoundId: String(6_000 + training.length + index) },
        ),
      ),
    );
    const before = database.getFollowerTop5TrackerState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(before.status, "armed");
    assert.equal(before.currentSession.continuityEpoch, 1);
    const sessionId = before.currentSession.id;

    database.sqlite.exec("PRAGMA user_version = 8");
    database.close();
    database = createDatabase({ path, gapThresholdSeconds: 135 });

    const reconciled = database.getFollowerTop5TrackerState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(reconciled.status, "armed");
    assert.equal(reconciled.currentSession.id, sessionId);
    assert.equal(reconciled.currentSession.continuityEpoch, 0);
    assert.equal(
      Number(
        database.sqlite
          .prepare("SELECT continuity_epoch FROM stream_state")
          .get().continuity_epoch,
      ),
      0,
    );

    database.ingestBatch([
      event(6, "paper-reconcile-next", training.length + 2, {
        externalRoundId: String(6_000 + training.length + 2),
      }),
    ]);
    const continued = database.getFollowerTop5TrackerState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(continued.currentSession.id, sessionId);
    assert.equal(continued.currentSession.attemptCount, 1);
    assert.equal(continued.currentSession.missCount, 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("repeated triples preserve order and count overlapping appearances", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const numbers = [3, 20, 18, 9, 3, 20, 18, 7, 7, 7, 7];
    database.ingestBatch(
      numbers.map((number, index) => event(number, `triple-${index}`, index)),
    );

    const triples = database.getRepeatedTriples(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
      20,
    );
    assert.deepEqual(
      triples.find((item) => item.numbers.join(",") === "3,20,18"),
      {
        numbers: [3, 20, 18],
        occurrenceCount: 2,
        firstOccurredAt: "2026-09-21T00:00:02.000Z",
        lastOccurredAt: "2026-09-21T00:00:06.000Z",
      },
    );
    assert.deepEqual(
      triples.find((item) => item.numbers.join(",") === "7,7,7"),
      {
        numbers: [7, 7, 7],
        occurrenceCount: 2,
        firstOccurredAt: "2026-09-21T00:00:09.000Z",
        lastOccurredAt: "2026-09-21T00:00:10.000Z",
      },
    );
    assert.equal(
      triples.some((item) => item.numbers.join(",") === "18,20,3"),
      false,
    );
  } finally {
    database.close();
  }
});

test("an integrity gap breaks triples while a duplicate gap does not split them again", () => {
  const database = createDatabase({ path: ":memory:" });
  const gap = {
    source: "buleto",
    instrument: "PRIMECOIN(XPM)/RUB",
    incidentKey: "triple-gap",
    detectedAt: "2026-09-21T00:00:02.000Z",
    message: "known missing result",
  };
  try {
    database.ingestBatch([
      event(1, "gap-triple-0", 0),
      event(2, "gap-triple-1", 1),
    ]);
    database.ingestBatchAfterGap(gap, [event(3, "gap-triple-2", 2)]);
    database.ingestBatch([
      event(1, "gap-triple-3", 3),
      event(2, "gap-triple-4", 4),
      event(3, "gap-triple-5", 5),
      event(9, "gap-triple-6", 6),
      event(1, "gap-triple-7", 7),
      event(2, "gap-triple-8", 8),
    ]);
    database.markGap(gap);
    database.ingestBatch([event(3, "gap-triple-9", 9)]);

    const triples = database.getRepeatedTriples(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
      20,
    );
    assert.deepEqual(
      triples.find((item) => item.numbers.join(",") === "1,2,3"),
      {
        numbers: [1, 2, 3],
        occurrenceCount: 2,
        firstOccurredAt: "2026-09-21T00:00:05.000Z",
        lastOccurredAt: "2026-09-21T00:00:09.000Z",
      },
    );

    const epochs = database.sqlite
      .prepare("SELECT continuity_epoch FROM round_results ORDER BY settled_at, id")
      .all()
      .map((row) => Number(row.continuity_epoch));
    assert.deepEqual(epochs, [0, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
  } finally {
    database.close();
  }
});

test("a normally completed cycle does not break a consecutive triple", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const numbers = [
      ...Array.from({ length: 36 }, (_, number) => number),
      0,
      9,
      34,
      35,
      0,
    ];
    database.ingestBatch(
      numbers.map((number, index) => event(number, `cycle-triple-${index}`, index)),
    );

    const match = database
      .getRepeatedTriples("buleto", "PRIMECOIN(XPM)/RUB", 20)
      .find((item) => item.numbers.join(",") === "34,35,0");
    assert.deepEqual(match, {
      numbers: [34, 35, 0],
      occurrenceCount: 2,
      firstOccurredAt: "2026-09-21T00:00:36.000Z",
      lastOccurredAt: "2026-09-21T00:00:40.000Z",
    });
    assert.equal(database.getDashboardState().totals.completedCycles, 1);
    assert.deepEqual(
      database.sqlite
        .prepare("SELECT DISTINCT continuity_epoch FROM round_results")
        .all()
        .map((row) => Number(row.continuity_epoch)),
      [0],
    );
  } finally {
    database.close();
  }
});

test("fingerprints dedupe results and a richer duplicate only enriches the row", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    database.ingestBatch([event(5, "same-result")]);
    const richerPayload = {
      id: "server-round-5",
      s: 5,
      rr: { dt: 2, c: 5, v: 5.401 },
    };
    const duplicate = database.ingestBatch([
      event(5, "same-result", 1, {
        externalRoundId: "server-round-5",
        rawPayload: richerPayload,
      }),
    ]);

    assert.equal(duplicate.inserted, 0);
    assert.equal(duplicate.duplicates, 1);
    assert.equal(duplicate.state.totals.results, 1);
    assert.equal(duplicate.state.activeCycle.eventCount, 1);
    assert.equal(duplicate.state.activeCycle.remainingCount, 36);

    const [stored] = database.getRecentResults(1);
    assert.equal(stored.externalRoundId, "server-round-5");
    assert.equal(stored.rawCell, 5);
    assert.deepEqual(stored.rawPayload, richerPayload);

    const eventCount = database.sqlite
      .prepare("SELECT COUNT(*) AS count FROM cycle_events")
      .get().count;
    assert.equal(eventCount, 1);
  } finally {
    database.close();
  }
});

test("external round id dedupes even when a fingerprint changes", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    database.ingestBatch([
      event(8, "first-fingerprint", 0, { externalRoundId: "round-8" }),
    ]);
    const duplicate = database.ingestBatch([
      event(8, "second-fingerprint", 1, { externalRoundId: "round-8" }),
    ]);

    assert.equal(duplicate.inserted, 0);
    assert.equal(duplicate.duplicates, 1);
    assert.equal(database.getDashboardState().totals.results, 1);
  } finally {
    database.close();
  }
});

test("external round ids are isolated by instrument", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const outcome = database.ingestBatch([
      event(8, "instrument-a", 0, { externalRoundId: "round-8", instrument: "A" }),
      event(9, "instrument-b", 1, { externalRoundId: "round-8", instrument: "B" }),
    ]);

    assert.equal(outcome.inserted, 2);
    assert.equal(database.getLatestResult("buleto", "A").fingerprint, "instrument-a");
    assert.equal(database.getLatestResult("buleto", "B").fingerprint, "instrument-b");
  } finally {
    database.close();
  }
});

test("a repeated result does not reduce the cycle remainder", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const result = database.ingestBatch([
      event(12, "repeat-1", 0),
      event(12, "repeat-2", 1),
    ]);

    assert.equal(result.inserted, 2);
    assert.equal(result.state.activeCycle.eventCount, 2);
    assert.equal(result.state.activeCycle.eliminatedCount, 1);
    assert.equal(result.state.activeCycle.remainingCount, 36);

    const recent = database.getRecentResults(1)[0];
    assert.equal(recent.number, 12);
    assert.equal(recent.wasNew, false);
    assert.equal(recent.remainingAfter, 36);

    const cycleEvents = database.sqlite
      .prepare("SELECT eliminated, remaining_count FROM cycle_events ORDER BY id")
      .all();
    assert.deepEqual(
      cycleEvents.map((row) => [row.eliminated, row.remaining_count]),
      [
        [1, 36],
        [0, 36],
      ],
    );
  } finally {
    database.close();
  }
});

test("cycle completes at one survivor; the next result opens a new cycle", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const firstCycleEvents = Array.from({ length: 36 }, (_, number) =>
      event(number, `cycle-1-${number}`, number, {
        externalRoundId: `round-${number}`,
      }),
    );
    const completed = database.ingestBatch(firstCycleEvents);

    assert.equal(completed.inserted, 36);
    assert.equal(completed.completedCycles.length, 1);
    assert.equal(completed.completedCycles[0].status, "completed");
    assert.equal(completed.completedCycles[0].survivorNumber, 36);
    assert.deepEqual(completed.completedCycles[0].remainingNumbers, [36]);
    assert.equal(completed.state.activeCycle, null);

    const next = database.ingestBatch([event(12, "cycle-2-12", 40)]);
    assert.equal(next.state.activeCycle.status, "active");
    assert.equal(next.state.activeCycle.id, 2);
    assert.equal(next.state.activeCycle.remainingCount, 36);
    assert.equal(next.state.activeCycle.remainingNumbers.includes(12), false);

    const history = database.getCompletedCycles(10);
    assert.equal(history.length, 1);
    assert.equal(history[0].survivorNumber, 36);
    assert.equal(database.getRecentResults(2)[0].fingerprint, "cycle-2-12");
  } finally {
    database.close();
  }
});

test("batch validation is atomic and a gap invalidates the active cycle", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    assert.throws(
      () =>
        database.ingestBatch([
          event(1, "would-be-valid"),
          event(99, "invalid-number", 1),
        ]),
      /wire number/,
    );
    assert.equal(database.getDashboardState().totals.results, 0);

    database.ingestBatch([event(4, "before-gap", 2)]);
    assert.equal(database.getDashboardState().activeCycle.id, 1);

    const gap = database.markGap({
      source: "buleto",
      instrument: "PRIMECOIN(XPM)/RUB",
      detectedAt: "2026-09-21T00:10:00.000Z",
      message: "missing result between snapshots",
      previousFingerprint: "before",
      nextFingerprint: "after",
    });
    assert.equal(gap.kind, "gap");
    assert.equal(gap.details.previousFingerprint, "before");
    assert.equal(gap.cycleId, 1);
    assert.equal(gap.invalidatedCycle.status, "invalid_gap");
    assert.equal(gap.invalidatedCycle.integrityStatus, "gap");
    assert.equal(gap.invalidatedCycle.survivorNumber, null);
    const state = database.getDashboardState();
    assert.equal(state.totals.incidents, 1);
    assert.equal(state.totals.invalidCycles, 1);
    assert.equal(state.activeCycle, null);
    assert.equal(state.recentIncidents[0].message, "missing result between snapshots");

    const afterGap = database.ingestBatch([event(9, "after-gap", 601)]);
    assert.equal(afterGap.state.activeCycle.id, 2);
    assert.equal(afterGap.state.activeCycle.status, "active");
    assert.equal(afterGap.state.activeCycle.remainingCount, 36);
  } finally {
    database.close();
  }
});

test("the same durable gap key cannot invalidate a later healthy cycle", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    database.ingestBatch([event(4, "durable-gap-before")]);
    const details = {
      source: "buleto",
      instrument: "PRIMECOIN(XPM)/RUB",
      incidentKey: "automatic:before:after",
      detectedAt: "2026-09-21T00:10:00.000Z",
      message: "durable gap",
    };
    const first = database.markGap(details);
    assert.equal(first.duplicate, false);

    database.ingestBatch([event(9, "durable-gap-after", 601)]);
    const duplicate = database.markGap(details);
    const state = database.getDashboardState();

    assert.equal(duplicate.duplicate, true);
    assert.equal(state.totals.incidents, 1);
    assert.equal(state.totals.invalidCycles, 1);
    assert.equal(state.activeCycle.id, 2);
    assert.equal(state.activeCycle.status, "active");
  } finally {
    database.close();
  }
});

test("late known results can be enriched without inserting unknown history", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    database.ingestBatch([event(7, "known-history")]);
    const richerPayload = { id: "round-7", rr: { c: 7, v: 5.4 } };
    const enrichment = database.enrichKnownResults([
      event(7, "known-history", 0, {
        externalRoundId: "round-7",
        rawPayload: richerPayload,
      }),
      event(8, "unknown-history", 1, { externalRoundId: "round-8" }),
    ]);

    assert.equal(enrichment.enriched, 1);
    assert.equal(database.getDashboardState().totals.results, 1);
    const stored = database.getRecentResults(1)[0];
    assert.equal(stored.externalRoundId, "round-7");
    assert.deepEqual(stored.rawPayload, richerPayload);
  } finally {
    database.close();
  }
});

test("latest result lookup is isolated by source and instrument", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    database.ingestBatch([
      event(1, "stream-a", 0, { instrument: "A" }),
      event(2, "stream-b", 100, { instrument: "B" }),
    ]);

    assert.equal(database.getLatestResult("buleto", "A").fingerprint, "stream-a");
    assert.equal(database.getLatestResult("buleto", "B").fingerprint, "stream-b");
    assert.equal(database.getLatestResult("buleto", "missing"), null);
  } finally {
    database.close();
  }
});

test("gap invalidation and its first result commit atomically", () => {
  const database = createDatabase({ path: ":memory:" });
  const gap = {
    source: "buleto",
    instrument: "PRIMECOIN(XPM)/RUB",
    incidentKey: "atomic-gap",
    detectedAt: "2026-09-21T00:05:00.000Z",
    message: "atomic boundary",
  };
  try {
    database.ingestBatch([event(1, "atomic-before")]);
    assert.throws(
      () => database.ingestBatchAfterGap(gap, [event(99, "atomic-invalid", 301)]),
      /wire number/,
    );

    let state = database.getDashboardState();
    assert.equal(state.totals.results, 1);
    assert.equal(state.totals.incidents, 0);
    assert.equal(state.totals.invalidCycles, 0);
    assert.equal(state.activeCycle.id, 1);

    const committed = database.ingestBatchAfterGap(gap, [event(2, "atomic-after", 301)]);
    state = database.getDashboardState();
    assert.equal(committed.inserted, 1);
    assert.equal(committed.gap.duplicate, false);
    assert.equal(state.totals.results, 2);
    assert.equal(state.totals.incidents, 1);
    assert.equal(state.totals.invalidCycles, 1);
    assert.equal(state.activeCycle.id, 2);
    assert.equal(state.latestResult.fingerprint, "atomic-after");
  } finally {
    database.close();
  }
});

test("virtual bettor arms at 200 misses and starts betting only on the next tail result", () => {
  const database = createDatabase({ path: ":memory:" });
  const history = virtualTriggerEvents("virtual-threshold");
  try {
    database.ingestBatch(history.slice(0, -1));
    let state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "waiting");
    assert.equal(state.longestCandidate.number, 1);
    assert.equal(state.longestCandidate.roundsSinceLast, 199);
    assert.equal(state.longestCandidate.eligible, false);
    assert.equal(state.activeSession, null);
    assert.equal(state.latestOutcome, null);

    database.ingestBatch(history.slice(-1));
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.mode, "simulation");
    assert.equal(state.executionEnabled, false);
    assert.equal(state.status, "armed");
    assert.equal(state.triggerThreshold, 200);
    assert.deepEqual(state.model, {
      triggerThreshold: 200,
      initialStake: 10,
      stakeStep: 10,
      maxStake: 2500,
      grossPayoutMultiplier: 36,
      payoutIncludesStake: true,
      modelVersion: "1.0.0",
    });
    assert.equal(state.longestCandidate.number, 1);
    assert.equal(state.longestCandidate.roundsSinceLast, 200);
    assert.equal(state.longestCandidate.eligible, true);
    assert.equal(state.activeSession.targetNumber, 1);
    assert.equal(state.activeSession.status, "armed");
    assert.equal(state.activeSession.attemptCount, 0);
    assert.equal(state.activeSession.totalStaked, 0);
    assert.equal(state.activeSession.nextStake, 10);
    assert.equal(state.activeSession.selectedAt, "2026-09-21T00:03:20.000Z");
    assert.equal(state.activeSession.startedAt, null);
    assert.equal(state.latestOutcome, null);
    assert.deepEqual(state.testBank, {
      mode: "simulation",
      status: "running",
      initialBalance: 87_700,
      currentBalance: 87_700,
      netResult: 0,
      nextStake: 10,
      canAffordNext: true,
      shortfall: 0,
      startedAt: state.testBank.startedAt,
      exhaustedAt: null,
      dataComplete: true,
    });
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM virtual_bets").get().count, 0);

    const initialized = database.initializeVirtualBettor(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(initialized.activeSession.id, state.activeSession.id);
    assert.equal(initialized.lifetime.totalSessions, 1);

    database.ingestBatch([event(3, "virtual-first-miss", 201)]);
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "active");
    assert.equal(state.activeSession.attemptCount, 1);
    assert.equal(state.activeSession.missCount, 1);
    assert.equal(state.activeSession.totalStaked, 10);
    assert.equal(state.activeSession.nextStake, 10);
    assert.equal(state.activeSession.startedAt, "2026-09-21T00:03:21.000Z");
    assert.equal(state.testBank.currentBalance, 87_690);
    assert.equal(state.testBank.netResult, -10);
    assert.deepEqual(
      {
        roundId: state.latestOutcome.roundId,
        sessionId: state.latestOutcome.sessionId,
        attemptNumber: state.latestOutcome.attemptNumber,
        targetNumber: state.latestOutcome.targetNumber,
        resultNumber: state.latestOutcome.resultNumber,
        outcome: state.latestOutcome.outcome,
        stake: state.latestOutcome.stake,
        grossPayout: state.latestOutcome.grossPayout,
        totalStakedAfter: state.latestOutcome.totalStakedAfter,
        sessionNetAfter: state.latestOutcome.sessionNetAfter,
        nextStake: state.latestOutcome.nextStake,
        recoveryPossible: state.latestOutcome.recoveryPossible,
        occurredAt: state.latestOutcome.occurredAt,
      },
      {
        roundId: null,
        sessionId: state.activeSession.id,
        attemptNumber: 1,
        targetNumber: 1,
        resultNumber: 3,
        outcome: "miss",
        stake: 10,
        grossPayout: 0,
        totalStakedAfter: 10,
        sessionNetAfter: -10,
        nextStake: 10,
        recoveryPossible: true,
        occurredAt: "2026-09-21T00:03:21.000Z",
      },
    );
    const firstOutcomeId = state.latestOutcome.betId;

    database.ingestBatch([event(3, "virtual-first-miss", 202)]);
    database.ingestBatch([event(4, "virtual-late-history", 50)]);
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.activeSession.attemptCount, 1);
    assert.equal(state.lifetime.totalBets, 1);
    assert.equal(state.latestOutcome.betId, firstOutcomeId);

    database.ingestBatch([event(1, "virtual-hit", 202)]);
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "waiting");
    assert.equal(state.activeSession, null);
    assert.equal(state.recentSessions[0].status, "completed");
    assert.equal(state.recentSessions[0].attemptCount, 2);
    assert.equal(state.recentSessions[0].missCount, 1);
    assert.equal(state.recentSessions[0].totalStaked, 20);
    assert.equal(state.recentSessions[0].grossPayout, 360);
    assert.equal(state.recentSessions[0].netResult, 340);
    assert.equal(state.recentSessions[0].endReason, "hit");
    assert.equal(state.latestOutcome.betId, firstOutcomeId + 1);
    assert.equal(state.latestOutcome.resultId, state.recentSessions[0].completedResultId);
    assert.equal(state.latestOutcome.sessionId, state.recentSessions[0].id);
    assert.equal(state.latestOutcome.attemptNumber, 2);
    assert.equal(state.latestOutcome.targetNumber, 1);
    assert.equal(state.latestOutcome.resultNumber, 1);
    assert.equal(state.latestOutcome.outcome, "hit");
    assert.equal(state.latestOutcome.stake, 10);
    assert.equal(state.latestOutcome.grossPayout, 360);
    assert.equal(state.latestOutcome.totalStakedAfter, 20);
    assert.equal(state.latestOutcome.sessionNetAfter, 340);
    assert.equal(state.latestOutcome.nextStake, null);
    assert.equal(state.latestOutcome.recoveryPossible, true);
    assert.equal(state.latestOutcome.occurredAt, "2026-09-21T00:03:22.000Z");
    assert.equal(state.testBank.currentBalance, 88_040);
    assert.equal(state.testBank.netResult, 340);
    assert.deepEqual(state.lifetime, {
      totalSessions: 1,
      completedSessions: 1,
      invalidatedSessions: 0,
      totalBets: 2,
      winningBets: 1,
      losingBets: 1,
      totalStaked: 20,
      grossPayout: 360,
      netResult: 340,
    });
    assert.equal(
      database.getVirtualBetSessions("buleto", "PRIMECOIN(XPM)/RUB", 10)[0]
        .startedAt,
      "2026-09-21T00:03:21.000Z",
    );
  } finally {
    database.close();
  }
});

test("virtual bettor includes never-seen numbers in the current epoch", () => {
  const database = createDatabase({ path: ":memory:" });
  const history = Array.from({ length: 200 }, (_, index) =>
    event(1, `virtual-unseen-${index}`, index),
  );
  try {
    assert.equal(
      database.getVirtualBettorState("buleto", "PRIMECOIN(XPM)/RUB")
        .longestCandidate,
      null,
    );
    database.ingestBatch(history.slice(0, -1));
    let state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.deepEqual(state.longestCandidate, {
      number: 0,
      roundsSinceLast: 199,
      occurrenceCount: 0,
      lastSeenAt: null,
      lastResultId: null,
      lastPosition: null,
      continuityEpoch: 0,
      eligible: false,
    });
    assert.equal(state.status, "waiting");

    database.ingestBatch(history.slice(-1));
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.deepEqual(state.longestCandidate, {
      number: 0,
      roundsSinceLast: 200,
      occurrenceCount: 0,
      lastSeenAt: null,
      lastResultId: null,
      lastPosition: null,
      continuityEpoch: 0,
      eligible: true,
    });
    assert.equal(state.status, "armed");
    assert.equal(state.activeSession.targetNumber, 0);
    assert.equal(state.activeSession.triggerRoundsMissed, 200);
    assert.equal(state.activeSession.attemptCount, 0);
    assert.equal(state.activeSession.totalStaked, 0);

    database.ingestBatch([event(1, "virtual-unseen-next", 200)]);
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "active");
    assert.equal(state.activeSession.targetNumber, 0);
    assert.equal(state.activeSession.attemptCount, 1);
    assert.equal(state.activeSession.totalStaked, 10);
    assert.equal(state.activeSession.nextStake, 10);
  } finally {
    database.close();
  }
});

test("a novel gap invalidates a live virtual session and a duplicate gap is inert", () => {
  const database = createDatabase({ path: ":memory:" });
  const details = {
    source: "buleto",
    instrument: "PRIMECOIN(XPM)/RUB",
    incidentKey: "virtual-gap",
    detectedAt: "2026-09-21T00:04:00.000Z",
    message: "virtual bettor integrity boundary",
  };
  try {
    database.ingestBatch(virtualTriggerEvents("virtual-gap"));
    database.ingestBatch([event(3, "virtual-gap-miss", 201)]);
    assert.equal(
      database.getVirtualBettorState("buleto", "PRIMECOIN(XPM)/RUB").status,
      "active",
    );

    const first = database.markGap(details);
    let state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(first.duplicate, false);
    assert.equal(state.status, "waiting");
    assert.equal(state.longestCandidate, null);
    assert.equal(state.recentSessions[0].status, "invalid_gap");
    assert.equal(state.recentSessions[0].attemptCount, 1);
    assert.equal(state.recentSessions[0].totalStaked, 10);
    assert.equal(state.recentSessions[0].netResult, -10);
    assert.equal(state.recentSessions[0].endReason, "integrity_gap");
    assert.equal(state.testBank.currentBalance, 87_690);
    assert.equal(state.testBank.status, "running");
    assert.equal(state.testBank.dataComplete, false);
    assert.equal(state.lifetime.totalBets, 1);
    assert.equal(state.lifetime.totalStaked, 10);
    assert.equal(state.lifetime.netResult, -10);

    const duplicate = database.markGap(details);
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(duplicate.duplicate, true);
    assert.equal(state.recentSessions.length, 1);
    assert.equal(state.lifetime.invalidatedSessions, 1);
    assert.equal(
      Number(
        database.sqlite
          .prepare(`
            SELECT continuity_epoch
            FROM stream_state
            WHERE source = 'buleto' AND instrument = 'PRIMECOIN(XPM)/RUB'
          `)
          .get().continuity_epoch,
      ),
      1,
    );
  } finally {
    database.close();
  }
});

test("virtual bet settlement rolls back with the result and can be retried", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    database.ingestBatch(virtualTriggerEvents("virtual-atomic"));
    database.sqlite.exec(`
      CREATE TRIGGER fail_virtual_bet
      BEFORE INSERT ON virtual_bets
      BEGIN
        SELECT RAISE(ABORT, 'forced virtual bet failure');
      END;
    `);

    assert.throws(
      () => database.ingestBatch([event(3, "virtual-atomic-next", 201)]),
      /forced virtual bet failure/,
    );
    let state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(database.getDashboardState().totals.results, 201);
    assert.equal(state.status, "armed");
    assert.equal(state.activeSession.attemptCount, 0);
    assert.equal(state.lifetime.totalBets, 0);
    assert.equal(state.testBank.currentBalance, 87_700);

    database.sqlite.exec("DROP TRIGGER fail_virtual_bet");
    const retry = database.ingestBatch([event(3, "virtual-atomic-next", 201)]);
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(retry.inserted, 1);
    assert.equal(state.status, "active");
    assert.equal(state.activeSession.attemptCount, 1);
    assert.equal(state.lifetime.totalBets, 1);
    assert.equal(state.testBank.currentBalance, 87_690);
  } finally {
    database.close();
  }
});

test("virtual bettor state persists and resumes after reopening the database", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-virtual-"));
  const path = join(directory, "paper-bettor.sqlite");
  let database = createDatabase({ path });
  try {
    database.ingestBatch(virtualTriggerEvents("virtual-persist"));
    const armedId = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    ).activeSession.id;
    database.close();

    database = createDatabase({ path });
    let state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "armed");
    assert.equal(state.activeSession.id, armedId);
    assert.equal(state.activeSession.attemptCount, 0);

    database.ingestBatch([event(3, "virtual-persist-next", 201)]);
    database.close();
    database = createDatabase({ path });
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "active");
    assert.equal(state.activeSession.id, armedId);
    assert.equal(state.activeSession.attemptCount, 1);
    assert.equal(state.activeSession.totalStaked, 10);
    assert.equal(state.lifetime.totalBets, 1);
    assert.equal(state.testBank.currentBalance, 87_690);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("database settlement follows the recovery ladder and isolates instruments", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    database.ingestBatch(virtualTriggerEvents("virtual-ladder"));
    database.ingestBatch(
      virtualTriggerEvents("virtual-ladder-other", 7, 8, {
        instrument: "OTHER",
      }),
    );

    let primary = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    let other = database.getVirtualBettorState("buleto", "OTHER");
    assert.equal(primary.status, "armed");
    assert.equal(primary.activeSession.targetNumber, 1);
    assert.equal(other.status, "armed");
    assert.equal(other.activeSession.targetNumber, 7);
    assert.notEqual(primary.activeSession.id, other.activeSession.id);

    database.ingestBatch(
      Array.from({ length: 36 }, (_, index) =>
        event(3, `virtual-ladder-first-${index}`, 201 + index),
      ),
    );
    primary = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    other = database.getVirtualBettorState("buleto", "OTHER");
    assert.equal(primary.activeSession.attemptCount, 36);
    assert.equal(primary.activeSession.missCount, 36);
    assert.equal(primary.activeSession.totalStaked, 360);
    assert.equal(primary.activeSession.nextStake, 20);
    assert.equal(other.status, "armed");
    assert.equal(other.activeSession.attemptCount, 0);
    assert.equal(other.activeSession.totalStaked, 0);
    assert.equal(primary.testBank.currentBalance, 87_340);
    assert.equal(other.testBank.currentBalance, 87_700);

    database.ingestBatch(
      Array.from({ length: 18 }, (_, index) =>
        event(3, `virtual-ladder-second-${index}`, 237 + index),
      ),
    );
    primary = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(primary.activeSession.attemptCount, 54);
    assert.equal(primary.activeSession.totalStaked, 720);
    assert.equal(primary.activeSession.nextStake, 30);
    assert.equal(primary.lifetime.totalBets, 54);
    assert.equal(primary.lifetime.totalStaked, 720);
  } finally {
    database.close();
  }
});

test("a one-stake bankroll exhausts after one miss and cannot place more paper bets", () => {
  const database = createDatabase({
    path: ":memory:",
    virtualStartingBalance: 10,
  });
  try {
    database.ingestBatch(virtualTriggerEvents("virtual-bankroll-exhaust"));
    let state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "armed");
    assert.equal(state.testBank.currentBalance, 10);

    database.ingestBatch([event(3, "virtual-bankroll-exhaust-miss", 201)]);
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "bankroll_exhausted");
    assert.equal(state.activeSession, null);
    assert.deepEqual(state.testBank, {
      mode: "simulation",
      status: "exhausted",
      initialBalance: 10,
      currentBalance: 0,
      netResult: -10,
      nextStake: 10,
      canAffordNext: false,
      shortfall: 10,
      startedAt: state.testBank.startedAt,
      exhaustedAt: "2026-09-21T00:03:21.000Z",
      dataComplete: true,
    });
    assert.equal(state.recentSessions[0].status, "completed");
    assert.equal(state.recentSessions[0].endReason, "bankroll_exhausted");
    assert.equal(state.recentSessions[0].attemptCount, 1);
    assert.equal(state.recentSessions[0].netResult, -10);

    const betCount = state.lifetime.totalBets;
    const sessionCount = state.lifetime.totalSessions;
    database.ingestBatch([
      event(1, "virtual-bankroll-exhaust-later-hit", 202),
      event(3, "virtual-bankroll-exhaust-later-miss", 203),
    ]);
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "bankroll_exhausted");
    assert.equal(state.testBank.currentBalance, 0);
    assert.equal(state.lifetime.totalBets, betCount);
    assert.equal(state.lifetime.totalSessions, sessionCount);
  } finally {
    database.close();
  }
});

test("the default 87700 bank funds 216 misses and attempt 217 exactly", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    database.ingestBatch(virtualTriggerEvents("virtual-bankroll-default-limit"));
    database.ingestBatch(
      Array.from({ length: 216 }, (_, index) =>
        event(
          3,
          `virtual-bankroll-default-limit-session-miss-${index}`,
          201 + index,
        ),
      ),
    );

    let state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "active");
    assert.equal(state.activeSession.attemptCount, 216);
    assert.equal(state.activeSession.totalStaked, 85_260);
    assert.equal(state.activeSession.nextStake, 2_440);
    assert.equal(state.testBank.currentBalance, 2_440);
    assert.equal(state.testBank.canAffordNext, true);

    database.ingestBatch([
      event(3, "virtual-bankroll-default-limit-session-miss-216", 417),
    ]);
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "bankroll_exhausted");
    assert.equal(state.testBank.currentBalance, 0);
    assert.equal(state.testBank.nextStake, 2_500);
    assert.equal(state.testBank.shortfall, 2_500);
    assert.equal(state.recentSessions[0].attemptCount, 217);
    assert.equal(state.recentSessions[0].totalStaked, 87_700);
    assert.equal(state.recentSessions[0].netResult, -87_700);
    assert.equal(state.recentSessions[0].endReason, "bankroll_exhausted");
  } finally {
    database.close();
  }
});

test("duplicate results never charge the virtual bankroll twice", () => {
  const database = createDatabase({
    path: ":memory:",
    virtualStartingBalance: 100,
  });
  try {
    database.ingestBatch(virtualTriggerEvents("virtual-bankroll-duplicate"));
    const next = event(3, "virtual-bankroll-duplicate-next", 201);
    database.ingestBatch([next]);
    const duplicate = database.ingestBatch([next]);
    const state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(duplicate.inserted, 0);
    assert.equal(duplicate.duplicates, 1);
    assert.equal(state.lifetime.totalBets, 1);
    assert.equal(state.testBank.currentBalance, 90);
  } finally {
    database.close();
  }
});

test("v7 paper history initializes v8 bankroll with all known net results exactly once", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-bankroll-v7-"));
  const path = join(directory, "paper-bankroll.sqlite");
  let database = createDatabase({ path });
  try {
    database.ingestBatch(virtualTriggerEvents("virtual-bankroll-migrate"));
    database.ingestBatch([
      ...Array.from({ length: 14 }, (_, index) =>
        event(3, `virtual-bankroll-migrate-next-miss-${index}`, 201 + index),
      ),
      event(1, "virtual-bankroll-migrate-hit", 215),
    ]);
    let state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.lifetime.netResult, 210);
    assert.equal(state.testBank.currentBalance, 87_910);
    database.close();

    const legacy = new DatabaseSync(path);
    try {
      legacy.exec(`
        DROP TABLE virtual_bankrolls;
        UPDATE virtual_bet_sessions SET end_reason = NULL;
        PRAGMA user_version = 7;
      `);
    } finally {
      legacy.close();
    }

    database = createDatabase({ path, virtualStartingBalance: 87_700 });
    state = database.initializeVirtualBettor(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(database.sqlite.prepare("PRAGMA user_version").get().user_version, 15);
    assert.equal(state.testBank.initialBalance, 87_700);
    assert.equal(state.testBank.currentBalance, 87_910);
    assert.equal(state.testBank.netResult, 210);
    assert.equal(state.recentSessions[0].endReason, "hit");
    assert.equal(
      database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM virtual_bankrolls")
        .get().count,
      1,
    );
    database.close();

    database = createDatabase({ path, virtualStartingBalance: 1 });
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.testBank.initialBalance, 87_700);
    assert.equal(state.testBank.currentBalance, 87_910);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("virtual bankroll persists across reopen and remains isolated per stream", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-bankroll-streams-"));
  const path = join(directory, "paper-bankroll.sqlite");
  let database = createDatabase({ path, virtualStartingBalance: 50 });
  try {
    database.ingestBatch(virtualTriggerEvents("virtual-bankroll-primary"));
    database.ingestBatch(
      virtualTriggerEvents("virtual-bankroll-other", 7, 8, {
        instrument: "OTHER",
      }),
    );
    database.ingestBatch([event(3, "virtual-bankroll-primary-miss", 201)]);
    database.ingestBatch([
      event(7, "virtual-bankroll-other-hit", 201, { instrument: "OTHER" }),
    ]);

    let primary = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    let other = database.getVirtualBettorState("buleto", "OTHER");
    assert.equal(primary.testBank.currentBalance, 40);
    assert.equal(other.testBank.currentBalance, 400);
    database.close();

    database = createDatabase({ path, virtualStartingBalance: 999 });
    primary = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    other = database.getVirtualBettorState("buleto", "OTHER");
    assert.equal(primary.testBank.initialBalance, 50);
    assert.equal(primary.testBank.currentBalance, 40);
    assert.equal(other.testBank.initialBalance, 50);
    assert.equal(other.testBank.currentBalance, 400);
    assert.equal(
      database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM virtual_bankrolls")
        .get().count,
      2,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
