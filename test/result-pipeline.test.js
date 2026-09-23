import test from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase } from '../src/database.js';
import { ResultPipeline } from '../src/result-pipeline.js';

const SOURCE = 'buleto';
const INSTRUMENT = 'XPM/RUB';
const BASE_TIME = Date.parse('2026-09-21T00:00:00.000Z');

function result(offsetSeconds, number, suffix, extra = {}) {
  const settledAt = new Date(BASE_TIME + offsetSeconds * 1_000).toISOString();
  return {
    source: SOURCE,
    instrument: INSTRUMENT,
    externalRoundId: null,
    settledAt,
    resultNumber: number,
    price: String(5.4 + offsetSeconds / 100_000),
    observedAt: settledAt,
    fingerprint: `fingerprint-${suffix}`,
    rawPayload: { dt: settledAt, c: number, v: 5.4 },
    ...extra,
  };
}

function createPipeline(database, options = {}) {
  return new ResultPipeline({
    db: database,
    source: SOURCE,
    instrument: INSTRUMENT,
    gapThresholdSeconds: 135,
    logger: { warn() {} },
    ...options,
  });
}

function seedActiveVirtualSession(database, prefix) {
  database.ingestBatch(
    Array.from({ length: 201 }, (_, index) =>
      result(index, 1, `${prefix}-${index}`),
    ),
  );
  const state = database.getVirtualBettorState(SOURCE, INSTRUMENT);
  assert.equal(state.status, 'active');
  assert.equal(state.activeSession.targetNumber, 0);
  assert.equal(state.activeSession.attemptCount, 1);
  return state.activeSession;
}

test('a transient database error leaves the result eligible for retry', () => {
  const database = createDatabase({ path: ':memory:' });
  let attempts = 0;
  const flakyDatabase = {
    getDashboardState: () => database.getDashboardState(),
    markGap: (details) => database.markGap(details),
    ingestBatch(events) {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('temporary sqlite failure');
      }
      return database.ingestBatch(events);
    },
  };
  const pipeline = createPipeline(flakyDatabase);
  const candidate = result(0, 7, 'retry');

  try {
    assert.throws(() => pipeline.ingest([candidate]), /temporary sqlite failure/);
    assert.equal(database.getDashboardState().totals.results, 0);
    assert.deepEqual(pipeline.getPendingCounts(), { results: 1, gaps: 0 });

    const retried = pipeline.drain();
    assert.equal(attempts, 2);
    assert.equal(retried.inserted, 1);
    assert.equal(retried.changed, true);
    assert.equal(database.getDashboardState().totals.results, 1);
    assert.deepEqual(pipeline.getPendingCounts(), { results: 0, gaps: 0 });

    const alreadyCommitted = pipeline.ingest([candidate]);
    assert.deepEqual(alreadyCommitted, {
      inserted: 0,
      gaps: 0,
      ignoredHistorical: 0,
      changed: false,
    });
  } finally {
    database.close();
  }
});

test('retry after the post-gap batch fails does not duplicate the gap incident', () => {
  const database = createDatabase({ path: ':memory:' });
  const previous = result(0, 2, 'gap-retry-before');
  database.ingestBatch([previous]);
  let attempts = 0;
  const flakyDatabase = {
    getDashboardState: () => database.getDashboardState(),
    markGap: (details) => database.markGap(details),
    ingestBatch(events) {
      attempts += 1;
      if (attempts === 1) throw new Error('post-gap write failed');
      return database.ingestBatch(events);
    },
  };
  const pipeline = createPipeline(flakyDatabase);
  const next = result(600, 8, 'gap-retry-after');

  try {
    assert.throws(() => pipeline.ingest([next]), /post-gap write failed/);
    let state = database.getDashboardState();
    assert.equal(state.totals.results, 1);
    assert.equal(state.totals.incidents, 1);
    assert.equal(state.totals.invalidCycles, 1);
    assert.deepEqual(pipeline.getPendingCounts(), { results: 1, gaps: 0 });

    const retry = pipeline.drain();
    state = database.getDashboardState();
    assert.equal(retry.inserted, 1);
    assert.equal(retry.gaps, 0, 'the already committed gap is not recorded twice');
    assert.equal(state.totals.results, 2);
    assert.equal(state.totals.incidents, 1);
    assert.equal(state.totals.invalidCycles, 1);
    assert.equal(state.activeCycle.id, 2);
  } finally {
    database.close();
  }
});

