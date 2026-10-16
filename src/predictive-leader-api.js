import {
  LEARNED_LEADER_ALGORITHM_VERSION,
  LEARNED_LEADER_SCHEMA_VERSION,
  normalizeLearnedLeaderDecision,
} from './learned-leader.js';
import {
  PREDICTIVE_LEADER_ACCOUNT_MODEL,
  PREDICTIVE_LEADER_ACCOUNT_SCHEMA_VERSION,
  PREDICTIVE_LEADER_ACCOUNT_STARTING_BALANCE,
  PREDICTIVE_LEADER_ACCOUNT_STRATEGY_VERSION,
  nextPredictiveLeaderStake,
} from './predictive-leader-account.js';
import {
  PREDICTIVE_LEADER_QUALITY_GATE,
} from './predictive-leader-quality-gate.js';

export const PREDICTIVE_LEADER_API_SCHEMA_VERSION = 4;

const SUM_TOLERANCE = 1e-9;
const SIGNAL_ACCOUNT_SCHEMA_VERSION = 1;
const SIGNAL_ACCOUNT_STRATEGY_VERSION = 'quality-gated-fixed10-v1';
const SIGNAL_ACCOUNT_STARTING_BALANCE = 1_000;
const SIGNAL_ACCOUNT_STAKE = 10;
const SIGNAL_ACCOUNT_GROSS_PAYOUT_MULTIPLIER = 36;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeInteger(value, { minimum = 0 } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum ? number : null;
}

function safeRouletteNumber(value) {
  const number = safeInteger(value);
  return number !== null && number <= 36 ? number : null;
}

function instant(value) {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : null;
}

function sameInstant(left, right) {
  const leftMilliseconds = Date.parse(left);
  const rightMilliseconds = Date.parse(right);
  return Number.isFinite(leftMilliseconds)
    && Number.isFinite(rightMilliseconds)
    && leftMilliseconds === rightMilliseconds;
}

function strictInteger(value, { minimum = 0 } = {}) {
  return Number.isSafeInteger(value) && value >= minimum ? value : null;
}

function canonicalInstant(value) {
  const normalized = instant(value);
  return normalized === value ? normalized : null;
}

function exactAccountModel(value) {
  const expected = PREDICTIVE_LEADER_ACCOUNT_MODEL;
  const netHitMultiplier = expected.grossPayoutMultiplier - 1;
  if (
    !isPlainObject(value)
    || value.initialStake !== expected.initialStake
    || value.stakeStep !== expected.stakeStep
    || value.maxStake !== expected.maxStake
    || value.grossPayoutMultiplier !== expected.grossPayoutMultiplier
    || value.payoutIncludesStake !== expected.payoutIncludesStake
    || value.netHitMultiplier !== netHitMultiplier
  ) {
    return null;
  }
  return {
    initialStake: value.initialStake,
    stakeStep: value.stakeStep,
    maxStake: value.maxStake,
    grossPayoutMultiplier: value.grossPayoutMultiplier,
    payoutIncludesStake: value.payoutIncludesStake,
    netHitMultiplier: value.netHitMultiplier,
  };
}

const ACCOUNT_REASONS_BY_STATUS = Object.freeze({
  waiting: new Set(['waiting_first_frozen_leader', 'waiting_next_frozen_leader']),
  pending: new Set(['bet_frozen']),
  exhausted: new Set(['bankroll_exhausted']),
});

function integrityIsCurrent(state) {
  const warnings = Array.isArray(state?.warnings) ? state.warnings : [];
  const integrity = String(state?.activeCycle?.integrityStatus || '').toLowerCase();
  const integrityHasGap = Boolean(
    integrity && !['ok', 'complete', 'valid', 'verified'].includes(integrity),
  );
  const hasFreshActiveCycle =
    String(state?.activeCycle?.status || '').toLowerCase() === 'active'
    && !integrityHasGap;
  const warningHasGap = !hasFreshActiveCycle && warnings.some((warning) => {
    const type = String(warning?.type || '').toLowerCase();
    return type.includes('gap')
      || type.includes('missing')
      || type.includes('integrity');
  });
  return !integrityHasGap && !warningHasGap;
}

function metricsForApi(value) {
  if (
    !isPlainObject(value)
    || value.algorithmVersion !== LEARNED_LEADER_ALGORITHM_VERSION
  ) {
    return null;
  }
  const readyCount = safeInteger(value.readyCount);
  const settledCount = safeInteger(value.settledCount);
  const pendingCount = safeInteger(value.pendingCount);
  const top1Hits = safeInteger(value.top1Hits);
  if (
    readyCount === null
    || settledCount === null
    || pendingCount === null
    || top1Hits === null
    || settledCount > readyCount
    || pendingCount !== readyCount - settledCount
    || top1Hits > settledCount
  ) {
    return null;
  }

  const top1Rate = value.top1Rate;
  const meanBrierLoss = value.meanBrierLoss;
  const uniformBrierLoss = value.uniformBrierLoss;
  const beatsUniform = value.beatsUniform;
  if (
    (settledCount === 0 && (
      top1Rate !== null
      || meanBrierLoss !== null
      || beatsUniform !== null
    ))
    || (settledCount > 0 && (
      typeof top1Rate !== 'number'
      || !Number.isFinite(top1Rate)
      || Math.abs(top1Rate - top1Hits / settledCount) > SUM_TOLERANCE
      || typeof meanBrierLoss !== 'number'
      || !Number.isFinite(meanBrierLoss)
      || meanBrierLoss < 0
      || meanBrierLoss > 1
      || typeof beatsUniform !== 'boolean'
    ))
    || typeof uniformBrierLoss !== 'number'
    || !Number.isFinite(uniformBrierLoss)
    || Math.abs(uniformBrierLoss - 18 / 37) > SUM_TOLERANCE
    || (settledCount > 0 && beatsUniform !== (meanBrierLoss < uniformBrierLoss))
  ) {
    return null;
  }

  return {
    readyCount,
    settledCount,
    pendingCount,
    top1Hits,
    top1Rate,
    meanBrierLoss,
    uniformBrierLoss,
    beatsUniform,
  };
}

