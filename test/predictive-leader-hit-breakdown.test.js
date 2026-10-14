import assert from "node:assert/strict";
import test from "node:test";

import { createDatabase } from "../src/database.js";
import {
  LEARNED_LEADER_ALGORITHM_VERSION,
  LEARNED_LEADER_SCHEMA_VERSION,
  buildLearnedLeaderDecision,
} from "../src/learned-leader.js";

const BASE_TIME = Date.parse("2026-10-14T00:00:00.000Z");
const SOURCE = "buleto";
const INSTRUMENT = "XPM/RUB";

function iso(offsetSeconds) {
  return new Date(BASE_TIME + offsetSeconds * 1_000).toISOString();
}

function insertResult(database, {
  instrument = INSTRUMENT,
  externalRoundId,
  number,
  settledAt,
}) {
  const insertion = database.sqlite
    .prepare(`
      INSERT INTO round_results (
        source, instrument, settled_at, result_number, price, observed_at,
        external_round_id, raw_cell, fingerprint, raw_payload,
        continuity_epoch, created_at
      ) VALUES (?, ?, ?, ?, 5.4, ?, ?, ?, ?, ?, 0, ?)
    `)
    .run(
      SOURCE,
      instrument,
      settledAt,
      number,
      settledAt,
      externalRoundId,
      number,
      `result:${instrument}:${externalRoundId}`,
      JSON.stringify({ c: number }),
      settledAt,
    );
  return Number(insertion.lastInsertRowid);
}

function insertLeaderForecast(database, {
  index,
  predictedNumber = null,
  actualNumber = null,
  horizonSeconds = 8,
  instrument = INSTRUMENT,
  historyResultId,
  corrupt = false,
}) {
  const externalRoundId = `leader-breakdown-${instrument}-${index}`;
  const lockedAt = iso(100 + index * 100);
  const persistedAt = iso(101 + index * 100);
  const bettingClosesAt = iso(110 + index * 100);
  const roundEndsAt = iso(130 + index * 100);
  const snapshot = database.sqlite
    .prepare(`
      INSERT INTO forecast_snapshots (
        source, instrument, external_round_id, horizon_seconds,
        betting_closes_at, round_ends_at, factor_at, locked_at,
        lead_time_ms, persisted_at, persisted_lead_time_ms,
        current_price, start_price, current_number,
        cells_json, features_json, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, 10000, ?, 9000,
        5.4, 5.35, 11, '[]', '{}', ?
      )
    `)
    .run(
      SOURCE,
      instrument,
      externalRoundId,
      horizonSeconds,
      bettingClosesAt,
      roundEndsAt,
      lockedAt,
      lockedAt,
      persistedAt,
      persistedAt,
    );
  const forecast = database.sqlite
    .prepare(`
      INSERT INTO round_forecasts (
        snapshot_id, model_version, predicted_price, predicted_number,
        ranked_numbers_json, created_at
      ) VALUES (?, 'fixture-v1', 5.4, ?, ?, ?)
    `)
    .run(
      Number(snapshot.lastInsertRowid),
      predictedNumber ?? 0,
      JSON.stringify([predictedNumber ?? 0, 1, 2]),
      persistedAt,
    );
  const forecastId = Number(forecast.lastInsertRowid);
  const decision = buildLearnedLeaderDecision({
    sources: predictedNumber === null
      ? []
      : [{
          id: `conditional-fixture-${index}`,
          family: "conditional-history",
          numbers: [predictedNumber],
          weights: [1],
          cursor: {
            historyMaxResultId: historyResultId,
            cutoffAt: lockedAt,
          },
        }],
    learningRows: [],
    lockedAt,
    tieSeed: externalRoundId,
  });
  database.sqlite
    .prepare(`
      INSERT INTO forecast_predictive_leader_snapshots (
        forecast_id, schema_version, algorithm_version, status, locked_at,
        history_max_result_id, training_through_forecast_id,
        training_through_result_id, training_count, predicted_number,
        score, snapshot_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?, ?, ?)
    `)
    .run(
      forecastId,
      LEARNED_LEADER_SCHEMA_VERSION,
      LEARNED_LEADER_ALGORITHM_VERSION,
      decision.status,
      lockedAt,
      predictedNumber === null ? null : historyResultId,
      decision.leaderNumber,
      decision.leaderMass,
      JSON.stringify(decision),
      persistedAt,
    );

  if (actualNumber !== null) {
    settleLeaderForecast(database, {
      forecastId,
      externalRoundId,
      predictedNumber,
      actualNumber,
      instrument,
      settledAt: iso(140 + index * 100),
    });
  }

  if (corrupt) {
    database.sqlite.exec("PRAGMA ignore_check_constraints = ON");
    try {
      database.sqlite
        .prepare(`
          UPDATE forecast_predictive_leader_snapshots
          SET snapshot_json = json_set(
            snapshot_json,
            '$.leaderNumber',
            CASE predicted_number WHEN 36 THEN 35 ELSE predicted_number + 1 END
          )
          WHERE forecast_id = ?
        `)
        .run(forecastId);
    } finally {
      database.sqlite.exec("PRAGMA ignore_check_constraints = OFF");
    }
  }
  return forecastId;
}

