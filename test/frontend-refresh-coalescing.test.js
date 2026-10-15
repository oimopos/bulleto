import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

function functionSource(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);

  const bodyStart = app.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < app.length; index += 1) {
    if (app[index] === "{") depth += 1;
    if (app[index] === "}") depth -= 1;
    if (depth === 0) return app.slice(start, index + 1);
  }

  throw new Error(`Could not find the end of ${name}`);
}

function createClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();

  function setTimeout(callback, delay) {
    const id = nextId;
    nextId += 1;
    timers.set(id, { callback, dueAt: now + delay });
    return id;
  }

  function clearTimeout(id) {
    timers.delete(id);
  }

  function tick(milliseconds) {
    const target = now + milliseconds;
    while (true) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0])[0];
      if (!due) break;
      const [id, timer] = due;
      timers.delete(id);
      now = timer.dueAt;
      timer.callback();
    }
    now = target;
  }

  return { clearTimeout, now: () => now, setTimeout, tick };
}

function refreshHarness() {
  const clock = createClock();
  const store = { refreshQueued: false, refreshing: false, refreshTimer: null };
  let completedRefreshes = 0;

  function refreshAll() {
    if (store.refreshing) {
      store.refreshQueued = true;
      return;
    }
    completedRefreshes += 1;
  }

  const build = new Function(
    "window",
    "store",
    "refreshAll",
    "REFRESH_DEBOUNCE_MS",
    `${functionSource("scheduleRefresh")}\n${functionSource("scheduleQueuedRefresh")}\n`
      + "return { scheduleRefresh, scheduleQueuedRefresh };",
  );
  const scheduler = build(clock, store, refreshAll, 180);

  return {
    clock,
    scheduler,
    store,
    completedRefreshes: () => completedRefreshes,
  };
}

