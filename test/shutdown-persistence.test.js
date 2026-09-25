import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BuletoCollector } from '../src/collector.js';
import { createDatabase } from '../src/database.js';
import { ResultPipeline } from '../src/result-pipeline.js';

const SOURCE = 'buleto';
const INSTRUMENT = 'XPM/RUB';
const quietLogger = { info() {}, warn() {}, error() {} };

class FakeWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    super();
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  message(payload) {
    const event = new Event('message');
    Object.defineProperty(event, 'data', { value: JSON.stringify(payload) });
    this.dispatchEvent(event);
  }

  close(code = 1000, reason = '') {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    const event = new Event('close');
    Object.defineProperties(event, {
      code: { value: code },
      reason: { value: reason },
    });
    this.dispatchEvent(event);
  }
}

function startRuntime(database) {
  const pipeline = new ResultPipeline({
    db: database,
    source: SOURCE,
    instrument: INSTRUMENT,
    gapThresholdSeconds: 135,
    logger: quietLogger,
  });
  const collector = new BuletoCollector({
    url: 'ws://example.test/ws',
    source: SOURCE,
    instrument: INSTRUMENT,
    connectionTimeoutMs: 10_000,
    initialSnapshotTimeoutMs: 10_000,
    resultSnapshotTimeoutMs: 10_000,
    logger: quietLogger,
  });
  const gaps = [];
  const outcomes = [];

  collector.on('results', (results) => outcomes.push(pipeline.ingest(results)));
  collector.on('integrity-gap', (details) => {
    gaps.push(details);
    pipeline.enqueueIntegrityGap(details);
    outcomes.push(pipeline.drain());
  });
  collector.start();

  const socket = FakeWebSocket.instances.at(-1);
  assert.ok(socket, 'collector opens a websocket');
  socket.open();
  return { collector, pipeline, socket, gaps, outcomes };
}

function continuityEpochs(database) {
  return database.sqlite
    .prepare('SELECT continuity_epoch FROM round_results ORDER BY settled_at, id')
    .all()
    .map((row) => Number(row.continuity_epoch));
}

test('planned shutdown persists pending rr and restart snapshot resumes the same chain', () => {
  const originalWebSocket = globalThis.WebSocket;
  const directory = mkdtempSync(join(tmpdir(), 'roulette-shutdown-'));
  const databasePath = join(directory, 'roulette.sqlite');
  const firstResult = { dt: '2026-09-25T08:00:00Z', c: 31, v: 5.41 };
  const shutdownResult = { dt: '2026-09-25T08:01:30.654Z', c: 35, v: 5.42 };
  const nextResult = { dt: '2026-09-25T08:03:00.321Z', c: 7, v: 5.43 };
  let database;
  let runtime;

  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;

  try {
    database = createDatabase({ path: databasePath, logger: quietLogger });
    runtime = startRuntime(database);
    runtime.socket.message({ type: 'last-results', data: [firstResult] });
    runtime.socket.message({
      type: 'round',
      data: { id: 4_090_231, s: 5, rr: shutdownResult },
    });

    assert.equal(
      database.getDashboardState().totals.results,
      1,
      'round.rr remains pending until shutdown or snapshot confirmation',
    );
    assert.deepEqual(runtime.collector.flushPendingForShutdown(), {
      flushed: 1,
      markedGap: false,
    });
    runtime.collector.stop();

    const beforeRestart = database.getDashboardState();
    const originalCycleId = beforeRestart.activeCycle.id;
    assert.equal(beforeRestart.totals.results, 2);
    assert.equal(beforeRestart.totals.incidents, 0);
    assert.equal(beforeRestart.totals.invalidCycles, 0);
    assert.equal(beforeRestart.totals.cycles, 1);
    assert.equal(beforeRestart.activeCycle.eventCount, 2);
    assert.equal(Number(beforeRestart.latestResult.externalRoundId), 4_090_231);
    assert.deepEqual(continuityEpochs(database), [0, 0]);
    assert.deepEqual(runtime.gaps, []);
    assert.deepEqual(runtime.pipeline.getPendingCounts(), { results: 0, gaps: 0 });

    database.close();
    database = createDatabase({ path: databasePath, logger: quietLogger });
    runtime = startRuntime(database);
    runtime.socket.message({
      type: 'last-results',
      data: [shutdownResult, firstResult],
    });

    const afterDuplicateSnapshot = database.getDashboardState();
    assert.equal(runtime.outcomes.at(-1).inserted, 0);
    assert.equal(afterDuplicateSnapshot.totals.results, 2);
    assert.equal(afterDuplicateSnapshot.totals.incidents, 0);
    assert.equal(afterDuplicateSnapshot.totals.invalidCycles, 0);
    assert.equal(afterDuplicateSnapshot.totals.cycles, 1);
    assert.equal(afterDuplicateSnapshot.activeCycle.id, originalCycleId);
    assert.equal(afterDuplicateSnapshot.activeCycle.eventCount, 2);
    assert.equal(Number(afterDuplicateSnapshot.latestResult.externalRoundId), 4_090_231);
    assert.deepEqual(continuityEpochs(database), [0, 0]);
    assert.equal(
      database.sqlite.prepare('SELECT COUNT(*) AS count FROM cycle_events').get().count,
      2,
    );

    runtime.socket.message({
      type: 'round',
      data: { id: 4_090_232, s: 5, rr: nextResult },
    });
    runtime.socket.message({
      type: 'last-results',
      data: [nextResult, shutdownResult, firstResult],
    });

    const resumed = database.getDashboardState();
    assert.equal(resumed.totals.results, 3);
    assert.equal(resumed.totals.incidents, 0);
    assert.equal(resumed.totals.invalidCycles, 0);
    assert.equal(resumed.totals.cycles, 1);
    assert.equal(resumed.activeCycle.id, originalCycleId);
    assert.equal(resumed.activeCycle.eventCount, 3);
    assert.deepEqual(continuityEpochs(database), [0, 0, 0]);
    assert.deepEqual(runtime.gaps, []);
  } finally {
    runtime?.collector.stop();
    database?.close();
    globalThis.WebSocket = originalWebSocket;
    rmSync(directory, { recursive: true, force: true });
  }
});
