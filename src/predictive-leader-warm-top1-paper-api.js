import {
  WARM_TOP1_ALGORITHM_VERSION,
  WARM_TOP1_BREAK_EVEN_RATE,
  WARM_TOP1_GATE,
  WARM_TOP1_GATE_TARGET_SAMPLE_SIZE,
  WARM_TOP1_GATE_VERSION,
  WARM_TOP1_MINIMUM_OBSERVED_FOLLOWERS,
  WARM_TOP1_SHARE_THRESHOLD_PERCENT,
} from './warm-top1-quality-gate.js';

export const PREDICTIVE_LEADER_WARM_TOP1_PAPER_API_SCHEMA_VERSION = 1;
export const PREDICTIVE_LEADER_WARM_TOP1_PAPER_STRATEGY_VERSION =
  'predictive-leader-warm-top1-quality-paper-ladder-v1';
export const PREDICTIVE_LEADER_WARM_TOP1_ALGORITHM_VERSION =
  WARM_TOP1_ALGORITHM_VERSION;
export const PREDICTIVE_LEADER_WARM_TOP1_GATE_VERSION =
  WARM_TOP1_GATE_VERSION;
export const PREDICTIVE_LEADER_WARM_TOP1_PAPER_STRATEGY_MODE =
  'quality-gated-warm-top1-paper-ladder';
export const PREDICTIVE_LEADER_WARM_TOP1_DECISION_SOURCE =
  'follower-warm-top1';

const GATE_WINDOW_POLICY = WARM_TOP1_GATE.windowPolicy;
const GATE_TARGET_SAMPLE_SIZE = WARM_TOP1_GATE_TARGET_SAMPLE_SIZE;
const ECONOMIC_BREAK_EVEN_TOP1_RATE = WARM_TOP1_BREAK_EVEN_RATE;
const WARM_THRESHOLD = WARM_TOP1_SHARE_THRESHOLD_PERCENT / 100;
const MINIMUM_OBSERVED_FOLLOWERS = WARM_TOP1_MINIMUM_OBSERVED_FOLLOWERS;
const MINIMUM_PLACEMENT_LEAD_MS = 5_000;
const MINIMUM_STAKE = 10;
const MAXIMUM_STAKE = 2_500;
const STAKE_STEP = 10;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clonePlain(value) {
  if (!isPlainObject(value)) return null;
  try {
    return structuredClone(value);
  } catch {
    return null;
  }
}

function canonicalText(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function safeInteger(value, { minimum = 0, maximum } = {}) {
  if (
    !Number.isSafeInteger(value)
    || value < minimum
    || (maximum !== undefined && value > maximum)
  ) {
    return null;
  }
  return value;
}

function finiteNumber(value, { minimum, maximum } = {}) {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || (minimum !== undefined && value < minimum)
    || (maximum !== undefined && value > maximum)
  ) {
    return null;
  }
  return value;
}

function boolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function instant(value) {
  const raw = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(raw) ? new Date(raw).toISOString() : null;
}

function sameInstant(left, right) {
  const leftInstant = instant(left);
  const rightInstant = instant(right);
  return leftInstant !== null && leftInstant === rightInstant;
}

function roundId(value) {
  if (typeof value === 'bigint') return value >= 0n ? value.toString() : null;
  if (Number.isSafeInteger(value) && value >= 0) return String(value);
  return canonicalText(value);
}

function nextRoundMatches(previous, current) {
  try {
    return BigInt(current) === BigInt(previous) + 1n;
  } catch {
    return false;
  }
}

function sha256(value) {
  const normalized = canonicalText(value);
  return normalized !== null && SHA256_PATTERN.test(normalized)
    ? normalized
    : null;
}

function closeEnough(left, right, tolerance = 1e-12) {
  return Number.isFinite(left)
    && Number.isFinite(right)
    && Math.abs(left - right) <= tolerance;
}

