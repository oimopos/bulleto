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

  return { clearTimeout, setTimeout, tick };
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
