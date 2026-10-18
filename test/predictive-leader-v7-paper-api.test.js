import assert from 'node:assert/strict';
import test from 'node:test';

import { LEARNED_LEADER_V7_ALGORITHM_VERSION } from '../src/learned-leader-v7.js';
import {
  PREDICTIVE_LEADER_V7_PAPER_API_SCHEMA_VERSION,
  PREDICTIVE_LEADER_V7_PAPER_STRATEGY_MODE,
  PREDICTIVE_LEADER_V7_PAPER_STRATEGY_VERSION,
  predictiveLeaderV7PaperSnapshotForApi,
} from '../src/predictive-leader-v7-paper-api.js';

const SOURCE = 'buleto';
const INSTRUMENT = 'XPM/RUB';
const CANDIDATE_ID = 'v7-rank20-history80-uniform95-a740-b500-t5-20261018';
const CAMPAIGN_KEY = 'v7-manual-override-paper-20261019';
const LATEST_SETTLED_AT = '2026-10-19T02:00:00.000Z';
const LOCKED_AT = '2026-10-19T02:00:20.000Z';
const PLACED_AT = '2026-10-19T02:00:21.000Z';
const SERVER_TIME = '2026-10-19T02:00:22.000Z';
const BETTING_CLOSES_AT = '2026-10-19T02:00:28.000Z';
const ROUND_ENDS_AT = '2026-10-19T02:00:30.000Z';
const FORECAST_ID = 1_001;

function pendingPaperState(overrides = {}) {
  return {
    schemaVersion: 1,
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
      fixedStake: 10,
      grossPayoutMultiplier: 36,
      payoutIncludesStake: true,
    },
    status: 'pending',
    reason: 'bet_frozen',
    initialBalance: 1_000,
    currentBalance: 990,
    deficit: 0,
    accountingBalance: 990,
    availableBalance: 990,
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
    peakBalance: 1_000,
    minimumBalance: 990,
    maximumDrawdown: 10,
    continuityGapCount: 0,
    pendingBet: {
      id: 41,
      forecastId: FORECAST_ID,
      roundId: '101',
      targetNumber: 7,
      stake: 10,
      lockedAt: LOCKED_AT,
      bettingClosesAt: BETTING_CLOSES_AT,
      placedAt: PLACED_AT,
    },
    latestOutcome: null,
    latestVoid: null,
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
    currentBalance: 1_000,
    accountingBalance: 1_000,
    availableBalance: 1_000,
    reservedStake: 0,
    profit: 0,
    canAffordNext: true,
    betCount: 0,
    pendingCount: 0,
    totalStaked: 0,
    minimumBalance: 1_000,
    maximumDrawdown: 0,
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
  assert.equal(payload.candidateNumber, 7);
  assert.equal(payload.account.currentBalance, 990);
  assert.equal(payload.account.reservedStake, 10);
  assert.equal(payload.stats.betCount, 1);
  assert.equal(payload.pendingBet.forecastId, FORECAST_ID);
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
  assert.equal(payload.candidateNumber, 7);
  assert.equal(payload.pendingBet, null);
  assert.equal(payload.account.currentBalance, 1_000);
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
  }
});

test('closed and already-settled rounds cannot expose a BET', () => {
  const closed = snapshot({ now: BETTING_CLOSES_AT });
  assert.equal(closed.reason, 'betting_closed');
  assert.equal(closed.action, 'WAIT');

  const settled = snapshot({
    audit: auditState({
      latest: {
        settlement: { resultId: 901, actualNumber: 7 },
      },
    }),
  });
  assert.equal(settled.reason, 'forecast_settled');
  assert.equal(settled.action, 'WAIT');
});

test('paper evidence must match the frozen V7 candidate and timestamps', () => {
  const wrongNumber = pendingPaperState();
  wrongNumber.pendingBet = { ...wrongNumber.pendingBet, targetNumber: 8 };
  const numberPayload = snapshot({ paperState: wrongNumber });
  assert.equal(numberPayload.reason, 'paper_evidence_mismatch');
  assert.equal(numberPayload.action, 'WAIT');

  const wrongLock = pendingPaperState();
  wrongLock.pendingBet = {
    ...wrongLock.pendingBet,
    lockedAt: '2026-10-19T02:00:19.000Z',
  };
  const lockPayload = snapshot({ paperState: wrongLock });
  assert.equal(lockPayload.reason, 'paper_evidence_mismatch');
  assert.equal(lockPayload.action, 'WAIT');
});

test('invalid paper accounting or a promotable audit is rejected', () => {
  const badAccount = pendingPaperState({ currentBalance: 1_000 });
  const accountPayload = snapshot({ paperState: badAccount });
  assert.equal(accountPayload.status, 'paused');
  assert.equal(accountPayload.reason, 'paper_state_invalid');
  assert.equal(accountPayload.account, null);
  assert.equal(accountPayload.action, 'WAIT');

  const promotableAudit = auditState({
    qualityGateDiagnostic: { promotionEligible: true },
  });
  const auditPayload = snapshot({ audit: promotableAudit });
  assert.equal(auditPayload.status, 'paused');
  assert.equal(auditPayload.reason, 'audit_invalid');
  assert.equal(auditPayload.qualityGateDiagnostic, null);
  assert.equal(auditPayload.action, 'WAIT');
});

