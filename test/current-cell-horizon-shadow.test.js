import assert from "node:assert/strict";
import test from "node:test";

import {
  CURRENT_CELL_HORIZON_SHADOW_ALGORITHM_VERSION,
  CURRENT_CELL_HORIZON_SHADOW_CONFIG,
  buildCurrentCellHorizonShadow,
  createCurrentCellHorizonShadowCohort,
  evaluateCurrentCellHorizonShadow,
  normalizeCurrentCellHorizonShadow,
} from "../src/current-cell-horizon-shadow.js";

function bands() {
  return Array.from({ length: 38 }, (_, wireCell) => ({
    wireCell,
    number: wireCell === 37 ? 0 : wireCell,
    lower: 37 - wireCell,
    upper: 38 - wireCell,
  }));
}

function tick({
  factorAt = "2026-10-18T10:00:49.000Z",
  receivedAt = "2026-10-18T10:00:49.100Z",
  createdAt = "2026-10-18T10:00:49.200Z",
  price = 35.5,
} = {}) {
  return { factorAt, receivedAt, createdAt, price };
}

function input(overrides = {}) {
  return {
    trajectoryId: 101,
    source: "buleto",
    instrument: "XPM/RUB",
    externalRoundId: "round-1",
    bettingClosesAt: "2026-10-18T10:01:00.000Z",
    capturedAt: "2026-10-18T10:00:50.100Z",
    bands: bands(),
    ticks: [tick()],
    ...overrides,
  };
}

test("selects the latest tick whose factor, receipt, and creation all precede cutoff", () => {
  const value = buildCurrentCellHorizonShadow(input({
    ticks: [
      tick({ price: 34.5 }),
      tick({
        factorAt: "2026-10-18T10:00:49.900Z",
        receivedAt: "2026-10-18T10:00:50.001Z",
        createdAt: "2026-10-18T10:00:50.002Z",
        price: 33.5,
      }),
      tick({
        factorAt: "2026-10-18T10:00:49.800Z",
        receivedAt: "2026-10-18T10:00:49.900Z",
        createdAt: "2026-10-18T10:00:50.001Z",
        price: 32.5,
      }),
      tick({
        factorAt: "2026-10-18T10:00:50.001Z",
        receivedAt: "2026-10-18T10:00:50.002Z",
        createdAt: "2026-10-18T10:00:50.003Z",
        price: 31.5,
      }),
    ],
  }));
  assert.equal(value.status, "ready");
  assert.equal(value.cutoffAt, "2026-10-18T10:00:50.000Z");
  assert.equal(value.leaderWireCell, 3);
  assert.equal(value.leaderNumber, 3);
  assert.equal(value.selectedTick.price, 34.5);
  assert.ok(
    value.audit.executionBufferMs
      >= CURRENT_CELL_HORIZON_SHADOW_CONFIG.minimumExecutionBufferMs,
  );
  assert.deepEqual(value.audit, {
    suppliedTickCount: 4,
    causalTickCount: 1,
    excludedFutureTickCount: 3,
    executionBufferMs: 9_900,
  });
});

test("maps lower wire zero to canonical zero and emits calibrated probabilities", () => {
  const value = buildCurrentCellHorizonShadow(input({
    ticks: [tick({ price: 0.5 })],
  }));
  assert.equal(value.status, "ready");
  assert.equal(value.leaderWireCell, 37);
  assert.equal(value.leaderNumber, 0);
  assert.equal(value.distribution.length, 37);
  assert.ok(Math.abs(value.distribution.reduce((sum, mass) => sum + mass, 0) - 1) < 1e-12);
  assert.equal(value.distribution[0], value.leaderProbability);
  assert.ok(value.leaderProbability > value.runnerUpProbability);
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.distribution), true);
});

test("never uses a future tick and reports an unavailable shadow instead", () => {
  const value = buildCurrentCellHorizonShadow(input({
    ticks: [tick({
      factorAt: "2026-10-18T10:00:49.900Z",
      receivedAt: "2026-10-18T10:00:50.001Z",
      createdAt: "2026-10-18T10:00:50.002Z",
    })],
  }));
  assert.equal(value.status, "unavailable");
  assert.equal(value.reason, "no_causal_tick");
  assert.equal(value.leaderNumber, null);
  assert.deepEqual(value.distribution, []);
});

test("requires an on-time prospective capture", () => {
  const early = buildCurrentCellHorizonShadow(input({
    capturedAt: "2026-10-18T10:00:49.999Z",
  }));
  assert.equal(early.reason, "cutoff_not_reached");

  const late = buildCurrentCellHorizonShadow(input({
    capturedAt: "2026-10-18T10:00:52.501Z",
  }));
  assert.equal(late.reason, "capture_late");

  const unsafeBuffer = buildCurrentCellHorizonShadow(input({
    capturedAt: "2026-10-18T10:00:56.000Z",
  }));
  assert.equal(unsafeBuffer.reason, "insufficient_execution_buffer");
  assert.equal(unsafeBuffer.audit.executionBufferMs, 4_000);
  assert.ok(
    unsafeBuffer.audit.executionBufferMs
      < CURRENT_CELL_HORIZON_SHADOW_CONFIG.minimumExecutionBufferMs,
  );
});

