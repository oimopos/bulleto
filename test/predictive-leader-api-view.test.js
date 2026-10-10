import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEARNED_LEADER_ALGORITHM_VERSION,
  buildLearnedLeaderDecision,
} from '../src/learned-leader.js';
import {
  PREDICTIVE_LEADER_API_SCHEMA_VERSION,
  predictiveLeaderSnapshotForApi,
} from '../src/predictive-leader-api.js';
import {
  PREDICTIVE_LEADER_ACCOUNT_MODEL,
  PREDICTIVE_LEADER_ACCOUNT_SCHEMA_VERSION,
  PREDICTIVE_LEADER_ACCOUNT_STARTING_BALANCE,
  PREDICTIVE_LEADER_ACCOUNT_STRATEGY_VERSION,
} from '../src/predictive-leader-account.js';

const SOURCE = 'buleto';
const INSTRUMENT = 'XPM/RUB';
const LATEST_SETTLED_AT = '2026-10-10T10:00:00.000Z';
const LOCKED_AT = '2026-10-10T10:00:20.000Z';
const BETTING_CLOSES_AT = '2026-10-10T10:00:28.000Z';
const ROUND_ENDS_AT = '2026-10-10T10:00:30.000Z';
const SERVER_TIME = '2026-10-10T10:00:22.000Z';
const ACCOUNT_STARTED_AT = '2026-10-10T10:00:21.000Z';

function pristineAccount() {
  return {
    schemaVersion: PREDICTIVE_LEADER_ACCOUNT_SCHEMA_VERSION,
    strategyVersion: PREDICTIVE_LEADER_ACCOUNT_STRATEGY_VERSION,
    leaderAlgorithmVersion: LEARNED_LEADER_ALGORITHM_VERSION,
    mode: 'prospective-simulation',
    executionEnabled: false,
    advisoryOnly: true,
    status: 'waiting',
    reason: 'waiting_first_frozen_leader',
    initialBalance: PREDICTIVE_LEADER_ACCOUNT_STARTING_BALANCE,
    currentBalance: 1000,
    profit: 0,
    model: {
      ...PREDICTIVE_LEADER_ACCOUNT_MODEL,
      netHitMultiplier: 35,
    },
    nextStake: 10,
    canAffordNext: true,
    shortfall: 0,
    betCount: 0,
    settledCount: 0,
    pendingCount: 0,
    hitCount: 0,
    missCount: 0,
    hitRate: null,
    totalStaked: 0,
    totalGrossPayout: 0,
    peakBalance: 1000,
    minimumBalance: 1000,
    maximumDrawdown: 0,
    continuityGapCount: 0,
    ladder: { missCount: 0, totalLoss: 0 },
    pendingBet: null,
    latestOutcome: null,
    startedAt: null,
    updatedAt: null,
    exhaustedAt: null,
  };
}

function pendingAccount() {
  return {
    schemaVersion: PREDICTIVE_LEADER_ACCOUNT_SCHEMA_VERSION,
    strategyVersion: PREDICTIVE_LEADER_ACCOUNT_STRATEGY_VERSION,
    leaderAlgorithmVersion: LEARNED_LEADER_ALGORITHM_VERSION,
    mode: 'prospective-simulation',
    executionEnabled: false,
    advisoryOnly: true,
    status: 'pending',
    reason: 'bet_frozen',
    initialBalance: PREDICTIVE_LEADER_ACCOUNT_STARTING_BALANCE,
    currentBalance: 1000,
    profit: 0,
    model: {
      ...PREDICTIVE_LEADER_ACCOUNT_MODEL,
      netHitMultiplier: 35,
    },
    nextStake: 10,
    canAffordNext: true,
    shortfall: 0,
    betCount: 1,
    settledCount: 0,
    pendingCount: 1,
    hitCount: 0,
    missCount: 0,
    hitRate: null,
    totalStaked: 0,
    totalGrossPayout: 0,
    peakBalance: 1000,
    minimumBalance: 1000,
    maximumDrawdown: 0,
    continuityGapCount: 0,
    ladder: { missCount: 0, totalLoss: 0 },
    pendingBet: {
      forecastId: 77,
      targetNumber: 7,
      stake: 10,
      balanceBefore: 1000,
      placedAt: ACCOUNT_STARTED_AT,
    },
    latestOutcome: null,
    startedAt: ACCOUNT_STARTED_AT,
    updatedAt: ACCOUNT_STARTED_AT,
    exhaustedAt: null,
  };
}

