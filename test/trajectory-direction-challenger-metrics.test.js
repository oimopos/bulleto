import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeTrajectoryDirectionChallenger } from '../src/trajectory-direction-challenger-metrics.js';

function entry({
  forecastId,
  status = 'ready',
  reason = null,
  predictedDirection = status === 'ready' ? 'up' : null,
  actualDirection = null,
  championDirection = null,
  settled = actualDirection !== null,
}) {
  return {
    forecastId,
    status,
    reason,
    predictedDirection,
    actualDirection,
    championDirection,
    settled,
  };
}

test('summarizes coverage, selective accuracy, sides, outcomes, pairing, and runs', () => {
  const metrics = summarizeTrajectoryDirectionChallenger([
    entry({ forecastId: 1, predictedDirection: 'up', actualDirection: 'up', championDirection: 'down' }),
    entry({
      forecastId: 2,
      status: 'unselected',
      reason: 'within_center_band',
      actualDirection: 'down',
      championDirection: 'down',
    }),
    entry({ forecastId: 3, predictedDirection: 'up', actualDirection: 'flat', championDirection: 'flat' }),
    entry({ forecastId: 4, status: 'unavailable', reason: 'missing_core_bands' }),
    entry({ forecastId: 5, predictedDirection: 'down', actualDirection: 'down', championDirection: 'down' }),
    entry({ forecastId: 6, predictedDirection: 'down', actualDirection: 'up', championDirection: 'down' }),
    entry({ forecastId: 7, predictedDirection: 'up', championDirection: 'up' }),
    entry({ forecastId: 8, predictedDirection: 'down', actualDirection: 'down', championDirection: 'up' }),
  ], {
    eligibleForecastCount: 10,
    totalStoredCount: 8,
  });

  assert.equal(metrics.eligibleCount, 10);
  assert.equal(metrics.storedCount, 8);
  assert.equal(metrics.validStoredCount, 8);
  assert.equal(metrics.selectedCount, 6);
  assert.equal(metrics.unselectedCount, 1);
  assert.equal(metrics.unavailableCount, 1);
  assert.deepEqual(metrics.reasons, {
    within_center_band: 1,
    missing_core_bands: 1,
  });
  assert.equal(metrics.decisionCoverage, 0.75);
  assert.equal(metrics.decisionCoverageWilson95.confidence, 0.95);
  assert.ok(metrics.decisionCoverageWilson95.lower < 0.75);
  assert.ok(metrics.decisionCoverageWilson95.upper > 0.75);

  assert.equal(metrics.evaluatedSelected, 5);
  assert.equal(metrics.settledSelected, 5);
  assert.equal(metrics.pendingSelected, 1);
  assert.equal(metrics.ungradableSelected, 0);
  assert.equal(metrics.hits, 3);
  assert.equal(metrics.selectiveAccuracy, 0.6);
  assert.ok(metrics.selectiveAccuracyWilson95.lower < 0.6);
  assert.ok(metrics.selectiveAccuracyWilson95.upper > 0.6);
  assert.deepEqual(metrics.byPredictedDirection.up, {
    selectedCount: 3,
    evaluatedCount: 2,
    hits: 1,
    rate: 0.5,
  });
  assert.deepEqual(metrics.byPredictedDirection.down, {
    selectedCount: 3,
    evaluatedCount: 3,
    hits: 2,
    rate: 2 / 3,
  });
  assert.deepEqual(metrics.actualDistribution, { up: 2, down: 2, flat: 1 });

  assert.deepEqual(metrics.paired, {
    count: 5,
    challengerHits: 3,
    championHits: 2,
    challengerRate: 0.6,
    championRate: 0.4,
    uplift: 0.2,
    bothHit: 1,
    challengerOnly: 2,
    championOnly: 1,
    bothWrong: 1,
    discordantCount: 3,
    exactTwoSidedMcNemarPValue: 1,
  });
  assert.equal(metrics.longestPredictedDirectionRun, 2);
  assert.equal(metrics.predictedDirectionTransitionCount, 3);
  assert.equal(metrics.predictedDirectionTransitionRate, 3 / 5);
});

test('flat actual outcomes are evaluated misses for an up/down challenger', () => {
  const metrics = summarizeTrajectoryDirectionChallenger([
    entry({ forecastId: 1, predictedDirection: 'up', actualDirection: 'flat' }),
    entry({ forecastId: 2, predictedDirection: 'down', actualDirection: 'flat' }),
  ]);

  assert.equal(metrics.evaluatedSelected, 2);
  assert.equal(metrics.hits, 0);
  assert.equal(metrics.selectiveAccuracy, 0);
  assert.deepEqual(metrics.actualDistribution, { up: 0, down: 0, flat: 2 });
});

test('abstentions do not enter selective accuracy or paired comparison', () => {
  const metrics = summarizeTrajectoryDirectionChallenger([
    entry({
      forecastId: 1,
      status: 'unselected',
      reason: 'within_center_band',
      actualDirection: 'up',
      championDirection: 'up',
    }),
    entry({
      forecastId: 2,
      status: 'unavailable',
      reason: null,
      actualDirection: 'down',
      championDirection: 'down',
    }),
  ]);

  assert.equal(metrics.selectedCount, 0);
  assert.equal(metrics.evaluatedSelected, 0);
  assert.equal(metrics.selectiveAccuracy, null);
  assert.equal(metrics.selectiveAccuracyWilson95, null);
  assert.deepEqual(metrics.reasons, { within_center_band: 1, unspecified: 1 });
  assert.equal(metrics.paired.count, 0);
  assert.equal(metrics.paired.exactTwoSidedMcNemarPValue, null);
});

