import assert from "node:assert/strict";
import test from "node:test";

import {
  PRECLOSE_FORECAST_CONSTANTS,
  PRECLOSE_FORECAST_MAX_LEAD_MS,
  PRECLOSE_FORECAST_MIN_LEAD_MS,
  buildPrecloseForecast,
} from "../src/preclose-forecast.js";

function cells() {
  return Array.from({ length: 38 }, (_, wireCell) => ({
    c: wireCell,
    vt: 38 - wireCell,
    vf: 37 - wireCell,
  }));
}

function round(overrides = {}) {
  return {
    id: 4090339,
    s: 2,
    bcd: "2026-09-25T12:00:00Z",
    ed: "2026-09-25T12:00:40Z",
    sv: 20,
    cls: cells(),
    ...overrides,
  };
}

const receivedAt = "2026-09-25T11:59:51Z";
const factors = [
  { dt: "2026-09-25T11:59:47Z", v: 19.6 },
  { dt: "2026-09-25T11:59:49Z", v: 19.8 },
  { dt: "2026-09-25T11:59:51Z", v: 20 },
];

test("builds a whitelisted linear projection locked before bcd", () => {
  const forecast = buildPrecloseForecast({ round: round(), factors, receivedAt });

  assert.equal(forecast.status, "predicted");
  assert.equal(forecast.horizonSeconds, 8);
  assert.equal(forecast.round.externalRoundId, "4090339");
  assert.equal(forecast.round.lockedAt, receivedAt.replace("Z", ".000Z"));
  assert.equal(forecast.features.leadTimeMs, 9_000);
  assert.equal(forecast.features.factorCount, 3);
  assert.equal(forecast.features.startPrice, 20);
  assert.equal(forecast.features.currentNumber, 17);
  assert.ok(Math.abs(forecast.features.trendPerSecond - 0.1) < 1e-12);
  assert.ok(Math.abs(forecast.features.projectedPrice - 24.9) < 1e-10);
  assert.equal(forecast.prediction.number, 13);
  assert.deepEqual(
    forecast.prediction.top3.map((item) => item.number),
    [13, 12, 14],
  );
  assert.equal(new Set(forecast.prediction.top3.map((item) => item.number)).size, 3);
  assert.equal("probabilities" in forecast.prediction, false);
  assert.equal("confidence" in forecast.prediction, false);
});

test("rejects a final round even when rr is null", () => {
  assert.throws(
    () => buildPrecloseForecast({ round: round({ rr: null }), factors, receivedAt }),
    /round with rr is final/,
  );
});

test("rejects a round whose upstream status is already closed", () => {
  assert.throws(
    () => buildPrecloseForecast({ round: round({ s: 4 }), factors, receivedAt }),
    /status s=2/,
  );
});

test("fails closed on missing cutoff timestamps", () => {
  assert.throws(
    () =>
      buildPrecloseForecast({
        round: round({ bcd: null }),
        factors,
        receivedAt,
      }),
    /round\.bcd must be a valid timestamp/,
  );
  assert.throws(
    () =>
      buildPrecloseForecast({
        round: round(),
        factors,
        receivedAt: null,
      }),
    /receivedAt must be a valid timestamp/,
  );
});

test("enforces the inclusive 8 to 10 second pre-bcd lock window", () => {
  assert.doesNotThrow(() =>
    buildPrecloseForecast({
      round: round(),
      factors: [
        { dt: "2026-09-25T11:59:48Z", v: 19.6 },
        { dt: "2026-09-25T11:59:50Z", v: 19.8 },
        { dt: "2026-09-25T11:59:52Z", v: 20 },
      ],
      receivedAt: "2026-09-25T11:59:52Z",
    }),
  );
  assert.doesNotThrow(() =>
    buildPrecloseForecast({
      round: round(),
      factors: [
        { dt: "2026-09-25T11:59:46Z", v: 19.6 },
        { dt: "2026-09-25T11:59:48Z", v: 19.8 },
        { dt: "2026-09-25T11:59:50Z", v: 20 },
      ],
      receivedAt: "2026-09-25T11:59:50Z",
    }),
  );
  assert.throws(
    () =>
      buildPrecloseForecast({
        round: round(),
        factors,
        receivedAt: "2026-09-25T11:59:52.001Z",
      }),
    /between 8 and 10 seconds/,
  );
  assert.throws(
    () =>
      buildPrecloseForecast({
        round: round(),
        factors,
        receivedAt: "2026-09-25T11:59:49.999Z",
      }),
    /between 8 and 10 seconds/,
  );
  assert.equal(PRECLOSE_FORECAST_MIN_LEAD_MS, 8_000);
  assert.equal(PRECLOSE_FORECAST_MAX_LEAD_MS, 10_000);
});

