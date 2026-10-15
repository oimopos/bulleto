import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const combinedNumber = readFileSync(
  new URL("../public/combined-number.js", import.meta.url),
  "utf8",
);
const styles = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const server = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const database = readFileSync(new URL("../src/database.js", import.meta.url), "utf8");

test("every app DOM reference exists exactly once in the dashboard", () => {
  const htmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const idCounts = new Map();
  htmlIds.forEach((id) => idCounts.set(id, (idCounts.get(id) || 0) + 1));

  const referencedIds = [
    ...app.matchAll(/document\.getElementById\("([^"]+)"\)/g),
  ].map((match) => match[1]);

  assert.deepEqual(
    htmlIds.filter((id) => idCounts.get(id) > 1),
    [],
    "HTML must not contain duplicate IDs",
  );
  assert.deepEqual(
    referencedIds.filter((id) => idCounts.get(id) !== 1),
    [],
    "every getElementById reference must resolve exactly once",
  );
});

test("dashboard keeps the exact read-only fetch URL list", () => {
  const stateUrls = [...app.matchAll(/settledFetch\("([^"]+)"\)/g)]
    .map((match) => match[1]);
  const optionalUrls = [...app.matchAll(/\burl: "(\/api\/[^"]+)"/g)]
    .map((match) => match[1]);
  const fetchUrls = [...stateUrls, ...optionalUrls];

  assert.deepEqual(fetchUrls, [
    "/api/state/core",
    "/api/results?limit=80",
    "/api/cycles?limit=10",
    "/api/sequences?limit=50",
    "/api/pairs",
    "/api/cycle-comparison",
    "/api/predictive-leader",
    "/api/trajectory-direction/challenger",
    "/api/forecasts",
  ]);
  assert.equal(
    [...app.matchAll(/\bfetchJson\(/g)].length,
    2,
    "one helper definition and one settled dispatcher are the only fetchJson uses",
  );
});

test("partial refresh marks cached dashboard state stale before rendering fresh side data", async () => {
  const functionStart = app.indexOf("  async function refreshAll({ notify = false } = {}) {");
  const functionEnd = app.indexOf("\n\n  function latestResultForRender", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const staleState = {
    precloseForecast: { latest: { trajectoryShadow: { direction: "up" } } },
  };
  const store = {
    state: staleState,
    stateLoaded: true,
    stateError: false,
    results: [{ id: "old" }],
    resultsLoaded: true,
    resultsError: false,
    refreshing: false,
    refreshQueued: false,
    refreshQueuedNotify: false,
    refreshTimer: 7,
    eventSource: null,
    hasCompletedInitialRender: true,
  };
  const classList = { add() {}, remove() {} };
  const elements = {
    refreshButton: { classList, disabled: false },
    main: { setAttribute() {}, removeAttribute() {} },
  };
  const rendered = [];
  const fetchJson = async (url) => {
    if (url === "/api/results?limit=80") return { items: [{ id: "fresh" }] };
    throw new Error(`failed ${url}`);
  };
  const build = new Function(
    "window",
    "store",
    "elements",
    "fetchJson",
    "extractItems",
    "renderAll",
    "setConnection",
    "scheduleQueuedRefresh",
    `"use strict"; ${app.slice(functionStart, functionEnd)}; return refreshAll;`,
  );
  const refreshAll = build(
    { clearTimeout() {} },
    store,
    elements,
    fetchJson,
    (payload) => Array.isArray(payload?.items) ? payload.items : [],
    () => rendered.push({ state: store.state, stateError: store.stateError }),
    () => {},
    () => {},
  );

  await refreshAll();

  assert.equal(store.state, staleState, "last-good state remains available to explicitly stale panels");
  assert.equal(store.stateError, true);
  assert.equal(store.resultsLoaded, true);
  assert.equal(store.resultsError, false);
  assert.deepEqual(store.results, [{ id: "fresh" }]);
  assert.equal(rendered.length, 9, "core and eight optional outcomes render independently");
  assert.ok(rendered.every(({ state, stateError }) => state === staleState && stateError));
});

test("trajectory challenger endpoint failure stays isolated from dashboard state", async () => {
  const functionStart = app.indexOf("  async function refreshAll({ notify = false } = {}) {");
  const functionEnd = app.indexOf("\n\n  function latestResultForRender", functionStart);
  const store = {
    state: null,
    stateLoaded: false,
    stateError: false,
    refreshing: false,
    refreshQueued: false,
    refreshTimer: null,
    eventSource: null,
  };
  const elements = {
    refreshButton: { classList: { add() {}, remove() {} }, disabled: false },
    main: { setAttribute() {}, removeAttribute() {} },
  };
  const fetchJson = async (url) => {
    if (url === "/api/state/core") return { serverTime: null, collector: { currentRound: null } };
    throw new Error(`failed ${url}`);
  };
  const build = new Function(
    "window",
    "store",
    "elements",
    "fetchJson",
    "extractItems",
    "renderAll",
    "setConnection",
    "scheduleQueuedRefresh",
    "captureServerClock",
    `"use strict"; ${app.slice(functionStart, functionEnd)}; return refreshAll;`,
  );
  const refreshAll = build(
    { clearTimeout() {} },
    store,
    elements,
    fetchJson,
    () => [],
    () => {},
    () => {},
    () => {},
    () => {},
  );

  await refreshAll();

  assert.equal(store.stateError, false);
  assert.equal(store.precloseForecastLoaded, true);
  assert.equal(store.precloseForecastError, true);
  assert.equal(store.trajectoryDirectionChallengerLoaded, true);
  assert.equal(store.trajectoryDirectionChallengerError, true);
  assert.equal(store.trajectoryDirectionChallengerSnapshot, null);
});

test("a failed forecast audit hides a retained same-round Rank-37", () => {
  const functionStart = app.indexOf("  function renderPrecloseForecast() {");
  const functionEnd = app.indexOf("  function renderCollector", functionStart);
  const elements = {
    precloseRanking: { setAttribute() {}, replaceChildren() {} },
    precloseLivePrice: { textContent: "stale" },
    precloseProjectedPrice: { textContent: "stale" },
    precloseComparison: { dataset: {}, setAttribute() {} },
    precloseComparisonBadge: { textContent: "" },
    precloseComparisonStatus: { textContent: "" },
    preclosePanel: { dataset: {} },
    precloseBadge: { textContent: "" },
    precloseStatus: { textContent: "" },
    precloseTiming: { textContent: "" },
  };
  const store = {
    state: {
      collector: { currentRound: { id: "same-round" } },
      precloseForecast: {
        latest: {
          roundId: "same-round",
          trajectoryShadow: { direction: "up" },
        },
      },
    },
    stateError: false,
    precloseForecastLoaded: true,
    precloseForecastError: true,
    trajectoryDirectionChallengerSnapshot: null,
    trajectoryDirectionChallengerError: false,
    trajectoryDirectionChallengerLoaded: true,
  };
  let comparisonForecast = "not-called";
  let metricOptions = null;
  let shadowOptions = null;
  const build = new Function(
    "store",
    "elements",
    "parseDate",
    "currentTimeMs",
    "normalizedTrajectoryMetrics",
    "renderPrecloseTrajectoryMetrics",
    "renderPrecloseComparison",
    "renderTrajectoryShadow",
    "renderTrajectoryDirectionChallenger",
    "createElement",
    "setTextIfChanged",
    `"use strict"; ${app.slice(functionStart, functionEnd)}; return renderPrecloseForecast;`,
  );
  const render = build(
    store,
    elements,
    () => null,
    () => Date.now(),
    () => null,
    (_metrics, options) => { metricOptions = options; },
    (latest) => { comparisonForecast = latest; },
    (_shadow, _metrics, options) => { shadowOptions = options; },
    () => {},
    () => ({}),
    (element, value) => { element.textContent = value; },
  );

  render();

  assert.equal(comparisonForecast, null, "retained forecast must not render after audit failure");
  assert.equal(metricOptions.failed, true);
  assert.equal(shadowOptions.failed, true);
  assert.equal(elements.preclosePanel.dataset.state, "error");
  assert.equal(elements.precloseBadge.textContent, "Не обновлено");
  assert.match(elements.precloseStatus.textContent, /Старый Rank‑37.*скрыты/);
});

test("a full initial API outage renders the explicit failure state", async () => {
  const functionStart = app.indexOf("  async function refreshAll({ notify = false } = {}) {");
  const functionEnd = app.indexOf("\n\n  function latestResultForRender", functionStart);
  const store = {
    state: null,
    stateLoaded: false,
    stateError: false,
    refreshing: false,
    refreshQueued: false,
    refreshQueuedNotify: false,
    refreshTimer: null,
    eventSource: null,
    hasCompletedInitialRender: false,
  };
  const pending = [];
  let busyRemoved = 0;
  const elements = {
    refreshButton: { classList: { add() {}, remove() {} }, disabled: false },
    main: { setAttribute() {}, removeAttribute() { busyRemoved += 1; } },
  };
  let renders = 0;
  const failureCompleted = [];
  const build = new Function(
    "window",
    "store",
    "elements",
    "fetchJson",
    "renderAll",
    "renderFetchFailure",
    "setConnection",
    "scheduleQueuedRefresh",
    `"use strict"; ${app.slice(functionStart, functionEnd)}; return refreshAll;`,
  );
  const refreshAll = build(
    { clearTimeout() {} },
    store,
    elements,
    (url) => {
      if (url === "/api/state/core") return Promise.reject(new Error("offline"));
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
    () => {
      renders += 1;
      store.hasCompletedInitialRender = true;
    },
    () => { failureCompleted.push(store.hasCompletedInitialRender); },
    () => {},
    () => {},
  );

  const refresh = refreshAll();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(failureCompleted, [false], "core failure must render before optional timeouts");
  assert.equal(busyRemoved, 1, "the initial loading state must end after the core failure");
  assert.equal(store.refreshing, true, "optional recovery may continue after the visible error");
  assert.equal(pending.length, 8);

  pending.forEach(({ reject }) => reject(new Error("offline")));
  await refresh;

  assert.equal(renders, 0, "failed sources must not turn placeholders into empty data");
  assert.ok(failureCompleted.every((completed) => completed === false));
  assert.equal(store.stateError, true);
});

test("core state renders before any optional endpoint settles", async () => {
  const functionStart = app.indexOf("  async function refreshAll({ notify = false } = {}) {");
  const functionEnd = app.indexOf("\n\n  function latestResultForRender", functionStart);
  const sequence = [];
  const pending = [];
  const store = {
    state: null,
    stateLoaded: false,
    stateError: false,
    refreshing: false,
    refreshQueued: false,
    refreshQueuedNotify: false,
    refreshTimer: null,
    eventSource: null,
    hasCompletedInitialRender: false,
  };
  const elements = {
    refreshButton: { classList: { add() {}, remove() {} }, disabled: false },
    main: { setAttribute() {}, removeAttribute() {} },
  };
  const fetchJson = (url) => {
    sequence.push(`fetch:${url}`);
    if (url === "/api/state/core") {
      return Promise.resolve({ serverTime: null, collector: { currentRound: { id: "fresh" } } });
    }
    return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  };
  const build = new Function(
    "window",
    "store",
    "elements",
    "fetchJson",
    "extractItems",
    "renderAll",
    "setConnection",
    "scheduleQueuedRefresh",
    "captureServerClock",
    `"use strict"; ${app.slice(functionStart, functionEnd)}; return refreshAll;`,
  );
  const refreshAll = build(
    { clearTimeout() {} },
    store,
    elements,
    fetchJson,
    () => [],
    () => {
      sequence.push("render");
      store.hasCompletedInitialRender = true;
    },
    () => {},
    () => {},
    () => {},
  );

  const refresh = refreshAll();
  await new Promise((resolve) => setImmediate(resolve));

  const firstRender = sequence.indexOf("render");
  const firstOptionalFetch = sequence.findIndex(
    (entry) => entry.startsWith("fetch:/api/") && entry !== "fetch:/api/state/core",
  );
  assert.ok(firstRender > sequence.indexOf("fetch:/api/state/core"));
  assert.ok(firstRender < firstOptionalFetch, "core must render before optional reads start");
  assert.equal(
    sequence.at(-1),
    "fetch:/api/forecasts",
    "the synchronous full-history audit must be dispatched after lightweight reads",
  );
  assert.equal(store.state.collector.currentRound.id, "fresh");
  assert.equal(store.refreshing, true, "optional reads may continue in the background");

  pending.forEach(({ reject }) => reject(new Error("optional unavailable")));
  await refresh;
  assert.equal(store.refreshing, false);
});

test("background refresh avoids global busy state and refresh cleanup survives renderer failure", async () => {
  const functionStart = app.indexOf("  async function refreshAll({ notify = false } = {}) {");
  const functionEnd = app.indexOf("\n\n  function latestResultForRender", functionStart);
  const build = new Function(
    "window",
    "store",
    "elements",
    "fetchJson",
    "extractItems",
    "renderAll",
    "setConnection",
    "scheduleQueuedRefresh",
    "captureServerClock",
    "console",
    `"use strict"; ${app.slice(functionStart, functionEnd)}; return refreshAll;`,
  );
  const makeHarness = ({ completed, throws }) => {
    const calls = {
      add: 0,
      remove: 0,
      setBusy: 0,
      removeBusy: 0,
      queued: 0,
      urls: [],
    };
    const store = {
      state: null,
      stateLoaded: false,
      stateError: false,
      refreshing: false,
      refreshQueued: false,
      refreshQueuedNotify: false,
      refreshTimer: null,
      eventSource: null,
      hasCompletedInitialRender: completed,
    };
    const elements = {
      refreshButton: {
        classList: {
          add() { calls.add += 1; },
          remove() { calls.remove += 1; },
        },
        disabled: false,
      },
      main: {
        setAttribute() { calls.setBusy += 1; },
        removeAttribute() { calls.removeBusy += 1; },
      },
    };
    const refreshAll = build(
      { clearTimeout() {} },
      store,
      elements,
      async (url) => {
        calls.urls.push(url);
        if (url === "/api/state/core") return { serverTime: null };
        throw new Error("optional unavailable");
      },
      () => [],
      () => {
        if (throws) throw new Error("renderer failed");
      },
      () => {},
      () => { calls.queued += 1; },
      () => {},
      { error() {} },
    );
    return { refreshAll, store, elements, calls };
  };

  const background = makeHarness({ completed: true, throws: false });
  await background.refreshAll();
  assert.equal(background.calls.add, 0);
  assert.equal(background.calls.setBusy, 0);
  assert.equal(background.store.refreshing, false);

  const failing = makeHarness({ completed: false, throws: true });
  await failing.refreshAll();
  assert.equal(failing.store.refreshing, false);
  assert.equal(failing.elements.refreshButton.disabled, false);
  assert.equal(failing.calls.remove, 1);
  assert.equal(failing.calls.removeBusy, 1);
  assert.equal(failing.calls.queued, 1);
  assert.equal(failing.calls.urls.length, 9, "one broken renderer cannot cancel independent API reads");
});

test("SSE connected is ignored and refresh storms coalesce while a refresh is active", () => {
  const connectStart = app.indexOf("  function connectEventStream() {");
  const connectEnd = app.indexOf("  elements.refreshButton.addEventListener", connectStart);
  const listeners = {};
  let scheduled = 0;
  class FakeEventSource {
    static OPEN = 1;
    static CLOSED = 2;
    constructor() { this.readyState = FakeEventSource.OPEN; }
    addEventListener(name, listener) { listeners[name] = listener; }
    close() {}
  }
  const connect = new Function(
    "window",
    "store",
    "setConnection",
    "EventSource",
    "scheduleRefresh",
    "announce",
    "renderCombinedPick",
    `"use strict"; ${app.slice(connectStart, connectEnd)}; return connectEventStream;`,
  )(
    { EventSource: FakeEventSource },
    { eventSource: null, predictiveLeaderRequiresFreshSnapshot: false },
    () => {},
    FakeEventSource,
    () => { scheduled += 1; },
    () => {},
    () => {},
  );
  connect();
  listeners.update({ data: JSON.stringify({ reason: "connected" }) });
  assert.equal(scheduled, 0);
  listeners.update({ data: JSON.stringify({ reason: "results" }) });
  assert.equal(scheduled, 1);

  const scheduleStart = app.indexOf("  function scheduleRefresh() {");
  const scheduleEnd = app.indexOf("  function connectEventStream()", scheduleStart);
  let timers = 0;
  const stormStore = {
    refreshing: true,
    refreshQueued: false,
    refreshQueuedNotify: false,
    refreshTimer: null,
  };
  const schedulers = new Function(
    "window",
    "store",
    "REFRESH_DEBOUNCE_MS",
    `"use strict"; ${app.slice(scheduleStart, scheduleEnd)}; return { scheduleRefresh, scheduleQueuedRefresh };`,
  )(
    {
      clearTimeout() {},
      setTimeout() { timers += 1; return timers; },
    },
    stormStore,
    180,
  );
  schedulers.scheduleRefresh();
  schedulers.scheduleRefresh();
  schedulers.scheduleRefresh();
  assert.equal(stormStore.refreshQueued, true);
  assert.equal(timers, 0);
  stormStore.refreshing = false;
  schedulers.scheduleQueuedRefresh();
  assert.equal(timers, 1, "one trailing refresh represents the whole SSE burst");
});

test("latest result selection distinguishes a fresh results response from two stale caches", () => {
  const functionStart = app.indexOf("  function latestResultForRender() {");
  const functionEnd = app.indexOf("  function renderFetchFailure()", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const build = new Function(
    "store",
    `"use strict"; ${app.slice(functionStart, functionEnd)}; return latestResultForRender;`,
  );
  const stateResult = { id: "state", settledAt: "2026-10-14T12:00:20.000Z" };
  const olderResult = { id: "older", settledAt: "2026-10-14T12:00:10.000Z" };
  const newerResult = { id: "newer", settledAt: "2026-10-14T12:00:30.000Z" };
  const pick = (overrides = {}) => build({
    state: { latestResult: stateResult },
    stateError: true,
    results: [olderResult],
    resultsLoaded: true,
    resultsError: false,
    ...overrides,
  })();

  assert.equal(pick(), olderResult, "a successful /api/results response is authoritative");
  assert.equal(pick({ results: [] }), null, "a successful empty response stays empty");
  assert.equal(pick({ resultsError: true }), stateResult, "newer cached state wins after dual failure");
  assert.equal(
    pick({ results: [newerResult], resultsError: true }),
    newerResult,
    "timestamps resolve two stale caches without rolling the dashboard back",
  );
  assert.equal(pick({ stateError: false, results: [newerResult] }), stateResult);
});

test("a total refresh failure immediately replaces the cached trajectory display", () => {
  const functionStart = app.indexOf("  function renderFetchFailure() {");
  const functionEnd = app.indexOf("  function renderAll()", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const block = app.slice(functionStart, functionEnd);

  assert.match(block, /renderPrecloseForecast\(\)/);
});

test("server exposes a separate read-only predictive leader GET", () => {
  const viewStart = server.indexOf("function predictiveLeaderForApi()");
  const viewEnd = server.indexOf("function clampLimit", viewStart);
  const view = server.slice(viewStart, viewEnd);

  assert.ok(viewStart >= 0 && viewEnd > viewStart);
  assert.match(
    server,
    /if \(pathname === '\/api\/predictive-leader'\) \{[\s\S]*?sendJson\(response, 200, predictiveLeaderForApi\(\)\)/,
  );
  assert.match(view, /db\.getPredictiveLeaderReadState\(source, instrument\)/);
  assert.match(view, /predictiveLeaderSnapshotForApi\(\{/);
  assert.match(view, /collector: collector\.getStatus\(\)/);
  assert.match(view, /pipelinePending: resultPipeline\.getPendingCounts\(\)/);
  assert.doesNotMatch(view, /dashboardState|getDashboardState|getPrecloseForecastState/);
});

test("predictive leader read path excludes dashboard and trajectory metric work", () => {
  const readStart = database.indexOf("getPredictiveLeaderReadState(");
  const readEnd = database.indexOf("getPrecloseForecastState(", readStart);
  const metricStart = database.indexOf("#predictiveLeaderMetricRows(");
  const metricEnd = database.indexOf("#predictiveLeaderAccountState(", metricStart);
  const readPath = database.slice(readStart, readEnd);
  const leaderMetricQuery = database.slice(metricStart, metricEnd);

  assert.ok(readStart >= 0 && readEnd > readStart);
  assert.ok(metricStart >= 0 && metricEnd > metricStart);
  assert.match(readPath, /mapPredictiveLeaderForecast\(latestRow\)/);
  assert.match(readPath, /#predictiveLeaderMetricRows\(/);
  assert.match(readPath, /#predictiveLeaderAccountState\(/);
  assert.match(readPath, /getLatestResult\(safeSource, safeInstrument\)/);
  assert.doesNotMatch(
    `${readPath}\n${leaderMetricQuery}`,
    /trajectory_adaptive_snapshot_valid|mapTrajectoryMetrics|getDashboardState|getPrecloseForecastState/,
  );
});

test("server starts without a synchronous full-history validation warmup", () => {
  const recovery = server.indexOf("db.reconcilePredictiveLeaderAccount(");
  const listen = server.indexOf("server.listen(");

  assert.ok(recovery >= 0 && listen > recovery);
  assert.doesNotMatch(server, /db\.warmPrecloseForecastValidation\(/);
});

test("dashboard wires predictive leader loading and SSE invalidation fail-closed", () => {
  const refreshStart = app.indexOf("async function refreshAll");
  const refreshEnd = app.indexOf("function renderFetchFailure", refreshStart);
  const refresh = app.slice(refreshStart, refreshEnd);
  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart);
  assert.match(refresh, /url: "\/api\/predictive-leader"/);
  assert.match(refresh, /normalizePredictiveLeaderApiSnapshot\(payload\)/);
  assert.match(refresh, /normalizedPredictiveLeaderAccount\(snapshot\?\.account\)/);
  assert.match(refresh, /store\.predictiveLeaderLoaded = true/);
  assert.match(refresh, /store\.predictiveLeaderError = true/);
  assert.match(refresh, /store\.predictiveLeaderRequiresFreshSnapshot = false/);

  const eventErrorStart = app.indexOf('source.addEventListener("error"');
  const eventErrorEnd = app.indexOf("});", eventErrorStart);
  const eventError = app.slice(eventErrorStart, eventErrorEnd);
  assert.ok(eventErrorStart >= 0 && eventErrorEnd > eventErrorStart);
  assert.match(eventError, /store\.predictiveLeaderRequiresFreshSnapshot = true/);
  assert.match(eventError, /renderCombinedPick\(\)/);
  assert.match(app, /if \(reason === "connected"\) return/);
  assert.match(app, /if \(store\.refreshing\) \{\s*store\.refreshQueued = true;\s*return;/);
});

test("combined leader is the first dashboard block and renders exactly one number", () => {
  const rendererIds = [
    "combined-pick",
    "combined-pick-number",
    "combined-pick-status",
    "combined-pick-sources",
  ];
  for (const id of rendererIds) {
    assert.match(html, new RegExp(`\\bid="${id}"`));
    assert.match(app, new RegExp(`getElementById\\("${id}"\\)`));
  }

  const gapStart = html.indexOf('id="gap-alert"');
  const blockStart = html.indexOf('id="combined-pick"');
  const headingStart = html.indexOf('class="page-heading"');
  const block = html.slice(blockStart, headingStart);
  assert.ok(gapStart >= 0 && blockStart > gapStart && headingStart > blockStart);
  assert.doesNotMatch(block, /\bhidden\b/);
  assert.match(block, /data-algorithm="learned-predictive-family-index-v5"/);
  assert.match(block, /id="combined-pick-status" role="status" aria-live="polite" aria-atomic="true"/);
  assert.equal([...block.matchAll(/<output\b/g)].length, 1);
  assert.match(block, /id="combined-pick-number"/);
  assert.doesNotMatch(block, /<(?:ol|ul)\b/);
  assert.match(block, /Актуальные прогнозные сигналы · один итог/);
  assert.match(block, /Команда BET закрыта/);
  assert.match(block, /1 000 проспективных прогнозов/);
  assert.match(block, /нижнюю границу Wilson 95% выше случайной базы 1\/37/);
  assert.match(html, /<script type="module" src="\/app\.js\?v=52"><\/script>/);

  assert.match(app, /from "\.\/combined-number\.js\?v=9"/);
  assert.match(app, /normalizePredictiveLeaderApiSnapshot/);
  assert.match(app, /predictiveLeaderNumberContext/);
  assert.match(combinedNumber, /export function normalizePredictiveLeaderApiSnapshot\(value\)/);
  assert.match(combinedNumber, /export function predictiveLeaderNumberContext\(/);
  assert.match(combinedNumber, /value\.schemaVersion !== PREDICTIVE_LEADER_API_SCHEMA_VERSION/);
  assert.match(combinedNumber, /value\.algorithmVersion !== PREDICTIVE_LEADER_API_ALGORITHM_VERSION/);
  assert.match(combinedNumber, /value\.mode !== "observation"/);
  assert.match(combinedNumber, /value\.executionEnabled !== false/);
  assert.match(combinedNumber, /value\.advisoryOnly !== true/);
  assert.match(app, /const LEARNED_LEADER_SCHEMA_VERSION = 1/);
  assert.match(app, /const LEARNED_LEADER_ALGORITHM_VERSION = "learned-predictive-family-index-v5"/);
  assert.match(app, /function normalizedPredictiveLeader\(value\)/);
  assert.match(app, /value\.schemaVersion !== LEARNED_LEADER_SCHEMA_VERSION/);
  assert.match(app, /value\.algorithmVersion !== LEARNED_LEADER_ALGORITHM_VERSION/);
  assert.match(app, /value\.ranking\.length !== 37/);
  assert.match(app, /normalizedLearnedLeaderDistribution/);
  assert.match(app, /normalizedLearnedLeaderLearning/);
  assert.match(app, /function normalizedPredictiveLeaderMetrics\(value\)/);
  assert.match(app, /function currentCombinedNumberContext\(\)/);
  assert.match(app, /function renderCombinedPick\(\)/);
  assert.match(app, /function currentPriceTrajectorySignals\(latestForecast\)/);
  assert.match(app, /combinedTrajectorySignals\(/);
  assert.match(server, /pipelinePending: resultPipeline\.getPendingCounts\(\)/);
  assert.ok(
    [...app.matchAll(/renderCombinedPick\(\)/g)].length >= 3,
    "combined leader must render on normal and failed refresh paths",
  );

  const contextStart = app.indexOf("function currentCombinedNumberContext()");
  const contextEnd = app.indexOf("function renderCombinedPick", contextStart);
  const contextBlock = app.slice(contextStart, contextEnd);
  assert.ok(contextStart >= 0 && contextEnd > contextStart);
  assert.match(contextBlock, /predictiveLeaderNumberContext\(/);
  assert.match(contextBlock, /loaded: store\.predictiveLeaderLoaded/);
  assert.match(contextBlock, /error: store\.predictiveLeaderError/);
  assert.match(contextBlock, /requiresFreshSnapshot: store\.predictiveLeaderRequiresFreshSnapshot/);
  assert.match(contextBlock, /snapshot: store\.predictiveLeaderSnapshot/);
  assert.doesNotMatch(contextBlock, /store\.state|precloseForecast|latestForecast/);
  assert.doesNotMatch(contextBlock, /combineNumberRankings|combinedTripleFollowerRanking/);
  assert.doesNotMatch(contextBlock, /rankedNumbers|trajectoryShadow|pairHistory|followerTop5Tracker|tripleFollowerSignal/);
  assert.doesNotMatch(contextBlock, /currentOverdueRanking|currentVirtualRecencySignals/);
  assert.doesNotMatch(contextBlock, /currentActiveCycleRemaining|currentCompletedCycleSurvivor/);
  assert.doesNotMatch(contextBlock, /currentCycleAnalogueRanking/);
  assert.doesNotMatch(contextBlock, /recency-overdue-top3|recency-virtual-held/);
  assert.doesNotMatch(contextBlock, /cycle-remaining|cycle-completed-survivor|cycle-analogue-next/);
  assert.doesNotMatch(contextBlock, /family: "absence"|family: "cycle-analogue"/);
  assert.doesNotMatch(contextBlock, /historicalAccount|actualNumber/);

  const renderStart = app.indexOf("function renderCombinedPick()");
  const renderEnd = app.indexOf("function renderPrecloseComparison", renderStart);
  const renderBlock = app.slice(renderStart, renderEnd);
  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  assert.match(renderBlock, /const \{ snapshot \} = context/);
  assert.match(renderBlock, /const \{ model, metrics, number \} = snapshot/);
  assert.match(renderBlock, /BET-допуск подтверждён/);
  assert.match(renderBlock, /обучение \$\{model\.trainingCount\}/);
  assert.match(renderBlock, /вес цены/);
  assert.match(renderBlock, /истории/);
  assert.match(renderBlock, /нижняя 95% граница/);
  assert.match(renderBlock, /WAIT — кандидат виден для наблюдения/);
  assert.doesNotMatch(renderBlock, /combineNumberRankings|leaderMass|score|вероятност/);
  assert.doesNotMatch(app, /\bcombineNumberRankings\b|\bcombinedTripleFollowerRanking\b/);
  assert.match(styles, /\.combined-pick\s*\{/);
  assert.match(styles, /\.combined-pick__result \.combined-pick__number\s*\{/);
  assert.match(
    styles,
    /@media \(max-width: 430px\)[\s\S]*?\.combined-pick\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
  );
});

test("dashboard does not display the ungated predictive leader reference simulation", () => {
  const blockStart = html.indexOf('id="combined-pick"');
  const blockEnd = html.indexOf('class="page-heading"', blockStart);
  const block = html.slice(blockStart, blockEnd);
  assert.equal([...block.matchAll(/<output\b/g)].length, 1);
  assert.doesNotMatch(block, /бумажный счёт|Следующая ставка|Условная ставка/);
  assert.doesNotMatch(html, /combined-pick-account/);
  assert.doesNotMatch(app, /combinedPickAccount|renderPredictiveLeaderAccount/);
  for (const id of [
    "signal-account",
    "signal-account-status",
    "signal-account-balance",
    "signal-account-record",
    "signal-account-pending",
  ]) {
    assert.equal([...html.matchAll(new RegExp(`\\bid="${id}"`, "g"))].length, 1);
    assert.match(app, new RegExp(`getElementById\\("${id}"\\)`));
  }
  assert.match(block, /Баланс подтверждённых BET-сигналов/);
  assert.match(block, /только прогнозы, для которых API выдал BET/);
  assert.match(app, /function renderPredictiveLeaderSignalAccount\(\)/);
  assert.match(app, /BET подтверждён · число/);

  assert.match(app, /const PREDICTIVE_LEADER_ACCOUNT_SCHEMA_VERSION = 1/);
  assert.match(
    app,
    /const PREDICTIVE_LEADER_ACCOUNT_STRATEGY_VERSION = "predictive-leader-single-ladder-v1"/,
  );
  assert.match(app, /const PREDICTIVE_LEADER_ACCOUNT_STARTING_BALANCE = 1_000/);
  assert.match(app, /initialStake: 10[\s\S]*?stakeStep: 10[\s\S]*?maxStake: 2_500/);
  assert.match(app, /grossPayoutMultiplier: 36[\s\S]*?payoutIncludesStake: true[\s\S]*?netHitMultiplier: 35/);

  const normalizerStart = app.indexOf("function normalizedPredictiveLeaderAccount(value)");
  const normalizerEnd = app.indexOf("function currentPriceTrajectorySignals", normalizerStart);
  const normalizer = app.slice(normalizerStart, normalizerEnd);
  assert.ok(normalizerStart >= 0 && normalizerEnd > normalizerStart);
  assert.match(normalizer, /value\.schemaVersion !== PREDICTIVE_LEADER_ACCOUNT_SCHEMA_VERSION/);
  assert.match(normalizer, /value\.strategyVersion !== PREDICTIVE_LEADER_ACCOUNT_STRATEGY_VERSION/);
  assert.match(normalizer, /value\.leaderAlgorithmVersion !== LEARNED_LEADER_ALGORITHM_VERSION/);
  assert.match(normalizer, /value\.mode !== "prospective-simulation"/);
  assert.match(normalizer, /value\.executionEnabled !== false/);
  assert.match(normalizer, /value\.advisoryOnly !== true/);
  assert.match(normalizer, /value\.model\.netHitMultiplier !== PREDICTIVE_LEADER_ACCOUNT_MODEL\.netHitMultiplier/);
  assert.match(
    normalizer,
    /value\.betCount !== value\.settledCount \+ value\.pendingCount \+ voidCount/,
  );
  assert.match(normalizer, /value\.latestVoid\.reason !== "integrity_gap"/);
  assert.match(normalizer, /\(voidCount > 0\) !== \(latestVoid !== null\)/);
  assert.match(normalizer, /value\.settledCount !== value\.hitCount \+ value\.missCount/);
  assert.match(normalizer, /value\.currentBalance !== computedBalance/);
  assert.match(normalizer, /value\.nextStake !== expectedNextStake/);
  assert.match(normalizer, /value\.hitRate - value\.hitCount \/ value\.settledCount/);
  assert.match(normalizer, /\(value\.status === "pending"\) !== \(pendingBet !== null\)/);
  assert.match(normalizer, /\(value\.status === "exhausted"\) !== !value\.canAffordNext/);

  assert.match(app, /normalizedPredictiveLeaderAccount\(snapshot\?\.account\)/);
  assert.doesNotMatch(styles, /combined-pick-account/);
});

test("experimental forecast shows only the first three places of the full Rank-37", () => {
  const blockStart = html.indexOf('id="preclose-panel"');
  const blockEnd = html.indexOf('id="follower-panel"', blockStart);
  const block = html.slice(blockStart, blockEnd);
  assert.ok(blockStart >= 0 && blockEnd > blockStart);
  assert.match(block, /Экспериментальный прогноз/);
  assert.match(block, /Первые 3 места полного Rank‑37/);
  assert.match(block, /aria-label="Первые три места полного рейтинга всех 37 чисел"/);
  assert.match(block, /Ранговая масса — не вероятность и не доказанное преимущество/);
  assert.match(block, /start-price-v2<\/code> остаётся служебным архивом/);
  assert.match(block, /не получает веса ни в новом списке, ни в верхнем едином лидере/);
  assert.match(block, /8–15 секунд до bcd/);

  const renderStart = app.indexOf("  function renderPrecloseForecast() {");
  const renderEnd = app.indexOf("  function renderCollector", renderStart);
  const renderBlock = app.slice(renderStart, renderEnd);
  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  assert.match(renderBlock, /const rankedNumbers = trajectory\.ranking\.slice\(0, 3\)/);
  assert.match(renderBlock, /Первые три места полного рейтинга 37 чисел/);
  assert.match(renderBlock, /все 37 чисел отранжированы, показаны три первых/);
  assert.match(renderBlock, /старый статичный Top‑3 не показывается/);
  assert.match(app, /const PRECLOSE_CAPTURE_MAX_LEAD_MS = 15_000/);
  assert.match(renderBlock, /closesMs - PRECLOSE_CAPTURE_MAX_LEAD_MS/);
  assert.doesNotMatch(renderBlock, /finalForecast\.numbers|price-start/);
});

test("trajectory shadow is prospective and exposes the full Rank-37 contract", () => {
  const rendererIds = [
    "trajectory-shadow-panel",
    "trajectory-shadow-badge",
    "trajectory-shadow-observed",
    "trajectory-shadow-status",
    "trajectory-shadow-shares",
    "trajectory-shadow-number-area",
    "trajectory-shadow-training",
    "trajectory-shadow-range-metrics",
    "trajectory-shadow-sample",
    "trajectory-direction-challenger",
  ];
  const semanticIds = ["trajectory-shadow-title", "trajectory-shadow-note"];

  for (const id of [...rendererIds, ...semanticIds]) {
    assert.match(html, new RegExp(`\\bid="${id}"`));
  }
  for (const id of rendererIds) {
    assert.match(app, new RegExp(`getElementById\\("${id}"\\)`));
  }

  const blockStart = html.indexOf('id="trajectory-shadow-panel"');
  const blockEnd = html.indexOf('id="preclose-note"');
  const block = html.slice(blockStart, blockEnd);
  assert.ok(blockStart >= 0 && blockEnd > blockStart);
  assert.match(block, /Shadow · факт отдельно от прогноза/);
  assert.match(block, /Факт · сохранённая диаграмма до lock/);
  assert.match(block, /Прогноз · отдельное движение lock → ed/);
  assert.match(block, /Проверка альтернативы · lock → ed/);
  assert.match(block, /trajectory-shadow-status trajectory-direction-challenger/);
  assert.match(block, /последней доступной точки перед forecast lock/);
  assert.match(block, /возраст точки не более 5 с/);
  assert.match(block, /не к текущему наклону и не к следующему тику/);
  assert.match(block, /направления могут быть противоположными/);
  assert.match(block, /это не переворот оси/);
  assert.match(block, /Архивное основание прогноза/);
  assert.match(block, /ПРОГНОЗ УЧАСТКА: НЕТ ДАННЫХ/);
  assert.match(block, /не более 6 соседних ценовых полос вокруг типичного q50/);
  assert.match(block, /полного коридора q20\/q80/);
  assert.match(block, /Adaptive v2 фиксирует при lock/);
  assert.match(block, /legacy KNN v1/);
  assert.match(block, /от 0 сверху к 36 снизу/);
  assert.match(block, /нижняя дублирующая нулевая полоса/);
  assert.match(
    block,
    /id="trajectory-shadow-number-area" aria-live="polite" aria-atomic="true"/,
  );
  assert.match(block, /Обучение: — результатов/);
  assert.match(block, /Участок: — из —/);
  assert.match(block, /Rank‑37 проверяются только на проспективно зафиксированных/);
  assert.match(block, /не являются вероятностью следующего раунда/);
  assert.match(block, /Rank‑37 входит с замороженной исходной массой/);
  assert.match(block, /нулевой массой данных не получают вес/);
  assert.match(block, /не создаёт второй независимый вес/);
  assert.doesNotMatch(block, /roulette-(?:red|green|black)|is-(?:hit|positive|loss)/);
  assert.doesNotMatch(html, /preclose-hit-history|Сохранённые попадания legacy Top/);
  assert.doesNotMatch(app, /forecastHits|renderForecastHitHistory|\/api\/forecasts\/hits/);
  assert.doesNotMatch(server, /\/api\/forecasts\/hits|preclose-forecast-hits/);
  assert.doesNotMatch(database, /getPrecloseForecastHits|mapPrecloseForecastHit/);

  assert.match(app, /const TRAJECTORY_SHADOW_LEGACY_VERSION = "trajectory-shadow-knn-v1"/);
  assert.match(app, /const TRAJECTORY_SHADOW_ADAPTIVE_VERSION = "trajectory-shadow-adaptive-v2"/);
  assert.match(app, /const TRAJECTORY_NUMBER_AREA_VERSION = "trajectory-number-area-v1"/);
  assert.match(app, /const TRAJECTORY_DISPLAY_RANGE_VERSION = "trajectory-display-range-v1"/);
  assert.match(app, /const TRAJECTORY_DISPLAY_RANGE_POLICY = "q50-centered-contiguous-max6-v1"/);
  assert.match(app, /TRAJECTORY_RANK37_VERSION,/);
  assert.match(app, /TRAJECTORY_RANK37_BASIS,/);
  assert.match(combinedNumber, /evidenceCandidateCount/);
  assert.match(combinedNumber, /weights: evidenceRawMass\.map/);
  assert.match(app, /const TRAJECTORY_NUMBER_AREA_MAX_DISPLAY_CELLS = 6/);
  assert.match(app, /const TRAJECTORY_DIRECTION_CHALLENGER_SCHEMA_VERSION = 1/);
  assert.match(app, /const TRAJECTORY_DIRECTION_CHALLENGER_KEY = "structural-center-v1"/);
  assert.match(app, /const TRAJECTORY_DIRECTION_CHALLENGER_MODEL = "trajectory-direction-structural-v1"/);
  assert.match(app, /const TRAJECTORY_DIRECTION_CHALLENGER_MODE = "prospective-shadow"/);
  assert.match(app, /function normalizedTrajectoryNumberArea\(value\)/);
  assert.match(app, /function normalizedTrajectoryDisplayRange\(value, numberArea\)/);
  assert.match(app, /function normalizedTrajectoryAdaptive\(value\)/);
  assert.match(app, /function normalizedTrajectoryObservedChange\(value\)/);
  assert.match(app, /function normalizedTrajectoryEvaluation\(value, \{ numberArea, displayRange \}\)/);
  assert.match(app, /function normalizedTrajectoryMetrics\(value\)/);
  assert.match(app, /function trajectoryNumberAreaDisplayCells\(area\)/);
  assert.match(app, /function trajectoryShadowDisplayCells\(shadow\)/);
  assert.match(app, /function trajectoryNumberAreaText\(shadow\)/);
  assert.match(app, /function normalizedTrajectoryShadow\(value\)/);
  assert.match(app, /function renderTrajectoryShadow\(value, metricsValue, \{ failed = false \} = \{\}\)/);
  assert.match(app, /"insufficient_current"/);
  assert.match(app, /график неполный/);
  assert.match(
    app,
    /renderTrajectoryShadow\(\s*matchesCurrent \? latest\?\.trajectoryShadow : null,\s*forecastState\?\.trajectoryMetrics,\s*\{ failed: forecastFailed \},\s*\)/,
  );
  assert.match(app, /shadow\.isAdaptive\s*\? shadow\.displayRange\?\.cells \?\? \[\]/);
  assert.match(app, /value\.modelVersion !== TRAJECTORY_SHADOW_ADAPTIVE_VERSION/);
  assert.match(app, /value\.displayRangeVersion !== TRAJECTORY_DISPLAY_RANGE_VERSION/);
  assert.match(app, /value\.rank37Version !== TRAJECTORY_RANK37_VERSION/);
  assert.match(app, /value\.rank37Basis !== TRAJECTORY_RANK37_BASIS/);
  assert.match(app, /value\.readyCount !== value\.settledCount \+ value\.pendingCount/);
  assert.match(app, /value\.settledCount !== value\.evaluatedCount \+ value\.ungradableCount/);
  assert.match(app, /Обучение: \$\{trainingCount\}/);
  assert.match(app, /Участок: \$\{displayRangeHits\} из \$\{evaluatedCount\}/);
  assert.match(app, /Rank‑37: Top‑1/);
  assert.match(app, /Top‑3 \$\{metrics\.rank37Top3Hits\}/);
  assert.match(app, /проспективное наблюдение/);
  assert.match(app, /Полные сопоставимые раунды:/);
  assert.match(app, /Архивное основание прогноза:/);
  assert.ok(app.includes("ПРОГНОЗ УЧАСТКА: ОТ ${from} ДО ${to}"));
  assert.match(
    app,
    /return cells\.slice\(start, start \+ size\)/,
  );
  assert.doesNotMatch(
    app,
    /trajectoryNumberAreaLabel\(area\.corridor\.(?:top|bottom)\)/,
  );
  assert.match(app, /ПРОГНОЗ УЧАСТКА: НЕДОСТАТОЧНО ПОХОЖИХ ГРАФИКОВ/);
  assert.match(
    app,
    /if \(point\.wireCell === 37\) return "0 \(НИЖНЯЯ ПОЛОСА\)"/,
  );
  assert.match(
    app,
    /if \(point\.wireCell === 0\) return "0 \(ВЕРХНЯЯ ПОЛОСА\)"/,
  );
  assert.match(styles, /\.trajectory-shadow__range\s*\{[\s\S]*?font-size: clamp\(18px, 4vw, 28px\)/);
  assert.match(styles, /\.trajectory-shadow__directions > \.trajectory-shadow__challenger\s*\{[\s\S]*?grid-column: 1 \/ -1/);
  assert.doesNotMatch(app, /trajectoryShadowPanel\.(?:dataset|classList)/);
});

test("trajectory direction challenger is advisory, current-round only, and fail-closed", () => {
  const functionStart = app.indexOf("  function normalizedTrajectoryDirectionChallengerMetrics(value) {");
  const functionEnd = app.indexOf("\n\n  function trajectoryNumberAreaLabel(point)", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);

  const target = () => ({ textContent: "" });
  const elements = { trajectoryDirectionChallenger: target() };
  const build = new Function(
    "TRAJECTORY_DIRECTION_CHALLENGER_SCHEMA_VERSION",
    "TRAJECTORY_DIRECTION_CHALLENGER_KEY",
    "TRAJECTORY_DIRECTION_CHALLENGER_MODEL",
    "TRAJECTORY_DIRECTION_CHALLENGER_MODE",
    "TRAJECTORY_SHADOW_ADAPTIVE_VERSION",
    "TRAJECTORY_SHADOW_DIRECTION_LABELS",
    "trajectoryShadowShareFormatter",
    "elements",
    "setTextIfChanged",
    `"use strict"; ${app.slice(functionStart, functionEnd)}; return { normalizedTrajectoryDirectionChallenger, renderTrajectoryDirectionChallenger };`,
  );
  const { normalizedTrajectoryDirectionChallenger: normalize, renderTrajectoryDirectionChallenger: render } = build(
    1,
    "structural-center-v1",
    "trajectory-direction-structural-v1",
    "prospective-shadow",
    "trajectory-shadow-adaptive-v2",
    { up: "вверх", down: "вниз", flat: "без движения" },
    new Intl.NumberFormat("ru-RU", {
      style: "percent",
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }),
    elements,
    (element, value) => { element.textContent = value; },
  );
  const metrics = {
    eligibleCount: 4,
    storedCount: 4,
    validStoredCount: 4,
    selectedCount: 3,
    unselectedCount: 1,
    unavailableCount: 0,
    evaluatedSelected: 2,
    settledSelected: 2,
    pendingSelected: 1,
    ungradableSelected: 0,
    hits: 1,
    invalidStoredCount: 0,
    decisionCoverage: 0.75,
    selectiveAccuracy: 0.5,
    paired: {
      count: 2,
      challengerHits: 1,
      championHits: 0,
      challengerRate: 0.5,
      championRate: 0,
      uplift: 0.5,
      bothHit: 0,
      challengerOnly: 1,
      championOnly: 0,
      bothWrong: 1,
      discordantCount: 1,
    },
    window: {
      limit: 1_000,
      eligibleCount: 4,
      storedCount: 4,
      validStoredCount: 4,
      totalEligibleCount: 4,
      totalStoredCount: 4,
      truncated: false,
    },
  };
  const ready = {
    schemaVersion: 1,
    challengerKey: "structural-center-v1",
    modelVersion: "trajectory-direction-structural-v1",
    championModelVersion: "trajectory-shadow-adaptive-v2",
    mode: "prospective-shadow",
    advisoryOnly: true,
    executionEnabled: false,
    latest: {
      roundId: "round-42",
      challenger: {
        schemaVersion: 1,
        challengerKey: "structural-center-v1",
        modelVersion: "trajectory-direction-structural-v1",
        status: "ready",
        reason: null,
        direction: "up",
        probabilities: null,
        selection: { eligible: true },
      },
      champion: {
        modelVersion: "trajectory-shadow-adaptive-v2",
        status: "ready",
        direction: "down",
      },
    },
    metrics,
  };

  assert.notEqual(normalize(ready), null);
  assert.equal(normalize({ ...ready, advisoryOnly: false }), null);
  assert.equal(normalize({ ...ready, executionEnabled: true }), null);
  assert.equal(normalize({ ...ready, mode: "observation" }), null);

  const withUngradable = structuredClone(ready);
  Object.assign(withUngradable.metrics, {
    evaluatedSelected: 1,
    settledSelected: 2,
    pendingSelected: 1,
    ungradableSelected: 1,
    hits: 1,
    selectiveAccuracy: 1,
    paired: {
      count: 1,
      challengerHits: 1,
      championHits: 0,
      challengerRate: 1,
      championRate: 0,
      uplift: 1,
      bothHit: 0,
      challengerOnly: 1,
      championOnly: 0,
      bothWrong: 0,
      discordantCount: 1,
    },
  });
  assert.notEqual(normalize(withUngradable), null);
  assert.equal(normalize({
    ...withUngradable,
    metrics: { ...withUngradable.metrics, settledSelected: 1 },
  }), null);

  render(ready, "round-42");
  assert.match(elements.trajectoryDirectionChallenger.textContent, /Проверяемая альтернатива: вверх/);
  assert.match(elements.trajectoryDirectionChallenger.textContent, /Не заменяет Adaptive v2/);
  assert.match(elements.trajectoryDirectionChallenger.textContent, /вероятность не рассчитана/);
  assert.match(elements.trajectoryDirectionChallenger.textContent, /Проспективно: 1\/2 \(50,0\s?%\)/);
  assert.match(elements.trajectoryDirectionChallenger.textContent, /отбор 3\/4 \(75,0\s?%\)/);
  assert.match(elements.trajectoryDirectionChallenger.textContent, /Пары с Adaptive v2: альтернатива 1\/2/);
  assert.doesNotMatch(elements.trajectoryDirectionChallenger.textContent, /альтернатива: вниз/);

  render(ready, "round-43");
  assert.match(elements.trajectoryDirectionChallenger.textContent, /для текущего раунда ещё не зафиксирована/);
  assert.doesNotMatch(elements.trajectoryDirectionChallenger.textContent, /1\/2|вверх/);

  for (const [reason, text] of [
    ["start_within_center_band", /старт был в центральной зоне/],
    ["lock_within_center_band", /lock оказался в центральной зоне/],
    ["center_side_changed", /цена пересекла центр/],
  ]) {
    const unselected = structuredClone(ready);
    Object.assign(unselected.latest.challenger, {
      status: "unselected",
      reason,
      direction: null,
      selection: { eligible: false },
    });
    render(unselected, "round-42");
    assert.match(elements.trajectoryDirectionChallenger.textContent, text);
    assert.match(elements.trajectoryDirectionChallenger.textContent, /Adaptive v2 не заменён/);
  }

  const unavailable = structuredClone(ready);
  Object.assign(unavailable.latest.challenger, {
    status: "unavailable",
    reason: "invalid_core",
    direction: null,
    selection: { eligible: false },
  });
  render(unavailable, "round-42");
  assert.match(elements.trajectoryDirectionChallenger.textContent, /недоступна для этого снимка/);

  const missing = structuredClone(ready);
  missing.latest.challenger = null;
  render(missing, "round-42");
  assert.match(elements.trajectoryDirectionChallenger.textContent, /ещё не зафиксирована/);

  render(ready, "round-42");
  render(ready, "round-42", { failed: true });
  assert.match(elements.trajectoryDirectionChallenger.textContent, /скрыта: её данные не обновились/);
  assert.doesNotMatch(elements.trajectoryDirectionChallenger.textContent, /1\/2|вверх|75/);
});

test("trajectory forecast hides every stale value when dashboard state did not refresh", () => {
  const functionStart = app.indexOf("  function renderTrajectoryShadow(value, metricsValue");
  const functionEnd = app.indexOf("\n\n  function sameEntityId", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);

  const target = () => ({ textContent: "stale", title: "stale" });
  const elements = {
    trajectoryShadowPanel: { setAttribute() {} },
    trajectoryShadowBadge: target(),
    trajectoryShadowObserved: target(),
    trajectoryShadowStatus: target(),
    trajectoryShadowShares: target(),
    trajectoryShadowNumberArea: target(),
    trajectoryShadowTraining: target(),
    trajectoryShadowRangeMetrics: target(),
    trajectoryShadowSample: target(),
  };
  const build = new Function(
    "normalizedTrajectoryShadow",
    "normalizedTrajectoryMetrics",
    "elements",
    "setTextIfChanged",
    `"use strict"; ${app.slice(functionStart, functionEnd)}; return renderTrajectoryShadow;`,
  );
  const render = build(
    () => ({ direction: "up", observedChange: { startPrice: 5.1, endPrice: 5.2 } }),
    () => ({ rank37Top1Hits: 99 }),
    elements,
    (element, value) => { element.textContent = value; },
  );

  render({ stale: true }, { stale: true }, { failed: true });

  assert.equal(elements.trajectoryShadowBadge.textContent, "Не обновлено");
  assert.match(elements.trajectoryShadowStatus.textContent, /Прогноз lock → ed скрыт/);
  assert.equal(
    elements.trajectoryShadowNumberArea.textContent,
    "ПРОГНОЗ УЧАСТКА: ДАННЫЕ НЕ ОБНОВЛЕНЫ",
  );
  const renderedText = Object.values(elements)
    .map((element) => element.textContent || "")
    .join(" ");
  assert.doesNotMatch(renderedText, /5[,.][12]|вверх|99/);
});

test("preclose trajectory metrics never turn an API failure into plausible zeroes", () => {
  const functionStart = app.indexOf("  function renderPrecloseTrajectoryMetrics(");
  const functionEnd = app.indexOf("  function renderPrecloseForecast()", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const elements = {
    precloseSampleCount: { textContent: "0 из 100", title: "stale" },
    precloseTop3Rate: { textContent: "0 из 0 · мало данных" },
  };
  const build = new Function(
    "elements",
    `"use strict"; ${app.slice(functionStart, functionEnd)}; return renderPrecloseTrajectoryMetrics;`,
  );

  build(elements)({ rank37EvaluatedCount: 0, rank37Top3Hits: 0 }, { failed: true });

  assert.equal(elements.precloseSampleCount.textContent, "—");
  assert.equal(elements.precloseSampleCount.title, "Статистика Rank‑37 не обновлена.");
  assert.equal(elements.precloseTop3Rate.textContent, "Не обновлено");
});

test("trajectory number area display keeps at most six cells around q50", () => {
  const functionStart = app.indexOf("  function trajectoryNumberAreaDisplayCells(area) {");
  const functionEnd = app.indexOf("\n\n  function trajectoryNumberAreaText(shadow)", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const functionSource = app.slice(functionStart, functionEnd);
  const build = new Function(
    "TRAJECTORY_NUMBER_AREA_MAX_DISPLAY_CELLS",
    `"use strict"; ${functionSource}; return { trajectoryNumberAreaDisplayCells, trajectoryShadowDisplayCells };`,
  );
  const {
    trajectoryNumberAreaDisplayCells: displayCells,
    trajectoryShadowDisplayCells: shadowDisplayCells,
  } = build(6);
  const point = (wireCell) => ({
    wireCell,
    number: wireCell === 37 ? 0 : wireCell,
  });
  const area = (from, to, typical) => ({
    typical: point(typical),
    corridor: {
      cells: Array.from({ length: to - from + 1 }, (_, index) => point(from + index)),
    },
  });

  assert.deepEqual(displayCells(area(13, 17, 15)).map(({ wireCell }) => wireCell), [13, 14, 15, 16, 17]);
  assert.deepEqual(displayCells(area(13, 18, 15)).map(({ wireCell }) => wireCell), [13, 14, 15, 16, 17, 18]);
  assert.deepEqual(displayCells(area(13, 19, 16)).map(({ wireCell }) => wireCell), [14, 15, 16, 17, 18, 19]);
  assert.deepEqual(displayCells(area(0, 20, 10)).map(({ wireCell }) => wireCell), [8, 9, 10, 11, 12, 13]);
  assert.deepEqual(displayCells(area(0, 20, 0)).map(({ wireCell }) => wireCell), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(displayCells(area(20, 37, 37)).map(({ wireCell }) => wireCell), [32, 33, 34, 35, 36, 37]);
  assert.deepEqual(displayCells(area(10, 20, 9)), []);

  const frozenInput = area(5, 25, 15);
  const before = structuredClone(frozenInput);
  displayCells(frozenInput);
  assert.deepEqual(frozenInput, before);

  const legacy = { isAdaptive: false, numberArea: area(5, 25, 15) };
  assert.deepEqual(
    shadowDisplayCells(legacy).map(({ wireCell }) => wireCell),
    [13, 14, 15, 16, 17, 18],
  );
  const frozenRange = [point(0), point(1), point(2)];
  const adaptive = {
    isAdaptive: true,
    numberArea: area(5, 25, 15),
    displayRange: { cells: frozenRange },
  };
  assert.equal(shadowDisplayCells(adaptive), frozenRange);
});

test("adaptive trajectory display range accepts only the frozen contiguous max-six contract", () => {
  const functionStart = app.indexOf("  function normalizedTrajectoryWirePoint(point) {");
  const functionEnd = app.indexOf("\n\n  function normalizedTrajectoryAdaptive(value)", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const functionSource = app.slice(functionStart, functionEnd);
  const build = new Function(
    "TRAJECTORY_NUMBER_AREA_VERSION",
    "TRAJECTORY_DISPLAY_RANGE_VERSION",
    "TRAJECTORY_DISPLAY_RANGE_POLICY",
    "TRAJECTORY_NUMBER_AREA_MAX_DISPLAY_CELLS",
    `"use strict"; ${functionSource}; return normalizedTrajectoryDisplayRange;`,
  );
  const normalize = build(
    "trajectory-number-area-v1",
    "trajectory-display-range-v1",
    "q50-centered-contiguous-max6-v1",
    6,
  );
  const point = (wireCell) => ({
    wireCell,
    number: wireCell === 37 ? 0 : wireCell,
  });
  const area = (from, to, typical) => ({
    typical: point(typical),
    corridor: {
      top: point(from),
      bottom: point(to),
      cells: Array.from({ length: to - from + 1 }, (_, index) => point(from + index)),
    },
  });
  const range = (from, to) => ({
    version: "trajectory-display-range-v1",
    policy: "q50-centered-contiguous-max6-v1",
    maxCells: 6,
    top: point(from),
    bottom: point(to),
    cells: Array.from({ length: to - from + 1 }, (_, index) => point(from + index)),
  });

  assert.deepEqual(
    normalize(range(0, 5), area(0, 20, 0)).cells.map(({ wireCell }) => wireCell),
    [0, 1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    normalize(range(32, 37), area(20, 37, 37)).cells.map(({ wireCell }) => wireCell),
    [32, 33, 34, 35, 36, 37],
  );
  assert.deepEqual(
    normalize(range(1, 6), area(0, 20, 3)).cells.map(({ wireCell }) => wireCell),
    [1, 2, 3, 4, 5, 6],
  );
  assert.equal(normalize(range(0, 6), area(0, 20, 3)), null);
  assert.equal(normalize(range(0, 5), area(0, 20, 3)), null);
  assert.equal(normalize(range(0, 5), area(0, 20, 10)), null);
  assert.equal(
    normalize({ ...range(0, 5), maxCells: "6" }, area(0, 20, 0)),
    null,
  );
});

test("observed trajectory change is frozen separately from the lock-to-ed forecast", () => {
  const functionStart = app.indexOf("  function normalizedTrajectoryObservedChange(value) {");
  const functionEnd = app.indexOf("\n\n  function normalizedTrajectoryNumberArea", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const normalize = new Function(
    `"use strict"; ${app.slice(functionStart, functionEnd)}; return normalizedTrajectoryObservedChange;`,
  )();
  const point = (second, price) => ({
    at: `2026-10-14T12:00:${String(second).padStart(2, "0")}.000Z`,
    price,
  });
  const input = (endPrice) => ({
    cutoffAt: "2026-10-14T12:00:10.000Z",
    lockPrice: endPrice,
    medianCellWidth: 0.01,
    parameters: { flatThresholdCellWidths: 0.5 },
    currentPrefix: [
      point(0, 5.2),
      point(5, 5.21),
      point(10, endPrice),
    ],
  });

  const up = normalize(input(5.23));
  assert.equal(up.direction, "up");
  assert.equal(up.startPrice, 5.2);
  assert.equal(up.endPrice, 5.23);
  assert.equal(up.pointCount, 3);
  assert.equal(normalize(input(5.19)).direction, "down");
  assert.equal(normalize(input(5.204)).direction, "flat");
  assert.equal(normalize({ ...input(5.23), lockPrice: 5.230000001 }).direction, "up");
  assert.equal(normalize({ ...input(5.23), lockPrice: 5.24 }), null);
  const exactBoundary = {
    cutoffAt: "2026-10-14T12:00:10.000Z",
    lockPrice: 1.5,
    medianCellWidth: 1,
    parameters: { flatThresholdCellWidths: 0.5 },
    currentPrefix: [point(0, 1), point(5, 1.25), point(10, 1.5)],
  };
  assert.equal(normalize(exactBoundary).direction, "flat");
  assert.equal(normalize({
    ...exactBoundary,
    lockPrice: 1,
    currentPrefix: [point(0, 1.5), point(5, 1.25), point(10, 1)],
  }).direction, "flat");
  assert.equal(normalize({ ...input(5.23), currentPrefix: [point(10, 5.23)] }), null);
  assert.equal(normalize({
    ...input(5.23),
    currentPrefix: [point(0, 5.2), point(5, 5.21), point(5, 5.23)],
  }), null);
  assert.equal(normalize({
    ...input(5.23),
    currentPrefix: [point(0, 5.2), point(10, 5.21), point(5, 5.23)],
  }), null);
  assert.equal(normalize({
    ...input(5.23),
    currentPrefix: [point(0, 5.2), point(5, 5.21), point(11, 5.23)],
  }), null);
});

test("adaptive trajectory metrics fail closed on inconsistent prospective counts", () => {
  const functionStart = app.indexOf("  function normalizedTrajectoryMetrics(value) {");
  const functionEnd = app.indexOf("\n\n  function normalizedTrajectoryShadow(value)", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const functionSource = app.slice(functionStart, functionEnd);
  const build = new Function(
    "TRAJECTORY_SHADOW_ADAPTIVE_VERSION",
    "TRAJECTORY_DISPLAY_RANGE_VERSION",
    "TRAJECTORY_RANK37_VERSION",
    "TRAJECTORY_RANK37_BASIS",
    `"use strict"; ${functionSource}; return normalizedTrajectoryMetrics;`,
  );
  const normalize = build(
    "trajectory-shadow-adaptive-v2",
    "trajectory-display-range-v1",
    "trajectory-rank37-v1",
    "adaptive-weighted-neighbor-delta-to-current-bands",
  );
  const valid = {
    modelVersion: "trajectory-shadow-adaptive-v2",
    displayRangeVersion: "trajectory-display-range-v1",
    rank37Version: "trajectory-rank37-v1",
    rank37Basis: "adaptive-weighted-neighbor-delta-to-current-bands",
    readyCount: 5,
    settledCount: 4,
    pendingCount: 1,
    evaluatedCount: 3,
    ungradableCount: 1,
    displayRangeHits: 2,
    q50ExactHits: 1,
    fullCorridorHits: 3,
    rank37ReadyCount: 5,
    rank37SettledCount: 4,
    rank37PendingCount: 1,
    rank37EvaluatedCount: 3,
    rank37UngradableCount: 1,
    rank37Top1Hits: 1,
    rank37Top3Hits: 2,
    displayRangeRate: 2 / 3,
    q50ExactRate: 1 / 3,
    fullCorridorRate: 1,
    rank37Top1Rate: 1 / 3,
    rank37Top3Rate: 2 / 3,
    coverageRate: 3 / 4,
  };

  assert.deepEqual(normalize(valid), {
    rank37Version: "trajectory-rank37-v1",
    rank37Basis: "adaptive-weighted-neighbor-delta-to-current-bands",
    readyCount: 5,
    settledCount: 4,
    pendingCount: 1,
    evaluatedCount: 3,
    ungradableCount: 1,
    displayRangeHits: 2,
    q50ExactHits: 1,
    fullCorridorHits: 3,
    rank37ReadyCount: 5,
    rank37SettledCount: 4,
    rank37PendingCount: 1,
    rank37EvaluatedCount: 3,
    rank37UngradableCount: 1,
    rank37Top1Hits: 1,
    rank37Top3Hits: 2,
    displayRangeRate: 2 / 3,
    q50ExactRate: 1 / 3,
    fullCorridorRate: 1,
    rank37Top1Rate: 1 / 3,
    rank37Top3Rate: 2 / 3,
    coverageRate: 3 / 4,
  });
  assert.equal(normalize({ ...valid, evaluatedCount: 4 }), null);
  assert.equal(normalize({ ...valid, displayRangeRate: 0.5 }), null);
  assert.equal(normalize({ ...valid, readyCount: "5" }), null);
  assert.equal(normalize({ ...valid, rank37ReadyCount: 6 }), null);
  assert.equal(normalize({ ...valid, rank37SettledCount: 5, rank37PendingCount: 0 }), null);
  assert.equal(normalize({ ...valid, rank37EvaluatedCount: 4, rank37UngradableCount: 0 }), null);
});

test("trajectory shadow normalizer keeps legacy v1 readable and requires frozen v2 fields", () => {
  const functionStart = app.indexOf("  function normalizedTrajectoryWirePoint(point) {");
  const functionEnd = app.indexOf("\n\n  function trajectoryNumberAreaLabel(point)", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const functionSource = app.slice(functionStart, functionEnd);
  const build = new Function(
    "TRAJECTORY_SHADOW_LEGACY_VERSION",
    "TRAJECTORY_SHADOW_ADAPTIVE_VERSION",
    "TRAJECTORY_NUMBER_AREA_VERSION",
    "TRAJECTORY_DISPLAY_RANGE_VERSION",
    "TRAJECTORY_DISPLAY_RANGE_POLICY",
    "TRAJECTORY_NUMBER_AREA_MAX_DISPLAY_CELLS",
    "TRAJECTORY_SHADOW_DIRECTION_LABELS",
    `"use strict"; ${functionSource}; return normalizedTrajectoryShadow;`,
  );
  const normalize = build(
    "trajectory-shadow-knn-v1",
    "trajectory-shadow-adaptive-v2",
    "trajectory-number-area-v1",
    "trajectory-display-range-v1",
    "q50-centered-contiguous-max6-v1",
    6,
    { up: "вверх", down: "вниз", flat: "без движения" },
  );
  const point = (wireCell) => ({
    wireCell,
    number: wireCell === 37 ? 0 : wireCell,
  });
  const cells = Array.from({ length: 6 }, (_, wireCell) => point(wireCell));
  const numberArea = {
    version: "trajectory-number-area-v1",
    basis: "weighted-neighbor-delta-q20-q50-q80",
    centralWeight: 0.6,
    scale: "wire-cell-top-to-bottom",
    current: point(2),
    typical: {
      ...point(2),
      price: 1,
      deltaCellWidths: 0,
      direction: "flat",
      agreesWithDirection: false,
    },
    corridor: {
      lowerQuantile: 0.2,
      upperQuantile: 0.8,
      top: point(0),
      bottom: point(5),
      cells,
    },
  };
  const sample = {
    historyCount: 30,
    eligibleCount: 30,
    excludedNotPastCount: 0,
    withinDistanceCount: 10,
    neighborCount: 10,
    requiredHistory: 30,
    requiredNeighbors: 10,
  };
  const base = {
    status: "ready",
    direction: "down",
    probabilities: { up: 0.3, down: 0.5, flat: 0.2 },
    cutoffAt: "2026-10-14T12:00:10.000Z",
    lockPrice: 1,
    medianCellWidth: 0.1,
    parameters: { flatThresholdCellWidths: 0.5 },
    currentPrefix: [
      { at: "2026-10-14T12:00:00.000Z", price: 0.8 },
      { at: "2026-10-14T12:00:05.000Z", price: 0.9 },
      { at: "2026-10-14T12:00:10.000Z", price: 1 },
    ],
    sample,
    numberArea,
    evaluation: null,
  };

  const legacy = normalize({
    ...base,
    version: "trajectory-shadow-knn-v1",
    modelVersion: "trajectory-shadow-knn-v1",
  });
  assert.equal(legacy.isAdaptive, false);
  assert.equal(legacy.displayRange, null);
  assert.equal(legacy.direction, "down");
  assert.equal(legacy.observedChange.direction, "up");

  const displayRange = {
    version: "trajectory-display-range-v1",
    policy: "q50-centered-contiguous-max6-v1",
    maxCells: 6,
    top: point(0),
    bottom: point(5),
    cells,
  };
  const adaptiveInput = {
    ...base,
    version: "trajectory-shadow-adaptive-v2",
    modelVersion: "trajectory-shadow-adaptive-v2",
    adaptive: { trainingCount: 4 },
    displayRange,
  };
  const adaptive = normalize(adaptiveInput);
  assert.equal(adaptive.isAdaptive, true);
  assert.equal(adaptive.adaptive.trainingCount, 4);
  assert.equal(adaptive.direction, "down");
  assert.equal(adaptive.observedChange.direction, "up");
  assert.deepEqual(adaptive.displayRange.cells, cells);
  const priceLessSettlement = normalize({
    ...adaptiveInput,
    evaluation: {
      rawCell: 2,
      displayRangeHit: true,
      q50ExactHit: true,
      fullCorridorHit: true,
      directionHit: null,
    },
  });
  assert.notEqual(priceLessSettlement, null);
  assert.deepEqual(priceLessSettlement.evaluation, {
    rawCell: 2,
    displayRangeHit: true,
    q50ExactHit: true,
    fullCorridorHit: true,
    directionHit: null,
  });
  assert.equal(normalize({ ...adaptiveInput, displayRange: null }), null);
  assert.equal(normalize({ ...adaptiveInput, adaptive: null }), null);
  assert.equal(normalize({ ...adaptiveInput, adaptive: { trainingCount: "4" } }), null);
  assert.equal(normalize({ ...adaptiveInput, currentPrefix: [] }), null);
  assert.equal(normalize({ ...adaptiveInput, lockPrice: 1.1 }), null);
});

test("trajectory evaluation distinguishes both zero bands and leaves missing raw cells ungraded", () => {
  const functionStart = app.indexOf("  function normalizedTrajectoryEvaluation(value, { numberArea, displayRange }) {");
  const functionEnd = app.indexOf("\n\n  function normalizedTrajectoryMetrics(value)", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const functionSource = app.slice(functionStart, functionEnd);
  const normalize = new Function(
    `"use strict"; ${functionSource}; return normalizedTrajectoryEvaluation;`,
  )();
  const point = (wireCell) => ({
    wireCell,
    number: wireCell === 37 ? 0 : wireCell,
  });
  const context = (from, to, typical) => {
    const cells = Array.from(
      { length: to - from + 1 },
      (_, index) => point(from + index),
    );
    return {
      numberArea: { typical: point(typical), corridor: { cells } },
      displayRange: { cells },
    };
  };

  assert.deepEqual(
    normalize({
      rawCell: 0,
      displayRangeHit: true,
      q50ExactHit: true,
      fullCorridorHit: true,
      directionHit: true,
    }, context(0, 5, 0)),
    {
      rawCell: 0,
      displayRangeHit: true,
      q50ExactHit: true,
      fullCorridorHit: true,
      directionHit: true,
    },
  );
  assert.deepEqual(
    normalize({
      rawCell: 37,
      displayRangeHit: true,
      q50ExactHit: true,
      fullCorridorHit: true,
      directionHit: false,
    }, context(32, 37, 37)),
    {
      rawCell: 37,
      displayRangeHit: true,
      q50ExactHit: true,
      fullCorridorHit: true,
      directionHit: false,
    },
  );
  assert.deepEqual(
    normalize({
      rawCell: 2,
      displayRangeHit: true,
      q50ExactHit: true,
      fullCorridorHit: true,
      directionHit: null,
    }, context(0, 5, 2)),
    {
      rawCell: 2,
      displayRangeHit: true,
      q50ExactHit: true,
      fullCorridorHit: true,
      directionHit: null,
    },
  );
  assert.deepEqual(
    normalize({
      rawCell: null,
      displayRangeHit: null,
      q50ExactHit: null,
      fullCorridorHit: null,
      directionHit: true,
    }, context(0, 5, 0)),
    {
      rawCell: null,
      displayRangeHit: null,
      q50ExactHit: null,
      fullCorridorHit: null,
      directionHit: true,
    },
  );
  assert.equal(
    normalize({
      rawCell: null,
      displayRangeHit: false,
      q50ExactHit: null,
      fullCorridorHit: null,
      directionHit: true,
    }, context(0, 5, 0)),
    false,
  );
});

test("top-5 horizon block stays hidden while preserving renderer targets and cumulative horizons", () => {
  for (const id of [
    "follower-horizon",
    "follower-horizon-list",
    "follower-horizon-status",
    "follower-horizon-note",
  ]) {
    assert.match(html, new RegExp(`\\bid="${id}"`));
  }
  assert.match(html, /id="follower-horizon"[^>]*\bhidden\b/);
  assert.match(app, /const FOLLOWER_HIT_HORIZONS = \[1, 2, 3, 5, 10, 20\]/);
  assert.match(app, /top5HitByHorizon/);
  assert.match(app, /follower-top5-walk-forward-v1/);
  assert.match(app, /случайная база/);
  assert.match(html, /Ретроспективная реконструкция/);
});

test("warm next-round forecast exposes a strict 5-percent walk-forward contract", () => {
  for (const id of [
    "follower-dynamic-next",
    "follower-dynamic-next-status",
    "follower-dynamic-next-hits",
    "follower-dynamic-next-misses",
    "follower-dynamic-next-rate",
    "follower-dynamic-next-sample",
    "follower-dynamic-next-source",
    "follower-dynamic-next-picks",
    "follower-dynamic-next-current-meta",
    "follower-dynamic-next-audit",
  ]) {
    assert.match(html, new RegExp(`\\bid="${id}"`));
    assert.match(app, new RegExp(`getElementById\\("${id}"\\)`));
  }

  assert.match(app, /const FOLLOWER_WARM_THRESHOLD = 0\.05/);
  assert.match(app, /function normalizedFollowerWarmNextRound\(\)/);
  assert.match(app, /follower-warm-top5-next-v1/);
  assert.match(app, /anchors-with-known-next-round/);
  assert.match(
    app,
    /candidate\.occurrenceCount \* 100 >= sampleSize \* 5/,
  );
  assert.match(app, /\["ready", "no_signal", "waiting_training", "gap", "empty"\]/);
  assert.match(app, /function renderFollowerWarmCurrent\(signal\)/);
  assert.match(app, /function renderFollowerDynamicNext\(\)/);
  assert.match(
    app,
    /function renderFollowerHitCurve\(\) \{\s*renderFollowerDynamicNext\(\);/,
  );
  assert.match(html, /id="follower-dynamic-next-title"[^>]*>[^<]*≥5%/);
  assert.match(html, /id="follower-dynamic-next-note"[^>]*>[\s\S]*?5%/);
  assert.match(html, /styles\.css\?v=34/);
  assert.match(html, /app\.js\?v=52/);
  assert.match(styles, /\.follower-dynamic-next\s*\{/);
  assert.match(styles, /\.follower-warm-current\s*\{/);
  assert.match(styles, /\.follower-warm-picks\s*\{/);
  assert.match(styles, /\.follower-dynamic-next__metrics\s*\{/);
  assert.match(
    styles,
    /@media \(max-width: 680px\)[\s\S]*?\.follower-warm-picks\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  );
});

test("raw dynamic top-5 archival account uses one strict shared ticket ladder", () => {
  for (const id of [
    "follower-warm-account",
    "follower-warm-account-status",
    "follower-warm-account-balance",
    "follower-warm-account-result-card",
    "follower-warm-account-result",
    "follower-warm-account-bets",
    "follower-warm-account-record",
    "follower-warm-account-drawdown",
    "follower-warm-account-risk",
    "follower-warm-account-audit",
  ]) {
    assert.match(html, new RegExp(`\\bid="${id}"`));
    assert.match(app, new RegExp(`getElementById\\("${id}"\\)`));
  }

  assert.match(app, /function normalizedFollowerWarmHistoricalAccount\(value, currentSignal\)/);
  assert.match(app, /follower-warm-top5-ladder-v2/);
  assert.match(app, /strategy\?\.selectionMode !== "dynamic-top5"/);
  assert.match(app, /strategy\?\.selectionCount !== 5/);
  assert.match(app, /strategy\?\.threshold !== null/);
  assert.match(app, /eligibleAnchorPolicy !== "every-known-next"/);
  assert.match(app, /gapPolicy !== "reset-ladder-keep-balance"/);
  assert.match(app, /exhaustionPolicy !== "permanent-stop"/);
  assert.match(app, /model\?\.modelVersion !== "2\.0\.0"/);
  assert.match(app, /model\?\.initialStakePerNumber !== 10/);
  assert.match(app, /model\?\.stakeStepPerNumber !== 10/);
  assert.match(app, /model\?\.maxStakePerNumber !== 2_500/);
  assert.match(app, /model\?\.numbersPerRound !== 5/);
  assert.match(app, /model\?\.grossPayoutMultiplier !== 36/);
  assert.match(app, /model\?\.netHitMultiplier !== 31/);
  assert.match(app, /value\.executionEnabled !== false/);
  assert.match(app, /initialBalance !== 10_000/);
  assert.match(app, /nextRoundCost !== expectedNextRoundCost/);
  assert.match(app, /betCount \+ skippedAfterExhaustionCount !== eligibleAnchorCount/);
  assert.match(app, /totalGrossPayout - totalStaked !== netResult/);
  assert.match(app, /ladderTotalLoss \/ \(model\.netHitMultiplier \* model\.stakeStepPerNumber\)/);
  assert.match(app, /\["ready", "no_signal"\]\.includes\(currentSignal\?\.status\)/);
  assert.match(app, /currentSignal\.candidates\.map\(\(\{ number \}\) => number\)/);
  assert.match(app, /historicalAccount\.eligibleAnchorCount === eligibleCount/);
  assert.match(app, /function renderFollowerWarmHistoricalAccount\(account,/);
  assert.doesNotMatch(app, /"Для счёта"|выбран для исторического счёта|is-account-pick/);
  assert.doesNotMatch(styles, /\.follower-warm-pick\.is-account-pick|\.follower-warm-pick__account/);
  assert.match(html, /Архивная симуляция · динамический Top‑5/);
  assert.match(html, /Исторический счёт общего билета/);
  assert.match(html, /Билеты Top‑5/);
  assert.match(html, /старт 10 000/);
  assert.match(html, /Счёт начинается с 10 000 условных единиц/);
  assert.doesNotMatch(html, /Счёт начинается с 1 000 условных единиц/);
  assert.match(html, /на каждое из 5 чисел необрезанного динамического Top‑5/);
  assert.match(html, /старт по 10 \(билет 50\), шаг по 10, максимум по 2 500 \(билет 12 500\)/);
  assert.match(html, /×36 начисляется только на одно выигравшее число/);
  assert.match(html, /коэффициент восстановления равен 31/);
  assert.match(html, /Порог ≥5% относится только к тёплому прогнозу выше/);
  assert.match(styles, /\.follower-warm-account\s*\{/);
  assert.match(styles, /\.follower-warm-account__metrics\s*\{/);
  assert.match(
    styles,
    /@media \(max-width: 680px\)[\s\S]*?\.follower-warm-account__metrics\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    styles,
    /@media \(max-width: 360px\)[\s\S]*?\.follower-warm-account__metrics\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
  );
});

test("live fixed top-5 account gates one shared ticket ladder on cumulative 80 percent", () => {
  for (const id of [
    "follower-live-account",
    "follower-live-account-status",
    "follower-live-account-balance",
    "follower-live-account-result-card",
    "follower-live-account-result",
    "follower-live-account-last-stake",
    "follower-live-account-last-stake-detail",
    "follower-live-account-bets",
    "follower-live-account-record",
    "follower-live-account-stake",
    "follower-live-account-ticket",
    "follower-live-account-gate",
    "follower-live-account-audit",
  ]) {
    assert.match(html, new RegExp(`\\bid="${id}"`));
    assert.match(app, new RegExp(`getElementById\\("${id}"\\)`));
  }
  assert.match(html, /\bid="follower-live-account-note"/);

  assert.match(app, /const FOLLOWER_LIVE_ACCOUNT_THRESHOLD = 0\.8/);
  assert.match(app, /function normalizedFollowerLiveGateEvidence\(value\)/);
  assert.match(app, /function normalizedFollowerLiveGatedAccount\(value, currentSession, trackerStatus\)/);
  assert.match(app, /follower-top5-cumulative80-ladder-v1/);
  assert.match(app, /persisted-session-retrospective/);
  assert.match(app, /thresholdMetric !== "cumulative-hit-by-attempt"/);
  assert.match(app, /evaluationTiming !== "pre-attempt-walk-forward"/);
  assert.match(app, /startPolicy !== "latch-for-session"/);
  assert.match(app, /noCrossingPolicy !== "observe-only"/);
  assert.match(app, /initialBalance !== 10_000/);
  assert.match(app, /trackedAttemptCount !== observedWithoutBetCount \+ eligibleBetCount/);
  assert.match(app, /eligibleBetCount !== betCount \+ skippedAfterExhaustionCount/);
  assert.match(app, /hitCount \+ missCount !== betCount/);
  assert.match(app, /startEvidence\.rate < strategy\.threshold/);
  assert.match(app, /function renderFollowerLiveGatedAccount\(account,/);
  assert.match(app, /renderFollowerLiveGatedAccount\(tracker\.gatedAccount, \{ stale \}\)/);
  assert.match(app, /followerLiveAccountLastStake,[\s\S]*?formatRiskAmount\(account\.latestOutcome\.totalStake\)/);
  assert.match(app, /followerLiveAccountLastStakeDetail,[\s\S]*?account\.latestOutcome\.stakePerNumber/);
  assert.match(app, /liveGatePercentFormatter/);
  assert.match(html, /Счёт с накопительным порогом 80%/);
  assert.match(html, /Последний разыгранный билет/);
  assert.match(html, /Разыгранных билетов ещё нет/);
  assert.match(html, /Порог 80% — накопительная архивная доля/);
  assert.match(html, /а не вероятность следующего раунда/);
  assert.match(html, /Независимый шанс попадания пяти чисел[^<]*5 из 37/);
  assert.match(html, /с 10 000 условных единиц/);
  assert.match(html, /одна общая лестница/);
  assert.match(html, /одинаково на все 5 зафиксированных чисел/);
  assert.match(html, /чистый коэффициент восстановления равен 31/);
  assert.match(styles, /\.follower-live-account\s*\{/);
  assert.match(styles, /\.follower-live-account__metrics\s*\{/);
  assert.match(
    styles,
    /@media \(max-width: 680px\)[\s\S]*?\.follower-live-account__metrics\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    styles,
    /@media \(max-width: 360px\)[\s\S]*?\.follower-live-account__metrics\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
  );
});

test("full-cycle comparison block stays hidden while preserving every renderer target", () => {
  const rendererIds = [
    "cycle-comparison-panel",
    "cycle-comparison-badge",
    "cycle-comparison-status",
    "cycle-comparison-current-title",
    "cycle-comparison-current-meta",
    "cycle-comparison-current-sequence",
    "cycle-comparison-analogue-card",
    "cycle-comparison-analogue-title",
    "cycle-comparison-analogue-meta",
    "cycle-comparison-metrics",
    "cycle-comparison-anchor-meta",
    "cycle-comparison-analogue-sequence",
    "cycle-comparison-continuation",
    "cycle-comparison-continuation-meta",
    "cycle-comparison-continuation-sequence",
  ];
  const semanticIds = [
    "cycle-comparison-title",
    "cycle-comparison-anchor-title",
    "cycle-comparison-continuation-title",
    "cycle-comparison-note",
  ];

  for (const id of [...rendererIds, ...semanticIds]) {
    assert.match(html, new RegExp(`\\bid="${id}"`));
  }
  for (const id of rendererIds) {
    assert.match(app, new RegExp(`getElementById\\("${id}"\\)`));
  }

  assert.match(
    html,
    /<section class="overview-grid"[\s\S]*?<section class="panel cycle-comparison-panel"[\s\S]*?<section class="panel preclose-panel"/,
  );
  assert.match(html, /id="cycle-comparison-panel"[^>]*\bhidden\b/);
  assert.match(html, /id="cycle-comparison-status" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html, /id="cycle-comparison-panel"[\s\S]*?aria-busy="true"/);
  assert.match(html, /id="cycle-comparison-current-sequence"[\s\S]*?aria-busy="true"/);
});

test("cycle analogue uses the fixed 20-draw contract and renders the entire archive tail", () => {
  assert.match(app, /const CYCLE_COMPARISON_ANCHOR_DRAWS = 20/);
  assert.match(app, /const CYCLE_COMPARISON_ALGORITHM_VERSION = "cycle-analogue-prefix-v1"/);
  assert.match(app, /url: "\/api\/cycle-comparison"/);
  assert.match(app, /value\.schemaVersion !== 1/);
  assert.match(app, /value\.algorithmVersion !== CYCLE_COMPARISON_ALGORITHM_VERSION/);
  assert.match(app, /value\.interpretation !== "descriptive-not-predictive"/);
  assert.match(app, /\["ready", "collecting_anchor", "unavailable", "integrity_gap"\]/);
  assert.match(app, /analogue\.events\.slice\(0, comparison\.anchorDrawCount\)/);
  assert.match(app, /analogue\.events\.slice\(comparison\.anchorDrawCount\)/);
  assert.match(app, /compareEvents: comparison\.target\.events/);
  assert.match(app, /is-position-match/);
  assert.match(app, /is-position-mismatch/);
  assert.match(app, /buildCycleStageMarker/);
  assert.match(app, /stageMarker\.position === event\.position/);
  assert.match(app, /markerRole: "current"/);
  assert.match(app, /markerRole: "reference"/);
  assert.match(app, /aria-current/);
  assert.match(app, /Сейчас сравниваем/);
  assert.match(app, /Исторический аналог завершился на ходе/);
  assert.match(styles, /\.cycle-sequence-event\.is-stage-marker/);
  assert.match(styles, /\.cycle-sequence-event\.is-marker-red/);
  assert.match(styles, /\.cycle-sequence-event\.is-marker-black/);
  assert.match(styles, /\.cycle-sequence-event\.is-marker-green/);
  assert.match(app, /не меняется до завершения круга/);
  assert.match(app, /function renderCycleComparison\(value\)/);
  assert.match(app, /setCycleComparisonState\("loading"/);
  assert.match(app, /setCycleComparisonState\(\s*"error"/);
  assert.match(app, /setCycleComparisonState\(\s*"stale"/);
  assert.match(app, /state = "collecting"/);
  assert.ok(
    [...app.matchAll(/renderCycleComparison\(store\.cycleComparison\)/g)].length >= 2,
    "comparison must render on normal and failed refresh paths",
  );
});

test("cycle comparison language is descriptive, responsive, and cache-busted", () => {
  const blockStart = html.indexOf('id="cycle-comparison-panel"');
  const blockEnd = html.indexOf('id="preclose-panel"');
  const block = html.slice(blockStart, blockEnd);

  assert.ok(blockStart >= 0 && blockEnd > blockStart);
  assert.match(block, /не прогноз/);
  assert.match(block, /не предсказывает следующее число/);
  assert.doesNotMatch(block, /должн/iu);
  assert.match(html, /href="\/styles\.css\?v=34"/);
  assert.match(html, /src="\/app\.js\?v=52"/);
  assert.match(styles, /\.cycle-sequence-list\s*\{[\s\S]*?repeat\(auto-fill, minmax\(50px, 1fr\)\)/);
  assert.match(
    styles,
    /@media \(max-width: 680px\)[\s\S]*?\.cycle-sequence-list\s*\{\s*grid-template-columns: repeat\(5, minmax\(42px, 1fr\)\)/,
  );
  assert.match(
    styles,
    /@media \(max-width: 430px\)[\s\S]*?\.cycle-sequence-list\s*\{\s*grid-template-columns: repeat\(4, minmax\(40px, 1fr\)\)/,
  );
});
