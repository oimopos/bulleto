import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createDatabase } from "../src/database.js";

const ROOT_DIR = fileURLToPath(new URL("../", import.meta.url));
const BASE_TIME = Date.parse("2026-10-10T00:00:00.000Z");
const SOURCE = "buleto";
const INSTRUMENT = "PRIMECOIN(XPM)/RUB";
const quietLogger = { info() {}, warn() {}, error() {} };

function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function resultEvent(resultNumber, fingerprint, offsetSeconds = 0, extra = {}) {
  const settledAt = iso(BASE_TIME + offsetSeconds * 1_000);
  return {
    source: SOURCE,
    instrument: INSTRUMENT,
    settledAt,
    resultNumber,
    price: 5.4 + offsetSeconds / 10_000,
    observedAt: settledAt,
    fingerprint,
    rawPayload: { c: resultNumber },
    ...extra,
  };
}

function forecast(externalRoundId, overrides = {}) {
  const bettingClosesAt = iso(BASE_TIME + 60_000);
  const lockedAt = iso(BASE_TIME + 51_000);
  const factorAt = lockedAt;
  return {
    source: SOURCE,
    instrument: INSTRUMENT,
    externalRoundId,
    horizonSeconds: 8,
    bettingClosesAt,
    roundEndsAt: iso(BASE_TIME + 100_000),
    factorAt,
    lockedAt,
    currentPrice: 5.4,
    startPrice: 5.35,
    currentNumber: 11,
    predictedPrice: 5.41,
    predictedNumber: 7,
    rankedNumbers: [7, 11, 19],
    cells: Array.from({ length: 38 }, (_, code) => ({
      c: code,
      vt: 6 - code / 100,
      vf: 5.99 - code / 100,
    })),
    features: {
      samples: [
        { dt: iso(BASE_TIME + 47_000), v: 5.38 },
        { dt: iso(BASE_TIME + 49_000), v: 5.39 },
        { dt: factorAt, v: 5.4 },
      ],
      windowSeconds: 4,
      slopePerSecond: 0.005,
      secondsToEnd: 46,
    },
    modelVersion: "preclose-linear-v1",
    ...overrides,
  };
}

function trajectory(
  externalRoundId,
  {
    startsAtMs,
    receivedAtMs = startsAtMs + 51_000,
    cells = forecast(externalRoundId).cells,
    factors = [],
  },
) {
  return {
    schemaVersion: 1,
    source: SOURCE,
    instrument: INSTRUMENT,
    receivedAt: iso(receivedAtMs),
    round: {
      externalRoundId: String(externalRoundId),
      status: 2,
      startsAt: iso(startsAtMs),
      bettingClosesAt: iso(startsAtMs + 60_000),
      bettingStopsAt: iso(startsAtMs + 70_000),
      endsAt: iso(startsAtMs + 100_000),
      startPrice: 5.35,
      bottomPrice: 5,
      topPrice: 6.1,
      cellBands: cells.map((cell) => ({
        wireCell: cell.c,
        number: cell.c === 37 ? 0 : cell.c,
        lower: cell.vf,
        upper: cell.vt,
      })),
    },
    factors: factors.map((factor) => ({
      at: iso(factor.atMs),
      price: factor.price,
      receivedAt: iso(factor.receivedAtMs ?? factor.atMs),
    })),
  };
}

function completePrefix(startsAtMs) {
  return [
    ...[1, 5, 10, 15, 20, 25, 30, 35, 40, 45].map((seconds) => ({
      atMs: startsAtMs + seconds * 1_000,
      price: 5.3 + seconds * 0.0006,
    })),
    { atMs: startsAtMs + 50_000, price: 5.33 },
    {
      atMs: startsAtMs + 50_000,
      price: 5.34,
      receivedAtMs: startsAtMs + 51_000,
    },
  ];
}

function markObservedRows(database, fingerprintPrefix) {
  database.sqlite
    .prepare(`
      UPDATE round_results
      SET created_at = observed_at
      WHERE fingerprint LIKE ?
    `)
    .run(`${fingerprintPrefix}%`);
}

const PRESERVED_TABLES = Object.freeze({
  results: ["round_results", "id"],
  trajectories: ["round_trajectories", "id"],
  trajectoryTicks: ["round_trajectory_ticks", "id"],
  forecastSnapshots: ["forecast_snapshots", "id"],
  forecasts: ["round_forecasts", "id"],
  pairForecasts: ["forecast_pair_snapshots", "forecast_id"],
  consensusForecasts: ["forecast_consensus_snapshots", "forecast_id"],
  trajectoryShadows: ["forecast_trajectory_shadows", "forecast_id"],
  leaders: ["forecast_predictive_leader_snapshots", "forecast_id"],
  settlements: ["forecast_settlements", "forecast_id"],
  accounts: ["predictive_leader_accounts", "source, instrument"],
  bets: ["predictive_leader_account_bets", "forecast_id"],
  resets: ["predictive_leader_account_ladder_resets", "id"],
});

