import test from "node:test";
import assert from "node:assert/strict";

import {
  ROULETTE_NUMBERS,
  advanceCycle,
  canonicalRouletteNumber,
  createCycleState,
  eliminateNumber,
} from "../src/domain.js";

test("roulette domain uses canonical 0..36 numbers", () => {
  assert.deepEqual(ROULETTE_NUMBERS, Array.from({ length: 37 }, (_, i) => i));
  assert.equal(Object.isFrozen(ROULETTE_NUMBERS), true);
  assert.equal(canonicalRouletteNumber(0), 0);
  assert.equal(canonicalRouletteNumber(36), 36);
  assert.equal(canonicalRouletteNumber(37), 0);
  assert.equal(canonicalRouletteNumber({ c: "37" }), 0);
});

test("invalid roulette values are rejected", () => {
  for (const value of [-1, 38, 1.5, "", "not-a-number", null, false, {}, []]) {
    assert.throws(() => canonicalRouletteNumber(value));
  }
});

test("a repeated number creates no additional elimination", () => {
  const original = [0, 1, 2, 3];
  const first = eliminateNumber(original, 2);
  const repeated = eliminateNumber(first.remainingNumbers, 2);

  assert.deepEqual(original, [0, 1, 2, 3], "input is not mutated");
  assert.equal(first.eliminated, true);
  assert.deepEqual(first.remainingNumbers, [0, 1, 3]);
  assert.equal(repeated.eliminated, false);
  assert.equal(repeated.repeated, true);
  assert.equal(repeated.remainingCount, 3);
  assert.deepEqual(repeated.remainingNumbers, [0, 1, 3]);
});

test("one survivor completes a cycle and the next result starts another", () => {
  const finishing = advanceCycle(
    {
      status: "active",
      remainingNumbers: [0, 7],
      remainingCount: 2,
      survivorNumber: null,
      eventCount: 35,
    },
    7,
  );

  assert.equal(finishing.completed, true);
  assert.equal(finishing.cycle.status, "completed");
  assert.equal(finishing.cycle.survivorNumber, 0);
  assert.deepEqual(finishing.cycle.remainingNumbers, [0]);

  const next = advanceCycle(finishing.cycle, 37);
  assert.equal(next.startedNewCycle, true);
  assert.equal(next.cycle.status, "active");
  assert.equal(next.cycle.eventCount, 1);
  assert.equal(next.cycle.remainingCount, 36);
  assert.equal(next.cycle.remainingNumbers.includes(0), false);
});

test("a fresh cycle contains every canonical number", () => {
  const state = createCycleState();
  assert.equal(state.status, "active");
  assert.equal(state.remainingCount, 37);
  assert.deepEqual(state.remainingNumbers, ROULETTE_NUMBERS);
  assert.notEqual(state.remainingNumbers, ROULETTE_NUMBERS);
});
