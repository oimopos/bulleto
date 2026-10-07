import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createDatabase } from "../src/database.js";

const ROOT_DIR = fileURLToPath(new URL("../", import.meta.url));
const SOURCE = "buleto";
const INSTRUMENT = "XPM/RUB";
const STARTING_BALANCE = 1_234;
const quietLogger = { info() {}, warn() {}, error() {} };

function resultEvent(offsetSeconds) {
  const settledAt = new Date(
    Date.parse("2026-10-07T00:00:00.000Z") + offsetSeconds * 1_000,
  ).toISOString();
  return {
    source: SOURCE,
    instrument: INSTRUMENT,
    settledAt,
    resultNumber: 1,
    price: 5.4,
    observedAt: settledAt,
    fingerprint: `virtual-api-${offsetSeconds}`,
    rawPayload: { c: 1 },
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
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited before becoming ready\n${logs()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/live`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return;
    } catch {
      // The listener may not have bound its port yet.
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

  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      child.kill("SIGKILL");
    }
    if (!(await settlesWithin(exitPromise, 5_000))) {
      throw new Error(`server process ${child.pid} did not exit`);
    }
  }
}

test(
  "GET /api/virtual-bettor returns the persisted balance and longest current series",
  { timeout: 25_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "roulette-virtual-api-"));
    const databasePath = join(directory, "virtual-api.sqlite");
    let child = null;
    let stdout = "";
    let stderr = "";

    try {
      const database = createDatabase({
        path: databasePath,
        logger: quietLogger,
        virtualStartingBalance: STARTING_BALANCE,
      });
      try {
        database.ingestBatch([resultEvent(0), resultEvent(1), resultEvent(2)]);
      } finally {
        database.close();
      }

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
          VIRTUAL_STARTING_BALANCE: String(STARTING_BALANCE),
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

      const response = await fetch(`${baseUrl}/api/virtual-bettor`);
      assert.equal(response.status, 200, logs());
      assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const payload = await response.json();
      assert.equal(typeof payload.serverTime, "string");
      assert.equal(new Date(payload.serverTime).toISOString(), payload.serverTime);
      assert.equal(typeof payload.bank.startedAt, "string");
      assert.equal(
        new Date(payload.bank.startedAt).toISOString(),
        payload.bank.startedAt,
      );
      assert.deepEqual(payload, {
        mode: "simulation",
        executionEnabled: false,
        status: "waiting",
        currentBalance: STARTING_BALANCE,
        profit: 0,
        bank: {
          status: "running",
          initialBalance: STARTING_BALANCE,
          currentBalance: STARTING_BALANCE,
          profit: 0,
          nextStake: 10,
          canAffordNext: true,
          shortfall: 0,
          startedAt: payload.bank.startedAt,
          exhaustedAt: null,
          dataComplete: true,
        },
        latestResult: {
          id: 3,
          roundId: null,
          number: 1,
          settledAt: "2026-10-07T00:00:02.000Z",
        },
        longestSeries: {
          number: 0,
          progress: 3,
          target: 200,
        },
        activeSession: null,
        lifetime: {
          totalSessions: 0,
          completedSessions: 0,
          invalidatedSessions: 0,
          totalBets: 0,
          winningBets: 0,
          losingBets: 0,
          totalStaked: 0,
          grossPayout: 0,
          netResult: 0,
          profit: 0,
        },
        serverTime: payload.serverTime,
        betting: null,
        signal: {
          action: "WAIT",
          actionable: false,
          reason: "below_threshold",
          actionId: null,
          sessionId: null,
          roundId: null,
          targetNumber: null,
          stake: null,
          attemptNumber: null,
          validUntil: null,
        },
        latestOutcome: null,
      });
    } finally {
      await stopChild(child);
      rmSync(directory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  },
);
