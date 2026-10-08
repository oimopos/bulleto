import assert from "node:assert/strict";
import test from "node:test";

import { followerTop5GatedSnapshotForApi } from "../src/follower-top5-gated-api.js";

const NOW = new Date("2026-10-08T12:00:00.000Z");
const TARGETS = Object.freeze([35, 34, 33, 32, 31]);
const LATEST_RESULT = Object.freeze({
  id: 912,
  externalRoundId: "4102200",
  resultNumber: 8,
  settledAt: "2026-10-08T11:59:10.000Z",
});
const NO_PIPELINE_PENDING = Object.freeze({ results: 0, gaps: 0 });

function evidence(overrides = {}) {
  return {
    horizon: 12,
    hitCount: 4,
    eligibleCount: 5,
    rate: 4 / 5,
    historyMaxResultId: 910,
    historyThrough: "2026-10-08T11:58:00.000Z",
    ...overrides,
  };
}

function currentAction(overrides = {}) {
  return {
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
    ...overrides,
  };
}

function gatedAccount(overrides = {}) {
  const base = {
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
    netResult: 0,
    nextStakePerNumber: 10,
    nextRoundCost: 50,
    canAffordNextRound: true,
    shortfall: 0,
    ladder: { missCount: 0, totalLoss: 0 },
    dataComplete: true,
    latestOutcome: null,
    currentAction: currentAction(),
  };
  return {
    ...base,
    ...overrides,
    strategy: { ...base.strategy, ...overrides.strategy },
    model: { ...base.model, ...overrides.model },
    ladder: { ...base.ladder, ...overrides.ladder },
    currentAction: currentAction(overrides.currentAction),
  };
}

function tracker(accountOverrides = {}) {
  return { gatedAccount: gatedAccount(accountOverrides) };
}

function collector(overrides = {}) {
  return {
    connected: true,
    error: null,
    lastResultAt: LATEST_RESULT.settledAt,
    resultConfirmationPending: false,
    pendingResultCount: 0,
    ...overrides,
    currentRound: overrides.currentRound === null
      ? null
      : {
          id: 4_102_201,
          status: 2,
          startsAt: "2026-10-08T11:59:30.000Z",
          bettingClosesAt: "2026-10-08T12:00:20.000Z",
          ...overrides.currentRound,
        },
  };
}

function readyAccount(overrides = {}) {
  const startEvidence = evidence({ horizon: 10 });
  return tracker({
    status: "running",
    finalBalance: 9_900,
    netResult: -100,
    nextStakePerNumber: 20,
    nextRoundCost: 100,
    ladder: { missCount: 2, totalLoss: 100 },
    currentAction: {
      action: "would_bet",
      reason: "betting_started",
      sessionId: 17,
      attemptNumber: 12,
      targetNumbers: [...TARGETS],
      selectionCount: 5,
      bettingStarted: true,
      startAttempt: 10,
      startEvidence,
      cumulativeRate: 17 / 20,
      hitCount: 17,
      eligibleCount: 20,
      historyMaxResultId: 912,
      historyThrough: "2026-10-08T11:59:10.000Z",
      stakePerNumber: 20,
      totalStake: 100,
      anchorResultId: 900,
    },
    ...overrides,
  });
}