const QUALITY_GATE_REASONS = Object.freeze({
  collecting: new Set(['insufficient_sample']),
  rejected: new Set([
    'current_family_count_not_two',
    'wilson_lower_bound_not_above_break_even',
    'mean_brier_loss_not_below_uniform',
  ]),
  confirmed: new Set(['quality_confirmed']),
  invalid: new Set([
    'invalid_input',
    'invalid_current_family_count',
    'malformed_facts',
  ]),
});

function wilson95(hitCount, sampleSize) {
  if (sampleSize === 0) return null;
  const z = 1.959963984540054;
  const rate = hitCount / sampleSize;
  const zSquared = z ** 2;
  const denominator = 1 + zSquared / sampleSize;
  const center = (rate + zSquared / (2 * sampleSize)) / denominator;
  const radius = z * Math.sqrt(
    (rate * (1 - rate) + zSquared / (4 * sampleSize)) / sampleSize,
  ) / denominator;
  return {
    lower: Math.max(0, center - radius),
    upper: Math.min(1, center + radius),
  };
}

function qualityGateForApi(value, forecast) {
  if (
    !isPlainObject(value)
    || !isPlainObject(forecast)
    || value.version !== PREDICTIVE_LEADER_QUALITY_GATE.version
    || value.windowSize !== PREDICTIVE_LEADER_QUALITY_GATE.windowSize
    || value.baselineRate !== PREDICTIVE_LEADER_QUALITY_GATE.baselineRate
    || value.confidenceLevel !== PREDICTIVE_LEADER_QUALITY_GATE.confidenceLevel
    || value.uniformBrierLoss !== PREDICTIVE_LEADER_QUALITY_GATE.uniformBrierLoss
    || !QUALITY_GATE_REASONS[value.status]?.has(value.reason)
    || typeof value.eligible !== 'boolean'
    || value.eligible !== (value.status === 'confirmed')
    || value.evaluatedForForecastId !== forecast.id
    || value.cutoffAt !== forecast.lockedAt
    || !Number.isSafeInteger(value.currentFamilyCount)
    || value.currentFamilyCount < 0
    || value.currentFamilyCount > 2
    || !/^[0-9a-f]{64}$/.test(value.evidenceDigest)
  ) {
    return null;
  }
  const sampleSize = strictInteger(value.sampleSize);
  const hitCount = strictInteger(value.hitCount);
  const throughResultId = value.throughResultId === null
    ? null
    : strictInteger(value.throughResultId, { minimum: 1 });
  const windowStartForecastId = value.windowStartForecastId === null
    ? null
    : strictInteger(value.windowStartForecastId, { minimum: 1 });
  const windowEndForecastId = value.windowEndForecastId === null
    ? null
    : strictInteger(value.windowEndForecastId, { minimum: 1 });
  if (
    sampleSize === null
    || sampleSize > PREDICTIVE_LEADER_QUALITY_GATE.windowSize
    || hitCount === null
    || hitCount > sampleSize
    || (value.throughResultId !== null && throughResultId === null)
    || (value.windowStartForecastId !== null && windowStartForecastId === null)
    || (value.windowEndForecastId !== null && windowEndForecastId === null)
    || (sampleSize === 0) !== (windowStartForecastId === null)
    || (sampleSize === 0) !== (windowEndForecastId === null)
    || (sampleSize === 0) !== (throughResultId === null)
    || (sampleSize > 0 && windowStartForecastId > windowEndForecastId)
    || (sampleSize > 0 && windowEndForecastId >= value.evaluatedForForecastId)
  ) {
    return null;
  }
  const interval = wilson95(hitCount, sampleSize);
  const expectedHitRate = sampleSize === 0 ? null : hitCount / sampleSize;
  const meanBrierLoss = value.meanBrierLoss;
  const expectedBrierDelta = meanBrierLoss === null
    ? null
    : PREDICTIVE_LEADER_QUALITY_GATE.uniformBrierLoss - meanBrierLoss;
  if (
    (expectedHitRate === null
      ? value.hitRate !== null
      : typeof value.hitRate !== 'number'
        || Math.abs(value.hitRate - expectedHitRate) > SUM_TOLERANCE)
    || (interval === null
      ? value.lowerBound !== null || value.upperBound !== null
      : typeof value.lowerBound !== 'number'
        || typeof value.upperBound !== 'number'
        || Math.abs(value.lowerBound - interval.lower) > SUM_TOLERANCE
        || Math.abs(value.upperBound - interval.upper) > SUM_TOLERANCE)
    || (sampleSize === 0
      ? meanBrierLoss !== null || value.brierDelta !== null
      : typeof meanBrierLoss !== 'number'
        || !Number.isFinite(meanBrierLoss)
        || meanBrierLoss < 0
        || meanBrierLoss > 1
        || typeof value.brierDelta !== 'number'
        || Math.abs(value.brierDelta - expectedBrierDelta) > SUM_TOLERANCE)
    || (value.status === 'collecting'
      && sampleSize >= PREDICTIVE_LEADER_QUALITY_GATE.windowSize)
    || (['rejected', 'confirmed'].includes(value.status)
      && sampleSize !== PREDICTIVE_LEADER_QUALITY_GATE.windowSize)
    || (value.status === 'confirmed' && (
      value.currentFamilyCount !== 2
      || value.lowerBound <= PREDICTIVE_LEADER_QUALITY_GATE.baselineRate
      || meanBrierLoss >= PREDICTIVE_LEADER_QUALITY_GATE.uniformBrierLoss
    ))
    || (value.status === 'invalid' && sampleSize !== 0)
  ) {
    return null;
  }
  return {
    version: value.version,
    status: value.status,
    reason: value.reason,
    eligible: value.eligible,
    windowSize: value.windowSize,
    sampleSize,
    hitCount,
    hitRate: value.hitRate,
    baselineRate: value.baselineRate,
    confidenceLevel: value.confidenceLevel,
    lowerBound: value.lowerBound,
    upperBound: value.upperBound,
    meanBrierLoss,
    uniformBrierLoss: value.uniformBrierLoss,
    brierDelta: value.brierDelta,
    windowStartForecastId,
    windowEndForecastId,
    evaluatedForForecastId: value.evaluatedForForecastId,
    cutoffAt: value.cutoffAt,
    currentFamilyCount: value.currentFamilyCount,
    throughResultId,
    evidenceDigest: value.evidenceDigest,
  };
}