function intervalForApi(value, { minimum, maximum } = {}) {
  if (!isPlainObject(value)) return null;
  const lower = finiteNumber(value.lower, { minimum, maximum });
  const upper = finiteNumber(value.upper, { minimum, maximum });
  if (lower === null || upper === null || lower > upper) return null;
  return { lower, upper };
}

function hacIntervalForApi(value) {
  if (!isPlainObject(value)) return null;
  const mean = finiteNumber(value.mean);
  const lower = finiteNumber(value.lower);
  const upper = finiteNumber(value.upper);
  if (mean === null || lower === null || upper === null || lower > upper) {
    return null;
  }
  return { mean, lower, upper };
}

function forecastForApi(value) {
  if (!isPlainObject(value)) return null;
  const id = safeInteger(value.id, { minimum: 1 });
  const normalizedRoundId = roundId(value.roundId);
  const lockedAt = instant(value.lockedAt);
  const bettingClosesAt = instant(value.bettingClosesAt);
  const roundEndsAt = value.roundEndsAt == null ? null : instant(value.roundEndsAt);
  const settled = boolean(value.settled);
  if (
    id === null
    || normalizedRoundId === null
    || lockedAt === null
    || bettingClosesAt === null
    || settled === null
    || Date.parse(lockedAt) >= Date.parse(bettingClosesAt)
    || (roundEndsAt !== null && Date.parse(bettingClosesAt) > Date.parse(roundEndsAt))
  ) {
    return null;
  }
  return {
    id,
    roundId: normalizedRoundId,
    lockedAt,
    bettingClosesAt,
    roundEndsAt,
    settled,
  };
}

function candidateEvidenceForApi(value) {
  if (!isPlainObject(value)) return null;
  const status = canonicalText(value.status);
  const reason = canonicalText(value.reason);
  const eligible = boolean(value.eligible);
  const algorithmVersion = canonicalText(value.algorithmVersion);
  const rank = safeInteger(value.rank, { minimum: 1, maximum: 5 });
  const number = safeInteger(value.number, { minimum: 0, maximum: 36 });
  const occurrenceCount = safeInteger(value.occurrenceCount, { minimum: 1 });
  const sampleSize = safeInteger(value.sampleSize, { minimum: 1 });
  const share = finiteNumber(value.share, { minimum: 0, maximum: 1 });
  const threshold = finiteNumber(value.threshold, { minimum: 0, maximum: 1 });
  const comparison = canonicalText(value.comparison);
  const observedFollowerCount = safeInteger(value.observedFollowerCount, {
    minimum: 0,
    maximum: 37,
  });
  const anchorResultId = safeInteger(value.anchorResultId, { minimum: 1 });
  const anchorNumber = safeInteger(value.anchorNumber, { minimum: 0, maximum: 36 });
  const anchorSettledAt = instant(value.anchorSettledAt);
  const historyMaxResultId = safeInteger(value.historyMaxResultId, { minimum: 1 });
  const historyCutoffAt = instant(value.historyCutoffAt);
  const evidenceSha256 = sha256(value.evidenceSha256);
  if (
    status === null
    || reason === null
    || eligible === null
    || algorithmVersion === null
    || rank === null
    || number === null
    || occurrenceCount === null
    || sampleSize === null
    || occurrenceCount > sampleSize
    || share === null
    || threshold === null
    || comparison === null
    || observedFollowerCount === null
    || anchorResultId === null
    || anchorNumber === null
    || anchorSettledAt === null
    || historyMaxResultId === null
    || historyMaxResultId < anchorResultId
    || historyCutoffAt === null
    || Date.parse(anchorSettledAt) >= Date.parse(historyCutoffAt)
    || evidenceSha256 === null
  ) {
    return null;
  }
  return {
    status,
    reason,
    eligible,
    algorithmVersion,
    rank,
    number,
    occurrenceCount,
    sampleSize,
    share,
    threshold,
    comparison,
    observedFollowerCount,
    anchorResultId,
    anchorNumber,
    anchorSettledAt,
    historyMaxResultId,
    historyCutoffAt,
    evidenceSha256,
  };
}

