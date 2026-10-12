import assert from "node:assert/strict";
import test from "node:test";

import { createDatabase } from "../src/database.js";

const BASE_TIME = Date.parse("2026-10-10T10:00:00.000Z");
const SOURCE = "buleto";
const INSTRUMENT = "XPM/RUB";

function iso(offsetSeconds) {
  return new Date(BASE_TIME + offsetSeconds * 1_000).toISOString();
}

function result(number, index, { instrument = INSTRUMENT } = {}) {
  return {
    source: SOURCE,
    instrument,
    settledAt: iso(index),
    resultNumber: number,
    price: 5.4 + index / 10_000,
    observedAt: iso(index),
    externalRoundId: String(100 + index),
    fingerprint: `${instrument}:${index}`,
    rawPayload: { c: number },
  };
}

function forecast() {
  const lockedAt = iso(51);
  return {
    source: SOURCE,
    instrument: INSTRUMENT,
    externalRoundId: "107",
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

test("lightweight predictive leader read preserves the frozen leader, metrics, and account", () => {
  let clockMs = BASE_TIME + 10_000;
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(clockMs),
  });

  try {
    database.ingestBatch(
      [9, 4, 9, 4, 9, 5, 9].map((number, index) => result(number, index)),
    );
    database.sqlite
      .prepare("UPDATE round_results SET created_at = observed_at")
      .run();
    clockMs = BASE_TIME + 52_000;
    database.recordPrecloseForecast(forecast());

    const full = database.getPrecloseForecastState(SOURCE, INSTRUMENT);
    const auditBefore = database.sqlite
      .prepare(`
        SELECT forecast_id, snapshot_json
        FROM forecast_predictive_leader_snapshots
        ORDER BY forecast_id
      `)
      .all();
    const lightweight = database.getPredictiveLeaderReadState(SOURCE, INSTRUMENT);

    assert.deepEqual(
      Object.keys(lightweight.precloseForecast).sort(),
      ["latest", "predictiveLeaderAccount", "predictiveLeaderMetrics"],
    );
    assert.deepEqual(lightweight.precloseForecast.latest, {
      id: full.latest.id,
      source: full.latest.source,
      instrument: full.latest.instrument,
      roundId: full.latest.roundId,
      horizonSeconds: full.latest.horizonSeconds,
      bettingClosesAt: full.latest.bettingClosesAt,
      roundEndsAt: full.latest.roundEndsAt,
      lockedAt: full.latest.lockedAt,
      predictiveLeader: full.latest.predictiveLeader,
      settlement: full.latest.settlement,
    });
    assert.equal(lightweight.precloseForecast.latest.predictiveLeader.status, "ready");
    assert.equal(lightweight.precloseForecast.latest.predictiveLeader.leaderNumber, 4);
    assert.deepEqual(
      lightweight.precloseForecast.predictiveLeaderMetrics,
      full.predictiveLeaderMetrics,
    );
    assert.deepEqual(
      lightweight.precloseForecast.predictiveLeaderAccount,
      full.predictiveLeaderAccount,
    );
    assert.equal(lightweight.precloseForecast.predictiveLeaderAccount.status, "pending");
    assert.equal(
      lightweight.precloseForecast.predictiveLeaderAccount.pendingBet.forecastId,
      full.latest.id,
    );
    assert.equal(lightweight.activeCycle.status, "active");
    assert.equal(lightweight.activeCycle.integrityStatus, "ok");
    assert.deepEqual(lightweight.warnings, []);
    assert.deepEqual(
      lightweight.latestResult,
      database.getLatestResult(SOURCE, INSTRUMENT),
    );
    assert.deepEqual(
      database.sqlite
        .prepare(`
          SELECT forecast_id, snapshot_json
          FROM forecast_predictive_leader_snapshots
          ORDER BY forecast_id
        `)
        .all(),
      auditBefore,
      "the read path must not rewrite frozen audit history",
    );
  } finally {
    database.close();
  }
});

test("lightweight predictive leader integrity is scoped and keeps unresolved audit warnings", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    database.ingestBatch([
      result(4, 0),
      result(7, 1, { instrument: "OTHER/RUB" }),
    ]);
    database.markGap({
      source: SOURCE,
      instrument: "OTHER/RUB",
      incidentKey: "other-stream-gap",
      detectedAt: iso(10),
      message: "other stream gap",
    });

    let state = database.getPredictiveLeaderReadState(SOURCE, INSTRUMENT);
    assert.equal(state.activeCycle.status, "active");
    assert.deepEqual(state.warnings, []);
    assert.equal(state.latestResult.instrument, INSTRUMENT);

    database.markGap({
      source: SOURCE,
      instrument: INSTRUMENT,
      incidentKey: "leader-stream-gap",
      detectedAt: iso(20),
      message: "leader stream gap",
    });
    state = database.getPredictiveLeaderReadState(SOURCE, INSTRUMENT);
    assert.equal(state.activeCycle, null);
    assert.deepEqual(state.warnings, [{ type: "gap" }]);

    database.ingestBatch([result(8, 30)]);
    state = database.getPredictiveLeaderReadState(SOURCE, INSTRUMENT);
    assert.equal(state.activeCycle.status, "active");
    assert.equal(state.activeCycle.integrityStatus, "ok");
    assert.deepEqual(
      state.warnings,
      [{ type: "gap" }],
      "unresolved incidents remain available for the existing freshness gate",
    );
  } finally {
    database.close();
  }
});