test("Top-5 gated snapshot fails closed while waiting or observing below threshold", () => {
  const waiting = followerTop5GatedSnapshotForApi({
    trackerState: tracker(),
    collectorState: collector(),
    now: NOW,
  });

  assert.equal(waiting.executionEnabled, false);
  assert.equal(waiting.advisoryOnly, true);
  assert.equal(waiting.source, "buleto");
  assert.equal(waiting.instrument, "default");
  assert.deepEqual(waiting.currentAttempt, null);
  assert.deepEqual(waiting.gate, {
    thresholdMetric: "cumulative-hit-by-attempt",
    threshold: 0.8,
    comparison: "gte",
    maximumCalibratedAttempt: 20,
    bettingStarted: false,
    startAttempt: null,
    startEvidence: null,
    currentEvidence: null,
  });
  assert.deepEqual(waiting.signal, {
    action: "WAIT",
    actionable: false,
    reason: "waiting_training",
    actionId: null,
    sessionId: null,
    attemptNumber: null,
    roundId: 4_102_201,
    targetNumbers: [],
    stakePerNumber: null,
    totalStake: null,
    thresholdEvidence: null,
    validUntil: "2026-10-08T12:00:20.000Z",
  });
  assert.equal(waiting.betting.strategyReady, false);
  assert.equal(waiting.betting.canBetNow, false);

  const belowEvidence = evidence({
    horizon: 2,
    hitCount: 3,
    eligibleCount: 5,
    rate: 3 / 5,
  });
  const observing = followerTop5GatedSnapshotForApi({
    trackerState: tracker({
      currentAction: {
        action: "observe",
        reason: "below_threshold",
        sessionId: 18,
        attemptNumber: 2,
        targetNumbers: [...TARGETS],
        selectionCount: 5,
        cumulativeRate: belowEvidence.rate,
        hitCount: belowEvidence.hitCount,
        eligibleCount: belowEvidence.eligibleCount,
        historyMaxResultId: belowEvidence.historyMaxResultId,
        historyThrough: belowEvidence.historyThrough,
        anchorResultId: 901,
      },
    }),
    collectorState: collector(),
    now: NOW,
  });

  assert.deepEqual(observing.currentAttempt, {
    sessionId: 18,
    attemptNumber: 2,
    anchorResultId: 901,
    targetNumbers: [...TARGETS],
    selectionCount: 5,
  });
  assert.deepEqual(observing.gate.currentEvidence, belowEvidence);
  assert.equal(observing.signal.action, "WAIT");
  assert.equal(observing.signal.actionable, false);
  assert.equal(observing.signal.reason, "below_threshold");
  assert.equal(observing.signal.actionId, null);
  assert.deepEqual(observing.signal.targetNumbers, TARGETS);
  assert.equal(observing.signal.stakePerNumber, null);
  assert.equal(observing.signal.totalStake, null);
  assert.deepEqual(observing.signal.thresholdEvidence, belowEvidence);
});

test("Top-5 gated snapshot emits one stable five-number BET for an open round", () => {
  const input = {
    trackerState: readyAccount(),
    collectorState: collector(),
    latestResult: LATEST_RESULT,
    pipelinePending: NO_PIPELINE_PENDING,
    now: NOW,
  };
  const snapshot = followerTop5GatedSnapshotForApi(input);
  const repeated = followerTop5GatedSnapshotForApi({
    ...input,
    now: new Date("2026-10-08T12:00:01.000Z"),
  });

  assert.equal(snapshot.executionEnabled, false);
  assert.equal(snapshot.advisoryOnly, true);
  assert.deepEqual(snapshot.latestResult, {
    id: 912,
    roundId: "4102200",
    number: 8,
    settledAt: LATEST_RESULT.settledAt,
  });
  assert.deepEqual(snapshot.freshness, {
    trackerSynced: true,
    trackerResultId: 912,
    latestPersistedResultId: 912,
    latestPersistedRoundId: 4_102_200,
    latestPersistedAt: LATEST_RESULT.settledAt,
    currentRoundId: 4_102_201,
    expectedRoundId: 4_102_201,
    collectorLastResultAt: LATEST_RESULT.settledAt,
    roundCursorMatches: true,
    resultConfirmationPending: false,
    pendingResultCount: 0,
    persistencePendingResults: 0,
    persistencePendingGaps: 0,
  });
  assert.equal(snapshot.betting.trackerSynced, true);
  assert.equal(snapshot.betting.canBetNow, true);
  assert.deepEqual(snapshot.account, {
    status: "running",
    initialBalance: 10_000,
    currentBalance: 9_900,
    profit: -100,
    nextStakePerNumber: 20,
    nextRoundCost: 100,
    canAffordNextRound: true,
    shortfall: 0,
    ladder: { missCount: 2, totalLoss: 100 },
    dataComplete: true,
  });
  assert.deepEqual(snapshot.gate, {
    thresholdMetric: "cumulative-hit-by-attempt",
    threshold: 0.8,
    comparison: "gte",
    maximumCalibratedAttempt: 20,
    bettingStarted: true,
    startAttempt: 10,
    startEvidence: evidence({ horizon: 10 }),
    currentEvidence: evidence({
      hitCount: 17,
      eligibleCount: 20,
      rate: 17 / 20,
      historyMaxResultId: 912,
      historyThrough: "2026-10-08T11:59:10.000Z",
    }),
  });
  assert.deepEqual(snapshot.signal, {
    action: "BET",
    actionable: true,
    reason: "ready",
    actionId: "follower-top5-gated:17:12:4102201",
    sessionId: 17,
    attemptNumber: 12,
    roundId: 4_102_201,
    targetNumbers: [...TARGETS],
    stakePerNumber: 20,
    totalStake: 100,
    thresholdEvidence: evidence({ horizon: 10 }),
    validUntil: "2026-10-08T12:00:20.000Z",
  });
  assert.equal(new Set(snapshot.signal.targetNumbers).size, 5);
  assert.equal(
    snapshot.signal.totalStake,
    snapshot.signal.targetNumbers.length * snapshot.signal.stakePerNumber,
  );
  assert.equal(repeated.signal.actionId, snapshot.signal.actionId);

  const nextRound = followerTop5GatedSnapshotForApi({
    ...input,
    collectorState: collector({ currentRound: { id: 4_102_202 } }),
  });
  assert.equal(nextRound.signal.action, "WAIT");
  assert.equal(nextRound.signal.reason, "tracker_not_synced");
  assert.equal(nextRound.signal.actionId, null);
  assert.equal(nextRound.freshness.roundCursorMatches, false);
  assert.equal(nextRound.freshness.expectedRoundId, 4_102_201);
  assert.equal(nextRound.freshness.currentRoundId, 4_102_202);

  const advancedLatestResult = {
    id: 913,
    externalRoundId: "4102201",
    resultNumber: 9,
    settledAt: "2026-10-08T12:00:30.000Z",
  };
  const advanced = followerTop5GatedSnapshotForApi({
    trackerState: readyAccount({
      currentAction: {
        ...readyAccount().gatedAccount.currentAction,
        attemptNumber: 13,
        historyMaxResultId: 913,
        historyThrough: advancedLatestResult.settledAt,
      },
    }),
    collectorState: collector({
      lastResultAt: advancedLatestResult.settledAt,
      currentRound: {
        id: 4_102_202,
        startsAt: "2026-10-08T12:00:31.000Z",
        bettingClosesAt: "2026-10-08T12:01:20.000Z",
      },
    }),
    latestResult: advancedLatestResult,
    pipelinePending: NO_PIPELINE_PENDING,
    now: new Date("2026-10-08T12:00:40.000Z"),
  });
  assert.equal(
    advanced.signal.actionId,
    "follower-top5-gated:17:13:4102202",
  );
  assert.equal(advanced.signal.action, "BET");
  assert.equal(advanced.freshness.trackerSynced, true);
});