function qualityGateForApi(value) {
  if (!isPlainObject(value)) return null;
  const version = canonicalText(value.version);
  const status = canonicalText(value.status);
  const reason = value.reason == null ? null : canonicalText(value.reason);
  const eligible = boolean(value.eligible);
  const controlsPaperAction = boolean(value.controlsPaperAction);
  const windowPolicy = canonicalText(value.windowPolicy);
  const targetSampleSize = safeInteger(value.targetSampleSize, { minimum: 1 });
  const selectedCount = safeInteger(value.selectedCount);
  const settledCount = safeInteger(value.settledCount);
  const sampleSize = safeInteger(value.sampleSize);
  const hitCount = safeInteger(value.hitCount);
  const fixedWindowComplete = boolean(value.fixedWindowComplete);
  const settlementComplete = boolean(value.settlementComplete);
  const windowStartForecastId = value.windowStartForecastId == null
    ? null
    : safeInteger(value.windowStartForecastId, { minimum: 1 });
  const windowEndForecastId = value.windowEndForecastId == null
    ? null
    : safeInteger(value.windowEndForecastId, { minimum: 1 });
  const economicBreakEvenTop1Rate = finiteNumber(
    value.economicBreakEvenTop1Rate,
    { minimum: 0, maximum: 1 },
  );
  const top1Wilson95 = value.top1Wilson95 == null
    ? null
    : intervalForApi(value.top1Wilson95, { minimum: 0, maximum: 1 });
  const binaryBrierDeltaVsUniformHac95 =
    value.binaryBrierDeltaVsUniformHac95 == null
      ? null
      : hacIntervalForApi(value.binaryBrierDeltaVsUniformHac95);
  const criteria = clonePlain(value.criteria);
  const evidenceSha256 = value.evidenceSha256 == null
    ? null
    : sha256(value.evidenceSha256);
  const frozenAt = value.frozenAt == null ? null : instant(value.frozenAt);
  if (
    version === null
    || status === null
    || eligible === null
    || controlsPaperAction === null
    || windowPolicy === null
    || targetSampleSize === null
    || selectedCount === null
    || settledCount === null
    || sampleSize === null
    || hitCount === null
    || settledCount > selectedCount
    || sampleSize > settledCount
    || hitCount > sampleSize
    || fixedWindowComplete === null
    || settlementComplete === null
    || economicBreakEvenTop1Rate === null
    || criteria === null
  ) {
    return null;
  }
  return {
    version,
    status,
    reason,
    eligible,
    controlsPaperAction,
    windowPolicy,
    targetSampleSize,
    selectedCount,
    settledCount,
    sampleSize,
    hitCount,
    fixedWindowComplete,
    settlementComplete,
    windowStartForecastId,
    windowEndForecastId,
    economicBreakEvenTop1Rate,
    top1Wilson95,
    binaryBrierDeltaVsUniformHac95,
    criteria,
    evidenceSha256,
    frozenAt,
  };
}

