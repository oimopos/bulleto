import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildFollowerTop5HitCurve,
  createDatabase,
} from "../src/database.js";

const SOURCE = "buleto";
const INSTRUMENT = "PRIMECOIN(XPM)/RUB";
const BASE_TIME = Date.parse("2026-09-21T00:00:00.000Z");
const TRAINING_NUMBERS = [9, 1, 9, 2, 9, 3, 9, 4, 9, 5, 9];

function event(resultNumber, fingerprint, offsetSeconds = 0, extra = {}) {
  const settledAt = new Date(BASE_TIME + offsetSeconds * 1_000).toISOString();
  return {
    source: SOURCE,
    instrument: INSTRUMENT,
    settledAt,
    observedAt: settledAt,
    resultNumber,
    price: 5.4 + offsetSeconds / 10_000,
    fingerprint,
    rawPayload: { c: resultNumber },
    ...extra,
  };
}

function ingestTrackerTraining(database, prefix, {
  secondsPerResult = 1,
  externalRoundIdStart = null,
} = {}) {
  database.ingestBatch(
    TRAINING_NUMBERS.map((number, index) => event(
      number,
      `${prefix}-${index}`,
      index * secondsPerResult,
      externalRoundIdStart === null
        ? {}
        : { externalRoundId: String(externalRoundIdStart + index) },
    )),
  );
}

function trackerState(database) {
  return database.getFollowerTop5TrackerState(SOURCE, INSTRUMENT);
}

test("fixed top-5 tracker schema and empty state expose a stable simulation contract", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    assert.deepEqual(
      database.sqlite
        .prepare("PRAGMA table_info(follower_top5_sessions)")
        .all()
        .map((column) => column.name),
      [
        "id",
        "source",
        "instrument",
        "continuity_epoch",
        "status",
        "end_reason",
        "anchor_result_id",
        "anchor_number",
        "top_numbers_json",
        "algorithm_version",
        "history_max_result_id",
        "sample_size",
        "observed_follower_count",
        "attempt_count",
        "miss_count",
        "last_attempt_result_id",
        "completed_result_id",
        "locked_at",
        "last_event_at",
        "completed_at",
        "created_at",
      ],
    );
    assert.deepEqual(
      database.sqlite
        .prepare("PRAGMA table_info(follower_top5_attempts)")
        .all()
        .map((column) => column.name),
      [
        "id",
        "session_id",
        "round_result_id",
        "attempt_number",
        "result_number",
        "outcome",
        "hit_rank",
        "occurred_at",
        "created_at",
      ],
    );

    const liveIndex = database.sqlite
      .prepare("PRAGMA index_list(follower_top5_sessions)")
      .all()
      .find((index) => index.name === "follower_top5_one_active_stream_idx");
    assert.equal(Number(liveIndex?.unique), 1);
    assert.equal(Number(liveIndex?.partial), 1);

    assert.deepEqual(trackerState(database), {
      schemaVersion: 1,
      algorithmVersion: "follower-top5-live-v1",
      mode: "simulation",
      executionEnabled: false,
      trackingMode: "persisted-batch-aware",
      topCount: 5,
      minimumObservedFollowerCount: 5,
      status: "waiting_training",
      currentSession: null,
      lastCompletedSession: null,
      lastAttempt: null,
      lifetime: {
        totalSessions: 0,
        completedSessions: 0,
        invalidatedSessions: 0,
        trackedRounds: 0,
        hits: 0,
        misses: 0,
      },
    });
  } finally {
    database.close();
  }
});

