import { bettingWindowForApi } from './betting-window.js';

const EMPTY_CURRENT_ACTION = Object.freeze({
  action: 'wait',
  reason: 'waiting_training',
  sessionId: null,
  attemptNumber: null,
  targetNumbers: [],
  selectionCount: 0,
  bettingStarted: false,
  startAttempt: null,
  startEvidence: null,
  cumulativeRate: null,
  hitCount: null,
  eligibleCount: null,
  historyMaxResultId: null,
  historyThrough: null,
  stakePerNumber: null,
  totalStake: null,
  anchorResultId: null,
});

function frozenTargetNumbers(value) {
  if (
    !Array.isArray(value)
    || value.length !== 5
    || value.some((number) =>
      !Number.isInteger(number) || number < 0 || number > 36)
    || new Set(value).size !== value.length
  ) {
    return [];
  }
  return [...value];
}

function evidenceForApi(evidence) {
  if (!evidence) return null;
  return {
    horizon: evidence.horizon,
    hitCount: evidence.hitCount,
    eligibleCount: evidence.eligibleCount,
    rate: evidence.rate,
    historyMaxResultId: evidence.historyMaxResultId,
    historyThrough: evidence.historyThrough,
  };
}

function currentEvidenceForApi(currentAction, maximumCalibratedAttempt) {
  if (
    !Number.isInteger(currentAction?.attemptNumber)
    || currentAction.attemptNumber < 1
    || currentAction.attemptNumber > maximumCalibratedAttempt
  ) {
    return null;
  }
  return {
    horizon: currentAction.attemptNumber,
    hitCount: currentAction.hitCount,
    eligibleCount: currentAction.eligibleCount,
    rate: currentAction.cumulativeRate,
    historyMaxResultId: currentAction.historyMaxResultId,
    historyThrough: currentAction.historyThrough,
  };
}

function currentAttemptForApi(currentAction) {
  const targetNumbers = frozenTargetNumbers(currentAction?.targetNumbers);
  if (
    currentAction?.sessionId == null
    || currentAction?.attemptNumber == null
    || targetNumbers.length !== 5
  ) {
    return null;
  }
  return {
    sessionId: currentAction.sessionId,
    attemptNumber: currentAction.attemptNumber,
    anchorResultId: currentAction.anchorResultId,
    targetNumbers,
    selectionCount: targetNumbers.length,
  };
}

function latestOutcomeForApi(outcome) {
  if (!outcome) return null;
  const targetNumbers = frozenTargetNumbers(outcome.targetNumbers);
  return {
    sessionId: outcome.sessionId,
    attemptNumber: outcome.attemptNumber,
    resultId: outcome.resultId,
    targetNumbers,
    selectionCount: targetNumbers.length,
    resultNumber: outcome.resultNumber,
    hitRank: outcome.hitRank,
    stakePerNumber: outcome.stakePerNumber,
    totalStake: outcome.totalStake,
    outcome: outcome.outcome,
    grossPayout: outcome.grossPayout,
    balanceAfter: outcome.balanceAfter,
    nextStakePerNumber: outcome.nextStakePerNumber,
    nextRoundCost: outcome.nextRoundCost,
    gateEvidence: evidenceForApi(outcome.gateEvidence),
    occurredAt: outcome.occurredAt,
  };
}

function latestResultForApi(result) {
  if (!result) return null;
  return {
    id: result.id,
    roundId: result.roundId ?? result.externalRoundId ?? null,
    number: result.number ?? result.resultNumber ?? null,
    settledAt: result.settledAt ?? null,
  };
}

function bettingForApi(collectorState, strategyReady, trackerSynced, now) {
  const window = bettingWindowForApi(collectorState, now);
  if (!window) return null;
  return {
    ...window,
    strategyReady,
    trackerSynced,
    canBetNow:
      window.isOpen
      && strategyReady
      && trackerSynced
      && window.roundId != null,
  };
}

function safeInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function sameInstant(left, right) {
  const leftMilliseconds = Date.parse(left);
  const rightMilliseconds = Date.parse(right);
  return Number.isFinite(leftMilliseconds)
    && Number.isFinite(rightMilliseconds)
    && leftMilliseconds === rightMilliseconds;
}

function freshnessForApi({
  currentAction,
  latestResult,
  collectorState,
  pipelinePending,
}) {
  const trackerResultId = safeInteger(currentAction.historyMaxResultId);
  const latestPersistedResultId = safeInteger(latestResult?.id);
  const latestPersistedRoundId = safeInteger(
    latestResult?.roundId ?? latestResult?.externalRoundId,
  );
  const currentRoundId = safeInteger(collectorState?.currentRound?.id);
  const latestPersistedAt = latestResult?.settledAt ?? null;
  const collectorLastResultAt = collectorState?.lastResultAt ?? null;
  const pendingResultCount = Number.isInteger(collectorState?.pendingResultCount)
    && collectorState.pendingResultCount > 0
    ? collectorState.pendingResultCount
    : 0;
  const resultConfirmationPending =
    collectorState?.resultConfirmationPending === true
    || pendingResultCount > 0;
  const persistencePendingResults =
    Number.isInteger(pipelinePending?.results) && pipelinePending.results > 0
      ? pipelinePending.results
      : 0;
  const persistencePendingGaps =
    Number.isInteger(pipelinePending?.gaps) && pipelinePending.gaps > 0
      ? pipelinePending.gaps
      : 0;
  const cursorMatches =
    trackerResultId !== null
    && latestPersistedResultId !== null
    && trackerResultId === latestPersistedResultId;
  const collectorCursorMatches = sameInstant(
    collectorLastResultAt,
    latestPersistedAt,
  );
  const expectedRoundId =
    latestPersistedRoundId !== null
    && latestPersistedRoundId < Number.MAX_SAFE_INTEGER
      ? latestPersistedRoundId + 1
      : null;
  const roundCursorMatches =
    currentRoundId !== null
    && expectedRoundId !== null
    && currentRoundId === expectedRoundId;
  const trackerSynced =
    cursorMatches
    && collectorCursorMatches
    && roundCursorMatches
    && !resultConfirmationPending
    && persistencePendingResults === 0
    && persistencePendingGaps === 0;

  return {
    trackerSynced,
    trackerResultId,
    latestPersistedResultId,
    latestPersistedRoundId,
    latestPersistedAt,
    currentRoundId,
    expectedRoundId,
    collectorLastResultAt,
    roundCursorMatches,
    resultConfirmationPending,
    pendingResultCount,
    persistencePendingResults,
    persistencePendingGaps,
  };
}

function signalForApi(
  account,
  currentAction,
  betting,
  thresholdEvidence,
  hasValidBetShape,
  freshness,
) {
  const wantsBet = currentAction.action === 'would_bet';
  const targetNumbers = frozenTargetNumbers(currentAction.targetNumbers);
  let reason = typeof currentAction.reason === 'string'
    ? currentAction.reason
    : 'strategy_not_ready';

  if (wantsBet) {
    if (account.status === 'exhausted' || !account.canAffordNextRound) {
      reason = 'bankroll_exhausted';
    } else if (!hasValidBetShape) {
      reason = 'strategy_not_ready';
    } else if (!betting) {
      reason = 'collector_unavailable';
    } else if (!freshness.trackerSynced) {
      reason = 'tracker_not_synced';
    } else if (!betting.isOpen || betting.roundId == null) {
      reason = 'betting_closed';
    } else {
      reason = 'ready';
    }
  }

  const actionable = wantsBet && hasValidBetShape && reason === 'ready';
  return {
    action: actionable ? 'BET' : 'WAIT',
    actionable,
    reason,
    actionId: actionable
      ? `follower-top5-gated:${currentAction.sessionId}:${currentAction.attemptNumber}:${betting.roundId}`
      : null,
    sessionId: currentAction.sessionId,
    attemptNumber: currentAction.attemptNumber,
    roundId: betting?.roundId ?? null,
    targetNumbers,
    stakePerNumber: currentAction.stakePerNumber,
    totalStake: currentAction.totalStake,
    thresholdEvidence,
    validUntil: betting?.closesAt ?? null,
  };
}