function settleLeaderForecast(database, {
  forecastId,
  externalRoundId,
  predictedNumber,
  actualNumber,
  instrument = INSTRUMENT,
  settledAt,
}) {
  const resultId = insertResult(database, {
    instrument,
    externalRoundId,
    number: actualNumber,
    settledAt,
  });
  const hit = Number(predictedNumber === actualNumber);
  database.sqlite
    .prepare(`
      INSERT INTO forecast_settlements (
        forecast_id, round_result_id, actual_number, settled_at,
        top1_hit, top3_hit, current_cell_hit, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `)
    .run(forecastId, resultId, actualNumber, settledAt, hit, hit, settledAt);
}

test("predictive leader hit breakdown is empty, complete, and JSON-safe", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const breakdown = database.getPredictiveLeaderHitBreakdown(SOURCE, INSTRUMENT);
    assert.equal(breakdown.integrity.status, "ok");
    assert.equal(breakdown.integrity.storedCount, 0);
    assert.deepEqual(breakdown.horizonSeconds, []);
    assert.deepEqual(breakdown.totals, {
      settledCount: 0,
      hitCount: 0,
      missCount: 0,
      hitRate: null,
      hitRateWilson95: null,
    });
    assert.equal(breakdown.items.length, 37);
    assert.deepEqual(
      [...breakdown.items].sort((left, right) => left.number - right.number)
        .map(({ number, predictionCount, actualCount, hitCount }) => ({
          number,
          predictionCount,
          actualCount,
          hitCount,
        })),
      Array.from({ length: 37 }, (_, number) => ({
        number,
        predictionCount: 0,
        actualCount: 0,
        hitCount: 0,
      })),
    );
    assert.doesNotThrow(() => JSON.stringify(breakdown));
  } finally {
    database.close();
  }
});

