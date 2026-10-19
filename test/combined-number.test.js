import assert from "node:assert/strict";
import test from "node:test";

import {
  assessCombinedNumberFreshness,
  COMBINED_NUMBER_ALGORITHM_VERSION,
  combinedCycleAnalogueRanking,
  combinedCycleNumberSignals,
  combinedOverdueRanking,
  combinedTripleFollowerRanking,
  combinedTrajectoryRanking,
  combinedTrajectorySignals,
  combinedVirtualRecencySources,
  combineNumberRankings,
  normalizePredictiveLeaderApiSnapshot,
  normalizePredictiveLeaderV7PaperApiSnapshot,
  normalizePredictiveShadowGateProgress,
  PREDICTIVE_LEADER_API_ALGORITHM_VERSION,
  PREDICTIVE_LEADER_API_SCHEMA_VERSION,
  predictiveLeaderNumberContext,
  predictiveLeaderV7PaperContext,
  TRAJECTORY_RANK37_BASIS,
  TRAJECTORY_RANK37_EVIDENCE_MASS_THRESHOLD,
  TRAJECTORY_RANK37_VERSION,
} from "../public/combined-number.js";

function trajectoryRank37(firstNumber = 32) {
  const order = [
    firstNumber,
    ...Array.from({ length: 37 }, (_, number) => number)
      .filter((number) => number !== firstNumber),
  ];
  const rawMassTotal = 37 * 38 / 2;
  return {
    version: TRAJECTORY_RANK37_VERSION,
    basis: TRAJECTORY_RANK37_BASIS,
    candidateCount: 37,
    evidenceCandidateCount: 37,
    evidenceMassThreshold: TRAJECTORY_RANK37_EVIDENCE_MASS_THRESHOLD,
    tieSeed: "forecast-4103913",
    smoothing: {
      version: "uniform-mixture-v1",
      weight: 0.05,
      baselineMass: 1 / 37,
    },
    ranking: order.map((number, index) => {
      const rawMass = (37 - index) / rawMassTotal;
      return {
        rank: index + 1,
        number,
        rawMass,
        mass: 0.95 * rawMass + 0.05 / 37,
      };
    }),
  };
}

const FRESH_STATE = Object.freeze({
  collector: Object.freeze({
    currentRound: Object.freeze({ id: "4103913" }),
    status: "connected",
    connected: true,
    error: null,
    lastResultAt: "2026-10-09T15:01:48.000Z",
    resultConfirmationPending: false,
    pendingResultCount: 0,
  }),
  latestResult: Object.freeze({
    id: 1_113,
    roundId: "4103912",
    settledAt: "2026-10-09T15:01:48Z",
  }),
  pipelinePending: Object.freeze({ results: 0, gaps: 0 }),
});

function predictiveLeaderApiSnapshot() {
  const gateHitCount = 50;
  const gateSampleSize = 1_000;
  const gateRate = gateHitCount / gateSampleSize;
  const z = 1.959963984540054;
  const zSquared = z ** 2;
  const denominator = 1 + zSquared / gateSampleSize;
  const center = (gateRate + zSquared / (2 * gateSampleSize)) / denominator;
  const radius = z * Math.sqrt(
    (gateRate * (1 - gateRate) + zSquared / (4 * gateSampleSize))
      / gateSampleSize,
  ) / denominator;
  const gateVersion = "rolling-1000-wilson95-brier-v1";
  const placedAt = "2026-10-10T10:00:20.000Z";
  return {
    schemaVersion: PREDICTIVE_LEADER_API_SCHEMA_VERSION,
    algorithmVersion: PREDICTIVE_LEADER_API_ALGORITHM_VERSION,
    mode: "observation",
    strategyMode: "quality-gated-simulation",
    executionEnabled: false,
    advisoryOnly: true,
    source: "buleto",
    instrument: "default",
    serverTime: "2026-10-10T10:00:22.000Z",
    status: "ready",
    reason: "ready",
    action: "BET",
    number: 7,
    candidateNumber: 7,
    forecast: {
      id: 1_001,
      roundId: "101",
      lockedAt: "2026-10-10T10:00:20.000Z",
      bettingClosesAt: "2026-10-10T10:00:25.000Z",
      roundEndsAt: "2026-10-10T10:01:00.000Z",
    },
    model: {
      sourceCount: 2,
      familyCount: 2,
      activeFamilies: ["price", "conditional-history"],
      activeFamilyWeights: {
        price: 0.5,
        "conditional-history": 0.5,
      },
      learningVersion: "family-brier-logodds-v1",
      learningStatus: "cold_start",
      trainingCount: 0,
      learnedFamilyWeights: {
        price: 0.5,
        "conditional-history": 0.5,
      },
      tieBreakApplied: false,
    },
    qualityGate: {
      version: gateVersion,
      status: "confirmed",
      reason: "quality_confirmed",
      eligible: true,
      windowSize: gateSampleSize,
      sampleSize: gateSampleSize,
      hitCount: gateHitCount,
      hitRate: gateRate,
      baselineRate: 1 / 36,
      confidenceLevel: 0.95,
      lowerBound: Math.max(0, center - radius),
      upperBound: Math.min(1, center + radius),
      meanBrierLoss: 0.45,
      uniformBrierLoss: 18 / 37,
      brierDelta: 18 / 37 - 0.45,
      windowStartForecastId: 1,
      windowEndForecastId: 1_000,
      evaluatedForForecastId: 1_001,
      cutoffAt: placedAt,
      currentFamilyCount: 2,
      throughResultId: 1_000,
      evidenceDigest: "0".repeat(64),
    },
    account: {
      schemaVersion: 1,
      strategyVersion: "quality-gated-fixed10-v1",
      leaderAlgorithmVersion: PREDICTIVE_LEADER_API_ALGORITHM_VERSION,
      gateVersion,
      mode: "quality-gated-fixed-stake-simulation",
      executionEnabled: false,
      advisoryOnly: true,
      status: "pending",
      reason: "bet_frozen",
      initialBalance: 1_000,
      currentBalance: 990,
      availableBalance: 990,
      reservedStake: 10,
      profit: -10,
      model: {
        fixedStake: 10,
        grossPayoutMultiplier: 36,
        payoutIncludesStake: true,
      },
      nextStake: 10,
      canAffordNext: true,
      shortfall: 0,
      betCount: 1,
      settledCount: 0,
      pendingCount: 1,
      voidCount: 0,
      hitCount: 0,
      missCount: 0,
      hitRate: null,
      totalStaked: 10,
      totalGrossPayout: 0,
      peakBalance: 1_000,
      minimumBalance: 990,
      maximumDrawdown: 10,
      continuityGapCount: 0,
      pendingBet: {
        forecastId: 1_001,
        targetNumber: 7,
        stake: 10,
        balanceBefore: 1_000,
        gateVersion,
        placedAt,
      },
      latestVoid: null,
      latestOutcome: null,
      startedAt: placedAt,
      updatedAt: placedAt,
      exhaustedAt: null,
    },
    legacyAccount: null,
    metrics: {
      readyCount: 1,
      settledCount: 0,
      pendingCount: 1,
      top1Hits: 0,
      top1Rate: null,
      meanBrierLoss: null,
      uniformBrierLoss: 18 / 37,
      beatsUniform: null,
    },
    freshness: {
      currentRoundId: 101,
      latestPersistedResultId: 10,
      latestPersistedRoundId: 100,
      latestPersistedAt: "2026-10-10T10:00:00.000Z",
      collectorLastResultAt: "2026-10-10T10:00:00.000Z",
      resultCursorMatches: true,
      roundCursorMatches: true,
      forecastRoundMatches: true,
      resultConfirmationPending: false,
      pendingResultCount: 0,
      persistencePendingResults: 0,
      persistencePendingGaps: 0,
      integrityOk: true,
    },
  };
}

