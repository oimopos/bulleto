import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PREDICTIVE_LEADER_V7_CANDIDATE_CONFIG,
  createDatabase,
} from "../src/database.js";
import { LEARNED_LEADER_ALGORITHM_VERSION } from "../src/learned-leader.js";
import { LEARNED_LEADER_V7_ALGORITHM_VERSION } from "../src/learned-leader-v7.js";
import { CURRENT_CELL_HORIZON_SHADOW_ALGORITHM_VERSION } from "../src/current-cell-horizon-shadow.js";
import { PREDICTIVE_LEADER_API_SCHEMA_VERSION } from "../src/predictive-leader-api.js";
import {
  PREDICTIVE_LEADER_V7_PAPER_API_SCHEMA_VERSION,
  PREDICTIVE_LEADER_V7_PAPER_STRATEGY_VERSION,
} from "../src/predictive-leader-v7-paper-api.js";

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
      if (response.ok) {
        const payload = await response.json();
        const trajectoryValidation =
          payload?.startup?.trajectoryValidation?.status
          ?? payload?.startup?.trajectoryValidation;
        if (trajectoryValidation === "ready") return;
      }
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
  "server exposes the current triple follower and persisted virtual state",
  { timeout: 25_000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "roulette-virtual-api-"));
    const databasePath = join(directory, "virtual-api.sqlite");
    let child = null;
    let stdout = "";
    let stderr = "";
    let expectedTripleFollowerSignal = null;

    try {
      const database = createDatabase({
        path: databasePath,
        logger: quietLogger,
        virtualStartingBalance: STARTING_BALANCE,
      });
      try {
        database.ingestBatch([resultEvent(0), resultEvent(1), resultEvent(2)]);
        expectedTripleFollowerSignal = database.getCurrentTripleFollowerSignal(
          SOURCE,
          INSTRUMENT,
        );
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

      const stateResponse = await fetch(`${baseUrl}/api/state`);
      assert.equal(stateResponse.status, 200, logs());
      assert.match(
        stateResponse.headers.get("content-type") ?? "",
        /^application\/json\b/,
      );
      assert.equal(stateResponse.headers.get("cache-control"), "no-store");
      const dashboardState = await stateResponse.json();
      assert.deepEqual(
        dashboardState.tripleFollowerSignal,
        expectedTripleFollowerSignal,
      );
      assert.equal(
        dashboardState.tripleFollowerSignal.historyThrough,
        dashboardState.latestResult.settledAt,
      );
      assert.equal(
        dashboardState.tripleFollowerSignal.anchor.current.resultId,
        dashboardState.latestResult.id,
      );
      assert.ok(Array.isArray(dashboardState.virtualBettor.longestCandidates));
      assert.ok(dashboardState.virtualBettor.longestCandidates.length >= 1);
      assert.deepEqual(
        dashboardState.virtualBettor.longestCandidate,
        dashboardState.virtualBettor.longestCandidates[0],
      );

      const leaderResponse = await fetch(`${baseUrl}/api/predictive-leader`);
      assert.equal(leaderResponse.status, 200, logs());
      assert.match(
        leaderResponse.headers.get("content-type") ?? "",
        /^application\/json\b/,
      );
      assert.equal(leaderResponse.headers.get("cache-control"), "no-store");
      const leaderPayload = await leaderResponse.json();
      assert.equal(
        leaderPayload.schemaVersion,
        PREDICTIVE_LEADER_API_SCHEMA_VERSION,
      );
      assert.equal(
        leaderPayload.algorithmVersion,
        LEARNED_LEADER_ALGORITHM_VERSION,
      );
      assert.equal(leaderPayload.mode, "observation");
      assert.equal(leaderPayload.strategyMode, "quality-gated-simulation");
      assert.equal(leaderPayload.executionEnabled, false);
      assert.equal(leaderPayload.advisoryOnly, true);
      assert.ok(["waiting", "paused"].includes(leaderPayload.status));
      assert.equal(leaderPayload.number, null);
      assert.doesNotMatch(
        JSON.stringify(leaderPayload),
        /ranking|combinedDistribution|familyDistributions|sourceManifest/,
      );

      const leaderHead = await fetch(`${baseUrl}/api/predictive-leader`, {
        method: "HEAD",
      });
      assert.equal(leaderHead.status, 200, logs());
      assert.equal(leaderHead.headers.get("cache-control"), "no-store");
      assert.match(
        leaderHead.headers.get("content-type") ?? "",
        /^application\/json\b/,
      );
      assert.equal(await leaderHead.text(), "");

      const leaderPost = await fetch(`${baseUrl}/api/predictive-leader`, {
        method: "POST",
      });
      assert.equal(leaderPost.status, 405, logs());
      assert.equal(leaderPost.headers.get("cache-control"), "no-store");
      assert.deepEqual(await leaderPost.json(), { error: "Метод не разрешён" });

      const v7Response = await fetch(
        `${baseUrl}/api/predictive-leader/v7-shadow`,
      );
      assert.equal(v7Response.status, 200, logs());
      assert.equal(v7Response.headers.get("cache-control"), "no-store");
      const v7Payload = await v7Response.json();
      assert.equal(v7Payload.schemaVersion, 1);
      assert.equal(v7Payload.algorithmVersion, LEARNED_LEADER_V7_ALGORITHM_VERSION);
      assert.equal(v7Payload.candidateId, PREDICTIVE_LEADER_V7_CANDIDATE_CONFIG.candidateId);
      assert.equal(v7Payload.mode, "prospective-shadow");
      assert.equal(v7Payload.executionEnabled, false);
      assert.equal(v7Payload.advisoryOnly, true);
      assert.equal(v7Payload.latest, null);
      assert.equal(v7Payload.metrics.storedCount, 0);
      assert.equal(v7Payload.qualityGateDiagnostic.status, "collecting");
      assert.equal(v7Payload.qualityGateDiagnostic.fixed.settledCount, 0);
      assert.equal(v7Payload.qualityGateDiagnostic.fixed.top1Hits, 0);
      assert.equal(v7Payload.qualityGateDiagnostic.promotionEligible, false);
      assert.equal(v7Payload.qualityGateDiagnostic.experimentFamilySize, 2);
      assert.equal(v7Payload.qualityGateDiagnostic.perCandidateAlpha, 0.025);

      const v7Head = await fetch(`${baseUrl}/api/predictive-leader/v7-shadow`, {
        method: "HEAD",
      });
      assert.equal(v7Head.status, 200, logs());
      assert.equal(v7Head.headers.get("cache-control"), "no-store");
      assert.equal(await v7Head.text(), "");

      const v7PaperResponse = await fetch(
        `${baseUrl}/api/predictive-leader/v7-paper`,
      );
      assert.equal(v7PaperResponse.status, 200, logs());
      assert.equal(v7PaperResponse.headers.get("cache-control"), "no-store");
      const v7PaperPayload = await v7PaperResponse.json();
      assert.equal(
        v7PaperPayload.schemaVersion,
        PREDICTIVE_LEADER_V7_PAPER_API_SCHEMA_VERSION,
      );
      assert.equal(
        v7PaperPayload.strategyVersion,
        PREDICTIVE_LEADER_V7_PAPER_STRATEGY_VERSION,
      );
      assert.equal(v7PaperPayload.strategyMode, "manual-override-paper");
      assert.equal(v7PaperPayload.executionEnabled, false);
      assert.equal(v7PaperPayload.advisoryOnly, true);
      assert.equal(v7PaperPayload.promotionEligible, false);
      assert.equal(v7PaperPayload.action, "WAIT");
      assert.equal(v7PaperPayload.number, null);
      assert.equal(v7PaperPayload.account.currentBalance, 1_000);
      assert.equal(v7PaperPayload.account.deficit, 0);
      assert.equal(v7PaperPayload.stats.betCount, 0);
      assert.equal(v7PaperPayload.pendingBet, null);
      assert.equal(v7PaperPayload.qualityGateDiagnostic.role, "audit-only");
      assert.equal(
        v7PaperPayload.qualityGateDiagnostic.controlsPaperAction,
        false,
      );

      const v7PaperHead = await fetch(
        `${baseUrl}/api/predictive-leader/v7-paper`,
        { method: "HEAD" },
      );
      assert.equal(v7PaperHead.status, 200, logs());
      assert.equal(v7PaperHead.headers.get("cache-control"), "no-store");
      assert.equal(await v7PaperHead.text(), "");

      const v7PaperPost = await fetch(
        `${baseUrl}/api/predictive-leader/v7-paper`,
        { method: "POST" },
      );
      assert.equal(v7PaperPost.status, 405, logs());

      const currentCellResponse = await fetch(
        `${baseUrl}/api/predictive-leader/current-cell-10s-shadow`,
      );
      assert.equal(currentCellResponse.status, 200, logs());
      assert.equal(currentCellResponse.headers.get("cache-control"), "no-store");
      const currentCellPayload = await currentCellResponse.json();
      assert.equal(currentCellPayload.schemaVersion, 1);
      assert.equal(
        currentCellPayload.algorithmVersion,
        CURRENT_CELL_HORIZON_SHADOW_ALGORITHM_VERSION,
      );
      assert.equal(currentCellPayload.mode, "prospective-shadow");
      assert.equal(currentCellPayload.executionEnabled, false);
      assert.equal(currentCellPayload.advisoryOnly, true);
      assert.equal(currentCellPayload.latest, null);
      assert.equal(currentCellPayload.metrics.storedCount, 0);
      assert.equal(currentCellPayload.metrics.pairedV5.pairedCount, 0);
      assert.equal(currentCellPayload.qualityGateDiagnostic.status, "collecting");
      assert.equal(currentCellPayload.qualityGateDiagnostic.fixed.settledCount, 0);
      assert.equal(currentCellPayload.qualityGateDiagnostic.fixed.top1Hits, 0);
      assert.equal(currentCellPayload.qualityGateDiagnostic.promotionEligible, false);
      assert.equal(currentCellPayload.qualityGateDiagnostic.experimentFamilySize, 2);
      assert.equal(currentCellPayload.qualityGateDiagnostic.perCandidateAlpha, 0.025);
      assert.equal(
        currentCellPayload.qualityGateDiagnostic.multiplicityPolicy,
        "bonferroni-two-prospective-candidates",
      );
      assert.equal(currentCellPayload.paperSimulation.stakePerRound, 10);
      assert.equal(currentCellPayload.paperSimulation.grossPayoutMultiplier, 36);

      const currentCellHead = await fetch(
        `${baseUrl}/api/predictive-leader/current-cell-10s-shadow`,
        { method: "HEAD" },
      );
      assert.equal(currentCellHead.status, 200, logs());
      assert.equal(currentCellHead.headers.get("cache-control"), "no-store");
      assert.equal(await currentCellHead.text(), "");

      const currentCellPost = await fetch(
        `${baseUrl}/api/predictive-leader/current-cell-10s-shadow`,
        { method: "POST" },
      );
      assert.equal(currentCellPost.status, 405, logs());
      assert.deepEqual(await currentCellPost.json(), { error: "Метод не разрешён" });

      const backtestResponse = await fetch(
        `${baseUrl}/api/trajectory-range-backtest`,
      );
      assert.equal(backtestResponse.status, 200, logs());
      assert.equal(backtestResponse.headers.get("cache-control"), "no-store");
      const backtest = await backtestResponse.json();
      assert.equal(backtest.schemaVersion, 1);
      assert.equal(backtest.mode, "retrospective-simulation");
      assert.equal(
        backtest.strategyMode,
        "frozen-trajectory-display-range-ladder",
      );
      assert.equal(backtest.executionEnabled, false);
      assert.equal(backtest.advisoryOnly, true);
      assert.equal(backtest.initialBalance, 1_000);
      assert.equal(backtest.finalBalance, 1_000);
      assert.equal(backtest.betCount, 0);
      assert.equal(backtest.coverage.requestedRoundCount, 100);
      assert.equal(backtest.coverage.roundCount, 3);
      assert.equal(backtest.coverage.unavailableRangeCount, 3);
      assert.deepEqual(
        backtest.rounds.map((round) => round.status),
        ["skipped", "skipped", "skipped"],
      );

      const backtestHead = await fetch(
        `${baseUrl}/api/trajectory-range-backtest`,
        { method: "HEAD" },
      );
      assert.equal(backtestHead.status, 200, logs());
      assert.equal(backtestHead.headers.get("cache-control"), "no-store");
      assert.equal(await backtestHead.text(), "");

      const neighborSince = new Date(Date.now() - 60 * 60 * 1_000).toISOString();
      const neighborUrl = `${baseUrl}/api/predictive-leader-neighbor-backtest?since=${encodeURIComponent(neighborSince)}`;
      const neighborResponse = await fetch(neighborUrl);
      assert.equal(neighborResponse.status, 200, logs());
      assert.equal(neighborResponse.headers.get("cache-control"), "no-store");
      const neighborBacktest = await neighborResponse.json();
      assert.equal(neighborBacktest.schemaVersion, 1);
      assert.equal(neighborBacktest.mode, "retrospective-simulation");
      assert.equal(
        neighborBacktest.strategyMode,
        "frozen-predictive-leader-numeric-neighbor-ladder",
      );
      assert.equal(neighborBacktest.executionEnabled, false);
      assert.equal(neighborBacktest.advisoryOnly, true);
      assert.equal(neighborBacktest.window.since, neighborSince);
      assert.equal(neighborBacktest.window.lowerBound, "inclusive");
      assert.equal(neighborBacktest.window.upperBound, "exclusive");
      assert.equal(neighborBacktest.initialBalance, 1_000);
      assert.equal(neighborBacktest.finalBalance, 1_000);
      assert.equal(neighborBacktest.betCount, 0);
      assert.equal(neighborBacktest.coverage.roundCount, 0);

      const neighborHead = await fetch(neighborUrl, { method: "HEAD" });
      assert.equal(neighborHead.status, 200, logs());
      assert.equal(neighborHead.headers.get("cache-control"), "no-store");
      assert.equal(await neighborHead.text(), "");

      const missingSince = await fetch(
        `${baseUrl}/api/predictive-leader-neighbor-backtest`,
      );
      assert.equal(missingSince.status, 400, logs());
      assert.deepEqual(await missingSince.json(), {
        error: "invalid_query",
        reason: "exactly_one_since_parameter_required",
      });

      const nonCanonicalSince = await fetch(
        `${baseUrl}/api/predictive-leader-neighbor-backtest?since=${encodeURIComponent("2026-10-17T00:00:00+05:00")}`,
      );
      assert.equal(nonCanonicalSince.status, 400, logs());
      assert.deepEqual(await nonCanonicalSince.json(), {
        error: "invalid_query",
        reason: "since_must_be_canonical_utc_iso",
      });

      const futureSince = new Date(Date.now() + 60_000).toISOString();
      const futureResponse = await fetch(
        `${baseUrl}/api/predictive-leader-neighbor-backtest?since=${encodeURIComponent(futureSince)}`,
      );
      assert.equal(futureResponse.status, 400, logs());
      assert.deepEqual(await futureResponse.json(), {
        error: "invalid_query",
        reason: "since_must_not_be_in_the_future",
      });

      const staleSince = new Date(Date.now() - 49 * 60 * 60 * 1_000).toISOString();
      const staleResponse = await fetch(
        `${baseUrl}/api/predictive-leader-neighbor-backtest?since=${encodeURIComponent(staleSince)}`,
      );
      assert.equal(staleResponse.status, 400, logs());
      assert.deepEqual(await staleResponse.json(), {
        error: "invalid_query",
        reason: "window_must_not_exceed_48_hours",
      });

      const duplicateSince = await fetch(`${neighborUrl}&since=${encodeURIComponent(neighborSince)}`);
      assert.equal(duplicateSince.status, 400, logs());
      assert.deepEqual(await duplicateSince.json(), {
        error: "invalid_query",
        reason: "exactly_one_since_parameter_required",
      });

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

      const gatedResponse = await fetch(`${baseUrl}/api/follower-top5-gated`);
      assert.equal(gatedResponse.status, 200, logs());
      assert.match(
        gatedResponse.headers.get("content-type") ?? "",
        /^application\/json\b/,
      );
      assert.equal(gatedResponse.headers.get("cache-control"), "no-store");
      const gated = await gatedResponse.json();
      assert.equal(new Date(gated.serverTime).toISOString(), gated.serverTime);
      assert.equal(
        new Date(gated.account.latestDeposit.depositedAt).toISOString(),
        gated.account.latestDeposit.depositedAt,
      );
      assert.deepEqual(gated, {
        schemaVersion: 1,
        algorithmVersion: "follower-top5-cumulative80-ladder-v1",
        mode: "persisted-session-retrospective",
        executionEnabled: false,
        advisoryOnly: true,
        source: SOURCE,
        instrument: INSTRUMENT,
        status: "waiting",
        currentBalance: 60_000,
        profit: 0,
        serverTime: gated.serverTime,
        strategy: {
          selectionMode: "frozen-top5",
          selectionCount: 5,
          thresholdMetric: "cumulative-hit-by-attempt",
          threshold: 0.8,
          comparison: "gte",
          cohort: "anchors-with-complete-20-round-window",
          maximumCalibratedAttempt: 20,
          evaluationTiming: "pre-attempt-walk-forward",
          startPolicy: "latch-for-session",
          noCrossingPolicy: "observe-only",
          minimumEligibleCount: 1,
        },
        model: {
          modelVersion: "2.0.0",
          initialStakePerNumber: 10,
          stakeStepPerNumber: 10,
          maxStakePerNumber: 2_500,
          numbersPerRound: 5,
          grossPayoutMultiplier: 36,
          netHitMultiplier: 31,
          payoutIncludesStake: true,
        },
        account: {
          status: "waiting",
          initialBalance: 10_000,
          totalDeposits: 50_000,
          contributedBalance: 60_000,
          depositCount: 1,
          latestDeposit: {
            depositKey: "manual-top-up-2026-10-15-50000",
            amount: 50_000,
            afterResultId: 3,
            balanceBefore: 10_000,
            balanceAfter: 60_000,
            depositedAt: gated.account.latestDeposit.depositedAt,
          },
          currentBalance: 60_000,
          profit: 0,
          nextStakePerNumber: 10,
          nextRoundCost: 50,
          canAffordNextRound: true,
          shortfall: 0,
          ladder: { missCount: 0, totalLoss: 0 },
          dataComplete: true,
        },
        gate: {
          thresholdMetric: "cumulative-hit-by-attempt",
          threshold: 0.8,
          comparison: "gte",
          maximumCalibratedAttempt: 20,
          bettingStarted: false,
          startAttempt: null,
          startEvidence: null,
          currentEvidence: null,
        },
        currentAttempt: null,
        freshness: {
          trackerSynced: false,
          trackerResultId: null,
          latestPersistedResultId: 3,
          latestPersistedRoundId: null,
          latestPersistedAt: "2026-10-07T00:00:02.000Z",
          currentRoundId: null,
          expectedRoundId: null,
          collectorLastResultAt: null,
          roundCursorMatches: false,
          resultConfirmationPending: false,
          pendingResultCount: 0,
          persistencePendingResults: 0,
          persistencePendingGaps: 0,
        },
        latestResult: {
          id: 3,
          roundId: null,
          number: 1,
          settledAt: "2026-10-07T00:00:02.000Z",
        },
        betting: null,
        signal: {
          action: "WAIT",
          actionable: false,
          reason: "waiting_training",
          actionId: null,
          sessionId: null,
          attemptNumber: null,
          roundId: null,
          targetNumbers: [],
          stakePerNumber: null,
          totalStake: null,
          thresholdEvidence: null,
          validUntil: null,
        },
        latestOutcome: null,
      });

      const gatedHead = await fetch(`${baseUrl}/api/follower-top5-gated`, {
        method: "HEAD",
      });
      assert.equal(gatedHead.status, 200, logs());
      assert.equal(gatedHead.headers.get("cache-control"), "no-store");
      assert.match(
        gatedHead.headers.get("content-type") ?? "",
        /^application\/json\b/,
      );
      assert.equal(await gatedHead.text(), "");

      const gatedPost = await fetch(`${baseUrl}/api/follower-top5-gated`, {
        method: "POST",
      });
      assert.equal(gatedPost.status, 405, logs());
      assert.equal(gatedPost.headers.get("cache-control"), "no-store");
      assert.deepEqual(await gatedPost.json(), { error: "Метод не разрешён" });
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
