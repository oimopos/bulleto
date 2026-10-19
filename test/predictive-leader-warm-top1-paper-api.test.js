import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PREDICTIVE_LEADER_WARM_TOP1_ALGORITHM_VERSION,
  PREDICTIVE_LEADER_WARM_TOP1_GATE_VERSION,
  PREDICTIVE_LEADER_WARM_TOP1_PAPER_API_SCHEMA_VERSION,
  PREDICTIVE_LEADER_WARM_TOP1_PAPER_STRATEGY_MODE,
  PREDICTIVE_LEADER_WARM_TOP1_PAPER_STRATEGY_VERSION,
  predictiveLeaderWarmTop1PaperSnapshotForApi,
} from '../src/predictive-leader-warm-top1-paper-api.js';

const CANDIDATE_DIGEST = 'a'.repeat(64);
const GATE_DIGEST = 'b'.repeat(64);
const NOW = '2026-10-19T07:51:45.000Z';

function readyGate(overrides = {}) {
  return {
    version: PREDICTIVE_LEADER_WARM_TOP1_GATE_VERSION,
    status: 'confirmed',
    reason: 'quality_confirmed',
    eligible: true,
    controlsPaperAction: true,
    windowPolicy: 'first-1000-selected-settled-prospective-no-roll',
    targetSampleSize: 1_000,
    selectedCount: 1_000,
    settledCount: 1_000,
    sampleSize: 1_000,
    hitCount: 38,
    fixedWindowComplete: true,
    settlementComplete: true,
    windowStartForecastId: 20_001,
    windowEndForecastId: 21_400,
    economicBreakEvenTop1Rate: 1 / 36,
    top1Wilson95: {
      lower: 0.02780900450930263,
      upper: 0.0517935536539434,
    },
    binaryBrierDeltaVsUniformHac95: {
      mean: -0.0012,
      lower: -0.002,
      upper: -0.0001,
    },
    criteria: {
      fixedSampleComplete: true,
      metadataIntegrity: true,
      exactHitRate: true,
      brierVsUniform: true,
    },
    evidenceSha256: GATE_DIGEST,
    frozenAt: '2026-10-19T07:50:00.000Z',
    ...overrides,
  };
}

function readyState(overrides = {}) {
  const state = {
    schemaVersion: PREDICTIVE_LEADER_WARM_TOP1_PAPER_API_SCHEMA_VERSION,
    strategyVersion: PREDICTIVE_LEADER_WARM_TOP1_PAPER_STRATEGY_VERSION,
    algorithmVersion: PREDICTIVE_LEADER_WARM_TOP1_ALGORITHM_VERSION,
    mode: PREDICTIVE_LEADER_WARM_TOP1_PAPER_STRATEGY_MODE,
    executionEnabled: false,
    advisoryOnly: true,
    source: 'buleto',
    instrument: 'default',
    campaign: {
      campaignKey: 'warm-top1-quality-paper-20261019',
      firstForecastId: 20_001,
    },
    forecast: {
      id: 21_401,
      roundId: '101',
      lockedAt: '2026-10-19T07:51:40.000Z',
      bettingClosesAt: '2026-10-19T07:51:50.000Z',
      roundEndsAt: '2026-10-19T07:52:00.000Z',
      settled: false,
    },
    candidateEvidence: {
      status: 'ready',
      reason: 'threshold_met',
      eligible: true,
      algorithmVersion: PREDICTIVE_LEADER_WARM_TOP1_ALGORITHM_VERSION,
      rank: 1,
      number: 17,
      occurrenceCount: 5,
      sampleSize: 100,
      share: 0.05,
      threshold: 0.05,
      comparison: 'gte',
      observedFollowerCount: 20,
      anchorResultId: 9_900,
      anchorNumber: 4,
      anchorSettledAt: '2026-10-19T07:50:59.000Z',
      historyMaxResultId: 9_900,
      historyCutoffAt: '2026-10-19T07:51:40.000Z',
      evidenceSha256: CANDIDATE_DIGEST,
    },
    qualityGate: readyGate(),
    account: {
      status: 'pending',
      reason: 'bet_frozen',
      initialBalance: 10_000,
      currentBalance: 9_990,
      deficit: 0,
      accountingBalance: 9_990,
      availableBalance: 9_990,
      reservedStake: 10,
      profit: -10,
      nextStake: 10,
      canAffordNext: false,
      shortfall: 0,
      ledgerRevision: 1,
      startedAt: '2026-10-19T07:00:00.000Z',
      updatedAt: '2026-10-19T07:51:41.000Z',
      exhaustedAt: null,
    },
    pendingBet: {
      id: 41,
      forecastId: 21_401,
      roundId: '101',
      targetNumber: 17,
      stake: 10,
      status: 'pending',
      decisionSource: 'follower-warm-top1',
      algorithmVersion: PREDICTIVE_LEADER_WARM_TOP1_ALGORITHM_VERSION,
      gateVersion: PREDICTIVE_LEADER_WARM_TOP1_GATE_VERSION,
      candidateEvidenceSha256: CANDIDATE_DIGEST,
      gateEvidenceSha256: GATE_DIGEST,
      lockedAt: '2026-10-19T07:51:40.000Z',
      bettingClosesAt: '2026-10-19T07:51:50.000Z',
      placedAt: '2026-10-19T07:51:41.000Z',
    },
    latestOutcome: null,
    latestVoid: null,
    latestReset: null,
  };
  return { ...state, ...overrides };
}

