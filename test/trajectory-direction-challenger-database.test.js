import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createDatabase } from "../src/database.js";

const BASE_MS = Date.parse("2026-10-14T10:00:00.000Z");
const SOURCE = "buleto";
const INSTRUMENT = "XPM/RUB";

function iso(seconds) {
  return new Date(BASE_MS + seconds * 1_000).toISOString();
}

function cells() {
  return Array.from({ length: 38 }, (_, code) => ({
    c: code,
    vt: 38 - code,
    vf: 37 - code,
  }));
}

function forecast(roundId, { startPrice = 10, currentPrice = 12 } = {}) {
  return {
    source: SOURCE,
    instrument: INSTRUMENT,
    externalRoundId: String(roundId),
    horizonSeconds: 8,
    bettingClosesAt: iso(60),
    roundEndsAt: iso(100),
    factorAt: iso(51),
    lockedAt: iso(51),
    currentPrice,
    startPrice,
    currentNumber: 11,
    predictedPrice: currentPrice,
    predictedNumber: 7,
    rankedNumbers: [7, 11, 19],
    cells: cells(),
    features: {
      samples: [
        { dt: iso(47), v: currentPrice - 0.2 },
        { dt: iso(49), v: currentPrice - 0.1 },
        { dt: iso(51), v: currentPrice },
      ],
      windowSeconds: 4,
      slopePerSecond: 0.05,
      secondsToEnd: 49,
    },
    modelVersion: "preclose-linear-v1",
  };
}

function result(roundId, price, number = 7) {
  return {
    source: SOURCE,
    instrument: INSTRUMENT,
    settledAt: iso(101),
    resultNumber: number,
    price,
    observedAt: iso(101),
    externalRoundId: String(roundId),
    fingerprint: `challenger:${roundId}`,
    rawPayload: { c: number },
  };
}

test("freezes selected up/down and unselected decisions and grades a flat miss", () => {
  let clockMs = BASE_MS + 52_000;
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(clockMs),
  });
  try {
    database.recordPrecloseForecast(forecast("up"));
    database.recordPrecloseForecast(forecast("down", {
      startPrice: 30,
      currentPrice: 28,
    }));
    database.recordPrecloseForecast(forecast("flat", {
      startPrice: 19,
      currentPrice: 19,
    }));

    const stored = database.sqlite.prepare(`
      SELECT status, reason, direction, probability_up,
        probability_down, probability_flat
      FROM forecast_trajectory_direction_challenger_snapshots
      ORDER BY forecast_id
    `).all();
    assert.deepEqual(stored.map((row) => ({
      status: row.status,
      reason: row.reason,
      direction: row.direction,
    })), [
      { status: "ready", reason: null, direction: "up" },
      { status: "ready", reason: null, direction: "down" },
      { status: "unselected", reason: "start_within_center_band", direction: null },
    ]);
    assert.ok(stored.every((row) =>
      row.probability_up === null &&
      row.probability_down === null &&
      row.probability_flat === null));

    clockMs = BASE_MS + 102_000;
    database.ingestBatch([result("up", 12.2)]);
    database.settlePrecloseForecasts(SOURCE, INSTRUMENT);
    const state = database.getTrajectoryDirectionChallengerState(
      SOURCE,
      INSTRUMENT,
    );
    assert.equal(state.metrics.evaluatedSelected, 1);
    assert.equal(state.metrics.hits, 0);
    assert.equal(state.metrics.actualDistribution.flat, 1);
    assert.equal(state.metrics.selectiveAccuracy, 0);
    assert.equal(state.metrics.paired.count, 0);
    assert.equal(state.latest.forecastId, 3);
    assert.equal(state.latest.challenger.status, "unselected");
  } finally {
    database.close();
  }
});

