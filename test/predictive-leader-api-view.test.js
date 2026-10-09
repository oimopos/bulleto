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

const SOURCE = 'buleto';
const INSTRUMENT = 'XPM/RUB';
const LATEST_SETTLED_AT = '2026-10-10T10:00:00.000Z';
const LOCKED_AT = '2026-10-10T10:00:20.000Z';
const BETTING_CLOSES_AT = '2026-10-10T10:00:28.000Z';
const ROUND_ENDS_AT = '2026-10-10T10:00:30.000Z';
const SERVER_TIME = '2026-10-10T10:00:22.000Z';

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
  }
});

test('predictive leader GET view has a stable waiting shape without state', () => {
  const payload = snapshot(null);
  assert.equal(payload.status, 'waiting');
  assert.equal(payload.reason, 'state_unavailable');
  assert.equal(payload.number, null);
  assert.equal(payload.forecast, null);
  assert.equal(payload.model, null);
  assert.equal(payload.freshness.currentRoundId, null);
});