function predictiveLeaderV7PaperApiSnapshot() {
  const model = {
    kind: "loss-recovery-ladder",
    initialBalance: 10_000,
    initialStake: 10,
    stakeStep: 10,
    maxStake: 2_500,
    cycleSpendLimit: 1_000,
    resetPolicy: "clamp-final-stake-reset-at-cycle-cap-v1",
    grossPayoutMultiplier: 36,
    payoutIncludesStake: true,
  };
  return {
    schemaVersion: 2,
    strategyVersion: "predictive-leader-v7-manual-override-paper-ladder-v2",
    algorithmVersion: "learned-predictive-exact-calibrated-v7-shadow",
    mode: "simulation",
    strategyMode: "manual-override-paper",
    executionEnabled: false,
    advisoryOnly: true,
    promotionEligible: false,
    promotionPolicy: "manual-override-paper-not-promoted",
    manualOverride: {
      authorized: true,
      reason: "operator-requested-virtual-api-2026-10-19",
      qualityGateRequired: false,
      automaticPromotionEnabled: false,
    },
    source: "buleto",
    instrument: "default",
    serverTime: "2026-10-19T02:00:22.000Z",
    campaign: {
      schemaVersion: 2,
      strategyVersion: "predictive-leader-v7-manual-override-paper-ladder-v2",
      campaignKey: "v7-manual-override-paper-ladder-20261019",
      candidateId: "v7-candidate",
      model,
      promotionEligible: false,
      promotionPolicy: "manual-override-paper-not-promoted",
    },
    status: "ready",
    reason: "ready",
    action: "BET",
    actionId: "v7-paper-bet:41",
    number: 7,
    stake: 20,
    candidateNumber: 7,
    account: {
      status: "pending",
      reason: "bet_frozen",
      initialBalance: 10_000,
      currentBalance: 9_620,
      deficit: 0,
      accountingBalance: 9_620,
      availableBalance: 9_620,
      reservedStake: 20,
      profit: -380,
      nextStake: 20,
      canAffordNext: false,
      shortfall: 0,
      ledgerRevision: 37,
    },
    stats: {
      betCount: 37,
      settledCount: 36,
      pendingCount: 1,
      voidCount: 0,
      hitCount: 0,
      missCount: 36,
      hitRate: 0,
      totalStaked: 380,
      totalGrossPayout: 0,
      peakBalance: 10_000,
      minimumBalance: 9_620,
      maximumDrawdown: 380,
      continuityGapCount: 0,
    },
    ladder: {
      cycleNumber: 1,
      cycleStaked: 360,
      ladderLoss: 360,
      missCount: 36,
      resetCount: 0,
      nextStake: 20,
      pendingReset: null,
    },
    pendingBet: {
      id: 41,
      forecastId: 1_001,
      roundId: "101",
      targetNumber: 7,
      stake: 20,
      rawStake: 20,
      balanceBefore: 9_640,
      cycleNumber: 1,
      cycleStakedBefore: 360,
      ladderLossBefore: 360,
      missCountBefore: 36,
      lockedAt: "2026-10-19T02:00:20.000Z",
      bettingClosesAt: "2026-10-19T02:00:28.000Z",
      placedAt: "2026-10-19T02:00:21.000Z",
    },
  };
}

function predictiveShadowAudit({
  sampleSize = 5,
  targetSampleSize = 1_000,
  hitCount = 1,
  status = "collecting",
  statisticalSignalsPass = false,
  fixedWindowComplete = sampleSize === targetSampleSize,
} = {}) {
  const settlementComplete = sampleSize === targetSampleSize;
  return {
    schemaVersion: 1,
    mode: "prospective-shadow",
    executionEnabled: false,
    advisoryOnly: true,
    qualityGateDiagnostic: {
      status,
      targetSampleSize,
      sampleSize,
      fixedWindowComplete,
      settlementComplete,
      economicBreakEvenTop1Rate: 1 / 36,
      fixed: {
        settledCount: sampleSize,
        top1Hits: hitCount,
      },
      statisticalSignalsPass,
      promotionEligible: false,
      promotionPolicy: "manual-review-only-no-automatic-bet-or-promotion",
    },
  };
}

