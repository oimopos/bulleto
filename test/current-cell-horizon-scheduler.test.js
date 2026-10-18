import assert from "node:assert/strict";
import test from "node:test";

import {
  CURRENT_CELL_HORIZON_SCHEDULER_CONFIG,
  createCurrentCellHorizonScheduler,
  createCurrentCellMetadataConflictRetryQueue,
  currentCellHorizonRoundKey,
} from "../src/current-cell-horizon-scheduler.js";

const BASE_MS = Date.parse("2026-10-18T10:00:00.000Z");

function round(externalRoundId = "round-1", closesMs = BASE_MS + 20_000) {
  return {
    source: "buleto",
    instrument: "roulette",
    externalRoundId,
    bettingClosesAt: new Date(closesMs).toISOString(),
  };
}

function fakeRuntime(initialMs = BASE_MS) {
  let nowMs = initialMs;
  let sequence = 0;
  let unrefCount = 0;
  let clearCount = 0;
  const timers = new Map();

  function setTimeout(callback, delayMs) {
    const handle = {
      id: ++sequence,
      unref() {
        unrefCount += 1;
      },
    };
    timers.set(handle.id, {
      callback,
      delayMs,
      dueMs: nowMs + delayMs,
      handle,
    });
    return handle;
  }

  function clearTimeout(handle) {
    clearCount += 1;
    timers.delete(handle?.id);
  }

  function nextTimer() {
    return [...timers.values()].sort((left, right) => (
      left.dueMs - right.dueMs || left.handle.id - right.handle.id
    ))[0] ?? null;
  }

  async function flush() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  async function fireNext() {
    const timer = nextTimer();
    assert.ok(timer, "expected a pending timer");
    timers.delete(timer.handle.id);
    timer.callback();
    await flush();
  }

  async function advanceTo(targetMs) {
    assert.ok(targetMs >= nowMs, "fake clock can only advance here");
    nowMs = targetMs;
    while (nextTimer()?.dueMs <= nowMs) await fireNext();
    await flush();
  }

  return {
    clock: () => nowMs,
    setTimeout,
    clearTimeout,
    setNow(value) {
      nowMs = value;
    },
    fireNext,
    advanceTo,
    pending() {
      return [...timers.values()].sort((left, right) => left.dueMs - right.dueMs);
    },
    get unrefCount() {
      return unrefCount;
    },
    get clearCount() {
      return clearCount;
    },
  };
}

test("metadata conflict queue retries SQLITE_BUSY and broadcasts after persistence", async () => {
  const runtime = fakeRuntime();
  const conflict = {
    source: "buleto",
    instrument: "roulette",
    externalRoundId: "conflicted",
    originalBettingClosesAt: "2026-10-18T10:00:20.000Z",
    observedBettingClosesAt: "2026-10-18T10:00:30.000Z",
    observedAt: "2026-10-18T10:00:01.000Z",
  };
  let attempts = 0;
  let changedCount = 0;
  const transientFailures = [];
  const queue = createCurrentCellMetadataConflictRetryQueue({
    persist(value) {
      attempts += 1;
      assert.deepEqual(value, conflict);
      if (attempts === 1) {
        const error = new Error("database is locked");
        error.code = "ERR_SQLITE_ERROR";
        error.errcode = 5;
        throw error;
      }
      return { databaseChanged: true };
    },
    isTransientError: (error) => (
      error?.code === "ERR_SQLITE_ERROR" && error.errcode === 5
    ),
    onDatabaseChanged() {
      changedCount += 1;
    },
    onTransientError(error, value, failureCount) {
      transientFailures.push({ error, value, failureCount });
    },
    setTimeout: runtime.setTimeout,
    clearTimeout: runtime.clearTimeout,
    retryDelayMs: 25,
    maxRetryDelayMs: 25,
  });

  assert.equal(queue.enqueue(conflict), false);
  assert.equal(queue.pendingCount, 1);
  assert.equal(attempts, 1);
  assert.equal(changedCount, 0);
  assert.equal(transientFailures.length, 1);
  assert.equal(transientFailures[0].failureCount, 1);
  assert.equal(runtime.pending().length, 1);

  await runtime.fireNext();
  assert.equal(attempts, 2);
  assert.equal(queue.pendingCount, 0);
  assert.equal(changedCount, 1);
  assert.equal(runtime.pending().length, 0);
});