test("walk-forward allPoints exposes every cumulative horizon from 1 through 20", () => {
  const training = [9, 1, 9, 1, 9, 2, 9, 2, 9, 3, 9, 3, 9, 4, 9, 4, 9, 5, 9, 5];
  const evaluation = [
    9, 1, ...Array.from({ length: 19 }, () => 30),
    9, 6, 30, 2, ...Array.from({ length: 17 }, () => 30),
    9, 7, ...Array.from({ length: 8 }, () => 30), 3, ...Array.from({ length: 10 }, () => 30),
    9, 8, ...Array.from({ length: 19 }, () => 30),
  ];
  const rows = [
    ...training.map((resultNumber, index) => ({
      id: index + 1,
      result_number: resultNumber,
      settled_at: new Date(BASE_TIME + index * 1_000).toISOString(),
      continuity_epoch: 0,
    })),
    ...evaluation.map((resultNumber, index) => ({
      id: training.length + index + 1,
      result_number: resultNumber,
      settled_at: new Date(
        BASE_TIME + (training.length + index + 1) * 1_000,
      ).toISOString(),
      continuity_epoch: 1,
    })),
  ];

  const curve = buildFollowerTop5HitCurve(rows);
  const expectedHitCounts = Array.from({ length: 20 }, (_, index) => {
    const horizon = index + 1;
    if (horizon < 3) return 1;
    if (horizon < 10) return 2;
    return 3;
  });

  assert.deepEqual(
    curve.overall.allPoints,
    expectedHitCounts.map((hitCount, index) => ({
      horizon: index + 1,
      hitCount,
      eligibleCount: 4,
      rate: hitCount / 4,
    })),
  );
  assert.deepEqual(
    curve.overall.points,
    curve.overall.allPoints.filter(({ horizon }) =>
      [1, 2, 3, 5, 10, 20].includes(horizon)),
  );
});

test("a hit inside a catch-up batch closes once and re-arms only at the batch tail", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    ingestTrackerTraining(database, "barrier-training");
    const original = trackerState(database);
    const observedAt = new Date(BASE_TIME + 60_000).toISOString();

    database.ingestBatch(
      [8, 3, 7, 9].map((number, index) => event(
        number,
        `barrier-catchup-${index}`,
        TRAINING_NUMBERS.length + index,
        { observedAt },
      )),
    );

    const state = trackerState(database);
    assert.equal(state.lastCompletedSession.id, original.currentSession.id);
    assert.equal(state.lastCompletedSession.attemptCount, 2);
    assert.equal(state.lastCompletedSession.missCount, 1);
    assert.equal(state.lastCompletedSession.hitNumber, 3);
    assert.equal(state.lastCompletedSession.hitRank, 3);
    assert.equal(state.currentSession.anchor.number, 9);
    assert.notEqual(state.currentSession.id, original.currentSession.id);
    assert.equal(state.currentSession.attemptCount, 0);
    assert.deepEqual(state.currentSession.fixedNumbers, [8, 5, 4, 3, 2]);
    assert.deepEqual(state.lifetime, {
      totalSessions: 2,
      completedSessions: 1,
      invalidatedSessions: 0,
      trackedRounds: 2,
      hits: 1,
      misses: 1,
    });

    assert.deepEqual(
      database.sqlite
        .prepare(`
          SELECT results.fingerprint, attempts.attempt_number, attempts.outcome
          FROM follower_top5_attempts AS attempts
          JOIN round_results AS results ON results.id = attempts.round_result_id
          ORDER BY attempts.id
        `)
        .all()
        .map((row) => ({
          fingerprint: row.fingerprint,
          attemptNumber: Number(row.attempt_number),
          outcome: row.outcome,
        })),
      [
        { fingerprint: "barrier-catchup-0", attemptNumber: 1, outcome: "miss" },
        { fingerprint: "barrier-catchup-1", attemptNumber: 2, outcome: "hit" },
      ],
    );
  } finally {
    database.close();
  }
});