test("a challenger insert failure preserves primary, v2, and leaders and retry fills only the gap", () => {
  const errors = [];
  let clockMs = BASE_MS + 52_000;
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(clockMs),
    logger: { error(payload, message) { errors.push({ payload, message }); } },
  });
  const attempt = forecast("retry");
  try {
    database.sqlite.exec(`
      CREATE TRIGGER fail_direction_challenger_insert
      BEFORE INSERT ON forecast_trajectory_direction_challenger_snapshots
      BEGIN
        SELECT RAISE(ABORT, 'injected challenger failure');
      END;
    `);
    assert.equal(database.recordPrecloseForecast(attempt).inserted, true);
    assert.equal(database.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM round_forecasts",
    ).get().count, 1);
    assert.equal(database.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM forecast_trajectory_shadows",
    ).get().count, 1);
    assert.equal(database.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM forecast_predictive_leader_snapshots",
    ).get().count, 1);
    assert.equal(database.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM forecast_predictive_challenger_snapshots",
    ).get().count, 1);
    assert.equal(database.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM forecast_trajectory_direction_challenger_snapshots",
    ).get().count, 0);
    assert.ok(errors.some(({ payload }) =>
      /injected challenger failure/.test(payload.error.message)));

    database.sqlite.exec("DROP TRIGGER fail_direction_challenger_insert");
    clockMs = BASE_MS + 56_000;
    assert.deepEqual(database.recordPrecloseForecast(attempt), {
      inserted: false,
      roundId: "retry",
    });
    assert.equal(database.sqlite.prepare(
      "SELECT COUNT(*) AS count FROM forecast_trajectory_direction_challenger_snapshots",
    ).get().count, 0);
    clockMs = BASE_MS + 52_000;
    assert.deepEqual(database.recordPrecloseForecast(attempt), {
      inserted: false,
      roundId: "retry",
      repaired: true,
    });
    const frozen = database.sqlite.prepare(`
      SELECT snapshot_json
      FROM forecast_trajectory_direction_challenger_snapshots
    `).get().snapshot_json;
    assert.deepEqual(database.recordPrecloseForecast(attempt), {
      inserted: false,
      roundId: "retry",
    });
    assert.equal(database.sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM forecast_trajectory_direction_challenger_snapshots
    `).get().count, 1);
    assert.equal(database.sqlite.prepare(`
      SELECT snapshot_json
      FROM forecast_trajectory_direction_challenger_snapshots
    `).get().snapshot_json, frozen);
  } finally {
    database.close();
  }
});

test("corrupt cohort is isolated from the established preclose read", () => {
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(BASE_MS + 52_000),
  });
  try {
    database.recordPrecloseForecast(forecast("cohort-corrupt"));
    database.sqlite.prepare(`
      UPDATE trajectory_direction_challenger_cohorts
      SET config_json = '{}'
    `).run();
    assert.throws(
      () => database.getTrajectoryDirectionChallengerState(SOURCE, INSTRUMENT),
      /cohort is invalid/,
    );
    const state = database.getPrecloseForecastState(SOURCE, INSTRUMENT);
    assert.equal(state.latest.roundId, "cohort-corrupt");
    assert.equal("trajectoryDirectionChallenger" in state, false);
  } finally {
    database.close();
  }
});

test("tampered JSON fails closed while a future result cannot rewrite the snapshot", () => {
  let clockMs = BASE_MS + 52_000;
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(clockMs),
  });
  try {
    database.recordPrecloseForecast(forecast("tamper"));
    const frozen = database.sqlite.prepare(`
      SELECT snapshot_json
      FROM forecast_trajectory_direction_challenger_snapshots
    `).get().snapshot_json;
    clockMs = BASE_MS + 102_000;
    database.ingestBatch([result("tamper", 14)]);
    database.settlePrecloseForecasts(SOURCE, INSTRUMENT);
    assert.equal(database.sqlite.prepare(`
      SELECT snapshot_json
      FROM forecast_trajectory_direction_challenger_snapshots
    `).get().snapshot_json, frozen);
    let state = database.getTrajectoryDirectionChallengerState(SOURCE, INSTRUMENT);
    assert.equal(state.latest.challenger.evaluation.actualDirection, "up");
    assert.equal(state.latest.challenger.evaluation.directionHit, true);
    database.sqlite.exec("UPDATE round_results SET price = NULL");
    state = database.getTrajectoryDirectionChallengerState(SOURCE, INSTRUMENT);
    assert.equal(state.latest.challenger.evaluation, null);
    assert.equal(state.latest.challenger.evaluationStatus, "ungradable");
    assert.equal(state.metrics.settledSelected, 1);
    assert.equal(state.metrics.ungradableSelected, 1);
    assert.equal(state.metrics.pendingSelected, 0);

    database.sqlite.exec("PRAGMA ignore_check_constraints = ON");
    database.sqlite.prepare(`
      UPDATE forecast_trajectory_direction_challenger_snapshots
      SET snapshot_json = '{}'
    `).run();
    database.sqlite.exec("PRAGMA ignore_check_constraints = OFF");
    state = database.getTrajectoryDirectionChallengerState(SOURCE, INSTRUMENT);
    assert.equal(state.latest.challenger, null);
    assert.equal(state.metrics.validStoredCount, 0);
    assert.equal(state.metrics.invalidStoredCount, 1);
  } finally {
    database.close();
  }
});

test("v21 cohort starts after legacy forecasts and does not backfill them", () => {
  const directory = mkdtempSync(join(tmpdir(), "direction-challenger-"));
  const path = join(directory, "test.sqlite");
  let database = createDatabase({
    path,
    clock: () => new Date(BASE_MS + 52_000),
  });
  try {
    database.recordPrecloseForecast(forecast("legacy"));
    database.sqlite.exec(`
      DELETE FROM forecast_trajectory_direction_challenger_snapshots;
      DROP TABLE forecast_trajectory_direction_challenger_snapshots;
      DROP TABLE trajectory_direction_challenger_cohorts;
      PRAGMA user_version = 20;
    `);
    database.close();
    database = createDatabase({
      path,
      clock: () => new Date(BASE_MS + 52_000),
    });
    const cohort = database.sqlite.prepare(
      "SELECT first_forecast_id FROM trajectory_direction_challenger_cohorts",
    ).get();
    assert.equal(cohort.first_forecast_id, 2);
    assert.equal(database.getTrajectoryDirectionChallengerState(
      SOURCE,
      INSTRUMENT,
    ).latest, null);

    database.recordPrecloseForecast(forecast("new"));
    assert.deepEqual(database.sqlite.prepare(`
      SELECT forecast_id
      FROM forecast_trajectory_direction_challenger_snapshots
      ORDER BY forecast_id
    `).all().map((row) => row.forecast_id), [2]);
  } finally {
    if (!database.closed) database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("v21 JSON checks reject a structurally empty ready snapshot", () => {
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(BASE_MS + 52_000),
  });
  try {
    database.recordPrecloseForecast(forecast("json-check"));
    database.sqlite.exec(
      "DELETE FROM forecast_trajectory_direction_challenger_snapshots",
    );
    assert.throws(() => database.sqlite.prepare(`
      INSERT INTO forecast_trajectory_direction_challenger_snapshots (
        forecast_id, challenger_key, schema_version, model_version,
        status, reason, locked_at, direction, probability_up,
        probability_down, probability_flat, expected_delta_cell_widths,
        snapshot_json, created_at
      ) VALUES (
        1, 'structural-center-v1', 1,
        'trajectory-direction-structural-v1', 'ready', NULL,
        '2026-10-14T10:00:00.000Z', 'up', NULL, NULL, NULL, NULL,
        '{}', '2026-10-14T10:00:01.000Z'
      )
    `).run(), /constraint/i);
  } finally {
    database.close();
  }
});
