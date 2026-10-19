export const PREDICTIVE_LEADER_V7_PAPER_LADDER_SCHEMA_VERSION = 2;
export const PREDICTIVE_LEADER_V7_PAPER_LADDER_STRATEGY_VERSION =
  'predictive-leader-v7-manual-override-paper-ladder-v2';
export const PREDICTIVE_LEADER_V7_PAPER_LADDER_CAMPAIGN_KEY =
  'v7-manual-override-paper-ladder-20261019';
export const PREDICTIVE_LEADER_V7_PAPER_LADDER_RESET_POLICY =
  'clamp-final-stake-reset-at-cycle-cap-v1';

export const PREDICTIVE_LEADER_V7_PAPER_LADDER_RESET_REASONS = Object.freeze({
  hit: 'hit',
  cycleSpendCap: 'cycle_spend_cap',
});

export const PREDICTIVE_LEADER_V7_PAPER_LADDER_PENDING_RESET_REASON =
  PREDICTIVE_LEADER_V7_PAPER_LADDER_RESET_REASONS.cycleSpendCap;

export const PREDICTIVE_LEADER_V7_PAPER_LADDER_MODEL = Object.freeze({
  kind: 'loss-recovery-ladder',
  initialBalance: 10_000,
  initialStake: 10,
  stakeStep: 10,
  maxStake: 2_500,
  cycleSpendLimit: 1_000,
  resetPolicy: PREDICTIVE_LEADER_V7_PAPER_LADDER_RESET_POLICY,
  grossPayoutMultiplier: 36,
  payoutIncludesStake: true,
});

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireSafeInteger(value, label, { minimum = 0, maximum } = {}) {
  if (
    !Number.isSafeInteger(value)
    || value < minimum
    || (maximum !== undefined && value > maximum)
  ) {
    const upperBound = maximum === undefined ? '' : ` and at most ${maximum}`;
    throw new TypeError(
      `${label} must be a safe integer of at least ${minimum}${upperBound}`,
    );
  }
  return value;
}

function requireSafeProduct(left, right, label) {
  const product = left * right;
  if (!Number.isSafeInteger(product)) {
    throw new RangeError(`${label} exceeds the safe integer range`);
  }
  return product;
}

function requireSafeSum(left, right, label) {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw new RangeError(`${label} exceeds the safe integer range`);
  }
  return sum;
}

function requireRouletteNumber(value, label) {
  return requireSafeInteger(value, label, { minimum: 0, maximum: 36 });
}

export function validatePredictiveLeaderV7PaperLadderModel(
  model = PREDICTIVE_LEADER_V7_PAPER_LADDER_MODEL,
) {
  const value = requireObject(model, 'model');
  if (value.kind !== PREDICTIVE_LEADER_V7_PAPER_LADDER_MODEL.kind) {
    throw new RangeError('model.kind is not supported');
  }
  if (value.resetPolicy !== PREDICTIVE_LEADER_V7_PAPER_LADDER_RESET_POLICY) {
    throw new RangeError('model.resetPolicy is not supported');
  }
  if (value.payoutIncludesStake !== true) {
    throw new RangeError('model.payoutIncludesStake must be true');
  }

  const initialBalance = requireSafeInteger(
    value.initialBalance,
    'model.initialBalance',
    { minimum: 1 },
  );
  const initialStake = requireSafeInteger(
    value.initialStake,
    'model.initialStake',
    { minimum: 1 },
  );
  const stakeStep = requireSafeInteger(
    value.stakeStep,
    'model.stakeStep',
    { minimum: 1 },
  );
  const maxStake = requireSafeInteger(
    value.maxStake,
    'model.maxStake',
    { minimum: 1 },
  );
  const cycleSpendLimit = requireSafeInteger(
    value.cycleSpendLimit,
    'model.cycleSpendLimit',
    { minimum: 1 },
  );
  const grossPayoutMultiplier = requireSafeInteger(
    value.grossPayoutMultiplier,
    'model.grossPayoutMultiplier',
    { minimum: 2 },
  );

  if (initialBalance < initialStake) {
    throw new RangeError('model.initialBalance cannot be smaller than initialStake');
  }
  if (maxStake < initialStake || maxStake < stakeStep) {
    throw new RangeError('model.maxStake cannot be smaller than the stake floor');
  }
  if (cycleSpendLimit < initialStake) {
    throw new RangeError('model.cycleSpendLimit cannot be smaller than initialStake');
  }
  if (
    initialStake % stakeStep !== 0
    || maxStake % stakeStep !== 0
    || cycleSpendLimit % stakeStep !== 0
  ) {
    throw new RangeError('model stake amounts must be multiples of stakeStep');
  }

  const netPayoutMultiplier = grossPayoutMultiplier - 1;
  const lossCoveredPerStep = requireSafeProduct(
    netPayoutMultiplier,
    stakeStep,
    'model loss coverage per step',
  );

  return Object.freeze({
    kind: value.kind,
    initialBalance,
    initialStake,
    stakeStep,
    maxStake,
    cycleSpendLimit,
    resetPolicy: value.resetPolicy,
    grossPayoutMultiplier,
    payoutIncludesStake: true,
    netPayoutMultiplier,
    lossCoveredPerStep,
  });
}