const SIGNAL_ACCOUNT_REASONS = Object.freeze({
  waiting: new Set(['waiting_first_eligible_signal', 'waiting_quality_gate']),
  pending: new Set(['bet_frozen']),
  exhausted: new Set(['bankroll_exhausted']),
});

function signalAccountForApi(value) {
  if (
    !isPlainObject(value)
    || value.schemaVersion !== SIGNAL_ACCOUNT_SCHEMA_VERSION
    || value.strategyVersion !== SIGNAL_ACCOUNT_STRATEGY_VERSION
    || value.leaderAlgorithmVersion !== LEARNED_LEADER_ALGORITHM_VERSION
    || value.gateVersion !== PREDICTIVE_LEADER_QUALITY_GATE.version
    || value.mode !== 'quality-gated-fixed-stake-simulation'
    || value.executionEnabled !== false
    || value.advisoryOnly !== true
    || value.initialBalance !== SIGNAL_ACCOUNT_STARTING_BALANCE
    || !SIGNAL_ACCOUNT_REASONS[value.status]?.has(value.reason)
    || !isPlainObject(value.model)
    || value.model.fixedStake !== SIGNAL_ACCOUNT_STAKE
    || value.model.grossPayoutMultiplier
      !== SIGNAL_ACCOUNT_GROSS_PAYOUT_MULTIPLIER
    || value.model.payoutIncludesStake !== true
  ) {
    return null;
  }
  const integerFields = [
    'currentBalance', 'availableBalance', 'reservedStake', 'profit', 'nextStake',
    'shortfall', 'betCount', 'settledCount', 'pendingCount', 'voidCount',
    'hitCount', 'missCount', 'totalStaked', 'totalGrossPayout', 'peakBalance',
    'minimumBalance', 'maximumDrawdown', 'continuityGapCount',
  ];
  if (integerFields.some((field) => !Number.isSafeInteger(value[field]))) return null;
  if (
    integerFields.some((field) => field !== 'profit' && value[field] < 0)
  ) {
    return null;
  }
  const expectedSettled = value.hitCount + value.missCount;
  const expectedBetCount = value.settledCount + value.pendingCount + value.voidCount;
  const expectedTotalStaked = (value.settledCount + value.pendingCount)
    * SIGNAL_ACCOUNT_STAKE;
  const expectedGross = value.hitCount * SIGNAL_ACCOUNT_STAKE
    * SIGNAL_ACCOUNT_GROSS_PAYOUT_MULTIPLIER;
  const expectedBalance = value.initialBalance - expectedTotalStaked + expectedGross;
  if (
    value.currentBalance < 0
    || value.availableBalance !== value.currentBalance
    || value.profit !== value.currentBalance - value.initialBalance
    || value.nextStake !== SIGNAL_ACCOUNT_STAKE
    || value.pendingCount < 0
    || value.pendingCount > 1
    || value.reservedStake !== value.pendingCount * SIGNAL_ACCOUNT_STAKE
    || value.settledCount !== expectedSettled
    || value.betCount !== expectedBetCount
    || value.totalStaked !== expectedTotalStaked
    || value.totalGrossPayout !== expectedGross
    || value.currentBalance !== expectedBalance
    || typeof value.canAffordNext !== 'boolean'
    || value.canAffordNext !== (value.currentBalance >= SIGNAL_ACCOUNT_STAKE)
    || value.shortfall !== Math.max(0, SIGNAL_ACCOUNT_STAKE - value.currentBalance)
    || value.peakBalance < Math.max(value.initialBalance, value.currentBalance)
    || value.minimumBalance > Math.min(value.initialBalance, value.currentBalance)
    || value.maximumDrawdown < value.peakBalance - value.currentBalance
    || value.maximumDrawdown > value.peakBalance - value.minimumBalance
    || value.continuityGapCount !== value.voidCount
    || (value.settledCount === 0
      ? value.hitRate !== null
      : value.hitRate !== value.hitCount / value.settledCount)
  ) {
    return null;
  }
  const pendingBet = value.pendingBet;
  if ((pendingBet !== null) !== (value.pendingCount === 1)) return null;
  if (pendingBet !== null && (
    !isPlainObject(pendingBet)
    || strictInteger(pendingBet.forecastId, { minimum: 1 }) === null
    || safeRouletteNumber(pendingBet.targetNumber) === null
    || pendingBet.stake !== SIGNAL_ACCOUNT_STAKE
    || pendingBet.balanceBefore !== value.currentBalance + SIGNAL_ACCOUNT_STAKE
    || pendingBet.gateVersion !== PREDICTIVE_LEADER_QUALITY_GATE.version
    || canonicalInstant(pendingBet.placedAt) === null
  )) return null;
  if ((value.status === 'pending') !== (pendingBet !== null)) return null;
  const exhausted = pendingBet === null && !value.canAffordNext;
  if ((value.status === 'exhausted') !== exhausted) return null;
  for (const key of ['startedAt', 'updatedAt', 'exhaustedAt']) {
    if (value[key] !== null && canonicalInstant(value[key]) === null) return null;
  }
  if ((value.betCount === 0) !== (value.startedAt === null)) return null;
  if ((value.betCount === 0) !== (value.updatedAt === null)) return null;
  if ((value.status === 'exhausted') !== (value.exhaustedAt !== null)) return null;
  const latestOutcome = value.latestOutcome;
  if ((latestOutcome !== null) !== (value.settledCount > 0)) return null;
  if (latestOutcome !== null) {
    const targetNumber = safeRouletteNumber(latestOutcome.targetNumber);
    const resultNumber = safeRouletteNumber(latestOutcome.resultNumber);
    const expectedOutcome = targetNumber === resultNumber ? 'hit' : 'miss';
    const expectedGrossPayout = expectedOutcome === 'hit'
      ? SIGNAL_ACCOUNT_STAKE * SIGNAL_ACCOUNT_GROSS_PAYOUT_MULTIPLIER
      : 0;
    if (
      !isPlainObject(latestOutcome)
      || strictInteger(latestOutcome.forecastId, { minimum: 1 }) === null
      || strictInteger(latestOutcome.resultId, { minimum: 1 }) === null
      || targetNumber === null
      || resultNumber === null
      || latestOutcome.stake !== SIGNAL_ACCOUNT_STAKE
      || latestOutcome.outcome !== expectedOutcome
      || latestOutcome.grossPayout !== expectedGrossPayout
      || strictInteger(latestOutcome.balanceAfter, { minimum: 0 }) === null
      || latestOutcome.balanceAfter !== value.currentBalance + value.reservedStake
      || canonicalInstant(latestOutcome.occurredAt) === null
    ) {
      return null;
    }
  }
  const latestVoid = value.latestVoid;
  if ((latestVoid !== null) !== (value.voidCount > 0)) return null;
  if (
    latestVoid !== null
    && (
      !isPlainObject(latestVoid)
      || strictInteger(latestVoid.forecastId, { minimum: 1 }) === null
      || safeRouletteNumber(latestVoid.targetNumber) === null
      || latestVoid.stake !== SIGNAL_ACCOUNT_STAKE
      || latestVoid.reason !== 'integrity_gap'
      || canonicalInstant(latestVoid.voidedAt) === null
    )
  ) {
    return null;
  }
  if (
    value.startedAt !== null
    && (
      Date.parse(value.startedAt) > Date.parse(value.updatedAt)
      || (pendingBet !== null
        && (Date.parse(pendingBet.placedAt) < Date.parse(value.startedAt)
          || Date.parse(pendingBet.placedAt) > Date.parse(value.updatedAt)))
      || (latestOutcome !== null
        && (Date.parse(latestOutcome.occurredAt) < Date.parse(value.startedAt)
          || Date.parse(latestOutcome.occurredAt) > Date.parse(value.updatedAt)))
      || (latestVoid !== null
        && (Date.parse(latestVoid.voidedAt) < Date.parse(value.startedAt)
          || Date.parse(latestVoid.voidedAt) > Date.parse(value.updatedAt)))
    )
  ) {
    return null;
  }
  return structuredClone(value);
}

