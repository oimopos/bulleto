import assert from "node:assert/strict";
import test from "node:test";

import {
  COMBINED_NUMBER_ALGORITHM_VERSION,
  combineNumberRankings,
} from "../public/combined-number.js";

test("combined number selects the strongest shared normalized rank", () => {
  const result = combineNumberRankings([
    { id: "model", priority: 0, numbers: [12, 16, 7] },
    { id: "transition", priority: 1, numbers: [32, 12, 16] },
  ]);

  assert.equal(result.version, COMBINED_NUMBER_ALGORITHM_VERSION);
  assert.equal(result.status, "combined");
  assert.equal(result.number, 12);
  assert.equal(result.sourceCount, 2);
  assert.equal(result.supportCount, 2);
  assert.deepEqual(result.sourceIds, ["model", "transition"]);
  assert.ok(Math.abs(result.score - (5 / 6)) < 1e-12);
});

test("roulette labels are ranked instead of arithmetically averaged", () => {
  const result = combineNumberRankings([
    { id: "model", priority: 0, numbers: [1] },
    { id: "transition", priority: 1, numbers: [35] },
  ]);

  assert.equal(result.number, 1);
  assert.notEqual(result.number, 18);
  assert.equal(result.supportCount, 1);
});

test("source priority resolves an exact tie independently of input order", () => {
  const sources = [
    { id: "transition", priority: 1, numbers: [36, 0] },
    { id: "model", priority: 0, numbers: [0, 36] },
  ];

  const forward = combineNumberRankings(sources);
  const reversed = combineNumberRankings([...sources].reverse());

  assert.equal(forward.number, 0);
  assert.deepEqual(reversed, forward);
});

test("one valid ranking returns an explicit single-source leader", () => {
  assert.deepEqual(
    combineNumberRankings([
      { id: "transition", priority: 1, numbers: [4, 8, 15, 16, 23] },
    ]),
    {
      version: COMBINED_NUMBER_ALGORITHM_VERSION,
      status: "single_source",
      number: 4,
      score: 1,
      sourceCount: 1,
      supportCount: 1,
      sourceIds: ["transition"],
    },
  );
});

test("malformed and duplicate source identifiers never add votes", () => {
  const result = combineNumberRankings([
    { id: "model", priority: 0, numbers: [7, 7] },
    { id: "transition", priority: 1, numbers: [40] },
    { id: "model", priority: 0, numbers: [12, 9] },
    { id: "model", priority: 0, numbers: [36] },
    null,
  ]);

  assert.equal(result.status, "single_source");
  assert.equal(result.number, 12);
  assert.equal(result.sourceCount, 1);
  assert.deepEqual(result.sourceIds, ["model"]);
});

test("empty input fails closed and inputs stay immutable", () => {
  const sources = [{ id: "model", priority: 0, numbers: [3, 2, 1] }];
  const before = structuredClone(sources);

  combineNumberRankings(sources);

  assert.deepEqual(sources, before);
  assert.deepEqual(combineNumberRankings([]), {
    version: COMBINED_NUMBER_ALGORITHM_VERSION,
    status: "unavailable",
    number: null,
    score: null,
    sourceCount: 0,
    supportCount: 0,
    sourceIds: [],
  });
});
