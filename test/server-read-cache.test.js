import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const server = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

function functionSource(name) {
  const start = server.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const bodyStart = server.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < server.length; index += 1) {
    if (server[index] === "{") depth += 1;
    if (server[index] === "}") depth -= 1;
    if (depth === 0) return server.slice(start, index + 1);
  }
  throw new Error(`Could not find the end of ${name}`);
}

function cacheHarness() {
  const start = server.indexOf("const DATABASE_WRITE_UPDATE_REASONS");
  const end = server.indexOf("function securityHeaders", start);
  assert.ok(start >= 0 && end > start, "database cache block must exist");
  const cacheBlock = server.slice(start, end);
  const build = new Function(
    `${cacheBlock}\n${functionSource("broadcastUpdate")}\n`
      + `return {
          broadcastUpdate,
          cachedDatabaseRead,
          invalidateDatabaseReadCache,
          invalidateForecastDatabaseReads,
          generation: () => databaseReadGeneration,
          keys: () => [...databaseReadCache.keys()],
          size: () => databaseReadCache.size,
        };`,
  );
  return build();
}

test("database read cache reuses exact values and never caches failures", () => {
  const cache = cacheHarness();
  let reads = 0;
  const read = () => ({ revision: ++reads });

  const first = cache.cachedDatabaseRead("state", read);
  const second = cache.cachedDatabaseRead("state", read);
  assert.strictEqual(second, first);
  assert.equal(reads, 1);

  assert.throws(
    () => cache.cachedDatabaseRead("failure", () => {
      throw new Error("read failed");
    }),
    /read failed/,
  );
  assert.deepEqual(
    cache.cachedDatabaseRead("failure", () => ({ recovered: true })),
    { recovered: true },
  );
});

test("cache invalidates only for persisted database update reasons", () => {
  const cache = cacheHarness();
  let reads = 0;
  const read = () => ({ revision: ++reads });

  cache.cachedDatabaseRead("state", read);
  for (const reason of ["round", "collector-status", "collector-error", "connected"]) {
    const generation = cache.generation();
    cache.broadcastUpdate(reason);
    assert.equal(cache.generation(), generation, `${reason} must retain DB snapshots`);
    assert.equal(cache.cachedDatabaseRead("state", read).revision, reads);
  }
  assert.equal(reads, 1);

  for (const reason of [
    "gap",
    "results",
    "forecast-settled",
    "predictive-leader-account",
  ]) {
    const generation = cache.generation();
    cache.broadcastUpdate(reason);
    assert.equal(cache.generation(), generation + 1, `${reason} must invalidate DB snapshots`);
    assert.equal(cache.cachedDatabaseRead("state", read).revision, reads);
  }
  assert.equal(reads, 5);

  const generation = cache.generation();
  const unrelated = cache.cachedDatabaseRead("number-stats", () => ({ stable: true }));
  const core = cache.cachedDatabaseRead("dashboard-api-core-state", () => ({ stable: true }));
  cache.cachedDatabaseRead("dashboard-api-state", () => ({ forecast: 1 }));
  cache.cachedDatabaseRead(
    "trajectory-direction-challenger-state:buleto:XPM/RUB",
    () => ({ forecast: 1 }),
  );
  cache.broadcastUpdate("forecast");
  assert.equal(cache.generation(), generation);
  assert.strictEqual(
    cache.cachedDatabaseRead("number-stats", () => ({ stable: false })),
    unrelated,
  );
  assert.strictEqual(
    cache.cachedDatabaseRead("dashboard-api-core-state", () => ({ stable: false })),
    core,
  );
  assert.deepEqual(
    cache.cachedDatabaseRead("dashboard-api-state", () => ({ forecast: 2 })),
    { forecast: 2 },
  );
  assert.deepEqual(
    cache.cachedDatabaseRead(
      "trajectory-direction-challenger-state:buleto:XPM/RUB",
      () => ({ forecast: 2 }),
    ),
    { forecast: 2 },
  );
});

test("idempotent pre-close retries refresh readers only after a durable change", () => {
  const changed = new Function(
    `${functionSource("forecastOutcomeChanged")}; return forecastOutcomeChanged;`,
  )();

  assert.equal(changed({ inserted: true, roundId: "1" }), true);
  assert.equal(changed({ inserted: false, repaired: true, roundId: "1" }), true);
  assert.equal(changed({ inserted: false, roundId: "1" }), false);
  assert.equal(changed(null), false);

  const listenerStart = server.indexOf("collector.on('preclose-forecast'");
  const listenerEnd = server.indexOf("collector.on('round'", listenerStart);
  const listener = server.slice(listenerStart, listenerEnd);
  assert.match(
    listener,
    /if \(forecastOutcomeChanged\(outcome\)\) broadcastUpdate\('forecast'\)/,
  );
  assert.doesNotMatch(listener, /\n\s*broadcastUpdate\('forecast'\);/);
});

test("read cache is bounded and keeps recently used snapshots", () => {
  const cache = cacheHarness();
  for (let index = 0; index < 32; index += 1) {
    cache.cachedDatabaseRead(`key-${index}`, () => index);
  }
  assert.equal(cache.size(), 32);

  cache.cachedDatabaseRead("key-0", () => -1);
  cache.cachedDatabaseRead("key-32", () => 32);
  assert.equal(cache.size(), 32);
  assert.equal(cache.keys().includes("key-0"), true);
  assert.equal(cache.keys().includes("key-1"), false);
});

test("dashboard core excludes the full forecast audit while legacy state keeps it", () => {
  const coreStateStart = server.indexOf("function databaseCoreStateForApi()");
  const coreStateEnd = server.indexOf("function databaseStateForApi()", coreStateStart);
  const coreState = server.slice(coreStateStart, coreStateEnd);
  const databaseStateStart = server.indexOf("function databaseStateForApi()");
  const databaseStateEnd = server.indexOf("function dashboardCoreState()", databaseStateStart);
  const databaseState = server.slice(databaseStateStart, databaseStateEnd);
  const coreRouteStart = server.indexOf("if (pathname === '/api/state/core')");
  const coreRouteEnd = server.indexOf("if (pathname === '/api/state')", coreRouteStart);
  const coreRoute = server.slice(coreRouteStart, coreRouteEnd);
  const forecastsRouteStart = server.indexOf("if (pathname === '/api/forecasts')");
  const forecastsRouteEnd = server.indexOf(
    "if (pathname === '/api/predictive-leader')",
    forecastsRouteStart,
  );
  const forecastsRoute = server.slice(forecastsRouteStart, forecastsRouteEnd);

  assert.doesNotMatch(server, /db\.warmPrecloseForecastValidation\(/);
  assert.match(coreState, /'dashboard-api-core-state'/);
  assert.doesNotMatch(coreState, /precloseForecast|getPrecloseForecastState/);
  assert.match(databaseState, /precloseForecast: precloseForecastStateFromDatabase\(\)/);
  assert.match(coreRoute, /sendJson\(response, 200, dashboardCoreState\(\)\)/);
  assert.match(forecastsRoute, /precloseForecastStateFromDatabase\(\)/);
  assert.match(server, /limit === 80[\s\S]*?'recent-results:default'/);
  assert.match(server, /limit === 20[\s\S]*?'preclose-forecast-hits:default'/);
});