function pendingBetForApi(value) {
  if (!isPlainObject(value)) return null;
  const id = safeInteger(value.id, { minimum: 1 });
  const forecastId = safeInteger(value.forecastId, { minimum: 1 });
  const normalizedRoundId = roundId(value.roundId);
  const targetNumber = safeInteger(value.targetNumber, { minimum: 0, maximum: 36 });
  const stake = safeInteger(value.stake, {
    minimum: MINIMUM_STAKE,
    maximum: MAXIMUM_STAKE,
  });
  const status = canonicalText(value.status);
  const decisionSource = canonicalText(value.decisionSource);
  const algorithmVersion = canonicalText(value.algorithmVersion);
  const gateVersion = canonicalText(value.gateVersion);
  const candidateEvidenceSha256 = sha256(value.candidateEvidenceSha256);
  const gateEvidenceSha256 = sha256(value.gateEvidenceSha256);
  const lockedAt = instant(value.lockedAt);
  const bettingClosesAt = instant(value.bettingClosesAt);
  const placedAt = instant(value.placedAt);
  if (
    id === null
    || forecastId === null
    || normalizedRoundId === null
    || targetNumber === null
    || stake === null
    || stake % STAKE_STEP !== 0
    || status !== 'pending'
    || decisionSource !== PREDICTIVE_LEADER_WARM_TOP1_DECISION_SOURCE
    || algorithmVersion !== PREDICTIVE_LEADER_WARM_TOP1_ALGORITHM_VERSION
    || gateVersion !== PREDICTIVE_LEADER_WARM_TOP1_GATE_VERSION
    || candidateEvidenceSha256 === null
    || gateEvidenceSha256 === null
    || lockedAt === null
    || bettingClosesAt === null
    || placedAt === null
    || Date.parse(placedAt) < Date.parse(lockedAt)
    || Date.parse(bettingClosesAt) - Date.parse(placedAt)
      < MINIMUM_PLACEMENT_LEAD_MS
  ) {
    return null;
  }
  return {
    id,
    forecastId,
    roundId: normalizedRoundId,
    targetNumber,
    stake,
    status,
    decisionSource,
    algorithmVersion,
    gateVersion,
    candidateEvidenceSha256,
    gateEvidenceSha256,
    lockedAt,
    bettingClosesAt,
    placedAt,
  };
}

function accountForApi(value) {
  if (!isPlainObject(value)) return null;
  const status = canonicalText(value.status);
  const reason = canonicalText(value.reason);
  const initialBalance = safeInteger(value.initialBalance);
  const currentBalance = safeInteger(value.currentBalance);
  const deficit = safeInteger(value.deficit);
  const accountingBalance = safeInteger(value.accountingBalance);
  const availableBalance = safeInteger(value.availableBalance);
  const reservedStake = safeInteger(value.reservedStake);
  const profit = safeInteger(value.profit, { minimum: Number.MIN_SAFE_INTEGER });
  const nextStake = safeInteger(value.nextStake, {
    minimum: MINIMUM_STAKE,
    maximum: MAXIMUM_STAKE,
  });
  const canAffordNext = boolean(value.canAffordNext);
  const shortfall = safeInteger(value.shortfall);
  const ledgerRevision = safeInteger(value.ledgerRevision);
  const startedAt = instant(value.startedAt);
  const updatedAt = instant(value.updatedAt);
  const exhaustedAt = value.exhaustedAt == null ? null : instant(value.exhaustedAt);
  if (
    status === null
    || reason === null
    || initialBalance === null
    || currentBalance === null
    || deficit === null
    || accountingBalance === null
    || availableBalance === null
    || reservedStake === null
    || profit === null
    || nextStake === null
    || nextStake % STAKE_STEP !== 0
    || canAffordNext === null
    || shortfall === null
    || ledgerRevision === null
    || startedAt === null
    || updatedAt === null
    || Date.parse(updatedAt) < Date.parse(startedAt)
    || (exhaustedAt !== null && Date.parse(exhaustedAt) < Date.parse(startedAt))
  ) {
    return null;
  }
  return {
    status,
    reason,
    initialBalance,
    currentBalance,
    deficit,
    accountingBalance,
    availableBalance,
    reservedStake,
    profit,
    nextStake,
    canAffordNext,
    shortfall,
    ledgerRevision,
    startedAt,
    updatedAt,
    exhaustedAt,
  };
}

function validPaperStateIdentity(state, source, instrument) {
  return isPlainObject(state)
    && state.schemaVersion === PREDICTIVE_LEADER_WARM_TOP1_PAPER_API_SCHEMA_VERSION
    && state.strategyVersion === PREDICTIVE_LEADER_WARM_TOP1_PAPER_STRATEGY_VERSION
    && state.algorithmVersion === PREDICTIVE_LEADER_WARM_TOP1_ALGORITHM_VERSION
    && state.mode === PREDICTIVE_LEADER_WARM_TOP1_PAPER_STRATEGY_MODE
    && (
      state.strategyMode === undefined
      || state.strategyMode === PREDICTIVE_LEADER_WARM_TOP1_PAPER_STRATEGY_MODE
    )
    && state.executionEnabled === false
    && state.advisoryOnly === true
    && state.source === source
    && state.instrument === instrument;
}

