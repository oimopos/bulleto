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
const ROULETTE_NUMBERS_FOR_TEST = Array.from({ length: 37 }, (_, number) => number);

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

function followerTransitionNumbers(sourceNumber, followers, { tail = true } = {}) {
  const numbers = followers.flatMap((follower) => [sourceNumber, follower]);
  if (tail) numbers.push(sourceNumber);
  return numbers;
}

function curveRows(segments) {
  let id = 0;
  return segments.flatMap((numbers, continuityEpoch) =>
    numbers.map((resultNumber) => {
      id += 1;
      return {
        id,
        result_number: resultNumber,
        settled_at: new Date(BASE_TIME + id * 1_000).toISOString(),
        continuity_epoch: continuityEpoch,
      };
    }),
  );
}

function compactWarmCandidates(candidates) {
  return candidates.map(({ rank, number, occurrenceCount, share }) => ({
    rank,
    number,
    occurrenceCount,
    share,
  }));
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

test("warm next-round signal includes an individual share exactly equal to five percent", () => {
  const followers = [
    ...Array.from({ length: 7 }, () => 1),
    ...Array.from({ length: 5 }, () => 2),
    ...Array.from({ length: 4 }, () => 3),
    ...Array.from({ length: 3 }, () => 4),
    5,
  ];
  const curve = buildFollowerTop5HitCurve(curveRows([
    followerTransitionNumbers(9, followers),
  ]));
  const warm = curve.warmNextRound;

  assert.deepEqual(
    {
      schemaVersion: warm.schemaVersion,
      algorithmVersion: warm.algorithmVersion,
      threshold: warm.threshold,
      comparison: warm.comparison,
      candidatePool: warm.candidatePool,
      topCount: warm.topCount,
      minimumObservedFollowerCount: warm.minimumObservedFollowerCount,
      evaluationMode: warm.evaluationMode,
      cohort: warm.cohort,
    },
    {
      schemaVersion: 1,
      algorithmVersion: "follower-warm-top5-next-v1",
      threshold: 0.05,
      comparison: "individual-share-gte",
      candidatePool: "dynamic-top5",
      topCount: 5,
      minimumObservedFollowerCount: 5,
      evaluationMode: "saved-sequence-retrospective",
      cohort: "anchors-with-known-next-round",
    },
  );
  assert.equal(warm.currentSignal.status, "ready");
  assert.equal(warm.currentSignal.sourceNumber, 9);
  assert.equal(warm.currentSignal.sampleSize, 20);
  assert.equal(warm.currentSignal.observedFollowerCount, 5);
  assert.deepEqual(
    compactWarmCandidates(warm.currentSignal.picks),
    [
      { rank: 1, number: 1, occurrenceCount: 7, share: 0.35 },
      { rank: 2, number: 2, occurrenceCount: 5, share: 0.25 },
      { rank: 3, number: 3, occurrenceCount: 4, share: 0.2 },
      { rank: 4, number: 4, occurrenceCount: 3, share: 0.15 },
      { rank: 5, number: 5, occurrenceCount: 1, share: 0.05 },
    ],
  );
  assert.equal(warm.eligibleCount, 0);
  assert.equal(warm.excludedMissingNextRoundCount, 1);
});

test("warm next-round reports below-threshold top-five anchors as no signal, not misses", () => {
  const uniqueFollowers = Array.from(
    { length: 22 },
    (_, index) => index < 9 ? index : index + 1,
  );
  const warm = buildFollowerTop5HitCurve(curveRows([
    followerTransitionNumbers(9, uniqueFollowers),
  ])).warmNextRound;

  assert.deepEqual(
    {
      eligibleCount: warm.eligibleCount,
      signalCount: warm.signalCount,
      noSignalCount: warm.noSignalCount,
      hitCount: warm.hitCount,
      missCount: warm.missCount,
      selectionCount: warm.selectionCount,
      hitRate: warm.hitRate,
      ticketHitRate: warm.ticketHitRate,
      coverage: warm.coverage,
      averageSelectionCount: warm.averageSelectionCount,
      randomBaselineRate: warm.randomBaselineRate,
      excludedMissingNextRoundCount: warm.excludedMissingNextRoundCount,
    },
    {
      eligibleCount: 17,
      signalCount: 16,
      noSignalCount: 1,
      hitCount: 0,
      missCount: 16,
      selectionCount: 80,
      hitRate: 0,
      ticketHitRate: 0,
      coverage: 16 / 17,
      averageSelectionCount: 5,
      randomBaselineRate: 5 / 37,
      excludedMissingNextRoundCount: 1,
    },
  );
  assert.equal(warm.currentSignal.status, "no_signal");
  assert.equal(warm.currentSignal.sampleSize, 22);
  assert.equal(warm.currentSignal.observedFollowerCount, 22);
  assert.deepEqual(warm.currentSignal.picks, []);
  assert.deepEqual(
    compactWarmCandidates(warm.currentSignal.candidates),
    [22, 21, 20, 19, 18].map((number, index) => ({
      rank: index + 1,
      number,
      occurrenceCount: 1,
      share: 1 / 22,
    })),
  );
  assert.equal(
    warm.currentSignal.candidates.every(({ share }) => share < warm.threshold),
    true,
  );
});

test("warm next-round supports variable pick counts and uses the signal count as its hit denominator", () => {
  const trainingFollowers = [
    ...Array.from({ length: 8 }, () => 1),
    ...Array.from({ length: 6 }, () => 2),
    ...Array.from({ length: 4 }, () => 3),
    4,
    5,
    6,
  ];
  const numbers = [
    ...followerTransitionNumbers(9, trainingFollowers, { tail: false }),
    9,
    1,
    9,
  ];
  const warm = buildFollowerTop5HitCurve(curveRows([numbers])).warmNextRound;

  assert.deepEqual(
    {
      eligibleCount: warm.eligibleCount,
      signalCount: warm.signalCount,
      noSignalCount: warm.noSignalCount,
      hitCount: warm.hitCount,
      missCount: warm.missCount,
      selectionCount: warm.selectionCount,
      hitRate: warm.hitRate,
      ticketHitRate: warm.ticketHitRate,
      coverage: warm.coverage,
      averageSelectionCount: warm.averageSelectionCount,
      randomBaselineRate: warm.randomBaselineRate,
    },
    {
      eligibleCount: 2,
      signalCount: 2,
      noSignalCount: 0,
      hitCount: 1,
      missCount: 1,
      selectionCount: 8,
      hitRate: 1 / 2,
      ticketHitRate: 1 / 8,
      coverage: 1,
      averageSelectionCount: 4,
      randomBaselineRate: 4 / 37,
    },
  );
  assert.equal(warm.currentSignal.status, "ready");
  assert.equal(warm.currentSignal.sampleSize, 22);
  assert.equal(warm.currentSignal.observedFollowerCount, 6);
  assert.deepEqual(
    compactWarmCandidates(warm.currentSignal.picks),
    [
      { rank: 1, number: 1, occurrenceCount: 9, share: 9 / 22 },
      { rank: 2, number: 2, occurrenceCount: 6, share: 6 / 22 },
      { rank: 3, number: 3, occurrenceCount: 4, share: 4 / 22 },
    ],
  );
  assert.deepEqual(
    compactWarmCandidates(warm.currentSignal.candidates.slice(3)),
    [
      { rank: 4, number: 6, occurrenceCount: 1, share: 1 / 22 },
      { rank: 5, number: 5, occurrenceCount: 1, share: 1 / 22 },
    ],
  );
});

test("warm next-round is walk-forward and does not promote an earlier result from later pairs", () => {
  const trainingFollowers = [
    ...Array.from({ length: 8 }, () => 1),
    ...Array.from({ length: 6 }, () => 2),
    ...Array.from({ length: 4 }, () => 3),
    4,
    5,
    6,
  ];
  const warm = buildFollowerTop5HitCurve(curveRows([
    [
      ...followerTransitionNumbers(9, trainingFollowers, { tail: false }),
      9,
      6,
    ],
    [9, 6, 9, 6],
  ])).warmNextRound;

  assert.deepEqual(
    {
      eligibleCount: warm.eligibleCount,
      signalCount: warm.signalCount,
      hitCount: warm.hitCount,
      missCount: warm.missCount,
      selectionCount: warm.selectionCount,
    },
    {
      eligibleCount: 4,
      signalCount: 4,
      hitCount: 2,
      missCount: 2,
      selectionCount: 16,
    },
  );
});

test("warm next-round never treats the first result after a gap as the prior anchor outcome", () => {
  const followers = [
    ...Array.from({ length: 7 }, () => 1),
    ...Array.from({ length: 5 }, () => 2),
    ...Array.from({ length: 4 }, () => 3),
    ...Array.from({ length: 3 }, () => 4),
    5,
  ];
  const warm = buildFollowerTop5HitCurve(curveRows([
    followerTransitionNumbers(9, followers),
    [1],
  ])).warmNextRound;

  assert.equal(warm.eligibleCount, 0);
  assert.equal(warm.signalCount, 0);
  assert.equal(warm.hitCount, 0);
  assert.equal(warm.missCount, 0);
  assert.equal(warm.excludedMissingNextRoundCount, 1);
});

test("warm current signal switches to gap when stream state advances without a result", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    ingestTrackerTraining(database, "warm-current-gap");
    const before = database.getFollowerTop5HitCurve(SOURCE, INSTRUMENT);
    assert.equal(before.warmNextRound.currentSignal.status, "ready");
    assert.equal(
      before.warmNextRound.historicalAccount.continuityGapCount,
      0,
    );
    assert.deepEqual(
      before.warmNextRound.currentSignal.picks.map(({ number }) => number),
      [5, 4, 3, 2, 1],
    );

    database.ingestBatchAfterGap(
      {
        source: SOURCE,
        instrument: INSTRUMENT,
        incidentKey: "warm-current-gap-boundary",
        detectedAt: new Date(BASE_TIME + 20_000).toISOString(),
        message: "known missing result",
      },
      [],
    );
    const after = database.getFollowerTop5HitCurve(SOURCE, INSTRUMENT);

    assert.equal(after.warmNextRound.currentSignal.status, "gap");
    assert.equal(
      after.warmNextRound.currentSignal.anchorResultId,
      before.warmNextRound.currentSignal.anchorResultId,
    );
    assert.equal(after.warmNextRound.currentSignal.sourceNumber, 9);
    assert.equal(after.warmNextRound.currentSignal.sampleSize, 5);
    assert.equal(after.warmNextRound.currentSignal.observedFollowerCount, 5);
    assert.deepEqual(after.warmNextRound.currentSignal.candidates, []);
    assert.deepEqual(after.warmNextRound.currentSignal.picks, []);
    assert.equal(
      after.warmNextRound.historicalAccount.continuityGapCount,
      1,
    );
    assert.equal(after.warmNextRound.historicalAccount.dataComplete, false);
    assert.equal(
      after.warmNextRound.historicalAccount.currentAction.reason,
      "gap",
    );
  } finally {
    database.close();
  }
});