function accountForApi(value) {
  if (
    !isPlainObject(value)
    || value.schemaVersion !== PREDICTIVE_LEADER_ACCOUNT_SCHEMA_VERSION
    || value.strategyVersion !== PREDICTIVE_LEADER_ACCOUNT_STRATEGY_VERSION
    || value.leaderAlgorithmVersion !== LEARNED_LEADER_ALGORITHM_VERSION
    || value.mode !== 'prospective-simulation'
    || value.executionEnabled !== false
    || value.advisoryOnly !== true
    || value.initialBalance !== PREDICTIVE_LEADER_ACCOUNT_STARTING_BALANCE
  ) {
    return null;
  }

  const model = exactAccountModel(value.model);
  const allowedReasons = ACCOUNT_REASONS_BY_STATUS[value.status];
  if (!model || !allowedReasons?.has(value.reason)) return null;

  const currentBalance = strictInteger(value.currentBalance);
  const profit = strictInteger(value.profit, { minimum: Number.MIN_SAFE_INTEGER });
  const nextStake = strictInteger(value.nextStake, { minimum: model.initialStake });
  const shortfall = strictInteger(value.shortfall);
  const betCount = strictInteger(value.betCount);
  const settledCount = strictInteger(value.settledCount);
  const pendingCount = strictInteger(value.pendingCount);
  const voidCount = strictInteger(value.voidCount);
  const hitCount = strictInteger(value.hitCount);
  const missCount = strictInteger(value.missCount);
  const totalStaked = strictInteger(value.totalStaked);
  const totalGrossPayout = strictInteger(value.totalGrossPayout);
  const peakBalance = strictInteger(value.peakBalance);
  const minimumBalance = strictInteger(value.minimumBalance);
  const maximumDrawdown = strictInteger(value.maximumDrawdown);
  const continuityGapCount = strictInteger(value.continuityGapCount);
  if (
    [
      currentBalance,
      profit,
      nextStake,
      shortfall,
      betCount,
      settledCount,
      pendingCount,
      voidCount,
      hitCount,
      missCount,
      totalStaked,
      totalGrossPayout,
      peakBalance,
      minimumBalance,
      maximumDrawdown,
      continuityGapCount,
    ].some((entry) => entry === null)
    || typeof value.canAffordNext !== 'boolean'
    || !isPlainObject(value.ladder)
  ) {
    return null;
  }

  const ladderMissCount = strictInteger(value.ladder.missCount);
  const ladderTotalLoss = strictInteger(value.ladder.totalLoss);
  if (ladderMissCount === null || ladderTotalLoss === null) return null;

  let expectedNextStake;
  try {
    expectedNextStake = nextPredictiveLeaderStake(ladderTotalLoss);
  } catch {
    return null;
  }
  const expectedBalance = value.initialBalance - totalStaked + totalGrossPayout;
  const expectedProfit = currentBalance - value.initialBalance;
  const expectedSettledCount = hitCount + missCount;
  const expectedBetCount = settledCount + pendingCount + voidCount;
  const expectedCanAfford = nextStake <= currentBalance;
  const expectedShortfall = Math.max(0, nextStake - currentBalance);
  const minimumLadderLoss = ladderMissCount * model.initialStake;
  if (
    !Number.isSafeInteger(expectedBalance)
    || !Number.isSafeInteger(expectedProfit)
    || !Number.isSafeInteger(expectedSettledCount)
    || !Number.isSafeInteger(expectedBetCount)
    || !Number.isSafeInteger(minimumLadderLoss)
    || currentBalance !== expectedBalance
    || profit !== expectedProfit
    || settledCount !== expectedSettledCount
    || betCount !== expectedBetCount
    || ![0, 1].includes(pendingCount)
    || nextStake !== expectedNextStake
    || value.canAffordNext !== expectedCanAfford
    || shortfall !== expectedShortfall
    || totalStaked % model.stakeStep !== 0
    || totalGrossPayout % (model.initialStake * model.grossPayoutMultiplier) !== 0
    || ladderTotalLoss % model.stakeStep !== 0
    || (ladderMissCount === 0) !== (ladderTotalLoss === 0)
    || ladderMissCount > missCount
    || ladderTotalLoss > totalStaked
    || ladderTotalLoss < minimumLadderLoss
    || peakBalance < value.initialBalance
    || peakBalance < currentBalance
    || minimumBalance > value.initialBalance
    || minimumBalance > currentBalance
    || maximumDrawdown > peakBalance - minimumBalance
    || maximumDrawdown < peakBalance - currentBalance
  ) {
    return null;
  }

  const expectedHitRate = settledCount === 0 ? null : hitCount / settledCount;
  if (value.hitRate !== expectedHitRate) return null;

  let pendingBet = null;
  if (value.pendingBet !== null) {
    if (!isPlainObject(value.pendingBet)) return null;
    const forecastId = strictInteger(value.pendingBet.forecastId, { minimum: 1 });
    const targetNumber = strictInteger(value.pendingBet.targetNumber);
    const stake = strictInteger(value.pendingBet.stake, { minimum: model.initialStake });
    const balanceBefore = strictInteger(value.pendingBet.balanceBefore);
    const placedAt = canonicalInstant(value.pendingBet.placedAt);
    if (
      forecastId === null
      || targetNumber === null
      || targetNumber > 36
      || stake === null
      || stake !== nextStake
      || stake > model.maxStake
      || stake % model.stakeStep !== 0
      || stake > balanceBefore
      || balanceBefore !== currentBalance
      || placedAt === null
    ) {
      return null;
    }
    pendingBet = { forecastId, targetNumber, stake, balanceBefore, placedAt };
  }
  if (pendingCount !== Number(pendingBet !== null)) return null;

  let latestVoid = null;
  if (value.latestVoid !== null) {
    if (!isPlainObject(value.latestVoid)) return null;
    const forecastId = strictInteger(value.latestVoid.forecastId, { minimum: 1 });
    const targetNumber = strictInteger(value.latestVoid.targetNumber);
    const stake = strictInteger(value.latestVoid.stake, { minimum: model.initialStake });
    const voidedAt = canonicalInstant(value.latestVoid.voidedAt);
    if (
      forecastId === null
      || targetNumber === null
      || targetNumber > 36
      || stake === null
      || stake > model.maxStake
      || stake % model.stakeStep !== 0
      || value.latestVoid.reason !== 'integrity_gap'
      || voidedAt === null
    ) {
      return null;
    }
    latestVoid = {
      forecastId,
      targetNumber,
      stake,
      reason: value.latestVoid.reason,
      voidedAt,
    };
  }
  if ((voidCount === 0) !== (latestVoid === null)) return null;

  let latestOutcome = null;
  if (value.latestOutcome !== null) {
    if (!isPlainObject(value.latestOutcome)) return null;
    const forecastId = strictInteger(value.latestOutcome.forecastId, { minimum: 1 });
    const resultId = strictInteger(value.latestOutcome.resultId, { minimum: 1 });
    const targetNumber = strictInteger(value.latestOutcome.targetNumber);
    const resultNumber = strictInteger(value.latestOutcome.resultNumber);
    const stake = strictInteger(value.latestOutcome.stake, { minimum: model.initialStake });
    const grossPayout = strictInteger(value.latestOutcome.grossPayout);
    const balanceAfter = strictInteger(value.latestOutcome.balanceAfter);
    const occurredAt = canonicalInstant(value.latestOutcome.occurredAt);
    const expectedOutcome = targetNumber === resultNumber ? 'hit' : 'miss';
    const expectedGrossPayout = expectedOutcome === 'hit'
      ? stake * model.grossPayoutMultiplier
      : 0;
    if (
      forecastId === null
      || resultId === null
      || targetNumber === null
      || targetNumber > 36
      || resultNumber === null
      || resultNumber > 36
      || stake === null
      || stake > model.maxStake
      || stake % model.stakeStep !== 0
      || !Number.isSafeInteger(expectedGrossPayout)
      || value.latestOutcome.outcome !== expectedOutcome
      || grossPayout !== expectedGrossPayout
      || balanceAfter !== currentBalance
      || occurredAt === null
    ) {
      return null;
    }
    latestOutcome = {
      forecastId,
      resultId,
      targetNumber,
      resultNumber,
      stake,
      outcome: value.latestOutcome.outcome,
      grossPayout,
      balanceAfter,
      occurredAt,
    };
  }
  if ((settledCount === 0) !== (latestOutcome === null)) return null;

  const pristine = value.reason === 'waiting_first_frozen_leader';
  let startedAt = null;
  let updatedAt = null;
  let exhaustedAt = null;
  if (pristine) {
    if (
      value.status !== 'waiting'
      || value.startedAt !== null
      || value.updatedAt !== null
      || value.exhaustedAt !== null
      || currentBalance !== value.initialBalance
      || profit !== 0
      || betCount !== 0
      || settledCount !== 0
      || pendingCount !== 0
      || voidCount !== 0
      || hitCount !== 0
      || missCount !== 0
      || totalStaked !== 0
      || totalGrossPayout !== 0
      || peakBalance !== value.initialBalance
      || minimumBalance !== value.initialBalance
      || maximumDrawdown !== 0
      || continuityGapCount !== 0
      || ladderMissCount !== 0
      || ladderTotalLoss !== 0
      || pendingBet !== null
      || latestVoid !== null
      || latestOutcome !== null
    ) {
      return null;
    }
  } else {
    startedAt = canonicalInstant(value.startedAt);
    updatedAt = canonicalInstant(value.updatedAt);
    if (
      startedAt === null
      || updatedAt === null
      || Date.parse(startedAt) > Date.parse(updatedAt)
    ) {
      return null;
    }
    if (
      pendingBet
      && (
        Date.parse(pendingBet.placedAt) < Date.parse(startedAt)
        || Date.parse(pendingBet.placedAt) > Date.parse(updatedAt)
      )
    ) {
      return null;
    }
    if (
      latestOutcome
      && (
        Date.parse(latestOutcome.occurredAt) < Date.parse(startedAt)
        || Date.parse(latestOutcome.occurredAt) > Date.parse(updatedAt)
      )
    ) {
      return null;
    }
    if (
      latestVoid
      && (
        Date.parse(latestVoid.voidedAt) < Date.parse(startedAt)
        || Date.parse(latestVoid.voidedAt) > Date.parse(updatedAt)
      )
    ) {
      return null;
    }
  }

  if (value.status === 'pending') {
    if (!expectedCanAfford || pendingBet === null || value.exhaustedAt !== null) {
      return null;
    }
  } else if (value.status === 'waiting') {
    if (!expectedCanAfford || pendingBet !== null || value.exhaustedAt !== null) {
      return null;
    }
  } else {
    exhaustedAt = canonicalInstant(value.exhaustedAt);
    if (
      expectedCanAfford
      || pendingBet !== null
      || exhaustedAt === null
      || startedAt === null
      || updatedAt === null
      || Date.parse(exhaustedAt) < Date.parse(startedAt)
      || Date.parse(exhaustedAt) > Date.parse(updatedAt)
    ) {
      return null;
    }
  }

  return {
    schemaVersion: value.schemaVersion,
    strategyVersion: value.strategyVersion,
    leaderAlgorithmVersion: value.leaderAlgorithmVersion,
    mode: value.mode,
    executionEnabled: value.executionEnabled,
    advisoryOnly: value.advisoryOnly,
    status: value.status,
    reason: value.reason,
    initialBalance: value.initialBalance,
    currentBalance,
    profit,
    model,
    nextStake,
    canAffordNext: value.canAffordNext,
    shortfall,
    betCount,
    settledCount,
    pendingCount,
    voidCount,
    hitCount,
    missCount,
    hitRate: value.hitRate,
    totalStaked,
    totalGrossPayout,
    peakBalance,
    minimumBalance,
    maximumDrawdown,
    continuityGapCount,
    ladder: {
      missCount: ladderMissCount,
      totalLoss: ladderTotalLoss,
    },
    pendingBet,
    latestVoid,
    latestOutcome,
    startedAt,
    updatedAt,
    exhaustedAt,
  };
}