test("predictive shadow gate progress exposes the exact remaining fixed cohort", () => {
  assert.deepEqual(
    normalizePredictiveShadowGateProgress(predictiveShadowAudit()),
    {
      status: "collecting",
      targetSampleSize: 1_000,
      sampleSize: 5,
      remainingSampleSize: 995,
      hitCount: 1,
      minimumHitCountAtTarget: 38,
      additionalHitsNeededAtTarget: 37,
      fixedWindowComplete: false,
      settlementComplete: false,
      statisticalSignalsPass: false,
      promotionEligible: false,
    },
  );
  assert.deepEqual(
    normalizePredictiveShadowGateProgress(predictiveShadowAudit({
      sampleSize: 1_000,
      hitCount: 50,
      status: "signals_pass",
      statisticalSignalsPass: true,
    })),
    {
      status: "signals_pass",
      targetSampleSize: 1_000,
      sampleSize: 1_000,
      remainingSampleSize: 0,
      hitCount: 50,
      minimumHitCountAtTarget: 38,
      additionalHitsNeededAtTarget: 0,
      fixedWindowComplete: true,
      settlementComplete: true,
      statisticalSignalsPass: true,
      promotionEligible: false,
    },
  );
  assert.equal(
    normalizePredictiveShadowGateProgress(predictiveShadowAudit({
      sampleSize: 999,
      hitCount: 37,
      status: "signals_failed",
      fixedWindowComplete: true,
    }))?.status,
    "signals_failed",
  );
});

test("predictive shadow gate progress rejects unsafe or inconsistent payloads", () => {
  for (const mutate of [
    (value) => { value.executionEnabled = true; },
    (value) => { value.qualityGateDiagnostic.promotionEligible = true; },
    (value) => { value.qualityGateDiagnostic.sampleSize = 1_001; },
    (value) => { value.qualityGateDiagnostic.settlementComplete = true; },
    (value) => { value.qualityGateDiagnostic.fixed.top1Hits = 6; },
    (value) => {
      value.qualityGateDiagnostic.status = "signals_pass";
      value.qualityGateDiagnostic.statisticalSignalsPass = false;
    },
  ]) {
    const malformed = predictiveShadowAudit();
    mutate(malformed);
    assert.equal(normalizePredictiveShadowGateProgress(malformed), null);
  }
});

test("combined freshness accepts one fully synchronized state snapshot", () => {
  assert.deepEqual(assessCombinedNumberFreshness(FRESH_STATE), {
    status: "ready",
    reason: "fresh",
    currentRoundId: 4_103_913,
    latestRoundId: 4_103_912,
    latestResultId: 1_113,
  });
});

test("predictive leader API snapshot exposes only a strict ready number", () => {
  const payload = predictiveLeaderApiSnapshot();
  const normalized = normalizePredictiveLeaderApiSnapshot(payload);

  assert.deepEqual(normalized, payload);
  assert.deepEqual(predictiveLeaderNumberContext({
    loaded: true,
    snapshot: normalized,
  }), {
    state: "ready",
    snapshot: normalized,
  });
});

test("predictive leader API rejects malformed ready payloads", () => {
  for (const mutate of [
    (value) => { value.number = 37; },
    (value) => { value.mode = "quality-gated-simulation"; },
    (value) => { value.strategyMode = "observation"; },
    (value) => { value.action = "WAIT"; },
    (value) => { value.candidateNumber = 8; },
    (value) => { value.model.learnedFamilyWeights.price = 0.6; },
    (value) => { value.qualityGate.sampleSize = 999; },
    (value) => { value.qualityGate.windowEndForecastId = value.forecast.id; },
    (value) => { value.account.model.fixedStake = 20; },
    (value) => { value.freshness.persistencePendingResults = 1; },
    (value) => { value.forecast.roundId = "102"; },
  ]) {
    const malformed = predictiveLeaderApiSnapshot();
    mutate(malformed);
    assert.equal(normalizePredictiveLeaderApiSnapshot(malformed), null);
  }
});

test("predictive leader API waiting and paused responses hide the number", () => {
  const waiting = predictiveLeaderApiSnapshot();
  waiting.status = "waiting";
  waiting.reason = "forecast_settled";
  waiting.action = "WAIT";
  waiting.number = null;
  waiting.candidateNumber = null;
  waiting.model = null;
  waiting.qualityGate = null;
  const normalizedWaiting = normalizePredictiveLeaderApiSnapshot(waiting);
  assert.equal(normalizedWaiting?.status, "waiting");
  assert.deepEqual(predictiveLeaderNumberContext({
    loaded: true,
    snapshot: normalizedWaiting,
  }), {
    state: "waiting",
    reason: "forecast_settled",
    snapshot: normalizedWaiting,
  });

  const paused = predictiveLeaderApiSnapshot();
  paused.status = "paused";
  paused.reason = "collector_unavailable";
  paused.action = "WAIT";
  paused.number = null;
  paused.candidateNumber = null;
  paused.forecast = null;
  paused.model = null;
  paused.qualityGate = null;
  const normalizedPaused = normalizePredictiveLeaderApiSnapshot(paused);
  assert.equal(normalizedPaused?.status, "paused");
  assert.deepEqual(predictiveLeaderNumberContext({
    loaded: true,
    snapshot: normalizedPaused,
  }), {
    state: "paused",
    reason: "collector_unavailable",
    snapshot: normalizedPaused,
  });
});

test("predictive leader keeps the final affordable fixed stake actionable while reserved", () => {
  const payload = predictiveLeaderApiSnapshot();
  Object.assign(payload.account, {
    currentBalance: 0,
    availableBalance: 0,
    reservedStake: 10,
    profit: -1_000,
    canAffordNext: false,
    shortfall: 10,
    betCount: 100,
    settledCount: 99,
    pendingCount: 1,
    hitCount: 0,
    missCount: 99,
    hitRate: 0,
    totalStaked: 1_000,
    peakBalance: 1_000,
    minimumBalance: 0,
    maximumDrawdown: 1_000,
    startedAt: "2026-10-10T09:00:00.000Z",
    latestOutcome: {
      forecastId: 1_000,
      resultId: 1_000,
      targetNumber: 1,
      resultNumber: 2,
      stake: 10,
      outcome: "miss",
      grossPayout: 0,
      balanceAfter: 10,
      occurredAt: "2026-10-10T10:00:19.000Z",
    },
  });
  payload.account.pendingBet.balanceBefore = 10;

  const normalized = normalizePredictiveLeaderApiSnapshot(payload);
  assert.equal(normalized?.status, "ready");
  assert.equal(normalized?.action, "BET");
  assert.equal(normalized?.account.status, "pending");
  assert.equal(normalized?.account.currentBalance, 0);
  assert.equal(normalized?.account.canAffordNext, false);
});

