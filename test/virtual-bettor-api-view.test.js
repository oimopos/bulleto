import assert from 'node:assert/strict';
import test from 'node:test';

import { virtualBettorSnapshotForApi } from '../src/virtual-bettor-api.js';

const NOW = new Date('2026-10-07T17:44:00.000Z');

function state(overrides = {}) {
  return {
    mode: 'simulation',
    executionEnabled: false,
    status: 'waiting',
    triggerThreshold: 200,
    testBank: {
      status: 'running',
      initialBalance: 87_700,
      currentBalance: 88_040,
      netResult: 340,
      nextStake: 10,
      canAffordNext: true,
      shortfall: 0,
      startedAt: '2026-09-23T13:44:48.270Z',
      exhaustedAt: null,
      dataComplete: true,
      ...overrides.testBank,
    },
    longestCandidate: {
      number: 17,
      roundsSinceLast: 143,
      eligible: false,
      ...overrides.longestCandidate,
    },
    activeSession: null,
    latestOutcome: null,
    lifetime: {
      totalSessions: 1,
      completedSessions: 1,
      invalidatedSessions: 0,
      totalBets: 2,
      winningBets: 1,
      losingBets: 1,
      totalStaked: 20,
      grossPayout: 360,
      netResult: 340,
      ...overrides.lifetime,
    },
    ...overrides,
    testBank: {
      status: 'running',
      initialBalance: 87_700,
      currentBalance: 88_040,
      netResult: 340,
      nextStake: 10,
      canAffordNext: true,
      shortfall: 0,
      startedAt: '2026-09-23T13:44:48.270Z',
      exhaustedAt: null,
      dataComplete: true,
      ...overrides.testBank,
    },
    longestCandidate:
      overrides.longestCandidate === null
        ? null
        : {
            number: 17,
            roundsSinceLast: 143,
            eligible: false,
            ...overrides.longestCandidate,
          },
    lifetime: {
      totalSessions: 1,
      completedSessions: 1,
      invalidatedSessions: 0,
      totalBets: 2,
      winningBets: 1,
      losingBets: 1,
      totalStaked: 20,
      grossPayout: 360,
      netResult: 340,
      ...overrides.lifetime,
    },
  };
}

function activeSession(overrides = {}) {
  return {
    id: 9,
    status: 'armed',
    targetNumber: 17,
    triggerRoundsMissed: 200,
    attemptCount: 0,
    missCount: 0,
    totalStaked: 0,
    nextStake: 10,
    projectedGrossPayout: 360,
    projectedNetIfHit: 350,
    projectedTotalLossIfMiss: 10,
    recoveryPossible: true,
    selectedAt: '2026-10-07T17:43:30.000Z',
    startedAt: null,
    ...overrides,
  };
}

function collector(overrides = {}) {
  return {
    connected: true,
    error: null,
    currentRound: {
      id: 4_102_101,
      status: 2,
      startsAt: '2026-10-07T17:43:40.000Z',
      bettingClosesAt: '2026-10-07T17:44:20.000Z',
      ...overrides.currentRound,
    },
    ...overrides,
  };
}

const latestResult = {
  id: 500,
  externalRoundId: '4102100',
  number: 3,
  settledAt: '2026-10-07T17:43:29.000Z',
};

test('waiting snapshot exposes result, bank profit, and a non-actionable signal', () => {
  const snapshot = virtualBettorSnapshotForApi({
    state: state(),
    latestResult,
    collectorState: collector(),
    now: NOW,
  });

  assert.equal(snapshot.currentBalance, 88_040);
  assert.equal(snapshot.profit, 340);
  assert.deepEqual(snapshot.latestResult, {
    id: 500,
    roundId: '4102100',
    number: 3,
    settledAt: '2026-10-07T17:43:29.000Z',
  });
  assert.equal(snapshot.bank.profit, 340);
  assert.equal(snapshot.lifetime.profit, 340);
  assert.equal(snapshot.activeSession, null);
  assert.deepEqual(snapshot.signal, {
    action: 'WAIT',
    actionable: false,
    reason: 'below_threshold',
    actionId: null,
    sessionId: null,
    roundId: 4_102_101,
    targetNumber: null,
    stake: null,
    attemptNumber: null,
    validUntil: '2026-10-07T17:44:20.000Z',
  });
  assert.equal(snapshot.latestOutcome, null);
});