function emptyFreshness() {
  return {
    currentRoundId: null,
    latestPersistedResultId: null,
    latestPersistedRoundId: null,
    latestPersistedAt: null,
    collectorLastResultAt: null,
    resultCursorMatches: false,
    roundCursorMatches: false,
    forecastRoundMatches: false,
    resultConfirmationPending: null,
    pendingResultCount: null,
    persistencePendingResults: null,
    persistencePendingGaps: null,
    integrityOk: true,
  };
}

function baseResponse({
  source,
  instrument,
  serverTime,
  metrics,
  freshness,
  account,
  legacyAccount,
}) {
  return {
    schemaVersion: PREDICTIVE_LEADER_API_SCHEMA_VERSION,
    algorithmVersion: LEARNED_LEADER_ALGORITHM_VERSION,
    mode: 'quality-gated-simulation',
    executionEnabled: false,
    advisoryOnly: true,
    source,
    instrument,
    serverTime,
    status: 'waiting',
    reason: 'state_unavailable',
    action: 'WAIT',
    number: null,
    candidateNumber: null,
    forecast: null,
    model: null,
    qualityGate: null,
    account,
    legacyAccount,
    metrics,
    freshness,
  };
}

function withStatus(base, status, reason, extra = {}) {
  return { ...base, status, reason, ...extra };
}

