import {
  LEARNED_LEADER_V7_ALGORITHM_VERSION,
  LEARNED_LEADER_V7_SCHEMA_VERSION,
} from './learned-leader-v7.js';

export const PREDICTIVE_LEADER_V7_PAPER_API_SCHEMA_VERSION = 1;
export const PREDICTIVE_LEADER_V7_PAPER_STRATEGY_VERSION =
  'predictive-leader-v7-manual-override-paper-v1';
export const PREDICTIVE_LEADER_V7_PAPER_STRATEGY_MODE =
  'manual-override-paper';

const INITIAL_BALANCE = 1_000;
const FIXED_STAKE = 10;
const GROSS_PAYOUT_MULTIPLIER = 36;

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

function pendingBetForApi(value) {
  if (!isPlainObject(value)) return null;
  const id = safeInteger(value.id, { minimum: 1 });
  const forecastId = safeInteger(value.forecastId, { minimum: 1 });
  const normalizedRoundId = roundId(value.roundId);
  const targetNumber = safeRouletteNumber(value.targetNumber);
  const lockedAt = instant(value.lockedAt);
  const bettingClosesAt = instant(value.bettingClosesAt);
  const placedAt = instant(value.placedAt);
  if (
    id === null
    || forecastId === null
    || normalizedRoundId === null
    || targetNumber === null
    || value.stake !== FIXED_STAKE
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
    stake: value.stake,
    lockedAt,
    bettingClosesAt,
    placedAt,
  };
}

function latestOutcomeForApi(value) {
  if (!isPlainObject(value)) return null;
  const betId = safeInteger(value.betId, { minimum: 1 });
  const forecastId = safeInteger(value.forecastId, { minimum: 1 });
  const resultId = safeInteger(value.resultId, { minimum: 1 });
  const normalizedRoundId = roundId(value.roundId);
  const targetNumber = safeRouletteNumber(value.targetNumber);
  const resultNumber = safeRouletteNumber(value.resultNumber);
  const balanceAfter = safeInteger(value.balanceAfter);
  const occurredAt = instant(value.occurredAt);
  const outcome = targetNumber === resultNumber ? 'hit' : 'miss';
  const grossPayout = outcome === 'hit'
    ? FIXED_STAKE * GROSS_PAYOUT_MULTIPLIER
    : 0;
  if (
    betId === null
    || forecastId === null
    || resultId === null
    || normalizedRoundId === null
    || targetNumber === null
    || resultNumber === null
    || value.outcome !== outcome
    || value.stake !== FIXED_STAKE
    || value.grossPayout !== grossPayout
    || balanceAfter === null
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
    stake: value.stake,
    grossPayout,
    balanceAfter,
    occurredAt,
  };
}

function latestVoidForApi(value) {
  if (!isPlainObject(value)) return null;
  const betId = safeInteger(value.betId, { minimum: 1 });
  const forecastId = safeInteger(value.forecastId, { minimum: 1 });
  const normalizedRoundId = roundId(value.roundId);
  const targetNumber = safeRouletteNumber(value.targetNumber);
  const voidedAt = instant(value.voidedAt);
  if (
    betId === null
    || forecastId === null
    || normalizedRoundId === null
    || targetNumber === null
    || value.stake !== FIXED_STAKE
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
    stake: value.stake,
    reason: value.reason,
    voidedAt,
  };
}