test('latest settled outcome and account statistics remain visible while waiting', () => {
  const state = pendingPaperState({
    status: 'waiting',
    reason: 'waiting_next_frozen_v7',
    currentBalance: 1_350,
    accountingBalance: 1_350,
    availableBalance: 1_350,
    reservedStake: 0,
    profit: 350,
    canAffordNext: true,
    betCount: 1,
    settledCount: 1,
    pendingCount: 0,
    hitCount: 1,
    hitRate: 1,
    totalStaked: 10,
    totalGrossPayout: 360,
    peakBalance: 1_350,
    minimumBalance: 990,
    maximumDrawdown: 10,
    pendingBet: null,
    latestOutcome: {
      betId: 41,
      forecastId: FORECAST_ID,
      resultId: 901,
      roundId: '101',
      targetNumber: 7,
      resultNumber: 7,
      outcome: 'hit',
      stake: 10,
      grossPayout: 360,
      balanceAfter: 1_350,
      occurredAt: '2026-10-19T02:00:30.000Z',
    },
    updatedAt: '2026-10-19T02:00:30.000Z',
  });
  const payload = snapshot({ paperState: state });

  assert.equal(payload.action, 'WAIT');
  assert.equal(payload.reason, 'paper_bet_not_pending');
  assert.equal(payload.account.currentBalance, 1_350);
  assert.equal(payload.stats.hitCount, 1);
  assert.equal(payload.latestOutcome.outcome, 'HIT');
  assert.equal(payload.latestOutcome.eventId, 'v7-paper-bet:41');
});

test('a late void deficit remains auditable and exhausts the paper campaign', () => {
  const state = pendingPaperState({
    status: 'exhausted',
    reason: 'bankroll_exhausted',
    currentBalance: 0,
    deficit: 10,
    accountingBalance: -10,
    availableBalance: 0,
    reservedStake: 0,
    profit: -1_010,
    canAffordNext: false,
    shortfall: 20,
    betCount: 102,
    settledCount: 101,
    pendingCount: 0,
    voidCount: 1,
    hitCount: 0,
    missCount: 101,
    hitRate: 0,
    totalStaked: 1_010,
    totalGrossPayout: 0,
    peakBalance: 1_000,
    minimumBalance: -10,
    maximumDrawdown: 1_010,
    pendingBet: null,
    latestOutcome: {
      betId: 142,
      forecastId: FORECAST_ID + 101,
      resultId: 1_002,
      roundId: '202',
      targetNumber: 7,
      resultNumber: 8,
      outcome: 'miss',
      stake: 10,
      grossPayout: 0,
      balanceAfter: 0,
      occurredAt: '2026-10-19T02:10:00.000Z',
    },
    latestVoid: {
      betId: 41,
      forecastId: FORECAST_ID,
      roundId: '101',
      targetNumber: 7,
      stake: 10,
      reason: 'round_metadata_conflict',
      voidedAt: '2026-10-19T02:10:01.000Z',
    },
    updatedAt: '2026-10-19T02:10:01.000Z',
    exhaustedAt: '2026-10-19T02:10:01.000Z',
  });
  const payload = snapshot({ paperState: state });

  assert.equal(payload.status, 'waiting');
  assert.equal(payload.reason, 'bankroll_exhausted');
  assert.equal(payload.action, 'WAIT');
  assert.equal(payload.account.currentBalance, 0);
  assert.equal(payload.account.deficit, 10);
  assert.equal(payload.account.accountingBalance, -10);
  assert.equal(payload.account.shortfall, 20);
  assert.equal(payload.stats.minimumBalance, -10);
});

test('the final affordable pending bet stays visible after reserving the last stake', () => {
  const state = pendingPaperState({
    currentBalance: 0,
    deficit: 0,
    accountingBalance: 0,
    availableBalance: 0,
    profit: -1_000,
    shortfall: 10,
    betCount: 100,
    settledCount: 99,
    pendingCount: 1,
    hitCount: 0,
    missCount: 99,
    hitRate: 0,
    totalStaked: 1_000,
    totalGrossPayout: 0,
    minimumBalance: 0,
    maximumDrawdown: 1_000,
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
      balanceAfter: 10,
      occurredAt: '2026-10-19T02:00:00.000Z',
    },
  });
  const payload = snapshot({ paperState: state });

  assert.equal(payload.status, 'ready');
  assert.equal(payload.action, 'BET');
  assert.equal(payload.account.currentBalance, 0);
  assert.equal(payload.account.exhaustedAt, null);
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
