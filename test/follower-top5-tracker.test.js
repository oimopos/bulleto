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
const GATED_CALIBRATION_SEGMENTS = Object.freeze([
  { sourceNumber: 0, followers: [1, 2, 3, 4, 5] },
  { sourceNumber: 6, followers: [7, 8, 9, 10, 11] },
  { sourceNumber: 12, followers: [13, 14, 15, 16, 17] },
  { sourceNumber: 18, followers: [19, 20, 21, 22, 23] },
  { sourceNumber: 24, followers: [25, 26, 27, 28, 29] },
]);
const GATED_CURRENT_SOURCE = 30;
const GATED_CURRENT_FOLLOWERS = Object.freeze([31, 32, 33, 34, 35]);
const GATED_FILLER = 36;

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

function createTrackerFixtureWriter(database, prefix) {
  let offsetSeconds = 0;
  let eventIndex = 0;
  let gapIndex = 0;
  return {
    ingest(numbers) {
      const events = numbers.map((number) => {
        const item = event(
          number,
          `${prefix}-event-${eventIndex}`,
          offsetSeconds,
        );
        eventIndex += 1;
        offsetSeconds += 1;
        return item;
      });
      database.ingestBatch(events);
    },
    gap(label = "boundary") {
      const detectedAt = new Date(
        BASE_TIME + offsetSeconds * 1_000,
      ).toISOString();
      database.ingestBatchAfterGap(
        {
          source: SOURCE,
          instrument: INSTRUMENT,
          incidentKey: `${prefix}-gap-${gapIndex}-${label}`,
          detectedAt,
          message: "known missing result in gated-account fixture",
        },
        [],
      );
      gapIndex += 1;
      offsetSeconds += 1;
    },
  };
}

function completeTop5Window(followers, firstHitOffset = null) {
  const numbers = Array.from({ length: 20 }, () => GATED_FILLER);
  if (firstHitOffset !== null) {
    numbers[firstHitOffset - 1] = followers.at(-1);
  }
  return numbers;
}

function ingestGatedCalibrationSegment(
  writer,
  segment,
  firstHitOffset,
  { gapAfter = true } = {},
) {
  writer.ingest(followerTransitionNumbers(
    segment.sourceNumber,
    segment.followers,
  ));
  writer.ingest(completeTop5Window(segment.followers, firstHitOffset));
  if (gapAfter) writer.gap(`after-source-${segment.sourceNumber}`);
}

function ingestGatedCalibrationCohort(writer, firstHitOffsets) {
  firstHitOffsets.forEach((firstHitOffset, index) => {
    ingestGatedCalibrationSegment(
      writer,
      GATED_CALIBRATION_SEGMENTS[index],
      firstHitOffset,
    );
  });
}

function armGatedCurrentSession(writer) {
  writer.ingest(followerTransitionNumbers(
    GATED_CURRENT_SOURCE,
    GATED_CURRENT_FOLLOWERS,
  ));
}

function compactWarmCandidates(candidates) {
  return candidates.map(({ rank, number, occurrenceCount, share }) => ({
    rank,
    number,
    occurrenceCount,
    share,
  }));
}

function assertWarmAccountInvariants(account) {
  assert.equal(account.hitCount + account.missCount, account.betCount);
  assert.equal(
    account.betCount + account.skippedAfterExhaustionCount,
    account.eligibleAnchorCount,
  );
  assert.equal(
    account.initialBalance - account.totalStaked + account.totalGrossPayout,
    account.finalBalance,
  );
  assert.equal(account.finalBalance - account.initialBalance, account.netResult);
  assert.equal(
    account.nextRoundCost,
    account.model.numbersPerRound * account.nextStakePerNumber,
  );
  assert.equal(
    account.shortfall,
    Math.max(0, account.nextRoundCost - account.finalBalance),
  );
  assert.equal(
    account.canAffordNextRound,
    account.status !== "exhausted"
      && account.finalBalance >= account.nextRoundCost,
  );
  assert.equal(
    account.maxRoundCost,
    account.model.numbersPerRound * account.maxStakePerNumber,
  );
  assert.ok(account.peakBalance >= account.initialBalance);
  assert.ok(account.peakBalance >= account.finalBalance);
  assert.ok(account.minimumBalance <= account.initialBalance);
  assert.ok(account.minimumBalance <= account.finalBalance);
  assert.ok(account.maximumDrawdown >= account.peakBalance - account.finalBalance);

  if (account.latestOutcome) {
    const outcome = account.latestOutcome;
    assert.equal(outcome.selectionCount, account.model.numbersPerRound);
    assert.equal(outcome.targetNumbers.length, account.model.numbersPerRound);
    assert.equal(new Set(outcome.targetNumbers).size, account.model.numbersPerRound);
    assert.equal(
      outcome.totalStake,
      account.model.numbersPerRound * outcome.stakePerNumber,
    );
    assert.equal(
      outcome.grossPayout,
      outcome.outcome === "hit"
        ? account.model.grossPayoutMultiplier * outcome.stakePerNumber
        : 0,
    );
    if (outcome.outcome === "hit") {
      assert.equal(
        outcome.targetNumbers[outcome.hitRank - 1],
        outcome.resultNumber,
      );
    } else {
      assert.equal(outcome.hitRank, null);
      assert.equal(outcome.targetNumbers.includes(outcome.resultNumber), false);
    }
  }
}