test("quality WAIT keeps the candidate visible but never exposes an actionable number", () => {
  const waiting = predictiveLeaderApiSnapshot();
  waiting.status = "waiting";
  waiting.reason = "quality_not_proven";
  waiting.action = "WAIT";
  waiting.number = null;
  waiting.qualityGate.status = "rejected";
  waiting.qualityGate.reason = "mean_brier_loss_not_below_uniform";
  waiting.qualityGate.eligible = false;
  waiting.qualityGate.meanBrierLoss = 0.5;
  waiting.qualityGate.brierDelta = 18 / 37 - 0.5;

  const normalized = normalizePredictiveLeaderApiSnapshot(waiting);
  assert.equal(normalized?.action, "WAIT");
  assert.equal(normalized?.number, null);
  assert.equal(normalized?.candidateNumber, 7);
  assert.equal(normalized?.qualityGate.status, "rejected");
  assert.deepEqual(predictiveLeaderNumberContext({
    loaded: true,
    snapshot: normalized,
  }), {
    state: "waiting",
    reason: "quality_not_proven",
    snapshot: normalized,
  });
});

test("predictive leader first-fetch error cannot remain stuck on loading", () => {
  const ready = normalizePredictiveLeaderApiSnapshot(predictiveLeaderApiSnapshot());
  assert.deepEqual(predictiveLeaderNumberContext({
    loaded: false,
    error: true,
    snapshot: ready,
  }), { state: "error" });
});

test("predictive leader SSE stale flag immediately hides a cached number", () => {
  const ready = normalizePredictiveLeaderApiSnapshot(predictiveLeaderApiSnapshot());
  assert.deepEqual(predictiveLeaderNumberContext({
    loaded: true,
    requiresFreshSnapshot: true,
    snapshot: ready,
  }), { state: "paused", reason: "event_stream_disconnected" });
});

test("V7 paper browser contract exposes the persisted dynamic stake and 10k ladder", () => {
  const normalized = normalizePredictiveLeaderV7PaperApiSnapshot(
    predictiveLeaderV7PaperApiSnapshot(),
  );

  assert.equal(normalized?.schemaVersion, 2);
  assert.equal(normalized?.strategyMode, "manual-override-paper");
  assert.equal(normalized?.executionEnabled, false);
  assert.equal(normalized?.campaign.model.initialBalance, 10_000);
  assert.equal(normalized?.campaign.model.cycleSpendLimit, 1_000);
  assert.equal(normalized?.account.currentBalance, 9_620);
  assert.equal(normalized?.ladder.cycleNumber, 1);
  assert.equal(normalized?.ladder.cycleStaked, 360);
  assert.equal(normalized?.pendingBet.stake, 20);
  assert.equal(normalized?.stake, normalized?.pendingBet.stake);
  assert.deepEqual(predictiveLeaderV7PaperContext({
    loaded: true,
    snapshot: normalized,
  }), {
    state: "ready",
    snapshot: normalized,
  });
});

test("V7 paper WAIT keeps pending audit visible but never exposes an action stake", () => {
  const payload = predictiveLeaderV7PaperApiSnapshot();
  Object.assign(payload, {
    status: "waiting",
    reason: "betting_closed",
    action: "WAIT",
    actionId: null,
    number: null,
    stake: null,
  });
  const normalized = normalizePredictiveLeaderV7PaperApiSnapshot(payload);

  assert.equal(normalized?.action, "WAIT");
  assert.equal(normalized?.stake, null);
  assert.equal(normalized?.pendingBet.stake, 20);
  assert.deepEqual(predictiveLeaderV7PaperContext({
    loaded: true,
    snapshot: normalized,
  }), {
    state: "waiting",
    reason: "betting_closed",
    snapshot: normalized,
  });
  assert.deepEqual(predictiveLeaderV7PaperContext({
    loaded: true,
    requiresFreshSnapshot: true,
    snapshot: normalized,
  }), { state: "paused", reason: "event_stream_disconnected" });
});

test("V7 paper BET expires locally at the exact betting cutoff", () => {
  const payload = predictiveLeaderV7PaperApiSnapshot();
  const normalized = normalizePredictiveLeaderV7PaperApiSnapshot(payload);
  const closesMs = Date.parse(payload.pendingBet.bettingClosesAt);

  assert.equal(predictiveLeaderV7PaperContext({
    loaded: true,
    snapshot: normalized,
    nowMs: closesMs - 1,
  }).state, "ready");
  assert.deepEqual(predictiveLeaderV7PaperContext({
    loaded: true,
    snapshot: normalized,
    nowMs: closesMs,
  }), {
    state: "waiting",
    reason: "betting_closed",
    snapshot: normalized,
  });

  payload.serverTime = payload.pendingBet.bettingClosesAt;
  assert.equal(normalizePredictiveLeaderV7PaperApiSnapshot(payload), null);
});