function requireLadderAmount(value, label, model, { allowLimit = true } = {}) {
  const maximum = allowLimit
    ? model.cycleSpendLimit
    : model.cycleSpendLimit - model.stakeStep;
  const amount = requireSafeInteger(value, label, { minimum: 0, maximum });
  if (amount % model.stakeStep !== 0) {
    throw new RangeError(`${label} must be a multiple of model.stakeStep`);
  }
  return amount;
}

function resolveNextStakeArguments(ladderLoss, cycleSpendOrModel, maybeModel) {
  if (
    cycleSpendOrModel
    && typeof cycleSpendOrModel === 'object'
    && !Array.isArray(cycleSpendOrModel)
    && maybeModel === undefined
  ) {
    return {
      ladderLoss,
      cycleSpend: ladderLoss,
      model: cycleSpendOrModel,
    };
  }
  return {
    ladderLoss,
    cycleSpend: cycleSpendOrModel === undefined ? ladderLoss : cycleSpendOrModel,
    model: maybeModel ?? PREDICTIVE_LEADER_V7_PAPER_LADDER_MODEL,
  };
}

export function calculatePredictiveLeaderV7PaperRawStake(
  ladderLoss,
  model = PREDICTIVE_LEADER_V7_PAPER_LADDER_MODEL,
) {
  const safeModel = validatePredictiveLeaderV7PaperLadderModel(model);
  const safeLoss = requireLadderAmount(ladderLoss, 'ladderLoss', safeModel);
  const requiredSteps = Math.max(
    1,
    Math.ceil(safeLoss / safeModel.lossCoveredPerStep),
  );
  const steppedStake = requireSafeProduct(
    safeModel.stakeStep,
    requiredSteps,
    'raw stake',
  );
  return Math.min(
    safeModel.maxStake,
    Math.max(safeModel.initialStake, steppedStake),
  );
}

export function calculatePredictiveLeaderV7PaperNextStake(
  ladderLoss,
  cycleSpendOrModel,
  maybeModel,
) {
  const resolved = resolveNextStakeArguments(
    ladderLoss,
    cycleSpendOrModel,
    maybeModel,
  );
  const safeModel = validatePredictiveLeaderV7PaperLadderModel(resolved.model);
  const safeLoss = requireLadderAmount(
    resolved.ladderLoss,
    'ladderLoss',
    safeModel,
  );
  const safeCycleSpend = requireLadderAmount(
    resolved.cycleSpend,
    'cycleSpend',
    safeModel,
  );
  if (safeLoss > safeCycleSpend) {
    throw new RangeError('ladderLoss cannot exceed cycleSpend');
  }
  if (safeCycleSpend === safeModel.cycleSpendLimit) {
    return safeModel.initialStake;
  }

  const rawStake = calculatePredictiveLeaderV7PaperRawStake(safeLoss, safeModel);
  const remaining = safeModel.cycleSpendLimit - safeCycleSpend;
  const actualStake = Math.min(rawStake, remaining);
  if (
    actualStake < safeModel.stakeStep
    || actualStake % safeModel.stakeStep !== 0
  ) {
    throw new RangeError('clamped stake is outside the model stake grid');
  }
  return actualStake;
}

export function createPredictiveLeaderV7PaperLadderCursor(
  model = PREDICTIVE_LEADER_V7_PAPER_LADDER_MODEL,
) {
  const safeModel = validatePredictiveLeaderV7PaperLadderModel(model);
  return Object.freeze({
    cycleSpend: 0,
    ladderLoss: 0,
    cycleMissCount: 0,
    nextStake: calculatePredictiveLeaderV7PaperNextStake(0, 0, safeModel),
  });
}