test("warm historical account stakes only rank one even when rank two hits", () => {
  const numbers = [
    ...followerTransitionNumbers(9, [1, 1, 2, 3, 4, 5], { tail: false }),
    9,
    5,
    9,
    5,
    9,
  ];
  const warm = buildFollowerTop5HitCurve(curveRows([numbers])).warmNextRound;
  const account = warm.historicalAccount;

  assert.deepEqual(
    {
      schemaVersion: account.schemaVersion,
      algorithmVersion: account.algorithmVersion,
      mode: account.mode,
      executionEnabled: account.executionEnabled,
      strategy: account.strategy,
      model: account.model,
      initialBalance: account.initialBalance,
    },
    {
      schemaVersion: 1,
      algorithmVersion: "follower-warm-top1-ladder-v1",
      mode: "saved-sequence-retrospective",
      executionEnabled: false,
      strategy: {
        rank: 1,
        threshold: 0.05,
        noSignalPolicy: "pause",
        gapPolicy: "reset-ladder-keep-balance",
        exhaustionPolicy: "permanent-stop",
      },
      model: {
        modelVersion: "1.0.0",
        initialStake: 10,
        stakeStep: 10,
        maxStake: 2_500,
        grossPayoutMultiplier: 36,
        payoutIncludesStake: true,
      },
      initialBalance: 1_000,
    },
  );
  assert.equal(warm.hitCount, 2, "both outcomes are inside the wider warm top-five");
  assert.deepEqual(
    {
      status: account.status,
      signalCount: account.signalCount,
      betCount: account.betCount,
      hitCount: account.hitCount,
      missCount: account.missCount,
      totalStaked: account.totalStaked,
      totalGrossPayout: account.totalGrossPayout,
      finalBalance: account.finalBalance,
      netResult: account.netResult,
      nextStake: account.nextStake,
      minimumBalance: account.minimumBalance,
      ladder: account.ladder,
    },
    {
      status: "running",
      signalCount: 2,
      betCount: 2,
      hitCount: 1,
      missCount: 1,
      totalStaked: 20,
      totalGrossPayout: 360,
      finalBalance: 1_340,
      netResult: 340,
      nextStake: 10,
      minimumBalance: 990,
      ladder: { missCount: 0, totalStaked: 0 },
    },
  );
  assert.deepEqual(
    {
      targetNumber: account.latestOutcome.targetNumber,
      resultNumber: account.latestOutcome.resultNumber,
      stake: account.latestOutcome.stake,
      outcome: account.latestOutcome.outcome,
      grossPayout: account.latestOutcome.grossPayout,
      balanceAfter: account.latestOutcome.balanceAfter,
    },
    {
      targetNumber: 5,
      resultNumber: 5,
      stake: 10,
      outcome: "hit",
      grossPayout: 360,
      balanceAfter: 1_340,
    },
  );
});

