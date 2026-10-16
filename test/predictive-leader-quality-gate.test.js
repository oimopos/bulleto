import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PREDICTIVE_LEADER_QUALITY_GATE,
  PREDICTIVE_LEADER_QUALITY_GATE_BASELINE_RATE,
  PREDICTIVE_LEADER_QUALITY_GATE_CONFIDENCE_LEVEL,
  PREDICTIVE_LEADER_QUALITY_GATE_VERSION,
  PREDICTIVE_LEADER_QUALITY_GATE_WINDOW_SIZE,
  evaluatePredictiveLeaderQualityGate,
} from '../src/predictive-leader-quality-gate.js';

const UNIFORM_BRIER_LOSS = 18 / 37;

function exactFacts({
  count = 1_000,
  hitCount = 60,
  brierLoss = 0.4,
  firstForecastId = 1,
} = {}) {
  return Array.from({ length: count }, (_, index) => ({
    forecastId: firstForecastId + index,
    top1Hit: index >= count - hitCount,
    combinedBrierLoss: brierLoss,
  }));
}

test('quality gate exposes its frozen audit schema while collecting', () => {
  const gate = evaluatePredictiveLeaderQualityGate({
    facts: [],
    currentFamilyCount: 2,
  });

  assert.deepEqual(gate, {
    version: 'rolling-1000-wilson95-brier-v1',
    status: 'collecting',
    reason: 'insufficient_sample',
    eligible: false,
    windowSize: 1_000,
    sampleSize: 0,
    hitCount: 0,
    hitRate: null,
    baselineRate: 1 / 36,
    confidenceLevel: 0.95,
    lowerBound: null,
    upperBound: null,
    meanBrierLoss: null,
    uniformBrierLoss: UNIFORM_BRIER_LOSS,
    brierDelta: null,
    windowStartForecastId: null,
    windowEndForecastId: null,
  });
  assert.equal(Object.isFrozen(gate), true);
  assert.deepEqual(PREDICTIVE_LEADER_QUALITY_GATE, {
    version: PREDICTIVE_LEADER_QUALITY_GATE_VERSION,
    windowSize: PREDICTIVE_LEADER_QUALITY_GATE_WINDOW_SIZE,
    baselineRate: PREDICTIVE_LEADER_QUALITY_GATE_BASELINE_RATE,
    confidenceLevel: PREDICTIVE_LEADER_QUALITY_GATE_CONFIDENCE_LEVEL,
    uniformBrierLoss: UNIFORM_BRIER_LOSS,
  });
  assert.equal(Object.isFrozen(PREDICTIVE_LEADER_QUALITY_GATE), true);
  assert.equal(gate.version, PREDICTIVE_LEADER_QUALITY_GATE_VERSION);
  assert.equal(gate.windowSize, PREDICTIVE_LEADER_QUALITY_GATE_WINDOW_SIZE);
  assert.equal(gate.baselineRate, PREDICTIVE_LEADER_QUALITY_GATE_BASELINE_RATE);
  assert.equal(
    gate.confidenceLevel,
    PREDICTIVE_LEADER_QUALITY_GATE_CONFIDENCE_LEVEL,
  );
});

test('quality gate confirms only a full window passing Wilson and Brier checks', () => {
  const gate = evaluatePredictiveLeaderQualityGate({
    facts: exactFacts(),
    currentFamilyCount: 2,
  });

  assert.equal(gate.status, 'confirmed');
  assert.equal(gate.reason, 'quality_confirmed');
  assert.equal(gate.eligible, true);
  assert.equal(gate.sampleSize, 1_000);
  assert.equal(gate.hitCount, 60);
  assert.equal(gate.hitRate, 0.06);
  assert.ok(gate.lowerBound > 1 / 36);
  assert.ok(gate.upperBound > gate.lowerBound);
  assert.equal(gate.meanBrierLoss, 0.4);
  assert.equal(gate.brierDelta, UNIFORM_BRIER_LOSS - 0.4);
  assert.equal(gate.windowStartForecastId, 1);
  assert.equal(gate.windowEndForecastId, 1_000);
  assert.equal(Object.isFrozen(gate), true);
});

test('rolling window uses the latest 1000 unique forecast ids', () => {
  const oldest = exactFacts({ count: 5, hitCount: 5, firstForecastId: 1 });
  const latest = exactFacts({ count: 1_000, hitCount: 60, firstForecastId: 6 });
  const gate = evaluatePredictiveLeaderQualityGate({
    facts: [...latest].reverse().concat(oldest),
    currentFamilyCount: 2,
  });

  assert.equal(gate.status, 'confirmed');
  assert.equal(gate.sampleSize, 1_000);
  assert.equal(gate.hitCount, 60);
  assert.equal(gate.windowStartForecastId, 6);
  assert.equal(gate.windowEndForecastId, 1_005);
});

