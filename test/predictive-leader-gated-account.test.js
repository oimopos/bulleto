import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { createDatabase } from "../src/database.js";

const SOURCE = "buleto";
const INSTRUMENT = "PRIMECOIN(XPM)/RUB";
const BASE_TIME = Date.parse("2026-09-21T00:00:00.000Z");
const GATE_VERSION = "rolling-1000-wilson95-brier-v1";
const STRATEGY_VERSION = "quality-gated-fixed10-v1";
const LEADER_VERSION = "learned-predictive-family-index-v5";

function iso(offsetSeconds) {
  return new Date(BASE_TIME + offsetSeconds * 1_000).toISOString();
}

function event(resultNumber, fingerprint, offsetSeconds, externalRoundId) {
  return {
    source: SOURCE,
    instrument: INSTRUMENT,
    settledAt: iso(offsetSeconds),
    resultNumber,
    price: 5.4 + offsetSeconds / 10_000,
    observedAt: iso(offsetSeconds),
    fingerprint,
    rawPayload: { c: resultNumber },
    externalRoundId: String(externalRoundId),
  };
}

function precloseForecast(externalRoundId) {
  const lockedAt = iso(51);
  return {
    source: SOURCE,
    instrument: INSTRUMENT,
    externalRoundId: String(externalRoundId),
    horizonSeconds: 8,
    bettingClosesAt: iso(60),
    roundEndsAt: iso(100),
    factorAt: lockedAt,
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
        { dt: iso(47), v: 5.38 },
        { dt: iso(49), v: 5.39 },
        { dt: lockedAt, v: 5.4 },
      ],
      windowSeconds: 4,
      slopePerSecond: 0.005,
      secondsToEnd: 46,
    },
    modelVersion: "preclose-linear-v1",
  };
}

function seedReadyForecast(database, setClock, roundId = "107") {
  const history = [9, 4, 9, 4, 9, 5, 9];
  database.ingestBatch(history.map((number, index) => event(
    number,
    `gated-leader-history-${roundId}-${index}`,
    index,
    100 + index,
  )));
  database.sqlite.prepare(`
    UPDATE round_results
    SET created_at = observed_at
    WHERE fingerprint LIKE ?
  `).run(`gated-leader-history-${roundId}-%`);
  setClock(52);
  const outcome = database.recordPrecloseForecast(precloseForecast(roundId));
  assert.deepEqual(outcome, {
    inserted: true,
    databaseChanged: true,
    roundId: String(roundId),
  });
  const state = database.getPredictiveLeaderReadState(SOURCE, INSTRUMENT);
  assert.equal(state.precloseForecast.latest.predictiveLeader.status, "ready");
  return state.precloseForecast.latest;
}

function assertPristineSignalAccount(account) {
  assert.deepEqual(account, {
    schemaVersion: 1,
    strategyVersion: STRATEGY_VERSION,
    leaderAlgorithmVersion: LEADER_VERSION,
    gateVersion: GATE_VERSION,
    mode: "quality-gated-fixed-stake-simulation",
    executionEnabled: false,
    advisoryOnly: true,
    status: "waiting",
    reason: "waiting_first_eligible_signal",
    initialBalance: 1_000,
    currentBalance: 1_000,
    availableBalance: 1_000,
    reservedStake: 0,
    profit: 0,
    model: {
      fixedStake: 10,
      grossPayoutMultiplier: 36,
      payoutIncludesStake: true,
    },
    nextStake: 10,
    canAffordNext: true,
    shortfall: 0,
    betCount: 0,
    settledCount: 0,
    pendingCount: 0,
    voidCount: 0,
    hitCount: 0,
    missCount: 0,
    hitRate: null,
    totalStaked: 0,
    totalGrossPayout: 0,
    peakBalance: 1_000,
    minimumBalance: 1_000,
    maximumDrawdown: 0,
    continuityGapCount: 0,
    pendingBet: null,
    latestVoid: null,
    latestOutcome: null,
    startedAt: null,
    updatedAt: null,
    exhaustedAt: null,
  });
}

