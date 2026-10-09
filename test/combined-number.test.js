import assert from "node:assert/strict";
import test from "node:test";

import {
  assessCombinedNumberFreshness,
  COMBINED_NUMBER_ALGORITHM_VERSION,
  combinedTrajectoryRanking,
  combineNumberRankings,
} from "../public/combined-number.js";

const FRESH_STATE = Object.freeze({
  collector: Object.freeze({
    currentRound: Object.freeze({ id: "4103913" }),
    status: "connected",
    connected: true,
    error: null,
    lastResultAt: "2026-10-09T15:01:48.000Z",
    resultConfirmationPending: false,
    pendingResultCount: 0,
  }),
  latestResult: Object.freeze({
    id: 1_113,
    roundId: "4103912",
    settledAt: "2026-10-09T15:01:48Z",
  }),
  pipelinePending: Object.freeze({ results: 0, gaps: 0 }),
});

test("combined freshness accepts one fully synchronized state snapshot", () => {
  assert.deepEqual(assessCombinedNumberFreshness(FRESH_STATE), {
    status: "ready",
    reason: "fresh",
    currentRoundId: 4_103_913,
    latestRoundId: 4_103_912,
    latestResultId: 1_113,
  });
});

test("combined freshness pauses on collector or persistence backlog", () => {
  const blockedStates = [
    {
      ...FRESH_STATE,
      collector: {
        ...FRESH_STATE.collector,
        status: "reconnecting",
        connected: false,
      },
    },
    {
      ...FRESH_STATE,
      collector: { ...FRESH_STATE.collector, resultConfirmationPending: true },
    },
    {
      ...FRESH_STATE,
      collector: { ...FRESH_STATE.collector, pendingResultCount: 1 },
    },
    { ...FRESH_STATE, pipelinePending: { results: 1, gaps: 0 } },
    { ...FRESH_STATE, pipelinePending: { results: 0, gaps: 1 } },
  ];

  for (const state of blockedStates) {
    assert.equal(assessCombinedNumberFreshness(state).status, "paused");
  }
  assert.equal(
    assessCombinedNumberFreshness(blockedStates[3]).reason,
    "persistence_pending",
  );
});

test("combined freshness pauses when database and collector cursors diverge", () => {
  const staleStates = [
    {
      ...FRESH_STATE,
      collector: {
        ...FRESH_STATE.collector,
        lastResultAt: "2026-10-09T15:00:48Z",
      },
    },
    {
      ...FRESH_STATE,
      collector: {
        ...FRESH_STATE.collector,
        currentRound: { id: "4103914" },
      },
    },
    { ...FRESH_STATE, pipelinePending: undefined },
  ];

  assert.deepEqual(
    staleStates.map((state) => assessCombinedNumberFreshness(state).reason),
    ["result_cursor_mismatch", "round_cursor_mismatch", "cursor_invalid"],
  );
  assert.ok(staleStates.every(
    (state) => assessCombinedNumberFreshness(state).status === "paused",
  ));
});

test("trajectory q50 eligibility is frozen by adaptive training count at lock", () => {
  const shadow = {
    isAdaptive: true,
    status: "ready",
    adaptive: { trainingCount: 29 },
    numberArea: { typical: { wireCell: 32, number: 32 } },
    displayRange: { cells: [{ wireCell: 32, number: 32 }] },
  };

  assert.deepEqual(combinedTrajectoryRanking(shadow), []);
  assert.deepEqual(combinedTrajectoryRanking({
    ...shadow,
    adaptive: { trainingCount: 30 },
  }), [32]);
  assert.deepEqual(combinedTrajectoryRanking({
    ...shadow,
    isAdaptive: false,
    adaptive: { trainingCount: 300 },
  }), []);
});

test("family consensus selects the strongest cross-family rank", () => {
  const result = combineNumberRankings([
    { id: "model", family: "price", numbers: [12, 16, 7] },
    { id: "transition", family: "transition", numbers: [32, 12, 16] },
  ]);

  assert.equal(result.version, COMBINED_NUMBER_ALGORITHM_VERSION);
  assert.equal(result.status, "consensus");
  assert.equal(result.number, 12);
  assert.equal(result.sourceCount, 2);
  assert.equal(result.familyCount, 2);
  assert.equal(result.supportCount, 2);
  assert.equal(result.familySupportCount, 2);
  assert.deepEqual(result.sourceIds, ["model", "transition"]);
  assert.deepEqual(result.familyIds, ["price", "transition"]);
  assert.ok(Math.abs(result.score - (5 / 6)) < 1e-12);
});

