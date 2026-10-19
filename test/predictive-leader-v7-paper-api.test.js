import assert from 'node:assert/strict';
import test from 'node:test';

import { LEARNED_LEADER_V7_ALGORITHM_VERSION } from '../src/learned-leader-v7.js';
import {
  PREDICTIVE_LEADER_V7_PAPER_LADDER_CAMPAIGN_KEY,
  PREDICTIVE_LEADER_V7_PAPER_LADDER_MODEL,
  PREDICTIVE_LEADER_V7_PAPER_LADDER_PENDING_RESET_REASON,
  PREDICTIVE_LEADER_V7_PAPER_LADDER_RESET_POLICY,
  calculatePredictiveLeaderV7PaperNextStake,
  calculatePredictiveLeaderV7PaperRawStake,
} from '../src/predictive-leader-v7-paper-ladder.js';
import {
  PREDICTIVE_LEADER_V7_PAPER_API_SCHEMA_VERSION,
  PREDICTIVE_LEADER_V7_PAPER_STRATEGY_MODE,
  PREDICTIVE_LEADER_V7_PAPER_STRATEGY_VERSION,
  predictiveLeaderV7PaperSnapshotForApi,
} from '../src/predictive-leader-v7-paper-api.js';

const SOURCE = 'buleto';
const INSTRUMENT = 'XPM/RUB';
const CANDIDATE_ID = 'v7-rank20-history80-uniform95-a740-b500-t5-20261018';
const CAMPAIGN_KEY = PREDICTIVE_LEADER_V7_PAPER_LADDER_CAMPAIGN_KEY;
const LATEST_SETTLED_AT = '2026-10-19T02:00:00.000Z';
const LOCKED_AT = '2026-10-19T02:00:20.000Z';
const PLACED_AT = '2026-10-19T02:00:21.000Z';
const SERVER_TIME = '2026-10-19T02:00:22.000Z';
const BETTING_CLOSES_AT = '2026-10-19T02:00:28.000Z';
const ROUND_ENDS_AT = '2026-10-19T02:00:30.000Z';
const FORECAST_ID = 1_001;

function pendingPaperState(overrides = {}) {
  return {
    schemaVersion: 2,
    strategyVersion: PREDICTIVE_LEADER_V7_PAPER_STRATEGY_VERSION,
    campaignKey: CAMPAIGN_KEY,
    candidateId: CANDIDATE_ID,
    algorithmVersion: LEARNED_LEADER_V7_ALGORITHM_VERSION,
    mode: PREDICTIVE_LEADER_V7_PAPER_STRATEGY_MODE,
    executionEnabled: false,
    advisoryOnly: true,
    promotionEligible: false,
    promotionPolicy: 'manual-override-paper-not-promoted',
    authorizationReason: 'operator-requested-virtual-api-2026-10-19',
    source: SOURCE,
    instrument: INSTRUMENT,
    activationBoundary: {
      firstForecastId: FORECAST_ID,
      startedAt: '2026-10-19T01:59:00.000Z',
    },
    model: {
      ...PREDICTIVE_LEADER_V7_PAPER_LADDER_MODEL,
    },
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
    betCount: 1,
    settledCount: 0,
    pendingCount: 1,
    voidCount: 0,
    hitCount: 0,
    missCount: 0,
    hitRate: null,
    totalStaked: 10,
    totalGrossPayout: 0,
    peakBalance: 10_000,
    minimumBalance: 9_990,
    maximumDrawdown: 10,
    continuityGapCount: 0,
    ledgerRevision: 1,
    ladder: {
      cycleNumber: 1,
      cycleStaked: 0,
      ladderLoss: 0,
      missCount: 0,
      resetCount: 0,
      nextStake: 10,
      pendingReset: null,
    },
    pendingBet: {
      id: 41,
      forecastId: FORECAST_ID,
      roundId: '101',
      targetNumber: 7,
      stake: 10,
      rawStake: 10,
      balanceBefore: 10_000,
      cycleNumber: 1,
      cycleStakedBefore: 0,
      ladderLossBefore: 0,
      missCountBefore: 0,
      lockedAt: LOCKED_AT,
      bettingClosesAt: BETTING_CLOSES_AT,
      placedAt: PLACED_AT,
    },
    latestOutcome: null,
    latestVoid: null,
    latestReset: null,
    startedAt: '2026-10-19T01:59:00.000Z',
    updatedAt: PLACED_AT,
    exhaustedAt: null,
    ...overrides,
  };
}