test("predictive leader hit breakdown ranks valid settled V5 hits without mutating history", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const historyResultId = insertResult(database, {
      externalRoundId: "leader-breakdown-history",
      number: 9,
      settledAt: iso(0),
    });
    const delayedForecastId = insertLeaderForecast(database, {
      index: -1,
      predictedNumber: 6,
      actualNumber: 6,
      horizonSeconds: 8,
      historyResultId,
    });
    const delayedLeaderRow = database.sqlite
      .prepare(`
        SELECT *
        FROM forecast_predictive_leader_snapshots
        WHERE forecast_id = ?
      `)
      .get(delayedForecastId);
    database.sqlite
      .prepare("DELETE FROM forecast_predictive_leader_snapshots WHERE forecast_id = ?")
      .run(delayedForecastId);
    const fixtures = [
      { predictedNumber: 4, actualNumber: 4, horizonSeconds: 8 },
      { predictedNumber: 4, actualNumber: 4, horizonSeconds: 12 },
      { predictedNumber: 4, actualNumber: 7, horizonSeconds: 8 },
      { predictedNumber: 7, actualNumber: 7, horizonSeconds: 12 },
      { predictedNumber: 7, actualNumber: 9, horizonSeconds: 8 },
      { predictedNumber: 12, actualNumber: 3, horizonSeconds: 12 },
      { predictedNumber: 12, actualNumber: null, horizonSeconds: 8 },
      { predictedNumber: null, actualNumber: null, horizonSeconds: 15 },
      { predictedNumber: 20, actualNumber: 20, horizonSeconds: 8, corrupt: true },
    ];
    const forecastIds = fixtures.map((fixture, index) => insertLeaderForecast(database, {
      index,
      historyResultId,
      ...fixture,
    }));
    insertLeaderForecast(database, {
      index: 20,
      predictedNumber: 30,
      actualNumber: 30,
      horizonSeconds: 8,
      instrument: "OTHER/RUB",
      historyResultId,
    });

    const before = database.sqlite
      .prepare(`
        SELECT forecast_id, snapshot_json
        FROM forecast_predictive_leader_snapshots
        ORDER BY forecast_id
      `)
      .all();
    const breakdown = database.getPredictiveLeaderHitBreakdown(SOURCE, INSTRUMENT);
    const byNumber = new Map(breakdown.items.map((item) => [item.number, item]));

    assert.equal(breakdown.schemaVersion, 1);
    assert.equal(breakdown.algorithmVersion, LEARNED_LEADER_ALGORITHM_VERSION);
    assert.equal(breakdown.scope, "all-valid-settled-v5-forecasts");
    assert.deepEqual(breakdown.horizonSeconds, [8, 12]);
    assert.deepEqual(breakdown.integrity, {
      status: "degraded",
      storedCount: 9,
      validCount: 8,
      invalidCount: 1,
      readyCount: 7,
      unavailableCount: 1,
      settledCount: 6,
      pendingCount: 1,
    });
    assert.equal(breakdown.totals.settledCount, 6);
    assert.equal(breakdown.totals.hitCount, 3);
    assert.equal(breakdown.totals.missCount, 3);
    assert.equal(breakdown.totals.hitRate, 0.5);
    assert.equal(breakdown.items[0].number, 4);
    assert.equal(breakdown.items[1].number, 7);
    assert.deepEqual(
      {
        predictionCount: byNumber.get(4).predictionCount,
        actualCount: byNumber.get(4).actualCount,
        hitCount: byNumber.get(4).hitCount,
        missCount: byNumber.get(4).missCount,
        hitRateWhenPredicted: byNumber.get(4).hitRateWhenPredicted,
        recognitionRateWhenActual: byNumber.get(4).recognitionRateWhenActual,
      },
      {
        predictionCount: 3,
        actualCount: 2,
        hitCount: 2,
        missCount: 1,
        hitRateWhenPredicted: 2 / 3,
        recognitionRateWhenActual: 1,
      },
    );
    assert.deepEqual(
      {
        predictionCount: byNumber.get(7).predictionCount,
        actualCount: byNumber.get(7).actualCount,
        hitCount: byNumber.get(7).hitCount,
        hitRateWhenPredicted: byNumber.get(7).hitRateWhenPredicted,
        recognitionRateWhenActual: byNumber.get(7).recognitionRateWhenActual,
      },
      {
        predictionCount: 2,
        actualCount: 2,
        hitCount: 1,
        hitRateWhenPredicted: 0.5,
        recognitionRateWhenActual: 0.5,
      },
    );
    assert.equal(byNumber.get(12).predictionCount, 1, "pending is excluded");
    assert.equal(byNumber.get(20).predictionCount, 0, "corrupt rows fail closed");
    assert.equal(byNumber.get(30).predictionCount, 0, "other streams are excluded");
    assert.equal(
      breakdown.items.reduce((total, item) => total + item.predictionCount, 0),
      breakdown.totals.settledCount,
    );
    assert.equal(
      breakdown.items.reduce((total, item) => total + item.actualCount, 0),
      breakdown.totals.settledCount,
    );
    assert.equal(
      breakdown.items.reduce((total, item) => total + item.hitCount, 0),
      breakdown.totals.hitCount,
    );
    assert.deepEqual(
      database.sqlite
        .prepare(`
          SELECT forecast_id, snapshot_json
          FROM forecast_predictive_leader_snapshots
          ORDER BY forecast_id
        `)
        .all(),
      before,
      "the breakdown must not rewrite frozen leader history",
    );

    settleLeaderForecast(database, {
      forecastId: forecastIds[6],
      externalRoundId: `leader-breakdown-${INSTRUMENT}-6`,
      predictedNumber: 12,
      actualNumber: 12,
      settledAt: iso(740),
    });
    database.sqlite
      .prepare(`
        INSERT INTO forecast_predictive_leader_snapshots (
          forecast_id, schema_version, algorithm_version, status, locked_at,
          history_max_result_id, training_through_forecast_id,
          training_through_result_id, training_count, predicted_number,
          score, snapshot_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        delayedLeaderRow.forecast_id,
        delayedLeaderRow.schema_version,
        delayedLeaderRow.algorithm_version,
        delayedLeaderRow.status,
        delayedLeaderRow.locked_at,
        delayedLeaderRow.history_max_result_id,
        delayedLeaderRow.training_through_forecast_id,
        delayedLeaderRow.training_through_result_id,
        delayedLeaderRow.training_count,
        delayedLeaderRow.predicted_number,
        delayedLeaderRow.score,
        delayedLeaderRow.snapshot_json,
        delayedLeaderRow.created_at,
      );
    const afterPendingSettlement = database.getPredictiveLeaderHitBreakdown(
      SOURCE,
      INSTRUMENT,
    );
    const refreshedTwelve = afterPendingSettlement.items.find(({ number }) => number === 12);
    assert.equal(afterPendingSettlement.integrity.storedCount, 10);
    assert.equal(afterPendingSettlement.integrity.settledCount, 8);
    assert.equal(afterPendingSettlement.integrity.pendingCount, 0);
    assert.equal(afterPendingSettlement.totals.hitCount, 5);
    assert.equal(afterPendingSettlement.period.lastForecastId, forecastIds[6]);
    assert.equal(refreshedTwelve.predictionCount, 2);
    assert.equal(refreshedTwelve.hitCount, 1);
    assert.equal(
      afterPendingSettlement.items.find(({ number }) => number === 6).hitCount,
      1,
      "a late V5 insert below the prior maximum forecast id must be discovered",
    );

    insertLeaderForecast(database, {
      index: 30,
      predictedNumber: 18,
      actualNumber: 18,
      horizonSeconds: 10,
      historyResultId,
    });
    const afterNewForecast = database.getPredictiveLeaderHitBreakdown(
      SOURCE,
      INSTRUMENT,
    );
    assert.equal(afterNewForecast.integrity.storedCount, 11);
    assert.equal(afterNewForecast.integrity.settledCount, 9);
    assert.equal(afterNewForecast.totals.hitCount, 6);
    assert.deepEqual(afterNewForecast.horizonSeconds, [8, 10, 12]);
    assert.equal(
      afterNewForecast.items.find(({ number }) => number === 18).hitCount,
      1,
      "the incremental cache must validate newly appended forecasts",
    );
  } finally {
    database.close();
  }
});
