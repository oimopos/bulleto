import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VIRTUAL_BET_MODEL,
  calculateNextVirtualStake,
  settleVirtualBet,
} from '../src/virtual-bettor.js';

test('the virtual bet model exposes stable frozen parameters', () => {
  assert.equal(Object.isFrozen(VIRTUAL_BET_MODEL), true);
  assert.deepEqual(VIRTUAL_BET_MODEL, {
    triggerThreshold: 200,
    initialStake: 10,
    stakeStep: 10,
    maxStake: 2_500,
    grossPayoutMultiplier: 36,
    payoutIncludesStake: true,
    modelVersion: '1.0.0',
  });
});

test('the next stake covers prior session losses in ten-point steps up to the cap', () => {
  const boundaries = [
    [0, 10],
    [350, 10],
    [360, 20],
    [700, 20],
    [720, 30],
    [85_260, 2_440],
    [87_700, 2_500],
  ];

  for (const [priorLoss, expectedStake] of boundaries) {
    assert.equal(calculateNextVirtualStake(priorLoss), expectedStake, `prior loss ${priorLoss}`);
  }
});

test('the next stake rejects invalid loss totals', () => {
  for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
    assert.throws(() => calculateNextVirtualStake(value), TypeError);
  }
});

test('a persisted model snapshot controls future stake calculations', () => {
  const snapshot = {
    initialStake: 20,
    stakeStep: 20,
    maxStake: 1_000,
    grossPayoutMultiplier: 36,
    payoutIncludesStake: true,
  };

  assert.equal(calculateNextVirtualStake(720, snapshot), 40);
  assert.equal(calculateNextVirtualStake(0, { ...snapshot, initialStake: 60 }), 60);
  assert.deepEqual(
    settleVirtualBet({
      targetNumber: 1,
      resultNumber: 2,
      stake: 20,
      priorTotalStaked: 700,
      model: snapshot,
    }),
    {
      outcome: 'miss',
      grossPayout: 0,
      totalStaked: 720,
      netResult: -720,
      nextStake: 40,
      recoveryPossible: true,
    },
  );
});

test('a hit returns gross payout and the net result for the whole session', () => {
  assert.deepEqual(
    settleVirtualBet({
      targetNumber: 31,
      resultNumber: 31,
      stake: 310,
      priorTotalStaked: 10_760,
    }),
    {
      outcome: 'hit',
      grossPayout: 11_160,
      totalStaked: 11_070,
      netResult: 90,
      nextStake: null,
      recoveryPossible: true,
    },
  );
});

test('a miss rolls the full session loss into the next stake', () => {
  assert.deepEqual(
    settleVirtualBet({
      targetNumber: 0,
      resultNumber: 36,
      stake: 10,
      priorTotalStaked: 350,
    }),
    {
      outcome: 'miss',
      grossPayout: 0,
      totalStaked: 360,
      netResult: -360,
      nextStake: 20,
      recoveryPossible: true,
    },
  );
});

test('the maximum stake reports when complete recovery is no longer possible', () => {
  assert.deepEqual(
    settleVirtualBet({
      targetNumber: 7,
      resultNumber: 7,
      stake: 2_500,
      priorTotalStaked: 87_700,
    }),
    {
      outcome: 'hit',
      grossPayout: 90_000,
      totalStaked: 90_200,
      netResult: -200,
      nextStake: null,
      recoveryPossible: false,
    },
  );

  assert.equal(
    settleVirtualBet({
      targetNumber: 7,
      resultNumber: 8,
      stake: 2_440,
      priorTotalStaked: 85_260,
    }).recoveryPossible,
    false,
  );
});

test('settlement validates roulette numbers and accounting inputs', () => {
  const valid = {
    targetNumber: 0,
    resultNumber: 36,
    stake: 10,
    priorTotalStaked: 0,
  };

  for (const targetNumber of [-1, 37, 1.5, Number.NaN]) {
    assert.throws(() => settleVirtualBet({ ...valid, targetNumber }), RangeError);
  }
  for (const resultNumber of [-1, 37, 1.5, Number.NaN]) {
    assert.throws(() => settleVirtualBet({ ...valid, resultNumber }), RangeError);
  }
  for (const stake of [0, -10, 1.5, Number.POSITIVE_INFINITY]) {
    assert.throws(() => settleVirtualBet({ ...valid, stake }), TypeError);
  }
  for (const priorTotalStaked of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => settleVirtualBet({ ...valid, priorTotalStaked }), TypeError);
  }
});