test('an explicit integrity gap blocks a terminal result until the gap commits', () => {
  const database = createDatabase({ path: ':memory:' });
  const previous = result(0, 14, 'explicit-gap-before');
  database.ingestBatch([previous]);
  let databaseRecovered = false;
  let atomicAttempts = 0;
  const flakyDatabase = {
    getLatestResult: (source, instrument) => database.getLatestResult(source, instrument),
    getDashboardState: () => database.getDashboardState(),
    markGap: (details) => database.markGap(details),
    ingestBatch: (events) => database.ingestBatch(events),
    ingestBatchAfterGap(details, events) {
      atomicAttempts += 1;
      if (!databaseRecovered) throw new Error('atomic write unavailable');
      return database.ingestBatchAfterGap(details, events);
    },
  };
  const pipeline = createPipeline(flakyDatabase);
  const terminalResult = result(600, 15, 'explicit-gap-terminal', {
    externalRoundId: '501',
  });
  const gap = {
    reason: 'round-result-not-confirmed-by-snapshot',
    detectedAt: new Date(BASE_TIME + 89_000).toISOString(),
    message: 'terminal result was not confirmed by a snapshot',
  };

  try {
    pipeline.enqueueIntegrityGap(gap);
    assert.deepEqual(pipeline.getPendingCounts(), { results: 0, gaps: 1 });

    assert.throws(
      () => pipeline.ingest([terminalResult]),
      /atomic write unavailable/,
    );
    assert.deepEqual(pipeline.getPendingCounts(), { results: 1, gaps: 1 });
    let state = database.getDashboardState();
    assert.equal(state.totals.incidents, 0);
    assert.equal(state.totals.results, 1);
    assert.equal(state.activeCycle.id, 1);
    assert.equal(state.activeCycle.eventCount, 1);

    databaseRecovered = true;
    const recovered = pipeline.drain();
    state = database.getDashboardState();

    assert.equal(atomicAttempts, 2);
    assert.deepEqual(recovered, {
      inserted: 1,
      gaps: 1,
      ignoredHistorical: 0,
      changed: true,
    });
    assert.deepEqual(pipeline.getPendingCounts(), { results: 0, gaps: 0 });
    assert.equal(state.totals.incidents, 1);
    assert.equal(state.totals.invalidCycles, 1);
    assert.equal(state.activeCycle.id, 2);
    assert.equal(state.activeCycle.eventCount, 1);
    assert.equal(state.latestResult.fingerprint, terminalResult.fingerprint);
  } finally {
    database.close();
  }
});

test('an explicit leading gap only suppresses the first automatic boundary', () => {
  const database = createDatabase({ path: ':memory:' });
  database.ingestBatch([result(0, 1, 'multi-gap-before')]);
  const pipeline = createPipeline(database);
  const firstAfterGap = result(600, 2, 'multi-gap-first');
  const secondAfterGap = result(1_200, 3, 'multi-gap-second');

  try {
    pipeline.enqueueIntegrityGap({
      reason: 'round-result-not-confirmed-by-snapshot',
      detectedAt: new Date(BASE_TIME + 599_000).toISOString(),
      message: 'explicit boundary',
    });
    const outcome = pipeline.ingest([firstAfterGap, secondAfterGap]);
    const state = database.getDashboardState();
    const recent = database.getRecentResults(2);

    assert.equal(outcome.gaps, 2);
    assert.equal(state.totals.incidents, 2);
    assert.equal(state.totals.invalidCycles, 2);
    assert.equal(state.activeCycle.id, 3);
    assert.equal(state.activeCycle.eventCount, 1);
    assert.equal(recent[0].fingerprint, secondAfterGap.fingerprint);
    assert.equal(recent[0].cycleId, 3);
    assert.equal(recent[1].fingerprint, firstAfterGap.fingerprint);
    assert.equal(recent[1].cycleId, 2);
  } finally {
    database.close();
  }
});

test('a large unproven time gap invalidates the old cycle before ingesting the new result', () => {
  const database = createDatabase({ path: ':memory:' });
  const previous = result(0, 3, 'before-gap', { externalRoundId: '100' });
  database.ingestBatch([previous]);
  const pipeline = createPipeline(database);

  try {
    const next = result(600, 4, 'after-gap', { externalRoundId: '105' });
    const outcome = pipeline.ingest([next]);
    const state = database.getDashboardState();

    assert.equal(outcome.inserted, 1);
    assert.equal(outcome.gaps, 1);
    assert.equal(outcome.changed, true);
    assert.equal(state.totals.results, 2);
    assert.equal(state.totals.incidents, 1);
    assert.equal(state.totals.invalidCycles, 1);
    assert.equal(state.totals.cycles, 2);
    assert.equal(state.activeCycle.id, 2);
    assert.equal(state.activeCycle.eventCount, 1);
    assert.equal(state.latestResult.fingerprint, next.fingerprint);
    assert.deepEqual(
      {
        from: state.recentIncidents[0].details.from,
        to: state.recentIncidents[0].details.to,
        gapSeconds: state.recentIncidents[0].details.gapSeconds,
      },
      {
        from: previous.settledAt,
        to: next.settledAt,
        gapSeconds: 600,
      },
    );
  } finally {
    database.close();
  }
});

