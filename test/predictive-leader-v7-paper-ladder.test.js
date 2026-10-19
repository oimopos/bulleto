import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PREDICTIVE_LEADER_V7_PAPER_LADDER_CAMPAIGN_KEY,
  PREDICTIVE_LEADER_V7_PAPER_LADDER_MODEL,
  PREDICTIVE_LEADER_V7_PAPER_LADDER_PENDING_RESET_REASON,
  PREDICTIVE_LEADER_V7_PAPER_LADDER_RESET_POLICY,
  PREDICTIVE_LEADER_V7_PAPER_LADDER_RESET_REASONS,
  PREDICTIVE_LEADER_V7_PAPER_LADDER_SCHEMA_VERSION,
  PREDICTIVE_LEADER_V7_PAPER_LADDER_STRATEGY_VERSION,
  calculatePredictiveLeaderV7PaperNextStake,
  calculatePredictiveLeaderV7PaperRawStake,
  createPredictiveLeaderV7PaperLadderCursor,
  settlePredictiveLeaderV7PaperLadderBet,
  validatePredictiveLeaderV7PaperLadderModel,
} from '../src/predictive-leader-v7-paper-ladder.js';

test('v7 paper ladder publishes the frozen v2 campaign contract', () => {
  assert.equal(PREDICTIVE_LEADER_V7_PAPER_LADDER_SCHEMA_VERSION, 2);
  assert.equal(
    PREDICTIVE_LEADER_V7_PAPER_LADDER_STRATEGY_VERSION,
    'predictive-leader-v7-manual-override-paper-ladder-v2',
  );
  assert.equal(
    PREDICTIVE_LEADER_V7_PAPER_LADDER_CAMPAIGN_KEY,
    'v7-manual-override-paper-ladder-20261019',
  );
  assert.equal(
    PREDICTIVE_LEADER_V7_PAPER_LADDER_RESET_POLICY,
    'clamp-final-stake-reset-at-cycle-cap-v1',
  );
  assert.equal(PREDICTIVE_LEADER_V7_PAPER_LADDER_PENDING_RESET_REASON, 'cycle_spend_cap');
  assert.deepEqual(PREDICTIVE_LEADER_V7_PAPER_LADDER_RESET_REASONS, {
    hit: 'hit',
    cycleSpendCap: 'cycle_spend_cap',
  });
  assert.deepEqual(PREDICTIVE_LEADER_V7_PAPER_LADDER_MODEL, {
    kind: 'loss-recovery-ladder',
    initialBalance: 10_000,
    initialStake: 10,
    stakeStep: 10,
    maxStake: 2_500,
    cycleSpendLimit: 1_000,
    resetPolicy: 'clamp-final-stake-reset-at-cycle-cap-v1',
    grossPayoutMultiplier: 36,
    payoutIncludesStake: true,
  });
  assert.ok(Object.isFrozen(PREDICTIVE_LEADER_V7_PAPER_LADDER_MODEL));
  assert.ok(Object.isFrozen(PREDICTIVE_LEADER_V7_PAPER_LADDER_RESET_REASONS));
  assert.deepEqual(createPredictiveLeaderV7PaperLadderCursor(), {
    cycleSpend: 0,
    ladderLoss: 0,
    cycleMissCount: 0,
    nextStake: 10,
  });
});

test('raw recovery stake follows the 35x ladder and actual stake clamps to cycle remainder', () => {
  const boundaries = [
    [0, 10],
    [350, 10],
    [360, 20],
    [700, 20],
    [720, 30],
    [990, 30],
    [1_000, 30],
  ];
  for (const [loss, expected] of boundaries) {
    assert.equal(calculatePredictiveLeaderV7PaperRawStake(loss), expected);
  }

  assert.equal(calculatePredictiveLeaderV7PaperNextStake(720), 30);
  assert.equal(calculatePredictiveLeaderV7PaperNextStake(990), 10);
  assert.equal(calculatePredictiveLeaderV7PaperNextStake(990, 990), 10);
  assert.equal(
    calculatePredictiveLeaderV7PaperNextStake(
      990,
      PREDICTIVE_LEADER_V7_PAPER_LADDER_MODEL,
    ),
    10,
  );
  assert.equal(
    calculatePredictiveLeaderV7PaperNextStake(1_000, 1_000),
    10,
    'a completed boundary denotes the already-reset next cursor',
  );
});

