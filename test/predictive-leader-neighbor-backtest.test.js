import assert from "node:assert/strict";
import test from "node:test";

import {
  numericNeighborTargetsForLeader,
  runPredictiveLeaderNeighborBacktest,
} from "../src/predictive-leader-neighbor-backtest.js";

function observation(index, overrides = {}) {
  return {
    resultId: index,
    externalRoundId: `round-${index}`,
    settledAt: new Date(Date.UTC(2026, 9, 17, 0, index)).toISOString(),
    forecastId: 1_000 + index,
    lockedAt: new Date(Date.UTC(2026, 9, 17, 0, index - 1, 30)).toISOString(),
    continuityEpoch: 1,
    availability: "ready",
    leaderNumber: 3,
    resultNumber: 20,
    ...overrides,
  };
}

test("numeric leader neighbors wrap around zero and 36", () => {
  assert.deepEqual(numericNeighborTargetsForLeader(3), [2, 3, 4]);
  assert.deepEqual(numericNeighborTargetsForLeader(0), [36, 0, 1]);
  assert.deepEqual(numericNeighborTargetsForLeader(36), [35, 36, 0]);
  assert.throws(() => numericNeighborTargetsForLeader(37), RangeError);
  assert.throws(() => numericNeighborTargetsForLeader(null), RangeError);
});

test("neighbor backtest pays gross roulette returns for exact and adjacent hits", () => {
  const result = runPredictiveLeaderNeighborBacktest([
    observation(1, { leaderNumber: 3, resultNumber: 2 }),
    observation(2, { leaderNumber: 0, resultNumber: 36 }),
    observation(3, { leaderNumber: 36, resultNumber: 36 }),
  ]);

  assert.equal(result.status, "completed");
  assert.equal(result.executionEnabled, false);
  assert.equal(result.advisoryOnly, true);
  assert.equal(result.betCount, 3);
  assert.equal(result.hitCount, 3);
  assert.equal(result.exactHitCount, 1);
  assert.equal(result.neighborOnlyHitCount, 2);
  assert.equal(result.totalStaked, 90);
  assert.equal(result.totalGrossPayout, 1_080);
  assert.equal(result.finalBalance, 1_990);
  assert.deepEqual(result.rounds[1].targetNumbers, [36, 0, 1]);
  assert.equal(result.rounds[1].hitKind, "previous_numeric_neighbor");
  assert.equal(result.rounds[2].hitKind, "exact");
});

test("neighbor ladder raises the per-number stake only enough to recover prior losses", () => {
  const misses = Array.from({ length: 12 }, (_, index) => observation(index + 1));
  const result = runPredictiveLeaderNeighborBacktest([
    ...misses,
    observation(13, { resultNumber: 4 }),
  ]);

  assert.equal(result.rounds[11].stakePerNumber, 10);
  assert.equal(result.rounds[11].ladderLossAfter, 360);
  assert.equal(result.rounds[12].requiredStakePerNumber, 20);
  assert.equal(result.rounds[12].stakePerNumber, 20);
  assert.equal(result.rounds[12].ticketCost, 60);
  assert.equal(result.rounds[12].grossPayout, 720);
  assert.equal(result.rounds[12].ladderLossAfter, 0);
  assert.equal(result.finalBalance, 1_300);
});

test("neighbor backtest stops before the first unaffordable ticket", () => {
  const result = runPredictiveLeaderNeighborBacktest([
    observation(1),
    observation(2),
    observation(3),
  ], {
    model: { initialBalance: 30 },
  });

  assert.equal(result.status, "exhausted");
  assert.equal(result.reason, "bankroll_exhausted");
  assert.equal(result.betCount, 1);
  assert.equal(result.finalBalance, 0);
  assert.equal(result.rounds[1].status, "not_played");
  assert.equal(result.rounds[1].ticketCost, 30);
  assert.equal(result.rounds[1].shortfall, 30);
  assert.equal(result.rounds[2].status, "not_played_after_exhaustion");
  assert.equal(result.coverage.skippedAfterExhaustionCount, 1);
});

test("continuity gaps reset ladder loss but keep the bankroll", () => {
  const observations = Array.from(
    { length: 12 },
    (_, index) => observation(index + 1),
  );
  observations.push(observation(13, { continuityEpoch: 2 }));

  const result = runPredictiveLeaderNeighborBacktest(observations);

  assert.equal(result.rounds[11].ladderLossAfter, 360);
  assert.equal(result.rounds[12].gapBefore, true);
  assert.equal(result.rounds[12].ladderResetBefore, true);
  assert.equal(result.rounds[12].ladderLossBefore, 0);
  assert.equal(result.rounds[12].stakePerNumber, 10);
  assert.equal(result.rounds[12].balanceBefore, 640);
  assert.equal(result.coverage.continuityGapCount, 1);
});

test("unavailable and invalid leaders are auditable skips that preserve ladder state", () => {
  const result = runPredictiveLeaderNeighborBacktest([
    observation(1),
    observation(2, { availability: "unavailable", leaderNumber: null }),
    observation(3, { leaderNumber: 50 }),
    observation(4, { resultNumber: 4 }),
  ]);

  assert.equal(result.betCount, 2);
  assert.equal(result.coverage.validLeaderCount, 2);
  assert.equal(result.coverage.unavailableLeaderCount, 1);
  assert.equal(result.coverage.invalidDataCount, 1);
  assert.equal(result.rounds[1].skipReason, "leader_unavailable");
  assert.equal(result.rounds[1].balanceAfter, 970);
  assert.equal(result.rounds[2].skipReason, "invalid_snapshot");
  assert.equal(result.rounds[3].ladderLossBefore, 30);
  assert.equal(result.rounds[3].stakePerNumber, 10);
  assert.equal(result.rounds[3].ladderLossAfter, 0);
  assert.equal(result.finalBalance, 1_300);
});

test("empty backtest has a stable advisory summary", () => {
  const result = runPredictiveLeaderNeighborBacktest([]);

  assert.equal(result.status, "empty");
  assert.equal(result.reason, "no_settled_rounds");
  assert.equal(result.hitRate, null);
  assert.equal(result.finalBalance, 1_000);
  assert.equal(result.coverage.completeWindow, true);
  assert.deepEqual(result.rounds, []);
});