test("V7 paper browser contract preserves the clamped final stake at the cycle cap", () => {
  const payload = predictiveLeaderV7PaperApiSnapshot();
  Object.assign(payload, { stake: 10 });
  Object.assign(payload.account, {
    currentBalance: 9_000,
    accountingBalance: 9_000,
    availableBalance: 9_000,
    reservedStake: 10,
    profit: -1_000,
    nextStake: 10,
    ledgerRevision: 100,
  });
  Object.assign(payload.stats, {
    betCount: 100,
    settledCount: 99,
    pendingCount: 1,
    hitCount: 0,
    missCount: 99,
    hitRate: 0,
    totalStaked: 1_000,
    minimumBalance: 9_000,
    maximumDrawdown: 1_000,
  });
  Object.assign(payload.ladder, {
    cycleStaked: 990,
    ladderLoss: 990,
    missCount: 99,
    nextStake: 10,
    pendingReset: "cycle_spend_cap",
  });
  Object.assign(payload.pendingBet, {
    stake: 10,
    rawStake: 30,
    balanceBefore: 9_010,
    cycleStakedBefore: 990,
    ladderLossBefore: 990,
    missCountBefore: 99,
  });

  const normalized = normalizePredictiveLeaderV7PaperApiSnapshot(payload);
  assert.equal(normalized?.pendingBet.rawStake, 30);
  assert.equal(normalized?.pendingBet.stake, 10);
  assert.equal(normalized?.ladder.pendingReset, "cycle_spend_cap");
  assert.equal(normalized?.ladder.cycleStaked + normalized?.pendingBet.stake, 1_000);
});

test("V7 paper browser contract preserves a signed audit minimum after a late void deficit", () => {
  const payload = predictiveLeaderV7PaperApiSnapshot();
  Object.assign(payload, {
    status: "waiting",
    reason: "bankroll_exhausted",
    action: "WAIT",
    actionId: null,
    number: null,
    stake: null,
  });
  Object.assign(payload.account, {
    status: "exhausted",
    reason: "bankroll_exhausted",
    currentBalance: 0,
    deficit: 10,
    accountingBalance: -10,
    availableBalance: 0,
    reservedStake: 0,
    profit: -10_010,
    nextStake: 10,
    canAffordNext: false,
    shortfall: 20,
    ledgerRevision: 1_002,
  });
  Object.assign(payload.stats, {
    betCount: 1_001,
    settledCount: 1_001,
    pendingCount: 0,
    hitCount: 0,
    missCount: 1_001,
    hitRate: 0,
    totalStaked: 10_010,
    minimumBalance: -10,
    maximumDrawdown: 10_010,
  });
  Object.assign(payload.ladder, {
    cycleNumber: 2,
    cycleStaked: 10,
    ladderLoss: 10,
    missCount: 1,
    resetCount: 1,
    nextStake: 10,
    pendingReset: null,
  });
  payload.pendingBet = null;

  const normalized = normalizePredictiveLeaderV7PaperApiSnapshot(payload);
  assert.equal(normalized?.account.status, "exhausted");
  assert.equal(normalized?.account.deficit, 10);
  assert.equal(normalized?.account.accountingBalance, -10);
  assert.equal(normalized?.stats.minimumBalance, -10);
  assert.deepEqual(predictiveLeaderV7PaperContext({
    loaded: true,
    snapshot: normalized,
  }), {
    state: "waiting",
    reason: "bankroll_exhausted",
    snapshot: normalized,
  });
});

test("V7 paper browser contract fails closed on unsafe or inconsistent ladder state", () => {
  for (const mutate of [
    (value) => { value.schemaVersion = 1; },
    (value) => { value.executionEnabled = true; },
    (value) => { value.manualOverride.qualityGateRequired = true; },
    (value) => { value.campaign.model.initialBalance = 1_000; },
    (value) => { value.campaign.model.cycleSpendLimit = 10_000; },
    (value) => { value.ladder.nextStake = 10; },
    (value) => { value.account.currentBalance = 10_000; },
    (value) => { value.pendingBet.stake = 30; },
    (value) => { value.stake = 30; },
    (value) => {
      value.action = "WAIT";
      value.status = "waiting";
      value.reason = "betting_closed";
      value.actionId = null;
      value.number = null;
    },
  ]) {
    const malformed = predictiveLeaderV7PaperApiSnapshot();
    mutate(malformed);
    assert.equal(normalizePredictiveLeaderV7PaperApiSnapshot(malformed), null);
  }
});

test("combined freshness pauses on collector or persistence backlog", () => {
  const blockedStates = [
    {
      ...FRESH_STATE,
      collector: {
        ...FRESH_STATE.collector,
        status: "reconnecting",
        connected: false,
      },
    },
    {
      ...FRESH_STATE,
      collector: { ...FRESH_STATE.collector, resultConfirmationPending: true },
    },
    {
      ...FRESH_STATE,
      collector: { ...FRESH_STATE.collector, pendingResultCount: 1 },
    },
    { ...FRESH_STATE, pipelinePending: { results: 1, gaps: 0 } },
    { ...FRESH_STATE, pipelinePending: { results: 0, gaps: 1 } },
  ];

  for (const state of blockedStates) {
    assert.equal(assessCombinedNumberFreshness(state).status, "paused");
  }
  assert.equal(
    assessCombinedNumberFreshness(blockedStates[3]).reason,
    "persistence_pending",
  );
});

test("combined freshness pauses when database and collector cursors diverge", () => {
  const staleStates = [
    {
      ...FRESH_STATE,
      collector: {
        ...FRESH_STATE.collector,
        lastResultAt: "2026-10-09T15:00:48Z",
      },
    },
    {
      ...FRESH_STATE,
      collector: {
        ...FRESH_STATE.collector,
        currentRound: { id: "4103914" },
      },
    },
    { ...FRESH_STATE, pipelinePending: undefined },
  ];

  assert.deepEqual(
    staleStates.map((state) => assessCombinedNumberFreshness(state).reason),
    ["result_cursor_mismatch", "round_cursor_mismatch", "cursor_invalid"],
  );
  assert.ok(staleStates.every(
    (state) => assessCombinedNumberFreshness(state).status === "paused",
  ));
});