export function followerTop5GatedSnapshotForApi({
  trackerState,
  collectorState,
  latestResult = null,
  pipelinePending = null,
  source = 'buleto',
  instrument = 'default',
  now = new Date(),
}) {
  const account = trackerState?.gatedAccount ?? {};
  const currentAction = account.currentAction ?? EMPTY_CURRENT_ACTION;
  const targetNumbers = frozenTargetNumbers(currentAction.targetNumbers);
  const hasValidBetShape =
    Number.isInteger(currentAction.sessionId)
    && currentAction.sessionId > 0
    && Number.isInteger(currentAction.attemptNumber)
    && currentAction.attemptNumber > 0
    && targetNumbers.length === 5
    && Number.isFinite(currentAction.stakePerNumber)
    && Number.isInteger(currentAction.stakePerNumber)
    && currentAction.stakePerNumber > 0
    && currentAction.selectionCount === 5
    && account.model?.numbersPerRound === 5
    && account.strategy?.selectionCount === 5
    && currentAction.totalStake === currentAction.stakePerNumber * 5
    && currentAction.stakePerNumber === account.nextStakePerNumber
    && currentAction.totalStake === account.nextRoundCost;
  const strategyReady = currentAction.action === 'would_bet'
    && account.status !== 'exhausted'
    && account.canAffordNextRound === true
    && hasValidBetShape;
  const freshness = freshnessForApi({
    currentAction,
    latestResult,
    collectorState,
    pipelinePending,
  });
  const betting = bettingForApi(
    collectorState,
    strategyReady,
    freshness.trackerSynced,
    now,
  );
  const maximumCalibratedAttempt =
    account.strategy?.maximumCalibratedAttempt ?? 20;
  const currentEvidence = currentEvidenceForApi(
    currentAction,
    maximumCalibratedAttempt,
  );
  const startEvidence = evidenceForApi(currentAction.startEvidence);
  const thresholdEvidence = currentAction.bettingStarted
    ? startEvidence
    : currentEvidence;

  return {
    schemaVersion: account.schemaVersion ?? 1,
    algorithmVersion: account.algorithmVersion ?? null,
    mode: account.mode ?? 'persisted-session-retrospective',
    executionEnabled: false,
    advisoryOnly: true,
    source,
    instrument,
    status: account.status ?? 'waiting',
    currentBalance: account.finalBalance ?? null,
    profit: account.netResult ?? null,
    serverTime: now.toISOString(),
    strategy: { ...account.strategy },
    model: { ...account.model },
    account: {
      status: account.status ?? 'waiting',
      initialBalance: account.initialBalance ?? null,
      currentBalance: account.finalBalance ?? null,
      profit: account.netResult ?? null,
      nextStakePerNumber: account.nextStakePerNumber ?? null,
      nextRoundCost: account.nextRoundCost ?? null,
      canAffordNextRound: account.canAffordNextRound === true,
      shortfall: account.shortfall ?? null,
      ladder: { ...account.ladder },
      dataComplete: account.dataComplete === true,
    },
    gate: {
      thresholdMetric: account.strategy?.thresholdMetric ?? null,
      threshold: account.strategy?.threshold ?? null,
      comparison: account.strategy?.comparison ?? null,
      maximumCalibratedAttempt,
      bettingStarted: currentAction.bettingStarted,
      startAttempt: currentAction.startAttempt,
      startEvidence,
      currentEvidence,
    },
    currentAttempt: currentAttemptForApi(currentAction),
    freshness,
    latestResult: latestResultForApi(latestResult),
    betting,
    signal: signalForApi(
      account,
      currentAction,
      betting,
      thresholdEvidence,
      hasValidBetShape,
      freshness,
    ),
    latestOutcome: latestOutcomeForApi(account.latestOutcome),
  };
}