function assertGatedAccountInvariants(account) {
  assert.equal(
    account.observedWithoutBetCount + account.eligibleBetCount,
    account.trackedAttemptCount,
  );
  assert.equal(
    account.betCount + account.skippedAfterExhaustionCount,
    account.eligibleBetCount,
  );
  assert.equal(account.hitCount + account.missCount, account.betCount);
  assert.equal(
    account.initialBalance - account.totalStaked + account.totalGrossPayout,
    account.finalBalance,
  );
  assert.equal(account.finalBalance - account.initialBalance, account.netResult);
  assert.equal(
    account.nextRoundCost,
    account.model.numbersPerRound * account.nextStakePerNumber,
  );
  assert.equal(
    account.shortfall,
    Math.max(0, account.nextRoundCost - account.finalBalance),
  );
  assert.equal(
    account.canAffordNextRound,
    account.status !== "exhausted"
      && account.finalBalance >= account.nextRoundCost,
  );
  assert.equal(
    account.maxRoundCost,
    account.model.numbersPerRound * account.maxStakePerNumber,
  );

  if (account.latestOutcome) {
    const outcome = account.latestOutcome;
    assert.equal(outcome.selectionCount, account.model.numbersPerRound);
    assert.equal(outcome.targetNumbers.length, account.model.numbersPerRound);
    assert.equal(new Set(outcome.targetNumbers).size, account.model.numbersPerRound);
    assert.equal(
      outcome.totalStake,
      account.model.numbersPerRound * outcome.stakePerNumber,
    );
    assert.equal(
      outcome.grossPayout,
      outcome.outcome === "hit"
        ? account.model.grossPayoutMultiplier * outcome.stakePerNumber
        : 0,
    );
    assert.ok(outcome.gateEvidence.eligibleCount > 0);
    assert.equal(
      outcome.gateEvidence.rate,
      outcome.gateEvidence.hitCount / outcome.gateEvidence.eligibleCount,
    );
    assert.ok(
      5 * outcome.gateEvidence.hitCount
        >= 4 * outcome.gateEvidence.eligibleCount,
    );
  }
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

    const emptyState = trackerState(database);
    const { gatedAccount, ...tracker } = emptyState;
    assert.deepEqual(tracker, {
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
    assert.deepEqual(
      {
        schemaVersion: gatedAccount.schemaVersion,
        algorithmVersion: gatedAccount.algorithmVersion,
        mode: gatedAccount.mode,
        executionEnabled: gatedAccount.executionEnabled,
        strategy: gatedAccount.strategy,
        model: gatedAccount.model,
        status: gatedAccount.status,
        initialBalance: gatedAccount.initialBalance,
        finalBalance: gatedAccount.finalBalance,
        nextStakePerNumber: gatedAccount.nextStakePerNumber,
        nextRoundCost: gatedAccount.nextRoundCost,
        trackedSessionCount: gatedAccount.trackedSessionCount,
        trackedAttemptCount: gatedAccount.trackedAttemptCount,
        qualifiedSessionCount: gatedAccount.qualifiedSessionCount,
        observedWithoutBetCount: gatedAccount.observedWithoutBetCount,
        eligibleBetCount: gatedAccount.eligibleBetCount,
        betCount: gatedAccount.betCount,
        hitCount: gatedAccount.hitCount,
        missCount: gatedAccount.missCount,
        ladder: gatedAccount.ladder,
        latestOutcome: gatedAccount.latestOutcome,
        currentAction: gatedAccount.currentAction,
      },
      {
        schemaVersion: 1,
        algorithmVersion: "follower-top5-cumulative80-ladder-v1",
        mode: "persisted-session-retrospective",
        executionEnabled: false,
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
        status: "waiting",
        initialBalance: 10_000,
        finalBalance: 10_000,
        nextStakePerNumber: 10,
        nextRoundCost: 50,
        trackedSessionCount: 0,
        trackedAttemptCount: 0,
        qualifiedSessionCount: 0,
        observedWithoutBetCount: 0,
        eligibleBetCount: 0,
        betCount: 0,
        hitCount: 0,
        missCount: 0,
        ladder: { missCount: 0, totalLoss: 0 },
        latestOutcome: null,
        currentAction: {
          action: "wait",
          reason: "waiting_training",
          sessionId: null,
          attemptNumber: null,
          targetNumbers: [],
          selectionCount: 0,
          bettingStarted: false,
          startAttempt: null,
          startEvidence: null,
          cumulativeRate: null,
          hitCount: null,
          eligibleCount: null,
          historyMaxResultId: null,
          historyThrough: null,
          stakePerNumber: null,
          totalStake: null,
          anchorResultId: null,
        },
      },
    );
    assertGatedAccountInvariants(gatedAccount);
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

test("warm historical account pays one 36x payout when rank two of five hits", () => {
  const numbers = [
    ...followerTransitionNumbers(9, [1, 1, 2, 3, 4, 5], { tail: false }),
    9,
    5,
    9,
  ];
  const account = buildFollowerTop5HitCurve(curveRows([numbers]))
    .warmNextRound.historicalAccount;

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
      algorithmVersion: "follower-warm-top5-ladder-v2",
      mode: "saved-sequence-retrospective",
      executionEnabled: false,
      strategy: {
        selectionMode: "dynamic-top5",
        selectionCount: 5,
        threshold: null,
        minimumObservedFollowerCount: 5,
        eligibleAnchorPolicy: "every-known-next",
        gapPolicy: "reset-ladder-keep-balance",
        exhaustionPolicy: "permanent-stop",
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
      initialBalance: 10_000,
    },
  );
  assert.deepEqual(
    {
      status: account.status,
      eligibleAnchorCount: account.eligibleAnchorCount,
      betCount: account.betCount,
      hitCount: account.hitCount,
      missCount: account.missCount,
      totalStaked: account.totalStaked,
      totalGrossPayout: account.totalGrossPayout,
      finalBalance: account.finalBalance,
      netResult: account.netResult,
      nextStakePerNumber: account.nextStakePerNumber,
      nextRoundCost: account.nextRoundCost,
      peakBalance: account.peakBalance,
      minimumBalance: account.minimumBalance,
      maximumDrawdown: account.maximumDrawdown,
      ladder: account.ladder,
    },
    {
      status: "running",
      eligibleAnchorCount: 1,
      betCount: 1,
      hitCount: 1,
      missCount: 0,
      totalStaked: 50,
      totalGrossPayout: 360,
      finalBalance: 10_310,
      netResult: 310,
      nextStakePerNumber: 10,
      nextRoundCost: 50,
      peakBalance: 10_310,
      minimumBalance: 10_000,
      maximumDrawdown: 0,
      ladder: { missCount: 0, totalLoss: 0 },
    },
  );
  assert.deepEqual(
    {
      sourceNumber: account.latestOutcome.sourceNumber,
      targetNumbers: account.latestOutcome.targetNumbers,
      selectionCount: account.latestOutcome.selectionCount,
      resultNumber: account.latestOutcome.resultNumber,
      hitRank: account.latestOutcome.hitRank,
      stakePerNumber: account.latestOutcome.stakePerNumber,
      totalStake: account.latestOutcome.totalStake,
      outcome: account.latestOutcome.outcome,
      grossPayout: account.latestOutcome.grossPayout,
      balanceAfter: account.latestOutcome.balanceAfter,
    },
    {
      sourceNumber: 9,
      targetNumbers: [1, 5, 4, 3, 2],
      selectionCount: 5,
      resultNumber: 5,
      hitRank: 2,
      stakePerNumber: 10,
      totalStake: 50,
      outcome: "hit",
      grossPayout: 360,
      balanceAfter: 10_310,
    },
  );
  assertWarmAccountInvariants(account);
});

test("warm historical account freezes each raw top five before learning its outcome", () => {
  const training = followerTransitionNumbers(9, [1, 2, 3, 4, 5], {
    tail: false,
  });
  const prefixNumbers = [...training, 9, 6, 9];
  const prefixAccount = buildFollowerTop5HitCurve(curveRows([prefixNumbers]))
    .warmNextRound.historicalAccount;

  assert.deepEqual(prefixAccount.latestOutcome.targetNumbers, [5, 4, 3, 2, 1]);
  assert.equal(prefixAccount.latestOutcome.resultNumber, 6);
  assert.equal(prefixAccount.latestOutcome.outcome, "miss");
  assert.deepEqual(prefixAccount.currentAction, {
    action: "would_bet",
    reason: "eligible",
    targetNumbers: [6, 5, 4, 3, 2],
    selectionCount: 5,
    stakePerNumber: 10,
    totalStake: 50,
    anchorResultId: prefixNumbers.length,
  });

  const account = buildFollowerTop5HitCurve(curveRows([
    [...prefixNumbers, 6, 9],
  ])).warmNextRound.historicalAccount;
  assert.deepEqual(
    {
      eligibleAnchorCount: account.eligibleAnchorCount,
      betCount: account.betCount,
      hitCount: account.hitCount,
      missCount: account.missCount,
      totalStaked: account.totalStaked,
      totalGrossPayout: account.totalGrossPayout,
      finalBalance: account.finalBalance,
      netResult: account.netResult,
      ladder: account.ladder,
    },
    {
      eligibleAnchorCount: 2,
      betCount: 2,
      hitCount: 1,
      missCount: 1,
      totalStaked: 100,
      totalGrossPayout: 360,
      finalBalance: 10_260,
      netResult: 260,
      ladder: { missCount: 0, totalLoss: 0 },
    },
  );
  assert.deepEqual(account.latestOutcome.targetNumbers, [6, 5, 4, 3, 2]);
  assert.equal(account.latestOutcome.resultNumber, 6);
  assert.equal(account.latestOutcome.hitRank, 1);
  assert.equal(account.latestOutcome.outcome, "hit");
  assertWarmAccountInvariants(prefixAccount);
  assertWarmAccountInvariants(account);
});

test("warm historical account uses the shared 31x ladder and resets it on hit", () => {
  const trainingFollowers = [
    ...Array.from({ length: 40 }, () => 1),
    2,
    3,
    4,
    5,
  ];
  const sevenMisses = [0, 6, 7, 8, 10, 11, 12];
  const numbers = [
    ...followerTransitionNumbers(9, trainingFollowers, { tail: false }),
    ...followerTransitionNumbers(9, [...sevenMisses, 1], { tail: false }),
    9,
  ];
  const account = buildFollowerTop5HitCurve(curveRows([numbers]))
    .warmNextRound.historicalAccount;

  assert.deepEqual(
    {
      eligibleAnchorCount: account.eligibleAnchorCount,
      betCount: account.betCount,
      hitCount: account.hitCount,
      missCount: account.missCount,
      totalStaked: account.totalStaked,
      totalGrossPayout: account.totalGrossPayout,
      finalBalance: account.finalBalance,
      netResult: account.netResult,
      nextStakePerNumber: account.nextStakePerNumber,
      nextRoundCost: account.nextRoundCost,
      maxStakePerNumber: account.maxStakePerNumber,
      maxRoundCost: account.maxRoundCost,
      peakBalance: account.peakBalance,
      minimumBalance: account.minimumBalance,
      maximumDrawdown: account.maximumDrawdown,
      ladder: account.ladder,
    },
    {
      eligibleAnchorCount: 8,
      betCount: 8,
      hitCount: 1,
      missCount: 7,
      totalStaked: 450,
      totalGrossPayout: 720,
      finalBalance: 10_270,
      netResult: 270,
      nextStakePerNumber: 10,
      nextRoundCost: 50,
      maxStakePerNumber: 20,
      maxRoundCost: 100,
      peakBalance: 10_270,
      minimumBalance: 9_650,
      maximumDrawdown: 350,
      ladder: { missCount: 0, totalLoss: 0 },
    },
  );
  assert.equal(account.latestOutcome.stakePerNumber, 20);
  assert.equal(account.latestOutcome.totalStake, 100);
  assert.equal(account.latestOutcome.outcome, "hit");
  assert.equal(account.latestOutcome.grossPayout, 720);
  assert.equal(account.latestOutcome.balanceAfter, 10_270);
  assert.equal(31 * account.latestOutcome.stakePerNumber - 350, 270);
  assertWarmAccountInvariants(account);
});

test("warm historical account bets the raw top five even when warm picks are empty", () => {
  const uniqueFollowers = Array.from(
    { length: 22 },
    (_, index) => index < 9 ? index : index + 1,
  );
  const warm = buildFollowerTop5HitCurve(curveRows([
    followerTransitionNumbers(9, uniqueFollowers),
  ])).warmNextRound;
  const account = warm.historicalAccount;

  assert.equal(warm.currentSignal.status, "no_signal");
  assert.deepEqual(warm.currentSignal.picks, []);
  assert.equal(warm.currentSignal.candidates.length, 5);
  assert.deepEqual(
    {
      status: account.status,
      eligibleAnchorCount: account.eligibleAnchorCount,
      betCount: account.betCount,
      hitCount: account.hitCount,
      missCount: account.missCount,
      totalStaked: account.totalStaked,
      totalGrossPayout: account.totalGrossPayout,
      finalBalance: account.finalBalance,
      netResult: account.netResult,
      nextStakePerNumber: account.nextStakePerNumber,
      nextRoundCost: account.nextRoundCost,
      maxStakePerNumber: account.maxStakePerNumber,
      maxRoundCost: account.maxRoundCost,
      ladder: account.ladder,
      currentAction: account.currentAction,
    },
    {
      status: "running",
      eligibleAnchorCount: 17,
      betCount: 17,
      hitCount: 0,
      missCount: 17,
      totalStaked: 2_250,
      totalGrossPayout: 0,
      finalBalance: 7_750,
      netResult: -2_250,
      nextStakePerNumber: 80,
      nextRoundCost: 400,
      maxStakePerNumber: 70,
      maxRoundCost: 350,
      ladder: { missCount: 17, totalLoss: 2_250 },
      currentAction: {
        action: "would_bet",
        reason: "eligible",
        targetNumbers: [22, 21, 20, 19, 18],
        selectionCount: 5,
        stakePerNumber: 80,
        totalStake: 400,
        anchorResultId: 45,
      },
    },
  );
  assert.deepEqual(account.latestOutcome.targetNumbers, [21, 20, 19, 18, 17]);
  assert.equal(account.latestOutcome.resultNumber, 22);
  assert.equal(account.latestOutcome.stakePerNumber, 70);
  assert.equal(account.latestOutcome.totalStake, 350);
  assertWarmAccountInvariants(account);
});

test("warm historical account resets its shared ladder at a gap without restoring cash", () => {
  const trainingFollowers = [
    ...Array.from({ length: 40 }, () => 1),
    2,
    3,
    4,
    5,
  ];
  const sevenMisses = [0, 6, 7, 8, 10, 11, 12];
  const account = buildFollowerTop5HitCurve(curveRows([
    [
      ...followerTransitionNumbers(9, trainingFollowers, { tail: false }),
      ...followerTransitionNumbers(9, sevenMisses, { tail: false }),
    ],
    [9, 13, 9],
  ])).warmNextRound.historicalAccount;

  assert.deepEqual(
    {
      status: account.status,
      eligibleAnchorCount: account.eligibleAnchorCount,
      betCount: account.betCount,
      hitCount: account.hitCount,
      missCount: account.missCount,
      totalStaked: account.totalStaked,
      finalBalance: account.finalBalance,
      nextStakePerNumber: account.nextStakePerNumber,
      nextRoundCost: account.nextRoundCost,
      maxStakePerNumber: account.maxStakePerNumber,
      maxRoundCost: account.maxRoundCost,
      continuityGapCount: account.continuityGapCount,
      dataComplete: account.dataComplete,
      ladder: account.ladder,
    },
    {
      status: "running",
      eligibleAnchorCount: 8,
      betCount: 8,
      hitCount: 0,
      missCount: 8,
      totalStaked: 400,
      finalBalance: 9_600,
      nextStakePerNumber: 10,
      nextRoundCost: 50,
      maxStakePerNumber: 10,
      maxRoundCost: 50,
      continuityGapCount: 1,
      dataComplete: false,
      ladder: { missCount: 1, totalLoss: 50 },
    },
  );
  assert.equal(account.latestOutcome.stakePerNumber, 10);
  assert.equal(account.latestOutcome.totalStake, 50);
  assert.equal(account.latestOutcome.balanceAfter, 9_600);
  assert.equal(account.latestOutcome.resultNumber, 13);
  assertWarmAccountInvariants(account);
});

test("warm historical account exhausts on total ticket cost and permanently skips a later hit", () => {
  const trainingFollowers = [
    ...Array.from({ length: 100 }, () => 1),
    ...Array.from({ length: 50 }, () => 2),
    ...Array.from({ length: 25 }, () => 3),
    ...Array.from({ length: 10 }, () => 4),
    5,
  ];
  const firstTwentySixMisses = ROULETTE_NUMBERS_FOR_TEST.filter(
    (number) => ![1, 2, 3, 4, 5, 9].includes(number),
  ).slice(0, 26);
  const rows = curveRows([[
    ...followerTransitionNumbers(9, trainingFollowers, { tail: false }),
    ...followerTransitionNumbers(
      9,
      [...firstTwentySixMisses, 1],
      { tail: false },
    ),
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
      nextStakePerNumber: account.nextStakePerNumber,
      nextRoundCost: account.nextRoundCost,
      canAffordNextRound: account.canAffordNextRound,
      shortfall: account.shortfall,
      eligibleAnchorCount: account.eligibleAnchorCount,
      betCount: account.betCount,
      hitCount: account.hitCount,
      missCount: account.missCount,
      totalStaked: account.totalStaked,
      totalGrossPayout: account.totalGrossPayout,
      skippedAfterExhaustionCount: account.skippedAfterExhaustionCount,
      peakBalance: account.peakBalance,
      minimumBalance: account.minimumBalance,
      maximumDrawdown: account.maximumDrawdown,
      maxStakePerNumber: account.maxStakePerNumber,
      maxRoundCost: account.maxRoundCost,
      ladder: account.ladder,
    },
    {
      status: "exhausted",
      initialBalance: 10_000,
      finalBalance: 1_000,
      netResult: -9_000,
      nextStakePerNumber: 300,
      nextRoundCost: 1_500,
      canAffordNextRound: false,
      shortfall: 500,
      eligibleAnchorCount: 27,
      betCount: 26,
      hitCount: 0,
      missCount: 26,
      totalStaked: 9_000,
      totalGrossPayout: 0,
      skippedAfterExhaustionCount: 1,
      peakBalance: 10_000,
      minimumBalance: 1_000,
      maximumDrawdown: 9_000,
      maxStakePerNumber: 250,
      maxRoundCost: 1_250,
      ladder: { missCount: 26, totalLoss: 9_000 },
    },
  );
  assert.equal(
    account.finalBalance >= account.nextStakePerNumber,
    true,
    "one number is affordable but the complete five-number ticket is not",
  );
  assert.equal(account.exhaustedAt, account.lastBetAt);
  assert.equal(account.latestOutcome.outcome, "miss");
  assert.equal(account.latestOutcome.stakePerNumber, 250);
  assert.equal(account.latestOutcome.totalStake, 1_250);
  assert.equal(account.latestOutcome.balanceAfter, 1_000);
  assert.equal(account.latestOutcome.resultNumber, firstTwentySixMisses.at(-1));
  assert.ok(
    account.latestOutcome.resultId < rows.at(-2).id,
    "the later dominant-number hit is skipped after permanent exhaustion",
  );
  assert.deepEqual(account.currentAction, {
    action: "wait",
    reason: "bankroll_exhausted",
    targetNumbers: [1, 2, 3, 4, firstTwentySixMisses.at(-1)],
    selectionCount: 5,
    stakePerNumber: 300,
    totalStake: 1_500,
    anchorResultId: rows.at(-1).id,
  });
  assertWarmAccountInvariants(account);
});

test("frozen Top-5 gated account crosses exact 80 percent only on the next pre-attempt prefix", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const writer = createTrackerFixtureWriter(database, "gated-prefix");
    ingestGatedCalibrationCohort(writer, [null, 1, 1, 1]);

    const pending = GATED_CALIBRATION_SEGMENTS[4];
    writer.ingest(followerTransitionNumbers(
      pending.sourceNumber,
      pending.followers,
    ));
    writer.ingest([
      pending.followers.at(-1),
      ...Array.from({ length: 7 }, () => GATED_FILLER),
      ...followerTransitionNumbers(
        GATED_CURRENT_SOURCE,
        GATED_CURRENT_FOLLOWERS,
      ),
    ]);

    let state = trackerState(database);
    assert.equal(state.currentSession.sourceNumber, GATED_CURRENT_SOURCE);
    assert.equal(state.currentSession.attemptCount, 0);
    assert.deepEqual(state.currentSession.fixedNumbers, [35, 34, 33, 32, 31]);
    assert.deepEqual(
      {
        action: state.gatedAccount.currentAction.action,
        reason: state.gatedAccount.currentAction.reason,
        attemptNumber: state.gatedAccount.currentAction.attemptNumber,
        bettingStarted: state.gatedAccount.currentAction.bettingStarted,
        cumulativeRate: state.gatedAccount.currentAction.cumulativeRate,
        hitCount: state.gatedAccount.currentAction.hitCount,
        eligibleCount: state.gatedAccount.currentAction.eligibleCount,
      },
      {
        action: "observe",
        reason: "below_threshold",
        attemptNumber: 1,
        bettingStarted: false,
        cumulativeRate: 3 / 4,
        hitCount: 3,
        eligibleCount: 4,
      },
    );

    writer.ingest([0]);
    state = trackerState(database);
    const attemptOne = state.currentSession.attempts[0];
    const beforeAttemptTwo = state.gatedAccount;
    assert.equal(attemptOne.attemptNumber, 1);
    assert.equal(attemptOne.outcome, "miss");
    assert.deepEqual(
      {
        action: beforeAttemptTwo.currentAction.action,
        reason: beforeAttemptTwo.currentAction.reason,
        attemptNumber: beforeAttemptTwo.currentAction.attemptNumber,
        bettingStarted: beforeAttemptTwo.currentAction.bettingStarted,
        startAttempt: beforeAttemptTwo.currentAction.startAttempt,
        cumulativeRate: beforeAttemptTwo.currentAction.cumulativeRate,
        hitCount: beforeAttemptTwo.currentAction.hitCount,
        eligibleCount: beforeAttemptTwo.currentAction.eligibleCount,
        historyMaxResultId: beforeAttemptTwo.currentAction.historyMaxResultId,
        startEvidence: beforeAttemptTwo.currentAction.startEvidence,
      },
      {
        action: "would_bet",
        reason: "threshold_reached",
        attemptNumber: 2,
        bettingStarted: true,
        startAttempt: 2,
        cumulativeRate: 4 / 5,
        hitCount: 4,
        eligibleCount: 5,
        historyMaxResultId: attemptOne.resultId,
        startEvidence: {
          horizon: 2,
          hitCount: 4,
          eligibleCount: 5,
          rate: 4 / 5,
          historyMaxResultId: attemptOne.resultId,
          historyThrough: attemptOne.settledAt,
        },
      },
    );
    assert.equal(beforeAttemptTwo.betCount, 0);
    assert.equal(beforeAttemptTwo.finalBalance, 10_000);

    writer.ingest([6]);
    const account = trackerState(database).gatedAccount;
    assert.deepEqual(
      {
        status: account.status,
        trackedSessionCount: account.trackedSessionCount,
        trackedAttemptCount: account.trackedAttemptCount,
        qualifiedSessionCount: account.qualifiedSessionCount,
        observedWithoutBetCount: account.observedWithoutBetCount,
        eligibleBetCount: account.eligibleBetCount,
        betCount: account.betCount,
        hitCount: account.hitCount,
        missCount: account.missCount,
        totalStaked: account.totalStaked,
        finalBalance: account.finalBalance,
        ladder: account.ladder,
      },
      {
        status: "running",
        trackedSessionCount: 6,
        trackedAttemptCount: 26,
        qualifiedSessionCount: 1,
        observedWithoutBetCount: 25,
        eligibleBetCount: 1,
        betCount: 1,
        hitCount: 0,
        missCount: 1,
        totalStaked: 50,
        finalBalance: 9_950,
        ladder: { missCount: 1, totalLoss: 50 },
      },
    );
    assert.equal(account.latestOutcome.attemptNumber, 2);
    assert.deepEqual(account.latestOutcome.targetNumbers, [35, 34, 33, 32, 31]);
    assert.equal(account.latestOutcome.resultNumber, 6);
    assert.equal(account.latestOutcome.outcome, "miss");
    assert.deepEqual(account.latestOutcome.gateEvidence, {
      horizon: 2,
      hitCount: 4,
      eligibleCount: 5,
      rate: 4 / 5,
      historyMaxResultId: attemptOne.resultId,
      historyThrough: attemptOne.settledAt,
    });
    assertGatedAccountInvariants(account);
  } finally {
    database.close();
  }
});

test("frozen Top-5 gate latches at attempt twenty, continues beyond the curve, and resets for the next session", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const writer = createTrackerFixtureWriter(database, "gated-latch");
    ingestGatedCalibrationCohort(writer, [null, 20, 20, 20, 20]);
    armGatedCurrentSession(writer);
    writer.ingest(Array.from({ length: 21 }, () => GATED_FILLER));

    let state = trackerState(database);
    let account = state.gatedAccount;
    const attemptNineteen = state.currentSession.attempts[18];
    assert.deepEqual(
      {
        trackedSessionCount: account.trackedSessionCount,
        trackedAttemptCount: account.trackedAttemptCount,
        qualifiedSessionCount: account.qualifiedSessionCount,
        observedWithoutBetCount: account.observedWithoutBetCount,
        eligibleBetCount: account.eligibleBetCount,
        betCount: account.betCount,
        hitCount: account.hitCount,
        missCount: account.missCount,
        totalStaked: account.totalStaked,
        finalBalance: account.finalBalance,
        ladder: account.ladder,
      },
      {
        trackedSessionCount: 6,
        trackedAttemptCount: 121,
        qualifiedSessionCount: 1,
        observedWithoutBetCount: 119,
        eligibleBetCount: 2,
        betCount: 2,
        hitCount: 0,
        missCount: 2,
        totalStaked: 100,
        finalBalance: 9_900,
        ladder: { missCount: 2, totalLoss: 100 },
      },
    );
    assert.equal(account.latestOutcome.attemptNumber, 21);
    assert.deepEqual(account.latestOutcome.gateEvidence, {
      horizon: 20,
      hitCount: 4,
      eligibleCount: 5,
      rate: 4 / 5,
      historyMaxResultId: attemptNineteen.resultId,
      historyThrough: attemptNineteen.settledAt,
    });
    assert.deepEqual(
      {
        action: account.currentAction.action,
        reason: account.currentAction.reason,
        attemptNumber: account.currentAction.attemptNumber,
        bettingStarted: account.currentAction.bettingStarted,
        startAttempt: account.currentAction.startAttempt,
        startEvidence: account.currentAction.startEvidence,
        cumulativeRate: account.currentAction.cumulativeRate,
        hitCount: account.currentAction.hitCount,
        eligibleCount: account.currentAction.eligibleCount,
        stakePerNumber: account.currentAction.stakePerNumber,
        totalStake: account.currentAction.totalStake,
      },
      {
        action: "would_bet",
        reason: "betting_started",
        attemptNumber: 22,
        bettingStarted: true,
        startAttempt: 20,
        startEvidence: account.latestOutcome.gateEvidence,
        cumulativeRate: null,
        hitCount: null,
        eligibleCount: null,
        stakePerNumber: 10,
        totalStake: 50,
      },
    );

    writer.ingest([GATED_CURRENT_FOLLOWERS.at(-1)]);
    account = trackerState(database).gatedAccount;
    assert.deepEqual(
      {
        trackedAttemptCount: account.trackedAttemptCount,
        observedWithoutBetCount: account.observedWithoutBetCount,
        eligibleBetCount: account.eligibleBetCount,
        betCount: account.betCount,
        hitCount: account.hitCount,
        missCount: account.missCount,
        totalStaked: account.totalStaked,
        totalGrossPayout: account.totalGrossPayout,
        finalBalance: account.finalBalance,
        nextStakePerNumber: account.nextStakePerNumber,
        ladder: account.ladder,
      },
      {
        trackedAttemptCount: 122,
        observedWithoutBetCount: 119,
        eligibleBetCount: 3,
        betCount: 3,
        hitCount: 1,
        missCount: 2,
        totalStaked: 150,
        totalGrossPayout: 360,
        finalBalance: 10_210,
        nextStakePerNumber: 10,
        ladder: { missCount: 0, totalLoss: 0 },
      },
    );
    assert.equal(account.latestOutcome.attemptNumber, 22);
    assert.equal(account.latestOutcome.outcome, "hit");
    assert.equal(account.latestOutcome.hitRank, 1);
    assert.equal(account.latestOutcome.grossPayout, 360);

    writer.ingest([GATED_CURRENT_SOURCE]);
    state = trackerState(database);
    assert.equal(state.currentSession.sourceNumber, GATED_CURRENT_SOURCE);
    assert.equal(state.currentSession.attemptCount, 0);
    assert.deepEqual(
      {
        action: state.gatedAccount.currentAction.action,
        reason: state.gatedAccount.currentAction.reason,
        attemptNumber: state.gatedAccount.currentAction.attemptNumber,
        bettingStarted: state.gatedAccount.currentAction.bettingStarted,
        startAttempt: state.gatedAccount.currentAction.startAttempt,
      },
      {
        action: "observe",
        reason: "below_threshold",
        attemptNumber: 1,
        bettingStarted: false,
        startAttempt: null,
      },
    );
    assert.ok(state.gatedAccount.currentAction.eligibleCount > 0);
    assert.equal(
      state.gatedAccount.currentAction.cumulativeRate,
      state.gatedAccount.currentAction.hitCount
        / state.gatedAccount.currentAction.eligibleCount,
    );
    assert.ok(state.gatedAccount.currentAction.cumulativeRate < 0.8);
    assert.equal(state.gatedAccount.betCount, 3);
    assert.equal(state.gatedAccount.finalBalance, 10_210);
    assertGatedAccountInvariants(state.gatedAccount);
  } finally {
    database.close();
  }
});