function waitingAccount() {
  return {
    ...pendingAccount(),
    status: 'waiting',
    reason: 'waiting_next_frozen_leader',
    currentBalance: 990,
    profit: -10,
    betCount: 1,
    settledCount: 1,
    pendingCount: 0,
    missCount: 1,
    hitRate: 0,
    totalStaked: 10,
    minimumBalance: 990,
    maximumDrawdown: 10,
    ladder: { missCount: 1, totalLoss: 10 },
    pendingBet: null,
    latestOutcome: {
      forecastId: 76,
      resultId: 10,
      targetNumber: 7,
      resultNumber: 8,
      stake: 10,
      outcome: 'miss',
      grossPayout: 0,
      balanceAfter: 990,
      occurredAt: LATEST_SETTLED_AT,
    },
    startedAt: '2026-10-10T09:59:20.000Z',
    updatedAt: LATEST_SETTLED_AT,
  };
}

function exhaustedAccount() {
  return {
    ...pendingAccount(),
    status: 'exhausted',
    reason: 'bankroll_exhausted',
    currentBalance: 10,
    profit: -990,
    nextStake: 30,
    canAffordNext: false,
    shortfall: 20,
    betCount: 63,
    settledCount: 63,
    pendingCount: 0,
    missCount: 63,
    hitRate: 0,
    totalStaked: 990,
    minimumBalance: 10,
    maximumDrawdown: 990,
    ladder: { missCount: 63, totalLoss: 990 },
    pendingBet: null,
    latestOutcome: {
      forecastId: 76,
      resultId: 10,
      targetNumber: 7,
      resultNumber: 8,
      stake: 30,
      outcome: 'miss',
      grossPayout: 0,
      balanceAfter: 10,
      occurredAt: LATEST_SETTLED_AT,
    },
    startedAt: '2026-10-09T10:00:00.000Z',
    updatedAt: LATEST_SETTLED_AT,
    exhaustedAt: LATEST_SETTLED_AT,
  };
}

function readyDecision() {
  return buildLearnedLeaderDecision({
    sources: [
      {
        id: 'price-rank37',
        family: 'price',
        numbers: [7, 11, 19],
        weights: [0.6, 0.3, 0.1],
        cursor: { forecastId: 77, cutoffAt: LOCKED_AT },
      },
      {
        id: 'conditional-pair-full',
        family: 'conditional-history',
        numbers: [7, 8, 12],
        weights: [0.5, 0.3, 0.2],
        cursor: {
          historyMaxResultId: 10,
          anchorResultId: 10,
          cutoffAt: LOCKED_AT,
        },
      },
    ],
    learningRows: [],
    lockedAt: LOCKED_AT,
    tieSeed: '10:101',
  });
}

function mappedLeader(decision = readyDecision()) {
  return {
    ...decision,
    forecastId: 77,
    historyMaxResultId: 10,
    trainingThroughForecastId: null,
    trainingThroughResultId: null,
    createdAt: '2026-10-10T10:00:21.000Z',
    evaluation: null,
  };
}

function freshState() {
  return {
    collector: {
      connected: true,
      status: 'connected',
      error: null,
      currentRound: { id: '101' },
      lastResultAt: LATEST_SETTLED_AT,
      resultConfirmationPending: false,
      pendingResultCount: 0,
    },
    pipelinePending: { results: 0, gaps: 0 },
    latestResult: {
      id: 10,
      roundId: '100',
      number: 4,
      settledAt: LATEST_SETTLED_AT,
    },
    activeCycle: {
      id: 3,
      status: 'active',
      integrityStatus: 'ok',
    },
    warnings: [],
    precloseForecast: {
      latest: {
        id: 77,
        source: SOURCE,
        instrument: INSTRUMENT,
        roundId: '101',
        lockedAt: LOCKED_AT,
        bettingClosesAt: BETTING_CLOSES_AT,
        roundEndsAt: ROUND_ENDS_AT,
        settlement: null,
        predictiveLeader: mappedLeader(),
      },
      predictiveLeaderMetrics: {
        algorithmVersion: LEARNED_LEADER_ALGORITHM_VERSION,
        readyCount: 1,
        settledCount: 0,
        pendingCount: 1,
        top1Hits: 0,
        top3Hits: 0,
        top1Rate: null,
        top3Rate: null,
        meanBrierLoss: null,
        uniformBrierLoss: 18 / 37,
        beatsUniform: null,
      },
      predictiveLeaderAccount: pendingAccount(),
    },
  };
}

function snapshot(state = freshState()) {
  return predictiveLeaderSnapshotForApi({
    state,
    source: SOURCE,
    instrument: INSTRUMENT,
    now: new Date(SERVER_TIME),
  });
}

