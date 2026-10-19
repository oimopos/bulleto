import assert from 'node:assert/strict';
import test from 'node:test';

import { createDatabase } from '../src/database.js';

const SOURCE = 'buleto';
const INSTRUMENT = 'PRIMECOIN(XPM)/RUB';
const BASE_TIME = Date.parse('2026-09-21T00:00:00.000Z');

function event(number, index) {
  const settledAt = new Date(BASE_TIME + index * 1_000).toISOString();
  return {
    source: SOURCE,
    instrument: INSTRUMENT,
    settledAt,
    observedAt: settledAt,
    resultNumber: number,
    price: 5.4 + index / 10_000,
    fingerprint: `virtual-window-${index}`,
    rawPayload: { c: number },
  };
}

test('window strategy arms at 160 and places the first bet on the next result', () => {
  const database = createDatabase({
    path: ':memory:',
    virtualWindowStartingBalance: 10_000,
  });
  try {
    database.ingestBatch(Array.from({ length: 160 }, (_, index) => event(1, index)));
    let state = database.getVirtualWindowBettorState(SOURCE, INSTRUMENT);
    assert.equal(state.testBank.initialBalance, 10_000);
    assert.equal(state.activeSession.status, 'armed');
    assert.equal(state.activeSession.triggerRoundsMissed, 160);
    assert.equal(state.activeSession.attemptBudget, 40);
    assert.equal(state.lifetime.totalBets, 0);

    database.ingestBatch([event(2, 160)]);
    state = database.getVirtualWindowBettorState(SOURCE, INSTRUMENT);
    assert.equal(state.activeSession.status, 'active');
    assert.equal(state.activeSession.attemptCount, 1);
    assert.equal(state.latestOutcome.outcome, 'miss');
    assert.equal(state.latestOutcome.stake, 10);
    assert.equal(state.testBank.currentBalance, 9_990);
  } finally {
    database.close();
  }
});

test('window expiry after forty misses closes the session at age 200', () => {
  const database = createDatabase({ path: ':memory:' });
  try {
    database.ingestBatch([
      ...Array.from({ length: 160 }, (_, index) => event(1, index)),
      ...Array.from({ length: 40 }, (_, index) => event(1, 160 + index)),
    ]);
    const state = database.getVirtualWindowBettorState(SOURCE, INSTRUMENT);
    assert.equal(state.activeSession, null);
    assert.equal(state.recentSessions[0].endReason, 'window_expired');
    assert.equal(state.recentSessions[0].attemptCount, 40);
    assert.equal(state.testBank.currentBalance, 9_560);
    assert.equal(state.lifetime.totalBets, 40);
  } finally {
    database.close();
  }
});