test("metadata conflict retry queue is bounded and deduplicates a pending identity", () => {
  const runtime = fakeRuntime();
  const permanentErrors = [];
  const queue = createCurrentCellMetadataConflictRetryQueue({
    persist() {
      const error = new Error("busy");
      error.code = "SQLITE_BUSY";
      throw error;
    },
    isTransientError: (error) => error?.code === "SQLITE_BUSY",
    onPermanentError(error, value) {
      permanentErrors.push({ error, value });
    },
    setTimeout: runtime.setTimeout,
    clearTimeout: runtime.clearTimeout,
    maxPending: 2,
  });
  const conflict = {
    source: "buleto",
    instrument: "roulette",
    externalRoundId: "one",
  };

  assert.equal(queue.enqueue(conflict), false);
  assert.equal(queue.enqueue({ ...conflict }), false);
  assert.equal(queue.pendingCount, 1);
  assert.equal(queue.enqueue({ ...conflict, externalRoundId: "two" }), false);
  assert.equal(queue.pendingCount, 2);
  assert.equal(queue.enqueue({ ...conflict, externalRoundId: "three" }), false);
  assert.equal(queue.pendingCount, 2);
  assert.equal(permanentErrors.length, 1);
  assert.match(permanentErrors[0].error.message, /reached 2 entries/);
  queue.cancelRetry();
});

function scheduler(runtime, capture, overrides = {}) {
  return createCurrentCellHorizonScheduler({
    capture,
    clock: runtime.clock,
    setTimeout: runtime.setTimeout,
    clearTimeout: runtime.clearTimeout,
    ...overrides,
  });
}

test("schedules one unrefed capture at close minus ten seconds and deduplicates", async () => {
  const runtime = fakeRuntime();
  const attempts = [];
  const value = scheduler(runtime, (attempt) => {
    attempts.push(attempt);
    return { status: "ready" };
  });

  const scheduled = value.scheduleRound(round());
  assert.deepEqual(scheduled, {
    status: "scheduled",
    roundKey: JSON.stringify([
      "buleto",
      "roulette",
      "round-1",
      "2026-10-18T10:00:20.000Z",
    ]),
    externalRoundId: "round-1",
    cutoffAt: "2026-10-18T10:00:10.000Z",
    deadlineAt: "2026-10-18T10:00:12.500Z",
  });
  assert.equal(runtime.pending().length, 1);
  assert.equal(runtime.pending()[0].delayMs, 10_000);
  assert.equal(runtime.unrefCount, 1);

  const duplicate = value.scheduleRound(round());
  assert.equal(duplicate.status, "deduplicated");
  assert.equal(runtime.pending().length, 1);

  await runtime.advanceTo(BASE_MS + 10_000);
  assert.equal(attempts.length, 1);
  assert.deepEqual(attempts[0], {
    roundKey: scheduled.roundKey,
    source: "buleto",
    instrument: "roulette",
    externalRoundId: "round-1",
    bettingClosesAt: "2026-10-18T10:00:20.000Z",
    cutoffAt: "2026-10-18T10:00:10.000Z",
    deadlineAt: "2026-10-18T10:00:12.500Z",
    capturedAt: "2026-10-18T10:00:10.000Z",
    attempt: 1,
  });
  assert.equal(Object.isFrozen(attempts[0]), true);
  assert.equal(runtime.pending().length, 0);
});

test("a new round cancels the superseded round", async () => {
  const runtime = fakeRuntime();
  const capturedIds = [];
  const value = scheduler(runtime, (attempt) => {
    capturedIds.push(attempt.externalRoundId);
  });

  value.scheduleRound(round("old", BASE_MS + 20_000));
  value.scheduleRound(round("new", BASE_MS + 30_000));
  assert.equal(runtime.clearCount, 1);
  assert.equal(runtime.pending().length, 1);

  await runtime.advanceTo(BASE_MS + 20_000);
  assert.deepEqual(capturedIds, ["new"]);
});

test("a corrected later close for the same id fails closed and blocks that identity", async () => {
  const runtime = fakeRuntime();
  const attempts = [];
  const value = scheduler(runtime, (attempt) => attempts.push(attempt));

  const original = value.scheduleRound(round("same", BASE_MS + 20_000));
  const corrected = value.scheduleRound(round("same", BASE_MS + 30_000));
  assert.equal(original.status, "scheduled");
  assert.equal(corrected.status, "metadata_conflict");
  assert.equal(
    corrected.originalBettingClosesAt,
    "2026-10-18T10:00:20.000Z",
  );
  assert.equal(
    corrected.observedBettingClosesAt,
    "2026-10-18T10:00:30.000Z",
  );
  assert.notEqual(original.roundKey, corrected.roundKey);
  assert.equal(runtime.clearCount, 1);
  assert.equal(runtime.pending().length, 0);
  assert.equal(
    value.scheduleRound(round("same", BASE_MS + 20_000)).status,
    "metadata_conflict",
  );

  const next = value.scheduleRound(round("next", BASE_MS + 40_000));
  assert.equal(next.status, "scheduled");
  assert.equal(
    value.scheduleRound(round("same", BASE_MS + 25_000)).status,
    "metadata_conflict",
  );
  assert.equal(runtime.pending().length, 1);
  assert.equal(runtime.clearCount, 1);
  await runtime.advanceTo(BASE_MS + 30_000);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].externalRoundId, "next");
});

