import {
  LEARNED_LEADER_V7_ALGORITHM_VERSION,
  LEARNED_LEADER_V7_SCHEMA_VERSION,
} from './learned-leader-v7.js';
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
} from './predictive-leader-v7-paper-ladder.js';

export const PREDICTIVE_LEADER_V7_PAPER_API_SCHEMA_VERSION =
  PREDICTIVE_LEADER_V7_PAPER_LADDER_SCHEMA_VERSION;
export const PREDICTIVE_LEADER_V7_PAPER_STRATEGY_VERSION =
  PREDICTIVE_LEADER_V7_PAPER_LADDER_STRATEGY_VERSION;
export const PREDICTIVE_LEADER_V7_PAPER_STRATEGY_MODE =
  'manual-override-paper';

const AUTHORIZATION_REASON = 'operator-requested-virtual-api-2026-10-19';
const ACCOUNT_RESET_REASONS = new Set([
  ...Object.values(PREDICTIVE_LEADER_V7_PAPER_LADDER_RESET_REASONS),
  'integrity_gap',
]);

const ACCOUNT_REASONS = Object.freeze({
  waiting: new Set([
    'waiting_first_frozen_v7',
    'waiting_next_frozen_v7',
    'waiting_next_frozen_leader',
  ]),
  pending: new Set(['bet_frozen']),
  exhausted: new Set(['bankroll_exhausted']),
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeInteger(value, { minimum = 0 } = {}) {
  return Number.isSafeInteger(value) && value >= minimum ? value : null;
}

function safeRouletteNumber(value) {
  const number = safeInteger(value);
  return number !== null && number <= 36 ? number : null;
}

function instant(value) {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
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

function canonicalText(value) {
  if (typeof value !== 'string' || value.trim() === '' || value !== value.trim()) {
    return null;
  }
  return value;
}

function roundId(value) {
  if (Number.isSafeInteger(value) && value >= 0) return String(value);
  return canonicalText(value);
}

function nextRoundMatches(previous, current) {
  if (/^(0|[1-9]\d*)$/.test(previous) && /^(0|[1-9]\d*)$/.test(current)) {
    const previousNumber = Number(previous);
    const currentNumber = Number(current);
    return Number.isSafeInteger(previousNumber)
      && Number.isSafeInteger(currentNumber)
      && previousNumber < Number.MAX_SAFE_INTEGER
      && currentNumber === previousNumber + 1;
  }
  return previous !== current;
}

function exactModelForApi(value) {
  const expected = PREDICTIVE_LEADER_V7_PAPER_LADDER_MODEL;
  if (
    !isPlainObject(value)
    || value.kind !== expected.kind
    || value.initialBalance !== expected.initialBalance
    || value.initialStake !== expected.initialStake
    || value.stakeStep !== expected.stakeStep
    || value.maxStake !== expected.maxStake
    || value.grossPayoutMultiplier !== expected.grossPayoutMultiplier
    || value.payoutIncludesStake !== expected.payoutIncludesStake
    || value.cycleSpendLimit !== expected.cycleSpendLimit
    || value.resetPolicy !== PREDICTIVE_LEADER_V7_PAPER_LADDER_RESET_POLICY
  ) {
    return null;
  }
  return {
    kind: value.kind,
    initialBalance: value.initialBalance,
    initialStake: value.initialStake,
    stakeStep: value.stakeStep,
    maxStake: value.maxStake,
    grossPayoutMultiplier: value.grossPayoutMultiplier,
    payoutIncludesStake: value.payoutIncludesStake,
    cycleSpendLimit: value.cycleSpendLimit,
    resetPolicy: value.resetPolicy,
  };
}

function expectedRawStake(ladderLoss, model) {
  try {
    return calculatePredictiveLeaderV7PaperRawStake(ladderLoss, model);
  } catch {
    return null;
  }
}

function expectedNextStake(ladderLoss, cycleStaked, model) {
  try {
    return calculatePredictiveLeaderV7PaperNextStake(
      ladderLoss,
      cycleStaked,
      model,
    );
  } catch {
    return null;
  }
}

function validMissCursor(ladderLoss, missCount, model) {
  return ladderLoss % model.stakeStep === 0
    && (missCount === 0) === (ladderLoss === 0)
    && ladderLoss >= missCount * model.initialStake;
}

function ladderForApi(value, model) {
  if (!isPlainObject(value)) return null;
  const cycleNumber = safeInteger(value.cycleNumber, { minimum: 1 });
  const cycleStaked = safeInteger(value.cycleStaked);
  const ladderLoss = safeInteger(value.ladderLoss);
  const missCount = safeInteger(value.missCount);
  const resetCount = safeInteger(value.resetCount);
  const nextStake = safeInteger(value.nextStake, { minimum: model.initialStake });
  const pendingReset = value.pendingReset === null
    ? null
    : canonicalText(value.pendingReset);
  const calculatedNextStake = expectedNextStake(ladderLoss, cycleStaked, model);
  if (
    cycleNumber === null
    || cycleStaked === null
    || ladderLoss === null
    || missCount === null
    || resetCount === null
    || nextStake === null
    || cycleStaked >= model.cycleSpendLimit
    || ladderLoss !== cycleStaked
    || !validMissCursor(ladderLoss, missCount, model)
    || resetCount !== cycleNumber - 1
    || calculatedNextStake === null
    || nextStake !== calculatedNextStake
    || ![null, PREDICTIVE_LEADER_V7_PAPER_LADDER_PENDING_RESET_REASON]
      .includes(pendingReset)
  ) {
    return null;
  }
  return {
    cycleNumber,
    cycleStaked,
    ladderLoss,
    missCount,
    resetCount,
    nextStake,
    pendingReset,
  };
}

function pendingBetForApi(value, model) {
  if (!isPlainObject(value)) return null;
  const id = safeInteger(value.id, { minimum: 1 });
  const forecastId = safeInteger(value.forecastId, { minimum: 1 });
  const normalizedRoundId = roundId(value.roundId);
  const targetNumber = safeRouletteNumber(value.targetNumber);
  const stake = safeInteger(value.stake, { minimum: model.initialStake });
  const rawStake = safeInteger(value.rawStake, { minimum: model.initialStake });
  const balanceBefore = safeInteger(value.balanceBefore);
  const cycleNumber = safeInteger(value.cycleNumber, { minimum: 1 });
  const cycleStakedBefore = safeInteger(value.cycleStakedBefore);
  const ladderLossBefore = safeInteger(value.ladderLossBefore);
  const missCountBefore = safeInteger(value.missCountBefore);
  const lockedAt = instant(value.lockedAt);
  const bettingClosesAt = instant(value.bettingClosesAt);
  const placedAt = instant(value.placedAt);
  const calculatedRawStake = expectedRawStake(ladderLossBefore, model);
  const calculatedStake = expectedNextStake(
    ladderLossBefore,
    cycleStakedBefore,
    model,
  );
  if (
    id === null
    || forecastId === null
    || normalizedRoundId === null
    || targetNumber === null
    || stake === null
    || rawStake === null
    || balanceBefore === null
    || cycleNumber === null
    || cycleStakedBefore === null
    || ladderLossBefore === null
    || missCountBefore === null
    || ladderLossBefore !== cycleStakedBefore
    || !validMissCursor(ladderLossBefore, missCountBefore, model)
    || calculatedRawStake === null
    || calculatedStake === null
    || rawStake !== calculatedRawStake
    || stake !== calculatedStake
    || stake > balanceBefore
    || cycleStakedBefore + stake > model.cycleSpendLimit
    || lockedAt === null
    || bettingClosesAt === null
    || placedAt === null
    || Date.parse(lockedAt) > Date.parse(placedAt)
    || Date.parse(placedAt) >= Date.parse(bettingClosesAt)
  ) {
    return null;
  }
  return {
    id,
    forecastId,
    roundId: normalizedRoundId,
    targetNumber,
    stake,
    rawStake,
    balanceBefore,
    cycleNumber,
    cycleStakedBefore,
    ladderLossBefore,
    missCountBefore,
    lockedAt,
    bettingClosesAt,
    placedAt,
  };
}

function latestOutcomeForApi(value, model) {
  if (!isPlainObject(value)) return null;
  const betId = safeInteger(value.betId, { minimum: 1 });
  const forecastId = safeInteger(value.forecastId, { minimum: 1 });
  const resultId = safeInteger(value.resultId, { minimum: 1 });
  const normalizedRoundId = roundId(value.roundId);
  const targetNumber = safeRouletteNumber(value.targetNumber);
  const resultNumber = safeRouletteNumber(value.resultNumber);
  const stake = safeInteger(value.stake, { minimum: model.initialStake });
  const balanceBefore = safeInteger(value.balanceBefore);
  const balanceAfter = safeInteger(value.balanceAfter);
  const cycleNumberBefore = safeInteger(value.cycleNumberBefore, { minimum: 1 });
  const cycleNumberAfter = safeInteger(value.cycleNumberAfter, { minimum: 1 });
  const cycleStakedBefore = safeInteger(value.cycleStakedBefore);
  const cycleStakedAfter = safeInteger(value.cycleStakedAfter);
  const ladderLossBefore = safeInteger(value.ladderLossBefore);
  const ladderLossAfter = safeInteger(value.ladderLossAfter);
  const missCountBefore = safeInteger(value.missCountBefore);
  const missCountAfter = safeInteger(value.missCountAfter);
  const nextStakeAfter = safeInteger(
    value.nextStakeAfter,
    { minimum: model.initialStake },
  );
  const occurredAt = instant(value.occurredAt);
  const outcome = targetNumber === resultNumber ? 'hit' : 'miss';
  const grossPayout = outcome === 'hit'
    ? stake * model.grossPayoutMultiplier
    : 0;
  const calculatedStake = expectedNextStake(
    ladderLossBefore,
    cycleStakedBefore,
    model,
  );
  const settlesAtCap = cycleStakedBefore + stake === model.cycleSpendLimit;
  const resetReason = outcome === 'hit'
    ? PREDICTIVE_LEADER_V7_PAPER_LADDER_RESET_REASONS.hit
    : settlesAtCap
      ? PREDICTIVE_LEADER_V7_PAPER_LADDER_RESET_REASONS.cycleSpendCap
      : null;
  const resetApplied = resetReason !== null;
  const expectedCycleNumberAfter = cycleNumberBefore + Number(resetApplied);
  const expectedCycleStakedAfter = resetApplied ? 0 : cycleStakedBefore + stake;
  const expectedLadderLossAfter = outcome === 'hit'
    ? 0
    : resetApplied
      ? 0
      : ladderLossBefore + stake;
  const expectedMissCountAfter = outcome === 'hit' || resetApplied
    ? 0
    : missCountBefore + 1;
  const calculatedNextStakeAfter = expectedNextStake(
    expectedLadderLossAfter,
    expectedCycleStakedAfter,
    model,
  );
  if (
    betId === null
    || forecastId === null
    || resultId === null
    || normalizedRoundId === null
    || targetNumber === null
    || resultNumber === null
    || stake === null
    || balanceBefore === null
    || balanceAfter === null
    || cycleNumberBefore === null
    || cycleNumberAfter === null
    || cycleStakedBefore === null
    || cycleStakedAfter === null
    || ladderLossBefore === null
    || ladderLossAfter === null
    || missCountBefore === null
    || missCountAfter === null
    || nextStakeAfter === null
    || ladderLossBefore !== cycleStakedBefore
    || !validMissCursor(ladderLossBefore, missCountBefore, model)
    || calculatedStake === null
    || stake !== calculatedStake
    || stake > balanceBefore
    || cycleStakedBefore + stake > model.cycleSpendLimit
    || !Number.isSafeInteger(grossPayout)
    || value.outcome !== outcome
    || value.grossPayout !== grossPayout
    || balanceAfter !== balanceBefore - stake + grossPayout
    || value.resetApplied !== resetApplied
    || value.resetReason !== resetReason
    || cycleNumberAfter !== expectedCycleNumberAfter
    || cycleStakedAfter !== expectedCycleStakedAfter
    || ladderLossAfter !== expectedLadderLossAfter
    || missCountAfter !== expectedMissCountAfter
    || calculatedNextStakeAfter === null
    || nextStakeAfter !== calculatedNextStakeAfter
    || occurredAt === null
  ) {
    return null;
  }
  return {
    eventId: `v7-paper-bet:${betId}`,
    betId,
    forecastId,
    resultId,
    roundId: normalizedRoundId,
    targetNumber,
    resultNumber,
    outcome: outcome.toUpperCase(),
    stake,
    grossPayout,
    balanceBefore,
    balanceAfter,
    cycleNumberBefore,
    cycleNumberAfter,
    cycleStakedBefore,
    cycleStakedAfter,
    ladderLossBefore,
    ladderLossAfter,
    missCountBefore,
    missCountAfter,
    nextStakeAfter,
    resetApplied,
    resetReason,
    occurredAt,
  };
}

function latestVoidForApi(value, model) {
  if (!isPlainObject(value)) return null;
  const betId = safeInteger(value.betId, { minimum: 1 });
  const forecastId = safeInteger(value.forecastId, { minimum: 1 });
  const normalizedRoundId = roundId(value.roundId);
  const targetNumber = safeRouletteNumber(value.targetNumber);
  const stake = safeInteger(value.stake, { minimum: model.initialStake });
  const balanceBefore = safeInteger(value.balanceBefore);
  const cycleNumber = safeInteger(value.cycleNumber, { minimum: 1 });
  const cycleStakedBefore = safeInteger(value.cycleStakedBefore);
  const ladderLossBefore = safeInteger(value.ladderLossBefore);
  const missCountBefore = safeInteger(value.missCountBefore);
  const voidedAt = instant(value.voidedAt);
  const calculatedStake = expectedNextStake(
    ladderLossBefore,
    cycleStakedBefore,
    model,
  );
  if (
    betId === null
    || forecastId === null
    || normalizedRoundId === null
    || targetNumber === null
    || stake === null
    || balanceBefore === null
    || cycleNumber === null
    || cycleStakedBefore === null
    || ladderLossBefore === null
    || missCountBefore === null
    || ladderLossBefore !== cycleStakedBefore
    || !validMissCursor(ladderLossBefore, missCountBefore, model)
    || calculatedStake === null
    || stake !== calculatedStake
    || stake > balanceBefore
    || !['integrity_gap', 'round_metadata_conflict'].includes(value.reason)
    || voidedAt === null
  ) {
    return null;
  }
  return {
    eventId: `v7-paper-void:${betId}`,
    betId,
    forecastId,
    roundId: normalizedRoundId,
    targetNumber,
    stake,
    balanceBefore,
    cycleNumber,
    cycleStakedBefore,
    ladderLossBefore,
    missCountBefore,
    reason: value.reason,
    voidedAt,
  };
}

function latestResetForApi(value, model) {
  if (!isPlainObject(value)) return null;
  const id = safeInteger(value.id, { minimum: 1 });
  const betId = value.betId === null
    ? null
    : safeInteger(value.betId, { minimum: 1 });
  const incidentId = value.incidentId === null
    ? null
    : safeInteger(value.incidentId, { minimum: 1 });
  const continuityEpoch = value.continuityEpoch === null
    ? null
    : safeInteger(value.continuityEpoch, { minimum: 1 });
  const cycleNumberBefore = safeInteger(value.cycleNumberBefore, { minimum: 1 });
  const cycleNumberAfter = safeInteger(value.cycleNumberAfter, { minimum: 2 });
  const cycleStakedBefore = safeInteger(value.cycleStakedBefore);
  const ladderLossBefore = safeInteger(value.ladderLossBefore);
  const missCountBefore = safeInteger(value.missCountBefore);
  const nextStakeBefore = safeInteger(
    value.nextStakeBefore,
    { minimum: model.initialStake },
  );
  const nextStakeAfter = safeInteger(
    value.nextStakeAfter,
    { minimum: model.initialStake },
  );
  const occurredAt = instant(value.occurredAt);
  const isIntegrityGap = value.reason === 'integrity_gap';
  const provenanceValid = isIntegrityGap
    ? value.betId === null
      && incidentId !== null
      && continuityEpoch !== null
    : betId !== null
      && value.incidentId === null
      && value.continuityEpoch === null;
  let reasonValid = false;
  if (
    ACCOUNT_RESET_REASONS.has(value.reason)
    && cycleStakedBefore !== null
    && ladderLossBefore !== null
    && missCountBefore !== null
    && nextStakeBefore !== null
  ) {
    if (value.reason === PREDICTIVE_LEADER_V7_PAPER_LADDER_RESET_REASONS.hit) {
      const hitStake = cycleStakedBefore - ladderLossBefore;
      reasonValid = hitStake === nextStakeBefore
        && hitStake === expectedNextStake(
          ladderLossBefore,
          ladderLossBefore,
          model,
        );
    } else if (
      value.reason
        === PREDICTIVE_LEADER_V7_PAPER_LADDER_RESET_REASONS.cycleSpendCap
    ) {
      const cursorBeforeFinalBet = model.cycleSpendLimit - nextStakeBefore;
      reasonValid = cycleStakedBefore === model.cycleSpendLimit
        && ladderLossBefore === model.cycleSpendLimit
        && nextStakeBefore === expectedNextStake(
          cursorBeforeFinalBet,
          cursorBeforeFinalBet,
          model,
        );
    } else {
      reasonValid = cycleStakedBefore === ladderLossBefore
        && nextStakeBefore === expectedNextStake(
          ladderLossBefore,
          cycleStakedBefore,
          model,
        );
    }
  }
  if (
    id === null
    || !provenanceValid
    || cycleNumberBefore === null
    || cycleNumberAfter === null
    || cycleStakedBefore === null
    || ladderLossBefore === null
    || missCountBefore === null
    || nextStakeBefore === null
    || nextStakeAfter === null
    || cycleNumberAfter !== cycleNumberBefore + 1
    || cycleStakedBefore > model.cycleSpendLimit
    || ladderLossBefore > cycleStakedBefore
    || !validMissCursor(ladderLossBefore, missCountBefore, model)
    || nextStakeAfter !== model.initialStake
    || !reasonValid
    || occurredAt === null
  ) {
    return null;
  }
  return {
    id,
    betId,
    incidentId,
    continuityEpoch,
    cycleNumberBefore,
    cycleNumberAfter,
    reason: value.reason,
    cycleStakedBefore,
    ladderLossBefore,
    missCountBefore,
    nextStakeBefore,
    nextStakeAfter,
    occurredAt,
  };
}

function accountStateForApi(value, source, instrument) {
  const model = exactModelForApi(value?.model);
  if (
    !isPlainObject(value)
    || value.schemaVersion !== PREDICTIVE_LEADER_V7_PAPER_LADDER_SCHEMA_VERSION
    || value.strategyVersion !== PREDICTIVE_LEADER_V7_PAPER_STRATEGY_VERSION
    || value.algorithmVersion !== LEARNED_LEADER_V7_ALGORITHM_VERSION
    || canonicalText(value.candidateId) === null
    || value.campaignKey !== PREDICTIVE_LEADER_V7_PAPER_LADDER_CAMPAIGN_KEY
    || value.mode !== PREDICTIVE_LEADER_V7_PAPER_STRATEGY_MODE
    || value.executionEnabled !== false
    || value.advisoryOnly !== true
    || value.promotionEligible !== false
    || value.promotionPolicy !== 'manual-override-paper-not-promoted'
    || value.authorizationReason !== AUTHORIZATION_REASON
    || value.source !== source
    || value.instrument !== instrument
    || value.initialBalance !== PREDICTIVE_LEADER_V7_PAPER_LADDER_MODEL.initialBalance
    || !ACCOUNT_REASONS[value.status]?.has(value.reason)
    || model === null
    || value.initialBalance !== model.initialBalance
    || !isPlainObject(value.activationBoundary)
  ) {
    return null;
  }
  const firstForecastId = safeInteger(
    value.activationBoundary.firstForecastId,
    { minimum: 1 },
  );
  const activationStartedAt = instant(value.activationBoundary.startedAt);
  if (firstForecastId === null || activationStartedAt === null) return null;

  const nonNegativeIntegerFields = [
    'currentBalance',
    'deficit',
    'availableBalance',
    'reservedStake',
    'nextStake',
    'shortfall',
    'betCount',
    'settledCount',
    'pendingCount',
    'voidCount',
    'hitCount',
    'missCount',
    'totalStaked',
    'totalGrossPayout',
    'peakBalance',
    'maximumDrawdown',
    'continuityGapCount',
    'ledgerRevision',
  ];
  if (nonNegativeIntegerFields.some((key) => safeInteger(value[key]) === null)) {
    return null;
  }
  if (
    !Number.isSafeInteger(value.accountingBalance)
    || !Number.isSafeInteger(value.minimumBalance)
    || !Number.isSafeInteger(value.profit)
  ) return null;

  const ladder = ladderForApi(value.ladder, model);
  if (ladder === null) return null;
  const pendingBet = value.pendingBet === null
    ? null
    : pendingBetForApi(value.pendingBet, model);
  const latestOutcome = value.latestOutcome === null
    ? null
    : latestOutcomeForApi(value.latestOutcome, model);
  const latestVoid = value.latestVoid === null
    ? null
    : latestVoidForApi(value.latestVoid, model);
  const latestReset = value.latestReset === null
    ? null
    : latestResetForApi(value.latestReset, model);
  const expectedSettledCount = value.hitCount + value.missCount;
  const expectedBetCount = value.settledCount + value.pendingCount + value.voidCount;
  const expectedAccountingBalance = value.initialBalance
    - value.totalStaked
    + value.totalGrossPayout;
  const expectedCanAfford = value.pendingCount === 0
    && value.deficit === 0
    && value.currentBalance >= ladder.nextStake;
  const campaignExhausted = value.deficit > 0
    || (value.pendingCount === 0 && value.currentBalance < ladder.nextStake);
  const expectedReservedStake = pendingBet?.stake ?? 0;
  const expectedPendingReset = pendingBet !== null
    && ladder.cycleStaked + pendingBet.stake === model.cycleSpendLimit
    ? PREDICTIVE_LEADER_V7_PAPER_LADDER_PENDING_RESET_REASON
    : null;
  const latestResetIsGap = latestReset?.reason === 'integrity_gap';
  const minimumNonGapResetCount = latestReset !== null && !latestResetIsGap ? 1 : 0;
  if (
    value.availableBalance !== value.currentBalance
    || value.reservedStake !== expectedReservedStake
    || value.currentBalance - value.deficit !== value.accountingBalance
    || (value.currentBalance > 0 && value.deficit > 0)
    || value.accountingBalance !== expectedAccountingBalance
    || value.profit !== value.accountingBalance - value.initialBalance
    || value.nextStake !== ladder.nextStake
    || value.shortfall !== Math.max(0, ladder.nextStake - value.accountingBalance)
    || value.settledCount !== expectedSettledCount
    || value.betCount !== expectedBetCount
    || value.pendingCount > 1
    || value.totalStaked % model.stakeStep !== 0
    || value.totalGrossPayout
      % (model.stakeStep * model.grossPayoutMultiplier) !== 0
    || value.canAffordNext !== expectedCanAfford
    || value.peakBalance < Math.max(value.initialBalance, value.currentBalance)
    || value.minimumBalance > Math.min(value.initialBalance, value.currentBalance)
    || value.maximumDrawdown < value.peakBalance - value.currentBalance
    || value.maximumDrawdown > value.peakBalance - value.minimumBalance
    || value.continuityGapCount
      > ladder.resetCount - minimumNonGapResetCount
    || (latestResetIsGap && value.continuityGapCount === 0)
    || (value.settledCount === 0
      ? value.hitRate !== null
      : value.hitRate !== value.hitCount / value.settledCount)
    || (pendingBet !== null) !== (value.pendingCount === 1)
    || (value.latestOutcome !== null) !== (latestOutcome !== null)
    || (value.latestVoid !== null) !== (latestVoid !== null)
    || (value.latestReset !== null) !== (latestReset !== null)
    || (latestOutcome !== null) !== (value.settledCount > 0)
    || (latestVoid !== null) !== (value.voidCount > 0)
    || (latestReset !== null) !== (ladder.resetCount > 0)
    || (latestReset !== null
      && latestReset.cycleNumberAfter !== ladder.cycleNumber)
    || ladder.pendingReset !== expectedPendingReset
    || (pendingBet !== null && (
      pendingBet.cycleNumber !== ladder.cycleNumber
      || pendingBet.cycleStakedBefore !== ladder.cycleStaked
      || pendingBet.ladderLossBefore !== ladder.ladderLoss
      || pendingBet.missCountBefore !== ladder.missCount
      || pendingBet.stake !== ladder.nextStake
    ))
    || (value.status === 'pending') !== (pendingBet !== null)
    || (value.status === 'exhausted') !== (campaignExhausted && pendingBet === null)
  ) {
    return null;
  }

  const startedAt = instant(value.startedAt);
  const updatedAt = instant(value.updatedAt);
  const exhaustedAt = value.exhaustedAt === null ? null : instant(value.exhaustedAt);
  if (
    startedAt === null
    || updatedAt === null
    || (value.exhaustedAt !== null) !== (exhaustedAt !== null)
    || !sameInstant(startedAt, activationStartedAt)
    || campaignExhausted !== (exhaustedAt !== null)
    || Date.parse(startedAt) > Date.parse(updatedAt)
  ) {
    return null;
  }
  if (
    pendingBet !== null
    && (
      Date.parse(pendingBet.placedAt) < Date.parse(startedAt)
      || Date.parse(pendingBet.placedAt) > Date.parse(updatedAt)
    )
  ) return null;
  if (
    latestOutcome !== null
    && (
      Date.parse(latestOutcome.occurredAt) < Date.parse(startedAt)
      || Date.parse(latestOutcome.occurredAt) > Date.parse(updatedAt)
    )
  ) return null;
  if (
    latestVoid !== null
    && (
      Date.parse(latestVoid.voidedAt) < Date.parse(startedAt)
      || Date.parse(latestVoid.voidedAt) > Date.parse(updatedAt)
    )
  ) return null;
  if (
    latestReset !== null
    && (
      Date.parse(latestReset.occurredAt) < Date.parse(startedAt)
      || Date.parse(latestReset.occurredAt) > Date.parse(updatedAt)
    )
  ) return null;

  return {
    schemaVersion: value.schemaVersion,
    strategyVersion: value.strategyVersion,
    campaignKey: value.campaignKey,
    candidateId: value.candidateId,
    promotionPolicy: value.promotionPolicy,
    authorizationReason: value.authorizationReason,
    activationBoundary: {
      firstForecastId,
      startedAt: activationStartedAt,
    },
    model,
    status: value.status,
    reason: value.reason,
    initialBalance: value.initialBalance,
    currentBalance: value.currentBalance,
    deficit: value.deficit,
    accountingBalance: value.accountingBalance,
    availableBalance: value.availableBalance,
    reservedStake: value.reservedStake,
    profit: value.profit,
    nextStake: value.nextStake,
    canAffordNext: value.canAffordNext,
    shortfall: value.shortfall,
    ledgerRevision: value.ledgerRevision,
    ladder,
    stats: {
      betCount: value.betCount,
      settledCount: value.settledCount,
      pendingCount: value.pendingCount,
      voidCount: value.voidCount,
      hitCount: value.hitCount,
      missCount: value.missCount,
      hitRate: value.hitRate,
      totalStaked: value.totalStaked,
      totalGrossPayout: value.totalGrossPayout,
      peakBalance: value.peakBalance,
      minimumBalance: value.minimumBalance,
      maximumDrawdown: value.maximumDrawdown,
      continuityGapCount: value.continuityGapCount,
    },
    pendingBet,
    latestOutcome,
    latestVoid,
    latestReset,
    startedAt,
    updatedAt,
    exhaustedAt,
  };
}

function auditForApi(value, source, instrument, candidateId) {
  if (
    !isPlainObject(value)
    || value.schemaVersion !== LEARNED_LEADER_V7_SCHEMA_VERSION
    || value.algorithmVersion !== LEARNED_LEADER_V7_ALGORITHM_VERSION
    || value.candidateId !== candidateId
    || value.source !== source
    || value.instrument !== instrument
    || value.executionEnabled !== false
    || value.advisoryOnly !== true
    || !isPlainObject(value.qualityGateDiagnostic)
    || value.qualityGateDiagnostic.promotionEligible !== false
  ) {
    return null;
  }
  let qualityGateDiagnostic;
  try {
    qualityGateDiagnostic = structuredClone(value.qualityGateDiagnostic);
  } catch {
    return null;
  }
  qualityGateDiagnostic.role = 'audit-only';
  qualityGateDiagnostic.controlsPaperAction = false;
  qualityGateDiagnostic.promotionEligible = false;

  if (value.latest === null) {
    return { latest: null, qualityGateDiagnostic };
  }
  const latest = value.latest;
  const forecastId = safeInteger(latest?.forecastId, { minimum: 1 });
  const normalizedRoundId = roundId(latest?.roundId);
  const lockedAt = instant(latest?.lockedAt);
  const bettingClosesAt = instant(latest?.bettingClosesAt);
  const roundEndsAt = instant(latest?.roundEndsAt);
  if (
    !isPlainObject(latest)
    || forecastId === null
    || normalizedRoundId === null
    || lockedAt === null
    || bettingClosesAt === null
    || roundEndsAt === null
    || Date.parse(lockedAt) >= Date.parse(bettingClosesAt)
    || Date.parse(bettingClosesAt) >= Date.parse(roundEndsAt)
  ) {
    return null;
  }
  const candidateNumber = safeRouletteNumber(latest.candidate?.leaderNumber);
  const candidate = isPlainObject(latest.candidate)
    ? {
        availability: latest.candidate.availability,
        status: latest.candidate.status,
        reason: latest.candidate.reason ?? null,
        selected: latest.candidate.selected === true,
        number: candidateNumber,
        evaluated: latest.candidate.evaluation !== null,
      }
    : null;
  return {
    latest: {
      forecastId,
      roundId: normalizedRoundId,
      lockedAt,
      bettingClosesAt,
      roundEndsAt,
      settled: latest.settlement !== null,
      candidate,
    },
    qualityGateDiagnostic,
  };
}

function freshnessForApi(runtimeState, audit, pendingBet, now) {
  const collector = runtimeState?.collector;
  const latestResult = runtimeState?.latestResult;
  const pipelinePending = runtimeState?.pipelinePending;
  const currentRoundId = roundId(collector?.currentRound?.id);
  const currentRoundStartsAt = instant(collector?.currentRound?.startsAt);
  const currentBettingClosesAt = instant(
    collector?.currentRound?.bettingClosesAt ?? collector?.currentRound?.closesAt,
  );
  const latestPersistedResultId = safeInteger(latestResult?.id, { minimum: 1 });
  const latestPersistedRoundId = roundId(
    latestResult?.roundId ?? latestResult?.externalRoundId,
  );
  const latestPersistedAt = instant(latestResult?.settledAt);
  const collectorLastResultAt = instant(collector?.lastResultAt);
  const pendingResultCount = safeInteger(collector?.pendingResultCount);
  const resultConfirmationPending =
    typeof collector?.resultConfirmationPending === 'boolean'
      ? collector.resultConfirmationPending
      : null;
  const persistencePendingResults = safeInteger(pipelinePending?.results);
  const persistencePendingGaps = safeInteger(pipelinePending?.gaps);
  const collectorReady = isPlainObject(collector)
    && collector.connected === true
    && collector.status === 'connected'
    && (collector.error === null || collector.error === undefined)
    && collector.currentRound?.status === 2;
  const resultCursorMatches = latestPersistedAt !== null
    && collectorLastResultAt !== null
    && sameInstant(latestPersistedAt, collectorLastResultAt);
  const roundCursorMatches = currentRoundId !== null
    && latestPersistedRoundId !== null
    && nextRoundMatches(latestPersistedRoundId, currentRoundId);
  const auditRoundMatches = currentRoundId !== null
    && audit?.latest?.roundId === currentRoundId;
  const pendingRoundMatches = currentRoundId !== null
    && pendingBet?.roundId === currentRoundId;
  const pendingForecastMatches = pendingBet !== null
    && audit?.latest?.forecastId === pendingBet.forecastId;
  const bettingWindowMatches = currentBettingClosesAt !== null
    && audit?.latest?.bettingClosesAt === currentBettingClosesAt
    && pendingBet?.bettingClosesAt === currentBettingClosesAt;
  const bettingOpen = collectorReady
    && currentRoundStartsAt !== null
    && currentBettingClosesAt !== null
    && Date.parse(currentRoundStartsAt) < Date.parse(currentBettingClosesAt)
    && Date.parse(now) >= Date.parse(currentRoundStartsAt)
    && Date.parse(now) < Date.parse(currentBettingClosesAt);

  return {
    collectorReady,
    currentRoundId,
    currentRoundStartsAt,
    currentBettingClosesAt,
    latestPersistedResultId,
    latestPersistedRoundId,
    latestPersistedAt,
    collectorLastResultAt,
    resultCursorMatches,
    roundCursorMatches,
    auditRoundMatches,
    pendingRoundMatches,
    pendingForecastMatches,
    bettingWindowMatches,
    bettingOpen,
    resultConfirmationPending,
    pendingResultCount,
    persistencePendingResults,
    persistencePendingGaps,
  };
}

function baseResponse({
  source,
  instrument,
  serverTime,
  account,
  audit,
  freshness,
}) {
  return {
    schemaVersion: PREDICTIVE_LEADER_V7_PAPER_API_SCHEMA_VERSION,
    strategyVersion: PREDICTIVE_LEADER_V7_PAPER_STRATEGY_VERSION,
    algorithmVersion: LEARNED_LEADER_V7_ALGORITHM_VERSION,
    mode: 'simulation',
    strategyMode: PREDICTIVE_LEADER_V7_PAPER_STRATEGY_MODE,
    executionEnabled: false,
    advisoryOnly: true,
    promotionEligible: false,
    promotionPolicy: 'manual-override-paper-not-promoted',
    manualOverride: {
      authorized: true,
      reason: account?.authorizationReason
        ?? AUTHORIZATION_REASON,
      qualityGateRequired: false,
      automaticPromotionEnabled: false,
    },
    source,
    instrument,
    serverTime,
    campaign: account
      ? {
          schemaVersion: account.schemaVersion,
          strategyVersion: account.strategyVersion,
          campaignKey: account.campaignKey,
          candidateId: account.candidateId,
          activationBoundary: account.activationBoundary,
          model: account.model,
          promotionEligible: false,
          promotionPolicy: account.promotionPolicy,
          authorizationReason: account.authorizationReason,
        }
      : null,
    status: 'waiting',
    reason: 'state_unavailable',
    action: 'WAIT',
    actionId: null,
    number: null,
    stake: null,
    candidateNumber: audit?.latest?.candidate?.number ?? null,
    forecast: audit?.latest
      ? {
          id: audit.latest.forecastId,
          roundId: audit.latest.roundId,
          lockedAt: audit.latest.lockedAt,
          bettingClosesAt: audit.latest.bettingClosesAt,
          roundEndsAt: audit.latest.roundEndsAt,
          settled: audit.latest.settled,
        }
      : null,
    account: account
      ? {
          status: account.status,
          reason: account.reason,
          initialBalance: account.initialBalance,
          currentBalance: account.currentBalance,
          deficit: account.deficit,
          accountingBalance: account.accountingBalance,
          availableBalance: account.availableBalance,
          reservedStake: account.reservedStake,
          profit: account.profit,
          nextStake: account.nextStake,
          canAffordNext: account.canAffordNext,
          shortfall: account.shortfall,
          ledgerRevision: account.ledgerRevision,
          startedAt: account.startedAt,
          updatedAt: account.updatedAt,
          exhaustedAt: account.exhaustedAt,
        }
      : null,
    stats: account?.stats ?? null,
    ladder: account?.ladder ?? null,
    pendingBet: account?.pendingBet ?? null,
    latestOutcome: account?.latestOutcome ?? null,
    latestVoid: account?.latestVoid ?? null,
    latestReset: account?.latestReset ?? null,
    qualityGateDiagnostic: audit?.qualityGateDiagnostic ?? null,
    freshness,
  };
}

function withStatus(base, status, reason, extra = {}) {
  return { ...base, status, reason, ...extra };
}

/**
 * Builds the read-only GET view for the operator-authorized V7 paper campaign.
 * A BET is descriptive: it only mirrors a pending bet already stored by the DB.
 */
export function predictiveLeaderV7PaperSnapshotForApi({
  paperState,
  auditState,
  runtimeState,
  source = 'buleto',
  instrument = 'default',
  now = new Date(),
} = {}) {
  const safeSource = canonicalText(source);
  const safeInstrument = canonicalText(instrument);
  if (safeSource === null || safeInstrument === null) {
    throw new TypeError('source and instrument are required');
  }
  const serverTime = instant(now);
  if (serverTime === null) throw new TypeError('now must be a valid timestamp');

  const account = accountStateForApi(paperState, safeSource, safeInstrument);
  const audit = account === null
    ? null
    : auditForApi(
        auditState,
        safeSource,
        safeInstrument,
        account.candidateId,
      );
  const freshness = freshnessForApi(
    runtimeState,
    audit,
    account?.pendingBet ?? null,
    serverTime,
  );
  const base = baseResponse({
    source: safeSource,
    instrument: safeInstrument,
    serverTime,
    account,
    audit,
    freshness,
  });

  if (!isPlainObject(paperState)) {
    return withStatus(base, 'waiting', 'paper_state_unavailable');
  }
  if (account === null) return withStatus(base, 'paused', 'paper_state_invalid');
  if (!isPlainObject(auditState)) {
    return withStatus(base, 'waiting', 'audit_unavailable');
  }
  if (audit === null) return withStatus(base, 'paused', 'audit_invalid');
  if (!isPlainObject(runtimeState?.collector) || !isPlainObject(runtimeState?.latestResult)) {
    return withStatus(base, 'waiting', 'cursor_unavailable');
  }
  if (!freshness.collectorReady) {
    return withStatus(base, 'paused', 'collector_unavailable');
  }
  if (
    freshness.latestPersistedResultId === null
    || freshness.latestPersistedRoundId === null
    || freshness.latestPersistedAt === null
    || freshness.collectorLastResultAt === null
    || freshness.currentRoundId === null
    || freshness.currentRoundStartsAt === null
    || freshness.currentBettingClosesAt === null
    || freshness.pendingResultCount === null
    || freshness.resultConfirmationPending === null
    || freshness.persistencePendingResults === null
    || freshness.persistencePendingGaps === null
  ) {
    return withStatus(base, 'paused', 'cursor_invalid');
  }
  if (freshness.resultConfirmationPending || freshness.pendingResultCount > 0) {
    return withStatus(base, 'paused', 'collector_pending');
  }
  if (
    freshness.persistencePendingResults > 0
    || freshness.persistencePendingGaps > 0
  ) {
    return withStatus(base, 'paused', 'persistence_pending');
  }
  if (!freshness.resultCursorMatches) {
    return withStatus(base, 'paused', 'result_cursor_mismatch');
  }
  if (!freshness.roundCursorMatches) {
    return withStatus(base, 'paused', 'round_cursor_mismatch');
  }
  if (account.status === 'exhausted') {
    return withStatus(base, 'waiting', 'bankroll_exhausted');
  }
  if (account.pendingBet === null) {
    return withStatus(base, 'waiting', 'paper_bet_not_pending');
  }
  if (audit.latest === null) {
    return withStatus(base, 'waiting', 'forecast_unavailable');
  }
  if (!freshness.auditRoundMatches || !freshness.pendingForecastMatches) {
    return withStatus(base, 'waiting', 'paper_pending_previous');
  }
  if (!freshness.pendingRoundMatches) {
    return withStatus(base, 'paused', 'paper_round_mismatch');
  }
  if (!freshness.bettingWindowMatches) {
    return withStatus(base, 'paused', 'round_metadata_mismatch');
  }
  if (audit.latest.settled) {
    return withStatus(base, 'waiting', 'forecast_settled');
  }
  if (Date.parse(serverTime) < Date.parse(audit.latest.lockedAt)) {
    return withStatus(base, 'paused', 'forecast_not_locked');
  }
  if (
    Date.parse(account.pendingBet.placedAt) > Date.parse(serverTime)
    || Date.parse(account.pendingBet.placedAt)
      < Date.parse(freshness.currentRoundStartsAt)
    || Date.parse(account.pendingBet.placedAt)
      < Date.parse(freshness.latestPersistedAt)
  ) {
    return withStatus(base, 'paused', 'paper_record_time_invalid');
  }
  if (!freshness.bettingOpen) {
    return withStatus(base, 'waiting', 'betting_closed');
  }
  const candidate = audit.latest.candidate;
  if (
    candidate === null
    || candidate.availability !== 'ready'
    || candidate.status !== 'ready'
    || candidate.selected !== true
    || candidate.evaluated
    || candidate.number === null
  ) {
    return withStatus(base, 'waiting', 'candidate_unavailable');
  }
  if (
    account.pendingBet.targetNumber !== candidate.number
    || !sameInstant(account.pendingBet.lockedAt, audit.latest.lockedAt)
    || !sameInstant(
      account.pendingBet.bettingClosesAt,
      audit.latest.bettingClosesAt,
    )
  ) {
    return withStatus(base, 'paused', 'paper_evidence_mismatch');
  }

  return withStatus(base, 'ready', 'ready', {
    action: 'BET',
    actionId: `v7-paper-bet:${account.pendingBet.id}`,
    number: account.pendingBet.targetNumber,
    stake: account.pendingBet.stake,
  });
}