function waitingPaperState() {
  return {
    ...pendingPaperState(),
    status: 'waiting',
    reason: 'waiting_first_frozen_v7',
    currentBalance: 10_000,
    accountingBalance: 10_000,
    availableBalance: 10_000,
    reservedStake: 0,
    profit: 0,
    canAffordNext: true,
    betCount: 0,
    pendingCount: 0,
    totalStaked: 0,
    minimumBalance: 10_000,
    maximumDrawdown: 0,
    ledgerRevision: 0,
    pendingBet: null,
    startedAt: '2026-10-19T01:59:00.000Z',
    updatedAt: '2026-10-19T01:59:00.000Z',
  };
}

function auditState(overrides = {}) {
  return {
    schemaVersion: 1,
    candidateId: CANDIDATE_ID,
    algorithmVersion: LEARNED_LEADER_V7_ALGORITHM_VERSION,
    mode: 'prospective-shadow',
    executionEnabled: false,
    advisoryOnly: true,
    source: SOURCE,
    instrument: INSTRUMENT,
    latest: {
      forecastId: FORECAST_ID,
      roundId: '101',
      lockedAt: LOCKED_AT,
      bettingClosesAt: BETTING_CLOSES_AT,
      roundEndsAt: ROUND_ENDS_AT,
      candidate: {
        availability: 'ready',
        status: 'ready',
        reason: null,
        leaderNumber: 7,
        selected: true,
        evaluation: null,
      },
      champion: null,
      settlement: null,
      ...overrides.latest,
    },
    qualityGateDiagnostic: {
      version: 'v7-fixed-first-1000-v1',
      status: 'signals_failed',
      sampleSize: 1_000,
      statisticalSignalsPass: false,
      promotionEligible: false,
      promotionPolicy: 'manual-review-only-no-automatic-bet-or-promotion',
      ...overrides.qualityGateDiagnostic,
    },
    ...overrides,
    latest: overrides.latest === null
      ? null
      : {
          forecastId: FORECAST_ID,
          roundId: '101',
          lockedAt: LOCKED_AT,
          bettingClosesAt: BETTING_CLOSES_AT,
          roundEndsAt: ROUND_ENDS_AT,
          candidate: {
            availability: 'ready',
            status: 'ready',
            reason: null,
            leaderNumber: 7,
            selected: true,
            evaluation: null,
            ...overrides.latest?.candidate,
          },
          champion: null,
          settlement: null,
          ...overrides.latest,
        },
    qualityGateDiagnostic: {
      version: 'v7-fixed-first-1000-v1',
      status: 'signals_failed',
      sampleSize: 1_000,
      statisticalSignalsPass: false,
      promotionEligible: false,
      promotionPolicy: 'manual-review-only-no-automatic-bet-or-promotion',
      ...overrides.qualityGateDiagnostic,
    },
  };
}

function runtimeState(overrides = {}) {
  return {
    collector: {
      connected: true,
      status: 'connected',
      error: null,
      lastResultAt: LATEST_SETTLED_AT,
      pendingResultCount: 0,
      resultConfirmationPending: false,
      ...overrides.collector,
      currentRound: {
        id: 101,
        status: 2,
        startsAt: '2026-10-19T02:00:10.000Z',
        bettingClosesAt: BETTING_CLOSES_AT,
        ...overrides.collector?.currentRound,
      },
    },
    latestResult: {
      id: 900,
      roundId: '100',
      number: 3,
      settledAt: LATEST_SETTLED_AT,
      ...overrides.latestResult,
    },
    pipelinePending: {
      results: 0,
      gaps: 0,
      ...overrides.pipelinePending,
    },
  };
}