test("a tail gap persists as censoring and the first later batch is anchor-only", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-top5-tail-gap-"));
  const path = join(directory, "tracker.sqlite");
  let database = createDatabase({ path });
  try {
    ingestTrackerTraining(database, "tail-gap-training");
    database.ingestBatch([
      event(8, "tail-gap-miss", TRAINING_NUMBERS.length),
    ]);
    database.ingestBatchAfterGap(
      {
        source: SOURCE,
        instrument: INSTRUMENT,
        incidentKey: "tail-gap-without-result",
        detectedAt: new Date(BASE_TIME + 20_000).toISOString(),
        message: "known missing result",
      },
      [],
    );

    let state = trackerState(database);
    assert.equal(state.status, "gap");
    assert.equal(state.currentSession, null);
    assert.deepEqual(state.lifetime, {
      totalSessions: 1,
      completedSessions: 0,
      invalidatedSessions: 1,
      trackedRounds: 1,
      hits: 0,
      misses: 1,
    });

    database.close();
    database = createDatabase({ path });
    state = trackerState(database);
    assert.equal(state.status, "gap", "reopen must not re-arm from the old epoch tail");

    database.ingestBatch([
      event(1, "tail-gap-catchup-hit-shaped", 21),
      event(9, "tail-gap-new-anchor", 22),
    ]);
    state = trackerState(database);
    assert.equal(state.status, "armed");
    assert.equal(state.currentSession.anchor.number, 9);
    assert.equal(state.currentSession.attemptCount, 0);
    assert.equal(state.lifetime.trackedRounds, 1);
    assert.equal(state.lifetime.hits, 0);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reopen continues the same frozen session and the next result is attempt two", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-top5-reopen-"));
  const path = join(directory, "tracker.sqlite");
  let database = createDatabase({ path });
  try {
    ingestTrackerTraining(database, "reopen-training");
    database.ingestBatch([
      event(8, "reopen-attempt-one", TRAINING_NUMBERS.length),
    ]);
    const before = trackerState(database);
    const sessionId = before.currentSession.id;
    const fixedNumbers = before.currentSession.fixedNumbers;
    database.close();

    database = createDatabase({ path });
    assert.equal(trackerState(database).currentSession.id, sessionId);
    database.ingestBatch([
      event(3, "reopen-attempt-two-hit", TRAINING_NUMBERS.length + 1),
    ]);

    const after = trackerState(database);
    assert.equal(after.currentSession, null);
    assert.equal(after.status, "waiting_training");
    assert.equal(after.lastCompletedSession.id, sessionId);
    assert.deepEqual(after.lastCompletedSession.fixedNumbers, fixedNumbers);
    assert.equal(after.lastCompletedSession.attemptCount, 2);
    assert.equal(after.lastCompletedSession.missCount, 1);
    assert.deepEqual(after.lifetime, {
      totalSessions: 1,
      completedSessions: 1,
      invalidatedSessions: 0,
      trackedRounds: 2,
      hits: 1,
      misses: 1,
    });
    assert.deepEqual(
      database.sqlite
        .prepare(`
          SELECT attempt_number, outcome, hit_rank
          FROM follower_top5_attempts
          WHERE session_id = ?
          ORDER BY attempt_number
        `)
        .all(sessionId)
        .map((row) => ({
          attemptNumber: Number(row.attempt_number),
          outcome: row.outcome,
          hitRank: row.hit_rank == null ? null : Number(row.hit_rank),
        })),
      [
        { attemptNumber: 1, outcome: "miss", hitRank: null },
        { attemptNumber: 2, outcome: "hit", hitRank: 3 },
      ],
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("version 12 history upgrades by arming only its latest tail without backfilled attempts", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-top5-v12-upgrade-"));
  const path = join(directory, "tracker.sqlite");
  let database = createDatabase({ path });
  try {
    ingestTrackerTraining(database, "v12-upgrade-training");
    database.sqlite.exec(`
      DROP TABLE follower_top5_attempts;
      DROP TABLE follower_top5_sessions;
      PRAGMA user_version = 12;
    `);
    database.close();

    database = createDatabase({ path });
    const state = trackerState(database);
    assert.equal(database.sqlite.prepare("PRAGMA user_version").get().user_version, 13);
    assert.equal(state.status, "armed");
    assert.equal(state.currentSession.anchor.number, 9);
    assert.equal(state.currentSession.attemptCount, 0);
    assert.deepEqual(state.currentSession.fixedNumbers, [5, 4, 3, 2, 1]);
    assert.deepEqual(state.lifetime, {
      totalSessions: 1,
      completedSessions: 0,
      invalidatedSessions: 0,
      trackedRounds: 0,
      hits: 0,
      misses: 0,
    });
    assert.equal(
      Number(database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM follower_top5_attempts")
        .get().count),
      0,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a reconciled shutdown gap keeps the post-gap frozen session usable", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-top5-reconcile-"));
  const path = join(directory, "tracker.sqlite");
  let database = createDatabase({ path, gapThresholdSeconds: 135 });
  try {
    ingestTrackerTraining(database, "reconcile-training", {
      secondsPerResult: 90,
      externalRoundIdStart: 8_000,
    });
    database.ingestBatch([
      event(8, "reconcile-live-miss", 990, { externalRoundId: "8011" }),
    ]);
    database.ingestBatchAfterGap(
      {
        source: SOURCE,
        instrument: INSTRUMENT,
        reason: "shutdown-with-unconfirmed-round-result",
        incidentKey: "top5-reconciled-shutdown",
        detectedAt: new Date(BASE_TIME + 1_080_100).toISOString(),
        message: "planned restart before snapshot confirmation",
      },
      [event(9, "reconcile-post-gap-anchor", 1_080, {
        externalRoundId: "8012",
      })],
    );
    const postGapSessionId = trackerState(database).currentSession.id;
    database.close();

    database = createDatabase({ path, gapThresholdSeconds: 135 });
    let state = trackerState(database);
    assert.equal(
      Number(database.sqlite.prepare("SELECT COUNT(*) AS count FROM incident_resolutions").get().count),
      1,
      "the shutdown boundary must be proven contiguous on reopen",
    );
    assert.equal(state.currentSession.id, postGapSessionId);
    assert.equal(state.currentSession.continuityEpoch, 0);

    database.ingestBatch([
      event(6, "reconcile-next-live-result", 1_170, { externalRoundId: "8013" }),
    ]);
    state = trackerState(database);
    assert.equal(state.currentSession.id, postGapSessionId);
    assert.equal(state.currentSession.attemptCount, 1);
    assert.equal(state.currentSession.attempts[0].resultNumber, 6);
    assert.equal(state.lifetime.invalidatedSessions, 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("state API and frontend share the persisted tracker and all-points contract", () => {
  const server = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

  assert.match(
    server,
    /followerTop5Tracker:\s*db\.getFollowerTop5TrackerState\('buleto',\s*config\.instrument\)/,
  );
  assert.match(app, /followerTop5Tracker/);
  assert.match(app, /follower-top5-live-v1/);
  assert.match(app, /persisted-batch-aware/);
  assert.match(app, /function normalizedFollowerTop5Tracker\(/);
  assert.match(app, /function normalizedFollowerAllPoints\(/);
  assert.match(app, /function renderFollowerTop5Tracker\(/);
  assert.match(app, /overall\?\.allPoints|overall\.allPoints/);

  for (const id of [
    "follower-live-tracker",
    "follower-live-status",
    "follower-live-source",
    "follower-live-fixed-list",
    "follower-live-lock-meta",
    "follower-live-current-attempt",
    "follower-live-attempt-summary",
    "follower-live-history-rate",
    "follower-live-history-detail",
    "follower-live-attempt-list",
    "follower-live-last-hit",
  ]) {
    assert.match(html, new RegExp(`\\bid="${id}"`));
    assert.match(app, new RegExp(`getElementById\\("${id}"\\)`));
  }
});