test("warm historical account resets an elevated ladder after a hit", () => {
  const losingNumbers = ROULETTE_NUMBERS_FOR_TEST.filter(
    (number) => number !== 1 && number !== 9,
  );
  const trainingFollowers = [
    ...Array.from({ length: 40 }, () => 1),
    2,
    3,
    4,
    5,
  ];
  const firstThirtySixMisses = Array.from(
    { length: 36 },
    (_, index) => losingNumbers[index % losingNumbers.length],
  );
  const numbers = [
    ...followerTransitionNumbers(9, trainingFollowers, { tail: false }),
    ...followerTransitionNumbers(
      9,
      [...firstThirtySixMisses, 1, 2],
      { tail: false },
    ),
    9,
  ];
  const account = buildFollowerTop5HitCurve(curveRows([numbers]))
    .warmNextRound.historicalAccount;

  assert.deepEqual(
    {
      signalCount: account.signalCount,
      betCount: account.betCount,
      hitCount: account.hitCount,
      missCount: account.missCount,
      totalStaked: account.totalStaked,
      totalGrossPayout: account.totalGrossPayout,
      finalBalance: account.finalBalance,
      netResult: account.netResult,
      nextStake: account.nextStake,
      maximumStake: account.maximumStake,
      peakBalance: account.peakBalance,
      minimumBalance: account.minimumBalance,
      maximumDrawdown: account.maximumDrawdown,
      ladder: account.ladder,
    },
    {
      signalCount: 38,
      betCount: 38,
      hitCount: 1,
      missCount: 37,
      totalStaked: 390,
      totalGrossPayout: 720,
      finalBalance: 1_330,
      netResult: 330,
      nextStake: 10,
      maximumStake: 20,
      peakBalance: 1_340,
      minimumBalance: 640,
      maximumDrawdown: 360,
      ladder: { missCount: 1, totalStaked: 10 },
    },
  );
  assert.equal(account.latestOutcome.stake, 10);
  assert.equal(account.latestOutcome.outcome, "miss");
  assert.equal(account.latestOutcome.resultNumber, 2);
});