test("trajectory exposes a validated full Rank-37 and its correlated range", () => {
  const numberRanking = trajectoryRank37(32);
  const expectedRanking = numberRanking.ranking.map(({ number }) => number);
  const expectedWeights = numberRanking.ranking.map(({ rawMass }) => rawMass);
  const shadow = {
    isAdaptive: true,
    status: "ready",
    adaptive: { trainingCount: 30 },
    numberArea: { typical: { wireCell: 32, number: 32 } },
    numberRanking,
    displayRange: {
      cells: [30, 31, 32, 33].map((number) => ({
        wireCell: number,
        number,
      })),
    },
  };

  assert.deepEqual(combinedTrajectorySignals(shadow), {
    ranking: expectedRanking,
    weights: expectedWeights,
    range: [30, 31, 32, 33],
  });
  assert.equal(COMBINED_NUMBER_ALGORITHM_VERSION, "predictive-family-index-v4");
  assert.equal(TRAJECTORY_RANK37_VERSION, "trajectory-rank37-v1");
  assert.equal(
    TRAJECTORY_RANK37_BASIS,
    "adaptive-weighted-neighbor-delta-to-current-bands",
  );
  assert.equal(expectedRanking.length, 37);
  assert.equal(new Set(expectedRanking).size, 37);
  assert.deepEqual(combinedTrajectoryRanking(shadow), expectedRanking);
  assert.deepEqual(combinedTrajectorySignals({
    ...shadow,
    adaptive: { trainingCount: 29 },
  }), { ranking: [], weights: [], range: [] });
  assert.deepEqual(combinedTrajectorySignals({
    ...shadow,
    displayRange: { cells: [{ wireCell: 37, number: 37 }] },
  }), { ranking: [], weights: [], range: [] });

  const zeroAlias = {
    ...shadow,
    numberArea: { typical: { wireCell: 37, number: 0 } },
    numberRanking: trajectoryRank37(0),
    displayRange: {
      cells: [
        { wireCell: 36, number: 36 },
        { wireCell: 37, number: 0 },
      ],
    },
  };
  assert.deepEqual(combinedTrajectorySignals(zeroAlias), {
    ranking: zeroAlias.numberRanking.ranking.map(({ number }) => number),
    weights: zeroAlias.numberRanking.ranking.map(({ rawMass }) => rawMass),
    range: [36, 0],
  });
});

test("trajectory Rank-37 fails closed when its frozen full order is malformed", () => {
  const numberRanking = trajectoryRank37();
  const shadow = {
    isAdaptive: true,
    status: "ready",
    adaptive: { trainingCount: 30 },
    numberArea: { typical: { wireCell: 32, number: 32 } },
    numberRanking,
    displayRange: {
      cells: [31, 32, 33].map((number) => ({ wireCell: number, number })),
    },
  };
  const malformed = [
    {
      ...numberRanking,
      ranking: numberRanking.ranking.slice(0, -1),
    },
    {
      ...numberRanking,
      ranking: numberRanking.ranking.map((candidate, index) => (
        index === 1
          ? { ...candidate, number: numberRanking.ranking[0].number }
          : candidate
      )),
    },
    {
      ...numberRanking,
      ranking: numberRanking.ranking.map((candidate, index) => (
        index === 0 ? { ...candidate, mass: candidate.mass + 0.01 } : candidate
      )),
    },
  ];

  for (const invalidRanking of malformed) {
    assert.deepEqual(combinedTrajectorySignals({
      ...shadow,
      numberRanking: invalidRanking,
    }), { ranking: [], weights: [], range: [] });
  }
});

test("zero-mass Rank-37 tail cannot steer the combined leader", () => {
  const firstOrder = [17, 5, 9, ...Array.from({ length: 37 }, (_, number) => number)
    .filter((number) => ![17, 5, 9].includes(number))];
  const secondOrder = [17, 9, 5, ...firstOrder.slice(3).reverse()];
  const run = (numbers) => combineNumberRankings([
    {
      id: "price-rank37",
      family: "price",
      numbers,
      weights: numbers.map((number) => number === 17 ? 1 : 0),
    },
    { id: "recency", family: "recency", numbers: [5] },
    { id: "cycle", family: "cycle", numbers: [9] },
  ], { tieSeed: "same-current-round" });

  const first = run(firstOrder);
  const second = run(secondOrder);
  assert.equal(first.number, second.number);
  assert.equal(first.score, second.score);
  assert.equal(first.familySupportCount, second.familySupportCount);
});

test("virtual recency abstains until it has a current held target", () => {
  const latestResult = { id: 41, continuityEpoch: 3 };
  const base = {
    mode: "simulation",
    executionEnabled: false,
    status: "waiting",
    longestCandidate: {
      number: 0,
      continuityEpoch: 3,
      roundsSinceLast: 12,
    },
    longestCandidates: [0, 1, 2].map((number) => ({
      number,
      continuityEpoch: 3,
      roundsSinceLast: 12,
    })),
    activeSession: null,
  };

  assert.deepEqual(combinedVirtualRecencySources(base, latestResult), []);

  const armed = {
    ...base,
    status: "armed",
    activeSession: {
      status: "armed",
      targetNumber: 0,
      continuityEpoch: 3,
      activatedAfterResultId: 41,
      attemptCount: 0,
      lastBetResultId: null,
    },
  };
  assert.deepEqual(
    combinedVirtualRecencySources(armed, latestResult).at(-1),
    { id: "recency-virtual-held", family: "absence", numbers: [0] },
  );
  assert.equal(combinedVirtualRecencySources({
    ...armed,
    activeSession: { ...armed.activeSession, activatedAfterResultId: 40 },
  }, latestResult).length, 0);
  assert.equal(combinedVirtualRecencySources({
    ...base,
    longestCandidates: [
      base.longestCandidates[0],
      { ...base.longestCandidates[1], roundsSinceLast: 11 },
    ],
  }, latestResult).length, 0);
});