test('snapshot adjacency suppresses a gap even when adjacent timestamps are far apart', () => {
  const database = createDatabase({ path: ':memory:' });
  const pipeline = createPipeline(database);
  const first = result(0, 10, 'snapshot-1');
  const second = result(600, 11, 'snapshot-2', {
    snapshotAdjacent: true,
    previousFingerprint: first.fingerprint,
  });
  const third = result(1_200, 12, 'snapshot-3', {
    snapshotAdjacent: true,
    previousFingerprint: second.fingerprint,
  });

  try {
    const outcome = pipeline.ingest([third, first, second]);
    const state = database.getDashboardState();

    assert.equal(outcome.inserted, 3);
    assert.equal(outcome.gaps, 0);
    assert.equal(state.totals.incidents, 0);
    assert.equal(state.totals.cycles, 1);
    assert.equal(state.activeCycle.eventCount, 3);
    assert.equal(state.latestResult.fingerprint, third.fingerprint);
  } finally {
    database.close();
  }
});

test('unknown bootstrap prehistory is ignored without creating an integrity gap', () => {
  const database = createDatabase({ path: ':memory:' });
  const current = result(300, 20, 'current');
  database.ingestBatch([current]);
  const warnings = [];
  const pipeline = createPipeline(database, {
    logger: { warn: (message) => warnings.push(message) },
  });
  const historical = result(0, 19, 'historical');

  try {
    const firstAttempt = pipeline.ingest([historical]);
    assert.deepEqual(firstAttempt, {
      inserted: 0,
      gaps: 0,
      ignoredHistorical: 1,
      changed: false,
    });
    assert.equal(database.getDashboardState().totals.results, 1);
    assert.equal(database.getDashboardState().activeCycle.eventCount, 1);
    assert.equal(database.getDashboardState().totals.incidents, 0);
    assert.equal(warnings.length, 1);

    const secondAttempt = pipeline.ingest([historical]);
    assert.deepEqual(secondAttempt, {
      inserted: 0,
      gaps: 0,
      ignoredHistorical: 0,
      changed: false,
    });
    assert.equal(database.getDashboardState().totals.results, 1);
    assert.equal(database.getDashboardState().totals.incidents, 0);
    assert.equal(warnings.length, 1);
  } finally {
    database.close();
  }
});

test('known restart snapshot rows are enriched or ignored without a gap', () => {
  const database = createDatabase({ path: ':memory:' });
  const first = result(100, 4, 'restart-known-first');
  const latest = result(200, 5, 'restart-known-latest');
  database.ingestBatch([first, latest]);
  const pipeline = createPipeline(database);
  const richerFirst = {
    ...first,
    externalRoundId: 'restart-round-100',
    rawPayload: { ...first.rawPayload, id: 'restart-round-100' },
  };

  try {
    const outcome = pipeline.ingest([latest, richerFirst]);
    assert.deepEqual(outcome, {
      inserted: 0,
      gaps: 0,
      ignoredHistorical: 2,
      changed: true,
    });
    const state = database.getDashboardState();
    assert.equal(state.totals.results, 2);
    assert.equal(state.totals.incidents, 0);
    assert.equal(state.totals.invalidCycles, 0);
    assert.equal(
      database.getRecentResults(2).find((item) => item.fingerprint === first.fingerprint)
        .externalRoundId,
      'restart-round-100',
    );
  } finally {
    database.close();
  }
});

test('an explicit leading gap subsumes covered historical anomalies', () => {
  const database = createDatabase({ path: ':memory:' });
  database.ingestBatch([
    result(100, 4, 'explicit-history-first'),
    result(200, 5, 'explicit-history-latest'),
  ]);
  const pipeline = createPipeline(database);
  const missing = result(150, 8, 'explicit-history-missing');
  const forward = result(201, 9, 'explicit-history-forward');

  try {
    pipeline.enqueueIntegrityGap({
      reason: 'authoritative-collector-gap',
      incidentKey: 'authoritative-history-gap',
      detectedAt: new Date(BASE_TIME + 200_500).toISOString(),
      message: 'authoritative gap already covers the boundary',
    });
    const outcome = pipeline.ingest([missing, forward]);
    const state = database.getDashboardState();

    assert.deepEqual(outcome, {
      inserted: 1,
      gaps: 1,
      ignoredHistorical: 1,
      changed: true,
    });
    assert.equal(state.totals.incidents, 1);
    assert.equal(state.totals.invalidCycles, 1);
    assert.equal(state.latestResult.fingerprint, forward.fingerprint);
    assert.equal(state.recentIncidents[0].incidentKey, 'authoritative-history-gap');
    assert.equal(
      state.recentIncidents[0].details.reason,
      'authoritative-collector-gap',
    );
  } finally {
    database.close();
  }
});