function accountStateForApi(value, source, instrument) {
  if (
    !isPlainObject(value)
    || value.schemaVersion !== 1
    || value.strategyVersion !== PREDICTIVE_LEADER_V7_PAPER_STRATEGY_VERSION
    || value.algorithmVersion !== LEARNED_LEADER_V7_ALGORITHM_VERSION
    || canonicalText(value.candidateId) === null
    || canonicalText(value.campaignKey) === null
    || value.mode !== PREDICTIVE_LEADER_V7_PAPER_STRATEGY_MODE
    || value.executionEnabled !== false
    || value.advisoryOnly !== true
    || value.promotionEligible !== false
    || value.promotionPolicy !== 'manual-override-paper-not-promoted'
    || value.authorizationReason !== 'operator-requested-virtual-api-2026-10-19'
    || value.source !== source
    || value.instrument !== instrument
    || value.initialBalance !== INITIAL_BALANCE
    || !ACCOUNT_REASONS[value.status]?.has(value.reason)
    || !isPlainObject(value.model)
    || value.model.fixedStake !== FIXED_STAKE
    || value.model.grossPayoutMultiplier !== GROSS_PAYOUT_MULTIPLIER
    || value.model.payoutIncludesStake !== true
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
  ];
  if (nonNegativeIntegerFields.some((key) => safeInteger(value[key]) === null)) {
    return null;
  }
  if (
    !Number.isSafeInteger(value.accountingBalance)
    || !Number.isSafeInteger(value.minimumBalance)
    || !Number.isSafeInteger(value.profit)
  ) return null;

  const pendingBet = value.pendingBet === null
    ? null
    : pendingBetForApi(value.pendingBet);
  const latestOutcome = value.latestOutcome === null
    ? null
    : latestOutcomeForApi(value.latestOutcome);
  const latestVoid = value.latestVoid === null
    ? null
    : latestVoidForApi(value.latestVoid);
  const expectedSettledCount = value.hitCount + value.missCount;
  const expectedBetCount = value.settledCount + value.pendingCount + value.voidCount;
  const expectedTotalStaked = (value.settledCount + value.pendingCount) * FIXED_STAKE;
  const expectedGrossPayout = value.hitCount * FIXED_STAKE
    * GROSS_PAYOUT_MULTIPLIER;
  const expectedAccountingBalance = value.initialBalance
    - expectedTotalStaked
    + expectedGrossPayout;
  const expectedCanAfford = value.pendingCount === 0
    && value.deficit === 0
    && value.currentBalance >= FIXED_STAKE;
  const campaignExhausted = value.deficit > 0
    || (value.pendingCount === 0 && value.currentBalance < FIXED_STAKE);
  if (
    value.availableBalance !== value.currentBalance
    || value.reservedStake !== value.pendingCount * FIXED_STAKE
    || value.currentBalance - value.deficit !== value.accountingBalance
    || (value.currentBalance > 0 && value.deficit > 0)
    || value.accountingBalance !== expectedAccountingBalance
    || value.profit !== value.accountingBalance - value.initialBalance
    || value.nextStake !== FIXED_STAKE
    || value.shortfall !== Math.max(0, FIXED_STAKE - value.accountingBalance)
    || value.settledCount !== expectedSettledCount
    || value.betCount !== expectedBetCount
    || value.pendingCount > 1
    || value.totalStaked !== expectedTotalStaked
    || value.totalGrossPayout !== expectedGrossPayout
    || value.canAffordNext !== expectedCanAfford
    || value.peakBalance < Math.max(value.initialBalance, value.currentBalance)
    || value.minimumBalance > Math.min(value.initialBalance, value.currentBalance)
    || value.maximumDrawdown < value.peakBalance - value.currentBalance
    || value.maximumDrawdown > value.peakBalance - value.minimumBalance
    || value.continuityGapCount > value.voidCount
    || (value.settledCount === 0
      ? value.hitRate !== null
      : value.hitRate !== value.hitCount / value.settledCount)
    || (pendingBet !== null) !== (value.pendingCount === 1)
    || (value.latestOutcome !== null) !== (latestOutcome !== null)
    || (value.latestVoid !== null) !== (latestVoid !== null)
    || (latestOutcome !== null) !== (value.settledCount > 0)
    || (latestVoid !== null) !== (value.voidCount > 0)
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

  return {
    campaignKey: value.campaignKey,
    candidateId: value.candidateId,
    promotionPolicy: value.promotionPolicy,
    authorizationReason: value.authorizationReason,
    activationBoundary: {
      firstForecastId,
      startedAt: activationStartedAt,
    },
    model: {
      fixedStake: value.model.fixedStake,
      grossPayoutMultiplier: value.model.grossPayoutMultiplier,
      payoutIncludesStake: value.model.payoutIncludesStake,
    },
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
        ?? 'operator-requested-virtual-api-2026-10-19',
      qualityGateRequired: false,
      automaticPromotionEnabled: false,
    },
    source,
    instrument,
    serverTime,
    campaign: account
      ? {
          schemaVersion: 1,
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
          startedAt: account.startedAt,
          updatedAt: account.updatedAt,
          exhaustedAt: account.exhaustedAt,
        }
      : null,
    stats: account?.stats ?? null,
    pendingBet: account?.pendingBet ?? null,
    latestOutcome: account?.latestOutcome ?? null,
    latestVoid: account?.latestVoid ?? null,
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
  });
}