test("cycle adapter treats active remaining numbers as a set and completed survivor as one signal", () => {
  const settledAt = "2026-10-09T15:01:48Z";
  const records = (remaining) => Array.from({ length: 37 }, (_, number) => ({
    number,
    eliminated: !remaining.includes(number),
  }));
  const activeRemaining = Array.from({ length: 30 }, (_, index) => index + 7);
  const active = {
    id: 144,
    status: "active",
    integrityStatus: "ok",
    lastEventAt: settledAt,
    eventCount: 9,
    totalDraws: 9,
    eliminatedCount: 7,
    uniqueCount: 7,
    remainingCount: 30,
    remainingNumbers: activeRemaining,
    numbers: records(activeRemaining),
    survivorNumber: null,
  };
  const latest = {
    id: 99,
    number: 6,
    cycleId: 144,
    settledAt,
    remainingAfter: 30,
  };
  assert.deepEqual(combinedCycleNumberSignals(active, latest), {
    remaining: activeRemaining,
    survivor: [],
  });
  assert.deepEqual(combinedCycleNumberSignals({
    ...active,
    remainingNumbers: [...activeRemaining, activeRemaining[0]],
    remainingCount: 31,
  }, { ...latest, remainingAfter: 31 }), { remaining: [], survivor: [] });
  assert.deepEqual(combinedCycleNumberSignals({
    ...active,
    remainingNumbers: [...activeRemaining.slice(0, -1), 99],
  }, latest), { remaining: [], survivor: [] });

  const completed = {
    ...active,
    status: "completed",
    eventCount: 54,
    totalDraws: 54,
    eliminatedCount: 36,
    uniqueCount: 36,
    remainingCount: 1,
    remainingNumbers: [9],
    numbers: records([9]),
    survivorNumber: 9,
  };
  assert.deepEqual(combinedCycleNumberSignals(completed, {
    ...latest,
    remainingAfter: 1,
  }), { remaining: [], survivor: [9] });
});

test("cycle analogue exposes only the next aligned archive event", () => {
  const start = Date.parse("2026-10-09T15:00:00Z");
  const events = (length, numberOffset = 0, idOffset = 0) => (
    Array.from({ length }, (_, index) => ({
      position: index + 1,
      resultId: idOffset + index + 1,
      number: (numberOffset + index) % 37,
      settledAt: new Date(start + index * 1_000).toISOString(),
    }))
  );
  const targetEvents = events(20);
  const analogueEvents = events(25, 11, 100);
  const latest = {
    id: 20,
    number: 19,
    cycleId: 7,
    settledAt: targetEvents.at(-1).settledAt,
  };
  const activeCycle = {
    id: 7,
    status: "active",
    integrityStatus: "ok",
    eventCount: 20,
    totalDraws: 20,
  };
  const comparison = {
    schemaVersion: 1,
    algorithmVersion: "cycle-analogue-prefix-v1",
    interpretation: "descriptive-not-predictive",
    anchorDrawCount: 20,
    anchorResultId: 20,
    status: "ready",
    target: {
      mode: "active",
      cycle: {
        id: 7,
        status: "active",
        integrityStatus: "ok",
        eventCount: 20,
        totalDraws: 20,
      },
      events: targetEvents,
    },
    analogue: {
      cycle: {
        id: 2,
        status: "completed",
        integrityStatus: "ok",
        eventCount: 25,
        totalDraws: 25,
      },
      events: analogueEvents,
    },
  };

  assert.deepEqual(
    combinedCycleAnalogueRanking(comparison, activeCycle, latest),
    [analogueEvents[20].number],
  );
  assert.deepEqual(combinedCycleAnalogueRanking({
    ...comparison,
    anchorResultId: 19,
  }, activeCycle, latest), []);
  assert.deepEqual(combinedCycleAnalogueRanking({
    ...comparison,
    analogue: { ...comparison.analogue, events: analogueEvents.slice(0, 20), cycle: {
      ...comparison.analogue.cycle,
      eventCount: 20,
      totalDraws: 20,
    } },
  }, activeCycle, latest), []);
});

test("triple follower adapter enforces the atomic current cursor and ranking", () => {
  const latest = {
    id: 12,
    number: 4,
    continuityEpoch: 2,
    settledAt: "2026-10-09T15:01:48Z",
  };
  const signal = {
    schemaVersion: 1,
    algorithmVersion: "triple-follower-current-v1",
    definition: "next-result-after-ordered-pair-within-continuity-epoch",
    tieBreak: "occurrence-count-desc,last-occurred-at-desc,number-asc",
    status: "ready",
    historyThroughResultId: 12,
    historyThrough: "2026-10-09T15:01:48.000Z",
    anchor: {
      continuityEpoch: 2,
      previous: {
        resultId: 11,
        number: 36,
        settledAt: "2026-10-09T15:01:30Z",
      },
      current: {
        resultId: 12,
        number: 4,
        settledAt: "2026-10-09T15:01:48Z",
      },
    },
    sampleSize: 3,
    observedFollowerCount: 2,
    candidates: [
      {
        rank: 1,
        number: 7,
        occurrenceCount: 2,
        share: 2 / 3,
        lastOccurredAt: "2026-10-09T14:00:00Z",
      },
      {
        rank: 2,
        number: 8,
        occurrenceCount: 1,
        share: 1 / 3,
        lastOccurredAt: "2026-10-09T13:00:00Z",
      },
    ],
  };
  assert.deepEqual(combinedTripleFollowerRanking(signal, latest), [7, 8]);
  assert.equal(combinedTripleFollowerRanking({
    ...signal,
    historyThroughResultId: 11,
  }, latest), null);
  assert.equal(combinedTripleFollowerRanking({
    ...signal,
    candidates: [...signal.candidates].reverse(),
  }, latest), null);
});

test("overdue adapter follows the displayed recency order without averaging labels", () => {
  assert.deepEqual(combinedOverdueRanking([
    { number: 3, roundsSinceLast: 10, lastSeenAt: "2026-10-09T10:00:00Z" },
    { number: 8, roundsSinceLast: 12, lastSeenAt: "2026-10-09T11:00:00Z" },
    { number: 9, roundsSinceLast: 10, lastSeenAt: "2026-10-09T09:00:00Z" },
    { number: 2, roundsSinceLast: null, lastSeenAt: null },
  ]), [8, 9, 3]);
});