function predictiveLeaderHarness() {
  const blockStart = app.indexOf("  function startPredictiveLeaderRequest() {");
  const blockEnd = app.indexOf("\n\n  function extractItems", blockStart);
  assert.ok(blockStart >= 0 && blockEnd > blockStart);

  const pending = [];
  const renders = [];
  const clock = createClock();
  const fakeWindow = {
    clearTimeout: clock.clearTimeout,
    performance: { now: clock.now },
    setTimeout: clock.setTimeout,
  };
  const store = {
    refreshing: true,
    predictiveLeaderSnapshot: null,
    predictiveLeaderLoaded: false,
    predictiveLeaderError: false,
    predictiveLeaderRequiresFreshSnapshot: false,
    predictiveLeaderRequestId: 0,
    predictiveLeaderRefreshPromise: null,
    predictiveLeaderExpiryTimer: null,
    predictiveLeaderExpiresAt: null,
    lastSyncAt: null,
  };
  const build = new Function(
    "window",
    "store",
    "fetchJson",
    "normalizePredictiveLeaderApiSnapshot",
    "normalizedPredictiveLeaderAccount",
    "normalizedPredictiveLeaderSignalAccount",
    "captureServerClock",
    "renderCombinedPick",
    "renderPredictiveLeaderSignalAccount",
    "updateLastSync",
    `"use strict"; ${app.slice(blockStart, blockEnd)};`
      + " return { invalidatePredictiveLeaderBet, refreshPredictiveLeader };",
  );
  const { invalidatePredictiveLeaderBet, refreshPredictiveLeader } = build(
    fakeWindow,
    store,
    (url) => {
      assert.equal(url, "/api/predictive-leader");
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
    (payload) => payload,
    (account) => account,
    (account) => account,
    () => {},
    () => {
      renders.push(store.predictiveLeaderRequiresFreshSnapshot
        ? "hidden"
        : store.predictiveLeaderSnapshot?.marker ?? null);
    },
    () => {},
    () => {},
  );

  return {
    clock,
    invalidatePredictiveLeaderBet,
    pending,
    refreshPredictiveLeader,
    renders,
    store,
  };
}

function leaderPayload(marker, overrides = {}) {
  return {
    marker,
    status: "waiting",
    action: "WAIT",
    account: null,
    signalAccount: { marker },
    serverTime: "2026-10-15T12:00:00.000Z",
    ...overrides,
  };
}

test("SSE refresh bursts use one trailing-edge refresh", () => {
  const harness = refreshHarness();

  harness.scheduler.scheduleRefresh();
  harness.clock.tick(100);
  harness.scheduler.scheduleRefresh();
  harness.clock.tick(100);
  harness.scheduler.scheduleRefresh();
  harness.clock.tick(179);

  assert.equal(harness.completedRefreshes(), 0);
  harness.clock.tick(1);
  assert.equal(harness.completedRefreshes(), 1);
  assert.equal(harness.store.refreshTimer, null);
});

test("events received during a timed-out refresh coalesce into one delayed retry", () => {
  const harness = refreshHarness();
  harness.store.refreshing = true;

  harness.scheduler.scheduleRefresh();
  harness.clock.tick(180);
  assert.equal(harness.store.refreshQueued, true);

  harness.scheduler.scheduleRefresh();
  harness.clock.tick(5_000);
  harness.scheduler.scheduleRefresh();
  harness.clock.tick(6_820);

  assert.equal(harness.completedRefreshes(), 0, "no request may overlap the active request");
  assert.equal(harness.store.refreshQueued, true, "the whole burst is represented by one boolean");

  harness.store.refreshing = false;
  harness.scheduler.scheduleQueuedRefresh();
  assert.equal(harness.store.refreshQueued, false);
  assert.equal(harness.completedRefreshes(), 0, "the retry must not start immediately after timeout");

  harness.clock.tick(179);
  assert.equal(harness.completedRefreshes(), 0);
  harness.clock.tick(1);
  assert.equal(harness.completedRefreshes(), 1);
  harness.clock.tick(1_000);
  assert.equal(harness.completedRefreshes(), 1, "one burst must produce at most one trailing retry");
});

test("an explicit refresh supersedes a pending SSE timer", () => {
  const refreshStart = app.indexOf("async function refreshAll");
  const requestStart = app.indexOf("const requests = await Promise.allSettled", refreshStart);
  const prologue = app.slice(refreshStart, requestStart);

  assert.match(
    prologue,
    /if \(store\.refreshing\) \{[\s\S]*?store\.refreshQueued = true;[\s\S]*?return;[\s\S]*?\}/,
  );
  assert.match(
    prologue,
    /window\.clearTimeout\(store\.refreshTimer\);\s*store\.refreshTimer = null;\s*store\.refreshing = true;/,
  );
  assert.match(
    app.slice(refreshStart, app.indexOf("function renderFetchFailure", refreshStart)),
    /store\.refreshing = false;[\s\S]*?scheduleQueuedRefresh\(\);/,
  );
});

test("latest-started leader refresh rejects every older response and failure", async () => {
  const harness = predictiveLeaderHarness();

  const oldSuccess = harness.refreshPredictiveLeader({ priority: true });
  const newSuccess = harness.refreshPredictiveLeader({ priority: true });
  assert.equal(harness.pending.length, 2, "the leader path must bypass active full-refresh work");

  harness.pending[0].resolve(leaderPayload("old"));
  assert.equal(await oldSuccess, false);
  assert.equal(harness.store.predictiveLeaderSnapshot, null);
  assert.deepEqual(
    harness.renders,
    [],
    "an older response must stay invisible while the latest-started request is pending",
  );

  harness.pending[1].resolve(leaderPayload("new"));
  assert.equal(await newSuccess, true);
  assert.equal(
    harness.store.predictiveLeaderSnapshot.marker,
    "new",
    "only the latest-started response may become visible",
  );
  assert.equal(harness.store.predictiveLeaderRequestId, 2);
  assert.equal(harness.store.predictiveLeaderError, false);
  assert.deepEqual(harness.renders, ["new"]);

  const oldFailure = harness.refreshPredictiveLeader({ priority: true });
  const newestSuccess = harness.refreshPredictiveLeader({ priority: true });
  harness.pending[3].resolve(leaderPayload("newest"));
  assert.equal(await newestSuccess, true);
  harness.pending[2].reject(new Error("late timeout"));
  assert.equal(await oldFailure, false);
  assert.equal(harness.store.predictiveLeaderSnapshot.marker, "newest");
  assert.equal(harness.store.predictiveLeaderError, false);
  assert.equal(harness.store.predictiveLeaderRequiresFreshSnapshot, false);
  assert.deepEqual(harness.renders, ["new", "newest"]);
});

test("leader lifecycle invalidation supersedes an in-flight response", async () => {
  const harness = predictiveLeaderHarness();
  const request = harness.refreshPredictiveLeader({ priority: true });

  harness.invalidatePredictiveLeaderBet();
  assert.equal(harness.store.predictiveLeaderRequestId, 2);
  assert.equal(harness.store.predictiveLeaderRefreshPromise, null);
  harness.pending[0].resolve(leaderPayload("obsolete"));

  assert.equal(await request, false);
  assert.equal(harness.store.predictiveLeaderSnapshot, null);
  assert.deepEqual(harness.renders, []);
});

test("ready BET expires at bettingClosesAt after subtracting request elapsed time", async () => {
  const harness = predictiveLeaderHarness();
  const request = harness.refreshPredictiveLeader({ priority: true });

  harness.clock.tick(3_000);
  harness.pending[0].resolve(leaderPayload("bet", {
    status: "ready",
    action: "BET",
    forecast: { bettingClosesAt: "2026-10-15T12:00:10.000Z" },
  }));
  assert.equal(await request, true);
  assert.equal(harness.store.predictiveLeaderRequiresFreshSnapshot, false);
  assert.equal(harness.store.predictiveLeaderExpiresAt, 10_000);
  assert.deepEqual(harness.renders, ["bet"]);

  harness.clock.tick(6_999);
  assert.equal(
    harness.store.predictiveLeaderRequiresFreshSnapshot,
    false,
    "BET remains visible one millisecond before the server close instant",
  );
  harness.clock.tick(1);
  assert.equal(harness.store.predictiveLeaderRequiresFreshSnapshot, true);
  assert.equal(harness.store.predictiveLeaderRequestId, 2);
  assert.equal(harness.store.predictiveLeaderExpiryTimer, null);
  assert.equal(harness.store.predictiveLeaderExpiresAt, null);
  assert.deepEqual(harness.renders, ["bet", "hidden"]);

  const lateHarness = predictiveLeaderHarness();
  const lateRequest = lateHarness.refreshPredictiveLeader({ priority: true });
  lateHarness.clock.tick(10_000);
  lateHarness.pending[0].resolve(leaderPayload("already-closed", {
    status: "ready",
    action: "BET",
    forecast: { bettingClosesAt: "2026-10-15T12:00:10.000Z" },
  }));
  assert.equal(await lateRequest, true);
  assert.equal(
    lateHarness.store.predictiveLeaderRequiresFreshSnapshot,
    true,
    "a BET received at the exact close boundary must never be exposed",
  );
  assert.deepEqual(lateHarness.renders, ["hidden"]);
});
