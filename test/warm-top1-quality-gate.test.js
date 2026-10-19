import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WARM_TOP1_ALGORITHM_VERSION,
  WARM_TOP1_BREAK_EVEN_RATE,
  WARM_TOP1_GATE,
  WARM_TOP1_GATE_TARGET_SAMPLE_SIZE,
  WARM_TOP1_GATE_VERSION,
  evaluateWarmTop1FixedGate,
  warmTop1CandidateFromPairSnapshot,
} from '../src/warm-top1-quality-gate.js';

function pairSnapshot({
  status = 'ready',
  sampleSize = 100,
  observedFollowerCount = 10,
  leaderNumber = 7,
  occurrenceCount = 5,
} = {}) {
  return {
    status,
    sampleSize,
    observedFollowerCount,
    pairTop3: status === 'ready'
      ? [
          {
            rank: 1,
            number: leaderNumber,
            occurrenceCount,
            share: occurrenceCount / sampleSize,
          },
          {
            rank: 2,
            number: (leaderNumber + 1) % 37,
            occurrenceCount: Math.max(1, Math.floor(occurrenceCount) - 1),
            share: Math.max(1, Math.floor(occurrenceCount) - 1) / sampleSize,
          },
        ]
      : [],
  };
}

function gateSamples({ count, hitCount, firstForecastId = 1 } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    forecastId: firstForecastId + index,
    actualNumber: index >= count - hitCount ? 7 : 8,
    pairSnapshot: pairSnapshot(),
  }));
}

test('exports the frozen Warm Top-1 policy contract', () => {
  assert.equal(WARM_TOP1_ALGORITHM_VERSION, 'follower-warm-top5-next-v1');
  assert.equal(
    WARM_TOP1_GATE_VERSION,
    'warm-top1-fixed-first-1000-prospective-v1',
  );
  assert.equal(WARM_TOP1_GATE_TARGET_SAMPLE_SIZE, 1_000);
  assert.equal(WARM_TOP1_BREAK_EVEN_RATE, 1 / 36);
  assert.equal(Object.isFrozen(WARM_TOP1_GATE), true);
  assert.deepEqual(WARM_TOP1_GATE, {
    version: WARM_TOP1_GATE_VERSION,
    algorithmVersion: WARM_TOP1_ALGORITHM_VERSION,
    windowPolicy: 'first-1000-selected-settled-prospective-no-roll',
    targetSampleSize: 1_000,
    breakEvenRate: 1 / 36,
    confidenceLevel: 0.95,
    shareThresholdPercent: 5,
    minimumObservedFollowerCount: 5,
  });
});

test('candidate takes pair_top3[0] and applies exact integer five-percent rule', () => {
  const exact = warmTop1CandidateFromPairSnapshot(pairSnapshot());
  const below = warmTop1CandidateFromPairSnapshot(pairSnapshot({
    sampleSize: 101,
  }));

  assert.deepEqual(exact, {
    algorithmVersion: WARM_TOP1_ALGORITHM_VERSION,
    status: 'ready',
    reason: 'threshold_met',
    eligible: true,
    rank: 1,
    number: 7,
    occurrenceCount: 5,
    sampleSize: 100,
    observedFollowerCount: 10,
    share: 0.05,
    threshold: 0.05,
    comparison: 'gte',
    shareThresholdPercent: 5,
    minimumObservedFollowerCount: 5,
  });
  assert.equal(Object.isFrozen(exact), true);
  assert.equal(below.status, 'no_signal');
  assert.equal(below.reason, 'below_share_threshold');
  assert.equal(below.eligible, false);
});

test('candidate requires at least five observed followers', () => {
  const candidate = warmTop1CandidateFromPairSnapshot(pairSnapshot({
    observedFollowerCount: 4,
  }));

  assert.equal(candidate.status, 'no_signal');
  assert.equal(candidate.reason, 'insufficient_observed_followers');
  assert.equal(candidate.eligible, false);
});

test('candidate accepts persisted snake_case and public top3 spellings', () => {
  const snake = warmTop1CandidateFromPairSnapshot({
    status: 'ready',
    sample_size: 100,
    observed_follower_count: 5,
    pair_top3: [{ number: 11, occurrence_count: 5 }],
  });
  const api = warmTop1CandidateFromPairSnapshot({
    status: 'ready',
    sampleSize: 100,
    observedFollowerCount: 5,
    top3: [{ rank: 1, number: 12, occurrenceCount: 5, share: 0.05 }],
  });

  assert.equal(snake.status, 'ready');
  assert.equal(snake.number, 11);
  assert.equal(api.status, 'ready');
  assert.equal(api.number, 12);
});

