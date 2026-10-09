import assert from "node:assert/strict";
import test from "node:test";

import {
  TRAJECTORY_SHADOW_ADAPTIVE_DEFAULTS,
  TRAJECTORY_SHADOW_ADAPTIVE_EXPERTS,
  TRAJECTORY_SHADOW_ADAPTIVE_VERSION,
  predictAdaptiveTrajectoryShadow,
} from "../src/trajectory-shadow-adaptive.js";

const BASE_TIME = Date.parse("2026-10-08T00:00:00.000Z");
const CURRENT_LOCK_MS = BASE_TIME + 24 * 60 * 60_000;

function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function prefix(lockedAtMs, prices) {
  return prices.map((price, index) => ({
    at: iso(lockedAtMs - (2 - index) * 5_000),
    price,
  }));
}

function current(overrides = {}) {
  return {
    id: "current-round",
    lockedAt: iso(CURRENT_LOCK_MS),
    prefix: prefix(CURRENT_LOCK_MS, [100, 102, 104]),
    cellWidths: [2, 2, 2, 2],
    ...overrides,
  };
}

function completed(id, ageMinutes, delta = 2, prices = [10, 11, 12]) {
  const completedAtMs = CURRENT_LOCK_MS - ageMinutes * 60_000;
  const lockedAtMs = completedAtMs - 20_000;
  const width = 1;
  return {
    id,
    lockedAt: iso(lockedAtMs),
    completedAt: iso(completedAtMs),
    prefix: prefix(lockedAtMs, prices),
    cellWidths: [width, width, width],
    lockPrice: prices.at(-1),
    endPrice: prices.at(-1) + delta * width,
  };
}

function completeHistory(delta = 2) {
  return Array.from({ length: 30 }, (_, index) =>
    completed(`history-${index + 1}`, 120 - index, delta),
  );
}

function probabilities(direction) {
  return {
    up: direction === "up" ? 1 : 0,
    down: direction === "down" ? 1 : 0,
    flat: direction === "flat" ? 1 : 0,
  };
}

function frozenExpertSnapshot(expert, { direction, delta }) {
  return {
    id: expert.id,
    modelVersion: "trajectory-shadow-knn-v1",
    options: { ...expert.options },
    status: "ready",
    direction,
    probabilities: probabilities(direction),
    expectedDeltaCellWidths: delta,
    deltaRangeCellWidths: {
      lowerQuantile: 0.2,
      upperQuantile: 0.8,
      lower: delta,
      median: delta,
      upper: delta,
    },
  };
}

function learningRow(id, ageMinutes, outcomes) {
  const completedAtMs = CURRENT_LOCK_MS - ageMinutes * 60_000;
  return {
    id,
    lockedAt: iso(completedAtMs - 30_000),
    completedAt: iso(completedAtMs),
    actualDeltaCellWidths: 2,
    experts: TRAJECTORY_SHADOW_ADAPTIVE_EXPERTS.map((expert, index) =>
      frozenExpertSnapshot(expert, outcomes[index]),
    ),
  };
}

function predictiveFields(result) {
  return {
    version: result.version,
    status: result.status,
    direction: result.direction,
    probabilities: result.probabilities,
    expectedDeltaCellWidths: result.expectedDeltaCellWidths,
    deltaRangeCellWidths: result.deltaRangeCellWidths,
    sample: result.sample,
    nearestIds: result.nearestIds,
    currentWeights: result.adaptive.currentWeights,
    ensembleWeights: result.adaptive.ensembleWeights,
    trainingCount: result.adaptive.trainingCount,
    lastTrainingCompletedAt: result.adaptive.lastTrainingCompletedAt,
    neighborDistributions: result.adaptive.experts.map((expert) => ({
      id: expert.id,
      neighborDistribution: expert.neighborDistribution,
    })),
  };
}