test("a corrected earlier close for the same id also fails closed without capture", async () => {
  const runtime = fakeRuntime();
  const attempts = [];
  const value = scheduler(runtime, (attempt) => attempts.push(attempt));

  value.scheduleRound(round("same", BASE_MS + 30_000));
  const corrected = value.scheduleRound(round("same", BASE_MS + 20_000));
  assert.equal(corrected.status, "metadata_conflict");
  assert.equal(
    corrected.originalBettingClosesAt,
    "2026-10-18T10:00:30.000Z",
  );
  assert.equal(
    corrected.observedBettingClosesAt,
    "2026-10-18T10:00:20.000Z",
  );
  assert.equal(runtime.clearCount, 1);
  assert.equal(runtime.pending().length, 0);

  await runtime.advanceTo(BASE_MS + 30_000);
  assert.equal(attempts.length, 0);
});

test("a stale older round event cannot supersede the active newer timer", async () => {
  const runtime = fakeRuntime();
  const attempts = [];
  const value = scheduler(runtime, (attempt) => attempts.push(attempt));

  value.scheduleRound(round("new", BASE_MS + 30_000));
  const stale = value.scheduleRound(round("old", BASE_MS + 20_000));
  assert.equal(stale.status, "stale");
  assert.equal(runtime.clearCount, 0);
  assert.equal(runtime.pending().length, 1);

  await runtime.advanceTo(BASE_MS + 20_000);
  assert.deepEqual(attempts.map((attempt) => attempt.externalRoundId), ["new"]);
});

test("early timeout delivery and a wall-clock rollback rearm instead of capturing", async () => {
  const runtime = fakeRuntime();
  const attempts = [];
  const value = scheduler(runtime, (attempt) => attempts.push(attempt));
  value.scheduleRound(round());

  runtime.setNow(BASE_MS - 5_000);
  await runtime.fireNext();
  assert.equal(attempts.length, 0);
  assert.equal(runtime.pending()[0].delayMs, 15_000);

  runtime.setNow(BASE_MS + 9_000);
  await runtime.fireNext();
  assert.equal(attempts.length, 0);
  assert.equal(runtime.pending()[0].delayMs, 1_000);

  await runtime.advanceTo(BASE_MS + 10_000);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].capturedAt, "2026-10-18T10:00:10.000Z");
});

test("retries only the three explicit transient outcomes", async () => {
  const runtime = fakeRuntime();
  const outcomes = [
    { status: "transient" },
    { status: "unavailable", reason: "trajectory_not_found" },
    "cutoff_not_reached",
    { status: "ready" },
  ];
  const attempts = [];
  const value = scheduler(runtime, (attempt) => {
    attempts.push(attempt);
    return outcomes.shift();
  });
  value.scheduleRound(round());

  await runtime.advanceTo(BASE_MS + 10_000);
  await runtime.advanceTo(BASE_MS + 10_250);
  await runtime.advanceTo(BASE_MS + 10_500);
  await runtime.advanceTo(BASE_MS + 10_750);
  assert.deepEqual(attempts.map((attempt) => attempt.attempt), [1, 2, 3, 4]);
  assert.equal(runtime.pending().length, 0);

  const terminalRuntime = fakeRuntime();
  let terminalAttempts = 0;
  const terminal = scheduler(terminalRuntime, () => {
    terminalAttempts += 1;
    return { status: "unavailable", reason: "no_causal_tick" };
  });
  terminal.scheduleRound(round());
  await terminalRuntime.advanceTo(BASE_MS + 10_000);
  await terminalRuntime.advanceTo(BASE_MS + 12_500);
  assert.equal(terminalAttempts, 1);
  assert.equal(terminalRuntime.pending().length, 0);
});