function preservedRows(database) {
  return Object.fromEntries(
    Object.entries(PRESERVED_TABLES).map(([name, [table, orderBy]]) => [
      name,
      database.sqlite
        .prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`)
        .all()
        .map((row) => ({ ...row })),
    ]),
  );
}

function modelEvidence(state) {
  const shadow = state.latest.trajectoryShadow;
  const leader = state.latest.predictiveLeader;
  return {
    historyCount: shadow.sample.historyCount,
    eligibleCount: shadow.sample.eligibleCount,
    neighborCount: shadow.sample.neighborCount,
    queriedCandidateCount: shadow.integration.queriedCandidateCount,
    usableHistoryCount: shadow.integration.usableHistoryCount,
    queriedLearningRowCount: shadow.integration.queriedLearningRowCount,
    usableLearningRowCount: shadow.integration.usableLearningRowCount,
    experts: shadow.adaptive.experts.map((expert) => ({ ...expert })),
    leaderTrainingCount: leader.learning.trainingCount,
    leaderTrainingThroughForecastId: leader.learning.trainingThroughForecastId,
    leaderTrainingThroughResultId: leader.learning.trainingThroughResultId,
  };
}

function frozenRows(database, forecastId) {
  return {
    shadow: {
      ...database.sqlite
        .prepare("SELECT * FROM forecast_trajectory_shadows WHERE forecast_id = ?")
        .get(forecastId),
    },
    leader: {
      ...database.sqlite
        .prepare("SELECT * FROM forecast_predictive_leader_snapshots WHERE forecast_id = ?")
        .get(forecastId),
    },
  };
}

async function availablePort() {
  const probe = createNetServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  assert.ok(address && typeof address === "object");
  const { port } = address;
  await new Promise((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntilReady(baseUrl, child, logs) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited before becoming ready\n${logs()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/live`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // The child has not bound its port yet.
    }
    await delay(50);
  }
  throw new Error(`server did not become ready in time\n${logs()}`);
}

async function settlesWithin(promise, milliseconds) {
  let timeout;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve(false), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exitPromise = once(child, "exit");
  child.kill("SIGTERM");
  if (await settlesWithin(exitPromise, 5_000)) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    child.kill("SIGKILL");
  }
  assert.equal(await settlesWithin(exitPromise, 5_000), true);
}