function promoteGateAndSeedPendingBet(database, forecast) {
  const row = database.sqlite.prepare(`
    SELECT snapshot_json
    FROM forecast_predictive_leader_quality_snapshots
    WHERE forecast_id = ?
  `).get(forecast.id);
  const gate = {
    ...JSON.parse(row.snapshot_json),
    status: "confirmed",
    reason: "quality_confirmed",
    eligible: true,
    sampleSize: 0,
    hitCount: 0,
    hitRate: null,
    lowerBound: null,
    upperBound: null,
    meanBrierLoss: null,
    brierDelta: null,
    windowStartForecastId: null,
    windowEndForecastId: null,
  };
  database.sqlite.prepare(`
    UPDATE forecast_predictive_leader_quality_snapshots
    SET status = 'confirmed', reason = 'quality_confirmed', eligible = 1,
        sample_size = 0, hit_count = 0, lower_bound = NULL,
        mean_brier_loss = NULL, window_start_forecast_id = NULL,
        window_end_forecast_id = NULL, snapshot_json = ?
    WHERE forecast_id = ?
  `).run(JSON.stringify(gate), forecast.id);

  const continuityEpoch = Number(database.sqlite.prepare(`
    SELECT continuity_epoch
    FROM stream_state
    WHERE source = ? AND instrument = ?
  `).get(SOURCE, INSTRUMENT).continuity_epoch);
  database.sqlite.prepare(`
    INSERT INTO predictive_leader_gated_fixed_bets (
      forecast_id, source, instrument, schema_version, strategy_version,
      leader_algorithm_version, gate_version, continuity_epoch,
      target_number, stake, balance_before, status, placed_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 10, 1000, 'pending', ?, ?)
  `).run(
    forecast.id,
    SOURCE,
    INSTRUMENT,
    STRATEGY_VERSION,
    LEADER_VERSION,
    GATE_VERSION,
    continuityEpoch,
    forecast.predictiveLeader.leaderNumber,
    iso(52),
    iso(52),
  );
}