test("frozen Top-5 session stays observe-only after attempt twenty when its gate never crossed", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const writer = createTrackerFixtureWriter(database, "gated-no-crossing");
    ingestGatedCalibrationCohort(writer, [null, 1, 1, 1]);
    armGatedCurrentSession(writer);
    writer.ingest(Array.from({ length: 21 }, () => GATED_FILLER));

    const state = trackerState(database);
    const account = state.gatedAccount;
    assert.equal(state.currentSession.attemptCount, 21);
    assert.deepEqual(
      {
        status: account.status,
        trackedSessionCount: account.trackedSessionCount,
        trackedAttemptCount: account.trackedAttemptCount,
        qualifiedSessionCount: account.qualifiedSessionCount,
        observedWithoutBetCount: account.observedWithoutBetCount,
        eligibleBetCount: account.eligibleBetCount,
        betCount: account.betCount,
        totalStaked: account.totalStaked,
        finalBalance: account.finalBalance,
        latestOutcome: account.latestOutcome,
        ladder: account.ladder,
      },
      {
        status: "waiting",
        trackedSessionCount: 5,
        trackedAttemptCount: 44,
        qualifiedSessionCount: 0,
        observedWithoutBetCount: 44,
        eligibleBetCount: 0,
        betCount: 0,
        totalStaked: 0,
        finalBalance: 10_000,
        latestOutcome: null,
        ladder: { missCount: 0, totalLoss: 0 },
      },
    );
    assert.deepEqual(
      {
        action: account.currentAction.action,
        reason: account.currentAction.reason,
        attemptNumber: account.currentAction.attemptNumber,
        bettingStarted: account.currentAction.bettingStarted,
        startAttempt: account.currentAction.startAttempt,
        startEvidence: account.currentAction.startEvidence,
        cumulativeRate: account.currentAction.cumulativeRate,
        hitCount: account.currentAction.hitCount,
        eligibleCount: account.currentAction.eligibleCount,
        stakePerNumber: account.currentAction.stakePerNumber,
        totalStake: account.currentAction.totalStake,
      },
      {
        action: "observe",
        reason: "threshold_not_reached",
        attemptNumber: 22,
        bettingStarted: false,
        startAttempt: null,
        startEvidence: null,
        cumulativeRate: null,
        hitCount: null,
        eligibleCount: null,
        stakePerNumber: null,
        totalStake: null,
      },
    );
    assertGatedAccountInvariants(account);
  } finally {
    database.close();
  }
});