function snapshot({
  paperState = pendingPaperState(),
  audit = auditState(),
  runtime = runtimeState(),
  now = SERVER_TIME,
} = {}) {
  return predictiveLeaderV7PaperSnapshotForApi({
    paperState,
    auditState: audit,
    runtimeState: runtime,
    source: SOURCE,
    instrument: INSTRUMENT,
    now,
  });
}

test('a stored pending V7 paper bet is exposed as a read-only BET', () => {
  const audit = auditState();
  const payload = snapshot({ audit });

  assert.equal(payload.schemaVersion, PREDICTIVE_LEADER_V7_PAPER_API_SCHEMA_VERSION);
  assert.equal(payload.schemaVersion, 2);
  assert.equal(payload.strategyVersion, PREDICTIVE_LEADER_V7_PAPER_STRATEGY_VERSION);
  assert.equal(payload.algorithmVersion, LEARNED_LEADER_V7_ALGORITHM_VERSION);
  assert.equal(payload.mode, 'simulation');
  assert.equal(payload.strategyMode, 'manual-override-paper');
  assert.equal(payload.executionEnabled, false);
  assert.equal(payload.advisoryOnly, true);
  assert.deepEqual(payload.manualOverride, {
    authorized: true,
    reason: 'operator-requested-virtual-api-2026-10-19',
    qualityGateRequired: false,
    automaticPromotionEnabled: false,
  });
  assert.equal(payload.status, 'ready');
  assert.equal(payload.reason, 'ready');
  assert.equal(payload.action, 'BET');
  assert.equal(payload.actionId, 'v7-paper-bet:41');
  assert.equal(payload.number, 7);
  assert.equal(payload.stake, 10);
  assert.equal(payload.candidateNumber, 7);
  assert.equal(payload.account.currentBalance, 9_990);
  assert.equal(payload.account.reservedStake, 10);
  assert.equal(payload.stats.betCount, 1);
  assert.equal(payload.pendingBet.forecastId, FORECAST_ID);
  assert.equal(payload.campaign.schemaVersion, 2);
  assert.equal(payload.campaign.campaignKey, CAMPAIGN_KEY);
  assert.equal(payload.campaign.model.kind, 'loss-recovery-ladder');
  assert.equal(payload.campaign.model.initialBalance, 10_000);
  assert.equal(payload.campaign.model.cycleSpendLimit, 1_000);
  assert.equal(
    payload.campaign.model.resetPolicy,
    PREDICTIVE_LEADER_V7_PAPER_LADDER_RESET_POLICY,
  );
  assert.deepEqual(payload.ladder, pendingPaperState().ladder);
  assert.equal(payload.latestOutcome, null);
  assert.equal(payload.qualityGateDiagnostic.status, 'signals_failed');
  assert.equal(payload.qualityGateDiagnostic.role, 'audit-only');
  assert.equal(payload.qualityGateDiagnostic.controlsPaperAction, false);
  assert.equal(payload.qualityGateDiagnostic.promotionEligible, false);
  assert.equal(audit.qualityGateDiagnostic.role, undefined, 'input must not be mutated');
});

test('a V7 candidate without a saved pending paper bet remains WAIT', () => {
  const payload = snapshot({ paperState: waitingPaperState() });

  assert.equal(payload.status, 'waiting');
  assert.equal(payload.reason, 'paper_bet_not_pending');
  assert.equal(payload.action, 'WAIT');
  assert.equal(payload.number, null);
  assert.equal(payload.stake, null);
  assert.equal(payload.candidateNumber, 7);
  assert.equal(payload.pendingBet, null);
  assert.equal(payload.account.currentBalance, 10_000);
});

