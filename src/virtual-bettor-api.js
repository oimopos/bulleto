import { virtualBettingForApi } from './betting-window.js';

function latestResultForApi(result) {
  if (!result) return null;
  return {
    id: result.id,
    roundId: result.roundId ?? result.externalRoundId ?? null,
    number: result.number ?? result.resultNumber ?? null,
    settledAt: result.settledAt ?? null,
  };
}

function bankForApi(testBank) {
  return {
    status: testBank.status,
    initialBalance: testBank.initialBalance,
    currentBalance: testBank.currentBalance,
    profit: testBank.netResult,
    nextStake: testBank.nextStake,
    canAffordNext: testBank.canAffordNext,
    shortfall: testBank.shortfall,
    startedAt: testBank.startedAt,
    exhaustedAt: testBank.exhaustedAt,
    dataComplete: testBank.dataComplete,
  };
}

function activeSessionForApi(session, threshold, bank) {
  if (!session) return null;

  const nextStake = session.nextStake;
  const projectedGrossPayout = session.projectedGrossPayout;
  const hasProjection =
    Number.isFinite(nextStake) && Number.isFinite(projectedGrossPayout);
  const projectedBalanceIfHit = hasProjection
    ? bank.currentBalance - nextStake + projectedGrossPayout
    : null;
  const projectedBalanceIfMiss = Number.isFinite(nextStake)
    ? bank.currentBalance - nextStake
    : null;

  return {
    id: session.id,
    status: session.status,
    targetNumber: session.targetNumber,
    triggerProgress: session.triggerRoundsMissed,
    threshold,
    attemptCount: session.attemptCount,
    nextAttemptNumber: session.attemptCount + 1,
    missCount: session.missCount,
    totalStaked: session.totalStaked,
    nextStake,
    projectedGrossPayout,
    projectedSessionProfitIfHit: session.projectedNetIfHit,
    projectedTotalLossIfMiss: session.projectedTotalLossIfMiss,
    projectedBalanceIfHit,
    projectedProfitIfHit:
      projectedBalanceIfHit === null
        ? null
        : projectedBalanceIfHit - bank.initialBalance,
    projectedBalanceIfMiss,
    projectedProfitIfMiss:
      projectedBalanceIfMiss === null
        ? null
        : projectedBalanceIfMiss - bank.initialBalance,
    recoveryPossible: session.recoveryPossible,
    selectedAt: session.selectedAt,
    startedAt: session.startedAt,
  };
}

function latestOutcomeForApi(outcome, latestResult) {
  if (!outcome) return null;
  return {
    eventId: `virtual-bet:${outcome.betId}`,
    betId: outcome.betId,
    resultId: outcome.resultId,
    roundId: outcome.roundId,
    sessionId: outcome.sessionId,
    attemptNumber: outcome.attemptNumber,
    targetNumber: outcome.targetNumber,
    resultNumber: outcome.resultNumber,
    outcome: String(outcome.outcome).toUpperCase(),
    stake: outcome.stake,
    grossPayout: outcome.grossPayout,
    totalStakedAfter: outcome.totalStakedAfter,
    sessionNetAfter: outcome.sessionNetAfter,
    nextStake: outcome.nextStake,
    recoveryPossible: outcome.recoveryPossible,
    occurredAt: outcome.occurredAt,
    isLatestResult:
      latestResult !== null && outcome.resultId === latestResult.id,
  };
}

function signalForApi(state, activeSession, betting) {
  const bank = state.testBank;
  let reason = 'ready';

  if (bank.status === 'exhausted') {
    reason = 'bankroll_exhausted';
  } else if (!activeSession) {
    reason = 'below_threshold';
  } else if (!Number.isFinite(activeSession.nextStake) || !bank.canAffordNext) {
    reason = 'cannot_afford';
  } else if (!betting) {
    reason = 'collector_unavailable';
  } else if (!betting.isOpen || betting.roundId == null) {
    reason = 'betting_closed';
  } else if (!betting.canBetNow) {
    reason = 'strategy_not_ready';
  }

  const actionable = reason === 'ready';
  return {
    action: actionable ? 'BET' : 'WAIT',
    actionable,
    reason,
    actionId: actionable
      ? `bet:${activeSession.id}:${betting.roundId}`
      : null,
    sessionId: activeSession?.id ?? null,
    roundId: betting?.roundId ?? null,
    targetNumber: activeSession?.targetNumber ?? null,
    stake: activeSession?.nextStake ?? null,
    attemptNumber: activeSession?.nextAttemptNumber ?? null,
    validUntil: betting?.closesAt ?? null,
  };
}

export function virtualBettorSnapshotForApi({
  state,
  latestResult,
  collectorState,
  now = new Date(),
}) {
  const normalizedLatestResult = latestResultForApi(latestResult);
  const bank = bankForApi(state.testBank);
  const activeSession = activeSessionForApi(
    state.activeSession,
    state.triggerThreshold,
    bank,
  );
  const betting = virtualBettingForApi(collectorState, state.status, now);

  return {
    mode: state.mode,
    executionEnabled: state.executionEnabled,
    status: state.status,
    currentBalance: bank.currentBalance,
    profit: bank.profit,
    bank,
    latestResult: normalizedLatestResult,
    longestSeries: state.longestCandidate
      ? {
          number: state.longestCandidate.number,
          progress: state.longestCandidate.roundsSinceLast,
          target: state.triggerThreshold,
        }
      : null,
    activeSession,
    lifetime: {
      ...state.lifetime,
      profit: state.lifetime.netResult,
    },
    serverTime: now.toISOString(),
    betting,
    signal: signalForApi(state, activeSession, betting),
    latestOutcome: latestOutcomeForApi(
      state.latestOutcome,
      normalizedLatestResult,
    ),
  };
}