test('candidate validation fails closed for malformed or ambiguous snapshots', () => {
  const invalid = [
    null,
    {},
    pairSnapshot({ occurrenceCount: 5.5 }),
    { ...pairSnapshot(), top3: [] },
    {
      ...pairSnapshot(),
      pairTop3: [
        { rank: 1, number: 7, occurrenceCount: 5, share: 0.05 },
        { rank: 2, number: 8, occurrenceCount: 6, share: 0.06 },
      ],
    },
    {
      ...pairSnapshot(),
      pairTop3: [
        { rank: 1, number: 7, occurrenceCount: 5, share: 0.5 },
      ],
    },
  ];

  for (const value of invalid) {
    const candidate = warmTop1CandidateFromPairSnapshot(value);
    assert.equal(candidate.status, 'invalid');
    assert.equal(candidate.reason, 'invalid_pair_snapshot');
    assert.equal(candidate.eligible, false);
  }
});

test('fixed gate collects only qualifying settled samples', () => {
  const samples = gateSamples({ count: 999, hitCount: 100 });
  samples.push({
    forecastId: 1_000,
    actualNumber: 7,
    pairSnapshot: pairSnapshot({ sampleSize: 101 }),
  });
  const gate = evaluateWarmTop1FixedGate(samples);

  assert.equal(gate.status, 'collecting');
  assert.equal(gate.reason, 'insufficient_selected_sample');
  assert.equal(gate.eligible, false);
  assert.equal(gate.sampleSize, 999);
  assert.equal(gate.hitCount, 100);
  assert.equal(gate.windowStartForecastId, 1);
  assert.equal(gate.windowEndForecastId, 999);
  assert.equal(Object.isFrozen(gate), true);
});

test('Wilson lower bound must be strictly above one-over-36', () => {
  const rejected = evaluateWarmTop1FixedGate(gateSamples({
    count: 1_000,
    hitCount: 37,
  }));
  const confirmed = evaluateWarmTop1FixedGate(gateSamples({
    count: 1_000,
    hitCount: 38,
  }));

  assert.ok(rejected.lowerBound <= 1 / 36);
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.eligible, false);
  assert.equal(
    rejected.reason,
    'wilson_lower_bound_not_above_break_even',
  );
  assert.ok(confirmed.lowerBound > 1 / 36);
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.reason, 'quality_confirmed');
  assert.equal(confirmed.eligible, true);
});

test('fixed gate sorts by forecast id and never rolls past first 1000', () => {
  const firstWindow = gateSamples({ count: 1_000, hitCount: 37 });
  const laterWins = gateSamples({
    count: 100,
    hitCount: 100,
    firstForecastId: 1_001,
  });
  const gate = evaluateWarmTop1FixedGate(
    [...laterWins, ...firstWindow].reverse(),
  );

  assert.equal(gate.status, 'rejected');
  assert.equal(gate.sampleSize, 1_000);
  assert.equal(gate.hitCount, 37);
  assert.equal(gate.windowStartForecastId, 1);
  assert.equal(gate.windowEndForecastId, 1_000);
});

test('external integrity and malformed settled samples fail closed', () => {
  const explicitFailure = evaluateWarmTop1FixedGate([], {
    integrityValid: false,
  });
  assert.equal(explicitFailure.status, 'invalid');
  assert.equal(explicitFailure.reason, 'integrity_not_confirmed');

  const malformed = [
    null,
    [{ forecastId: 1, actualNumber: 37, pairSnapshot: pairSnapshot() }],
    [{ forecastId: 1, actualNumber: 7, pairSnapshot: {} }],
    [
      { forecastId: 1, actualNumber: 7, pairSnapshot: pairSnapshot() },
      { forecastId: 1, actualNumber: 8, pairSnapshot: pairSnapshot() },
    ],
  ];
  for (const samples of malformed) {
    const gate = evaluateWarmTop1FixedGate(samples);
    assert.equal(gate.status, 'invalid');
    assert.equal(gate.eligible, false);
    assert.equal(gate.sampleSize, 0);
    assert.equal(gate.hitCount, 0);
    assert.equal(gate.lowerBound, null);
  }
});