test('a saved bet for an older forecast never leaks as the current BET', () => {
  const paperState = pendingPaperState();
  paperState.pendingBet = {
    ...paperState.pendingBet,
    forecastId: FORECAST_ID - 1,
    roundId: '100',
  };

  const payload = snapshot({ paperState });

  assert.equal(payload.status, 'waiting');
  assert.equal(payload.reason, 'paper_pending_previous');
  assert.equal(payload.action, 'WAIT');
  assert.equal(payload.number, null);
  assert.equal(payload.stake, null);
  assert.equal(payload.pendingBet.forecastId, FORECAST_ID - 1);
});

test('live cursor, queue, and metadata hazards fail closed', () => {
  const cases = [
    [
      'collector_unavailable',
      runtimeState({ collector: { connected: false, status: 'reconnecting' } }),
    ],
    [
      'collector_pending',
      runtimeState({ collector: { resultConfirmationPending: true } }),
    ],
    [
      'persistence_pending',
      runtimeState({ pipelinePending: { results: 1 } }),
    ],
    [
      'result_cursor_mismatch',
      runtimeState({ collector: { lastResultAt: '2026-10-19T01:59:59.000Z' } }),
    ],
    [
      'round_cursor_mismatch',
      runtimeState({ latestResult: { roundId: '99' } }),
    ],
    [
      'round_metadata_mismatch',
      runtimeState({
        collector: {
          currentRound: { bettingClosesAt: '2026-10-19T02:00:29.000Z' },
        },
      }),
    ],
  ];

  for (const [reason, runtime] of cases) {
    const payload = snapshot({ runtime });
    assert.equal(payload.reason, reason, reason);
    assert.equal(payload.action, 'WAIT', reason);
    assert.equal(payload.number, null, reason);
    assert.equal(payload.stake, null, reason);
  }
});

test('closed and already-settled rounds cannot expose a BET', () => {
  const closed = snapshot({ now: BETTING_CLOSES_AT });
  assert.equal(closed.reason, 'betting_closed');
  assert.equal(closed.action, 'WAIT');
  assert.equal(closed.stake, null);

  const settled = snapshot({
    audit: auditState({
      latest: {
        settlement: { resultId: 901, actualNumber: 7 },
      },
    }),
  });
  assert.equal(settled.reason, 'forecast_settled');
  assert.equal(settled.action, 'WAIT');
  assert.equal(settled.stake, null);
});

test('paper evidence must match the frozen V7 candidate and timestamps', () => {
  const wrongNumber = pendingPaperState();
  wrongNumber.pendingBet = { ...wrongNumber.pendingBet, targetNumber: 8 };
  const numberPayload = snapshot({ paperState: wrongNumber });
  assert.equal(numberPayload.reason, 'paper_evidence_mismatch');
  assert.equal(numberPayload.action, 'WAIT');
  assert.equal(numberPayload.stake, null);

  const wrongLock = pendingPaperState();
  wrongLock.pendingBet = {
    ...wrongLock.pendingBet,
    lockedAt: '2026-10-19T02:00:19.000Z',
  };
  const lockPayload = snapshot({ paperState: wrongLock });
  assert.equal(lockPayload.reason, 'paper_evidence_mismatch');
  assert.equal(lockPayload.action, 'WAIT');
  assert.equal(lockPayload.stake, null);
});

test('invalid paper accounting or a promotable audit is rejected', () => {
  const badAccount = pendingPaperState({ currentBalance: 1_000 });
  const accountPayload = snapshot({ paperState: badAccount });
  assert.equal(accountPayload.status, 'paused');
  assert.equal(accountPayload.reason, 'paper_state_invalid');
  assert.equal(accountPayload.account, null);
  assert.equal(accountPayload.action, 'WAIT');
  assert.equal(accountPayload.stake, null);

  const promotableAudit = auditState({
    qualityGateDiagnostic: { promotionEligible: true },
  });
  const auditPayload = snapshot({ audit: promotableAudit });
  assert.equal(auditPayload.status, 'paused');
  assert.equal(auditPayload.reason, 'audit_invalid');
  assert.equal(auditPayload.qualityGateDiagnostic, null);
  assert.equal(auditPayload.action, 'WAIT');
  assert.equal(auditPayload.stake, null);
});