test("v26 creates gated tables without backfilling historical leader rows", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-gated-v26-"));
  const path = join(directory, "tracker.sqlite");
  let clockOffset = 10;
  let database = createDatabase({
    path,
    clock: () => new Date(BASE_TIME + clockOffset * 1_000),
    predictiveLeaderLegacyAccountEnabled: false,
  });
  try {
    seedReadyForecast(database, (offset) => { clockOffset = offset; });
    assert.equal(
      database.sqlite.prepare(`
        SELECT COUNT(*) AS count FROM forecast_predictive_leader_snapshots
      `).get().count,
      1,
    );
    database.close();

    const oldDatabase = new DatabaseSync(path);
    oldDatabase.exec(`
      DROP TABLE predictive_leader_gated_fixed_bets;
      DROP TABLE forecast_predictive_leader_evaluation_voids;
      DROP TABLE forecast_predictive_leader_quality_snapshots;
      PRAGMA user_version = 25;
    `);
    oldDatabase.close();

    database = createDatabase({
      path,
      clock: () => new Date(BASE_TIME + clockOffset * 1_000),
      predictiveLeaderLegacyAccountEnabled: false,
    });
    assert.equal(database.sqlite.prepare("PRAGMA user_version").get().user_version, 31);
    const tables = database.sqlite.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN (
        'forecast_predictive_leader_quality_snapshots',
        'forecast_predictive_leader_evaluation_voids',
        'predictive_leader_gated_fixed_bets'
      )
      ORDER BY name
    `).all().map(({ name }) => name);
    assert.deepEqual(tables, [
      "forecast_predictive_leader_evaluation_voids",
      "forecast_predictive_leader_quality_snapshots",
      "predictive_leader_gated_fixed_bets",
    ]);
    assert.equal(
      database.sqlite.prepare(`
        SELECT COUNT(*) AS count FROM forecast_predictive_leader_quality_snapshots
      `).get().count,
      0,
      "migration must not manufacture quality decisions for past forecasts",
    );
    assert.equal(
      database.sqlite.prepare(`
        SELECT COUNT(*) AS count
        FROM forecast_predictive_leader_evaluation_voids
      `).get().count,
      0,
      "migration must not void historical forecasts without a causal gap",
    );
    assert.equal(
      database.sqlite.prepare(`
        SELECT COUNT(*) AS count FROM predictive_leader_gated_fixed_bets
      `).get().count,
      0,
      "migration must not manufacture historical bets",
    );
    assertPristineSignalAccount(database.getPredictiveLeaderSignalAccount(
      SOURCE,
      INSTRUMENT,
    ));
  } finally {
    if (!database.closed) database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a fresh ready forecast freezes a collecting gate and cannot place a default bet", () => {
  let clockOffset = 10;
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(BASE_TIME + clockOffset * 1_000),
    predictiveLeaderLegacyAccountEnabled: false,
  });
  try {
    const forecast = seedReadyForecast(database, (offset) => { clockOffset = offset; });
    const gate = forecast.predictiveLeaderQualityGate;
    assert.equal(gate.version, GATE_VERSION);
    assert.equal(gate.evaluatedForForecastId, forecast.id);
    assert.equal(gate.cutoffAt, forecast.lockedAt);
    assert.equal(gate.status, "collecting");
    assert.equal(gate.reason, "insufficient_sample");
    assert.equal(gate.eligible, false);
    assert.equal(gate.windowSize, 1_000);
    assert.equal(gate.sampleSize, 0);
    assert.equal(gate.hitCount, 0);
    assert.equal(gate.windowStartForecastId, null);
    assert.equal(gate.windowEndForecastId, null);
    assert.match(gate.evidenceDigest, /^[a-f0-9]{64}$/);

    const stored = database.sqlite.prepare(`
      SELECT status, reason, eligible, sample_size, snapshot_json
      FROM forecast_predictive_leader_quality_snapshots
      WHERE forecast_id = ?
    `).get(forecast.id);
    assert.deepEqual(
      {
        status: stored.status,
        reason: stored.reason,
        eligible: Number(stored.eligible),
        sampleSize: Number(stored.sample_size),
      },
      {
        status: "collecting",
        reason: "insufficient_sample",
        eligible: 0,
        sampleSize: 0,
      },
    );
    assert.deepEqual(JSON.parse(stored.snapshot_json), gate);
    assert.equal(
      database.sqlite.prepare(`
        SELECT COUNT(*) AS count FROM predictive_leader_gated_fixed_bets
      `).get().count,
      0,
    );
    assertPristineSignalAccount(database.getPredictiveLeaderSignalAccount(
      SOURCE,
      INSTRUMENT,
    ));

    const frozenJson = stored.snapshot_json;
    assert.deepEqual(database.recordPrecloseForecast(precloseForecast("107")), {
      inserted: false,
      databaseChanged: false,
      roundId: "107",
    });
    assert.equal(
      database.sqlite.prepare(`
        SELECT snapshot_json
        FROM forecast_predictive_leader_quality_snapshots
        WHERE forecast_id = ?
      `).get(forecast.id).snapshot_json,
      frozenJson,
      "an idempotent forecast write must not recompute its frozen gate",
    );
  } finally {
    database.close();
  }
});

test("quality gate rolls by the latest forecast facts, not late result ids", () => {
  let clockOffset = 10;
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(BASE_TIME + clockOffset * 1_000),
    predictiveLeaderLegacyAccountEnabled: false,
  });
  try {
    const templateForecast = seedReadyForecast(
      database,
      (offset) => { clockOffset = offset; },
      "107",
    );
    const templateLeader = database.sqlite.prepare(`
      SELECT * FROM forecast_predictive_leader_snapshots WHERE forecast_id = ?
    `).get(templateForecast.id);
    const historicalLockedAt = iso(10);
    const historicalCreatedAt = iso(11);
    const resultAt = iso(20);
    const insertSnapshot = database.sqlite.prepare(`
      INSERT INTO forecast_snapshots (
        source, instrument, external_round_id, horizon_seconds,
        betting_closes_at, round_ends_at, factor_at, locked_at,
        lead_time_ms, persisted_at, persisted_lead_time_ms,
        current_price, start_price, current_number, cells_json,
        features_json, created_at
      ) VALUES (?, ?, ?, 8, ?, ?, ?, ?, 20000, ?, 19000,
        5.4, 5.35, 11, '[]', '{}', ?)
    `);
    const insertForecast = database.sqlite.prepare(`
      INSERT INTO round_forecasts (
        snapshot_id, model_version, predicted_price, predicted_number,
        ranked_numbers_json, created_at
      ) VALUES (?, 'preclose-linear-v1', 5.41, 7, '[7,11,19]', ?)
    `);
    const insertLeader = database.sqlite.prepare(`
      INSERT INTO forecast_predictive_leader_snapshots (
        forecast_id, schema_version, algorithm_version, status, locked_at,
        history_max_result_id, training_through_forecast_id,
        training_through_result_id, training_count, predicted_number, score,
        snapshot_json, created_at
      ) VALUES (?, ?, ?, 'ready', ?, NULL, NULL, NULL, ?, ?, ?, ?, ?)
    `);
    const insertResult = database.sqlite.prepare(`
      INSERT INTO round_results (
        source, instrument, settled_at, result_number, price, observed_at,
        external_round_id, raw_cell, fingerprint, raw_payload,
        continuity_epoch, created_at
      ) VALUES (?, ?, ?, ?, 5.4, ?, ?, ?, ?, '{}', 0, ?)
    `);
    const insertSettlement = database.sqlite.prepare(`
      INSERT INTO forecast_settlements (
        forecast_id, round_result_id, actual_number, settled_at,
        top1_hit, top3_hit, current_cell_hit, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `);
    const insertMetric = database.sqlite.prepare(`
      INSERT OR REPLACE INTO forecast_predictive_leader_metric_facts (
        forecast_id, metric_version, ready_count, settled_count,
        top1_hits, top3_hits, combined_brier_loss
      ) VALUES (?, 'learned-leader-v1/metrics-v1', 1, 1, ?, ?, ?)
    `);
    const forecastIds = [];
    database.sqlite.exec("BEGIN IMMEDIATE");
    try {
      for (let index = 0; index < 1_001; index += 1) {
        const externalRoundId = `rolling-history-${index}`;
        const snapshotId = Number(insertSnapshot.run(
          SOURCE,
          INSTRUMENT,
          externalRoundId,
          iso(30),
          iso(40),
          historicalLockedAt,
          historicalLockedAt,
          historicalCreatedAt,
          historicalCreatedAt,
        ).lastInsertRowid);
        const forecastId = Number(insertForecast.run(
          snapshotId,
          historicalCreatedAt,
        ).lastInsertRowid);
        const decision = JSON.parse(templateLeader.snapshot_json);
        decision.lockedAt = historicalLockedAt;
        insertLeader.run(
          forecastId,
          Number(templateLeader.schema_version),
          templateLeader.algorithm_version,
          historicalLockedAt,
          Number(templateLeader.training_count),
          Number(templateLeader.predicted_number),
          Number(templateLeader.score),
          JSON.stringify(decision),
          historicalCreatedAt,
        );
        forecastIds.push(forecastId);
      }

      const resultOrder = [...forecastIds.slice(1), forecastIds[0]];
      for (const forecastId of resultOrder) {
        const isLateLowForecast = forecastId === forecastIds[0];
        const hit = !isLateLowForecast
          && forecastId >= forecastIds[1]
          && forecastId < forecastIds[1] + 38;
        const resultNumber = hit ? 7 : 8;
        const externalRoundId = `rolling-history-${forecastId - forecastIds[0]}`;
        const resultId = Number(insertResult.run(
          SOURCE,
          INSTRUMENT,
          resultAt,
          resultNumber,
          resultAt,
          externalRoundId,
          resultNumber,
          `rolling-result-${forecastId}`,
          resultAt,
        ).lastInsertRowid);
        insertSettlement.run(
          forecastId,
          resultId,
          resultNumber,
          resultAt,
          Number(hit),
          Number(hit),
          resultAt,
        );
        insertMetric.run(
          forecastId,
          Number(hit),
          Number(hit),
          isLateLowForecast ? 2 : 0.4,
        );
      }
      database.sqlite.prepare(`
        DELETE FROM forecast_predictive_leader_metric_dirty
        WHERE forecast_id >= ?
      `).run(forecastIds[0]);
      database.sqlite.exec("COMMIT");
    } catch (error) {
      database.sqlite.exec("ROLLBACK");
      throw error;
    }

    const outcome = database.recordPrecloseForecast(
      precloseForecast("rolling-window-current"),
    );
    assert.equal(outcome.inserted, true);
    const current = database.sqlite.prepare(`
      SELECT forecasts.id
      FROM round_forecasts AS forecasts
      JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
      WHERE snapshots.external_round_id = 'rolling-window-current'
    `).get();
    const gate = JSON.parse(database.sqlite.prepare(`
      SELECT snapshot_json
      FROM forecast_predictive_leader_quality_snapshots
      WHERE forecast_id = ?
    `).get(Number(current.id)).snapshot_json);
    assert.equal(gate.status, "rejected");
    assert.equal(gate.reason, "current_family_count_not_two");
    assert.equal(gate.sampleSize, 1_000);
    assert.equal(gate.hitCount, 38);
    assert.equal(gate.windowStartForecastId, forecastIds[1]);
    assert.equal(gate.windowEndForecastId, forecastIds.at(-1));
    assert.ok(gate.windowEndForecastId < Number(current.id));
    assert.notEqual(gate.windowStartForecastId, forecastIds[0]);
    assert.throws(
      () => database.sqlite.prepare(`
        UPDATE forecast_predictive_leader_quality_snapshots
        SET window_end_forecast_id = forecast_id
        WHERE forecast_id = ?
      `).run(Number(current.id)),
      /quality window|CHECK constraint failed/,
    );

    database.sqlite.prepare(`
      UPDATE forecast_predictive_leader_metric_facts
      SET combined_brier_loss = 2
      WHERE forecast_id = ?
    `).run(forecastIds.at(-1));
    database.sqlite.prepare(`
      DELETE FROM forecast_predictive_leader_metric_dirty
      WHERE forecast_id = ?
    `).run(forecastIds.at(-1));
    assert.equal(
      database.recordPrecloseForecast(
        precloseForecast("rolling-window-invalid-evidence"),
      ).inserted,
      true,
    );
    const invalidGate = database.getPredictiveLeaderReadState(
      SOURCE,
      INSTRUMENT,
    ).precloseForecast.latest.predictiveLeaderQualityGate;
    assert.equal(invalidGate.status, "invalid");
    assert.equal(invalidGate.reason, "malformed_facts");
    assert.equal(invalidGate.sampleSize, 0);
    assert.equal(invalidGate.throughResultId, null);
  } finally {
    database.close();
  }
});

test("a fixed gated bet settles once and survives reopen", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-gated-settle-"));
  const path = join(directory, "tracker.sqlite");
  let clockOffset = 10;
  let database = createDatabase({
    path,
    clock: () => new Date(BASE_TIME + clockOffset * 1_000),
    predictiveLeaderLegacyAccountEnabled: false,
  });
  try {
    const forecast = seedReadyForecast(database, (offset) => { clockOffset = offset; });
    promoteGateAndSeedPendingBet(database, forecast);
    assert.equal(database.getPredictiveLeaderSignalAccount(SOURCE, INSTRUMENT).status, "pending");

    clockOffset = 101;
    const target = forecast.predictiveLeader.leaderNumber;
    database.ingestBatch([
      event(target, "gated-settlement-result", 100, "107"),
    ]);
    assert.equal(database.settlePrecloseForecasts(SOURCE, INSTRUMENT).settled, 1);
    assert.deepEqual(database.settlePredictiveLeaderSignalAccount(SOURCE, INSTRUMENT), {
      settled: 1,
      voided: 0,
    });
    assert.deepEqual(database.settlePredictiveLeaderSignalAccount(SOURCE, INSTRUMENT), {
      settled: 0,
      voided: 0,
    });
    const settled = database.getPredictiveLeaderSignalAccount(SOURCE, INSTRUMENT);
    assert.equal(settled.currentBalance, 1_350);
    assert.equal(settled.settledCount, 1);
    assert.equal(settled.hitCount, 1);
    assert.equal(settled.totalStaked, 10);
    assert.equal(settled.totalGrossPayout, 360);

    database.close();
    database = createDatabase({
      path,
      clock: () => new Date(BASE_TIME + clockOffset * 1_000),
      predictiveLeaderLegacyAccountEnabled: false,
    });
    assert.deepEqual(
      database.getPredictiveLeaderSignalAccount(SOURCE, INSTRUMENT),
      settled,
    );
    assert.deepEqual(database.settlePredictiveLeaderSignalAccount(SOURCE, INSTRUMENT), {
      settled: 0,
      voided: 0,
    });
  } finally {
    if (!database.closed) database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an unresolved fixed gated bet voids once at a gap and survives reopen", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-gated-void-"));
  const path = join(directory, "tracker.sqlite");
  let clockOffset = 10;
  let database = createDatabase({
    path,
    clock: () => new Date(BASE_TIME + clockOffset * 1_000),
    predictiveLeaderLegacyAccountEnabled: false,
  });
  try {
    const forecast = seedReadyForecast(database, (offset) => { clockOffset = offset; });
    promoteGateAndSeedPendingBet(database, forecast);

    clockOffset = 101;
    database.markGap({
      source: SOURCE,
      instrument: INSTRUMENT,
      incidentKey: "gated-fixed-account-gap",
      detectedAt: iso(101),
      reason: "missing-target-round",
    });
    assert.deepEqual(database.settlePredictiveLeaderSignalAccount(SOURCE, INSTRUMENT), {
      settled: 0,
      voided: 1,
    });
    assert.deepEqual(database.settlePredictiveLeaderSignalAccount(SOURCE, INSTRUMENT), {
      settled: 0,
      voided: 0,
    });
    const voided = database.getPredictiveLeaderSignalAccount(SOURCE, INSTRUMENT);
    assert.equal(voided.currentBalance, 1_000);
    assert.equal(voided.pendingCount, 0);
    assert.equal(voided.voidCount, 1);
    assert.equal(voided.latestVoid.forecastId, forecast.id);
    assert.equal(voided.latestVoid.reason, "integrity_gap");

    database.close();
    database = createDatabase({
      path,
      clock: () => new Date(BASE_TIME + clockOffset * 1_000),
      predictiveLeaderLegacyAccountEnabled: false,
    });
    assert.deepEqual(
      database.getPredictiveLeaderSignalAccount(SOURCE, INSTRUMENT),
      voided,
    );
    assert.deepEqual(database.settlePredictiveLeaderSignalAccount(SOURCE, INSTRUMENT), {
      settled: 0,
      voided: 0,
    });
  } finally {
    if (!database.closed) database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a gap voids unresolved leader metrics even when quality placed no bet", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-gated-metric-void-"));
  const path = join(directory, "tracker.sqlite");
  let clockOffset = 10;
  let database = createDatabase({
    path,
    clock: () => new Date(BASE_TIME + clockOffset * 1_000),
    predictiveLeaderLegacyAccountEnabled: false,
  });
  try {
    const forecast = seedReadyForecast(database, (offset) => { clockOffset = offset; });
    assert.equal(
      database.sqlite.prepare(`
        SELECT COUNT(*) AS count FROM predictive_leader_gated_fixed_bets
      `).get().count,
      0,
    );
    let metrics = database.getPredictiveLeaderReadState(SOURCE, INSTRUMENT)
      .precloseForecast.predictiveLeaderMetrics;
    assert.equal(metrics.readyCount, 1);
    assert.equal(metrics.settledCount, 0);
    assert.equal(metrics.pendingCount, 1);

    const gap = database.markGap({
      source: SOURCE,
      instrument: INSTRUMENT,
      incidentKey: "quality-rejected-forecast-gap",
      detectedAt: iso(101),
      reason: "missing-target-round",
    });
    const evaluationVoid = database.sqlite.prepare(`
      SELECT *
      FROM forecast_predictive_leader_evaluation_voids
      WHERE forecast_id = ?
    `).get(forecast.id);
    assert.equal(Number(evaluationVoid.incident_id), gap.id);
    assert.equal(Number(evaluationVoid.void_continuity_epoch), 1);
    assert.equal(evaluationVoid.reason, "integrity_gap");

    metrics = database.getPredictiveLeaderReadState(SOURCE, INSTRUMENT)
      .precloseForecast.predictiveLeaderMetrics;
    assert.equal(metrics.readyCount, 0);
    assert.equal(metrics.settledCount, 0);
    assert.equal(metrics.pendingCount, 0);
    assert.equal(metrics.readyCount, metrics.settledCount + metrics.pendingCount);

    database.markGap({
      source: SOURCE,
      instrument: INSTRUMENT,
      incidentKey: "quality-rejected-forecast-gap",
      detectedAt: iso(101),
      reason: "missing-target-round",
    });
    assert.equal(
      database.sqlite.prepare(`
        SELECT COUNT(*) AS count
        FROM forecast_predictive_leader_evaluation_voids
        WHERE forecast_id = ?
      `).get(forecast.id).count,
      1,
    );

    database.sqlite.exec(`
      DROP TABLE forecast_predictive_leader_evaluation_voids;
      PRAGMA user_version = 25;
    `);
    database.close();
    database = createDatabase({
      path,
      clock: () => new Date(BASE_TIME + clockOffset * 1_000),
      predictiveLeaderLegacyAccountEnabled: false,
    });
    metrics = database.getPredictiveLeaderReadState(SOURCE, INSTRUMENT)
      .precloseForecast.predictiveLeaderMetrics;
    assert.equal(
      database.sqlite.prepare(`
        SELECT COUNT(*) AS count
        FROM forecast_predictive_leader_evaluation_voids
        WHERE forecast_id = ?
      `).get(forecast.id).count,
      1,
      "v26 migration must reconstruct the causal void audit from the gap",
    );
    assert.equal(metrics.readyCount, 0);
    assert.equal(metrics.pendingCount, 0);
  } finally {
    if (!database.closed) database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a signal result committed with a leading gap settles instead of voiding", () => {
  let clockOffset = 10;
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(BASE_TIME + clockOffset * 1_000),
    predictiveLeaderLegacyAccountEnabled: false,
  });
  try {
    const forecast = seedReadyForecast(database, (offset) => { clockOffset = offset; });
    promoteGateAndSeedPendingBet(database, forecast);
    clockOffset = 101;
    database.ingestBatchAfterGap(
      {
        source: SOURCE,
        instrument: INSTRUMENT,
        incidentKey: "gated-leading-gap-with-target",
        detectedAt: iso(100.5),
        reason: "restart-boundary",
      },
      [event(
        forecast.predictiveLeader.leaderNumber,
        "gated-leading-gap-target",
        100,
        "107",
      )],
    );
    assert.equal(
      database.sqlite.prepare(`
        SELECT COUNT(*) AS count
        FROM forecast_predictive_leader_evaluation_voids
        WHERE forecast_id = ?
      `).get(forecast.id).count,
      0,
      "the exact committed target must keep the evaluation resolvable",
    );
    assert.deepEqual(database.settlePredictiveLeaderSignalAccount(SOURCE, INSTRUMENT), {
      settled: 0,
      voided: 0,
    });
    assert.equal(
      database.sqlite.prepare(`
        SELECT status FROM predictive_leader_gated_fixed_bets WHERE forecast_id = ?
      `).get(forecast.id).status,
      "pending",
    );

    assert.equal(database.settlePrecloseForecasts(SOURCE, INSTRUMENT).settled, 1);
    assert.deepEqual(database.settlePredictiveLeaderSignalAccount(SOURCE, INSTRUMENT), {
      settled: 1,
      voided: 0,
    });
    const account = database.getPredictiveLeaderSignalAccount(SOURCE, INSTRUMENT);
    assert.equal(account.status, "waiting");
    assert.equal(account.settledCount, 1);
    assert.equal(account.voidCount, 0);
    assert.equal(account.currentBalance, 1_350);
  } finally {
    database.close();
  }
});
