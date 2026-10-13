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
    "forecast",
    "forecast-settled",
    "predictive-leader-account",
  ]) {
    const generation = cache.generation();
    cache.broadcastUpdate(reason);
    assert.equal(cache.generation(), generation + 1, `${reason} must invalidate DB snapshots`);
    assert.equal(cache.cachedDatabaseRead("state", read).revision, reads);
  }
  assert.equal(reads, 6);
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

test("heavy forecast state is shared and startup never performs a full warmup", () => {
  const databaseStateStart = server.indexOf("function databaseStateForApi()");
  const databaseStateEnd = server.indexOf("function dashboardState()", databaseStateStart);
  const databaseState = server.slice(databaseStateStart, databaseStateEnd);
  const forecastsRouteStart = server.indexOf("if (pathname === '/api/forecasts')");
  const forecastsRouteEnd = server.indexOf(
    "if (pathname === '/api/predictive-leader')",
    forecastsRouteStart,
  );
  const forecastsRoute = server.slice(forecastsRouteStart, forecastsRouteEnd);

  assert.doesNotMatch(server, /db\.warmPrecloseForecastValidation\(/);
  assert.match(databaseState, /precloseForecast: precloseForecastStateFromDatabase\(\)/);
  assert.match(forecastsRoute, /precloseForecastStateFromDatabase\(\)/);
  assert.match(server, /limit === 80[\s\S]*?'recent-results:default'/);
  assert.match(server, /limit === 20[\s\S]*?'preclose-forecast-hits:default'/);
});
