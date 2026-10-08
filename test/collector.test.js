import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BuletoCollector,
  ROUND_TRAJECTORY_SCHEMA_VERSION,
  canonicalRouletteNumber,
  normalizeLastResults,
  normalizeWireResult,
} from '../src/collector.js';

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

const quietLogger = { info() {}, warn() {}, error() {} };

function forecastCells() {
  return Array.from({ length: 38 }, (_, wireCell) => ({
    c: wireCell,
    vt: 38 - wireCell,
    vf: 37 - wireCell,
  }));
}

function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function forecastRound({ id, bettingClosesAtMs, result } = {}) {
  const round = {
    id,
    s: 2,
    bcd: iso(bettingClosesAtMs),
    ed: iso(bettingClosesAtMs + 40_000),
    sv: 20,
    cls: forecastCells(),
  };
  if (result !== undefined) round.rr = result;
  return round;
}

function trajectoryRound({
  id,
  baseMs,
  startsAtMs = baseMs - 20_000,
  bettingClosesAtMs = baseMs + 30_000,
  status = 2,
  result,
} = {}) {
  const round = {
    id,
    s: status,
    sd: iso(startsAtMs),
    bcd: iso(bettingClosesAtMs),
    btd: iso(bettingClosesAtMs + 10_000),
    ed: iso(bettingClosesAtMs + 40_000),
    sv: 20,
    bv: 1,
    tv: 37,
    cls: forecastCells().map((cell) => ({ ...cell, vendorCellField: 'ignored' })),
    vendorRoundField: 'ignored',
  };
  if (result !== undefined) round.rr = result;
  return round;
}