test("frozen Top-5 gated account resets the shared ladder at a gap but keeps its cash", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const writer = createTrackerFixtureWriter(database, "gated-gap");
    ingestGatedCalibrationCohort(writer, [null, 1, 1, 1, 1]);
    armGatedCurrentSession(writer);
    writer.ingest(Array.from({ length: 7 }, () => GATED_FILLER));

    const beforeGap = trackerState(database).gatedAccount;
    assert.deepEqual(
      {
        trackedAttemptCount: beforeGap.trackedAttemptCount,
        observedWithoutBetCount: beforeGap.observedWithoutBetCount,
        eligibleBetCount: beforeGap.eligibleBetCount,
        betCount: beforeGap.betCount,
        missCount: beforeGap.missCount,
        totalStaked: beforeGap.totalStaked,
        finalBalance: beforeGap.finalBalance,
        nextStakePerNumber: beforeGap.nextStakePerNumber,
        nextRoundCost: beforeGap.nextRoundCost,
        ladder: beforeGap.ladder,
      },
      {
        trackedAttemptCount: 31,
        observedWithoutBetCount: 24,
        eligibleBetCount: 7,
        betCount: 7,
        missCount: 7,
        totalStaked: 350,
        finalBalance: 9_650,
        nextStakePerNumber: 20,
        nextRoundCost: 100,
        ladder: { missCount: 7, totalLoss: 350 },
      },
    );

    writer.gap("active-gated-session");
    const afterGap = trackerState(database).gatedAccount;
    assert.equal(afterGap.finalBalance, beforeGap.finalBalance);
    assert.equal(afterGap.totalStaked, beforeGap.totalStaked);
    assert.equal(afterGap.betCount, beforeGap.betCount);
    assert.equal(afterGap.continuityGapCount, beforeGap.continuityGapCount + 1);
    assert.equal(afterGap.dataComplete, false);
    assert.equal(afterGap.nextStakePerNumber, 10);
    assert.equal(afterGap.nextRoundCost, 50);
    assert.deepEqual(afterGap.ladder, { missCount: 0, totalLoss: 0 });
    assert.deepEqual(afterGap.currentAction, {
      action: "wait",
      reason: "gap",
      sessionId: null,
      attemptNumber: null,
      targetNumbers: [],
      selectionCount: 0,
      bettingStarted: false,
      startAttempt: null,
      startEvidence: null,
      cumulativeRate: null,
      hitCount: null,
      eligibleCount: null,
      historyMaxResultId: null,
      historyThrough: null,
      stakePerNumber: null,
      totalStake: null,
      anchorResultId: null,
    });

    writer.ingest([GATED_CURRENT_SOURCE]);
    writer.ingest([0]);
    const account = trackerState(database).gatedAccount;
    assert.deepEqual(
      {
        trackedSessionCount: account.trackedSessionCount,
        trackedAttemptCount: account.trackedAttemptCount,
        qualifiedSessionCount: account.qualifiedSessionCount,
        observedWithoutBetCount: account.observedWithoutBetCount,
        eligibleBetCount: account.eligibleBetCount,
        betCount: account.betCount,
        missCount: account.missCount,
        totalStaked: account.totalStaked,
        finalBalance: account.finalBalance,
        nextStakePerNumber: account.nextStakePerNumber,
        nextRoundCost: account.nextRoundCost,
        ladder: account.ladder,
      },
      {
        trackedSessionCount: 7,
        trackedAttemptCount: 32,
        qualifiedSessionCount: 2,
        observedWithoutBetCount: 24,
        eligibleBetCount: 8,
        betCount: 8,
        missCount: 8,
        totalStaked: 400,
        finalBalance: 9_600,
        nextStakePerNumber: 10,
        nextRoundCost: 50,
        ladder: { missCount: 1, totalLoss: 50 },
      },
    );
    assert.equal(account.latestOutcome.attemptNumber, 1);
    assert.equal(account.latestOutcome.stakePerNumber, 10);
    assert.deepEqual(account.latestOutcome.targetNumbers, [36, 35, 34, 33, 32]);
    assert.equal(account.latestOutcome.resultNumber, 0);
    assertGatedAccountInvariants(account);
  } finally {
    database.close();
  }
});

