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

export const PREDICTIVE_LEADER_API_SCHEMA_VERSION = 1;

const SUM_TOLERANCE = 1e-9;

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
  const expectedBetCount = settledCount + pendingCount;
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
}) {
  return {
    schemaVersion: PREDICTIVE_LEADER_API_SCHEMA_VERSION,
    algorithmVersion: LEARNED_LEADER_ALGORITHM_VERSION,
    mode: 'observation',
    executionEnabled: false,
    advisoryOnly: true,
    source,
    instrument,
    serverTime,
    status: 'waiting',
    reason: 'state_unavailable',
    number: null,
    forecast: null,
    model: null,
    account,
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
  const account = accountForApi(
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
  return withStatus(base, 'ready', 'ready', {
    number,
    forecast,
    model: {
      sourceCount: leader.sourceCount,
      familyCount: leader.familyCount,
      activeFamilies: Object.keys(activeFamilyWeights),
      activeFamilyWeights,
      learningVersion: leader.learning.version,
      learningStatus: leader.learning.status,
      trainingCount: leader.learning.trainingCount,
      learnedFamilyWeights,
      tieBreakApplied: leader.tieBreakApplied,
    },
  });
}
