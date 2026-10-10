import {
  VIRTUAL_BET_MODEL,
  calculateNextVirtualStake,
  settleVirtualBet,
} from './virtual-bettor.js';

export const PREDICTIVE_LEADER_ACCOUNT_SCHEMA_VERSION = 1;
export const PREDICTIVE_LEADER_ACCOUNT_STRATEGY_VERSION =
  'predictive-leader-single-ladder-v1';
export const PREDICTIVE_LEADER_ACCOUNT_STARTING_BALANCE = 1_000;

export const PREDICTIVE_LEADER_ACCOUNT_MODEL = Object.freeze({
  initialStake: VIRTUAL_BET_MODEL.initialStake,
  stakeStep: VIRTUAL_BET_MODEL.stakeStep,
  maxStake: VIRTUAL_BET_MODEL.maxStake,
  grossPayoutMultiplier: VIRTUAL_BET_MODEL.grossPayoutMultiplier,
  payoutIncludesStake: VIRTUAL_BET_MODEL.payoutIncludesStake,
});

function safeNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a safe non-negative integer`);
  }
  return value;
}

export function nextPredictiveLeaderStake(
  ladderLoss,
  model = PREDICTIVE_LEADER_ACCOUNT_MODEL,
) {
  return calculateNextVirtualStake(
    safeNonNegativeInteger(ladderLoss, 'ladderLoss'),
    model,
  );
}

export function settlePredictiveLeaderBet({
  targetNumber,
  resultNumber,
  stake,
  balanceBefore,
  ladderLossBefore,
  model = PREDICTIVE_LEADER_ACCOUNT_MODEL,
} = {}) {
  const safeBalance = safeNonNegativeInteger(balanceBefore, 'balanceBefore');
  const safeLadderLoss = safeNonNegativeInteger(
    ladderLossBefore,
    'ladderLossBefore',
  );
  if (!Number.isSafeInteger(stake) || stake <= 0 || stake > safeBalance) {
    throw new RangeError('stake must be affordable and positive');
  }
  const settlement = settleVirtualBet({
    targetNumber,
    resultNumber,
    stake,
    priorTotalStaked: safeLadderLoss,
    model,
  });
  const balanceAfter = safeBalance - stake + settlement.grossPayout;
  if (!Number.isSafeInteger(balanceAfter) || balanceAfter < 0) {
    throw new RangeError('balanceAfter is invalid');
  }
  const ladderMissCountDelta = settlement.outcome === 'miss' ? 1 : 0;
  return {
    ...settlement,
    balanceAfter,
    ladderLossAfter: settlement.outcome === 'hit' ? 0 : settlement.totalStaked,
    ladderMissCountDelta,
    nextStakeAfter: settlement.outcome === 'hit'
      ? nextPredictiveLeaderStake(0, model)
      : settlement.nextStake,
  };
}