test('a loss series spends exactly 1000 and resets only after the terminal miss', () => {
  let balance = PREDICTIVE_LEADER_V7_PAPER_LADDER_MODEL.initialBalance;
  let { cycleSpend, ladderLoss, cycleMissCount, nextStake } =
    createPredictiveLeaderV7PaperLadderCursor();
  let terminal = null;

  for (let attempt = 1; attempt <= 64; attempt += 1) {
    const settlement = settlePredictiveLeaderV7PaperLadderBet({
      targetNumber: 7,
      resultNumber: 8,
      stake: nextStake,
      balanceBefore: balance,
      cycleSpendBefore: cycleSpend,
      ladderLossBefore: ladderLoss,
      cycleMissCountBefore: cycleMissCount,
    });
    balance = settlement.balanceAfter;
    cycleSpend = settlement.cycleSpendAfter;
    ladderLoss = settlement.ladderLossAfter;
    cycleMissCount = settlement.cycleMissCountAfter;
    nextStake = settlement.nextStakeAfter;

    if (attempt === 36) {
      assert.equal(cycleSpend, 360);
      assert.equal(nextStake, 20);
    }
    if (attempt === 54) {
      assert.equal(cycleSpend, 720);
      assert.equal(nextStake, 30);
    }
    if (attempt === 63) {
      assert.equal(cycleSpend, 990);
      assert.equal(settlement.rawStakeBefore, 30);
      assert.equal(nextStake, 10);
      assert.equal(settlement.cycleReset, false);
    }
    if (attempt === 64) terminal = settlement;
  }

  assert.equal(balance, 9_000);
  assert.equal(terminal.rawStakeBefore, 30);
  assert.equal(terminal.stake, 10);
  assert.equal(terminal.stakeClamped, true);
  assert.equal(terminal.recoveryPossible, false);
  assert.equal(terminal.cycleSpendAtSettlement, 1_000);
  assert.equal(terminal.cycleMissCountAtSettlement, 64);
  assert.equal(terminal.spendCapReached, true);
  assert.equal(terminal.cycleReset, true);
  assert.equal(terminal.resetReason, 'cycle_spend_cap');
  assert.equal(terminal.cycleSpendAfter, 0);
  assert.equal(terminal.ladderLossAfter, 0);
  assert.equal(terminal.cycleMissCountAfter, 0);
  assert.equal(terminal.nextStakeAfter, 10);

  const firstMissOfNextCycle = settlePredictiveLeaderV7PaperLadderBet({
    targetNumber: 7,
    resultNumber: 8,
    stake: terminal.nextStakeAfter,
    balanceBefore: terminal.balanceAfter,
    cycleSpendBefore: terminal.cycleSpendAfter,
    ladderLossBefore: terminal.ladderLossAfter,
    cycleMissCountBefore: terminal.cycleMissCountAfter,
  });
  assert.equal(firstMissOfNextCycle.cycleSpendAfter, 10);
  assert.equal(firstMissOfNextCycle.cycleMissCountAfter, 1);
  assert.equal(firstMissOfNextCycle.resetReason, null);
});