test("warm historical account pauses without charging on a no-signal anchor", () => {
  const uniqueFollowers = Array.from(
    { length: 22 },
    (_, index) => index < 9 ? index : index + 1,
  );
  const account = buildFollowerTop5HitCurve(curveRows([
    followerTransitionNumbers(9, uniqueFollowers),
  ])).warmNextRound.historicalAccount;

  assert.deepEqual(
    {
      signalCount: account.signalCount,
      noSignalCount: account.noSignalCount,
      betCount: account.betCount,
      hitCount: account.hitCount,
      missCount: account.missCount,
      totalStaked: account.totalStaked,
      finalBalance: account.finalBalance,
      nextStake: account.nextStake,
      ladder: account.ladder,
      currentAction: account.currentAction,
    },
    {
      signalCount: 16,
      noSignalCount: 1,
      betCount: 16,
      hitCount: 0,
      missCount: 16,
      totalStaked: 160,
      finalBalance: 840,
      nextStake: 10,
      ladder: { missCount: 16, totalStaked: 160 },
      currentAction: {
        action: "wait",
        reason: "no_signal",
        targetNumber: null,
        stake: null,
        anchorResultId: 45,
      },
    },
  );
});

test("warm historical account resets its ladder at a gap without restoring balance", () => {
  const losingNumbers = ROULETTE_NUMBERS_FOR_TEST.filter(
    (number) => number !== 1 && number !== 9,
  );
  const trainingFollowers = [
    ...Array.from({ length: 40 }, () => 1),
    2,
    3,
    4,
    5,
  ];
  const missesBeforeGap = Array.from(
    { length: 36 },
    (_, index) => losingNumbers[index % losingNumbers.length],
  );
  const account = buildFollowerTop5HitCurve(curveRows([
    [
      ...followerTransitionNumbers(9, trainingFollowers, { tail: false }),
      ...followerTransitionNumbers(9, missesBeforeGap, { tail: false }),
    ],
    [9, 2, 9],
  ])).warmNextRound.historicalAccount;

  assert.deepEqual(
    {
      status: account.status,
      signalCount: account.signalCount,
      betCount: account.betCount,
      missCount: account.missCount,
      totalStaked: account.totalStaked,
      finalBalance: account.finalBalance,
      nextStake: account.nextStake,
      maximumStake: account.maximumStake,
      continuityGapCount: account.continuityGapCount,
      dataComplete: account.dataComplete,
      ladder: account.ladder,
    },
    {
      status: "running",
      signalCount: 37,
      betCount: 37,
      missCount: 37,
      totalStaked: 370,
      finalBalance: 630,
      nextStake: 10,
      maximumStake: 10,
      continuityGapCount: 1,
      dataComplete: false,
      ladder: { missCount: 1, totalStaked: 10 },
    },
  );
  assert.equal(account.latestOutcome.stake, 10);
  assert.equal(account.latestOutcome.balanceAfter, 630);
});