test("Top-5 gated snapshot suppresses BET for unavailable, closed, and exhausted states", () => {
  const unavailable = followerTop5GatedSnapshotForApi({
    trackerState: readyAccount(),
    collectorState: collector({ connected: false }),
    latestResult: LATEST_RESULT,
    pipelinePending: NO_PIPELINE_PENDING,
    now: NOW,
  });
  assert.equal(unavailable.signal.action, "WAIT");
  assert.equal(unavailable.signal.actionable, false);
  assert.equal(unavailable.signal.reason, "collector_unavailable");
  assert.equal(unavailable.signal.actionId, null);

  const closed = followerTop5GatedSnapshotForApi({
    trackerState: readyAccount(),
    collectorState: collector(),
    latestResult: LATEST_RESULT,
    pipelinePending: NO_PIPELINE_PENDING,
    now: new Date("2026-10-08T12:00:20.000Z"),
  });
  assert.equal(closed.signal.action, "WAIT");
  assert.equal(closed.signal.reason, "betting_closed");
  assert.equal(closed.signal.actionId, null);
  assert.equal(closed.betting.isOpen, false);
  assert.equal(closed.betting.canBetNow, false);

  const exhausted = followerTop5GatedSnapshotForApi({
    trackerState: readyAccount({
      status: "exhausted",
      finalBalance: 1_000,
      netResult: -9_000,
      nextStakePerNumber: 300,
      nextRoundCost: 1_500,
      canAffordNextRound: false,
      shortfall: 500,
    }),
    collectorState: collector(),
    latestResult: LATEST_RESULT,
    pipelinePending: NO_PIPELINE_PENDING,
    now: NOW,
  });
  assert.equal(exhausted.signal.action, "WAIT");
  assert.equal(exhausted.signal.actionable, false);
  assert.equal(exhausted.signal.reason, "bankroll_exhausted");
  assert.equal(exhausted.signal.actionId, null);
  assert.equal(exhausted.betting.strategyReady, false);
  assert.equal(exhausted.betting.canBetNow, false);
  assert.deepEqual(exhausted.signal.targetNumbers, TARGETS);
  assert.equal(exhausted.signal.stakePerNumber, 20);
  assert.equal(exhausted.signal.totalStake, 100);

  const gap = followerTop5GatedSnapshotForApi({
    trackerState: tracker({
      dataComplete: false,
      currentAction: { reason: "gap" },
    }),
    collectorState: collector(),
    now: NOW,
  });
  assert.equal(gap.signal.action, "WAIT");
  assert.equal(gap.signal.reason, "gap");
  assert.equal(gap.signal.actionId, null);
  assert.deepEqual(gap.signal.targetNumbers, []);
  assert.equal(gap.signal.stakePerNumber, null);
  assert.equal(gap.signal.totalStake, null);
});

