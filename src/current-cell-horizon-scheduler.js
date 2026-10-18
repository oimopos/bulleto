import {
  CURRENT_CELL_HORIZON_SHADOW_CONFIG,
} from "./current-cell-horizon-shadow.js";

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const DEFAULT_RETRY_DELAY_MS = 250;
const DEFAULT_METADATA_CONFLICT_RETRY_DELAY_MS = 1_000;
const DEFAULT_METADATA_CONFLICT_MAX_RETRY_DELAY_MS = 30_000;
const RETRYABLE_REASONS = new Set([
  "transient",
  "trajectory_not_found",
  "cutoff_not_reached",
]);

export const CURRENT_CELL_HORIZON_SCHEDULER_CONFIG = Object.freeze({
  horizonMs: CURRENT_CELL_HORIZON_SHADOW_CONFIG.horizonSeconds * 1_000,
  captureGraceMs: CURRENT_CELL_HORIZON_SHADOW_CONFIG.captureGraceMs,
  minimumExecutionBufferMs:
    CURRENT_CELL_HORIZON_SHADOW_CONFIG.minimumExecutionBufferMs,
  retryDelayMs: DEFAULT_RETRY_DELAY_MS,
});

function nonEmptyString(value, label) {
  const normalized = String(value ?? "").trim();
  if (normalized === "") throw new TypeError(`${label} is required`);
  return normalized;
}

function canonicalInstant(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be a valid timestamp`);
  }
  return new Date(value).toISOString();
}

function positiveFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive finite number`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function metadataConflictIdentityKey(conflict) {
  return JSON.stringify([
    nonEmptyString(conflict?.source, "conflict.source"),
    nonEmptyString(conflict?.instrument, "conflict.instrument"),
    nonEmptyString(conflict?.externalRoundId, "conflict.externalRoundId"),
  ]);
}

/**
 * Keeps scheduler-detected close-metadata conflicts in a bounded FIFO until a
 * synchronous persistence attempt succeeds or returns a non-transient error.
 */
export function createCurrentCellMetadataConflictRetryQueue({
  persist,
  isTransientError,
  onDatabaseChanged = () => {},
  onTransientError = () => {},
  onPermanentError = () => {},
  shouldRetry = () => true,
  setTimeout: setTimeoutFn = globalThis.setTimeout,
  clearTimeout: clearTimeoutFn = globalThis.clearTimeout,
  maxPending = 1_024,
  retryDelayMs = DEFAULT_METADATA_CONFLICT_RETRY_DELAY_MS,
  maxRetryDelayMs = DEFAULT_METADATA_CONFLICT_MAX_RETRY_DELAY_MS,
} = {}) {
  if (typeof persist !== "function") throw new TypeError("persist must be a function");
  if (typeof isTransientError !== "function") {
    throw new TypeError("isTransientError must be a function");
  }
  for (const [label, callback] of [
    ["onDatabaseChanged", onDatabaseChanged],
    ["onTransientError", onTransientError],
    ["onPermanentError", onPermanentError],
    ["shouldRetry", shouldRetry],
    ["setTimeout", setTimeoutFn],
    ["clearTimeout", clearTimeoutFn],
  ]) {
    if (typeof callback !== "function") throw new TypeError(`${label} must be a function`);
  }
  const safeMaxPending = positiveInteger(maxPending, "maxPending");
  const safeRetryDelayMs = positiveFiniteNumber(retryDelayMs, "retryDelayMs");
  const safeMaxRetryDelayMs = positiveFiniteNumber(
    maxRetryDelayMs,
    "maxRetryDelayMs",
  );
  if (safeMaxRetryDelayMs < safeRetryDelayMs) {
    throw new RangeError("maxRetryDelayMs cannot be less than retryDelayMs");
  }

  const pending = [];
  const pendingIdentityKeys = new Set();
  let retryTimer = null;
  let draining = false;

  function removeHead() {
    const removed = pending.shift();
    if (removed) pendingIdentityKeys.delete(removed.identityKey);
  }

  function cancelRetry() {
    if (retryTimer === null) return;
    clearTimeoutFn(retryTimer);
    retryTimer = null;
  }

  function scheduleRetry() {
    if (retryTimer !== null || pending.length === 0 || !shouldRetry()) return;
    const failureCount = pending[0].failureCount;
    const delayMs = Math.min(
      safeMaxRetryDelayMs,
      safeRetryDelayMs * 2 ** Math.min(Math.max(0, failureCount - 1), 5),
    );
    retryTimer = setTimeoutFn(() => {
      retryTimer = null;
      drain();
    }, delayMs);
    retryTimer?.unref?.();
  }

  function drain({ retry = true } = {}) {
    if (draining) return pending.length === 0;
    draining = true;
    let transientFailure = null;
    try {
      while (pending.length > 0) {
        const head = pending[0];
        let outcome;
        try {
          outcome = persist(head.conflict);
        } catch (error) {
          head.failureCount += 1;
          if (isTransientError(error)) {
            transientFailure = error;
            onTransientError(error, head.conflict, head.failureCount);
            break;
          }
          removeHead();
          onPermanentError(error, head.conflict, head.failureCount);
          continue;
        }
        removeHead();
        if (outcome?.databaseChanged) {
          onDatabaseChanged(outcome, head.conflict);
        }
      }
    } finally {
      draining = false;
    }

    if (transientFailure !== null) {
      if (retry) scheduleRetry();
      return false;
    }
    cancelRetry();
    return pending.length === 0;
  }

  function enqueue(conflict) {
    const identityKey = metadataConflictIdentityKey(conflict);
    if (pendingIdentityKeys.has(identityKey)) return pending.length === 0;
    if (pending.length >= safeMaxPending) {
      onPermanentError(
        new RangeError(`metadata conflict retry queue reached ${safeMaxPending} entries`),
        conflict,
        0,
      );
      return false;
    }
    pending.push({
      identityKey,
      conflict: Object.freeze({ ...conflict }),
      failureCount: 0,
    });
    pendingIdentityKeys.add(identityKey);
    if (retryTimer === null) drain();
    return pending.length === 0;
  }

  return Object.freeze({
    enqueue,
    drain,
    cancelRetry,
    get pendingCount() {
      return pending.length;
    },
  });
}

function clockMilliseconds(clock) {
  const value = clock();
  const milliseconds = value instanceof Date ? value.getTime() : value;
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError("clock must return a finite millisecond timestamp or Date");
  }
  return milliseconds;
}