test("rejects ambiguous latest ticks and malformed temporal order", () => {
  const ambiguous = buildCurrentCellHorizonShadow(input({
    ticks: [tick({ price: 34.5 }), tick({ price: 33.5 })],
  }));
  assert.equal(ambiguous.reason, "ambiguous_latest_tick");
  assert.throws(() => buildCurrentCellHorizonShadow(input({
    ticks: [tick({
      factorAt: "2026-10-18T10:00:49.500Z",
      receivedAt: "2026-10-18T10:00:49.400Z",
    })],
  })), /received before its factor time/);
});

test("creates an immutable prospective cohort with frozen configuration", () => {
  const cohort = createCurrentCellHorizonShadowCohort({
    source: "buleto",
    instrument: "XPM/RUB",
    firstTrajectoryId: 8_559,
    startedAt: "2026-10-18T01:00:00.000Z",
  });
  assert.equal(cohort.firstTrajectoryId, 8_559);
  assert.equal(cohort.source, "buleto");
  assert.equal(cohort.instrument, "XPM/RUB");
  assert.equal(cohort.algorithmVersion, CURRENT_CELL_HORIZON_SHADOW_ALGORITHM_VERSION);
  assert.equal(cohort.mode, "prospective-shadow");
  assert.equal(cohort.config, CURRENT_CELL_HORIZON_SHADOW_CONFIG);
  assert.equal(cohort.config.executionEnabled, false);
  assert.equal(
    cohort.config.calibration.developmentSampleSize,
    cohort.config.selectionAudit.commonTrainCount
      + cohort.config.selectionAudit.commonTuneCount,
  );
  assert.equal(
    cohort.config.calibration.developmentHitCount,
    cohort.config.selectionAudit.commonTrainHitCount
      + cohort.config.selectionAudit.commonTuneHitCount,
  );
  assert.equal(cohort.config.selectionAudit.developmentThroughResultId, 21_409);
  assert.equal(
    cohort.config.selectionAudit.developmentThroughExternalRoundId,
    "4109398",
  );
  assert.equal(Object.isFrozen(cohort), true);
  assert.equal(Object.isFrozen(cohort.config.calibration), true);
  assert.throws(() => createCurrentCellHorizonShadowCohort({
    source: "buleto",
    instrument: "XPM/RUB",
    firstTrajectoryId: 0,
    startedAt: "2026-10-18T01:00:00.000Z",
  }), /positive integer/);
  assert.throws(() => createCurrentCellHorizonShadowCohort({
    source: "buleto",
    instrument: "OTHER",
    firstTrajectoryId: 8_559,
    startedAt: "2026-10-18T01:00:00.000Z",
  }), /frozen current-cell stream/);
});

test("normalizer rebuilds the complete causal snapshot and rejects tampering", () => {
  const original = JSON.parse(JSON.stringify(buildCurrentCellHorizonShadow(input())));
  const normalized = normalizeCurrentCellHorizonShadow(original);
  assert.deepEqual(normalized, original);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.bandManifest), true);
  assert.equal(Object.isFrozen(normalized.tickManifest), true);

  const mutations = [
    (value) => { value.trajectoryId = 0; },
    (value) => { value.source = ""; },
    (value) => { value.instrument = ""; },
    (value) => { value.cohortKey = "other"; },
    (value) => { value.leaderNumber = 4; },
    (value) => { value.distribution[3] += 0.001; },
    (value) => { value.selectedTick.price = 33.5; },
    (value) => { value.audit.causalTickCount = 2; },
    (value) => { value.config.calibration.developmentSampleSize = 5_945; },
    (value) => { value.tickManifest[0].price = 33.5; },
    (value) => { value.unexpected = true; },
  ];
  for (const mutate of mutations) {
    const tampered = structuredClone(original);
    mutate(tampered);
    assert.equal(normalizeCurrentCellHorizonShadow(tampered), null);
  }

  const unavailable = JSON.parse(JSON.stringify(
    buildCurrentCellHorizonShadow(input({ ticks: [] })),
  ));
  assert.deepEqual(normalizeCurrentCellHorizonShadow(unavailable), unavailable);
  unavailable.reason = "tampered";
  assert.equal(normalizeCurrentCellHorizonShadow(unavailable), null);
});

test("evaluator reports frozen top-1, Brier, and clipped log loss", () => {
  const shadow = buildCurrentCellHorizonShadow(input());
  const hit = evaluateCurrentCellHorizonShadow(shadow, shadow.leaderNumber);
  const miss = evaluateCurrentCellHorizonShadow(shadow, 4);
  assert.equal(hit.top1Hit, true);
  assert.equal(miss.top1Hit, false);
  assert.ok(hit.brierLoss < miss.brierLoss);
  assert.ok(hit.clippedLogLoss < miss.clippedLogLoss);
  assert.equal(hit.uniformBrierLoss, 18 / 37);
  assert.equal(hit.uniformClippedLogLoss, Math.log(37));
  assert.equal(Object.isFrozen(hit), true);

  const unavailable = buildCurrentCellHorizonShadow(input({ ticks: [] }));
  assert.throws(
    () => evaluateCurrentCellHorizonShadow(unavailable, 3),
    /valid ready current-cell snapshot/,
  );
  assert.throws(
    () => evaluateCurrentCellHorizonShadow(shadow, 37),
    /integer from 0 through 36/,
  );
});