test("Top-5 gated snapshot requires one fully persisted and confirmed round cursor", () => {
  const base = {
    trackerState: readyAccount(),
    collectorState: collector(),
    latestResult: LATEST_RESULT,
    pipelinePending: NO_PIPELINE_PENDING,
    now: NOW,
  };
  const staleInputs = [
    { ...base, latestResult: null },
    { ...base, latestResult: { ...LATEST_RESULT, id: "missing-id" } },
    { ...base, latestResult: { ...LATEST_RESULT, externalRoundId: null } },
    { ...base, latestResult: { ...LATEST_RESULT, externalRoundId: "round-x" } },
    {
      ...base,
      collectorState: collector({ currentRound: { id: null } }),
    },
    {
      ...base,
      collectorState: collector({ currentRound: { id: "round-x" } }),
    },
    {
      ...base,
      collectorState: collector({
        lastResultAt: "2026-10-08T11:59:11.000Z",
      }),
    },
    {
      ...base,
      trackerState: readyAccount({
        currentAction: {
          ...readyAccount().gatedAccount.currentAction,
          historyMaxResultId: 911,
        },
      }),
    },
  ];

  for (const input of staleInputs) {
    const snapshot = followerTop5GatedSnapshotForApi(input);
    assert.equal(snapshot.freshness.trackerSynced, false);
    assert.equal(snapshot.signal.action, "WAIT");
    assert.equal(snapshot.signal.actionable, false);
    assert.equal(snapshot.signal.reason, "tracker_not_synced");
    assert.equal(snapshot.signal.actionId, null);
    assert.equal(snapshot.betting?.trackerSynced, false);
    assert.equal(snapshot.betting?.canBetNow, false);
  }

  const pendingInputs = [
    {
      ...base,
      collectorState: collector({ resultConfirmationPending: true }),
    },
    {
      ...base,
      collectorState: collector({ pendingResultCount: 2 }),
    },
    { ...base, pipelinePending: { results: 1, gaps: 0 } },
    { ...base, pipelinePending: { results: 0, gaps: 1 } },
  ];
  for (const input of pendingInputs) {
    const snapshot = followerTop5GatedSnapshotForApi(input);
    assert.equal(snapshot.freshness.trackerSynced, false);
    assert.equal(snapshot.signal.action, "WAIT");
    assert.equal(snapshot.signal.reason, "tracker_not_synced");
    assert.equal(snapshot.signal.actionId, null);
    assert.equal(snapshot.betting.canBetNow, false);
  }

  const confirmationPending = followerTop5GatedSnapshotForApi(pendingInputs[0]);
  assert.equal(confirmationPending.freshness.resultConfirmationPending, true);
  const collectorPending = followerTop5GatedSnapshotForApi(pendingInputs[1]);
  assert.equal(collectorPending.freshness.pendingResultCount, 2);
  assert.equal(collectorPending.freshness.resultConfirmationPending, true);
  const resultsPending = followerTop5GatedSnapshotForApi(pendingInputs[2]);
  assert.equal(resultsPending.freshness.persistencePendingResults, 1);
  const gapsPending = followerTop5GatedSnapshotForApi(pendingInputs[3]);
  assert.equal(gapsPending.freshness.persistencePendingGaps, 1);
});

test("Top-5 gated snapshot fails closed for a malformed five-number ticket", () => {
  const readyAction = readyAccount().gatedAccount.currentAction;
  for (const accountOverrides of [
    { currentAction: {
      ...readyAction,
      targetNumbers: [35, 35, 33, 32, 31],
    } },
    { currentAction: { ...readyAction, selectionCount: 4 } },
    { currentAction: { ...readyAction, totalStake: 90 } },
    { currentAction: {
      ...readyAction,
      stakePerNumber: 20.5,
      totalStake: 102.5,
    } },
    { nextStakePerNumber: 10 },
    { nextRoundCost: 90 },
    { strategy: { selectionCount: 4 } },
    { model: { numbersPerRound: 4 } },
  ]) {
    const snapshot = followerTop5GatedSnapshotForApi({
      trackerState: readyAccount(accountOverrides),
      collectorState: collector(),
      latestResult: LATEST_RESULT,
      pipelinePending: NO_PIPELINE_PENDING,
      now: NOW,
    });
    assert.equal(snapshot.signal.action, "WAIT");
    assert.equal(snapshot.signal.actionable, false);
    assert.equal(snapshot.signal.reason, "strategy_not_ready");
    assert.equal(snapshot.signal.actionId, null);
    assert.equal(snapshot.betting.strategyReady, false);
    assert.equal(snapshot.betting.canBetNow, false);
  }
});
