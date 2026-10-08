import assert from "node:assert/strict";
import test from "node:test";

import {
  TRAJECTORY_SHADOW_DEFAULTS,
  TRAJECTORY_SHADOW_VERSION,
  predictTrajectoryShadow,
} from "../src/trajectory-shadow.js";

const BASE_TIME = Date.parse("2026-10-08T00:00:00.000Z");
const CURRENT_LOCK_MS = BASE_TIME + 60 * 60_000;

function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function prefix(lockedAtMs, prices, offsets = [-10_000, -5_000, 0]) {
  return prices.map((price, index) => ({
    at: iso(lockedAtMs + offsets[index]),
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

function completed(
  id,
  {
    ageMinutes,
    prices = [10, 11, 12],
    cellWidths = [1, 1, 1],
    delta = 1,
    offsets,
  },
) {
  const completedAtMs = CURRENT_LOCK_MS - ageMinutes * 60_000;
  const lockedAtMs = completedAtMs - 20_000;
  const lockPrice = prices.at(-1);
  return {
    id,
    lockedAt: iso(lockedAtMs),
    completedAt: iso(completedAtMs),
    prefix: prefix(lockedAtMs, prices, offsets),
    cellWidths,
    lockPrice,
    endPrice: lockPrice + delta * [...cellWidths].sort((a, b) => a - b)[1],
  };
}

const SMALL_OPTIONS = Object.freeze({
  resamplePoints: 8,
  neighbors: 3,
  minHistory: 3,
  minNeighbors: 3,
  maxDistanceCellWidths: 4,
});

function predictiveFields(result) {
  return {
    version: result.version,
    status: result.status,
    direction: result.direction,
    probabilities: result.probabilities,
    expectedDeltaCellWidths: result.expectedDeltaCellWidths,
    nearestIds: result.nearestIds,
  };
}

test("normalizes offsets and cell scale before deterministic weighted kNN", () => {
  const result = predictTrajectoryShadow({
    current: current(),
    history: [
      completed("old-up", { ageMinutes: 30, delta: 1 }),
      completed("middle-up", {
        ageMinutes: 20,
        prices: [50, 52, 54],
        cellWidths: [2, 2, 2],
        delta: 2,
      }),
      completed("recent-down", {
        ageMinutes: 10,
        prices: [1_000, 1_010, 1_020],
        cellWidths: [10, 10, 10],
        delta: -1,
      }),
    ],
    options: SMALL_OPTIONS,
  });

  assert.equal(TRAJECTORY_SHADOW_VERSION, "trajectory-shadow-knn-v1");
  assert.deepEqual(TRAJECTORY_SHADOW_DEFAULTS, {
    resamplePoints: 16,
    neighbors: 15,
    minHistory: 30,
    minNeighbors: 10,
    maxDistanceCellWidths: 4,
    flatThresholdCellWidths: 0.5,
    maxAbsDeltaCellWidths: 12,
  });
  assert.equal(result.status, "ready");
  assert.equal(result.direction, "up");
  assert.deepEqual(result.nearestIds, [
    "recent-down",
    "middle-up",
    "old-up",
  ]);
  assert.ok(Math.abs(result.probabilities.up - 2 / 3) < 1e-12);
  assert.ok(Math.abs(result.probabilities.down - 1 / 3) < 1e-12);
  assert.equal(result.probabilities.flat, 0);
  assert.ok(Math.abs(result.expectedDeltaCellWidths - 2 / 3) < 1e-12);
  assert.deepEqual(result.sample, {
    historyCount: 3,
    eligibleCount: 3,
    excludedNotPastCount: 0,
    withinDistanceCount: 3,
    neighborCount: 3,
    requiredHistory: 3,
    requiredNeighbors: 3,
  });
});

test("future and same-cutoff outcomes cannot affect a past-only prediction", () => {
  const history = [
    completed("down-1", { ageMinutes: 30, delta: -1 }),
    completed("down-2", { ageMinutes: 20, delta: -2 }),
    completed("down-3", { ageMinutes: 10, delta: -1 }),
  ];
  const baseline = predictTrajectoryShadow({
    current: current(),
    history,
    options: SMALL_OPTIONS,
  });
  const withLeaks = predictTrajectoryShadow({
    current: current(),
    history: [
      ...history,
      {
        id: "same-cutoff-poison",
        completedAt: iso(CURRENT_LOCK_MS),
      },
      {
        id: "future-poison",
        completedAt: iso(CURRENT_LOCK_MS + 1),
      },
    ],
    options: SMALL_OPTIONS,
  });

  assert.deepEqual(predictiveFields(withLeaks), predictiveFields(baseline));
  assert.equal(withLeaks.sample.excludedNotPastCount, 2);
  assert.equal(withLeaks.sample.eligibleCount, 3);
  assert.equal(withLeaks.sample.historyCount, 5);
});

test("fails closed until the minimum past history exists", () => {
  const result = predictTrajectoryShadow({
    current: current(),
    history: [
      completed("only-1", { ageMinutes: 20, delta: 1 }),
      completed("only-2", { ageMinutes: 10, delta: -1 }),
    ],
    options: SMALL_OPTIONS,
  });

  assert.equal(result.status, "insufficient_history");
  assert.equal(result.direction, null);
  assert.equal(result.probabilities, null);
  assert.equal(result.expectedDeltaCellWidths, null);
  assert.deepEqual(result.nearestIds, []);
  assert.equal(result.sample.eligibleCount, 2);
  assert.equal(result.sample.neighborCount, 0);
});

test("bounds shape distance and gives a closer neighbor more weight", () => {
  const result = predictTrajectoryShadow({
    current: current(),
    history: [
      completed("exact-up", { ageMinutes: 30, delta: 1 }),
      completed("near-down", {
        ageMinutes: 20,
        prices: [10, 10.5, 11],
        delta: -1,
      }),
      completed("far-down", {
        ageMinutes: 10,
        prices: [10, -40, -90],
        delta: -1,
      }),
    ],
    options: {
      ...SMALL_OPTIONS,
      neighbors: 2,
      minNeighbors: 2,
      maxDistanceCellWidths: 2,
    },
  });

  assert.equal(result.status, "ready");
  assert.deepEqual(result.nearestIds, ["exact-up", "near-down"]);
  assert.equal(result.sample.eligibleCount, 3);
  assert.equal(result.sample.withinDistanceCount, 2);
  assert.ok(result.probabilities.up > result.probabilities.down);
  assert.equal(result.direction, "up");
});

test("fails closed when too few candidates are inside the distance bound", () => {
  const result = predictTrajectoryShadow({
    current: current(),
    history: [
      completed("inside", { ageMinutes: 30, delta: 1 }),
      completed("outside-1", {
        ageMinutes: 20,
        prices: [10, 20, 30],
        delta: -1,
      }),
      completed("outside-2", {
        ageMinutes: 10,
        prices: [10, -10, -30],
        delta: -1,
      }),
    ],
    options: {
      ...SMALL_OPTIONS,
      minNeighbors: 2,
      maxDistanceCellWidths: 0.1,
    },
  });

  assert.equal(result.status, "insufficient_neighbors");
  assert.equal(result.sample.eligibleCount, 3);
  assert.equal(result.sample.withinDistanceCount, 1);
  assert.equal(result.sample.neighborCount, 0);
  assert.equal(result.probabilities, null);
  assert.deepEqual(result.nearestIds, []);
});

test("is immutable and invariant to history input order", () => {
  const input = {
    current: current(),
    history: [
      completed("a", { ageMinutes: 40, delta: 1 }),
      completed("b", { ageMinutes: 40, delta: -1 }),
      completed("c", { ageMinutes: 20, delta: 0.1 }),
      completed("d", { ageMinutes: 10, delta: 2 }),
    ],
    options: {
      ...SMALL_OPTIONS,
      neighbors: 4,
      minHistory: 4,
    },
  };
  const before = structuredClone(input);
  const forward = predictTrajectoryShadow(input);
  const reversed = predictTrajectoryShadow({
    ...input,
    history: [...input.history].reverse(),
  });

  assert.deepEqual(input, before);
  assert.deepEqual(reversed, forward);
});

test("rejects malformed eligible prefixes and duplicate eligible IDs", () => {
  assert.throws(
    () =>
      predictTrajectoryShadow({
        current: current({
          prefix: [
            ...prefix(CURRENT_LOCK_MS, [100, 102, 104]),
            { at: iso(CURRENT_LOCK_MS + 1), price: 105 },
          ],
        }),
        history: [],
      }),
    /is after lockedAt/,
  );

  const duplicate = completed("duplicate", { ageMinutes: 10, delta: 1 });
  assert.throws(
    () =>
      predictTrajectoryShadow({
        current: current(),
        history: [duplicate, structuredClone(duplicate)],
        options: { ...SMALL_OPTIONS, minHistory: 2, minNeighbors: 2 },
      }),
    /duplicate eligible id/,
  );
});