function confirmedGateReady(gate) {
  if (
    gate === null
    || gate.version !== PREDICTIVE_LEADER_WARM_TOP1_GATE_VERSION
    || gate.status !== 'confirmed'
    || gate.eligible !== true
    || gate.controlsPaperAction !== true
    || gate.windowPolicy !== GATE_WINDOW_POLICY
    || gate.targetSampleSize !== GATE_TARGET_SAMPLE_SIZE
    || gate.selectedCount !== GATE_TARGET_SAMPLE_SIZE
    || gate.settledCount !== GATE_TARGET_SAMPLE_SIZE
    || gate.sampleSize !== GATE_TARGET_SAMPLE_SIZE
    || gate.fixedWindowComplete !== true
    || gate.settlementComplete !== true
    || gate.windowStartForecastId === null
    || gate.windowEndForecastId === null
    || gate.windowEndForecastId < gate.windowStartForecastId
    || !closeEnough(
      gate.economicBreakEvenTop1Rate,
      ECONOMIC_BREAK_EVEN_TOP1_RATE,
    )
    || gate.top1Wilson95 === null
    || gate.top1Wilson95.lower <= ECONOMIC_BREAK_EVEN_TOP1_RATE
    || gate.binaryBrierDeltaVsUniformHac95 === null
    || gate.binaryBrierDeltaVsUniformHac95.upper >= 0
    || gate.evidenceSha256 === null
    || gate.frozenAt === null
  ) {
    return false;
  }
  const requiredCriteria = [
    'fixedSampleComplete',
    'metadataIntegrity',
    'exactHitRate',
    'brierVsUniform',
  ];
  return requiredCriteria.every((key) => gate.criteria[key] === true)
    && Object.values(gate.criteria).every((value) => value === true);
}

function actionableCandidate(candidate, forecast) {
  return candidate !== null
    && candidate.status === 'ready'
    && candidate.reason === 'threshold_met'
    && candidate.eligible === true
    && candidate.algorithmVersion === PREDICTIVE_LEADER_WARM_TOP1_ALGORITHM_VERSION
    && candidate.rank === 1
    && closeEnough(candidate.threshold, WARM_THRESHOLD)
    && candidate.comparison === 'gte'
    && candidate.observedFollowerCount >= MINIMUM_OBSERVED_FOLLOWERS
    && candidate.occurrenceCount * 100 >= candidate.sampleSize * 5
    && closeEnough(
      candidate.share,
      candidate.occurrenceCount / candidate.sampleSize,
    )
    && forecast !== null
    && sameInstant(candidate.historyCutoffAt, forecast.lockedAt);
}

function freshnessForApi(runtimeState, forecast, pendingBet, now) {
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
  const resultConfirmationPending = boolean(collector?.resultConfirmationPending);
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
  const forecastRoundMatches = currentRoundId !== null
    && forecast?.roundId === currentRoundId;
  const pendingRoundMatches = currentRoundId !== null
    && pendingBet?.roundId === currentRoundId;
  const pendingForecastMatches = pendingBet !== null
    && forecast !== null
    && pendingBet.forecastId === forecast.id;
  const bettingWindowMatches = currentBettingClosesAt !== null
    && forecast?.bettingClosesAt === currentBettingClosesAt
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
    forecastRoundMatches,
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
  state,
  forecast,
  candidateEvidence,
  qualityGate,
  account,
  pendingBet,
  freshness,
}) {
  return {
    schemaVersion: PREDICTIVE_LEADER_WARM_TOP1_PAPER_API_SCHEMA_VERSION,
    strategyVersion: PREDICTIVE_LEADER_WARM_TOP1_PAPER_STRATEGY_VERSION,
    algorithmVersion: PREDICTIVE_LEADER_WARM_TOP1_ALGORITHM_VERSION,
    mode: 'simulation',
    strategyMode: PREDICTIVE_LEADER_WARM_TOP1_PAPER_STRATEGY_MODE,
    executionEnabled: false,
    advisoryOnly: true,
    source,
    instrument,
    serverTime,
    campaign: clonePlain(state?.campaign),
    status: 'waiting',
    reason: 'state_unavailable',
    action: 'WAIT',
    actionId: null,
    number: null,
    stake: null,
    selectedSource: null,
    candidateNumber: candidateEvidence?.number ?? null,
    forecast,
    candidateEvidence,
    qualityGate,
    account,
    pendingBet,
    latestOutcome: clonePlain(state?.latestOutcome),
    latestVoid: clonePlain(state?.latestVoid),
    latestReset: clonePlain(state?.latestReset),
    freshness,
  };
}