test("one ranked family still produces exactly one leader", () => {
  const result = combineNumberRankings([
    { id: "price", family: "price", numbers: [12, 16, 7] },
  ], { tieSeed: "round-4103913" });

  assert.equal(result.version, COMBINED_NUMBER_ALGORITHM_VERSION);
  assert.equal(result.status, "ranked");
  assert.equal(result.number, 12);
  assert.ok(Math.abs(result.score - 0.5) < 1e-12);
  assert.equal(result.sourceCount, 1);
  assert.equal(result.familyCount, 1);
  assert.equal(result.supportCount, 1);
  assert.equal(result.familySupportCount, 1);
  assert.equal(result.tieCount, 1);
  assert.equal(result.tieBreakApplied, false);
  assert.deepEqual(result.sourceIds, ["price"]);
  assert.deepEqual(result.familyIds, ["price"]);
});

test("disjoint families still return one strongest ranked number", () => {
  const result = combineNumberRankings([
    { id: "price", family: "price", numbers: [18, 19, 17] },
    { id: "transition", family: "transition", numbers: [32] },
  ], { tieSeed: "round-4103913" });

  assert.equal(result.status, "ranked");
  assert.equal(result.number, 32);
  assert.ok(Math.abs(result.score - 0.5) < 1e-12);
  assert.equal(result.sourceCount, 2);
  assert.equal(result.familyCount, 2);
  assert.equal(result.familySupportCount, 1);
  assert.equal(result.tieBreakApplied, false);
});

test("unordered sets give every member equal weight and ignore input order", () => {
  const forward = combineNumberRankings([
    { id: "remaining", family: "cycle", mode: "set", numbers: [9, 3, 12] },
  ], { tieSeed: "cycle-144" });
  const reordered = combineNumberRankings([
    { id: "remaining", family: "cycle", mode: "set", numbers: [12, 9, 3] },
  ], { tieSeed: "cycle-144" });

  assert.deepEqual(reordered, forward);
  assert.equal(forward.status, "ranked");
  assert.ok([3, 9, 12].includes(forward.number));
  assert.ok(Math.abs(forward.score - (1 / 3)) < 1e-12);
  assert.equal(forward.tieCount, 3);
  assert.equal(forward.tieBreakApplied, true);
});

test("correlated sources are averaged inside their family before families are averaged", () => {
  const result = combineNumberRankings([
    { id: "price-model", family: "price", numbers: [1, 2] },
    { id: "price-q50", family: "price", numbers: [2] },
    { id: "transition", family: "transition", numbers: [2, 1] },
  ], { tieSeed: "round-4103913" });

  assert.equal(result.status, "ranked");
  assert.equal(result.number, 2);
  assert.ok(Math.abs(result.score - (2 / 3)) < 1e-12);
  assert.equal(result.sourceCount, 3);
  assert.equal(result.familyCount, 2);
  assert.equal(result.supportCount, 3);
  assert.equal(result.familySupportCount, 2);
  assert.equal(result.tieBreakApplied, false);
});

test("seeded tie resolution is deterministic and independent of source order", () => {
  const sources = [
    { id: "transition", family: "transition", numbers: [36, 0] },
    { id: "price", family: "price", numbers: [0, 36] },
  ];
  const forward = combineNumberRankings(sources, { tieSeed: "round-4103913" });
  const reversed = combineNumberRankings([...sources].reverse(), {
    tieSeed: "round-4103913",
  });

  assert.deepEqual(reversed, forward);
  assert.equal(forward.status, "ranked");
  assert.ok([0, 36].includes(forward.number));
  assert.ok(Math.abs(forward.score - 0.5) < 1e-12);
  assert.equal(forward.tieCount, 2);
  assert.equal(forward.tieBreakApplied, true);
  assert.equal(forward.familySupportCount, 2);

  const seededWinners = new Set(Array.from({ length: 100 }, (_, index) => (
    combineNumberRankings(sources, { tieSeed: `round-${index}` }).number
  )));
  assert.deepEqual([...seededWinners].sort((left, right) => left - right), [0, 36]);
});

test("invalid and duplicate sources add no weight while modes dedupe separately", () => {
  const sources = [
    { id: "model-a", family: "price", numbers: [12, 9] },
    { id: "model-copy", family: "price", numbers: [12, 9] },
    { id: "remaining-a", family: "cycle", mode: "set", numbers: [4, 8, 2] },
    { id: "remaining-copy", family: "cycle", mode: "set", numbers: [2, 4, 8] },
    { id: "cycle-ranking", family: "cycle", mode: "ranking", numbers: [2, 4, 8] },
    { id: "duplicate", family: "price", numbers: [12] },
    { id: "duplicate", family: "transition", numbers: [12] },
    { id: "repeated-number", family: "bad", numbers: [7, 7] },
    { id: "out-of-range", family: "bad", numbers: [37] },
    { id: "bad-mode", family: "bad", mode: "weighted", numbers: [1] },
    { id: "missing-family", numbers: [1] },
    null,
  ];
  const before = structuredClone(sources);
  const forward = combineNumberRankings(sources, { tieSeed: "stable" });
  const reversed = combineNumberRankings([...sources].reverse(), {
    tieSeed: "stable",
  });

  assert.deepEqual(sources, before);
  assert.deepEqual(reversed, forward);
  assert.equal(forward.status, "ranked");
  assert.equal(forward.number, 12);
  assert.equal(forward.sourceCount, 3);
  assert.equal(forward.familyCount, 2);
  assert.deepEqual(forward.sourceIds, [
    "cycle-ranking",
    "model-a",
    "remaining-a",
  ]);
  assert.deepEqual(forward.familyIds, ["cycle", "price"]);
});

test("empty input fails closed with the complete v4 result shape", () => {
  assert.deepEqual(combineNumberRankings([]), {
    version: COMBINED_NUMBER_ALGORITHM_VERSION,
    status: "unavailable",
    number: null,
    score: null,
    sourceCount: 0,
    familyCount: 0,
    supportCount: 0,
    familySupportCount: 0,
    tieCount: 0,
    tieBreakApplied: false,
    sourceIds: [],
    familyIds: [],
  });
  assert.deepEqual(combineNumberRankings(null), combineNumberRankings([]));
});