test('a settled dynamic hit pays actual stake times 36 and resets the recovery cycle', () => {
  const occurredAt = '2026-10-19T02:00:30.000Z';
  const state = pendingPaperState({
    status: 'waiting',
    reason: 'waiting_next_frozen_v7',
    currentBalance: 10_340,
    accountingBalance: 10_340,
    availableBalance: 10_340,
    reservedStake: 0,
    profit: 340,
    canAffordNext: true,
    betCount: 37,
    settledCount: 37,
    pendingCount: 0,
    hitCount: 1,
    missCount: 36,
    hitRate: 1 / 37,
    totalStaked: 380,
    totalGrossPayout: 720,
    peakBalance: 10_340,
    minimumBalance: 9_620,
    maximumDrawdown: 380,
    ledgerRevision: 38,
    ladder: {
      cycleNumber: 2,
      cycleStaked: 0,
      ladderLoss: 0,
      missCount: 0,
      resetCount: 1,
      nextStake: 10,
      pendingReset: null,
    },
    pendingBet: null,
    latestOutcome: {
      betId: 41,
      forecastId: FORECAST_ID,
      resultId: 901,
      roundId: '101',
      targetNumber: 7,
      resultNumber: 7,
      outcome: 'hit',
      stake: 20,
      grossPayout: 720,
      balanceBefore: 9_640,
      balanceAfter: 10_340,
      cycleNumberBefore: 1,
      cycleNumberAfter: 2,
      cycleStakedBefore: 360,
      cycleStakedAfter: 0,
      ladderLossBefore: 360,
      ladderLossAfter: 0,
      missCountBefore: 36,
      missCountAfter: 0,
      nextStakeAfter: 10,
      resetApplied: true,
      resetReason: 'hit',
      occurredAt,
    },
    latestReset: {
      id: 1,
      betId: 41,
      incidentId: null,
      continuityEpoch: null,
      cycleNumberBefore: 1,
      cycleNumberAfter: 2,
      reason: 'hit',
      cycleStakedBefore: 380,
      ladderLossBefore: 360,
      missCountBefore: 36,
      nextStakeBefore: 20,
      nextStakeAfter: 10,
      occurredAt,
    },
    updatedAt: occurredAt,
  });
  const payload = snapshot({ paperState: state });

  assert.equal(payload.action, 'WAIT');
  assert.equal(payload.stake, null);
  assert.equal(payload.reason, 'paper_bet_not_pending');
  assert.equal(payload.account.currentBalance, 10_340);
  assert.equal(payload.stats.hitCount, 1);
  assert.equal(payload.latestOutcome.outcome, 'HIT');
  assert.equal(payload.latestOutcome.stake, 20);
  assert.equal(payload.latestOutcome.grossPayout, 720);
  assert.equal(payload.latestOutcome.resetReason, 'hit');
  assert.equal(payload.latestReset.cycleNumberAfter, 2);

  const wrongPayout = structuredClone(state);
  wrongPayout.latestOutcome.grossPayout = 360;
  const rejected = snapshot({ paperState: wrongPayout });
  assert.equal(rejected.reason, 'paper_state_invalid');
  assert.equal(rejected.action, 'WAIT');
  assert.equal(rejected.stake, null);

  const wrongResetProvenance = structuredClone(state);
  wrongResetProvenance.latestReset.incidentId = 91;
  wrongResetProvenance.latestReset.continuityEpoch = 2;
  assert.equal(
    snapshot({ paperState: wrongResetProvenance }).reason,
    'paper_state_invalid',
  );

  assert.equal(
    snapshot({
      paperState: { ...state, continuityGapCount: 1 },
    }).reason,
    'paper_state_invalid',
  );
});

