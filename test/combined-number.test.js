import assert from "node:assert/strict";
import test from "node:test";

import {
  assessCombinedNumberFreshness,
  COMBINED_NUMBER_ALGORITHM_VERSION,
  combinedCycleAnalogueRanking,
  combinedCycleNumberSignals,
  combinedOverdueRanking,
  combinedTripleFollowerRanking,
  combinedTrajectoryRanking,
  combinedTrajectorySignals,
  combinedVirtualRecencySources,
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

test("trajectory exposes the evaluated q50 ranking and its validated range", () => {
  const shadow = {
    isAdaptive: true,
    status: "ready",
    adaptive: { trainingCount: 30 },
    numberArea: { typical: { wireCell: 32, number: 32 } },
    displayRange: {
      cells: [30, 31, 32, 33].map((number) => ({
        wireCell: number,
        number,
      })),
    },
  };

  assert.deepEqual(combinedTrajectorySignals(shadow), {
    ranking: [32],
    range: [30, 31, 32, 33],
  });
  assert.deepEqual(combinedTrajectoryRanking(shadow), [32]);
  assert.deepEqual(combinedTrajectorySignals({
    ...shadow,
    adaptive: { trainingCount: 29 },
  }), { ranking: [], range: [] });
  assert.deepEqual(combinedTrajectorySignals({
    ...shadow,
    displayRange: { cells: [{ wireCell: 37, number: 37 }] },
  }), { ranking: [], range: [] });

  const zeroAlias = {
    ...shadow,
    numberArea: { typical: { wireCell: 37, number: 0 } },
    displayRange: {
      cells: [
        { wireCell: 36, number: 36 },
        { wireCell: 37, number: 0 },
      ],
    },
  };
  assert.deepEqual(combinedTrajectorySignals(zeroAlias), {
    ranking: [0],
    range: [36, 0],
  });
});

test("recency adapters preserve equal longest candidates and current held target zero", () => {
  const latestResult = { id: 41, continuityEpoch: 3 };
  const base = {
    mode: "simulation",
    executionEnabled: false,
    status: "waiting",
    longestCandidate: {
      number: 0,
      continuityEpoch: 3,
      roundsSinceLast: 12,
    },
    longestCandidates: [0, 1, 2].map((number) => ({
      number,
      continuityEpoch: 3,
      roundsSinceLast: 12,
    })),
    activeSession: null,
  };

  assert.deepEqual(combinedVirtualRecencySources(base, latestResult), [{
    id: "recency-virtual-longest-set",
    family: "recency",
    mode: "set",
    numbers: [0, 1, 2],
  }]);

  const armed = {
    ...base,
    status: "armed",
    activeSession: {
      status: "armed",
      targetNumber: 0,
      continuityEpoch: 3,
      activatedAfterResultId: 41,
      attemptCount: 0,
      lastBetResultId: null,
    },
  };
  assert.deepEqual(
    combinedVirtualRecencySources(armed, latestResult).at(-1),
    { id: "recency-virtual-held", family: "recency", numbers: [0] },
  );
  assert.equal(combinedVirtualRecencySources({
    ...armed,
    activeSession: { ...armed.activeSession, activatedAfterResultId: 40 },
  }, latestResult).length, 1);
  assert.equal(combinedVirtualRecencySources({
    ...base,
    longestCandidates: [
      base.longestCandidates[0],
      { ...base.longestCandidates[1], roundsSinceLast: 11 },
    ],
  }, latestResult).length, 0);
});

test("cycle adapter treats active remaining numbers as a set and completed survivor as one signal", () => {
  const settledAt = "2026-10-09T15:01:48Z";
  const records = (remaining) => Array.from({ length: 37 }, (_, number) => ({
    number,
    eliminated: !remaining.includes(number),
  }));
  const activeRemaining = Array.from({ length: 30 }, (_, index) => index + 7);
  const active = {
    id: 144,
    status: "active",
    integrityStatus: "ok",
    lastEventAt: settledAt,
    eventCount: 9,
    totalDraws: 9,
    eliminatedCount: 7,
    uniqueCount: 7,
    remainingCount: 30,
    remainingNumbers: activeRemaining,
    numbers: records(activeRemaining),
    survivorNumber: null,
  };
  const latest = {
    id: 99,
    number: 6,
    cycleId: 144,
    settledAt,
    remainingAfter: 30,
  };
  assert.deepEqual(combinedCycleNumberSignals(active, latest), {
    remaining: activeRemaining,
    survivor: [],
  });
  assert.deepEqual(combinedCycleNumberSignals({
    ...active,
    remainingNumbers: [...activeRemaining, activeRemaining[0]],
    remainingCount: 31,
  }, { ...latest, remainingAfter: 31 }), { remaining: [], survivor: [] });
  assert.deepEqual(combinedCycleNumberSignals({
    ...active,
    remainingNumbers: [...activeRemaining.slice(0, -1), 99],
  }, latest), { remaining: [], survivor: [] });

  const completed = {
    ...active,
    status: "completed",
    eventCount: 54,
    totalDraws: 54,
    eliminatedCount: 36,
    uniqueCount: 36,
    remainingCount: 1,
    remainingNumbers: [9],
    numbers: records([9]),
    survivorNumber: 9,
  };
  assert.deepEqual(combinedCycleNumberSignals(completed, {
    ...latest,
    remainingAfter: 1,
  }), { remaining: [], survivor: [9] });
});

test("cycle analogue exposes only the next aligned archive event", () => {
  const start = Date.parse("2026-10-09T15:00:00Z");
  const events = (length, numberOffset = 0, idOffset = 0) => (
    Array.from({ length }, (_, index) => ({
      position: index + 1,
      resultId: idOffset + index + 1,
      number: (numberOffset + index) % 37,
      settledAt: new Date(start + index * 1_000).toISOString(),
    }))
  );
  const targetEvents = events(20);
  const analogueEvents = events(25, 11, 100);
  const latest = {
    id: 20,
    number: 19,
    cycleId: 7,
    settledAt: targetEvents.at(-1).settledAt,
  };
  const activeCycle = {
    id: 7,
    status: "active",
    integrityStatus: "ok",
    eventCount: 20,
    totalDraws: 20,
  };
  const comparison = {
    schemaVersion: 1,
    algorithmVersion: "cycle-analogue-prefix-v1",
    interpretation: "descriptive-not-predictive",
    anchorDrawCount: 20,
    anchorResultId: 20,
    status: "ready",
    target: {
      mode: "active",
      cycle: {
        id: 7,
        status: "active",
        integrityStatus: "ok",
        eventCount: 20,
        totalDraws: 20,
      },
      events: targetEvents,
    },
    analogue: {
      cycle: {
        id: 2,
        status: "completed",
        integrityStatus: "ok",
        eventCount: 25,
        totalDraws: 25,
      },
      events: analogueEvents,
    },
  };

  assert.deepEqual(
    combinedCycleAnalogueRanking(comparison, activeCycle, latest),
    [analogueEvents[20].number],
  );
  assert.deepEqual(combinedCycleAnalogueRanking({
    ...comparison,
    anchorResultId: 19,
  }, activeCycle, latest), []);
  assert.deepEqual(combinedCycleAnalogueRanking({
    ...comparison,
    analogue: { ...comparison.analogue, events: analogueEvents.slice(0, 20), cycle: {
      ...comparison.analogue.cycle,
      eventCount: 20,
      totalDraws: 20,
    } },
  }, activeCycle, latest), []);
});

test("triple follower adapter enforces the atomic current cursor and ranking", () => {
  const latest = {
    id: 12,
    number: 4,
    continuityEpoch: 2,
    settledAt: "2026-10-09T15:01:48Z",
  };
  const signal = {
    schemaVersion: 1,
    algorithmVersion: "triple-follower-current-v1",
    definition: "next-result-after-ordered-pair-within-continuity-epoch",
    tieBreak: "occurrence-count-desc,last-occurred-at-desc,number-asc",
    status: "ready",
    historyThroughResultId: 12,
    historyThrough: "2026-10-09T15:01:48.000Z",
    anchor: {
      continuityEpoch: 2,
      previous: {
        resultId: 11,
        number: 36,
        settledAt: "2026-10-09T15:01:30Z",
      },
      current: {
        resultId: 12,
        number: 4,
        settledAt: "2026-10-09T15:01:48Z",
      },
    },
    sampleSize: 3,
    observedFollowerCount: 2,
    candidates: [
      {
        rank: 1,
        number: 7,
        occurrenceCount: 2,
        share: 2 / 3,
        lastOccurredAt: "2026-10-09T14:00:00Z",
      },
      {
        rank: 2,
        number: 8,
        occurrenceCount: 1,
        share: 1 / 3,
        lastOccurredAt: "2026-10-09T13:00:00Z",
      },
    ],
  };
  assert.deepEqual(combinedTripleFollowerRanking(signal, latest), [7, 8]);
  assert.equal(combinedTripleFollowerRanking({
    ...signal,
    historyThroughResultId: 11,
  }, latest), null);
  assert.equal(combinedTripleFollowerRanking({
    ...signal,
    candidates: [...signal.candidates].reverse(),
  }, latest), null);
});

test("overdue adapter follows the displayed recency order without averaging labels", () => {
  assert.deepEqual(combinedOverdueRanking([
    { number: 3, roundsSinceLast: 10, lastSeenAt: "2026-10-09T10:00:00Z" },
    { number: 8, roundsSinceLast: 12, lastSeenAt: "2026-10-09T11:00:00Z" },
    { number: 9, roundsSinceLast: 10, lastSeenAt: "2026-10-09T09:00:00Z" },
    { number: 2, roundsSinceLast: null, lastSeenAt: null },
  ]), [8, 9, 3]);
});

test("one ranked family still produces exactly one leader", () => {
  const result = combineNumberRankings([
    { id: "price", family: "price", numbers: [12, 16, 7] },
  ], { tieSeed: "round-4103913" });

  assert.equal(result.version, COMBINED_NUMBER_ALGORITHM_VERSION);
  assert.equal(result.status, "ranked");
  assert.equal(result.number, 12);
  assert.ok(Math.abs(result.score - 0.5) < 1e-12);
  assert.equal(result.sourceCount, 1);
  assert.equal(result.familyCount, 1);
  assert.equal(result.supportCount, 1);
  assert.equal(result.familySupportCount, 1);
  assert.equal(result.tieCount, 1);
  assert.equal(result.tieBreakApplied, false);
  assert.deepEqual(result.sourceIds, ["price"]);
  assert.deepEqual(result.familyIds, ["price"]);
});

test("disjoint families still return one strongest ranked number", () => {
  const result = combineNumberRankings([
    { id: "price", family: "price", numbers: [18, 19, 17] },
    { id: "transition", family: "transition", numbers: [32] },
  ], { tieSeed: "round-4103913" });

  assert.equal(result.status, "ranked");
  assert.equal(result.number, 32);
  assert.ok(Math.abs(result.score - 0.5) < 1e-12);
  assert.equal(result.sourceCount, 2);
  assert.equal(result.familyCount, 2);
  assert.equal(result.familySupportCount, 1);
  assert.equal(result.tieBreakApplied, false);
});

test("unordered sets give every member equal weight and ignore input order", () => {
  const forward = combineNumberRankings([
    { id: "remaining", family: "cycle", mode: "set", numbers: [9, 3, 12] },
  ], { tieSeed: "cycle-144" });
  const reordered = combineNumberRankings([
    { id: "remaining", family: "cycle", mode: "set", numbers: [12, 9, 3] },
  ], { tieSeed: "cycle-144" });

  assert.deepEqual(reordered, forward);
  assert.equal(forward.status, "ranked");
  assert.ok([3, 9, 12].includes(forward.number));
  assert.ok(Math.abs(forward.score - (1 / 3)) < 1e-12);
  assert.equal(forward.tieCount, 3);
  assert.equal(forward.tieBreakApplied, true);
});

test("correlated sources are averaged inside their family before families are averaged", () => {
  const result = combineNumberRankings([
    { id: "price-model", family: "price", numbers: [1, 2] },
    { id: "price-q50", family: "price", numbers: [2] },
    { id: "transition", family: "transition", numbers: [2, 1] },
  ], { tieSeed: "round-4103913" });

  assert.equal(result.status, "ranked");
  assert.equal(result.number, 2);
  assert.ok(Math.abs(result.score - (2 / 3)) < 1e-12);
  assert.equal(result.sourceCount, 3);
  assert.equal(result.familyCount, 2);
  assert.equal(result.supportCount, 3);
  assert.equal(result.familySupportCount, 2);
  assert.equal(result.tieBreakApplied, false);
});

test("seeded tie resolution is deterministic and independent of source order", () => {
  const sources = [
    { id: "transition", family: "transition", numbers: [36, 0] },
    { id: "price", family: "price", numbers: [0, 36] },
  ];
  const forward = combineNumberRankings(sources, { tieSeed: "round-4103913" });
  const reversed = combineNumberRankings([...sources].reverse(), {
    tieSeed: "round-4103913",
  });

  assert.deepEqual(reversed, forward);
  assert.equal(forward.status, "ranked");
  assert.ok([0, 36].includes(forward.number));
  assert.ok(Math.abs(forward.score - 0.5) < 1e-12);
  assert.equal(forward.tieCount, 2);
  assert.equal(forward.tieBreakApplied, true);
  assert.equal(forward.familySupportCount, 2);

  const seededWinners = new Set(Array.from({ length: 100 }, (_, index) => (
    combineNumberRankings(sources, { tieSeed: `round-${index}` }).number
  )));
  assert.deepEqual([...seededWinners].sort((left, right) => left - right), [0, 36]);
});

test("invalid and duplicate sources add no weight while modes dedupe separately", () => {
  const sources = [
    { id: "model-a", family: "price", numbers: [12, 9] },
    { id: "model-copy", family: "price", numbers: [12, 9] },
    { id: "remaining-a", family: "cycle", mode: "set", numbers: [4, 8, 2] },
    { id: "remaining-copy", family: "cycle", mode: "set", numbers: [2, 4, 8] },
    { id: "cycle-ranking", family: "cycle", mode: "ranking", numbers: [2, 4, 8] },
    { id: "duplicate", family: "price", numbers: [12] },
    { id: "duplicate", family: "transition", numbers: [12] },
    { id: "repeated-number", family: "bad", numbers: [7, 7] },
    { id: "out-of-range", family: "bad", numbers: [37] },
    { id: "bad-mode", family: "bad", mode: "weighted", numbers: [1] },
    { id: "missing-family", numbers: [1] },
    null,
  ];
  const before = structuredClone(sources);
  const forward = combineNumberRankings(sources, { tieSeed: "stable" });
  const reversed = combineNumberRankings([...sources].reverse(), {
    tieSeed: "stable",
  });

  assert.deepEqual(sources, before);
  assert.deepEqual(reversed, forward);
  assert.equal(forward.status, "ranked");
  assert.equal(forward.number, 12);
  assert.equal(forward.sourceCount, 3);
  assert.equal(forward.familyCount, 2);
  assert.deepEqual(forward.sourceIds, [
    "cycle-ranking",
    "model-a",
    "remaining-a",
  ]);
  assert.deepEqual(forward.familyIds, ["cycle", "price"]);
});

test("empty input fails closed with the complete v3 result shape", () => {
  assert.deepEqual(combineNumberRankings([]), {
    version: COMBINED_NUMBER_ALGORITHM_VERSION,
    status: "unavailable",
    number: null,
    score: null,
    sourceCount: 0,
    familyCount: 0,
    supportCount: 0,
    familySupportCount: 0,
    tieCount: 0,
    tieBreakApplied: false,
    sourceIds: [],
    familyIds: [],
  });
  assert.deepEqual(combineNumberRankings(null), combineNumberRankings([]));
});