test('pending selected rows count toward coverage and direction runs but not accuracy', () => {
  const metrics = summarizeTrajectoryDirectionChallenger([
    entry({ forecastId: 1, predictedDirection: 'down' }),
    entry({ forecastId: 2, predictedDirection: 'down' }),
    entry({ forecastId: 3, predictedDirection: 'up', actualDirection: 'up' }),
  ]);

  assert.equal(metrics.selectedCount, 3);
  assert.equal(metrics.evaluatedSelected, 1);
  assert.equal(metrics.settledSelected, 1);
  assert.equal(metrics.pendingSelected, 2);
  assert.equal(metrics.ungradableSelected, 0);
  assert.equal(metrics.longestPredictedDirectionRun, 2);
  assert.equal(metrics.predictedDirectionTransitionRate, 0.5);
});

test('settled rows without a gradable price are not reported as pending', () => {
  const metrics = summarizeTrajectoryDirectionChallenger([
    entry({ forecastId: 1, predictedDirection: 'up', settled: true }),
    entry({ forecastId: 2, predictedDirection: 'down' }),
  ]);

  assert.equal(metrics.selectedCount, 2);
  assert.equal(metrics.settledSelected, 1);
  assert.equal(metrics.evaluatedSelected, 0);
  assert.equal(metrics.ungradableSelected, 1);
  assert.equal(metrics.pendingSelected, 1);
  assert.equal(metrics.selectiveAccuracy, null);
});

test('uses an exact two-sided binomial p-value for discordant pairs', () => {
  const metrics = summarizeTrajectoryDirectionChallenger([
    entry({ forecastId: 1, predictedDirection: 'up', actualDirection: 'up', championDirection: 'down' }),
    entry({ forecastId: 2, predictedDirection: 'up', actualDirection: 'up', championDirection: 'down' }),
    entry({ forecastId: 3, predictedDirection: 'up', actualDirection: 'up', championDirection: 'down' }),
    entry({ forecastId: 4, predictedDirection: 'up', actualDirection: 'up', championDirection: 'down' }),
    entry({ forecastId: 5, predictedDirection: 'up', actualDirection: 'up', championDirection: 'down' }),
    entry({ forecastId: 6, predictedDirection: 'up', actualDirection: 'up', championDirection: 'down' }),
  ]);

  assert.equal(metrics.paired.discordantCount, 6);
  assert.equal(metrics.paired.challengerOnly, 6);
  assert.equal(metrics.paired.championOnly, 0);
  assert.ok(Math.abs(metrics.paired.exactTwoSidedMcNemarPValue - 0.03125) < 1e-12);
});

test('returns null rates and intervals for an empty cohort', () => {
  const metrics = summarizeTrajectoryDirectionChallenger([], {
    eligibleForecastCount: 0,
  });

  assert.equal(metrics.eligibleCount, 0);
  assert.equal(metrics.validStoredCount, 0);
  assert.equal(metrics.settledSelected, 0);
  assert.equal(metrics.pendingSelected, 0);
  assert.equal(metrics.ungradableSelected, 0);
  assert.equal(metrics.decisionCoverage, null);
  assert.equal(metrics.decisionCoverageWilson95, null);
  assert.equal(metrics.selectiveAccuracy, null);
  assert.equal(metrics.selectiveAccuracyWilson95, null);
  assert.equal(metrics.byPredictedDirection.up.rate, null);
  assert.equal(metrics.paired.challengerRate, null);
  assert.equal(metrics.paired.championRate, null);
  assert.equal(metrics.paired.uplift, null);
  assert.equal(metrics.predictedDirectionTransitionRate, null);
  assert.equal(metrics.longestPredictedDirectionRun, 0);
});

test('rejects malformed and non-chronological entries', () => {
  assert.throws(
    () => summarizeTrajectoryDirectionChallenger('not-an-array'),
    /entries must be an array/,
  );
  assert.throws(
    () => summarizeTrajectoryDirectionChallenger([entry({ forecastId: 0 })]),
    /positive safe integer/,
  );
  assert.throws(
    () => summarizeTrajectoryDirectionChallenger([entry({ forecastId: 1, status: 'bad' })]),
    /status must be/,
  );
  assert.throws(
    () => summarizeTrajectoryDirectionChallenger([
      entry({ forecastId: 1, status: 'unselected', predictedDirection: 'up' }),
    ]),
    /must be null unless ready/,
  );
  assert.throws(
    () => summarizeTrajectoryDirectionChallenger([
      entry({ forecastId: 1, actualDirection: 'sideways' }),
    ]),
    /actualDirection must be/,
  );
  assert.throws(
    () => summarizeTrajectoryDirectionChallenger([
      entry({ forecastId: 2 }),
      entry({ forecastId: 1 }),
    ]),
    /strictly increasing/,
  );
  assert.throws(
    () => summarizeTrajectoryDirectionChallenger([entry({ forecastId: 1 })], {
      totalStoredCount: 0,
    }),
    /cannot be smaller/,
  );
  assert.throws(
    () => summarizeTrajectoryDirectionChallenger([{
      ...entry({ forecastId: 1 }),
      settled: 'yes',
    }]),
    /settled must be a boolean/,
  );
  assert.throws(
    () => summarizeTrajectoryDirectionChallenger([entry({
      forecastId: 1,
      actualDirection: 'up',
      settled: false,
    })]),
    /requires a settled outcome/,
  );
});