test("retries are bounded through the grace deadline and retain a safe close buffer", async () => {
  const runtime = fakeRuntime();
  const attempts = [];
  const value = scheduler(runtime, (attempt) => {
    attempts.push(attempt);
    return { reason: "transient" };
  }, { retryDelayMs: 1_000 });
  value.scheduleRound(round());

  await runtime.advanceTo(BASE_MS + 10_000);
  await runtime.advanceTo(BASE_MS + 11_000);
  await runtime.advanceTo(BASE_MS + 12_000);
  await runtime.advanceTo(BASE_MS + 12_500);
  assert.deepEqual(
    attempts.map((attempt) => Date.parse(attempt.capturedAt) - BASE_MS),
    [10_000, 11_000, 12_000, 12_500],
  );
  assert.ok(attempts.every((attempt) => (
    Date.parse(attempt.bettingClosesAt) - Date.parse(attempt.capturedAt)
      >= CURRENT_CELL_HORIZON_SCHEDULER_CONFIG.minimumExecutionBufferMs
  )));
  assert.equal(runtime.pending().length, 0);

  const lateRuntime = fakeRuntime(BASE_MS + 12_501);
  let lateCaptures = 0;
  const late = scheduler(lateRuntime, () => { lateCaptures += 1; });
  assert.equal(late.scheduleRound(round()).status, "expired");
  await lateRuntime.advanceTo(BASE_MS + 20_000);
  assert.equal(lateCaptures, 0, "a past-deadline round is never backfilled");

  const unsafeRuntime = fakeRuntime();
  let unsafeCaptures = 0;
  const unsafe = scheduler(unsafeRuntime, () => { unsafeCaptures += 1; });
  unsafe.scheduleRound(round());
  unsafeRuntime.setNow(BASE_MS + 15_001);
  await unsafeRuntime.fireNext();
  assert.equal(unsafeCaptures, 0, "a late timer cannot cross the close buffer");
});

test("a superseded in-flight transient result cannot rearm its old round", async () => {
  const runtime = fakeRuntime();
  let resolveOld;
  const attempts = [];
  const value = scheduler(runtime, (attempt) => {
    attempts.push(attempt.externalRoundId);
    if (attempt.externalRoundId === "old") {
      return new Promise((resolve) => { resolveOld = resolve; });
    }
    return { status: "ready" };
  });
  value.scheduleRound(round("old", BASE_MS + 20_000));
  await runtime.advanceTo(BASE_MS + 10_000);
  assert.deepEqual(attempts, ["old"]);

  value.scheduleRound(round("new", BASE_MS + 30_000));
  resolveOld({ reason: "transient" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(runtime.pending().length, 1);

  await runtime.advanceTo(BASE_MS + 20_000);
  assert.deepEqual(attempts, ["old", "new"]);
});

test("stop clears the timer and makes the scheduler terminal", async () => {
  const runtime = fakeRuntime();
  let captures = 0;
  const value = scheduler(runtime, () => { captures += 1; });
  value.scheduleRound(round());
  value.stop();
  value.stop();
  assert.equal(runtime.pending().length, 0);

  const stopped = value.scheduleRound(round("after-stop"));
  assert.equal(stopped.status, "stopped");
  await runtime.advanceTo(BASE_MS + 20_000);
  assert.equal(captures, 0);
});

test("round keys are unambiguous and scheduler dependencies are validated", () => {
  assert.notEqual(
    currentCellHorizonRoundKey({
      source: "a:b",
      instrument: "c",
      externalRoundId: "d",
      bettingClosesAt: "2026-10-18T10:00:20.000Z",
    }),
    currentCellHorizonRoundKey({
      source: "a",
      instrument: "b:c",
      externalRoundId: "d",
      bettingClosesAt: "2026-10-18T10:00:20.000Z",
    }),
  );
  assert.throws(() => createCurrentCellHorizonScheduler(), /capture/);
  assert.throws(() => createCurrentCellHorizonScheduler({
    capture() {},
    retryDelayMs: 0,
  }), /positive finite number/);
  const runtime = fakeRuntime();
  const value = scheduler(runtime, () => {});
  assert.throws(() => value.scheduleRound({}), /source is required/);
  const wireTimestamp = value.scheduleRound({
    ...round(),
    bettingClosesAt: "2026-10-18T10:00:20Z",
  });
  assert.equal(wireTimestamp.status, "scheduled");
  assert.equal(wireTimestamp.cutoffAt, "2026-10-18T10:00:10.000Z");
  assert.equal(value.scheduleRound(round()).status, "deduplicated");
  assert.throws(() => value.scheduleRound({
    ...round(),
    bettingClosesAt: "not-a-timestamp",
  }), /valid timestamp/);
});
