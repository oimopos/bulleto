import {
  LEARNED_LEADER_ALGORITHM_VERSION,
  LEARNED_LEADER_SCHEMA_VERSION,
  normalizeLearnedLeaderDecision,
} from './learned-leader.js';

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

function baseResponse({ source, instrument, serverTime, metrics, freshness }) {
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
  if (!isPlainObject(state)) {
    return baseResponse({
      source: safeSource,
      instrument: safeInstrument,
      serverTime,
      metrics,
      freshness: emptyFreshness(),
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