function readyRuntime(overrides = {}) {
  const runtime = {
    collector: {
      connected: true,
      status: 'connected',
      error: null,
      lastResultAt: '2026-10-19T07:50:59.000Z',
      pendingResultCount: 0,
      resultConfirmationPending: false,
      currentRound: {
        id: '101',
        status: 2,
        startsAt: '2026-10-19T07:51:00.000Z',
        bettingClosesAt: '2026-10-19T07:51:50.000Z',
      },
    },
    latestResult: {
      id: 9_900,
      roundId: '100',
      settledAt: '2026-10-19T07:50:59.000Z',
    },
    pipelinePending: {
      results: 0,
      gaps: 0,
    },
  };
  return { ...runtime, ...overrides };
}

function snapshot({ state = readyState(), runtimeState = readyRuntime(), now = NOW } = {}) {
  return predictiveLeaderWarmTop1PaperSnapshotForApi({
    paperState: state,
    runtimeState,
    source: 'buleto',
    instrument: 'default',
    now,
  });
}

function assertWait(payload, reason) {
  assert.equal(payload.action, 'WAIT');
  assert.equal(payload.reason, reason);
  assert.equal(payload.actionId, null);
  assert.equal(payload.number, null);
  assert.equal(payload.stake, null);
  assert.equal(payload.selectedSource, null);
}

test('returns the schema-v1 warm Top-1 BET only for a durable matching pending row', () => {
  const payload = snapshot();

  assert.equal(payload.schemaVersion, 1);
  assert.equal(
    payload.strategyMode,
    'quality-gated-warm-top1-paper-ladder',
  );
  assert.equal(payload.mode, 'simulation');
  assert.equal(payload.executionEnabled, false);
  assert.equal(payload.advisoryOnly, true);
  assert.equal(payload.status, 'ready');
  assert.equal(payload.reason, 'ready');
  assert.equal(payload.action, 'BET');
  assert.equal(payload.actionId, 'warm-top1-paper-bet:41');
  assert.equal(payload.number, 17);
  assert.equal(payload.stake, 10);
  assert.equal(payload.selectedSource, 'follower-warm-top1');
  assert.equal(payload.pendingBet.status, 'pending');
  assert.equal(payload.pendingBet.decisionSource, 'follower-warm-top1');
  assert.equal(payload.qualityGate.controlsPaperAction, true);
  assert.equal(payload.qualityGate.status, 'confirmed');
  assert.equal(payload.freshness.bettingOpen, true);
});

test('missing state is a WAIT with null action fields', () => {
  const payload = snapshot({ state: null });
  assert.equal(payload.status, 'waiting');
  assertWait(payload, 'paper_state_unavailable');
});

test('accepts the state alias without mutating normalized inputs', () => {
  const state = readyState();
  const runtimeState = readyRuntime();
  const before = structuredClone({ state, runtimeState });
  const payload = predictiveLeaderWarmTop1PaperSnapshotForApi({
    state,
    runtimeState,
    now: NOW,
  });

  assert.equal(payload.action, 'BET');
  assert.deepEqual({ state, runtimeState }, before);
});

test('a collecting quality gate always emits WAIT even if a pending row is present', () => {
  const gate = readyGate({
    status: 'collecting',
    reason: 'insufficient_sample',
    eligible: false,
    selectedCount: 999,
    settledCount: 999,
    sampleSize: 999,
    hitCount: 37,
    fixedWindowComplete: false,
    settlementComplete: false,
    windowEndForecastId: null,
    top1Wilson95: null,
    binaryBrierDeltaVsUniformHac95: null,
    criteria: {
      fixedSampleComplete: false,
      metadataIntegrity: null,
      exactHitRate: null,
      brierVsUniform: null,
    },
    evidenceSha256: null,
    frozenAt: null,
  });
  const payload = snapshot({ state: readyState({ qualityGate: gate }) });

  assert.equal(payload.status, 'waiting');
  assertWait(payload, 'quality_gate_collecting');
  assert.equal(payload.pendingBet.id, 41, 'pending remains visible only for audit');
});

test('a rejected quality gate emits WAIT', () => {
  const gate = readyGate({
    status: 'rejected',
    reason: 'wilson_lower_bound_not_above_break_even',
    eligible: false,
    top1Wilson95: { lower: 0.0269, upper: 0.0509 },
    criteria: {
      fixedSampleComplete: true,
      metadataIntegrity: true,
      exactHitRate: false,
      brierVsUniform: true,
    },
  });
  const payload = snapshot({ state: readyState({ qualityGate: gate }) });

  assert.equal(payload.status, 'waiting');
  assertWait(payload, 'quality_gate_rejected');
});