export function predictiveLeaderSnapshotForApi({
  state,
  source = 'buleto',
  instrument = 'default',
  now = new Date(),
} = {}) {
  const safeSource = typeof source === 'string' ? source.trim() : '';
  const safeInstrument = typeof instrument === 'string' ? instrument.trim() : '';
  if (safeSource === '' || safeInstrument === '') {
    throw new TypeError('source and instrument are required');
  }
  const serverTime = instant(now instanceof Date ? now.toISOString() : now);
  if (serverTime === null) throw new TypeError('now must be a valid timestamp');

  const metrics = metricsForApi(state?.precloseForecast?.predictiveLeaderMetrics);
  const account = signalAccountForApi(
    state?.precloseForecast?.predictiveLeaderSignalAccount,
  );
  const legacyAccount = accountForApi(
    state?.precloseForecast?.predictiveLeaderAccount,
  );
  if (!isPlainObject(state)) {
    return baseResponse({
      source: safeSource,
      instrument: safeInstrument,
      serverTime,
      metrics,
      freshness: emptyFreshness(),
      account,
      legacyAccount,
    });
  }

  const collector = state.collector;
  const latestResult = state.latestResult;
  const pipelinePending = state.pipelinePending;
  const currentRoundId = safeInteger(collector?.currentRound?.id);
  const latestPersistedResultId = safeInteger(latestResult?.id, { minimum: 1 });
  const latestPersistedRoundId = safeInteger(
    latestResult?.roundId ?? latestResult?.externalRoundId,
  );
  const latestPersistedAt = instant(latestResult?.settledAt);
  const collectorLastResultAt = instant(collector?.lastResultAt);
  const pendingResultCount = safeInteger(collector?.pendingResultCount);
  const resultConfirmationPending = typeof collector?.resultConfirmationPending === 'boolean'
    ? collector.resultConfirmationPending
    : null;
  const persistencePendingResults = safeInteger(pipelinePending?.results);
  const persistencePendingGaps = safeInteger(pipelinePending?.gaps);
  const resultCursorMatches = latestPersistedAt !== null
    && collectorLastResultAt !== null
    && sameInstant(latestPersistedAt, collectorLastResultAt);
  const roundCursorMatches = currentRoundId !== null
    && latestPersistedRoundId !== null
    && latestPersistedRoundId < Number.MAX_SAFE_INTEGER
    && currentRoundId === latestPersistedRoundId + 1;
  const forecastRoundId = safeInteger(state.precloseForecast?.latest?.roundId);
  const forecastRoundMatches = currentRoundId !== null
    && forecastRoundId !== null
    && currentRoundId === forecastRoundId;
  const integrityOk = integrityIsCurrent(state);
  const freshness = {
    currentRoundId,
    latestPersistedResultId,
    latestPersistedRoundId,
    latestPersistedAt,
    collectorLastResultAt,
    resultCursorMatches,
    roundCursorMatches,
    forecastRoundMatches,
    resultConfirmationPending,
    pendingResultCount,
    persistencePendingResults,
    persistencePendingGaps,
    integrityOk,
  };
  const base = baseResponse({
    source: safeSource,
    instrument: safeInstrument,
    serverTime,
    metrics,
    freshness,
    account,
    legacyAccount,
  });

  if (!integrityOk) return withStatus(base, 'paused', 'integrity_gap');
  if (!isPlainObject(collector) || !isPlainObject(latestResult)) {
    return withStatus(base, 'waiting', 'cursor_unavailable');
  }
  if (
    currentRoundId === null
    || latestPersistedResultId === null
    || latestPersistedRoundId === null
    || latestPersistedRoundId >= Number.MAX_SAFE_INTEGER
    || latestPersistedAt === null
    || collectorLastResultAt === null
    || pendingResultCount === null
    || resultConfirmationPending === null
    || persistencePendingResults === null
    || persistencePendingGaps === null
  ) {
    return withStatus(base, 'paused', 'cursor_invalid');
  }
  if (
    collector.connected !== true
    || collector.status !== 'connected'
    || (collector.error !== null && collector.error !== undefined)
  ) {
    return withStatus(base, 'paused', 'collector_unavailable');
  }
  if (resultConfirmationPending || pendingResultCount > 0) {
    return withStatus(base, 'paused', 'collector_pending');
  }
  if (persistencePendingResults > 0 || persistencePendingGaps > 0) {
    return withStatus(base, 'paused', 'persistence_pending');
  }
  if (!resultCursorMatches) {
    return withStatus(base, 'paused', 'result_cursor_mismatch');
  }
  if (!roundCursorMatches) {
    return withStatus(base, 'paused', 'round_cursor_mismatch');
  }

  const latestForecast = state.precloseForecast?.latest;
  if (!isPlainObject(latestForecast)) {
    return withStatus(base, 'waiting', 'forecast_unavailable');
  }
  const forecastId = safeInteger(latestForecast.id, { minimum: 1 });
  const forecastLockedAt = instant(latestForecast.lockedAt);
  const bettingClosesAt = instant(latestForecast.bettingClosesAt);
  const roundEndsAt = instant(latestForecast.roundEndsAt);
  if (
    forecastId === null
    || forecastRoundId === null
    || forecastLockedAt === null
    || bettingClosesAt === null
    || roundEndsAt === null
    || latestForecast.source !== safeSource
    || latestForecast.instrument !== safeInstrument
  ) {
    return withStatus(base, 'paused', 'forecast_invalid');
  }
  const forecast = {
    id: forecastId,
    roundId: latestForecast.roundId,
    lockedAt: forecastLockedAt,
    bettingClosesAt,
    roundEndsAt,
  };
  if (!forecastRoundMatches) {
    return withStatus(base, 'paused', 'forecast_round_mismatch', { forecast });
  }
  if (Date.parse(serverTime) < Date.parse(forecastLockedAt)) {
    return withStatus(base, 'paused', 'forecast_invalid', { forecast });
  }
  if (Date.parse(serverTime) >= Date.parse(bettingClosesAt)) {
    return withStatus(base, 'waiting', 'betting_closed', { forecast });
  }
  if (latestForecast.settlement !== null) {
    return withStatus(base, 'waiting', 'forecast_settled', { forecast });
  }

  const storedLeader = latestForecast.predictiveLeader;
  if (storedLeader === null || storedLeader === undefined) {
    return withStatus(base, 'waiting', 'leader_not_frozen', { forecast });
  }
  const leader = normalizeLearnedLeaderDecision(storedLeader);
  if (
    !leader
    || safeInteger(storedLeader.forecastId, { minimum: 1 }) !== forecastId
    || storedLeader.evaluation !== null
    || !sameInstant(leader.lockedAt, forecastLockedAt)
  ) {
    return withStatus(base, 'paused', 'leader_invalid', { forecast });
  }
  if (leader.status !== 'ready') {
    return withStatus(base, 'waiting', 'no_valid_family', { forecast });
  }
  const number = safeRouletteNumber(leader.leaderNumber);
  if (number === null) {
    return withStatus(base, 'paused', 'leader_invalid', { forecast });
  }

  const activeFamilyWeights = Object.fromEntries(
    Object.entries(leader.familyWeights).map(([family, weight]) => [family, weight]),
  );
  const learnedFamilyWeights = Object.fromEntries(
    Object.entries(leader.learning.familyWeights).map(
      ([family, weight]) => [family, weight],
    ),
  );
  const model = {
    sourceCount: leader.sourceCount,
    familyCount: leader.familyCount,
    activeFamilies: Object.keys(activeFamilyWeights),
    activeFamilyWeights,
    learningVersion: leader.learning.version,
    learningStatus: leader.learning.status,
    trainingCount: leader.learning.trainingCount,
    learnedFamilyWeights,
    tieBreakApplied: leader.tieBreakApplied,
  };
  const rawGate = latestForecast.predictiveLeaderQualityGate;
  const qualityGate = qualityGateForApi(rawGate, forecast);
  const observed = { candidateNumber: number, forecast, model, qualityGate };
  if (!qualityGate) {
    return withStatus(
      base,
      rawGate == null ? 'waiting' : 'paused',
      rawGate == null ? 'quality_not_frozen' : 'quality_evidence_invalid',
      observed,
    );
  }
  if (qualityGate.currentFamilyCount !== leader.familyCount) {
    return withStatus(base, 'paused', 'quality_evidence_invalid', observed);
  }
  if (qualityGate.status !== 'confirmed' || qualityGate.eligible !== true) {
    const reason = qualityGate.status === 'collecting'
      ? 'quality_collecting'
      : qualityGate.status === 'invalid'
        ? 'quality_evidence_invalid'
        : 'quality_not_proven';
    return withStatus(
      base,
      qualityGate.status === 'invalid' ? 'paused' : 'waiting',
      reason,
      observed,
    );
  }
  if (!account) {
    return withStatus(base, 'paused', 'signal_account_invalid', observed);
  }
  if (account.status === 'exhausted') {
    return withStatus(base, 'waiting', 'bankroll_exhausted', observed);
  }
  if (
    account.status !== 'pending'
    || account.pendingBet?.forecastId !== forecastId
    || account.pendingBet?.targetNumber !== number
    || account.pendingBet?.gateVersion !== qualityGate.version
  ) {
    const pendingPrevious = account.status === 'pending';
    return withStatus(
      base,
      pendingPrevious ? 'waiting' : 'paused',
      pendingPrevious ? 'signal_pending_previous' : 'signal_not_recorded',
      observed,
    );
  }
  return withStatus(base, 'ready', 'ready', {
    action: 'BET',
    number,
    candidateNumber: number,
    forecast,
    model,
    qualityGate,
  });
}