test('a hit pays the actual stake and resets the cursor to ten', () => {
  const settlement = settlePredictiveLeaderV7PaperLadderBet({
    targetNumber: 7,
    resultNumber: 7,
    stake: 20,
    balanceBefore: 9_640,
    cycleSpendBefore: 360,
    ladderLossBefore: 360,
    cycleMissCountBefore: 36,
  });

  assert.equal(settlement.outcome, 'hit');
  assert.equal(settlement.grossPayout, 720);
  assert.equal(settlement.balanceAfter, 10_340);
  assert.equal(settlement.cycleNetResult, 340);
  assert.equal(settlement.recoveryPossible, true);
  assert.equal(settlement.cycleReset, true);
  assert.equal(settlement.resetReason, 'hit');
  assert.equal(settlement.cycleSpendAtSettlement, 380);
  assert.equal(settlement.cycleSpendAfter, 0);
  assert.equal(settlement.ladderLossAfter, 0);
  assert.equal(settlement.cycleMissCountAfter, 0);
  assert.equal(settlement.nextStakeAfter, 10);
});

test('a clamped hit is a hit reset rather than a loss-cap reset', () => {
  const settlement = settlePredictiveLeaderV7PaperLadderBet({
    targetNumber: 7,
    resultNumber: 7,
    stake: 10,
    balanceBefore: 9_010,
    cycleSpendBefore: 990,
    ladderLossBefore: 990,
    cycleMissCountBefore: 63,
  });

  assert.equal(settlement.stakeClamped, true);
  assert.equal(settlement.spendCapReached, true);
  assert.equal(settlement.recoveryPossible, false);
  assert.equal(settlement.grossPayout, 360);
  assert.equal(settlement.balanceAfter, 9_360);
  assert.equal(settlement.resetReason, 'hit');
  assert.equal(settlement.nextStakeAfter, 10);
});

test('model and cursor inputs are strictly validated', () => {
  const model = PREDICTIVE_LEADER_V7_PAPER_LADDER_MODEL;
  const invalidModels = [
    null,
    {},
    { ...model, kind: 'fixed' },
    { ...model, resetPolicy: 'silent-reset' },
    { ...model, payoutIncludesStake: false },
    { ...model, initialBalance: 9 },
    { ...model, initialStake: 11 },
    { ...model, stakeStep: 0 },
    { ...model, maxStake: 5 },
    { ...model, cycleSpendLimit: 995 },
    { ...model, grossPayoutMultiplier: 1 },
    { ...model, initialBalance: Number.MAX_SAFE_INTEGER + 1 },
  ];
  for (const invalid of invalidModels) {
    assert.throws(() => validatePredictiveLeaderV7PaperLadderModel(invalid));
  }

  for (const loss of [-10, 5, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => calculatePredictiveLeaderV7PaperRawStake(loss));
  }
  assert.throws(
    () => calculatePredictiveLeaderV7PaperNextStake(20, 10),
    /cannot exceed cycleSpend/,
  );
  assert.throws(() => calculatePredictiveLeaderV7PaperNextStake(0, 1_010));
});

test('settlement rejects an unfrozen, unaffordable, or inconsistent stake', () => {
  const base = {
    targetNumber: 7,
    resultNumber: 8,
    stake: 10,
    balanceBefore: 9_010,
    cycleSpendBefore: 990,
    ladderLossBefore: 990,
    cycleMissCountBefore: 63,
  };

  assert.throws(
    () => settlePredictiveLeaderV7PaperLadderBet({ ...base, stake: 30 }),
    /frozen ladder next stake/,
  );
  assert.throws(
    () => settlePredictiveLeaderV7PaperLadderBet({ ...base, balanceBefore: 9 }),
    /affordable/,
  );
  assert.throws(
    () => settlePredictiveLeaderV7PaperLadderBet({ ...base, ladderLossBefore: 980 }),
    /must equal cycleSpendBefore/,
  );
  assert.throws(
    () => settlePredictiveLeaderV7PaperLadderBet({ ...base, cycleMissCountBefore: 0 }),
    /miss cursor/,
  );
  assert.throws(
    () => settlePredictiveLeaderV7PaperLadderBet({ ...base, targetNumber: 37 }),
  );
  assert.throws(
    () => settlePredictiveLeaderV7PaperLadderBet({ ...base, resultNumber: 1.5 }),
  );
});