test('separate predictive leader GET view exposes exactly one fresh number', () => {
  const payload = snapshot();

  assert.deepEqual(payload, {
    schemaVersion: PREDICTIVE_LEADER_API_SCHEMA_VERSION,
    algorithmVersion: LEARNED_LEADER_ALGORITHM_VERSION,
    mode: 'observation',
    executionEnabled: false,
    advisoryOnly: true,
    source: SOURCE,
    instrument: INSTRUMENT,
    serverTime: SERVER_TIME,
    status: 'ready',
    reason: 'ready',
    number: 7,
    forecast: {
      id: 77,
      roundId: '101',
      lockedAt: LOCKED_AT,
      bettingClosesAt: BETTING_CLOSES_AT,
      roundEndsAt: ROUND_ENDS_AT,
    },
    model: {
      sourceCount: 2,
      familyCount: 2,
      activeFamilies: ['price', 'conditional-history'],
      activeFamilyWeights: {
        price: 0.5,
        'conditional-history': 0.5,
      },
      learningVersion: 'family-brier-logodds-v1',
      learningStatus: 'cold_start',
      trainingCount: 0,
      learnedFamilyWeights: {
        price: 0.5,
        'conditional-history': 0.5,
      },
      tieBreakApplied: false,
    },
    account: pendingAccount(),
    metrics: {
      readyCount: 1,
      settledCount: 0,
      pendingCount: 1,
      top1Hits: 0,
      top1Rate: null,
      meanBrierLoss: null,
      uniformBrierLoss: 18 / 37,
      beatsUniform: null,
    },
    freshness: {
      currentRoundId: 101,
      latestPersistedResultId: 10,
      latestPersistedRoundId: 100,
      latestPersistedAt: LATEST_SETTLED_AT,
      collectorLastResultAt: LATEST_SETTLED_AT,
      resultCursorMatches: true,
      roundCursorMatches: true,
      forecastRoundMatches: true,
      resultConfirmationPending: false,
      pendingResultCount: 0,
      persistencePendingResults: 0,
      persistencePendingGaps: 0,
      integrityOk: true,
    },
  });

  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(
    serialized,
    /ranking|combinedDistribution|familyDistributions|sourceManifest/,
  );
  assert.equal(
    [...serialized.matchAll(/"number":/g)].length,
    1,
    'the endpoint must expose one roulette prediction only',
  );
});

test('predictive leader GET view fails closed instead of returning a stale number', () => {
  const unavailableDecision = buildLearnedLeaderDecision({
    sources: [],
    lockedAt: LOCKED_AT,
    tieSeed: '10:101',
  });
  const cases = [
    {
      status: 'paused',
      reason: 'integrity_gap',
      mutate(state) {
        state.activeCycle.integrityStatus = 'gap';
      },
    },
    {
      status: 'paused',
      reason: 'collector_unavailable',
      mutate(state) {
        state.collector.connected = false;
        state.collector.status = 'reconnecting';
      },
    },
    {
      status: 'paused',
      reason: 'collector_pending',
      mutate(state) {
        state.collector.resultConfirmationPending = true;
      },
    },
    {
      status: 'paused',
      reason: 'persistence_pending',
      mutate(state) {
        state.pipelinePending.results = 1;
      },
    },
    {
      status: 'paused',
      reason: 'result_cursor_mismatch',
      mutate(state) {
        state.collector.lastResultAt = '2026-10-10T09:59:00.000Z';
      },
    },
    {
      status: 'paused',
      reason: 'round_cursor_mismatch',
      mutate(state) {
        state.collector.currentRound.id = '102';
        state.precloseForecast.latest.roundId = '102';
      },
    },
    {
      status: 'paused',
      reason: 'forecast_round_mismatch',
      mutate(state) {
        state.precloseForecast.latest.roundId = '102';
      },
    },
    {
      status: 'waiting',
      reason: 'forecast_settled',
      mutate(state) {
        state.precloseForecast.latest.settlement = { actualNumber: 7 };
      },
    },
    {
      status: 'waiting',
      reason: 'leader_not_frozen',
      mutate(state) {
        state.precloseForecast.latest.predictiveLeader = null;
      },
    },
    {
      status: 'paused',
      reason: 'leader_invalid',
      mutate(state) {
        state.precloseForecast.latest.predictiveLeader.lockedAt =
          '2026-10-10T10:00:19.000Z';
      },
    },
    {
      status: 'waiting',
      reason: 'no_valid_family',
      mutate(state) {
        state.precloseForecast.latest.predictiveLeader = mappedLeader(
          unavailableDecision,
        );
      },
    },
  ];

  for (const scenario of cases) {
    const state = freshState();
    scenario.mutate(state);
    const payload = snapshot(state);
    assert.equal(payload.status, scenario.status, scenario.reason);
    assert.equal(payload.reason, scenario.reason);
    assert.equal(payload.number, null);
    assert.equal(payload.model, null);
    assert.deepEqual(payload.account, pendingAccount());
  }
});