test('confirmed label cannot bypass the Wilson and Brier quality criteria', () => {
  const weakWilson = snapshot({
    state: readyState({
      qualityGate: readyGate({
        top1Wilson95: { lower: 1 / 36, upper: 0.05 },
      }),
    }),
  });
  assert.equal(weakWilson.status, 'paused');
  assertWait(weakWilson, 'quality_gate_not_confirmed');

  const weakBrier = snapshot({
    state: readyState({
      qualityGate: readyGate({
        binaryBrierDeltaVsUniformHac95: {
          mean: -0.0001,
          lower: -0.001,
          upper: 0,
        },
      }),
    }),
  });
  assert.equal(weakBrier.status, 'paused');
  assertWait(weakBrier, 'quality_gate_not_confirmed');
});

test('missing durable pending state cannot produce BET', () => {
  const payload = snapshot({ state: readyState({ pendingBet: null }) });

  assert.equal(payload.status, 'waiting');
  assertWait(payload, 'paper_bet_not_pending');
});

test('candidate must be rank 1 and meet the exact integer five-percent boundary', () => {
  const belowThreshold = readyState();
  belowThreshold.candidateEvidence = {
    ...belowThreshold.candidateEvidence,
    occurrenceCount: 4,
    share: 0.04,
  };
  const below = snapshot({ state: belowThreshold });
  assert.equal(below.status, 'paused');
  assertWait(below, 'candidate_invalid');

  const wrongRank = readyState();
  wrongRank.candidateEvidence = {
    ...wrongRank.candidateEvidence,
    rank: 2,
  };
  const second = snapshot({ state: wrongRank });
  assert.equal(second.status, 'paused');
  assertWait(second, 'candidate_invalid');
});

test('collector and persistence freshness failures are fail-closed WAIT responses', () => {
  const disconnectedRuntime = readyRuntime();
  disconnectedRuntime.collector = {
    ...disconnectedRuntime.collector,
    connected: false,
  };
  const disconnected = snapshot({ runtimeState: disconnectedRuntime });
  assert.equal(disconnected.status, 'paused');
  assertWait(disconnected, 'collector_unavailable');

  const pendingRuntime = readyRuntime({
    pipelinePending: { results: 1, gaps: 0 },
  });
  const pending = snapshot({ runtimeState: pendingRuntime });
  assert.equal(pending.status, 'paused');
  assertWait(pending, 'persistence_pending');
});

test('round, result, and evidence mismatches cannot produce BET', () => {
  const staleRuntime = readyRuntime();
  staleRuntime.collector = {
    ...staleRuntime.collector,
    lastResultAt: '2026-10-19T07:50:58.000Z',
  };
  const stale = snapshot({ runtimeState: staleRuntime });
  assertWait(stale, 'result_cursor_mismatch');

  const staleCandidateState = readyState();
  staleCandidateState.candidateEvidence = {
    ...staleCandidateState.candidateEvidence,
    anchorResultId: 9_899,
  };
  const staleCandidate = snapshot({ state: staleCandidateState });
  assertWait(staleCandidate, 'candidate_cursor_mismatch');

  const mismatchedState = readyState();
  mismatchedState.pendingBet = {
    ...mismatchedState.pendingBet,
    targetNumber: 18,
  };
  const mismatched = snapshot({ state: mismatchedState });
  assert.equal(mismatched.status, 'paused');
  assertWait(mismatched, 'paper_evidence_mismatch');
});

test('a closed betting window emits WAIT while preserving audit state', () => {
  const payload = snapshot({ now: '2026-10-19T07:51:50.000Z' });

  assert.equal(payload.status, 'waiting');
  assertWait(payload, 'betting_closed');
  assert.equal(payload.pendingBet.id, 41);
  assert.equal(payload.candidateNumber, 17);
});

test('pending account reservation must exactly match the frozen bet', () => {
  const state = readyState();
  state.account = {
    ...state.account,
    reservedStake: 20,
  };
  const payload = snapshot({ state });

  assert.equal(payload.status, 'paused');
  assertWait(payload, 'paper_account_mismatch');
});

test('a positive next-stake shortfall does not suppress an already durable pending bet', () => {
  const state = readyState();
  state.account = {
    ...state.account,
    shortfall: 20,
  };
  const payload = snapshot({ state });

  assert.equal(payload.action, 'BET');
  assert.equal(payload.actionId, 'warm-top1-paper-bet:41');
  assert.equal(payload.stake, 10);
});

test('invalid source identity is paused and never leaks an action', () => {
  const payload = snapshot({ state: readyState({ source: 'other' }) });

  assert.equal(payload.status, 'paused');
  assertWait(payload, 'paper_state_invalid');
});
