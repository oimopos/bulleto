import {
  calculateNextVirtualStake,
  settleVirtualBet,
} from './virtual-bettor.js';

export const VIRTUAL_WINDOW_BET_MODEL = Object.freeze({
  strategyKey: 'virtual-overdue-window-160-200-v1',
  triggerThreshold: 160,
  stopThreshold: 200,
  initialStake: 10,
  stakeStep: 10,
  maxStake: 2_500,
  grossPayoutMultiplier: 36,
  payoutIncludesStake: true,
  initialBalance: 10_000,
  modelVersion: '2.0.0',
});

export function virtualWindowAttemptBudget(triggerAge) {
  if (!Number.isSafeInteger(triggerAge)) {
    throw new TypeError('triggerAge must be a safe integer');
  }
  if (
    triggerAge < VIRTUAL_WINDOW_BET_MODEL.triggerThreshold
    || triggerAge >= VIRTUAL_WINDOW_BET_MODEL.stopThreshold
  ) {
    throw new RangeError('triggerAge must be inside the 160..199 window');
  }
  return VIRTUAL_WINDOW_BET_MODEL.stopThreshold - triggerAge;
}

export function virtualWindowCandidateEligible(age) {
  return Number.isSafeInteger(age)
    && age >= VIRTUAL_WINDOW_BET_MODEL.triggerThreshold
    && age < VIRTUAL_WINDOW_BET_MODEL.stopThreshold;
}

export function virtualWindowStake(priorTotalStaked) {
  return calculateNextVirtualStake(priorTotalStaked, VIRTUAL_WINDOW_BET_MODEL);
}

export function settleVirtualWindowBet({
  targetNumber,
  resultNumber,
  stake,
  priorTotalStaked,
} = {}) {
  return settleVirtualBet({
    targetNumber,
    resultNumber,
    stake,
    priorTotalStaked,
    model: VIRTUAL_WINDOW_BET_MODEL,
  });
}