test('armed strategy emits a stable BET action with target, stake, and projections', () => {
  const snapshot = virtualBettorSnapshotForApi({
    state: state({
      status: 'armed',
      activeSession: activeSession(),
    }),
    latestResult,
    collectorState: collector(),
    now: NOW,
  });

  assert.deepEqual(snapshot.signal, {
    action: 'BET',
    actionable: true,
    reason: 'ready',
    actionId: 'bet:9:4102101',
    sessionId: 9,
    roundId: 4_102_101,
    targetNumber: 17,
    stake: 10,
    attemptNumber: 1,
    validUntil: '2026-10-07T17:44:20.000Z',
  });
  assert.equal(snapshot.activeSession.projectedBalanceIfHit, 88_390);
  assert.equal(snapshot.activeSession.projectedProfitIfHit, 690);
  assert.equal(snapshot.activeSession.projectedBalanceIfMiss, 88_030);
  assert.equal(snapshot.activeSession.projectedProfitIfMiss, 330);
});

test('closed or unavailable betting window never emits BET', () => {
  const closed = virtualBettorSnapshotForApi({
    state: state({ status: 'armed', activeSession: activeSession() }),
    latestResult,
    collectorState: collector(),
    now: new Date('2026-10-07T17:44:20.000Z'),
  });
  assert.equal(closed.signal.action, 'WAIT');
  assert.equal(closed.signal.reason, 'betting_closed');
  assert.equal(closed.signal.actionId, null);

  const unavailable = virtualBettorSnapshotForApi({
    state: state({ status: 'armed', activeSession: activeSession() }),
    latestResult,
    collectorState: collector({ connected: false }),
    now: NOW,
  });
  assert.equal(unavailable.signal.action, 'WAIT');
  assert.equal(unavailable.signal.reason, 'collector_unavailable');
});

test('latest HIT remains separate when a new BET action already exists', () => {
  const snapshot = virtualBettorSnapshotForApi({
    state: state({
      status: 'armed',
      activeSession: activeSession({ id: 10, targetNumber: 8 }),
      latestOutcome: {
        betId: 77,
        resultId: 500,
        roundId: '4102100',
        sessionId: 9,
        attemptNumber: 14,
        targetNumber: 3,
        resultNumber: 3,
        outcome: 'hit',
        stake: 10,
        grossPayout: 360,
        totalStakedAfter: 140,
        sessionNetAfter: 220,
        nextStake: null,
        recoveryPossible: true,
        occurredAt: '2026-10-07T17:43:29.000Z',
      },
    }),
    latestResult,
    collectorState: collector(),
    now: NOW,
  });

  assert.equal(snapshot.signal.action, 'BET');
  assert.equal(snapshot.signal.targetNumber, 8);
  assert.deepEqual(snapshot.latestOutcome, {
    eventId: 'virtual-bet:77',
    betId: 77,
    resultId: 500,
    roundId: '4102100',
    sessionId: 9,
    attemptNumber: 14,
    targetNumber: 3,
    resultNumber: 3,
    outcome: 'HIT',
    stake: 10,
    grossPayout: 360,
    totalStakedAfter: 140,
    sessionNetAfter: 220,
    nextStake: null,
    recoveryPossible: true,
    occurredAt: '2026-10-07T17:43:29.000Z',
    isLatestResult: true,
  });
});

test('an older outcome stays available with an explicit freshness flag', () => {
  const snapshot = virtualBettorSnapshotForApi({
    state: state({
      latestOutcome: {
        betId: 76,
        resultId: 499,
        roundId: '4102099',
        sessionId: 9,
        attemptNumber: 13,
        targetNumber: 3,
        resultNumber: 7,
        outcome: 'miss',
        stake: 10,
        grossPayout: 0,
        totalStakedAfter: 130,
        sessionNetAfter: -130,
        nextStake: 10,
        recoveryPossible: true,
        occurredAt: '2026-10-07T17:41:59.000Z',
      },
    }),
    latestResult,
    collectorState: collector(),
    now: NOW,
  });

  assert.equal(snapshot.latestOutcome.outcome, 'MISS');
  assert.equal(snapshot.latestOutcome.isLatestResult, false);
  assert.equal(snapshot.latestOutcome.eventId, 'virtual-bet:76');
});
