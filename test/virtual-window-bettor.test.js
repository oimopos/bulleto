import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VIRTUAL_WINDOW_BET_MODEL,
  settleVirtualWindowBet,
  virtualWindowAttemptBudget,
  virtualWindowCandidateEligible,
  virtualWindowStake,
} from '../src/virtual-window-bettor.js';

test('the virtual window accepts only trigger ages 160 through 199', () => {
  assert.equal(virtualWindowCandidateEligible(149), false);
  assert.equal(virtualWindowCandidateEligible(150), false);
  assert.equal(virtualWindowCandidateEligible(160), true);
  assert.equal(virtualWindowCandidateEligible(199), true);
  assert.equal(virtualWindowCandidateEligible(200), false);
  assert.equal(virtualWindowAttemptBudget(160), 40);
  assert.equal(virtualWindowAttemptBudget(199), 1);
  assert.throws(() => virtualWindowAttemptBudget(149), RangeError);
  assert.throws(() => virtualWindowAttemptBudget(200), RangeError);
});

test('the window model starts a fresh ten-thousand-unit bank', () => {
  assert.equal(VIRTUAL_WINDOW_BET_MODEL.initialBalance, 10_000);
  assert.equal(VIRTUAL_WINDOW_BET_MODEL.initialStake, 10);
  assert.equal(VIRTUAL_WINDOW_BET_MODEL.stopThreshold, 200);
  assert.equal(virtualWindowStake(0), 10);
  assert.equal(virtualWindowStake(360), 20);
});

test('forty misses from age 160 cost exactly 440 units', () => {
  let totalStaked = 0;
  let balance = VIRTUAL_WINDOW_BET_MODEL.initialBalance;
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    const stake = virtualWindowStake(totalStaked);
    const settlement = settleVirtualWindowBet({
      targetNumber: 7,
      resultNumber: 8,
      stake,
      priorTotalStaked: totalStaked,
    });
    totalStaked = settlement.totalStaked;
    balance -= stake;
  }
  assert.equal(totalStaked, 440);
  assert.equal(balance, 9_560);
});

test('a hit closes the window and returns the gross payout', () => {
  const settlement = settleVirtualWindowBet({
    targetNumber: 7,
    resultNumber: 7,
    stake: 10,
    priorTotalStaked: 20,
  });
  assert.equal(settlement.outcome, 'hit');
  assert.equal(settlement.grossPayout, 360);
  assert.equal(settlement.nextStake, null);
});