test("ignores factor points timestamped after receivedAt", () => {
  const baseline = buildPrecloseForecast({ round: round(), factors, receivedAt });
  const withFuturePoint = buildPrecloseForecast({
    round: round(),
    factors: [
      ...factors,
      { dt: "2026-09-25T11:59:52Z", v: 999_999, secret: "future" },
    ],
    receivedAt,
  });

  assert.equal(withFuturePoint.features.factorCount, 3);
  assert.equal(
    withFuturePoint.features.projectedPrice,
    baseline.features.projectedPrice,
  );
  assert.equal(
    withFuturePoint.features.factorPoints.some((point) => point.at.includes("11:59:52")),
    false,
  );
});

test("rejects a stale latest factor and an undersized trend window", () => {
  assert.throws(
    () =>
      buildPrecloseForecast({
        round: round(),
        receivedAt,
        factors: [
          { dt: "2026-09-25T11:59:41Z", v: 19.6 },
          { dt: "2026-09-25T11:59:43Z", v: 19.8 },
          { dt: "2026-09-25T11:59:45Z", v: 20 },
        ],
      }),
    /more than 5 seconds old/,
  );
  assert.throws(
    () =>
      buildPrecloseForecast({
        round: round(),
        receivedAt,
        factors: factors.slice(1),
      }),
    /at least 3 factor points/,
  );
});

test("canonicalizes the lower wire band c=37 to zero and keeps top3 unique", () => {
  const fallingFactors = [
    { dt: "2026-09-25T11:59:47Z", v: 10.825 },
    { dt: "2026-09-25T11:59:49Z", v: 10.4125 },
    { dt: "2026-09-25T11:59:51Z", v: 10 },
  ];
  const forecast = buildPrecloseForecast({
    round: round(),
    factors: fallingFactors,
    receivedAt,
  });

  assert.equal(forecast.prediction.number, 0);
  assert.equal(forecast.prediction.top3[0].wireCell, 37);
  assert.equal(new Set(forecast.prediction.top3.map((item) => item.number)).size, 3);
  assert.equal(
    forecast.features.cellBands.find((band) => band.wireCell === 37).number,
    0,
  );
});

test("uses the upper wire cell on an exact shared boundary", () => {
  const boundaryFactors = [
    { dt: "2026-09-25T11:59:47Z", v: 1 },
    { dt: "2026-09-25T11:59:49Z", v: 1 },
    { dt: "2026-09-25T11:59:51Z", v: 1 },
  ];
  const forecast = buildPrecloseForecast({
    round: round(),
    factors: boundaryFactors,
    receivedAt,
  });

  assert.equal(forecast.features.currentNumber, 36);
  assert.equal(forecast.prediction.number, 36);
  assert.equal(forecast.prediction.top3[0].wireCell, 36);
});

test("returns only whitelisted audit fields", () => {
  const forecast = buildPrecloseForecast({
    round: round({
      sv: 123,
      s: 2,
      upstreamSecret: "must-not-be-copied",
    }),
    factors: factors.map((factor) => ({ ...factor, vendorField: "ignored" })),
    receivedAt,
  });
  const serialized = JSON.stringify(forecast);

  assert.deepEqual(Object.keys(forecast.round).sort(), [
    "bettingClosesAt",
    "endsAt",
    "externalRoundId",
    "lockedAt",
  ]);
  assert.equal(serialized.includes("must-not-be-copied"), false);
  assert.equal(serialized.includes("vendorField"), false);
  assert.equal(serialized.includes('"rr"'), false);
  assert.equal(PRECLOSE_FORECAST_CONSTANTS.factorWindowMs, 12_000);
  assert.equal(PRECLOSE_FORECAST_CONSTANTS.maxFactorAgeMs, 5_000);
});