test("starts from frozen experts with an equal prior", () => {
  const result = predictAdaptiveTrajectoryShadow({
    current: current(),
    history: completeHistory(),
    learningRows: [],
  });

  assert.equal(
    TRAJECTORY_SHADOW_ADAPTIVE_VERSION,
    "trajectory-shadow-adaptive-v2",
  );
  assert.equal(TRAJECTORY_SHADOW_ADAPTIVE_EXPERTS.length, 3);
  assert.deepEqual(
    TRAJECTORY_SHADOW_ADAPTIVE_EXPERTS.map((expert) => ({
      resamplePoints: expert.options.resamplePoints,
      neighbors: expert.options.neighbors,
      radius: expert.options.maxDistanceCellWidths,
      flat: expert.options.flatThresholdCellWidths,
    })),
    [
      { resamplePoints: 12, neighbors: 10, radius: 3, flat: 0.5 },
      { resamplePoints: 16, neighbors: 15, radius: 4, flat: 0.5 },
      { resamplePoints: 20, neighbors: 20, radius: 5, flat: 0.5 },
    ],
  );
  assert.deepEqual(TRAJECTORY_SHADOW_ADAPTIVE_DEFAULTS, {
    eta: 0.75,
    decay: 0.995,
    directionLossWeight: 0.5,
    deltaLossWeight: 0.5,
    flatThresholdCellWidths: 0.5,
    maxAbsDeltaCellWidths: 12,
  });
  assert.equal(result.status, "ready");
  assert.equal(result.adaptive.trainingCount, 0);
  for (const expert of TRAJECTORY_SHADOW_ADAPTIVE_EXPERTS) {
    assert.ok(
      Math.abs(result.adaptive.priorWeights[expert.id] - 1 / 3) < 1e-12,
    );
    assert.ok(
      Math.abs(result.adaptive.currentWeights[expert.id] - 1 / 3) < 1e-12,
    );
  }
  for (const expert of result.adaptive.experts) {
    assert.equal(expert.status, "ready");
    assert.equal(
      expert.neighborDistribution.length,
      expert.sample.neighborCount,
    );
    assert.deepEqual(
      expert.neighborDistribution.map((neighbor) => neighbor.id),
      expert.nearestIds,
    );
    assert.ok(
      Math.abs(
        expert.neighborDistribution.reduce(
          (sum, neighbor) => sum + neighbor.weight,
          0,
        ) - 1,
      ) < 1e-12,
    );
  }
});

test("chronological loss updates move weight toward the better expert", () => {
  const best = { direction: "up", delta: 2 };
  const middle = { direction: "flat", delta: 0 };
  const worst = { direction: "down", delta: -2 };
  const rows = [
    learningRow("learn-1", 30, [best, middle, worst]),
    learningRow("learn-2", 20, [best, middle, worst]),
    learningRow("learn-3", 10, [best, middle, worst]),
  ];
  const input = {
    current: current(),
    history: completeHistory(),
    learningRows: rows,
  };
  const before = structuredClone(input);
  const result = predictAdaptiveTrajectoryShadow(input);
  const [local, balanced, broad] = TRAJECTORY_SHADOW_ADAPTIVE_EXPERTS;

  assert.deepEqual(input, before, "adaptive prediction must not mutate inputs");
  assert.equal(result.adaptive.trainingCount, 3);
  assert.ok(
    result.adaptive.currentWeights[local.id] >
      result.adaptive.currentWeights[balanced.id],
  );
  assert.ok(
    result.adaptive.currentWeights[balanced.id] >
      result.adaptive.currentWeights[broad.id],
  );
  assert.equal(
    Object.values(result.adaptive.currentWeights).reduce(
      (sum, weight) => sum + weight,
      0,
    ),
    1,
  );
});

test("same-cutoff and future outcomes cannot change learned prediction", () => {
  const baseline = predictAdaptiveTrajectoryShadow({
    current: current(),
    history: completeHistory(),
    learningRows: [],
  });
  const withUnavailableOutcomes = predictAdaptiveTrajectoryShadow({
    current: current(),
    history: completeHistory(),
    learningRows: [
      {
        id: "same-cutoff-poison",
        completedAt: iso(CURRENT_LOCK_MS),
        lockedAt: "not-inspected",
        actualDeltaCellWidths: Number.NaN,
        experts: "not-inspected",
      },
      {
        id: "future-poison",
        completedAt: iso(CURRENT_LOCK_MS + 1),
        lockedAt: "not-inspected",
        actualDeltaCellWidths: Number.POSITIVE_INFINITY,
        experts: null,
      },
    ],
  });

  assert.deepEqual(
    {
      ...predictiveFields(withUnavailableOutcomes),
      excludedNotPastCount: 0,
    },
    {
      ...predictiveFields(baseline),
      excludedNotPastCount: 0,
    },
  );
  assert.equal(withUnavailableOutcomes.adaptive.excludedNotPastCount, 2);
  assert.equal(withUnavailableOutcomes.adaptive.eligibleLearningRowCount, 0);
});

test("learning is deterministic regardless of input row order", () => {
  const best = { direction: "up", delta: 2 };
  const middle = { direction: "flat", delta: 0 };
  const worst = { direction: "down", delta: -2 };
  const rows = [
    learningRow("old", 30, [best, middle, worst]),
    learningRow("middle", 20, [middle, best, worst]),
    learningRow("recent", 10, [best, worst, middle]),
  ];
  const forward = predictAdaptiveTrajectoryShadow({
    current: current(),
    history: completeHistory(),
    learningRows: rows,
  });
  const reverse = predictAdaptiveTrajectoryShadow({
    current: current(),
    history: [...completeHistory()].reverse(),
    learningRows: [...rows].reverse(),
  });

  assert.deepEqual(reverse, forward);
});