test('a persisted dynamic ladder stake is exposed without assuming fixed ten', () => {
  const state = pendingPaperState({
    currentBalance: 9_620,
    accountingBalance: 9_620,
    availableBalance: 9_620,
    reservedStake: 20,
    profit: -380,
    nextStake: 20,
    betCount: 37,
    settledCount: 36,
    pendingCount: 1,
    hitCount: 0,
    missCount: 36,
    hitRate: 0,
    totalStaked: 380,
    peakBalance: 10_000,
    minimumBalance: 9_620,
    maximumDrawdown: 380,
    ledgerRevision: 37,
    ladder: {
      cycleNumber: 1,
      cycleStaked: 360,
      ladderLoss: 360,
      missCount: 36,
      resetCount: 0,
      nextStake: 20,
      pendingReset: null,
    },
    pendingBet: {
      ...pendingPaperState().pendingBet,
      stake: 20,
      rawStake: 20,
      balanceBefore: 9_640,
      cycleStakedBefore: 360,
      ladderLossBefore: 360,
      missCountBefore: 36,
    },
    latestOutcome: {
      betId: 40,
      forecastId: FORECAST_ID - 1,
      resultId: 900,
      roundId: '100',
      targetNumber: 7,
      resultNumber: 8,
      outcome: 'miss',
      stake: 10,
      grossPayout: 0,
      balanceBefore: 9_650,
      balanceAfter: 9_640,
      cycleNumberBefore: 1,
      cycleNumberAfter: 1,
      cycleStakedBefore: 350,
      cycleStakedAfter: 360,
      ladderLossBefore: 350,
      ladderLossAfter: 360,
      missCountBefore: 35,
      missCountAfter: 36,
      nextStakeAfter: 20,
      resetApplied: false,
      resetReason: null,
      occurredAt: LATEST_SETTLED_AT,
    },
  });
  const payload = snapshot({ paperState: state });

  assert.equal(payload.status, 'ready');
  assert.equal(payload.action, 'BET');
  assert.equal(payload.number, 7);
  assert.equal(payload.stake, 20);
  assert.equal(payload.pendingBet.stake, 20);
  assert.equal(payload.pendingBet.rawStake, 20);
  assert.equal(payload.account.reservedStake, 20);
  assert.equal(payload.account.nextStake, 20);
  assert.equal(payload.ladder.ladderLoss, 360);

  const lateOverlay = structuredClone(state);
  lateOverlay.pendingBet.balanceBefore = 9_700;
  const overlayPayload = snapshot({ paperState: lateOverlay });
  assert.equal(overlayPayload.action, 'BET');
  assert.equal(overlayPayload.stake, 20);
});