test('quality gate keeps collecting through 999 exact settled facts', () => {
  const gate = evaluatePredictiveLeaderQualityGate({
    facts: exactFacts({ count: 999, hitCount: 100 }),
    currentFamilyCount: 2,
  });

  assert.equal(gate.status, 'collecting');
  assert.equal(gate.reason, 'insufficient_sample');
  assert.equal(gate.eligible, false);
  assert.equal(gate.sampleSize, 999);
  assert.equal(gate.windowStartForecastId, 1);
  assert.equal(gate.windowEndForecastId, 999);
  assert.ok(gate.lowerBound > gate.baselineRate);
  assert.ok(gate.brierDelta > 0);
});

test('Wilson lower bound must be strictly above economic break-even', () => {
  const below = evaluatePredictiveLeaderQualityGate({
    facts: exactFacts({ hitCount: 37 }),
    currentFamilyCount: 2,
  });
  const above = evaluatePredictiveLeaderQualityGate({
    facts: exactFacts({ hitCount: 38 }),
    currentFamilyCount: 2,
  });

  assert.ok(below.lowerBound <= 1 / 36);
  assert.equal(below.status, 'rejected');
  assert.equal(below.reason, 'wilson_lower_bound_not_above_break_even');
  assert.ok(above.lowerBound > 1 / 36);
  assert.equal(above.status, 'confirmed');
});

test('mean Brier loss must be strictly below the uniform loss', () => {
  const equal = evaluatePredictiveLeaderQualityGate({
    facts: exactFacts({ brierLoss: UNIFORM_BRIER_LOSS }),
    currentFamilyCount: 2,
  });
  const worse = evaluatePredictiveLeaderQualityGate({
    facts: exactFacts({ brierLoss: 0.5 }),
    currentFamilyCount: 2,
  });

  for (const gate of [equal, worse]) {
    assert.equal(gate.status, 'rejected');
    assert.equal(gate.reason, 'mean_brier_loss_not_below_uniform');
    assert.equal(gate.eligible, false);
    assert.ok(gate.brierDelta <= 0);
  }
  assert.equal(equal.meanBrierLoss, UNIFORM_BRIER_LOSS);
  assert.equal(equal.brierDelta, 0);
});

test('both predictive families must be present at the current lock', () => {
  for (const currentFamilyCount of [0, 1, 3]) {
    const gate = evaluatePredictiveLeaderQualityGate({
      facts: exactFacts(),
      currentFamilyCount,
    });
    assert.equal(gate.status, 'rejected');
    assert.equal(gate.reason, 'current_family_count_not_two');
    assert.equal(gate.eligible, false);
  }
});

test('malformed or non-exact facts fail closed as invalid', () => {
  const malformedInputs = [
    null,
    {},
    { facts: null, currentFamilyCount: 2 },
    { facts: [null], currentFamilyCount: 2 },
    {
      facts: [{ forecastId: 1, top1Hit: 1, combinedBrierLoss: 0.4 }],
      currentFamilyCount: 2,
    },
    {
      facts: [{ forecastId: '1', top1Hit: true, combinedBrierLoss: 0.4 }],
      currentFamilyCount: 2,
    },
    {
      facts: [{ forecastId: 1, top1Hit: true, combinedBrierLoss: Number.NaN }],
      currentFamilyCount: 2,
    },
    {
      facts: [{ forecastId: 1, top1Hit: true, combinedBrierLoss: -0.1 }],
      currentFamilyCount: 2,
    },
    {
      facts: [{ forecastId: 1, top1Hit: true, combinedBrierLoss: 1.1 }],
      currentFamilyCount: 2,
    },
    {
      facts: [{
        forecastId: 1,
        top1Hit: true,
        combinedBrierLoss: 0.4,
        extra: true,
      }],
      currentFamilyCount: 2,
    },
    {
      facts: [
        { forecastId: 1, top1Hit: true, combinedBrierLoss: 0.4 },
        { forecastId: 1, top1Hit: false, combinedBrierLoss: 0.5 },
      ],
      currentFamilyCount: 2,
    },
    { facts: [], currentFamilyCount: 1.5 },
  ];

  for (const input of malformedInputs) {
    const gate = evaluatePredictiveLeaderQualityGate(input);
    assert.equal(gate.status, 'invalid');
    assert.equal(gate.eligible, false);
    assert.equal(gate.sampleSize, 0);
    assert.equal(gate.hitCount, 0);
    assert.equal(gate.lowerBound, null);
    assert.equal(gate.meanBrierLoss, null);
    assert.equal(Object.isFrozen(gate), true);
  }
});