test("broader family support outranks mass after the two-family quorum", () => {
  const result = combineNumberRankings([
    { id: "a", family: "a", numbers: [2, 3, 4, 5, 1] },
    { id: "b", family: "b", numbers: [2, 6, 7, 8, 1] },
    { id: "c", family: "c", numbers: [9, 10, 11, 12, 1] },
  ]);

  assert.equal(result.status, "consensus");
  assert.equal(result.number, 1);
  assert.equal(result.familySupportCount, 3);
  assert.ok(Math.abs(result.score - 0.2) < 1e-12);
});

test("disagreeing families fail closed instead of favoring the model", () => {
  const result = combineNumberRankings([
    { id: "model", family: "price", numbers: [18, 19, 17] },
    { id: "transition", family: "transition", numbers: [32, 25, 29] },
  ]);

  assert.equal(result.status, "no_consensus");
  assert.equal(result.number, null);
  assert.equal(result.score, null);
  assert.equal(result.sourceCount, 2);
  assert.equal(result.familyCount, 2);
  assert.equal(result.familySupportCount, 0);
});

test("a candidate outside the start-price top three can become leader", () => {
  const result = combineNumberRankings([
    { id: "start-price", family: "price", numbers: [18, 19, 17] },
    { id: "trajectory", family: "price", numbers: [32] },
    { id: "transition", family: "transition", numbers: [32, 25, 29] },
  ]);

  assert.equal(result.status, "consensus");
  assert.equal(result.number, 32);
  assert.ok(![18, 19, 17].includes(result.number));
  assert.equal(result.familySupportCount, 2);
  assert.equal(result.supportCount, 2);
  assert.ok(Math.abs(result.score - 1) < 1e-12);
});

test("several correlated methods in one family cannot manufacture consensus", () => {
  const result = combineNumberRankings([
    { id: "warm", family: "transition", numbers: [4, 8, 15, 16, 23] },
    { id: "live", family: "transition", numbers: [4, 12, 7, 21, 9] },
  ]);

  assert.equal(result.status, "insufficient_families");
  assert.equal(result.number, null);
  assert.equal(result.sourceCount, 2);
  assert.equal(result.familyCount, 1);
  assert.deepEqual(result.familyIds, ["transition"]);
});

test("identical rankings in one family are deduplicated", () => {
  const sources = [
    { id: "model-a", family: "price", numbers: [12, 9] },
    { id: "model-copy", family: "price", numbers: [12, 9] },
    { id: "transition", family: "transition", numbers: [12, 7] },
  ];
  const result = combineNumberRankings(sources);

  assert.equal(result.status, "consensus");
  assert.equal(result.number, 12);
  assert.equal(result.sourceCount, 2);
  assert.deepEqual(result.sourceIds, ["model-a", "transition"]);
  assert.deepEqual(combineNumberRankings([...sources].reverse()), result);
});

test("exact ties abstain and stay independent of source order", () => {
  const sources = [
    { id: "transition", family: "transition", numbers: [36, 0] },
    { id: "model", family: "price", numbers: [0, 36] },
  ];

  const forward = combineNumberRankings(sources);
  const reversed = combineNumberRankings([...sources].reverse());

  assert.equal(forward.status, "ambiguous");
  assert.equal(forward.number, null);
  assert.deepEqual(reversed, forward);
});

test("malformed sources never add votes", () => {
  const result = combineNumberRankings([
    { id: "model", family: "price", numbers: [7, 7] },
    { id: "transition", family: "transition", numbers: [40] },
    { id: "model", family: "price", numbers: [12, 9] },
    { id: "missing-family", numbers: [12] },
    null,
  ]);

  assert.equal(result.status, "insufficient_families");
  assert.equal(result.sourceCount, 1);
  assert.deepEqual(result.sourceIds, ["model"]);
});

test("conflicting duplicate source identifiers fail closed independent of order", () => {
  const sources = [
    { id: "duplicate", family: "price", numbers: [12, 9] },
    { id: "duplicate", family: "transition", numbers: [12, 7] },
    { id: "other", family: "transition", numbers: [12, 6] },
  ];
  const forward = combineNumberRankings(sources);
  const reversed = combineNumberRankings([...sources].reverse());

  assert.equal(forward.status, "insufficient_families");
  assert.deepEqual(forward.sourceIds, ["other"]);
  assert.deepEqual(reversed, forward);
});

test("empty input fails closed and inputs stay immutable", () => {
  const sources = [
    { id: "model", family: "price", numbers: [3, 2, 1] },
    { id: "transition", family: "transition", numbers: [3, 8, 13] },
  ];
  const before = structuredClone(sources);

  combineNumberRankings(sources);

  assert.deepEqual(sources, before);
  assert.deepEqual(combineNumberRankings([]), {
    version: COMBINED_NUMBER_ALGORITHM_VERSION,
    status: "unavailable",
    number: null,
    score: null,
    sourceCount: 0,
    familyCount: 0,
    supportCount: 0,
    familySupportCount: 0,
    sourceIds: [],
    familyIds: [],
  });
});