test('unknown history inside current coverage creates one gap and invalidates paper betting', () => {
  const database = createDatabase({ path: ':memory:' });
  seedActiveVirtualSession(database, 'late-covered');
  const pipeline = createPipeline(database);
  const missing = result(100.5, 9, 'late-covered-missing');

  try {
    const outcome = pipeline.ingest([missing]);
    assert.deepEqual(outcome, {
      inserted: 0,
      gaps: 1,
      ignoredHistorical: 1,
      changed: true,
    });
    let state = database.getDashboardState();
    let virtual = database.getVirtualBettorState(SOURCE, INSTRUMENT);
    assert.equal(state.totals.results, 201);
    assert.equal(state.totals.incidents, 1);
    assert.equal(state.totals.invalidCycles, 1);
    assert.equal(state.activeCycle, null);
    assert.equal(virtual.status, 'waiting');
    assert.equal(virtual.activeSession, null);
    assert.equal(virtual.recentSessions[0].status, 'invalid_gap');
    assert.equal(virtual.recentSessions[0].attemptCount, 1);

    const restarted = createPipeline(database);
    const duplicateDiscovery = restarted.ingest([missing]);
    state = database.getDashboardState();
    virtual = database.getVirtualBettorState(SOURCE, INSTRUMENT);
    assert.deepEqual(duplicateDiscovery, {
      inserted: 0,
      gaps: 0,
      ignoredHistorical: 1,
      changed: false,
    });
    assert.equal(state.totals.incidents, 1);
    assert.equal(state.totals.invalidCycles, 1);
    assert.equal(virtual.lifetime.invalidatedSessions, 1);
  } finally {
    database.close();
  }
});

test('covered unknown history and the next forward result retry as one atomic operation', () => {
  const database = createDatabase({ path: ':memory:' });
  seedActiveVirtualSession(database, 'late-atomic');
  const pipeline = createPipeline(database);
  const missing = result(100.5, 9, 'late-atomic-missing');
  const forward = result(201, 2, 'late-atomic-forward');
  database.sqlite.exec(`
    CREATE TRIGGER fail_late_history_forward
    BEFORE INSERT ON round_results
    WHEN NEW.fingerprint = '${forward.fingerprint}'
    BEGIN
      SELECT RAISE(ABORT, 'forced late-history forward failure');
    END;
  `);

  try {
    assert.throws(
      () => pipeline.ingest([forward, missing]),
      /forced late-history forward failure/,
    );
    let state = database.getDashboardState();
    let virtual = database.getVirtualBettorState(SOURCE, INSTRUMENT);
    assert.deepEqual(pipeline.getPendingCounts(), { results: 2, gaps: 0 });
    assert.equal(state.totals.results, 201);
    assert.equal(state.totals.incidents, 0);
    assert.equal(state.totals.invalidCycles, 0);
    assert.equal(virtual.status, 'active');
    assert.equal(virtual.activeSession.attemptCount, 1);
    assert.equal(
      Number(database.sqlite.prepare('SELECT COUNT(*) AS count FROM virtual_bets').get().count),
      1,
    );

    database.sqlite.exec('DROP TRIGGER fail_late_history_forward');
    const retried = pipeline.drain();
    state = database.getDashboardState();
    virtual = database.getVirtualBettorState(SOURCE, INSTRUMENT);
    assert.deepEqual(retried, {
      inserted: 1,
      gaps: 1,
      ignoredHistorical: 1,
      changed: true,
    });
    assert.deepEqual(pipeline.getPendingCounts(), { results: 0, gaps: 0 });
    assert.equal(state.totals.results, 202);
    assert.equal(state.totals.incidents, 1);
    assert.equal(state.totals.invalidCycles, 1);
    assert.equal(state.latestResult.fingerprint, forward.fingerprint);
    assert.equal(state.activeCycle.eventCount, 1);
    assert.equal(virtual.status, 'waiting');
    assert.equal(virtual.recentSessions[0].status, 'invalid_gap');
    assert.equal(virtual.recentSessions[0].attemptCount, 1);
    assert.equal(
      Number(database.sqlite.prepare('SELECT COUNT(*) AS count FROM virtual_bets').get().count),
      1,
      'the forward row must not settle the invalidated session',
    );

    const restarted = createPipeline(database);
    const replay = restarted.ingest([missing, forward]);
    assert.deepEqual(replay, {
      inserted: 0,
      gaps: 0,
      ignoredHistorical: 2,
      changed: false,
    });
    assert.equal(database.getDashboardState().totals.incidents, 1);
  } finally {
    database.close();
  }
});
