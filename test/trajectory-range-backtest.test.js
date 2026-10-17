import assert from "node:assert/strict";
import test from "node:test";

import { runTrajectoryRangeBacktest } from "../src/trajectory-range-backtest.js";

const SIX_NUMBERS = Object.freeze([1, 2, 3, 4, 5, 6]);

function observation(index, overrides = {}) {
  return {
    resultId: index,
    externalRoundId: `round-${index}`,
    settledAt: new Date(Date.UTC(2026, 9, 17, 0, index)).toISOString(),
    forecastId: 1_000 + index,
    continuityEpoch: 1,
    availability: "ready",
    targetNumbers: [...SIX_NUMBERS],
    resultNumber: 36,
    ...overrides,
  };
}

test("trajectory range backtest replays a miss and hit with gross roulette payout", () => {
  const result = runTrajectoryRangeBacktest([
    observation(1),
    observation(2, { resultNumber: 3 }),
  ], { requestedRoundCount: 2 });

  assert.equal(result.status, "completed");
  assert.equal(result.executionEnabled, false);
  assert.equal(result.advisoryOnly, true);
  assert.equal(result.betCount, 2);
  assert.equal(result.hitCount, 1);
  assert.equal(result.missCount, 1);
  assert.equal(result.totalStaked, 120);
  assert.equal(result.totalGrossPayout, 360);
  assert.equal(result.finalBalance, 1_240);
  assert.equal(result.netResult, 240);
  assert.equal(result.rounds[0].stakePerNumber, 10);
  assert.equal(result.rounds[0].ladderLossAfter, 60);
  assert.equal(result.rounds[1].ladderLossBefore, 60);
  assert.equal(result.rounds[1].grossPayout, 360);
  assert.equal(result.rounds[1].ladderLossAfter, 0);
});

test("trajectory range backtest stops before the first unaffordable ticket", () => {
  const result = runTrajectoryRangeBacktest(
    Array.from({ length: 12 }, (_, index) => observation(index + 1)),
    { requestedRoundCount: 12 },
  );

  assert.equal(result.status, "exhausted");
  assert.equal(result.reason, "bankroll_exhausted");
  assert.equal(result.betCount, 10);
  assert.equal(result.finalBalance, 100);
  assert.equal(result.netResult, -900);
  assert.equal(result.rounds[9].stakePerNumber, 30);
  assert.equal(result.rounds[10].status, "not_played");
  assert.equal(result.rounds[10].ticketCost, 180);
  assert.equal(result.rounds[10].shortfall, 80);
  assert.equal(result.rounds[11].status, "not_played_after_exhaustion");
  assert.equal(result.coverage.skippedAfterExhaustionCount, 1);
});

test("trajectory range backtest never mutates ladder state after exhaustion", () => {
  const observations = Array.from(
    { length: 11 },
    (_, index) => observation(index + 1),
  );
  observations.push(observation(12, {
    continuityEpoch: 2,
    availability: "unavailable",
    targetNumbers: null,
  }));

  const result = runTrajectoryRangeBacktest(observations, {
    requestedRoundCount: observations.length,
  });

  assert.equal(result.status, "exhausted");
  assert.deepEqual(result.ladder, { missCount: 10, totalLoss: 900 });
  assert.equal(result.rounds[11].gapBefore, true);
  assert.equal(result.rounds[11].ladderResetBefore, false);
  assert.equal(result.rounds[11].status, "not_played_after_exhaustion");
  assert.equal(result.rounds[11].ladderLossAfter, 900);
  assert.equal(result.coverage.unavailableRangeCount, 1);
});

test("trajectory range backtest permits a ticket costing the whole balance", () => {
  const result = runTrajectoryRangeBacktest(
    [observation(1), observation(2)],
    {
      requestedRoundCount: 2,
      model: { initialBalance: 60 },
    },
  );

  assert.equal(result.rounds[0].status, "bet");
  assert.equal(result.rounds[0].balanceAfter, 0);
  assert.equal(result.rounds[1].status, "not_played");
  assert.equal(result.finalBalance, 0);
});

test("trajectory range backtest resets ladder loss at continuity gaps", () => {
  const result = runTrajectoryRangeBacktest([
    observation(1),
    observation(2, { continuityEpoch: 2 }),
  ], { requestedRoundCount: 2 });

  assert.equal(result.rounds[0].ladderLossAfter, 60);
  assert.equal(result.rounds[1].gapBefore, true);
  assert.equal(result.rounds[1].ladderLossBefore, 0);
  assert.equal(result.rounds[1].stakePerNumber, 10);
  assert.equal(result.coverage.continuityGapCount, 1);
});

test("trajectory range backtest skips unavailable and invalid ranges without changing balance", () => {
  const result = runTrajectoryRangeBacktest([
    observation(1),
    observation(2, { availability: "unavailable", targetNumbers: null }),
    observation(3, { targetNumbers: [1, 1] }),
    observation(4, { resultNumber: 2 }),
  ], { requestedRoundCount: 4 });

  assert.equal(result.betCount, 2);
  assert.equal(result.coverage.validRangeCount, 2);
  assert.equal(result.coverage.unavailableRangeCount, 1);
  assert.equal(result.coverage.invalidDataCount, 1);
  assert.equal(result.rounds[1].status, "skipped");
  assert.equal(result.rounds[1].balanceBefore, 940);
  assert.equal(result.rounds[1].ladderLossAfter, 60);
  assert.equal(result.rounds[2].skipReason, "invalid_snapshot");
  assert.equal(result.rounds[3].ladderLossBefore, 60);
});

test("trajectory range backtest uses the actual count of selected numbers", () => {
  const result = runTrajectoryRangeBacktest([
    observation(1, {
      targetNumbers: [0],
      resultNumber: 0,
      rawCell: 0,
      forecastDisplayHit: false,
      lockedAt: "2026-10-16T23:59:00.000Z",
    }),
  ], { requestedRoundCount: 1 });

  assert.equal(result.rounds[0].selectionCount, 1);
  assert.equal(result.rounds[0].ticketCost, 10);
  assert.equal(result.rounds[0].grossPayout, 360);
  assert.equal(result.finalBalance, 1_350);
  assert.equal(result.rounds[0].hit, true);
  assert.equal(result.rounds[0].forecastDisplayHit, false);
  assert.equal(result.rounds[0].rawCell, 0);
  assert.equal(result.rounds[0].lockedAt, "2026-10-16T23:59:00.000Z");
});