export function settlePredictiveLeaderV7PaperLadderBet({
  targetNumber,
  resultNumber,
  stake,
  balanceBefore,
  cycleSpendBefore,
  ladderLossBefore = cycleSpendBefore,
  cycleMissCountBefore,
  model = PREDICTIVE_LEADER_V7_PAPER_LADDER_MODEL,
} = {}) {
  const safeModel = validatePredictiveLeaderV7PaperLadderModel(model);
  const safeTargetNumber = requireRouletteNumber(targetNumber, 'targetNumber');
  const safeResultNumber = requireRouletteNumber(resultNumber, 'resultNumber');
  const safeBalanceBefore = requireSafeInteger(balanceBefore, 'balanceBefore');
  const safeCycleSpendBefore = requireLadderAmount(
    cycleSpendBefore,
    'cycleSpendBefore',
    safeModel,
    { allowLimit: false },
  );
  const safeLadderLossBefore = requireLadderAmount(
    ladderLossBefore,
    'ladderLossBefore',
    safeModel,
    { allowLimit: false },
  );
  const safeMissCountBefore = requireSafeInteger(
    cycleMissCountBefore,
    'cycleMissCountBefore',
  );
  if (safeLadderLossBefore !== safeCycleSpendBefore) {
    throw new RangeError('ladderLossBefore must equal cycleSpendBefore');
  }
  if (
    (safeCycleSpendBefore === 0) !== (safeMissCountBefore === 0)
    || safeMissCountBefore > safeCycleSpendBefore / safeModel.stakeStep
  ) {
    throw new RangeError('cycle miss cursor is inconsistent with cycle spend');
  }

  const safeStake = requireSafeInteger(stake, 'stake', { minimum: 1 });
  if (safeStake % safeModel.stakeStep !== 0) {
    throw new RangeError('stake must be a multiple of model.stakeStep');
  }
  const rawStakeBefore = calculatePredictiveLeaderV7PaperRawStake(
    safeLadderLossBefore,
    safeModel,
  );
  const expectedStake = calculatePredictiveLeaderV7PaperNextStake(
    safeLadderLossBefore,
    safeCycleSpendBefore,
    safeModel,
  );
  if (safeStake !== expectedStake) {
    throw new RangeError('stake must equal the frozen ladder next stake');
  }
  if (safeStake > safeBalanceBefore) {
    throw new RangeError('stake must be affordable');
  }

  const cycleSpendAtSettlement = requireSafeSum(
    safeCycleSpendBefore,
    safeStake,
    'cycleSpendAtSettlement',
  );
  if (cycleSpendAtSettlement > safeModel.cycleSpendLimit) {
    throw new RangeError('cycle spend exceeds model.cycleSpendLimit');
  }
  const hit = safeTargetNumber === safeResultNumber;
  const grossPayout = hit
    ? requireSafeProduct(
        safeStake,
        safeModel.grossPayoutMultiplier,
        'grossPayout',
      )
    : 0;
  const debitedBalance = safeBalanceBefore - safeStake;
  const balanceAfter = requireSafeSum(
    debitedBalance,
    grossPayout,
    'balanceAfter',
  );
  const spendCapReached = cycleSpendAtSettlement === safeModel.cycleSpendLimit;
  const resetReason = hit
    ? PREDICTIVE_LEADER_V7_PAPER_LADDER_RESET_REASONS.hit
    : spendCapReached
      ? PREDICTIVE_LEADER_V7_PAPER_LADDER_RESET_REASONS.cycleSpendCap
      : null;
  const cycleReset = resetReason !== null;
  const cycleMissCountAtSettlement = requireSafeSum(
    safeMissCountBefore,
    Number(!hit),
    'cycleMissCountAtSettlement',
  );
  const cycleSpendAfter = cycleReset ? 0 : cycleSpendAtSettlement;
  const ladderLossAfter = cycleReset ? 0 : cycleSpendAtSettlement;
  const cycleMissCountAfter = cycleReset ? 0 : cycleMissCountAtSettlement;
  const nextStakeAfter = calculatePredictiveLeaderV7PaperNextStake(
    ladderLossAfter,
    cycleSpendAfter,
    safeModel,
  );
  const recoverableLoss = requireSafeProduct(
    safeModel.netPayoutMultiplier,
    safeStake,
    'recoverableLoss',
  );
  const recoveryPossible = recoverableLoss >= safeLadderLossBefore;
  const cycleNetResult = hit
    ? grossPayout - cycleSpendAtSettlement
    : -cycleSpendAtSettlement;

  return Object.freeze({
    outcome: hit ? 'hit' : 'miss',
    grossPayout,
    balanceAfter,
    rawStakeBefore,
    stake: safeStake,
    stakeClamped: safeStake < rawStakeBefore,
    recoveryPossible,
    cycleNetResult,
    cycleSpendBefore: safeCycleSpendBefore,
    ladderLossBefore: safeLadderLossBefore,
    cycleMissCountBefore: safeMissCountBefore,
    cycleSpendAtSettlement,
    cycleMissCountAtSettlement,
    spendCapReached,
    cycleReset,
    resetReason,
    cycleSpendAfter,
    ladderLossAfter,
    cycleMissCountAfter,
    nextStakeAfter,
  });
}