test('the final cycle stake is clamped to the remaining cap and marked pending', () => {
  assert.equal(calculatePredictiveLeaderV7PaperRawStake(990), 30);
  assert.equal(calculatePredictiveLeaderV7PaperNextStake(990, 990), 10);
  const state = pendingPaperState({
    currentBalance: 9_000,
    accountingBalance: 9_000,
    availableBalance: 9_000,
    profit: -1_000,
    betCount: 64,
    settledCount: 63,
    pendingCount: 1,
    hitCount: 0,
    missCount: 63,
    hitRate: 0,
    totalStaked: 1_000,
    peakBalance: 10_000,
    minimumBalance: 9_000,
    maximumDrawdown: 1_000,
    ledgerRevision: 64,
    ladder: {
      cycleNumber: 1,
      cycleStaked: 990,
      ladderLoss: 990,
      missCount: 63,
      resetCount: 0,
      nextStake: 10,
      pendingReset: PREDICTIVE_LEADER_V7_PAPER_LADDER_PENDING_RESET_REASON,
    },
    pendingBet: {
      ...pendingPaperState().pendingBet,
      stake: 10,
      rawStake: 30,
      balanceBefore: 9_010,
      cycleStakedBefore: 990,
      ladderLossBefore: 990,
      missCountBefore: 63,
    },
    latestOutcome: {
      betId: 40,
      forecastId: FORECAST_ID - 1,
      resultId: 900,
      roundId: '100',
      targetNumber: 7,
      resultNumber: 8,
      outcome: 'miss',
      stake: 30,
      grossPayout: 0,
      balanceBefore: 9_040,
      balanceAfter: 9_010,
      cycleNumberBefore: 1,
      cycleNumberAfter: 1,
      cycleStakedBefore: 960,
      cycleStakedAfter: 990,
      ladderLossBefore: 960,
      ladderLossAfter: 990,
      missCountBefore: 62,
      missCountAfter: 63,
      nextStakeAfter: 10,
      resetApplied: false,
      resetReason: null,
      occurredAt: LATEST_SETTLED_AT,
    },
  });
  const payload = snapshot({ paperState: state });

  assert.equal(payload.action, 'BET');
  assert.equal(payload.stake, 10);
  assert.equal(payload.pendingBet.rawStake, 30);
  assert.equal(payload.ladder.pendingReset, 'cycle_spend_cap');

  const missingProjectedReset = structuredClone(state);
  missingProjectedReset.ladder.pendingReset = null;
  assert.equal(
    snapshot({ paperState: missingProjectedReset }).reason,
    'paper_state_invalid',
  );
});

test('a settled miss at the cycle cap applies one audited reset', () => {
  const occurredAt = '2026-10-19T02:00:30.000Z';
  const state = pendingPaperState({
    status: 'waiting',
    reason: 'waiting_next_frozen_v7',
    currentBalance: 9_000,
    accountingBalance: 9_000,
    availableBalance: 9_000,
    reservedStake: 0,
    profit: -1_000,
    canAffordNext: true,
    betCount: 64,
    settledCount: 64,
    pendingCount: 0,
    hitCount: 0,
    missCount: 64,
    hitRate: 0,
    totalStaked: 1_000,
    peakBalance: 10_000,
    minimumBalance: 9_000,
    maximumDrawdown: 1_000,
    ledgerRevision: 65,
    ladder: {
      cycleNumber: 2,
      cycleStaked: 0,
      ladderLoss: 0,
      missCount: 0,
      resetCount: 1,
      nextStake: 10,
      pendingReset: null,
    },
    pendingBet: null,
    latestOutcome: {
      betId: 41,
      forecastId: FORECAST_ID,
      resultId: 901,
      roundId: '101',
      targetNumber: 7,
      resultNumber: 8,
      outcome: 'miss',
      stake: 10,
      grossPayout: 0,
      balanceBefore: 9_010,
      balanceAfter: 9_000,
      cycleNumberBefore: 1,
      cycleNumberAfter: 2,
      cycleStakedBefore: 990,
      cycleStakedAfter: 0,
      ladderLossBefore: 990,
      ladderLossAfter: 0,
      missCountBefore: 63,
      missCountAfter: 0,
      nextStakeAfter: 10,
      resetApplied: true,
      resetReason: 'cycle_spend_cap',
      occurredAt,
    },
    latestReset: {
      id: 1,
      betId: 41,
      incidentId: null,
      continuityEpoch: null,
      cycleNumberBefore: 1,
      cycleNumberAfter: 2,
      reason: 'cycle_spend_cap',
      cycleStakedBefore: 1_000,
      ladderLossBefore: 1_000,
      missCountBefore: 64,
      nextStakeBefore: 10,
      nextStakeAfter: 10,
      occurredAt,
    },
    updatedAt: occurredAt,
  });
  const payload = snapshot({ paperState: state });

  assert.equal(payload.action, 'WAIT');
  assert.equal(payload.stake, null);
  assert.equal(payload.ladder.cycleNumber, 2);
  assert.equal(payload.ladder.resetCount, 1);
  assert.equal(payload.latestOutcome.resetApplied, true);
  assert.equal(payload.latestReset.reason, 'cycle_spend_cap');
});