export function currentCellHorizonRoundKey({
  source,
  instrument,
  externalRoundId,
  bettingClosesAt,
} = {}) {
  return JSON.stringify([
    nonEmptyString(source, "source"),
    nonEmptyString(instrument, "instrument"),
    nonEmptyString(externalRoundId, "externalRoundId"),
    canonicalInstant(bettingClosesAt, "bettingClosesAt"),
  ]);
}

function normalizeRound(round) {
  const source = nonEmptyString(round?.source, "source");
  const instrument = nonEmptyString(round?.instrument, "instrument");
  const externalRoundId = nonEmptyString(
    round?.externalRoundId,
    "externalRoundId",
  );
  const bettingClosesAt = canonicalInstant(
    round?.bettingClosesAt,
    "bettingClosesAt",
  );
  const closesMs = Date.parse(bettingClosesAt);
  const cutoffMs = closesMs - CURRENT_CELL_HORIZON_SCHEDULER_CONFIG.horizonMs;
  const deadlineMs = Math.min(
    cutoffMs + CURRENT_CELL_HORIZON_SCHEDULER_CONFIG.captureGraceMs,
    closesMs
      - CURRENT_CELL_HORIZON_SCHEDULER_CONFIG.minimumExecutionBufferMs,
  );
  return Object.freeze({
    identityKey: JSON.stringify([source, instrument, externalRoundId]),
    roundKey: currentCellHorizonRoundKey({
      source,
      instrument,
      externalRoundId,
      bettingClosesAt,
    }),
    source,
    instrument,
    externalRoundId,
    bettingClosesAt,
    closesMs,
    cutoffMs,
    cutoffAt: new Date(cutoffMs).toISOString(),
    deadlineMs,
    deadlineAt: new Date(deadlineMs).toISOString(),
  });
}