test("returns a v1-compatible unavailable result when no expert is ready", () => {
  const result = predictAdaptiveTrajectoryShadow({
    current: current(),
    history: completeHistory().slice(0, 29),
    learningRows: [],
  });

  assert.equal(result.status, "insufficient_history");
  assert.equal(result.direction, null);
  assert.equal(result.probabilities, null);
  assert.equal(result.expectedDeltaCellWidths, null);
  assert.equal(result.deltaRangeCellWidths, null);
  assert.deepEqual(result.nearestIds, []);
  assert.equal(result.sample.eligibleCount, 29);
  assert.equal(result.parameters.flatThresholdCellWidths, 0.5);
  assert.equal(result.adaptive.experts.length, 3);
  assert.ok(
    result.adaptive.experts.every(
      (expert) => expert.neighborDistribution.length === 0,
    ),
  );
});

test("is ready when at least one current expert is ready", () => {
  const broadOnlyHistory = Array.from({ length: 30 }, (_, index) =>
    completed(`broad-only-${index + 1}`, 120 - index, 2, [10, 7.5, 5]),
  );
  const result = predictAdaptiveTrajectoryShadow({
    current: current(),
    history: broadOnlyHistory,
    learningRows: [],
  });
  const [local, balanced, broad] = TRAJECTORY_SHADOW_ADAPTIVE_EXPERTS;
  const expertsById = Object.fromEntries(
    result.adaptive.experts.map((expert) => [expert.id, expert]),
  );

  assert.equal(expertsById[local.id].status, "insufficient_neighbors");
  assert.equal(expertsById[balanced.id].status, "insufficient_neighbors");
  assert.equal(expertsById[broad.id].status, "ready");
  assert.equal(result.status, "ready");
  assert.equal(result.adaptive.ensembleWeights[local.id], 0);
  assert.equal(result.adaptive.ensembleWeights[balanced.id], 0);
  assert.equal(result.adaptive.ensembleWeights[broad.id], 1);
  assert.deepEqual(expertsById[local.id].neighborDistribution, []);
  assert.deepEqual(expertsById[balanced.id].neighborDistribution, []);
  assert.equal(
    expertsById[broad.id].neighborDistribution.length,
    expertsById[broad.id].sample.neighborCount,
  );
  assert.deepEqual(result.probabilities, expertsById[broad.id].probabilities);
});

test("ensembles probabilities, expectation, and q20/q50/q80", () => {
  const mixedHistory = Array.from({ length: 30 }, (_, index) => {
    const delta = index >= 20 ? 2 : index >= 15 ? -2 : index >= 10 ? 0 : -2;
    return completed(`mixed-${index + 1}`, 120 - index, delta);
  });
  const result = predictAdaptiveTrajectoryShadow({
    current: current(),
    history: mixedHistory,
    learningRows: [],
  });

  assert.equal(result.status, "ready");
  assert.equal(result.direction, "up");
  assert.ok(Math.abs(result.probabilities.up - 13 / 18) < 1e-12);
  assert.ok(Math.abs(result.probabilities.down - 7 / 36) < 1e-12);
  assert.ok(Math.abs(result.probabilities.flat - 1 / 12) < 1e-12);
  assert.ok(Math.abs(result.expectedDeltaCellWidths - 19 / 18) < 1e-12);
  assert.equal(result.deltaRangeCellWidths.lowerQuantile, 0.2);
  assert.equal(result.deltaRangeCellWidths.upperQuantile, 0.8);
  assert.ok(Math.abs(result.deltaRangeCellWidths.lower + 2 / 3) < 1e-12);
  assert.ok(Math.abs(result.deltaRangeCellWidths.median - 4 / 3) < 1e-12);
  assert.ok(Math.abs(result.deltaRangeCellWidths.upper - 2) < 1e-12);
  assert.equal(
    Object.values(result.adaptive.ensembleWeights).reduce(
      (sum, weight) => sum + weight,
      0,
    ),
    1,
  );
});

test("rejects malformed eligible learning snapshots but skips unavailable rows", () => {
  const valid = learningRow("valid", 10, [
    { direction: "up", delta: 2 },
    { direction: "up", delta: 2 },
    { direction: "up", delta: 2 },
  ]);
  valid.experts[0].probabilities.up = 2;
  assert.throws(
    () =>
      predictAdaptiveTrajectoryShadow({
        current: current(),
        history: completeHistory(),
        learningRows: [valid],
      }),
    /between zero and one/,
  );

  const unavailable = learningRow("unavailable", 10, [
    { direction: "up", delta: 2 },
    { direction: "up", delta: 2 },
    { direction: "up", delta: 2 },
  ]);
  unavailable.experts[2] = {
    id: TRAJECTORY_SHADOW_ADAPTIVE_EXPERTS[2].id,
    modelVersion: "trajectory-shadow-knn-v1",
    options: { ...TRAJECTORY_SHADOW_ADAPTIVE_EXPERTS[2].options },
    status: "insufficient_neighbors",
  };
  const result = predictAdaptiveTrajectoryShadow({
    current: current(),
    history: completeHistory(),
    learningRows: [unavailable],
  });
  assert.equal(result.adaptive.trainingCount, 0);
  assert.equal(result.adaptive.eligibleLearningRowCount, 1);
  assert.equal(result.adaptive.skippedNotCommonReadyCount, 1);
});