test('an independent integrity gap resets the cursor without requiring a voided bet', () => {
  const occurredAt = '2026-10-19T02:00:10.000Z';
  const latestReset = {
    id: 1,
    betId: null,
    incidentId: 91,
    continuityEpoch: 2,
    cycleNumberBefore: 1,
    cycleNumberAfter: 2,
    reason: 'integrity_gap',
    cycleStakedBefore: 0,
    ladderLossBefore: 0,
    missCountBefore: 0,
    nextStakeBefore: 10,
    nextStakeAfter: 10,
    occurredAt,
  };
  const state = {
    ...waitingPaperState(),
    reason: 'waiting_next_frozen_v7',
    continuityGapCount: 1,
    ledgerRevision: 1,
    ladder: {
      ...waitingPaperState().ladder,
      cycleNumber: 2,
      resetCount: 1,
    },
    latestReset,
    updatedAt: occurredAt,
  };

  const payload = snapshot({ paperState: state });

  assert.equal(payload.reason, 'paper_bet_not_pending');
  assert.equal(payload.action, 'WAIT');
  assert.equal(payload.stake, null);
  assert.equal(payload.stats.voidCount, 0);
  assert.equal(payload.stats.continuityGapCount, 1);
  assert.deepEqual(payload.latestReset, latestReset);

  assert.equal(
    snapshot({
      paperState: { ...state, continuityGapCount: 2 },
    }).reason,
    'paper_state_invalid',
  );

  for (const invalidReset of [
    { ...latestReset, incidentId: null },
    { ...latestReset, continuityEpoch: 0 },
    { ...latestReset, betId: 41 },
    {
      ...latestReset,
      betId: 41,
      incidentId: null,
      continuityEpoch: null,
      reason: 'hit',
    },
  ]) {
    const invalid = snapshot({
      paperState: { ...state, latestReset: invalidReset },
    });
    assert.equal(invalid.reason, 'paper_state_invalid');
    assert.equal(invalid.action, 'WAIT');
    assert.equal(invalid.stake, null);
  }
});

test('fixed-v1, forged mixed-stake accounting, and invalid ladder cursors fail closed', () => {
  const cases = [
    pendingPaperState({
      schemaVersion: 1,
      strategyVersion: 'predictive-leader-v7-manual-override-paper-v1',
      campaignKey: 'v7-manual-override-paper-20261019',
    }),
    pendingPaperState({ totalStaked: 20 }),
    pendingPaperState({
      ladder: { ...pendingPaperState().ladder, nextStake: 20 },
      nextStake: 20,
    }),
    pendingPaperState({
      pendingBet: { ...pendingPaperState().pendingBet, stake: 20 },
      reservedStake: 20,
      currentBalance: 9_980,
      accountingBalance: 9_980,
      availableBalance: 9_980,
      profit: -20,
      totalStaked: 20,
      minimumBalance: 9_980,
      maximumDrawdown: 20,
    }),
  ];

  for (const paperState of cases) {
    const payload = snapshot({ paperState });
    assert.equal(payload.status, 'paused');
    assert.equal(payload.reason, 'paper_state_invalid');
    assert.equal(payload.action, 'WAIT');
    assert.equal(payload.stake, null);
  }
});

test('invalid API identity and time inputs are rejected synchronously', () => {
  assert.throws(
    () => predictiveLeaderV7PaperSnapshotForApi({ source: ' ', instrument: INSTRUMENT }),
    /source and instrument are required/,
  );
  assert.throws(
    () => predictiveLeaderV7PaperSnapshotForApi({
      source: SOURCE,
      instrument: INSTRUMENT,
      now: 'not-a-date',
    }),
    /now must be a valid timestamp/,
  );
});