function retryableReason(value) {
  if (typeof value === "string" && RETRYABLE_REASONS.has(value)) return value;
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return null;
  }
  if (value.transient === true) return "transient";
  for (const candidate of [value.reason, value.code, value.status]) {
    if (typeof candidate === "string" && RETRYABLE_REASONS.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

function scheduleResult(status, round, details = {}) {
  return Object.freeze({
    status,
    roundKey: round.roundKey,
    externalRoundId: round.externalRoundId,
    cutoffAt: round.cutoffAt,
    deadlineAt: round.deadlineAt,
    ...details,
  });
}

/**
 * Schedules one prospective current-cell capture per round.
 *
 * `capture(attempt)` may return (or reject with) an object whose `reason`,
 * `code`, or `status` is `transient`, `trajectory_not_found`, or
 * `cutoff_not_reached`. Only those explicit outcomes are retried. Every other
 * return value is terminal. A rejected error can also opt in with
 * `error.transient === true`.
 */
export function createCurrentCellHorizonScheduler({
  capture,
  clock = Date.now,
  setTimeout: setTimeoutFn = globalThis.setTimeout,
  clearTimeout: clearTimeoutFn = globalThis.clearTimeout,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  onError = () => {},
} = {}) {
  if (typeof capture !== "function") {
    throw new TypeError("capture must be a function");
  }
  if (typeof clock !== "function") throw new TypeError("clock must be a function");
  if (typeof setTimeoutFn !== "function") {
    throw new TypeError("setTimeout must be a function");
  }
  if (typeof clearTimeoutFn !== "function") {
    throw new TypeError("clearTimeout must be a function");
  }
  if (typeof onError !== "function") {
    throw new TypeError("onError must be a function");
  }
  const safeRetryDelayMs = positiveFiniteNumber(retryDelayMs, "retryDelayMs");

  let active = null;
  let generation = 0;
  let stopped = false;
  const seenRounds = new Map();
  const conflictedIdentities = new Set();

  function isCurrent(record) {
    return !stopped && active === record && record.generation === generation;
  }

  function clearTimer(record) {
    if (record.timer === null) return;
    clearTimeoutFn(record.timer);
    record.timer = null;
  }

  function retire(record, state = "settled") {
    clearTimer(record);
    record.state = state;
  }

  function reportError(error, attempt) {
    try {
      onError(error, attempt);
    } catch {
      // Observability must never change capture or retry semantics.
    }
  }

  function arm(record, notBeforeMs) {
    if (!isCurrent(record) || record.state !== "scheduled") return;
    clearTimer(record);
    record.notBeforeMs = notBeforeMs;
    const nowMs = clockMilliseconds(clock);
    if (
      nowMs > record.round.deadlineMs
      || record.round.closesMs - nowMs
        < CURRENT_CELL_HORIZON_SCHEDULER_CONFIG.minimumExecutionBufferMs
    ) {
      retire(record, "expired");
      return;
    }
    const delayMs = Math.min(
      MAX_TIMER_DELAY_MS,
      Math.max(0, notBeforeMs - nowMs),
    );
    let handle;
    handle = setTimeoutFn(() => {
      if (record.timer === handle) record.timer = null;
      void runAttempt(record);
    }, delayMs);
    record.timer = handle;
    if (handle && typeof handle.unref === "function") handle.unref();
  }

  function nextRetry(record) {
    if (!isCurrent(record) || record.state !== "scheduled") return;
    let nowMs;
    try {
      nowMs = clockMilliseconds(clock);
    } catch (error) {
      retire(record, "failed");
      reportError(error, null);
      return;
    }
    if (
      nowMs >= record.round.deadlineMs
      || record.round.closesMs - nowMs
        < CURRENT_CELL_HORIZON_SCHEDULER_CONFIG.minimumExecutionBufferMs
    ) {
      retire(record, "expired");
      return;
    }
    const retryAtMs = Math.min(
      record.round.deadlineMs,
      Math.max(record.round.cutoffMs, nowMs + safeRetryDelayMs),
    );
    arm(record, retryAtMs);
  }

  async function runAttempt(record) {
    if (!isCurrent(record) || record.state !== "scheduled") return;
    let nowMs;
    try {
      nowMs = clockMilliseconds(clock);
    } catch (error) {
      retire(record, "failed");
      reportError(error, null);
      return;
    }

    // A timeout is only a wake-up hint. Recheck the wall clock so an early
    // callback, a capped long timeout, or a clock rollback cannot capture
    // before the intended instant.
    if (nowMs < record.notBeforeMs || nowMs < record.round.cutoffMs) {
      arm(record, Math.max(record.notBeforeMs, record.round.cutoffMs));
      return;
    }
    if (
      nowMs > record.round.deadlineMs
      || record.round.closesMs - nowMs
        < CURRENT_CELL_HORIZON_SCHEDULER_CONFIG.minimumExecutionBufferMs
    ) {
      retire(record, "expired");
      return;
    }

    record.attempts += 1;
    const attempt = Object.freeze({
      roundKey: record.round.roundKey,
      source: record.round.source,
      instrument: record.round.instrument,
      externalRoundId: record.round.externalRoundId,
      bettingClosesAt: record.round.bettingClosesAt,
      cutoffAt: record.round.cutoffAt,
      deadlineAt: record.round.deadlineAt,
      capturedAt: new Date(nowMs).toISOString(),
      attempt: record.attempts,
    });

    let outcome;
    let failed = false;
    try {
      outcome = await capture(attempt);
    } catch (error) {
      failed = true;
      outcome = error;
      reportError(error, attempt);
    }
    if (!isCurrent(record) || record.state !== "scheduled") return;
    if (retryableReason(outcome) !== null) {
      nextRetry(record);
      return;
    }
    retire(record, failed ? "failed" : "settled");
  }

  function scheduleRound(roundInput) {
    const round = normalizeRound(roundInput);
    if (stopped) return scheduleResult("stopped", round);

    const seenRound = seenRounds.get(round.identityKey);
    if (conflictedIdentities.has(round.identityKey)) {
      return scheduleResult("metadata_conflict", round, {
        originalBettingClosesAt: seenRound.bettingClosesAt,
        observedBettingClosesAt: round.bettingClosesAt,
      });
    }
    if (seenRound !== undefined && seenRound.roundKey !== round.roundKey) {
      conflictedIdentities.add(round.identityKey);
      if (active?.round.identityKey === round.identityKey) {
        retire(active, "metadata_conflict");
        active = null;
        generation += 1;
      }
      return scheduleResult("metadata_conflict", round, {
        originalBettingClosesAt: seenRound.bettingClosesAt,
        observedBettingClosesAt: round.bettingClosesAt,
      });
    }
    seenRounds.set(round.identityKey, round);
    if (active?.round.roundKey === round.roundKey) {
      return scheduleResult("deduplicated", active.round);
    }

    // Collector events can arrive out of order. A distinct round that closes
    // no later than the active one is stale and must not cancel its timer.
    if (
      active !== null
      && round.closesMs <= active.round.closesMs
    ) {
      return scheduleResult("stale", round);
    }

    if (active !== null) {
      clearTimer(active);
      active.state = "superseded";
    }
    generation += 1;
    const record = {
      generation,
      round,
      timer: null,
      notBeforeMs: round.cutoffMs,
      attempts: 0,
      state: "scheduled",
    };
    active = record;

    const nowMs = clockMilliseconds(clock);
    if (
      nowMs > round.deadlineMs
      || round.closesMs - nowMs
        < CURRENT_CELL_HORIZON_SCHEDULER_CONFIG.minimumExecutionBufferMs
    ) {
      retire(record, "expired");
      return scheduleResult("expired", round);
    }
    arm(record, Math.max(nowMs, round.cutoffMs));
    return scheduleResult("scheduled", round);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    generation += 1;
    if (active !== null) {
      clearTimer(active);
      active.state = "stopped";
      active = null;
    }
  }

  return Object.freeze({ scheduleRound, stop });
}