function wait(base, status, reason) {
  return {
    ...base,
    status,
    reason,
    action: 'WAIT',
    actionId: null,
    number: null,
    stake: null,
    selectedSource: null,
  };
}

/**
 * Converts durable, normalized database state plus live collector cursors into
 * the public warm Top-1 paper contract. This function is deliberately
 * fail-closed: it never creates a bet and only mirrors a persisted pending row.
 */
export function predictiveLeaderWarmTop1PaperSnapshotForApi(options = {}) {
  if (!isPlainObject(options)) {
    throw new TypeError('options must be an object');
  }
  const state = options.paperState ?? options.state ?? null;
  const runtimeState = options.runtimeState ?? null;
  const source = canonicalText(options.source ?? 'buleto');
  const instrument = canonicalText(options.instrument ?? 'default');
  const serverTime = instant(options.now ?? new Date());
  if (source === null || instrument === null) {
    throw new TypeError('source and instrument are required');
  }
  if (serverTime === null) throw new TypeError('now must be a valid timestamp');

  const forecast = forecastForApi(state?.forecast);
  const candidateEvidence = candidateEvidenceForApi(state?.candidateEvidence);
  const qualityGate = qualityGateForApi(state?.qualityGate);
  const account = accountForApi(state?.account);
  const pendingBet = pendingBetForApi(state?.pendingBet);
  const freshness = freshnessForApi(
    runtimeState,
    forecast,
    pendingBet,
    serverTime,
  );
  const base = baseResponse({
    source,
    instrument,
    serverTime,
    state,
    forecast,
    candidateEvidence,
    qualityGate,
    account,
    pendingBet,
    freshness,
  });

  if (!isPlainObject(state)) {
    return wait(base, 'waiting', 'paper_state_unavailable');
  }
  if (!validPaperStateIdentity(state, source, instrument)) {
    return wait(base, 'paused', 'paper_state_invalid');
  }
  if (qualityGate === null) {
    return wait(base, 'paused', 'quality_gate_invalid');
  }
  if (!confirmedGateReady(qualityGate)) {
    if (qualityGate.status === 'collecting') {
      return wait(base, 'waiting', 'quality_gate_collecting');
    }
    if (qualityGate.status === 'rejected') {
      return wait(base, 'waiting', 'quality_gate_rejected');
    }
    return wait(base, 'paused', 'quality_gate_not_confirmed');
  }
  if (account === null) return wait(base, 'paused', 'account_invalid');
  if (
    account.status === 'exhausted'
    || (state.pendingBet == null && account.shortfall > 0)
  ) {
    return wait(base, 'waiting', 'bankroll_exhausted');
  }
  if (forecast === null) {
    return wait(
      base,
      state.forecast == null ? 'waiting' : 'paused',
      state.forecast == null ? 'forecast_unavailable' : 'forecast_invalid',
    );
  }
  if (!actionableCandidate(candidateEvidence, forecast)) {
    return wait(
      base,
      state.candidateEvidence == null ? 'waiting' : 'paused',
      state.candidateEvidence == null ? 'candidate_unavailable' : 'candidate_invalid',
    );
  }
  if (pendingBet === null) {
    return wait(
      base,
      state.pendingBet == null ? 'waiting' : 'paused',
      state.pendingBet == null ? 'paper_bet_not_pending' : 'paper_pending_invalid',
    );
  }
  if (!isPlainObject(runtimeState?.collector) || !isPlainObject(runtimeState?.latestResult)) {
    return wait(base, 'waiting', 'cursor_unavailable');
  }
  if (!freshness.collectorReady) {
    return wait(base, 'paused', 'collector_unavailable');
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
    return wait(base, 'paused', 'cursor_invalid');
  }
  if (freshness.resultConfirmationPending || freshness.pendingResultCount > 0) {
    return wait(base, 'paused', 'collector_pending');
  }
  if (
    freshness.persistencePendingResults > 0
    || freshness.persistencePendingGaps > 0
  ) {
    return wait(base, 'paused', 'persistence_pending');
  }
  if (!freshness.resultCursorMatches) {
    return wait(base, 'paused', 'result_cursor_mismatch');
  }
  if (
    candidateEvidence.anchorResultId !== freshness.latestPersistedResultId
    || candidateEvidence.historyMaxResultId !== freshness.latestPersistedResultId
    || !sameInstant(candidateEvidence.anchorSettledAt, freshness.latestPersistedAt)
    || !sameInstant(candidateEvidence.anchorSettledAt, freshness.collectorLastResultAt)
  ) {
    return wait(base, 'paused', 'candidate_cursor_mismatch');
  }
  if (!freshness.roundCursorMatches) {
    return wait(base, 'paused', 'round_cursor_mismatch');
  }
  if (!freshness.forecastRoundMatches || !freshness.pendingForecastMatches) {
    return wait(base, 'waiting', 'paper_pending_previous');
  }
  if (!freshness.pendingRoundMatches) {
    return wait(base, 'paused', 'paper_round_mismatch');
  }
  if (!freshness.bettingWindowMatches) {
    return wait(base, 'paused', 'round_metadata_mismatch');
  }
  if (forecast.settled) return wait(base, 'waiting', 'forecast_settled');
  if (Date.parse(serverTime) < Date.parse(forecast.lockedAt)) {
    return wait(base, 'paused', 'forecast_not_locked');
  }
  if (
    Date.parse(pendingBet.placedAt) > Date.parse(serverTime)
    || Date.parse(pendingBet.placedAt) < Date.parse(freshness.currentRoundStartsAt)
    || Date.parse(pendingBet.placedAt) < Date.parse(freshness.latestPersistedAt)
  ) {
    return wait(base, 'paused', 'paper_record_time_invalid');
  }
  if (!freshness.bettingOpen) return wait(base, 'waiting', 'betting_closed');
  if (
    pendingBet.forecastId !== forecast.id
    || pendingBet.roundId !== forecast.roundId
    || pendingBet.targetNumber !== candidateEvidence.number
    || pendingBet.algorithmVersion !== candidateEvidence.algorithmVersion
    || pendingBet.gateVersion !== qualityGate.version
    || pendingBet.candidateEvidenceSha256 !== candidateEvidence.evidenceSha256
    || pendingBet.gateEvidenceSha256 !== qualityGate.evidenceSha256
    || !sameInstant(pendingBet.lockedAt, forecast.lockedAt)
    || !sameInstant(pendingBet.bettingClosesAt, forecast.bettingClosesAt)
  ) {
    return wait(base, 'paused', 'paper_evidence_mismatch');
  }
  if (
    account.status !== 'pending'
    || account.reason !== 'bet_frozen'
    || account.reservedStake !== pendingBet.stake
    || account.nextStake !== pendingBet.stake
    || account.canAffordNext !== false
  ) {
    return wait(base, 'paused', 'paper_account_mismatch');
  }

  return {
    ...base,
    status: 'ready',
    reason: 'ready',
    action: 'BET',
    actionId: `warm-top1-paper-bet:${pendingBet.id}`,
    number: pendingBet.targetNumber,
    stake: pendingBet.stake,
    selectedSource: PREDICTIVE_LEADER_WARM_TOP1_DECISION_SOURCE,
  };
}