test("frozen Top-5 gated account permanently stops after the full ticket becomes unaffordable", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const writer = createTrackerFixtureWriter(database, "gated-bankruptcy");
    ingestGatedCalibrationCohort(writer, [null, 1, 1, 1, 1]);
    armGatedCurrentSession(writer);
    const armed = trackerState(database);
    const anchor = armed.currentSession.anchor;
    assert.deepEqual(armed.currentSession.fixedNumbers, [35, 34, 33, 32, 31]);

    writer.ingest([
      ...Array.from({ length: 27 }, () => GATED_FILLER),
      GATED_CURRENT_FOLLOWERS.at(-1),
    ]);
    const state = trackerState(database);
    const account = state.gatedAccount;

    assert.equal(state.currentSession, null);
    assert.equal(state.lastCompletedSession.attemptCount, 28);
    assert.equal(state.lastCompletedSession.hitNumber, 35);
    assert.deepEqual(
      {
        status: account.status,
        initialBalance: account.initialBalance,
        finalBalance: account.finalBalance,
        netResult: account.netResult,
        nextStakePerNumber: account.nextStakePerNumber,
        nextRoundCost: account.nextRoundCost,
        canAffordNextRound: account.canAffordNextRound,
        shortfall: account.shortfall,
        trackedSessionCount: account.trackedSessionCount,
        trackedAttemptCount: account.trackedAttemptCount,
        qualifiedSessionCount: account.qualifiedSessionCount,
        observedWithoutBetCount: account.observedWithoutBetCount,
        eligibleBetCount: account.eligibleBetCount,
        betCount: account.betCount,
        hitCount: account.hitCount,
        missCount: account.missCount,
        totalStaked: account.totalStaked,
        totalGrossPayout: account.totalGrossPayout,
        skippedAfterExhaustionCount: account.skippedAfterExhaustionCount,
        peakBalance: account.peakBalance,
        minimumBalance: account.minimumBalance,
        maximumDrawdown: account.maximumDrawdown,
        maxStakePerNumber: account.maxStakePerNumber,
        maxRoundCost: account.maxRoundCost,
        ladder: account.ladder,
      },
      {
        status: "exhausted",
        initialBalance: 10_000,
        finalBalance: 1_000,
        netResult: -9_000,
        nextStakePerNumber: 300,
        nextRoundCost: 1_500,
        canAffordNextRound: false,
        shortfall: 500,
        trackedSessionCount: 6,
        trackedAttemptCount: 52,
        qualifiedSessionCount: 1,
        observedWithoutBetCount: 24,
        eligibleBetCount: 28,
        betCount: 26,
        hitCount: 0,
        missCount: 26,
        totalStaked: 9_000,
        totalGrossPayout: 0,
        skippedAfterExhaustionCount: 2,
        peakBalance: 10_000,
        minimumBalance: 1_000,
        maximumDrawdown: 9_000,
        maxStakePerNumber: 250,
        maxRoundCost: 1_250,
        ladder: { missCount: 26, totalLoss: 9_000 },
      },
    );
    assert.equal(account.exhaustedAt, account.latestOutcome.occurredAt);
    assert.equal(account.latestOutcome.attemptNumber, 26);
    assert.equal(account.latestOutcome.resultNumber, GATED_FILLER);
    assert.equal(account.latestOutcome.outcome, "miss");
    assert.equal(account.latestOutcome.stakePerNumber, 250);
    assert.equal(account.latestOutcome.totalStake, 1_250);
    assert.equal(account.latestOutcome.balanceAfter, 1_000);
    assert.deepEqual(account.latestOutcome.gateEvidence, {
      horizon: 1,
      hitCount: 4,
      eligibleCount: 5,
      rate: 4 / 5,
      historyMaxResultId: anchor.resultId,
      historyThrough: anchor.settledAt,
    });
    assert.ok(account.latestOutcome.resultId < state.lastAttempt.resultId);
    assert.equal(
      state.lastAttempt.resultNumber,
      GATED_CURRENT_FOLLOWERS.at(-1),
      "the later frozen-set hit closes tracking but cannot revive the bank",
    );
    assertGatedAccountInvariants(account);
  } finally {
    database.close();
  }
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
    assert.equal(database.sqlite.prepare("PRAGMA user_version").get().user_version, 15);
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
