export const VIRTUAL_BET_MODEL = Object.freeze({
  triggerThreshold: 200,
  initialStake: 10,
  stakeStep: 10,
  maxStake: 2_500,
  grossPayoutMultiplier: 36,
  payoutIncludesStake: true,
  modelVersion: '1.0.0',
});

function requireSafeNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a finite, safe, non-negative integer`);
  }
  return value;
}

function requireSafePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a finite, safe, positive integer`);
  }
  return value;
}

function requireRouletteNumber(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > 36) {
    throw new RangeError(`${name} must be an integer from 0 through 36`);
  }
  return value;
}

function requireSafeResult(value, name) {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} exceeds the safe integer range`);
  }
  return value;
}

function requireModel(model) {
  if (!model || typeof model !== 'object') {
    throw new TypeError('model must be an object');
  }
  const initialStake = requireSafePositiveInteger(
    model.initialStake,
    'model.initialStake',
  );
  const stakeStep = requireSafePositiveInteger(model.stakeStep, 'model.stakeStep');
  const maxStake = requireSafePositiveInteger(model.maxStake, 'model.maxStake');
  const grossPayoutMultiplier = requireSafePositiveInteger(
    model.grossPayoutMultiplier,
    'model.grossPayoutMultiplier',
  );
  if (typeof model.payoutIncludesStake !== 'boolean') {
    throw new TypeError('model.payoutIncludesStake must be a boolean');
  }
  const netPayoutMultiplier =
    grossPayoutMultiplier - (model.payoutIncludesStake ? 1 : 0);
  if (netPayoutMultiplier <= 0) {
    throw new RangeError('model must have a positive net payout multiplier');
  }
  if (maxStake < stakeStep) {
    throw new RangeError('model.maxStake cannot be smaller than model.stakeStep');
  }
  if (maxStake < initialStake) {
    throw new RangeError('model.maxStake cannot be smaller than model.initialStake');
  }
  return {
    initialStake,
    stakeStep,
    maxStake,
    grossPayoutMultiplier,
    netPayoutMultiplier,
  };
}

export function calculateNextVirtualStake(priorLoss, model = VIRTUAL_BET_MODEL) {
  const safePriorLoss = requireSafeNonNegativeInteger(priorLoss, 'priorLoss');
  const safeModel = requireModel(model);
  const lossCoveredPerStep = safeModel.netPayoutMultiplier * safeModel.stakeStep;
  const requiredSteps = Math.max(1, Math.ceil(safePriorLoss / lossCoveredPerStep));
  return Math.min(
    safeModel.maxStake,
    Math.max(safeModel.initialStake, safeModel.stakeStep * requiredSteps),
  );
}

export function settleVirtualBet({
  targetNumber,
  resultNumber,
  stake,
  priorTotalStaked,
  model = VIRTUAL_BET_MODEL,
} = {}) {
  const safeTargetNumber = requireRouletteNumber(targetNumber, 'targetNumber');
  const safeResultNumber = requireRouletteNumber(resultNumber, 'resultNumber');
  const safeStake = requireSafePositiveInteger(stake, 'stake');
  const safePriorTotalStaked = requireSafeNonNegativeInteger(
    priorTotalStaked,
    'priorTotalStaked',
  );
  const safeModel = requireModel(model);
  const totalStaked = requireSafeResult(
    safePriorTotalStaked + safeStake,
    'totalStaked',
  );
  const hit = safeTargetNumber === safeResultNumber;
  const grossPayout = hit
    ? requireSafeResult(
        safeStake * safeModel.grossPayoutMultiplier,
        'grossPayout',
      )
    : 0;
  const netResult = hit ? grossPayout - totalStaked : -totalStaked;
  const nextStake = hit ? null : calculateNextVirtualStake(totalStaked, model);
  const recoveryPossible = hit
    ? netResult >= 0
    : safeModel.netPayoutMultiplier * nextStake >= totalStaked;

  return {
    outcome: hit ? 'hit' : 'miss',
    grossPayout,
    totalStaked,
    netResult,
    nextStake,
    recoveryPossible,
  };
}