function startFakeCollector(t) {
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;
  t.after(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  const collector = new BuletoCollector({
    url: 'ws://example.test/ws',
    connectionTimeoutMs: 10_000,
    initialSnapshotTimeoutMs: 10_000,
    resultSnapshotTimeoutMs: 10_000,
    logger: quietLogger,
  });
  t.after(() => collector.stop());
  collector.start();
  const socket = FakeWebSocket.instances[0];
  socket.open();
  return { collector, socket };
}

test('Buleto wire cell 37 maps to roulette zero', () => {
  assert.equal(canonicalRouletteNumber(37), 0);
  assert.equal(canonicalRouletteNumber(0), 0);
  assert.equal(canonicalRouletteNumber(36), 36);
  assert.throws(() => canonicalRouletteNumber(38), RangeError);
  assert.throws(() => canonicalRouletteNumber(2.5), RangeError);
  assert.throws(() => canonicalRouletteNumber(null), TypeError);
  assert.throws(() => canonicalRouletteNumber('  '), TypeError);
  assert.throws(() => canonicalRouletteNumber(false), TypeError);
});

test('empty or null price is rejected instead of becoming zero', () => {
  const base = { dt: '2026-09-20T20:04:29Z', c: 1 };
  assert.throws(() => normalizeWireResult({ ...base, v: null }), TypeError);
  assert.throws(() => normalizeWireResult({ ...base, v: '' }), TypeError);
});

test('equivalent numeric price formats deduplicate', () => {
  const base = { dt: '2026-09-20T20:04:29Z', c: 1 };
  assert.equal(
    normalizeWireResult({ ...base, v: 5.4 }).fingerprint,
    normalizeWireResult({ ...base, v: '5.40000' }).fingerprint,
  );
});

test('wire result is normalized without losing its raw payload', () => {
  const result = normalizeWireResult(
    { dt: '2026-09-20T20:04:29Z', c: 37, v: 5.40398 },
    { observedAt: new Date('2026-09-20T20:04:30Z'), externalRoundId: 4_085_880 },
  );

  assert.equal(result.resultNumber, 0);
  assert.equal(result.externalRoundId, 4_085_880);
  assert.equal(result.price, '5.40398');
  assert.equal(result.settledAt, '2026-09-20T20:04:29.000Z');
  assert.equal(result.observedAt, '2026-09-20T20:04:30.000Z');
  assert.equal(result.rawPayload.c, 37);
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
});

test('last-results snapshot is ordered oldest first', () => {
  const results = normalizeLastResults(
    [
      { dt: '2026-09-20T20:02:58Z', c: 11, v: 5.42642 },
      { dt: '2026-09-20T20:01:28Z', c: 9, v: 5.43053 },
    ],
    { observedAt: new Date('2026-09-20T20:03:00Z') },
  );

  assert.deepEqual(
    results.map((result) => result.resultNumber),
    [9, 11],
  );
});

test('same settled result has same fingerprint with or without round id', () => {
  const fromSnapshot = normalizeWireResult({
    dt: '2026-09-20T20:04:29Z',
    c: 23,
    v: 5.40398,
  });
  const fromRound = normalizeWireResult(
    { dt: '2026-09-20T20:04:29.6540391Z', c: 23, v: 5.40398 },
    { externalRoundId: 123 },
  );
  assert.equal(fromSnapshot.fingerprint, fromRound.fingerprint);
});

test('collector emits a whitelisted round trajectory and associates cached factors by time', (t) => {
  const { collector, socket } = startFakeCollector(t);
  const trajectories = [];
  collector.on('round-trajectory', (trajectory) => trajectories.push(trajectory));

  const baseMs = Date.now();
  const firstAt = iso(baseMs - 8_000);
  const secondAt = iso(baseMs - 3_000);
  socket.message({
    type: 'factors',
    data: [
      { dt: iso(baseMs - 25_000), v: 18, vendorFactorField: 'ignored' },
      { dt: firstAt, v: 19.5, vendorFactorField: 'ignored' },
      { dt: firstAt, v: 19.5, duplicate: true },
      { dt: secondAt, v: 20 },
      { dt: iso(baseMs + 2_000), v: 999_999 },
      { dt: iso(baseMs - 1_000), v: '20.1' },
    ],
  });
  socket.message({
    type: 'round',
    data: trajectoryRound({ id: 601, baseMs }),
  });

  assert.equal(trajectories.length, 1);
  const trajectory = trajectories[0];
  assert.equal(trajectory.schemaVersion, ROUND_TRAJECTORY_SCHEMA_VERSION);
  assert.deepEqual(Object.keys(trajectory).sort(), [
    'factors',
    'instrument',
    'receivedAt',
    'round',
    'schemaVersion',
    'source',
  ]);
  assert.deepEqual(Object.keys(trajectory.round).sort(), [
    'bettingClosesAt',
    'bettingStopsAt',
    'bottomPrice',
    'cellBands',
    'endsAt',
    'externalRoundId',
    'startPrice',
    'startsAt',
    'status',
    'topPrice',
  ]);
  assert.deepEqual(
    {
      externalRoundId: trajectory.round.externalRoundId,
      status: trajectory.round.status,
      startPrice: trajectory.round.startPrice,
      bottomPrice: trajectory.round.bottomPrice,
      topPrice: trajectory.round.topPrice,
    },
    {
      externalRoundId: '601',
      status: 2,
      startPrice: 20,
      bottomPrice: 1,
      topPrice: 37,
    },
  );
  assert.equal(trajectory.round.cellBands.length, 38);
  assert.deepEqual(trajectory.round.cellBands[0], {
    wireCell: 0,
    number: 0,
    lower: 37,
    upper: 38,
  });
  assert.deepEqual(trajectory.round.cellBands[37], {
    wireCell: 37,
    number: 0,
    lower: 0,
    upper: 1,
  });
  assert.deepEqual(
    trajectory.factors.map(({ at, price }) => ({ at, price })),
    [
      { at: firstAt, price: 19.5 },
      { at: secondAt, price: 20 },
    ],
  );
  for (const factor of trajectory.factors) {
    assert.deepEqual(Object.keys(factor).sort(), ['at', 'price', 'receivedAt']);
    assert.ok(Date.parse(factor.at) <= Date.parse(factor.receivedAt));
  }
  assert.equal('vendorRoundField' in trajectory.round, false);
  assert.equal('vendorCellField' in trajectory.round.cellBands[0], false);
  assert.equal('vendorFactorField' in trajectory.factors[0], false);
});

test('round trajectory emits only new exact observations and never leaks across closed rounds', (t) => {
  const { collector, socket } = startFakeCollector(t);
  const trajectories = [];
  collector.on('round-trajectory', (trajectory) => trajectories.push(trajectory));

  const baseMs = Date.now();
  const repeatedAt = iso(baseMs - 8_000);
  const nextAt = iso(baseMs - 4_000);
  socket.message({ type: 'round', data: trajectoryRound({ id: 701, baseMs }) });
  socket.message({
    type: 'factors',
    data: [{ dt: repeatedAt, v: 19.5 }],
  });
  socket.message({
    type: 'factors',
    data: [
      { dt: repeatedAt, v: 19.5 },
      { dt: repeatedAt, v: 19.6 },
      { dt: nextAt, v: 20 },
    ],
  });

  assert.deepEqual(
    trajectories.map((trajectory) => trajectory.factors.map(({ at, price }) => ({ at, price }))),
    [
      [],
      [{ at: repeatedAt, price: 19.5 }],
      [
        { at: repeatedAt, price: 19.6 },
        { at: nextAt, price: 20 },
      ],
    ],
  );

  socket.message({
    type: 'round',
    data: trajectoryRound({ id: 701, baseMs, result: null }),
  });
  socket.message({ type: 'factors', data: [{ dt: iso(baseMs - 2_000), v: 20.2 }] });
  assert.equal(trajectories.length, 3, 'rr presence closes capture even when rr is null');

  const secondStartMs = baseMs - 5_000;
  const beforeSecondRound = iso(baseMs - 8_000);
  const insideSecondRound = iso(baseMs - 2_000);
  socket.message({
    type: 'round',
    data: trajectoryRound({ id: 702, baseMs, startsAtMs: secondStartMs, status: 4 }),
  });
  socket.message({
    type: 'factors',
    data: [
      { dt: beforeSecondRound, v: 19.8 },
      { dt: insideSecondRound, v: 20.1 },
    ],
  });
  socket.message({
    type: 'round',
    data: trajectoryRound({ id: 702, baseMs, startsAtMs: secondStartMs }),
  });

  assert.equal(trajectories.length, 4);
  assert.equal(trajectories[3].round.externalRoundId, '702');
  assert.deepEqual(
    trajectories[3].factors.map(({ at, price }) => ({ at, price })),
    [{ at: insideSecondRound, price: 20.1 }],
  );
});

test('same-message trajectory always precedes pre-close forecast for both wire orders', (t) => {
  const { collector, socket } = startFakeCollector(t);
  const order = [];
  collector.on('round-trajectory', (trajectory) => {
    order.push({ type: 'trajectory', roundId: trajectory.round.externalRoundId });
  });
  collector.on('preclose-forecast', (forecast) => {
    order.push({ type: 'forecast', roundId: forecast.round.externalRoundId });
  });

  const baseMs = Date.now() - 250;
  const bettingClosesAtMs = baseMs + 9_250;
  const factors = [
    { dt: iso(baseMs - 4_000), v: 19.6 },
    { dt: iso(baseMs - 2_000), v: 19.8 },
    { dt: iso(baseMs), v: 20 },
  ];

  socket.message({
    type: 'round',
    data: trajectoryRound({ id: 801, baseMs, bettingClosesAtMs }),
  });
  order.length = 0;
  socket.message({ type: 'factors', data: factors });
  assert.deepEqual(order, [
    { type: 'trajectory', roundId: '801' },
    { type: 'forecast', roundId: '801' },
  ]);

  socket.message({
    type: 'round',
    data: trajectoryRound({ id: 801, baseMs, bettingClosesAtMs, result: null }),
  });
  order.length = 0;
  socket.message({ type: 'factors', data: factors });
  assert.deepEqual(order, [], 'factors wait while there is no trusted open round');
  socket.message({
    type: 'round',
    data: trajectoryRound({ id: 802, baseMs, bettingClosesAtMs }),
  });
  assert.deepEqual(order, [
    { type: 'trajectory', roundId: '802' },
    { type: 'forecast', roundId: '802' },
  ]);
});

test('collector emits a pre-close forecast in the safe window and ignores future factors', (t) => {
  const { collector, socket } = startFakeCollector(t);
  const forecasts = [];
  const errors = [];
  collector.on('preclose-forecast', (forecast) => forecasts.push(forecast));
  collector.on('collector-error', (error) => errors.push(error));

  // Keep the received message near nine seconds before bcd, comfortably inside
  // the inclusive 8-10 second lock window without replacing the global clock.
  const factorBaseMs = Date.now() - 250;
  socket.message({
    type: 'round',
    data: forecastRound({ id: 501, bettingClosesAtMs: factorBaseMs + 9_250 }),
  });
  socket.message({
    type: 'factors',
    data: [
      { dt: iso(factorBaseMs - 4_000), v: 19.6 },
      { dt: iso(factorBaseMs - 2_000), v: 19.8 },
      { dt: iso(factorBaseMs), v: 20 },
      { dt: iso(factorBaseMs + 2_000), v: 999_999 },
    ],
  });

  assert.equal(errors.length, 0);
  assert.equal(forecasts.length, 1);
  assert.equal(forecasts[0].round.externalRoundId, '501');
  assert.ok(forecasts[0].features.leadTimeMs >= 8_000);
  assert.ok(forecasts[0].features.leadTimeMs <= 10_000);
  assert.equal(forecasts[0].features.factorCount, 3);
  assert.equal(forecasts[0].features.latestPrice, 20);
  assert.equal(forecasts[0].modelVersion, 'start-price-v2');
  assert.equal(forecasts[0].features.projectedPrice, 20);
  assert.equal(forecasts[0].prediction.basis, 'start_price');
  assert.equal(
    forecasts[0].features.shadow.modelVersion,
    'linear-trend-12s-to-ed-v1',
  );
  assert.notEqual(
    forecasts[0].features.shadow.projectedPrice,
    forecasts[0].features.projectedPrice,
  );
  assert.equal(
    forecasts[0].features.factorPoints.some((point) => point.price === 999_999),
    false,
  );
});

test('collector does not emit a forecast after betting is closed', (t) => {
  const { collector, socket } = startFakeCollector(t);
  const forecasts = [];
  collector.on('preclose-forecast', (forecast) => forecasts.push(forecast));

  const factorBaseMs = Date.now() - 250;
  socket.message({
    type: 'round',
    data: forecastRound({ id: 502, bettingClosesAtMs: factorBaseMs - 1_000 }),
  });
  socket.message({
    type: 'factors',
    data: [
      { dt: iso(factorBaseMs - 4_000), v: 19.6 },
      { dt: iso(factorBaseMs - 2_000), v: 19.8 },
      { dt: iso(factorBaseMs), v: 20 },
    ],
  });

  assert.equal(forecasts.length, 0);
});

test('collector does not emit a forecast when upstream status is closed', (t) => {
  const { collector, socket } = startFakeCollector(t);
  const forecasts = [];
  collector.on('preclose-forecast', (forecast) => forecasts.push(forecast));

  const factorBaseMs = Date.now() - 250;
  const closedRound = forecastRound({
    id: 504,
    bettingClosesAtMs: factorBaseMs + 9_250,
  });
  closedRound.s = 4;
  socket.message({ type: 'round', data: closedRound });
  socket.message({
    type: 'factors',
    data: [
      { dt: iso(factorBaseMs - 4_000), v: 19.6 },
      { dt: iso(factorBaseMs - 2_000), v: 19.8 },
      { dt: iso(factorBaseMs), v: 20 },
    ],
  });

  assert.equal(forecasts.length, 0);
});

test('collector never derives a forecast from a final round carrying rr', (t) => {
  const { collector, socket } = startFakeCollector(t);
  const forecasts = [];
  collector.on('preclose-forecast', (forecast) => forecasts.push(forecast));

  const factorBaseMs = Date.now() - 250;
  socket.message({
    type: 'round',
    data: forecastRound({
      id: 503,
      bettingClosesAtMs: factorBaseMs + 9_250,
      result: { dt: iso(factorBaseMs), c: 3, v: 20 },
    }),
  });
  socket.message({
    type: 'factors',
    data: [
      { dt: iso(factorBaseMs - 4_000), v: 19.6 },
      { dt: iso(factorBaseMs - 2_000), v: 19.8 },
      { dt: iso(factorBaseMs), v: 20 },
    ],
  });

  assert.equal(forecasts.length, 0);
});

test('round result waits for matching snapshot and is emitted in chronological order', (t) => {
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;
  t.after(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  const collector = new BuletoCollector({
    url: 'ws://example.test/ws',
    connectionTimeoutMs: 10_000,
    initialSnapshotTimeoutMs: 10_000,
    resultSnapshotTimeoutMs: 10_000,
    logger: quietLogger,
  });
  t.after(() => collector.stop());

  const batches = [];
  collector.on('results', (batch) => batches.push(batch));
  collector.start();
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.message({
    type: 'round',
    data: {
      id: 103,
      s: 5,
      rr: { dt: '2026-09-20T20:03:00.6540391Z', c: 3, v: 5.3 },
    },
  });
  assert.equal(batches.length, 0, 'round.rr must stay staged before snapshot');

  const snapshot = {
    type: 'last-results',
    data: [
      { dt: '2026-09-20T20:03:00Z', c: 3, v: '5.30000' },
      { dt: '2026-09-20T20:02:00Z', c: 2, v: 5.2 },
      { dt: '2026-09-20T20:01:00Z', c: 1, v: 5.1 },
    ],
  };
  socket.message(snapshot);

  assert.equal(batches.length, 1);
  assert.deepEqual(
    batches[0].map((result) => result.resultNumber),
    [1, 2, 3],
  );
  assert.equal(batches[0][2].externalRoundId, 103);
  assert.equal(batches[0][2].previousFingerprint, batches[0][1].fingerprint);

  socket.message(snapshot);
  assert.equal(
    batches.length,
    2,
    'snapshot stays at-least-once so persistence can retry after a transient failure',
  );
});

test('pending round survives reconnect until a matching snapshot', async (t) => {
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;
  t.after(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  const collector = new BuletoCollector({
    url: 'ws://example.test/ws',
    reconnectMinMs: 1,
    reconnectMaxMs: 1,
    connectionTimeoutMs: 10_000,
    initialSnapshotTimeoutMs: 10_000,
    resultSnapshotTimeoutMs: 10_000,
    logger: quietLogger,
  });
  t.after(() => collector.stop());

  const batches = [];
  collector.on('results', (batch) => batches.push(batch));
  collector.start();
  const firstSocket = FakeWebSocket.instances[0];
  firstSocket.open();
  firstSocket.message({
    type: 'round',
    data: {
      id: 203,
      s: 5,
      rr: { dt: '2026-09-20T20:03:00.9Z', c: 3, v: 5.3 },
    },
  });
  firstSocket.close(1006, 'network lost');

  await new Promise((resolve) => setTimeout(resolve, 10));
  const secondSocket = FakeWebSocket.instances[1];
  assert.ok(secondSocket, 'collector reconnects');
  secondSocket.open();
  secondSocket.message({
    type: 'last-results',
    data: [
      { dt: '2026-09-20T20:03:00Z', c: 3, v: 5.3 },
      { dt: '2026-09-20T20:02:00Z', c: 2, v: 5.2 },
      { dt: '2026-09-20T20:01:00Z', c: 1, v: 5.1 },
    ],
  });

  assert.equal(batches.length, 1);
  assert.equal(batches[0][2].externalRoundId, 203);
});

test('unmatched pending round reaches terminal gap policy instead of reconnecting forever', (t) => {
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;
  t.after(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  const collector = new BuletoCollector({
    url: 'ws://example.test/ws',
    connectionTimeoutMs: 10_000,
    initialSnapshotTimeoutMs: 10_000,
    resultSnapshotTimeoutMs: 10_000,
    maxUnmatchedSnapshots: 3,
    logger: quietLogger,
  });
  t.after(() => collector.stop());

  const batches = [];
  const gaps = [];
  collector.on('results', (batch) => batches.push(batch));
  collector.on('integrity-gap', (gap) => gaps.push(gap));
  collector.start();
  const socket = FakeWebSocket.instances[0];
  socket.open();

  const staleSnapshot = {
    type: 'last-results',
    data: [{ dt: '2026-09-20T20:01:00Z', c: 1, v: 5.1 }],
  };
  socket.message(staleSnapshot);
  socket.message({
    type: 'round',
    data: {
      id: 302,
      s: 5,
      rr: { dt: '2026-09-20T20:02:00Z', c: 2, v: 5.2 },
    },
  });
  socket.message(staleSnapshot);
  socket.message(staleSnapshot);
  socket.message(staleSnapshot);

  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].reason, 'round-result-not-confirmed-by-snapshot');
  assert.ok(
    batches.some((batch) => batch.some((result) => result.externalRoundId === 302)),
    'reliable round.rr is eventually emitted after marking a gap',
  );
});

test('graceful shutdown persists an unconfirmed round without marking a gap', (t) => {
  const originalWebSocket = globalThis.WebSocket;
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket;
  t.after(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  const collector = new BuletoCollector({
    url: 'ws://example.test/ws',
    connectionTimeoutMs: 10_000,
    initialSnapshotTimeoutMs: 10_000,
    resultSnapshotTimeoutMs: 10_000,
    logger: quietLogger,
  });
  t.after(() => collector.stop());

  const order = [];
  const batches = [];
  const gaps = [];
  collector.on('integrity-gap', (gap) => {
    gaps.push(gap);
    order.push('gap');
  });
  collector.on('results', (batch) => {
    order.push('results');
    batches.push(batch);
  });
  collector.start();
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.message({
    type: 'last-results',
    data: [{ dt: '2026-09-20T20:01:00Z', c: 1, v: 5.1 }],
  });
  order.length = 0;
  batches.length = 0;
  socket.message({
    type: 'round',
    data: {
      id: 402,
      s: 5,
      rr: { dt: '2026-09-20T20:02:00Z', c: 2, v: 5.2 },
    },
  });

  const outcome = collector.flushPendingForShutdown();
  assert.deepEqual(outcome, { flushed: 1, markedGap: false });
  assert.deepEqual(order, ['results']);
  assert.deepEqual(gaps, []);
  assert.equal(batches[0][0].externalRoundId, 402);
  assert.deepEqual(collector.flushPendingForShutdown(), {
    flushed: 0,
    markedGap: false,
  });
  assert.equal(batches.length, 1);
});