test("warm historical account selects every target walk-forward without lookahead", () => {
  const numbers = [
    ...followerTransitionNumbers(9, [1, 1, 2, 3, 4, 6], { tail: false }),
    9,
    6,
    9,
    6,
    9,
  ];
  const warm = buildFollowerTop5HitCurve(curveRows([numbers])).warmNextRound;
  const account = warm.historicalAccount;

  assert.equal(warm.hitCount, 2);
  assert.deepEqual(
    {
      signalCount: account.signalCount,
      betCount: account.betCount,
      hitCount: account.hitCount,
      missCount: account.missCount,
      totalStaked: account.totalStaked,
      totalGrossPayout: account.totalGrossPayout,
      finalBalance: account.finalBalance,
      minimumBalance: account.minimumBalance,
      ladder: account.ladder,
    },
    {
      signalCount: 2,
      betCount: 2,
      hitCount: 1,
      missCount: 1,
      totalStaked: 20,
      totalGrossPayout: 360,
      finalBalance: 1_340,
      minimumBalance: 990,
      ladder: { missCount: 0, totalStaked: 0 },
    },
  );
  assert.equal(account.latestOutcome.targetNumber, 6);
  assert.equal(account.latestOutcome.resultNumber, 6);
  assert.equal(account.latestOutcome.outcome, "hit");
});

test("warm historical account exhausts after 63 misses and skips every later signal", () => {
  const losingNumbers = ROULETTE_NUMBERS_FOR_TEST.filter(
    (number) => number !== 1 && number !== 9,
  );
  const trainingFollowers = [
    ...Array.from({ length: 100 }, () => 1),
    2,
    3,
    4,
    5,
  ];
  const sixtyFourMisses = Array.from(
    { length: 64 },
    (_, index) => losingNumbers[index % losingNumbers.length],
  );
  const rows = curveRows([[
    ...followerTransitionNumbers(9, trainingFollowers, { tail: false }),
    ...followerTransitionNumbers(9, sixtyFourMisses, { tail: false }),
    9,
  ]]);
  const account = buildFollowerTop5HitCurve(rows)
    .warmNextRound.historicalAccount;

  assert.deepEqual(
    {
      status: account.status,
      initialBalance: account.initialBalance,
      finalBalance: account.finalBalance,
      netResult: account.netResult,
      nextStake: account.nextStake,
      canAffordNext: account.canAffordNext,
      shortfall: account.shortfall,
      signalCount: account.signalCount,
      betCount: account.betCount,
      hitCount: account.hitCount,
      missCount: account.missCount,
      totalStaked: account.totalStaked,
      totalGrossPayout: account.totalGrossPayout,
      skippedAfterExhaustionCount: account.skippedAfterExhaustionCount,
      peakBalance: account.peakBalance,
      minimumBalance: account.minimumBalance,
      maximumDrawdown: account.maximumDrawdown,
      maximumStake: account.maximumStake,
      ladder: account.ladder,
    },
    {
      status: "exhausted",
      initialBalance: 1_000,
      finalBalance: 10,
      netResult: -990,
      nextStake: 30,
      canAffordNext: false,
      shortfall: 20,
      signalCount: 64,
      betCount: 63,
      hitCount: 0,
      missCount: 63,
      totalStaked: 990,
      totalGrossPayout: 0,
      skippedAfterExhaustionCount: 1,
      peakBalance: 1_000,
      minimumBalance: 10,
      maximumDrawdown: 990,
      maximumStake: 30,
      ladder: { missCount: 63, totalStaked: 990 },
    },
  );
  assert.equal(account.exhaustedAt, account.lastBetAt);
  assert.equal(account.latestOutcome.outcome, "miss");
  assert.equal(account.latestOutcome.stake, 30);
  assert.equal(account.latestOutcome.balanceAfter, 10);
  assert.equal(account.latestOutcome.resultNumber, sixtyFourMisses[62]);
  assert.deepEqual(account.currentAction, {
    action: "wait",
    reason: "bankroll_exhausted",
    targetNumber: 1,
    stake: 30,
    anchorResultId: rows.at(-1).id,
  });
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