test(
  "predictive model history, frozen outputs, account ledger, and reset audit survive reopen and lightweight reads",
  { timeout: 120_000 },
  async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "roulette-leader-preservation-"));
    const databasePath = join(directory, "preservation.sqlite");
    let clockMs = BASE_TIME + 10_000;
    let database = createDatabase({
      path: databasePath,
      clock: () => new Date(clockMs),
      logger: quietLogger,
    });
    let child = null;
    let stdout = "";
    let stderr = "";

    try {
      database.ingestBatch(
        [9, 4, 9, 4, 9, 5, 9].map((number, index) => resultEvent(
          number,
          `preservation-leader-history-${index}`,
          index,
          { externalRoundId: String(100 + index) },
        )),
      );
      markObservedRows(database, "preservation-leader-history-");

      clockMs = BASE_TIME + 52_000;
      assert.equal(database.recordPrecloseForecast(forecast("107")).inserted, true);
      const firstAccount = database.getPrecloseForecastState(SOURCE, INSTRUMENT)
        .predictiveLeaderAccount;
      assert.equal(firstAccount.status, "pending");
      const missResult = (firstAccount.pendingBet.targetNumber + 1) % 37;

      clockMs = BASE_TIME + 101_000;
      database.ingestBatch([resultEvent(
        missResult,
        "preservation-first-miss",
        100,
        { externalRoundId: "107" },
      )]);
      markObservedRows(database, "preservation-first-miss");
      assert.equal(database.settlePrecloseForecasts(SOURCE, INSTRUMENT).settled, 1);
      assert.equal(database.settlePredictiveLeaderAccount(SOURCE, INSTRUMENT).settled, 1);

      // Re-run only the one-time v19 migration so this fixture contains the
      // same immutable reset audit row as an upgraded production database.
      database.sqlite.exec("PRAGMA user_version = 18");
      database.close();
      clockMs += 1_000;
      database = createDatabase({
        path: databasePath,
        clock: () => new Date(clockMs),
        logger: quietLogger,
      });
      assert.equal(database.applyPredictiveLeaderAccountReset(SOURCE, INSTRUMENT).applied, 1);

      const currentStartMs = BASE_TIME + 4_000_000;
      const currentLockedMs = currentStartMs + 51_000;
      const numberAreaCells = Array.from({ length: 38 }, (_, wireCell) => ({
        c: wireCell,
        vt: 5.6 - wireCell / 100,
        vf: 5.59 - wireCell / 100,
      }));
      const historicalResults = [];
      for (let index = 0; index < 30; index += 1) {
        const roundId = String(200 + index);
        const fingerprint = `preservation-trajectory-history-${index}`;
        const startsAtMs = currentStartMs - (30 - index) * 120_000;
        clockMs = startsAtMs + 51_100;
        database.recordRoundTrajectory(trajectory(roundId, {
          startsAtMs,
          factors: completePrefix(startsAtMs),
        }));
        const historyNumber = [9, 4, 9, 4, 9, 5, 9][index % 7];
        historicalResults.push(resultEvent(historyNumber, fingerprint, 0, {
          externalRoundId: roundId,
          settledAt: iso(startsAtMs + 100_000),
          observedAt: iso(startsAtMs + 100_000),
          price: index >= 26 ? 5.22 : 5.36,
        }));
      }
      database.ingestBatch(historicalResults);
      markObservedRows(database, "preservation-trajectory-history-");

      const currentRoundId = "230";
      clockMs = currentLockedMs + 100;
      database.recordRoundTrajectory(trajectory(currentRoundId, {
        startsAtMs: currentStartMs,
        cells: numberAreaCells,
        factors: completePrefix(currentStartMs),
      }));
      clockMs = currentLockedMs + 2_000;
      const trajectoryBuildStartedAt = performance.now();
      const trajectoryBuild = database.recordPrecloseForecast(forecast(
        currentRoundId,
        {
          bettingClosesAt: iso(currentStartMs + 60_000),
          roundEndsAt: iso(currentStartMs + 100_000),
          factorAt: iso(currentLockedMs),
          lockedAt: iso(currentLockedMs),
          currentPrice: 5.34,
          startPrice: 5.35,
          cells: numberAreaCells,
        },
      ));
      const trajectoryBuildElapsedMs = performance.now() - trajectoryBuildStartedAt;
      assert.equal(trajectoryBuild.inserted, true);
      assert.equal(Number.isFinite(trajectoryBuildElapsedMs), true);
      assert.ok(trajectoryBuildElapsedMs >= 0);

      const beforeState = database.getPrecloseForecastState(SOURCE, INSTRUMENT);
      assert.equal(
        beforeState.latest.trajectoryShadow.status,
        "ready",
        JSON.stringify(beforeState.latest.trajectoryShadow),
      );
      assert.equal(
        beforeState.latest.predictiveLeader.status,
        "ready",
        JSON.stringify(beforeState.latest.predictiveLeader),
      );
      assert.equal(beforeState.latest.trajectoryShadow.sample.historyCount, 30);
      assert.equal(
        beforeState.latest.trajectoryShadow.integration.queriedCandidateCount,
        30,
      );
      assert.equal(
        beforeState.latest.trajectoryShadow.integration.usableHistoryCount,
        30,
      );
      assert.equal(beforeState.latest.trajectoryShadow.adaptive.experts.length, 3);
      assert.equal(beforeState.predictiveLeaderAccount.status, "pending");
      assert.equal(beforeState.predictiveLeaderAccount.pendingBet.stake, 10);

      const latestForecastId = beforeState.latest.id;
      const beforeRows = preservedRows(database);
      const beforeFrozen = frozenRows(database, latestForecastId);
      const beforeEvidence = modelEvidence(beforeState);
      const beforeReadState = database.getPredictiveLeaderReadState(
        SOURCE,
        INSTRUMENT,
      );
      const beforeJsonState = JSON.parse(JSON.stringify(beforeState));
      assert.equal(beforeRows.resets.length, 1);
      assert.equal(beforeRows.resets[0].status, "applied");
      assert.equal(beforeRows.bets.length, 2);
      assert.deepEqual(
        beforeReadState.precloseForecast.latest.predictiveLeader,
        beforeState.latest.predictiveLeader,
      );
      assert.deepEqual(
        beforeReadState.precloseForecast.predictiveLeaderAccount,
        beforeState.predictiveLeaderAccount,
      );
      assert.deepEqual(
        beforeReadState.precloseForecast.predictiveLeaderMetrics,
        beforeState.predictiveLeaderMetrics,
      );

      database.close();
      database = createDatabase({
        path: databasePath,
        clock: () => new Date(clockMs + 1_000),
        logger: quietLogger,
      });

      const reopenedState = database.getPrecloseForecastState(SOURCE, INSTRUMENT);
      const reopenedRows = preservedRows(database);
      const reopenedEvidence = modelEvidence(reopenedState);
      assert.deepEqual(reopenedRows, beforeRows);
      for (const name of Object.keys(PRESERVED_TABLES)) {
        assert.equal(
          reopenedRows[name].length,
          beforeRows[name].length,
          `${name} row count must not decrease after reopen`,
        );
      }
      assert.deepEqual(frozenRows(database, latestForecastId), beforeFrozen);
      assert.deepEqual(reopenedState, beforeState);
      assert.deepEqual(reopenedEvidence, beforeEvidence);
      assert.deepEqual(
        database.getPredictiveLeaderReadState(SOURCE, INSTRUMENT),
        beforeReadState,
      );
      assert.equal(
        reopenedEvidence.queriedCandidateCount,
        beforeEvidence.queriedCandidateCount,
      );
      assert.equal(reopenedEvidence.usableHistoryCount, beforeEvidence.usableHistoryCount);
      assert.equal(reopenedEvidence.experts.length, beforeEvidence.experts.length);
      assert.equal(
        reopenedEvidence.leaderTrainingCount,
        beforeEvidence.leaderTrainingCount,
      );

      // Repeated read/model passes are deliberately checked for exact output
      // and zero writes. A future cache or narrow state path may avoid work,
      // but it may not reduce the evidence used by either frozen model.
      for (let pass = 0; pass < 3; pass += 1) {
        const passState = database.getPrecloseForecastState(SOURCE, INSTRUMENT);
        assert.deepEqual(modelEvidence(passState), beforeEvidence);
        assert.deepEqual(passState.latest.trajectoryShadow, beforeState.latest.trajectoryShadow);
        assert.deepEqual(passState.latest.predictiveLeader, beforeState.latest.predictiveLeader);
      }
      assert.deepEqual(preservedRows(database), beforeRows);
      database.close();

      const port = await availablePort();
      child = spawn(process.execPath, [join(ROOT_DIR, "src", "server.js")], {
        cwd: ROOT_DIR,
        env: {
          ...process.env,
          HOST: "127.0.0.1",
          PORT: String(port),
          DATABASE_PATH: databasePath,
          DATABASE_SEED_PATH: "",
          BULETO_INSTRUMENT: INSTRUMENT,
          COLLECTOR_ENABLED: "false",
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout = `${stdout}${chunk}`.slice(-32_768);
      });
      child.stderr.on("data", (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-32_768);
      });
      const baseUrl = `http://127.0.0.1:${port}`;
      const logs = () => `stdout:\n${stdout}\nstderr:\n${stderr}`;
      await waitUntilReady(baseUrl, child, logs);

      const measureJson = async (pathname) => {
        const startedAt = performance.now();
        const response = await fetch(`${baseUrl}${pathname}`, {
          signal: AbortSignal.timeout(30_000),
        });
        const elapsedMs = performance.now() - startedAt;
        assert.equal(response.status, 200, logs());
        assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/);
        return { elapsedMs, payload: await response.json() };
      };

      const firstLeaderRead = await measureJson("/api/predictive-leader");
      const secondLeaderRead = await measureJson("/api/predictive-leader");
      const trajectoryRead = await measureJson("/api/forecasts");
      for (const measurement of [firstLeaderRead, secondLeaderRead, trajectoryRead]) {
        assert.equal(Number.isFinite(measurement.elapsedMs), true);
        assert.ok(measurement.elapsedMs >= 0);
      }
      t.diagnostic(
        `measurement only (no timing threshold): trajectory build ${trajectoryBuildElapsedMs.toFixed(1)}ms; leader ${firstLeaderRead.elapsedMs.toFixed(1)}ms / ${secondLeaderRead.elapsedMs.toFixed(1)}ms; trajectory read ${trajectoryRead.elapsedMs.toFixed(1)}ms`,
      );
      assert.deepEqual(trajectoryRead.payload, beforeJsonState);
      assert.deepEqual(firstLeaderRead.payload.account, beforeJsonState.predictiveLeaderAccount);
      assert.deepEqual(secondLeaderRead.payload.account, firstLeaderRead.payload.account);
      assert.deepEqual(secondLeaderRead.payload.metrics, firstLeaderRead.payload.metrics);

      await stopChild(child);
      child = null;
      database = createDatabase({
        path: databasePath,
        clock: () => new Date(clockMs + 2_000),
        logger: quietLogger,
      });
      assert.deepEqual(preservedRows(database), beforeRows);
      assert.deepEqual(frozenRows(database, latestForecastId), beforeFrozen);
      const finalState = database.getPrecloseForecastState(SOURCE, INSTRUMENT);
      assert.deepEqual(finalState, beforeState);
      assert.deepEqual(modelEvidence(finalState), beforeEvidence);
    } finally {
      await stopChild(child);
      try {
        database?.close();
      } catch {
        // The fixture may already be closed between reopen phases.
      }
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
