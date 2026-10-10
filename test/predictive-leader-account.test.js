import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PREDICTIVE_LEADER_ACCOUNT_MODEL,
  PREDICTIVE_LEADER_ACCOUNT_STARTING_BALANCE,
  nextPredictiveLeaderStake,
  settlePredictiveLeaderBet,
} from '../src/predictive-leader-account.js';

test('predictive leader ladder uses the single-number 35x recovery model', () => {
  assert.deepEqual(PREDICTIVE_LEADER_ACCOUNT_MODEL, {
    initialStake: 10,
    stakeStep: 10,
    maxStake: 2_500,
    grossPayoutMultiplier: 36,
    payoutIncludesStake: true,
  });
  assert.equal(nextPredictiveLeaderStake(0), 10);
  assert.equal(nextPredictiveLeaderStake(350), 10);
  assert.equal(nextPredictiveLeaderStake(360), 20);
});

test('a first-hit paper bet grows the 1000 balance to 1350 and resets the ladder', () => {
  const result = settlePredictiveLeaderBet({
    targetNumber: 7,
    resultNumber: 7,
    stake: 10,
    balanceBefore: PREDICTIVE_LEADER_ACCOUNT_STARTING_BALANCE,
    ladderLossBefore: 0,
  });

  assert.equal(result.outcome, 'hit');
  assert.equal(result.grossPayout, 360);
  assert.equal(result.balanceAfter, 1_350);
  assert.equal(result.ladderLossAfter, 0);
  assert.equal(result.nextStakeAfter, 10);
});

test('a miss debits the balance and carries loss into the next ladder step', () => {
  const result = settlePredictiveLeaderBet({
    targetNumber: 7,
    resultNumber: 8,
    stake: 20,
    balanceBefore: 640,
    ladderLossBefore: 350,
  });

  assert.equal(result.outcome, 'miss');
  assert.equal(result.grossPayout, 0);
  assert.equal(result.balanceAfter, 620);
  assert.equal(result.ladderLossAfter, 370);
  assert.equal(result.nextStakeAfter, 20);
});

test('paper settlement rejects an unaffordable stake', () => {
  assert.throws(() => settlePredictiveLeaderBet({
    targetNumber: 7,
    resultNumber: 8,
    stake: 20,
    balanceBefore: 10,
    ladderLossBefore: 990,
  }), /affordable/);
});

test('a 1000-point account stops honestly after 63 consecutive misses', () => {
  let balance = PREDICTIVE_LEADER_ACCOUNT_STARTING_BALANCE;
  let ladderLoss = 0;

  for (let attempt = 1; attempt <= 63; attempt += 1) {
    const stake = nextPredictiveLeaderStake(ladderLoss);
    const settlement = settlePredictiveLeaderBet({
      targetNumber: 7,
      resultNumber: 8,
      stake,
      balanceBefore: balance,
      ladderLossBefore: ladderLoss,
    });
    balance = settlement.balanceAfter;
    ladderLoss = settlement.ladderLossAfter;

    if (attempt === 36) assert.equal(settlement.nextStakeAfter, 20);
    if (attempt === 54) assert.equal(settlement.nextStakeAfter, 30);
  }

  assert.equal(balance, 10);
  assert.equal(ladderLoss, 990);
  assert.equal(nextPredictiveLeaderStake(ladderLoss), 30);
  assert.ok(nextPredictiveLeaderStake(ladderLoss) > balance);
});