test('predictive leader GET view exposes persisted account states without mutation', () => {
  for (const account of [
    pristineAccount(),
    pendingAccount(),
    waitingAccount(),
    exhaustedAccount(),
  ]) {
    const state = freshState();
    state.precloseForecast.predictiveLeaderAccount = account;
    const before = structuredClone(state);

    const payload = snapshot(state);

    assert.equal(payload.status, 'ready');
    assert.equal(payload.number, 7);
    assert.deepEqual(payload.account, account);
    assert.notStrictEqual(payload.account, account);
    assert.notStrictEqual(payload.account.model, account.model);
    assert.deepEqual(state, before, `${account.status} input state must stay untouched`);
  }
});

test('predictive leader GET view keeps a valid account on waiting and paused responses', () => {
  const waitingState = freshState();
  waitingState.precloseForecast.predictiveLeaderAccount = waitingAccount();
  waitingState.precloseForecast.latest.settlement = { actualNumber: 8 };
  const waitingPayload = snapshot(waitingState);
  assert.equal(waitingPayload.status, 'waiting');
  assert.equal(waitingPayload.reason, 'forecast_settled');
  assert.deepEqual(waitingPayload.account, waitingAccount());

  const pausedState = freshState();
  pausedState.precloseForecast.predictiveLeaderAccount = exhaustedAccount();
  pausedState.collector.connected = false;
  pausedState.collector.status = 'reconnecting';
  const pausedPayload = snapshot(pausedState);
  assert.equal(pausedPayload.status, 'paused');
  assert.equal(pausedPayload.reason, 'collector_unavailable');
  assert.deepEqual(pausedPayload.account, exhaustedAccount());
});

test('predictive leader GET view rejects invalid account snapshots independently', () => {
  const cases = [
    ['schema version', (account) => { account.schemaVersion += 1; }],
    ['strategy version', (account) => { account.strategyVersion = 'other'; }],
    ['leader algorithm version', (account) => {
      account.leaderAlgorithmVersion = 'other';
    }],
    ['model', (account) => { account.model.maxStake += 10; }],
    ['derived model multiplier', (account) => {
      account.model.netHitMultiplier = 36;
    }],
    ['balance identity', (account) => { account.currentBalance = 999; }],
    ['ladder stake', (account) => { account.nextStake = 20; }],
    ['bet count', (account) => { account.betCount = 2; }],
    ['drawdown bounds', (account) => { account.maximumDrawdown = 1; }],
    ['ladder totals', (account) => {
      account.ladder = { missCount: 1, totalLoss: 10 };
    }],
    ['pending target', (account) => { account.pendingBet.targetNumber = 37; }],
    ['pending count', (account) => { account.pendingCount = 0; }],
    ['non-canonical timestamp', (account) => {
      account.pendingBet.placedAt = '2026-10-10T10:00:21Z';
    }],
    ['status/reason pair', (account) => { account.status = 'waiting'; }],
    ['numeric string', (account) => { account.currentBalance = '1000'; }],
  ];

  for (const [label, mutate] of cases) {
    const state = freshState();
    mutate(state.precloseForecast.predictiveLeaderAccount);
    const before = structuredClone(state);
    const payload = snapshot(state);
    assert.equal(payload.status, 'ready', label);
    assert.equal(payload.number, 7, label);
    assert.equal(payload.account, null, label);
    assert.deepEqual(state, before, `${label} input state must stay untouched`);
  }
});

test('predictive leader GET view never initializes an absent account', () => {
  const state = freshState();
  delete state.precloseForecast.predictiveLeaderAccount;
  const before = structuredClone(state);

  const payload = snapshot(state);

  assert.equal(payload.status, 'ready');
  assert.equal(payload.number, 7);
  assert.equal(payload.account, null);
  assert.deepEqual(state, before);
});

test('predictive leader GET view has a stable waiting shape without state', () => {
  const payload = snapshot(null);
  assert.equal(payload.status, 'waiting');
  assert.equal(payload.reason, 'state_unavailable');
  assert.equal(payload.number, null);
  assert.equal(payload.forecast, null);
  assert.equal(payload.model, null);
  assert.equal(payload.account, null);
  assert.equal(payload.freshness.currentRoundId, null);
});
