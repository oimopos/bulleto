import assert from "node:assert/strict";
import test from "node:test";

import {
  TRAJECTORY_DIRECTION_CHALLENGER_KEY,
  TRAJECTORY_DIRECTION_STRUCTURAL_DEFAULTS,
  TRAJECTORY_DIRECTION_STRUCTURAL_VERSION,
  buildTrajectoryDirectionChallenger,
} from "../src/trajectory-direction-challenger.js";

function bands() {
  return Array.from({ length: 38 }, (_, wireCell) => ({
    wireCell,
    number: wireCell === 37 ? 0 : wireCell,
    lower: 37 - wireCell,
    upper: 38 - wireCell,
  }));
}

function predict(overrides = {}) {
  return buildTrajectoryDirectionChallenger({
    bands: bands(),
    startPrice: 10,
    lockPrice: 12,
    medianCellWidth: 1,
    ...overrides,
  });
}

test("freezes the structural challenger contract", () => {
  assert.equal(TRAJECTORY_DIRECTION_CHALLENGER_KEY, "structural-center-v1");
  assert.equal(
    TRAJECTORY_DIRECTION_STRUCTURAL_VERSION,
    "trajectory-direction-structural-v1",
  );
  assert.deepEqual(TRAJECTORY_DIRECTION_STRUCTURAL_DEFAULTS, {
    flatThresholdCellWidths: 0.5,
    targetPointPolicy: "core-midpoint-v1",
    eligibilityPolicy: "start-edge-and-lock-remaining-same-sign-v1",
  });
  assert.equal(Object.isFrozen(TRAJECTORY_DIRECTION_STRUCTURAL_DEFAULTS), true);
});

test("selects center reversion only when start and lock remain below the core midpoint", () => {
  const result = predict();

  assert.equal(result.status, "ready");
  assert.equal(result.reason, null);
  assert.equal(result.direction, "up");
  assert.equal(result.probabilities, null);
  assert.equal(result.expectedDeltaCellWidths, null);
  assert.deepEqual(result.selection, {
    eligible: true,
    edgeScoreCellWidths: 9,
    remainingScoreCellWidths: 7,
    thresholdCellWidths: 0.5,
    sameSide: true,
  });
  assert.equal(result.audit.coreTop, 37);
  assert.equal(result.audit.coreBottom, 1);
  assert.equal(result.audit.coreMidpoint, 19);
});

test("selects downward center reversion above the core midpoint", () => {
  const result = predict({ startPrice: 30, lockPrice: 28 });

  assert.equal(result.status, "ready");
  assert.equal(result.direction, "down");
  assert.equal(result.expectedDeltaCellWidths, null);
  assert.equal(result.selection.edgeScoreCellWidths, -11);
  assert.equal(result.selection.sameSide, true);
});

test("does not select after crossing the structural center", () => {
  const result = predict({ startPrice: 10, lockPrice: 28 });

  assert.equal(result.status, "unselected");
  assert.equal(result.reason, "center_side_changed");
  assert.equal(result.direction, null);
  assert.equal(result.probabilities, null);
  assert.equal(result.expectedDeltaCellWidths, null);
  assert.equal(result.selection.eligible, false);
  assert.equal(result.selection.sameSide, false);
});

test("treats both flat-threshold boundaries as unselected", () => {
  const startBoundary = predict({ startPrice: 18.5, lockPrice: 12 });
  assert.equal(startBoundary.status, "unselected");
  assert.equal(startBoundary.reason, "start_within_center_band");
  assert.equal(startBoundary.selection.edgeScoreCellWidths, 0.5);

  const lockBoundary = predict({ startPrice: 10, lockPrice: 18.5 });
  assert.equal(lockBoundary.status, "unselected");
  assert.equal(lockBoundary.reason, "lock_within_center_band");
  assert.equal(lockBoundary.selection.remainingScoreCellWidths, 0.5);

  const negativeBoundary = predict({ startPrice: 30, lockPrice: 19.5 });
  assert.equal(negativeBoundary.status, "unselected");
  assert.equal(negativeBoundary.reason, "lock_within_center_band");
  assert.equal(negativeBoundary.selection.remainingScoreCellWidths, -0.5);
});

test("supports locks in both raw zero edge bands without using their centers", () => {
  const lowZero = predict({ startPrice: 0.5, lockPrice: 0.5 });
  const highZero = predict({ startPrice: 37.5, lockPrice: 37.5 });

  assert.equal(lowZero.status, "ready");
  assert.equal(lowZero.direction, "up");
  assert.equal(lowZero.expectedDeltaCellWidths, null);
  assert.equal(highZero.status, "ready");
  assert.equal(highZero.direction, "down");
  assert.equal(highZero.expectedDeltaCellWidths, null);
});

test("extreme zero-band centers cannot move the core midpoint or median width", () => {
  const extremeBands = bands();
  extremeBands[0] = { ...extremeBands[0], upper: 1_000 };
  extremeBands[37] = { ...extremeBands[37], lower: -1_000 };
  const input = {
    bands: extremeBands,
    startPrice: 10,
    lockPrice: 12,
    medianCellWidth: 1,
  };
  const before = structuredClone(input);
  const result = buildTrajectoryDirectionChallenger(input);

  assert.deepEqual(input, before);
  assert.equal(result.status, "ready");
  assert.equal(result.direction, "up");
  assert.equal(result.audit.coreMidpoint, 19);
  assert.equal(result.audit.medianCellWidth, 1);
  assert.equal(result.expectedDeltaCellWidths, null);
});

test("rejects a noncanonical lower zero band without emitting a direction", () => {
  const malformed = bands();
  malformed[37] = { ...malformed[37], number: 37 };
  const result = predict({ bands: malformed });

  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "invalid_bands");
  assert.equal(result.direction, null);
  assert.equal(result.probabilities, null);
  assert.equal(result.expectedDeltaCellWidths, null);
});

test("fails closed for invalid geometry, prices, and median width", () => {
  const unordered = bands();
  [unordered[1], unordered[2]] = [unordered[2], unordered[1]];
  const cases = [
    [predict({ bands: unordered }), "invalid_bands"],
    [predict({ startPrice: Number.NaN }), "invalid_start_price"],
    [predict({ lockPrice: Number.POSITIVE_INFINITY }), "invalid_lock_price"],
    [predict({ medianCellWidth: 0 }), "invalid_median_cell_width"],
    [predict({ medianCellWidth: 2 }), "median_cell_width_mismatch"],
    [predict({ startPrice: -1 }), "start_price_outside_bands"],
    [predict({ lockPrice: 40 }), "lock_price_outside_bands"],
    [predict({ flatThresholdCellWidths: -1 }), "invalid_flat_threshold"],
  ];

  for (const [result, reason] of cases) {
    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, reason);
    assert.equal(result.direction, null);
    assert.equal(result.probabilities, null);
    assert.equal(result.expectedDeltaCellWidths, null);
    assert.equal(result.selection.eligible, false);
  }
});

test("returns a deeply frozen snapshot without mutating input", () => {
  const input = {
    bands: bands(),
    startPrice: 10,
    lockPrice: 12,
    medianCellWidth: 1,
  };
  const before = structuredClone(input);
  const result = buildTrajectoryDirectionChallenger(input);

  assert.deepEqual(input, before);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.parameters), true);
  assert.equal(Object.isFrozen(result.selection), true);
  assert.equal(Object.isFrozen(result.audit), true);
  assert.equal(Object.isFrozen(result.audit.coreWireCells), true);
  assert.throws(() => {
    result.selection.eligible = false;
  }, TypeError);
});
