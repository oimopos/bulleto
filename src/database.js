import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import {
  ROULETTE_NUMBERS,
  canonicalRouletteNumber,
  eliminateNumber,
} from "./domain.js";
import {
  VIRTUAL_BET_MODEL,
  calculateNextVirtualStake,
  settleVirtualBet,
} from "./virtual-bettor.js";
import {
  VIRTUAL_WINDOW_BET_MODEL,
  settleVirtualWindowBet,
  virtualWindowAttemptBudget,
  virtualWindowCandidateEligible,
  virtualWindowStake,
} from "./virtual-window-bettor.js";
import {
  FORECAST_CONSENSUS_BORDA_ALGORITHM_VERSION,
  FORECAST_CONSENSUS_MODEL_AUTHORITATIVE_ALGORITHM_VERSION,
  combineFrozenTop3,
} from "./forecast-consensus.js";
import {
  PRECLOSE_FORECAST_FACTOR_WINDOW_MS,
  PRECLOSE_FORECAST_HORIZON_SECONDS,
  PRECLOSE_FORECAST_MAX_LEAD_MS,
  PRECLOSE_FORECAST_MIN_LEAD_MS,
  PRECLOSE_FORECAST_SHADOW_MODEL_VERSION,
  PRECLOSE_START_PRICE_MODEL_VERSION,
  calculatePrecloseOlsSlope,
  rankPrecloseForecastCells,
} from "./preclose-forecast.js";
import {
  TRAJECTORY_SHADOW_VERSION,
} from "./trajectory-shadow.js";
import {
  TRAJECTORY_SHADOW_ADAPTIVE_DEFAULTS,
  TRAJECTORY_SHADOW_ADAPTIVE_EXPERTS,
  TRAJECTORY_SHADOW_ADAPTIVE_VERSION,
  predictAdaptiveTrajectoryShadow,
} from "./trajectory-shadow-adaptive.js";
import {
  TRAJECTORY_RANK37_BASIS,
  TRAJECTORY_RANK37_EVIDENCE_MASS_THRESHOLD,
  TRAJECTORY_RANK37_MIN_EVIDENCE_CANDIDATES,
  TRAJECTORY_RANK37_MIN_TRAINING_COUNT,
  TRAJECTORY_RANK37_SMOOTHING_WEIGHT,
  TRAJECTORY_RANK37_VERSION,
  buildTrajectoryRank37,
} from "./trajectory-rank37.js";
import {
  LEARNED_LEADER_ALGORITHM_VERSION,
  LEARNED_LEADER_DEFAULTS,
  LEARNED_LEADER_LEARNING_VERSION,
  LEARNED_LEADER_SCHEMA_VERSION,
  LEARNED_LEADER_UNIFORM_BRIER_LOSS,
  buildLearnedLeaderDecision,
  evaluateLearnedLeaderDecision,
  normalizeLearnedLeaderDecision,
} from "./learned-leader.js";
import {
  LEARNED_LEADER_V7_ALGORITHM_VERSION,
  LEARNED_LEADER_V7_CONFIG_VERSION,
  LEARNED_LEADER_V7_SCHEMA_VERSION,
  LEARNED_LEADER_V7_TARGET_HORIZON,
  LEARNED_LEADER_V7_UNIFORM_BRIER_LOSS,
  buildLearnedLeaderV7Decision,
  createLearnedLeaderV7Config,
  evaluateLearnedLeaderV7Decision,
  normalizeLearnedLeaderV7Decision,
} from "./learned-leader-v7.js";
import {
  CURRENT_CELL_HORIZON_SHADOW_ALGORITHM_VERSION,
  CURRENT_CELL_HORIZON_SHADOW_COHORT_KEY,
  CURRENT_CELL_HORIZON_SHADOW_CONFIG,
  CURRENT_CELL_HORIZON_SHADOW_CONFIG_VERSION,
  CURRENT_CELL_HORIZON_SHADOW_INSTRUMENT,
  CURRENT_CELL_HORIZON_SHADOW_SCHEMA_VERSION,
  CURRENT_CELL_HORIZON_SHADOW_SOURCE,
  CURRENT_CELL_HORIZON_SHADOW_UNIFORM_BRIER_LOSS,
  CURRENT_CELL_HORIZON_SHADOW_UNIFORM_LOG_LOSS,
  buildCurrentCellHorizonShadow,
  currentCellHorizonClippedLogLoss,
  evaluateCurrentCellHorizonShadow,
  normalizeCurrentCellHorizonShadow,
} from "./current-cell-horizon-shadow.js";
import {
  PREDICTIVE_LEADER_QUALITY_GATE,
  evaluatePredictiveLeaderQualityGate,
} from "./predictive-leader-quality-gate.js";
import {
  PREDICTIVE_LEADER_ACCOUNT_MODEL,
  PREDICTIVE_LEADER_ACCOUNT_SCHEMA_VERSION,
  PREDICTIVE_LEADER_ACCOUNT_STARTING_BALANCE,
  PREDICTIVE_LEADER_ACCOUNT_STRATEGY_VERSION,
  nextPredictiveLeaderStake,
  settlePredictiveLeaderBet,
} from "./predictive-leader-account.js";
import {
  PREDICTIVE_LEADER_V7_PAPER_LADDER_CAMPAIGN_KEY,
  PREDICTIVE_LEADER_V7_PAPER_LADDER_MODEL,
  PREDICTIVE_LEADER_V7_PAPER_LADDER_SCHEMA_VERSION,
  PREDICTIVE_LEADER_V7_PAPER_LADDER_STRATEGY_VERSION,
  calculatePredictiveLeaderV7PaperNextStake,
  calculatePredictiveLeaderV7PaperRawStake,
  settlePredictiveLeaderV7PaperLadderBet,
} from "./predictive-leader-v7-paper-ladder.js";
import {
  WARM_TOP1_ALGORITHM_VERSION,
  WARM_TOP1_BREAK_EVEN_RATE,
  WARM_TOP1_GATE_TARGET_SAMPLE_SIZE,
  WARM_TOP1_GATE_VERSION,
  evaluateWarmTop1FixedGate,
  warmTop1CandidateFromPairSnapshot,
} from "./warm-top1-quality-gate.js";
import {
  CYCLE_ANALOGUE_ALGORITHM_VERSION,
  CYCLE_ANALOGUE_ANCHOR_DRAW_COUNT,
  selectCycleAnalogue,
} from "./cycle-analogue.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const DEFAULT_VIRTUAL_STARTING_BALANCE = 87_700;
const DEFAULT_VIRTUAL_WINDOW_STARTING_BALANCE =
  VIRTUAL_WINDOW_BET_MODEL.initialBalance;
const ROUND_TRAJECTORY_SCHEMA_VERSION = 1;
const TRAJECTORY_SHADOW_SCHEMA_VERSION = 1;
const TRAJECTORY_SHADOW_CANDIDATE_LIMIT = 500;
const TRAJECTORY_SHADOW_LEARNING_LIMIT = 500;
const TRAJECTORY_SHADOW_LEARNING_CANDIDATE_LIMIT = 1_000;
const TRAJECTORY_PREFIX_EDGE_TOLERANCE_MS = 5_000;
const TRAJECTORY_NUMBER_AREA_VERSION = "trajectory-number-area-v1";
const TRAJECTORY_DISPLAY_RANGE_VERSION = "trajectory-display-range-v1";
const TRAJECTORY_DISPLAY_RANGE_POLICY =
  "q50-centered-contiguous-max6-v1";
const TRAJECTORY_DISPLAY_RANGE_MAX_CELLS = 6;
const PREDICTIVE_LEADER_ACCOUNT_RESET_KEY = "manual-ladder-restart-2026-10-12";
const PREDICTIVE_LEADER_ACCOUNT_RESET_REASON = "user_requested";
const PREDICTIVE_LEADER_SIGNAL_ACCOUNT_SCHEMA_VERSION = 1;
const PREDICTIVE_LEADER_SIGNAL_ACCOUNT_STRATEGY_VERSION =
  "quality-gated-fixed10-v1";
const PREDICTIVE_LEADER_SIGNAL_ACCOUNT_STARTING_BALANCE = 1_000;
const PREDICTIVE_LEADER_SIGNAL_STAKE = 10;
const PREDICTIVE_LEADER_SIGNAL_GROSS_PAYOUT_MULTIPLIER = 36;
const PREDICTIVE_LEADER_V7_GATE_WINDOW_SIZE = 1_000;
const PREDICTIVE_LEADER_V7_BREAK_EVEN_RATE = 1 / 36;
const PREDICTIVE_LEADER_V7_MINIMUM_BRIER_IMPROVEMENT = 1e-4;
const PREDICTIVE_LEADER_V7_MINIMUM_SELECTION_COVERAGE = 0.9;
const PREDICTIVE_LEADER_V7_GATE_VERSION = "fixed-first-1000-prospective-v1";
const PREDICTIVE_LEADER_V7_FORECAST_HORIZON_SECONDS = 8;
export const PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN = Object.freeze({
  campaignKey: "v7-manual-override-paper-20261019",
  schemaVersion: 1,
  strategyVersion: "predictive-leader-v7-manual-override-paper-v1",
  mode: "manual-override-paper",
  initialBalance: 1_000,
  fixedStake: 10,
  grossPayoutMultiplier: 36,
  payoutIncludesStake: true,
  minimumPlacementLeadMs: 5_000,
  executionEnabled: false,
  advisoryOnly: true,
  promotionEligible: false,
  promotionPolicy: "manual-override-paper-not-promoted",
  authorizationReason: "operator-requested-virtual-api-2026-10-19",
});
export const PREDICTIVE_LEADER_V7_PAPER_LADDER_CAMPAIGN = Object.freeze({
  campaignKey: PREDICTIVE_LEADER_V7_PAPER_LADDER_CAMPAIGN_KEY,
  schemaVersion: PREDICTIVE_LEADER_V7_PAPER_LADDER_SCHEMA_VERSION,
  strategyVersion: PREDICTIVE_LEADER_V7_PAPER_LADDER_STRATEGY_VERSION,
  mode: "manual-override-paper",
  initialBalance: PREDICTIVE_LEADER_V7_PAPER_LADDER_MODEL.initialBalance,
  model: PREDICTIVE_LEADER_V7_PAPER_LADDER_MODEL,
  minimumPlacementLeadMs: 5_000,
  executionEnabled: false,
  advisoryOnly: true,
  promotionEligible: false,
  promotionPolicy: "manual-override-paper-not-promoted",
  authorizationReason: "operator-requested-virtual-api-2026-10-19",
});
export const PREDICTIVE_LEADER_WARM_TOP1_PAPER_CAMPAIGN = Object.freeze({
  campaignKey: "warm-top1-quality-paper-20261019",
  schemaVersion: 1,
  strategyVersion: "predictive-leader-warm-top1-quality-paper-ladder-v1",
  algorithmVersion: WARM_TOP1_ALGORITHM_VERSION,
  gateVersion: WARM_TOP1_GATE_VERSION,
  mode: "quality-gated-warm-top1-paper-ladder",
  initialBalance: PREDICTIVE_LEADER_V7_PAPER_LADDER_MODEL.initialBalance,
  model: PREDICTIVE_LEADER_V7_PAPER_LADDER_MODEL,
  minimumPlacementLeadMs: 5_000,
  executionEnabled: false,
  advisoryOnly: true,
});
export const PREDICTIVE_LEADER_V7_CANDIDATE_CONFIG =
  createLearnedLeaderV7Config({
    version: LEARNED_LEADER_V7_CONFIG_VERSION,
    candidateId: "v7-rank20-history80-uniform95-a740-b500-t5-20261018",
    targetHorizon: LEARNED_LEADER_V7_TARGET_HORIZON,
    price: {
      temperature: 5,
      baselineMix: 0,
    },
    history: {
      pairPriorStrength: 740,
      tripleBackoffStrength: 500,
    },
    blend: {
      price: 0.01,
      conditionalHistory: 0.04,
      baseline: 0.95,
    },
    selection: {
      minimumPriceEvidenceCandidates: 5,
      minimumPairEffectiveSampleSize: 100,
      minimumLeaderMass: 1 / 37,
      minimumMargin: 0,
    },
  });
const PREDICTIVE_LEADER_V7_CONFIG_JSON = JSON.stringify(
  PREDICTIVE_LEADER_V7_CANDIDATE_CONFIG,
);
export const PREDICTIVE_LEADER_V7_CONFIG_SHA256 = createHash("sha256")
  .update(PREDICTIVE_LEADER_V7_CONFIG_JSON)
  .digest("hex");
export const PREDICTIVE_LEADER_V7_SOURCE_EXPORT = Object.freeze({
  artifact: "buleto-production-20261018T0030Z.sqlite",
  sha256: "9149c55c6d77f8175ab65cd31b12f7b4b3bbb88bb8014c19c6c34ada6f523fbc",
  // Maximum logical write timestamp observed in the immutable source export.
  cutoffAt: "2026-10-18T00:32:03.908Z",
});
export const PREDICTIVE_SHADOW_FROZEN_STREAM = Object.freeze({
  source: CURRENT_CELL_HORIZON_SHADOW_SOURCE,
  instrument: CURRENT_CELL_HORIZON_SHADOW_INSTRUMENT,
});
const CURRENT_CELL_HORIZON_SHADOW_CONFIG_JSON = JSON.stringify(
  CURRENT_CELL_HORIZON_SHADOW_CONFIG,
);
export const CURRENT_CELL_HORIZON_SHADOW_CONFIG_SHA256 = createHash("sha256")
  .update(CURRENT_CELL_HORIZON_SHADOW_CONFIG_JSON)
  .digest("hex");
export const CURRENT_CELL_HORIZON_SHADOW_SOURCE_EXPORT = Object.freeze({
  artifact: PREDICTIVE_LEADER_V7_SOURCE_EXPORT.artifact,
  sha256: PREDICTIVE_LEADER_V7_SOURCE_EXPORT.sha256,
  cutoffAt: PREDICTIVE_LEADER_V7_SOURCE_EXPORT.cutoffAt,
});
const CURRENT_CELL_HORIZON_SHADOW_GATE_WINDOW_SIZE = 1_000;
const CURRENT_CELL_HORIZON_SHADOW_BREAK_EVEN_RATE = 1 / 36;
const CURRENT_CELL_HORIZON_SHADOW_MINIMUM_READY_COVERAGE = 0.9;
const CURRENT_CELL_HORIZON_SHADOW_MINIMUM_PAIRED_V5_COVERAGE = 0.9;
const CURRENT_CELL_HORIZON_SHADOW_GATE_VERSION =
  "fixed-first-1000-ready-prospective-v1";
const CURRENT_CELL_HORIZON_SHADOW_PAPER_STARTING_BALANCE = 1_000;
const CURRENT_CELL_HORIZON_SHADOW_PAPER_STAKE = 10;
const CURRENT_CELL_HORIZON_SHADOW_PAPER_GROSS_MULTIPLIER = 36;
const FOLLOWER_TOP5_HORIZONS = Object.freeze([1, 2, 3, 5, 10, 20]);
const FOLLOWER_TOP5_ALL_HORIZONS = Object.freeze(
  Array.from({ length: 20 }, (_, index) => index + 1),
);
const FOLLOWER_TOP5_COUNT = 5;
const FOLLOWER_TOP5_MINIMUM_OBSERVED = 5;
const FOLLOWER_TOP5_LIVE_ALGORITHM_VERSION = "follower-top5-live-v1";
const FOLLOWER_WARM_THRESHOLD_PERCENT = 5;
const FOLLOWER_WARM_ALGORITHM_VERSION = "follower-warm-top5-next-v1";
const FOLLOWER_WARM_ACCOUNT_STARTING_BALANCE = 10_000;
const FOLLOWER_WARM_ACCOUNT_SELECTION_COUNT = FOLLOWER_TOP5_COUNT;
const FOLLOWER_WARM_ACCOUNT_NET_HIT_MULTIPLIER =
  VIRTUAL_BET_MODEL.grossPayoutMultiplier - FOLLOWER_WARM_ACCOUNT_SELECTION_COUNT;
const FOLLOWER_WARM_ACCOUNT_ALGORITHM_VERSION =
  "follower-warm-top5-ladder-v2";
const FOLLOWER_WARM_ACCOUNT_MODEL_VERSION = "2.0.0";
const FOLLOWER_TOP5_GATE_THRESHOLD_PERCENT = 80;
const FOLLOWER_TOP5_GATE_MAXIMUM_ATTEMPT = 20;
const FOLLOWER_TOP5_GATE_ACCOUNT_ALGORITHM_VERSION =
  "follower-top5-cumulative80-ladder-v1";
const TRIPLE_FOLLOWER_SCHEMA_VERSION = 1;
const TRIPLE_FOLLOWER_ALGORITHM_VERSION = "triple-follower-current-v1";
const TRIPLE_FOLLOWER_DEFINITION =
  "next-result-after-ordered-pair-within-continuity-epoch";
const TRIPLE_FOLLOWER_TIE_BREAK =
  "occurrence-count-desc,last-occurred-at-desc,number-asc";

function emptyFollowerHitBucket() {
  return {
    eligibleCount: 0,
    hitCounts: FOLLOWER_TOP5_ALL_HORIZONS.map(() => 0),
  };
}

function followerHitPoints(bucket, horizons = FOLLOWER_TOP5_HORIZONS) {
  return horizons.map((horizon) => ({
    horizon,
    hitCount: bucket.hitCounts[horizon - 1],
    eligibleCount: bucket.eligibleCount,
    rate:
      bucket.eligibleCount > 0
        ? bucket.hitCounts[horizon - 1] / bucket.eligibleCount
        : null,
  }));
}

function rankFollowerNumbers(counts, lastOccurredAt) {
  return [...ROULETTE_NUMBERS]
    .sort((left, right) => {
      if (counts[right] !== counts[left]) {
        return counts[right] - counts[left];
      }
      const rightLast = lastOccurredAt[right] ?? "";
      const leftLast = lastOccurredAt[left] ?? "";
      if (rightLast !== leftLast) {
        return rightLast.localeCompare(leftLast);
      }
      return left - right;
    })
    .slice(0, FOLLOWER_TOP5_COUNT);
}

function followerSampleSize(counts) {
  return counts.reduce((total, count) => total + count, 0);
}

function meetsFollowerWarmThreshold(occurrenceCount, sampleSize) {
  return sampleSize > 0
    && occurrenceCount * 100 >= sampleSize * FOLLOWER_WARM_THRESHOLD_PERCENT;
}

function followerRankedCandidates(counts, lastOccurredAt) {
  const sampleSize = followerSampleSize(counts);
  return rankFollowerNumbers(counts, lastOccurredAt).map((number, index) => ({
    rank: index + 1,
    number,
    occurrenceCount: counts[number],
    share: sampleSize > 0 ? counts[number] / sampleSize : null,
    lastOccurredAt: lastOccurredAt[number],
  }));
}

function calculateSharedTop5Stake(priorSessionLoss) {
  const lossCoveredPerStep =
    FOLLOWER_WARM_ACCOUNT_NET_HIT_MULTIPLIER * VIRTUAL_BET_MODEL.stakeStep;
  const requiredSteps = Math.max(
    1,
    Math.ceil(priorSessionLoss / lossCoveredPerStep),
  );
  return Math.min(
    VIRTUAL_BET_MODEL.maxStake,
    Math.max(
      VIRTUAL_BET_MODEL.initialStake,
      VIRTUAL_BET_MODEL.stakeStep * requiredSteps,
    ),
  );
}

function createFollowerWarmHistoricalAccount() {
  return {
    status: "waiting",
    currentBalance: FOLLOWER_WARM_ACCOUNT_STARTING_BALANCE,
    nextStakePerNumber: calculateSharedTop5Stake(0),
    eligibleAnchorCount: 0,
    betCount: 0,
    hitCount: 0,
    missCount: 0,
    totalStaked: 0,
    totalGrossPayout: 0,
    skippedAfterExhaustionCount: 0,
    peakBalance: FOLLOWER_WARM_ACCOUNT_STARTING_BALANCE,
    minimumBalance: FOLLOWER_WARM_ACCOUNT_STARTING_BALANCE,
    maximumDrawdown: 0,
    maxStakePerNumber: 0,
    maxRoundCost: 0,
    continuityGapCount: 0,
    firstBetAt: null,
    lastBetAt: null,
    exhaustedAt: null,
    ladderMissCount: 0,
    ladderTotalLoss: 0,
    latestOutcome: null,
  };
}

function resetFollowerWarmLadderAtGap(account) {
  account.continuityGapCount += 1;
  if (account.status === "exhausted") return;
  account.ladderMissCount = 0;
  account.ladderTotalLoss = 0;
  account.nextStakePerNumber = calculateSharedTop5Stake(0);
}

function settleFollowerWarmHistoricalAnchor(account, {
  anchor,
  next,
  sourceNumber,
  targetNumbers,
}) {
  account.eligibleAnchorCount += 1;
  if (account.status === "exhausted") {
    account.skippedAfterExhaustionCount += 1;
    return;
  }

  const stakePerNumber = calculateSharedTop5Stake(
    account.ladderTotalLoss,
  );
  const totalStake = FOLLOWER_WARM_ACCOUNT_SELECTION_COUNT * stakePerNumber;
  account.nextStakePerNumber = stakePerNumber;
  if (totalStake > account.currentBalance) {
    account.status = "exhausted";
    account.exhaustedAt = anchor.settled_at;
    account.skippedAfterExhaustionCount += 1;
    return;
  }

  const resultNumber = Number(next.result_number);
  const hitIndex = targetNumbers.indexOf(resultNumber);
  const outcome = hitIndex >= 0 ? "hit" : "miss";
  const grossPayout = outcome === "hit"
    ? stakePerNumber * VIRTUAL_BET_MODEL.grossPayoutMultiplier
    : 0;
  const balanceAfter =
    account.currentBalance - totalStake + grossPayout;
  if (!Number.isSafeInteger(balanceAfter) || balanceAfter < 0) {
    throw new RangeError("warm historical account balance is invalid");
  }

  account.status = "running";
  account.currentBalance = balanceAfter;
  account.betCount += 1;
  account.totalStaked += totalStake;
  account.totalGrossPayout += grossPayout;
  account.maxStakePerNumber = Math.max(
    account.maxStakePerNumber,
    stakePerNumber,
  );
  account.maxRoundCost = Math.max(account.maxRoundCost, totalStake);
  account.firstBetAt ??= next.settled_at;
  account.lastBetAt = next.settled_at;
  account.peakBalance = Math.max(account.peakBalance, balanceAfter);
  account.minimumBalance = Math.min(account.minimumBalance, balanceAfter);
  account.maximumDrawdown = Math.max(
    account.maximumDrawdown,
    account.peakBalance - balanceAfter,
  );

  if (outcome === "hit") {
    account.hitCount += 1;
    account.ladderMissCount = 0;
    account.ladderTotalLoss = 0;
    account.nextStakePerNumber = calculateSharedTop5Stake(0);
  } else {
    account.missCount += 1;
    account.ladderMissCount += 1;
    account.ladderTotalLoss += totalStake;
    account.nextStakePerNumber = calculateSharedTop5Stake(
      account.ladderTotalLoss,
    );
    if (
      FOLLOWER_WARM_ACCOUNT_SELECTION_COUNT * account.nextStakePerNumber
      > balanceAfter
    ) {
      account.status = "exhausted";
      account.exhaustedAt = next.settled_at;
    }
  }

  account.latestOutcome = {
    anchorResultId: Number(anchor.id),
    resultId: Number(next.id),
    sourceNumber,
    targetNumbers: [...targetNumbers],
    selectionCount: targetNumbers.length,
    resultNumber,
    hitRank: hitIndex >= 0 ? hitIndex + 1 : null,
    stakePerNumber,
    totalStake,
    outcome,
    grossPayout,
    balanceAfter,
    nextStakePerNumber: account.nextStakePerNumber,
    nextRoundCost:
      FOLLOWER_WARM_ACCOUNT_SELECTION_COUNT * account.nextStakePerNumber,
    occurredAt: next.settled_at,
  };
}

function followerWarmCurrentAction(account, currentSignal) {
  const targetNumbers = ["ready", "no_signal"].includes(currentSignal.status)
    ? currentSignal.candidates
      .slice(0, FOLLOWER_WARM_ACCOUNT_SELECTION_COUNT)
      .map((candidate) => candidate.number)
    : [];
  const hasSelection =
    targetNumbers.length === FOLLOWER_WARM_ACCOUNT_SELECTION_COUNT;
  const stakePerNumber = hasSelection ? account.nextStakePerNumber : null;
  const totalStake = hasSelection
    ? FOLLOWER_WARM_ACCOUNT_SELECTION_COUNT * account.nextStakePerNumber
    : null;
  if (account.status === "exhausted") {
    return {
      action: "wait",
      reason: "bankroll_exhausted",
      targetNumbers,
      selectionCount: targetNumbers.length,
      stakePerNumber,
      totalStake,
      anchorResultId: currentSignal.anchorResultId,
    };
  }
  if (!hasSelection) {
    return {
      action: "wait",
      reason: currentSignal.status,
      targetNumbers: [],
      selectionCount: 0,
      stakePerNumber: null,
      totalStake: null,
      anchorResultId: currentSignal.anchorResultId,
    };
  }
  return {
    action: "would_bet",
    reason: "eligible",
    targetNumbers,
    selectionCount: targetNumbers.length,
    stakePerNumber,
    totalStake,
    anchorResultId: currentSignal.anchorResultId,
  };
}

function followerWarmHistoricalAccountForApi(account, currentSignal) {
  const nextRoundCost =
    FOLLOWER_WARM_ACCOUNT_SELECTION_COUNT * account.nextStakePerNumber;
  const canAffordNextRound =
    account.status !== "exhausted"
    && account.currentBalance >= nextRoundCost;
  return {
    schemaVersion: 1,
    algorithmVersion: FOLLOWER_WARM_ACCOUNT_ALGORITHM_VERSION,
    mode: "saved-sequence-retrospective",
    executionEnabled: false,
    strategy: {
      selectionMode: "dynamic-top5",
      selectionCount: FOLLOWER_WARM_ACCOUNT_SELECTION_COUNT,
      threshold: null,
      minimumObservedFollowerCount: FOLLOWER_TOP5_MINIMUM_OBSERVED,
      eligibleAnchorPolicy: "every-known-next",
      gapPolicy: "reset-ladder-keep-balance",
      exhaustionPolicy: "permanent-stop",
    },
    model: {
      modelVersion: FOLLOWER_WARM_ACCOUNT_MODEL_VERSION,
      initialStakePerNumber: VIRTUAL_BET_MODEL.initialStake,
      stakeStepPerNumber: VIRTUAL_BET_MODEL.stakeStep,
      maxStakePerNumber: VIRTUAL_BET_MODEL.maxStake,
      numbersPerRound: FOLLOWER_WARM_ACCOUNT_SELECTION_COUNT,
      grossPayoutMultiplier: VIRTUAL_BET_MODEL.grossPayoutMultiplier,
      netHitMultiplier: FOLLOWER_WARM_ACCOUNT_NET_HIT_MULTIPLIER,
      payoutIncludesStake: VIRTUAL_BET_MODEL.payoutIncludesStake,
    },
    status: account.status,
    initialBalance: FOLLOWER_WARM_ACCOUNT_STARTING_BALANCE,
    finalBalance: account.currentBalance,
    netResult:
      account.currentBalance - FOLLOWER_WARM_ACCOUNT_STARTING_BALANCE,
    nextStakePerNumber: account.nextStakePerNumber,
    nextRoundCost,
    canAffordNextRound,
    shortfall: Math.max(0, nextRoundCost - account.currentBalance),
    eligibleAnchorCount: account.eligibleAnchorCount,
    betCount: account.betCount,
    hitCount: account.hitCount,
    missCount: account.missCount,
    hitRate:
      account.betCount > 0 ? account.hitCount / account.betCount : null,
    totalStaked: account.totalStaked,
    totalGrossPayout: account.totalGrossPayout,
    skippedAfterExhaustionCount: account.skippedAfterExhaustionCount,
    peakBalance: account.peakBalance,
    minimumBalance: account.minimumBalance,
    maximumDrawdown: account.maximumDrawdown,
    maxStakePerNumber: account.maxStakePerNumber,
    maxRoundCost: account.maxRoundCost,
    continuityGapCount: account.continuityGapCount,
    dataComplete: account.continuityGapCount === 0,
    firstBetAt: account.firstBetAt,
    lastBetAt: account.lastBetAt,
    exhaustedAt: account.exhaustedAt,
    ladder: {
      missCount: account.ladderMissCount,
      totalLoss: account.ladderTotalLoss,
    },
    latestOutcome: account.latestOutcome,
    currentAction: followerWarmCurrentAction(account, currentSignal),
  };
}

function currentFollowerWarmSignal(
  rows,
  counts,
  lastOccurredAt,
  observedFollowerCounts,
  currentContinuityEpoch,
) {
  const anchor = rows.at(-1);
  if (!anchor) {
    return {
      status: "empty",
      sourceNumber: null,
      anchorResultId: null,
      anchoredAt: null,
      sampleSize: 0,
      observedFollowerCount: 0,
      candidates: [],
      picks: [],
    };
  }

  const sourceNumber = Number(anchor.result_number);
  const sampleSize = followerSampleSize(counts[sourceNumber]);
  const observedFollowerCount = observedFollowerCounts[sourceNumber];
  const base = {
    sourceNumber,
    anchorResultId: Number(anchor.id),
    anchoredAt: anchor.settled_at,
    sampleSize,
    observedFollowerCount,
  };
  if (
    currentContinuityEpoch !== null
    && Number(anchor.continuity_epoch) !== currentContinuityEpoch
  ) {
    return {
      status: "gap",
      ...base,
      candidates: [],
      picks: [],
    };
  }
  if (observedFollowerCount < FOLLOWER_TOP5_MINIMUM_OBSERVED) {
    return {
      status: "waiting_training",
      ...base,
      candidates: [],
      picks: [],
    };
  }

  const candidates = followerRankedCandidates(
    counts[sourceNumber],
    lastOccurredAt[sourceNumber],
  );
  const picks = candidates.filter((candidate) =>
    meetsFollowerWarmThreshold(candidate.occurrenceCount, sampleSize),
  );
  return {
    status: picks.length > 0 ? "ready" : "no_signal",
    ...base,
    candidates,
    picks,
  };
}

/**
 * Retrospective expanding walk-forward over the saved event sequence.
 * The incoming transition is known at an anchor; its outgoing transition is not.
 * The legacy horizon curve uses one complete-20-round cohort. The warm signal
 * has its own next-round cohort because it never evaluates later horizons. Its
 * historical account bets the raw frozen Top-5 at every eligible anchor, while
 * the surrounding warm metrics keep applying the individual-share threshold.
 */
export function buildFollowerTop5HitCurve(
  rows,
  { currentContinuityEpoch = null } = {},
) {
  const maximumHorizon = FOLLOWER_TOP5_HORIZONS.at(-1);
  const counts = ROULETTE_NUMBERS.map(() =>
    ROULETTE_NUMBERS.map(() => 0),
  );
  const lastOccurredAt = ROULETTE_NUMBERS.map(() =>
    ROULETTE_NUMBERS.map(() => null),
  );
  const observedFollowerCounts = ROULETTE_NUMBERS.map(() => 0);
  const overall = emptyFollowerHitBucket();
  const bySourceBuckets = ROULETTE_NUMBERS.map(() => emptyFollowerHitBucket());
  const warmNextRound = {
    eligibleCount: 0,
    signalCount: 0,
    hitCount: 0,
    selectionCount: 0,
    excludedMissingNextRoundCount: 0,
  };
  const warmHistoricalAccount = createFollowerWarmHistoricalAccount();
  let continuitySegmentCount = 0;
  let excludedInsufficientTrainingCount = 0;
  let excludedIncompleteWindowCount = 0;

  rows.forEach((row, index) => {
    const number = Number(row.result_number);
    const epoch = Number(row.continuity_epoch);
    const previous = rows[index - 1];

    if (!previous || Number(previous.continuity_epoch) !== epoch) {
      continuitySegmentCount += 1;
      if (previous) {
        resetFollowerWarmLadderAtGap(warmHistoricalAccount);
      }
    } else {
      const previousNumber = Number(previous.result_number);
      if (counts[previousNumber][number] === 0) {
        observedFollowerCounts[previousNumber] += 1;
      }
      counts[previousNumber][number] += 1;
      lastOccurredAt[previousNumber][number] = row.settled_at;
    }

    if (observedFollowerCounts[number] < FOLLOWER_TOP5_MINIMUM_OBSERVED) {
      excludedInsufficientTrainingCount += 1;
      return;
    }

    const rankedTop5 = rankFollowerNumbers(
      counts[number],
      lastOccurredAt[number],
    );
    const sampleSize = followerSampleSize(counts[number]);
    const warmNumbers = rankedTop5.filter((candidate) =>
      meetsFollowerWarmThreshold(counts[number][candidate], sampleSize),
    );
    const next = rows[index + 1];
    if (next && Number(next.continuity_epoch) === epoch) {
      warmNextRound.eligibleCount += 1;
      settleFollowerWarmHistoricalAnchor(warmHistoricalAccount, {
        anchor: row,
        next,
        sourceNumber: number,
        targetNumbers: rankedTop5,
      });
      if (warmNumbers.length > 0) {
        warmNextRound.signalCount += 1;
        warmNextRound.selectionCount += warmNumbers.length;
        if (warmNumbers.includes(Number(next.result_number))) {
          warmNextRound.hitCount += 1;
        }
      }
    } else {
      warmNextRound.excludedMissingNextRoundCount += 1;
    }

    let hasCompleteWindow = index + maximumHorizon < rows.length;
    if (hasCompleteWindow) {
      for (let offset = 1; offset <= maximumHorizon; offset += 1) {
        if (Number(rows[index + offset].continuity_epoch) !== epoch) {
          hasCompleteWindow = false;
          break;
        }
      }
    }
    if (!hasCompleteWindow) {
      excludedIncompleteWindowCount += 1;
      return;
    }

    const top5 = new Set(rankedTop5);
    let firstHitOffset = null;
    for (let offset = 1; offset <= maximumHorizon; offset += 1) {
      if (top5.has(Number(rows[index + offset].result_number))) {
        firstHitOffset = offset;
        break;
      }
    }

    overall.eligibleCount += 1;
    bySourceBuckets[number].eligibleCount += 1;
    FOLLOWER_TOP5_ALL_HORIZONS.forEach((horizon, horizonIndex) => {
      if (firstHitOffset !== null && firstHitOffset <= horizon) {
        overall.hitCounts[horizonIndex] += 1;
        bySourceBuckets[number].hitCounts[horizonIndex] += 1;
      }
    });
  });

  const warmMissCount = warmNextRound.signalCount - warmNextRound.hitCount;
  const warmNoSignalCount =
    warmNextRound.eligibleCount - warmNextRound.signalCount;
  const warmHitRate = warmNextRound.signalCount > 0
    ? warmNextRound.hitCount / warmNextRound.signalCount
    : null;
  const warmTicketHitRate = warmNextRound.selectionCount > 0
    ? warmNextRound.hitCount / warmNextRound.selectionCount
    : null;
  const warmCoverage = warmNextRound.eligibleCount > 0
    ? warmNextRound.signalCount / warmNextRound.eligibleCount
    : null;
  const warmAverageSelectionCount = warmNextRound.signalCount > 0
    ? warmNextRound.selectionCount / warmNextRound.signalCount
    : null;
  const currentWarmSignal = currentFollowerWarmSignal(
    rows,
    counts,
    lastOccurredAt,
    observedFollowerCounts,
    currentContinuityEpoch,
  );
  if (currentWarmSignal.status === "gap") {
    resetFollowerWarmLadderAtGap(warmHistoricalAccount);
  }

  return {
    schemaVersion: 1,
    algorithmVersion: "follower-top5-walk-forward-v1",
    topCount: FOLLOWER_TOP5_COUNT,
    minimumObservedFollowerCount: FOLLOWER_TOP5_MINIMUM_OBSERVED,
    evaluationMode: "saved-sequence-retrospective",
    horizons: [...FOLLOWER_TOP5_HORIZONS],
    maximumHorizonRounds: maximumHorizon,
    cohort: "anchors-with-complete-20-round-window",
    historyResultCount: rows.length,
    continuitySegmentCount,
    excludedInsufficientTrainingCount,
    excludedIncompleteWindowCount,
    overall: {
      eligibleCount: overall.eligibleCount,
      points: followerHitPoints(overall),
      allPoints: followerHitPoints(overall, FOLLOWER_TOP5_ALL_HORIZONS),
    },
    bySource: bySourceBuckets.map((bucket, sourceNumber) => ({
      sourceNumber,
      eligibleCount: bucket.eligibleCount,
      points: followerHitPoints(bucket),
    })),
    warmNextRound: {
      schemaVersion: 1,
      algorithmVersion: FOLLOWER_WARM_ALGORITHM_VERSION,
      threshold: FOLLOWER_WARM_THRESHOLD_PERCENT / 100,
      comparison: "individual-share-gte",
      candidatePool: "dynamic-top5",
      topCount: FOLLOWER_TOP5_COUNT,
      minimumObservedFollowerCount: FOLLOWER_TOP5_MINIMUM_OBSERVED,
      evaluationMode: "saved-sequence-retrospective",
      cohort: "anchors-with-known-next-round",
      eligibleCount: warmNextRound.eligibleCount,
      signalCount: warmNextRound.signalCount,
      noSignalCount: warmNoSignalCount,
      hitCount: warmNextRound.hitCount,
      missCount: warmMissCount,
      selectionCount: warmNextRound.selectionCount,
      hitRate: warmHitRate,
      ticketHitRate: warmTicketHitRate,
      coverage: warmCoverage,
      averageSelectionCount: warmAverageSelectionCount,
      randomBaselineRate:
        warmAverageSelectionCount === null
          ? null
          : warmAverageSelectionCount / ROULETTE_NUMBERS.length,
      excludedMissingNextRoundCount:
        warmNextRound.excludedMissingNextRoundCount,
      currentSignal: currentWarmSignal,
      historicalAccount: followerWarmHistoricalAccountForApi(
        warmHistoricalAccount,
        currentWarmSignal,
      ),
    },
  };
}

function followerTop5GateQualifies(evidence) {
  return evidence !== null
    && evidence.eligibleCount >= 1
    && evidence.hitCount * 100
      >= evidence.eligibleCount * FOLLOWER_TOP5_GATE_THRESHOLD_PERCENT;
}

function storedFollowerTop5Numbers(session) {
  const value = Array.isArray(session?.top_numbers_json)
    ? session.top_numbers_json
    : deserializeJson(session?.top_numbers_json);
  if (
    !Array.isArray(value)
    || value.length !== FOLLOWER_TOP5_COUNT
    || new Set(value.map(Number)).size !== FOLLOWER_TOP5_COUNT
    || value.some((number) => !ROULETTE_NUMBERS.includes(Number(number)))
  ) {
    throw new Error("stored follower top-5 session is invalid");
  }
  return value.map(Number);
}

function followerTop5GateEvidenceByDecision(
  rows,
  decisions,
) {
  const decisionsByBoundary = new Map();
  for (const decision of decisions) {
    if (decision.attemptNumber > FOLLOWER_TOP5_GATE_MAXIMUM_ATTEMPT) continue;
    const group = decisionsByBoundary.get(decision.boundaryResultId) ?? [];
    group.push(decision);
    decisionsByBoundary.set(decision.boundaryResultId, group);
  }

  const evidenceByKey = new Map();
  const counts = ROULETTE_NUMBERS.map(() =>
    ROULETTE_NUMBERS.map(() => 0),
  );
  const lastOccurredAt = ROULETTE_NUMBERS.map(() =>
    ROULETTE_NUMBERS.map(() => null),
  );
  const observedFollowerCounts = ROULETTE_NUMBERS.map(() => 0);
  const anchorSnapshots = Array(rows.length).fill(null);
  const bucket = emptyFollowerHitBucket();

  rows.forEach((row, index) => {
    const number = Number(row.result_number);
    const epoch = Number(row.continuity_epoch);
    const previous = rows[index - 1];
    if (previous && Number(previous.continuity_epoch) === epoch) {
      const previousNumber = Number(previous.result_number);
      if (counts[previousNumber][number] === 0) {
        observedFollowerCounts[previousNumber] += 1;
      }
      counts[previousNumber][number] += 1;
      lastOccurredAt[previousNumber][number] = row.settled_at;
    }

    if (observedFollowerCounts[number] >= FOLLOWER_TOP5_MINIMUM_OBSERVED) {
      anchorSnapshots[index] = {
        epoch,
        topNumbers: rankFollowerNumbers(
          counts[number],
          lastOccurredAt[number],
        ),
      };
    }

    const matureIndex = index - FOLLOWER_TOP5_GATE_MAXIMUM_ATTEMPT;
    const matureAnchor = matureIndex >= 0
      ? anchorSnapshots[matureIndex]
      : null;
    if (matureAnchor) {
      let complete = true;
      let firstHitOffset = null;
      const topNumbers = new Set(matureAnchor.topNumbers);
      for (
        let offset = 1;
        offset <= FOLLOWER_TOP5_GATE_MAXIMUM_ATTEMPT;
        offset += 1
      ) {
        const outcome = rows[matureIndex + offset];
        if (Number(outcome.continuity_epoch) !== matureAnchor.epoch) {
          complete = false;
          break;
        }
        if (
          firstHitOffset === null
          && topNumbers.has(Number(outcome.result_number))
        ) {
          firstHitOffset = offset;
        }
      }
      if (complete) {
        bucket.eligibleCount += 1;
        FOLLOWER_TOP5_ALL_HORIZONS.forEach((horizon, horizonIndex) => {
          if (firstHitOffset !== null && firstHitOffset <= horizon) {
            bucket.hitCounts[horizonIndex] += 1;
          }
        });
      }
    }

    const boundaryDecisions = decisionsByBoundary.get(Number(row.id)) ?? [];
    for (const decision of boundaryDecisions) {
      const horizonIndex = decision.attemptNumber - 1;
      const eligibleCount = bucket.eligibleCount;
      const hitCount = bucket.hitCounts[horizonIndex];
      evidenceByKey.set(decision.key, {
        horizon: decision.attemptNumber,
        hitCount,
        eligibleCount,
        rate: eligibleCount > 0 ? hitCount / eligibleCount : null,
        historyMaxResultId: Number(row.id),
        historyThrough: row.settled_at,
      });
    }
  });

  return evidenceByKey;
}

function emptyFollowerTop5GatedCurrentAction(status) {
  return {
    action: "wait",
    reason: status === "gap" ? "gap" : "waiting_training",
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
  };
}

/**
 * Replays only the persisted, batch-aware frozen Top-5 sessions. Every gate
 * snapshot is taken at the result immediately before the evaluated attempt;
 * outcomes that were not known at that boundary cannot enter its cohort.
 */
export function buildFollowerTop5GatedAccount(
  rows,
  sessionRows,
  attemptRows,
  {
    currentContinuityEpoch = null,
    trackerStatus = "waiting_training",
    depositRows = [],
  } = {},
) {
  const orderedRows = [...rows].sort(
    (left, right) =>
      left.settled_at.localeCompare(right.settled_at)
      || Number(left.id) - Number(right.id),
  );
  const rowById = new Map(
    orderedRows.map((row, index) => [Number(row.id), { row, index }]),
  );
  const attemptsBySession = new Map();
  for (const attempt of attemptRows) {
    const sessionId = Number(attempt.session_id);
    const group = attemptsBySession.get(sessionId) ?? [];
    group.push(attempt);
    attemptsBySession.set(sessionId, group);
  }
  for (const attempts of attemptsBySession.values()) {
    attempts.sort(
      (left, right) =>
        Number(left.attempt_number) - Number(right.attempt_number),
    );
  }

  const sessions = [...sessionRows].sort((left, right) => {
    const leftIndex = rowById.get(Number(left.anchor_result_id))?.index;
    const rightIndex = rowById.get(Number(right.anchor_result_id))?.index;
    return (leftIndex ?? Number.MAX_SAFE_INTEGER)
      - (rightIndex ?? Number.MAX_SAFE_INTEGER)
      || Number(left.id) - Number(right.id);
  });
  const deposits = [...depositRows].sort(
    (left, right) =>
      Number(left.after_result_id ?? 0) - Number(right.after_result_id ?? 0)
      || Number(left.id) - Number(right.id),
  );
  const decisions = [];
  const decisionKey = (sessionId, attemptNumber) =>
    `${sessionId}:${attemptNumber}`;
  for (const session of sessions) {
    const sessionId = Number(session.id);
    const attempts = attemptsBySession.get(sessionId) ?? [];
    attempts.forEach((attempt, index) => {
      decisions.push({
        key: decisionKey(sessionId, Number(attempt.attempt_number)),
        boundaryResultId: index === 0
          ? Number(session.anchor_result_id)
          : Number(attempts[index - 1].round_result_id),
        attemptNumber: Number(attempt.attempt_number),
      });
    });
    if (session.status === "active") {
      decisions.push({
        key: `${sessionId}:current`,
        boundaryResultId: attempts.length === 0
          ? Number(session.anchor_result_id)
          : Number(attempts.at(-1).round_result_id),
        attemptNumber: attempts.length + 1,
      });
    }
  }
  const evidenceByKey = followerTop5GateEvidenceByDecision(
    orderedRows,
    decisions,
  );

  const account = {
    status: "waiting",
    currentBalance: FOLLOWER_WARM_ACCOUNT_STARTING_BALANCE,
    nextStakePerNumber: calculateSharedTop5Stake(0),
    trackedAttemptCount: 0,
    qualifiedSessionCount: 0,
    observedWithoutBetCount: 0,
    eligibleBetCount: 0,
    betCount: 0,
    hitCount: 0,
    missCount: 0,
    totalStaked: 0,
    totalGrossPayout: 0,
    skippedAfterExhaustionCount: 0,
    peakBalance: FOLLOWER_WARM_ACCOUNT_STARTING_BALANCE,
    minimumBalance: FOLLOWER_WARM_ACCOUNT_STARTING_BALANCE,
    maximumDrawdown: 0,
    maxStakePerNumber: 0,
    maxRoundCost: 0,
    firstBetAt: null,
    lastBetAt: null,
    exhaustedAt: null,
    ladderMissCount: 0,
    ladderTotalLoss: 0,
    totalDeposits: 0,
    depositCount: 0,
    latestDeposit: null,
    latestOutcome: null,
  };
  let nextDepositIndex = 0;
  const applyDeposit = (deposit) => {
    const amount = Number(deposit.amount);
    const afterResultId = deposit.after_result_id == null
      ? null
      : Number(deposit.after_result_id);
    if (
      !Number.isSafeInteger(amount)
      || amount <= 0
      || (afterResultId !== null && (
        !Number.isSafeInteger(afterResultId) || afterResultId < 1
      ))
      || typeof deposit.deposit_key !== "string"
      || deposit.deposit_key.trim() === ""
      || !Number.isFinite(Date.parse(deposit.deposited_at))
    ) {
      throw new Error("gated follower account deposit is invalid");
    }
    const balanceBefore = account.currentBalance;
    const balanceAfter = balanceBefore + amount;
    const totalDeposits = account.totalDeposits + amount;
    if (
      !Number.isSafeInteger(balanceAfter)
      || !Number.isSafeInteger(totalDeposits)
    ) {
      throw new RangeError("gated follower account deposit overflows balance");
    }
    account.currentBalance = balanceAfter;
    account.totalDeposits = totalDeposits;
    account.depositCount += 1;
    account.latestDeposit = {
      depositKey: deposit.deposit_key,
      amount,
      afterResultId,
      balanceBefore,
      balanceAfter,
      depositedAt: deposit.deposited_at,
    };
    account.peakBalance = Math.max(account.peakBalance, balanceAfter);
    if (
      account.status === "exhausted"
      && balanceAfter
        >= FOLLOWER_TOP5_COUNT * account.nextStakePerNumber
    ) {
      account.status = account.betCount > 0 ? "running" : "waiting";
      account.exhaustedAt = null;
    }
  };
  const applyDepositsBeforeEvent = (
    resultId,
    occurredAt,
    { boundaryInclusive = false } = {},
  ) => {
    const occurredAtMs = Date.parse(occurredAt);
    if (!Number.isFinite(occurredAtMs)) {
      throw new Error("gated follower account attempt timestamp is invalid");
    }
    while (nextDepositIndex < deposits.length) {
      const deposit = deposits[nextDepositIndex];
      const afterResultId = deposit.after_result_id == null
        ? null
        : Number(deposit.after_result_id);
      const followsBoundary = afterResultId === null
        || (boundaryInclusive
          ? resultId >= afterResultId
          : resultId > afterResultId);
      const followsDepositTime = occurredAtMs > Date.parse(deposit.deposited_at);
      if (!followsBoundary || !followsDepositTime) break;
      applyDeposit(deposit);
      nextDepositIndex += 1;
    }
  };
  const resetLadder = () => {
    if (account.status === "exhausted") return;
    account.ladderMissCount = 0;
    account.ladderTotalLoss = 0;
    account.nextStakePerNumber = calculateSharedTop5Stake(0);
  };
  const sessionStates = new Map();
  let previousSessionEpoch = null;

  for (const session of sessions) {
    const sessionId = Number(session.id);
    const sessionEpoch = Number(session.continuity_epoch);
    const sessionAnchor = rowById.get(Number(session.anchor_result_id))?.row;
    if (sessionAnchor) {
      applyDepositsBeforeEvent(
        Number(sessionAnchor.id),
        sessionAnchor.settled_at,
      );
    }
    if (
      previousSessionEpoch !== null
      && sessionEpoch !== previousSessionEpoch
    ) {
      resetLadder();
    }
    previousSessionEpoch = sessionEpoch;

    const targetNumbers = storedFollowerTop5Numbers(session);
    const attempts = attemptsBySession.get(sessionId) ?? [];
    let bettingStarted = false;
    let startAttempt = null;
    let startEvidence = null;

    attempts.forEach((attempt, index) => {
      const attemptNumber = Number(attempt.attempt_number);
      applyDepositsBeforeEvent(
        Number(attempt.round_result_id),
        attempt.occurred_at,
      );
      const evidence = evidenceByKey.get(
        decisionKey(sessionId, attemptNumber),
      ) ?? null;
      account.trackedAttemptCount += 1;

      if (!bettingStarted && followerTop5GateQualifies(evidence)) {
        bettingStarted = true;
        startAttempt = attemptNumber;
        startEvidence = evidence;
        account.qualifiedSessionCount += 1;
      }
      if (!bettingStarted) {
        account.observedWithoutBetCount += 1;
        return;
      }

      account.eligibleBetCount += 1;
      if (account.status === "exhausted") {
        account.skippedAfterExhaustionCount += 1;
        return;
      }

      const boundaryResultId = index === 0
        ? Number(session.anchor_result_id)
        : Number(attempts[index - 1].round_result_id);
      const boundary = rowById.get(boundaryResultId)?.row ?? null;
      const stakePerNumber = calculateSharedTop5Stake(
        account.ladderTotalLoss,
      );
      const totalStake = FOLLOWER_TOP5_COUNT * stakePerNumber;
      account.nextStakePerNumber = stakePerNumber;
      if (totalStake > account.currentBalance) {
        account.status = "exhausted";
        account.exhaustedAt = boundary?.settled_at ?? attempt.occurred_at;
        account.skippedAfterExhaustionCount += 1;
        return;
      }

      const resultNumber = Number(attempt.result_number);
      const hitIndex = targetNumbers.indexOf(resultNumber);
      const outcome = hitIndex >= 0 ? "hit" : "miss";
      const grossPayout = outcome === "hit"
        ? stakePerNumber * VIRTUAL_BET_MODEL.grossPayoutMultiplier
        : 0;
      const balanceAfter =
        account.currentBalance - totalStake + grossPayout;
      if (!Number.isSafeInteger(balanceAfter) || balanceAfter < 0) {
        throw new RangeError("gated follower account balance is invalid");
      }

      account.status = "running";
      account.currentBalance = balanceAfter;
      account.betCount += 1;
      account.totalStaked += totalStake;
      account.totalGrossPayout += grossPayout;
      account.maxStakePerNumber = Math.max(
        account.maxStakePerNumber,
        stakePerNumber,
      );
      account.maxRoundCost = Math.max(account.maxRoundCost, totalStake);
      account.firstBetAt ??= attempt.occurred_at;
      account.lastBetAt = attempt.occurred_at;
      account.peakBalance = Math.max(account.peakBalance, balanceAfter);
      account.minimumBalance = Math.min(
        account.minimumBalance,
        balanceAfter,
      );
      account.maximumDrawdown = Math.max(
        account.maximumDrawdown,
        account.peakBalance - balanceAfter,
      );

      if (outcome === "hit") {
        account.hitCount += 1;
        account.ladderMissCount = 0;
        account.ladderTotalLoss = 0;
        account.nextStakePerNumber = calculateSharedTop5Stake(0);
      } else {
        account.missCount += 1;
        account.ladderMissCount += 1;
        account.ladderTotalLoss += totalStake;
        account.nextStakePerNumber = calculateSharedTop5Stake(
          account.ladderTotalLoss,
        );
        if (
          FOLLOWER_TOP5_COUNT * account.nextStakePerNumber
          > balanceAfter
        ) {
          account.status = "exhausted";
          account.exhaustedAt = attempt.occurred_at;
        }
      }

      account.latestOutcome = {
        attemptId: Number(attempt.id),
        sessionId,
        attemptNumber,
        resultId: Number(attempt.round_result_id),
        targetNumbers: [...targetNumbers],
        selectionCount: targetNumbers.length,
        resultNumber,
        hitRank: hitIndex >= 0 ? hitIndex + 1 : null,
        stakePerNumber,
        totalStake,
        outcome,
        grossPayout,
        balanceAfter,
        nextStakePerNumber: account.nextStakePerNumber,
        nextRoundCost: FOLLOWER_TOP5_COUNT * account.nextStakePerNumber,
        gateEvidence: { ...startEvidence },
        occurredAt: attempt.occurred_at,
      };
    });

    sessionStates.set(sessionId, {
      bettingStarted,
      startAttempt,
      startEvidence,
    });
    if (session.status === "invalid_gap") {
      const boundaryResultId = attempts.length === 0
        ? Number(session.anchor_result_id)
        : Number(attempts.at(-1).round_result_id);
      applyDepositsBeforeEvent(
        boundaryResultId,
        session.completed_at ?? session.last_event_at,
        { boundaryInclusive: true },
      );
      resetLadder();
    }
  }

  while (nextDepositIndex < deposits.length) {
    applyDeposit(deposits[nextDepositIndex]);
    nextDepositIndex += 1;
  }

  const firstSession = sessions[0] ?? null;
  const lastSession = sessions.at(-1) ?? null;
  const firstAnchor = firstSession
    ? rowById.get(Number(firstSession.anchor_result_id)) ?? null
    : null;
  let continuityGapCount = 0;
  if (firstAnchor) {
    let previousEpoch = Number(firstAnchor.row.continuity_epoch);
    for (let index = firstAnchor.index + 1; index < orderedRows.length; index += 1) {
      const epoch = Number(orderedRows[index].continuity_epoch);
      if (epoch !== previousEpoch) continuityGapCount += 1;
      previousEpoch = epoch;
    }
    if (
      currentContinuityEpoch !== null
      && orderedRows.length > 0
      && Number(orderedRows.at(-1).continuity_epoch)
        !== Number(currentContinuityEpoch)
    ) {
      continuityGapCount += 1;
      resetLadder();
    }
  }

  const activeSession = sessions.find((session) => session.status === "active")
    ?? null;
  let currentAction = emptyFollowerTop5GatedCurrentAction(trackerStatus);
  if (activeSession) {
    const sessionId = Number(activeSession.id);
    const attempts = attemptsBySession.get(sessionId) ?? [];
    const attemptNumber = attempts.length + 1;
    const boundaryResultId = attempts.length === 0
      ? Number(activeSession.anchor_result_id)
      : Number(attempts.at(-1).round_result_id);
    const boundary = rowById.get(boundaryResultId)?.row ?? null;
    const evidence = evidenceByKey.get(`${sessionId}:current`) ?? null;
    const storedState = sessionStates.get(sessionId) ?? {
      bettingStarted: false,
      startAttempt: null,
      startEvidence: null,
    };
    const crossesNow =
      !storedState.bettingStarted && followerTop5GateQualifies(evidence);
    const bettingStarted = storedState.bettingStarted || crossesNow;
    const startAttempt = crossesNow
      ? attemptNumber
      : storedState.startAttempt;
    const startEvidence = crossesNow
      ? evidence
      : storedState.startEvidence;
    const targetNumbers = storedFollowerTop5Numbers(activeSession);
    const stakePerNumber = bettingStarted
      ? account.nextStakePerNumber
      : null;
    const totalStake = bettingStarted
      ? FOLLOWER_TOP5_COUNT * account.nextStakePerNumber
      : null;
    let action;
    let reason;
    if (account.status === "exhausted") {
      action = "wait";
      reason = "bankroll_exhausted";
    } else if (bettingStarted) {
      action = "would_bet";
      reason = crossesNow ? "threshold_reached" : "betting_started";
    } else {
      action = "observe";
      if (attemptNumber > FOLLOWER_TOP5_GATE_MAXIMUM_ATTEMPT) {
        reason = "threshold_not_reached";
      } else if (!evidence || evidence.eligibleCount === 0) {
        reason = "insufficient_history";
      } else {
        reason = "below_threshold";
      }
    }
    currentAction = {
      action,
      reason,
      sessionId,
      attemptNumber,
      targetNumbers,
      selectionCount: targetNumbers.length,
      bettingStarted,
      startAttempt,
      startEvidence,
      cumulativeRate: evidence?.rate ?? null,
      hitCount: evidence?.hitCount ?? null,
      eligibleCount: evidence?.eligibleCount ?? null,
      historyMaxResultId: evidence?.historyMaxResultId ?? boundaryResultId,
      historyThrough: evidence?.historyThrough ?? boundary?.settled_at ?? null,
      stakePerNumber,
      totalStake,
      anchorResultId: Number(activeSession.anchor_result_id),
    };
  }

  const nextRoundCost = FOLLOWER_TOP5_COUNT * account.nextStakePerNumber;
  const completedSessionCount = sessions.filter(
    (session) => session.status === "completed",
  ).length;
  const invalidatedSessionCount = sessions.filter(
    (session) => session.status === "invalid_gap",
  ).length;
  return {
    schemaVersion: 1,
    algorithmVersion: FOLLOWER_TOP5_GATE_ACCOUNT_ALGORITHM_VERSION,
    mode: "persisted-session-retrospective",
    executionEnabled: false,
    strategy: {
      selectionMode: "frozen-top5",
      selectionCount: FOLLOWER_TOP5_COUNT,
      thresholdMetric: "cumulative-hit-by-attempt",
      threshold: FOLLOWER_TOP5_GATE_THRESHOLD_PERCENT / 100,
      comparison: "gte",
      cohort: "anchors-with-complete-20-round-window",
      maximumCalibratedAttempt: FOLLOWER_TOP5_GATE_MAXIMUM_ATTEMPT,
      evaluationTiming: "pre-attempt-walk-forward",
      startPolicy: "latch-for-session",
      noCrossingPolicy: "observe-only",
      minimumEligibleCount: 1,
    },
    model: {
      modelVersion: FOLLOWER_WARM_ACCOUNT_MODEL_VERSION,
      initialStakePerNumber: VIRTUAL_BET_MODEL.initialStake,
      stakeStepPerNumber: VIRTUAL_BET_MODEL.stakeStep,
      maxStakePerNumber: VIRTUAL_BET_MODEL.maxStake,
      numbersPerRound: FOLLOWER_TOP5_COUNT,
      grossPayoutMultiplier: VIRTUAL_BET_MODEL.grossPayoutMultiplier,
      netHitMultiplier: FOLLOWER_WARM_ACCOUNT_NET_HIT_MULTIPLIER,
      payoutIncludesStake: VIRTUAL_BET_MODEL.payoutIncludesStake,
    },
    status: account.status,
    initialBalance: FOLLOWER_WARM_ACCOUNT_STARTING_BALANCE,
    totalDeposits: account.totalDeposits,
    contributedBalance:
      FOLLOWER_WARM_ACCOUNT_STARTING_BALANCE + account.totalDeposits,
    depositCount: account.depositCount,
    latestDeposit: account.latestDeposit,
    finalBalance: account.currentBalance,
    netResult:
      account.currentBalance
      - FOLLOWER_WARM_ACCOUNT_STARTING_BALANCE
      - account.totalDeposits,
    nextStakePerNumber: account.nextStakePerNumber,
    nextRoundCost,
    canAffordNextRound:
      account.status !== "exhausted"
      && account.currentBalance >= nextRoundCost,
    shortfall: Math.max(0, nextRoundCost - account.currentBalance),
    trackedSessionCount: sessions.length,
    trackedAttemptCount: account.trackedAttemptCount,
    qualifiedSessionCount: account.qualifiedSessionCount,
    observedWithoutBetCount: account.observedWithoutBetCount,
    eligibleBetCount: account.eligibleBetCount,
    betCount: account.betCount,
    hitCount: account.hitCount,
    missCount: account.missCount,
    hitRate:
      account.betCount > 0 ? account.hitCount / account.betCount : null,
    totalStaked: account.totalStaked,
    totalGrossPayout: account.totalGrossPayout,
    skippedAfterExhaustionCount: account.skippedAfterExhaustionCount,
    peakBalance: account.peakBalance,
    minimumBalance: account.minimumBalance,
    maximumDrawdown: account.maximumDrawdown,
    maxStakePerNumber: account.maxStakePerNumber,
    maxRoundCost: account.maxRoundCost,
    continuityGapCount,
    dataComplete: continuityGapCount === 0,
    firstBetAt: account.firstBetAt,
    lastBetAt: account.lastBetAt,
    exhaustedAt: account.exhaustedAt,
    coverage: {
      scope: "persisted-follower-top5-sessions-only",
      firstSessionId: firstSession ? Number(firstSession.id) : null,
      firstAnchorResultId: firstSession
        ? Number(firstSession.anchor_result_id)
        : null,
      firstTrackedAt: firstAnchor?.row.settled_at ?? null,
      lastSessionId: lastSession ? Number(lastSession.id) : null,
      completedSessionCount,
      invalidatedSessionCount,
    },
    ladder: {
      missCount: account.ladderMissCount,
      totalLoss: account.ladderTotalLoss,
    },
    latestOutcome: account.latestOutcome,
    currentAction,
  };
}

function asNonEmptyText(value, fallback, label) {
  const candidate = value ?? fallback;
  if (typeof candidate !== "string" || candidate.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return candidate.trim();
}

function asTimestamp(value, fallback, label) {
  const candidate = value ?? fallback;
  const date = candidate instanceof Date ? candidate : new Date(candidate);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`${label} must be a valid date`);
  }
  return date.toISOString();
}

function asPrice(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const price = Number(value);
  if (!Number.isFinite(price)) {
    throw new TypeError("price must be a finite number");
  }
  return price;
}

function rawCellFromPayload(rawPayload) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return null;
  }
  const candidate = rawPayload.rr?.c ?? rawPayload.c;
  if (candidate === null || candidate === undefined || candidate === "") {
    return null;
  }
  const rawCell = Number(candidate);
  return Number.isInteger(rawCell) && rawCell >= 0 && rawCell <= 37
    ? rawCell
    : null;
}

function serializeJson(value, label) {
  if (value === undefined) {
    return null;
  }

  try {
    return JSON.stringify(value);
  } catch (error) {
    throw new TypeError(`${label} must be JSON-serializable`, {
      cause: error,
    });
  }
}

function deserializeJson(value) {
  if (value === null || value === undefined) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function asStrictFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function normalizeTrajectoryBands(value, label = "round.cellBands") {
  if (!Array.isArray(value) || value.length !== 38) {
    throw new TypeError(`${label} must contain all 38 wire bands`);
  }
  const seen = new Set();
  return value
    .map((band, index) => {
      if (!band || typeof band !== "object" || Array.isArray(band)) {
        throw new TypeError(`${label}[${index}] must be an object`);
      }
      const wireCell = band.wireCell;
      const number = band.number;
      const lower = asStrictFiniteNumber(
        band.lower,
        `${label}[${index}].lower`,
      );
      const upper = asStrictFiniteNumber(
        band.upper,
        `${label}[${index}].upper`,
      );
      if (
        !Number.isInteger(wireCell) ||
        wireCell < 0 ||
        wireCell > 37 ||
        seen.has(wireCell)
      ) {
        throw new TypeError(`${label}[${index}].wireCell is invalid`);
      }
      const expectedNumber = wireCell === 37 ? 0 : wireCell;
      if (number !== expectedNumber) {
        throw new TypeError(`${label}[${index}].number is not canonical`);
      }
      if (!(upper > lower)) {
        throw new RangeError(`${label}[${index}] must have upper above lower`);
      }
      seen.add(wireCell);
      return { wireCell, number, lower, upper };
    })
    .sort((left, right) => left.wireCell - right.wireCell);
}

function normalizeRoundTrajectoryEvent(event, persistedAt) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new TypeError("round trajectory event must be an object");
  }
  if (event.schemaVersion !== ROUND_TRAJECTORY_SCHEMA_VERSION) {
    throw new RangeError(
      `round trajectory schemaVersion must be ${ROUND_TRAJECTORY_SCHEMA_VERSION}`,
    );
  }
  if (!event.round || typeof event.round !== "object" || Array.isArray(event.round)) {
    throw new TypeError("round trajectory round must be an object");
  }
  if (event.round.status !== 2) {
    throw new RangeError("round trajectory must describe an open status=2 round");
  }

  const source = asNonEmptyText(event.source, "buleto", "source");
  const instrument = asNonEmptyText(
    event.instrument,
    "default",
    "instrument",
  );
  const externalRoundId = asNonEmptyText(
    String(event.round.externalRoundId ?? ""),
    undefined,
    "round.externalRoundId",
  );
  const receivedAt = asTimestamp(event.receivedAt, undefined, "receivedAt");
  const startsAt = asTimestamp(event.round.startsAt, undefined, "round.startsAt");
  const bettingClosesAt = asTimestamp(
    event.round.bettingClosesAt,
    undefined,
    "round.bettingClosesAt",
  );
  const bettingStopsAt = asTimestamp(
    event.round.bettingStopsAt,
    undefined,
    "round.bettingStopsAt",
  );
  const roundEndsAt = asTimestamp(event.round.endsAt, undefined, "round.endsAt");
  const startsMs = Date.parse(startsAt);
  const closesMs = Date.parse(bettingClosesAt);
  const stopsMs = Date.parse(bettingStopsAt);
  const endsMs = Date.parse(roundEndsAt);
  const receivedMs = Date.parse(receivedAt);
  const persistedMs = Date.parse(persistedAt);
  if (!(startsMs < closesMs && closesMs <= stopsMs && stopsMs < endsMs)) {
    throw new RangeError("round trajectory timestamps are not ordered");
  }
  if (receivedMs < startsMs || receivedMs > endsMs) {
    throw new RangeError("round trajectory receivedAt must be inside the round");
  }
  if (receivedMs > persistedMs) {
    throw new RangeError("round trajectory receivedAt cannot be in the future");
  }

  const startPrice = asStrictFiniteNumber(
    event.round.startPrice,
    "round.startPrice",
  );
  const bottomPrice = asStrictFiniteNumber(
    event.round.bottomPrice,
    "round.bottomPrice",
  );
  const topPrice = asStrictFiniteNumber(
    event.round.topPrice,
    "round.topPrice",
  );
  if (!(bottomPrice < topPrice) || startPrice < bottomPrice || startPrice > topPrice) {
    throw new RangeError("round trajectory prices are inconsistent");
  }
  const bands = normalizeTrajectoryBands(event.round.cellBands);
  if (!Array.isArray(event.factors)) {
    throw new TypeError("round trajectory factors must be an array");
  }
  const factors = event.factors.map((factor, index) => {
    if (!factor || typeof factor !== "object" || Array.isArray(factor)) {
      throw new TypeError(`factors[${index}] must be an object`);
    }
    const at = asTimestamp(factor.at, undefined, `factors[${index}].at`);
    const factorReceivedAt = asTimestamp(
      factor.receivedAt,
      undefined,
      `factors[${index}].receivedAt`,
    );
    const atMs = Date.parse(at);
    const factorReceivedMs = Date.parse(factorReceivedAt);
    if (atMs < startsMs || atMs > endsMs) {
      throw new RangeError(`factors[${index}].at must be inside the round`);
    }
    if (factorReceivedMs < atMs || factorReceivedMs > receivedMs) {
      throw new RangeError(
        `factors[${index}] must be observed no earlier than at and no later than event receivedAt`,
      );
    }
    return {
      at,
      price: asStrictFiniteNumber(factor.price, `factors[${index}].price`),
      receivedAt: factorReceivedAt,
    };
  });

  return {
    source,
    instrument,
    externalRoundId,
    startsAt,
    bettingClosesAt,
    bettingStopsAt,
    roundEndsAt,
    startPrice,
    bottomPrice,
    topPrice,
    bands,
    bandsJson: JSON.stringify(bands),
    receivedAt,
    factors,
  };
}

function trajectoryBandsFromForecastCells(cells) {
  return cells
    .map((cell) => ({
      wireCell: cell.c,
      number: cell.c === 37 ? 0 : cell.c,
      lower: cell.vf,
      upper: cell.vt,
    }))
    .sort((left, right) => left.wireCell - right.wireCell);
}

function trajectoryMedianCellWidth(bands) {
  const widths = bands
    .map((band) => Number(band.upper) - Number(band.lower))
    .filter((width) => Number.isFinite(width) && width > 0)
    .sort((left, right) => left - right);
  if (widths.length !== bands.length || widths.length === 0) return null;
  const middle = Math.floor(widths.length / 2);
  return widths.length % 2 === 1
    ? widths[middle]
    : (widths[middle - 1] + widths[middle]) / 2;
}

function trajectoryDirection(deltaCellWidths, flatThresholdCellWidths) {
  if (deltaCellWidths > flatThresholdCellWidths) return "up";
  if (deltaCellWidths < -flatThresholdCellWidths) return "down";
  return "flat";
}

function roundTrajectoryPrefixFromRows(rows, startsAt, cutoffAt) {
  const latestByTimestamp = new Map();
  for (const row of rows) latestByTimestamp.set(row.factor_at, row);
  const prefix = [...latestByTimestamp.values()].map((row) => ({
    at: row.factor_at,
    price: Number(row.price),
  }));
  let maxGapMs = null;
  if (prefix.length > 1) {
    maxGapMs = 0;
    for (let index = 1; index < prefix.length; index += 1) {
      maxGapMs = Math.max(
        maxGapMs,
        Date.parse(prefix[index].at) - Date.parse(prefix[index - 1].at),
      );
    }
  }
  const coverage = {
    tickCount: prefix.length,
    firstAt: prefix[0]?.at ?? null,
    lastAt: prefix.at(-1)?.at ?? null,
    maxGapMs,
  };
  if (prefix.length < 3) {
    return {
      usable: false,
      reason: "fewer_than_three_distinct_timestamps",
      prefix,
      coverage,
    };
  }
  const startsMs = Date.parse(startsAt);
  const cutoffMs = Date.parse(cutoffAt);
  const firstMs = Date.parse(prefix[0].at);
  const lastMs = Date.parse(prefix.at(-1).at);
  if (!(cutoffMs > startsMs) || !(lastMs > firstMs)) {
    return {
      usable: false,
      reason: "non_positive_prefix_span",
      prefix,
      coverage,
    };
  }
  if (firstMs > startsMs + TRAJECTORY_PREFIX_EDGE_TOLERANCE_MS) {
    return {
      usable: false,
      reason: "prefix_starts_after_round_tolerance",
      prefix,
      coverage,
    };
  }
  if (lastMs < cutoffMs - TRAJECTORY_PREFIX_EDGE_TOLERANCE_MS) {
    return {
      usable: false,
      reason: "prefix_ends_before_cutoff_tolerance",
      prefix,
      coverage,
    };
  }
  if (maxGapMs > TRAJECTORY_PREFIX_EDGE_TOLERANCE_MS) {
    return {
      usable: false,
      reason: "prefix_gap_exceeds_tolerance",
      prefix,
      coverage,
    };
  }
  return {
    usable: true,
    reason: null,
    prefix,
    coverage,
    lockPrice: prefix.at(-1).price,
  };
}

function trajectoryBandPoint(band) {
  return {
    wireCell: band.wireCell,
    number: band.number,
  };
}

function buildTrajectoryNumberArea({
  bands,
  lockPrice,
  medianCellWidth,
  deltaRangeCellWidths,
  direction,
  flatThresholdCellWidths,
}) {
  if (
    !Array.isArray(bands) ||
    bands.length !== 38 ||
    !Number.isFinite(lockPrice) ||
    !Number.isFinite(medianCellWidth) ||
    medianCellWidth <= 0 ||
    !["up", "down", "flat"].includes(direction) ||
    !Number.isFinite(flatThresholdCellWidths) ||
    flatThresholdCellWidths < 0 ||
    !deltaRangeCellWidths ||
    typeof deltaRangeCellWidths !== "object" ||
    Array.isArray(deltaRangeCellWidths)
  ) {
    return null;
  }
  const {
    lowerQuantile,
    upperQuantile,
    lower,
    median,
    upper,
  } = deltaRangeCellWidths;
  if (
    !Number.isFinite(lowerQuantile) ||
    !Number.isFinite(upperQuantile) ||
    Math.abs(lowerQuantile - 0.2) > 1e-12 ||
    Math.abs(upperQuantile - 0.8) > 1e-12 ||
    !Number.isFinite(lower) ||
    !Number.isFinite(median) ||
    !Number.isFinite(upper) ||
    lower > median ||
    median > upper
  ) {
    return null;
  }
  const centers = bands.map((band) => (band.lower + band.upper) / 2);
  if (
    bands.some(
      (band, index) =>
        band.wireCell !== index ||
        band.number !== (index === 37 ? 0 : index) ||
        !Number.isFinite(band.lower) ||
        !Number.isFinite(band.upper) ||
        !(band.upper > band.lower),
    ) ||
    centers.some(
      (center, index) => index > 0 && !(centers[index - 1] > center),
    ) ||
    bands.some(
      (band, index) =>
        index > 0 &&
        !(
          bands[index - 1].upper > band.upper &&
          bands[index - 1].lower > band.lower
        ),
    ) ||
    lockPrice < bands.at(-1).lower ||
    lockPrice > bands[0].upper
  ) {
    return null;
  }

  const forecastCells = bands.map((band) => ({
    c: band.wireCell,
    vf: band.lower,
    vt: band.upper,
  }));
  const locate = (price) =>
    trajectoryBandPoint(rankPrecloseForecastCells(forecastCells, price)[0]);
  const lowerPrice = lockPrice + lower * medianCellWidth;
  const upperPrice = lockPrice + upper * medianCellWidth;
  const typicalPrice = lockPrice + median * medianCellWidth;
  const firstEndpoint = locate(lowerPrice);
  const secondEndpoint = locate(upperPrice);
  const topWireCell = Math.min(
    firstEndpoint.wireCell,
    secondEndpoint.wireCell,
  );
  const bottomWireCell = Math.max(
    firstEndpoint.wireCell,
    secondEndpoint.wireCell,
  );
  const cells = bands
    .slice(topWireCell, bottomWireCell + 1)
    .map(trajectoryBandPoint);

  return {
    version: TRAJECTORY_NUMBER_AREA_VERSION,
    basis: "weighted-neighbor-delta-q20-q50-q80",
    centralWeight: upperQuantile - lowerQuantile,
    scale: "wire-cell-top-to-bottom",
    current: trajectoryBandPoint(
      rankPrecloseForecastCells(forecastCells, lockPrice)[0],
    ),
    typical: {
      ...locate(typicalPrice),
      price: typicalPrice,
      deltaCellWidths: median,
      direction: trajectoryDirection(median, flatThresholdCellWidths),
      agreesWithDirection:
        trajectoryDirection(median, flatThresholdCellWidths) === direction,
    },
    corridor: {
      lowerQuantile,
      upperQuantile,
      lowerDeltaCellWidths: lower,
      medianDeltaCellWidths: median,
      upperDeltaCellWidths: upper,
      lowerPrice,
      upperPrice,
      top: trajectoryBandPoint(bands[topWireCell]),
      bottom: trajectoryBandPoint(bands[bottomWireCell]),
      cells,
      clippedTop: upperPrice > bands[0].upper,
      clippedBottom: lowerPrice < bands.at(-1).lower,
    },
  };
}

function buildTrajectoryDisplayRange(numberArea) {
  const cells = numberArea?.corridor?.cells;
  if (!Array.isArray(cells) || cells.length === 0) return null;
  const typicalIndex = cells.findIndex(
    (cell) => cell.wireCell === numberArea?.typical?.wireCell,
  );
  if (typicalIndex < 0) return null;
  const size = Math.min(TRAJECTORY_DISPLAY_RANGE_MAX_CELLS, cells.length);
  const centeredStart = Math.round(typicalIndex - (size - 1) / 2);
  const start = Math.min(Math.max(centeredStart, 0), cells.length - size);
  const displayedCells = cells.slice(start, start + size).map((cell) => ({
    wireCell: cell.wireCell,
    number: cell.number,
  }));
  return {
    version: TRAJECTORY_DISPLAY_RANGE_VERSION,
    policy: TRAJECTORY_DISPLAY_RANGE_POLICY,
    maxCells: TRAJECTORY_DISPLAY_RANGE_MAX_CELLS,
    top: { ...displayedCells[0] },
    bottom: { ...displayedCells.at(-1) },
    cells: displayedCells,
  };
}

function normalizedLimit(value, fallback = DEFAULT_LIMIT) {
  const limit = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new RangeError(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return limit;
}

function normalizedGapSeconds(value, fallback = 135) {
  const seconds = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86_400) {
    throw new RangeError("gapThresholdSeconds must be an integer between 1 and 86400");
  }
  return seconds;
}

function normalizedVirtualStartingBalance(
  value,
  fallback = DEFAULT_VIRTUAL_STARTING_BALANCE,
) {
  const balance = value === undefined ? fallback : Number(value);
  if (
    !Number.isSafeInteger(balance) ||
    balance < 0 ||
    balance > Number.MAX_SAFE_INTEGER
  ) {
    throw new RangeError(
      "virtualStartingBalance must be a non-negative safe integer",
    );
  }
  return balance;
}

function clampedSafeBalance(value) {
  const balance = Number(value);
  if (!Number.isFinite(balance)) {
    return balance > 0 ? Number.MAX_SAFE_INTEGER : 0;
  }
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(balance)));
}

function numericRoundId(value) {
  if (value === null || value === undefined) return null;
  const candidate = String(value).trim();
  if (!/^\d+$/.test(candidate)) return null;
  return BigInt(candidate);
}

function storedResultsAreAdjacent(left, right, gapThresholdMs) {
  const crossedInvalidCycle =
    left.cycle_status === "invalid_gap" &&
    left.cycle_id !== null &&
    Number(left.cycle_id) !== Number(right.cycle_id);
  if (crossedInvalidCycle) return false;

  const leftRoundId = numericRoundId(left.external_round_id);
  const rightRoundId = numericRoundId(right.external_round_id);
  if (leftRoundId !== null && rightRoundId !== null) {
    return rightRoundId === leftRoundId + 1n;
  }

  const elapsed = Date.parse(right.settled_at) - Date.parse(left.settled_at);
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= gapThresholdMs;
}

function normalizeEvent(event, index, now) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new TypeError(`events[${index}] must be an object`);
  }

  const observedAt = asTimestamp(event.observedAt, now, "observedAt");
  const externalRoundIdValue =
    event.externalRoundId ?? event.external_round_id ?? null;
  const externalRoundId =
    externalRoundIdValue === null
      ? null
      : asNonEmptyText(
          String(externalRoundIdValue),
          undefined,
          "externalRoundId",
        );

  return {
    source: asNonEmptyText(event.source, "buleto", "source"),
    instrument: asNonEmptyText(
      event.instrument,
      "default",
      "instrument",
    ),
    settledAt: asTimestamp(event.settledAt, observedAt, "settledAt"),
    resultNumber: canonicalRouletteNumber(event.resultNumber),
    price: asPrice(event.price),
    observedAt,
    externalRoundId,
    origin: asNonEmptyText(
      event.origin,
      externalRoundId === null ? "last-results" : "round",
      "origin",
    ),
    rawCell: rawCellFromPayload(event.rawPayload),
    fingerprint: asNonEmptyText(
      event.fingerprint,
      undefined,
      "fingerprint",
    ),
    rawPayload: serializeJson(event.rawPayload, "rawPayload"),
    inputIndex: index,
  };
}

function mapRoundResult(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    source: row.source,
    instrument: row.instrument,
    settledAt: row.settled_at,
    resultNumber: Number(row.result_number),
    number: Number(row.result_number),
    price: row.price === null ? null : Number(row.price),
    observedAt: row.observed_at,
    externalRoundId: row.external_round_id,
    rawCell: row.raw_cell === null ? null : Number(row.raw_cell),
    fingerprint: row.fingerprint,
    rawPayload: deserializeJson(row.raw_payload),
    cycleId: row.cycle_id == null ? null : Number(row.cycle_id),
    continuityEpoch: Number(row.continuity_epoch ?? 0),
    wasNew:
      row.was_new === null || row.was_new === undefined
        ? null
        : Boolean(row.was_new),
    remainingAfter:
      row.remaining_after === null || row.remaining_after === undefined
        ? null
        : Number(row.remaining_after),
    createdAt: row.created_at,
  };
}

function mapIncident(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    kind: row.kind,
    source: row.source,
    instrument: row.instrument,
    message: row.message,
    incidentKey: row.incident_key ?? null,
    detectedAt: row.detected_at,
    details: deserializeJson(row.details_json),
    cycleId: row.cycle_id == null ? null : Number(row.cycle_id),
    createdAt: row.created_at,
  };
}

function mapForecastPairHistory(row) {
  if (!row?.pair_status) return null;
  const allowedStatuses = new Set(["ready", "no_anchor", "no_samples"]);
  if (!allowedStatuses.has(row.pair_status)) return null;

  const sampleSize = Number(row.pair_sample_size);
  const observedFollowerCount = Number(row.pair_observed_follower_count);
  if (
    !Number.isSafeInteger(sampleSize) ||
    sampleSize < 0 ||
    !Number.isSafeInteger(observedFollowerCount) ||
    observedFollowerCount < 0 ||
    observedFollowerCount > 37
  ) {
    return null;
  }
  const rawTop3 = deserializeJson(row.pair_top3_json);
  if (!Array.isArray(rawTop3) || rawTop3.length > 3) return null;
  const top3 = [];
  for (const [index, item] of rawTop3.entries()) {
    const number = Number(item?.number);
    const occurrenceCount = Number(item?.occurrenceCount);
    if (
      !Number.isInteger(number) ||
      number < 0 ||
      number > 36 ||
      !Number.isSafeInteger(occurrenceCount) ||
      occurrenceCount <= 0
    ) {
      return null;
    }
    top3.push({
      rank: index + 1,
      number,
      occurrenceCount,
      share: sampleSize > 0 ? occurrenceCount / sampleSize : null,
      firstOccurredAt: item.firstOccurredAt ?? null,
      lastOccurredAt: item.lastOccurredAt ?? null,
    });
  }
  const storedModelTop3 = deserializeJson(row.pair_model_top3_json);
  if (!Array.isArray(storedModelTop3) || storedModelTop3.length !== 3) return null;
  const modelTop3 = storedModelTop3.map(Number);
  if (
    modelTop3.some(
      (number) => !Number.isInteger(number) || number < 0 || number > 36,
    ) ||
    new Set(modelTop3).size !== 3
  ) {
    return null;
  }
  const storedOverlap = deserializeJson(row.pair_overlap_numbers_json);
  if (!Array.isArray(storedOverlap) || storedOverlap.length > 3) return null;
  const overlapNumbers = storedOverlap.map(Number);
  const storedOverlapCount = Number(row.pair_overlap_count);
  if (
    overlapNumbers.some(
      (number) => !Number.isInteger(number) || number < 0 || number > 36,
    ) ||
    new Set(overlapNumbers).size !== overlapNumbers.length ||
    !Number.isSafeInteger(storedOverlapCount) ||
    storedOverlapCount !== overlapNumbers.length
  ) {
    return null;
  }
  const anchor = row.pair_anchor_result_id == null
    ? null
    : {
        resultId: Number(row.pair_anchor_result_id),
        number: Number(row.pair_anchor_number),
        settledAt: row.pair_anchor_settled_at,
        continuityEpoch: Number(row.pair_anchor_continuity_epoch),
      };
  const schemaVersion = Number(row.pair_schema_version);
  const historyMaxResultId = row.pair_history_max_result_id == null
    ? null
    : Number(row.pair_history_max_result_id);
  if (
    schemaVersion !== 1 ||
    !Number.isFinite(Date.parse(row.pair_history_cutoff_at)) ||
    !Number.isFinite(Date.parse(row.pair_captured_at)) ||
    (historyMaxResultId !== null &&
      (!Number.isSafeInteger(historyMaxResultId) || historyMaxResultId <= 0)) ||
    (anchor !== null &&
      (!Number.isSafeInteger(anchor.resultId) ||
        anchor.resultId <= 0 ||
        !Number.isInteger(anchor.number) ||
        anchor.number < 0 ||
        anchor.number > 36 ||
        !Number.isFinite(Date.parse(anchor.settledAt)) ||
        !Number.isSafeInteger(anchor.continuityEpoch) ||
        anchor.continuityEpoch < 0))
  ) {
    return null;
  }
  if (
    (row.pair_status === "ready" && (anchor === null || sampleSize <= 0 || top3.length === 0)) ||
    (row.pair_status === "no_samples" && (anchor === null || sampleSize !== 0 || top3.length !== 0)) ||
    (row.pair_status === "no_anchor" && (anchor !== null || sampleSize !== 0 || top3.length !== 0))
  ) {
    return null;
  }
  const pairNumbers = top3.map((item) => item.number);
  if (
    new Set(pairNumbers).size !== pairNumbers.length ||
    observedFollowerCount < pairNumbers.length ||
    top3.reduce((sum, item) => sum + item.occurrenceCount, 0) > sampleSize
  ) {
    return null;
  }
  const expectedOverlap = modelTop3.filter((number) => pairNumbers.includes(number));
  if (
    expectedOverlap.length !== overlapNumbers.length ||
    expectedOverlap.some((number, index) => number !== overlapNumbers[index])
  ) {
    return null;
  }
  const expectedSameTop1 = pairNumbers.length === 0
    ? null
    : modelTop3[0] === pairNumbers[0];
  const storedSameTop1 = row.pair_same_top1 == null
    ? null
    : Boolean(row.pair_same_top1);
  const expectedExactOrder =
    pairNumbers.length === modelTop3.length &&
    pairNumbers.every((number, index) => number === modelTop3[index]);
  if (
    storedSameTop1 !== expectedSameTop1 ||
    Boolean(row.pair_exact_order) !== expectedExactOrder
  ) {
    return null;
  }

  return {
    schemaVersion,
    status: row.pair_status,
    historyCutoffAt: row.pair_history_cutoff_at,
    capturedAt: row.pair_captured_at,
    historyMaxResultId,
    anchor,
    sampleSize,
    observedFollowerCount,
    top3,
    definition: "adjacent-within-continuity-epoch",
    tieBreak: "count-desc,last-seen-desc,number-asc",
    comparison: {
      modelTop3,
      pairTop3: top3.map((item) => item.number),
      overlapNumbers,
      overlapCount: storedOverlapCount,
      sameTop1: storedSameTop1,
      exactOrder: expectedExactOrder,
    },
  };
}

function mapForecastConsensus(row, modelTop3) {
  if (
    row?.consensus_forecast_id === null ||
    row?.consensus_forecast_id === undefined
  ) {
    return null;
  }
  const algorithmVersion = row.consensus_algorithm_version;
  let allowedInputs;
  let allowedReasons;
  if (algorithmVersion === FORECAST_CONSENSUS_BORDA_ALGORITHM_VERSION) {
    allowedInputs = new Map([
      ["combined", ["model", "pair"]],
      ["model_fallback", ["model"]],
      ["pair_fallback", ["pair"]],
      ["unavailable", []],
    ]);
    allowedReasons = new Map([
      ["combined", new Set(["frozen_model_and_pair"])],
      [
        "model_fallback",
        new Set([
          "pair_not_ready",
          "invalid_pair_ranking",
          "empty_pair_ranking",
          "pair_snapshot_model_mismatch",
        ]),
      ],
      ["pair_fallback", new Set(["model_unavailable"])],
      [
        "unavailable",
        new Set(["incomplete_model_ranking", "invalid_model_ranking"]),
      ],
    ]);
  } else if (
    algorithmVersion ===
    FORECAST_CONSENSUS_MODEL_AUTHORITATIVE_ALGORITHM_VERSION
  ) {
    allowedInputs = new Map([
      ["model_fallback", ["model"]],
      ["unavailable", []],
    ]);
    allowedReasons = new Map([
      ["model_fallback", new Set(["authoritative_model"])],
      [
        "unavailable",
        new Set(["incomplete_model_ranking", "invalid_model_ranking"]),
      ],
    ]);
  } else {
    return null;
  }
  const status = row.consensus_status;
  const top3 = deserializeJson(row.consensus_top3_json);
  const inputsUsed = deserializeJson(row.consensus_inputs_used_json);
  const schemaVersion = Number(row.consensus_schema_version);
  const pairSampleSize = row.consensus_pair_sample_size == null
    ? null
    : Number(row.consensus_pair_sample_size);
  const derivedFromSnapshotAt = row.consensus_derived_from_snapshot_at;
  const createdAt = row.consensus_created_at;
  const expectedInputs = allowedInputs.get(status);
  const expectedReasons = allowedReasons.get(status);
  const forecastId = Number(row.consensus_forecast_id);
  if (
    !Number.isSafeInteger(forecastId) ||
    forecastId <= 0 ||
    forecastId !== Number(row.forecast_id) ||
    schemaVersion !== 1 ||
    !expectedInputs ||
    !expectedReasons ||
    !expectedReasons.has(row.consensus_reason) ||
    !Array.isArray(top3) ||
    !Array.isArray(inputsUsed) ||
    inputsUsed.length !== expectedInputs.length ||
    inputsUsed.some((input, index) => input !== expectedInputs[index]) ||
    (pairSampleSize !== null &&
      (!Number.isSafeInteger(pairSampleSize) || pairSampleSize < 0)) ||
    !Number.isFinite(Date.parse(derivedFromSnapshotAt)) ||
    !Number.isFinite(Date.parse(createdAt)) ||
    Date.parse(derivedFromSnapshotAt) > Date.parse(createdAt)
  ) {
    return null;
  }
  if (
    top3.some(
      (number) => !Number.isInteger(number) || number < 0 || number > 36,
    ) ||
    new Set(top3).size !== top3.length ||
    (status === "unavailable" ? top3.length !== 0 : top3.length !== 3) ||
    (status === "model_fallback" &&
      (top3.length !== modelTop3.length ||
        top3.some((number, index) => number !== modelTop3[index]))) ||
    (["combined", "pair_fallback"].includes(status) &&
      (pairSampleSize === null || pairSampleSize <= 0))
  ) {
    return null;
  }

  return {
    status,
    top3,
    algorithmVersion,
    pairSampleSize,
    derivedFromSnapshotAt,
    inputsUsed,
    reason: row.consensus_reason,
  };
}

function normalizeTrajectoryNumberArea(
  value,
  { direction, lockPrice, medianCellWidth, flatThresholdCellWidths } = {},
) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const validPoint = (point) =>
    point &&
    typeof point === "object" &&
    !Array.isArray(point) &&
    Number.isInteger(point.wireCell) &&
    point.wireCell >= 0 &&
    point.wireCell <= 37 &&
    point.number === (point.wireCell === 37 ? 0 : point.wireCell);
  const { current, typical, corridor } = value;
  if (
    value.version !== TRAJECTORY_NUMBER_AREA_VERSION ||
    value.basis !== "weighted-neighbor-delta-q20-q50-q80" ||
    value.scale !== "wire-cell-top-to-bottom" ||
    !Number.isFinite(value.centralWeight) ||
    !validPoint(current) ||
    !validPoint(typical) ||
    !Number.isFinite(typical.price) ||
    !Number.isFinite(typical.deltaCellWidths) ||
    !["up", "down", "flat"].includes(typical.direction) ||
    typeof typical.agreesWithDirection !== "boolean" ||
    !corridor ||
    typeof corridor !== "object" ||
    Array.isArray(corridor) ||
    !validPoint(corridor.top) ||
    !validPoint(corridor.bottom) ||
    !Array.isArray(corridor.cells) ||
    corridor.cells.length < 1 ||
    corridor.cells.some((cell) => !validPoint(cell)) ||
    !Number.isFinite(corridor.lowerQuantile) ||
    !Number.isFinite(corridor.upperQuantile) ||
    !Number.isFinite(corridor.lowerDeltaCellWidths) ||
    !Number.isFinite(corridor.medianDeltaCellWidths) ||
    !Number.isFinite(corridor.upperDeltaCellWidths) ||
    !Number.isFinite(corridor.lowerPrice) ||
    !Number.isFinite(corridor.upperPrice) ||
    typeof corridor.clippedTop !== "boolean" ||
    typeof corridor.clippedBottom !== "boolean"
  ) {
    return null;
  }
  if (
    Math.abs(corridor.lowerQuantile - 0.2) > 1e-12 ||
    Math.abs(corridor.upperQuantile - 0.8) > 1e-12 ||
    Math.abs(
      value.centralWeight -
        (corridor.upperQuantile - corridor.lowerQuantile),
    ) > 1e-12 ||
    !Number.isFinite(lockPrice) ||
    !Number.isFinite(medianCellWidth) ||
    medianCellWidth <= 0 ||
    !Number.isFinite(flatThresholdCellWidths) ||
    flatThresholdCellWidths < 0 ||
    !["up", "down", "flat"].includes(direction) ||
    corridor.lowerDeltaCellWidths > corridor.medianDeltaCellWidths ||
    corridor.medianDeltaCellWidths > corridor.upperDeltaCellWidths ||
    Math.abs(typical.deltaCellWidths - corridor.medianDeltaCellWidths) > 1e-12 ||
    typical.direction !==
      trajectoryDirection(
        corridor.medianDeltaCellWidths,
        flatThresholdCellWidths,
      ) ||
    typical.agreesWithDirection !== (typical.direction === direction) ||
    Math.abs(
      typical.price -
        (lockPrice + corridor.medianDeltaCellWidths * medianCellWidth),
    ) > 1e-9 ||
    Math.abs(
      corridor.lowerPrice -
        (lockPrice + corridor.lowerDeltaCellWidths * medianCellWidth),
    ) > 1e-9 ||
    Math.abs(
      corridor.upperPrice -
        (lockPrice + corridor.upperDeltaCellWidths * medianCellWidth),
    ) > 1e-9 ||
    corridor.lowerPrice > corridor.upperPrice ||
    corridor.top.wireCell > corridor.bottom.wireCell ||
    corridor.cells.length !==
      corridor.bottom.wireCell - corridor.top.wireCell + 1 ||
    corridor.cells.some(
      (cell, index) => cell.wireCell !== corridor.top.wireCell + index,
    ) ||
    corridor.cells[0].wireCell !== corridor.top.wireCell ||
    corridor.cells.at(-1).wireCell !== corridor.bottom.wireCell
  ) {
    return null;
  }
  return {
    version: value.version,
    basis: value.basis,
    centralWeight: value.centralWeight,
    scale: value.scale,
    current: { wireCell: current.wireCell, number: current.number },
    typical: {
      wireCell: typical.wireCell,
      number: typical.number,
      price: typical.price,
      deltaCellWidths: typical.deltaCellWidths,
      direction: typical.direction,
      agreesWithDirection: typical.agreesWithDirection,
    },
    corridor: {
      lowerQuantile: corridor.lowerQuantile,
      upperQuantile: corridor.upperQuantile,
      lowerDeltaCellWidths: corridor.lowerDeltaCellWidths,
      medianDeltaCellWidths: corridor.medianDeltaCellWidths,
      upperDeltaCellWidths: corridor.upperDeltaCellWidths,
      lowerPrice: corridor.lowerPrice,
      upperPrice: corridor.upperPrice,
      top: {
        wireCell: corridor.top.wireCell,
        number: corridor.top.number,
      },
      bottom: {
        wireCell: corridor.bottom.wireCell,
        number: corridor.bottom.number,
      },
      cells: corridor.cells.map((cell) => ({
        wireCell: cell.wireCell,
        number: cell.number,
      })),
      clippedTop: corridor.clippedTop,
      clippedBottom: corridor.clippedBottom,
    },
  };
}

function normalizeTrajectoryDisplayRange(value, numberArea) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.version !== TRAJECTORY_DISPLAY_RANGE_VERSION ||
    value.policy !== TRAJECTORY_DISPLAY_RANGE_POLICY ||
    value.maxCells !== TRAJECTORY_DISPLAY_RANGE_MAX_CELLS
  ) {
    return null;
  }
  const expected = buildTrajectoryDisplayRange(numberArea);
  if (!expected || !Array.isArray(value.cells)) return null;
  const samePoint = (left, right) =>
    left &&
    typeof left === "object" &&
    !Array.isArray(left) &&
    left.wireCell === right.wireCell &&
    left.number === right.number;
  if (
    !samePoint(value.top, expected.top) ||
    !samePoint(value.bottom, expected.bottom) ||
    value.cells.length !== expected.cells.length ||
    value.cells.some((cell, index) => !samePoint(cell, expected.cells[index]))
  ) {
    return null;
  }
  return expected;
}

const TRAJECTORY_DIRECTIONS = Object.freeze(["up", "down", "flat"]);
const TRAJECTORY_SAMPLE_KEYS = Object.freeze([
  "historyCount",
  "eligibleCount",
  "excludedNotPastCount",
  "withinDistanceCount",
  "neighborCount",
  "requiredHistory",
  "requiredNeighbors",
]);
const TRAJECTORY_ADAPTIVE_VALIDATOR_SQL_FUNCTION =
  "trajectory_adaptive_snapshot_valid_v2";
const TRAJECTORY_ADAPTIVE_VALIDATOR_ARGUMENT_COUNT = 15;
const TRAJECTORY_METRIC_FACT_VERSION =
  "trajectory-adaptive-snapshot-valid-v2/metrics-v1";
const PREDICTIVE_LEADER_METRIC_FACT_VERSION =
  "learned-leader-v1/metrics-v1";

function trajectoryAdaptiveValidatorFingerprint(values) {
  if (values.length !== TRAJECTORY_ADAPTIVE_VALIDATOR_ARGUMENT_COUNT) {
    throw new TypeError(
      `trajectory validator requires ${TRAJECTORY_ADAPTIVE_VALIDATOR_ARGUMENT_COUNT} arguments`,
    );
  }

  const hash = createHash("sha256");
  hash.update("trajectory-adaptive-snapshot-valid-v2/15\0", "utf8");
  for (const value of values) {
    let type;
    let byteLength;
    let bytes = null;
    let text = null;
    let encoding = null;
    if (value === null) {
      type = 0;
      byteLength = 0;
    } else if (typeof value === "string") {
      type = 1;
      byteLength = value.length * 2;
      text = value;
      encoding = "utf16le";
    } else if (typeof value === "number") {
      type = 2;
      bytes = Buffer.allocUnsafe(8);
      bytes.writeDoubleBE(value);
      byteLength = bytes.byteLength;
    } else if (typeof value === "bigint") {
      type = 3;
      text = value.toString(10);
      encoding = "ascii";
      byteLength = Buffer.byteLength(text, encoding);
    } else if (value instanceof Uint8Array) {
      type = 4;
      bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      byteLength = bytes.byteLength;
    } else if (value === undefined) {
      type = 5;
      byteLength = 0;
    } else if (typeof value === "boolean") {
      type = 6;
      bytes = Buffer.from([Number(value)]);
      byteLength = bytes.byteLength;
    } else {
      throw new TypeError("unsupported trajectory validator argument type");
    }

    const frame = Buffer.allocUnsafe(9);
    frame.writeUInt8(type, 0);
    frame.writeBigUInt64BE(BigInt(byteLength), 1);
    hash.update(frame);
    if (text !== null) hash.update(text, encoding);
    else if (bytes !== null) hash.update(bytes);
  }
  return hash.digest("base64url");
}

function bettingClosesAtFromSerializedPayload(rawPayload) {
  const parsed = deserializeJson(rawPayload);
  const candidate = parsed?.bcd ?? parsed?.bettingClosesAt ?? null;
  if (typeof candidate !== "string" || !Number.isFinite(Date.parse(candidate))) {
    return null;
  }
  return new Date(candidate).toISOString();
}

function trajectoryAdaptiveValidatorValuesFromRow(row) {
  return [
    row.status,
    row.cutoff_at,
    row.snapshot_locked_at,
    row.lock_price,
    row.snapshot_current_price,
    row.median_cell_width,
    row.direction,
    row.probabilities_json,
    row.expected_delta_cell_widths,
    row.sample_json,
    row.nearest_ids_json,
    row.parameters_json,
    row.current_prefix_json,
    row.integration_json,
    row.cells_json,
  ];
}

function trajectoryNumbersEqual(left, right, tolerance = 1e-9) {
  return (
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.abs(left - right) <=
      tolerance * Math.max(1, Math.abs(left), Math.abs(right))
  );
}

function sameTrajectoryValue(left, right) {
  if (typeof left === "number" || typeof right === "number") {
    return (
      typeof left === "number" &&
      typeof right === "number" &&
      trajectoryNumbersEqual(left, right)
    );
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameTrajectoryValue(value, right[index]))
    );
  }
  if (
    left &&
    right &&
    typeof left === "object" &&
    typeof right === "object"
  ) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index]) &&
      leftKeys.every((key) => sameTrajectoryValue(left[key], right[key]))
    );
  }
  return left === right;
}

function plainTrajectoryExpertOptions(options) {
  return {
    resamplePoints: options.resamplePoints,
    neighbors: options.neighbors,
    minHistory: options.minHistory,
    minNeighbors: options.minNeighbors,
    maxDistanceCellWidths: options.maxDistanceCellWidths,
    flatThresholdCellWidths: options.flatThresholdCellWidths,
    maxAbsDeltaCellWidths: options.maxAbsDeltaCellWidths,
  };
}

function expectedTrajectoryAdaptiveParameters() {
  return {
    flatThresholdCellWidths:
      TRAJECTORY_SHADOW_ADAPTIVE_DEFAULTS.flatThresholdCellWidths,
    maxAbsDeltaCellWidths:
      TRAJECTORY_SHADOW_ADAPTIVE_DEFAULTS.maxAbsDeltaCellWidths,
    eta: TRAJECTORY_SHADOW_ADAPTIVE_DEFAULTS.eta,
    decay: TRAJECTORY_SHADOW_ADAPTIVE_DEFAULTS.decay,
    directionLossWeight:
      TRAJECTORY_SHADOW_ADAPTIVE_DEFAULTS.directionLossWeight,
    deltaLossWeight: TRAJECTORY_SHADOW_ADAPTIVE_DEFAULTS.deltaLossWeight,
    quantileAggregation: "weighted_expert_quantiles",
    expertCount: TRAJECTORY_SHADOW_ADAPTIVE_EXPERTS.length,
    experts: TRAJECTORY_SHADOW_ADAPTIVE_EXPERTS.map((expert) => ({
      id: expert.id,
      options: plainTrajectoryExpertOptions(expert.options),
    })),
  };
}

function trajectoryWinningDirection(probabilities, expectedDeltaCellWidths) {
  const maximum = Math.max(
    ...TRAJECTORY_DIRECTIONS.map((key) => probabilities[key]),
  );
  const tied = TRAJECTORY_DIRECTIONS.filter(
    (key) => Math.abs(probabilities[key] - maximum) <= Number.EPSILON * 8,
  );
  if (tied.length === 1) return tied[0];
  if (tied.includes("flat")) return "flat";
  const expectedDirection = expectedDeltaCellWidths >= 0 ? "up" : "down";
  return tied.includes(expectedDirection)
    ? expectedDirection
    : [...tied].sort()[0];
}

function validTrajectorySample(sample, status, options) {
  if (!sample || typeof sample !== "object" || Array.isArray(sample)) {
    return false;
  }
  const keys = Object.keys(sample).sort();
  const expectedKeys = [...TRAJECTORY_SAMPLE_KEYS].sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index]) ||
    TRAJECTORY_SAMPLE_KEYS.some(
      (key) => !Number.isSafeInteger(sample[key]) || sample[key] < 0,
    ) ||
    sample.requiredHistory !== options.minHistory ||
    sample.requiredNeighbors !== options.minNeighbors ||
    sample.eligibleCount + sample.excludedNotPastCount !==
      sample.historyCount ||
    sample.withinDistanceCount > sample.eligibleCount
  ) {
    return false;
  }
  if (status === "ready") {
    return (
      sample.eligibleCount >= options.minHistory &&
      sample.neighborCount ===
        Math.min(options.neighbors, sample.withinDistanceCount) &&
      sample.neighborCount >= options.minNeighbors
    );
  }
  if (status === "insufficient_history") {
    return sample.eligibleCount < options.minHistory && sample.neighborCount === 0;
  }
  return (
    status === "insufficient_neighbors" &&
    sample.eligibleCount >= options.minHistory &&
    sample.withinDistanceCount < options.minNeighbors &&
    sample.neighborCount === 0
  );
}

function validTrajectoryNearestIds(nearestIds, expectedCount) {
  return (
    Array.isArray(nearestIds) &&
    nearestIds.length === expectedCount &&
    nearestIds.every(
      (id) => typeof id === "string" && id.trim() !== "",
    ) &&
    new Set(nearestIds).size === nearestIds.length
  );
}

function normalizedTrajectoryNeighborDistribution(
  value,
  nearestIds,
  expectedCount,
) {
  if (value === undefined) return { present: false, value: [] };
  if (
    !Array.isArray(nearestIds)
    || !Number.isSafeInteger(expectedCount)
    || expectedCount < 0
    || !Array.isArray(value)
    || value.length !== expectedCount
  ) return null;
  const normalized = [];
  let totalWeight = 0;
  for (let index = 0; index < value.length; index += 1) {
    const neighbor = value[index];
    if (
      !neighbor
      || typeof neighbor !== "object"
      || Array.isArray(neighbor)
      || Object.keys(neighbor).sort().join(",") !== "deltaCellWidths,id,weight"
      || neighbor.id !== nearestIds[index]
      || !Number.isFinite(neighbor.deltaCellWidths)
      || Math.abs(neighbor.deltaCellWidths) >
        TRAJECTORY_SHADOW_ADAPTIVE_DEFAULTS.maxAbsDeltaCellWidths
      || !Number.isFinite(neighbor.weight)
      || !(neighbor.weight > 0)
      || neighbor.weight > 1
    ) {
      return null;
    }
    totalWeight += neighbor.weight;
    normalized.push({
      id: neighbor.id,
      deltaCellWidths: neighbor.deltaCellWidths,
      weight: neighbor.weight,
    });
  }
  if (expectedCount > 0 && !trajectoryNumbersEqual(totalWeight, 1)) {
    return null;
  }
  return { present: true, value: normalized };
}

function normalizeTrajectoryAdaptive(
  value,
  {
    status,
    cutoffAt,
    snapshotLockedAt,
    direction,
    probabilities,
    expectedDeltaCellWidths,
    sample,
    nearestIds,
    parameters,
    lockPrice,
    snapshotCurrentPrice,
    medianCellWidth,
    currentPrefix,
    cells,
    numberArea,
    displayRange,
    storedNumberArea,
    storedDisplayRange,
  } = {},
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const countKeys = [
    "trainingCount",
    "eligibleLearningRowCount",
    "skippedNotCommonReadyCount",
    "excludedNotPastCount",
  ];
  const expectedIds = TRAJECTORY_SHADOW_ADAPTIVE_EXPERTS.map(
    (expert) => expert.id,
  );
  const sortedExpectedIds = [...expectedIds].sort();
  const validWeightObject = (weights, expectedTotal) => {
    if (!weights || typeof weights !== "object" || Array.isArray(weights)) {
      return false;
    }
    const keys = Object.keys(weights).sort();
    if (
      keys.length !== sortedExpectedIds.length ||
      keys.some((key, index) => key !== sortedExpectedIds[index])
    ) {
      return false;
    }
    const values = expectedIds.map((id) => weights[id]);
    return (
      values.every(
        (weight) => Number.isFinite(weight) && weight >= 0 && weight <= 1,
      ) &&
      trajectoryNumbersEqual(
        values.reduce((sum, weight) => sum + weight, 0),
        expectedTotal,
      )
    );
  };
  const learningCutoffMs = Date.parse(value.learningCutoffAt);
  const shadowCutoffMs = Date.parse(cutoffAt);
  const snapshotLockedMs = Date.parse(snapshotLockedAt);
  const lastTrainingMs = value.lastTrainingCompletedAt === null
    ? null
    : Date.parse(value.lastTrainingCompletedAt);
  const validCurrentPrefix =
    Array.isArray(currentPrefix) &&
    currentPrefix.length >= 3 &&
    currentPrefix.every((point, index) => {
      if (
        !point ||
        typeof point !== "object" ||
        Array.isArray(point) ||
        Object.keys(point).sort().join(",") !== "at,price" ||
        !Number.isFinite(Date.parse(point.at)) ||
        !Number.isFinite(point.price) ||
        Date.parse(point.at) > shadowCutoffMs
      ) {
        return false;
      }
      return index === 0 || Date.parse(currentPrefix[index - 1].at) < Date.parse(point.at);
    });
  if (
    !Array.isArray(value.experts) ||
    value.experts.length !== expectedIds.length ||
    countKeys.some(
      (key) => !Number.isSafeInteger(value[key]) || value[key] < 0,
    ) ||
    value.trainingCount + value.skippedNotCommonReadyCount !==
      value.eligibleLearningRowCount ||
    !Number.isFinite(learningCutoffMs) ||
    !Number.isFinite(shadowCutoffMs) ||
    !Number.isFinite(snapshotLockedMs) ||
    shadowCutoffMs !== snapshotLockedMs ||
    learningCutoffMs !== shadowCutoffMs ||
    !Number.isFinite(lockPrice) ||
    !Number.isFinite(snapshotCurrentPrice) ||
    !trajectoryNumbersEqual(lockPrice, snapshotCurrentPrice) ||
    !validCurrentPrefix ||
    !trajectoryNumbersEqual(currentPrefix.at(-1).price, lockPrice) ||
    (value.trainingCount === 0) !==
      (value.lastTrainingCompletedAt === null) ||
    (lastTrainingMs !== null &&
      (!Number.isFinite(lastTrainingMs) || lastTrainingMs >= learningCutoffMs)) ||
    !sameTrajectoryValue(parameters, expectedTrajectoryAdaptiveParameters())
  ) {
    return null;
  }
  const equalPriorWeight = 1 / expectedIds.length;
  if (
    !validWeightObject(value.priorWeights, 1) ||
    !validWeightObject(value.currentWeights, 1) ||
    expectedIds.some(
      (id) => !trajectoryNumbersEqual(value.priorWeights[id], equalPriorWeight),
    )
  ) {
    return null;
  }

  const normalizedExperts = [];
  for (const [index, expert] of value.experts.entries()) {
    const expected = TRAJECTORY_SHADOW_ADAPTIVE_EXPERTS[index];
    const expectedOptions = plainTrajectoryExpertOptions(expected.options);
    const options = expert?.options;
    const expertStatus = expert?.status;
    const ready = expertStatus === "ready";
    if (
      !expert ||
      typeof expert !== "object" ||
      Array.isArray(expert) ||
      expert.id !== expected.id ||
      expert.modelVersion !== TRAJECTORY_SHADOW_VERSION ||
      !sameTrajectoryValue(options, expectedOptions) ||
      !["ready", "insufficient_history", "insufficient_neighbors"].includes(
        expertStatus,
      ) ||
      !validTrajectorySample(expert.sample, expertStatus, expectedOptions) ||
      !Number.isFinite(expert.priorWeight) ||
      !Number.isFinite(expert.learnedWeight) ||
      !Number.isFinite(expert.ensembleWeight) ||
      !trajectoryNumbersEqual(
        expert.priorWeight,
        value.priorWeights?.[expected.id],
      ) ||
      !trajectoryNumbersEqual(
        expert.learnedWeight,
        value.currentWeights?.[expected.id],
      ) ||
      !trajectoryNumbersEqual(
        expert.ensembleWeight,
        value.ensembleWeights?.[expected.id],
      )
    ) {
      return null;
    }
    let neighborDistribution;
    if (ready) {
      const expertProbabilities = expert.probabilities;
      const range = expert.deltaRangeCellWidths;
      neighborDistribution = normalizedTrajectoryNeighborDistribution(
        expert.neighborDistribution,
        expert.nearestIds,
        expert.sample?.neighborCount,
      );
      if (
        !TRAJECTORY_DIRECTIONS.includes(expert.direction) ||
        !expertProbabilities ||
        typeof expertProbabilities !== "object" ||
        Array.isArray(expertProbabilities) ||
        TRAJECTORY_DIRECTIONS.some(
          (key) =>
            !Number.isFinite(expertProbabilities[key]) ||
            expertProbabilities[key] < 0 ||
            expertProbabilities[key] > 1,
        ) ||
        !trajectoryNumbersEqual(
          TRAJECTORY_DIRECTIONS.reduce(
            (total, key) => total + expertProbabilities[key],
            0,
          ),
          1,
        ) ||
        !Number.isFinite(expert.expectedDeltaCellWidths) ||
        Math.abs(expert.expectedDeltaCellWidths) >
          TRAJECTORY_SHADOW_ADAPTIVE_DEFAULTS.maxAbsDeltaCellWidths ||
        !range ||
        typeof range !== "object" ||
        Array.isArray(range) ||
        !trajectoryNumbersEqual(range.lowerQuantile, 0.2) ||
        !trajectoryNumbersEqual(range.upperQuantile, 0.8) ||
        !Number.isFinite(range.lower) ||
        !Number.isFinite(range.median) ||
        !Number.isFinite(range.upper) ||
        [range.lower, range.median, range.upper].some(
          (delta) =>
            Math.abs(delta) >
            TRAJECTORY_SHADOW_ADAPTIVE_DEFAULTS.maxAbsDeltaCellWidths,
        ) ||
        range.lower > range.median ||
        range.median > range.upper ||
        expert.direction !==
          trajectoryWinningDirection(
            expertProbabilities,
            expert.expectedDeltaCellWidths,
          ) ||
        !validTrajectoryNearestIds(
          expert.nearestIds,
          expert.sample.neighborCount,
        ) || !neighborDistribution
      ) {
        return null;
      }
    } else {
      neighborDistribution = normalizedTrajectoryNeighborDistribution(
        expert.neighborDistribution,
        expert.nearestIds,
        0,
      );
      if (
        expert.direction !== null ||
        expert.probabilities !== null ||
        expert.expectedDeltaCellWidths !== null ||
        expert.deltaRangeCellWidths !== null ||
        !validTrajectoryNearestIds(expert.nearestIds, 0) ||
        !neighborDistribution
      ) {
        return null;
      }
    }
    const normalizedExpert = { ...expert, options: { ...options } };
    if (neighborDistribution.present) {
      normalizedExpert.neighborDistribution = neighborDistribution.value;
    } else {
      delete normalizedExpert.neighborDistribution;
    }
    normalizedExperts.push(normalizedExpert);
  }

  const readyExperts = normalizedExperts.filter(
    (expert) => expert.status === "ready",
  );
  const expectedEnsembleTotal = readyExperts.length > 0 ? 1 : 0;
  const readyCurrentWeightTotal = readyExperts.reduce(
    (total, expert) => total + value.currentWeights[expert.id],
    0,
  );
  if (
    !validWeightObject(value.ensembleWeights, expectedEnsembleTotal) ||
    (status === "ready") !== (readyExperts.length > 0) ||
    (readyExperts.length > 0 && !(readyCurrentWeightTotal > 0)) ||
    expectedIds.some((id) => {
      const ready = readyExperts.some((expert) => expert.id === id);
      const expectedWeight = ready
        ? value.currentWeights[id] / readyCurrentWeightTotal
        : 0;
      return !trajectoryNumbersEqual(value.ensembleWeights[id], expectedWeight);
    })
  ) {
    return null;
  }

  if (readyExperts.length === 0) {
    const representative =
      normalizedExperts.find(
        (expert) => expert.status === "insufficient_history",
      ) ?? normalizedExperts[0];
    if (
      status !== representative.status ||
      direction !== null ||
      probabilities !== null ||
      expectedDeltaCellWidths !== null ||
      !sameTrajectoryValue(sample, representative.sample) ||
      !sameTrajectoryValue(nearestIds, []) ||
      numberArea !== null ||
      displayRange !== null ||
      storedNumberArea !== null ||
      storedDisplayRange !== null
    ) {
      return null;
    }
  } else {
    const expectedProbabilities = { up: 0, down: 0, flat: 0 };
    const expectedRange = {
      lowerQuantile: 0.2,
      upperQuantile: 0.8,
      lower: 0,
      median: 0,
      upper: 0,
    };
    let expectedDelta = 0;
    for (const expert of readyExperts) {
      const weight = value.ensembleWeights[expert.id];
      for (const key of TRAJECTORY_DIRECTIONS) {
        expectedProbabilities[key] += weight * expert.probabilities[key];
      }
      expectedDelta += weight * expert.expectedDeltaCellWidths;
      expectedRange.lower += weight * expert.deltaRangeCellWidths.lower;
      expectedRange.median += weight * expert.deltaRangeCellWidths.median;
      expectedRange.upper += weight * expert.deltaRangeCellWidths.upper;
    }
    const probabilityTotal = TRAJECTORY_DIRECTIONS.reduce(
      (total, key) => total + expectedProbabilities[key],
      0,
    );
    for (const key of TRAJECTORY_DIRECTIONS) {
      expectedProbabilities[key] /= probabilityTotal;
    }
    const reference = readyExperts.reduce((best, expert) =>
      value.ensembleWeights[expert.id] > value.ensembleWeights[best.id]
        ? expert
        : best,
    );
    const expectedNearestIds = [];
    const seenNearestIds = new Set();
    for (const expert of readyExperts) {
      for (const id of expert.nearestIds) {
        if (seenNearestIds.has(id)) continue;
        seenNearestIds.add(id);
        expectedNearestIds.push(id);
      }
    }
    let bands;
    try {
      bands = trajectoryBandsFromForecastCells(cells);
    } catch {
      return null;
    }
    const expectedMedianCellWidth = trajectoryMedianCellWidth(bands);
    const expectedDirection = trajectoryWinningDirection(
      expectedProbabilities,
      expectedDelta,
    );
    const expectedNumberArea = buildTrajectoryNumberArea({
      bands,
      lockPrice,
      medianCellWidth,
      deltaRangeCellWidths: expectedRange,
      direction: expectedDirection,
      flatThresholdCellWidths:
        TRAJECTORY_SHADOW_ADAPTIVE_DEFAULTS.flatThresholdCellWidths,
    });
    const expectedDisplayRange = buildTrajectoryDisplayRange(expectedNumberArea);
    if (
      !sameTrajectoryValue(probabilities, expectedProbabilities) ||
      !trajectoryNumbersEqual(expectedDeltaCellWidths, expectedDelta) ||
      direction !== expectedDirection ||
      !sameTrajectoryValue(sample, reference.sample) ||
      !sameTrajectoryValue(nearestIds, expectedNearestIds) ||
      !trajectoryNumbersEqual(medianCellWidth, expectedMedianCellWidth) ||
      expectedNumberArea === null ||
      !sameTrajectoryValue(numberArea, expectedNumberArea) ||
      !sameTrajectoryValue(storedNumberArea, expectedNumberArea) ||
      expectedDisplayRange === null ||
      !sameTrajectoryValue(displayRange, expectedDisplayRange) ||
      !sameTrajectoryValue(storedDisplayRange, expectedDisplayRange)
    ) {
      return null;
    }
  }

  return {
    ...value,
    experts: normalizedExperts,
    currentWeights: { ...value.currentWeights },
    ensembleWeights: { ...value.ensembleWeights },
    priorWeights: { ...value.priorWeights },
  };
}

function expectedTrajectoryNumberRanking({
  adaptive,
  cells,
  lockPrice,
  medianCellWidth,
  cutoffAt,
} = {}) {
  if (!adaptive || !Array.isArray(adaptive.experts)) return null;
  if (adaptive.trainingCount < TRAJECTORY_RANK37_MIN_TRAINING_COUNT) return null;
  const readyExperts = adaptive.experts.filter(
    (expert) => expert.status === "ready",
  );
  if (readyExperts.length === 0) return null;
  const distributionCount = readyExperts.filter(
    (expert) => Array.isArray(expert.neighborDistribution),
  ).length;
  if (distributionCount === 0) return null;
  if (distributionCount !== readyExperts.length) {
    throw new TypeError("adaptive neighbor distributions must be all present or all absent");
  }
  return buildTrajectoryRank37({
    bands: trajectoryBandsFromForecastCells(cells),
    lockPrice,
    medianCellWidth,
    adaptive,
    tieSeed: cutoffAt,
  });
}

function validAdaptiveTrajectorySnapshotSql(
  status,
  cutoffAt,
  snapshotLockedAt,
  lockPrice,
  snapshotCurrentPrice,
  medianCellWidth,
  direction,
  probabilitiesJson,
  expectedDeltaCellWidths,
  sampleJson,
  nearestIdsJson,
  parametersJson,
  currentPrefixJson,
  integrationJson,
  cellsJson,
) {
  try {
    const probabilities = deserializeJson(probabilitiesJson);
    const sample = deserializeJson(sampleJson);
    const nearestIds = deserializeJson(nearestIdsJson);
    const parameters = deserializeJson(parametersJson);
    const currentPrefix = deserializeJson(currentPrefixJson);
    const integration = deserializeJson(integrationJson);
    const cells = deserializeJson(cellsJson);
    const numericLockPrice = lockPrice == null ? null : Number(lockPrice);
    const numericMedianCellWidth =
      medianCellWidth == null ? null : Number(medianCellWidth);
    const numericSnapshotCurrentPrice =
      snapshotCurrentPrice == null ? null : Number(snapshotCurrentPrice);
    const numericExpectedDelta =
      expectedDeltaCellWidths == null
        ? null
        : Number(expectedDeltaCellWidths);
    const numberArea = normalizeTrajectoryNumberArea(integration?.numberArea, {
      direction,
      lockPrice: numericLockPrice,
      medianCellWidth: numericMedianCellWidth,
      flatThresholdCellWidths: Number(parameters?.flatThresholdCellWidths),
    });
    const displayRange = normalizeTrajectoryDisplayRange(
      integration?.displayRange,
      numberArea,
    );
    const adaptive = normalizeTrajectoryAdaptive(integration?.adaptive, {
      status,
      cutoffAt,
      snapshotLockedAt,
      direction,
      probabilities,
      expectedDeltaCellWidths: numericExpectedDelta,
      sample,
      nearestIds,
      parameters,
      lockPrice: numericLockPrice,
      snapshotCurrentPrice: numericSnapshotCurrentPrice,
      medianCellWidth: numericMedianCellWidth,
      currentPrefix,
      cells,
      numberArea,
      displayRange,
      storedNumberArea: integration?.numberArea ?? null,
      storedDisplayRange: integration?.displayRange ?? null,
    });
    if (adaptive === null) return 0;
    const expectedNumberRanking = status === "ready"
      ? expectedTrajectoryNumberRanking({
          adaptive,
          cells,
          lockPrice: numericLockPrice,
          medianCellWidth: numericMedianCellWidth,
          cutoffAt,
        })
      : null;
    const storedNumberRanking = integration?.numberRanking ?? null;
    if (
      expectedNumberRanking === null
        ? storedNumberRanking !== null
        : !sameTrajectoryValue(storedNumberRanking, expectedNumberRanking)
    ) {
      return 0;
    }
    return 1;
  } catch {
    return 0;
  }
}

function consistentTrajectoryRawCell(rawCellValue, actualNumberValue) {
  if (
    rawCellValue === null ||
    rawCellValue === undefined ||
    rawCellValue === "" ||
    actualNumberValue === null ||
    actualNumberValue === undefined ||
    actualNumberValue === ""
  ) {
    return null;
  }
  const rawCell = Number(rawCellValue);
  const actualNumber = Number(actualNumberValue);
  if (
    !Number.isInteger(rawCell) ||
    rawCell < 0 ||
    rawCell > 37 ||
    !Number.isInteger(actualNumber) ||
    actualNumber < 0 ||
    actualNumber > 36 ||
    canonicalRouletteNumber(rawCell) !== actualNumber
  ) {
    return null;
  }
  return rawCell;
}

function mapForecastTrajectoryShadow(row) {
  if (
    row?.trajectory_shadow_forecast_id === null ||
    row?.trajectory_shadow_forecast_id === undefined
  ) {
    return null;
  }
  const allowedStatuses = new Set([
    "ready",
    "insufficient_current",
    "insufficient_history",
    "insufficient_neighbors",
  ]);
  const probabilities = deserializeJson(row.trajectory_shadow_probabilities_json);
  const sample = deserializeJson(row.trajectory_shadow_sample_json);
  const nearestIds = deserializeJson(row.trajectory_shadow_nearest_ids_json);
  const parameters = deserializeJson(row.trajectory_shadow_parameters_json);
  const currentPrefix = deserializeJson(row.trajectory_shadow_current_prefix_json);
  const integration = deserializeJson(row.trajectory_shadow_integration_json);
  const cells = deserializeJson(row.trajectory_cells_json);
  const status = row.trajectory_shadow_status;
  const direction = row.trajectory_shadow_direction;
  const modelVersion = row.trajectory_shadow_model_version;
  const flatThresholdCellWidths = Number(
    parameters?.flatThresholdCellWidths,
  );
  if (
    Number(row.trajectory_shadow_schema_version) !==
      TRAJECTORY_SHADOW_SCHEMA_VERSION ||
    ![TRAJECTORY_SHADOW_VERSION, TRAJECTORY_SHADOW_ADAPTIVE_VERSION].includes(
      modelVersion,
    ) ||
    !allowedStatuses.has(status) ||
    !Array.isArray(nearestIds) ||
    !parameters ||
    typeof parameters !== "object" ||
    Array.isArray(parameters) ||
    !Array.isArray(currentPrefix) ||
    !integration ||
    typeof integration !== "object" ||
    Array.isArray(integration) ||
    !Number.isFinite(flatThresholdCellWidths) ||
    flatThresholdCellWidths < 0
  ) {
    return null;
  }

  const lockPrice = row.trajectory_shadow_lock_price == null
    ? null
    : Number(row.trajectory_shadow_lock_price);
  const medianCellWidth = row.trajectory_shadow_median_cell_width == null
    ? null
    : Number(row.trajectory_shadow_median_cell_width);
  const expectedDeltaCellWidths =
    row.trajectory_shadow_expected_delta_cell_widths == null
      ? null
      : Number(row.trajectory_shadow_expected_delta_cell_widths);
  const actualPrice = row.trajectory_actual_price == null
    ? null
    : Number(row.trajectory_actual_price);
  const numberArea = normalizeTrajectoryNumberArea(integration?.numberArea, {
    direction,
    lockPrice,
    medianCellWidth,
    flatThresholdCellWidths,
  });
  const displayRange = normalizeTrajectoryDisplayRange(
    integration?.displayRange,
    numberArea,
  );
  const adaptive = modelVersion === TRAJECTORY_SHADOW_ADAPTIVE_VERSION
    ? normalizeTrajectoryAdaptive(integration?.adaptive, {
        status,
        cutoffAt: row.trajectory_shadow_cutoff_at,
        snapshotLockedAt: row.locked_at,
        direction,
        probabilities,
        expectedDeltaCellWidths,
        sample,
        nearestIds,
        parameters,
        lockPrice,
        snapshotCurrentPrice:
          row.current_price == null ? null : Number(row.current_price),
        medianCellWidth,
        currentPrefix,
        cells,
        numberArea,
        displayRange,
        storedNumberArea: integration?.numberArea ?? null,
        storedDisplayRange: integration?.displayRange ?? null,
      })
    : null;
  let numberRanking = null;
  try {
    numberRanking = status === "ready" && adaptive !== null
      ? expectedTrajectoryNumberRanking({
          adaptive,
          cells,
          lockPrice,
          medianCellWidth,
          cutoffAt: row.trajectory_shadow_cutoff_at,
        })
      : null;
  } catch {
    return null;
  }
  const storedNumberRanking = integration?.numberRanking ?? null;
  if (
    numberRanking === null
      ? storedNumberRanking !== null
      : !sameTrajectoryValue(storedNumberRanking, numberRanking)
  ) {
    return null;
  }
  const readyProbabilitiesValid =
    probabilities !== null &&
    typeof probabilities === "object" &&
    !Array.isArray(probabilities) &&
    ["up", "down", "flat"].every(
      (key) =>
        Number.isFinite(probabilities[key]) &&
        probabilities[key] >= 0 &&
        probabilities[key] <= 1,
    ) &&
    Math.abs(
      probabilities.up + probabilities.down + probabilities.flat - 1,
    ) <= 1e-9;
  const readyShapeValid =
    status === "ready"
      ? ["up", "down", "flat"].includes(direction) &&
        readyProbabilitiesValid &&
        Number.isFinite(expectedDeltaCellWidths) &&
        Number.isFinite(lockPrice) &&
        Number.isFinite(medianCellWidth) &&
        medianCellWidth > 0 &&
        sample !== null &&
        typeof sample === "object" &&
        !Array.isArray(sample) &&
        row.trajectory_shadow_reason === null
      : direction === null &&
        probabilities === null &&
        expectedDeltaCellWidths === null &&
        typeof row.trajectory_shadow_reason === "string" &&
        row.trajectory_shadow_reason.length > 0;
  if (!readyShapeValid) return null;
  if (
    modelVersion === TRAJECTORY_SHADOW_ADAPTIVE_VERSION &&
    status !== "insufficient_current" &&
    (adaptive === null ||
      (status === "ready" &&
        (numberArea === null || displayRange === null)))
  ) {
    return null;
  }

  let evaluation = null;
  const actualNumber = Number(row.actual_number);
  const hasSettlement =
    row.round_result_id !== null &&
    row.round_result_id !== undefined &&
    Number.isInteger(actualNumber) &&
    actualNumber >= 0 &&
    actualNumber <= 36;
  if (hasSettlement) {
    const directionEvaluable =
      actualPrice !== null &&
      Number.isFinite(actualPrice) &&
      Number.isFinite(lockPrice) &&
      Number.isFinite(medianCellWidth) &&
      medianCellWidth > 0;
    const delta = directionEvaluable ? actualPrice - lockPrice : null;
    const deltaCellWidths = directionEvaluable
      ? delta / medianCellWidth
      : null;
    const actualDirection = directionEvaluable
      ? trajectoryDirection(
          deltaCellWidths,
          Number(parameters.flatThresholdCellWidths),
        )
      : null;
    const rawCell = consistentTrajectoryRawCell(
      row.trajectory_actual_raw_cell,
      actualNumber,
    );
    evaluation = {
      resultId: Number(row.round_result_id),
      actualNumber,
      rawCell,
      actualPrice,
      settledAt: row.settled_at,
      delta,
      deltaCellWidths,
      actualDirection,
      directionHit:
        status === "ready" && actualDirection !== null
          ? row.trajectory_shadow_direction === actualDirection
          : null,
      displayRangeHit:
        status === "ready" && rawCell !== null && displayRange !== null
          ? displayRange.cells.some((cell) => cell.wireCell === rawCell)
          : null,
      q50ExactHit:
        status === "ready" && rawCell !== null && numberArea !== null
          ? numberArea.typical.wireCell === rawCell
          : null,
      fullCorridorHit:
        status === "ready" && rawCell !== null && numberArea !== null
          ? numberArea.corridor.cells.some((cell) => cell.wireCell === rawCell)
          : null,
    };
  }

  return {
    schemaVersion: Number(row.trajectory_shadow_schema_version),
    version: modelVersion,
    modelVersion,
    status,
    reason: row.trajectory_shadow_reason,
    trajectoryId:
      row.trajectory_shadow_trajectory_id == null
        ? null
        : Number(row.trajectory_shadow_trajectory_id),
    cutoffAt: row.trajectory_shadow_cutoff_at,
    lockPrice,
    medianCellWidth,
    direction,
    probabilities,
    expectedDeltaCellWidths,
    sample,
    nearestIds,
    parameters,
    currentPrefix,
    integration: {
      ...integration,
      adaptive,
      numberArea: status === "ready" ? numberArea : null,
      displayRange: status === "ready" ? displayRange : null,
      numberRanking,
    },
    adaptive,
    numberArea: status === "ready" ? numberArea : null,
    displayRange: status === "ready" ? displayRange : null,
    numberRanking,
    evaluation,
    createdAt: row.trajectory_shadow_created_at,
  };
}

function mapTrajectoryMetrics(row) {
  const readyCount = Number(row?.ready_count ?? 0);
  const settledCount = Number(row?.settled_count ?? 0);
  const evaluatedCount = Number(row?.evaluated_count ?? 0);
  const displayRangeHits = Number(row?.display_range_hits ?? 0);
  const q50ExactHits = Number(row?.q50_exact_hits ?? 0);
  const fullCorridorHits = Number(row?.full_corridor_hits ?? 0);
  const rank37ReadyCount = Number(row?.rank37_ready_count ?? 0);
  const rank37SettledCount = Number(row?.rank37_settled_count ?? 0);
  const rank37EvaluatedCount = Number(row?.rank37_evaluated_count ?? 0);
  const rank37Top1Hits = Number(row?.rank37_top1_hits ?? 0);
  const rank37Top3Hits = Number(row?.rank37_top3_hits ?? 0);
  return {
    modelVersion: TRAJECTORY_SHADOW_ADAPTIVE_VERSION,
    displayRangeVersion: TRAJECTORY_DISPLAY_RANGE_VERSION,
    readyCount,
    settledCount,
    pendingCount: Math.max(0, readyCount - settledCount),
    evaluatedCount,
    ungradableCount: Math.max(0, settledCount - evaluatedCount),
    displayRangeHits,
    q50ExactHits,
    fullCorridorHits,
    rank37Version: TRAJECTORY_RANK37_VERSION,
    rank37Basis: TRAJECTORY_RANK37_BASIS,
    rank37ReadyCount,
    rank37SettledCount,
    rank37PendingCount: Math.max(0, rank37ReadyCount - rank37SettledCount),
    rank37EvaluatedCount,
    rank37UngradableCount: Math.max(
      0,
      rank37SettledCount - rank37EvaluatedCount,
    ),
    rank37Top1Hits,
    rank37Top3Hits,
    displayRangeRate:
      evaluatedCount > 0 ? displayRangeHits / evaluatedCount : null,
    q50ExactRate: evaluatedCount > 0 ? q50ExactHits / evaluatedCount : null,
    fullCorridorRate:
      evaluatedCount > 0 ? fullCorridorHits / evaluatedCount : null,
    rank37Top1Rate:
      rank37EvaluatedCount > 0
        ? rank37Top1Hits / rank37EvaluatedCount
        : null,
    rank37Top3Rate:
      rank37EvaluatedCount > 0
        ? rank37Top3Hits / rank37EvaluatedCount
        : null,
    coverageRate: settledCount > 0 ? evaluatedCount / settledCount : null,
  };
}

function buildTrajectoryMetricFact(row, isValid) {
  const empty = {
    readyCount: 0,
    settledCount: 0,
    evaluatedCount: 0,
    displayRangeHits: 0,
    q50ExactHits: 0,
    fullCorridorHits: 0,
    rank37ReadyCount: 0,
    rank37SettledCount: 0,
    rank37EvaluatedCount: 0,
    rank37Top1Hits: 0,
    rank37Top3Hits: 0,
  };
  if (Number(isValid) !== 1) return empty;

  const integration = deserializeJson(row.integration_json);
  const hasSettlement = row.round_result_id !== null
    && row.round_result_id !== undefined;
  const actualNumber = Number(row.actual_number);
  const rawCell = consistentTrajectoryRawCell(row.raw_cell, actualNumber);
  const isGradable = hasSettlement && rawCell !== null;
  const displayCells = integration?.displayRange?.cells;
  const corridorCells = integration?.numberArea?.corridor?.cells;
  const ranking = integration?.numberRanking;
  const rank37Ready = ranking?.version === TRAJECTORY_RANK37_VERSION
    && Number(ranking.evidenceCandidateCount)
      >= TRAJECTORY_RANK37_MIN_EVIDENCE_CANDIDATES;
  const rank37Ranking = Array.isArray(ranking?.ranking) ? ranking.ranking : [];

  return {
    readyCount: 1,
    settledCount: Number(hasSettlement),
    evaluatedCount: Number(isGradable),
    displayRangeHits: Number(
      isGradable
      && Array.isArray(displayCells)
      && displayCells.some((cell) => Number(cell?.wireCell) === rawCell),
    ),
    q50ExactHits: Number(
      isGradable
      && Number(integration?.numberArea?.typical?.wireCell) === rawCell,
    ),
    fullCorridorHits: Number(
      isGradable
      && Array.isArray(corridorCells)
      && corridorCells.some((cell) => Number(cell?.wireCell) === rawCell),
    ),
    rank37ReadyCount: Number(rank37Ready),
    rank37SettledCount: Number(rank37Ready && hasSettlement),
    rank37EvaluatedCount: Number(rank37Ready && isGradable),
    rank37Top1Hits: Number(
      rank37Ready
      && isGradable
      && Number(rank37Ranking[0]?.number) === actualNumber,
    ),
    rank37Top3Hits: Number(
      rank37Ready
      && isGradable
      && rank37Ranking.some(
        (candidate) => Number(candidate?.rank) <= 3
          && Number(candidate?.number) === actualNumber,
      ),
    ),
  };
}

function validLearnedLeaderAudit(decision) {
  const learning = decision?.learning;
  if (
    !learning
    || typeof learning !== "object"
    || Array.isArray(learning)
    || learning.version !== LEARNED_LEADER_LEARNING_VERSION
    || !["cold_start", "adaptive"].includes(learning.status)
    || !Number.isSafeInteger(learning.trainingCount)
    || learning.trainingCount < 0
    || !Number.isSafeInteger(learning.eligibleRowCount)
    || learning.eligibleRowCount < learning.trainingCount
    || !Number.isSafeInteger(learning.skippedIncompleteFamilyCount)
    || learning.skippedIncompleteFamilyCount < 0
    || !Number.isSafeInteger(learning.excludedNotPastCount)
    || learning.excludedNotPastCount < 0
    || learning.learningCutoffAt !== decision.lockedAt
    || (learning.trainingCount === 0) !== (learning.trainingThroughId === null)
    || (learning.trainingCount === 0) !== (learning.lastTrainingCompletedAt === null)
    || (
      learning.lastTrainingCompletedAt !== null
      && (
        !Number.isFinite(Date.parse(learning.lastTrainingCompletedAt))
        || Date.parse(learning.lastTrainingCompletedAt) >= Date.parse(decision.lockedAt)
      )
    )
    || !learning.parameters
    || typeof learning.parameters !== "object"
    || Array.isArray(learning.parameters)
    || Object.keys(learning.parameters).length
      !== Object.keys(LEARNED_LEADER_DEFAULTS).length
    || Object.entries(LEARNED_LEADER_DEFAULTS).some(
      ([key, value]) => learning.parameters[key] !== value,
    )
    || learning.status !== (
      learning.trainingCount < LEARNED_LEADER_DEFAULTS.minimumAdaptiveTrainingCount
        ? "cold_start"
        : "adaptive"
    )
  ) {
    return false;
  }

  if (decision.status === "unavailable") {
    return decision.reason === "no_valid_family"
      && decision.leaderMass === null
      && decision.runnerUpMass === null
      && decision.margin === null
      && decision.tieCount === 0
      && decision.tieBreakApplied === false
      && decision.sourceCount === 0
      && decision.familyCount === 0;
  }

  const top = decision.ranking?.[0];
  if (
    !top
    || decision.reason !== learning.status
    || !Array.isArray(decision.sourceManifest)
    || decision.sourceManifest.some((source) => (
      !source?.cursor
      || typeof source.cursor !== "object"
      || Array.isArray(source.cursor)
      || source.cursor.cutoffAt !== decision.lockedAt
    ))
  ) return false;
  const tied = decision.ranking.filter((candidate) => (
    Math.abs(candidate.mass - top.mass) <= 1e-12
    && candidate.familySupportCount === top.familySupportCount
  ));
  return Number.isSafeInteger(decision.tieCount)
    && decision.tieCount === tied.length
    && decision.tieBreakApplied === (tied.length > 1);
}

function mapForecastPredictiveLeader(row) {
  if (
    row?.leader_forecast_id === null
    || row?.leader_forecast_id === undefined
  ) {
    return null;
  }
  const rawSnapshot = deserializeJson(row.leader_snapshot_json);
  const decision = normalizeLearnedLeaderDecision(rawSnapshot);
  const forecastId = Number(row.leader_forecast_id);
  const schemaVersion = Number(row.leader_schema_version);
  const trainingCount = Number(row.leader_training_count);
  const trainingThroughForecastId = row.leader_training_through_forecast_id == null
    ? null
    : Number(row.leader_training_through_forecast_id);
  const trainingThroughResultId = row.leader_training_through_result_id == null
    ? null
    : Number(row.leader_training_through_result_id);
  const predictedNumber = row.leader_predicted_number == null
    ? null
    : Number(row.leader_predicted_number);
  const score = row.leader_score == null ? null : Number(row.leader_score);
  const historyMaxResultId = row.leader_history_max_result_id == null
    ? null
    : Number(row.leader_history_max_result_id);
  const expectedTrainingResultId = row.leader_expected_training_result_id == null
    ? null
    : Number(row.leader_expected_training_result_id);
  if (
    !decision
    || !validLearnedLeaderAudit(decision)
    || !Number.isSafeInteger(forecastId)
    || forecastId < 1
    || forecastId !== Number(row.forecast_id)
    || schemaVersion !== LEARNED_LEADER_SCHEMA_VERSION
    || row.leader_algorithm_version !== LEARNED_LEADER_ALGORITHM_VERSION
    || row.leader_status !== decision.status
    || row.leader_locked_at !== decision.lockedAt
    || row.locked_at !== decision.lockedAt
    || !Number.isSafeInteger(trainingCount)
    || trainingCount !== decision.learning.trainingCount
    || (
      trainingThroughForecastId === null
        ? decision.learning.trainingThroughId !== null
        : String(trainingThroughForecastId) !== decision.learning.trainingThroughId
    )
    || (trainingCount === 0) !== (trainingThroughResultId === null)
    || trainingThroughResultId !== expectedTrainingResultId
    || predictedNumber !== decision.leaderNumber
    || (
      score === null
        ? decision.leaderMass !== null
        : !Number.isFinite(score) || Math.abs(score - decision.leaderMass) > 1e-12
    )
    || !Number.isFinite(Date.parse(row.leader_created_at))
    || Date.parse(row.leader_created_at) < Date.parse(decision.lockedAt)
  ) {
    return null;
  }
  for (const source of decision.sourceManifest) {
    if (
      source.family === "price"
      && Number(source.cursor.forecastId) !== forecastId
    ) {
      return null;
    }
    if (
      source.family === "conditional-history"
      && Number(source.cursor.historyMaxResultId) !== historyMaxResultId
    ) {
      return null;
    }
  }

  let evaluation = null;
  if (
    decision.status === "ready"
    && row.actual_number !== null
    && row.actual_number !== undefined
  ) {
    try {
      evaluation = {
        resultId: Number(row.round_result_id),
        settledAt: row.settled_at,
        createdAt: row.settlement_created_at,
        ...evaluateLearnedLeaderDecision(decision, Number(row.actual_number)),
      };
    } catch {
      return null;
    }
  }

  return {
    ...decision,
    forecastId,
    historyMaxResultId,
    trainingThroughForecastId,
    trainingThroughResultId,
    createdAt: row.leader_created_at,
    evaluation,
  };
}

function mapPredictiveLeaderMetrics(rows) {
  const leaders = rows
    .map(mapForecastPredictiveLeader)
    .filter((leader) => leader?.status === "ready");
  const settled = leaders.filter((leader) => leader.evaluation !== null);
  const top1Hits = settled.reduce(
    (total, leader) => total + Number(leader.evaluation.top1Hit),
    0,
  );
  const top3Hits = settled.reduce(
    (total, leader) => total + Number(leader.evaluation.top3Hit),
    0,
  );
  const meanBrierLoss = settled.length === 0
    ? null
    : settled.reduce(
        (total, leader) => total + leader.evaluation.combinedBrierLoss,
        0,
      ) / settled.length;
  return {
    algorithmVersion: LEARNED_LEADER_ALGORITHM_VERSION,
    readyCount: leaders.length,
    settledCount: settled.length,
    pendingCount: Math.max(0, leaders.length - settled.length),
    top1Hits,
    top3Hits,
    top1Rate: settled.length > 0 ? top1Hits / settled.length : null,
    top3Rate: settled.length > 0 ? top3Hits / settled.length : null,
    meanBrierLoss,
    uniformBrierLoss: LEARNED_LEADER_UNIFORM_BRIER_LOSS,
    beatsUniform:
      meanBrierLoss === null ? null : meanBrierLoss < LEARNED_LEADER_UNIFORM_BRIER_LOSS,
  };
}

function mapPredictiveLeaderQualityGate(row) {
  if (
    row?.leader_gate_forecast_id === null
    || row?.leader_gate_forecast_id === undefined
  ) {
    return null;
  }
  const gate = deserializeJson(row.leader_gate_snapshot_json);
  const forecastId = Number(row.forecast_id);
  const sampleSize = Number(gate?.sampleSize);
  const windowStartForecastId = gate?.windowStartForecastId;
  const windowEndForecastId = gate?.windowEndForecastId;
  const throughResultId = gate?.throughResultId;
  if (
    !gate
    || typeof gate !== "object"
    || Array.isArray(gate)
    || Number(row.leader_gate_forecast_id) !== Number(row.forecast_id)
    || row.leader_gate_version !== gate.version
    || row.leader_gate_status !== gate.status
    || Boolean(row.leader_gate_eligible) !== gate.eligible
    || row.leader_gate_cutoff_at !== gate.cutoffAt
    || Number(gate.evaluatedForForecastId) !== forecastId
    || !Number.isSafeInteger(sampleSize)
    || sampleSize < 0
    || sampleSize > PREDICTIVE_LEADER_QUALITY_GATE.windowSize
    || (sampleSize === 0) !== (windowStartForecastId === null)
    || (sampleSize === 0) !== (windowEndForecastId === null)
    || (sampleSize === 0) !== (throughResultId === null)
    || (gate.status === "collecting"
      && sampleSize >= PREDICTIVE_LEADER_QUALITY_GATE.windowSize)
    || (["rejected", "confirmed"].includes(gate.status)
      && sampleSize !== PREDICTIVE_LEADER_QUALITY_GATE.windowSize)
    || (gate.status === "invalid" && sampleSize !== 0)
    || (sampleSize > 0 && (
      !Number.isSafeInteger(windowStartForecastId)
      || windowStartForecastId < 1
      || !Number.isSafeInteger(windowEndForecastId)
      || windowEndForecastId < windowStartForecastId
      || windowEndForecastId >= forecastId
      || !Number.isSafeInteger(throughResultId)
      || throughResultId < 1
    ))
  ) {
    return null;
  }
  return gate;
}

function buildPredictiveLeaderMetricFact(row) {
  const leader = mapForecastPredictiveLeader(row);
  if (leader?.status !== "ready") {
    return {
      readyCount: 0,
      settledCount: 0,
      top1Hits: 0,
      top3Hits: 0,
      combinedBrierLoss: null,
    };
  }
  if (leader.evaluation === null) {
    return {
      readyCount: 1,
      settledCount: 0,
      top1Hits: 0,
      top3Hits: 0,
      combinedBrierLoss: null,
    };
  }
  return {
    readyCount: 1,
    settledCount: 1,
    top1Hits: Number(leader.evaluation.top1Hit),
    top3Hits: Number(leader.evaluation.top3Hit),
    combinedBrierLoss: leader.evaluation.combinedBrierLoss,
  };
}

function predictiveLeaderV7SmoothedPriceSource(
  trajectoryShadow,
  source,
  { forecastId, lockedAt } = {},
) {
  const adaptive = trajectoryShadow?.integration?.adaptive;
  const numberRanking = trajectoryShadow?.integration?.numberRanking;
  const ranking = numberRanking?.ranking;
  const smoothing = numberRanking?.smoothing;
  if (
    !Number.isSafeInteger(forecastId)
    || forecastId < 1
    || trajectoryShadow?.status !== "ready"
    || trajectoryShadow.modelVersion !== TRAJECTORY_SHADOW_ADAPTIVE_VERSION
    || trajectoryShadow.cutoffAt !== lockedAt
    || !Number.isSafeInteger(adaptive?.trainingCount)
    || adaptive.trainingCount < TRAJECTORY_RANK37_MIN_TRAINING_COUNT
    || numberRanking?.version !== TRAJECTORY_RANK37_VERSION
    || numberRanking?.basis !== TRAJECTORY_RANK37_BASIS
    || numberRanking?.candidateCount !== 37
    || !Number.isSafeInteger(numberRanking?.evidenceCandidateCount)
    || numberRanking.evidenceCandidateCount < 0
    || numberRanking.evidenceCandidateCount > 37
    || numberRanking.evidenceMassThreshold
      !== TRAJECTORY_RANK37_EVIDENCE_MASS_THRESHOLD
    || smoothing?.version !== "uniform-mixture-v1"
    || smoothing.weight !== TRAJECTORY_RANK37_SMOOTHING_WEIGHT
    || smoothing.baselineMass !== 1 / 37
    || !Array.isArray(ranking)
    || ranking.length !== 37
  ) {
    return null;
  }

  const numbers = [];
  const weights = [];
  const rawMassByNumber = Array(37).fill(null);
  const seen = new Set();
  let rawTotal = 0;
  let smoothedTotal = 0;
  for (let index = 0; index < ranking.length; index += 1) {
    const candidate = ranking[index];
    const number = Number(candidate?.number);
    const rawMass = Number(candidate?.rawMass);
    const mass = Number(candidate?.mass);
    const expectedMass = (1 - TRAJECTORY_RANK37_SMOOTHING_WEIGHT) * rawMass
      + TRAJECTORY_RANK37_SMOOTHING_WEIGHT / 37;
    if (
      candidate?.rank !== index + 1
      || !Number.isInteger(number)
      || number < 0
      || number > 36
      || seen.has(number)
      || !Number.isFinite(rawMass)
      || rawMass < 0
      || rawMass > 1
      || !Number.isFinite(mass)
      || mass < 0
      || mass > 1
      || Math.abs(mass - expectedMass) > 1e-9
      || (index > 0 && mass - weights[index - 1] > 1e-12)
    ) {
      return null;
    }
    seen.add(number);
    numbers.push(number);
    weights.push(mass);
    rawMassByNumber[number] = rawMass;
    rawTotal += rawMass;
    smoothedTotal += mass;
  }
  if (Math.abs(rawTotal - 1) > 1e-9 || Math.abs(smoothedTotal - 1) > 1e-9) {
    return null;
  }
  const rawEvidenceCandidateCount = rawMassByNumber.filter(
    (mass) => mass > TRAJECTORY_RANK37_EVIDENCE_MASS_THRESHOLD,
  ).length;
  if (rawEvidenceCandidateCount !== numberRanking.evidenceCandidateCount) return null;

  if (source !== null && source !== undefined) {
    if (
      source.id !== "price-trajectory-rank37"
      || source.family !== "price"
      || source.cursor?.forecastId !== forecastId
      || source.cursor?.cutoffAt !== lockedAt
      || !Array.isArray(source.numbers)
      || source.numbers.length !== 37
      || !Array.isArray(source.weights)
      || source.weights.length !== 37
    ) return null;
    const rawEvidenceTotal = rawMassByNumber.reduce((total, mass) => (
      total + (mass > TRAJECTORY_RANK37_EVIDENCE_MASS_THRESHOLD ? mass : 0)
    ), 0);
    const championRawMassByNumber = Array(37).fill(null);
    for (let index = 0; index < source.numbers.length; index += 1) {
      const number = Number(source.numbers[index]);
      const mass = Number(source.weights[index]);
      if (
        !Number.isInteger(number)
        || number < 0
        || number > 36
        || championRawMassByNumber[number] !== null
        || !Number.isFinite(mass)
        || mass < 0
        || mass > 1
      ) return null;
      championRawMassByNumber[number] = mass;
    }
    if (!(rawEvidenceTotal > 0) || championRawMassByNumber.some((mass, number) => {
      const expected = rawMassByNumber[number] > TRAJECTORY_RANK37_EVIDENCE_MASS_THRESHOLD
        ? rawMassByNumber[number] / rawEvidenceTotal
        : 0;
      return Math.abs(mass - expected) > 1e-9;
    })) return null;
  }

  return {
    id: "price-trajectory-rank37-smoothed",
    family: "price",
    numbers,
    weights,
    cursor: {
      forecastId,
      cutoffAt: lockedAt,
      targetHorizon: LEARNED_LEADER_V7_TARGET_HORIZON,
      scoreKind: "smoothed-rank37",
      evidenceCandidateCount: numberRanking.evidenceCandidateCount,
      rawEvidenceCandidateCount,
      rawEvidenceMassThreshold: TRAJECTORY_RANK37_EVIDENCE_MASS_THRESHOLD,
    },
  };
}

export function predictiveLeaderV7SourcesFromChampion(
  champion,
  trajectoryShadow,
  { forecastId, lockedAt } = {},
) {
  if (!champion || !Array.isArray(champion.sourceManifest)) return [];
  const rank37Price = champion.sourceManifest.find(
    (source) => source.id === "price-trajectory-rank37",
  ) ?? null;
  const smoothedPrice = predictiveLeaderV7SmoothedPriceSource(
    trajectoryShadow,
    rank37Price,
    { forecastId, lockedAt },
  );
  const adapted = champion.sourceManifest.flatMap((source) => {
    if (source.id === "price-trajectory-rank37") return [];
    const weights = Array.isArray(source.weights) ? [...source.weights] : null;
    const cursor = {
      ...source.cursor,
      targetHorizon: LEARNED_LEADER_V7_TARGET_HORIZON,
    };
    if (
      source.family === "conditional-history"
      && Number.isSafeInteger(cursor.sampleSize)
      && cursor.sampleSize >= 0
      && cursor.effectiveSampleSize === undefined
    ) {
      cursor.effectiveSampleSize = cursor.sampleSize;
    }
    return [{
      id: source.id,
      family: source.family,
      numbers: [...source.numbers],
      weights,
      cursor,
    }];
  });
  return smoothedPrice ? [smoothedPrice, ...adapted] : adapted;
}

function mapPredictiveLeaderV7Cohort(row) {
  if (!row) return null;
  const rawConfig = deserializeJson(row.config_json);
  let config;
  try {
    config = createLearnedLeaderV7Config(rawConfig);
  } catch {
    return null;
  }
  const firstForecastId = Number(row.first_forecast_id);
  const targetHorizon = Number(row.target_horizon);
  const forecastHorizonSeconds = Number(row.forecast_horizon_seconds);
  const startedMs = Date.parse(row.started_at);
  const cutoffMs = Date.parse(row.source_export_cutoff_at);
  if (
    row.candidate_key !== PREDICTIVE_LEADER_V7_CANDIDATE_CONFIG.candidateId
    || Number(row.schema_version) !== LEARNED_LEADER_V7_SCHEMA_VERSION
    || row.algorithm_version !== LEARNED_LEADER_V7_ALGORITHM_VERSION
    || row.config_version !== LEARNED_LEADER_V7_CONFIG_VERSION
    || targetHorizon !== LEARNED_LEADER_V7_TARGET_HORIZON
    || forecastHorizonSeconds !== PREDICTIVE_LEADER_V7_FORECAST_HORIZON_SECONDS
    || row.mode !== "prospective-shadow"
    || row.source !== PREDICTIVE_SHADOW_FROZEN_STREAM.source
    || row.instrument !== PREDICTIVE_SHADOW_FROZEN_STREAM.instrument
    || !Number.isSafeInteger(firstForecastId)
    || firstForecastId < 1
    || !Number.isFinite(startedMs)
    || !Number.isFinite(cutoffMs)
    || startedMs <= cutoffMs
    || row.started_at !== row.created_at
    || row.config_json !== PREDICTIVE_LEADER_V7_CONFIG_JSON
    || JSON.stringify(config) !== PREDICTIVE_LEADER_V7_CONFIG_JSON
    || row.config_sha256 !== PREDICTIVE_LEADER_V7_CONFIG_SHA256
    || row.source_export_artifact !== PREDICTIVE_LEADER_V7_SOURCE_EXPORT.artifact
    || row.source_export_sha256 !== PREDICTIVE_LEADER_V7_SOURCE_EXPORT.sha256
    || row.source_export_cutoff_at !== PREDICTIVE_LEADER_V7_SOURCE_EXPORT.cutoffAt
  ) return null;
  return {
    candidateId: row.candidate_key,
    schemaVersion: Number(row.schema_version),
    algorithmVersion: row.algorithm_version,
    configVersion: row.config_version,
    targetHorizon,
    forecastHorizonSeconds,
    mode: row.mode,
    source: row.source,
    instrument: row.instrument,
    firstForecastId,
    startedAt: row.started_at,
    config,
    configSha256: row.config_sha256,
    sourceExport: {
      artifact: row.source_export_artifact,
      sha256: row.source_export_sha256,
      cutoffAt: row.source_export_cutoff_at,
    },
    createdAt: row.created_at,
  };
}

function mapForecastPredictiveLeaderV7(row, cohort) {
  if (
    !cohort
    || row?.v7_forecast_id === null
    || row?.v7_forecast_id === undefined
  ) return null;
  const decision = normalizeLearnedLeaderV7Decision(
    deserializeJson(row.v7_snapshot_json),
  );
  const forecastId = Number(row.v7_forecast_id);
  const historyMaxResultId = row.v7_history_max_result_id == null
    ? null
    : Number(row.v7_history_max_result_id);
  const predictedNumber = row.v7_predicted_number == null
    ? null
    : Number(row.v7_predicted_number);
  const leaderMass = row.v7_leader_mass == null
    ? null
    : Number(row.v7_leader_mass);
  const margin = row.v7_margin == null ? null : Number(row.v7_margin);
  if (
    !decision
    || forecastId !== Number(row.forecast_id)
    || forecastId < cohort.firstForecastId
    || Number(row.horizon_seconds) !== cohort.forecastHorizonSeconds
    || row.locked_at < cohort.startedAt
    || Number(row.v7_schema_version) !== cohort.schemaVersion
    || row.v7_algorithm_version !== cohort.algorithmVersion
    || row.v7_config_version !== cohort.configVersion
    || Number(row.v7_target_horizon) !== cohort.targetHorizon
    || row.v7_candidate_key !== cohort.candidateId
    || row.v7_config_sha256 !== cohort.configSha256
    || row.v7_status !== decision.status
    || row.v7_locked_at !== decision.lockedAt
    || row.locked_at !== decision.lockedAt
    || predictedNumber !== decision.leaderNumber
    || (leaderMass === null
      ? decision.leaderMass !== null
      : Math.abs(leaderMass - decision.leaderMass) > 1e-12)
    || (margin === null
      ? decision.margin !== null
      : Math.abs(margin - decision.margin) > 1e-12)
    || Boolean(row.v7_selected) !== decision.selection.eligible
    || JSON.stringify(decision.config) !== PREDICTIVE_LEADER_V7_CONFIG_JSON
    || !Number.isFinite(Date.parse(row.v7_created_at))
    || Date.parse(row.v7_created_at) < Date.parse(decision.lockedAt)
  ) return null;
  for (const source of decision.sourceManifest) {
    if (
      source.family === "price"
      && Number(source.cursor.forecastId) !== forecastId
    ) return null;
    if (
      source.family === "conditional-history"
      && (source.cursor.historyMaxResultId == null
        ? historyMaxResultId !== null
        : Number(source.cursor.historyMaxResultId) !== historyMaxResultId)
    ) return null;
  }

  let evaluation = null;
  if (
    row.actual_number !== null
    && row.actual_number !== undefined
    && !validPredictiveLeaderV7SettlementRow(row)
  ) return null;
  if (
    decision.status === "ready"
    && row.actual_number !== null
    && row.actual_number !== undefined
  ) {
    try {
      evaluation = {
        resultId: Number(row.round_result_id),
        settledAt: row.settled_at,
        createdAt: row.settlement_created_at,
        ...evaluateLearnedLeaderV7Decision(decision, Number(row.actual_number)),
      };
    } catch {
      return null;
    }
  }
  return {
    ...decision,
    forecastId,
    historyMaxResultId,
    createdAt: row.v7_created_at,
    evaluation,
  };
}

function validPredictiveLeaderV7SettlementRow(row) {
  if (row.actual_number === null || row.actual_number === undefined) return true;
  const resultId = Number(row.result_id);
  const actualNumber = Number(row.actual_number);
  const resultNumber = Number(row.result_number);
  const lockedMs = Date.parse(row.locked_at);
  const capturedMs = Date.parse(row.v7_created_at);
  const timestamps = [
    row.settled_at,
    row.settlement_created_at,
    row.result_settled_at,
    row.result_observed_at,
    row.result_created_at,
  ].map(Date.parse);
  return Number.isSafeInteger(resultId)
    && resultId >= 1
    && resultId === Number(row.round_result_id)
    && Number.isInteger(actualNumber)
    && actualNumber >= 0
    && actualNumber <= 36
    && actualNumber === resultNumber
    && row.result_source === row.source
    && row.result_instrument === row.instrument
    && row.result_external_round_id === row.external_round_id
    && row.result_settled_at === row.settled_at
    && Number.isFinite(lockedMs)
    && Number.isFinite(capturedMs)
    && timestamps.every((timestamp) => (
      Number.isFinite(timestamp) && lockedMs < timestamp && capturedMs < timestamp
    ));
}

function summarizePredictiveLeaderV7(leaders) {
  const ready = leaders.filter((leader) => leader?.status === "ready");
  const settled = ready.filter((leader) => leader.evaluation !== null);
  const top1Hits = settled.reduce(
    (total, leader) => total + Number(leader.evaluation.top1Hit),
    0,
  );
  const top3Hits = settled.reduce(
    (total, leader) => total + Number(leader.evaluation.top3Hit),
    0,
  );
  const mean = (selector) => settled.length === 0
    ? null
    : settled.reduce((total, leader) => total + selector(leader), 0) / settled.length;
  const meanBrierLoss = mean((leader) => leader.evaluation.combinedBrierLoss);
  const meanLeaderMass = mean((leader) => leader.leaderMass);
  const top1Rate = settled.length === 0 ? null : top1Hits / settled.length;
  return {
    readyCount: ready.length,
    settledCount: settled.length,
    pendingCount: Math.max(0, ready.length - settled.length),
    top1Hits,
    top1Rate,
    top3Hits,
    top3Rate: settled.length === 0 ? null : top3Hits / settled.length,
    meanLeaderMass,
    calibrationGap: top1Rate === null ? null : top1Rate - meanLeaderMass,
    meanBrierLoss,
    meanClippedLogLoss: mean(
      (leader) => leader.evaluation.combinedClippedLogLoss,
    ),
    uniformBrierLoss: LEARNED_LEADER_V7_UNIFORM_BRIER_LOSS,
    meanBrierImprovementVsUniform: meanBrierLoss === null
      ? null
      : LEARNED_LEADER_V7_UNIFORM_BRIER_LOSS - meanBrierLoss,
  };
}

function wilsonInterval95(hitCount, sampleSize) {
  if (!Number.isSafeInteger(sampleSize) || sampleSize < 1) return null;
  const successes = Number(hitCount);
  const z = 1.959963984540054;
  const proportion = successes / sampleSize;
  const denominator = 1 + z ** 2 / sampleSize;
  const center = (proportion + z ** 2 / (2 * sampleSize)) / denominator;
  const radius = z * Math.sqrt(
    proportion * (1 - proportion) / sampleSize
      + z ** 2 / (4 * sampleSize ** 2),
  ) / denominator;
  return { lower: Math.max(0, center - radius), upper: Math.min(1, center + radius) };
}

function hacMeanInterval95(values) {
  if (!Array.isArray(values) || values.length < 1) return null;
  const sampleSize = values.length;
  const mean = values.reduce((total, value) => total + value, 0) / sampleSize;
  if (sampleSize === 1) {
    return { sampleSize, mean, bandwidth: 0, standardError: null, lower: null, upper: null };
  }
  const centered = values.map((value) => value - mean);
  const bandwidth = Math.min(
    sampleSize - 1,
    Math.max(1, Math.floor(4 * (sampleSize / 100) ** (2 / 9))),
  );
  let longRunVariance = centered.reduce(
    (total, value) => total + value ** 2,
    0,
  ) / sampleSize;
  for (let lag = 1; lag <= bandwidth; lag += 1) {
    let covariance = 0;
    for (let index = lag; index < sampleSize; index += 1) {
      covariance += centered[index] * centered[index - lag];
    }
    covariance /= sampleSize;
    longRunVariance += 2 * (1 - lag / (bandwidth + 1)) * covariance;
  }
  const standardError = Math.sqrt(Math.max(0, longRunVariance) / sampleSize);
  const radius = 1.959963984540054 * standardError;
  return {
    sampleSize,
    mean,
    bandwidth,
    standardError,
    lower: mean - radius,
    upper: mean + radius,
  };
}

function oneSidedExactBinomialPValue(successes, trials) {
  if (!Number.isSafeInteger(trials) || trials < 0) return null;
  if (!Number.isSafeInteger(successes) || successes < 0 || successes > trials) {
    return null;
  }
  if (trials === 0) return 1;
  let probability = 2 ** (-trials);
  let tail = successes === 0 ? probability : 0;
  for (let count = 0; count < trials; count += 1) {
    probability *= (trials - count) / (count + 1);
    if (count + 1 >= successes) tail += probability;
  }
  return Math.min(1, tail);
}

function summarizePredictiveLeaderV7Pairings(pairs) {
  const evaluated = pairs.filter(({ v7, champion }) => (
    v7?.evaluation != null && champion?.evaluation != null
  ));
  const bothCorrect = evaluated.filter(({ v7, champion }) => (
    v7.evaluation.top1Hit && champion.evaluation.top1Hit
  )).length;
  const v7Only = evaluated.filter(({ v7, champion }) => (
    v7.evaluation.top1Hit && !champion.evaluation.top1Hit
  )).length;
  const championOnly = evaluated.filter(({ v7, champion }) => (
    !v7.evaluation.top1Hit && champion.evaluation.top1Hit
  )).length;
  const neitherCorrect = evaluated.length - bothCorrect - v7Only - championOnly;
  const brierDeltas = evaluated.map(({ v7, champion }) => (
    v7.evaluation.combinedBrierLoss - champion.evaluation.combinedBrierLoss
  ));
  const discordantCount = v7Only + championOnly;
  return {
    pairedCount: evaluated.length,
    bothCorrect,
    v7Only,
    championOnly,
    discordantCount,
    v7BetterOneSidedExactPValue: oneSidedExactBinomialPValue(
      v7Only,
      discordantCount,
    ),
    neitherCorrect,
    deltaTop1Rate: evaluated.length === 0
      ? null
      : (v7Only - championOnly) / evaluated.length,
    meanBrierDelta: evaluated.length === 0
      ? null
      : brierDeltas.reduce((total, value) => total + value, 0) / evaluated.length,
    brierDeltaHac95: hacMeanInterval95(brierDeltas),
  };
}

function mapCurrentCellHorizonCohort(row) {
  if (!row) return null;
  const firstTrajectoryId = Number(row.first_trajectory_id);
  if (
    row.cohort_key !== CURRENT_CELL_HORIZON_SHADOW_COHORT_KEY
    || Number(row.schema_version) !== CURRENT_CELL_HORIZON_SHADOW_SCHEMA_VERSION
    || row.algorithm_version !== CURRENT_CELL_HORIZON_SHADOW_ALGORITHM_VERSION
    || row.config_version !== CURRENT_CELL_HORIZON_SHADOW_CONFIG_VERSION
    || Number(row.horizon_seconds) !== CURRENT_CELL_HORIZON_SHADOW_CONFIG.horizonSeconds
    || row.mode !== CURRENT_CELL_HORIZON_SHADOW_CONFIG.mode
    || row.source !== CURRENT_CELL_HORIZON_SHADOW_SOURCE
    || row.instrument !== CURRENT_CELL_HORIZON_SHADOW_INSTRUMENT
    || !Number.isSafeInteger(firstTrajectoryId)
    || firstTrajectoryId < 1
    || row.config_json !== CURRENT_CELL_HORIZON_SHADOW_CONFIG_JSON
    || row.config_sha256 !== CURRENT_CELL_HORIZON_SHADOW_CONFIG_SHA256
    || row.source_export_artifact
      !== CURRENT_CELL_HORIZON_SHADOW_SOURCE_EXPORT.artifact
    || row.source_export_sha256
      !== CURRENT_CELL_HORIZON_SHADOW_SOURCE_EXPORT.sha256
    || row.source_export_cutoff_at
      !== CURRENT_CELL_HORIZON_SHADOW_SOURCE_EXPORT.cutoffAt
    || !Number.isFinite(Date.parse(row.started_at))
    || row.started_at !== row.created_at
    || Date.parse(row.started_at) <= Date.parse(row.source_export_cutoff_at)
  ) return null;
  return {
    cohortKey: row.cohort_key,
    schemaVersion: Number(row.schema_version),
    algorithmVersion: row.algorithm_version,
    configVersion: row.config_version,
    horizonSeconds: Number(row.horizon_seconds),
    mode: row.mode,
    source: row.source,
    instrument: row.instrument,
    firstTrajectoryId,
    startedAt: row.started_at,
    config: CURRENT_CELL_HORIZON_SHADOW_CONFIG,
    configSha256: row.config_sha256,
    sourceExport: {
      artifact: row.source_export_artifact,
      sha256: row.source_export_sha256,
      cutoffAt: row.source_export_cutoff_at,
    },
    createdAt: row.created_at,
  };
}

function mapCurrentCellHorizonSnapshot(row, cohort) {
  if (!cohort || row?.shadow_trajectory_id == null) return null;
  const snapshot = normalizeCurrentCellHorizonShadow(
    deserializeJson(row.shadow_snapshot_json),
  );
  const trajectoryId = Number(row.shadow_trajectory_id);
  const predictedNumber = row.shadow_predicted_number == null
    ? null
    : Number(row.shadow_predicted_number);
  const leaderWireCell = row.shadow_leader_wire_cell == null
    ? null
    : Number(row.shadow_leader_wire_cell);
  const leaderProbability = row.shadow_leader_probability == null
    ? null
    : Number(row.shadow_leader_probability);
  const runnerUpProbability = row.shadow_runner_up_probability == null
    ? null
    : Number(row.shadow_runner_up_probability);
  const margin = row.shadow_margin == null ? null : Number(row.shadow_margin);
  if (
    !snapshot
    || trajectoryId !== Number(row.trajectory_id)
    || trajectoryId < cohort.firstTrajectoryId
    || snapshot.trajectoryId !== trajectoryId
    || snapshot.source !== row.source
    || snapshot.instrument !== row.instrument
    || snapshot.externalRoundId !== row.external_round_id
    || snapshot.bettingClosesAt !== row.betting_closes_at
    || snapshot.cohortKey !== cohort.cohortKey
    || Number(row.shadow_schema_version) !== cohort.schemaVersion
    || row.shadow_algorithm_version !== cohort.algorithmVersion
    || row.shadow_config_version !== cohort.configVersion
    || row.shadow_config_sha256 !== cohort.configSha256
    || row.shadow_status !== snapshot.status
    || row.shadow_reason !== snapshot.reason
    || row.shadow_cutoff_at !== snapshot.cutoffAt
    || row.shadow_captured_at !== snapshot.capturedAt
    || predictedNumber !== snapshot.leaderNumber
    || leaderWireCell !== snapshot.leaderWireCell
    || (leaderProbability === null
      ? snapshot.leaderProbability !== null
      : Math.abs(leaderProbability - snapshot.leaderProbability) > 1e-12)
    || (runnerUpProbability === null
      ? snapshot.runnerUpProbability !== null
      : Math.abs(runnerUpProbability - snapshot.runnerUpProbability) > 1e-12)
    || (margin === null
      ? snapshot.margin !== null
      : Math.abs(margin - snapshot.margin) > 1e-12)
    || row.shadow_created_at < snapshot.capturedAt
    || JSON.stringify(snapshot.config) !== CURRENT_CELL_HORIZON_SHADOW_CONFIG_JSON
  ) return null;

  let evaluation = null;
  if (row.evaluation_trajectory_id != null) {
    const actualNumber = Number(row.evaluation_actual_number);
    let expected;
    try {
      expected = evaluateCurrentCellHorizonShadow(snapshot, actualNumber);
    } catch {
      return null;
    }
    const stored = deserializeJson(row.evaluation_json);
    const resultTimes = [
      row.result_settled_at,
      row.result_observed_at,
      row.result_created_at,
    ].map(Date.parse);
    if (
      Number(row.evaluation_trajectory_id) !== trajectoryId
      || row.evaluation_cohort_key !== cohort.cohortKey
      || Number(row.evaluation_round_result_id) !== Number(row.result_id)
      || actualNumber !== Number(row.result_number)
      || row.result_source !== row.source
      || row.result_instrument !== row.instrument
      || row.result_external_round_id !== row.external_round_id
      || resultTimes.some((time) => (
        !Number.isFinite(time) || time <= Date.parse(snapshot.capturedAt)
      ))
      || row.evaluation_evaluated_at < row.result_created_at
      || JSON.stringify(stored) !== JSON.stringify(expected)
      || Boolean(row.evaluation_top1_hit) !== expected.top1Hit
      || Math.abs(Number(row.evaluation_brier_loss) - expected.brierLoss) > 1e-12
      || Math.abs(
        Number(row.evaluation_clipped_log_loss) - expected.clippedLogLoss,
      ) > 1e-12
    ) return null;
    evaluation = {
      resultId: Number(row.result_id),
      settledAt: row.result_settled_at,
      evaluatedAt: row.evaluation_evaluated_at,
      ...expected,
    };
  }
  return {
    ...snapshot,
    createdAt: row.shadow_created_at,
    evaluation,
  };
}

function summarizeCurrentCellHorizonSnapshots(snapshots) {
  const ready = snapshots.filter((snapshot) => snapshot?.status === "ready");
  const settled = ready.filter((snapshot) => snapshot.evaluation !== null);
  const top1Hits = settled.reduce(
    (total, snapshot) => total + Number(snapshot.evaluation.top1Hit),
    0,
  );
  const mean = (selector) => settled.length === 0
    ? null
    : settled.reduce((total, snapshot) => total + selector(snapshot), 0)
      / settled.length;
  const top1Rate = settled.length === 0 ? null : top1Hits / settled.length;
  const meanLeaderProbability = mean((snapshot) => snapshot.leaderProbability);
  const meanBrierLoss = mean((snapshot) => snapshot.evaluation.brierLoss);
  return {
    readyCount: ready.length,
    settledCount: settled.length,
    pendingCount: Math.max(0, ready.length - settled.length),
    top1Hits,
    top1Rate,
    meanLeaderProbability,
    calibrationGap: top1Rate === null
      ? null
      : top1Rate - meanLeaderProbability,
    meanBrierLoss,
    meanClippedLogLoss: mean(
      (snapshot) => snapshot.evaluation.clippedLogLoss,
    ),
    uniformBrierLoss: CURRENT_CELL_HORIZON_SHADOW_UNIFORM_BRIER_LOSS,
    uniformClippedLogLoss: CURRENT_CELL_HORIZON_SHADOW_UNIFORM_LOG_LOSS,
    meanBrierImprovementVsUniform: meanBrierLoss === null
      ? null
      : CURRENT_CELL_HORIZON_SHADOW_UNIFORM_BRIER_LOSS - meanBrierLoss,
  };
}

function summarizeCurrentCellV5Pairings(pairs) {
  const evaluated = pairs.filter(({ current, champion }) => (
    current?.evaluation != null && champion?.evaluation != null
  ));
  const bothCorrect = evaluated.filter(({ current, champion }) => (
    current.evaluation.top1Hit && champion.evaluation.top1Hit
  )).length;
  const currentOnly = evaluated.filter(({ current, champion }) => (
    current.evaluation.top1Hit && !champion.evaluation.top1Hit
  )).length;
  const v5Only = evaluated.filter(({ current, champion }) => (
    !current.evaluation.top1Hit && champion.evaluation.top1Hit
  )).length;
  const neitherCorrect = evaluated.length - bothCorrect - currentOnly - v5Only;
  const brierDeltas = evaluated.map(({ current, champion }) => (
    current.evaluation.brierLoss - champion.evaluation.combinedBrierLoss
  ));
  const logLossDeltas = evaluated.map(({ current, champion }) => (
    current.evaluation.clippedLogLoss
      - currentCellHorizonClippedLogLoss(
        champion.combinedDistribution,
        champion.evaluation.actualNumber,
      )
  ));
  const mean = (values) => values.length === 0
    ? null
    : values.reduce((total, value) => total + value, 0) / values.length;
  const discordantCount = currentOnly + v5Only;
  return {
    pairedCount: evaluated.length,
    bothCorrect,
    currentOnly,
    v5Only,
    neitherCorrect,
    discordantCount,
    currentBetterOneSidedExactPValue: oneSidedExactBinomialPValue(
      currentOnly,
      discordantCount,
    ),
    deltaTop1Rate: evaluated.length === 0
      ? null
      : (currentOnly - v5Only) / evaluated.length,
    meanBrierDelta: mean(brierDeltas),
    brierDeltaHac95: hacMeanInterval95(brierDeltas),
    meanClippedLogLossDelta: mean(logLossDeltas),
    clippedLogLossDeltaHac95: hacMeanInterval95(logLossDeltas),
  };
}

function mapCurrentCellPairedV5(row) {
  const champion = mapForecastPredictiveLeader({
    ...row,
    round_result_id: row.v5_round_result_id,
    actual_number: row.v5_actual_number,
    settled_at: row.v5_settled_at,
    settlement_created_at: row.v5_settlement_created_at,
  });
  if (!champion || row.v5_actual_number == null) return champion;
  const lockedMs = Date.parse(row.locked_at);
  const resultTimes = [
    row.v5_settled_at,
    row.v5_settlement_created_at,
    row.v5_result_settled_at,
    row.v5_result_observed_at,
    row.v5_result_created_at,
  ].map(Date.parse);
  if (
    Number(row.v5_settlement_forecast_id) !== Number(row.forecast_id)
    || Number(row.v5_round_result_id) !== Number(row.v5_result_id)
    || Number(row.v5_actual_number) !== Number(row.v5_result_number)
    || row.v5_result_source !== row.source
    || row.v5_result_instrument !== row.instrument
    || row.v5_result_external_round_id !== row.external_round_id
    || row.v5_result_settled_at !== row.v5_settled_at
    || !Number.isFinite(lockedMs)
    || resultTimes.some((time) => !Number.isFinite(time) || time <= lockedMs)
  ) return null;
  return champion;
}

function currentCellFlatPaperSimulation(snapshots) {
  let balance = CURRENT_CELL_HORIZON_SHADOW_PAPER_STARTING_BALANCE;
  let attemptedCount = 0;
  let settledCount = 0;
  let hitCount = 0;
  let totalStaked = 0;
  let grossPayout = 0;
  let stoppedAtTrajectoryId = null;
  for (const snapshot of snapshots) {
    if (snapshot?.status !== "ready") continue;
    if (balance < CURRENT_CELL_HORIZON_SHADOW_PAPER_STAKE) {
      stoppedAtTrajectoryId = snapshot.trajectoryId;
      break;
    }
    attemptedCount += 1;
    totalStaked += CURRENT_CELL_HORIZON_SHADOW_PAPER_STAKE;
    balance -= CURRENT_CELL_HORIZON_SHADOW_PAPER_STAKE;
    if (snapshot.evaluation === null) continue;
    settledCount += 1;
    if (snapshot.evaluation.top1Hit) {
      hitCount += 1;
      const payout = CURRENT_CELL_HORIZON_SHADOW_PAPER_STAKE
        * CURRENT_CELL_HORIZON_SHADOW_PAPER_GROSS_MULTIPLIER;
      grossPayout += payout;
      balance += payout;
    }
  }
  return {
    mode: "audit-only-flat-paper",
    executionEnabled: false,
    startingBalance: CURRENT_CELL_HORIZON_SHADOW_PAPER_STARTING_BALANCE,
    stakePerRound: CURRENT_CELL_HORIZON_SHADOW_PAPER_STAKE,
    grossPayoutMultiplier: CURRENT_CELL_HORIZON_SHADOW_PAPER_GROSS_MULTIPLIER,
    attemptedCount,
    settledCount,
    pendingCount: attemptedCount - settledCount,
    hitCount,
    totalStaked,
    grossPayout,
    netResult: grossPayout - totalStaked,
    currentBalance: balance,
    stoppedAtTrajectoryId,
  };
}

function mapPredictiveLeaderMetricFacts(rows) {
  const readyCount = rows.reduce(
    (total, row) => total + Number(row.ready_count),
    0,
  );
  const settledCount = rows.reduce(
    (total, row) => total + Number(row.settled_count),
    0,
  );
  const top1Hits = rows.reduce(
    (total, row) => total + Number(row.top1_hits),
    0,
  );
  const top3Hits = rows.reduce(
    (total, row) => total + Number(row.top3_hits),
    0,
  );
  const totalBrierLoss = rows.reduce(
    (total, row) => total + Number(row.combined_brier_loss ?? 0),
    0,
  );
  const meanBrierLoss = settledCount === 0
    ? null
    : totalBrierLoss / settledCount;
  return {
    algorithmVersion: LEARNED_LEADER_ALGORITHM_VERSION,
    readyCount,
    settledCount,
    pendingCount: Math.max(0, readyCount - settledCount),
    top1Hits,
    top3Hits,
    top1Rate: settledCount > 0 ? top1Hits / settledCount : null,
    top3Rate: settledCount > 0 ? top3Hits / settledCount : null,
    meanBrierLoss,
    uniformBrierLoss: LEARNED_LEADER_UNIFORM_BRIER_LOSS,
    beatsUniform:
      meanBrierLoss === null ? null : meanBrierLoss < LEARNED_LEADER_UNIFORM_BRIER_LOSS,
  };
}

function mapPrecloseForecast(row) {
  if (!row) return null;
  const rawRankedNumbers = deserializeJson(row.ranked_numbers_json);
  const rankedNumbers = Array.isArray(rawRankedNumbers)
    ? rawRankedNumbers.map(Number)
    : [];
  const pairHistory = mapForecastPairHistory(row);
  const consensus = mapForecastConsensus(row, rankedNumbers);
  const trajectoryShadow = mapForecastTrajectoryShadow(row);
  const predictiveLeader = mapForecastPredictiveLeader(row);
  const predictiveLeaderQualityGate = mapPredictiveLeaderQualityGate(row);
  return {
    id: Number(row.forecast_id ?? row.id),
    snapshotId: Number(row.snapshot_id),
    source: row.source,
    instrument: row.instrument,
    roundId: row.external_round_id,
    horizonSeconds: Number(row.horizon_seconds),
    bettingClosesAt: row.betting_closes_at,
    roundEndsAt: row.round_ends_at,
    factorAt: row.factor_at,
    lockedAt: row.locked_at,
    leadSeconds: Number(row.lead_time_ms) / 1_000,
    persistedAt: row.persisted_at,
    availableLeadSeconds: Number(row.persisted_lead_time_ms) / 1_000,
    currentPrice: Number(row.current_price),
    startPrice: Number(row.start_price),
    currentNumber: Number(row.current_number),
    projectedPrice: Number(row.predicted_price),
    predictedNumber: Number(row.predicted_number),
    rankedNumbers,
    modelVersion: row.model_version,
    features: deserializeJson(row.features_json),
    pairHistory,
    consensus,
    trajectoryShadow,
    predictiveLeader,
    predictiveLeaderQualityGate,
    settlement:
      row.actual_number === null || row.actual_number === undefined
        ? null
        : {
            resultId: Number(row.round_result_id),
            actualNumber: Number(row.actual_number),
            settledAt: row.settled_at,
            top1Hit: Boolean(row.top1_hit),
            top3Hit: Boolean(row.top3_hit),
            currentCellHit: Boolean(row.current_cell_hit),
            createdAt: row.settlement_created_at,
          },
    createdAt: row.forecast_created_at ?? row.created_at,
  };
}

function mapPredictiveLeaderForecast(row) {
  if (!row) return null;
  return {
    id: Number(row.forecast_id),
    source: row.source,
    instrument: row.instrument,
    roundId: row.external_round_id,
    horizonSeconds: Number(row.horizon_seconds),
    bettingClosesAt: row.betting_closes_at,
    roundEndsAt: row.round_ends_at,
    lockedAt: row.locked_at,
    predictiveLeader: mapForecastPredictiveLeader(row),
    predictiveLeaderQualityGate: mapPredictiveLeaderQualityGate(row),
    settlement:
      row.actual_number === null || row.actual_number === undefined
        ? null
        : {
            resultId: Number(row.round_result_id),
            actualNumber: Number(row.actual_number),
            settledAt: row.settled_at,
            createdAt: row.settlement_created_at,
          },
  };
}

function mapPredictiveLeaderOutcome(row) {
  const resultId = Number(row.round_result_id);
  const resultNumber = Number(row.result_number);
  const continuityEpoch = Number(row.continuity_epoch);
  const forecastId = row.forecast_id === null || row.forecast_id === undefined
    ? null
    : Number(row.forecast_id);
  const base = {
    resultId: Number.isSafeInteger(resultId) && resultId >= 1 ? resultId : null,
    externalRoundId: row.result_external_round_id,
    settledAt: row.result_settled_at,
    resultNumber: Number.isInteger(resultNumber)
      && resultNumber >= 0
      && resultNumber <= 36
      ? resultNumber
      : null,
    continuityEpoch: Number.isSafeInteger(continuityEpoch) && continuityEpoch >= 0
      ? continuityEpoch
      : null,
    forecastId: Number.isSafeInteger(forecastId) && forecastId >= 1
      ? forecastId
      : null,
    lockedAt: row.locked_at ?? null,
    leaderNumber: null,
    hit: null,
    algorithmVersion: null,
  };
  if (
    base.resultId === null
    || base.resultNumber === null
    || base.continuityEpoch === null
    || !Number.isFinite(Date.parse(base.settledAt))
  ) {
    return { ...base, availability: "invalid" };
  }

  if (row.settlement_forecast_id === null || row.settlement_forecast_id === undefined) {
    return { ...base, availability: "unavailable" };
  }
  if (
    base.forecastId === null
    || row.snapshot_id === null
    || row.snapshot_id === undefined
    || row.leader_forecast_id === null
    || row.leader_forecast_id === undefined
  ) {
    return { ...base, availability: "unavailable" };
  }

  const lockedMs = Date.parse(row.locked_at);
  const settledMs = Date.parse(row.result_settled_at);
  const snapshotPersistedMs = Date.parse(row.snapshot_persisted_at);
  const forecastCreatedMs = Date.parse(row.forecast_created_at);
  const leaderCreatedMs = Date.parse(row.leader_created_at);
  const settlementMatchesResult = Number(row.settlement_round_result_id) === base.resultId
    && Number(row.actual_number) === base.resultNumber
    && row.settlement_settled_at === row.result_settled_at
    && row.external_round_id === row.result_external_round_id;
  if (
    !settlementMatchesResult
    || !Number.isFinite(lockedMs)
    || !Number.isFinite(snapshotPersistedMs)
    || !Number.isFinite(forecastCreatedMs)
    || !Number.isFinite(leaderCreatedMs)
    || snapshotPersistedMs < lockedMs
    || forecastCreatedMs < lockedMs
    || leaderCreatedMs < lockedMs
    || snapshotPersistedMs >= settledMs
    || forecastCreatedMs >= settledMs
    || leaderCreatedMs >= settledMs
    || lockedMs >= settledMs
  ) {
    return { ...base, availability: "invalid" };
  }

  const leader = mapForecastPredictiveLeader({
    ...row,
    round_result_id: row.settlement_round_result_id,
    settled_at: row.settlement_settled_at,
  });
  if (!leader) return { ...base, availability: "invalid" };
  if (leader.status !== "ready") {
    return {
      ...base,
      availability: "unavailable",
      algorithmVersion: leader.algorithmVersion,
    };
  }
  if (leader.evaluation === null) return { ...base, availability: "invalid" };

  return {
    ...base,
    availability: "ready",
    leaderNumber: leader.leaderNumber,
    hit: leader.evaluation.top1Hit,
    algorithmVersion: leader.algorithmVersion,
  };
}

function mapPrecloseForecastHit(row) {
  const rawRankedNumbers = deserializeJson(row.ranked_numbers_json);
  if (!Array.isArray(rawRankedNumbers) || rawRankedNumbers.length !== 3) {
    throw new Error("stored forecast ranking is invalid");
  }

  return {
    roundId: row.external_round_id,
    rankedNumbers: rawRankedNumbers.map(Number),
    actualNumber: Number(row.actual_number),
    lockedAt: row.locked_at,
    settledAt: row.settled_at,
    modelVersion: row.model_version,
  };
}

function mapVirtualBetSession(row) {
  if (!row) return null;
  const nextStake = row.next_stake == null ? null : Number(row.next_stake);
  const totalStaked = Number(row.total_staked);
  const projectedGrossPayout =
    nextStake === null
      ? null
      : nextStake * Number(row.gross_payout_multiplier);
  const projectedNetIfHit =
    nextStake === null
      ? null
      : projectedGrossPayout - totalStaked - nextStake;

  return {
    id: Number(row.id),
    source: row.source,
    instrument: row.instrument,
    continuityEpoch: Number(row.continuity_epoch),
    targetNumber: Number(row.target_number),
    status: row.status,
    endReason:
      row.end_reason ??
      (row.status === "completed"
        ? "hit"
        : row.status === "invalid_gap"
          ? "integrity_gap"
          : null),
    triggerRoundsMissed: Number(row.trigger_rounds_missed),
    attemptBudget:
      row.attempt_budget == null ? null : Number(row.attempt_budget),
    activatedAfterResultId: Number(row.activated_after_result_id),
    attemptCount: Number(row.attempt_count),
    missCount: Number(row.miss_count),
    totalStaked,
    nextStake,
    lastBetResultId:
      row.last_bet_result_id == null ? null : Number(row.last_bet_result_id),
    completedResultId:
      row.completed_result_id == null ? null : Number(row.completed_result_id),
    grossPayout: Number(row.gross_payout),
    netResult: row.net_result == null ? null : Number(row.net_result),
    selectedAt: row.armed_at,
    startedAt: row.started_at ?? null,
    armedAt: row.armed_at,
    lastEventAt: row.last_event_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    model: {
      modelVersion: row.model_version,
      initialStake: Number(row.initial_stake),
      stakeStep: Number(row.stake_step),
      maxStake: Number(row.max_stake),
      grossPayoutMultiplier: Number(row.gross_payout_multiplier),
      payoutIncludesStake: Boolean(row.payout_includes_stake),
    },
    projectedTotalLossIfMiss:
      nextStake === null ? null : totalStaked + nextStake,
    projectedGrossPayout,
    projectedNetIfHit,
    capped:
      nextStake === null ? false : nextStake === Number(row.max_stake),
    recoveryPossible:
      projectedNetIfHit === null ? null : projectedNetIfHit >= 0,
  };
}

function mapVirtualBetOutcome(row) {
  if (!row) return null;
  return {
    betId: Number(row.bet_id),
    resultId: Number(row.round_result_id),
    roundId: row.external_round_id ?? null,
    sessionId: Number(row.session_id),
    attemptNumber: Number(row.attempt_number),
    targetNumber: Number(row.target_number),
    resultNumber: Number(row.result_number),
    outcome: row.outcome,
    stake: Number(row.stake),
    grossPayout: Number(row.gross_payout),
    totalStakedAfter: Number(row.total_staked_after),
    sessionNetAfter: Number(row.net_after),
    nextStake:
      row.next_stake_after == null ? null : Number(row.next_stake_after),
    recoveryPossible: Boolean(row.recovery_possible),
    occurredAt: row.occurred_at,
  };
}

function emitLog(logger, level, payload, message) {
  try {
    logger?.[level]?.(payload, message);
  } catch {
    // Logging must never change ingestion semantics.
  }
}

export class RouletteDatabase {
  constructor({
    path = ":memory:",
    logger = null,
    gapThresholdSeconds = 135,
    virtualStartingBalance = DEFAULT_VIRTUAL_STARTING_BALANCE,
    virtualWindowStartingBalance = DEFAULT_VIRTUAL_WINDOW_STARTING_BALANCE,
    predictiveLeaderLegacyAccountEnabled = true,
    clock = () => new Date(),
  } = {}) {
    if (typeof path !== "string" || path.trim() === "") {
      throw new TypeError("path must be a non-empty string");
    }
    if (typeof clock !== "function") {
      throw new TypeError("clock must be a function");
    }
    if (typeof predictiveLeaderLegacyAccountEnabled !== "boolean") {
      throw new TypeError("predictiveLeaderLegacyAccountEnabled must be a boolean");
    }

    this.logger = logger;
    this.clock = clock;
    this.gapThresholdMs = normalizedGapSeconds(gapThresholdSeconds) * 1_000;
    this.virtualStartingBalance = normalizedVirtualStartingBalance(
      virtualStartingBalance,
    );
    this.virtualWindowStartingBalance = normalizedVirtualStartingBalance(
      virtualWindowStartingBalance,
    );
    this.predictiveLeaderLegacyAccountEnabled =
      predictiveLeaderLegacyAccountEnabled;
    this.followerTop5HitCurveCache = new Map();
    this.followerTop5GatedAccountCache = new Map();
    this.trajectoryAdaptiveValidationCache = new Map();
    this.trajectoryAdaptiveValidationCacheHits = 0;
    this.trajectoryAdaptiveValidationCacheMisses = 0;
    this.trajectoryAdaptiveValidationWarmupPromise = null;
    this.trajectoryAdaptiveValidationWarmupKey = null;
    this.closed = false;
    this.sqlite = new DatabaseSync(path);

    try {
      const existingSchemaVersion = Number(
        this.sqlite.prepare("PRAGMA user_version").get().user_version,
      );
      if (!Number.isSafeInteger(existingSchemaVersion) || existingSchemaVersion > 33) {
        throw new Error(
          `database schema version ${existingSchemaVersion} is newer than supported version 33`,
        );
      }
      this.sqlite.function(
        TRAJECTORY_ADAPTIVE_VALIDATOR_SQL_FUNCTION,
        { deterministic: true },
        this.#validAdaptiveTrajectorySnapshotSql.bind(this),
      );
      this.sqlite.exec("PRAGMA foreign_keys = ON");
      this.sqlite.exec("PRAGMA busy_timeout = 5000");
      this.sqlite.exec("PRAGMA journal_mode = WAL");
      this.#migrate();
      this.#initializeFollowerTop5Trackers();
    } catch (error) {
      this.sqlite.close();
      this.closed = true;
      throw error;
    }
  }

  #validAdaptiveTrajectorySnapshotSql(
    status,
    cutoffAt,
    snapshotLockedAt,
    lockPrice,
    snapshotCurrentPrice,
    medianCellWidth,
    direction,
    probabilitiesJson,
    expectedDeltaCellWidths,
    sampleJson,
    nearestIdsJson,
    parametersJson,
    currentPrefixJson,
    integrationJson,
    cellsJson,
  ) {
    const values = [
      status,
      cutoffAt,
      snapshotLockedAt,
      lockPrice,
      snapshotCurrentPrice,
      medianCellWidth,
      direction,
      probabilitiesJson,
      expectedDeltaCellWidths,
      sampleJson,
      nearestIdsJson,
      parametersJson,
      currentPrefixJson,
      integrationJson,
      cellsJson,
    ];
    const fingerprint = trajectoryAdaptiveValidatorFingerprint(values);
    const cached = this.trajectoryAdaptiveValidationCache.get(fingerprint);
    if (cached !== undefined) {
      this.trajectoryAdaptiveValidationCacheHits += 1;
      return cached;
    }

    this.trajectoryAdaptiveValidationCacheMisses += 1;
    const result = validAdaptiveTrajectorySnapshotSql(...values);
    this.trajectoryAdaptiveValidationCache.set(fingerprint, result);
    return result;
  }

  #writeTrajectoryMetricFacts(validatedRows) {
    if (validatedRows.length === 0) return;
    const statement = this.sqlite.prepare(`
      INSERT INTO forecast_trajectory_metric_facts (
        forecast_id, validator_version, ready_count, settled_count,
        evaluated_count, display_range_hits, q50_exact_hits,
        full_corridor_hits, rank37_ready_count, rank37_settled_count,
        rank37_evaluated_count, rank37_top1_hits, rank37_top3_hits
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(forecast_id) DO UPDATE SET
        validator_version = excluded.validator_version,
        ready_count = excluded.ready_count,
        settled_count = excluded.settled_count,
        evaluated_count = excluded.evaluated_count,
        display_range_hits = excluded.display_range_hits,
        q50_exact_hits = excluded.q50_exact_hits,
        full_corridor_hits = excluded.full_corridor_hits,
        rank37_ready_count = excluded.rank37_ready_count,
        rank37_settled_count = excluded.rank37_settled_count,
        rank37_evaluated_count = excluded.rank37_evaluated_count,
        rank37_top1_hits = excluded.rank37_top1_hits,
        rank37_top3_hits = excluded.rank37_top3_hits
    `);
    const clearDirty = this.sqlite.prepare(`
      DELETE FROM forecast_trajectory_metric_dirty WHERE forecast_id = ?
    `);
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      for (const { row, isValid } of validatedRows) {
        const fact = buildTrajectoryMetricFact(row, isValid);
        statement.run(
          Number(row.forecast_id),
          TRAJECTORY_METRIC_FACT_VERSION,
          fact.readyCount,
          fact.settledCount,
          fact.evaluatedCount,
          fact.displayRangeHits,
          fact.q50ExactHits,
          fact.fullCorridorHits,
          fact.rank37ReadyCount,
          fact.rank37SettledCount,
          fact.rank37EvaluatedCount,
          fact.rank37Top1Hits,
          fact.rank37Top3Hits,
        );
        clearDirty.run(Number(row.forecast_id));
      }
      this.sqlite.exec("COMMIT");
    } catch (error) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // Preserve the materialization error.
      }
      throw error;
    }
  }

  #ensureTrajectoryMetricFacts(source, instrument) {
    const rows = this.sqlite.prepare(`
      WITH candidate_ids AS (
        SELECT forecast_id FROM forecast_trajectory_metric_dirty
        UNION
        SELECT trajectory_shadows.forecast_id
        FROM forecast_trajectory_shadows AS trajectory_shadows
          INDEXED BY forecast_trajectory_shadows_metric_idx
        LEFT JOIN forecast_trajectory_metric_facts AS metric_facts
          ON metric_facts.forecast_id = trajectory_shadows.forecast_id
         AND metric_facts.validator_version = ?
        WHERE trajectory_shadows.model_version = ?
          AND trajectory_shadows.status = 'ready'
          AND metric_facts.forecast_id IS NULL
      )
      SELECT
        trajectory_shadows.forecast_id,
        trajectory_shadows.status,
        trajectory_shadows.cutoff_at,
        snapshots.locked_at AS snapshot_locked_at,
        trajectory_shadows.lock_price,
        snapshots.current_price AS snapshot_current_price,
        trajectory_shadows.median_cell_width,
        trajectory_shadows.direction,
        trajectory_shadows.probabilities_json,
        trajectory_shadows.expected_delta_cell_widths,
        trajectory_shadows.sample_json,
        trajectory_shadows.nearest_ids_json,
        trajectory_shadows.parameters_json,
        trajectory_shadows.current_prefix_json,
        trajectory_shadows.integration_json,
        snapshots.cells_json,
        settlements.round_result_id,
        settlements.actual_number,
        settlement_results.raw_cell
      FROM candidate_ids AS metric_dirty
      CROSS JOIN forecast_trajectory_shadows AS trajectory_shadows
        ON trajectory_shadows.forecast_id = metric_dirty.forecast_id
      JOIN round_forecasts AS forecasts
        ON forecasts.id = trajectory_shadows.forecast_id
      JOIN forecast_snapshots AS snapshots
        ON snapshots.id = forecasts.snapshot_id
      LEFT JOIN forecast_settlements AS settlements
        ON settlements.forecast_id = forecasts.id
      LEFT JOIN round_results AS settlement_results
        ON settlement_results.id = settlements.round_result_id
      WHERE snapshots.source = ?
        AND snapshots.instrument = ?
        AND trajectory_shadows.model_version = ?
        AND trajectory_shadows.status = 'ready'
      ORDER BY trajectory_shadows.forecast_id
    `).all(
      TRAJECTORY_METRIC_FACT_VERSION,
      TRAJECTORY_SHADOW_ADAPTIVE_VERSION,
      source,
      instrument,
      TRAJECTORY_SHADOW_ADAPTIVE_VERSION,
    );
    const validatedRows = rows.map((row) => ({
      row,
      isValid: this.#validAdaptiveTrajectorySnapshotSql(
        ...trajectoryAdaptiveValidatorValuesFromRow(row),
      ),
    }));
    this.#writeTrajectoryMetricFacts(validatedRows);
  }

  #assertOpen() {
    if (this.closed) {
      throw new Error("database is closed");
    }
  }

  #migrate() {
    const startingVersion = Number(
      this.sqlite.prepare("PRAGMA user_version").get().user_version,
    );
    if (!Number.isSafeInteger(startingVersion) || startingVersion > 33) {
      throw new Error(
        `database schema version ${startingVersion} is newer than supported version 33`,
      );
    }
    this.sqlite.exec(`
      BEGIN IMMEDIATE;

      CREATE TABLE IF NOT EXISTS cycles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        instrument TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN ('active', 'completed', 'invalid_gap')
        ),
        origin TEXT NOT NULL,
        started_at TEXT NOT NULL,
        last_event_at TEXT NOT NULL,
        completed_at TEXT,
        survivor_number INTEGER CHECK (
          survivor_number IS NULL OR survivor_number BETWEEN 0 AND 36
        ),
        event_count INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
        eliminated_count INTEGER NOT NULL DEFAULT 0 CHECK (
          eliminated_count BETWEEN 0 AND 36
        ),
        created_at TEXT NOT NULL,
        CHECK (
          (status = 'active' AND completed_at IS NULL AND survivor_number IS NULL)
          OR
          (status = 'completed' AND completed_at IS NOT NULL AND survivor_number IS NOT NULL)
          OR
          (status = 'invalid_gap' AND completed_at IS NOT NULL AND survivor_number IS NULL)
        )
      );

      CREATE UNIQUE INDEX IF NOT EXISTS cycles_one_active_stream
        ON cycles(source, instrument)
        WHERE status = 'active';

      CREATE INDEX IF NOT EXISTS cycles_completed_at_idx
        ON cycles(completed_at DESC)
        WHERE status = 'completed';

      CREATE TABLE IF NOT EXISTS round_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        instrument TEXT NOT NULL,
        settled_at TEXT NOT NULL,
        result_number INTEGER NOT NULL CHECK (result_number BETWEEN 0 AND 36),
        price REAL,
        observed_at TEXT NOT NULL,
        external_round_id TEXT,
        raw_cell INTEGER CHECK (raw_cell IS NULL OR raw_cell BETWEEN 0 AND 37),
        fingerprint TEXT NOT NULL UNIQUE,
        raw_payload TEXT,
        cycle_id INTEGER REFERENCES cycles(id),
        continuity_epoch INTEGER NOT NULL DEFAULT 0 CHECK (continuity_epoch >= 0),
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS round_results_settled_at_idx
        ON round_results(settled_at DESC, id DESC);

      CREATE INDEX IF NOT EXISTS round_results_number_history_idx
        ON round_results(source, instrument, result_number, settled_at DESC);

      CREATE INDEX IF NOT EXISTS round_results_stream_time_idx
        ON round_results(source, instrument, settled_at, id);

      CREATE UNIQUE INDEX IF NOT EXISTS round_results_external_round_idx
        ON round_results(source, instrument, external_round_id)
        WHERE external_round_id IS NOT NULL;

      CREATE INDEX IF NOT EXISTS round_results_cycle_id_idx
        ON round_results(cycle_id, id);

      CREATE TABLE IF NOT EXISTS cycle_numbers (
        cycle_id INTEGER NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
        number INTEGER NOT NULL CHECK (number BETWEEN 0 AND 36),
        eliminated_at TEXT,
        eliminated_by_result_id INTEGER REFERENCES round_results(id),
        PRIMARY KEY (cycle_id, number),
        CHECK (
          (eliminated_at IS NULL AND eliminated_by_result_id IS NULL)
          OR
          (eliminated_at IS NOT NULL AND eliminated_by_result_id IS NOT NULL)
        )
      );

      CREATE TABLE IF NOT EXISTS cycle_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cycle_id INTEGER NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
        round_result_id INTEGER NOT NULL UNIQUE REFERENCES round_results(id),
        result_number INTEGER NOT NULL CHECK (result_number BETWEEN 0 AND 36),
        eliminated INTEGER NOT NULL CHECK (eliminated IN (0, 1)),
        remaining_count INTEGER NOT NULL CHECK (remaining_count BETWEEN 1 AND 36),
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS cycle_events_cycle_id_idx
        ON cycle_events(cycle_id, id);

      CREATE TABLE IF NOT EXISTS incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        source TEXT NOT NULL,
        instrument TEXT NOT NULL,
        message TEXT,
        incident_key TEXT,
        detected_at TEXT NOT NULL,
        details_json TEXT,
        cycle_id INTEGER REFERENCES cycles(id),
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS incidents_detected_at_idx
        ON incidents(detected_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS stream_state (
        source TEXT NOT NULL,
        instrument TEXT NOT NULL,
        continuity_epoch INTEGER NOT NULL DEFAULT 0 CHECK (continuity_epoch >= 0),
        PRIMARY KEY (source, instrument)
      );

      COMMIT;
    `);

    // Later migrations add durable gap idempotency and scope external round
    // identifiers per instrument. Fresh databases already have the columns;
    // older databases are upgraded in place before indexes are rebuilt.
    const incidentColumns = this.sqlite.prepare("PRAGMA table_info(incidents)").all();
    if (!incidentColumns.some((column) => column.name === "incident_key")) {
      this.sqlite.exec("ALTER TABLE incidents ADD COLUMN incident_key TEXT");
    }
    const resultColumns = this.sqlite.prepare("PRAGMA table_info(round_results)").all();
    const addedContinuityEpoch = !resultColumns.some(
      (column) => column.name === "continuity_epoch",
    );
    if (addedContinuityEpoch) {
      this.sqlite.exec(
        "ALTER TABLE round_results ADD COLUMN continuity_epoch INTEGER NOT NULL DEFAULT 0 CHECK (continuity_epoch >= 0)",
      );
    }
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS stream_state (
        source TEXT NOT NULL,
        instrument TEXT NOT NULL,
        continuity_epoch INTEGER NOT NULL DEFAULT 0 CHECK (continuity_epoch >= 0),
        PRIMARY KEY (source, instrument)
      );
      CREATE INDEX IF NOT EXISTS round_results_number_history_idx
        ON round_results(source, instrument, result_number, settled_at DESC);
      CREATE INDEX IF NOT EXISTS round_results_stream_time_idx
        ON round_results(source, instrument, settled_at, id);
      CREATE INDEX IF NOT EXISTS round_results_continuity_idx
        ON round_results(source, instrument, continuity_epoch, settled_at, id);
    `);

    if (addedContinuityEpoch || startingVersion < 6) {
      this.#backfillContinuityEpochs();
    }
    this.sqlite.exec(`
      BEGIN IMMEDIATE;

      CREATE TABLE IF NOT EXISTS virtual_bet_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        instrument TEXT NOT NULL,
        continuity_epoch INTEGER NOT NULL CHECK (continuity_epoch >= 0),
        target_number INTEGER NOT NULL CHECK (target_number BETWEEN 0 AND 36),
        status TEXT NOT NULL CHECK (
          status IN ('armed', 'active', 'completed', 'invalid_gap')
        ),
        trigger_rounds_missed INTEGER NOT NULL CHECK (trigger_rounds_missed >= 0),
        activated_after_result_id INTEGER NOT NULL REFERENCES round_results(id),
        model_version TEXT NOT NULL,
        initial_stake INTEGER NOT NULL CHECK (initial_stake > 0),
        stake_step INTEGER NOT NULL CHECK (stake_step > 0),
        max_stake INTEGER NOT NULL CHECK (max_stake > 0),
        gross_payout_multiplier INTEGER NOT NULL CHECK (gross_payout_multiplier > 0),
        payout_includes_stake INTEGER NOT NULL CHECK (payout_includes_stake IN (0, 1)),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        miss_count INTEGER NOT NULL DEFAULT 0 CHECK (miss_count >= 0),
        total_staked INTEGER NOT NULL DEFAULT 0 CHECK (total_staked >= 0),
        next_stake INTEGER CHECK (next_stake IS NULL OR next_stake > 0),
        last_bet_result_id INTEGER REFERENCES round_results(id),
        completed_result_id INTEGER REFERENCES round_results(id),
        gross_payout INTEGER NOT NULL DEFAULT 0 CHECK (gross_payout >= 0),
        net_result INTEGER,
        armed_at TEXT NOT NULL,
        last_event_at TEXT NOT NULL,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        CHECK (
          (status IN ('armed', 'active') AND completed_at IS NULL AND next_stake IS NOT NULL)
          OR
          (status IN ('completed', 'invalid_gap') AND completed_at IS NOT NULL AND next_stake IS NULL)
        )
      );

      CREATE UNIQUE INDEX IF NOT EXISTS virtual_bet_sessions_one_live_stream_idx
        ON virtual_bet_sessions(source, instrument)
        WHERE status IN ('armed', 'active');

      CREATE INDEX IF NOT EXISTS virtual_bet_sessions_stream_history_idx
        ON virtual_bet_sessions(source, instrument, id DESC);

      CREATE TABLE IF NOT EXISTS virtual_bets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES virtual_bet_sessions(id) ON DELETE CASCADE,
        round_result_id INTEGER NOT NULL UNIQUE REFERENCES round_results(id),
        attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
        stake INTEGER NOT NULL CHECK (stake > 0),
        result_number INTEGER NOT NULL CHECK (result_number BETWEEN 0 AND 36),
        outcome TEXT NOT NULL CHECK (outcome IN ('miss', 'hit')),
        gross_payout INTEGER NOT NULL CHECK (gross_payout >= 0),
        total_staked_after INTEGER NOT NULL CHECK (total_staked_after > 0),
        net_after INTEGER NOT NULL,
        next_stake_after INTEGER CHECK (
          next_stake_after IS NULL OR next_stake_after > 0
        ),
        recovery_possible INTEGER NOT NULL CHECK (recovery_possible IN (0, 1)),
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(session_id, attempt_number)
      );

      CREATE INDEX IF NOT EXISTS virtual_bets_session_idx
        ON virtual_bets(session_id, attempt_number);

      COMMIT;
    `);

    // Version 8 adds a durable, stream-scoped paper bankroll. The column is
    // added separately so existing v7 databases keep every session and bet.
    // SQLite applies ALTER TABLE transactionally, making an interrupted
    // migration safe to retry on the next start.
    const virtualSessionColumns = this.sqlite
      .prepare("PRAGMA table_info(virtual_bet_sessions)")
      .all();
    const hasEndReason = virtualSessionColumns.some(
      (column) => column.name === "end_reason",
    );
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      if (!hasEndReason) {
        this.sqlite.exec(`
          ALTER TABLE virtual_bet_sessions
          ADD COLUMN end_reason TEXT CHECK (
            end_reason IS NULL OR end_reason IN (
              'hit', 'integrity_gap', 'bankroll_exhausted'
            )
          )
        `);
      }
      this.sqlite.exec(`
        UPDATE virtual_bet_sessions
        SET end_reason = CASE
          WHEN status = 'completed' THEN 'hit'
          WHEN status = 'invalid_gap' THEN 'integrity_gap'
          ELSE end_reason
        END
        WHERE end_reason IS NULL
          AND status IN ('completed', 'invalid_gap');

        CREATE TABLE IF NOT EXISTS virtual_bankrolls (
          source TEXT NOT NULL,
          instrument TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('running', 'exhausted')),
          initial_balance INTEGER NOT NULL CHECK (initial_balance >= 0),
          current_balance INTEGER NOT NULL CHECK (current_balance >= 0),
          next_stake INTEGER CHECK (next_stake IS NULL OR next_stake > 0),
          started_at TEXT NOT NULL,
          exhausted_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (source, instrument),
          CHECK (
            (status = 'running' AND exhausted_at IS NULL AND next_stake IS NULL)
            OR
            (status = 'exhausted' AND exhausted_at IS NOT NULL AND next_stake IS NOT NULL)
          )
        );

        PRAGMA user_version = 8;
        COMMIT;
      `);
    } catch (error) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // Preserve the migration error.
      }
      throw error;
    }

    this.#repairStartupInvariantsV24(startingVersion);
    this.#migrateContinuityReconciliationV9();
    this.#migratePrecloseForecastsV10();
    this.#migrateForecastPairSnapshotsV11();
    this.#migrateForecastConsensusSnapshotsV12();
    this.#migrateFollowerTop5TrackerV13();
    this.#migrateForecastConsensusPolicyV14();
    this.#migrateRoundTrajectoriesV15();
    this.#migratePredictiveLeaderSnapshotsV16();
    this.#migratePredictiveLeaderAccountV17();
    this.#migratePredictiveLeaderAccountVoidV18();
    this.#migratePredictiveLeaderAccountLadderResetV19(startingVersion);
    this.#migrateFollowerTop5GatedAccountDepositsV23();
    this.#finalizeSchemaVersionV24(startingVersion);
    this.#migrateTrajectoryMetricFactsV25(startingVersion);
    this.#migratePredictiveLeaderQualityAndSignalV26(startingVersion);
    this.#migratePredictiveLeaderV7ShadowV27(startingVersion);
    this.#migrateCurrentCellHorizonShadowV28(startingVersion);
    this.#migrateCurrentCellHorizonMetadataVoidsV29(startingVersion);
    this.#migratePredictiveLeaderV7PaperCampaignV30(startingVersion);
    this.#migratePredictiveLeaderV7PaperLadderCampaignV31(startingVersion);
    this.#migratePredictiveLeaderWarmTop1PaperCampaignV32(startingVersion);
    this.#migrateVirtualWindowBettorV33(startingVersion);
  }

  #migratePrecloseForecastsV10() {
    this.sqlite.exec(`
      BEGIN IMMEDIATE;

      CREATE TABLE IF NOT EXISTS forecast_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        instrument TEXT NOT NULL,
        external_round_id TEXT NOT NULL,
        horizon_seconds INTEGER NOT NULL CHECK (horizon_seconds BETWEEN 5 AND 60),
        betting_closes_at TEXT NOT NULL,
        round_ends_at TEXT NOT NULL,
        factor_at TEXT NOT NULL,
        locked_at TEXT NOT NULL,
        lead_time_ms INTEGER NOT NULL CHECK (lead_time_ms >= 5000),
        persisted_at TEXT NOT NULL,
        persisted_lead_time_ms INTEGER NOT NULL CHECK (persisted_lead_time_ms >= 5000),
        current_price REAL NOT NULL,
        start_price REAL NOT NULL,
        current_number INTEGER NOT NULL CHECK (current_number BETWEEN 0 AND 36),
        cells_json TEXT NOT NULL,
        features_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(source, instrument, external_round_id, horizon_seconds),
        CHECK (factor_at <= locked_at),
        CHECK (locked_at <= persisted_at),
        CHECK (persisted_at < betting_closes_at)
      );

      CREATE INDEX IF NOT EXISTS forecast_snapshots_stream_time_idx
        ON forecast_snapshots(source, instrument, locked_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS round_forecasts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_id INTEGER NOT NULL UNIQUE REFERENCES forecast_snapshots(id),
        model_version TEXT NOT NULL,
        predicted_price REAL NOT NULL,
        predicted_number INTEGER NOT NULL CHECK (predicted_number BETWEEN 0 AND 36),
        ranked_numbers_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS round_forecasts_model_idx
        ON round_forecasts(model_version, id DESC);

      CREATE TABLE IF NOT EXISTS forecast_settlements (
        forecast_id INTEGER PRIMARY KEY REFERENCES round_forecasts(id),
        round_result_id INTEGER NOT NULL UNIQUE REFERENCES round_results(id),
        actual_number INTEGER NOT NULL CHECK (actual_number BETWEEN 0 AND 36),
        settled_at TEXT NOT NULL,
        top1_hit INTEGER NOT NULL CHECK (top1_hit IN (0, 1)),
        top3_hit INTEGER NOT NULL CHECK (top3_hit IN (0, 1)),
        current_cell_hit INTEGER NOT NULL CHECK (current_cell_hit IN (0, 1)),
        created_at TEXT NOT NULL
      );

      PRAGMA user_version = 10;
      COMMIT;
    `);
  }

  #migrateForecastPairSnapshotsV11() {
    this.sqlite.exec(`
      BEGIN IMMEDIATE;

      CREATE TABLE IF NOT EXISTS forecast_pair_snapshots (
        forecast_id INTEGER PRIMARY KEY REFERENCES round_forecasts(id),
        schema_version INTEGER NOT NULL CHECK (schema_version = 1),
        status TEXT NOT NULL CHECK (
          status IN ('ready', 'no_anchor', 'no_samples')
        ),
        history_cutoff_at TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        history_max_result_id INTEGER REFERENCES round_results(id),
        anchor_result_id INTEGER REFERENCES round_results(id),
        anchor_number INTEGER CHECK (
          anchor_number IS NULL OR anchor_number BETWEEN 0 AND 36
        ),
        anchor_settled_at TEXT,
        anchor_continuity_epoch INTEGER CHECK (
          anchor_continuity_epoch IS NULL OR anchor_continuity_epoch >= 0
        ),
        sample_size INTEGER NOT NULL CHECK (sample_size >= 0),
        observed_follower_count INTEGER NOT NULL CHECK (
          observed_follower_count BETWEEN 0 AND 37
        ),
        pair_top3_json TEXT NOT NULL,
        model_top3_json TEXT NOT NULL,
        overlap_numbers_json TEXT NOT NULL,
        overlap_count INTEGER NOT NULL CHECK (overlap_count BETWEEN 0 AND 3),
        same_top1 INTEGER CHECK (same_top1 IS NULL OR same_top1 IN (0, 1)),
        exact_order INTEGER NOT NULL CHECK (exact_order IN (0, 1)),
        created_at TEXT NOT NULL,
        CHECK (
          (status = 'no_anchor' AND anchor_result_id IS NULL AND sample_size = 0)
          OR
          (status = 'no_samples' AND anchor_result_id IS NOT NULL AND sample_size = 0)
          OR
          (status = 'ready' AND anchor_result_id IS NOT NULL AND sample_size > 0)
        )
      );

      PRAGMA user_version = 11;
      COMMIT;
    `);
  }

  #migrateForecastConsensusSnapshotsV12() {
    this.sqlite.exec(`
      BEGIN IMMEDIATE;

      CREATE TABLE IF NOT EXISTS forecast_consensus_snapshots (
        forecast_id INTEGER PRIMARY KEY REFERENCES round_forecasts(id),
        schema_version INTEGER NOT NULL CHECK (schema_version = 1),
        algorithm_version TEXT NOT NULL CHECK (
          algorithm_version = 'consensus-borda-v1'
        ),
        status TEXT NOT NULL CHECK (
          status IN ('combined', 'model_fallback', 'pair_fallback', 'unavailable')
        ),
        top3_json TEXT NOT NULL CHECK (json_valid(top3_json)),
        inputs_used_json TEXT NOT NULL CHECK (json_valid(inputs_used_json)),
        pair_sample_size INTEGER CHECK (
          pair_sample_size IS NULL OR pair_sample_size >= 0
        ),
        derived_from_snapshot_at TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        CHECK (json_type(top3_json) = 'array'),
        CHECK (json_type(inputs_used_json) = 'array'),
        CHECK (
          (status = 'unavailable' AND json_array_length(top3_json) = 0)
          OR
          (status <> 'unavailable' AND json_array_length(top3_json) = 3)
        ),
        CHECK (
          status = 'unavailable'
          OR (
            json_type(top3_json, '$[0]') = 'integer'
            AND json_type(top3_json, '$[1]') = 'integer'
            AND json_type(top3_json, '$[2]') = 'integer'
            AND json_extract(top3_json, '$[0]') BETWEEN 0 AND 36
            AND json_extract(top3_json, '$[1]') BETWEEN 0 AND 36
            AND json_extract(top3_json, '$[2]') BETWEEN 0 AND 36
            AND json_extract(top3_json, '$[0]') <> json_extract(top3_json, '$[1]')
            AND json_extract(top3_json, '$[0]') <> json_extract(top3_json, '$[2]')
            AND json_extract(top3_json, '$[1]') <> json_extract(top3_json, '$[2]')
          )
        ),
        CHECK (
          (status = 'combined' AND inputs_used_json = '["model","pair"]')
          OR
          (status = 'model_fallback' AND inputs_used_json = '["model"]')
          OR
          (status = 'pair_fallback' AND inputs_used_json = '["pair"]')
          OR
          (status = 'unavailable' AND inputs_used_json = '[]')
        ),
        CHECK (
          (status = 'combined' AND reason = 'frozen_model_and_pair')
          OR
          (status = 'model_fallback' AND reason IN (
            'pair_not_ready',
            'invalid_pair_ranking',
            'empty_pair_ranking',
            'pair_snapshot_model_mismatch'
          ))
          OR
          (status = 'pair_fallback' AND reason = 'model_unavailable')
          OR
          (status = 'unavailable' AND reason IN (
            'incomplete_model_ranking',
            'invalid_model_ranking'
          ))
        ),
        CHECK (
          status NOT IN ('combined', 'pair_fallback')
          OR (pair_sample_size IS NOT NULL AND pair_sample_size > 0)
        ),
        CHECK (derived_from_snapshot_at <= created_at)
      );

      PRAGMA user_version = 12;
      COMMIT;
    `);
  }

  #migrateFollowerTop5TrackerV13() {
    this.sqlite.exec(`
      BEGIN IMMEDIATE;

      CREATE TABLE IF NOT EXISTS follower_top5_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        instrument TEXT NOT NULL,
        continuity_epoch INTEGER NOT NULL CHECK (continuity_epoch >= 0),
        status TEXT NOT NULL CHECK (
          status IN ('active', 'completed', 'invalid_gap')
        ),
        end_reason TEXT CHECK (
          end_reason IS NULL OR end_reason IN ('hit', 'integrity_gap')
        ),
        anchor_result_id INTEGER NOT NULL UNIQUE REFERENCES round_results(id),
        anchor_number INTEGER NOT NULL CHECK (anchor_number BETWEEN 0 AND 36),
        top_numbers_json TEXT NOT NULL CHECK (
          json_valid(top_numbers_json)
          AND json_type(top_numbers_json) = 'array'
          AND json_array_length(top_numbers_json) = 5
        ),
        algorithm_version TEXT NOT NULL,
        history_max_result_id INTEGER NOT NULL REFERENCES round_results(id),
        sample_size INTEGER NOT NULL CHECK (sample_size >= 5),
        observed_follower_count INTEGER NOT NULL CHECK (
          observed_follower_count BETWEEN 5 AND 37
        ),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        miss_count INTEGER NOT NULL DEFAULT 0 CHECK (miss_count >= 0),
        last_attempt_result_id INTEGER REFERENCES round_results(id),
        completed_result_id INTEGER REFERENCES round_results(id),
        locked_at TEXT NOT NULL,
        last_event_at TEXT NOT NULL,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        CHECK (history_max_result_id = anchor_result_id),
        CHECK (miss_count <= attempt_count),
        CHECK (
          (
            status = 'active'
            AND end_reason IS NULL
            AND completed_result_id IS NULL
            AND completed_at IS NULL
            AND miss_count = attempt_count
          )
          OR
          (
            status = 'completed'
            AND end_reason = 'hit'
            AND completed_result_id IS NOT NULL
            AND completed_at IS NOT NULL
            AND attempt_count = miss_count + 1
          )
          OR
          (
            status = 'invalid_gap'
            AND end_reason = 'integrity_gap'
            AND completed_result_id IS NULL
            AND completed_at IS NOT NULL
            AND miss_count = attempt_count
          )
        )
      );

      CREATE UNIQUE INDEX IF NOT EXISTS follower_top5_one_active_stream_idx
        ON follower_top5_sessions(source, instrument)
        WHERE status = 'active';

      CREATE INDEX IF NOT EXISTS follower_top5_session_history_idx
        ON follower_top5_sessions(source, instrument, id DESC);

      CREATE TABLE IF NOT EXISTS follower_top5_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL
          REFERENCES follower_top5_sessions(id) ON DELETE CASCADE,
        round_result_id INTEGER NOT NULL UNIQUE REFERENCES round_results(id),
        attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
        result_number INTEGER NOT NULL CHECK (result_number BETWEEN 0 AND 36),
        outcome TEXT NOT NULL CHECK (outcome IN ('miss', 'hit')),
        hit_rank INTEGER CHECK (hit_rank IS NULL OR hit_rank BETWEEN 1 AND 5),
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        CHECK (
          (outcome = 'miss' AND hit_rank IS NULL)
          OR (outcome = 'hit' AND hit_rank IS NOT NULL)
        ),
        UNIQUE(session_id, attempt_number)
      );

      CREATE INDEX IF NOT EXISTS follower_top5_attempts_session_idx
        ON follower_top5_attempts(session_id, attempt_number);

      PRAGMA user_version = 13;
      COMMIT;
    `);
  }

  #migrateForecastConsensusPolicyV14() {
    const table = this.sqlite
      .prepare(`
        SELECT sql
        FROM sqlite_master
        WHERE type = 'table' AND name = 'forecast_consensus_snapshots'
      `)
      .get();
    const schemaSql = typeof table?.sql === "string" ? table.sql : "";
    if (
      schemaSql.includes(
        `'${FORECAST_CONSENSUS_MODEL_AUTHORITATIVE_ALGORITHM_VERSION}'`,
      )
    ) {
      this.sqlite.exec("PRAGMA user_version = 14");
      return;
    }

    const priorCount = Number(
      this.sqlite
        .prepare("SELECT COUNT(*) AS count FROM forecast_consensus_snapshots")
        .get().count,
    );
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite.exec(`
        DROP TABLE IF EXISTS forecast_consensus_snapshots_v14;
        CREATE TABLE forecast_consensus_snapshots_v14 (
          forecast_id INTEGER PRIMARY KEY REFERENCES round_forecasts(id),
          schema_version INTEGER NOT NULL CHECK (schema_version = 1),
          algorithm_version TEXT NOT NULL CHECK (
            algorithm_version IN (
              'consensus-borda-v1',
              'model-authoritative-v1'
            )
          ),
          status TEXT NOT NULL CHECK (
            status IN ('combined', 'model_fallback', 'pair_fallback', 'unavailable')
          ),
          top3_json TEXT NOT NULL CHECK (json_valid(top3_json)),
          inputs_used_json TEXT NOT NULL CHECK (json_valid(inputs_used_json)),
          pair_sample_size INTEGER CHECK (
            pair_sample_size IS NULL OR pair_sample_size >= 0
          ),
          derived_from_snapshot_at TEXT NOT NULL,
          reason TEXT NOT NULL,
          created_at TEXT NOT NULL,
          CHECK (json_type(top3_json) = 'array'),
          CHECK (json_type(inputs_used_json) = 'array'),
          CHECK (
            (status = 'unavailable' AND json_array_length(top3_json) = 0)
            OR
            (status <> 'unavailable' AND json_array_length(top3_json) = 3)
          ),
          CHECK (
            status = 'unavailable'
            OR (
              json_type(top3_json, '$[0]') = 'integer'
              AND json_type(top3_json, '$[1]') = 'integer'
              AND json_type(top3_json, '$[2]') = 'integer'
              AND json_extract(top3_json, '$[0]') BETWEEN 0 AND 36
              AND json_extract(top3_json, '$[1]') BETWEEN 0 AND 36
              AND json_extract(top3_json, '$[2]') BETWEEN 0 AND 36
              AND json_extract(top3_json, '$[0]') <> json_extract(top3_json, '$[1]')
              AND json_extract(top3_json, '$[0]') <> json_extract(top3_json, '$[2]')
              AND json_extract(top3_json, '$[1]') <> json_extract(top3_json, '$[2]')
            )
          ),
          CHECK (
            (status = 'combined' AND inputs_used_json = '["model","pair"]')
            OR
            (status = 'model_fallback' AND inputs_used_json = '["model"]')
            OR
            (status = 'pair_fallback' AND inputs_used_json = '["pair"]')
            OR
            (status = 'unavailable' AND inputs_used_json = '[]')
          ),
          CHECK (
            (
              algorithm_version = 'consensus-borda-v1'
              AND (
                (status = 'combined' AND reason = 'frozen_model_and_pair')
                OR
                (status = 'model_fallback' AND reason IN (
                  'pair_not_ready',
                  'invalid_pair_ranking',
                  'empty_pair_ranking',
                  'pair_snapshot_model_mismatch'
                ))
                OR
                (status = 'pair_fallback' AND reason = 'model_unavailable')
                OR
                (status = 'unavailable' AND reason IN (
                  'incomplete_model_ranking',
                  'invalid_model_ranking'
                ))
              )
            )
            OR
            (
              algorithm_version = 'model-authoritative-v1'
              AND (
                (status = 'model_fallback' AND reason = 'authoritative_model')
                OR
                (status = 'unavailable' AND reason IN (
                  'incomplete_model_ranking',
                  'invalid_model_ranking'
                ))
              )
            )
          ),
          CHECK (
            status NOT IN ('combined', 'pair_fallback')
            OR (pair_sample_size IS NOT NULL AND pair_sample_size > 0)
          ),
          CHECK (derived_from_snapshot_at <= created_at)
        );
      `);
      const copy = this.sqlite.prepare(`
        INSERT INTO forecast_consensus_snapshots_v14 (
          forecast_id, schema_version, algorithm_version, status,
          top3_json, inputs_used_json, pair_sample_size,
          derived_from_snapshot_at, reason, created_at
        )
        SELECT
          forecast_id, schema_version, algorithm_version, status,
          top3_json, inputs_used_json, pair_sample_size,
          derived_from_snapshot_at, reason, created_at
        FROM forecast_consensus_snapshots
      `).run();
      if (Number(copy.changes) !== priorCount) {
        throw new Error("forecast consensus v14 migration did not copy every row");
      }
      this.sqlite.exec(`
        DROP TABLE forecast_consensus_snapshots;
        ALTER TABLE forecast_consensus_snapshots_v14
          RENAME TO forecast_consensus_snapshots;
        PRAGMA user_version = 14;
        COMMIT;
      `);
    } catch (error) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // Preserve the migration error.
      }
      throw error;
    }
  }

  #migrateRoundTrajectoriesV15() {
    this.sqlite.exec(`
      BEGIN IMMEDIATE;

      CREATE TABLE IF NOT EXISTS round_trajectories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        schema_version INTEGER NOT NULL CHECK (schema_version = 1),
        source TEXT NOT NULL,
        instrument TEXT NOT NULL,
        external_round_id TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        betting_closes_at TEXT NOT NULL,
        betting_stops_at TEXT NOT NULL,
        round_ends_at TEXT NOT NULL,
        start_price REAL NOT NULL,
        bottom_price REAL NOT NULL,
        top_price REAL NOT NULL,
        bands_json TEXT NOT NULL CHECK (
          json_valid(bands_json)
          AND json_type(bands_json) = 'array'
          AND json_array_length(bands_json) = 38
        ),
        first_received_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(source, instrument, external_round_id),
        CHECK (starts_at < betting_closes_at),
        CHECK (betting_closes_at <= betting_stops_at),
        CHECK (betting_stops_at < round_ends_at),
        CHECK (bottom_price < top_price),
        CHECK (start_price BETWEEN bottom_price AND top_price),
        CHECK (starts_at <= first_received_at),
        CHECK (first_received_at <= round_ends_at),
        CHECK (first_received_at <= created_at)
      );

      CREATE INDEX IF NOT EXISTS round_trajectories_stream_end_idx
        ON round_trajectories(
          source, instrument, round_ends_at DESC, id DESC
        );

      CREATE TABLE IF NOT EXISTS round_trajectory_ticks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trajectory_id INTEGER NOT NULL REFERENCES round_trajectories(id),
        factor_at TEXT NOT NULL,
        price REAL NOT NULL,
        received_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(trajectory_id, factor_at, price),
        CHECK (factor_at <= received_at),
        CHECK (received_at <= created_at)
      );

      CREATE INDEX IF NOT EXISTS round_trajectory_ticks_prefix_idx
        ON round_trajectory_ticks(
          trajectory_id, factor_at, received_at, id
        );

      CREATE TABLE IF NOT EXISTS forecast_trajectory_shadows (
        forecast_id INTEGER PRIMARY KEY REFERENCES round_forecasts(id),
        trajectory_id INTEGER REFERENCES round_trajectories(id),
        schema_version INTEGER NOT NULL CHECK (schema_version = 1),
        model_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK (
          status IN (
            'ready',
            'insufficient_current',
            'insufficient_history',
            'insufficient_neighbors'
          )
        ),
        reason TEXT,
        cutoff_at TEXT NOT NULL,
        lock_price REAL,
        median_cell_width REAL CHECK (
          median_cell_width IS NULL OR median_cell_width > 0
        ),
        direction TEXT CHECK (
          direction IS NULL OR direction IN ('up', 'down', 'flat')
        ),
        probabilities_json TEXT NOT NULL CHECK (
          json_valid(probabilities_json)
          AND json_type(probabilities_json) IN ('object', 'null')
        ),
        expected_delta_cell_widths REAL,
        sample_json TEXT NOT NULL CHECK (
          json_valid(sample_json)
          AND json_type(sample_json) IN ('object', 'null')
        ),
        nearest_ids_json TEXT NOT NULL CHECK (
          json_valid(nearest_ids_json)
          AND json_type(nearest_ids_json) = 'array'
        ),
        parameters_json TEXT NOT NULL CHECK (
          json_valid(parameters_json)
          AND json_type(parameters_json) = 'object'
        ),
        current_prefix_json TEXT NOT NULL CHECK (
          json_valid(current_prefix_json)
          AND json_type(current_prefix_json) = 'array'
        ),
        integration_json TEXT NOT NULL CHECK (
          json_valid(integration_json)
          AND json_type(integration_json) = 'object'
        ),
        created_at TEXT NOT NULL,
        CHECK (cutoff_at <= created_at),
        CHECK (
          (
            status = 'ready'
            AND trajectory_id IS NOT NULL
            AND reason IS NULL
            AND lock_price IS NOT NULL
            AND median_cell_width IS NOT NULL
            AND direction IS NOT NULL
            AND json_type(probabilities_json) = 'object'
            AND expected_delta_cell_widths IS NOT NULL
          )
          OR
          (
            status <> 'ready'
            AND reason IS NOT NULL
            AND direction IS NULL
            AND json_type(probabilities_json) = 'null'
            AND expected_delta_cell_widths IS NULL
          )
        )
      );

      CREATE INDEX IF NOT EXISTS forecast_trajectory_shadows_model_idx
        ON forecast_trajectory_shadows(model_version, forecast_id DESC);
      CREATE INDEX IF NOT EXISTS forecast_trajectory_shadows_trajectory_idx
        ON forecast_trajectory_shadows(trajectory_id, forecast_id);

      PRAGMA user_version = 15;
      COMMIT;
    `);
  }

  #migratePredictiveLeaderSnapshotsV16() {
    this.sqlite.exec(`
      BEGIN IMMEDIATE;

      CREATE TABLE IF NOT EXISTS forecast_predictive_leader_snapshots (
        forecast_id INTEGER PRIMARY KEY REFERENCES round_forecasts(id),
        schema_version INTEGER NOT NULL CHECK (schema_version = 1),
        algorithm_version TEXT NOT NULL CHECK (
          length(trim(algorithm_version)) > 0
        ),
        status TEXT NOT NULL CHECK (status IN ('ready', 'unavailable')),
        locked_at TEXT NOT NULL,
        history_max_result_id INTEGER REFERENCES round_results(id),
        training_through_forecast_id INTEGER REFERENCES round_forecasts(id),
        training_through_result_id INTEGER REFERENCES round_results(id),
        training_count INTEGER NOT NULL CHECK (training_count >= 0),
        predicted_number INTEGER CHECK (
          predicted_number IS NULL OR predicted_number BETWEEN 0 AND 36
        ),
        score REAL CHECK (score IS NULL OR score BETWEEN 0 AND 1),
        snapshot_json TEXT NOT NULL CHECK (
          json_valid(snapshot_json)
          AND json_type(snapshot_json) = 'object'
        ),
        created_at TEXT NOT NULL,
        CHECK (locked_at <= created_at),
        CHECK (json_extract(snapshot_json, '$.schemaVersion') = schema_version),
        CHECK (json_extract(snapshot_json, '$.algorithmVersion') = algorithm_version),
        CHECK (json_extract(snapshot_json, '$.status') = status),
        CHECK (json_extract(snapshot_json, '$.lockedAt') = locked_at),
        CHECK (json_extract(snapshot_json, '$.learning.trainingCount') = training_count),
        CHECK (
          (
            status = 'ready'
            AND predicted_number IS NOT NULL
            AND score IS NOT NULL
            AND json_extract(snapshot_json, '$.leaderNumber') = predicted_number
            AND json_extract(snapshot_json, '$.leaderMass') = score
          )
          OR
          (
            status = 'unavailable'
            AND predicted_number IS NULL
            AND score IS NULL
            AND json_type(snapshot_json, '$.leaderNumber') = 'null'
            AND json_type(snapshot_json, '$.leaderMass') = 'null'
          )
        ),
        CHECK (
          (training_count = 0 AND training_through_forecast_id IS NULL
            AND training_through_result_id IS NULL)
          OR
          (training_count > 0 AND training_through_forecast_id IS NOT NULL
            AND training_through_result_id IS NOT NULL)
        )
      );

      CREATE INDEX IF NOT EXISTS forecast_predictive_leader_algorithm_idx
        ON forecast_predictive_leader_snapshots(
          algorithm_version, status, forecast_id DESC
        );

      PRAGMA user_version = 16;
      COMMIT;
    `);
  }

  #migratePredictiveLeaderAccountV17() {
    this.sqlite.exec(`
      BEGIN IMMEDIATE;

      CREATE TABLE IF NOT EXISTS predictive_leader_accounts (
        source TEXT NOT NULL,
        instrument TEXT NOT NULL,
        schema_version INTEGER NOT NULL CHECK (schema_version = 1),
        strategy_version TEXT NOT NULL CHECK (length(trim(strategy_version)) > 0),
        leader_algorithm_version TEXT NOT NULL CHECK (
          length(trim(leader_algorithm_version)) > 0
        ),
        status TEXT NOT NULL CHECK (status IN ('running', 'exhausted')),
        initial_balance INTEGER NOT NULL CHECK (initial_balance = 1000),
        current_balance INTEGER NOT NULL CHECK (current_balance >= 0),
        initial_stake INTEGER NOT NULL CHECK (initial_stake = 10),
        stake_step INTEGER NOT NULL CHECK (stake_step = 10),
        max_stake INTEGER NOT NULL CHECK (max_stake = 2500),
        gross_payout_multiplier INTEGER NOT NULL CHECK (
          gross_payout_multiplier = 36
        ),
        payout_includes_stake INTEGER NOT NULL CHECK (
          payout_includes_stake IN (0, 1)
        ),
        next_stake INTEGER NOT NULL CHECK (
          next_stake > 0 AND next_stake <= max_stake
          AND next_stake % stake_step = 0
        ),
        ladder_miss_count INTEGER NOT NULL CHECK (ladder_miss_count >= 0),
        ladder_total_loss INTEGER NOT NULL CHECK (
          ladder_total_loss >= 0 AND ladder_total_loss % stake_step = 0
        ),
        last_continuity_epoch INTEGER CHECK (
          last_continuity_epoch IS NULL OR last_continuity_epoch >= 0
        ),
        continuity_gap_count INTEGER NOT NULL CHECK (continuity_gap_count >= 0),
        pending_forecast_id INTEGER UNIQUE REFERENCES
          forecast_predictive_leader_snapshots(forecast_id),
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        exhausted_at TEXT,
        PRIMARY KEY (source, instrument),
        CHECK ((ladder_miss_count = 0) = (ladder_total_loss = 0)),
        CHECK (
          (status = 'running' AND exhausted_at IS NULL)
          OR
          (status = 'exhausted' AND exhausted_at IS NOT NULL
            AND pending_forecast_id IS NULL AND next_stake > current_balance)
        )
      );

      CREATE TABLE IF NOT EXISTS predictive_leader_account_bets (
        forecast_id INTEGER PRIMARY KEY REFERENCES
          forecast_predictive_leader_snapshots(forecast_id),
        source TEXT NOT NULL,
        instrument TEXT NOT NULL,
        schema_version INTEGER NOT NULL CHECK (schema_version = 1),
        strategy_version TEXT NOT NULL CHECK (length(trim(strategy_version)) > 0),
        leader_algorithm_version TEXT NOT NULL CHECK (
          length(trim(leader_algorithm_version)) > 0
        ),
        continuity_epoch INTEGER CHECK (
          continuity_epoch IS NULL OR continuity_epoch >= 0
        ),
        target_number INTEGER NOT NULL CHECK (target_number BETWEEN 0 AND 36),
        stake INTEGER NOT NULL CHECK (
          stake > 0 AND stake <= 2500 AND stake % 10 = 0
        ),
        balance_before INTEGER NOT NULL CHECK (balance_before >= stake),
        ladder_loss_before INTEGER NOT NULL CHECK (
          ladder_loss_before >= 0 AND ladder_loss_before % 10 = 0
        ),
        ladder_miss_count_before INTEGER NOT NULL CHECK (
          ladder_miss_count_before >= 0
        ),
        status TEXT NOT NULL CHECK (status IN ('pending', 'settled', 'void')),
        round_result_id INTEGER UNIQUE REFERENCES round_results(id),
        result_number INTEGER CHECK (
          result_number IS NULL OR result_number BETWEEN 0 AND 36
        ),
        outcome TEXT CHECK (outcome IS NULL OR outcome IN ('hit', 'miss')),
        gross_payout INTEGER CHECK (gross_payout IS NULL OR gross_payout >= 0),
        balance_after INTEGER CHECK (balance_after IS NULL OR balance_after >= 0),
        ladder_loss_after INTEGER CHECK (
          ladder_loss_after IS NULL OR ladder_loss_after >= 0
        ),
        ladder_miss_count_after INTEGER CHECK (
          ladder_miss_count_after IS NULL OR ladder_miss_count_after >= 0
        ),
        next_stake_after INTEGER CHECK (
          next_stake_after IS NULL
          OR (next_stake_after > 0 AND next_stake_after <= 2500
            AND next_stake_after % 10 = 0)
        ),
        recovery_possible INTEGER CHECK (
          recovery_possible IS NULL OR recovery_possible IN (0, 1)
        ),
        placed_at TEXT NOT NULL,
        occurred_at TEXT,
        settled_at TEXT,
        void_reason TEXT CHECK (
          void_reason IS NULL OR void_reason = 'integrity_gap'
        ),
        void_incident_id INTEGER UNIQUE REFERENCES incidents(id),
        void_continuity_epoch INTEGER CHECK (
          void_continuity_epoch IS NULL OR void_continuity_epoch >= 0
        ),
        voided_at TEXT,
        updated_at TEXT NOT NULL,
        CHECK (
          (status = 'pending' AND round_result_id IS NULL
            AND result_number IS NULL AND outcome IS NULL
            AND gross_payout IS NULL AND balance_after IS NULL
            AND ladder_loss_after IS NULL AND ladder_miss_count_after IS NULL
            AND next_stake_after IS NULL AND recovery_possible IS NULL
            AND occurred_at IS NULL AND settled_at IS NULL
            AND void_reason IS NULL AND void_incident_id IS NULL
            AND void_continuity_epoch IS NULL AND voided_at IS NULL)
          OR
          (status = 'settled' AND round_result_id IS NOT NULL
            AND result_number IS NOT NULL AND outcome IS NOT NULL
            AND gross_payout IS NOT NULL AND balance_after IS NOT NULL
            AND ladder_loss_after IS NOT NULL
            AND ladder_miss_count_after IS NOT NULL
            AND next_stake_after IS NOT NULL
            AND recovery_possible IS NOT NULL
            AND occurred_at IS NOT NULL AND settled_at IS NOT NULL
            AND void_reason IS NULL AND void_incident_id IS NULL
            AND void_continuity_epoch IS NULL AND voided_at IS NULL
            AND placed_at <= occurred_at AND occurred_at <= settled_at)
          OR
          (status = 'void' AND round_result_id IS NULL
            AND result_number IS NULL AND outcome IS NULL
            AND gross_payout IS NULL AND balance_after IS NULL
            AND ladder_loss_after IS NULL AND ladder_miss_count_after IS NULL
            AND next_stake_after IS NULL AND recovery_possible IS NULL
            AND occurred_at IS NULL AND settled_at IS NULL
            AND void_reason = 'integrity_gap' AND void_incident_id IS NOT NULL
            AND void_continuity_epoch IS NOT NULL AND voided_at IS NOT NULL
            AND placed_at <= voided_at)
        ),
        CHECK (
          status <> 'settled'
          OR balance_after = balance_before - stake + gross_payout
        ),
        CHECK (
          status <> 'settled'
          OR (outcome = 'hit' AND result_number = target_number
            AND gross_payout = stake * 36
            AND ladder_loss_after = 0 AND ladder_miss_count_after = 0)
          OR (outcome = 'miss' AND result_number != target_number
            AND gross_payout = 0
            AND ladder_loss_after = ladder_loss_before + stake
            AND ladder_miss_count_after = ladder_miss_count_before + 1)
        )
      );

      CREATE INDEX IF NOT EXISTS predictive_leader_account_bets_stream_idx
        ON predictive_leader_account_bets(source, instrument, forecast_id);
      CREATE UNIQUE INDEX IF NOT EXISTS predictive_leader_account_pending_idx
        ON predictive_leader_account_bets(source, instrument)
        WHERE status = 'pending';

      PRAGMA user_version = 17;
      COMMIT;
    `);
  }

  #migratePredictiveLeaderAccountVoidV18() {
    const columns = this.sqlite
      .prepare("PRAGMA table_info(predictive_leader_account_bets)")
      .all();
    if (columns.some((column) => column.name === "void_incident_id")) {
      this.sqlite.exec("PRAGMA user_version = 18");
      return;
    }

    const priorCount = Number(
      this.sqlite
        .prepare("SELECT COUNT(*) AS count FROM predictive_leader_account_bets")
        .get().count,
    );
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite.exec(`
        DROP TABLE IF EXISTS predictive_leader_account_bets_v18;
        CREATE TABLE predictive_leader_account_bets_v18 (
          forecast_id INTEGER PRIMARY KEY REFERENCES
            forecast_predictive_leader_snapshots(forecast_id),
          source TEXT NOT NULL,
          instrument TEXT NOT NULL,
          schema_version INTEGER NOT NULL CHECK (schema_version = 1),
          strategy_version TEXT NOT NULL CHECK (length(trim(strategy_version)) > 0),
          leader_algorithm_version TEXT NOT NULL CHECK (
            length(trim(leader_algorithm_version)) > 0
          ),
          continuity_epoch INTEGER CHECK (
            continuity_epoch IS NULL OR continuity_epoch >= 0
          ),
          target_number INTEGER NOT NULL CHECK (target_number BETWEEN 0 AND 36),
          stake INTEGER NOT NULL CHECK (
            stake > 0 AND stake <= 2500 AND stake % 10 = 0
          ),
          balance_before INTEGER NOT NULL CHECK (balance_before >= stake),
          ladder_loss_before INTEGER NOT NULL CHECK (
            ladder_loss_before >= 0 AND ladder_loss_before % 10 = 0
          ),
          ladder_miss_count_before INTEGER NOT NULL CHECK (
            ladder_miss_count_before >= 0
          ),
          status TEXT NOT NULL CHECK (status IN ('pending', 'settled', 'void')),
          round_result_id INTEGER UNIQUE REFERENCES round_results(id),
          result_number INTEGER CHECK (
            result_number IS NULL OR result_number BETWEEN 0 AND 36
          ),
          outcome TEXT CHECK (outcome IS NULL OR outcome IN ('hit', 'miss')),
          gross_payout INTEGER CHECK (gross_payout IS NULL OR gross_payout >= 0),
          balance_after INTEGER CHECK (balance_after IS NULL OR balance_after >= 0),
          ladder_loss_after INTEGER CHECK (
            ladder_loss_after IS NULL OR ladder_loss_after >= 0
          ),
          ladder_miss_count_after INTEGER CHECK (
            ladder_miss_count_after IS NULL OR ladder_miss_count_after >= 0
          ),
          next_stake_after INTEGER CHECK (
            next_stake_after IS NULL
            OR (next_stake_after > 0 AND next_stake_after <= 2500
              AND next_stake_after % 10 = 0)
          ),
          recovery_possible INTEGER CHECK (
            recovery_possible IS NULL OR recovery_possible IN (0, 1)
          ),
          placed_at TEXT NOT NULL,
          occurred_at TEXT,
          settled_at TEXT,
          void_reason TEXT CHECK (
            void_reason IS NULL OR void_reason = 'integrity_gap'
          ),
          void_incident_id INTEGER UNIQUE REFERENCES incidents(id),
          void_continuity_epoch INTEGER CHECK (
            void_continuity_epoch IS NULL OR void_continuity_epoch >= 0
          ),
          voided_at TEXT,
          updated_at TEXT NOT NULL,
          CHECK (
            (status = 'pending' AND round_result_id IS NULL
              AND result_number IS NULL AND outcome IS NULL
              AND gross_payout IS NULL AND balance_after IS NULL
              AND ladder_loss_after IS NULL AND ladder_miss_count_after IS NULL
              AND next_stake_after IS NULL AND recovery_possible IS NULL
              AND occurred_at IS NULL AND settled_at IS NULL
              AND void_reason IS NULL AND void_incident_id IS NULL
              AND void_continuity_epoch IS NULL AND voided_at IS NULL)
            OR
            (status = 'settled' AND round_result_id IS NOT NULL
              AND result_number IS NOT NULL AND outcome IS NOT NULL
              AND gross_payout IS NOT NULL AND balance_after IS NOT NULL
              AND ladder_loss_after IS NOT NULL
              AND ladder_miss_count_after IS NOT NULL
              AND next_stake_after IS NOT NULL
              AND recovery_possible IS NOT NULL
              AND occurred_at IS NOT NULL AND settled_at IS NOT NULL
              AND void_reason IS NULL AND void_incident_id IS NULL
              AND void_continuity_epoch IS NULL AND voided_at IS NULL
              AND placed_at <= occurred_at AND occurred_at <= settled_at)
            OR
            (status = 'void' AND round_result_id IS NULL
              AND result_number IS NULL AND outcome IS NULL
              AND gross_payout IS NULL AND balance_after IS NULL
              AND ladder_loss_after IS NULL AND ladder_miss_count_after IS NULL
              AND next_stake_after IS NULL AND recovery_possible IS NULL
              AND occurred_at IS NULL AND settled_at IS NULL
              AND void_reason = 'integrity_gap' AND void_incident_id IS NOT NULL
              AND void_continuity_epoch IS NOT NULL AND voided_at IS NOT NULL
              AND placed_at <= voided_at)
          ),
          CHECK (
            status <> 'settled'
            OR balance_after = balance_before - stake + gross_payout
          ),
          CHECK (
            status <> 'settled'
            OR (outcome = 'hit' AND result_number = target_number
              AND gross_payout = stake * 36
              AND ladder_loss_after = 0 AND ladder_miss_count_after = 0)
            OR (outcome = 'miss' AND result_number != target_number
              AND gross_payout = 0
              AND ladder_loss_after = ladder_loss_before + stake
              AND ladder_miss_count_after = ladder_miss_count_before + 1)
          )
        );
      `);
      const copy = this.sqlite.prepare(`
        INSERT INTO predictive_leader_account_bets_v18 (
          forecast_id, source, instrument, schema_version, strategy_version,
          leader_algorithm_version, continuity_epoch, target_number, stake,
          balance_before, ladder_loss_before, ladder_miss_count_before,
          status, round_result_id, result_number, outcome, gross_payout,
          balance_after, ladder_loss_after, ladder_miss_count_after,
          next_stake_after, recovery_possible, placed_at, occurred_at,
          settled_at, void_reason, void_incident_id, void_continuity_epoch,
          voided_at, updated_at
        )
        SELECT
          forecast_id, source, instrument, schema_version, strategy_version,
          leader_algorithm_version, continuity_epoch, target_number, stake,
          balance_before, ladder_loss_before, ladder_miss_count_before,
          status, round_result_id, result_number, outcome, gross_payout,
          balance_after, ladder_loss_after, ladder_miss_count_after,
          next_stake_after, recovery_possible, placed_at, occurred_at,
          settled_at, NULL, NULL, NULL, NULL, updated_at
        FROM predictive_leader_account_bets
      `).run();
      if (Number(copy.changes) !== priorCount) {
        throw new Error("predictive leader account v18 migration lost bet rows");
      }
      this.sqlite.exec(`
        DROP TABLE predictive_leader_account_bets;
        ALTER TABLE predictive_leader_account_bets_v18
          RENAME TO predictive_leader_account_bets;
        CREATE INDEX predictive_leader_account_bets_stream_idx
          ON predictive_leader_account_bets(source, instrument, forecast_id);
        CREATE UNIQUE INDEX predictive_leader_account_pending_idx
          ON predictive_leader_account_bets(source, instrument)
          WHERE status = 'pending';
        PRAGMA user_version = 18;
        COMMIT;
      `);
    } catch (error) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // Preserve the migration error.
      }
      throw error;
    }
  }

  #migratePredictiveLeaderAccountLadderResetV19(startingVersion) {
    const shouldRequestReset = startingVersion >= 17 && startingVersion < 19;
    const requestedAt = shouldRequestReset
      ? asTimestamp(this.clock(), undefined, "predictive leader reset requestedAt")
      : null;
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS predictive_leader_account_ladder_resets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source TEXT NOT NULL,
          instrument TEXT NOT NULL,
          reset_key TEXT NOT NULL CHECK (length(trim(reset_key)) > 0),
          reason TEXT NOT NULL CHECK (reason = 'user_requested'),
          status TEXT NOT NULL CHECK (status IN ('pending', 'applied')),
          requested_at TEXT NOT NULL,
          applied_after_forecast_id INTEGER UNIQUE REFERENCES
            predictive_leader_account_bets(forecast_id),
          balance_before INTEGER CHECK (balance_before IS NULL OR balance_before >= 0),
          balance_after INTEGER CHECK (balance_after IS NULL OR balance_after >= 0),
          ladder_total_loss_before INTEGER CHECK (
            ladder_total_loss_before IS NULL
            OR (ladder_total_loss_before >= 0 AND ladder_total_loss_before % 10 = 0)
          ),
          ladder_miss_count_before INTEGER CHECK (
            ladder_miss_count_before IS NULL OR ladder_miss_count_before >= 0
          ),
          next_stake_before INTEGER CHECK (
            next_stake_before IS NULL
            OR (next_stake_before > 0 AND next_stake_before <= 2500
              AND next_stake_before % 10 = 0)
          ),
          ladder_total_loss_after INTEGER CHECK (
            ladder_total_loss_after IS NULL OR ladder_total_loss_after = 0
          ),
          ladder_miss_count_after INTEGER CHECK (
            ladder_miss_count_after IS NULL OR ladder_miss_count_after = 0
          ),
          next_stake_after INTEGER CHECK (
            next_stake_after IS NULL OR next_stake_after = 10
          ),
          applied_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(source, instrument, reset_key),
          CHECK (
            (status = 'pending'
              AND applied_after_forecast_id IS NULL
              AND balance_before IS NULL AND balance_after IS NULL
              AND ladder_total_loss_before IS NULL
              AND ladder_miss_count_before IS NULL
              AND next_stake_before IS NULL
              AND ladder_total_loss_after IS NULL
              AND ladder_miss_count_after IS NULL
              AND next_stake_after IS NULL AND applied_at IS NULL)
            OR
            (status = 'applied'
              AND applied_after_forecast_id IS NOT NULL
              AND balance_before IS NOT NULL AND balance_after = balance_before
              AND ladder_total_loss_before IS NOT NULL
              AND ladder_miss_count_before IS NOT NULL
              AND next_stake_before IS NOT NULL
              AND ladder_total_loss_after = 0
              AND ladder_miss_count_after = 0
              AND next_stake_after = 10 AND applied_at IS NOT NULL)
          )
        );
        CREATE UNIQUE INDEX IF NOT EXISTS predictive_leader_account_reset_pending_idx
          ON predictive_leader_account_ladder_resets(source, instrument)
          WHERE status = 'pending';
        CREATE INDEX IF NOT EXISTS predictive_leader_account_reset_stream_idx
          ON predictive_leader_account_ladder_resets(source, instrument, id);
      `);
      if (shouldRequestReset) {
        this.sqlite
          .prepare(`
            INSERT INTO predictive_leader_account_ladder_resets (
              source, instrument, reset_key, reason, status, requested_at,
              created_at, updated_at
            )
            SELECT
              accounts.source,
              accounts.instrument,
              ?,
              ?,
              'pending',
              CASE WHEN accounts.updated_at > ? THEN accounts.updated_at ELSE ? END,
              CASE WHEN accounts.updated_at > ? THEN accounts.updated_at ELSE ? END,
              CASE WHEN accounts.updated_at > ? THEN accounts.updated_at ELSE ? END
            FROM predictive_leader_accounts AS accounts
            WHERE EXISTS (
              SELECT 1
              FROM predictive_leader_account_bets AS bets
              WHERE bets.source = accounts.source
                AND bets.instrument = accounts.instrument
            )
            ON CONFLICT(source, instrument, reset_key) DO NOTHING
          `)
          .run(
            PREDICTIVE_LEADER_ACCOUNT_RESET_KEY,
            PREDICTIVE_LEADER_ACCOUNT_RESET_REASON,
            requestedAt,
            requestedAt,
            requestedAt,
            requestedAt,
            requestedAt,
            requestedAt,
          );
      }
      this.sqlite.exec("PRAGMA user_version = 19; COMMIT");
    } catch (error) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // Preserve the migration error.
      }
      throw error;
    }
  }

  #migrateFollowerTop5GatedAccountDepositsV23() {
    this.sqlite.exec(`
      BEGIN IMMEDIATE;

      CREATE TABLE IF NOT EXISTS follower_top5_gated_account_deposits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        instrument TEXT NOT NULL,
        deposit_key TEXT NOT NULL CHECK (length(trim(deposit_key)) > 0),
        amount INTEGER NOT NULL CHECK (amount > 0),
        after_result_id INTEGER REFERENCES round_results(id),
        deposited_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(source, instrument, deposit_key)
      );

      CREATE INDEX IF NOT EXISTS follower_top5_gated_deposits_stream_idx
        ON follower_top5_gated_account_deposits(
          source, instrument, after_result_id, id
        );

      PRAGMA user_version = 23;
      COMMIT;
    `);
  }

  #repairStartupInvariantsV24(startingVersion) {
    if (startingVersion >= 24) return;

    const normalizeIndexSql = (value) => String(value ?? "")
      .toLowerCase()
      .replace(/["'`\[\]]/g, "")
      .replace(/\s+/g, "")
      .replace(/;/g, "");
    const indexSql = this.sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?");
    const expectedRoundIndex = normalizeIndexSql(`
      CREATE UNIQUE INDEX round_results_external_round_idx
      ON round_results(source, instrument, external_round_id)
      WHERE external_round_id IS NOT NULL
    `);
    const expectedIncidentIndex = normalizeIndexSql(`
      CREATE UNIQUE INDEX incidents_key_idx
      ON incidents(source, instrument, incident_key)
      WHERE incident_key IS NOT NULL
    `);
    const rebuildRoundIndex = normalizeIndexSql(
      indexSql.get("round_results_external_round_idx")?.sql,
    ) !== expectedRoundIndex;
    const rebuildIncidentIndex = normalizeIndexSql(
      indexSql.get("incidents_key_idx")?.sql,
    ) !== expectedIncidentIndex;
    const indexMigrationSql = [
      rebuildRoundIndex
        ? `
          DROP INDEX IF EXISTS round_results_external_round_idx;
          CREATE UNIQUE INDEX round_results_external_round_idx
            ON round_results(source, instrument, external_round_id)
            WHERE external_round_id IS NOT NULL;
        `
        : "",
      rebuildIncidentIndex
        ? `
          DROP INDEX IF EXISTS incidents_key_idx;
          CREATE UNIQUE INDEX incidents_key_idx
            ON incidents(source, instrument, incident_key)
            WHERE incident_key IS NOT NULL;
        `
        : "",
    ].join("\n");

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite.exec(`
        ${indexMigrationSql}

        INSERT INTO stream_state (source, instrument, continuity_epoch)
        SELECT source, instrument, MAX(continuity_epoch)
        FROM round_results
        GROUP BY source, instrument
        ON CONFLICT(source, instrument) DO UPDATE SET
          continuity_epoch = MAX(stream_state.continuity_epoch, excluded.continuity_epoch);

        COMMIT;
      `);
    } catch (error) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // Preserve the migration error.
      }
      throw error;
    }
  }

  #finalizeSchemaVersionV24(startingVersion) {
    // Earlier idempotent migrations in this legacy chain write their own
    // version numbers. Preserve a newer compatible database version.
    this.sqlite.exec(`PRAGMA user_version = ${Math.max(24, startingVersion)}`);
  }

  #migrateTrajectoryMetricFactsV25(startingVersion) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS forecast_trajectory_metric_facts (
          forecast_id INTEGER PRIMARY KEY
            REFERENCES round_forecasts(id) ON DELETE CASCADE,
          validator_version TEXT NOT NULL,
          ready_count INTEGER NOT NULL CHECK (ready_count IN (0, 1)),
          settled_count INTEGER NOT NULL CHECK (settled_count IN (0, 1)),
          evaluated_count INTEGER NOT NULL CHECK (evaluated_count IN (0, 1)),
          display_range_hits INTEGER NOT NULL CHECK (display_range_hits IN (0, 1)),
          q50_exact_hits INTEGER NOT NULL CHECK (q50_exact_hits IN (0, 1)),
          full_corridor_hits INTEGER NOT NULL CHECK (full_corridor_hits IN (0, 1)),
          rank37_ready_count INTEGER NOT NULL CHECK (rank37_ready_count IN (0, 1)),
          rank37_settled_count INTEGER NOT NULL
            CHECK (rank37_settled_count IN (0, 1)),
          rank37_evaluated_count INTEGER NOT NULL
            CHECK (rank37_evaluated_count IN (0, 1)),
          rank37_top1_hits INTEGER NOT NULL CHECK (rank37_top1_hits IN (0, 1)),
          rank37_top3_hits INTEGER NOT NULL CHECK (rank37_top3_hits IN (0, 1))
        );

        CREATE TABLE IF NOT EXISTS forecast_trajectory_metric_dirty (
          forecast_id INTEGER PRIMARY KEY
            REFERENCES round_forecasts(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS forecast_predictive_leader_metric_facts (
          forecast_id INTEGER PRIMARY KEY
            REFERENCES round_forecasts(id) ON DELETE CASCADE,
          metric_version TEXT NOT NULL,
          ready_count INTEGER NOT NULL CHECK (ready_count IN (0, 1)),
          settled_count INTEGER NOT NULL CHECK (settled_count IN (0, 1)),
          top1_hits INTEGER NOT NULL CHECK (top1_hits IN (0, 1)),
          top3_hits INTEGER NOT NULL CHECK (top3_hits IN (0, 1)),
          combined_brier_loss REAL,
          CHECK (settled_count <= ready_count),
          CHECK (top1_hits <= settled_count),
          CHECK (top3_hits <= settled_count),
          CHECK (
            (settled_count = 0 AND combined_brier_loss IS NULL)
            OR
            (settled_count = 1 AND combined_brier_loss >= 0)
          )
        );

        CREATE TABLE IF NOT EXISTS forecast_predictive_leader_metric_dirty (
          forecast_id INTEGER PRIMARY KEY
            REFERENCES round_forecasts(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS forecast_trajectory_shadows_metric_idx
          ON forecast_trajectory_shadows(model_version, status, forecast_id);
        CREATE INDEX IF NOT EXISTS forecast_predictive_leaders_metric_idx
          ON forecast_predictive_leader_snapshots(
            schema_version,
            algorithm_version,
            forecast_id
          );
        CREATE INDEX IF NOT EXISTS forecast_predictive_leaders_training_idx
          ON forecast_predictive_leader_snapshots(
            training_through_forecast_id,
            forecast_id
          );

        INSERT OR IGNORE INTO forecast_trajectory_metric_dirty (forecast_id)
        SELECT trajectory_shadows.forecast_id
        FROM forecast_trajectory_shadows AS trajectory_shadows
        LEFT JOIN forecast_trajectory_metric_facts AS metric_facts
          ON metric_facts.forecast_id = trajectory_shadows.forecast_id
         AND metric_facts.validator_version = '${TRAJECTORY_METRIC_FACT_VERSION}'
        WHERE trajectory_shadows.model_version = '${TRAJECTORY_SHADOW_ADAPTIVE_VERSION}'
          AND trajectory_shadows.status = 'ready'
          AND metric_facts.forecast_id IS NULL;

        INSERT OR IGNORE INTO forecast_predictive_leader_metric_dirty (forecast_id)
        SELECT leaders.forecast_id
        FROM forecast_predictive_leader_snapshots AS leaders
        LEFT JOIN forecast_predictive_leader_metric_facts AS metric_facts
          ON metric_facts.forecast_id = leaders.forecast_id
         AND metric_facts.metric_version = '${PREDICTIVE_LEADER_METRIC_FACT_VERSION}'
        WHERE leaders.schema_version = ${LEARNED_LEADER_SCHEMA_VERSION}
          AND leaders.algorithm_version = '${LEARNED_LEADER_ALGORITHM_VERSION}'
          AND metric_facts.forecast_id IS NULL;

        CREATE TRIGGER IF NOT EXISTS trajectory_metric_facts_shadow_insert
        AFTER INSERT ON forecast_trajectory_shadows
        BEGIN
          DELETE FROM forecast_trajectory_metric_facts
          WHERE forecast_id = NEW.forecast_id;
          INSERT OR IGNORE INTO forecast_trajectory_metric_dirty (forecast_id)
          SELECT NEW.forecast_id
          WHERE NEW.model_version = '${TRAJECTORY_SHADOW_ADAPTIVE_VERSION}'
            AND NEW.status = 'ready';
        END;

        CREATE TRIGGER IF NOT EXISTS trajectory_metric_facts_shadow_update
        AFTER UPDATE ON forecast_trajectory_shadows
        BEGIN
          DELETE FROM forecast_trajectory_metric_facts
          WHERE forecast_id IN (OLD.forecast_id, NEW.forecast_id);
          DELETE FROM forecast_trajectory_metric_dirty
          WHERE forecast_id IN (OLD.forecast_id, NEW.forecast_id);
          INSERT OR IGNORE INTO forecast_trajectory_metric_dirty (forecast_id)
          SELECT NEW.forecast_id
          WHERE NEW.model_version = '${TRAJECTORY_SHADOW_ADAPTIVE_VERSION}'
            AND NEW.status = 'ready';
        END;

        CREATE TRIGGER IF NOT EXISTS trajectory_metric_facts_shadow_delete
        AFTER DELETE ON forecast_trajectory_shadows
        BEGIN
          DELETE FROM forecast_trajectory_metric_facts
          WHERE forecast_id = OLD.forecast_id;
          DELETE FROM forecast_trajectory_metric_dirty
          WHERE forecast_id = OLD.forecast_id;
        END;

        CREATE TRIGGER IF NOT EXISTS trajectory_metric_facts_snapshot_update
        AFTER UPDATE OF locked_at, current_price, cells_json ON forecast_snapshots
        BEGIN
          DELETE FROM forecast_trajectory_metric_facts
          WHERE forecast_id IN (
            SELECT id FROM round_forecasts WHERE snapshot_id = NEW.id
          );
          INSERT OR IGNORE INTO forecast_trajectory_metric_dirty (forecast_id)
          SELECT trajectory_shadows.forecast_id
          FROM forecast_trajectory_shadows AS trajectory_shadows
          JOIN round_forecasts AS forecasts
            ON forecasts.id = trajectory_shadows.forecast_id
          WHERE forecasts.snapshot_id = NEW.id
            AND trajectory_shadows.model_version = '${TRAJECTORY_SHADOW_ADAPTIVE_VERSION}'
            AND trajectory_shadows.status = 'ready';
        END;

        CREATE TRIGGER IF NOT EXISTS trajectory_metric_facts_settlement_insert
        AFTER INSERT ON forecast_settlements
        BEGIN
          DELETE FROM forecast_trajectory_metric_facts
          WHERE forecast_id = NEW.forecast_id;
          INSERT OR IGNORE INTO forecast_trajectory_metric_dirty (forecast_id)
          SELECT trajectory_shadows.forecast_id
          FROM forecast_trajectory_shadows AS trajectory_shadows
          WHERE trajectory_shadows.forecast_id = NEW.forecast_id
            AND trajectory_shadows.model_version = '${TRAJECTORY_SHADOW_ADAPTIVE_VERSION}'
            AND trajectory_shadows.status = 'ready';
        END;

        CREATE TRIGGER IF NOT EXISTS trajectory_metric_facts_settlement_update
        AFTER UPDATE ON forecast_settlements
        BEGIN
          DELETE FROM forecast_trajectory_metric_facts
          WHERE forecast_id IN (OLD.forecast_id, NEW.forecast_id);
          INSERT OR IGNORE INTO forecast_trajectory_metric_dirty (forecast_id)
          SELECT trajectory_shadows.forecast_id
          FROM forecast_trajectory_shadows AS trajectory_shadows
          WHERE trajectory_shadows.forecast_id IN (
              OLD.forecast_id,
              NEW.forecast_id
            )
            AND trajectory_shadows.model_version = '${TRAJECTORY_SHADOW_ADAPTIVE_VERSION}'
            AND trajectory_shadows.status = 'ready';
        END;

        CREATE TRIGGER IF NOT EXISTS trajectory_metric_facts_settlement_delete
        AFTER DELETE ON forecast_settlements
        BEGIN
          DELETE FROM forecast_trajectory_metric_facts
          WHERE forecast_id = OLD.forecast_id;
          INSERT OR IGNORE INTO forecast_trajectory_metric_dirty (forecast_id)
          SELECT trajectory_shadows.forecast_id
          FROM forecast_trajectory_shadows AS trajectory_shadows
          WHERE trajectory_shadows.forecast_id = OLD.forecast_id
            AND trajectory_shadows.model_version = '${TRAJECTORY_SHADOW_ADAPTIVE_VERSION}'
            AND trajectory_shadows.status = 'ready';
        END;

        CREATE TRIGGER IF NOT EXISTS trajectory_metric_facts_result_update
        AFTER UPDATE OF result_number, raw_cell ON round_results
        BEGIN
          DELETE FROM forecast_trajectory_metric_facts
          WHERE forecast_id IN (
            SELECT forecast_id
            FROM forecast_settlements
            WHERE round_result_id IN (OLD.id, NEW.id)
          );
          INSERT OR IGNORE INTO forecast_trajectory_metric_dirty (forecast_id)
          SELECT trajectory_shadows.forecast_id
          FROM forecast_trajectory_shadows AS trajectory_shadows
          JOIN forecast_settlements AS settlements
            ON settlements.forecast_id = trajectory_shadows.forecast_id
          WHERE settlements.round_result_id IN (OLD.id, NEW.id)
            AND trajectory_shadows.model_version = '${TRAJECTORY_SHADOW_ADAPTIVE_VERSION}'
            AND trajectory_shadows.status = 'ready';
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_metric_facts_leader_insert
        AFTER INSERT ON forecast_predictive_leader_snapshots
        BEGIN
          DELETE FROM forecast_predictive_leader_metric_facts
          WHERE forecast_id = NEW.forecast_id;
          INSERT OR IGNORE INTO forecast_predictive_leader_metric_dirty (forecast_id)
          SELECT NEW.forecast_id
          WHERE NEW.schema_version = ${LEARNED_LEADER_SCHEMA_VERSION}
            AND NEW.algorithm_version = '${LEARNED_LEADER_ALGORITHM_VERSION}';
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_metric_facts_leader_update
        AFTER UPDATE ON forecast_predictive_leader_snapshots
        BEGIN
          DELETE FROM forecast_predictive_leader_metric_facts
          WHERE forecast_id IN (OLD.forecast_id, NEW.forecast_id);
          DELETE FROM forecast_predictive_leader_metric_dirty
          WHERE forecast_id IN (OLD.forecast_id, NEW.forecast_id);
          INSERT OR IGNORE INTO forecast_predictive_leader_metric_dirty (forecast_id)
          SELECT NEW.forecast_id
          WHERE NEW.schema_version = ${LEARNED_LEADER_SCHEMA_VERSION}
            AND NEW.algorithm_version = '${LEARNED_LEADER_ALGORITHM_VERSION}';
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_metric_facts_leader_delete
        AFTER DELETE ON forecast_predictive_leader_snapshots
        BEGIN
          DELETE FROM forecast_predictive_leader_metric_facts
          WHERE forecast_id = OLD.forecast_id;
          DELETE FROM forecast_predictive_leader_metric_dirty
          WHERE forecast_id = OLD.forecast_id;
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_metric_facts_snapshot_update
        AFTER UPDATE OF locked_at ON forecast_snapshots
        BEGIN
          DELETE FROM forecast_predictive_leader_metric_facts
          WHERE forecast_id IN (
            SELECT id FROM round_forecasts WHERE snapshot_id = NEW.id
          );
          INSERT OR IGNORE INTO forecast_predictive_leader_metric_dirty (forecast_id)
          SELECT leaders.forecast_id
          FROM forecast_predictive_leader_snapshots AS leaders
          JOIN round_forecasts AS forecasts ON forecasts.id = leaders.forecast_id
          WHERE forecasts.snapshot_id = NEW.id
            AND leaders.schema_version = ${LEARNED_LEADER_SCHEMA_VERSION}
            AND leaders.algorithm_version = '${LEARNED_LEADER_ALGORITHM_VERSION}';
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_metric_facts_settlement_insert
        AFTER INSERT ON forecast_settlements
        BEGIN
          DELETE FROM forecast_predictive_leader_metric_facts
          WHERE forecast_id = NEW.forecast_id
             OR forecast_id IN (
               SELECT forecast_id
               FROM forecast_predictive_leader_snapshots
               WHERE training_through_forecast_id = NEW.forecast_id
             );
          INSERT OR IGNORE INTO forecast_predictive_leader_metric_dirty (forecast_id)
          SELECT leaders.forecast_id
          FROM forecast_predictive_leader_snapshots AS leaders
          WHERE (
              leaders.forecast_id = NEW.forecast_id
              OR leaders.training_through_forecast_id = NEW.forecast_id
            )
            AND leaders.schema_version = ${LEARNED_LEADER_SCHEMA_VERSION}
            AND leaders.algorithm_version = '${LEARNED_LEADER_ALGORITHM_VERSION}';
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_metric_facts_settlement_update
        AFTER UPDATE ON forecast_settlements
        BEGIN
          DELETE FROM forecast_predictive_leader_metric_facts
          WHERE forecast_id IN (OLD.forecast_id, NEW.forecast_id)
             OR forecast_id IN (
               SELECT forecast_id
               FROM forecast_predictive_leader_snapshots
               WHERE training_through_forecast_id IN (
                 OLD.forecast_id,
                 NEW.forecast_id
               )
             );
          INSERT OR IGNORE INTO forecast_predictive_leader_metric_dirty (forecast_id)
          SELECT leaders.forecast_id
          FROM forecast_predictive_leader_snapshots AS leaders
          WHERE (
              leaders.forecast_id IN (OLD.forecast_id, NEW.forecast_id)
              OR leaders.training_through_forecast_id IN (
                OLD.forecast_id,
                NEW.forecast_id
              )
            )
            AND leaders.schema_version = ${LEARNED_LEADER_SCHEMA_VERSION}
            AND leaders.algorithm_version = '${LEARNED_LEADER_ALGORITHM_VERSION}';
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_metric_facts_settlement_delete
        AFTER DELETE ON forecast_settlements
        BEGIN
          DELETE FROM forecast_predictive_leader_metric_facts
          WHERE forecast_id = OLD.forecast_id
             OR forecast_id IN (
               SELECT forecast_id
               FROM forecast_predictive_leader_snapshots
               WHERE training_through_forecast_id = OLD.forecast_id
             );
          INSERT OR IGNORE INTO forecast_predictive_leader_metric_dirty (forecast_id)
          SELECT leaders.forecast_id
          FROM forecast_predictive_leader_snapshots AS leaders
          WHERE (
              leaders.forecast_id = OLD.forecast_id
              OR leaders.training_through_forecast_id = OLD.forecast_id
            )
            AND leaders.schema_version = ${LEARNED_LEADER_SCHEMA_VERSION}
            AND leaders.algorithm_version = '${LEARNED_LEADER_ALGORITHM_VERSION}';
        END;

        CREATE TRIGGER IF NOT EXISTS metric_facts_forecast_snapshot_update
        AFTER UPDATE OF snapshot_id ON round_forecasts
        BEGIN
          DELETE FROM forecast_trajectory_metric_facts
          WHERE forecast_id = NEW.id;
          DELETE FROM forecast_predictive_leader_metric_facts
          WHERE forecast_id = NEW.id;
          INSERT OR IGNORE INTO forecast_trajectory_metric_dirty (forecast_id)
          SELECT trajectory_shadows.forecast_id
          FROM forecast_trajectory_shadows AS trajectory_shadows
          WHERE trajectory_shadows.forecast_id = NEW.id
            AND trajectory_shadows.model_version = '${TRAJECTORY_SHADOW_ADAPTIVE_VERSION}'
            AND trajectory_shadows.status = 'ready';
          INSERT OR IGNORE INTO forecast_predictive_leader_metric_dirty (forecast_id)
          SELECT leaders.forecast_id
          FROM forecast_predictive_leader_snapshots AS leaders
          WHERE leaders.forecast_id = NEW.id
            AND leaders.schema_version = ${LEARNED_LEADER_SCHEMA_VERSION}
            AND leaders.algorithm_version = '${LEARNED_LEADER_ALGORITHM_VERSION}';
        END;

        PRAGMA user_version = ${Math.max(25, startingVersion)};
        COMMIT;
      `);
    } catch (error) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // Preserve the migration error.
      }
      throw error;
    }
  }

  #migratePredictiveLeaderQualityAndSignalV26(startingVersion) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS forecast_predictive_leader_quality_snapshots (
          forecast_id INTEGER PRIMARY KEY REFERENCES
            forecast_predictive_leader_snapshots(forecast_id) ON DELETE CASCADE,
          policy_version TEXT NOT NULL CHECK (length(trim(policy_version)) > 0),
          cutoff_at TEXT NOT NULL,
          status TEXT NOT NULL CHECK (
            status IN ('collecting', 'rejected', 'confirmed', 'invalid')
          ),
          reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
          eligible INTEGER NOT NULL CHECK (eligible IN (0, 1)),
          sample_size INTEGER NOT NULL CHECK (
            sample_size BETWEEN 0 AND ${PREDICTIVE_LEADER_QUALITY_GATE.windowSize}
          ),
          hit_count INTEGER NOT NULL CHECK (
            hit_count >= 0 AND hit_count <= sample_size
          ),
          lower_bound REAL,
          mean_brier_loss REAL,
          window_start_forecast_id INTEGER REFERENCES round_forecasts(id),
          window_end_forecast_id INTEGER REFERENCES round_forecasts(id),
          snapshot_json TEXT NOT NULL CHECK (
            json_valid(snapshot_json) AND json_type(snapshot_json) = 'object'
          ),
          created_at TEXT NOT NULL,
          CHECK (eligible = (status = 'confirmed')),
          CHECK (json_extract(snapshot_json, '$.version') = policy_version),
          CHECK (json_extract(snapshot_json, '$.status') = status),
          CHECK (json_extract(snapshot_json, '$.reason') = reason),
          CHECK (json_extract(snapshot_json, '$.eligible') = eligible),
          CHECK (json_extract(snapshot_json, '$.sampleSize') = sample_size),
          CHECK (json_extract(snapshot_json, '$.hitCount') = hit_count),
          CHECK (json_extract(snapshot_json, '$.cutoffAt') = cutoff_at),
          CHECK (json_extract(snapshot_json, '$.evaluatedForForecastId') = forecast_id),
          CHECK (
            (sample_size = 0 AND window_start_forecast_id IS NULL
              AND window_end_forecast_id IS NULL)
            OR
            (sample_size > 0 AND window_start_forecast_id IS NOT NULL
              AND window_end_forecast_id IS NOT NULL
              AND window_start_forecast_id <= window_end_forecast_id
              AND window_end_forecast_id < forecast_id)
          ),
          CHECK (cutoff_at <= created_at)
        );

        CREATE INDEX IF NOT EXISTS predictive_leader_quality_status_idx
          ON forecast_predictive_leader_quality_snapshots(
            policy_version, status, forecast_id DESC
          );
        CREATE TRIGGER IF NOT EXISTS predictive_leader_quality_causal_insert
          BEFORE INSERT ON forecast_predictive_leader_quality_snapshots
          WHEN NEW.sample_size > 0 AND (
            NEW.window_start_forecast_id IS NULL
            OR NEW.window_end_forecast_id IS NULL
            OR NEW.window_start_forecast_id > NEW.window_end_forecast_id
            OR NEW.window_end_forecast_id >= NEW.forecast_id
          )
          BEGIN
            SELECT RAISE(ABORT, 'predictive leader quality window is not causal');
          END;
        CREATE TRIGGER IF NOT EXISTS predictive_leader_quality_causal_update
          BEFORE UPDATE OF forecast_id, sample_size, window_start_forecast_id,
            window_end_forecast_id
          ON forecast_predictive_leader_quality_snapshots
          WHEN NEW.sample_size > 0 AND (
            NEW.window_start_forecast_id IS NULL
            OR NEW.window_end_forecast_id IS NULL
            OR NEW.window_start_forecast_id > NEW.window_end_forecast_id
            OR NEW.window_end_forecast_id >= NEW.forecast_id
          )
          BEGIN
            SELECT RAISE(ABORT, 'predictive leader quality window is not causal');
          END;

        CREATE TABLE IF NOT EXISTS forecast_predictive_leader_evaluation_voids (
          forecast_id INTEGER NOT NULL REFERENCES
            forecast_predictive_leader_snapshots(forecast_id) ON DELETE CASCADE,
          incident_id INTEGER NOT NULL REFERENCES incidents(id),
          void_continuity_epoch INTEGER NOT NULL CHECK (void_continuity_epoch >= 1),
          reason TEXT NOT NULL CHECK (reason = 'integrity_gap'),
          voided_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (forecast_id, incident_id),
          CHECK (voided_at <= created_at)
        );
        CREATE INDEX IF NOT EXISTS predictive_leader_evaluation_void_incident_idx
          ON forecast_predictive_leader_evaluation_voids(incident_id, forecast_id);

        CREATE TABLE IF NOT EXISTS predictive_leader_gated_fixed_bets (
          forecast_id INTEGER PRIMARY KEY REFERENCES
            forecast_predictive_leader_quality_snapshots(forecast_id),
          source TEXT NOT NULL,
          instrument TEXT NOT NULL,
          schema_version INTEGER NOT NULL CHECK (schema_version = 1),
          strategy_version TEXT NOT NULL CHECK (length(trim(strategy_version)) > 0),
          leader_algorithm_version TEXT NOT NULL CHECK (
            length(trim(leader_algorithm_version)) > 0
          ),
          gate_version TEXT NOT NULL CHECK (length(trim(gate_version)) > 0),
          continuity_epoch INTEGER NOT NULL CHECK (continuity_epoch >= 0),
          target_number INTEGER NOT NULL CHECK (target_number BETWEEN 0 AND 36),
          stake INTEGER NOT NULL CHECK (stake = 10),
          balance_before INTEGER NOT NULL CHECK (balance_before >= stake),
          status TEXT NOT NULL CHECK (status IN ('pending', 'settled', 'void')),
          round_result_id INTEGER UNIQUE REFERENCES round_results(id),
          result_number INTEGER CHECK (
            result_number IS NULL OR result_number BETWEEN 0 AND 36
          ),
          outcome TEXT CHECK (outcome IS NULL OR outcome IN ('hit', 'miss')),
          gross_payout INTEGER CHECK (gross_payout IS NULL OR gross_payout >= 0),
          balance_after INTEGER CHECK (balance_after IS NULL OR balance_after >= 0),
          void_reason TEXT CHECK (
            void_reason IS NULL OR void_reason = 'integrity_gap'
          ),
          placed_at TEXT NOT NULL,
          settled_at TEXT,
          updated_at TEXT NOT NULL,
          CHECK (
            (status = 'pending' AND round_result_id IS NULL
              AND result_number IS NULL AND outcome IS NULL
              AND gross_payout IS NULL AND balance_after IS NULL
              AND void_reason IS NULL AND settled_at IS NULL)
            OR
            (status = 'settled' AND round_result_id IS NOT NULL
              AND result_number IS NOT NULL AND outcome IS NOT NULL
              AND gross_payout IS NOT NULL AND balance_after IS NOT NULL
              AND void_reason IS NULL AND settled_at IS NOT NULL
              AND balance_after = balance_before - stake + gross_payout
              AND (outcome = 'hit') = (target_number = result_number)
              AND gross_payout = CASE
                WHEN outcome = 'hit' THEN stake * 36 ELSE 0 END)
            OR
            (status = 'void' AND round_result_id IS NULL
              AND result_number IS NULL AND outcome IS NULL
              AND gross_payout IS NULL AND balance_after IS NULL
              AND void_reason = 'integrity_gap' AND settled_at IS NOT NULL)
          )
        );

        CREATE UNIQUE INDEX IF NOT EXISTS predictive_leader_gated_fixed_pending_idx
          ON predictive_leader_gated_fixed_bets(source, instrument)
          WHERE status = 'pending';
        CREATE INDEX IF NOT EXISTS predictive_leader_gated_fixed_stream_idx
          ON predictive_leader_gated_fixed_bets(
            source, instrument, forecast_id DESC
          );

        PRAGMA user_version = ${Math.max(26, startingVersion)};
        COMMIT;
      `);
    } catch (error) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // Preserve the migration error.
      }
      throw error;
    }
    this.#backfillPredictiveLeaderEvaluationVoids();
  }

  #migratePredictiveLeaderV7ShadowV27(startingVersion) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS predictive_leader_v7_cohorts (
          candidate_key TEXT PRIMARY KEY CHECK (length(trim(candidate_key)) > 0),
          schema_version INTEGER NOT NULL CHECK (
            schema_version = ${LEARNED_LEADER_V7_SCHEMA_VERSION}
          ),
          algorithm_version TEXT NOT NULL CHECK (length(trim(algorithm_version)) > 0),
          config_version TEXT NOT NULL CHECK (length(trim(config_version)) > 0),
          target_horizon INTEGER NOT NULL CHECK (target_horizon = 1),
          forecast_horizon_seconds INTEGER NOT NULL CHECK (
            forecast_horizon_seconds BETWEEN 5 AND 60
          ),
          mode TEXT NOT NULL CHECK (mode = 'prospective-shadow'),
          source TEXT NOT NULL DEFAULT 'buleto' CHECK (source = 'buleto'),
          instrument TEXT NOT NULL DEFAULT 'XPM/RUB' CHECK (instrument = 'XPM/RUB'),
          first_forecast_id INTEGER NOT NULL CHECK (first_forecast_id >= 1),
          started_at TEXT NOT NULL,
          config_json TEXT NOT NULL CHECK (
            json_valid(config_json)
            AND json_type(config_json) = 'object'
          ),
          config_sha256 TEXT NOT NULL CHECK (
            length(config_sha256) = 64 AND config_sha256 = lower(config_sha256)
          ),
          source_export_artifact TEXT NOT NULL CHECK (
            length(trim(source_export_artifact)) > 0
          ),
          source_export_sha256 TEXT NOT NULL CHECK (
            length(source_export_sha256) = 64
            AND source_export_sha256 = lower(source_export_sha256)
          ),
          source_export_cutoff_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(algorithm_version),
          UNIQUE(
            candidate_key, schema_version, algorithm_version, config_version,
            target_horizon, config_sha256
          ),
          CHECK (started_at = created_at),
          CHECK (started_at > source_export_cutoff_at),
          CHECK (json_extract(config_json, '$.candidateId') = candidate_key),
          CHECK (json_extract(config_json, '$.version') = config_version),
          CHECK (json_extract(config_json, '$.targetHorizon') = 1)
        );

        CREATE TABLE IF NOT EXISTS forecast_predictive_leader_v7_snapshots (
          forecast_id INTEGER NOT NULL
            REFERENCES round_forecasts(id) ON DELETE CASCADE,
          candidate_key TEXT NOT NULL,
          schema_version INTEGER NOT NULL CHECK (
            schema_version = ${LEARNED_LEADER_V7_SCHEMA_VERSION}
          ),
          algorithm_version TEXT NOT NULL CHECK (length(trim(algorithm_version)) > 0),
          config_version TEXT NOT NULL CHECK (length(trim(config_version)) > 0),
          target_horizon INTEGER NOT NULL CHECK (target_horizon = 1),
          config_sha256 TEXT NOT NULL CHECK (
            length(config_sha256) = 64 AND config_sha256 = lower(config_sha256)
          ),
          status TEXT NOT NULL CHECK (status IN ('ready', 'unavailable')),
          locked_at TEXT NOT NULL,
          history_max_result_id INTEGER REFERENCES round_results(id),
          predicted_number INTEGER CHECK (
            predicted_number IS NULL OR predicted_number BETWEEN 0 AND 36
          ),
          leader_mass REAL CHECK (
            leader_mass IS NULL OR leader_mass BETWEEN 0 AND 1
          ),
          margin REAL CHECK (margin IS NULL OR margin BETWEEN 0 AND 1),
          selected INTEGER NOT NULL CHECK (selected IN (0, 1)),
          snapshot_json TEXT NOT NULL CHECK (
            json_valid(snapshot_json) AND json_type(snapshot_json) = 'object'
          ),
          created_at TEXT NOT NULL,
          PRIMARY KEY (forecast_id, candidate_key),
          FOREIGN KEY (
            candidate_key, schema_version, algorithm_version, config_version,
            target_horizon, config_sha256
          ) REFERENCES predictive_leader_v7_cohorts(
            candidate_key, schema_version, algorithm_version, config_version,
            target_horizon, config_sha256
          ),
          CHECK (locked_at <= created_at),
          CHECK (
            (status = 'ready' AND predicted_number IS NOT NULL
              AND leader_mass IS NOT NULL AND margin IS NOT NULL)
            OR
            (status = 'unavailable' AND predicted_number IS NULL
              AND leader_mass IS NULL AND margin IS NULL AND selected = 0)
          ),
          CHECK (json_extract(snapshot_json, '$.schemaVersion') = schema_version),
          CHECK (json_extract(snapshot_json, '$.algorithmVersion') = algorithm_version),
          CHECK (json_extract(snapshot_json, '$.status') = status),
          CHECK (json_extract(snapshot_json, '$.lockedAt') = locked_at),
          CHECK (json_extract(snapshot_json, '$.leaderNumber') IS predicted_number),
          CHECK (json_extract(snapshot_json, '$.leaderMass') IS leader_mass),
          CHECK (json_extract(snapshot_json, '$.margin') IS margin),
          CHECK (json_extract(snapshot_json, '$.selection.eligible') = selected),
          CHECK (json_extract(snapshot_json, '$.config.candidateId') = candidate_key),
          CHECK (json_extract(snapshot_json, '$.config.version') = config_version),
          CHECK (json_extract(snapshot_json, '$.targetHorizon') = target_horizon),
          CHECK (json_extract(snapshot_json, '$.shadow') = 1),
          CHECK (json_extract(snapshot_json, '$.targetHorizon') = 1)
        );

        CREATE INDEX IF NOT EXISTS predictive_leader_v7_stream_idx
          ON forecast_predictive_leader_v7_snapshots(
            candidate_key, status, selected, forecast_id
          );
        CREATE INDEX IF NOT EXISTS predictive_leader_v7_history_idx
          ON forecast_predictive_leader_v7_snapshots(
            history_max_result_id, forecast_id
          );

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_no_backfill_insert
        BEFORE INSERT ON forecast_predictive_leader_v7_snapshots
        WHEN NEW.forecast_id < (
          SELECT first_forecast_id
          FROM predictive_leader_v7_cohorts
          WHERE candidate_key = NEW.candidate_key
        ) OR NEW.locked_at < (
          SELECT started_at
          FROM predictive_leader_v7_cohorts
          WHERE candidate_key = NEW.candidate_key
        )
        BEGIN
          SELECT RAISE(ABORT, 'v7 shadow snapshots cannot be backfilled');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_no_backfill_update
        BEFORE UPDATE OF forecast_id, candidate_key, locked_at
          ON forecast_predictive_leader_v7_snapshots
        WHEN NEW.forecast_id < (
          SELECT first_forecast_id
          FROM predictive_leader_v7_cohorts
          WHERE candidate_key = NEW.candidate_key
        ) OR NEW.locked_at < (
          SELECT started_at
          FROM predictive_leader_v7_cohorts
          WHERE candidate_key = NEW.candidate_key
        )
        BEGIN
          SELECT RAISE(ABORT, 'v7 shadow snapshots cannot be backfilled');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_cohort_immutable_update
        BEFORE UPDATE ON predictive_leader_v7_cohorts
        BEGIN
          SELECT RAISE(ABORT, 'v7 shadow cohort is immutable');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_cohort_immutable_delete
        BEFORE DELETE ON predictive_leader_v7_cohorts
        BEGIN
          SELECT RAISE(ABORT, 'v7 shadow cohort is immutable');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_snapshot_immutable_update
        BEFORE UPDATE ON forecast_predictive_leader_v7_snapshots
        BEGIN
          SELECT RAISE(ABORT, 'v7 shadow snapshot is immutable');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_snapshot_immutable_delete
        BEFORE DELETE ON forecast_predictive_leader_v7_snapshots
        BEGIN
          SELECT RAISE(ABORT, 'v7 shadow snapshot is immutable');
        END;
      `);

      const v7CohortColumns = this.sqlite.prepare(`
        PRAGMA table_info(predictive_leader_v7_cohorts)
      `).all();
      if (!v7CohortColumns.some((column) => column.name === "source")) {
        this.sqlite.exec(`
          ALTER TABLE predictive_leader_v7_cohorts
          ADD COLUMN source TEXT NOT NULL DEFAULT 'buleto' CHECK (source = 'buleto')
        `);
      }
      if (!v7CohortColumns.some((column) => column.name === "instrument")) {
        this.sqlite.exec(`
          ALTER TABLE predictive_leader_v7_cohorts
          ADD COLUMN instrument TEXT NOT NULL DEFAULT 'XPM/RUB'
            CHECK (instrument = 'XPM/RUB')
        `);
      }
      this.sqlite.exec(`
        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_snapshot_stream_identity
        BEFORE INSERT ON forecast_predictive_leader_v7_snapshots
        WHEN NOT EXISTS (
          SELECT 1
          FROM round_forecasts AS forecasts
          JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
          JOIN predictive_leader_v7_cohorts AS cohorts
            ON cohorts.candidate_key = NEW.candidate_key
          WHERE forecasts.id = NEW.forecast_id
            AND snapshots.source = cohorts.source
            AND snapshots.instrument = cohorts.instrument
        )
        BEGIN
          SELECT RAISE(ABORT, 'v7 shadow snapshot stream identity is invalid');
        END;
      `);

      const firstForecastId = Number(this.sqlite.prepare(`
        SELECT COALESCE(MAX(id), 0) + 1 AS first_forecast_id
        FROM round_forecasts
      `).get().first_forecast_id);
      const existingCohort = this.sqlite.prepare(`
        SELECT candidate_key
        FROM predictive_leader_v7_cohorts
        WHERE candidate_key = ?
      `).get(PREDICTIVE_LEADER_V7_CANDIDATE_CONFIG.candidateId);
      let cohortInsertionChanges = 0;
      if (!existingCohort) {
        const migrationClockAt = asTimestamp(
          this.clock(),
          undefined,
          "predictive leader v7 cohort startedAt",
        );
        const startedAt = new Date(Math.max(
          Date.parse(migrationClockAt),
          Date.parse(PREDICTIVE_LEADER_V7_SOURCE_EXPORT.cutoffAt) + 1,
        )).toISOString();
        const cohortInsertion = this.sqlite.prepare(`
          INSERT INTO predictive_leader_v7_cohorts (
            candidate_key, schema_version, algorithm_version, config_version,
            target_horizon, forecast_horizon_seconds, mode, source, instrument,
            first_forecast_id,
            started_at, config_json, config_sha256,
            source_export_artifact, source_export_sha256,
            source_export_cutoff_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'prospective-shadow', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          PREDICTIVE_LEADER_V7_CANDIDATE_CONFIG.candidateId,
          LEARNED_LEADER_V7_SCHEMA_VERSION,
          LEARNED_LEADER_V7_ALGORITHM_VERSION,
          LEARNED_LEADER_V7_CONFIG_VERSION,
          LEARNED_LEADER_V7_TARGET_HORIZON,
          PREDICTIVE_LEADER_V7_FORECAST_HORIZON_SECONDS,
          PREDICTIVE_SHADOW_FROZEN_STREAM.source,
          PREDICTIVE_SHADOW_FROZEN_STREAM.instrument,
          firstForecastId,
          startedAt,
          PREDICTIVE_LEADER_V7_CONFIG_JSON,
          PREDICTIVE_LEADER_V7_CONFIG_SHA256,
          PREDICTIVE_LEADER_V7_SOURCE_EXPORT.artifact,
          PREDICTIVE_LEADER_V7_SOURCE_EXPORT.sha256,
          PREDICTIVE_LEADER_V7_SOURCE_EXPORT.cutoffAt,
          startedAt,
        );
        cohortInsertionChanges = Number(cohortInsertion.changes);
      }
      const cohort = this.sqlite.prepare(`
        SELECT * FROM predictive_leader_v7_cohorts WHERE candidate_key = ?
      `).get(PREDICTIVE_LEADER_V7_CANDIDATE_CONFIG.candidateId);
      if (
        !cohort
        || Number(cohort.schema_version) !== LEARNED_LEADER_V7_SCHEMA_VERSION
        || cohort.algorithm_version !== LEARNED_LEADER_V7_ALGORITHM_VERSION
        || cohort.config_version !== LEARNED_LEADER_V7_CONFIG_VERSION
        || Number(cohort.target_horizon) !== LEARNED_LEADER_V7_TARGET_HORIZON
        || Number(cohort.forecast_horizon_seconds)
          !== PREDICTIVE_LEADER_V7_FORECAST_HORIZON_SECONDS
        || cohort.mode !== "prospective-shadow"
        || cohort.source !== PREDICTIVE_SHADOW_FROZEN_STREAM.source
        || cohort.instrument !== PREDICTIVE_SHADOW_FROZEN_STREAM.instrument
        || cohort.config_json !== PREDICTIVE_LEADER_V7_CONFIG_JSON
        || cohort.config_sha256 !== PREDICTIVE_LEADER_V7_CONFIG_SHA256
        || cohort.source_export_artifact
          !== PREDICTIVE_LEADER_V7_SOURCE_EXPORT.artifact
        || cohort.source_export_sha256 !== PREDICTIVE_LEADER_V7_SOURCE_EXPORT.sha256
        || cohort.source_export_cutoff_at
          !== PREDICTIVE_LEADER_V7_SOURCE_EXPORT.cutoffAt
        || !Number.isSafeInteger(Number(cohort.first_forecast_id))
        || Number(cohort.first_forecast_id) < 1
        || (cohortInsertionChanges === 1
          && Number(cohort.first_forecast_id) !== firstForecastId)
        || !Number.isFinite(Date.parse(cohort.started_at))
        || cohort.started_at !== cohort.created_at
        || Date.parse(cohort.started_at)
          <= Date.parse(cohort.source_export_cutoff_at)
      ) {
        throw new Error("predictive leader v7 cohort is incompatible");
      }
      this.sqlite.exec(`
        PRAGMA user_version = ${Math.max(27, startingVersion)};
        COMMIT;
      `);
    } catch (error) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // Preserve the migration error.
      }
      throw error;
    }
  }

  #migrateCurrentCellHorizonShadowV28(startingVersion) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS current_cell_horizon_shadow_cohorts (
          cohort_key TEXT PRIMARY KEY CHECK (length(trim(cohort_key)) > 0),
          schema_version INTEGER NOT NULL CHECK (
            schema_version = ${CURRENT_CELL_HORIZON_SHADOW_SCHEMA_VERSION}
          ),
          algorithm_version TEXT NOT NULL UNIQUE CHECK (
            length(trim(algorithm_version)) > 0
          ),
          config_version TEXT NOT NULL CHECK (length(trim(config_version)) > 0),
          horizon_seconds INTEGER NOT NULL CHECK (horizon_seconds = 10),
          mode TEXT NOT NULL CHECK (mode = 'prospective-shadow'),
          source TEXT NOT NULL CHECK (source = 'buleto'),
          instrument TEXT NOT NULL CHECK (instrument = 'XPM/RUB'),
          first_trajectory_id INTEGER NOT NULL CHECK (first_trajectory_id >= 1),
          started_at TEXT NOT NULL,
          config_json TEXT NOT NULL CHECK (
            json_valid(config_json) AND json_type(config_json) = 'object'
          ),
          config_sha256 TEXT NOT NULL CHECK (
            length(config_sha256) = 64 AND config_sha256 = lower(config_sha256)
          ),
          source_export_artifact TEXT NOT NULL CHECK (
            length(trim(source_export_artifact)) > 0
          ),
          source_export_sha256 TEXT NOT NULL CHECK (
            length(source_export_sha256) = 64
            AND source_export_sha256 = lower(source_export_sha256)
          ),
          source_export_cutoff_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(
            cohort_key, schema_version, algorithm_version, config_version,
            config_sha256
          ),
          CHECK (started_at = created_at),
          CHECK (started_at > source_export_cutoff_at),
          CHECK (json_extract(config_json, '$.version') = config_version),
          CHECK (json_extract(config_json, '$.horizonSeconds') = horizon_seconds),
          CHECK (json_extract(config_json, '$.mode') = mode),
          CHECK (json_extract(config_json, '$.executionEnabled') = 0),
          CHECK (json_extract(config_json, '$.advisoryOnly') = 1)
        );

        CREATE TABLE IF NOT EXISTS round_trajectory_current_cell_horizon_snapshots (
          trajectory_id INTEGER NOT NULL REFERENCES round_trajectories(id),
          cohort_key TEXT NOT NULL,
          schema_version INTEGER NOT NULL CHECK (
            schema_version = ${CURRENT_CELL_HORIZON_SHADOW_SCHEMA_VERSION}
          ),
          algorithm_version TEXT NOT NULL CHECK (length(trim(algorithm_version)) > 0),
          config_version TEXT NOT NULL CHECK (length(trim(config_version)) > 0),
          config_sha256 TEXT NOT NULL CHECK (
            length(config_sha256) = 64 AND config_sha256 = lower(config_sha256)
          ),
          status TEXT NOT NULL CHECK (status IN ('ready', 'unavailable')),
          reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
          cutoff_at TEXT NOT NULL,
          captured_at TEXT NOT NULL,
          predicted_number INTEGER CHECK (
            predicted_number IS NULL OR predicted_number BETWEEN 0 AND 36
          ),
          leader_wire_cell INTEGER CHECK (
            leader_wire_cell IS NULL OR leader_wire_cell BETWEEN 0 AND 37
          ),
          leader_probability REAL CHECK (
            leader_probability IS NULL
            OR leader_probability BETWEEN 0 AND 1
          ),
          runner_up_probability REAL CHECK (
            runner_up_probability IS NULL
            OR runner_up_probability BETWEEN 0 AND 1
          ),
          margin REAL CHECK (margin IS NULL OR margin BETWEEN 0 AND 1),
          snapshot_json TEXT NOT NULL CHECK (
            json_valid(snapshot_json) AND json_type(snapshot_json) = 'object'
          ),
          created_at TEXT NOT NULL,
          PRIMARY KEY (trajectory_id, cohort_key),
          FOREIGN KEY (
            cohort_key, schema_version, algorithm_version, config_version,
            config_sha256
          ) REFERENCES current_cell_horizon_shadow_cohorts(
            cohort_key, schema_version, algorithm_version, config_version,
            config_sha256
          ),
          CHECK (cutoff_at <= captured_at AND captured_at <= created_at),
          CHECK (
            (status = 'ready' AND predicted_number IS NOT NULL
              AND leader_wire_cell IS NOT NULL AND leader_probability IS NOT NULL
              AND runner_up_probability IS NOT NULL AND margin IS NOT NULL)
            OR
            (status = 'unavailable' AND predicted_number IS NULL
              AND leader_wire_cell IS NULL AND leader_probability IS NULL
              AND runner_up_probability IS NULL AND margin IS NULL)
          ),
          CHECK (json_extract(snapshot_json, '$.trajectoryId') = trajectory_id),
          CHECK (json_extract(snapshot_json, '$.cohortKey') = cohort_key),
          CHECK (json_extract(snapshot_json, '$.schemaVersion') = schema_version),
          CHECK (json_extract(snapshot_json, '$.algorithmVersion') = algorithm_version),
          CHECK (json_extract(snapshot_json, '$.config.version') = config_version),
          CHECK (json_extract(snapshot_json, '$.status') = status),
          CHECK (json_extract(snapshot_json, '$.reason') = reason),
          CHECK (json_extract(snapshot_json, '$.cutoffAt') = cutoff_at),
          CHECK (json_extract(snapshot_json, '$.capturedAt') = captured_at),
          CHECK (json_extract(snapshot_json, '$.leaderNumber') IS predicted_number),
          CHECK (json_extract(snapshot_json, '$.leaderWireCell') IS leader_wire_cell),
          CHECK (json_extract(snapshot_json, '$.leaderProbability') IS leader_probability),
          CHECK (
            json_extract(snapshot_json, '$.runnerUpProbability')
              IS runner_up_probability
          ),
          CHECK (json_extract(snapshot_json, '$.margin') IS margin),
          CHECK (json_extract(snapshot_json, '$.executionEnabled') = 0),
          CHECK (json_extract(snapshot_json, '$.advisoryOnly') = 1)
        );

        CREATE INDEX IF NOT EXISTS current_cell_horizon_snapshot_stream_idx
          ON round_trajectory_current_cell_horizon_snapshots(
            cohort_key, status, trajectory_id
          );
        CREATE INDEX IF NOT EXISTS current_cell_horizon_snapshot_cutoff_idx
          ON round_trajectory_current_cell_horizon_snapshots(
            cohort_key, cutoff_at, trajectory_id
          );

        CREATE TABLE IF NOT EXISTS round_trajectory_current_cell_horizon_evaluations (
          trajectory_id INTEGER NOT NULL,
          cohort_key TEXT NOT NULL,
          round_result_id INTEGER NOT NULL REFERENCES round_results(id),
          actual_number INTEGER NOT NULL CHECK (actual_number BETWEEN 0 AND 36),
          top1_hit INTEGER NOT NULL CHECK (top1_hit IN (0, 1)),
          brier_loss REAL NOT NULL CHECK (brier_loss BETWEEN 0 AND 1),
          clipped_log_loss REAL NOT NULL CHECK (clipped_log_loss >= 0),
          evaluation_json TEXT NOT NULL CHECK (
            json_valid(evaluation_json) AND json_type(evaluation_json) = 'object'
          ),
          evaluated_at TEXT NOT NULL,
          PRIMARY KEY (trajectory_id, cohort_key),
          UNIQUE(round_result_id, cohort_key),
          FOREIGN KEY (trajectory_id, cohort_key)
            REFERENCES round_trajectory_current_cell_horizon_snapshots(
              trajectory_id, cohort_key
            ),
          CHECK (json_extract(evaluation_json, '$.actualNumber') = actual_number),
          CHECK (json_extract(evaluation_json, '$.top1Hit') = top1_hit),
          CHECK (json_extract(evaluation_json, '$.brierLoss') = brier_loss),
          CHECK (
            json_extract(evaluation_json, '$.clippedLogLoss') = clipped_log_loss
          )
        );

        CREATE INDEX IF NOT EXISTS current_cell_horizon_evaluation_result_idx
          ON round_trajectory_current_cell_horizon_evaluations(
            cohort_key, round_result_id
          );

        CREATE TRIGGER IF NOT EXISTS current_cell_horizon_snapshot_no_backfill
        BEFORE INSERT ON round_trajectory_current_cell_horizon_snapshots
        WHEN NEW.trajectory_id < (
          SELECT first_trajectory_id
          FROM current_cell_horizon_shadow_cohorts
          WHERE cohort_key = NEW.cohort_key
        ) OR NEW.cutoff_at < (
          SELECT started_at
          FROM current_cell_horizon_shadow_cohorts
          WHERE cohort_key = NEW.cohort_key
        ) OR NEW.captured_at < (
          SELECT started_at
          FROM current_cell_horizon_shadow_cohorts
          WHERE cohort_key = NEW.cohort_key
        )
        BEGIN
          SELECT RAISE(ABORT, 'current-cell shadow snapshots cannot be backfilled');
        END;

        CREATE TRIGGER IF NOT EXISTS current_cell_horizon_snapshot_identity
        BEFORE INSERT ON round_trajectory_current_cell_horizon_snapshots
        WHEN NOT EXISTS (
          SELECT 1
          FROM round_trajectories AS trajectories
          JOIN current_cell_horizon_shadow_cohorts AS cohorts
            ON cohorts.cohort_key = NEW.cohort_key
          WHERE trajectories.id = NEW.trajectory_id
            AND json_extract(NEW.snapshot_json, '$.source') = trajectories.source
            AND json_extract(NEW.snapshot_json, '$.instrument')
              = trajectories.instrument
            AND json_extract(NEW.snapshot_json, '$.externalRoundId')
              = trajectories.external_round_id
            AND trajectories.source = cohorts.source
            AND trajectories.instrument = cohorts.instrument
            AND NEW.cutoff_at = strftime(
              '%Y-%m-%dT%H:%M:%fZ', trajectories.betting_closes_at, '-10 seconds'
            )
            AND NEW.captured_at >= NEW.cutoff_at
            AND NEW.captured_at <= strftime(
              '%Y-%m-%dT%H:%M:%fZ', NEW.cutoff_at, '+2.5 seconds'
            )
            AND NEW.captured_at <= strftime(
              '%Y-%m-%dT%H:%M:%fZ', trajectories.betting_closes_at, '-5 seconds'
            )
        )
        BEGIN
          SELECT RAISE(ABORT, 'current-cell shadow snapshot identity is invalid');
        END;

        CREATE TRIGGER IF NOT EXISTS current_cell_horizon_snapshot_chronological
        BEFORE INSERT ON round_trajectory_current_cell_horizon_snapshots
        WHEN EXISTS (
          SELECT 1
          FROM round_trajectory_current_cell_horizon_snapshots AS prior
          JOIN round_trajectories AS prior_trajectory
            ON prior_trajectory.id = prior.trajectory_id
          JOIN round_trajectories AS next_trajectory
            ON next_trajectory.id = NEW.trajectory_id
          WHERE prior.cohort_key = NEW.cohort_key
            AND prior_trajectory.source = next_trajectory.source
            AND prior_trajectory.instrument = next_trajectory.instrument
            AND (
              prior_trajectory.betting_closes_at
                > next_trajectory.betting_closes_at
              OR (
                prior_trajectory.betting_closes_at
                  = next_trajectory.betting_closes_at
                AND prior.trajectory_id > NEW.trajectory_id
              )
            )
        )
        BEGIN
          SELECT RAISE(ABORT, 'current-cell shadow chronological backfill is forbidden');
        END;

        CREATE TRIGGER IF NOT EXISTS current_cell_horizon_evaluation_identity
        BEFORE INSERT ON round_trajectory_current_cell_horizon_evaluations
        WHEN NOT EXISTS (
          SELECT 1
          FROM round_trajectory_current_cell_horizon_snapshots AS snapshots
          JOIN round_trajectories AS trajectories
            ON trajectories.id = snapshots.trajectory_id
          JOIN round_results AS results
            ON results.id = NEW.round_result_id
          WHERE snapshots.trajectory_id = NEW.trajectory_id
            AND snapshots.cohort_key = NEW.cohort_key
            AND snapshots.status = 'ready'
            AND results.source = trajectories.source
            AND results.instrument = trajectories.instrument
            AND results.external_round_id = trajectories.external_round_id
            AND results.result_number = NEW.actual_number
            AND results.settled_at > snapshots.captured_at
            AND results.observed_at > snapshots.captured_at
            AND results.created_at > snapshots.captured_at
            AND NEW.evaluated_at >= results.created_at
        )
        BEGIN
          SELECT RAISE(ABORT, 'current-cell shadow evaluation identity is invalid');
        END;

        CREATE TRIGGER IF NOT EXISTS current_cell_horizon_cohort_immutable_update
        BEFORE UPDATE ON current_cell_horizon_shadow_cohorts
        BEGIN
          SELECT RAISE(ABORT, 'current-cell shadow cohort is immutable');
        END;
        CREATE TRIGGER IF NOT EXISTS current_cell_horizon_cohort_immutable_delete
        BEFORE DELETE ON current_cell_horizon_shadow_cohorts
        BEGIN
          SELECT RAISE(ABORT, 'current-cell shadow cohort is immutable');
        END;
        CREATE TRIGGER IF NOT EXISTS current_cell_horizon_snapshot_immutable_update
        BEFORE UPDATE ON round_trajectory_current_cell_horizon_snapshots
        BEGIN
          SELECT RAISE(ABORT, 'current-cell shadow snapshot is immutable');
        END;
        CREATE TRIGGER IF NOT EXISTS current_cell_horizon_snapshot_immutable_delete
        BEFORE DELETE ON round_trajectory_current_cell_horizon_snapshots
        BEGIN
          SELECT RAISE(ABORT, 'current-cell shadow snapshot is immutable');
        END;
        CREATE TRIGGER IF NOT EXISTS current_cell_horizon_evaluation_immutable_update
        BEFORE UPDATE ON round_trajectory_current_cell_horizon_evaluations
        BEGIN
          SELECT RAISE(ABORT, 'current-cell shadow evaluation is immutable');
        END;
        CREATE TRIGGER IF NOT EXISTS current_cell_horizon_evaluation_immutable_delete
        BEFORE DELETE ON round_trajectory_current_cell_horizon_evaluations
        BEGIN
          SELECT RAISE(ABORT, 'current-cell shadow evaluation is immutable');
        END;
      `);

      const firstTrajectoryId = Number(this.sqlite.prepare(`
        SELECT COALESCE(MAX(id), 0) + 1 AS first_trajectory_id
        FROM round_trajectories
      `).get().first_trajectory_id);
      const existing = this.sqlite.prepare(`
        SELECT cohort_key
        FROM current_cell_horizon_shadow_cohorts
        WHERE cohort_key = ?
      `).get(CURRENT_CELL_HORIZON_SHADOW_COHORT_KEY);
      let inserted = 0;
      if (!existing) {
        const migrationClockAt = asTimestamp(
          this.clock(),
          undefined,
          "current-cell shadow cohort startedAt",
        );
        const startedAt = new Date(Math.max(
          Date.parse(migrationClockAt),
          Date.parse(CURRENT_CELL_HORIZON_SHADOW_SOURCE_EXPORT.cutoffAt) + 1,
        )).toISOString();
        inserted = Number(this.sqlite.prepare(`
          INSERT INTO current_cell_horizon_shadow_cohorts (
            cohort_key, schema_version, algorithm_version, config_version,
            horizon_seconds, mode, source, instrument, first_trajectory_id, started_at,
            config_json, config_sha256, source_export_artifact,
            source_export_sha256, source_export_cutoff_at, created_at
          ) VALUES (?, ?, ?, ?, 10, 'prospective-shadow', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          CURRENT_CELL_HORIZON_SHADOW_COHORT_KEY,
          CURRENT_CELL_HORIZON_SHADOW_SCHEMA_VERSION,
          CURRENT_CELL_HORIZON_SHADOW_ALGORITHM_VERSION,
          CURRENT_CELL_HORIZON_SHADOW_CONFIG_VERSION,
          CURRENT_CELL_HORIZON_SHADOW_SOURCE,
          CURRENT_CELL_HORIZON_SHADOW_INSTRUMENT,
          firstTrajectoryId,
          startedAt,
          CURRENT_CELL_HORIZON_SHADOW_CONFIG_JSON,
          CURRENT_CELL_HORIZON_SHADOW_CONFIG_SHA256,
          CURRENT_CELL_HORIZON_SHADOW_SOURCE_EXPORT.artifact,
          CURRENT_CELL_HORIZON_SHADOW_SOURCE_EXPORT.sha256,
          CURRENT_CELL_HORIZON_SHADOW_SOURCE_EXPORT.cutoffAt,
          startedAt,
        ).changes);
      }
      const cohort = this.sqlite.prepare(`
        SELECT * FROM current_cell_horizon_shadow_cohorts WHERE cohort_key = ?
      `).get(CURRENT_CELL_HORIZON_SHADOW_COHORT_KEY);
      if (
        !cohort
        || Number(cohort.schema_version)
          !== CURRENT_CELL_HORIZON_SHADOW_SCHEMA_VERSION
        || cohort.algorithm_version
          !== CURRENT_CELL_HORIZON_SHADOW_ALGORITHM_VERSION
        || cohort.config_version !== CURRENT_CELL_HORIZON_SHADOW_CONFIG_VERSION
        || Number(cohort.horizon_seconds) !== 10
        || cohort.mode !== "prospective-shadow"
        || cohort.source !== CURRENT_CELL_HORIZON_SHADOW_SOURCE
        || cohort.instrument !== CURRENT_CELL_HORIZON_SHADOW_INSTRUMENT
        || cohort.config_json !== CURRENT_CELL_HORIZON_SHADOW_CONFIG_JSON
        || cohort.config_sha256 !== CURRENT_CELL_HORIZON_SHADOW_CONFIG_SHA256
        || cohort.source_export_artifact
          !== CURRENT_CELL_HORIZON_SHADOW_SOURCE_EXPORT.artifact
        || cohort.source_export_sha256
          !== CURRENT_CELL_HORIZON_SHADOW_SOURCE_EXPORT.sha256
        || cohort.source_export_cutoff_at
          !== CURRENT_CELL_HORIZON_SHADOW_SOURCE_EXPORT.cutoffAt
        || !Number.isSafeInteger(Number(cohort.first_trajectory_id))
        || Number(cohort.first_trajectory_id) < 1
        || (inserted === 1
          && Number(cohort.first_trajectory_id) !== firstTrajectoryId)
        || cohort.started_at !== cohort.created_at
        || Date.parse(cohort.started_at)
          <= Date.parse(cohort.source_export_cutoff_at)
      ) {
        throw new Error("current-cell shadow cohort is incompatible");
      }
      this.sqlite.exec(`
        PRAGMA user_version = ${Math.max(28, startingVersion)};
        COMMIT;
      `);
    } catch (error) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // Preserve the migration error.
      }
      throw error;
    }
  }

  #migrateCurrentCellHorizonMetadataVoidsV29(startingVersion) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS predictive_shadow_integrity_boundaries (
          boundary_key TEXT PRIMARY KEY CHECK (
            boundary_key = 'predictive-shadow-metadata-integrity-v1'
          ),
          policy_version TEXT NOT NULL CHECK (
            policy_version = 'metadata-conflict-void-v1'
          ),
          current_cell_cohort_key TEXT NOT NULL REFERENCES current_cell_horizon_shadow_cohorts(
            cohort_key
          ),
          v7_candidate_key TEXT NOT NULL REFERENCES predictive_leader_v7_cohorts(
            candidate_key
          ),
          first_trajectory_id INTEGER NOT NULL CHECK (first_trajectory_id >= 1),
          first_forecast_id INTEGER NOT NULL CHECK (first_forecast_id >= 1),
          started_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          CHECK (started_at = created_at)
        );

        CREATE TABLE IF NOT EXISTS predictive_shadow_round_metadata_conflicts (
          boundary_key TEXT NOT NULL REFERENCES predictive_shadow_integrity_boundaries(
            boundary_key
          ),
          source TEXT NOT NULL,
          instrument TEXT NOT NULL,
          external_round_id TEXT NOT NULL,
          reason TEXT NOT NULL CHECK (reason = 'metadata_conflict'),
          original_betting_closes_at TEXT NOT NULL,
          observed_betting_closes_at TEXT NOT NULL,
          observed_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (boundary_key, source, instrument, external_round_id),
          CHECK (original_betting_closes_at <> observed_betting_closes_at),
          CHECK (observed_at <= created_at)
        );

        CREATE INDEX IF NOT EXISTS predictive_shadow_metadata_conflict_stream_idx
          ON predictive_shadow_round_metadata_conflicts(
            boundary_key, created_at, external_round_id
          );

        CREATE TRIGGER IF NOT EXISTS current_cell_horizon_snapshot_not_void
        BEFORE INSERT ON round_trajectory_current_cell_horizon_snapshots
        WHEN EXISTS (
          SELECT 1
          FROM predictive_shadow_round_metadata_conflicts AS voids
          JOIN round_trajectories AS trajectories
            ON trajectories.id = NEW.trajectory_id
          JOIN predictive_shadow_integrity_boundaries AS boundaries
            ON boundaries.boundary_key = voids.boundary_key
           AND boundaries.current_cell_cohort_key = NEW.cohort_key
          WHERE voids.boundary_key = 'predictive-shadow-metadata-integrity-v1'
            AND voids.source = trajectories.source
            AND voids.instrument = trajectories.instrument
            AND voids.external_round_id = trajectories.external_round_id
        )
        BEGIN
          SELECT RAISE(ABORT, 'current-cell shadow snapshot identity is void');
        END;

        CREATE TRIGGER IF NOT EXISTS current_cell_horizon_snapshot_v29_boundary
        BEFORE INSERT ON round_trajectory_current_cell_horizon_snapshots
        WHEN NOT EXISTS (
          SELECT 1
          FROM round_trajectories AS trajectories
          JOIN predictive_shadow_integrity_boundaries AS boundaries
            ON boundaries.current_cell_cohort_key = NEW.cohort_key
          WHERE trajectories.id = NEW.trajectory_id
            AND trajectories.id >= boundaries.first_trajectory_id
            AND trajectories.created_at >= boundaries.started_at
            AND NEW.cutoff_at >= boundaries.started_at
            AND NEW.captured_at >= boundaries.started_at
        )
        BEGIN
          SELECT RAISE(ABORT, 'current-cell shadow snapshot predates v29 boundary');
        END;

        CREATE TRIGGER IF NOT EXISTS current_cell_horizon_evaluation_not_void
        BEFORE INSERT ON round_trajectory_current_cell_horizon_evaluations
        WHEN EXISTS (
          SELECT 1
          FROM predictive_shadow_round_metadata_conflicts AS voids
          JOIN round_trajectories AS trajectories
            ON trajectories.id = NEW.trajectory_id
          JOIN predictive_shadow_integrity_boundaries AS boundaries
            ON boundaries.boundary_key = voids.boundary_key
           AND boundaries.current_cell_cohort_key = NEW.cohort_key
          WHERE voids.boundary_key = 'predictive-shadow-metadata-integrity-v1'
            AND voids.source = trajectories.source
            AND voids.instrument = trajectories.instrument
            AND voids.external_round_id = trajectories.external_round_id
        )
        BEGIN
          SELECT RAISE(ABORT, 'current-cell shadow evaluation identity is void');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_v29_boundary
        BEFORE INSERT ON forecast_predictive_leader_v7_snapshots
        WHEN NOT EXISTS (
          SELECT 1
          FROM round_forecasts AS forecasts
          JOIN forecast_snapshots AS snapshots
            ON snapshots.id = forecasts.snapshot_id
          JOIN predictive_shadow_integrity_boundaries AS boundaries
            ON boundaries.v7_candidate_key = NEW.candidate_key
          WHERE forecasts.id = NEW.forecast_id
            AND forecasts.id >= boundaries.first_forecast_id
            AND snapshots.locked_at >= boundaries.started_at
        )
        BEGIN
          SELECT RAISE(ABORT, 'predictive leader v7 snapshot predates v29 boundary');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_snapshot_not_void
        BEFORE INSERT ON forecast_predictive_leader_v7_snapshots
        WHEN EXISTS (
          SELECT 1
          FROM round_forecasts AS forecasts
          JOIN forecast_snapshots AS snapshots
            ON snapshots.id = forecasts.snapshot_id
          JOIN predictive_shadow_integrity_boundaries AS boundaries
            ON boundaries.v7_candidate_key = NEW.candidate_key
          JOIN predictive_shadow_round_metadata_conflicts AS voids
            ON voids.boundary_key = boundaries.boundary_key
           AND voids.source = snapshots.source
           AND voids.instrument = snapshots.instrument
           AND voids.external_round_id = snapshots.external_round_id
          WHERE forecasts.id = NEW.forecast_id
        )
        BEGIN
          SELECT RAISE(ABORT, 'predictive leader v7 snapshot identity is void');
        END;

        CREATE TRIGGER IF NOT EXISTS current_cell_horizon_void_identity
        BEFORE INSERT ON predictive_shadow_round_metadata_conflicts
        WHEN NOT EXISTS (
          SELECT 1
          FROM predictive_shadow_integrity_boundaries AS boundaries
          JOIN current_cell_horizon_shadow_cohorts AS cohorts
            ON cohorts.cohort_key = boundaries.current_cell_cohort_key
          JOIN predictive_leader_v7_cohorts AS v7_cohorts
            ON v7_cohorts.candidate_key = boundaries.v7_candidate_key
          WHERE boundaries.boundary_key = NEW.boundary_key
            AND NEW.source = cohorts.source
            AND NEW.instrument = cohorts.instrument
            AND NEW.source = v7_cohorts.source
            AND NEW.instrument = v7_cohorts.instrument
            AND length(trim(NEW.external_round_id)) > 0
            AND NEW.reason = 'metadata_conflict'
            AND NEW.original_betting_closes_at <> NEW.observed_betting_closes_at
            AND NEW.observed_at >= boundaries.started_at
            AND NEW.created_at >= boundaries.started_at
            AND NEW.created_at >= NEW.observed_at
        )
        BEGIN
          SELECT RAISE(ABORT, 'current-cell shadow void identity is invalid');
        END;

        CREATE TRIGGER IF NOT EXISTS current_cell_horizon_void_immutable_update
        BEFORE UPDATE ON predictive_shadow_round_metadata_conflicts
        BEGIN
          SELECT RAISE(ABORT, 'current-cell shadow void is immutable');
        END;
        CREATE TRIGGER IF NOT EXISTS current_cell_horizon_void_immutable_delete
        BEFORE DELETE ON predictive_shadow_round_metadata_conflicts
        BEGIN
          SELECT RAISE(ABORT, 'current-cell shadow void is immutable');
        END;
        CREATE TRIGGER IF NOT EXISTS current_cell_horizon_boundary_immutable_update
        BEFORE UPDATE ON predictive_shadow_integrity_boundaries
        BEGIN
          SELECT RAISE(ABORT, 'current-cell shadow gate boundary is immutable');
        END;
        CREATE TRIGGER IF NOT EXISTS current_cell_horizon_boundary_immutable_delete
        BEFORE DELETE ON predictive_shadow_integrity_boundaries
        BEGIN
          SELECT RAISE(ABORT, 'current-cell shadow gate boundary is immutable');
        END;
      `);

      const cohort = this.sqlite.prepare(`
        SELECT *
        FROM current_cell_horizon_shadow_cohorts
        WHERE cohort_key = ?
      `).get(CURRENT_CELL_HORIZON_SHADOW_COHORT_KEY);
      if (!cohort) throw new Error("current-cell shadow cohort is missing");
      const v7Cohort = this.sqlite.prepare(`
        SELECT *
        FROM predictive_leader_v7_cohorts
        WHERE candidate_key = ?
      `).get(PREDICTIVE_LEADER_V7_CANDIDATE_CONFIG.candidateId);
      if (!v7Cohort) throw new Error("predictive leader v7 cohort is missing");
      const existing = this.sqlite.prepare(`
        SELECT *
        FROM predictive_shadow_integrity_boundaries
        WHERE boundary_key = 'predictive-shadow-metadata-integrity-v1'
      `).get();
      const firstTrajectoryId = Number(this.sqlite.prepare(`
        SELECT COALESCE(MAX(id), 0) + 1 AS first_trajectory_id
        FROM round_trajectories
      `).get().first_trajectory_id);
      const firstForecastId = Number(this.sqlite.prepare(`
        SELECT COALESCE(MAX(id), 0) + 1 AS first_forecast_id
        FROM round_forecasts
      `).get().first_forecast_id);
      let inserted = 0;
      if (!existing) {
        const minimumStartedAtMs = Math.max(
          Date.parse(cohort.started_at),
          Date.parse(v7Cohort.started_at),
        );
        const migrationStartedAtMs = startingVersion >= 28
          ? Date.parse(asTimestamp(
              this.clock(),
              undefined,
              "predictive shadow v29 boundary startedAt",
            ))
          : minimumStartedAtMs;
        const startedAt = new Date(Math.max(
          minimumStartedAtMs,
          migrationStartedAtMs,
        )).toISOString();
        inserted = Number(this.sqlite.prepare(`
          INSERT INTO predictive_shadow_integrity_boundaries (
            boundary_key, policy_version, current_cell_cohort_key, v7_candidate_key,
            first_trajectory_id, first_forecast_id, started_at, created_at
          ) VALUES (
            'predictive-shadow-metadata-integrity-v1',
            'metadata-conflict-void-v1', ?, ?, ?, ?, ?, ?
          )
        `).run(
          CURRENT_CELL_HORIZON_SHADOW_COHORT_KEY,
          PREDICTIVE_LEADER_V7_CANDIDATE_CONFIG.candidateId,
          firstTrajectoryId,
          firstForecastId,
          startedAt,
          startedAt,
        ).changes);
      }
      const boundary = this.sqlite.prepare(`
        SELECT *
        FROM predictive_shadow_integrity_boundaries
        WHERE boundary_key = 'predictive-shadow-metadata-integrity-v1'
      `).get();
      if (
        !boundary
        || boundary.policy_version !== "metadata-conflict-void-v1"
        || boundary.current_cell_cohort_key !== CURRENT_CELL_HORIZON_SHADOW_COHORT_KEY
        || boundary.v7_candidate_key
          !== PREDICTIVE_LEADER_V7_CANDIDATE_CONFIG.candidateId
        || !Number.isSafeInteger(Number(boundary.first_trajectory_id))
        || Number(boundary.first_trajectory_id) < 1
        || !Number.isSafeInteger(Number(boundary.first_forecast_id))
        || Number(boundary.first_forecast_id) < 1
        || boundary.started_at !== boundary.created_at
        || boundary.started_at < cohort.started_at
        || boundary.started_at < v7Cohort.started_at
        || (inserted === 1
          && (
            Number(boundary.first_trajectory_id) !== firstTrajectoryId
            || Number(boundary.first_forecast_id) !== firstForecastId
          ))
      ) {
        throw new Error("current-cell shadow v29 boundary is incompatible");
      }
      this.sqlite.exec(`
        PRAGMA user_version = ${Math.max(29, startingVersion)};
        COMMIT;
      `);
    } catch (error) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // Preserve the migration error.
      }
      throw error;
    }
  }

  #migratePredictiveLeaderV7PaperCampaignV30(startingVersion) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS predictive_leader_v7_paper_campaigns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_key TEXT NOT NULL UNIQUE CHECK (length(trim(campaign_key)) > 0),
          schema_version INTEGER NOT NULL CHECK (
            schema_version = ${PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.schemaVersion}
          ),
          strategy_version TEXT NOT NULL CHECK (length(trim(strategy_version)) > 0),
          candidate_key TEXT NOT NULL REFERENCES predictive_leader_v7_cohorts(
            candidate_key
          ),
          algorithm_version TEXT NOT NULL CHECK (length(trim(algorithm_version)) > 0),
          mode TEXT NOT NULL CHECK (mode = 'manual-override-paper'),
          execution_enabled INTEGER NOT NULL CHECK (execution_enabled = 0),
          advisory_only INTEGER NOT NULL CHECK (advisory_only = 1),
          promotion_eligible INTEGER NOT NULL CHECK (promotion_eligible = 0),
          promotion_policy TEXT NOT NULL CHECK (
            promotion_policy = 'manual-override-paper-not-promoted'
          ),
          authorization_reason TEXT NOT NULL CHECK (
            authorization_reason = 'operator-requested-virtual-api-2026-10-19'
          ),
          source TEXT NOT NULL,
          instrument TEXT NOT NULL,
          first_forecast_id INTEGER NOT NULL CHECK (first_forecast_id >= 1),
          status TEXT NOT NULL CHECK (status IN ('running', 'exhausted')),
          initial_balance INTEGER NOT NULL CHECK (initial_balance = 1000),
          current_balance INTEGER NOT NULL CHECK (current_balance >= 0),
          ledger_deficit INTEGER NOT NULL DEFAULT 0 CHECK (ledger_deficit >= 0),
          fixed_stake INTEGER NOT NULL CHECK (fixed_stake = 10),
          gross_payout_multiplier INTEGER NOT NULL CHECK (
            gross_payout_multiplier = 36
          ),
          payout_includes_stake INTEGER NOT NULL CHECK (payout_includes_stake = 1),
          last_continuity_epoch INTEGER NOT NULL CHECK (last_continuity_epoch >= 0),
          continuity_gap_count INTEGER NOT NULL DEFAULT 0 CHECK (
            continuity_gap_count >= 0
          ),
          started_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          exhausted_at TEXT,
          created_at TEXT NOT NULL,
          UNIQUE(candidate_key, strategy_version),
          CHECK (started_at = created_at),
          CHECK (started_at <= updated_at),
          CHECK (current_balance = 0 OR ledger_deficit = 0),
          CHECK (
            (status = 'running' AND exhausted_at IS NULL)
            OR
            (status = 'exhausted' AND exhausted_at IS NOT NULL
              AND (current_balance < fixed_stake OR ledger_deficit > 0))
          )
        );

        CREATE TABLE IF NOT EXISTS predictive_leader_v7_paper_bets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_id INTEGER NOT NULL REFERENCES
            predictive_leader_v7_paper_campaigns(id),
          forecast_id INTEGER NOT NULL,
          candidate_key TEXT NOT NULL,
          external_round_id TEXT NOT NULL CHECK (
            length(trim(external_round_id)) > 0
          ),
          continuity_epoch INTEGER NOT NULL CHECK (continuity_epoch >= 0),
          target_number INTEGER NOT NULL CHECK (target_number BETWEEN 0 AND 36),
          stake INTEGER NOT NULL CHECK (stake = 10),
          balance_before INTEGER NOT NULL CHECK (balance_before >= stake),
          locked_at TEXT NOT NULL,
          betting_closes_at TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'settled', 'void')),
          round_result_id INTEGER REFERENCES round_results(id),
          result_number INTEGER CHECK (
            result_number IS NULL OR result_number BETWEEN 0 AND 36
          ),
          outcome TEXT CHECK (outcome IS NULL OR outcome IN ('hit', 'miss')),
          gross_payout INTEGER CHECK (gross_payout IS NULL OR gross_payout >= 0),
          balance_after INTEGER CHECK (balance_after IS NULL OR balance_after >= 0),
          void_reason TEXT CHECK (
            void_reason IS NULL OR void_reason IN (
              'integrity_gap', 'round_metadata_conflict'
            )
          ),
          void_incident_id INTEGER REFERENCES incidents(id),
          void_continuity_epoch INTEGER CHECK (
            void_continuity_epoch IS NULL OR void_continuity_epoch >= 1
          ),
          placed_at TEXT NOT NULL,
          settled_at TEXT,
          voided_at TEXT,
          updated_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(campaign_id, forecast_id),
          UNIQUE(campaign_id, round_result_id),
          FOREIGN KEY (forecast_id, candidate_key) REFERENCES
            forecast_predictive_leader_v7_snapshots(forecast_id, candidate_key),
          CHECK (locked_at <= placed_at),
          CHECK (placed_at = created_at),
          CHECK (placed_at <= updated_at),
          CHECK (
            (status = 'pending' AND round_result_id IS NULL
              AND result_number IS NULL AND outcome IS NULL
              AND gross_payout IS NULL AND balance_after IS NULL
              AND void_reason IS NULL AND void_incident_id IS NULL
              AND void_continuity_epoch IS NULL AND settled_at IS NULL
              AND voided_at IS NULL)
            OR
            (status = 'settled' AND round_result_id IS NOT NULL
              AND result_number IS NOT NULL AND outcome IS NOT NULL
              AND gross_payout IS NOT NULL AND balance_after IS NOT NULL
              AND void_reason IS NULL AND void_incident_id IS NULL
              AND void_continuity_epoch IS NULL AND settled_at IS NOT NULL
              AND voided_at IS NULL
              AND placed_at <= settled_at
              AND balance_after = balance_before - stake + gross_payout
              AND (outcome = 'hit') = (target_number = result_number)
              AND gross_payout = CASE
                WHEN outcome = 'hit' THEN stake * 36 ELSE 0 END)
            OR
            (status = 'void' AND round_result_id IS NULL
              AND result_number IS NULL AND outcome IS NULL
              AND gross_payout IS NULL AND balance_after IS NULL
              AND void_reason IS NOT NULL AND settled_at IS NULL
              AND voided_at IS NOT NULL
              AND ((void_reason = 'integrity_gap'
                AND void_incident_id IS NOT NULL
                AND void_continuity_epoch IS NOT NULL)
              OR (void_reason = 'round_metadata_conflict'
                AND void_incident_id IS NULL
                AND void_continuity_epoch IS NULL)))
          )
        );

        CREATE TABLE IF NOT EXISTS predictive_leader_v7_paper_voids (
          bet_id INTEGER PRIMARY KEY REFERENCES
            predictive_leader_v7_paper_bets(id),
          campaign_id INTEGER NOT NULL REFERENCES
            predictive_leader_v7_paper_campaigns(id),
          prior_status TEXT NOT NULL CHECK (prior_status IN ('pending', 'settled')),
          reason TEXT NOT NULL CHECK (
            reason IN ('integrity_gap', 'round_metadata_conflict')
          ),
          balance_adjustment INTEGER NOT NULL,
          incident_id INTEGER REFERENCES incidents(id),
          continuity_epoch INTEGER CHECK (
            continuity_epoch IS NULL OR continuity_epoch >= 1
          ),
          voided_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          CHECK (voided_at = created_at),
          CHECK (
            (reason = 'integrity_gap' AND incident_id IS NOT NULL
              AND continuity_epoch IS NOT NULL)
            OR
            (reason = 'round_metadata_conflict' AND incident_id IS NULL
              AND continuity_epoch IS NULL)
          )
        );

        CREATE UNIQUE INDEX IF NOT EXISTS predictive_leader_v7_paper_pending_idx
          ON predictive_leader_v7_paper_bets(campaign_id)
          WHERE status = 'pending';
        CREATE INDEX IF NOT EXISTS predictive_leader_v7_paper_history_idx
          ON predictive_leader_v7_paper_bets(campaign_id, forecast_id DESC);
        CREATE INDEX IF NOT EXISTS predictive_leader_v7_paper_void_history_idx
          ON predictive_leader_v7_paper_voids(campaign_id, voided_at DESC, bet_id DESC);

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_campaign_config_immutable
        BEFORE UPDATE OF
          campaign_key, schema_version, strategy_version, candidate_key,
          algorithm_version, mode, execution_enabled, advisory_only,
          promotion_eligible, promotion_policy, authorization_reason,
          source, instrument,
          first_forecast_id, initial_balance, fixed_stake,
          gross_payout_multiplier, payout_includes_stake, started_at, created_at
        ON predictive_leader_v7_paper_campaigns
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper campaign configuration is immutable');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_campaign_no_delete
        BEFORE DELETE ON predictive_leader_v7_paper_campaigns
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper campaign cannot be deleted');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_no_backfill
        BEFORE INSERT ON predictive_leader_v7_paper_bets
        WHEN NOT EXISTS (
          SELECT 1
          FROM predictive_leader_v7_paper_campaigns AS campaigns
          WHERE campaigns.id = NEW.campaign_id
            AND campaigns.candidate_key = NEW.candidate_key
            AND NEW.forecast_id >= campaigns.first_forecast_id
            AND NEW.placed_at >= campaigns.started_at
        )
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper bets cannot be backfilled');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_valid_pending
        BEFORE INSERT ON predictive_leader_v7_paper_bets
        WHEN NEW.status <> 'pending' OR NOT EXISTS (
          SELECT 1
          FROM predictive_leader_v7_paper_campaigns AS campaigns
          JOIN forecast_predictive_leader_v7_snapshots AS leaders
            ON leaders.forecast_id = NEW.forecast_id
           AND leaders.candidate_key = NEW.candidate_key
          JOIN round_forecasts AS forecasts ON forecasts.id = leaders.forecast_id
          JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
          WHERE campaigns.id = NEW.campaign_id
            AND campaigns.status = 'running'
            AND campaigns.candidate_key = leaders.candidate_key
            AND campaigns.algorithm_version = leaders.algorithm_version
            AND campaigns.source = snapshots.source
            AND campaigns.instrument = snapshots.instrument
            AND campaigns.current_balance >= NEW.stake
            AND campaigns.ledger_deficit = 0
            AND NEW.continuity_epoch = campaigns.last_continuity_epoch
            AND NEW.continuity_epoch = (
              SELECT continuity_epoch
              FROM stream_state
              WHERE source = campaigns.source AND instrument = campaigns.instrument
            )
            AND NEW.balance_before = campaigns.current_balance
            AND leaders.status = 'ready'
            AND leaders.selected = 1
            AND leaders.locked_at >= campaigns.started_at
            AND leaders.created_at >= campaigns.started_at
            AND leaders.predicted_number = NEW.target_number
            AND leaders.locked_at = NEW.locked_at
            AND snapshots.external_round_id = NEW.external_round_id
            AND snapshots.locked_at = NEW.locked_at
            AND snapshots.betting_closes_at = NEW.betting_closes_at
            AND NEW.placed_at >= NEW.locked_at
            AND (julianday(NEW.betting_closes_at) - julianday(NEW.placed_at))
              * 86400000 >= 4999
            AND NOT EXISTS (
              SELECT 1 FROM forecast_settlements
              WHERE forecast_id = NEW.forecast_id
            )
            AND NOT EXISTS (
              SELECT 1 FROM round_results AS results
              WHERE results.source = campaigns.source
                AND results.instrument = campaigns.instrument
                AND results.external_round_id = NEW.external_round_id
            )
            AND NOT EXISTS (
              SELECT 1
              FROM predictive_shadow_round_metadata_conflicts AS conflicts
              WHERE conflicts.boundary_key = 'predictive-shadow-metadata-integrity-v1'
                AND conflicts.source = campaigns.source
                AND conflicts.instrument = campaigns.instrument
                AND conflicts.external_round_id = NEW.external_round_id
            )
        )
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper pending bet is not eligible');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_bet_placement_immutable
        BEFORE UPDATE OF
          campaign_id, forecast_id, candidate_key, external_round_id,
          continuity_epoch, target_number, stake, balance_before, locked_at,
          betting_closes_at, placed_at, created_at
        ON predictive_leader_v7_paper_bets
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper bet placement is immutable');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_bet_terminal_immutable
        BEFORE UPDATE ON predictive_leader_v7_paper_bets
        WHEN OLD.status <> 'pending' OR NEW.status NOT IN ('settled', 'void')
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper terminal bet is immutable');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_bet_no_delete
        BEFORE DELETE ON predictive_leader_v7_paper_bets
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper bet cannot be deleted');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_void_valid
        BEFORE INSERT ON predictive_leader_v7_paper_voids
        WHEN NOT EXISTS (
          SELECT 1
          FROM predictive_leader_v7_paper_bets AS bets
          WHERE bets.id = NEW.bet_id
            AND bets.campaign_id = NEW.campaign_id
            AND bets.status = NEW.prior_status
            AND NEW.voided_at >= bets.placed_at
            AND NEW.voided_at >= bets.updated_at
            AND (bets.settled_at IS NULL OR NEW.voided_at >= bets.settled_at)
        )
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper void identity is invalid');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_void_immutable_update
        BEFORE UPDATE ON predictive_leader_v7_paper_voids
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper void is immutable');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_void_immutable_delete
        BEFORE DELETE ON predictive_leader_v7_paper_voids
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper void cannot be deleted');
        END;
      `);

      const cohort = this.sqlite.prepare(`
        SELECT *
        FROM predictive_leader_v7_cohorts
        WHERE candidate_key = ?
      `).get(PREDICTIVE_LEADER_V7_CANDIDATE_CONFIG.candidateId);
      if (!cohort) throw new Error("predictive leader v7 paper cohort is missing");
      const continuityEpoch = Number(this.sqlite.prepare(`
        SELECT continuity_epoch
        FROM stream_state
        WHERE source = ? AND instrument = ?
      `).get(cohort.source, cohort.instrument)?.continuity_epoch ?? 0);
      const firstForecastId = Number(this.sqlite.prepare(`
        SELECT COALESCE(MAX(id), 0) + 1 AS first_forecast_id
        FROM round_forecasts
      `).get().first_forecast_id);
      const existing = this.sqlite.prepare(`
        SELECT id
        FROM predictive_leader_v7_paper_campaigns
        WHERE campaign_key = ?
      `).get(PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.campaignKey);
      let inserted = 0;
      if (!existing) {
        const migrationClockAt = startingVersion >= 29
          ? asTimestamp(
              this.clock(),
              undefined,
              "predictive leader v7 paper campaign startedAt",
            )
          : cohort.started_at;
        const startedAt = new Date(Math.max(
          Date.parse(migrationClockAt),
          Date.parse(cohort.started_at),
        )).toISOString();
        inserted = Number(this.sqlite.prepare(`
          INSERT INTO predictive_leader_v7_paper_campaigns (
            campaign_key, schema_version, strategy_version, candidate_key,
            algorithm_version, mode, execution_enabled, advisory_only,
            promotion_eligible, promotion_policy, authorization_reason,
            source, instrument,
            first_forecast_id, status, initial_balance, current_balance,
            ledger_deficit,
            fixed_stake, gross_payout_multiplier, payout_includes_stake,
            last_continuity_epoch, continuity_gap_count, started_at, updated_at,
            exhausted_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 0, 1, 0, ?, ?, ?, ?, ?, 'running',
            ?, ?, 0, ?, ?, 1, ?, 0, ?, ?, NULL, ?)
        `).run(
          PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.campaignKey,
          PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.schemaVersion,
          PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.strategyVersion,
          cohort.candidate_key,
          cohort.algorithm_version,
          PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.mode,
          PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.promotionPolicy,
          PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.authorizationReason,
          cohort.source,
          cohort.instrument,
          firstForecastId,
          PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.initialBalance,
          PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.initialBalance,
          PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.fixedStake,
          PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.grossPayoutMultiplier,
          continuityEpoch,
          startedAt,
          startedAt,
          startedAt,
        ).changes);
      }
      const campaign = this.sqlite.prepare(`
        SELECT *
        FROM predictive_leader_v7_paper_campaigns
        WHERE campaign_key = ?
      `).get(PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.campaignKey);
      if (
        !campaign
        || Number(campaign.schema_version)
          !== PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.schemaVersion
        || campaign.strategy_version
          !== PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.strategyVersion
        || campaign.candidate_key !== cohort.candidate_key
        || campaign.algorithm_version !== cohort.algorithm_version
        || campaign.mode !== PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.mode
        || Boolean(campaign.execution_enabled)
          !== PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.executionEnabled
        || Boolean(campaign.advisory_only)
          !== PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.advisoryOnly
        || Boolean(campaign.promotion_eligible)
          !== PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.promotionEligible
        || campaign.promotion_policy
          !== PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.promotionPolicy
        || campaign.authorization_reason
          !== PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.authorizationReason
        || campaign.source !== cohort.source
        || campaign.instrument !== cohort.instrument
        || Number(campaign.initial_balance)
          !== PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.initialBalance
        || !Number.isSafeInteger(Number(campaign.current_balance))
        || Number(campaign.current_balance) < 0
        || !Number.isSafeInteger(Number(campaign.ledger_deficit))
        || Number(campaign.ledger_deficit) < 0
        || (Number(campaign.current_balance) > 0
          && Number(campaign.ledger_deficit) > 0)
        || Number(campaign.fixed_stake)
          !== PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.fixedStake
        || Number(campaign.gross_payout_multiplier)
          !== PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.grossPayoutMultiplier
        || !Boolean(campaign.payout_includes_stake)
        || !Number.isSafeInteger(Number(campaign.first_forecast_id))
        || Number(campaign.first_forecast_id) < 1
        || campaign.started_at !== campaign.created_at
        || campaign.started_at < cohort.started_at
        || (inserted === 1
          && Number(campaign.first_forecast_id) !== firstForecastId)
      ) {
        throw new Error("predictive leader v7 paper campaign is incompatible");
      }
      this.sqlite.exec(`
        PRAGMA user_version = ${Math.max(30, startingVersion)};
        COMMIT;
      `);
    } catch (error) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // Preserve the migration error.
      }
      throw error;
    }
  }

  #migratePredictiveLeaderV7PaperLadderCampaignV31(startingVersion) {
    const campaignConfig = PREDICTIVE_LEADER_V7_PAPER_LADDER_CAMPAIGN;
    const model = campaignConfig.model;
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS predictive_leader_v7_paper_ladder_campaigns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_key TEXT NOT NULL UNIQUE CHECK (length(trim(campaign_key)) > 0),
          schema_version INTEGER NOT NULL CHECK (
            schema_version = ${campaignConfig.schemaVersion}
          ),
          strategy_version TEXT NOT NULL CHECK (length(trim(strategy_version)) > 0),
          candidate_key TEXT NOT NULL REFERENCES predictive_leader_v7_cohorts(
            candidate_key
          ),
          algorithm_version TEXT NOT NULL CHECK (length(trim(algorithm_version)) > 0),
          mode TEXT NOT NULL CHECK (mode = 'manual-override-paper'),
          execution_enabled INTEGER NOT NULL CHECK (execution_enabled = 0),
          advisory_only INTEGER NOT NULL CHECK (advisory_only = 1),
          promotion_eligible INTEGER NOT NULL CHECK (promotion_eligible = 0),
          promotion_policy TEXT NOT NULL CHECK (
            promotion_policy = 'manual-override-paper-not-promoted'
          ),
          authorization_reason TEXT NOT NULL CHECK (
            authorization_reason = 'operator-requested-virtual-api-2026-10-19'
          ),
          source TEXT NOT NULL,
          instrument TEXT NOT NULL,
          first_forecast_id INTEGER NOT NULL CHECK (first_forecast_id >= 1),
          status TEXT NOT NULL CHECK (status IN ('running', 'exhausted')),
          initial_balance INTEGER NOT NULL CHECK (initial_balance = ${model.initialBalance}),
          current_balance INTEGER NOT NULL CHECK (current_balance >= 0),
          ledger_deficit INTEGER NOT NULL DEFAULT 0 CHECK (ledger_deficit >= 0),
          model_kind TEXT NOT NULL CHECK (model_kind = 'loss-recovery-ladder'),
          initial_stake INTEGER NOT NULL CHECK (initial_stake = ${model.initialStake}),
          stake_step INTEGER NOT NULL CHECK (stake_step = ${model.stakeStep}),
          max_stake INTEGER NOT NULL CHECK (max_stake = ${model.maxStake}),
          cycle_spend_limit INTEGER NOT NULL CHECK (
            cycle_spend_limit = ${model.cycleSpendLimit}
          ),
          reset_policy TEXT NOT NULL CHECK (
            reset_policy = '${model.resetPolicy}'
          ),
          gross_payout_multiplier INTEGER NOT NULL CHECK (
            gross_payout_multiplier = ${model.grossPayoutMultiplier}
          ),
          payout_includes_stake INTEGER NOT NULL CHECK (payout_includes_stake = 1),
          cycle_number INTEGER NOT NULL DEFAULT 1 CHECK (cycle_number >= 1),
          cycle_staked INTEGER NOT NULL DEFAULT 0 CHECK (
            cycle_staked >= 0 AND cycle_staked < cycle_spend_limit
          ),
          ladder_loss INTEGER NOT NULL DEFAULT 0 CHECK (ladder_loss >= 0),
          ladder_miss_count INTEGER NOT NULL DEFAULT 0 CHECK (ladder_miss_count >= 0),
          reset_count INTEGER NOT NULL DEFAULT 0 CHECK (reset_count >= 0),
          next_stake INTEGER NOT NULL CHECK (
            next_stake >= initial_stake
            AND next_stake <= max_stake
            AND next_stake <= cycle_spend_limit - cycle_staked
            AND next_stake % stake_step = 0
          ),
          ledger_revision INTEGER NOT NULL DEFAULT 0 CHECK (ledger_revision >= 0),
          last_continuity_epoch INTEGER NOT NULL CHECK (last_continuity_epoch >= 0),
          activation_gap_incident_id INTEGER NOT NULL CHECK (
            activation_gap_incident_id >= 0
          ),
          last_gap_incident_id INTEGER NOT NULL CHECK (
            last_gap_incident_id >= activation_gap_incident_id
          ),
          continuity_gap_count INTEGER NOT NULL DEFAULT 0 CHECK (
            continuity_gap_count >= 0
          ),
          started_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          exhausted_at TEXT,
          created_at TEXT NOT NULL,
          UNIQUE(candidate_key, strategy_version),
          CHECK (started_at = created_at),
          CHECK (started_at <= updated_at),
          CHECK (current_balance = 0 OR ledger_deficit = 0),
          CHECK (ladder_loss = cycle_staked),
          CHECK (
            (status = 'running' AND exhausted_at IS NULL)
            OR
            (status = 'exhausted' AND exhausted_at IS NOT NULL
              AND (current_balance < next_stake OR ledger_deficit > 0))
          )
        );

        CREATE TABLE IF NOT EXISTS predictive_leader_v7_paper_ladder_bets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_id INTEGER NOT NULL REFERENCES
            predictive_leader_v7_paper_ladder_campaigns(id),
          forecast_id INTEGER NOT NULL,
          candidate_key TEXT NOT NULL,
          external_round_id TEXT NOT NULL CHECK (length(trim(external_round_id)) > 0),
          continuity_epoch INTEGER NOT NULL CHECK (continuity_epoch >= 0),
          target_number INTEGER NOT NULL CHECK (target_number BETWEEN 0 AND 36),
          stake INTEGER NOT NULL CHECK (stake > 0),
          raw_stake INTEGER NOT NULL CHECK (raw_stake > 0),
          balance_before INTEGER NOT NULL CHECK (balance_before >= stake),
          cycle_number_before INTEGER NOT NULL CHECK (cycle_number_before >= 1),
          cycle_staked_before INTEGER NOT NULL CHECK (
            cycle_staked_before >= 0 AND cycle_staked_before < ${model.cycleSpendLimit}
          ),
          ladder_loss_before INTEGER NOT NULL CHECK (ladder_loss_before >= 0),
          ladder_miss_count_before INTEGER NOT NULL CHECK (ladder_miss_count_before >= 0),
          locked_at TEXT NOT NULL,
          betting_closes_at TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'settled', 'void')),
          round_result_id INTEGER REFERENCES round_results(id),
          result_number INTEGER CHECK (
            result_number IS NULL OR result_number BETWEEN 0 AND 36
          ),
          outcome TEXT CHECK (outcome IS NULL OR outcome IN ('hit', 'miss')),
          gross_payout INTEGER CHECK (gross_payout IS NULL OR gross_payout >= 0),
          balance_after INTEGER CHECK (balance_after IS NULL OR balance_after >= 0),
          cycle_number_after INTEGER CHECK (
            cycle_number_after IS NULL OR cycle_number_after >= cycle_number_before
          ),
          cycle_staked_at_settlement INTEGER CHECK (
            cycle_staked_at_settlement IS NULL
            OR cycle_staked_at_settlement BETWEEN 1 AND ${model.cycleSpendLimit}
          ),
          cycle_staked_after INTEGER CHECK (
            cycle_staked_after IS NULL
            OR cycle_staked_after BETWEEN 0 AND ${model.cycleSpendLimit - model.initialStake}
          ),
          ladder_loss_after INTEGER CHECK (
            ladder_loss_after IS NULL OR ladder_loss_after >= 0
          ),
          ladder_miss_count_after INTEGER CHECK (
            ladder_miss_count_after IS NULL OR ladder_miss_count_after >= 0
          ),
          next_stake_after INTEGER CHECK (
            next_stake_after IS NULL OR next_stake_after > 0
          ),
          reset_reason TEXT CHECK (
            reset_reason IS NULL OR reset_reason IN ('hit', 'cycle_spend_cap')
          ),
          void_reason TEXT CHECK (
            void_reason IS NULL OR void_reason IN (
              'integrity_gap', 'round_metadata_conflict'
            )
          ),
          void_incident_id INTEGER REFERENCES incidents(id),
          void_continuity_epoch INTEGER CHECK (
            void_continuity_epoch IS NULL OR void_continuity_epoch >= 1
          ),
          placed_at TEXT NOT NULL,
          settled_at TEXT,
          voided_at TEXT,
          updated_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(campaign_id, forecast_id),
          UNIQUE(campaign_id, round_result_id),
          FOREIGN KEY (forecast_id, candidate_key) REFERENCES
            forecast_predictive_leader_v7_snapshots(forecast_id, candidate_key),
          CHECK (locked_at <= placed_at),
          CHECK (placed_at = created_at),
          CHECK (placed_at <= updated_at),
          CHECK (ladder_loss_before = cycle_staked_before),
          CHECK (raw_stake >= stake AND raw_stake <= ${model.maxStake}),
          CHECK (raw_stake % ${model.stakeStep} = 0),
          CHECK (stake % ${model.stakeStep} = 0),
          CHECK (cycle_staked_before + stake <= ${model.cycleSpendLimit}),
          CHECK (
            stake = CASE
              WHEN raw_stake > ${model.cycleSpendLimit} - cycle_staked_before
              THEN ${model.cycleSpendLimit} - cycle_staked_before
              ELSE raw_stake
            END
          ),
          CHECK (
            (status = 'pending' AND round_result_id IS NULL
              AND result_number IS NULL AND outcome IS NULL
              AND gross_payout IS NULL AND balance_after IS NULL
              AND cycle_number_after IS NULL
              AND cycle_staked_at_settlement IS NULL
              AND cycle_staked_after IS NULL AND ladder_loss_after IS NULL
              AND ladder_miss_count_after IS NULL AND next_stake_after IS NULL
              AND reset_reason IS NULL
              AND void_reason IS NULL AND void_incident_id IS NULL
              AND void_continuity_epoch IS NULL AND settled_at IS NULL
              AND voided_at IS NULL)
            OR
            (status = 'settled' AND round_result_id IS NOT NULL
              AND result_number IS NOT NULL AND outcome IS NOT NULL
              AND gross_payout IS NOT NULL AND balance_after IS NOT NULL
              AND cycle_number_after IS NOT NULL
              AND cycle_staked_at_settlement = cycle_staked_before + stake
              AND cycle_staked_after IS NOT NULL AND ladder_loss_after IS NOT NULL
              AND ladder_miss_count_after IS NOT NULL AND next_stake_after IS NOT NULL
              AND void_reason IS NULL AND void_incident_id IS NULL
              AND void_continuity_epoch IS NULL AND settled_at IS NOT NULL
              AND voided_at IS NULL AND placed_at <= settled_at
              AND balance_after = balance_before - stake + gross_payout
              AND (outcome = 'hit') = (target_number = result_number)
              AND gross_payout = CASE
                WHEN outcome = 'hit' THEN stake * ${model.grossPayoutMultiplier}
                ELSE 0 END
              AND (
                (reset_reason IS NULL AND outcome = 'miss'
                  AND cycle_number_after = cycle_number_before
                  AND cycle_staked_after = cycle_staked_at_settlement
                  AND ladder_loss_after = ladder_loss_before + stake
                  AND ladder_miss_count_after = ladder_miss_count_before + 1
                  AND cycle_staked_after < ${model.cycleSpendLimit})
                OR
                (reset_reason = 'hit' AND outcome = 'hit'
                  AND cycle_number_after = cycle_number_before + 1
                  AND cycle_staked_after = 0 AND ladder_loss_after = 0
                  AND ladder_miss_count_after = 0
                  AND next_stake_after = ${model.initialStake})
                OR
                (reset_reason = 'cycle_spend_cap' AND outcome = 'miss'
                  AND cycle_staked_at_settlement = ${model.cycleSpendLimit}
                  AND cycle_number_after = cycle_number_before + 1
                  AND cycle_staked_after = 0 AND ladder_loss_after = 0
                  AND ladder_miss_count_after = 0
                  AND next_stake_after = ${model.initialStake})
              ))
            OR
            (status = 'void' AND round_result_id IS NULL
              AND result_number IS NULL AND outcome IS NULL
              AND gross_payout IS NULL AND balance_after IS NULL
              AND cycle_number_after IS NULL
              AND cycle_staked_at_settlement IS NULL
              AND cycle_staked_after IS NULL AND ladder_loss_after IS NULL
              AND ladder_miss_count_after IS NULL AND next_stake_after IS NULL
              AND reset_reason IS NULL
              AND void_reason IS NOT NULL AND settled_at IS NULL
              AND voided_at IS NOT NULL
              AND ((void_reason = 'integrity_gap'
                AND void_incident_id IS NOT NULL
                AND void_continuity_epoch IS NOT NULL)
              OR (void_reason = 'round_metadata_conflict'
                AND void_incident_id IS NULL
                AND void_continuity_epoch IS NULL)))
          )
        );

        CREATE TABLE IF NOT EXISTS predictive_leader_v7_paper_ladder_voids (
          bet_id INTEGER PRIMARY KEY REFERENCES
            predictive_leader_v7_paper_ladder_bets(id),
          campaign_id INTEGER NOT NULL REFERENCES
            predictive_leader_v7_paper_ladder_campaigns(id),
          prior_status TEXT NOT NULL CHECK (prior_status IN ('pending', 'settled')),
          reason TEXT NOT NULL CHECK (
            reason IN ('integrity_gap', 'round_metadata_conflict')
          ),
          balance_adjustment INTEGER NOT NULL,
          incident_id INTEGER REFERENCES incidents(id),
          continuity_epoch INTEGER CHECK (
            continuity_epoch IS NULL OR continuity_epoch >= 1
          ),
          voided_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          CHECK (voided_at = created_at),
          CHECK (
            (reason = 'integrity_gap' AND incident_id IS NOT NULL
              AND continuity_epoch IS NOT NULL)
            OR
            (reason = 'round_metadata_conflict' AND incident_id IS NULL
              AND continuity_epoch IS NULL)
          )
        );

        CREATE TABLE IF NOT EXISTS predictive_leader_v7_paper_ladder_resets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_id INTEGER NOT NULL REFERENCES
            predictive_leader_v7_paper_ladder_campaigns(id),
          trigger_bet_id INTEGER REFERENCES
            predictive_leader_v7_paper_ladder_bets(id),
          incident_id INTEGER REFERENCES incidents(id),
          continuity_epoch INTEGER CHECK (
            continuity_epoch IS NULL OR continuity_epoch >= 1
          ),
          reason TEXT NOT NULL CHECK (
            reason IN ('hit', 'cycle_spend_cap', 'integrity_gap')
          ),
          cycle_number_before INTEGER NOT NULL CHECK (cycle_number_before >= 1),
          cycle_number_after INTEGER NOT NULL CHECK (
            cycle_number_after = cycle_number_before + 1
          ),
          cycle_staked_before INTEGER NOT NULL CHECK (cycle_staked_before >= 0),
          ladder_loss_before INTEGER NOT NULL CHECK (ladder_loss_before >= 0),
          ladder_miss_count_before INTEGER NOT NULL CHECK (ladder_miss_count_before >= 0),
          next_stake_before INTEGER NOT NULL CHECK (next_stake_before > 0),
          next_stake_after INTEGER NOT NULL CHECK (
            next_stake_after = ${model.initialStake}
          ),
          occurred_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(campaign_id, trigger_bet_id, reason),
          UNIQUE(campaign_id, incident_id),
          CHECK (occurred_at = created_at),
          CHECK (
            (reason IN ('hit', 'cycle_spend_cap')
              AND trigger_bet_id IS NOT NULL
              AND incident_id IS NULL AND continuity_epoch IS NULL)
            OR
            (reason = 'integrity_gap'
              AND trigger_bet_id IS NULL
              AND incident_id IS NOT NULL AND continuity_epoch IS NOT NULL)
          )
        );

        CREATE UNIQUE INDEX IF NOT EXISTS predictive_leader_v7_paper_ladder_pending_idx
          ON predictive_leader_v7_paper_ladder_bets(campaign_id)
          WHERE status = 'pending';
        CREATE INDEX IF NOT EXISTS predictive_leader_v7_paper_ladder_history_idx
          ON predictive_leader_v7_paper_ladder_bets(campaign_id, forecast_id DESC);
        CREATE INDEX IF NOT EXISTS predictive_leader_v7_paper_ladder_void_history_idx
          ON predictive_leader_v7_paper_ladder_voids(
            campaign_id, voided_at DESC, bet_id DESC
          );
        CREATE INDEX IF NOT EXISTS predictive_leader_v7_paper_ladder_reset_history_idx
          ON predictive_leader_v7_paper_ladder_resets(
            campaign_id, id DESC
          );

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_ladder_campaign_config_immutable
        BEFORE UPDATE OF
          campaign_key, schema_version, strategy_version, candidate_key,
          algorithm_version, mode, execution_enabled, advisory_only,
          promotion_eligible, promotion_policy, authorization_reason,
          source, instrument, first_forecast_id, initial_balance, model_kind,
          initial_stake, stake_step, max_stake, cycle_spend_limit, reset_policy,
          gross_payout_multiplier, payout_includes_stake,
          activation_gap_incident_id, started_at, created_at
        ON predictive_leader_v7_paper_ladder_campaigns
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper ladder campaign configuration is immutable');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_ladder_campaign_no_delete
        BEFORE DELETE ON predictive_leader_v7_paper_ladder_campaigns
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper ladder campaign cannot be deleted');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_ladder_no_backfill
        BEFORE INSERT ON predictive_leader_v7_paper_ladder_bets
        WHEN NOT EXISTS (
          SELECT 1
          FROM predictive_leader_v7_paper_ladder_campaigns AS campaigns
          WHERE campaigns.id = NEW.campaign_id
            AND campaigns.candidate_key = NEW.candidate_key
            AND NEW.forecast_id >= campaigns.first_forecast_id
            AND NEW.placed_at >= campaigns.started_at
        )
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper ladder bets cannot be backfilled');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_ladder_valid_pending
        BEFORE INSERT ON predictive_leader_v7_paper_ladder_bets
        WHEN NEW.status <> 'pending' OR NOT EXISTS (
          SELECT 1
          FROM predictive_leader_v7_paper_ladder_campaigns AS campaigns
          JOIN forecast_predictive_leader_v7_snapshots AS leaders
            ON leaders.forecast_id = NEW.forecast_id
           AND leaders.candidate_key = NEW.candidate_key
          JOIN round_forecasts AS forecasts ON forecasts.id = leaders.forecast_id
          JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
          WHERE campaigns.id = NEW.campaign_id
            AND campaigns.status = 'running'
            AND campaigns.candidate_key = leaders.candidate_key
            AND campaigns.algorithm_version = leaders.algorithm_version
            AND campaigns.source = snapshots.source
            AND campaigns.instrument = snapshots.instrument
            AND campaigns.current_balance >= NEW.stake
            AND campaigns.ledger_deficit = 0
            AND NEW.balance_before = campaigns.current_balance
            AND NEW.cycle_number_before = campaigns.cycle_number
            AND NEW.cycle_staked_before = campaigns.cycle_staked
            AND NEW.ladder_loss_before = campaigns.ladder_loss
            AND NEW.ladder_miss_count_before = campaigns.ladder_miss_count
            AND NEW.stake = campaigns.next_stake
            AND leaders.status = 'ready'
            AND leaders.selected = 1
            AND leaders.locked_at >= campaigns.started_at
            AND leaders.created_at >= campaigns.started_at
            AND leaders.predicted_number = NEW.target_number
            AND leaders.locked_at = NEW.locked_at
            AND snapshots.external_round_id = NEW.external_round_id
            AND snapshots.locked_at = NEW.locked_at
            AND snapshots.betting_closes_at = NEW.betting_closes_at
            AND NEW.placed_at >= NEW.locked_at
            AND (julianday(NEW.betting_closes_at) - julianday(NEW.placed_at))
              * 86400000 >= 4999
            AND NOT EXISTS (
              SELECT 1 FROM forecast_settlements
              WHERE forecast_id = NEW.forecast_id
            )
            AND NOT EXISTS (
              SELECT 1 FROM round_results AS results
              WHERE results.source = campaigns.source
                AND results.instrument = campaigns.instrument
                AND results.external_round_id = NEW.external_round_id
            )
            AND NOT EXISTS (
              SELECT 1
              FROM predictive_shadow_round_metadata_conflicts AS conflicts
              WHERE conflicts.boundary_key = 'predictive-shadow-metadata-integrity-v1'
                AND conflicts.source = campaigns.source
                AND conflicts.instrument = campaigns.instrument
                AND conflicts.external_round_id = NEW.external_round_id
            )
        )
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper ladder pending bet is not eligible');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_ladder_bet_placement_immutable
        BEFORE UPDATE OF
          campaign_id, forecast_id, candidate_key, external_round_id,
          continuity_epoch, target_number, stake, raw_stake, balance_before,
          cycle_number_before, cycle_staked_before, ladder_loss_before,
          ladder_miss_count_before, locked_at, betting_closes_at, placed_at, created_at
        ON predictive_leader_v7_paper_ladder_bets
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper ladder bet placement is immutable');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_ladder_bet_terminal_immutable
        BEFORE UPDATE ON predictive_leader_v7_paper_ladder_bets
        WHEN OLD.status <> 'pending' OR NEW.status NOT IN ('settled', 'void')
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper ladder terminal bet is immutable');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_ladder_bet_no_delete
        BEFORE DELETE ON predictive_leader_v7_paper_ladder_bets
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper ladder bet cannot be deleted');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_ladder_void_valid
        BEFORE INSERT ON predictive_leader_v7_paper_ladder_voids
        WHEN NOT EXISTS (
          SELECT 1
          FROM predictive_leader_v7_paper_ladder_bets AS bets
          WHERE bets.id = NEW.bet_id
            AND bets.campaign_id = NEW.campaign_id
            AND bets.status = NEW.prior_status
            AND NEW.voided_at >= bets.placed_at
            AND NEW.voided_at >= bets.updated_at
            AND (bets.settled_at IS NULL OR NEW.voided_at >= bets.settled_at)
        )
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper ladder void identity is invalid');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_ladder_void_immutable_update
        BEFORE UPDATE ON predictive_leader_v7_paper_ladder_voids
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper ladder void is immutable');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_ladder_void_immutable_delete
        BEFORE DELETE ON predictive_leader_v7_paper_ladder_voids
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper ladder void cannot be deleted');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_ladder_reset_valid
        BEFORE INSERT ON predictive_leader_v7_paper_ladder_resets
        WHEN (
          NEW.reason IN ('hit', 'cycle_spend_cap')
          AND NOT EXISTS (
            SELECT 1
            FROM predictive_leader_v7_paper_ladder_bets AS bets
            WHERE bets.id = NEW.trigger_bet_id
              AND bets.campaign_id = NEW.campaign_id
              AND bets.status = 'settled' AND bets.reset_reason = NEW.reason
          )
        ) OR (
          NEW.reason = 'integrity_gap'
          AND NOT EXISTS (
            SELECT 1
            FROM incidents
            JOIN predictive_leader_v7_paper_ladder_campaigns AS campaigns
              ON campaigns.id = NEW.campaign_id
            WHERE incidents.id = NEW.incident_id
              AND incidents.kind = 'gap'
              AND incidents.source = campaigns.source
              AND incidents.instrument = campaigns.instrument
          )
        )
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper ladder reset identity is invalid');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_ladder_reset_immutable_update
        BEFORE UPDATE ON predictive_leader_v7_paper_ladder_resets
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper ladder reset is immutable');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_ladder_reset_immutable_delete
        BEFORE DELETE ON predictive_leader_v7_paper_ladder_resets
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper ladder reset cannot be deleted');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_fixed_v1_retired
        BEFORE INSERT ON predictive_leader_v7_paper_bets
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper fixed-v1 campaign is retired');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_fixed_v1_void_chronology
        BEFORE INSERT ON predictive_leader_v7_paper_voids
        WHEN NOT EXISTS (
          SELECT 1
          FROM predictive_leader_v7_paper_bets AS bets
          WHERE bets.id = NEW.bet_id
            AND bets.campaign_id = NEW.campaign_id
            AND NEW.voided_at >= bets.placed_at
            AND NEW.voided_at >= bets.updated_at
            AND (bets.settled_at IS NULL OR NEW.voided_at >= bets.settled_at)
        )
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper fixed-v1 void chronology is invalid');
        END;

        CREATE TRIGGER IF NOT EXISTS predictive_leader_v7_paper_ladder_epoch_no_rollback
        BEFORE UPDATE OF continuity_epoch ON stream_state
        WHEN NEW.continuity_epoch < OLD.continuity_epoch
          AND EXISTS (
            SELECT 1
            FROM predictive_leader_v7_paper_ladder_campaigns AS campaigns
            WHERE campaigns.source = NEW.source
              AND campaigns.instrument = NEW.instrument
              AND campaigns.last_continuity_epoch > NEW.continuity_epoch
          )
        BEGIN
          SELECT RAISE(ABORT, 'v7 paper ladder continuity epoch cannot roll back');
        END;
      `);

      const cohort = this.sqlite.prepare(`
        SELECT *
        FROM predictive_leader_v7_cohorts
        WHERE candidate_key = ?
      `).get(PREDICTIVE_LEADER_V7_CANDIDATE_CONFIG.candidateId);
      if (!cohort) throw new Error("predictive leader v7 paper ladder cohort is missing");
      const continuityEpoch = Number(this.sqlite.prepare(`
        SELECT continuity_epoch
        FROM stream_state
        WHERE source = ? AND instrument = ?
      `).get(cohort.source, cohort.instrument)?.continuity_epoch ?? 0);
      const activationGapIncidentId = Number(this.sqlite.prepare(`
        SELECT COALESCE(MAX(id), 0) AS incident_id
        FROM incidents
        WHERE kind = 'gap' AND source = ? AND instrument = ?
      `).get(cohort.source, cohort.instrument).incident_id);
      const firstForecastId = Number(this.sqlite.prepare(`
        SELECT COALESCE(MAX(id), 0) + 1 AS first_forecast_id
        FROM round_forecasts
      `).get().first_forecast_id);
      const existing = this.sqlite.prepare(`
        SELECT id
        FROM predictive_leader_v7_paper_ladder_campaigns
        WHERE campaign_key = ?
      `).get(campaignConfig.campaignKey);
      let inserted = 0;
      if (!existing) {
        const migrationClockAt = asTimestamp(
          this.clock(),
          undefined,
          "predictive leader v7 paper ladder campaign startedAt",
        );
        const startedAt = new Date(Math.max(
          Date.parse(migrationClockAt),
          Date.parse(cohort.started_at),
        )).toISOString();
        inserted = Number(this.sqlite.prepare(`
          INSERT INTO predictive_leader_v7_paper_ladder_campaigns (
            campaign_key, schema_version, strategy_version, candidate_key,
            algorithm_version, mode, execution_enabled, advisory_only,
            promotion_eligible, promotion_policy, authorization_reason,
            source, instrument, first_forecast_id, status,
            initial_balance, current_balance, ledger_deficit, model_kind,
            initial_stake, stake_step, max_stake, cycle_spend_limit, reset_policy,
            gross_payout_multiplier, payout_includes_stake,
            cycle_number, cycle_staked, ladder_loss, ladder_miss_count,
            reset_count, next_stake, ledger_revision,
            last_continuity_epoch, activation_gap_incident_id,
            last_gap_incident_id, continuity_gap_count,
            started_at, updated_at, exhausted_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 0, 1, 0, ?, ?, ?, ?, ?, 'running',
            ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 1,
            1, 0, 0, 0, 0, ?, 0, ?, ?, ?, 0, ?, ?, NULL, ?)
        `).run(
          campaignConfig.campaignKey,
          campaignConfig.schemaVersion,
          campaignConfig.strategyVersion,
          cohort.candidate_key,
          cohort.algorithm_version,
          campaignConfig.mode,
          campaignConfig.promotionPolicy,
          campaignConfig.authorizationReason,
          cohort.source,
          cohort.instrument,
          firstForecastId,
          campaignConfig.initialBalance,
          campaignConfig.initialBalance,
          model.kind,
          model.initialStake,
          model.stakeStep,
          model.maxStake,
          model.cycleSpendLimit,
          model.resetPolicy,
          model.grossPayoutMultiplier,
          model.initialStake,
          continuityEpoch,
          activationGapIncidentId,
          activationGapIncidentId,
          startedAt,
          startedAt,
          startedAt,
        ).changes);
      }
      const campaign = this.sqlite.prepare(`
        SELECT *
        FROM predictive_leader_v7_paper_ladder_campaigns
        WHERE campaign_key = ?
      `).get(campaignConfig.campaignKey);
      if (
        !campaign
        || Number(campaign.schema_version) !== campaignConfig.schemaVersion
        || campaign.strategy_version !== campaignConfig.strategyVersion
        || campaign.candidate_key !== cohort.candidate_key
        || campaign.algorithm_version !== cohort.algorithm_version
        || campaign.mode !== campaignConfig.mode
        || Boolean(campaign.execution_enabled) !== campaignConfig.executionEnabled
        || Boolean(campaign.advisory_only) !== campaignConfig.advisoryOnly
        || Boolean(campaign.promotion_eligible) !== campaignConfig.promotionEligible
        || campaign.promotion_policy !== campaignConfig.promotionPolicy
        || campaign.authorization_reason !== campaignConfig.authorizationReason
        || campaign.source !== cohort.source
        || campaign.instrument !== cohort.instrument
        || Number(campaign.initial_balance) !== campaignConfig.initialBalance
        || campaign.model_kind !== model.kind
        || Number(campaign.initial_stake) !== model.initialStake
        || Number(campaign.stake_step) !== model.stakeStep
        || Number(campaign.max_stake) !== model.maxStake
        || Number(campaign.cycle_spend_limit) !== model.cycleSpendLimit
        || campaign.reset_policy !== model.resetPolicy
        || Number(campaign.gross_payout_multiplier) !== model.grossPayoutMultiplier
        || !Boolean(campaign.payout_includes_stake)
        || !Number.isSafeInteger(Number(campaign.current_balance))
        || Number(campaign.current_balance) < 0
        || !Number.isSafeInteger(Number(campaign.ledger_deficit))
        || Number(campaign.ledger_deficit) < 0
        || !Number.isSafeInteger(Number(campaign.first_forecast_id))
        || Number(campaign.first_forecast_id) < 1
        || !Number.isSafeInteger(Number(campaign.activation_gap_incident_id))
        || Number(campaign.activation_gap_incident_id) < 0
        || !Number.isSafeInteger(Number(campaign.last_gap_incident_id))
        || Number(campaign.last_gap_incident_id)
          < Number(campaign.activation_gap_incident_id)
        || campaign.started_at !== campaign.created_at
        || campaign.started_at < cohort.started_at
        || (inserted === 1 && Number(campaign.first_forecast_id) !== firstForecastId)
      ) {
        throw new Error("predictive leader v7 paper ladder campaign is incompatible");
      }
      this.sqlite.exec(`
        PRAGMA user_version = ${Math.max(31, startingVersion)};
        COMMIT;
      `);
    } catch (error) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // Preserve the migration error.
      }
      throw error;
    }
  }

  #migratePredictiveLeaderWarmTop1PaperCampaignV32(startingVersion) {
    const config = PREDICTIVE_LEADER_WARM_TOP1_PAPER_CAMPAIGN;
    const model = config.model;
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS predictive_leader_warm_top1_paper_campaigns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_key TEXT NOT NULL UNIQUE CHECK (length(trim(campaign_key)) > 0),
          schema_version INTEGER NOT NULL CHECK (schema_version = 1),
          strategy_version TEXT NOT NULL CHECK (length(trim(strategy_version)) > 0),
          algorithm_version TEXT NOT NULL CHECK (length(trim(algorithm_version)) > 0),
          gate_version TEXT NOT NULL CHECK (length(trim(gate_version)) > 0),
          mode TEXT NOT NULL CHECK (mode = 'quality-gated-warm-top1-paper-ladder'),
          execution_enabled INTEGER NOT NULL CHECK (execution_enabled = 0),
          advisory_only INTEGER NOT NULL CHECK (advisory_only = 1),
          source TEXT NOT NULL,
          instrument TEXT NOT NULL,
          first_forecast_id INTEGER NOT NULL CHECK (first_forecast_id >= 1),
          activation_continuity_epoch INTEGER NOT NULL CHECK (
            activation_continuity_epoch >= 0
          ),
          gate_status TEXT NOT NULL CHECK (
            gate_status IN ('collecting', 'confirmed', 'rejected', 'invalid')
          ),
          gate_target_sample_size INTEGER NOT NULL CHECK (
            gate_target_sample_size = ${WARM_TOP1_GATE_TARGET_SAMPLE_SIZE}
          ),
          gate_selected_count INTEGER NOT NULL DEFAULT 0 CHECK (
            gate_selected_count BETWEEN 0 AND gate_target_sample_size
          ),
          gate_settled_count INTEGER NOT NULL DEFAULT 0 CHECK (
            gate_settled_count BETWEEN 0 AND gate_selected_count
          ),
          gate_hit_count INTEGER NOT NULL DEFAULT 0 CHECK (
            gate_hit_count BETWEEN 0 AND gate_settled_count
          ),
          gate_window_start_forecast_id INTEGER REFERENCES round_forecasts(id),
          gate_window_end_forecast_id INTEGER REFERENCES round_forecasts(id),
          gate_metrics_json TEXT,
          gate_evidence_sha256 TEXT CHECK (
            gate_evidence_sha256 IS NULL OR (
              length(gate_evidence_sha256) = 64
              AND gate_evidence_sha256 = lower(gate_evidence_sha256)
            )
          ),
          gate_frozen_at TEXT,
          status TEXT NOT NULL CHECK (status IN ('running', 'exhausted')),
          initial_balance INTEGER NOT NULL CHECK (initial_balance = ${model.initialBalance}),
          current_balance INTEGER NOT NULL CHECK (current_balance >= 0),
          ledger_deficit INTEGER NOT NULL DEFAULT 0 CHECK (ledger_deficit >= 0),
          model_kind TEXT NOT NULL CHECK (model_kind = '${model.kind}'),
          initial_stake INTEGER NOT NULL CHECK (initial_stake = ${model.initialStake}),
          stake_step INTEGER NOT NULL CHECK (stake_step = ${model.stakeStep}),
          max_stake INTEGER NOT NULL CHECK (max_stake = ${model.maxStake}),
          cycle_spend_limit INTEGER NOT NULL CHECK (
            cycle_spend_limit = ${model.cycleSpendLimit}
          ),
          reset_policy TEXT NOT NULL CHECK (reset_policy = '${model.resetPolicy}'),
          gross_payout_multiplier INTEGER NOT NULL CHECK (
            gross_payout_multiplier = ${model.grossPayoutMultiplier}
          ),
          payout_includes_stake INTEGER NOT NULL CHECK (payout_includes_stake = 1),
          cycle_number INTEGER NOT NULL DEFAULT 1 CHECK (cycle_number >= 1),
          cycle_staked INTEGER NOT NULL DEFAULT 0 CHECK (
            cycle_staked >= 0 AND cycle_staked < cycle_spend_limit
          ),
          ladder_loss INTEGER NOT NULL DEFAULT 0 CHECK (ladder_loss >= 0),
          ladder_miss_count INTEGER NOT NULL DEFAULT 0 CHECK (ladder_miss_count >= 0),
          reset_count INTEGER NOT NULL DEFAULT 0 CHECK (reset_count >= 0),
          next_stake INTEGER NOT NULL CHECK (next_stake > 0),
          ledger_revision INTEGER NOT NULL DEFAULT 0 CHECK (ledger_revision >= 0),
          started_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          exhausted_at TEXT,
          created_at TEXT NOT NULL,
          CHECK (gate_settled_count <= gate_selected_count),
          CHECK (
            (gate_status = 'collecting' AND gate_frozen_at IS NULL)
            OR
            (gate_status IN ('confirmed', 'rejected', 'invalid')
              AND gate_frozen_at IS NOT NULL)
          ),
          CHECK (
            (status = 'running' AND exhausted_at IS NULL)
            OR
            (status = 'exhausted' AND exhausted_at IS NOT NULL)
          )
        );

        CREATE TABLE IF NOT EXISTS predictive_leader_warm_top1_paper_bets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_id INTEGER NOT NULL REFERENCES
            predictive_leader_warm_top1_paper_campaigns(id),
          forecast_id INTEGER NOT NULL UNIQUE REFERENCES round_forecasts(id),
          external_round_id TEXT NOT NULL,
          continuity_epoch INTEGER NOT NULL CHECK (continuity_epoch >= 0),
          target_number INTEGER NOT NULL CHECK (target_number BETWEEN 0 AND 36),
          occurrence_count INTEGER NOT NULL CHECK (occurrence_count > 0),
          sample_size INTEGER NOT NULL CHECK (sample_size > 0),
          observed_follower_count INTEGER NOT NULL CHECK (
            observed_follower_count BETWEEN 5 AND 37
          ),
          anchor_result_id INTEGER NOT NULL REFERENCES round_results(id),
          anchor_number INTEGER NOT NULL CHECK (anchor_number BETWEEN 0 AND 36),
          anchor_settled_at TEXT NOT NULL,
          history_max_result_id INTEGER NOT NULL REFERENCES round_results(id),
          evidence_sha256 TEXT NOT NULL CHECK (
            length(evidence_sha256) = 64 AND evidence_sha256 = lower(evidence_sha256)
          ),
          stake INTEGER NOT NULL CHECK (stake > 0),
          raw_stake INTEGER NOT NULL CHECK (raw_stake >= stake),
          balance_before INTEGER NOT NULL CHECK (balance_before >= stake),
          cycle_number_before INTEGER NOT NULL CHECK (cycle_number_before >= 1),
          cycle_staked_before INTEGER NOT NULL CHECK (cycle_staked_before >= 0),
          ladder_loss_before INTEGER NOT NULL CHECK (ladder_loss_before >= 0),
          ladder_miss_count_before INTEGER NOT NULL CHECK (ladder_miss_count_before >= 0),
          locked_at TEXT NOT NULL,
          betting_closes_at TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'settled', 'void')),
          result_id INTEGER REFERENCES round_results(id),
          result_number INTEGER CHECK (result_number IS NULL OR result_number BETWEEN 0 AND 36),
          outcome TEXT CHECK (outcome IS NULL OR outcome IN ('hit', 'miss')),
          gross_payout INTEGER CHECK (gross_payout IS NULL OR gross_payout >= 0),
          balance_after INTEGER CHECK (balance_after IS NULL OR balance_after >= 0),
          cycle_number_after INTEGER CHECK (
            cycle_number_after IS NULL OR cycle_number_after >= 1
          ),
          cycle_staked_after INTEGER CHECK (
            cycle_staked_after IS NULL OR cycle_staked_after >= 0
          ),
          ladder_loss_after INTEGER CHECK (
            ladder_loss_after IS NULL OR ladder_loss_after >= 0
          ),
          ladder_miss_count_after INTEGER CHECK (
            ladder_miss_count_after IS NULL OR ladder_miss_count_after >= 0
          ),
          next_stake_after INTEGER CHECK (next_stake_after IS NULL OR next_stake_after > 0),
          reset_reason TEXT CHECK (
            reset_reason IS NULL OR reset_reason IN ('hit', 'cycle_spend_cap')
          ),
          void_reason TEXT CHECK (
            void_reason IS NULL OR void_reason IN ('round_metadata_conflict', 'integrity_gap')
          ),
          void_incident_id INTEGER REFERENCES incidents(id),
          void_continuity_epoch INTEGER CHECK (
            void_continuity_epoch IS NULL OR void_continuity_epoch >= 0
          ),
          placed_at TEXT NOT NULL,
          settled_at TEXT,
          voided_at TEXT,
          updated_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          CHECK (occurrence_count <= sample_size),
          CHECK (occurrence_count * 100 >= sample_size * 5),
          CHECK (locked_at < betting_closes_at),
          CHECK (
            (status = 'pending' AND result_id IS NULL AND outcome IS NULL
              AND settled_at IS NULL AND void_reason IS NULL AND voided_at IS NULL
              AND void_incident_id IS NULL AND void_continuity_epoch IS NULL)
            OR
            (status = 'settled' AND result_id IS NOT NULL AND result_number IS NOT NULL
              AND outcome IS NOT NULL AND gross_payout IS NOT NULL
              AND balance_after IS NOT NULL AND settled_at IS NOT NULL
              AND void_reason IS NULL AND voided_at IS NULL
              AND void_incident_id IS NULL AND void_continuity_epoch IS NULL)
            OR
            (status = 'void' AND result_id IS NULL AND outcome IS NULL
              AND settled_at IS NULL AND void_reason IS NOT NULL AND voided_at IS NOT NULL
              AND (
                (void_reason = 'integrity_gap' AND void_incident_id IS NOT NULL
                  AND void_continuity_epoch IS NOT NULL)
                OR
                (void_reason = 'round_metadata_conflict' AND void_incident_id IS NULL)
              ))
          )
        );

        CREATE UNIQUE INDEX IF NOT EXISTS
          predictive_leader_warm_top1_one_pending
          ON predictive_leader_warm_top1_paper_bets(campaign_id)
          WHERE status = 'pending';
        CREATE INDEX IF NOT EXISTS predictive_leader_warm_top1_bets_campaign_idx
          ON predictive_leader_warm_top1_paper_bets(campaign_id, id);
      `);

      let campaign = this.sqlite.prepare(`
        SELECT * FROM predictive_leader_warm_top1_paper_campaigns
        WHERE campaign_key = ?
      `).get(config.campaignKey);
      if (!campaign) {
        const predecessor = this.sqlite.prepare(`
          SELECT started_at
          FROM predictive_leader_v7_paper_ladder_campaigns
          WHERE campaign_key = ?
        `).get(PREDICTIVE_LEADER_V7_PAPER_LADDER_CAMPAIGN.campaignKey);
        const now = startingVersion >= 31
          ? asTimestamp(
            this.clock(),
            undefined,
            "predictive leader warm top1 campaign startedAt",
          )
          : asTimestamp(
            predecessor?.started_at,
            undefined,
            "predictive leader warm top1 predecessor startedAt",
          );
        const latestForecast = this.sqlite.prepare(`
          SELECT COALESCE(MAX(id), 0) AS max_id FROM round_forecasts
        `).get();
        const firstForecastId = Number(latestForecast.max_id) + 1;
        const continuityEpoch = Number(this.sqlite.prepare(`
          SELECT continuity_epoch
          FROM stream_state
          WHERE source = ? AND instrument = ?
        `).get(
          PREDICTIVE_SHADOW_FROZEN_STREAM.source,
          PREDICTIVE_SHADOW_FROZEN_STREAM.instrument,
        )?.continuity_epoch ?? 0);
        this.sqlite.prepare(`
          INSERT INTO predictive_leader_warm_top1_paper_campaigns (
            campaign_key, schema_version, strategy_version, algorithm_version,
            gate_version, mode, execution_enabled, advisory_only,
            source, instrument, first_forecast_id, activation_continuity_epoch,
            gate_status, gate_target_sample_size, gate_selected_count,
            gate_settled_count, gate_hit_count, status,
            initial_balance, current_balance, ledger_deficit, model_kind,
            initial_stake, stake_step, max_stake, cycle_spend_limit,
            reset_policy, gross_payout_multiplier, payout_includes_stake,
            cycle_number, cycle_staked, ladder_loss, ladder_miss_count,
            reset_count, next_stake, ledger_revision,
            started_at, updated_at, exhausted_at, created_at
          ) VALUES (?, 1, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?,
            'collecting', ?, 0, 0, 0, 'running', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 1,
            1, 0, 0, 0, 0, ?, 0, ?, ?, NULL, ?)
        `).run(
          config.campaignKey,
          config.strategyVersion,
          config.algorithmVersion,
          config.gateVersion,
          config.mode,
          PREDICTIVE_SHADOW_FROZEN_STREAM.source,
          PREDICTIVE_SHADOW_FROZEN_STREAM.instrument,
          firstForecastId,
          continuityEpoch,
          WARM_TOP1_GATE_TARGET_SAMPLE_SIZE,
          config.initialBalance,
          config.initialBalance,
          model.kind,
          model.initialStake,
          model.stakeStep,
          model.maxStake,
          model.cycleSpendLimit,
          model.resetPolicy,
          model.grossPayoutMultiplier,
          model.initialStake,
          now,
          now,
          now,
        );
        campaign = this.sqlite.prepare(`
          SELECT * FROM predictive_leader_warm_top1_paper_campaigns
          WHERE campaign_key = ?
        `).get(config.campaignKey);
      }
      if (
        !campaign
        || Number(campaign.schema_version) !== config.schemaVersion
        || campaign.strategy_version !== config.strategyVersion
        || campaign.algorithm_version !== config.algorithmVersion
        || campaign.gate_version !== config.gateVersion
        || campaign.mode !== config.mode
        || campaign.source !== PREDICTIVE_SHADOW_FROZEN_STREAM.source
        || campaign.instrument !== PREDICTIVE_SHADOW_FROZEN_STREAM.instrument
        || Number(campaign.gate_target_sample_size)
          !== WARM_TOP1_GATE_TARGET_SAMPLE_SIZE
        || Number(campaign.initial_balance) !== config.initialBalance
        || campaign.model_kind !== model.kind
        || Number(campaign.next_stake) < model.initialStake
      ) {
        throw new Error("predictive leader warm top1 paper campaign is incompatible");
      }
      this.sqlite.exec(`
        PRAGMA user_version = ${Math.max(32, startingVersion)};
        COMMIT;
      `);
    } catch (error) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // Preserve the migration error.
      }
      throw error;
    }
  }

  #migrateVirtualWindowBettorV33(startingVersion) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS virtual_window_bettor_bankrolls (
          source TEXT NOT NULL,
          instrument TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('running', 'exhausted')),
          initial_balance INTEGER NOT NULL CHECK (initial_balance = ${this.virtualWindowStartingBalance}),
          current_balance INTEGER NOT NULL CHECK (current_balance >= 0),
          next_stake INTEGER CHECK (next_stake IS NULL OR next_stake > 0),
          started_at TEXT NOT NULL,
          exhausted_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (source, instrument),
          CHECK (
            (status = 'running' AND exhausted_at IS NULL AND next_stake IS NULL)
            OR
            (status = 'exhausted' AND exhausted_at IS NOT NULL AND next_stake IS NOT NULL)
          )
        );

        CREATE TABLE IF NOT EXISTS virtual_window_bet_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source TEXT NOT NULL,
          instrument TEXT NOT NULL,
          continuity_epoch INTEGER NOT NULL CHECK (continuity_epoch >= 0),
          target_number INTEGER NOT NULL CHECK (target_number BETWEEN 0 AND 36),
          status TEXT NOT NULL CHECK (status IN ('armed', 'active', 'completed', 'invalid_gap')),
          trigger_rounds_missed INTEGER NOT NULL CHECK (trigger_rounds_missed BETWEEN 160 AND 199),
          attempt_budget INTEGER NOT NULL CHECK (attempt_budget BETWEEN 1 AND 50),
          activated_after_result_id INTEGER NOT NULL REFERENCES round_results(id),
          model_version TEXT NOT NULL CHECK (model_version = '${VIRTUAL_WINDOW_BET_MODEL.modelVersion}'),
          initial_stake INTEGER NOT NULL CHECK (initial_stake = ${VIRTUAL_WINDOW_BET_MODEL.initialStake}),
          stake_step INTEGER NOT NULL CHECK (stake_step = ${VIRTUAL_WINDOW_BET_MODEL.stakeStep}),
          max_stake INTEGER NOT NULL CHECK (max_stake = ${VIRTUAL_WINDOW_BET_MODEL.maxStake}),
          gross_payout_multiplier INTEGER NOT NULL CHECK (gross_payout_multiplier = ${VIRTUAL_WINDOW_BET_MODEL.grossPayoutMultiplier}),
          payout_includes_stake INTEGER NOT NULL CHECK (payout_includes_stake = 1),
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
          miss_count INTEGER NOT NULL DEFAULT 0 CHECK (miss_count >= 0),
          total_staked INTEGER NOT NULL DEFAULT 0 CHECK (total_staked >= 0),
          next_stake INTEGER CHECK (next_stake IS NULL OR next_stake > 0),
          last_bet_result_id INTEGER REFERENCES round_results(id),
          completed_result_id INTEGER REFERENCES round_results(id),
          gross_payout INTEGER NOT NULL DEFAULT 0 CHECK (gross_payout >= 0),
          net_result INTEGER,
          end_reason TEXT CHECK (end_reason IS NULL OR end_reason IN ('hit', 'window_expired', 'integrity_gap', 'bankroll_exhausted')),
          armed_at TEXT NOT NULL,
          last_event_at TEXT NOT NULL,
          completed_at TEXT,
          created_at TEXT NOT NULL,
          CHECK (
            (status IN ('armed', 'active') AND completed_at IS NULL AND next_stake IS NOT NULL AND end_reason IS NULL)
            OR
            (status IN ('completed', 'invalid_gap') AND completed_at IS NOT NULL AND next_stake IS NULL AND end_reason IS NOT NULL)
          )
        );

        CREATE UNIQUE INDEX IF NOT EXISTS virtual_window_bettor_one_live_stream_idx
          ON virtual_window_bet_sessions(source, instrument)
          WHERE status IN ('armed', 'active');
        CREATE INDEX IF NOT EXISTS virtual_window_bettor_session_history_idx
          ON virtual_window_bet_sessions(source, instrument, id DESC);

        CREATE TABLE IF NOT EXISTS virtual_window_bets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id INTEGER NOT NULL REFERENCES virtual_window_bet_sessions(id) ON DELETE CASCADE,
          round_result_id INTEGER NOT NULL UNIQUE REFERENCES round_results(id),
          attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
          stake INTEGER NOT NULL CHECK (stake > 0),
          result_number INTEGER NOT NULL CHECK (result_number BETWEEN 0 AND 36),
          outcome TEXT NOT NULL CHECK (outcome IN ('miss', 'hit')),
          gross_payout INTEGER NOT NULL CHECK (gross_payout >= 0),
          total_staked_after INTEGER NOT NULL CHECK (total_staked_after > 0),
          net_after INTEGER NOT NULL,
          next_stake_after INTEGER CHECK (next_stake_after IS NULL OR next_stake_after > 0),
          recovery_possible INTEGER NOT NULL CHECK (recovery_possible IN (0, 1)),
          occurred_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(session_id, attempt_number)
        );
        CREATE INDEX IF NOT EXISTS virtual_window_bets_session_idx
          ON virtual_window_bets(session_id, attempt_number);

        PRAGMA user_version = ${Math.max(33, startingVersion)};
        COMMIT;
      `);
    } catch (error) {
      try { this.sqlite.exec("ROLLBACK"); } catch { /* preserve migration error */ }
      throw error;
    }
  }

  #migrateContinuityReconciliationV9() {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.sqlite.exec(`
        CREATE TABLE IF NOT EXISTS incident_resolutions (
          incident_id INTEGER PRIMARY KEY REFERENCES incidents(id),
          resolution TEXT NOT NULL CHECK (
            resolution IN ('reconciled_contiguous')
          ),
          resolved_at TEXT NOT NULL,
          evidence_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);

      this.#reconcileProvenShutdownGaps(new Date().toISOString());
      this.sqlite.exec(`
        PRAGMA user_version = 9;
        COMMIT;
      `);
    } catch (error) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // Preserve the migration error.
      }
      throw error;
    }
  }

  #reconcileProvenShutdownGaps(now) {
    const existingTables = new Set(
      this.sqlite.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
      `).all().map((row) => row.name),
    );
    const tableHasColumn = (table, column) => existingTables.has(table)
      && this.sqlite.prepare(`PRAGMA table_info(${table})`).all()
        .some((row) => row.name === column);
    const incidentReferenceStatements = [];
    for (const [table, column] of [
      ["predictive_leader_account_bets", "void_incident_id"],
      ["forecast_predictive_leader_evaluation_voids", "incident_id"],
      ["predictive_leader_v7_paper_bets", "void_incident_id"],
      ["predictive_leader_v7_paper_voids", "incident_id"],
      ["predictive_leader_v7_paper_ladder_bets", "void_incident_id"],
      ["predictive_leader_v7_paper_ladder_voids", "incident_id"],
      ["predictive_leader_v7_paper_ladder_resets", "incident_id"],
    ]) {
      if (tableHasColumn(table, column)) {
        incidentReferenceStatements.push(
          this.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`),
        );
      }
    }
    const paperEpochStatements = [];
    if (existingTables.has("predictive_leader_v7_paper_campaigns")) {
      paperEpochStatements.push(this.sqlite.prepare(`
        SELECT COUNT(*) AS count
        FROM predictive_leader_v7_paper_campaigns
        WHERE source = ? AND instrument = ? AND last_continuity_epoch >= ?
      `));
    }
    if (
      existingTables.has("predictive_leader_v7_paper_bets")
      && existingTables.has("predictive_leader_v7_paper_campaigns")
    ) {
      paperEpochStatements.push(this.sqlite.prepare(`
        SELECT COUNT(*) AS count
        FROM predictive_leader_v7_paper_bets AS bets
        JOIN predictive_leader_v7_paper_campaigns AS campaigns
          ON campaigns.id = bets.campaign_id
        WHERE campaigns.source = ? AND campaigns.instrument = ?
          AND bets.continuity_epoch >= ?
      `));
    }
    if (existingTables.has("predictive_leader_v7_paper_ladder_campaigns")) {
      paperEpochStatements.push(this.sqlite.prepare(`
        SELECT COUNT(*) AS count
        FROM predictive_leader_v7_paper_ladder_campaigns
        WHERE source = ? AND instrument = ? AND last_continuity_epoch >= ?
      `));
    }
    if (
      existingTables.has("predictive_leader_v7_paper_ladder_bets")
      && existingTables.has("predictive_leader_v7_paper_ladder_campaigns")
    ) {
      paperEpochStatements.push(this.sqlite.prepare(`
        SELECT COUNT(*) AS count
        FROM predictive_leader_v7_paper_ladder_bets AS bets
        JOIN predictive_leader_v7_paper_ladder_campaigns AS campaigns
          ON campaigns.id = bets.campaign_id
        WHERE campaigns.source = ? AND campaigns.instrument = ?
          AND bets.continuity_epoch >= ?
      `));
    }
    const candidates = this.sqlite
      .prepare(`
        SELECT incidents.*
        FROM incidents
        LEFT JOIN incident_resolutions
          ON incident_resolutions.incident_id = incidents.id
        WHERE incidents.kind = 'gap'
          AND incidents.cycle_id IS NOT NULL
          AND incident_resolutions.incident_id IS NULL
        ORDER BY incidents.detected_at DESC, incidents.id DESC
      `)
      .all();

    const cycleById = this.sqlite.prepare("SELECT * FROM cycles WHERE id = ?");
    const lastCycleResult = this.sqlite.prepare(`
      SELECT *
      FROM round_results
      WHERE source = ? AND instrument = ? AND cycle_id = ?
      ORDER BY settled_at DESC, id DESC
      LIMIT 1
    `);
    const firstEpochResult = this.sqlite.prepare(`
      SELECT *
      FROM round_results
      WHERE source = ? AND instrument = ? AND continuity_epoch = ?
      ORDER BY settled_at, id
      LIMIT 1
    `);
    const epochState = this.sqlite.prepare(`
      SELECT continuity_epoch
      FROM stream_state
      WHERE source = ? AND instrument = ?
    `);
    const epochShape = this.sqlite.prepare(`
      SELECT
        COUNT(*) AS result_count,
        COUNT(DISTINCT cycle_id) AS cycle_count,
        MIN(cycle_id) AS only_cycle_id,
        SUM(CASE WHEN cycle_id IS NULL THEN 1 ELSE 0 END) AS null_cycle_count
      FROM round_results
      WHERE source = ? AND instrument = ? AND continuity_epoch = ?
    `);
    const cycleShape = this.sqlite.prepare(`
      SELECT
        COUNT(*) AS result_count,
        COUNT(DISTINCT result_number) AS distinct_count,
        MIN(settled_at) AS first_settled_at,
        MAX(settled_at) AS last_settled_at
      FROM round_results
      WHERE cycle_id IN (?, ?)
    `);
    const cycleResultCount = this.sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM round_results
      WHERE cycle_id = ?
    `);
    const cycleEventCount = this.sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM cycle_events
      WHERE cycle_id = ?
    `);
    const cycleNumberCount = this.sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM cycle_numbers
      WHERE cycle_id = ?
    `);
    const rightEpochVirtualSessions = this.sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM virtual_bet_sessions
      WHERE source = ? AND instrument = ? AND continuity_epoch = ?
    `);
    const invalidatedAtIncident = this.sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM virtual_bet_sessions
      WHERE source = ?
        AND instrument = ?
        AND status = 'invalid_gap'
        AND completed_at = ?
    `);
    const unresolvedRightCycleIncidents = this.sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM incidents
      LEFT JOIN incident_resolutions
        ON incident_resolutions.incident_id = incidents.id
      WHERE incidents.cycle_id = ?
        AND incident_resolutions.incident_id IS NULL
    `);
    const moveResults = this.sqlite.prepare(`
      UPDATE round_results
      SET cycle_id = ?, continuity_epoch = ?
      WHERE source = ?
        AND instrument = ?
        AND cycle_id = ?
        AND continuity_epoch = ?
    `);
    const moveEvents = this.sqlite.prepare(`
      UPDATE cycle_events
      SET cycle_id = ?
      WHERE cycle_id = ?
    `);
    const moveResolvedIncidentReferences = this.sqlite.prepare(`
      UPDATE incidents
      SET cycle_id = ?
      WHERE cycle_id = ?
        AND EXISTS (
          SELECT 1
          FROM incident_resolutions
          WHERE incident_resolutions.incident_id = incidents.id
        )
    `);
    const orderedCycleEvents = this.sqlite.prepare(`
      SELECT id, round_result_id, result_number, occurred_at
      FROM cycle_events
      WHERE cycle_id = ?
      ORDER BY occurred_at, id
    `);
    const updateCycleEvent = this.sqlite.prepare(`
      UPDATE cycle_events
      SET eliminated = ?, remaining_count = ?
      WHERE id = ?
    `);
    const resetCycleNumbers = this.sqlite.prepare(`
      UPDATE cycle_numbers
      SET eliminated_at = NULL, eliminated_by_result_id = NULL
      WHERE cycle_id = ?
    `);
    const eliminateCycleNumber = this.sqlite.prepare(`
      UPDATE cycle_numbers
      SET eliminated_at = ?, eliminated_by_result_id = ?
      WHERE cycle_id = ? AND number = ?
    `);
    const deleteCycle = this.sqlite.prepare("DELETE FROM cycles WHERE id = ?");
    const restoreCycle = this.sqlite.prepare(`
      UPDATE cycles
      SET
        status = 'active',
        last_event_at = ?,
        completed_at = NULL,
        survivor_number = NULL,
        event_count = ?,
        eliminated_count = ?
      WHERE id = ? AND status = 'invalid_gap'
    `);
    const restoreEpoch = this.sqlite.prepare(`
      UPDATE stream_state
      SET continuity_epoch = ?
      WHERE source = ?
        AND instrument = ?
        AND continuity_epoch = ?
    `);
    const insertResolution = this.sqlite.prepare(`
      INSERT INTO incident_resolutions (
        incident_id,
        resolution,
        resolved_at,
        evidence_json,
        created_at
      ) VALUES (?, 'reconciled_contiguous', ?, ?, ?)
    `);

    for (const incident of candidates) {
      const details = deserializeJson(incident.details_json);
      if (
        !details ||
        typeof details !== "object" ||
        Array.isArray(details) ||
        details.reason !== "shutdown-with-unconfirmed-round-result"
      ) {
        continue;
      }

      const leftCycleId = Number(incident.cycle_id);
      const leftCycle = cycleById.get(leftCycleId);
      if (
        !leftCycle ||
        leftCycle.source !== incident.source ||
        leftCycle.instrument !== incident.instrument ||
        leftCycle.status !== "invalid_gap" ||
        leftCycle.completed_at !== incident.detected_at
      ) {
        continue;
      }

      const left = lastCycleResult.get(
        incident.source,
        incident.instrument,
        leftCycleId,
      );
      if (!left) continue;
      const leftEpoch = Number(left.continuity_epoch);
      const rightEpoch = leftEpoch + 1;
      const irreversibleIncidentReference = incidentReferenceStatements.some(
        (statement) => Number(statement.get(Number(incident.id)).count) > 0,
      );
      const rightEpochPaperBet = paperEpochStatements.some(
        (statement) => Number(statement.get(
          incident.source,
          incident.instrument,
          rightEpoch,
        ).count) > 0,
      );
      if (irreversibleIncidentReference || rightEpochPaperBet) continue;
      const right = firstEpochResult.get(
        incident.source,
        incident.instrument,
        rightEpoch,
      );
      if (!right || right.cycle_id === null) continue;

      const leftRoundId = numericRoundId(left.external_round_id);
      const rightRoundId = numericRoundId(right.external_round_id);
      const elapsedMs = Date.parse(right.settled_at) - Date.parse(left.settled_at);
      const observationToDetectionMs =
        Date.parse(incident.detected_at) - Date.parse(right.observed_at);
      if (
        leftRoundId === null ||
        rightRoundId === null ||
        rightRoundId !== leftRoundId + 1n ||
        !Number.isFinite(elapsedMs) ||
        elapsedMs <= 0 ||
        elapsedMs > this.gapThresholdMs ||
        !Number.isFinite(observationToDetectionMs) ||
        observationToDetectionMs < 0 ||
        observationToDetectionMs > this.gapThresholdMs
      ) {
        continue;
      }

      const rightCycleId = Number(right.cycle_id);
      const rightCycle = cycleById.get(rightCycleId);
      const currentEpoch = epochState.get(incident.source, incident.instrument);
      const epoch = epochShape.get(
        incident.source,
        incident.instrument,
        rightEpoch,
      );
      if (
        rightCycleId === leftCycleId ||
        !rightCycle ||
        rightCycle.source !== incident.source ||
        rightCycle.instrument !== incident.instrument ||
        rightCycle.status !== "active" ||
        rightCycle.started_at !== right.settled_at ||
        Number(currentEpoch?.continuity_epoch) !== rightEpoch ||
        Number(epoch.result_count) < 1 ||
        Number(epoch.null_cycle_count) !== 0 ||
        Number(epoch.cycle_count) !== 1 ||
        Number(epoch.only_cycle_id) !== rightCycleId
      ) {
        continue;
      }

      const leftResults = Number(cycleResultCount.get(leftCycleId).count);
      const rightResults = Number(cycleResultCount.get(rightCycleId).count);
      const leftEvents = Number(cycleEventCount.get(leftCycleId).count);
      const rightEvents = Number(cycleEventCount.get(rightCycleId).count);
      const combined = cycleShape.get(leftCycleId, rightCycleId);
      if (
        leftResults < 1 ||
        rightResults < 1 ||
        leftResults !== leftEvents ||
        rightResults !== rightEvents ||
        Number(combined.result_count) !== leftResults + rightResults ||
        Number(combined.distinct_count) >= 36 ||
        Number(cycleNumberCount.get(leftCycleId).count) !== 37 ||
        Number(cycleNumberCount.get(rightCycleId).count) !== 37 ||
        Number(
          rightEpochVirtualSessions.get(
            incident.source,
            incident.instrument,
            rightEpoch,
          ).count,
        ) !== 0 ||
        Number(
          invalidatedAtIncident.get(
            incident.source,
            incident.instrument,
            incident.detected_at,
          ).count,
        ) !== 0 ||
        Number(unresolvedRightCycleIncidents.get(rightCycleId).count) !== 0
      ) {
        continue;
      }

      const movedResults = Number(
        moveResults.run(
          leftCycleId,
          leftEpoch,
          incident.source,
          incident.instrument,
          rightCycleId,
          rightEpoch,
        ).changes,
      );
      const movedEvents = Number(moveEvents.run(leftCycleId, rightCycleId).changes);
      if (movedResults !== rightResults || movedEvents !== rightEvents) {
        throw new Error("continuity reconciliation moved an unexpected row count");
      }

      moveResolvedIncidentReferences.run(leftCycleId, rightCycleId);
      const events = orderedCycleEvents.all(leftCycleId);
      const firstByNumber = new Map();
      let remainingCount = 37;
      for (const event of events) {
        const number = Number(event.result_number);
        const eliminated = !firstByNumber.has(number);
        if (eliminated) {
          firstByNumber.set(number, event);
          remainingCount -= 1;
        }
        updateCycleEvent.run(eliminated ? 1 : 0, remainingCount, Number(event.id));
      }

      resetCycleNumbers.run(leftCycleId);
      for (const [number, event] of firstByNumber) {
        const update = eliminateCycleNumber.run(
          event.occurred_at,
          Number(event.round_result_id),
          leftCycleId,
          number,
        );
        if (Number(update.changes) !== 1) {
          throw new Error("continuity reconciliation could not rebuild cycle numbers");
        }
      }

      if (Number(deleteCycle.run(rightCycleId).changes) !== 1) {
        throw new Error("continuity reconciliation could not remove derived cycle");
      }
      if (
        Number(
          restoreCycle.run(
            events.at(-1).occurred_at,
            events.length,
            firstByNumber.size,
            leftCycleId,
          ).changes,
        ) !== 1
      ) {
        throw new Error("continuity reconciliation could not restore active cycle");
      }
      if (
        Number(
          restoreEpoch.run(
            leftEpoch,
            incident.source,
            incident.instrument,
            rightEpoch,
          ).changes,
        ) !== 1
      ) {
        throw new Error("continuity reconciliation could not restore stream epoch");
      }

      const evidence = {
        proof: "adjacent-external-round-ids",
        reason: details.reason,
        incidentId: Number(incident.id),
        source: incident.source,
        instrument: incident.instrument,
        left: {
          resultId: Number(left.id),
          externalRoundId: left.external_round_id,
          settledAt: left.settled_at,
          continuityEpoch: leftEpoch,
          cycleId: leftCycleId,
        },
        right: {
          resultId: Number(right.id),
          externalRoundId: right.external_round_id,
          settledAt: right.settled_at,
          continuityEpoch: rightEpoch,
          cycleId: rightCycleId,
        },
        elapsedMs,
        movedResults,
        restoredCycle: {
          id: leftCycleId,
          eventCount: events.length,
          eliminatedCount: firstByNumber.size,
        },
      };
      insertResolution.run(
        Number(incident.id),
        now,
        serializeJson(evidence, "incident resolution evidence"),
        now,
      );
    }
  }

  #backfillContinuityEpochs() {
    const streams = this.sqlite
      .prepare(`
        SELECT DISTINCT source, instrument
        FROM round_results
        ORDER BY source, instrument
      `)
      .all();
    const updateResult = this.sqlite.prepare(
      "UPDATE round_results SET continuity_epoch = ? WHERE id = ?",
    );
    const saveState = this.sqlite.prepare(`
      INSERT INTO stream_state (source, instrument, continuity_epoch)
      VALUES (?, ?, ?)
      ON CONFLICT(source, instrument) DO UPDATE SET
        continuity_epoch = excluded.continuity_epoch
    `);

    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      for (const stream of streams) {
        const incidentBoundaries = this.sqlite
          .prepare(`
            SELECT (
              SELECT rr.id
              FROM round_results AS rr
              WHERE rr.source = incidents.source
                AND rr.instrument = incidents.instrument
                AND rr.created_at >= incidents.created_at
              ORDER BY rr.created_at, rr.id
              LIMIT 1
            ) AS boundary_id
            FROM incidents
            WHERE source = ? AND instrument = ?
            ORDER BY created_at, id
          `)
          .all(stream.source, stream.instrument);
        const boundaryIds = new Set(
          incidentBoundaries
            .filter((item) => item.boundary_id !== null)
            .map((item) => Number(item.boundary_id)),
        );
        const trailingGapCount = incidentBoundaries.filter(
          (item) => item.boundary_id === null,
        ).length;
        const rows = this.sqlite
          .prepare(`
            SELECT
              rr.id,
              rr.settled_at,
              rr.external_round_id,
              rr.cycle_id,
              c.status AS cycle_status
            FROM round_results AS rr
            LEFT JOIN cycles AS c ON c.id = rr.cycle_id
            WHERE rr.source = ? AND rr.instrument = ?
            ORDER BY rr.settled_at, rr.id
          `)
          .iterate(stream.source, stream.instrument);
        let epoch = 0;
        let previous = null;
        for (const row of rows) {
          if (
            previous &&
            (
              boundaryIds.has(Number(row.id)) ||
              !storedResultsAreAdjacent(previous, row, this.gapThresholdMs)
            )
          ) {
            epoch += 1;
          }
          updateResult.run(epoch, Number(row.id));
          previous = row;
        }
        epoch += trailingGapCount;
        saveState.run(stream.source, stream.instrument, epoch);
      }
      this.sqlite.exec("COMMIT");
    } catch (error) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // Preserve the migration error.
      }
      throw error;
    }
  }

  #transaction(operation) {
    this.#assertOpen();
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // Preserve the original failure.
      }
      throw error;
    }
  }

  #createCycle(source, instrument, origin, startedAt, createdAt) {
    const insert = this.sqlite
      .prepare(`
        INSERT INTO cycles (
          source,
          instrument,
          origin,
          status,
          started_at,
          last_event_at,
          created_at
        ) VALUES (?, ?, ?, 'active', ?, ?, ?)
      `)
      .run(source, instrument, origin, startedAt, startedAt, createdAt);
    const cycleId = Number(insert.lastInsertRowid);
    const insertNumber = this.sqlite.prepare(`
      INSERT INTO cycle_numbers (cycle_id, number)
      VALUES (?, ?)
    `);

    for (const number of ROULETTE_NUMBERS) {
      insertNumber.run(cycleId, number);
    }

    return cycleId;
  }

  #activeCycleId(source, instrument) {
    const row = this.sqlite
      .prepare(`
        SELECT id
        FROM cycles
        WHERE source = ? AND instrument = ? AND status = 'active'
      `)
      .get(source, instrument);
    return row ? Number(row.id) : null;
  }

  #continuityEpoch(source, instrument) {
    this.sqlite
      .prepare(`
        INSERT INTO stream_state (source, instrument, continuity_epoch)
        VALUES (?, ?, 0)
        ON CONFLICT(source, instrument) DO NOTHING
      `)
      .run(source, instrument);
    const row = this.sqlite
      .prepare(`
        SELECT continuity_epoch
        FROM stream_state
        WHERE source = ? AND instrument = ?
      `)
      .get(source, instrument);
    return Number(row.continuity_epoch);
  }

  #advanceContinuityEpoch(source, instrument) {
    const row = this.sqlite
      .prepare(`
        INSERT INTO stream_state (source, instrument, continuity_epoch)
        VALUES (?, ?, 1)
        ON CONFLICT(source, instrument) DO UPDATE SET
          continuity_epoch = continuity_epoch + 1
        RETURNING continuity_epoch
      `)
      .get(source, instrument);
    return Number(row.continuity_epoch);
  }

  #virtualBankrollRow(source, instrument) {
    return this.sqlite
      .prepare(`
        SELECT *
        FROM virtual_bankrolls
        WHERE source = ? AND instrument = ?
      `)
      .get(source, instrument);
  }

  #ensureVirtualBankrollInTransaction(source, instrument, now) {
    const existing = this.#virtualBankrollRow(source, instrument);
    if (existing) return existing;

    // A v7 database can already contain paper bets. Seed the durable balance
    // from their known cash flow exactly once, so deploying v8 never resets a
    // running experiment or discards its profit/loss.
    const history = this.sqlite
      .prepare(`
        SELECT
          COALESCE(SUM(bets.gross_payout - bets.stake), 0) AS net_result,
          MIN(sessions.created_at) AS first_session_at
        FROM virtual_bet_sessions AS sessions
        LEFT JOIN virtual_bets AS bets ON bets.session_id = sessions.id
        WHERE sessions.source = ? AND sessions.instrument = ?
      `)
      .get(source, instrument);
    const currentBalance = clampedSafeBalance(
      this.virtualStartingBalance + Number(history.net_result),
    );
    const startedAt = history.first_session_at ?? now;

    this.sqlite
      .prepare(`
        INSERT INTO virtual_bankrolls (
          source,
          instrument,
          status,
          initial_balance,
          current_balance,
          next_stake,
          started_at,
          exhausted_at,
          created_at,
          updated_at
        ) VALUES (?, ?, 'running', ?, ?, NULL, ?, NULL, ?, ?)
        ON CONFLICT(source, instrument) DO NOTHING
      `)
      .run(
        source,
        instrument,
        this.virtualStartingBalance,
        currentBalance,
        startedAt,
        now,
        now,
      );
    let bankroll = this.#virtualBankrollRow(source, instrument);
    const live = this.#liveVirtualBetSessionRow(source, instrument);
    if (
      live &&
      Number(live.next_stake) > Number(bankroll.current_balance)
    ) {
      this.#exhaustVirtualBankrollForLiveSession(
        bankroll,
        live,
        Number(live.next_stake),
        now,
      );
      bankroll = this.#virtualBankrollRow(source, instrument);
    }
    return bankroll;
  }

  #exhaustVirtualBankrollForLiveSession(
    bankroll,
    live,
    requiredStake,
    completedAt,
  ) {
    this.sqlite
      .prepare(`
        UPDATE virtual_bankrolls
        SET
          status = 'exhausted',
          next_stake = ?,
          exhausted_at = ?,
          updated_at = ?
        WHERE source = ? AND instrument = ? AND status = 'running'
      `)
      .run(
        requiredStake,
        completedAt,
        completedAt,
        bankroll.source,
        bankroll.instrument,
      );

    if (live) {
      this.sqlite
        .prepare(`
          UPDATE virtual_bet_sessions
          SET
            status = 'completed',
            end_reason = 'bankroll_exhausted',
            next_stake = NULL,
            completed_result_id = COALESCE(completed_result_id, last_bet_result_id),
            net_result = -total_staked + gross_payout,
            last_event_at = ?,
            completed_at = ?
          WHERE id = ? AND status IN ('armed', 'active')
        `)
        .run(completedAt, completedAt, Number(live.id));
    }
  }

  #liveVirtualBetSessionRow(source, instrument) {
    return this.sqlite
      .prepare(`
        SELECT
          sessions.*,
          (
            SELECT MIN(bets.occurred_at)
            FROM virtual_bets AS bets
            WHERE bets.session_id = sessions.id
          ) AS started_at
        FROM virtual_bet_sessions AS sessions
        WHERE sessions.source = ?
          AND sessions.instrument = ?
          AND sessions.status IN ('armed', 'active')
        LIMIT 1
      `)
      .get(source, instrument);
  }

  #latestResultInEpoch(source, instrument, continuityEpoch, excludeResultId = null) {
    return this.sqlite
      .prepare(`
        SELECT *
        FROM round_results
        WHERE source = ?
          AND instrument = ?
          AND continuity_epoch = ?
          AND (? IS NULL OR id <> ?)
        ORDER BY settled_at DESC, id DESC
        LIMIT 1
      `)
      .get(
        source,
        instrument,
        continuityEpoch,
        excludeResultId,
        excludeResultId,
      );
  }

  #longestVirtualCandidates(
    source,
    instrument,
    continuityEpoch,
    excludeResultId = null,
    triggerThreshold = VIRTUAL_BET_MODEL.triggerThreshold,
    maxTriggerThreshold = null,
  ) {
    const rows = this.sqlite
      .prepare(`
        WITH numbers(result_number) AS (
          VALUES ${ROULETTE_NUMBERS.map((number) => `(${number})`).join(", ")}
        ),
        ordered AS (
          SELECT
            id,
            result_number,
            settled_at,
            ROW_NUMBER() OVER (ORDER BY settled_at, id) AS position
          FROM round_results
          WHERE source = ?
            AND instrument = ?
            AND continuity_epoch = ?
            AND (? IS NULL OR id <> ?)
        ),
        totals AS (
          SELECT COUNT(*) AS total_rounds
          FROM ordered
        ),
        last_seen AS (
          SELECT
            result_number,
            COUNT(*) AS occurrence_count,
            MAX(position) AS last_position
          FROM ordered
          GROUP BY result_number
        )
        SELECT
          numbers.result_number,
          COALESCE(last_seen.occurrence_count, 0) AS occurrence_count,
          last_seen.last_position,
          totals.total_rounds - COALESCE(last_seen.last_position, 0)
            AS rounds_since_last,
          ordered.id AS last_result_id,
          ordered.settled_at AS last_seen_at
        FROM numbers
        CROSS JOIN totals
        LEFT JOIN last_seen
          ON last_seen.result_number = numbers.result_number
        LEFT JOIN ordered
          ON ordered.result_number = last_seen.result_number
         AND ordered.position = last_seen.last_position
        WHERE totals.total_rounds > 0
        ORDER BY
          rounds_since_last DESC,
          CASE WHEN last_seen.last_position IS NULL THEN 0 ELSE 1 END,
          last_seen.last_position,
          numbers.result_number
      `)
      .all(
        source,
        instrument,
        continuityEpoch,
        excludeResultId,
        excludeResultId,
      );

    if (rows.length === 0) return [];
    const candidates = rows.map((row) => {
      const roundsSinceLast = Number(row.rounds_since_last);
      return {
        number: Number(row.result_number),
        roundsSinceLast,
        occurrenceCount: Number(row.occurrence_count),
        lastSeenAt: row.last_seen_at,
        lastResultId:
          row.last_result_id === null ? null : Number(row.last_result_id),
        lastPosition:
          row.last_position === null ? null : Number(row.last_position),
        continuityEpoch,
        eligible: roundsSinceLast >= triggerThreshold,
      };
    });
    const eligibleCandidates = maxTriggerThreshold === null
      ? candidates
      : candidates.filter(({ roundsSinceLast }) => (
          roundsSinceLast < maxTriggerThreshold
        ));
    if (eligibleCandidates.length === 0) return [];
    const longestRounds = eligibleCandidates[0].roundsSinceLast;
    return eligibleCandidates.filter(({ roundsSinceLast }) => (
      roundsSinceLast === longestRounds
    ));
  }

  #longestVirtualCandidate(
    source,
    instrument,
    continuityEpoch,
    excludeResultId = null,
  ) {
    return this.#longestVirtualCandidates(
      source,
      instrument,
      continuityEpoch,
      excludeResultId,
    )[0] ?? null;
  }

  #virtualWindowBankrollRow(source, instrument) {
    return this.sqlite
      .prepare(`
        SELECT *
        FROM virtual_window_bettor_bankrolls
        WHERE source = ? AND instrument = ?
      `)
      .get(source, instrument);
  }

  #ensureVirtualWindowBankrollInTransaction(source, instrument, now) {
    const existing = this.#virtualWindowBankrollRow(source, instrument);
    if (existing) return existing;
    const history = this.sqlite
      .prepare(`
        SELECT
          COALESCE(SUM(bets.gross_payout - bets.stake), 0) AS net_result,
          MIN(sessions.created_at) AS first_session_at
        FROM virtual_window_bet_sessions AS sessions
        LEFT JOIN virtual_window_bets AS bets ON bets.session_id = sessions.id
        WHERE sessions.source = ? AND sessions.instrument = ?
      `)
      .get(source, instrument);
    const currentBalance = clampedSafeBalance(
      this.virtualWindowStartingBalance + Number(history.net_result),
    );
    const startedAt = history.first_session_at ?? now;
    this.sqlite
      .prepare(`
        INSERT INTO virtual_window_bettor_bankrolls (
          source, instrument, status, initial_balance, current_balance,
          next_stake, started_at, exhausted_at, created_at, updated_at
        ) VALUES (?, ?, 'running', ?, ?, NULL, ?, NULL, ?, ?)
        ON CONFLICT(source, instrument) DO NOTHING
      `)
      .run(
        source,
        instrument,
        this.virtualWindowStartingBalance,
        currentBalance,
        startedAt,
        now,
        now,
      );
    return this.#virtualWindowBankrollRow(source, instrument);
  }

  #liveVirtualWindowSessionRow(source, instrument) {
    return this.sqlite
      .prepare(`
        SELECT sessions.*,
          (
            SELECT MIN(bets.occurred_at)
            FROM virtual_window_bets AS bets
            WHERE bets.session_id = sessions.id
          ) AS started_at
        FROM virtual_window_bet_sessions AS sessions
        WHERE sessions.source = ? AND sessions.instrument = ?
          AND sessions.status IN ('armed', 'active')
        LIMIT 1
      `)
      .get(source, instrument);
  }

  #armVirtualWindowBettorInTransaction(
    source,
    instrument,
    now,
    { excludeResultId = null } = {},
  ) {
    const bankroll = this.#ensureVirtualWindowBankrollInTransaction(
      source,
      instrument,
      now,
    );
    if (bankroll.status === 'exhausted') return null;
    const live = this.#liveVirtualWindowSessionRow(source, instrument);
    if (live) return live;
    const continuityEpoch = this.#continuityEpoch(source, instrument);
    const boundary = this.#latestResultInEpoch(
      source,
      instrument,
      continuityEpoch,
      excludeResultId,
    );
    if (!boundary) return null;
    const candidate = this.#longestVirtualCandidates(
      source,
      instrument,
      continuityEpoch,
      excludeResultId,
      VIRTUAL_WINDOW_BET_MODEL.triggerThreshold,
      VIRTUAL_WINDOW_BET_MODEL.stopThreshold,
    )[0];
    if (!candidate?.eligible || candidate.roundsSinceLast >= VIRTUAL_WINDOW_BET_MODEL.stopThreshold) {
      return null;
    }
    const attemptBudget = virtualWindowAttemptBudget(candidate.roundsSinceLast);
    const initialStake = virtualWindowStake(0);
    if (initialStake > Number(bankroll.current_balance)) {
      this.sqlite.prepare(`
        UPDATE virtual_window_bettor_bankrolls
        SET status = 'exhausted', next_stake = ?, exhausted_at = ?, updated_at = ?
        WHERE source = ? AND instrument = ? AND status = 'running'
      `).run(initialStake, boundary.settled_at, boundary.settled_at, source, instrument);
      return null;
    }
    const insertion = this.sqlite.prepare(`
      INSERT INTO virtual_window_bet_sessions (
        source, instrument, continuity_epoch, target_number, status,
        trigger_rounds_missed, attempt_budget, activated_after_result_id,
        model_version, initial_stake, stake_step, max_stake,
        gross_payout_multiplier, payout_includes_stake, attempt_count,
        miss_count, total_staked, next_stake, armed_at, last_event_at, created_at
      ) VALUES (?, ?, ?, ?, 'armed', ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 0, ?, ?, ?, ?)
    `).run(
      source,
      instrument,
      continuityEpoch,
      candidate.number,
      candidate.roundsSinceLast,
      attemptBudget,
      Number(boundary.id),
      VIRTUAL_WINDOW_BET_MODEL.modelVersion,
      VIRTUAL_WINDOW_BET_MODEL.initialStake,
      VIRTUAL_WINDOW_BET_MODEL.stakeStep,
      VIRTUAL_WINDOW_BET_MODEL.maxStake,
      VIRTUAL_WINDOW_BET_MODEL.grossPayoutMultiplier,
      initialStake,
      boundary.settled_at,
      boundary.settled_at,
      now,
    );
    return this.sqlite
      .prepare('SELECT * FROM virtual_window_bet_sessions WHERE id = ?')
      .get(Number(insertion.lastInsertRowid));
  }

  #settleVirtualWindowBettorInTransaction(resultRow, now) {
    const live = this.#liveVirtualWindowSessionRow(
      resultRow.source,
      resultRow.instrument,
    );
    if (
      !live
      || Number(live.continuity_epoch) !== Number(resultRow.continuity_epoch)
      || Number(live.activated_after_result_id) === Number(resultRow.id)
    ) return null;
    const bankroll = this.#ensureVirtualWindowBankrollInTransaction(
      resultRow.source,
      resultRow.instrument,
      now,
    );
    if (bankroll.status === 'exhausted') return null;
    const stake = Number(live.next_stake);
    if (stake > Number(bankroll.current_balance)) return null;
    const settlement = settleVirtualWindowBet({
      targetNumber: Number(live.target_number),
      resultNumber: Number(resultRow.result_number),
      stake,
      priorTotalStaked: Number(live.total_staked),
    });
    const attemptNumber = Number(live.attempt_count) + 1;
    this.sqlite.prepare(`
      INSERT INTO virtual_window_bets (
        session_id, round_result_id, attempt_number, stake, result_number,
        outcome, gross_payout, total_staked_after, net_after, next_stake_after,
        recovery_possible, occurred_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      Number(live.id),
      Number(resultRow.id),
      attemptNumber,
      stake,
      Number(resultRow.result_number),
      settlement.outcome,
      settlement.grossPayout,
      settlement.totalStaked,
      settlement.netResult,
      settlement.nextStake,
      settlement.recoveryPossible ? 1 : 0,
      resultRow.settled_at,
      now,
    );
    const currentBalance = clampedSafeBalance(
      Number(bankroll.current_balance) - stake + settlement.grossPayout,
    );
    const expired = settlement.outcome === 'miss'
      && attemptNumber >= Number(live.attempt_budget);
    const bankrollExhausted = settlement.outcome === 'miss'
      && settlement.nextStake > currentBalance;
    const completed = settlement.outcome === 'hit' || expired || bankrollExhausted;
    this.sqlite.prepare(`
      UPDATE virtual_window_bettor_bankrolls
      SET status = ?, current_balance = ?, next_stake = ?, exhausted_at = ?, updated_at = ?
      WHERE source = ? AND instrument = ? AND status = 'running'
    `).run(
      bankrollExhausted ? 'exhausted' : 'running',
      currentBalance,
      bankrollExhausted ? settlement.nextStake : null,
      bankrollExhausted ? resultRow.settled_at : null,
      resultRow.settled_at,
      resultRow.source,
      resultRow.instrument,
    );
    const endReason = settlement.outcome === 'hit'
      ? 'hit'
      : bankrollExhausted
        ? 'bankroll_exhausted'
        : expired
          ? 'window_expired'
          : null;
    if (completed) {
      this.sqlite.prepare(`
        UPDATE virtual_window_bet_sessions
        SET status = 'completed', end_reason = ?, attempt_count = ?,
          miss_count = miss_count + ?, total_staked = ?, next_stake = NULL,
          last_bet_result_id = ?, completed_result_id = ?, gross_payout = ?,
          net_result = ?, last_event_at = ?, completed_at = ?
        WHERE id = ? AND status IN ('armed', 'active')
      `).run(
        endReason,
        attemptNumber,
        settlement.outcome === 'miss' ? 1 : 0,
        settlement.totalStaked,
        Number(resultRow.id),
        Number(resultRow.id),
        settlement.grossPayout,
        settlement.netResult,
        resultRow.settled_at,
        resultRow.settled_at,
        Number(live.id),
      );
    } else {
      this.sqlite.prepare(`
        UPDATE virtual_window_bet_sessions
        SET status = 'active', attempt_count = ?, miss_count = miss_count + 1,
          total_staked = ?, next_stake = ?, last_bet_result_id = ?,
          net_result = ?, last_event_at = ?
        WHERE id = ? AND status IN ('armed', 'active')
      `).run(
        attemptNumber,
        settlement.totalStaked,
        settlement.nextStake,
        Number(resultRow.id),
        settlement.netResult,
        resultRow.settled_at,
        Number(live.id),
      );
    }
    return settlement;
  }

  #processVirtualWindowBettorResult(resultRow, now) {
    const isTail = this.#isChronologicalTail(resultRow);
    if (isTail && !this.#liveVirtualWindowSessionRow(resultRow.source, resultRow.instrument)) {
      this.#armVirtualWindowBettorInTransaction(resultRow.source, resultRow.instrument, now, {
        excludeResultId: Number(resultRow.id),
      });
    }
    if (isTail) this.#settleVirtualWindowBettorInTransaction(resultRow, now);
    if (!this.#liveVirtualWindowSessionRow(resultRow.source, resultRow.instrument)) {
      this.#armVirtualWindowBettorInTransaction(resultRow.source, resultRow.instrument, now);
    }
  }

  #invalidateVirtualWindowBettorForGap(source, instrument, detectedAt) {
    this.sqlite.prepare(`
      UPDATE virtual_window_bet_sessions
      SET status = 'invalid_gap', end_reason = 'integrity_gap', next_stake = NULL,
        completed_result_id = COALESCE(completed_result_id, last_bet_result_id),
        net_result = -total_staked + gross_payout,
        last_event_at = ?, completed_at = ?
      WHERE source = ? AND instrument = ? AND status IN ('armed', 'active')
    `).run(detectedAt, detectedAt, source, instrument);
  }

  #armVirtualBettorInTransaction(
    source,
    instrument,
    now,
    { excludeResultId = null } = {},
  ) {
    const bankroll = this.#ensureVirtualBankrollInTransaction(
      source,
      instrument,
      now,
    );
    if (bankroll.status === "exhausted") return null;

    const live = this.#liveVirtualBetSessionRow(source, instrument);
    if (live) {
      const requiredStake = Number(live.next_stake);
      if (requiredStake > Number(bankroll.current_balance)) {
        this.#exhaustVirtualBankrollForLiveSession(
          bankroll,
          live,
          requiredStake,
          now,
        );
        return null;
      }
      return live;
    }

    const continuityEpoch = this.#continuityEpoch(source, instrument);
    const boundary = this.#latestResultInEpoch(
      source,
      instrument,
      continuityEpoch,
      excludeResultId,
    );
    if (!boundary) return null;

    const candidate = this.#longestVirtualCandidate(
      source,
      instrument,
      continuityEpoch,
      excludeResultId,
    );
    if (!candidate?.eligible) return null;

    const initialStake = calculateNextVirtualStake(0);
    if (initialStake > Number(bankroll.current_balance)) {
      this.#exhaustVirtualBankrollForLiveSession(
        bankroll,
        null,
        initialStake,
        boundary.settled_at,
      );
      return null;
    }
    const insertion = this.sqlite
      .prepare(`
        INSERT INTO virtual_bet_sessions (
          source,
          instrument,
          continuity_epoch,
          target_number,
          status,
          trigger_rounds_missed,
          activated_after_result_id,
          model_version,
          initial_stake,
          stake_step,
          max_stake,
          gross_payout_multiplier,
          payout_includes_stake,
          next_stake,
          armed_at,
          last_event_at,
          created_at
        ) VALUES (?, ?, ?, ?, 'armed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        source,
        instrument,
        continuityEpoch,
        candidate.number,
        candidate.roundsSinceLast,
        Number(boundary.id),
        VIRTUAL_BET_MODEL.modelVersion,
        VIRTUAL_BET_MODEL.initialStake,
        VIRTUAL_BET_MODEL.stakeStep,
        VIRTUAL_BET_MODEL.maxStake,
        VIRTUAL_BET_MODEL.grossPayoutMultiplier,
        VIRTUAL_BET_MODEL.payoutIncludesStake ? 1 : 0,
        initialStake,
        boundary.settled_at,
        boundary.settled_at,
        now,
      );
    return this.sqlite
      .prepare("SELECT * FROM virtual_bet_sessions WHERE id = ?")
      .get(Number(insertion.lastInsertRowid));
  }

  #isChronologicalTail(resultRow) {
    const latest = this.#latestResultInEpoch(
      resultRow.source,
      resultRow.instrument,
      Number(resultRow.continuity_epoch),
    );
    return latest !== undefined && Number(latest.id) === Number(resultRow.id);
  }

  #settleVirtualBettorInTransaction(resultRow, now) {
    const live = this.#liveVirtualBetSessionRow(
      resultRow.source,
      resultRow.instrument,
    );
    if (
      !live ||
      Number(live.continuity_epoch) !== Number(resultRow.continuity_epoch) ||
      Number(live.activated_after_result_id) === Number(resultRow.id)
    ) {
      return null;
    }

    const bankroll = this.#ensureVirtualBankrollInTransaction(
      resultRow.source,
      resultRow.instrument,
      now,
    );
    if (bankroll.status === "exhausted") return null;

    const stake = Number(live.next_stake);
    if (stake > Number(bankroll.current_balance)) {
      this.#exhaustVirtualBankrollForLiveSession(
        bankroll,
        live,
        stake,
        resultRow.settled_at,
      );
      return null;
    }

    const settlement = settleVirtualBet({
      targetNumber: Number(live.target_number),
      resultNumber: Number(resultRow.result_number),
      stake,
      priorTotalStaked: Number(live.total_staked),
      // Continue an already armed session with the exact rules persisted when
      // it started, even if a later deployment changes the global defaults.
      model: {
        initialStake: Number(live.initial_stake),
        stakeStep: Number(live.stake_step),
        maxStake: Number(live.max_stake),
        grossPayoutMultiplier: Number(live.gross_payout_multiplier),
        payoutIncludesStake: Boolean(live.payout_includes_stake),
      },
    });
    const attemptNumber = Number(live.attempt_count) + 1;

    this.sqlite
      .prepare(`
        INSERT INTO virtual_bets (
          session_id,
          round_result_id,
          attempt_number,
          stake,
          result_number,
          outcome,
          gross_payout,
          total_staked_after,
          net_after,
          next_stake_after,
          recovery_possible,
          occurred_at,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        Number(live.id),
        Number(resultRow.id),
        attemptNumber,
        stake,
        Number(resultRow.result_number),
        settlement.outcome,
        settlement.grossPayout,
        settlement.totalStaked,
        settlement.netResult,
        settlement.nextStake,
        settlement.recoveryPossible ? 1 : 0,
        resultRow.settled_at,
        now,
      );

    const currentBalance = clampedSafeBalance(
      Number(bankroll.current_balance) - stake + settlement.grossPayout,
    );
    const bankrollExhausted =
      settlement.outcome === "miss" &&
      settlement.nextStake > currentBalance;
    this.sqlite
      .prepare(`
        UPDATE virtual_bankrolls
        SET
          status = ?,
          current_balance = ?,
          next_stake = ?,
          exhausted_at = ?,
          updated_at = ?
        WHERE source = ? AND instrument = ? AND status = 'running'
      `)
      .run(
        bankrollExhausted ? "exhausted" : "running",
        currentBalance,
        bankrollExhausted ? settlement.nextStake : null,
        bankrollExhausted ? resultRow.settled_at : null,
        resultRow.settled_at,
        resultRow.source,
        resultRow.instrument,
      );

    if (settlement.outcome === "hit") {
      this.sqlite
        .prepare(`
          UPDATE virtual_bet_sessions
          SET
            status = 'completed',
            end_reason = 'hit',
            attempt_count = ?,
            total_staked = ?,
            next_stake = NULL,
            last_bet_result_id = ?,
            completed_result_id = ?,
            gross_payout = ?,
            net_result = ?,
            last_event_at = ?,
            completed_at = ?
          WHERE id = ? AND status IN ('armed', 'active')
        `)
        .run(
          attemptNumber,
          settlement.totalStaked,
          Number(resultRow.id),
          Number(resultRow.id),
          settlement.grossPayout,
          settlement.netResult,
          resultRow.settled_at,
          resultRow.settled_at,
          Number(live.id),
        );
    } else if (bankrollExhausted) {
      this.sqlite
        .prepare(`
          UPDATE virtual_bet_sessions
          SET
            status = 'completed',
            end_reason = 'bankroll_exhausted',
            attempt_count = ?,
            miss_count = miss_count + 1,
            total_staked = ?,
            next_stake = NULL,
            last_bet_result_id = ?,
            completed_result_id = ?,
            gross_payout = 0,
            net_result = ?,
            last_event_at = ?,
            completed_at = ?
          WHERE id = ? AND status IN ('armed', 'active')
        `)
        .run(
          attemptNumber,
          settlement.totalStaked,
          Number(resultRow.id),
          Number(resultRow.id),
          settlement.netResult,
          resultRow.settled_at,
          resultRow.settled_at,
          Number(live.id),
        );
    } else {
      this.sqlite
        .prepare(`
          UPDATE virtual_bet_sessions
          SET
            status = 'active',
            attempt_count = ?,
            miss_count = miss_count + 1,
            total_staked = ?,
            next_stake = ?,
            last_bet_result_id = ?,
            gross_payout = 0,
            net_result = ?,
            last_event_at = ?
          WHERE id = ? AND status IN ('armed', 'active')
        `)
        .run(
          attemptNumber,
          settlement.totalStaked,
          settlement.nextStake,
          Number(resultRow.id),
          settlement.netResult,
          resultRow.settled_at,
          Number(live.id),
        );
    }

    return settlement;
  }

  #processVirtualBettorResult(resultRow, now) {
    const isTail = this.#isChronologicalTail(resultRow);
    if (isTail && !this.#liveVirtualBetSessionRow(resultRow.source, resultRow.instrument)) {
      this.#armVirtualBettorInTransaction(resultRow.source, resultRow.instrument, now, {
        excludeResultId: Number(resultRow.id),
      });
    }

    if (isTail) {
      this.#settleVirtualBettorInTransaction(resultRow, now);
    }

    if (!this.#liveVirtualBetSessionRow(resultRow.source, resultRow.instrument)) {
      this.#armVirtualBettorInTransaction(resultRow.source, resultRow.instrument, now);
    }
  }

  #invalidateVirtualBettorForGap(source, instrument, detectedAt) {
    this.sqlite
      .prepare(`
        UPDATE virtual_bet_sessions
        SET
          status = 'invalid_gap',
          end_reason = 'integrity_gap',
          next_stake = NULL,
          gross_payout = 0,
          net_result = -total_staked,
          last_event_at = ?,
          completed_at = ?
        WHERE source = ?
          AND instrument = ?
          AND status IN ('armed', 'active')
      `)
      .run(detectedAt, detectedAt, source, instrument);
    this.#invalidateVirtualWindowBettorForGap(source, instrument, detectedAt);
  }

  #liveFollowerTop5SessionRow(source, instrument) {
    return this.sqlite
      .prepare(`
        SELECT
          sessions.*,
          COALESCE(last_attempt.settled_at, anchor.settled_at)
            AS boundary_settled_at,
          COALESCE(last_attempt.id, anchor.id) AS boundary_result_id
        FROM follower_top5_sessions AS sessions
        JOIN round_results AS anchor ON anchor.id = sessions.anchor_result_id
        LEFT JOIN round_results AS last_attempt
          ON last_attempt.id = sessions.last_attempt_result_id
        WHERE sessions.source = ?
          AND sessions.instrument = ?
          AND sessions.status = 'active'
        ORDER BY sessions.id DESC
        LIMIT 1
      `)
      .get(source, instrument);
  }

  #followerTop5SnapshotAtResult(resultRow) {
    const rows = this.sqlite
      .prepare(`
        WITH ordered AS (
          SELECT
            result_number AS source_number,
            LEAD(result_number, 1) OVER stream_order AS follower_number,
            LEAD(settled_at, 1) OVER stream_order AS follower_settled_at
          FROM round_results
          WHERE source = ?
            AND instrument = ?
            AND (
              settled_at < ?
              OR (settled_at = ? AND id <= ?)
            )
          WINDOW stream_order AS (
            PARTITION BY continuity_epoch
            ORDER BY settled_at, id
          )
        )
        SELECT
          follower_number,
          COUNT(*) AS occurrence_count,
          MAX(follower_settled_at) AS last_occurred_at
        FROM ordered
        WHERE source_number = ? AND follower_number IS NOT NULL
        GROUP BY follower_number
      `)
      .all(
        resultRow.source,
        resultRow.instrument,
        resultRow.settled_at,
        resultRow.settled_at,
        Number(resultRow.id),
        Number(resultRow.result_number),
      );
    if (rows.length < FOLLOWER_TOP5_MINIMUM_OBSERVED) return null;

    const counts = ROULETTE_NUMBERS.map(() => 0);
    const lastOccurredAt = ROULETTE_NUMBERS.map(() => null);
    let sampleSize = 0;
    for (const row of rows) {
      const number = Number(row.follower_number);
      const count = Number(row.occurrence_count);
      counts[number] = count;
      lastOccurredAt[number] = row.last_occurred_at;
      sampleSize += count;
    }
    const topNumbers = rankFollowerNumbers(counts, lastOccurredAt);
    return {
      topNumbers,
      sampleSize,
      observedFollowerCount: rows.length,
    };
  }

  #armFollowerTop5SessionAtResult(resultRow, now, preparedSnapshot = null) {
    if (!resultRow || this.#liveFollowerTop5SessionRow(
      resultRow.source,
      resultRow.instrument,
    )) {
      return null;
    }
    if (!this.#isChronologicalTail(resultRow)) return null;

    const epochRow = this.sqlite
      .prepare(`
        SELECT continuity_epoch
        FROM stream_state
        WHERE source = ? AND instrument = ?
      `)
      .get(resultRow.source, resultRow.instrument);
    if (
      epochRow
      && Number(epochRow.continuity_epoch) !== Number(resultRow.continuity_epoch)
    ) {
      return null;
    }

    const snapshot = preparedSnapshot ?? this.#followerTop5SnapshotAtResult(resultRow);
    if (!snapshot) return null;
    const insertion = this.sqlite
      .prepare(`
        INSERT OR IGNORE INTO follower_top5_sessions (
          source,
          instrument,
          continuity_epoch,
          status,
          end_reason,
          anchor_result_id,
          anchor_number,
          top_numbers_json,
          algorithm_version,
          history_max_result_id,
          sample_size,
          observed_follower_count,
          attempt_count,
          miss_count,
          locked_at,
          last_event_at,
          created_at
        ) VALUES (?, ?, ?, 'active', NULL, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
      `)
      .run(
        resultRow.source,
        resultRow.instrument,
        Number(resultRow.continuity_epoch),
        Number(resultRow.id),
        Number(resultRow.result_number),
        serializeJson(snapshot.topNumbers, "follower top-5"),
        FOLLOWER_TOP5_LIVE_ALGORITHM_VERSION,
        Number(resultRow.id),
        snapshot.sampleSize,
        snapshot.observedFollowerCount,
        now,
        resultRow.settled_at,
        now,
      );
    if (Number(insertion.changes) === 0) return null;
    return this.sqlite
      .prepare("SELECT * FROM follower_top5_sessions WHERE id = ?")
      .get(Number(insertion.lastInsertRowid));
  }

  #settleFollowerTop5Session(sessionRow, resultRow, now) {
    if (
      !sessionRow
      || Number(sessionRow.continuity_epoch) !== Number(resultRow.continuity_epoch)
      || Number(sessionRow.anchor_result_id) === Number(resultRow.id)
    ) {
      return null;
    }
    const boundarySettledAt = sessionRow.boundary_settled_at;
    const boundaryResultId = Number(sessionRow.boundary_result_id);
    if (
      resultRow.settled_at < boundarySettledAt
      || (
        resultRow.settled_at === boundarySettledAt
        && Number(resultRow.id) <= boundaryResultId
      )
    ) {
      return null;
    }
    const topNumbers = deserializeJson(sessionRow.top_numbers_json);
    if (
      !Array.isArray(topNumbers)
      || topNumbers.length !== FOLLOWER_TOP5_COUNT
      || new Set(topNumbers).size !== FOLLOWER_TOP5_COUNT
      || topNumbers.some((number) => !ROULETTE_NUMBERS.includes(Number(number)))
    ) {
      throw new Error("stored follower top-5 session is invalid");
    }
    const resultNumber = Number(resultRow.result_number);
    const hitIndex = topNumbers.map(Number).indexOf(resultNumber);
    const hit = hitIndex >= 0;
    const attemptNumber = Number(sessionRow.attempt_count) + 1;
    this.sqlite
      .prepare(`
        INSERT INTO follower_top5_attempts (
          session_id,
          round_result_id,
          attempt_number,
          result_number,
          outcome,
          hit_rank,
          occurred_at,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        Number(sessionRow.id),
        Number(resultRow.id),
        attemptNumber,
        resultNumber,
        hit ? "hit" : "miss",
        hit ? hitIndex + 1 : null,
        resultRow.settled_at,
        now,
      );

    if (hit) {
      this.sqlite
        .prepare(`
          UPDATE follower_top5_sessions
          SET
            status = 'completed',
            end_reason = 'hit',
            attempt_count = ?,
            last_attempt_result_id = ?,
            completed_result_id = ?,
            last_event_at = ?,
            completed_at = ?
          WHERE id = ? AND status = 'active'
        `)
        .run(
          attemptNumber,
          Number(resultRow.id),
          Number(resultRow.id),
          resultRow.settled_at,
          resultRow.settled_at,
          Number(sessionRow.id),
        );
    } else {
      this.sqlite
        .prepare(`
          UPDATE follower_top5_sessions
          SET
            attempt_count = ?,
            miss_count = miss_count + 1,
            last_attempt_result_id = ?,
            last_event_at = ?
          WHERE id = ? AND status = 'active'
        `)
        .run(
          attemptNumber,
          Number(resultRow.id),
          resultRow.settled_at,
          Number(sessionRow.id),
        );
    }
    return { hit, attemptNumber, hitRank: hit ? hitIndex + 1 : null };
  }

  #invalidateFollowerTop5SessionForGap(source, instrument, detectedAt) {
    this.sqlite
      .prepare(`
        UPDATE follower_top5_sessions
        SET
          status = 'invalid_gap',
          end_reason = 'integrity_gap',
          last_event_at = ?,
          completed_at = ?
        WHERE source = ? AND instrument = ? AND status = 'active'
      `)
      .run(detectedAt, detectedAt, source, instrument);
  }

  #processFollowerTop5TrackerBatch(resultRows, now) {
    const byStream = new Map();
    for (const row of resultRows) {
      const key = `${row.source}\u0000${row.instrument}`;
      const group = byStream.get(key) ?? [];
      group.push(row);
      byStream.set(key, group);
    }

    for (const rows of byStream.values()) {
      const first = rows[0];
      let live = this.#liveFollowerTop5SessionRow(
        first.source,
        first.instrument,
      );
      if (live) {
        for (const row of rows) {
          if (Number(live.continuity_epoch) !== Number(row.continuity_epoch)) {
            this.#invalidateFollowerTop5SessionForGap(
              row.source,
              row.instrument,
              row.settled_at,
            );
            live = null;
            break;
          }
          const settlement = this.#settleFollowerTop5Session(live, row, now);
          if (settlement?.hit) {
            live = null;
            break;
          }
          live = this.#liveFollowerTop5SessionRow(row.source, row.instrument);
        }
      }

      if (!this.#liveFollowerTop5SessionRow(first.source, first.instrument)) {
        this.#armFollowerTop5SessionAtResult(rows.at(-1), now);
      }
    }
  }

  #initializeFollowerTop5Trackers() {
    this.#transaction(() => {
      // Continuity reconciliation can merge a proven false shutdown gap before
      // this v13 initialization runs. Keep persisted sessions attached to the
      // epoch of their immutable anchor instead of cancelling a healthy live
      // session on the first result after restart.
      this.sqlite
        .prepare(`
          UPDATE follower_top5_sessions
          SET continuity_epoch = (
            SELECT anchors.continuity_epoch
            FROM round_results AS anchors
            WHERE anchors.id = follower_top5_sessions.anchor_result_id
          )
          WHERE continuity_epoch <> (
            SELECT anchors.continuity_epoch
            FROM round_results AS anchors
            WHERE anchors.id = follower_top5_sessions.anchor_result_id
          )
        `)
        .run();

      const tails = this.sqlite
        .prepare(`
          SELECT rr.*
          FROM round_results AS rr
          JOIN stream_state AS state
            ON state.source = rr.source
            AND state.instrument = rr.instrument
            AND state.continuity_epoch = rr.continuity_epoch
          WHERE rr.id = (
            SELECT candidate.id
            FROM round_results AS candidate
            WHERE candidate.source = rr.source
              AND candidate.instrument = rr.instrument
            ORDER BY candidate.settled_at DESC, candidate.id DESC
            LIMIT 1
          )
            AND NOT EXISTS (
              SELECT 1
              FROM follower_top5_sessions AS live
              WHERE live.source = rr.source
                AND live.instrument = rr.instrument
                AND live.status = 'active'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM follower_top5_sessions AS anchored
              WHERE anchored.anchor_result_id = rr.id
            )
        `)
        .all();
      let now = null;
      for (const tail of tails) {
        const snapshot = this.#followerTop5SnapshotAtResult(tail);
        if (!snapshot) continue;
        now ??= asTimestamp(this.clock(), undefined, "clock");
        this.#armFollowerTop5SessionAtResult(tail, now, snapshot);
      }
    });
  }

  #remainingNumbers(cycleId) {
    return this.sqlite
      .prepare(`
        SELECT number
        FROM cycle_numbers
        WHERE cycle_id = ? AND eliminated_at IS NULL
        ORDER BY number
      `)
      .all(cycleId)
      .map((row) => Number(row.number));
  }

  #cycleEventSequence(cycleId) {
    return this.sqlite
      .prepare(`
        SELECT
          ce.id AS event_id,
          ce.round_result_id,
          ce.result_number,
          ce.eliminated,
          ce.remaining_count,
          ce.occurred_at
        FROM cycle_events AS ce
        WHERE ce.cycle_id = ?
        ORDER BY ce.occurred_at, ce.round_result_id, ce.id
      `)
      .all(cycleId)
      .map((row, index) => ({
        position: index + 1,
        id: Number(row.round_result_id),
        resultId: Number(row.round_result_id),
        eventId: Number(row.event_id),
        number: Number(row.result_number),
        settledAt: row.occurred_at,
        wasNew: Boolean(row.eliminated),
        remainingAfter: Number(row.remaining_count),
      }));
  }

  #hydrateCycle(row) {
    if (!row) {
      return null;
    }

    const cycleId = Number(row.id);
    const numbers = this.sqlite
      .prepare(`
        SELECT
          cn.number,
          cn.eliminated_at,
          COUNT(ce.id) AS occurrence_count,
          MIN(ce.occurred_at) AS first_seen_at
        FROM cycle_numbers AS cn
        LEFT JOIN cycle_events AS ce
          ON ce.cycle_id = cn.cycle_id
         AND ce.result_number = cn.number
        WHERE cn.cycle_id = ?
        GROUP BY cn.number, cn.eliminated_at
        ORDER BY cn.number
      `)
      .all(cycleId)
      .map((item) => ({
        number: Number(item.number),
        occurrenceCount: Number(item.occurrence_count),
        eliminated: item.eliminated_at !== null,
        firstSeenAt: item.first_seen_at,
      }));
    const remainingNumbers = numbers
      .filter((item) => !item.eliminated)
      .map((item) => item.number);
    const eliminatedNumbers = numbers
      .filter((item) => item.eliminated)
      .map((item) => item.number);

    return {
      id: cycleId,
      source: row.source,
      instrument: row.instrument,
      status: row.status,
      integrityStatus: row.status === "invalid_gap" ? "gap" : "ok",
      origin: row.origin,
      startedAt: row.started_at,
      lastEventAt: row.last_event_at,
      completedAt: row.completed_at,
      survivorNumber:
        row.survivor_number === null ? null : Number(row.survivor_number),
      eventCount: Number(row.event_count),
      eliminatedCount: Number(row.eliminated_count),
      totalDraws: Number(row.event_count),
      uniqueCount: Number(row.eliminated_count),
      remainingCount: remainingNumbers.length,
      remainingNumbers,
      eliminatedNumbers,
      numbers,
    };
  }

  #cycleById(cycleId) {
    const row = this.sqlite
      .prepare("SELECT * FROM cycles WHERE id = ?")
      .get(cycleId);
    return this.#hydrateCycle(row);
  }

  #classifyHistoricalEventsInTransaction(events) {
    const outcome = {
      received: events.length,
      known: 0,
      enriched: 0,
      prehistory: 0,
      unknownWithinCoverage: 0,
      afterCoverage: 0,
      missingGroups: new Map(),
    };
    if (events.length === 0) return outcome;

    const findKnown = this.sqlite.prepare(`
      SELECT *
      FROM round_results
      WHERE fingerprint = ?
         OR (
           ? IS NOT NULL
           AND source = ?
           AND instrument = ?
           AND external_round_id = ?
         )
      ORDER BY CASE WHEN fingerprint = ? THEN 0 ELSE 1 END
      LIMIT 1
    `);
    const enrichKnown = this.sqlite.prepare(`
      UPDATE round_results
      SET
        external_round_id = COALESCE(external_round_id, ?),
        raw_cell = COALESCE(?, raw_cell),
        raw_payload = COALESCE(?, raw_payload)
      WHERE id = ?
    `);
    const coverageByStream = new Map();

    for (const event of events) {
      const existing = findKnown.get(
        event.fingerprint,
        event.externalRoundId,
        event.source,
        event.instrument,
        event.externalRoundId,
        event.fingerprint,
      );
      if (existing) {
        outcome.known += 1;
        if (event.externalRoundId !== null) {
          outcome.enriched += Number(
            enrichKnown.run(
              event.externalRoundId,
              event.rawCell,
              event.rawPayload,
              Number(existing.id),
            ).changes,
          );
        }
        continue;
      }

      const streamKey = `${event.source}\u0000${event.instrument}`;
      let coverage = coverageByStream.get(streamKey);
      if (!coverage) {
        const continuityEpoch = this.#continuityEpoch(
          event.source,
          event.instrument,
        );
        const row = this.sqlite
          .prepare(`
            SELECT
              (
                SELECT settled_at
                FROM round_results
                WHERE source = ?
                  AND instrument = ?
                  AND continuity_epoch = ?
                ORDER BY settled_at, id
                LIMIT 1
              ) AS earliest_settled_at,
              (
                SELECT settled_at
                FROM round_results
                WHERE source = ?
                  AND instrument = ?
                  AND continuity_epoch = ?
                ORDER BY settled_at DESC, id DESC
                LIMIT 1
              ) AS latest_settled_at
          `)
          .get(
            event.source,
            event.instrument,
            continuityEpoch,
            event.source,
            event.instrument,
            continuityEpoch,
          );
        coverage = {
          source: event.source,
          instrument: event.instrument,
          continuityEpoch,
          earliestSettledAt: row.earliest_settled_at,
          latestSettledAt: row.latest_settled_at,
        };
        coverageByStream.set(streamKey, coverage);
      }

      if (
        coverage.earliestSettledAt === null ||
        event.settledAt < coverage.earliestSettledAt
      ) {
        outcome.prehistory += 1;
        continue;
      }
      if (event.settledAt > coverage.latestSettledAt) {
        outcome.afterCoverage += 1;
        continue;
      }

      outcome.unknownWithinCoverage += 1;
      let group = outcome.missingGroups.get(streamKey);
      if (!group) {
        group = { ...coverage, events: [] };
        outcome.missingGroups.set(streamKey, group);
      }
      group.events.push(event);
    }

    return outcome;
  }

  #lateHistoricalGap(group, now) {
    const identities = group.events
      .map((event) =>
        event.externalRoundId === null
          ? `fingerprint:${event.fingerprint}`
          : `round:${event.externalRoundId}`,
      )
      .sort();
    return this.#normalizeGap(
      {
        source: group.source,
        instrument: group.instrument,
        reason: "late-history-within-coverage",
        incidentKey: `late-history\u0000${identities.join("\u0001")}`,
        detectedAt: now,
        from: group.earliestSettledAt,
        to: group.latestSettledAt,
        continuityEpoch: group.continuityEpoch,
        message:
          "Обнаружен ранее неизвестный исторический результат внутри сохранённой последовательности.",
        historicalResults: group.events.map((event) => ({
          fingerprint: event.fingerprint,
          externalRoundId: event.externalRoundId,
          settledAt: event.settledAt,
          resultNumber: event.resultNumber,
        })),
      },
      now,
    );
  }

  #normalizeGap(details, now) {
    if (!details || typeof details !== "object" || Array.isArray(details)) {
      throw new TypeError("gap details must be an object");
    }
    return {
      kind: "gap",
      source: asNonEmptyText(details.source, "buleto", "source"),
      instrument: asNonEmptyText(details.instrument, "default", "instrument"),
      message:
        details.message === undefined || details.message === null
          ? null
          : String(details.message),
      incidentKey:
        details.incidentKey === undefined || details.incidentKey === null
          ? null
          : asNonEmptyText(String(details.incidentKey), undefined, "incidentKey"),
      detectedAt: asTimestamp(
        details.detectedAt ?? details.observedAt,
        now,
        "detectedAt",
      ),
      detailsJson: serializeJson(details, "gap details"),
    };
  }

  #markGapInTransaction(
    incident,
    now,
    { deferPredictiveLeaderVoid = false } = {},
  ) {
    if (incident.incidentKey !== null) {
      const existing = this.sqlite
        .prepare(`
          SELECT *
          FROM incidents
          WHERE source = ? AND instrument = ? AND incident_key = ?
        `)
        .get(incident.source, incident.instrument, incident.incidentKey);
      if (existing) {
        const continuityEpoch = this.#continuityEpoch(
          incident.source,
          incident.instrument,
        );
        const predictiveLeaderEvaluationVoid = deferPredictiveLeaderVoid
          ? null
          : this.#voidUnresolvedPredictiveLeaderEvaluationsForGapInTransaction({
              source: incident.source,
              instrument: incident.instrument,
              incidentId: Number(existing.id),
              continuityEpoch,
              voidedAt: now,
            });
        const predictiveLeaderWarmTop1PaperVoid = deferPredictiveLeaderVoid
          || incident.source !== PREDICTIVE_SHADOW_FROZEN_STREAM.source
          || incident.instrument !== PREDICTIVE_SHADOW_FROZEN_STREAM.instrument
          ? null
          : this.#reconcilePredictiveLeaderWarmTop1PaperInTransaction(
              incident.source,
              incident.instrument,
              now,
            );
        return {
          row: existing,
          cycleId: existing.cycle_id == null ? null : Number(existing.cycle_id),
          duplicate: true,
          continuityEpoch,
          predictiveLeaderEvaluationVoid,
          predictiveLeaderVoid: deferPredictiveLeaderVoid
            ? null
            : this.#voidPredictiveLeaderPendingBetForGapInTransaction({
                source: incident.source,
                instrument: incident.instrument,
                incidentId: Number(existing.id),
                continuityEpoch,
                voidedAt: now,
              }),
          predictiveLeaderV7PaperVoid: deferPredictiveLeaderVoid
            ? null
            : this.#voidPredictiveLeaderV7PaperForGapInTransaction({
                source: incident.source,
                instrument: incident.instrument,
                incidentId: Number(existing.id),
                continuityEpoch,
                voidedAt: now,
              }),
          predictiveLeaderWarmTop1PaperVoid,
        };
      }
    }

    const cycleId = this.#activeCycleId(incident.source, incident.instrument);
    if (cycleId !== null) {
      this.sqlite
        .prepare(`
          UPDATE cycles
          SET
            status = 'invalid_gap',
            last_event_at = ?,
            completed_at = ?,
            survivor_number = NULL
          WHERE id = ? AND status = 'active'
        `)
        .run(incident.detectedAt, incident.detectedAt, cycleId);
    }

    const insertion = this.sqlite
      .prepare(`
        INSERT INTO incidents (
          kind,
          source,
          instrument,
          message,
          incident_key,
          detected_at,
          details_json,
          cycle_id,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        incident.kind,
        incident.source,
        incident.instrument,
        incident.message,
        incident.incidentKey,
        incident.detectedAt,
        incident.detailsJson,
        cycleId,
        now,
      );
    this.#invalidateVirtualBettorForGap(
      incident.source,
      incident.instrument,
      incident.detectedAt,
    );
    this.#invalidateFollowerTop5SessionForGap(
      incident.source,
      incident.instrument,
      incident.detectedAt,
    );
    const continuityEpoch = this.#advanceContinuityEpoch(
      incident.source,
      incident.instrument,
    );
    const incidentId = Number(insertion.lastInsertRowid);
    const predictiveLeaderEvaluationVoid = deferPredictiveLeaderVoid
      ? null
      : this.#voidUnresolvedPredictiveLeaderEvaluationsForGapInTransaction({
          source: incident.source,
          instrument: incident.instrument,
          incidentId,
          continuityEpoch,
          voidedAt: now,
        });
    const predictiveLeaderWarmTop1PaperVoid = deferPredictiveLeaderVoid
      || incident.source !== PREDICTIVE_SHADOW_FROZEN_STREAM.source
      || incident.instrument !== PREDICTIVE_SHADOW_FROZEN_STREAM.instrument
      ? null
      : this.#reconcilePredictiveLeaderWarmTop1PaperInTransaction(
          incident.source,
          incident.instrument,
          now,
        );
    return {
      row: this.sqlite
        .prepare("SELECT * FROM incidents WHERE id = ?")
        .get(incidentId),
      cycleId,
      duplicate: false,
      continuityEpoch,
      predictiveLeaderEvaluationVoid,
      predictiveLeaderVoid: deferPredictiveLeaderVoid
        ? null
        : this.#voidPredictiveLeaderPendingBetForGapInTransaction({
            source: incident.source,
            instrument: incident.instrument,
            incidentId,
            continuityEpoch,
            voidedAt: now,
          }),
      predictiveLeaderV7PaperVoid: deferPredictiveLeaderVoid
        ? null
        : this.#voidPredictiveLeaderV7PaperForGapInTransaction({
            source: incident.source,
            instrument: incident.instrument,
            incidentId,
            continuityEpoch,
            voidedAt: now,
          }),
      predictiveLeaderWarmTop1PaperVoid,
    };
  }

  #mapGapOutcome(outcome) {
    if (!outcome) return null;
    return {
      ...mapIncident(outcome.row),
      invalidatedCycle:
        outcome.cycleId === null ? null : this.#cycleById(outcome.cycleId),
      duplicate: outcome.duplicate,
    };
  }

  ingestBatch(events, { gapBefore = null, historicalEvents = [] } = {}) {
    this.#assertOpen();
    if (!Array.isArray(events)) {
      throw new TypeError("events must be an array");
    }
    if (!Array.isArray(historicalEvents)) {
      throw new TypeError("historicalEvents must be an array");
    }

    if (
      events.length === 0 &&
      historicalEvents.length === 0 &&
      gapBefore === null
    ) {
      return {
        received: 0,
        inserted: 0,
        duplicates: 0,
        results: [],
        completedCycles: [],
        state: this.getDashboardState(),
      };
    }

    const now = new Date().toISOString();
    const normalizedGap = gapBefore === null ? null : this.#normalizeGap(gapBefore, now);
    const normalizedEvents = events
      .map((event, index) => normalizeEvent(event, index, now))
      .sort(
        (left, right) =>
          left.settledAt.localeCompare(right.settledAt) ||
          left.observedAt.localeCompare(right.observedAt) ||
          left.inputIndex - right.inputIndex,
      );
    const normalizedHistoricalEvents = historicalEvents
      .map((event, index) => normalizeEvent(event, index, now))
      .sort(
        (left, right) =>
          left.settledAt.localeCompare(right.settledAt) ||
          left.observedAt.localeCompare(right.observedAt) ||
          left.inputIndex - right.inputIndex,
      );

    let transactionResult;
    try {
      transactionResult = this.#transaction(() => {
        const historicalOutcome = this.#classifyHistoricalEventsInTransaction(
          normalizedHistoricalEvents,
        );
        const gapOutcomes = [];
        if (normalizedGap !== null) {
          gapOutcomes.push(this.#markGapInTransaction(normalizedGap, now, {
            deferPredictiveLeaderVoid: true,
          }));
        } else {
          for (const group of historicalOutcome.missingGroups.values()) {
            gapOutcomes.push(
              this.#markGapInTransaction(this.#lateHistoricalGap(group, now), now, {
                deferPredictiveLeaderVoid: true,
              }),
            );
          }
        }
        const gapOutcome = gapOutcomes[0] ?? null;
        let duplicateCount = 0;
        let metadataConflictCount = 0;
        const insertedResults = [];
        const insertedResultRows = [];
        const completedCycleIds = [];
        const continuityEpochs = new Map();
        const insertResult = this.sqlite.prepare(`
          INSERT INTO round_results (
            source,
            instrument,
            settled_at,
            result_number,
            price,
            observed_at,
            external_round_id,
            raw_cell,
            fingerprint,
            raw_payload,
            continuity_epoch,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT DO NOTHING
        `);
        const storedForecastRoundMetadata = this.sqlite.prepare(`
          SELECT betting_closes_at
          FROM forecast_snapshots
          WHERE source = ? AND instrument = ? AND external_round_id = ?
          ORDER BY CASE WHEN horizon_seconds = 8 THEN 0 ELSE 1 END, id
          LIMIT 1
        `);
        const storedTrajectoryRoundMetadata = this.sqlite.prepare(`
          SELECT betting_closes_at
          FROM round_trajectories
          WHERE source = ? AND instrument = ? AND external_round_id = ?
          LIMIT 1
        `);

        for (const event of normalizedEvents) {
          const finalBettingClosesAt = bettingClosesAtFromSerializedPayload(
            event.rawPayload,
          );
          if (event.externalRoundId !== null && finalBettingClosesAt !== null) {
            const storedMetadata = [
              storedForecastRoundMetadata.get(
                event.source,
                event.instrument,
                event.externalRoundId,
              ),
              storedTrajectoryRoundMetadata.get(
                event.source,
                event.instrument,
                event.externalRoundId,
              ),
            ].find((metadata) => (
              metadata
              && metadata.betting_closes_at !== finalBettingClosesAt
            ));
            if (
              storedMetadata
            ) {
              const conflictCreatedAt = new Date(Math.max(
                Date.parse(now),
                Date.parse(event.observedAt),
              )).toISOString();
              metadataConflictCount += Number(
                this.#recordCurrentCellHorizonMetadataConflict({
                  source: event.source,
                  instrument: event.instrument,
                  externalRoundId: event.externalRoundId,
                  originalBettingClosesAt: storedMetadata.betting_closes_at,
                  observedBettingClosesAt: finalBettingClosesAt,
                  observedAt: event.observedAt,
                  createdAt: conflictCreatedAt,
                }),
              );
            }
          }
          const streamKey = `${event.source}\u0000${event.instrument}`;
          let continuityEpoch = continuityEpochs.get(streamKey);
          if (continuityEpoch === undefined) {
            continuityEpoch = this.#continuityEpoch(event.source, event.instrument);
            continuityEpochs.set(streamKey, continuityEpoch);
          }
          const insertion = insertResult.run(
            event.source,
            event.instrument,
            event.settledAt,
            event.resultNumber,
            event.price,
            event.observedAt,
            event.externalRoundId,
            event.rawCell,
            event.fingerprint,
            event.rawPayload,
            continuityEpoch,
            now,
          );

          if (Number(insertion.changes) === 0) {
            duplicateCount += 1;
            const existing = this.sqlite
              .prepare(`
                SELECT *
                FROM round_results
                WHERE fingerprint = ?
                   OR (
                     ? IS NOT NULL
                     AND source = ?
                     AND instrument = ?
                     AND external_round_id = ?
                   )
                ORDER BY CASE WHEN fingerprint = ? THEN 0 ELSE 1 END
                LIMIT 1
              `)
              .get(
                event.fingerprint,
                event.externalRoundId,
                event.source,
                event.instrument,
                event.externalRoundId,
                event.fingerprint,
              );

            if (existing && event.externalRoundId !== null) {
              this.sqlite
                .prepare(`
                  UPDATE round_results
                  SET
                    external_round_id = COALESCE(external_round_id, ?),
                    raw_cell = COALESCE(?, raw_cell),
                    raw_payload = COALESCE(?, raw_payload)
                  WHERE id = ?
                `)
                .run(
                  event.externalRoundId,
                  event.rawCell,
                  event.rawPayload,
                  Number(existing.id),
                );
            }
            continue;
          }

          const resultId = Number(insertion.lastInsertRowid);
          let cycleId = this.#activeCycleId(event.source, event.instrument);
          if (cycleId === null) {
            cycleId = this.#createCycle(
              event.source,
              event.instrument,
              event.origin,
              event.settledAt,
              now,
            );
          }

          const transition = eliminateNumber(
            this.#remainingNumbers(cycleId),
            event.resultNumber,
          );

          if (transition.eliminated) {
            this.sqlite
              .prepare(`
                UPDATE cycle_numbers
                SET eliminated_at = ?, eliminated_by_result_id = ?
                WHERE cycle_id = ? AND number = ? AND eliminated_at IS NULL
              `)
              .run(event.settledAt, resultId, cycleId, event.resultNumber);
          }

          this.sqlite
            .prepare(`
              INSERT INTO cycle_events (
                cycle_id,
                round_result_id,
                result_number,
                eliminated,
                remaining_count,
                occurred_at,
                created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `)
            .run(
              cycleId,
              resultId,
              event.resultNumber,
              transition.eliminated ? 1 : 0,
              transition.remainingCount,
              event.settledAt,
              now,
            );

          this.sqlite
            .prepare("UPDATE round_results SET cycle_id = ? WHERE id = ?")
            .run(cycleId, resultId);

          if (transition.completed) {
            this.sqlite
              .prepare(`
                UPDATE cycles
                SET
                  status = 'completed',
                  last_event_at = ?,
                  completed_at = ?,
                  survivor_number = ?,
                  event_count = event_count + 1,
                  eliminated_count = eliminated_count + ?
                WHERE id = ? AND status = 'active'
              `)
              .run(
                event.settledAt,
                event.settledAt,
                transition.survivorNumber,
                transition.eliminated ? 1 : 0,
                cycleId,
              );
            completedCycleIds.push(cycleId);
          } else {
            this.sqlite
              .prepare(`
                UPDATE cycles
                SET
                  last_event_at = ?,
                  event_count = event_count + 1,
                  eliminated_count = eliminated_count + ?
                WHERE id = ? AND status = 'active'
              `)
              .run(
                event.settledAt,
                transition.eliminated ? 1 : 0,
                cycleId,
              );
          }

          const storedRow = this.sqlite
            .prepare(`
              SELECT
                rr.*,
                ce.eliminated AS was_new,
                ce.remaining_count AS remaining_after
              FROM round_results AS rr
              LEFT JOIN cycle_events AS ce ON ce.round_result_id = rr.id
              WHERE rr.id = ?
            `)
            .get(resultId);
          this.#processVirtualBettorResult(storedRow, now);
          this.#processVirtualWindowBettorResult(storedRow, now);
          insertedResultRows.push(storedRow);
          insertedResults.push(mapRoundResult(storedRow));
        }

        this.#processFollowerTop5TrackerBatch(insertedResultRows, now);

        for (const outcome of gapOutcomes) {
          outcome.predictiveLeaderEvaluationVoid =
            this.#voidUnresolvedPredictiveLeaderEvaluationsForGapInTransaction({
              source: outcome.row.source,
              instrument: outcome.row.instrument,
              incidentId: Number(outcome.row.id),
              continuityEpoch: outcome.continuityEpoch,
              voidedAt: now,
            });
          outcome.predictiveLeaderVoid =
            this.#voidPredictiveLeaderPendingBetForGapInTransaction({
              source: outcome.row.source,
              instrument: outcome.row.instrument,
              incidentId: Number(outcome.row.id),
              continuityEpoch: outcome.continuityEpoch,
              voidedAt: now,
            });
          outcome.predictiveLeaderV7PaperVoid =
            this.#voidPredictiveLeaderV7PaperForGapInTransaction({
              source: outcome.row.source,
              instrument: outcome.row.instrument,
              incidentId: Number(outcome.row.id),
              continuityEpoch: outcome.continuityEpoch,
              voidedAt: now,
            });
          outcome.predictiveLeaderWarmTop1PaperVoid =
            outcome.row.source === PREDICTIVE_SHADOW_FROZEN_STREAM.source
              && outcome.row.instrument === PREDICTIVE_SHADOW_FROZEN_STREAM.instrument
              ? this.#reconcilePredictiveLeaderWarmTop1PaperInTransaction(
                  outcome.row.source,
                  outcome.row.instrument,
                  now,
                )
              : null;
        }

        return {
          received: events.length,
          inserted: insertedResults.length,
          duplicates: duplicateCount,
          results: insertedResults,
          completedCycleIds,
          gapOutcome,
          gapOutcomes,
          historicalOutcome,
          metadataConflictCount,
        };
      });
    } catch (error) {
      emitLog(
        this.logger,
        "error",
        { error, received: events.length },
        "roulette batch ingestion failed",
      );
      throw error;
    }

    const completedCycles = transactionResult.completedCycleIds.map((cycleId) =>
      this.#cycleById(cycleId),
    );
    const response = {
      received: transactionResult.received,
      inserted: transactionResult.inserted,
      duplicates: transactionResult.duplicates,
      results: transactionResult.results,
      completedCycles,
      gap: this.#mapGapOutcome(transactionResult.gapOutcome),
      gaps: transactionResult.gapOutcomes.map((outcome) =>
        this.#mapGapOutcome(outcome),
      ),
      historical: {
        received: transactionResult.historicalOutcome.received,
        known: transactionResult.historicalOutcome.known,
        enriched: transactionResult.historicalOutcome.enriched,
        prehistory: transactionResult.historicalOutcome.prehistory,
        unknownWithinCoverage:
          transactionResult.historicalOutcome.unknownWithinCoverage,
        afterCoverage: transactionResult.historicalOutcome.afterCoverage,
      },
      metadataConflictCount: transactionResult.metadataConflictCount,
      databaseChanged:
        transactionResult.inserted > 0
        || transactionResult.metadataConflictCount > 0
        || transactionResult.gapOutcomes.length > 0,
      state: this.getDashboardState(),
    };

    emitLog(
      this.logger,
      "info",
      {
        received: response.received,
        inserted: response.inserted,
        duplicates: response.duplicates,
      },
      "roulette batch ingested",
    );

    return response;
  }

  ingestBatchAfterGap(details, events, { historicalEvents = [] } = {}) {
    return this.ingestBatch(events, { gapBefore: details, historicalEvents });
  }

  getDashboardState() {
    this.#assertOpen();
    const activeRows = this.sqlite
      .prepare(`
        SELECT *
        FROM cycles
        WHERE status = 'active'
        ORDER BY last_event_at DESC, id DESC
      `)
      .all();
    const activeCycles = activeRows.map((row) => this.#hydrateCycle(row));
    const completedRow = this.sqlite
      .prepare(`
        SELECT *
        FROM cycles
        WHERE status = 'completed'
        ORDER BY completed_at DESC, id DESC
        LIMIT 1
      `)
      .get();
    const latestCycleRow = this.sqlite
      .prepare(`
        SELECT *
        FROM cycles
        ORDER BY last_event_at DESC, id DESC
        LIMIT 1
      `)
      .get();
    const latestResultRow = this.sqlite
      .prepare(`
        SELECT
          rr.*,
          ce.eliminated AS was_new,
          ce.remaining_count AS remaining_after
        FROM round_results AS rr
        LEFT JOIN cycle_events AS ce ON ce.round_result_id = rr.id
        ORDER BY rr.settled_at DESC, rr.id DESC
        LIMIT 1
      `)
      .get();
    const recentIncidentRows = this.sqlite
      .prepare(`
        SELECT incidents.*
        FROM incidents
        WHERE NOT EXISTS (
          SELECT 1
          FROM incident_resolutions
          WHERE incident_resolutions.incident_id = incidents.id
        )
        ORDER BY incidents.detected_at DESC, incidents.id DESC
        LIMIT 10
      `)
      .all();
    const totals = this.sqlite
      .prepare(`
        SELECT
          (SELECT COUNT(*) FROM round_results) AS results,
          (SELECT COUNT(*) FROM cycles) AS cycles,
          (SELECT COUNT(*) FROM cycles WHERE status = 'completed') AS completed_cycles,
          (SELECT COUNT(*) FROM cycles WHERE status = 'invalid_gap') AS invalid_cycles,
          (SELECT COUNT(*) FROM incidents) AS incidents
      `)
      .get();

    return {
      activeCycle: activeCycles[0] ?? null,
      activeCycles,
      latestCycle: this.#hydrateCycle(latestCycleRow),
      latestCompletedCycle: this.#hydrateCycle(completedRow),
      latestResult: mapRoundResult(latestResultRow),
      recentIncidents: recentIncidentRows.map(mapIncident),
      totals: {
        results: Number(totals.results),
        cycles: Number(totals.cycles),
        completedCycles: Number(totals.completed_cycles),
        invalidCycles: Number(totals.invalid_cycles),
        incidents: Number(totals.incidents),
      },
    };
  }

  getLatestResult(source = "buleto", instrument = "default") {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const row = this.sqlite
      .prepare(`
        SELECT
          rr.*,
          ce.eliminated AS was_new,
          ce.remaining_count AS remaining_after
        FROM round_results AS rr
        LEFT JOIN cycle_events AS ce ON ce.round_result_id = rr.id
        WHERE rr.source = ? AND rr.instrument = ?
        ORDER BY rr.settled_at DESC, rr.id DESC
        LIMIT 1
      `)
      .get(safeSource, safeInstrument);
    return mapRoundResult(row);
  }

  getNumberStats(source = "buleto", instrument = "default") {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const rows = this.sqlite
      .prepare(`
        WITH ordered AS (
          SELECT
            result_number,
            settled_at,
            ROW_NUMBER() OVER (ORDER BY settled_at, id) AS position,
            COUNT(*) OVER () AS total_rounds
          FROM round_results
          WHERE source = ? AND instrument = ?
        )
        SELECT
          result_number,
          COUNT(*) AS occurrence_count,
          MAX(settled_at) AS last_seen_at,
          MAX(total_rounds) - MAX(position) AS rounds_since_last
        FROM ordered
        GROUP BY result_number
        ORDER BY result_number
      `)
      .all(safeSource, safeInstrument);
    const byNumber = new Map(rows.map((row) => [Number(row.result_number), row]));

    return ROULETTE_NUMBERS.map((number) => {
      const row = byNumber.get(number);
      return {
        number,
        occurrenceCount: row ? Number(row.occurrence_count) : 0,
        lastSeenAt: row?.last_seen_at ?? null,
        roundsSinceLast: row ? Number(row.rounds_since_last) : null,
      };
    });
  }

  #followerTop5GatedAccount(
    source,
    instrument,
    trackerStatus,
    currentContinuityEpoch,
  ) {
    const resultRevision = this.sqlite
      .prepare(`
        SELECT
          COUNT(*) AS row_count,
          MAX(id) AS maximum_id,
          MAX(settled_at) AS latest_at,
          SUM(continuity_epoch) AS epoch_checksum
        FROM round_results
        WHERE source = ? AND instrument = ?
      `)
      .get(source, instrument);
    const sessionRevision = this.sqlite
      .prepare(`
        SELECT
          COUNT(*) AS row_count,
          MAX(id) AS maximum_id,
          MAX(last_event_at) AS latest_at,
          SUM(attempt_count) AS attempt_checksum,
          SUM(miss_count) AS miss_checksum
        FROM follower_top5_sessions
        WHERE source = ? AND instrument = ?
      `)
      .get(source, instrument);
    const attemptRevision = this.sqlite
      .prepare(`
        SELECT COUNT(*) AS row_count, MAX(attempts.id) AS maximum_id
        FROM follower_top5_attempts AS attempts
        JOIN follower_top5_sessions AS sessions ON sessions.id = attempts.session_id
        WHERE sessions.source = ? AND sessions.instrument = ?
      `)
      .get(source, instrument);
    const depositRevision = this.sqlite
      .prepare(`
        SELECT
          COUNT(*) AS row_count,
          MAX(id) AS maximum_id,
          SUM(amount) AS amount_checksum,
          MAX(deposited_at) AS latest_at
        FROM follower_top5_gated_account_deposits
        WHERE source = ? AND instrument = ?
      `)
      .get(source, instrument);
    const cacheKey = `${source}\u0000${instrument}`;
    const signature = [
      Number(resultRevision.row_count),
      resultRevision.maximum_id == null ? null : Number(resultRevision.maximum_id),
      resultRevision.latest_at,
      Number(resultRevision.epoch_checksum ?? 0),
      Number(sessionRevision.row_count),
      sessionRevision.maximum_id == null ? null : Number(sessionRevision.maximum_id),
      sessionRevision.latest_at,
      Number(sessionRevision.attempt_checksum ?? 0),
      Number(sessionRevision.miss_checksum ?? 0),
      Number(attemptRevision.row_count),
      attemptRevision.maximum_id == null ? null : Number(attemptRevision.maximum_id),
      Number(depositRevision.row_count),
      depositRevision.maximum_id == null ? null : Number(depositRevision.maximum_id),
      Number(depositRevision.amount_checksum ?? 0),
      depositRevision.latest_at,
      currentContinuityEpoch,
      trackerStatus,
    ].join(":");
    const cached = this.followerTop5GatedAccountCache.get(cacheKey);
    if (cached?.signature === signature) return cached.value;

    const rows = this.sqlite
      .prepare(`
        SELECT id, result_number, settled_at, continuity_epoch
        FROM round_results
        WHERE source = ? AND instrument = ?
        ORDER BY settled_at, id
      `)
      .all(source, instrument);
    const sessions = this.sqlite
      .prepare(`
        SELECT *
        FROM follower_top5_sessions
        WHERE source = ? AND instrument = ?
        ORDER BY id
      `)
      .all(source, instrument);
    const attempts = this.sqlite
      .prepare(`
        SELECT attempts.*
        FROM follower_top5_attempts AS attempts
        JOIN follower_top5_sessions AS sessions ON sessions.id = attempts.session_id
        WHERE sessions.source = ? AND sessions.instrument = ?
        ORDER BY attempts.id
      `)
      .all(source, instrument);
    const deposits = this.sqlite
      .prepare(`
        SELECT *
        FROM follower_top5_gated_account_deposits
        WHERE source = ? AND instrument = ?
        ORDER BY COALESCE(after_result_id, 0), id
      `)
      .all(source, instrument);
    const value = buildFollowerTop5GatedAccount(rows, sessions, attempts, {
      currentContinuityEpoch,
      trackerStatus,
      depositRows: deposits,
    });
    this.followerTop5GatedAccountCache.set(cacheKey, { signature, value });
    return value;
  }

  applyFollowerTop5GatedDeposit(
    source = "buleto",
    instrument = "default",
    {
      depositKey,
      amount,
      depositedAt = this.clock(),
    } = {},
  ) {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const safeDepositKey = asNonEmptyText(
      depositKey,
      undefined,
      "depositKey",
    );
    const safeAmount = Number(amount);
    if (!Number.isSafeInteger(safeAmount) || safeAmount <= 0) {
      throw new RangeError("amount must be a positive safe integer");
    }
    const safeDepositedAt = asTimestamp(
      depositedAt,
      undefined,
      "depositedAt",
    );

    const result = this.#transaction(() => {
      const existing = this.sqlite
        .prepare(`
          SELECT *
          FROM follower_top5_gated_account_deposits
          WHERE source = ? AND instrument = ? AND deposit_key = ?
        `)
        .get(safeSource, safeInstrument, safeDepositKey);
      if (existing) {
        if (Number(existing.amount) !== safeAmount) {
          throw new Error("follower Top-5 deposit key has a different amount");
        }
        return { applied: false, row: existing };
      }

      const boundary = this.sqlite
        .prepare(`
          SELECT MAX(id) AS result_id
          FROM round_results
          WHERE source = ? AND instrument = ?
        `)
        .get(safeSource, safeInstrument);
      const afterResultId = boundary.result_id == null
        ? null
        : Number(boundary.result_id);
      const insert = this.sqlite
        .prepare(`
          INSERT INTO follower_top5_gated_account_deposits (
            source, instrument, deposit_key, amount, after_result_id,
            deposited_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          safeSource,
          safeInstrument,
          safeDepositKey,
          safeAmount,
          afterResultId,
          safeDepositedAt,
          safeDepositedAt,
        );
      const row = this.sqlite
        .prepare(`
          SELECT *
          FROM follower_top5_gated_account_deposits
          WHERE id = ?
        `)
        .get(Number(insert.lastInsertRowid));
      return { applied: true, row };
    });
    this.followerTop5GatedAccountCache.delete(
      `${safeSource}\u0000${safeInstrument}`,
    );
    return {
      applied: result.applied,
      depositKey: result.row.deposit_key,
      amount: Number(result.row.amount),
      afterResultId: result.row.after_result_id == null
        ? null
        : Number(result.row.after_result_id),
      depositedAt: result.row.deposited_at,
    };
  }

  getFollowerTop5TrackerState(source = "buleto", instrument = "default") {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const liveRow = this.sqlite
      .prepare(`
        SELECT
          sessions.*,
          anchor.result_number AS anchor_result_number,
          anchor.settled_at AS anchor_settled_at,
          anchor.external_round_id AS anchor_external_round_id
        FROM follower_top5_sessions AS sessions
        JOIN round_results AS anchor ON anchor.id = sessions.anchor_result_id
        WHERE sessions.source = ?
          AND sessions.instrument = ?
          AND sessions.status = 'active'
        ORDER BY sessions.id DESC
        LIMIT 1
      `)
      .get(safeSource, safeInstrument);
    const lastCompletedRow = this.sqlite
      .prepare(`
        SELECT
          sessions.*,
          anchor.result_number AS anchor_result_number,
          anchor.settled_at AS anchor_settled_at,
          result.result_number AS hit_number,
          result.settled_at AS hit_settled_at
        FROM follower_top5_sessions AS sessions
        JOIN round_results AS anchor ON anchor.id = sessions.anchor_result_id
        JOIN round_results AS result ON result.id = sessions.completed_result_id
        WHERE sessions.source = ?
          AND sessions.instrument = ?
          AND sessions.status = 'completed'
          AND sessions.end_reason = 'hit'
        ORDER BY sessions.id DESC
        LIMIT 1
      `)
      .get(safeSource, safeInstrument);
    const lastAttemptRow = this.sqlite
      .prepare(`
        SELECT
          attempts.*,
          sessions.top_numbers_json,
          sessions.anchor_number
        FROM follower_top5_attempts AS attempts
        JOIN follower_top5_sessions AS sessions ON sessions.id = attempts.session_id
        WHERE sessions.source = ? AND sessions.instrument = ?
        ORDER BY attempts.id DESC
        LIMIT 1
      `)
      .get(safeSource, safeInstrument);
    const lifetime = this.sqlite
      .prepare(`
        SELECT
          COUNT(DISTINCT sessions.id) AS total_sessions,
          COUNT(DISTINCT CASE WHEN sessions.status = 'completed' THEN sessions.id END)
            AS completed_sessions,
          COUNT(DISTINCT CASE WHEN sessions.status = 'invalid_gap' THEN sessions.id END)
            AS invalidated_sessions,
          COUNT(attempts.id) AS tracked_rounds,
          COALESCE(SUM(CASE WHEN attempts.outcome = 'hit' THEN 1 ELSE 0 END), 0)
            AS hits,
          COALESCE(SUM(CASE WHEN attempts.outcome = 'miss' THEN 1 ELSE 0 END), 0)
            AS misses
        FROM follower_top5_sessions AS sessions
        LEFT JOIN follower_top5_attempts AS attempts ON attempts.session_id = sessions.id
        WHERE sessions.source = ? AND sessions.instrument = ?
      `)
      .get(safeSource, safeInstrument);
    const epochShape = this.sqlite
      .prepare(`
        SELECT
          state.continuity_epoch AS current_epoch,
          (
            SELECT continuity_epoch
            FROM round_results
            WHERE source = state.source AND instrument = state.instrument
            ORDER BY settled_at DESC, id DESC
            LIMIT 1
          ) AS latest_result_epoch
        FROM stream_state AS state
        WHERE state.source = ? AND state.instrument = ?
      `)
      .get(safeSource, safeInstrument);

    const attemptRows = liveRow
      ? this.sqlite
        .prepare(`
          SELECT *
          FROM follower_top5_attempts
          WHERE session_id = ?
          ORDER BY attempt_number DESC
          LIMIT 101
        `)
        .all(Number(liveRow.id))
      : [];
    const visibleAttemptRows = attemptRows.slice(0, 100).reverse();
    const mapAttempt = (row) => row
      ? {
          attemptNumber: Number(row.attempt_number),
          resultId: Number(row.round_result_id),
          resultNumber: Number(row.result_number),
          outcome: row.outcome,
          hitRank: row.hit_rank == null ? null : Number(row.hit_rank),
          settledAt: row.occurred_at,
        }
      : null;
    const fixedNumbers = liveRow
      ? deserializeJson(liveRow.top_numbers_json)
      : null;
    const currentSession = liveRow
      ? {
          id: Number(liveRow.id),
          continuityEpoch: Number(liveRow.continuity_epoch),
          sourceNumber: Number(liveRow.anchor_number),
          fixedNumbers: Array.isArray(fixedNumbers) ? fixedNumbers.map(Number) : [],
          anchor: {
            resultId: Number(liveRow.anchor_result_id),
            number: Number(liveRow.anchor_result_number),
            externalRoundId: liveRow.anchor_external_round_id ?? null,
            settledAt: liveRow.anchor_settled_at,
          },
          lockedAt: liveRow.locked_at,
          sampleSize: Number(liveRow.sample_size),
          observedFollowerCount: Number(liveRow.observed_follower_count),
          attemptCount: Number(liveRow.attempt_count),
          missCount: Number(liveRow.miss_count),
          nextAttemptNumber: Number(liveRow.attempt_count) + 1,
          attempts: visibleAttemptRows.map(mapAttempt),
          attemptsTruncated: attemptRows.length > visibleAttemptRows.length,
        }
      : null;
    const completedTopNumbers = lastCompletedRow
      ? deserializeJson(lastCompletedRow.top_numbers_json)
      : null;
    const gapWaiting =
      epochShape
      && epochShape.latest_result_epoch != null
      && Number(epochShape.current_epoch) !== Number(epochShape.latest_result_epoch);
    const trackerStatus = currentSession
      ? currentSession.attemptCount > 0 ? "active" : "armed"
      : gapWaiting ? "gap" : "waiting_training";
    const gatedAccount = this.#followerTop5GatedAccount(
      safeSource,
      safeInstrument,
      trackerStatus,
      epochShape?.current_epoch == null
        ? null
        : Number(epochShape.current_epoch),
    );

    return {
      schemaVersion: 1,
      algorithmVersion: FOLLOWER_TOP5_LIVE_ALGORITHM_VERSION,
      mode: "simulation",
      executionEnabled: false,
      trackingMode: "persisted-batch-aware",
      topCount: FOLLOWER_TOP5_COUNT,
      minimumObservedFollowerCount: FOLLOWER_TOP5_MINIMUM_OBSERVED,
      status: trackerStatus,
      currentSession,
      lastCompletedSession: lastCompletedRow
        ? {
            id: Number(lastCompletedRow.id),
            sourceNumber: Number(lastCompletedRow.anchor_number),
            fixedNumbers: Array.isArray(completedTopNumbers)
              ? completedTopNumbers.map(Number)
              : [],
            attemptCount: Number(lastCompletedRow.attempt_count),
            missCount: Number(lastCompletedRow.miss_count),
            hitNumber: Number(lastCompletedRow.hit_number),
            hitRank: deserializeJson(lastCompletedRow.top_numbers_json)
              .map(Number)
              .indexOf(Number(lastCompletedRow.hit_number)) + 1,
            completedAt: lastCompletedRow.hit_settled_at,
          }
        : null,
      lastAttempt: lastAttemptRow
        ? {
            ...mapAttempt(lastAttemptRow),
            sessionId: Number(lastAttemptRow.session_id),
            sourceNumber: Number(lastAttemptRow.anchor_number),
            fixedNumbers: deserializeJson(lastAttemptRow.top_numbers_json).map(Number),
          }
        : null,
      lifetime: {
        totalSessions: Number(lifetime.total_sessions),
        completedSessions: Number(lifetime.completed_sessions),
        invalidatedSessions: Number(lifetime.invalidated_sessions),
        trackedRounds: Number(lifetime.tracked_rounds),
        hits: Number(lifetime.hits),
        misses: Number(lifetime.misses),
      },
      gatedAccount,
    };
  }

  initializeVirtualWindowBettor(source = "buleto", instrument = "default") {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const now = new Date().toISOString();
    this.#transaction(() => {
      this.#armVirtualWindowBettorInTransaction(
        safeSource,
        safeInstrument,
        now,
      );
    });
    return this.getVirtualWindowBettorState(safeSource, safeInstrument);
  }

  getVirtualWindowBetSessions(
    source = "buleto",
    instrument = "default",
    limit = 20,
  ) {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const safeLimit = normalizedLimit(limit, 20);
    return this.sqlite
      .prepare(`
        SELECT
          sessions.*,
          (
            SELECT MIN(bets.occurred_at)
            FROM virtual_window_bets AS bets
            WHERE bets.session_id = sessions.id
          ) AS started_at
        FROM virtual_window_bet_sessions AS sessions
        WHERE sessions.source = ? AND sessions.instrument = ?
        ORDER BY sessions.id DESC
        LIMIT ?
      `)
      .all(safeSource, safeInstrument, safeLimit)
      .map(mapVirtualBetSession);
  }

  getVirtualWindowBettorState(source = "buleto", instrument = "default") {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const now = new Date().toISOString();
    const bankroll = this.#transaction(() =>
      this.#ensureVirtualWindowBankrollInTransaction(
        safeSource,
        safeInstrument,
        now,
      ),
    );
    const epochRow = this.sqlite
      .prepare(`
        SELECT continuity_epoch
        FROM stream_state
        WHERE source = ? AND instrument = ?
      `)
      .get(safeSource, safeInstrument);
    const continuityEpoch = Number(epochRow?.continuity_epoch ?? 0);
    const liveRow = this.#liveVirtualWindowSessionRow(safeSource, safeInstrument);
    const recentRows = this.sqlite
      .prepare(`
        SELECT
          sessions.*,
          (
            SELECT MIN(bets.occurred_at)
            FROM virtual_window_bets AS bets
            WHERE bets.session_id = sessions.id
          ) AS started_at
        FROM virtual_window_bet_sessions AS sessions
        WHERE sessions.source = ?
          AND sessions.instrument = ?
          AND sessions.status IN ('completed', 'invalid_gap')
        ORDER BY sessions.id DESC
        LIMIT 10
      `)
      .all(safeSource, safeInstrument);
    const latestOutcomeRow = this.sqlite
      .prepare(`
        SELECT
          bets.id AS bet_id,
          bets.round_result_id,
          bets.session_id,
          bets.attempt_number,
          bets.stake,
          bets.result_number,
          bets.outcome,
          bets.gross_payout,
          bets.total_staked_after,
          bets.net_after,
          bets.next_stake_after,
          bets.recovery_possible,
          bets.occurred_at,
          sessions.target_number,
          results.external_round_id
        FROM virtual_window_bets AS bets
        JOIN virtual_window_bet_sessions AS sessions ON sessions.id = bets.session_id
        JOIN round_results AS results ON results.id = bets.round_result_id
        WHERE sessions.source = ? AND sessions.instrument = ?
        ORDER BY bets.id DESC
        LIMIT 1
      `)
      .get(safeSource, safeInstrument);
    const lifetime = this.sqlite
      .prepare(`
        SELECT
          COUNT(DISTINCT sessions.id) AS total_sessions,
          COUNT(DISTINCT CASE WHEN sessions.status = 'completed' THEN sessions.id END)
            AS completed_sessions,
          COUNT(DISTINCT CASE WHEN sessions.status = 'invalid_gap' THEN sessions.id END)
            AS invalidated_sessions,
          COUNT(bets.id) AS total_bets,
          COALESCE(SUM(CASE WHEN bets.outcome = 'hit' THEN 1 ELSE 0 END), 0)
            AS winning_bets,
          COALESCE(SUM(CASE WHEN bets.outcome = 'miss' THEN 1 ELSE 0 END), 0)
            AS losing_bets,
          COALESCE(SUM(bets.stake), 0) AS total_staked,
          COALESCE(SUM(bets.gross_payout), 0) AS gross_payout
        FROM virtual_window_bet_sessions AS sessions
        LEFT JOIN virtual_window_bets AS bets ON bets.session_id = sessions.id
        WHERE sessions.source = ? AND sessions.instrument = ?
      `)
      .get(safeSource, safeInstrument);
    const totalStaked = Number(lifetime.total_staked);
    const grossPayout = Number(lifetime.gross_payout);
    const invalidGapSessions = Number(
      this.sqlite
        .prepare(`
          SELECT COUNT(*) AS count
          FROM virtual_window_bet_sessions
          WHERE source = ? AND instrument = ?
            AND (status = 'invalid_gap' OR end_reason = 'integrity_gap')
        `)
        .get(safeSource, safeInstrument).count,
    );
    const longestCandidates = this.#longestVirtualCandidates(
      safeSource,
      safeInstrument,
      continuityEpoch,
      null,
      VIRTUAL_WINDOW_BET_MODEL.triggerThreshold,
    );
    const longestCandidate = longestCandidates[0] ?? null;
    const nextStake = liveRow
      ? Number(liveRow.next_stake)
      : bankroll.status === 'exhausted'
        ? Number(bankroll.next_stake)
        : VIRTUAL_WINDOW_BET_MODEL.initialStake;
    const initialBalance = Number(bankroll.initial_balance);
    const currentBalance = Number(bankroll.current_balance);
    return {
      mode: 'simulation',
      executionEnabled: false,
      strategyKey: VIRTUAL_WINDOW_BET_MODEL.strategyKey,
      modelVersion: VIRTUAL_WINDOW_BET_MODEL.modelVersion,
      status: liveRow?.status
        ?? (bankroll.status === 'exhausted' ? 'bankroll_exhausted' : 'waiting'),
      triggerThreshold: VIRTUAL_WINDOW_BET_MODEL.triggerThreshold,
      stopThreshold: VIRTUAL_WINDOW_BET_MODEL.stopThreshold,
      model: { ...VIRTUAL_WINDOW_BET_MODEL },
      testBank: {
        mode: 'simulation',
        status: bankroll.status,
        initialBalance,
        currentBalance,
        netResult: currentBalance - initialBalance,
        nextStake,
        canAffordNext: currentBalance >= nextStake,
        shortfall: Math.max(0, nextStake - currentBalance),
        startedAt: bankroll.started_at,
        exhaustedAt: bankroll.exhausted_at ?? null,
        dataComplete: invalidGapSessions === 0,
      },
      longestCandidate,
      longestCandidates,
      activeSession: mapVirtualBetSession(liveRow),
      latestOutcome: mapVirtualBetOutcome(latestOutcomeRow),
      recentSessions: recentRows.map(mapVirtualBetSession),
      lifetime: {
        totalSessions: Number(lifetime.total_sessions),
        completedSessions: Number(lifetime.completed_sessions),
        invalidatedSessions: Number(lifetime.invalidated_sessions),
        totalBets: Number(lifetime.total_bets),
        winningBets: Number(lifetime.winning_bets),
        losingBets: Number(lifetime.losing_bets),
        totalStaked,
        grossPayout,
        netResult: grossPayout - totalStaked,
      },
    };
  }

  initializeVirtualBettor(source = "buleto", instrument = "default") {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const now = new Date().toISOString();
    this.#transaction(() => {
      this.#armVirtualBettorInTransaction(
        safeSource,
        safeInstrument,
        now,
      );
    });
    return this.getVirtualBettorState(safeSource, safeInstrument);
  }

  getVirtualBetSessions(
    source = "buleto",
    instrument = "default",
    limit = 20,
  ) {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const safeLimit = normalizedLimit(limit, 20);
    return this.sqlite
      .prepare(`
        SELECT
          sessions.*,
          (
            SELECT MIN(bets.occurred_at)
            FROM virtual_bets AS bets
            WHERE bets.session_id = sessions.id
          ) AS started_at
        FROM virtual_bet_sessions AS sessions
        WHERE sessions.source = ? AND sessions.instrument = ?
        ORDER BY sessions.id DESC
        LIMIT ?
      `)
      .all(safeSource, safeInstrument, safeLimit)
      .map(mapVirtualBetSession);
  }

  getVirtualBettorState(source = "buleto", instrument = "default") {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const bankroll = this.#transaction(() =>
      this.#ensureVirtualBankrollInTransaction(
        safeSource,
        safeInstrument,
        new Date().toISOString(),
      ),
    );
    const epochRow = this.sqlite
      .prepare(`
        SELECT continuity_epoch
        FROM stream_state
        WHERE source = ? AND instrument = ?
      `)
      .get(safeSource, safeInstrument);
    const continuityEpoch = Number(epochRow?.continuity_epoch ?? 0);
    const liveRow = this.#liveVirtualBetSessionRow(safeSource, safeInstrument);
    const recentRows = this.sqlite
      .prepare(`
        SELECT
          sessions.*,
          (
            SELECT MIN(bets.occurred_at)
            FROM virtual_bets AS bets
            WHERE bets.session_id = sessions.id
          ) AS started_at
        FROM virtual_bet_sessions AS sessions
        WHERE sessions.source = ?
          AND sessions.instrument = ?
          AND sessions.status IN ('completed', 'invalid_gap')
        ORDER BY sessions.id DESC
        LIMIT 10
      `)
      .all(safeSource, safeInstrument);
    const latestOutcomeRow = this.sqlite
      .prepare(`
        SELECT
          bets.id AS bet_id,
          bets.round_result_id,
          bets.session_id,
          bets.attempt_number,
          bets.stake,
          bets.result_number,
          bets.outcome,
          bets.gross_payout,
          bets.total_staked_after,
          bets.net_after,
          bets.next_stake_after,
          bets.recovery_possible,
          bets.occurred_at,
          sessions.target_number,
          results.external_round_id
        FROM virtual_bets AS bets
        JOIN virtual_bet_sessions AS sessions ON sessions.id = bets.session_id
        JOIN round_results AS results ON results.id = bets.round_result_id
        WHERE sessions.source = ? AND sessions.instrument = ?
        ORDER BY bets.id DESC
        LIMIT 1
      `)
      .get(safeSource, safeInstrument);
    const lifetime = this.sqlite
      .prepare(`
        SELECT
          COUNT(DISTINCT sessions.id) AS total_sessions,
          COUNT(DISTINCT CASE WHEN sessions.status = 'completed' THEN sessions.id END)
            AS completed_sessions,
          COUNT(DISTINCT CASE WHEN sessions.status = 'invalid_gap' THEN sessions.id END)
            AS invalidated_sessions,
          COUNT(bets.id) AS total_bets,
          COALESCE(SUM(CASE WHEN bets.outcome = 'hit' THEN 1 ELSE 0 END), 0)
            AS winning_bets,
          COALESCE(SUM(CASE WHEN bets.outcome = 'miss' THEN 1 ELSE 0 END), 0)
            AS losing_bets,
          COALESCE(SUM(bets.stake), 0) AS total_staked,
          COALESCE(SUM(bets.gross_payout), 0) AS gross_payout
        FROM virtual_bet_sessions AS sessions
        LEFT JOIN virtual_bets AS bets ON bets.session_id = sessions.id
        WHERE sessions.source = ? AND sessions.instrument = ?
      `)
      .get(safeSource, safeInstrument);
    const totalStaked = Number(lifetime.total_staked);
    const grossPayout = Number(lifetime.gross_payout);
    const invalidGapSessions = Number(
      this.sqlite
        .prepare(`
          SELECT COUNT(*) AS count
          FROM virtual_bet_sessions
          WHERE source = ?
            AND instrument = ?
            AND (
              status = 'invalid_gap'
              OR end_reason = 'integrity_gap'
            )
        `)
        .get(safeSource, safeInstrument).count,
    );
    const nextStake = liveRow
      ? Number(liveRow.next_stake)
      : bankroll.status === "exhausted"
        ? Number(bankroll.next_stake)
        : VIRTUAL_BET_MODEL.initialStake;
    const initialBalance = Number(bankroll.initial_balance);
    const currentBalance = Number(bankroll.current_balance);
    const longestCandidates = this.#longestVirtualCandidates(
      safeSource,
      safeInstrument,
      continuityEpoch,
    );

    return {
      mode: "simulation",
      executionEnabled: false,
      status:
        liveRow?.status ??
        (bankroll.status === "exhausted" ? "bankroll_exhausted" : "waiting"),
      triggerThreshold: VIRTUAL_BET_MODEL.triggerThreshold,
      model: { ...VIRTUAL_BET_MODEL },
      testBank: {
        mode: "simulation",
        status: bankroll.status,
        initialBalance,
        currentBalance,
        netResult: currentBalance - initialBalance,
        nextStake,
        canAffordNext: currentBalance >= nextStake,
        shortfall: Math.max(0, nextStake - currentBalance),
        startedAt: bankroll.started_at,
        exhaustedAt: bankroll.exhausted_at ?? null,
        dataComplete: invalidGapSessions === 0,
      },
      longestCandidate: longestCandidates[0] ?? null,
      longestCandidates,
      activeSession: mapVirtualBetSession(liveRow),
      latestOutcome: mapVirtualBetOutcome(latestOutcomeRow),
      recentSessions: recentRows.map(mapVirtualBetSession),
      lifetime: {
        totalSessions: Number(lifetime.total_sessions),
        completedSessions: Number(lifetime.completed_sessions),
        invalidatedSessions: Number(lifetime.invalidated_sessions),
        totalBets: Number(lifetime.total_bets),
        winningBets: Number(lifetime.winning_bets),
        losingBets: Number(lifetime.losing_bets),
        totalStaked,
        grossPayout,
        netResult: grossPayout - totalStaked,
      },
    };
  }

  getRepeatedTriples(
    source = "buleto",
    instrument = "default",
    limit = 20,
  ) {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const safeLimit = normalizedLimit(limit);
    return this.sqlite
      .prepare(`
        WITH ordered AS (
          SELECT
            result_number AS first_number,
            LEAD(result_number, 1) OVER stream_order AS second_number,
            LEAD(result_number, 2) OVER stream_order AS third_number,
            LEAD(settled_at, 2) OVER stream_order AS occurred_at
          FROM round_results
          WHERE source = ? AND instrument = ?
          WINDOW stream_order AS (
            PARTITION BY continuity_epoch
            ORDER BY settled_at, id
          )
        )
        SELECT
          first_number,
          second_number,
          third_number,
          COUNT(*) AS occurrence_count,
          MIN(occurred_at) AS first_occurred_at,
          MAX(occurred_at) AS last_occurred_at
        FROM ordered
        WHERE second_number IS NOT NULL AND third_number IS NOT NULL
        GROUP BY first_number, second_number, third_number
        HAVING COUNT(*) >= 2
        ORDER BY
          occurrence_count DESC,
          last_occurred_at DESC,
          first_number,
          second_number,
          third_number
        LIMIT ?
      `)
      .all(safeSource, safeInstrument, safeLimit)
      .map((row) => ({
        numbers: [
          Number(row.first_number),
          Number(row.second_number),
          Number(row.third_number),
        ],
        occurrenceCount: Number(row.occurrence_count),
        firstOccurredAt: row.first_occurred_at,
        lastOccurredAt: row.last_occurred_at,
      }));
  }

  getCurrentTripleFollowerSignal(
    source = "buleto",
    instrument = "default",
  ) {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const latestRows = this.sqlite
      .prepare(`
        SELECT id, result_number, settled_at, continuity_epoch
        FROM round_results
        WHERE source = ? AND instrument = ?
        ORDER BY settled_at DESC, id DESC
        LIMIT 2
      `)
      .all(safeSource, safeInstrument);
    const currentRow = latestRows[0] ?? null;
    const responseBase = {
      schemaVersion: TRIPLE_FOLLOWER_SCHEMA_VERSION,
      algorithmVersion: TRIPLE_FOLLOWER_ALGORITHM_VERSION,
      definition: TRIPLE_FOLLOWER_DEFINITION,
      tieBreak: TRIPLE_FOLLOWER_TIE_BREAK,
      historyThroughResultId: currentRow === null ? null : Number(currentRow.id),
      historyThrough: currentRow?.settled_at ?? null,
      anchor: null,
      sampleSize: 0,
      observedFollowerCount: 0,
      candidates: [],
    };

    if (currentRow === null) {
      return { ...responseBase, status: "empty" };
    }

    const previousRow = latestRows[1] ?? null;
    if (
      previousRow === null ||
      Number(previousRow.continuity_epoch) !== Number(currentRow.continuity_epoch)
    ) {
      return { ...responseBase, status: "waiting_anchor" };
    }

    const anchor = {
      continuityEpoch: Number(currentRow.continuity_epoch),
      previous: {
        resultId: Number(previousRow.id),
        number: Number(previousRow.result_number),
        settledAt: previousRow.settled_at,
      },
      current: {
        resultId: Number(currentRow.id),
        number: Number(currentRow.result_number),
        settledAt: currentRow.settled_at,
      },
    };
    const rows = this.sqlite
      .prepare(`
        WITH bounded AS (
          SELECT id, result_number, settled_at, continuity_epoch
          FROM round_results
          WHERE source = ?
            AND instrument = ?
            AND (
              settled_at < ?
              OR (settled_at = ? AND id <= ?)
            )
        ), ordered AS (
          SELECT
            result_number AS first_number,
            LEAD(result_number, 1) OVER stream_order AS second_number,
            LEAD(result_number, 2) OVER stream_order AS follower_number,
            LEAD(settled_at, 2) OVER stream_order AS follower_occurred_at
          FROM bounded
          WINDOW stream_order AS (
            PARTITION BY continuity_epoch
            ORDER BY settled_at, id
          )
        )
        SELECT
          follower_number,
          COUNT(*) AS occurrence_count,
          MAX(follower_occurred_at) AS last_occurred_at
        FROM ordered
        WHERE first_number = ?
          AND second_number = ?
          AND follower_number IS NOT NULL
        GROUP BY follower_number
        ORDER BY
          occurrence_count DESC,
          last_occurred_at DESC,
          follower_number
      `)
      .all(
        safeSource,
        safeInstrument,
        currentRow.settled_at,
        currentRow.settled_at,
        Number(currentRow.id),
        Number(previousRow.result_number),
        Number(currentRow.result_number),
      );
    const sampleSize = rows.reduce(
      (total, row) => total + Number(row.occurrence_count),
      0,
    );
    const candidates = rows.map((row, index) => ({
      rank: index + 1,
      number: Number(row.follower_number),
      occurrenceCount: Number(row.occurrence_count),
      share: Number(row.occurrence_count) / sampleSize,
      lastOccurredAt: row.last_occurred_at,
    }));

    return {
      ...responseBase,
      status: sampleSize > 0 ? "ready" : "no_samples",
      anchor,
      sampleSize,
      observedFollowerCount: candidates.length,
      candidates,
    };
  }

  getPairStats(source = "buleto", instrument = "default") {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    return this.sqlite
      .prepare(`
        WITH ordered AS (
          SELECT
            result_number AS first_number,
            LEAD(result_number, 1) OVER stream_order AS second_number,
            LEAD(settled_at, 1) OVER stream_order AS occurred_at
          FROM round_results
          WHERE source = ? AND instrument = ?
          WINDOW stream_order AS (
            PARTITION BY continuity_epoch
            ORDER BY settled_at, id
          )
        )
        SELECT
          first_number,
          second_number,
          COUNT(*) AS occurrence_count,
          MIN(occurred_at) AS first_occurred_at,
          MAX(occurred_at) AS last_occurred_at
        FROM ordered
        WHERE second_number IS NOT NULL
        GROUP BY first_number, second_number
        ORDER BY
          occurrence_count DESC,
          last_occurred_at DESC,
          first_number,
          second_number
      `)
      .all(safeSource, safeInstrument)
      .map((row) => ({
        numbers: [Number(row.first_number), Number(row.second_number)],
        occurrenceCount: Number(row.occurrence_count),
        firstOccurredAt: row.first_occurred_at,
        lastOccurredAt: row.last_occurred_at,
      }));
  }

  getFollowerTop5HitCurve(source = "buleto", instrument = "default") {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const revision = this.sqlite
      .prepare(`
        SELECT
          COUNT(*) AS result_count,
          MAX(id) AS maximum_result_id,
          MAX(continuity_epoch) AS maximum_continuity_epoch,
          SUM(continuity_epoch) AS continuity_epoch_checksum
        FROM round_results
        WHERE source = ? AND instrument = ?
      `)
      .get(safeSource, safeInstrument);
    const streamState = this.sqlite
      .prepare(`
        SELECT continuity_epoch
        FROM stream_state
        WHERE source = ? AND instrument = ?
      `)
      .get(safeSource, safeInstrument);
    const currentContinuityEpoch = streamState?.continuity_epoch == null
      ? null
      : Number(streamState.continuity_epoch);
    const cacheKey = `${safeSource}\u0000${safeInstrument}`;
    const signature = [
      Number(revision.result_count),
      revision.maximum_result_id == null ? null : Number(revision.maximum_result_id),
      revision.maximum_continuity_epoch == null
        ? null
        : Number(revision.maximum_continuity_epoch),
      revision.continuity_epoch_checksum == null
        ? null
        : Number(revision.continuity_epoch_checksum),
      currentContinuityEpoch,
    ].join(":");
    const cached = this.followerTop5HitCurveCache.get(cacheKey);
    if (cached?.signature === signature) {
      return cached.value;
    }
    const rows = this.sqlite
      .prepare(`
        SELECT id, result_number, settled_at, continuity_epoch
        FROM round_results
        WHERE source = ? AND instrument = ?
        ORDER BY settled_at, id
      `)
      .all(safeSource, safeInstrument);

    const value = buildFollowerTop5HitCurve(rows, { currentContinuityEpoch });
    this.followerTop5HitCurveCache.set(cacheKey, { signature, value });
    return value;
  }

  #recordCurrentCellHorizonMetadataConflict({
    source,
    instrument,
    externalRoundId,
    originalBettingClosesAt,
    observedBettingClosesAt,
    observedAt,
    createdAt,
  }) {
    if (originalBettingClosesAt === observedBettingClosesAt) {
      return false;
    }
    const inserted = Number(this.sqlite.prepare(`
      INSERT INTO predictive_shadow_round_metadata_conflicts (
        boundary_key, source, instrument, external_round_id, reason,
        original_betting_closes_at, observed_betting_closes_at,
        observed_at, created_at
      )
      SELECT
        boundaries.boundary_key,
        ?,
        ?,
        ?,
        'metadata_conflict',
        ?,
        ?,
        ?,
        ?
      FROM predictive_shadow_integrity_boundaries AS boundaries
      JOIN current_cell_horizon_shadow_cohorts AS cohorts
        ON cohorts.cohort_key = boundaries.current_cell_cohort_key
      WHERE boundaries.boundary_key = 'predictive-shadow-metadata-integrity-v1'
        AND cohorts.cohort_key = ?
        AND cohorts.source = ?
        AND cohorts.instrument = ?
        AND ? >= boundaries.started_at
        AND ? >= boundaries.started_at
      ON CONFLICT(boundary_key, source, instrument, external_round_id) DO NOTHING
    `).run(
      source,
      instrument,
      externalRoundId,
      originalBettingClosesAt,
      observedBettingClosesAt,
      observedAt,
      createdAt,
      CURRENT_CELL_HORIZON_SHADOW_COHORT_KEY,
      source,
      instrument,
      observedAt,
      createdAt,
    ).changes) === 1;
    const stored = inserted || Boolean(this.sqlite.prepare(`
      SELECT 1
      FROM predictive_shadow_round_metadata_conflicts
      WHERE boundary_key = 'predictive-shadow-metadata-integrity-v1'
        AND source = ? AND instrument = ? AND external_round_id = ?
    `).get(source, instrument, externalRoundId));
    if (stored) {
      this.#voidPredictiveLeaderV7PaperForMetadataConflictInTransaction({
        source,
        instrument,
        externalRoundId,
        voidedAt: createdAt,
      });
      if (
        source === PREDICTIVE_SHADOW_FROZEN_STREAM.source
        && instrument === PREDICTIVE_SHADOW_FROZEN_STREAM.instrument
      ) {
        this.#reconcilePredictiveLeaderWarmTop1PaperInTransaction(
          source,
          instrument,
          createdAt,
        );
      }
    }
    return inserted;
  }

  recordCurrentCellHorizonMetadataConflict(
    source = "buleto",
    instrument = "default",
    externalRoundId,
    originalBettingClosesAt,
    observedBettingClosesAt,
    observedAt,
  ) {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const safeRoundId = asNonEmptyText(
      externalRoundId,
      undefined,
      "externalRoundId",
    );
    const safeOriginalBettingClosesAt = asTimestamp(
      originalBettingClosesAt,
      undefined,
      "originalBettingClosesAt",
    );
    const safeObservedBettingClosesAt = asTimestamp(
      observedBettingClosesAt,
      undefined,
      "observedBettingClosesAt",
    );
    const createdAt = asTimestamp(
      this.clock(),
      undefined,
      "current-cell shadow void createdAt",
    );
    const safeObservedAt = asTimestamp(observedAt ?? createdAt, undefined, "observedAt");
    if (safeObservedAt > createdAt) {
      throw new RangeError("current-cell shadow conflict cannot be observed in the future");
    }
    return this.#transaction(() => {
      if (safeOriginalBettingClosesAt === safeObservedBettingClosesAt) {
        return { inserted: false, databaseChanged: false, reason: "metadata_matches" };
      }
      const inserted = this.#recordCurrentCellHorizonMetadataConflict({
        source: safeSource,
        instrument: safeInstrument,
        externalRoundId: safeRoundId,
        originalBettingClosesAt: safeOriginalBettingClosesAt,
        observedBettingClosesAt: safeObservedBettingClosesAt,
        observedAt: safeObservedAt,
        createdAt,
      });
      const stored = this.sqlite.prepare(`
        SELECT 1
        FROM predictive_shadow_round_metadata_conflicts
        WHERE boundary_key = 'predictive-shadow-metadata-integrity-v1'
          AND source = ? AND instrument = ?
          AND external_round_id = ?
      `).get(
        safeSource,
        safeInstrument,
        safeRoundId,
      );
      return {
        inserted,
        databaseChanged: inserted,
        reason: inserted
          ? "metadata_conflict_recorded"
          : stored
            ? "already_recorded"
            : "outside_prospective_boundary",
      };
    });
  }

  recordRoundTrajectory(event) {
    this.#assertOpen();
    const persistedAt = asTimestamp(
      this.clock(),
      undefined,
      "round trajectory persistedAt",
    );
    const input = normalizeRoundTrajectoryEvent(event, persistedAt);
    return this.#transaction(() => {
      let row = this.sqlite
        .prepare(`
          SELECT *
          FROM round_trajectories
          WHERE source = ? AND instrument = ? AND external_round_id = ?
          LIMIT 1
        `)
        .get(input.source, input.instrument, input.externalRoundId);
      let inserted = false;
      if (!row) {
        const insertion = this.sqlite
          .prepare(`
            INSERT INTO round_trajectories (
              schema_version, source, instrument, external_round_id,
              starts_at, betting_closes_at, betting_stops_at, round_ends_at,
              start_price, bottom_price, top_price, bands_json,
              first_received_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            ROUND_TRAJECTORY_SCHEMA_VERSION,
            input.source,
            input.instrument,
            input.externalRoundId,
            input.startsAt,
            input.bettingClosesAt,
            input.bettingStopsAt,
            input.roundEndsAt,
            input.startPrice,
            input.bottomPrice,
            input.topPrice,
            input.bandsJson,
            input.receivedAt,
            persistedAt,
          );
        row = this.sqlite
          .prepare("SELECT * FROM round_trajectories WHERE id = ?")
          .get(Number(insertion.lastInsertRowid));
        inserted = true;
      } else {
        const immutableValuesMatch =
          Number(row.schema_version) === ROUND_TRAJECTORY_SCHEMA_VERSION &&
          row.starts_at === input.startsAt &&
          row.betting_closes_at === input.bettingClosesAt &&
          row.betting_stops_at === input.bettingStopsAt &&
          row.round_ends_at === input.roundEndsAt &&
          Number(row.start_price) === input.startPrice &&
          Number(row.bottom_price) === input.bottomPrice &&
          Number(row.top_price) === input.topPrice &&
          row.bands_json === input.bandsJson;
        if (!immutableValuesMatch) {
          if (row.betting_closes_at !== input.bettingClosesAt) {
            const voidInserted = this.#recordCurrentCellHorizonMetadataConflict({
              source: row.source,
              instrument: row.instrument,
              externalRoundId: row.external_round_id,
              originalBettingClosesAt: row.betting_closes_at,
              observedBettingClosesAt: input.bettingClosesAt,
              observedAt: input.receivedAt,
              createdAt: persistedAt,
            });
            return {
              inserted: false,
              ticksInserted: 0,
              trajectoryId: Number(row.id),
              metadataConflict: true,
              voidInserted,
              databaseChanged: voidInserted,
            };
          }
          throw new RangeError("round trajectory immutable metadata mismatch");
        }
        if (input.receivedAt < row.first_received_at) {
          throw new RangeError(
            "round trajectory event predates the frozen first receipt",
          );
        }
      }

      const insertTick = this.sqlite.prepare(`
        INSERT INTO round_trajectory_ticks (
          trajectory_id, factor_at, price, received_at, created_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(trajectory_id, factor_at, price) DO NOTHING
      `);
      let ticksInserted = 0;
      for (const factor of input.factors) {
        ticksInserted += Number(
          insertTick.run(
            Number(row.id),
            factor.at,
            factor.price,
            factor.receivedAt,
            persistedAt,
          ).changes,
        );
      }
      return {
        inserted,
        trajectoryId: Number(row.id),
        ticksInserted,
      };
    });
  }

  recordCurrentCellHorizonShadow(
    source = "buleto",
    instrument = "default",
    externalRoundId,
    expectedBettingClosesAt,
  ) {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const safeRoundId = asNonEmptyText(
      externalRoundId,
      undefined,
      "externalRoundId",
    );
    const outcome = this.#transaction(() => {
      const cohort = mapCurrentCellHorizonCohort(this.sqlite.prepare(`
        SELECT *
        FROM current_cell_horizon_shadow_cohorts
        WHERE cohort_key = ?
      `).get(CURRENT_CELL_HORIZON_SHADOW_COHORT_KEY));
      if (!cohort) throw new Error("current-cell shadow cohort is invalid");
      const boundary = this.sqlite.prepare(`
        SELECT *
        FROM predictive_shadow_integrity_boundaries
        WHERE boundary_key = 'predictive-shadow-metadata-integrity-v1'
          AND current_cell_cohort_key = ?
      `).get(cohort.cohortKey);
      if (
        !boundary
        || boundary.policy_version !== "metadata-conflict-void-v1"
        || !Number.isSafeInteger(Number(boundary.first_trajectory_id))
        || Number(boundary.first_trajectory_id) < 1
        || boundary.started_at !== boundary.created_at
      ) {
        throw new Error("current-cell shadow v29 boundary is invalid");
      }
      if (safeSource !== cohort.source || safeInstrument !== cohort.instrument) {
        return { inserted: false, reason: "outside_frozen_stream", retryable: false };
      }
      const safeExpectedBettingClosesAt = asTimestamp(
        expectedBettingClosesAt,
        undefined,
        "expectedBettingClosesAt",
      );

      const trajectory = this.sqlite.prepare(`
        SELECT *
        FROM round_trajectories
        WHERE source = ? AND instrument = ? AND external_round_id = ?
        LIMIT 1
      `).get(safeSource, safeInstrument, safeRoundId);
      if (!trajectory) {
        return { inserted: false, reason: "trajectory_not_found", retryable: true };
      }
      const trajectoryId = Number(trajectory.id);
      if (
        trajectoryId < Number(boundary.first_trajectory_id)
        || trajectory.created_at < boundary.started_at
        || new Date(
          Date.parse(trajectory.betting_closes_at) - cohort.horizonSeconds * 1_000,
        ).toISOString() < boundary.started_at
      ) {
        return {
          inserted: false,
          reason: "outside_prospective_boundary",
          retryable: false,
        };
      }
      const existingVoid = this.sqlite.prepare(`
        SELECT 1
        FROM predictive_shadow_round_metadata_conflicts
        WHERE boundary_key = 'predictive-shadow-metadata-integrity-v1'
          AND source = ? AND instrument = ?
          AND external_round_id = ?
      `).get(safeSource, safeInstrument, safeRoundId);
      if (existingVoid) {
        return {
          inserted: false,
          reason: "metadata_conflict",
          retryable: false,
          voidInserted: false,
          databaseChanged: false,
        };
      }
      if (trajectory.betting_closes_at !== safeExpectedBettingClosesAt) {
        const conflictAt = asTimestamp(
          this.clock(),
          undefined,
          "current-cell shadow metadata conflict at",
        );
        const voidInserted = this.#recordCurrentCellHorizonMetadataConflict({
          source: safeSource,
          instrument: safeInstrument,
          externalRoundId: safeRoundId,
          originalBettingClosesAt: trajectory.betting_closes_at,
          observedBettingClosesAt: safeExpectedBettingClosesAt,
          observedAt: conflictAt,
          createdAt: conflictAt,
        });
        return {
          inserted: false,
          reason: "metadata_conflict",
          retryable: false,
          voidInserted,
          databaseChanged: voidInserted,
        };
      }
      const existing = this.sqlite.prepare(`
        SELECT trajectory_id
        FROM round_trajectory_current_cell_horizon_snapshots
        WHERE trajectory_id = ? AND cohort_key = ?
      `).get(trajectoryId, cohort.cohortKey);
      if (existing) {
        return { inserted: false, reason: "already_frozen", retryable: false };
      }

      const capturedAt = asTimestamp(
        this.clock(),
        undefined,
        "current-cell shadow capturedAt",
      );
      const closesMs = Date.parse(trajectory.betting_closes_at);
      const cutoffMs = closesMs - cohort.horizonSeconds * 1_000;
      const cutoffAt = new Date(cutoffMs).toISOString();
      const capturedMs = Date.parse(capturedAt);
      if (capturedMs < cutoffMs) {
        return { inserted: false, reason: "cutoff_not_reached", retryable: true };
      }
      if (
        capturedMs > cutoffMs + CURRENT_CELL_HORIZON_SHADOW_CONFIG.captureGraceMs
        || closesMs - capturedMs
          < CURRENT_CELL_HORIZON_SHADOW_CONFIG.minimumExecutionBufferMs
      ) {
        return { inserted: false, reason: "capture_window_missed", retryable: false };
      }
      const knownTarget = this.sqlite.prepare(`
        SELECT id
        FROM round_results
        WHERE source = ? AND instrument = ? AND external_round_id = ?
        LIMIT 1
      `).get(safeSource, safeInstrument, safeRoundId);
      if (knownTarget) {
        return { inserted: false, reason: "target_already_known", retryable: false };
      }

      const ticks = this.sqlite.prepare(`
        SELECT factor_at, received_at, created_at, price
        FROM round_trajectory_ticks
        WHERE trajectory_id = ?
          AND factor_at <= ?
          AND received_at <= ?
          AND created_at <= ?
        ORDER BY factor_at, received_at, created_at, id
      `).all(trajectoryId, cutoffAt, cutoffAt, cutoffAt).map((tick) => ({
        factorAt: tick.factor_at,
        receivedAt: tick.received_at,
        createdAt: tick.created_at,
        price: Number(tick.price),
      }));
      const snapshot = normalizeCurrentCellHorizonShadow(
        buildCurrentCellHorizonShadow({
          trajectoryId,
          source: safeSource,
          instrument: safeInstrument,
          cohortKey: cohort.cohortKey,
          externalRoundId: safeRoundId,
          bettingClosesAt: trajectory.betting_closes_at,
          capturedAt,
          bands: deserializeJson(trajectory.bands_json),
          ticks,
        }),
      );
      if (!snapshot) {
        throw new Error("current-cell shadow builder returned an invalid snapshot");
      }
      if (
        snapshot.status === "unavailable"
        && !["no_causal_tick", "ambiguous_latest_tick"].includes(snapshot.reason)
      ) {
        return { inserted: false, reason: snapshot.reason, retryable: false };
      }

      const commitCheckedAt = asTimestamp(
        this.clock(),
        undefined,
        "current-cell shadow commitCheckedAt",
      );
      const commitCheckedMs = Date.parse(commitCheckedAt);
      if (
        commitCheckedMs < capturedMs
        || closesMs - commitCheckedMs
          < CURRENT_CELL_HORIZON_SHADOW_CONFIG.minimumExecutionBufferMs
      ) {
        throw new RangeError(
          "current-cell shadow transaction must finish at least five seconds before betting closes",
        );
      }
      this.sqlite.prepare(`
        INSERT INTO round_trajectory_current_cell_horizon_snapshots (
          trajectory_id, cohort_key, schema_version, algorithm_version,
          config_version, config_sha256, status, reason, cutoff_at, captured_at,
          predicted_number, leader_wire_cell, leader_probability,
          runner_up_probability, margin, snapshot_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        trajectoryId,
        cohort.cohortKey,
        cohort.schemaVersion,
        cohort.algorithmVersion,
        cohort.configVersion,
        cohort.configSha256,
        snapshot.status,
        snapshot.reason,
        snapshot.cutoffAt,
        snapshot.capturedAt,
        snapshot.leaderNumber,
        snapshot.leaderWireCell,
        snapshot.leaderProbability,
        snapshot.runnerUpProbability,
        snapshot.margin,
        JSON.stringify(snapshot),
        commitCheckedAt,
      );
      return {
        inserted: true,
        reason: snapshot.status === "ready" ? "frozen" : snapshot.reason,
        retryable: false,
        trajectoryId,
        status: snapshot.status,
      };
    });
    return outcome;
  }

  settleCurrentCellHorizonShadows(
    source = "buleto",
    instrument = "default",
  ) {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const outcome = this.#transaction(() => {
      const rows = this.sqlite.prepare(`
        SELECT
          snapshots.*,
          trajectories.source,
          trajectories.instrument,
          trajectories.external_round_id,
          trajectories.betting_closes_at,
          results.id AS result_id,
          results.result_number,
          results.settled_at AS result_settled_at,
          results.observed_at AS result_observed_at,
          results.created_at AS result_created_at
        FROM round_trajectory_current_cell_horizon_snapshots AS snapshots
        JOIN round_trajectories AS trajectories
          ON trajectories.id = snapshots.trajectory_id
        JOIN predictive_shadow_integrity_boundaries AS boundaries
          ON boundaries.current_cell_cohort_key = snapshots.cohort_key
         AND boundaries.boundary_key = 'predictive-shadow-metadata-integrity-v1'
        JOIN round_results AS results
          ON results.source = trajectories.source
         AND results.instrument = trajectories.instrument
         AND results.external_round_id = trajectories.external_round_id
        LEFT JOIN round_trajectory_current_cell_horizon_evaluations AS evaluations
          ON evaluations.trajectory_id = snapshots.trajectory_id
         AND evaluations.cohort_key = snapshots.cohort_key
        LEFT JOIN predictive_shadow_round_metadata_conflicts AS voids
          ON voids.boundary_key = boundaries.boundary_key
         AND voids.source = trajectories.source
         AND voids.instrument = trajectories.instrument
         AND voids.external_round_id = trajectories.external_round_id
        WHERE trajectories.source = ?
          AND trajectories.instrument = ?
          AND snapshots.cohort_key = ?
          AND snapshots.status = 'ready'
          AND trajectories.id >= boundaries.first_trajectory_id
          AND trajectories.created_at >= boundaries.started_at
          AND evaluations.trajectory_id IS NULL
          AND voids.external_round_id IS NULL
        ORDER BY trajectories.betting_closes_at, snapshots.trajectory_id
      `).all(
        safeSource,
        safeInstrument,
        CURRENT_CELL_HORIZON_SHADOW_COHORT_KEY,
      );
      const insert = this.sqlite.prepare(`
        INSERT INTO round_trajectory_current_cell_horizon_evaluations (
          trajectory_id, cohort_key, round_result_id, actual_number, top1_hit,
          brier_loss, clipped_log_loss, evaluation_json, evaluated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      let settled = 0;
      for (const row of rows) {
        const snapshot = normalizeCurrentCellHorizonShadow(
          deserializeJson(row.snapshot_json),
        );
        const trajectoryId = Number(row.trajectory_id);
        const actualNumber = Number(row.result_number);
        const capturedMs = Date.parse(snapshot?.capturedAt);
        const resultTimes = [
          row.result_settled_at,
          row.result_observed_at,
          row.result_created_at,
        ].map(Date.parse);
        if (
          !snapshot
          || snapshot.status !== "ready"
          || snapshot.trajectoryId !== trajectoryId
          || snapshot.source !== row.source
          || snapshot.instrument !== row.instrument
          || snapshot.externalRoundId !== row.external_round_id
          || snapshot.bettingClosesAt !== row.betting_closes_at
          || snapshot.cohortKey !== row.cohort_key
          || !Number.isInteger(actualNumber)
          || actualNumber < 0
          || actualNumber > 36
          || !Number.isFinite(capturedMs)
          || resultTimes.some((time) => !Number.isFinite(time) || time <= capturedMs)
        ) {
          throw new Error("current-cell shadow settlement identity is invalid");
        }
        const evaluation = evaluateCurrentCellHorizonShadow(snapshot, actualNumber);
        const evaluatedAt = asTimestamp(
          this.clock(),
          undefined,
          "current-cell shadow evaluatedAt",
        );
        if (evaluatedAt < row.result_created_at) {
          throw new RangeError(
            "current-cell shadow evaluation cannot predate its result",
          );
        }
        settled += Number(insert.run(
          trajectoryId,
          row.cohort_key,
          Number(row.result_id),
          evaluation.actualNumber,
          Number(evaluation.top1Hit),
          evaluation.brierLoss,
          evaluation.clippedLogLoss,
          JSON.stringify(evaluation),
          evaluatedAt,
        ).changes);
      }
      return { settled };
    });
    return outcome;
  }

  #roundTrajectoryPrefix(
    trajectoryId,
    startsAt,
    cutoffAt,
    { createdBefore = null } = {},
  ) {
    const rows = this.sqlite
      .prepare(`
        SELECT id, factor_at, price, received_at, created_at
        FROM round_trajectory_ticks
        WHERE trajectory_id = ?
          AND factor_at <= ?
          AND received_at <= ?
          AND (? IS NULL OR created_at < ?)
        ORDER BY factor_at, received_at, id
      `)
      .all(
        trajectoryId,
        cutoffAt,
        cutoffAt,
        createdBefore,
        createdBefore,
      );
    return roundTrajectoryPrefixFromRows(rows, startsAt, cutoffAt);
  }

  #roundTrajectoryPrefixes(requests, { createdBefore = null } = {}) {
    if (requests.length === 0) return new Map();
    const requestByTrajectoryId = new Map();
    for (const request of requests) {
      const trajectoryId = Number(request.trajectoryId);
      if (requestByTrajectoryId.has(trajectoryId)) {
        throw new Error("round trajectory prefix batch contains a duplicate id");
      }
      requestByTrajectoryId.set(trajectoryId, request);
    }
    const requestJson = JSON.stringify(
      requests.map((request) => ({
        trajectoryId: Number(request.trajectoryId),
        cutoffAt: request.cutoffAt,
      })),
    );
    const rows = this.sqlite
      .prepare(`
        WITH requested AS (
          SELECT
            CAST(json_extract(value, '$.trajectoryId') AS INTEGER)
              AS trajectory_id,
            json_extract(value, '$.cutoffAt') AS cutoff_at
          FROM json_each(?)
        )
        SELECT
          ticks.trajectory_id,
          ticks.id,
          ticks.factor_at,
          ticks.price,
          ticks.received_at,
          ticks.created_at
        FROM requested
        JOIN round_trajectory_ticks AS ticks
          ON ticks.trajectory_id = requested.trajectory_id
        WHERE ticks.factor_at <= requested.cutoff_at
          AND ticks.received_at <= requested.cutoff_at
          AND (? IS NULL OR ticks.created_at < ?)
        ORDER BY ticks.trajectory_id, ticks.factor_at, ticks.received_at, ticks.id
      `)
      .all(requestJson, createdBefore, createdBefore);
    const rowsByTrajectoryId = new Map(
      requests.map((request) => [Number(request.trajectoryId), []]),
    );
    for (const row of rows) {
      rowsByTrajectoryId.get(Number(row.trajectory_id)).push(row);
    }
    return new Map(
      [...requestByTrajectoryId].map(([trajectoryId, request]) => [
        trajectoryId,
        roundTrajectoryPrefixFromRows(
          rowsByTrajectoryId.get(trajectoryId),
          request.startsAt,
          request.cutoffAt,
        ),
      ]),
    );
  }

  #buildForecastTrajectoryShadow({
    source,
    instrument,
    externalRoundId,
    bettingClosesAt,
    roundEndsAt,
    lockedAt,
    startPrice,
    cells,
  }) {
    const baseIntegration = {
      candidateLimit: TRAJECTORY_SHADOW_CANDIDATE_LIMIT,
      queriedCandidateCount: 0,
      usableHistoryCount: 0,
      excludedCoverageCount: 0,
      historyMaxResultId: null,
      historyCutoffAt: lockedAt,
      currentCoverage: null,
      learningLimit: TRAJECTORY_SHADOW_LEARNING_LIMIT,
      queriedLearningRowCount: 0,
      usableLearningRowCount: 0,
      excludedLearningRowCount: 0,
      adaptive: null,
      numberArea: null,
      displayRange: null,
      numberRanking: null,
    };
    const unavailableCurrent = (
      reason,
      {
        trajectoryId = null,
        lockPrice = null,
        medianCellWidth = null,
        currentPrefix = [],
        integration = baseIntegration,
      } = {},
    ) => ({
      modelVersion: TRAJECTORY_SHADOW_ADAPTIVE_VERSION,
      trajectoryId,
      status: "insufficient_current",
      reason,
      cutoffAt: lockedAt,
      lockPrice,
      medianCellWidth,
      direction: null,
      probabilities: null,
      expectedDeltaCellWidths: null,
      sample: null,
      nearestIds: [],
      parameters: { ...TRAJECTORY_SHADOW_ADAPTIVE_DEFAULTS },
      currentPrefix,
      integration,
    });

    const trajectory = this.sqlite
      .prepare(`
        SELECT *
        FROM round_trajectories
        WHERE source = ? AND instrument = ? AND external_round_id = ?
        LIMIT 1
      `)
      .get(source, instrument, externalRoundId);
    if (!trajectory) return unavailableCurrent("trajectory_not_found");

    const trajectoryId = Number(trajectory.id);
    const bands = deserializeJson(trajectory.bands_json);
    const forecastBandsJson = JSON.stringify(
      trajectoryBandsFromForecastCells(cells),
    );
    const medianCellWidth = Array.isArray(bands)
      ? trajectoryMedianCellWidth(bands)
      : null;
    if (
      trajectory.betting_closes_at !== bettingClosesAt ||
      trajectory.round_ends_at !== roundEndsAt ||
      Number(trajectory.start_price) !== startPrice ||
      trajectory.bands_json !== forecastBandsJson ||
      !Number.isFinite(medianCellWidth) ||
      medianCellWidth <= 0
    ) {
      return unavailableCurrent("trajectory_metadata_mismatch", {
        trajectoryId,
        medianCellWidth,
      });
    }

    const currentPrefix = this.#roundTrajectoryPrefix(
      trajectoryId,
      trajectory.starts_at,
      lockedAt,
    );
    const integration = {
      ...baseIntegration,
      currentCoverage: currentPrefix.coverage,
    };
    if (!currentPrefix.usable) {
      return unavailableCurrent(currentPrefix.reason, {
        trajectoryId,
        medianCellWidth,
        currentPrefix: currentPrefix.prefix,
        integration,
      });
    }

    const lockedMs = Date.parse(lockedAt);
    const secondsToEndMs = Date.parse(roundEndsAt) - lockedMs;
    const candidates = this.sqlite
      .prepare(`
        SELECT
          trajectories.*,
          results.id AS result_id,
          results.price AS result_price,
          results.settled_at AS result_settled_at,
          results.observed_at AS result_observed_at,
          results.created_at AS result_created_at,
          MAX(
            results.settled_at,
            results.observed_at,
            results.created_at
          ) AS completed_at
        FROM round_trajectories AS trajectories
        JOIN round_results AS results
          ON results.source = trajectories.source
         AND results.instrument = trajectories.instrument
         AND results.external_round_id = trajectories.external_round_id
        WHERE trajectories.source = ?
          AND trajectories.instrument = ?
          AND trajectories.id <> ?
          AND trajectories.created_at < ?
          AND results.price IS NOT NULL
          AND results.settled_at < ?
          AND results.observed_at < ?
          AND results.created_at < ?
        ORDER BY completed_at DESC, results.id DESC
        LIMIT ?
      `)
      .all(
        source,
        instrument,
        trajectoryId,
        lockedAt,
        lockedAt,
        lockedAt,
        lockedAt,
        TRAJECTORY_SHADOW_CANDIDATE_LIMIT,
      );

    const history = [];
    let excludedCoverageCount = 0;
    const candidateContexts = [];
    for (const candidate of candidates) {
      const cutoffMs = Date.parse(candidate.round_ends_at) - secondsToEndMs;
      const startsMs = Date.parse(candidate.starts_at);
      const endsMs = Date.parse(candidate.round_ends_at);
      if (!(cutoffMs > startsMs) || cutoffMs >= endsMs) {
        excludedCoverageCount += 1;
        continue;
      }
      const cutoffAt = new Date(cutoffMs).toISOString();
      candidateContexts.push({ candidate, cutoffAt });
    }
    const candidatePrefixes = this.#roundTrajectoryPrefixes(
      candidateContexts.map(({ candidate, cutoffAt }) => ({
        trajectoryId: Number(candidate.id),
        startsAt: candidate.starts_at,
        cutoffAt,
      })),
      { createdBefore: lockedAt },
    );
    for (const { candidate, cutoffAt } of candidateContexts) {
      const prefix = candidatePrefixes.get(Number(candidate.id));
      const candidateBands = deserializeJson(candidate.bands_json);
      const cellWidths = Array.isArray(candidateBands)
        ? candidateBands.map((band) => Number(band.upper) - Number(band.lower))
        : [];
      if (
        !prefix.usable ||
        cellWidths.length !== 38 ||
        cellWidths.some((width) => !Number.isFinite(width) || width <= 0)
      ) {
        excludedCoverageCount += 1;
        continue;
      }
      const completedAt = new Date(
        Math.max(
          Date.parse(candidate.result_settled_at),
          Date.parse(candidate.result_observed_at),
          Date.parse(candidate.result_created_at),
        ),
      ).toISOString();
      history.push({
        id: String(candidate.id),
        lockedAt: cutoffAt,
        completedAt,
        prefix: prefix.prefix,
        cellWidths,
        lockPrice: prefix.lockPrice,
        endPrice: Number(candidate.result_price),
      });
    }

    const learningCandidateStatement = this.sqlite.prepare(`
        SELECT
          shadows.forecast_id,
          shadows.status AS shadow_status,
          shadows.cutoff_at AS shadow_cutoff_at,
          shadows.lock_price,
          shadows.median_cell_width,
          shadows.direction,
          shadows.probabilities_json,
          shadows.expected_delta_cell_widths,
          shadows.sample_json,
          shadows.nearest_ids_json,
          shadows.parameters_json,
          shadows.current_prefix_json,
          shadows.integration_json,
          snapshots.locked_at,
          snapshots.current_price AS snapshot_current_price,
          snapshots.cells_json AS snapshot_cells_json,
          settlements.created_at AS settlement_created_at,
          results.price AS result_price,
          results.settled_at AS result_settled_at,
          results.observed_at AS result_observed_at,
          results.created_at AS result_created_at,
          MAX(
            results.settled_at,
            results.observed_at,
            results.created_at,
            settlements.created_at
          ) AS completed_at
        FROM forecast_trajectory_shadows AS shadows
        JOIN round_forecasts AS forecasts
          ON forecasts.id = shadows.forecast_id
        JOIN forecast_snapshots AS snapshots
          ON snapshots.id = forecasts.snapshot_id
        JOIN forecast_settlements AS settlements
          ON settlements.forecast_id = forecasts.id
        JOIN round_results AS results
          ON results.id = settlements.round_result_id
        WHERE snapshots.source = ?
          AND snapshots.instrument = ?
          AND shadows.model_version = ?
          AND shadows.status = 'ready'
          AND shadows.created_at < ?
          AND shadows.cutoff_at < ?
          AND forecasts.created_at < ?
          AND snapshots.locked_at < ?
          AND results.price IS NOT NULL
          AND settlements.settled_at < ?
          AND settlements.created_at < ?
          AND results.settled_at < ?
          AND results.observed_at < ?
          AND results.created_at < ?
        ORDER BY completed_at DESC, results.id DESC, shadows.forecast_id DESC
        LIMIT ?
      `);
    const rawLearningCandidates = learningCandidateStatement.all(
      source,
      instrument,
      TRAJECTORY_SHADOW_ADAPTIVE_VERSION,
      lockedAt,
      lockedAt,
      lockedAt,
      lockedAt,
      lockedAt,
      lockedAt,
      lockedAt,
      lockedAt,
      lockedAt,
      TRAJECTORY_SHADOW_LEARNING_CANDIDATE_LIMIT,
    );
    const learningCandidates = [];
    for (const candidate of rawLearningCandidates) {
      const valid = this.#validAdaptiveTrajectorySnapshotSql(
        candidate.shadow_status,
        candidate.shadow_cutoff_at,
        candidate.locked_at,
        candidate.lock_price,
        candidate.snapshot_current_price,
        candidate.median_cell_width,
        candidate.direction,
        candidate.probabilities_json,
        candidate.expected_delta_cell_widths,
        candidate.sample_json,
        candidate.nearest_ids_json,
        candidate.parameters_json,
        candidate.current_prefix_json,
        candidate.integration_json,
        candidate.snapshot_cells_json,
      );
      if (valid === 1) learningCandidates.push(candidate);
      if (learningCandidates.length >= TRAJECTORY_SHADOW_LEARNING_LIMIT) break;
    }
    const learningRows = [];
    let excludedLearningRowCount = 0;
    for (const candidate of learningCandidates) {
      const lockPrice = Number(candidate.lock_price);
      const candidateCellWidth = Number(candidate.median_cell_width);
      const actualPrice = Number(candidate.result_price);
      const integrationSnapshot = deserializeJson(candidate.integration_json);
      const completedMs = Date.parse(candidate.completed_at);
      const candidateLockedMs = Date.parse(candidate.locked_at);
      if (
        !Number.isFinite(lockPrice) ||
        !Number.isFinite(candidateCellWidth) ||
        candidateCellWidth <= 0 ||
        !Number.isFinite(actualPrice) ||
        !Number.isFinite(completedMs) ||
        !Number.isFinite(candidateLockedMs) ||
        candidateLockedMs >= completedMs ||
        !Array.isArray(integrationSnapshot?.adaptive?.experts)
      ) {
        excludedLearningRowCount += 1;
        continue;
      }
      learningRows.push({
        id: String(candidate.forecast_id),
        lockedAt: candidate.locked_at,
        completedAt: new Date(completedMs).toISOString(),
        actualDeltaCellWidths:
          (actualPrice - lockPrice) / candidateCellWidth,
        experts: integrationSnapshot.adaptive.experts,
      });
    }
    learningRows.sort(
      (left, right) =>
        Date.parse(left.completedAt) - Date.parse(right.completedAt) ||
        Date.parse(left.lockedAt) - Date.parse(right.lockedAt) ||
        left.id.localeCompare(right.id),
    );

    const result = predictAdaptiveTrajectoryShadow({
      current: {
        id: String(trajectoryId),
        lockedAt,
        prefix: currentPrefix.prefix,
        cellWidths: bands.map((band) => band.upper - band.lower),
      },
      history,
      learningRows,
    });
    const numberArea = result.status === "ready"
      ? buildTrajectoryNumberArea({
          bands,
          lockPrice: currentPrefix.lockPrice,
          medianCellWidth,
          deltaRangeCellWidths: result.deltaRangeCellWidths,
          direction: result.direction,
          flatThresholdCellWidths: result.parameters.flatThresholdCellWidths,
        })
      : null;
    const displayRange = numberArea === null
      ? null
      : buildTrajectoryDisplayRange(numberArea);
    const numberRanking = result.status === "ready"
      && result.adaptive.trainingCount >= TRAJECTORY_RANK37_MIN_TRAINING_COUNT
      ? buildTrajectoryRank37({
          bands,
          lockPrice: currentPrefix.lockPrice,
          medianCellWidth,
          adaptive: result.adaptive,
          tieSeed: lockedAt,
        })
      : null;
    return {
      modelVersion: result.version,
      trajectoryId,
      status: result.status,
      reason: result.status === "ready" ? null : result.status,
      cutoffAt: lockedAt,
      lockPrice: currentPrefix.lockPrice,
      medianCellWidth,
      direction: result.direction,
      probabilities: result.probabilities,
      expectedDeltaCellWidths: result.expectedDeltaCellWidths,
      sample: result.sample,
      nearestIds: result.nearestIds,
      parameters: result.parameters,
      currentPrefix: currentPrefix.prefix,
      integration: {
        ...integration,
        queriedCandidateCount: candidates.length,
        usableHistoryCount: history.length,
        excludedCoverageCount,
        historyMaxResultId:
          candidates.length === 0
            ? null
            : Math.max(...candidates.map((candidate) => Number(candidate.result_id))),
        queriedLearningRowCount: learningCandidates.length,
        usableLearningRowCount: learningRows.length,
        excludedLearningRowCount,
        adaptive: result.adaptive,
        numberArea,
        displayRange,
        numberRanking,
      },
    };
  }

  #insertForecastTrajectoryShadow(forecastId, shadow, createdAt) {
    this.sqlite
      .prepare(`
        INSERT INTO forecast_trajectory_shadows (
          forecast_id, trajectory_id, schema_version, model_version,
          status, reason, cutoff_at, lock_price, median_cell_width,
          direction, probabilities_json, expected_delta_cell_widths,
          sample_json, nearest_ids_json, parameters_json,
          current_prefix_json, integration_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        forecastId,
        shadow.trajectoryId,
        TRAJECTORY_SHADOW_SCHEMA_VERSION,
        shadow.modelVersion,
        shadow.status,
        shadow.reason,
        shadow.cutoffAt,
        shadow.lockPrice,
        shadow.medianCellWidth,
        shadow.direction,
        JSON.stringify(shadow.probabilities),
        shadow.expectedDeltaCellWidths,
        JSON.stringify(shadow.sample),
        JSON.stringify(shadow.nearestIds),
        JSON.stringify(shadow.parameters),
        JSON.stringify(shadow.currentPrefix),
        JSON.stringify(shadow.integration),
        createdAt,
      );
  }

  #storedTrajectoryShadowForPredictiveLeader(forecastId) {
    const row = this.sqlite
      .prepare(`
        SELECT status, model_version, cutoff_at, integration_json
        FROM forecast_trajectory_shadows
        WHERE forecast_id = ?
      `)
      .get(forecastId);
    if (!row) return null;
    const integration = deserializeJson(row.integration_json);
    if (!integration || typeof integration !== "object" || Array.isArray(integration)) {
      return null;
    }
    return {
      status: row.status,
      modelVersion: row.model_version,
      cutoffAt: row.cutoff_at,
      integration,
    };
  }

  #predictiveLeaderPriceSources(shadow, forecastId, lockedAt) {
    const adaptive = shadow?.integration?.adaptive;
    const numberRanking = shadow?.integration?.numberRanking;
    const displayRange = shadow?.integration?.displayRange;
    if (
      shadow?.status !== "ready"
      || shadow.modelVersion !== TRAJECTORY_SHADOW_ADAPTIVE_VERSION
      || shadow.cutoffAt !== lockedAt
      || !Number.isSafeInteger(adaptive?.trainingCount)
      || adaptive.trainingCount < TRAJECTORY_RANK37_MIN_TRAINING_COUNT
      || numberRanking?.version !== TRAJECTORY_RANK37_VERSION
      || numberRanking?.basis !== TRAJECTORY_RANK37_BASIS
      || numberRanking?.candidateCount !== 37
      || !Number.isSafeInteger(numberRanking?.evidenceCandidateCount)
      || numberRanking.evidenceCandidateCount
        < TRAJECTORY_RANK37_MIN_EVIDENCE_CANDIDATES
      || !Array.isArray(numberRanking.ranking)
      || numberRanking.ranking.length !== 37
      || !Array.isArray(displayRange?.cells)
    ) {
      return [];
    }

    const numbers = [];
    const rawWeights = [];
    const seen = new Set();
    for (let index = 0; index < numberRanking.ranking.length; index += 1) {
      const candidate = numberRanking.ranking[index];
      const number = Number(candidate?.number);
      const rawMass = Number(candidate?.rawMass);
      if (
        candidate?.rank !== index + 1
        || !Number.isInteger(number)
        || number < 0
        || number > 36
        || seen.has(number)
        || !Number.isFinite(rawMass)
        || rawMass < 0
        || rawMass > 1
      ) {
        return [];
      }
      seen.add(number);
      numbers.push(number);
      rawWeights.push(
        rawMass > TRAJECTORY_RANK37_EVIDENCE_MASS_THRESHOLD ? rawMass : 0,
      );
    }
    const evidenceTotal = rawWeights.reduce((total, weight) => total + weight, 0);
    if (!(evidenceTotal > 0)) return [];
    const range = displayRange.cells.map((cell) => {
      const wireCell = Number(cell?.wireCell);
      const number = Number(cell?.number);
      return Number.isInteger(wireCell)
        && wireCell >= 0
        && wireCell <= 37
        && Number.isInteger(number)
        && number === (wireCell === 37 ? 0 : wireCell)
        ? number
        : null;
    });
    if (
      range.length < 1
      || range.length > 6
      || range.some((number) => number === null)
      || new Set(range).size !== range.length
    ) {
      return [];
    }
    const cursor = { forecastId, cutoffAt: lockedAt };
    return [
      {
        id: "price-trajectory-rank37",
        family: "price",
        numbers,
        weights: rawWeights.map((weight) => weight / evidenceTotal),
        cursor,
      },
      {
        id: "price-trajectory-range",
        family: "price",
        mode: "set",
        numbers: range,
        cursor,
      },
    ];
  }

  #predictiveLeaderConditionalSources({
    source,
    instrument,
    externalRoundId,
    lockedAt,
  }) {
    const eligibility = `
      source = ?
      AND instrument = ?
      AND created_at <= ?
      AND observed_at <= ?
      AND settled_at < ?
    `;
    const historyMaxRow = this.sqlite
      .prepare(`
        SELECT MAX(id) AS max_result_id
        FROM round_results
        WHERE ${eligibility}
      `)
      .get(source, instrument, lockedAt, lockedAt, lockedAt);
    const historyMaxResultId = historyMaxRow?.max_result_id == null
      ? null
      : Number(historyMaxRow.max_result_id);
    if (historyMaxResultId === null) {
      return { historyMaxResultId: null, sources: [] };
    }

    const latestRows = this.sqlite
      .prepare(`
        SELECT id, result_number, settled_at, continuity_epoch, external_round_id
        FROM round_results
        WHERE ${eligibility}
        ORDER BY settled_at DESC, id DESC
        LIMIT 2
      `)
      .all(source, instrument, lockedAt, lockedAt, lockedAt);
    const current = latestRows[0] ?? null;
    const targetRoundId = numericRoundId(externalRoundId);
    const anchorRoundId = numericRoundId(current?.external_round_id);
    if (
      !current
      || targetRoundId === null
      || anchorRoundId === null
      || targetRoundId !== anchorRoundId + 1n
    ) {
      return { historyMaxResultId, sources: [] };
    }

    const anchorResultId = Number(current.id);
    const anchorNumber = Number(current.result_number);
    const continuityEpoch = Number(current.continuity_epoch);
    const sources = [];
    const pairRows = this.sqlite
      .prepare(`
        WITH eligible_results AS (
          SELECT id, result_number, settled_at, continuity_epoch
          FROM round_results
          WHERE ${eligibility}
        ), ordered AS (
          SELECT
            result_number AS first_number,
            LEAD(result_number, 1) OVER stream_order AS follower_number,
            LEAD(settled_at, 1) OVER stream_order AS follower_occurred_at
          FROM eligible_results
          WINDOW stream_order AS (
            PARTITION BY continuity_epoch
            ORDER BY settled_at, id
          )
        )
        SELECT
          follower_number,
          COUNT(*) AS occurrence_count,
          MAX(follower_occurred_at) AS last_occurred_at
        FROM ordered
        WHERE first_number = ? AND follower_number IS NOT NULL
        GROUP BY follower_number
        ORDER BY occurrence_count DESC, last_occurred_at DESC, follower_number
      `)
      .all(
        source,
        instrument,
        lockedAt,
        lockedAt,
        lockedAt,
        anchorNumber,
      );
    const pairSampleSize = pairRows.reduce(
      (total, row) => total + Number(row.occurrence_count),
      0,
    );
    if (pairSampleSize > 0) {
      sources.push({
        id: "conditional-pair-full",
        family: "conditional-history",
        numbers: pairRows.map((row) => Number(row.follower_number)),
        weights: pairRows.map((row) => Number(row.occurrence_count) / pairSampleSize),
        cursor: {
          historyMaxResultId,
          anchorResultId,
          continuityEpoch,
          cutoffAt: lockedAt,
          sampleSize: pairSampleSize,
        },
      });
    }

    const previous = latestRows[1] ?? null;
    if (previous && Number(previous.continuity_epoch) === continuityEpoch) {
      const previousNumber = Number(previous.result_number);
      const tripleRows = this.sqlite
        .prepare(`
          WITH eligible_results AS (
            SELECT id, result_number, settled_at, continuity_epoch
            FROM round_results
            WHERE ${eligibility}
          ), ordered AS (
            SELECT
              result_number AS first_number,
              LEAD(result_number, 1) OVER stream_order AS second_number,
              LEAD(result_number, 2) OVER stream_order AS follower_number,
              LEAD(settled_at, 2) OVER stream_order AS follower_occurred_at
            FROM eligible_results
            WINDOW stream_order AS (
              PARTITION BY continuity_epoch
              ORDER BY settled_at, id
            )
          )
          SELECT
            follower_number,
            COUNT(*) AS occurrence_count,
            MAX(follower_occurred_at) AS last_occurred_at
          FROM ordered
          WHERE first_number = ?
            AND second_number = ?
            AND follower_number IS NOT NULL
          GROUP BY follower_number
          ORDER BY occurrence_count DESC, last_occurred_at DESC, follower_number
        `)
        .all(
          source,
          instrument,
          lockedAt,
          lockedAt,
          lockedAt,
          previousNumber,
          anchorNumber,
        );
      const tripleSampleSize = tripleRows.reduce(
        (total, row) => total + Number(row.occurrence_count),
        0,
      );
      if (tripleSampleSize > 0) {
        sources.push({
          id: "conditional-triple-full",
          family: "conditional-history",
          numbers: tripleRows.map((row) => Number(row.follower_number)),
          weights: tripleRows.map(
            (row) => Number(row.occurrence_count) / tripleSampleSize,
          ),
          cursor: {
            historyMaxResultId,
            previousResultId: Number(previous.id),
            currentResultId: anchorResultId,
            continuityEpoch,
            cutoffAt: lockedAt,
            sampleSize: tripleSampleSize,
          },
        });
      }
    }

    const live = this.sqlite
      .prepare(`
        SELECT
          sessions.*,
          last_result.result_number AS last_attempt_result_number
        FROM follower_top5_sessions AS sessions
        LEFT JOIN round_results AS last_result
          ON last_result.id = sessions.last_attempt_result_id
        WHERE sessions.source = ?
          AND sessions.instrument = ?
          AND sessions.status IN ('armed', 'active')
        ORDER BY sessions.id DESC
        LIMIT 1
      `)
      .get(source, instrument);
    if (
      live
      && live.algorithm_version === FOLLOWER_TOP5_LIVE_ALGORITHM_VERSION
      && Number(live.continuity_epoch) === continuityEpoch
      && live.created_at <= lockedAt
      && live.locked_at <= lockedAt
      && live.last_event_at <= lockedAt
    ) {
      const attemptCount = Number(live.attempt_count);
      const aligned = attemptCount === 0
        ? Number(live.anchor_result_id) === anchorResultId
          && Number(live.anchor_number) === anchorNumber
        : Number(live.last_attempt_result_id) === anchorResultId
          && Number(live.last_attempt_result_number) === anchorNumber;
      const fixedNumbers = deserializeJson(live.top_numbers_json);
      if (
        aligned
        && Array.isArray(fixedNumbers)
        && fixedNumbers.length === FOLLOWER_TOP5_COUNT
        && fixedNumbers.every((number) => (
          Number.isInteger(Number(number))
          && Number(number) >= 0
          && Number(number) <= 36
        ))
        && new Set(fixedNumbers.map(Number)).size === FOLLOWER_TOP5_COUNT
      ) {
        sources.push({
          id: "conditional-live-fixed",
          family: "conditional-history",
          numbers: fixedNumbers.map(Number),
          cursor: {
            historyMaxResultId,
            sessionId: Number(live.id),
            continuityEpoch,
            cutoffAt: lockedAt,
            attemptCount,
          },
        });
      }
    }

    return { historyMaxResultId, sources };
  }

  #predictiveLeaderLearningRows(source, instrument, horizonSeconds, lockedAt) {
    const rows = this.sqlite
      .prepare(`
        SELECT
          leaders.forecast_id,
          leaders.schema_version,
          leaders.algorithm_version,
          leaders.status,
          leaders.locked_at AS leader_locked_at,
          leaders.training_count,
          leaders.predicted_number,
          leaders.score,
          leaders.snapshot_json,
          leaders.created_at AS leader_created_at,
          snapshots.locked_at,
          forecasts.created_at AS forecast_created_at,
          settlements.round_result_id,
          settlements.actual_number,
          settlements.settled_at,
          settlements.created_at AS settlement_created_at,
          results.observed_at AS result_observed_at,
          results.created_at AS result_created_at
        FROM forecast_predictive_leader_snapshots AS leaders
        JOIN round_forecasts AS forecasts ON forecasts.id = leaders.forecast_id
        JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
        JOIN forecast_settlements AS settlements
          ON settlements.forecast_id = leaders.forecast_id
        JOIN round_results AS results ON results.id = settlements.round_result_id
        WHERE snapshots.source = ?
          AND snapshots.instrument = ?
          AND snapshots.horizon_seconds = ?
          AND leaders.schema_version = ?
          AND leaders.algorithm_version = ?
          AND leaders.status = 'ready'
          AND leaders.created_at < ?
          AND leaders.locked_at < ?
          AND forecasts.created_at < ?
          AND snapshots.locked_at < ?
          AND settlements.settled_at < ?
          AND settlements.created_at < ?
          AND results.settled_at < ?
          AND results.observed_at < ?
          AND results.created_at < ?
        ORDER BY settlements.settled_at DESC, leaders.forecast_id DESC
        LIMIT ?
      `)
      .all(
        source,
        instrument,
        horizonSeconds,
        LEARNED_LEADER_SCHEMA_VERSION,
        LEARNED_LEADER_ALGORITHM_VERSION,
        lockedAt,
        lockedAt,
        lockedAt,
        lockedAt,
        lockedAt,
        lockedAt,
        lockedAt,
        lockedAt,
        lockedAt,
        LEARNED_LEADER_DEFAULTS.learningLimit,
      );
    const learningRows = [];
    const resultIdByForecastId = new Map();
    for (const row of rows) {
      const decision = normalizeLearnedLeaderDecision(
        deserializeJson(row.snapshot_json),
      );
      if (
        !decision
        || !validLearnedLeaderAudit(decision)
        || decision.status !== "ready"
        || decision.lockedAt !== row.leader_locked_at
        || decision.lockedAt !== row.locked_at
        || Number(row.schema_version) !== LEARNED_LEADER_SCHEMA_VERSION
        || row.algorithm_version !== LEARNED_LEADER_ALGORITHM_VERSION
        || Number(row.training_count) !== decision.learning.trainingCount
        || Number(row.predicted_number) !== decision.leaderNumber
        || Math.abs(Number(row.score) - decision.leaderMass) > 1e-12
      ) {
        continue;
      }
      const forecastId = Number(row.forecast_id);
      learningRows.push({
        id: String(forecastId),
        algorithmVersion: LEARNED_LEADER_ALGORITHM_VERSION,
        lockedAt: decision.lockedAt,
        completedAt: row.settled_at,
        actualNumber: Number(row.actual_number),
        familyDistributions: decision.familyDistributions,
      });
      resultIdByForecastId.set(String(forecastId), Number(row.round_result_id));
    }
    return { learningRows, resultIdByForecastId };
  }

  #predictiveLeaderPendingResultIsResolvable(
    forecastId,
    source,
    instrument,
  ) {
    const forecast = this.sqlite
      .prepare(`
        SELECT
          snapshots.external_round_id,
          snapshots.round_ends_at,
          settlements.forecast_id AS settlement_forecast_id
        FROM round_forecasts AS forecasts
        JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
        LEFT JOIN forecast_settlements AS settlements
          ON settlements.forecast_id = forecasts.id
        WHERE forecasts.id = ?
          AND snapshots.source = ?
          AND snapshots.instrument = ?
      `)
      .get(forecastId, source, instrument);
    if (!forecast) {
      throw new Error("predictive leader pending forecast cursor is invalid");
    }
    if (forecast.settlement_forecast_id !== null) return true;

    const exact = this.sqlite
      .prepare(`
        SELECT id
        FROM round_results
        WHERE source = ? AND instrument = ? AND external_round_id = ?
        LIMIT 1
      `)
      .get(source, instrument, forecast.external_round_id);
    if (exact) return true;

    const expectedEndMs = Date.parse(forecast.round_ends_at);
    if (!Number.isFinite(expectedEndMs)) return false;
    const anonymous = this.sqlite
      .prepare(`
        SELECT id
        FROM round_results
        WHERE source = ?
          AND instrument = ?
          AND external_round_id IS NULL
          AND settled_at >= ?
          AND settled_at <= ?
          AND NOT EXISTS (
            SELECT 1
            FROM forecast_settlements
            WHERE forecast_settlements.round_result_id = round_results.id
          )
        ORDER BY settled_at, id
        LIMIT 2
      `)
      .all(
        source,
        instrument,
        new Date(expectedEndMs - 3_000).toISOString(),
        new Date(expectedEndMs + 1_000).toISOString(),
      );
    if (anonymous.length !== 1) return false;
    const unsettledAtEnd = Number(
      this.sqlite
        .prepare(`
          SELECT COUNT(*) AS count
          FROM round_forecasts AS forecasts
          JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
          LEFT JOIN forecast_settlements AS settlements
            ON settlements.forecast_id = forecasts.id
          WHERE snapshots.source = ?
            AND snapshots.instrument = ?
            AND snapshots.round_ends_at = ?
            AND settlements.forecast_id IS NULL
        `)
        .get(source, instrument, forecast.round_ends_at).count,
    );
    return unsettledAtEnd === 1;
  }

  #voidUnresolvedPredictiveLeaderEvaluationsForGapInTransaction({
    source,
    instrument,
    incidentId,
    continuityEpoch,
    voidedAt,
  }) {
    const incident = this.sqlite.prepare(`
      SELECT
        incidents.*,
        incident_resolutions.incident_id AS resolved_incident_id
      FROM incidents
      LEFT JOIN incident_resolutions
        ON incident_resolutions.incident_id = incidents.id
      WHERE incidents.id = ?
        AND incidents.source = ?
        AND incidents.instrument = ?
        AND incidents.kind = 'gap'
    `).get(incidentId, source, instrument);
    if (!incident) {
      throw new Error("predictive leader evaluation void incident cursor is invalid");
    }
    if (incident.resolved_incident_id !== null) {
      return { voided: 0, reason: "incident_resolved" };
    }
    const nextEpoch = Number(continuityEpoch);
    if (!Number.isSafeInteger(nextEpoch) || nextEpoch < 1) {
      throw new Error("predictive leader evaluation void continuity cursor is invalid");
    }
    const safeVoidedAt = asTimestamp(
      voidedAt,
      undefined,
      "predictive leader evaluation voidedAt",
    );
    const candidates = this.sqlite.prepare(`
      SELECT leaders.forecast_id
      FROM forecast_predictive_leader_snapshots AS leaders
      JOIN round_forecasts AS forecasts ON forecasts.id = leaders.forecast_id
      JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
      LEFT JOIN forecast_settlements AS settlements
        ON settlements.forecast_id = leaders.forecast_id
      WHERE snapshots.source = ?
        AND snapshots.instrument = ?
        AND leaders.schema_version = ?
        AND leaders.algorithm_version = ?
        AND leaders.status = 'ready'
        AND leaders.created_at <= ?
        AND settlements.forecast_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM forecast_predictive_leader_evaluation_voids AS evaluation_voids
          WHERE evaluation_voids.forecast_id = leaders.forecast_id
            AND evaluation_voids.incident_id = ?
        )
      ORDER BY leaders.forecast_id
    `).all(
      source,
      instrument,
      LEARNED_LEADER_SCHEMA_VERSION,
      LEARNED_LEADER_ALGORITHM_VERSION,
      incident.created_at,
      Number(incident.id),
    );
    const insert = this.sqlite.prepare(`
      INSERT OR IGNORE INTO forecast_predictive_leader_evaluation_voids (
        forecast_id, incident_id, void_continuity_epoch, reason,
        voided_at, created_at
      ) VALUES (?, ?, ?, 'integrity_gap', ?, ?)
    `);
    let voided = 0;
    for (const candidate of candidates) {
      const forecastId = Number(candidate.forecast_id);
      if (
        this.#predictiveLeaderPendingResultIsResolvable(
          forecastId,
          source,
          instrument,
        )
      ) {
        continue;
      }
      voided += Number(insert.run(
        forecastId,
        Number(incident.id),
        nextEpoch,
        safeVoidedAt,
        safeVoidedAt,
      ).changes);
    }
    return { voided, reason: voided > 0 ? "integrity_gap" : "no_unresolved_forecast" };
  }

  #backfillPredictiveLeaderEvaluationVoids() {
    const incidents = this.sqlite.prepare(`
      SELECT
        incidents.*,
        (
          SELECT COUNT(*)
          FROM incidents AS prior
          WHERE prior.kind = 'gap'
            AND prior.source = incidents.source
            AND prior.instrument = incidents.instrument
            AND prior.id <= incidents.id
        ) AS continuity_epoch
      FROM incidents
      WHERE incidents.kind = 'gap'
        AND NOT EXISTS (
          SELECT 1
          FROM incident_resolutions
          WHERE incident_resolutions.incident_id = incidents.id
        )
      ORDER BY incidents.id
    `).all();
    if (incidents.length === 0) return;
    this.#transaction(() => {
      for (const incident of incidents) {
        this.#voidUnresolvedPredictiveLeaderEvaluationsForGapInTransaction({
          source: incident.source,
          instrument: incident.instrument,
          incidentId: Number(incident.id),
          continuityEpoch: Number(incident.continuity_epoch),
          voidedAt: incident.created_at,
        });
      }
    });
  }

  #voidPredictiveLeaderPendingBetForGapInTransaction({
    source,
    instrument,
    incidentId,
    continuityEpoch,
    voidedAt,
  }) {
    const account = this.sqlite
      .prepare(`
        SELECT *
        FROM predictive_leader_accounts
        WHERE source = ? AND instrument = ?
      `)
      .get(source, instrument);
    if (!account || account.pending_forecast_id === null) {
      return { voided: 0, reason: "no_pending_bet" };
    }
    if (account.status !== "running") {
      throw new Error("exhausted predictive leader account cannot have a pending bet");
    }

    const incident = this.sqlite
      .prepare(`
        SELECT *
        FROM incidents
        WHERE id = ? AND source = ? AND instrument = ? AND kind = 'gap'
      `)
      .get(incidentId, source, instrument);
    if (!incident) {
      throw new Error("predictive leader void incident cursor is invalid");
    }
    const nextEpoch = Number(continuityEpoch);
    if (!Number.isSafeInteger(nextEpoch) || nextEpoch < 1) {
      throw new Error("predictive leader void continuity cursor is invalid");
    }

    const bet = this.sqlite
      .prepare(`
        SELECT *
        FROM predictive_leader_account_bets
        WHERE forecast_id = ? AND source = ? AND instrument = ?
          AND status = 'pending'
      `)
      .get(Number(account.pending_forecast_id), source, instrument);
    if (!bet) {
      throw new Error("predictive leader account pending pointer is invalid");
    }
    const betEpoch = bet.continuity_epoch === null
      ? null
      : Number(bet.continuity_epoch);
    const incidentCreatedMs = Date.parse(incident.created_at);
    const placedMs = Date.parse(bet.placed_at);
    const staleAcrossGap = betEpoch === null
      ? Number.isFinite(incidentCreatedMs)
        && Number.isFinite(placedMs)
        && placedMs <= incidentCreatedMs
      : betEpoch < nextEpoch;
    if (!staleAcrossGap) {
      if (betEpoch !== null && betEpoch > nextEpoch) {
        throw new Error("predictive leader pending bet is ahead of continuity");
      }
      return { voided: 0, reason: "pending_bet_after_gap" };
    }
    if (
      this.#predictiveLeaderPendingResultIsResolvable(
        Number(bet.forecast_id),
        source,
        instrument,
      )
    ) {
      return { voided: 0, reason: "result_resolvable" };
    }
    if (
      Number(bet.balance_before) !== Number(account.current_balance)
      || Number(bet.ladder_loss_before) !== Number(account.ladder_total_loss)
      || Number(bet.ladder_miss_count_before) !== Number(account.ladder_miss_count)
      || Number(bet.stake) !== Number(account.next_stake)
    ) {
      throw new Error("predictive leader void ledger cursor is invalid");
    }

    const safeVoidedAt = asTimestamp(
      voidedAt,
      undefined,
      "predictive leader account voidedAt",
    );
    if (Date.parse(safeVoidedAt) < placedMs) {
      throw new Error("predictive leader bet cannot be voided before placement");
    }
    const betUpdate = this.sqlite
      .prepare(`
        UPDATE predictive_leader_account_bets
        SET status = 'void', void_reason = 'integrity_gap',
          void_incident_id = ?, void_continuity_epoch = ?, voided_at = ?,
          updated_at = ?
        WHERE forecast_id = ? AND status = 'pending'
      `)
      .run(
        Number(incident.id),
        nextEpoch,
        safeVoidedAt,
        safeVoidedAt,
        Number(bet.forecast_id),
      );
    if (Number(betUpdate.changes) !== 1) {
      throw new Error("predictive leader account bet was not voided exactly once");
    }
    const accountUpdate = this.sqlite
      .prepare(`
        UPDATE predictive_leader_accounts
        SET pending_forecast_id = NULL, next_stake = ?, ladder_miss_count = 0,
          ladder_total_loss = 0, last_continuity_epoch = ?,
          continuity_gap_count = continuity_gap_count + 1, updated_at = ?
        WHERE source = ? AND instrument = ? AND status = 'running'
          AND pending_forecast_id = ?
      `)
      .run(
        nextPredictiveLeaderStake(0),
        nextEpoch,
        safeVoidedAt,
        source,
        instrument,
        Number(bet.forecast_id),
      );
    if (Number(accountUpdate.changes) !== 1) {
      throw new Error("predictive leader account was not released after void");
    }
    this.#applyPendingPredictiveLeaderAccountResetInTransaction({
      source,
      instrument,
      appliedAt: safeVoidedAt,
    });
    return {
      voided: 1,
      reason: "integrity_gap",
      forecastId: Number(bet.forecast_id),
    };
  }

  #applyPendingPredictiveLeaderAccountResetInTransaction({
    source,
    instrument,
    appliedAt,
  }) {
    const reset = this.sqlite
      .prepare(`
        SELECT *
        FROM predictive_leader_account_ladder_resets
        WHERE source = ? AND instrument = ? AND status = 'pending'
        ORDER BY id
        LIMIT 1
      `)
      .get(source, instrument);
    if (!reset) return { applied: 0, reason: "no_pending_reset" };
    if (
      reset.reset_key !== PREDICTIVE_LEADER_ACCOUNT_RESET_KEY
      || reset.reason !== PREDICTIVE_LEADER_ACCOUNT_RESET_REASON
    ) {
      throw new Error("predictive leader account reset request is invalid");
    }

    const account = this.sqlite
      .prepare(`
        SELECT *
        FROM predictive_leader_accounts
        WHERE source = ? AND instrument = ?
      `)
      .get(source, instrument);
    if (!account) {
      throw new Error("predictive leader account reset has no account");
    }
    if (account.pending_forecast_id !== null) {
      return { applied: 0, reason: "prior_pending" };
    }
    const lastBet = this.sqlite
      .prepare(`
        SELECT *
        FROM predictive_leader_account_bets
        WHERE source = ? AND instrument = ?
        ORDER BY forecast_id DESC
        LIMIT 1
      `)
      .get(source, instrument);
    if (!lastBet || lastBet.status === "pending") {
      throw new Error("predictive leader account reset boundary is invalid");
    }

    const currentBalance = Number(account.current_balance);
    const ladderTotalLoss = Number(account.ladder_total_loss);
    const ladderMissCount = Number(account.ladder_miss_count);
    const previousNextStake = Number(account.next_stake);
    const expectedBalance = lastBet.status === "settled"
      ? Number(lastBet.balance_after)
      : Number(lastBet.balance_before);
    const expectedLadderLoss = lastBet.status === "settled"
      ? Number(lastBet.ladder_loss_after)
      : 0;
    const expectedLadderMissCount = lastBet.status === "settled"
      ? Number(lastBet.ladder_miss_count_after)
      : 0;
    if (
      Number(account.schema_version) !== PREDICTIVE_LEADER_ACCOUNT_SCHEMA_VERSION
      || account.strategy_version !== PREDICTIVE_LEADER_ACCOUNT_STRATEGY_VERSION
      || account.leader_algorithm_version !== LEARNED_LEADER_ALGORITHM_VERSION
      || !["running", "exhausted"].includes(account.status)
      || !Number.isSafeInteger(currentBalance)
      || !Number.isSafeInteger(ladderTotalLoss)
      || !Number.isSafeInteger(ladderMissCount)
      || previousNextStake !== nextPredictiveLeaderStake(ladderTotalLoss)
      || currentBalance !== expectedBalance
      || ladderTotalLoss !== expectedLadderLoss
      || ladderMissCount !== expectedLadderMissCount
    ) {
      throw new Error("predictive leader account reset cursor is invalid");
    }

    const requestedAtMs = Date.parse(reset.requested_at);
    const accountUpdatedAtMs = Date.parse(account.updated_at);
    const betUpdatedAtMs = Date.parse(lastBet.updated_at);
    const candidateAppliedAt = asTimestamp(
      appliedAt,
      undefined,
      "predictive leader reset appliedAt",
    );
    const appliedAtMs = Math.max(
      Date.parse(candidateAppliedAt),
      requestedAtMs,
      accountUpdatedAtMs,
      betUpdatedAtMs,
    );
    if (
      !Number.isFinite(requestedAtMs)
      || !Number.isFinite(accountUpdatedAtMs)
      || !Number.isFinite(betUpdatedAtMs)
      || !Number.isFinite(appliedAtMs)
    ) {
      throw new Error("predictive leader account reset timestamps are invalid");
    }
    const safeAppliedAt = new Date(appliedAtMs).toISOString();
    const nextStake = nextPredictiveLeaderStake(0);
    const canResume = currentBalance >= nextStake;
    const nextStatus = canResume ? "running" : "exhausted";
    const exhaustedAt = canResume
      ? null
      : account.exhausted_at ?? safeAppliedAt;

    const accountUpdate = this.sqlite
      .prepare(`
        UPDATE predictive_leader_accounts
        SET status = ?, next_stake = ?, ladder_miss_count = 0,
          ladder_total_loss = 0, updated_at = ?, exhausted_at = ?
        WHERE source = ? AND instrument = ? AND pending_forecast_id IS NULL
          AND current_balance = ? AND next_stake = ?
          AND ladder_miss_count = ? AND ladder_total_loss = ?
      `)
      .run(
        nextStatus,
        nextStake,
        safeAppliedAt,
        exhaustedAt,
        source,
        instrument,
        currentBalance,
        previousNextStake,
        ladderMissCount,
        ladderTotalLoss,
      );
    if (Number(accountUpdate.changes) !== 1) {
      throw new Error("predictive leader account reset was not applied exactly once");
    }
    const resetUpdate = this.sqlite
      .prepare(`
        UPDATE predictive_leader_account_ladder_resets
        SET status = 'applied', applied_after_forecast_id = ?,
          balance_before = ?, balance_after = ?, ladder_total_loss_before = ?,
          ladder_miss_count_before = ?, next_stake_before = ?,
          ladder_total_loss_after = 0, ladder_miss_count_after = 0,
          next_stake_after = ?, applied_at = ?, updated_at = ?
        WHERE id = ? AND status = 'pending'
      `)
      .run(
        Number(lastBet.forecast_id),
        currentBalance,
        currentBalance,
        ladderTotalLoss,
        ladderMissCount,
        previousNextStake,
        nextStake,
        safeAppliedAt,
        safeAppliedAt,
        Number(reset.id),
      );
    if (Number(resetUpdate.changes) !== 1) {
      throw new Error("predictive leader account reset audit was not applied exactly once");
    }
    return {
      applied: 1,
      reason: "stake_restart",
      afterForecastId: Number(lastBet.forecast_id),
      previousNextStake,
      nextStake,
    };
  }

  applyPredictiveLeaderAccountReset(source = "buleto", instrument = "default") {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const now = asTimestamp(
      this.clock(),
      undefined,
      "predictive leader reset appliedAt",
    );
    return this.#transaction(() => (
      this.#applyPendingPredictiveLeaderAccountResetInTransaction({
        source: safeSource,
        instrument: safeInstrument,
        appliedAt: now,
      })
    ));
  }

  #predictiveLeaderQualityEvidenceRows({
    source,
    instrument,
    horizonSeconds,
    cutoffAt,
    historyMaxResultId,
    beforeForecastId,
  }) {
    if (historyMaxResultId === null) return [];
    const rows = this.sqlite.prepare(`
      SELECT
        leaders.forecast_id,
        metric_facts.metric_version,
        metric_facts.ready_count,
        metric_facts.settled_count,
        metric_facts.top1_hits,
        metric_facts.combined_brier_loss,
        settlements.round_result_id,
        settlements.actual_number,
        settlements.settled_at AS settlement_settled_at,
        settlements.created_at AS settlement_created_at,
        results.result_number,
        results.settled_at AS result_settled_at,
        results.observed_at AS result_observed_at,
        results.created_at AS result_created_at
      FROM forecast_predictive_leader_snapshots AS leaders
      JOIN round_forecasts AS forecasts ON forecasts.id = leaders.forecast_id
      JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
      JOIN forecast_settlements AS settlements
        ON settlements.forecast_id = leaders.forecast_id
      JOIN round_results AS results ON results.id = settlements.round_result_id
      LEFT JOIN forecast_predictive_leader_metric_facts AS metric_facts
        ON metric_facts.forecast_id = leaders.forecast_id
       AND metric_facts.metric_version = ?
      WHERE snapshots.source = ?
        AND snapshots.instrument = ?
        AND snapshots.horizon_seconds = ?
        AND leaders.schema_version = ?
        AND leaders.algorithm_version = ?
        AND leaders.status = 'ready'
        AND snapshots.locked_at < ?
        AND leaders.created_at < ?
        AND settlements.settled_at < ?
        AND settlements.created_at < ?
        AND results.settled_at < ?
        AND results.observed_at < ?
        AND results.created_at < ?
        AND results.id <= ?
        AND leaders.forecast_id < ?
      ORDER BY leaders.forecast_id DESC, results.id DESC
      LIMIT ?
    `).all(
      PREDICTIVE_LEADER_METRIC_FACT_VERSION,
      source,
      instrument,
      horizonSeconds,
      LEARNED_LEADER_SCHEMA_VERSION,
      LEARNED_LEADER_ALGORITHM_VERSION,
      cutoffAt,
      cutoffAt,
      cutoffAt,
      cutoffAt,
      cutoffAt,
      cutoffAt,
      cutoffAt,
      historyMaxResultId,
      beforeForecastId,
      PREDICTIVE_LEADER_QUALITY_GATE.windowSize,
    );
    return rows.reverse().map((row) => {
      const valid = row.metric_version === PREDICTIVE_LEADER_METRIC_FACT_VERSION
        && Number(row.ready_count) === 1
        && Number(row.settled_count) === 1
        && [0, 1].includes(Number(row.top1_hits))
        && typeof row.combined_brier_loss === "number"
        && Number.isFinite(row.combined_brier_loss)
        && row.combined_brier_loss >= 0
        && row.combined_brier_loss <= 1
        && Number(row.actual_number) === Number(row.result_number)
        && row.settlement_settled_at === row.result_settled_at;
      return valid
        ? {
            forecastId: Number(row.forecast_id),
            top1Hit: Boolean(row.top1_hits),
            combinedBrierLoss: Number(row.combined_brier_loss),
          }
        : {
            forecastId: Number(row.forecast_id),
            top1Hit: null,
            combinedBrierLoss: row.combined_brier_loss,
          };
    });
  }

  #freezePredictiveLeaderQualityGateInTransaction({
    forecastId,
    parent,
    decision,
    historyMaxResultId,
    createdAt,
  }) {
    const facts = this.#predictiveLeaderQualityEvidenceRows({
      source: parent.source,
      instrument: parent.instrument,
      horizonSeconds: Number(parent.horizon_seconds),
      cutoffAt: parent.locked_at,
      historyMaxResultId,
      beforeForecastId: forecastId,
    });
    const assessed = evaluatePredictiveLeaderQualityGate({
      facts,
      currentFamilyCount: decision.familyCount,
    });
    const throughResultId = assessed.sampleSize === 0 || historyMaxResultId === null
      ? null
      : historyMaxResultId;
    const evidenceDigest = createHash("sha256")
      .update(JSON.stringify(facts))
      .digest("hex");
    const gate = Object.freeze({
      ...assessed,
      evaluatedForForecastId: forecastId,
      cutoffAt: parent.locked_at,
      currentFamilyCount: decision.familyCount,
      throughResultId,
      evidenceDigest,
    });
    this.sqlite.prepare(`
      INSERT INTO forecast_predictive_leader_quality_snapshots (
        forecast_id, policy_version, cutoff_at, status, reason, eligible,
        sample_size, hit_count, lower_bound, mean_brier_loss,
        window_start_forecast_id, window_end_forecast_id, snapshot_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      forecastId,
      gate.version,
      gate.cutoffAt,
      gate.status,
      gate.reason,
      gate.eligible ? 1 : 0,
      gate.sampleSize,
      gate.hitCount,
      gate.lowerBound,
      gate.meanBrierLoss,
      gate.windowStartForecastId,
      gate.windowEndForecastId,
      JSON.stringify(gate),
      createdAt,
    );
    return gate;
  }

  #placePredictiveLeaderSignalBetInTransaction({
    forecastId,
    source,
    instrument,
    decision,
    gate,
    placedAt,
  }) {
    if (decision.status !== "ready" || gate.eligible !== true) {
      return { placed: false, reason: "quality_not_confirmed" };
    }
    const pending = this.sqlite.prepare(`
      SELECT forecast_id
      FROM predictive_leader_gated_fixed_bets
      WHERE source = ? AND instrument = ? AND status = 'pending'
    `).get(source, instrument);
    if (pending) return { placed: false, reason: "prior_pending" };
    const totals = this.sqlite.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status <> 'void' THEN stake ELSE 0 END), 0)
          AS total_staked,
        COALESCE(SUM(CASE WHEN status = 'settled'
          THEN gross_payout ELSE 0 END), 0) AS total_gross_payout
      FROM predictive_leader_gated_fixed_bets
      WHERE source = ? AND instrument = ?
    `).get(source, instrument);
    const balanceBefore = PREDICTIVE_LEADER_SIGNAL_ACCOUNT_STARTING_BALANCE
      - Number(totals.total_staked)
      + Number(totals.total_gross_payout);
    if (balanceBefore < PREDICTIVE_LEADER_SIGNAL_STAKE) {
      return { placed: false, reason: "bankroll_exhausted" };
    }
    this.sqlite.prepare(`
      INSERT INTO predictive_leader_gated_fixed_bets (
        forecast_id, source, instrument, schema_version, strategy_version,
        leader_algorithm_version, gate_version, continuity_epoch,
        target_number, stake, balance_before, status, placed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      forecastId,
      source,
      instrument,
      PREDICTIVE_LEADER_SIGNAL_ACCOUNT_SCHEMA_VERSION,
      PREDICTIVE_LEADER_SIGNAL_ACCOUNT_STRATEGY_VERSION,
      LEARNED_LEADER_ALGORITHM_VERSION,
      gate.version,
      this.#continuityEpoch(source, instrument) ?? 0,
      decision.leaderNumber,
      PREDICTIVE_LEADER_SIGNAL_STAKE,
      balanceBefore,
      placedAt,
      placedAt,
    );
    return { placed: true, reason: "bet_frozen" };
  }

  #placePredictiveLeaderAccountBetInTransaction({
    forecastId,
    source,
    instrument,
    decision,
    historyMaxResultId,
    placedAt,
  }) {
    if (decision.status !== "ready") return { placed: false, reason: "unavailable" };
    this.sqlite
      .prepare(`
        INSERT INTO predictive_leader_accounts (
          source, instrument, schema_version, strategy_version,
          leader_algorithm_version, status, initial_balance, current_balance,
          initial_stake, stake_step, max_stake, gross_payout_multiplier,
          payout_includes_stake, next_stake, ladder_miss_count,
          ladder_total_loss, last_continuity_epoch, continuity_gap_count,
          pending_forecast_id, started_at, updated_at, exhausted_at
        ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, 0, 0,
          NULL, 0, NULL, ?, ?, NULL)
        ON CONFLICT(source, instrument) DO NOTHING
      `)
      .run(
        source,
        instrument,
        PREDICTIVE_LEADER_ACCOUNT_SCHEMA_VERSION,
        PREDICTIVE_LEADER_ACCOUNT_STRATEGY_VERSION,
        LEARNED_LEADER_ALGORITHM_VERSION,
        PREDICTIVE_LEADER_ACCOUNT_STARTING_BALANCE,
        PREDICTIVE_LEADER_ACCOUNT_STARTING_BALANCE,
        PREDICTIVE_LEADER_ACCOUNT_MODEL.initialStake,
        PREDICTIVE_LEADER_ACCOUNT_MODEL.stakeStep,
        PREDICTIVE_LEADER_ACCOUNT_MODEL.maxStake,
        PREDICTIVE_LEADER_ACCOUNT_MODEL.grossPayoutMultiplier,
        PREDICTIVE_LEADER_ACCOUNT_MODEL.payoutIncludesStake ? 1 : 0,
        nextPredictiveLeaderStake(0),
        placedAt,
        placedAt,
      );
    this.#applyPendingPredictiveLeaderAccountResetInTransaction({
      source,
      instrument,
      appliedAt: placedAt,
    });
    const account = this.sqlite
      .prepare(`
        SELECT *
        FROM predictive_leader_accounts
        WHERE source = ? AND instrument = ?
      `)
      .get(source, instrument);
    if (
      !account
      || Number(account.schema_version) !== PREDICTIVE_LEADER_ACCOUNT_SCHEMA_VERSION
      || account.strategy_version !== PREDICTIVE_LEADER_ACCOUNT_STRATEGY_VERSION
      || account.leader_algorithm_version !== LEARNED_LEADER_ALGORITHM_VERSION
      || Number(account.initial_balance) !== PREDICTIVE_LEADER_ACCOUNT_STARTING_BALANCE
      || Number(account.initial_stake) !== PREDICTIVE_LEADER_ACCOUNT_MODEL.initialStake
      || Number(account.stake_step) !== PREDICTIVE_LEADER_ACCOUNT_MODEL.stakeStep
      || Number(account.max_stake) !== PREDICTIVE_LEADER_ACCOUNT_MODEL.maxStake
      || Number(account.gross_payout_multiplier)
        !== PREDICTIVE_LEADER_ACCOUNT_MODEL.grossPayoutMultiplier
      || Boolean(account.payout_includes_stake)
        !== PREDICTIVE_LEADER_ACCOUNT_MODEL.payoutIncludesStake
    ) {
      throw new Error("predictive leader account model is invalid");
    }
    if (account.status === "exhausted") {
      return { placed: false, reason: "bankroll_exhausted" };
    }
    if (account.pending_forecast_id !== null) {
      return { placed: false, reason: "prior_pending" };
    }

    const historyRow = historyMaxResultId === null
      ? null
      : this.sqlite
          .prepare(`
            SELECT continuity_epoch
            FROM round_results
            WHERE id = ? AND source = ? AND instrument = ?
          `)
          .get(historyMaxResultId, source, instrument);
    if (historyMaxResultId !== null && !historyRow) {
      throw new Error("predictive leader account history cursor is invalid");
    }
    const continuityEpoch = this.#continuityEpoch(source, instrument);
    let ladderMissCount = Number(account.ladder_miss_count);
    let ladderTotalLoss = Number(account.ladder_total_loss);
    let nextStake = Number(account.next_stake);
    let continuityGapCount = Number(account.continuity_gap_count);
    const lastContinuityEpoch = account.last_continuity_epoch === null
      ? null
      : Number(account.last_continuity_epoch);
    if (
      lastContinuityEpoch !== null
      && continuityEpoch !== null
      && continuityEpoch !== lastContinuityEpoch
    ) {
      ladderMissCount = 0;
      ladderTotalLoss = 0;
      nextStake = nextPredictiveLeaderStake(0);
      continuityGapCount += 1;
    }
    if (nextStake !== nextPredictiveLeaderStake(ladderTotalLoss)) {
      throw new Error("predictive leader account ladder cursor is invalid");
    }
    const currentBalance = Number(account.current_balance);
    if (nextStake > currentBalance) {
      this.sqlite
        .prepare(`
          UPDATE predictive_leader_accounts
          SET status = 'exhausted', next_stake = ?, pending_forecast_id = NULL,
            last_continuity_epoch = ?, continuity_gap_count = ?,
            ladder_miss_count = ?, ladder_total_loss = ?, updated_at = ?,
            exhausted_at = ?
          WHERE source = ? AND instrument = ? AND status = 'running'
        `)
        .run(
          nextStake,
          continuityEpoch,
          continuityGapCount,
          ladderMissCount,
          ladderTotalLoss,
          placedAt,
          placedAt,
          source,
          instrument,
        );
      return { placed: false, reason: "bankroll_exhausted" };
    }

    this.sqlite
      .prepare(`
        INSERT INTO predictive_leader_account_bets (
          forecast_id, source, instrument, schema_version, strategy_version,
          leader_algorithm_version, continuity_epoch, target_number, stake,
          balance_before, ladder_loss_before, ladder_miss_count_before,
          status, placed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `)
      .run(
        forecastId,
        source,
        instrument,
        PREDICTIVE_LEADER_ACCOUNT_SCHEMA_VERSION,
        PREDICTIVE_LEADER_ACCOUNT_STRATEGY_VERSION,
        LEARNED_LEADER_ALGORITHM_VERSION,
        continuityEpoch,
        decision.leaderNumber,
        nextStake,
        currentBalance,
        ladderTotalLoss,
        ladderMissCount,
        placedAt,
        placedAt,
      );
    const update = this.sqlite
      .prepare(`
        UPDATE predictive_leader_accounts
        SET pending_forecast_id = ?, next_stake = ?, ladder_miss_count = ?,
          ladder_total_loss = ?, last_continuity_epoch = ?,
          continuity_gap_count = ?, updated_at = ?
        WHERE source = ? AND instrument = ? AND status = 'running'
          AND pending_forecast_id IS NULL
      `)
      .run(
        forecastId,
        nextStake,
        ladderMissCount,
        ladderTotalLoss,
        continuityEpoch,
        continuityGapCount,
        placedAt,
        source,
        instrument,
      );
    if (Number(update.changes) !== 1) {
      throw new Error("predictive leader account could not freeze its pending bet");
    }
    return { placed: true, reason: "pending" };
  }

  #recordPredictiveLeaderSnapshot(forecastId, trajectoryShadow) {
    const metricScope = this.sqlite.prepare(`
      SELECT snapshots.source, snapshots.instrument, snapshots.horizon_seconds
      FROM round_forecasts AS forecasts
      JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
      WHERE forecasts.id = ?
    `).get(forecastId);
    if (metricScope) {
      this.#ensurePredictiveLeaderMetricFacts(
        metricScope.source,
        metricScope.instrument,
        Number(metricScope.horizon_seconds),
      );
    }
    return this.#transaction(() => {
      const existing = this.sqlite
        .prepare(`
          SELECT forecast_id
          FROM forecast_predictive_leader_snapshots
          WHERE forecast_id = ?
        `)
        .get(forecastId);
      if (existing) return { inserted: false };

      const parent = this.sqlite
        .prepare(`
          SELECT
            forecasts.id AS forecast_id,
            snapshots.source,
            snapshots.instrument,
            snapshots.external_round_id,
            snapshots.horizon_seconds,
            snapshots.locked_at,
            snapshots.betting_closes_at,
            settlements.forecast_id AS settlement_forecast_id
          FROM round_forecasts AS forecasts
          JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
          LEFT JOIN forecast_settlements AS settlements
            ON settlements.forecast_id = forecasts.id
          WHERE forecasts.id = ?
        `)
        .get(forecastId);
      if (!parent || parent.settlement_forecast_id != null) {
        throw new Error("predictive leader requires an unsettled frozen forecast");
      }
      const knownTarget = this.sqlite
        .prepare(`
          SELECT id
          FROM round_results
          WHERE source = ? AND instrument = ? AND external_round_id = ?
          LIMIT 1
        `)
        .get(parent.source, parent.instrument, parent.external_round_id);
      if (knownTarget) {
        throw new Error("predictive leader cannot be captured after its result");
      }
      const createdAt = asTimestamp(
        this.clock(),
        undefined,
        "predictive leader createdAt",
      );
      if (
        Date.parse(createdAt) < Date.parse(parent.locked_at)
        || Date.parse(parent.betting_closes_at) - Date.parse(createdAt) < 5_000
      ) {
        throw new RangeError(
          "predictive leader must be stored at least five seconds before betting closes",
        );
      }

      const conditional = this.#predictiveLeaderConditionalSources({
        source: parent.source,
        instrument: parent.instrument,
        externalRoundId: parent.external_round_id,
        lockedAt: parent.locked_at,
      });
      const sources = [
        ...this.#predictiveLeaderPriceSources(
          trajectoryShadow,
          forecastId,
          parent.locked_at,
        ),
        ...conditional.sources,
      ];
      const learning = this.#predictiveLeaderLearningRows(
        parent.source,
        parent.instrument,
        Number(parent.horizon_seconds),
        parent.locked_at,
      );
      const decision = buildLearnedLeaderDecision({
        sources,
        learningRows: learning.learningRows,
        lockedAt: parent.locked_at,
        tieSeed: `${conditional.historyMaxResultId ?? "none"}:${parent.external_round_id}`,
      });
      const normalized = normalizeLearnedLeaderDecision(decision);
      if (!normalized || !validLearnedLeaderAudit(normalized)) {
        throw new Error("predictive leader builder returned an invalid snapshot");
      }
      const trainingThroughForecastId = decision.learning.trainingThroughId == null
        ? null
        : Number(decision.learning.trainingThroughId);
      const trainingThroughResultId = decision.learning.trainingThroughId == null
        ? null
        : learning.resultIdByForecastId.get(decision.learning.trainingThroughId) ?? null;
      if (
        decision.learning.trainingCount > 0
        && (
          !Number.isSafeInteger(trainingThroughForecastId)
          || !Number.isSafeInteger(trainingThroughResultId)
        )
      ) {
        throw new Error("predictive leader training cursor is incomplete");
      }
      this.sqlite
        .prepare(`
          INSERT INTO forecast_predictive_leader_snapshots (
            forecast_id, schema_version, algorithm_version, status, locked_at,
            history_max_result_id, training_through_forecast_id,
            training_through_result_id, training_count, predicted_number,
            score, snapshot_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          forecastId,
          LEARNED_LEADER_SCHEMA_VERSION,
          LEARNED_LEADER_ALGORITHM_VERSION,
          decision.status,
          decision.lockedAt,
          conditional.historyMaxResultId,
          trainingThroughForecastId,
          trainingThroughResultId,
          decision.learning.trainingCount,
          decision.leaderNumber,
          decision.leaderMass,
          JSON.stringify(decision),
          createdAt,
        );
      const qualityGate = this.#freezePredictiveLeaderQualityGateInTransaction({
        forecastId,
        parent,
        decision,
        historyMaxResultId: conditional.historyMaxResultId,
        createdAt,
      });
      this.#placePredictiveLeaderSignalBetInTransaction({
        forecastId,
        source: parent.source,
        instrument: parent.instrument,
        decision,
        gate: qualityGate,
        placedAt: createdAt,
      });
      if (this.predictiveLeaderLegacyAccountEnabled) {
        this.#placePredictiveLeaderAccountBetInTransaction({
          forecastId,
          source: parent.source,
          instrument: parent.instrument,
          decision,
          historyMaxResultId: conditional.historyMaxResultId,
          placedAt: createdAt,
        });
      }
      const commitCheckedAt = asTimestamp(
        this.clock(),
        undefined,
        "predictive leader commitCheckedAt",
      );
      if (
        Date.parse(parent.betting_closes_at) - Date.parse(commitCheckedAt) < 5_000
      ) {
        throw new RangeError(
          "predictive leader transaction must finish at least five seconds before betting closes",
        );
      }
      return { inserted: true };
    });
  }

  #predictiveLeaderV7PaperCampaignRow(source, instrument) {
    const campaign = this.sqlite.prepare(`
      SELECT *
      FROM predictive_leader_v7_paper_campaigns
      WHERE campaign_key = ?
    `).get(PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.campaignKey);
    if (!campaign) {
      throw new Error("predictive leader v7 paper campaign is missing");
    }
    if (campaign.source !== source || campaign.instrument !== instrument) {
      return null;
    }
    if (
      Number(campaign.schema_version)
        !== PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.schemaVersion
      || campaign.strategy_version
        !== PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.strategyVersion
      || campaign.candidate_key
        !== PREDICTIVE_LEADER_V7_CANDIDATE_CONFIG.candidateId
      || campaign.algorithm_version !== LEARNED_LEADER_V7_ALGORITHM_VERSION
      || campaign.mode !== PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.mode
      || Boolean(campaign.execution_enabled)
        !== PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.executionEnabled
      || Boolean(campaign.advisory_only)
        !== PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.advisoryOnly
      || Boolean(campaign.promotion_eligible)
        !== PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.promotionEligible
      || campaign.promotion_policy
        !== PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.promotionPolicy
      || campaign.authorization_reason
        !== PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.authorizationReason
      || Number(campaign.initial_balance)
        !== PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.initialBalance
      || Number(campaign.fixed_stake)
        !== PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.fixedStake
      || Number(campaign.gross_payout_multiplier)
        !== PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.grossPayoutMultiplier
      || !Boolean(campaign.payout_includes_stake)
      || !["running", "exhausted"].includes(campaign.status)
      || !Number.isSafeInteger(Number(campaign.current_balance))
      || Number(campaign.current_balance) < 0
      || !Number.isSafeInteger(Number(campaign.ledger_deficit))
      || Number(campaign.ledger_deficit) < 0
      || (Number(campaign.current_balance) > 0
        && Number(campaign.ledger_deficit) > 0)
      || !Number.isSafeInteger(Number(campaign.first_forecast_id))
      || Number(campaign.first_forecast_id) < 1
      || !Number.isSafeInteger(Number(campaign.last_continuity_epoch))
      || Number(campaign.last_continuity_epoch) < 0
      || !Number.isSafeInteger(Number(campaign.continuity_gap_count))
      || Number(campaign.continuity_gap_count) < 0
      || campaign.started_at !== campaign.created_at
      || !Number.isFinite(Date.parse(campaign.started_at))
      || !Number.isFinite(Date.parse(campaign.updated_at))
      || campaign.updated_at < campaign.started_at
    ) {
      throw new Error("predictive leader v7 paper campaign cursor is invalid");
    }
    return campaign;
  }

  #requirePredictiveLeaderV7PaperCampaign(source, instrument) {
    const campaign = this.#predictiveLeaderV7PaperCampaignRow(source, instrument);
    if (!campaign) {
      throw new RangeError("predictive leader v7 paper campaign is pinned to its frozen stream");
    }
    return campaign;
  }

  #voidPredictiveLeaderV7PaperBetInTransaction({
    campaign,
    bet,
    reason,
    incidentId = null,
    continuityEpoch = null,
    voidedAt,
  }) {
    const existingVoid = this.sqlite.prepare(`
      SELECT bet_id
      FROM predictive_leader_v7_paper_voids
      WHERE bet_id = ?
    `).get(Number(bet.id));
    if (existingVoid) {
      return { voided: 0, reason: "already_void", forecastId: Number(bet.forecast_id) };
    }
    if (!["pending", "settled"].includes(bet.status)) {
      throw new Error("predictive leader v7 paper void source status is invalid");
    }
    if (!PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.payoutIncludesStake) {
      throw new Error("predictive leader v7 paper payout model is invalid");
    }
    const requestedVoidedAt = asTimestamp(
      voidedAt,
      undefined,
      "predictive leader v7 paper voidedAt",
    );
    const safeVoidedAt = new Date(Math.max(
      Date.parse(requestedVoidedAt),
      Date.parse(campaign.updated_at),
      Date.parse(bet.updated_at),
      Date.parse(bet.settled_at ?? bet.placed_at),
    )).toISOString();
    const balanceAdjustment = bet.status === "pending"
      ? Number(bet.stake)
      : Number(bet.stake) - Number(bet.gross_payout);
    const insertion = this.sqlite.prepare(`
      INSERT INTO predictive_leader_v7_paper_voids (
        bet_id, campaign_id, prior_status, reason, balance_adjustment,
        incident_id, continuity_epoch, voided_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(bet_id) DO NOTHING
    `).run(
      Number(bet.id),
      Number(campaign.id),
      bet.status,
      reason,
      balanceAdjustment,
      incidentId,
      continuityEpoch,
      safeVoidedAt,
      safeVoidedAt,
    );
    if (Number(insertion.changes) !== 1) {
      return { voided: 0, reason: "already_void", forecastId: Number(bet.forecast_id) };
    }
    if (bet.status === "pending") {
      const update = this.sqlite.prepare(`
        UPDATE predictive_leader_v7_paper_bets
        SET status = 'void', void_reason = ?, void_incident_id = ?,
          void_continuity_epoch = ?, voided_at = ?, updated_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(
        reason,
        incidentId,
        continuityEpoch,
        safeVoidedAt,
        safeVoidedAt,
        Number(bet.id),
      );
      if (Number(update.changes) !== 1) {
        throw new Error("predictive leader v7 paper pending bet was not voided exactly once");
      }
    }
    const effectiveBalance = Number(campaign.current_balance)
      - Number(campaign.ledger_deficit)
      + balanceAdjustment;
    const currentBalance = Math.max(0, effectiveBalance);
    const ledgerDeficit = Math.max(0, -effectiveBalance);
    const pendingAfterVoid = this.sqlite.prepare(`
      SELECT 1
      FROM predictive_leader_v7_paper_bets AS bets
      LEFT JOIN predictive_leader_v7_paper_voids AS voids ON voids.bet_id = bets.id
      WHERE bets.campaign_id = ? AND bets.status = 'pending'
        AND voids.bet_id IS NULL
      LIMIT 1
    `).get(Number(campaign.id));
    const exhausted = ledgerDeficit > 0
      || (!pendingAfterVoid && currentBalance < Number(campaign.fixed_stake));
    const updatedAt = campaign.updated_at > safeVoidedAt
      ? campaign.updated_at
      : safeVoidedAt;
    const campaignUpdate = this.sqlite.prepare(`
      UPDATE predictive_leader_v7_paper_campaigns
      SET status = ?, current_balance = ?, ledger_deficit = ?,
        last_continuity_epoch = ?,
        continuity_gap_count = continuity_gap_count + ?, updated_at = ?,
        exhausted_at = ?
      WHERE id = ? AND current_balance = ? AND ledger_deficit = ?
    `).run(
      exhausted ? "exhausted" : "running",
      currentBalance,
      ledgerDeficit,
      reason === "integrity_gap"
        ? Number(continuityEpoch)
        : Number(campaign.last_continuity_epoch),
      reason === "integrity_gap" ? 1 : 0,
      updatedAt,
      exhausted ? campaign.exhausted_at ?? safeVoidedAt : null,
      Number(campaign.id),
      Number(campaign.current_balance),
      Number(campaign.ledger_deficit),
    );
    if (Number(campaignUpdate.changes) !== 1) {
      throw new Error("predictive leader v7 paper campaign void adjustment failed");
    }
    return {
      voided: 1,
      reason,
      forecastId: Number(bet.forecast_id),
      balanceAdjustment,
    };
  }

  #voidPredictiveLeaderV7FixedPaperForMetadataConflictInTransaction({
    source,
    instrument,
    externalRoundId,
    voidedAt,
  }) {
    const campaign = this.#predictiveLeaderV7PaperCampaignRow(source, instrument);
    if (!campaign) return { voided: 0, reason: "outside_frozen_stream" };
    const conflict = this.sqlite.prepare(`
      SELECT 1
      FROM predictive_shadow_round_metadata_conflicts
      WHERE boundary_key = 'predictive-shadow-metadata-integrity-v1'
        AND source = ? AND instrument = ? AND external_round_id = ?
    `).get(source, instrument, externalRoundId);
    if (!conflict) return { voided: 0, reason: "metadata_matches" };
    const bet = this.sqlite.prepare(`
      SELECT bets.*
      FROM predictive_leader_v7_paper_bets AS bets
      LEFT JOIN predictive_leader_v7_paper_voids AS voids ON voids.bet_id = bets.id
      WHERE bets.campaign_id = ? AND bets.external_round_id = ?
        AND bets.status IN ('pending', 'settled')
        AND voids.bet_id IS NULL
      ORDER BY bets.id DESC
      LIMIT 1
    `).get(Number(campaign.id), externalRoundId);
    if (!bet) return { voided: 0, reason: "no_affected_bet" };
    return this.#voidPredictiveLeaderV7PaperBetInTransaction({
      campaign,
      bet,
      reason: "round_metadata_conflict",
      voidedAt,
    });
  }

  #predictiveLeaderV7PaperBetHasResolvableResult({ source, instrument, bet }) {
    const durableResult = this.sqlite.prepare(`
      SELECT results.id
      FROM round_results AS results
      WHERE results.source = ? AND results.instrument = ?
        AND results.external_round_id = ?
      UNION ALL
      SELECT settlements.round_result_id AS id
      FROM forecast_settlements AS settlements
      WHERE settlements.forecast_id = ?
      LIMIT 1
    `).get(
      source,
      instrument,
      bet.external_round_id,
      Number(bet.forecast_id),
    );
    if (durableResult) return true;

    const forecast = this.sqlite.prepare(`
      SELECT snapshots.round_ends_at
      FROM round_forecasts AS forecasts
      JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
      WHERE forecasts.id = ?
        AND snapshots.source = ? AND snapshots.instrument = ?
        AND snapshots.external_round_id = ?
    `).get(
      Number(bet.forecast_id),
      source,
      instrument,
      bet.external_round_id,
    );
    const expectedEndMs = Date.parse(forecast?.round_ends_at);
    if (!Number.isFinite(expectedEndMs)) return false;
    const anonymousCandidates = this.sqlite.prepare(`
      SELECT results.id
      FROM round_results AS results
      WHERE results.source = ? AND results.instrument = ?
        AND results.external_round_id IS NULL
        AND results.settled_at >= ? AND results.settled_at <= ?
        AND NOT EXISTS (
          SELECT 1
          FROM forecast_settlements AS settlements
          WHERE settlements.round_result_id = results.id
        )
      ORDER BY results.settled_at, results.id
      LIMIT 2
    `).all(
      source,
      instrument,
      new Date(expectedEndMs - 3_000).toISOString(),
      new Date(expectedEndMs + 1_000).toISOString(),
    );
    if (anonymousCandidates.length !== 1) return false;
    const unsettledCount = Number(this.sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM round_forecasts AS forecasts
      JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
      LEFT JOIN forecast_settlements AS settlements
        ON settlements.forecast_id = forecasts.id
      WHERE snapshots.source = ? AND snapshots.instrument = ?
        AND snapshots.round_ends_at = ?
        AND settlements.forecast_id IS NULL
    `).get(source, instrument, forecast.round_ends_at).count);
    return unsettledCount === 1;
  }

  #voidPredictiveLeaderV7FixedPaperForGapInTransaction({
    source,
    instrument,
    incidentId,
    continuityEpoch,
    voidedAt,
  }) {
    const campaign = this.#predictiveLeaderV7PaperCampaignRow(source, instrument);
    if (!campaign) return { voided: 0, reason: "outside_frozen_stream" };
    const incident = this.sqlite.prepare(`
      SELECT incidents.*, incident_resolutions.incident_id AS resolved_incident_id
      FROM incidents
      LEFT JOIN incident_resolutions
        ON incident_resolutions.incident_id = incidents.id
      WHERE incidents.id = ? AND incidents.source = ?
        AND incidents.instrument = ? AND incidents.kind = 'gap'
    `).get(incidentId, source, instrument);
    if (!incident) throw new Error("predictive leader v7 paper gap cursor is invalid");
    if (incident.resolved_incident_id !== null) {
      return { voided: 0, reason: "incident_resolved" };
    }
    const nextEpoch = Number(continuityEpoch);
    if (!Number.isSafeInteger(nextEpoch) || nextEpoch < 1) {
      throw new Error("predictive leader v7 paper continuity cursor is invalid");
    }
    const bet = this.sqlite.prepare(`
      SELECT bets.*
      FROM predictive_leader_v7_paper_bets AS bets
      LEFT JOIN predictive_leader_v7_paper_voids AS voids ON voids.bet_id = bets.id
      WHERE bets.campaign_id = ? AND bets.status = 'pending'
        AND bets.continuity_epoch < ? AND voids.bet_id IS NULL
      ORDER BY bets.id
      LIMIT 1
    `).get(Number(campaign.id), nextEpoch);
    if (!bet) return { voided: 0, reason: "no_pending_bet" };
    if (this.#predictiveLeaderV7PaperBetHasResolvableResult({
      source,
      instrument,
      bet,
    })) return { voided: 0, reason: "result_resolvable" };
    return this.#voidPredictiveLeaderV7PaperBetInTransaction({
      campaign,
      bet,
      reason: "integrity_gap",
      incidentId: Number(incident.id),
      continuityEpoch: nextEpoch,
      voidedAt,
    });
  }

  #settlePredictiveLeaderV7PaperInTransaction(source, instrument, updatedAt) {
    let campaign = this.#predictiveLeaderV7PaperCampaignRow(source, instrument);
    if (!campaign) return { settled: 0, voided: 0, reason: "outside_frozen_stream" };
    const pending = this.sqlite.prepare(`
      SELECT
        bets.*,
        settlements.round_result_id AS settlement_result_id,
        settlements.actual_number AS settlement_actual_number,
        settlements.settled_at AS settlement_occurred_at,
        results.source AS result_source,
        results.instrument AS result_instrument,
        results.external_round_id AS result_external_round_id,
        results.result_number AS stored_result_number,
        results.settled_at AS result_occurred_at,
        conflicts.reason AS conflict_reason
      FROM predictive_leader_v7_paper_bets AS bets
      JOIN round_forecasts AS forecasts ON forecasts.id = bets.forecast_id
      JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
      LEFT JOIN forecast_settlements AS settlements
        ON settlements.forecast_id = bets.forecast_id
      LEFT JOIN round_results AS results ON results.id = settlements.round_result_id
      LEFT JOIN predictive_shadow_round_metadata_conflicts AS conflicts
        ON conflicts.boundary_key = 'predictive-shadow-metadata-integrity-v1'
       AND conflicts.source = snapshots.source
       AND conflicts.instrument = snapshots.instrument
       AND conflicts.external_round_id = snapshots.external_round_id
      LEFT JOIN predictive_leader_v7_paper_voids AS voids ON voids.bet_id = bets.id
      WHERE bets.campaign_id = ? AND bets.status = 'pending'
        AND voids.bet_id IS NULL
      LIMIT 1
    `).get(Number(campaign.id));
    if (!pending) return { settled: 0, voided: 0, reason: "no_pending_bet" };
    if (pending.conflict_reason !== null) {
      const outcome = this.#voidPredictiveLeaderV7FixedPaperForMetadataConflictInTransaction({
        source,
        instrument,
        externalRoundId: pending.external_round_id,
        voidedAt: updatedAt,
      });
      return { settled: 0, ...outcome };
    }
    if (pending.settlement_result_id === null) {
      return { settled: 0, voided: 0, reason: "awaiting_authoritative_result" };
    }
    if (
      pending.result_source !== source
      || pending.result_instrument !== instrument
      || (pending.result_external_round_id !== null
        && pending.result_external_round_id !== pending.external_round_id)
      || Number(pending.settlement_actual_number)
        !== Number(pending.stored_result_number)
      || pending.settlement_occurred_at !== pending.result_occurred_at
    ) {
      throw new Error("predictive leader v7 paper settlement is not authoritative");
    }
    if (Date.parse(pending.result_occurred_at) < Date.parse(pending.placed_at)) {
      throw new Error("predictive leader v7 paper result predates its placement");
    }
    const effectiveUpdatedAt = new Date(Math.max(
      Date.parse(campaign.updated_at),
      Date.parse(updatedAt),
      Date.parse(pending.result_occurred_at),
    )).toISOString();
    const resultNumber = Number(pending.stored_result_number);
    const hit = resultNumber === Number(pending.target_number);
    const grossPayout = hit
      ? Number(pending.stake) * PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.grossPayoutMultiplier
      : 0;
    const historicalBalanceAfter = Number(pending.balance_before)
      - Number(pending.stake)
      + grossPayout;
    const betUpdate = this.sqlite.prepare(`
      UPDATE predictive_leader_v7_paper_bets
      SET status = 'settled', round_result_id = ?, result_number = ?, outcome = ?,
        gross_payout = ?, balance_after = ?, settled_at = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(
      Number(pending.settlement_result_id),
      resultNumber,
      hit ? "hit" : "miss",
      grossPayout,
      historicalBalanceAfter,
      pending.result_occurred_at,
      effectiveUpdatedAt,
      Number(pending.id),
    );
    if (Number(betUpdate.changes) !== 1) {
      throw new Error("predictive leader v7 paper bet was not settled exactly once");
    }
    const effectiveBalance = Number(campaign.current_balance)
      - Number(campaign.ledger_deficit)
      + grossPayout;
    const currentBalance = Math.max(0, effectiveBalance);
    const ledgerDeficit = Math.max(0, -effectiveBalance);
    const exhausted = ledgerDeficit > 0
      || currentBalance < Number(campaign.fixed_stake);
    const campaignUpdate = this.sqlite.prepare(`
      UPDATE predictive_leader_v7_paper_campaigns
      SET status = ?, current_balance = ?, ledger_deficit = ?, updated_at = ?,
        exhausted_at = ?
      WHERE id = ? AND current_balance = ? AND ledger_deficit = ?
    `).run(
      exhausted ? "exhausted" : "running",
      currentBalance,
      ledgerDeficit,
      effectiveUpdatedAt,
      exhausted ? campaign.exhausted_at ?? effectiveUpdatedAt : null,
      Number(campaign.id),
      Number(campaign.current_balance),
      Number(campaign.ledger_deficit),
    );
    if (Number(campaignUpdate.changes) !== 1) {
      throw new Error("predictive leader v7 paper campaign settlement failed");
    }
    return {
      settled: 1,
      voided: 0,
      reason: hit ? "hit" : "miss",
      forecastId: Number(pending.forecast_id),
    };
  }

  #reconcilePredictiveLeaderV7PaperInTransaction(source, instrument, updatedAt) {
    const campaign = this.#predictiveLeaderV7PaperCampaignRow(source, instrument);
    if (!campaign) return { settled: 0, voided: 0, reason: "outside_frozen_stream" };
    const pending = this.sqlite.prepare(`
      SELECT bets.*
      FROM predictive_leader_v7_paper_bets AS bets
      LEFT JOIN predictive_leader_v7_paper_voids AS voids ON voids.bet_id = bets.id
      WHERE bets.campaign_id = ? AND bets.status = 'pending'
        AND voids.bet_id IS NULL
      LIMIT 1
    `).get(Number(campaign.id));
    if (pending) {
      const conflict = this.sqlite.prepare(`
        SELECT 1
        FROM predictive_shadow_round_metadata_conflicts
        WHERE boundary_key = 'predictive-shadow-metadata-integrity-v1'
          AND source = ? AND instrument = ? AND external_round_id = ?
      `).get(source, instrument, pending.external_round_id);
      if (conflict) {
        const outcome = this.#voidPredictiveLeaderV7FixedPaperForMetadataConflictInTransaction({
          source,
          instrument,
          externalRoundId: pending.external_round_id,
          voidedAt: updatedAt,
        });
        return { settled: 0, ...outcome };
      }
      const currentEpoch = this.#continuityEpoch(source, instrument);
      if (Number(pending.continuity_epoch) < currentEpoch) {
        if (!this.#predictiveLeaderV7PaperBetHasResolvableResult({
          source,
          instrument,
          bet: pending,
        })) {
          const incident = this.sqlite.prepare(`
            SELECT incidents.id, incidents.created_at
            FROM incidents
            LEFT JOIN incident_resolutions
              ON incident_resolutions.incident_id = incidents.id
            WHERE incidents.source = ? AND incidents.instrument = ?
              AND incidents.kind = 'gap'
              AND incidents.created_at >= ?
              AND incident_resolutions.incident_id IS NULL
            ORDER BY incidents.id
            LIMIT 1
          `).get(source, instrument, pending.placed_at);
          if (!incident) {
            throw new Error("predictive leader v7 paper gap incident is missing");
          }
          const outcome = this.#voidPredictiveLeaderV7FixedPaperForGapInTransaction({
            source,
            instrument,
            incidentId: Number(incident.id),
            continuityEpoch: currentEpoch,
            voidedAt: incident.created_at > updatedAt ? incident.created_at : updatedAt,
          });
          return { settled: 0, ...outcome };
        }
      }
    }
    return this.#settlePredictiveLeaderV7PaperInTransaction(
      source,
      instrument,
      updatedAt,
    );
  }

  #placePredictiveLeaderV7PaperBetInTransaction({
    source,
    instrument,
    forecastId,
    placedAt,
  }) {
    const campaign = this.#requirePredictiveLeaderV7PaperCampaign(source, instrument);
    const safeForecastId = Number(forecastId);
    if (!Number.isSafeInteger(safeForecastId) || safeForecastId < 1) {
      throw new TypeError("forecastId must be a positive safe integer");
    }
    const existing = this.sqlite.prepare(`
      SELECT id
      FROM predictive_leader_v7_paper_bets
      WHERE campaign_id = ? AND forecast_id = ?
    `).get(Number(campaign.id), safeForecastId);
    if (existing) return { placed: 0, reason: "already_recorded", forecastId: safeForecastId };
    const pending = this.sqlite.prepare(`
      SELECT id
      FROM predictive_leader_v7_paper_bets
      WHERE campaign_id = ? AND status = 'pending'
    `).get(Number(campaign.id));
    if (pending) return { placed: 0, reason: "prior_pending", forecastId: safeForecastId };
    if (campaign.status === "exhausted"
      || Number(campaign.ledger_deficit) > 0
      || Number(campaign.current_balance) < Number(campaign.fixed_stake)) {
      return { placed: 0, reason: "bankroll_exhausted", forecastId: safeForecastId };
    }
    const candidate = this.sqlite.prepare(`
      SELECT
        leaders.*,
        snapshots.source,
        snapshots.instrument,
        snapshots.external_round_id,
        snapshots.locked_at AS forecast_locked_at,
        snapshots.betting_closes_at,
        settlements.forecast_id AS settlement_forecast_id,
        conflicts.reason AS conflict_reason,
        results.id AS known_result_id
      FROM forecast_predictive_leader_v7_snapshots AS leaders
      JOIN round_forecasts AS forecasts ON forecasts.id = leaders.forecast_id
      JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
      LEFT JOIN forecast_settlements AS settlements
        ON settlements.forecast_id = leaders.forecast_id
      LEFT JOIN predictive_shadow_round_metadata_conflicts AS conflicts
        ON conflicts.boundary_key = 'predictive-shadow-metadata-integrity-v1'
       AND conflicts.source = snapshots.source
       AND conflicts.instrument = snapshots.instrument
       AND conflicts.external_round_id = snapshots.external_round_id
      LEFT JOIN round_results AS results
        ON results.source = snapshots.source
       AND results.instrument = snapshots.instrument
       AND results.external_round_id = snapshots.external_round_id
      WHERE leaders.forecast_id = ? AND leaders.candidate_key = ?
    `).get(safeForecastId, campaign.candidate_key);
    if (!candidate) {
      return { placed: 0, reason: "v7_snapshot_unavailable", forecastId: safeForecastId };
    }
    if (
      safeForecastId < Number(campaign.first_forecast_id)
      || candidate.locked_at < campaign.started_at
      || candidate.created_at < campaign.started_at
    ) {
      return { placed: 0, reason: "outside_prospective_boundary", forecastId: safeForecastId };
    }
    if (candidate.source !== source || candidate.instrument !== instrument) {
      throw new Error("predictive leader v7 paper forecast stream is invalid");
    }
    if (candidate.conflict_reason !== null) {
      return { placed: 0, reason: "round_metadata_conflict", forecastId: safeForecastId };
    }
    if (candidate.settlement_forecast_id !== null || candidate.known_result_id !== null) {
      return { placed: 0, reason: "result_already_known", forecastId: safeForecastId };
    }
    const decision = normalizeLearnedLeaderV7Decision(
      deserializeJson(candidate.snapshot_json),
    );
    if (
      !decision
      || candidate.status !== "ready"
      || Number(candidate.selected) !== 1
      || decision.status !== "ready"
      || decision.selection.eligible !== true
      || decision.algorithmVersion !== campaign.algorithm_version
      || decision.config.candidateId !== campaign.candidate_key
      || JSON.stringify(decision.config) !== PREDICTIVE_LEADER_V7_CONFIG_JSON
      || Number(decision.leaderNumber) !== Number(candidate.predicted_number)
      || decision.lockedAt !== candidate.locked_at
      || candidate.locked_at !== candidate.forecast_locked_at
    ) {
      return { placed: 0, reason: "v7_not_ready_selected", forecastId: safeForecastId };
    }
    const safePlacedAt = asTimestamp(
      placedAt,
      undefined,
      "predictive leader v7 paper placedAt",
    );
    if (
      Date.parse(safePlacedAt) < Date.parse(candidate.locked_at)
      || Date.parse(candidate.betting_closes_at) - Date.parse(safePlacedAt)
        < PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.minimumPlacementLeadMs
    ) {
      return { placed: 0, reason: "outside_safe_preclose", forecastId: safeForecastId };
    }
    const continuityEpoch = this.#continuityEpoch(source, instrument);
    const insertion = this.sqlite.prepare(`
      INSERT INTO predictive_leader_v7_paper_bets (
        campaign_id, forecast_id, candidate_key, external_round_id,
        continuity_epoch, target_number, stake, balance_before, locked_at,
        betting_closes_at, status, placed_at, updated_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(
      Number(campaign.id),
      safeForecastId,
      campaign.candidate_key,
      candidate.external_round_id,
      continuityEpoch,
      Number(candidate.predicted_number),
      Number(campaign.fixed_stake),
      Number(campaign.current_balance),
      candidate.locked_at,
      candidate.betting_closes_at,
      safePlacedAt,
      safePlacedAt,
      safePlacedAt,
    );
    const campaignUpdate = this.sqlite.prepare(`
      UPDATE predictive_leader_v7_paper_campaigns
      SET current_balance = current_balance - fixed_stake,
        last_continuity_epoch = ?, updated_at = ?
      WHERE id = ? AND status = 'running' AND current_balance = ?
        AND ledger_deficit = 0
    `).run(
      continuityEpoch,
      safePlacedAt,
      Number(campaign.id),
      Number(campaign.current_balance),
    );
    if (Number(insertion.changes) !== 1 || Number(campaignUpdate.changes) !== 1) {
      throw new Error("predictive leader v7 paper placement was not committed exactly once");
    }
    const commitCheckedAt = asTimestamp(
      this.clock(),
      undefined,
      "predictive leader v7 paper commitCheckedAt",
    );
    if (
      Date.parse(commitCheckedAt) < Date.parse(safePlacedAt)
      || Date.parse(candidate.betting_closes_at) - Date.parse(commitCheckedAt)
        < PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.minimumPlacementLeadMs
    ) {
      throw new RangeError(
        "predictive leader v7 paper transaction must finish at least five seconds before betting closes",
      );
    }
    return { placed: 1, reason: "bet_frozen", forecastId: safeForecastId };
  }

  #predictiveLeaderV7PaperLadderCampaignRow(source, instrument) {
    const config = PREDICTIVE_LEADER_V7_PAPER_LADDER_CAMPAIGN;
    const model = config.model;
    const campaign = this.sqlite.prepare(`
      SELECT *
      FROM predictive_leader_v7_paper_ladder_campaigns
      WHERE campaign_key = ?
    `).get(config.campaignKey);
    if (!campaign) {
      throw new Error("predictive leader v7 paper ladder campaign is missing");
    }
    if (campaign.source !== source || campaign.instrument !== instrument) return null;
    const cycleNumber = Number(campaign.cycle_number);
    const cycleStaked = Number(campaign.cycle_staked);
    const ladderLoss = Number(campaign.ladder_loss);
    const ladderMissCount = Number(campaign.ladder_miss_count);
    const resetCount = Number(campaign.reset_count);
    const nextStake = Number(campaign.next_stake);
    const currentContinuityEpoch = this.#continuityEpoch(source, instrument);
    const expectedNextStake = calculatePredictiveLeaderV7PaperNextStake(
      ladderLoss,
      cycleStaked,
    );
    if (
      Number(campaign.schema_version) !== config.schemaVersion
      || campaign.strategy_version !== config.strategyVersion
      || campaign.candidate_key !== PREDICTIVE_LEADER_V7_CANDIDATE_CONFIG.candidateId
      || campaign.algorithm_version !== LEARNED_LEADER_V7_ALGORITHM_VERSION
      || campaign.mode !== config.mode
      || Boolean(campaign.execution_enabled) !== config.executionEnabled
      || Boolean(campaign.advisory_only) !== config.advisoryOnly
      || Boolean(campaign.promotion_eligible) !== config.promotionEligible
      || campaign.promotion_policy !== config.promotionPolicy
      || campaign.authorization_reason !== config.authorizationReason
      || Number(campaign.initial_balance) !== config.initialBalance
      || campaign.model_kind !== model.kind
      || Number(campaign.initial_stake) !== model.initialStake
      || Number(campaign.stake_step) !== model.stakeStep
      || Number(campaign.max_stake) !== model.maxStake
      || Number(campaign.cycle_spend_limit) !== model.cycleSpendLimit
      || campaign.reset_policy !== model.resetPolicy
      || Number(campaign.gross_payout_multiplier) !== model.grossPayoutMultiplier
      || !Boolean(campaign.payout_includes_stake)
      || !["running", "exhausted"].includes(campaign.status)
      || !Number.isSafeInteger(Number(campaign.current_balance))
      || Number(campaign.current_balance) < 0
      || !Number.isSafeInteger(Number(campaign.ledger_deficit))
      || Number(campaign.ledger_deficit) < 0
      || (Number(campaign.current_balance) > 0
        && Number(campaign.ledger_deficit) > 0)
      || !Number.isSafeInteger(cycleNumber)
      || cycleNumber < 1
      || !Number.isSafeInteger(cycleStaked)
      || cycleStaked < 0
      || cycleStaked >= model.cycleSpendLimit
      || ladderLoss !== cycleStaked
      || !Number.isSafeInteger(ladderMissCount)
      || ladderMissCount < 0
      || !Number.isSafeInteger(resetCount)
      || resetCount !== cycleNumber - 1
      || nextStake !== expectedNextStake
      || !Number.isSafeInteger(Number(campaign.ledger_revision))
      || Number(campaign.ledger_revision) < 0
      || !Number.isSafeInteger(Number(campaign.first_forecast_id))
      || Number(campaign.first_forecast_id) < 1
      || !Number.isSafeInteger(Number(campaign.last_continuity_epoch))
      || Number(campaign.last_continuity_epoch) < 0
      || Number(campaign.last_continuity_epoch) > currentContinuityEpoch
      || !Number.isSafeInteger(Number(campaign.activation_gap_incident_id))
      || Number(campaign.activation_gap_incident_id) < 0
      || !Number.isSafeInteger(Number(campaign.last_gap_incident_id))
      || Number(campaign.last_gap_incident_id)
        < Number(campaign.activation_gap_incident_id)
      || !Number.isSafeInteger(Number(campaign.continuity_gap_count))
      || Number(campaign.continuity_gap_count) < 0
      || campaign.started_at !== campaign.created_at
      || !Number.isFinite(Date.parse(campaign.started_at))
      || !Number.isFinite(Date.parse(campaign.updated_at))
      || campaign.updated_at < campaign.started_at
    ) {
      throw new Error("predictive leader v7 paper ladder campaign cursor is invalid");
    }
    return campaign;
  }

  #requirePredictiveLeaderV7PaperLadderCampaign(source, instrument) {
    const campaign = this.#predictiveLeaderV7PaperLadderCampaignRow(source, instrument);
    if (!campaign) {
      throw new RangeError(
        "predictive leader v7 paper ladder campaign is pinned to its frozen stream",
      );
    }
    return campaign;
  }

  #insertPredictiveLeaderV7PaperLadderResetInTransaction({
    campaign,
    bet = null,
    incidentId = null,
    continuityEpoch = null,
    reason,
    cycleStakedBefore,
    ladderLossBefore,
    ladderMissCountBefore,
    nextStakeBefore,
    occurredAt,
  }) {
    const nextCycleNumber = Number(campaign.cycle_number) + 1;
    const insertion = this.sqlite.prepare(`
      INSERT INTO predictive_leader_v7_paper_ladder_resets (
        campaign_id, trigger_bet_id, incident_id, continuity_epoch, reason,
        cycle_number_before, cycle_number_after,
        cycle_staked_before, ladder_loss_before, ladder_miss_count_before,
        next_stake_before, next_stake_after, occurred_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `).run(
      Number(campaign.id),
      bet === null ? null : Number(bet.id),
      incidentId,
      continuityEpoch,
      reason,
      Number(campaign.cycle_number),
      nextCycleNumber,
      Number(cycleStakedBefore),
      Number(ladderLossBefore),
      Number(ladderMissCountBefore),
      Number(nextStakeBefore),
      PREDICTIVE_LEADER_V7_PAPER_LADDER_CAMPAIGN.model.initialStake,
      occurredAt,
      occurredAt,
    );
    const reset = this.sqlite.prepare(`
      SELECT *
      FROM predictive_leader_v7_paper_ladder_resets
      WHERE campaign_id = ? AND reason = ?
        AND (
          (? IS NOT NULL AND trigger_bet_id = ?)
          OR (? IS NOT NULL AND incident_id = ?)
        )
    `).get(
      Number(campaign.id),
      reason,
      bet === null ? null : Number(bet.id),
      bet === null ? null : Number(bet.id),
      incidentId,
      incidentId,
    );
    if (
      !reset
      || (reason === "integrity_gap"
        ? reset.trigger_bet_id !== null
          || Number(reset.incident_id) !== Number(incidentId)
          || Number(reset.continuity_epoch) !== Number(continuityEpoch)
        : Number(reset.trigger_bet_id) !== Number(bet?.id)
          || reset.incident_id !== null
          || reset.continuity_epoch !== null)
      || Number(reset.cycle_number_before) !== Number(campaign.cycle_number)
      || Number(reset.cycle_number_after) !== nextCycleNumber
      || Number(reset.cycle_staked_before) !== Number(cycleStakedBefore)
      || Number(reset.ladder_loss_before) !== Number(ladderLossBefore)
      || Number(reset.ladder_miss_count_before) !== Number(ladderMissCountBefore)
      || Number(reset.next_stake_before) !== Number(nextStakeBefore)
    ) {
      throw new Error("predictive leader v7 paper ladder reset audit is invalid");
    }
    return { reset, inserted: Number(insertion.changes) === 1 };
  }

  #voidPredictiveLeaderV7PaperLadderBetInTransaction({
    campaign,
    bet,
    reason,
    incidentId = null,
    continuityEpoch = null,
    voidedAt,
  }) {
    const existingVoid = this.sqlite.prepare(`
      SELECT bet_id
      FROM predictive_leader_v7_paper_ladder_voids
      WHERE bet_id = ?
    `).get(Number(bet.id));
    if (existingVoid) {
      return { voided: 0, reset: 0, reason: "already_void", forecastId: Number(bet.forecast_id) };
    }
    if (!["pending", "settled"].includes(bet.status)) {
      throw new Error("predictive leader v7 paper ladder void source status is invalid");
    }
    const requestedVoidedAt = asTimestamp(
      voidedAt,
      undefined,
      "predictive leader v7 paper ladder voidedAt",
    );
    const safeVoidedAt = new Date(Math.max(
      Date.parse(requestedVoidedAt),
      Date.parse(campaign.updated_at),
      Date.parse(bet.updated_at),
      Date.parse(bet.settled_at ?? bet.placed_at),
    )).toISOString();
    const balanceAdjustment = bet.status === "pending"
      ? Number(bet.stake)
      : Number(bet.stake) - Number(bet.gross_payout);
    const insertion = this.sqlite.prepare(`
      INSERT INTO predictive_leader_v7_paper_ladder_voids (
        bet_id, campaign_id, prior_status, reason, balance_adjustment,
        incident_id, continuity_epoch, voided_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(bet_id) DO NOTHING
    `).run(
      Number(bet.id),
      Number(campaign.id),
      bet.status,
      reason,
      balanceAdjustment,
      incidentId,
      continuityEpoch,
      safeVoidedAt,
      safeVoidedAt,
    );
    if (Number(insertion.changes) !== 1) {
      return { voided: 0, reset: 0, reason: "already_void", forecastId: Number(bet.forecast_id) };
    }
    if (bet.status === "pending") {
      const update = this.sqlite.prepare(`
        UPDATE predictive_leader_v7_paper_ladder_bets
        SET status = 'void', void_reason = ?, void_incident_id = ?,
          void_continuity_epoch = ?, voided_at = ?, updated_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(
        reason,
        incidentId,
        continuityEpoch,
        safeVoidedAt,
        safeVoidedAt,
        Number(bet.id),
      );
      if (Number(update.changes) !== 1) {
        throw new Error("predictive leader v7 paper ladder pending bet was not voided exactly once");
      }
    }
    const effectiveUpdatedAt = campaign.updated_at > safeVoidedAt
      ? campaign.updated_at
      : safeVoidedAt;
    const nextStake = Number(campaign.next_stake);
    const effectiveBalance = Number(campaign.current_balance)
      - Number(campaign.ledger_deficit)
      + balanceAdjustment;
    const currentBalance = Math.max(0, effectiveBalance);
    const ledgerDeficit = Math.max(0, -effectiveBalance);
    const pendingAfterVoid = this.sqlite.prepare(`
      SELECT 1
      FROM predictive_leader_v7_paper_ladder_bets AS bets
      LEFT JOIN predictive_leader_v7_paper_ladder_voids AS voids
        ON voids.bet_id = bets.id
      WHERE bets.campaign_id = ? AND bets.status = 'pending'
        AND voids.bet_id IS NULL
      LIMIT 1
    `).get(Number(campaign.id));
    const exhausted = ledgerDeficit > 0
      || (!pendingAfterVoid && currentBalance < nextStake);
    const campaignUpdate = this.sqlite.prepare(`
      UPDATE predictive_leader_v7_paper_ladder_campaigns
      SET status = ?, current_balance = ?, ledger_deficit = ?,
        ledger_revision = ledger_revision + 1, updated_at = ?, exhausted_at = ?
      WHERE id = ? AND current_balance = ? AND ledger_deficit = ?
    `).run(
      exhausted ? "exhausted" : "running",
      currentBalance,
      ledgerDeficit,
      effectiveUpdatedAt,
      exhausted ? campaign.exhausted_at ?? effectiveUpdatedAt : null,
      Number(campaign.id),
      Number(campaign.current_balance),
      Number(campaign.ledger_deficit),
    );
    if (Number(campaignUpdate.changes) !== 1) {
      throw new Error("predictive leader v7 paper ladder campaign void adjustment failed");
    }
    return {
      voided: 1,
      reset: 0,
      reason,
      forecastId: Number(bet.forecast_id),
      balanceAdjustment,
    };
  }

  #voidPredictiveLeaderV7PaperLadderForMetadataConflictInTransaction({
    source,
    instrument,
    externalRoundId,
    voidedAt,
  }) {
    const campaign = this.#predictiveLeaderV7PaperLadderCampaignRow(source, instrument);
    if (!campaign) return { voided: 0, reset: 0, reason: "outside_frozen_stream" };
    const conflict = this.sqlite.prepare(`
      SELECT 1
      FROM predictive_shadow_round_metadata_conflicts
      WHERE boundary_key = 'predictive-shadow-metadata-integrity-v1'
        AND source = ? AND instrument = ? AND external_round_id = ?
    `).get(source, instrument, externalRoundId);
    if (!conflict) return { voided: 0, reset: 0, reason: "metadata_matches" };
    const bet = this.sqlite.prepare(`
      SELECT bets.*
      FROM predictive_leader_v7_paper_ladder_bets AS bets
      LEFT JOIN predictive_leader_v7_paper_ladder_voids AS voids
        ON voids.bet_id = bets.id
      WHERE bets.campaign_id = ? AND bets.external_round_id = ?
        AND bets.status IN ('pending', 'settled')
        AND voids.bet_id IS NULL
      ORDER BY bets.id DESC
      LIMIT 1
    `).get(Number(campaign.id), externalRoundId);
    if (!bet) return { voided: 0, reset: 0, reason: "no_affected_bet" };
    return this.#voidPredictiveLeaderV7PaperLadderBetInTransaction({
      campaign,
      bet,
      reason: "round_metadata_conflict",
      voidedAt,
    });
  }

  #advancePredictiveLeaderV7PaperResolvedGapMarkerInTransaction({
    campaign,
    incident,
    updatedAt,
  }) {
    const effectiveUpdatedAt = new Date(Math.max(
      Date.parse(campaign.updated_at),
      Date.parse(updatedAt),
      Date.parse(incident.created_at),
    )).toISOString();
    const update = this.sqlite.prepare(`
      UPDATE predictive_leader_v7_paper_ladder_campaigns
      SET last_gap_incident_id = ?, updated_at = ?
      WHERE id = ? AND last_gap_incident_id = ?
        AND last_continuity_epoch = ?
    `).run(
      Number(incident.id),
      effectiveUpdatedAt,
      Number(campaign.id),
      Number(campaign.last_gap_incident_id),
      Number(campaign.last_continuity_epoch),
    );
    if (Number(update.changes) !== 1) {
      throw new Error("predictive leader v7 paper resolved gap marker failed");
    }
  }

  #applyPredictiveLeaderV7PaperLadderGapResetInTransaction({
    campaign,
    incident,
    continuityEpoch,
    updatedAt,
  }) {
    const nextEpoch = Number(continuityEpoch);
    if (
      !Number.isSafeInteger(nextEpoch)
      || nextEpoch !== Number(campaign.last_continuity_epoch) + 1
      || Number(incident.id) <= Number(campaign.last_gap_incident_id)
    ) {
      throw new Error("predictive leader v7 paper ladder gap cursor is invalid");
    }
    const pending = this.sqlite.prepare(`
      SELECT 1
      FROM predictive_leader_v7_paper_ladder_bets AS bets
      LEFT JOIN predictive_leader_v7_paper_ladder_voids AS voids
        ON voids.bet_id = bets.id
      WHERE bets.campaign_id = ? AND bets.status = 'pending'
        AND voids.bet_id IS NULL
      LIMIT 1
    `).get(Number(campaign.id));
    if (pending) {
      throw new Error("predictive leader v7 paper ladder gap reset cannot cross a pending bet");
    }
    const effectiveUpdatedAt = new Date(Math.max(
      Date.parse(campaign.updated_at),
      Date.parse(updatedAt),
      Date.parse(incident.created_at),
    )).toISOString();
    const reset = this.#insertPredictiveLeaderV7PaperLadderResetInTransaction({
      campaign,
      incidentId: Number(incident.id),
      continuityEpoch: nextEpoch,
      reason: "integrity_gap",
      cycleStakedBefore: Number(campaign.cycle_staked),
      ladderLossBefore: Number(campaign.ladder_loss),
      ladderMissCountBefore: Number(campaign.ladder_miss_count),
      nextStakeBefore: Number(campaign.next_stake),
      occurredAt: effectiveUpdatedAt,
    });
    if (!reset.inserted) {
      throw new Error("predictive leader v7 paper ladder gap reset was not inserted");
    }
    const nextStake = PREDICTIVE_LEADER_V7_PAPER_LADDER_CAMPAIGN.model.initialStake;
    const exhausted = Number(campaign.ledger_deficit) > 0
      || Number(campaign.current_balance) < nextStake;
    const update = this.sqlite.prepare(`
      UPDATE predictive_leader_v7_paper_ladder_campaigns
      SET status = ?, cycle_number = cycle_number + 1,
        cycle_staked = 0, ladder_loss = 0, ladder_miss_count = 0,
        reset_count = reset_count + 1, next_stake = ?,
        ledger_revision = ledger_revision + 1,
        last_continuity_epoch = ?, last_gap_incident_id = ?,
        continuity_gap_count = continuity_gap_count + 1,
        updated_at = ?, exhausted_at = ?
      WHERE id = ? AND current_balance = ? AND ledger_deficit = ?
        AND cycle_number = ? AND cycle_staked = ? AND ladder_loss = ?
        AND ladder_miss_count = ? AND reset_count = ? AND next_stake = ?
        AND last_continuity_epoch = ? AND last_gap_incident_id = ?
    `).run(
      exhausted ? "exhausted" : "running",
      nextStake,
      nextEpoch,
      Number(incident.id),
      effectiveUpdatedAt,
      exhausted ? campaign.exhausted_at ?? effectiveUpdatedAt : null,
      Number(campaign.id),
      Number(campaign.current_balance),
      Number(campaign.ledger_deficit),
      Number(campaign.cycle_number),
      Number(campaign.cycle_staked),
      Number(campaign.ladder_loss),
      Number(campaign.ladder_miss_count),
      Number(campaign.reset_count),
      Number(campaign.next_stake),
      Number(campaign.last_continuity_epoch),
      Number(campaign.last_gap_incident_id),
    );
    if (Number(update.changes) !== 1) {
      throw new Error("predictive leader v7 paper ladder gap reset update failed");
    }
    return {
      settled: 0,
      voided: 0,
      reset: 1,
      resetReason: "integrity_gap",
      reason: "integrity_gap",
    };
  }

  #reconcilePredictiveLeaderV7PaperLadderGapsInTransaction(
    source,
    instrument,
    updatedAt,
  ) {
    let campaign = this.#predictiveLeaderV7PaperLadderCampaignRow(source, instrument);
    if (!campaign) {
      return { settled: 0, voided: 0, reset: 0, reason: "outside_frozen_stream" };
    }
    let settled = 0;
    let voided = 0;
    let reset = 0;
    let forecastId;
    let settlementReason = null;
    for (;;) {
      const incident = this.sqlite.prepare(`
        SELECT incidents.*,
          incident_resolutions.incident_id AS resolved_incident_id
        FROM incidents
        LEFT JOIN incident_resolutions
          ON incident_resolutions.incident_id = incidents.id
        WHERE incidents.kind = 'gap'
          AND incidents.source = ? AND incidents.instrument = ?
          AND incidents.id > ?
        ORDER BY incidents.id
        LIMIT 1
      `).get(source, instrument, Number(campaign.last_gap_incident_id));
      if (!incident) break;
      if (incident.resolved_incident_id !== null) {
        this.#advancePredictiveLeaderV7PaperResolvedGapMarkerInTransaction({
          campaign,
          incident,
          updatedAt,
        });
        campaign = this.#requirePredictiveLeaderV7PaperLadderCampaign(
          source,
          instrument,
        );
        continue;
      }
      const nextEpoch = Number(campaign.last_continuity_epoch) + 1;
      const currentEpoch = this.#continuityEpoch(source, instrument);
      if (nextEpoch > currentEpoch) {
        throw new Error("predictive leader v7 paper ladder gap epoch is missing");
      }
      const pending = this.sqlite.prepare(`
        SELECT bets.*
        FROM predictive_leader_v7_paper_ladder_bets AS bets
        LEFT JOIN predictive_leader_v7_paper_ladder_voids AS voids
          ON voids.bet_id = bets.id
        WHERE bets.campaign_id = ? AND bets.status = 'pending'
          AND voids.bet_id IS NULL
        LIMIT 1
      `).get(Number(campaign.id));
      if (pending) {
        if (Number(pending.continuity_epoch) !== Number(campaign.last_continuity_epoch)) {
          throw new Error("predictive leader v7 paper ladder pending epoch is invalid");
        }
        if (this.#predictiveLeaderV7PaperBetHasResolvableResult({
          source,
          instrument,
          bet: pending,
        })) {
          const outcome = this.#settlePredictiveLeaderV7PaperLadderInTransaction(
            source,
            instrument,
            updatedAt,
          );
          if (
            Number(outcome.settled ?? 0) !== 1
            && Number(outcome.voided ?? 0) === 0
          ) {
            return {
              settled,
              voided,
              reset,
              resetReason: reset > 0 ? "integrity_gap" : null,
              reason: outcome.reason,
              forecastId,
            };
          }
          settled += Number(outcome.settled ?? 0);
          voided += Number(outcome.voided ?? 0);
          reset += Number(outcome.reset ?? 0);
          forecastId = outcome.forecastId;
          settlementReason = outcome.reason;
        } else {
          const gapVoidedAt = new Date(Math.max(
            Date.parse(updatedAt),
            Date.parse(incident.created_at),
            Date.parse(campaign.updated_at),
            Date.parse(pending.placed_at),
          )).toISOString();
          const outcome = this.#voidPredictiveLeaderV7PaperLadderBetInTransaction({
            campaign,
            bet: pending,
            reason: "integrity_gap",
            incidentId: Number(incident.id),
            continuityEpoch: nextEpoch,
            voidedAt: gapVoidedAt,
          });
          voided += Number(outcome.voided ?? 0);
          forecastId = outcome.forecastId;
        }
        campaign = this.#requirePredictiveLeaderV7PaperLadderCampaign(
          source,
          instrument,
        );
      }
      const gapReset = this.#applyPredictiveLeaderV7PaperLadderGapResetInTransaction({
        campaign,
        incident,
        continuityEpoch: nextEpoch,
        updatedAt,
      });
      reset += gapReset.reset;
      campaign = this.#requirePredictiveLeaderV7PaperLadderCampaign(source, instrument);
    }
    const currentEpoch = this.#continuityEpoch(source, instrument);
    if (Number(campaign.last_continuity_epoch) !== currentEpoch) {
      throw new Error("predictive leader v7 paper ladder gap audit is incomplete");
    }
    return {
      settled,
      voided,
      reset,
      resetReason: reset > 0 ? "integrity_gap" : null,
      reason: settlementReason ?? (reset > 0 ? "integrity_gap" : "no_pending_bet"),
      forecastId,
    };
  }

  #voidPredictiveLeaderV7PaperLadderForGapInTransaction({
    source,
    instrument,
    incidentId,
    continuityEpoch,
    voidedAt,
  }) {
    const safeIncidentId = Number(incidentId);
    const safeContinuityEpoch = Number(continuityEpoch);
    if (
      !Number.isSafeInteger(safeIncidentId)
      || safeIncidentId < 1
      || !Number.isSafeInteger(safeContinuityEpoch)
      || safeContinuityEpoch < 1
    ) {
      throw new Error("predictive leader v7 paper ladder gap cursor is invalid");
    }
    const scopedCampaign = this.#predictiveLeaderV7PaperLadderCampaignRow(
      source,
      instrument,
    );
    if (!scopedCampaign) {
      return { settled: 0, voided: 0, reset: 0, reason: "outside_frozen_stream" };
    }
    const incident = this.sqlite.prepare(`
      SELECT id FROM incidents
      WHERE id = ? AND kind = 'gap' AND source = ? AND instrument = ?
    `).get(safeIncidentId, source, instrument);
    if (!incident) {
      throw new Error("predictive leader v7 paper ladder gap cursor is invalid");
    }
    const outcome = this.#reconcilePredictiveLeaderV7PaperLadderGapsInTransaction(
      source,
      instrument,
      voidedAt,
    );
    const resetRow = this.sqlite.prepare(`
      SELECT continuity_epoch
      FROM predictive_leader_v7_paper_ladder_resets
      WHERE incident_id = ? AND reason = 'integrity_gap'
    `).get(safeIncidentId);
    const resolved = this.sqlite.prepare(`
      SELECT 1 FROM incident_resolutions WHERE incident_id = ?
    `).get(safeIncidentId);
    const campaign = this.#requirePredictiveLeaderV7PaperLadderCampaign(
      source,
      instrument,
    );
    const alreadyCoveredByActivation = safeIncidentId
      <= Number(campaign.activation_gap_incident_id);
    if (
      resetRow
      && Number(resetRow.continuity_epoch) > safeContinuityEpoch
    ) {
      throw new Error("predictive leader v7 paper ladder gap epoch is invalid");
    }
    if (
      !resetRow
      && !resolved
      && !alreadyCoveredByActivation
      && outcome.reason !== "awaiting_authoritative_result"
    ) {
      throw new Error("predictive leader v7 paper ladder gap was not durably handled");
    }
    return outcome;
  }

  #voidPredictiveLeaderV7PaperForMetadataConflictInTransaction(details) {
    const fixed = this.#voidPredictiveLeaderV7FixedPaperForMetadataConflictInTransaction(
      details,
    );
    const ladder = this.#voidPredictiveLeaderV7PaperLadderForMetadataConflictInTransaction(
      details,
    );
    return {
      voided: Number(fixed.voided ?? 0) + Number(ladder.voided ?? 0),
      reset: Number(ladder.reset ?? 0),
      reason: ladder.voided > 0 ? ladder.reason : fixed.reason,
      fixed,
      ladder,
    };
  }

  #voidPredictiveLeaderV7PaperForGapInTransaction(details) {
    const fixed = this.#voidPredictiveLeaderV7FixedPaperForGapInTransaction(details);
    const ladder = this.#voidPredictiveLeaderV7PaperLadderForGapInTransaction(details);
    return {
      voided: Number(fixed.voided ?? 0) + Number(ladder.voided ?? 0),
      reset: Number(ladder.reset ?? 0),
      reason: ladder.voided > 0 ? ladder.reason : fixed.reason,
      fixed,
      ladder,
    };
  }

  #settlePredictiveLeaderV7PaperLadderInTransaction(source, instrument, updatedAt) {
    let campaign = this.#predictiveLeaderV7PaperLadderCampaignRow(source, instrument);
    if (!campaign) {
      return { settled: 0, voided: 0, reset: 0, reason: "outside_frozen_stream" };
    }
    const pending = this.sqlite.prepare(`
      SELECT
        bets.*,
        settlements.round_result_id AS settlement_result_id,
        settlements.actual_number AS settlement_actual_number,
        settlements.settled_at AS settlement_occurred_at,
        results.source AS result_source,
        results.instrument AS result_instrument,
        results.external_round_id AS result_external_round_id,
        results.result_number AS stored_result_number,
        results.settled_at AS result_occurred_at,
        conflicts.reason AS conflict_reason
      FROM predictive_leader_v7_paper_ladder_bets AS bets
      JOIN round_forecasts AS forecasts ON forecasts.id = bets.forecast_id
      JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
      LEFT JOIN forecast_settlements AS settlements
        ON settlements.forecast_id = bets.forecast_id
      LEFT JOIN round_results AS results ON results.id = settlements.round_result_id
      LEFT JOIN predictive_shadow_round_metadata_conflicts AS conflicts
        ON conflicts.boundary_key = 'predictive-shadow-metadata-integrity-v1'
       AND conflicts.source = snapshots.source
       AND conflicts.instrument = snapshots.instrument
       AND conflicts.external_round_id = snapshots.external_round_id
      LEFT JOIN predictive_leader_v7_paper_ladder_voids AS voids
        ON voids.bet_id = bets.id
      WHERE bets.campaign_id = ? AND bets.status = 'pending'
        AND voids.bet_id IS NULL
      LIMIT 1
    `).get(Number(campaign.id));
    if (!pending) {
      return { settled: 0, voided: 0, reset: 0, reason: "no_pending_bet" };
    }
    if (pending.conflict_reason !== null) {
      const outcome = this.#voidPredictiveLeaderV7PaperLadderForMetadataConflictInTransaction({
        source,
        instrument,
        externalRoundId: pending.external_round_id,
        voidedAt: updatedAt,
      });
      return { settled: 0, ...outcome };
    }
    if (pending.settlement_result_id === null) {
      return {
        settled: 0,
        voided: 0,
        reset: 0,
        reason: "awaiting_authoritative_result",
      };
    }
    if (
      pending.result_source !== source
      || pending.result_instrument !== instrument
      || (pending.result_external_round_id !== null
        && pending.result_external_round_id !== pending.external_round_id)
      || Number(pending.settlement_actual_number)
        !== Number(pending.stored_result_number)
      || pending.settlement_occurred_at !== pending.result_occurred_at
    ) {
      throw new Error("predictive leader v7 paper ladder settlement is not authoritative");
    }
    if (Date.parse(pending.result_occurred_at) < Date.parse(pending.placed_at)) {
      throw new Error("predictive leader v7 paper ladder result predates its placement");
    }
    if (
      Number(pending.continuity_epoch) !== Number(campaign.last_continuity_epoch)
      || Number(pending.cycle_number_before) !== Number(campaign.cycle_number)
      || Number(pending.cycle_staked_before) !== Number(campaign.cycle_staked)
      || Number(pending.ladder_loss_before) !== Number(campaign.ladder_loss)
      || Number(pending.ladder_miss_count_before)
        !== Number(campaign.ladder_miss_count)
      || Number(pending.stake) !== Number(campaign.next_stake)
    ) {
      throw new Error("predictive leader v7 paper ladder pending cursor is invalid");
    }
    const effectiveUpdatedAt = new Date(Math.max(
      Date.parse(campaign.updated_at),
      Date.parse(updatedAt),
      Date.parse(pending.result_occurred_at),
    )).toISOString();
    const resultNumber = Number(pending.stored_result_number);
    const stake = Number(pending.stake);
    const ladderSettlement = settlePredictiveLeaderV7PaperLadderBet({
      targetNumber: Number(pending.target_number),
      resultNumber,
      stake,
      balanceBefore: Number(pending.balance_before),
      cycleSpendBefore: Number(pending.cycle_staked_before),
      ladderLossBefore: Number(pending.ladder_loss_before),
      cycleMissCountBefore: Number(pending.ladder_miss_count_before),
    });
    if (Number(pending.raw_stake) !== ladderSettlement.rawStakeBefore) {
      throw new Error("predictive leader v7 paper ladder raw stake is invalid");
    }
    const hit = ladderSettlement.outcome === "hit";
    const grossPayout = ladderSettlement.grossPayout;
    const historicalBalanceAfter = ladderSettlement.balanceAfter;
    const cycleStakedAtSettlement = ladderSettlement.cycleSpendAtSettlement;
    const resetReason = ladderSettlement.resetReason;
    const cycleNumberAfter = Number(pending.cycle_number_before)
      + Number(resetReason !== null);
    const cycleStakedAfter = ladderSettlement.cycleSpendAfter;
    const ladderLossAfter = ladderSettlement.ladderLossAfter;
    const ladderMissCountAfter = ladderSettlement.cycleMissCountAfter;
    const nextStakeAfter = ladderSettlement.nextStakeAfter;
    const betUpdate = this.sqlite.prepare(`
      UPDATE predictive_leader_v7_paper_ladder_bets
      SET status = 'settled', round_result_id = ?, result_number = ?, outcome = ?,
        gross_payout = ?, balance_after = ?, cycle_number_after = ?,
        cycle_staked_at_settlement = ?, cycle_staked_after = ?,
        ladder_loss_after = ?, ladder_miss_count_after = ?, next_stake_after = ?,
        reset_reason = ?, settled_at = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(
      Number(pending.settlement_result_id),
      resultNumber,
      hit ? "hit" : "miss",
      grossPayout,
      historicalBalanceAfter,
      cycleNumberAfter,
      cycleStakedAtSettlement,
      cycleStakedAfter,
      ladderLossAfter,
      ladderMissCountAfter,
      nextStakeAfter,
      resetReason,
      pending.result_occurred_at,
      effectiveUpdatedAt,
      Number(pending.id),
    );
    if (Number(betUpdate.changes) !== 1) {
      throw new Error("predictive leader v7 paper ladder bet was not settled exactly once");
    }
    let reset = null;
    if (resetReason !== null) {
      reset = this.#insertPredictiveLeaderV7PaperLadderResetInTransaction({
        campaign,
        bet: pending,
        reason: resetReason,
        cycleStakedBefore: cycleStakedAtSettlement,
        ladderLossBefore: hit
          ? Number(pending.ladder_loss_before)
          : ladderSettlement.ladderLossBefore + stake,
        ladderMissCountBefore: ladderSettlement.cycleMissCountAtSettlement,
        nextStakeBefore: stake,
        occurredAt: effectiveUpdatedAt,
      });
      if (!reset.inserted) {
        throw new Error("predictive leader v7 paper ladder settlement reset was not inserted");
      }
    }
    const effectiveBalance = Number(campaign.current_balance)
      - Number(campaign.ledger_deficit)
      + grossPayout;
    const currentBalance = Math.max(0, effectiveBalance);
    const ledgerDeficit = Math.max(0, -effectiveBalance);
    const exhausted = ledgerDeficit > 0 || currentBalance < nextStakeAfter;
    const campaignUpdate = this.sqlite.prepare(`
      UPDATE predictive_leader_v7_paper_ladder_campaigns
      SET status = ?, current_balance = ?, ledger_deficit = ?,
        cycle_number = ?, cycle_staked = ?, ladder_loss = ?,
        ladder_miss_count = ?, reset_count = ?, next_stake = ?,
        ledger_revision = ledger_revision + 1, updated_at = ?, exhausted_at = ?
      WHERE id = ? AND current_balance = ? AND ledger_deficit = ?
        AND cycle_number = ? AND cycle_staked = ? AND ladder_loss = ?
        AND ladder_miss_count = ? AND reset_count = ? AND next_stake = ?
    `).run(
      exhausted ? "exhausted" : "running",
      currentBalance,
      ledgerDeficit,
      cycleNumberAfter,
      cycleStakedAfter,
      ladderLossAfter,
      ladderMissCountAfter,
      Number(campaign.reset_count) + Number(resetReason !== null),
      nextStakeAfter,
      effectiveUpdatedAt,
      exhausted ? campaign.exhausted_at ?? effectiveUpdatedAt : null,
      Number(campaign.id),
      Number(campaign.current_balance),
      Number(campaign.ledger_deficit),
      Number(campaign.cycle_number),
      Number(campaign.cycle_staked),
      Number(campaign.ladder_loss),
      Number(campaign.ladder_miss_count),
      Number(campaign.reset_count),
      Number(campaign.next_stake),
    );
    if (Number(campaignUpdate.changes) !== 1) {
      throw new Error("predictive leader v7 paper ladder campaign settlement failed");
    }
    return {
      settled: 1,
      voided: 0,
      reset: Number(resetReason !== null),
      resetReason,
      reason: hit ? "hit" : "miss",
      forecastId: Number(pending.forecast_id),
      stake,
    };
  }

  #reconcilePredictiveLeaderV7PaperLadderInTransaction(source, instrument, updatedAt) {
    let campaign = this.#predictiveLeaderV7PaperLadderCampaignRow(source, instrument);
    if (!campaign) {
      return { settled: 0, voided: 0, reset: 0, reason: "outside_frozen_stream" };
    }
    let voided = 0;
    let forecastId;
    const pending = this.sqlite.prepare(`
      SELECT bets.*
      FROM predictive_leader_v7_paper_ladder_bets AS bets
      LEFT JOIN predictive_leader_v7_paper_ladder_voids AS voids
        ON voids.bet_id = bets.id
      WHERE bets.campaign_id = ? AND bets.status = 'pending'
        AND voids.bet_id IS NULL
      LIMIT 1
    `).get(Number(campaign.id));
    if (pending) {
      const conflict = this.sqlite.prepare(`
        SELECT 1
        FROM predictive_shadow_round_metadata_conflicts
        WHERE boundary_key = 'predictive-shadow-metadata-integrity-v1'
          AND source = ? AND instrument = ? AND external_round_id = ?
      `).get(source, instrument, pending.external_round_id);
      if (conflict) {
        const outcome = this.#voidPredictiveLeaderV7PaperLadderForMetadataConflictInTransaction({
          source,
          instrument,
          externalRoundId: pending.external_round_id,
          voidedAt: updatedAt,
        });
        voided += Number(outcome.voided ?? 0);
        forecastId = outcome.forecastId;
        campaign = this.#requirePredictiveLeaderV7PaperLadderCampaign(source, instrument);
      }
    }

    const gapOutcome = this.#reconcilePredictiveLeaderV7PaperLadderGapsInTransaction(
      source,
      instrument,
      updatedAt,
    );
    if (
      Number(gapOutcome.settled ?? 0) > 0
      || Number(gapOutcome.voided ?? 0) > 0
      || Number(gapOutcome.reset ?? 0) > 0
      || gapOutcome.reason === "awaiting_authoritative_result"
    ) {
      return {
        ...gapOutcome,
        voided: voided + Number(gapOutcome.voided ?? 0),
        forecastId: gapOutcome.forecastId ?? forecastId,
      };
    }

    const settlement = this.#settlePredictiveLeaderV7PaperLadderInTransaction(
      source,
      instrument,
      updatedAt,
    );
    return {
      ...settlement,
      voided: voided + Number(settlement.voided ?? 0),
      reason: settlement.reason === "no_pending_bet" && voided > 0
        ? "round_metadata_conflict"
        : settlement.reason,
      forecastId: settlement.forecastId ?? forecastId,
    };
  }

  #placePredictiveLeaderV7PaperLadderBetInTransaction({
    source,
    instrument,
    forecastId,
    placedAt,
  }) {
    const campaign = this.#requirePredictiveLeaderV7PaperLadderCampaign(
      source,
      instrument,
    );
    const continuityEpoch = this.#continuityEpoch(source, instrument);
    if (Number(campaign.last_continuity_epoch) !== continuityEpoch) {
      throw new Error("predictive leader v7 paper ladder gap audit is incomplete");
    }
    const safeForecastId = Number(forecastId);
    if (!Number.isSafeInteger(safeForecastId) || safeForecastId < 1) {
      throw new TypeError("forecastId must be a positive safe integer");
    }
    const existing = this.sqlite.prepare(`
      SELECT id
      FROM predictive_leader_v7_paper_ladder_bets
      WHERE campaign_id = ? AND forecast_id = ?
    `).get(Number(campaign.id), safeForecastId);
    if (existing) {
      return { placed: 0, reason: "already_recorded", forecastId: safeForecastId };
    }
    const pending = this.sqlite.prepare(`
      SELECT id
      FROM predictive_leader_v7_paper_ladder_bets
      WHERE campaign_id = ? AND status = 'pending'
    `).get(Number(campaign.id));
    if (pending) return { placed: 0, reason: "prior_pending", forecastId: safeForecastId };
    const stake = Number(campaign.next_stake);
    if (
      campaign.status === "exhausted"
      || Number(campaign.ledger_deficit) > 0
      || Number(campaign.current_balance) < stake
    ) {
      return { placed: 0, reason: "bankroll_exhausted", forecastId: safeForecastId };
    }
    const candidate = this.sqlite.prepare(`
      SELECT
        leaders.*,
        snapshots.source,
        snapshots.instrument,
        snapshots.external_round_id,
        snapshots.locked_at AS forecast_locked_at,
        snapshots.betting_closes_at,
        settlements.forecast_id AS settlement_forecast_id,
        conflicts.reason AS conflict_reason,
        results.id AS known_result_id
      FROM forecast_predictive_leader_v7_snapshots AS leaders
      JOIN round_forecasts AS forecasts ON forecasts.id = leaders.forecast_id
      JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
      LEFT JOIN forecast_settlements AS settlements
        ON settlements.forecast_id = leaders.forecast_id
      LEFT JOIN predictive_shadow_round_metadata_conflicts AS conflicts
        ON conflicts.boundary_key = 'predictive-shadow-metadata-integrity-v1'
       AND conflicts.source = snapshots.source
       AND conflicts.instrument = snapshots.instrument
       AND conflicts.external_round_id = snapshots.external_round_id
      LEFT JOIN round_results AS results
        ON results.source = snapshots.source
       AND results.instrument = snapshots.instrument
       AND results.external_round_id = snapshots.external_round_id
      WHERE leaders.forecast_id = ? AND leaders.candidate_key = ?
    `).get(safeForecastId, campaign.candidate_key);
    if (!candidate) {
      return { placed: 0, reason: "v7_snapshot_unavailable", forecastId: safeForecastId };
    }
    if (
      safeForecastId < Number(campaign.first_forecast_id)
      || candidate.locked_at < campaign.started_at
      || candidate.created_at < campaign.started_at
    ) {
      return { placed: 0, reason: "outside_prospective_boundary", forecastId: safeForecastId };
    }
    if (candidate.source !== source || candidate.instrument !== instrument) {
      throw new Error("predictive leader v7 paper ladder forecast stream is invalid");
    }
    if (candidate.conflict_reason !== null) {
      return { placed: 0, reason: "round_metadata_conflict", forecastId: safeForecastId };
    }
    if (candidate.settlement_forecast_id !== null || candidate.known_result_id !== null) {
      return { placed: 0, reason: "result_already_known", forecastId: safeForecastId };
    }
    const decision = normalizeLearnedLeaderV7Decision(
      deserializeJson(candidate.snapshot_json),
    );
    if (
      !decision
      || candidate.status !== "ready"
      || Number(candidate.selected) !== 1
      || decision.status !== "ready"
      || decision.selection.eligible !== true
      || decision.algorithmVersion !== campaign.algorithm_version
      || decision.config.candidateId !== campaign.candidate_key
      || JSON.stringify(decision.config) !== PREDICTIVE_LEADER_V7_CONFIG_JSON
      || Number(decision.leaderNumber) !== Number(candidate.predicted_number)
      || decision.lockedAt !== candidate.locked_at
      || candidate.locked_at !== candidate.forecast_locked_at
    ) {
      return { placed: 0, reason: "v7_not_ready_selected", forecastId: safeForecastId };
    }
    const safePlacedAt = asTimestamp(
      placedAt,
      undefined,
      "predictive leader v7 paper ladder placedAt",
    );
    if (
      Date.parse(safePlacedAt) < Date.parse(candidate.locked_at)
      || Date.parse(candidate.betting_closes_at) - Date.parse(safePlacedAt)
        < PREDICTIVE_LEADER_V7_PAPER_LADDER_CAMPAIGN.minimumPlacementLeadMs
    ) {
      return { placed: 0, reason: "outside_safe_preclose", forecastId: safeForecastId };
    }
    const rawStake = calculatePredictiveLeaderV7PaperRawStake(
      Number(campaign.ladder_loss),
    );
    const expectedStake = calculatePredictiveLeaderV7PaperNextStake(
      Number(campaign.ladder_loss),
      Number(campaign.cycle_staked),
    );
    if (stake !== expectedStake) {
      throw new Error("predictive leader v7 paper ladder next stake is invalid");
    }
    const insertion = this.sqlite.prepare(`
      INSERT INTO predictive_leader_v7_paper_ladder_bets (
        campaign_id, forecast_id, candidate_key, external_round_id,
        continuity_epoch, target_number, stake, raw_stake, balance_before,
        cycle_number_before, cycle_staked_before, ladder_loss_before,
        ladder_miss_count_before, locked_at, betting_closes_at,
        status, placed_at, updated_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(
      Number(campaign.id),
      safeForecastId,
      campaign.candidate_key,
      candidate.external_round_id,
      continuityEpoch,
      Number(candidate.predicted_number),
      stake,
      rawStake,
      Number(campaign.current_balance),
      Number(campaign.cycle_number),
      Number(campaign.cycle_staked),
      Number(campaign.ladder_loss),
      Number(campaign.ladder_miss_count),
      candidate.locked_at,
      candidate.betting_closes_at,
      safePlacedAt,
      safePlacedAt,
      safePlacedAt,
    );
    const campaignUpdate = this.sqlite.prepare(`
      UPDATE predictive_leader_v7_paper_ladder_campaigns
      SET current_balance = current_balance - ?,
        ledger_revision = ledger_revision + 1, updated_at = ?
      WHERE id = ? AND status = 'running' AND current_balance = ?
        AND ledger_deficit = 0 AND cycle_number = ?
        AND cycle_staked = ? AND ladder_loss = ?
        AND ladder_miss_count = ? AND next_stake = ?
        AND last_continuity_epoch = ?
    `).run(
      stake,
      safePlacedAt,
      Number(campaign.id),
      Number(campaign.current_balance),
      Number(campaign.cycle_number),
      Number(campaign.cycle_staked),
      Number(campaign.ladder_loss),
      Number(campaign.ladder_miss_count),
      stake,
      continuityEpoch,
    );
    if (Number(insertion.changes) !== 1 || Number(campaignUpdate.changes) !== 1) {
      throw new Error("predictive leader v7 paper ladder placement was not committed exactly once");
    }
    const commitCheckedAt = asTimestamp(
      this.clock(),
      undefined,
      "predictive leader v7 paper ladder commitCheckedAt",
    );
    if (
      Date.parse(commitCheckedAt) < Date.parse(safePlacedAt)
      || Date.parse(candidate.betting_closes_at) - Date.parse(commitCheckedAt)
        < PREDICTIVE_LEADER_V7_PAPER_LADDER_CAMPAIGN.minimumPlacementLeadMs
    ) {
      throw new RangeError(
        "predictive leader v7 paper ladder transaction must finish at least five seconds before betting closes",
      );
    }
    return {
      placed: 1,
      reason: "bet_frozen",
      forecastId: safeForecastId,
      stake,
    };
  }

  #recordPredictiveLeaderV7Snapshot(forecastId, trajectoryShadow) {
    return this.#transaction(() => {
      const cohort = mapPredictiveLeaderV7Cohort(this.sqlite.prepare(`
        SELECT *
        FROM predictive_leader_v7_cohorts
        WHERE candidate_key = ?
      `).get(PREDICTIVE_LEADER_V7_CANDIDATE_CONFIG.candidateId));
      if (!cohort) {
        throw new Error("predictive leader v7 cohort is invalid");
      }
      const boundary = this.sqlite.prepare(`
        SELECT *
        FROM predictive_shadow_integrity_boundaries
        WHERE boundary_key = 'predictive-shadow-metadata-integrity-v1'
          AND v7_candidate_key = ?
      `).get(cohort.candidateId);
      if (
        !boundary
        || boundary.policy_version !== "metadata-conflict-void-v1"
        || !Number.isSafeInteger(Number(boundary.first_forecast_id))
        || Number(boundary.first_forecast_id) < 1
        || boundary.started_at !== boundary.created_at
      ) {
        throw new Error("predictive shadow v29 boundary is invalid");
      }

      const parent = this.sqlite.prepare(`
        SELECT
          forecasts.id AS forecast_id,
          snapshots.source,
          snapshots.instrument,
          snapshots.external_round_id,
          snapshots.horizon_seconds,
          snapshots.locked_at,
          snapshots.betting_closes_at,
          settlements.forecast_id AS settlement_forecast_id,
          settlements.round_result_id,
          settlements.actual_number,
          settlements.settled_at,
          settlements.created_at AS settlement_created_at,
          leaders.forecast_id AS leader_forecast_id,
          leaders.schema_version AS leader_schema_version,
          leaders.algorithm_version AS leader_algorithm_version,
          leaders.status AS leader_status,
          leaders.locked_at AS leader_locked_at,
          leaders.history_max_result_id AS leader_history_max_result_id,
          leaders.training_through_forecast_id
            AS leader_training_through_forecast_id,
          leaders.training_through_result_id
            AS leader_training_through_result_id,
          leader_training_settlements.round_result_id
            AS leader_expected_training_result_id,
          leaders.training_count AS leader_training_count,
          leaders.predicted_number AS leader_predicted_number,
          leaders.score AS leader_score,
          leaders.snapshot_json AS leader_snapshot_json,
          leaders.created_at AS leader_created_at
        FROM round_forecasts AS forecasts
        JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
        LEFT JOIN forecast_settlements AS settlements
          ON settlements.forecast_id = forecasts.id
        LEFT JOIN forecast_predictive_leader_snapshots AS leaders
          ON leaders.forecast_id = forecasts.id
        LEFT JOIN forecast_settlements AS leader_training_settlements
          ON leader_training_settlements.forecast_id =
            leaders.training_through_forecast_id
        WHERE forecasts.id = ?
      `).get(forecastId);
      if (!parent) throw new Error("predictive leader v7 parent forecast is missing");
      if (
        parent.source !== cohort.source
        || parent.instrument !== cohort.instrument
      ) {
        return { inserted: false, reason: "outside_frozen_stream" };
      }
      if (
        forecastId < Number(boundary.first_forecast_id)
        || Number(parent.horizon_seconds) !== cohort.forecastHorizonSeconds
        || parent.locked_at < boundary.started_at
      ) {
        return { inserted: false, reason: "outside_prospective_boundary" };
      }
      const metadataConflict = this.sqlite.prepare(`
        SELECT 1
        FROM predictive_shadow_round_metadata_conflicts
        WHERE boundary_key = 'predictive-shadow-metadata-integrity-v1'
          AND source = ? AND instrument = ? AND external_round_id = ?
      `).get(parent.source, parent.instrument, parent.external_round_id);
      if (metadataConflict) {
        return { inserted: false, reason: "metadata_conflict" };
      }
      const existing = this.sqlite.prepare(`
        SELECT forecast_id
        FROM forecast_predictive_leader_v7_snapshots
        WHERE forecast_id = ? AND candidate_key = ?
      `).get(forecastId, cohort.candidateId);
      if (existing) return { inserted: false, reason: "already_frozen" };
      if (parent.settlement_forecast_id != null) {
        throw new Error("predictive leader v7 requires an unsettled frozen forecast");
      }
      const knownTarget = this.sqlite.prepare(`
        SELECT id
        FROM round_results
        WHERE source = ? AND instrument = ? AND external_round_id = ?
        LIMIT 1
      `).get(parent.source, parent.instrument, parent.external_round_id);
      if (knownTarget) {
        throw new Error("predictive leader v7 cannot be captured after its result");
      }
      const champion = mapForecastPredictiveLeader(parent);
      if (!champion) {
        return { inserted: false, reason: "champion_snapshot_unavailable" };
      }
      const createdAt = asTimestamp(
        this.clock(),
        undefined,
        "predictive leader v7 createdAt",
      );
      if (
        Date.parse(createdAt) < Date.parse(parent.locked_at)
        || Date.parse(parent.betting_closes_at) - Date.parse(createdAt) < 5_000
      ) {
        throw new RangeError(
          "predictive leader v7 must be stored at least five seconds before betting closes",
        );
      }
      const decision = buildLearnedLeaderV7Decision({
        sources: predictiveLeaderV7SourcesFromChampion(champion, trajectoryShadow, {
          forecastId,
          lockedAt: parent.locked_at,
        }),
        config: cohort.config,
        lockedAt: parent.locked_at,
        tieSeed: champion.tieSeed,
      });
      const normalized = normalizeLearnedLeaderV7Decision(decision);
      if (
        !normalized
        || JSON.stringify(normalized.config) !== PREDICTIVE_LEADER_V7_CONFIG_JSON
      ) {
        throw new Error("predictive leader v7 builder returned an invalid snapshot");
      }
      this.sqlite.prepare(`
        INSERT INTO forecast_predictive_leader_v7_snapshots (
          forecast_id, candidate_key, schema_version, algorithm_version,
          config_version, target_horizon, config_sha256, status, locked_at,
          history_max_result_id, predicted_number, leader_mass, margin,
          selected, snapshot_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        forecastId,
        cohort.candidateId,
        cohort.schemaVersion,
        cohort.algorithmVersion,
        cohort.configVersion,
        cohort.targetHorizon,
        cohort.configSha256,
        normalized.status,
        normalized.lockedAt,
        champion.historyMaxResultId,
        normalized.leaderNumber,
        normalized.leaderMass,
        normalized.margin,
        Number(normalized.selection.eligible),
        JSON.stringify(normalized),
        createdAt,
      );
      const commitCheckedAt = asTimestamp(
        this.clock(),
        undefined,
        "predictive leader v7 commitCheckedAt",
      );
      if (
        Date.parse(parent.betting_closes_at) - Date.parse(commitCheckedAt) < 5_000
      ) {
        throw new RangeError(
          "predictive leader v7 transaction must finish at least five seconds before betting closes",
        );
      }
      return { inserted: true, reason: "frozen" };
    });
  }

  #buildForecastPairSnapshot({
    source,
    instrument,
    externalRoundId,
    lockedAt,
    modelTop3,
  }) {
    const eligibility = `
      source = ?
      AND instrument = ?
      AND created_at <= ?
      AND observed_at <= ?
      AND settled_at < ?
    `;
    const historyMaxRow = this.sqlite
      .prepare(`
        SELECT MAX(id) AS max_result_id
        FROM round_results
        WHERE ${eligibility}
      `)
      .get(source, instrument, lockedAt, lockedAt, lockedAt);
    const historyMaxResultId = historyMaxRow?.max_result_id == null
      ? null
      : Number(historyMaxRow.max_result_id);
    const base = {
      schemaVersion: 1,
      historyCutoffAt: lockedAt,
      historyMaxResultId,
      anchor: null,
      sampleSize: 0,
      observedFollowerCount: 0,
      pairTop3: [],
      modelTop3: [...modelTop3],
      overlapNumbers: [],
      overlapCount: 0,
      sameTop1: null,
      exactOrder: false,
    };
    if (historyMaxResultId === null) {
      return { ...base, status: "no_anchor" };
    }

    const anchor = this.sqlite
      .prepare(`
        SELECT
          id,
          result_number,
          settled_at,
          continuity_epoch,
          external_round_id
        FROM round_results
        WHERE ${eligibility}
          AND id <= ?
        ORDER BY settled_at DESC, id DESC
        LIMIT 1
      `)
      .get(
        source,
        instrument,
        lockedAt,
        lockedAt,
        lockedAt,
        historyMaxResultId,
      );
    const forecastRoundId = numericRoundId(externalRoundId);
    const anchorRoundId = numericRoundId(anchor?.external_round_id);
    if (
      !anchor ||
      forecastRoundId === null ||
      anchorRoundId === null ||
      forecastRoundId !== anchorRoundId + 1n
    ) {
      return { ...base, status: "no_anchor" };
    }

    const safeAnchor = {
      resultId: Number(anchor.id),
      number: Number(anchor.result_number),
      settledAt: anchor.settled_at,
      continuityEpoch: Number(anchor.continuity_epoch),
    };
    const rows = this.sqlite
      .prepare(`
        WITH eligible_results AS (
          SELECT id, result_number, settled_at, continuity_epoch
          FROM round_results
          WHERE ${eligibility}
            AND id <= ?
        ), ordered AS (
          SELECT
            result_number AS first_number,
            LEAD(result_number, 1) OVER stream_order AS second_number,
            LEAD(settled_at, 1) OVER stream_order AS occurred_at
          FROM eligible_results
          WINDOW stream_order AS (
            PARTITION BY continuity_epoch
            ORDER BY settled_at, id
          )
        ), followers AS (
          SELECT
            second_number AS number,
            COUNT(*) AS occurrence_count,
            MIN(occurred_at) AS first_occurred_at,
            MAX(occurred_at) AS last_occurred_at
          FROM ordered
          WHERE first_number = ? AND second_number IS NOT NULL
          GROUP BY second_number
        )
        SELECT
          number,
          occurrence_count,
          first_occurred_at,
          last_occurred_at,
          SUM(occurrence_count) OVER () AS sample_size,
          COUNT(*) OVER () AS observed_follower_count
        FROM followers
        ORDER BY occurrence_count DESC, last_occurred_at DESC, number
        LIMIT 3
      `)
      .all(
        source,
        instrument,
        lockedAt,
        lockedAt,
        lockedAt,
        historyMaxResultId,
        safeAnchor.number,
      );
    if (rows.length === 0) {
      return {
        ...base,
        status: "no_samples",
        anchor: safeAnchor,
      };
    }

    const pairTop3 = rows.map((row) => ({
      number: Number(row.number),
      occurrenceCount: Number(row.occurrence_count),
      firstOccurredAt: row.first_occurred_at,
      lastOccurredAt: row.last_occurred_at,
    }));
    const pairNumbers = pairTop3.map((item) => item.number);
    const pairSet = new Set(pairNumbers);
    const overlapNumbers = modelTop3.filter((number) => pairSet.has(number));
    return {
      ...base,
      status: "ready",
      anchor: safeAnchor,
      sampleSize: Number(rows[0].sample_size),
      observedFollowerCount: Number(rows[0].observed_follower_count),
      pairTop3,
      overlapNumbers,
      overlapCount: overlapNumbers.length,
      sameTop1: modelTop3[0] === pairNumbers[0],
      exactOrder:
        pairNumbers.length === modelTop3.length &&
        pairNumbers.every((number, index) => number === modelTop3[index]),
    };
  }

  #insertForecastPairSnapshot(forecastId, snapshot, capturedAt) {
    this.sqlite
      .prepare(`
        INSERT INTO forecast_pair_snapshots (
          forecast_id, schema_version, status,
          history_cutoff_at, captured_at, history_max_result_id,
          anchor_result_id, anchor_number, anchor_settled_at,
          anchor_continuity_epoch, sample_size, observed_follower_count,
          pair_top3_json, model_top3_json, overlap_numbers_json,
          overlap_count, same_top1, exact_order, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        forecastId,
        snapshot.schemaVersion,
        snapshot.status,
        snapshot.historyCutoffAt,
        capturedAt,
        snapshot.historyMaxResultId,
        snapshot.anchor?.resultId ?? null,
        snapshot.anchor?.number ?? null,
        snapshot.anchor?.settledAt ?? null,
        snapshot.anchor?.continuityEpoch ?? null,
        snapshot.sampleSize,
        snapshot.observedFollowerCount,
        JSON.stringify(snapshot.pairTop3),
        JSON.stringify(snapshot.modelTop3),
        JSON.stringify(snapshot.overlapNumbers),
        snapshot.overlapCount,
        snapshot.sameTop1 === null ? null : snapshot.sameTop1 ? 1 : 0,
        snapshot.exactOrder ? 1 : 0,
        capturedAt,
      );
  }

  #insertForecastConsensusSnapshot(forecastId, snapshot, createdAt) {
    this.sqlite
      .prepare(`
        INSERT INTO forecast_consensus_snapshots (
          forecast_id, schema_version, algorithm_version, status,
          top3_json, inputs_used_json, pair_sample_size,
          derived_from_snapshot_at, reason, created_at
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        forecastId,
        snapshot.algorithmVersion,
        snapshot.status,
        JSON.stringify(snapshot.top3),
        JSON.stringify(snapshot.inputsUsed),
        snapshot.pairSampleSize,
        snapshot.derivedFromSnapshotAt,
        snapshot.reason,
        createdAt,
      );
  }

  recordPrecloseForecast(attempt) {
    this.#assertOpen();
    if (!attempt || typeof attempt !== "object" || Array.isArray(attempt)) {
      throw new TypeError("forecast attempt must be an object");
    }

    const source = asNonEmptyText(attempt.source, "buleto", "source");
    const instrument = asNonEmptyText(
      attempt.instrument,
      "default",
      "instrument",
    );
    const externalRoundId = asNonEmptyText(
      String(attempt.externalRoundId ?? ""),
      undefined,
      "externalRoundId",
    );
    const horizonSeconds = Number(attempt.horizonSeconds);
    if (!Number.isInteger(horizonSeconds) || horizonSeconds < 5 || horizonSeconds > 60) {
      throw new RangeError("horizonSeconds must be an integer between 5 and 60");
    }

    const bettingClosesAt = asTimestamp(
      attempt.bettingClosesAt,
      undefined,
      "bettingClosesAt",
    );
    const roundEndsAt = asTimestamp(attempt.roundEndsAt, undefined, "roundEndsAt");
    const factorAt = asTimestamp(attempt.factorAt, undefined, "factorAt");
    const lockedAt = asTimestamp(attempt.lockedAt, undefined, "lockedAt");
    const closesMs = Date.parse(bettingClosesAt);
    const lockedMs = Date.parse(lockedAt);
    const factorMs = Date.parse(factorAt);
    const roundEndsMs = Date.parse(roundEndsAt);
    const leadTimeMs = closesMs - lockedMs;
    const minimumLeadTimeMs = horizonSeconds === PRECLOSE_FORECAST_HORIZON_SECONDS
      ? PRECLOSE_FORECAST_MIN_LEAD_MS
      : horizonSeconds * 1_000;
    const maximumLeadTimeMs = horizonSeconds === PRECLOSE_FORECAST_HORIZON_SECONDS
      ? PRECLOSE_FORECAST_MAX_LEAD_MS
      : (horizonSeconds + 2.5) * 1_000;
    if (
      leadTimeMs < 5_000 ||
      leadTimeMs < minimumLeadTimeMs ||
      leadTimeMs > maximumLeadTimeMs
    ) {
      throw new RangeError("forecast must be locked inside its pre-bcd horizon window");
    }
    if (factorMs > lockedMs || lockedMs - factorMs > 5_000) {
      throw new RangeError("forecast factor must be fresh and observed before lock");
    }
    if (roundEndsMs <= lockedMs) {
      throw new RangeError("roundEndsAt must be after lockedAt");
    }

    const currentPrice = asPrice(attempt.currentPrice);
    const startPrice = asPrice(attempt.startPrice);
    const predictedPrice = asPrice(attempt.predictedPrice);
    if (currentPrice === null || startPrice === null || predictedPrice === null) {
      throw new TypeError("forecast prices must be finite numbers");
    }
    const currentNumber = canonicalRouletteNumber(attempt.currentNumber);
    const predictedNumber = canonicalRouletteNumber(attempt.predictedNumber);
    if (!Array.isArray(attempt.rankedNumbers) || attempt.rankedNumbers.length !== 3) {
      throw new TypeError("rankedNumbers must contain exactly three numbers");
    }
    const rankedNumbers = attempt.rankedNumbers.map(canonicalRouletteNumber);
    if (new Set(rankedNumbers).size !== rankedNumbers.length) {
      throw new TypeError("rankedNumbers must be unique");
    }
    if (rankedNumbers[0] !== predictedNumber) {
      throw new TypeError("predictedNumber must be the first ranked number");
    }

    if (!Array.isArray(attempt.cells) || attempt.cells.length !== 38) {
      throw new TypeError("cells must contain all 38 wire price ranges");
    }
    const seenCells = new Set();
    const cells = attempt.cells.map((cell, index) => {
      const code = Number(cell?.c);
      const upper = Number(cell?.vt);
      const lower = Number(cell?.vf);
      if (
        !Number.isInteger(code) ||
        code < 0 ||
        code > 37 ||
        !Number.isFinite(upper) ||
        !Number.isFinite(lower) ||
        upper < lower ||
        seenCells.has(code)
      ) {
        throw new TypeError(`cells[${index}] is invalid`);
      }
      seenCells.add(code);
      return { c: code, vt: upper, vf: lower };
    });

    const inputFeatures = attempt.features;
    if (!inputFeatures || typeof inputFeatures !== "object" || Array.isArray(inputFeatures)) {
      throw new TypeError("features must be an object");
    }
    if (!Array.isArray(inputFeatures.samples) || inputFeatures.samples.length < 3) {
      throw new TypeError("features.samples must contain at least three prices");
    }
    const samples = inputFeatures.samples.map((sample, index) => {
      const at = asTimestamp(sample?.dt, undefined, `features.samples[${index}].dt`);
      const price = asPrice(sample?.v);
      if (price === null || Date.parse(at) > factorMs) {
        throw new RangeError(`features.samples[${index}] is after the locked factor`);
      }
      return { dt: at, v: price };
    });
    const slopePerSecond = Number(inputFeatures.slopePerSecond);
    const windowSeconds = Number(inputFeatures.windowSeconds);
    const secondsToEnd = Number(inputFeatures.secondsToEnd);
    if (
      !Number.isFinite(slopePerSecond) ||
      !Number.isFinite(windowSeconds) ||
      windowSeconds <= 0 ||
      !Number.isFinite(secondsToEnd) ||
      secondsToEnd <= 0
    ) {
      throw new TypeError("forecast feature summary is invalid");
    }
    const predictionBasis = inputFeatures.predictionBasis === undefined
      ? null
      : asNonEmptyText(
          inputFeatures.predictionBasis,
          undefined,
          "features.predictionBasis",
        );
    let shadow = null;
    if (inputFeatures.shadow !== undefined) {
      if (
        !inputFeatures.shadow ||
        typeof inputFeatures.shadow !== "object" ||
        Array.isArray(inputFeatures.shadow)
      ) {
        throw new TypeError("features.shadow must be an object");
      }
      const shadowModelVersion = asNonEmptyText(
        inputFeatures.shadow.modelVersion,
        undefined,
        "features.shadow.modelVersion",
      );
      const shadowProjectedPrice = asPrice(
        inputFeatures.shadow.projectedPrice,
      );
      if (shadowProjectedPrice === null) {
        throw new TypeError("features.shadow.projectedPrice must be finite");
      }
      shadow = {
        modelVersion: shadowModelVersion,
        projectedPrice: shadowProjectedPrice,
      };
    }
    const features = {
      samples,
      sampleCount: samples.length,
      windowSeconds,
      slopePerSecond,
      secondsToEnd,
      ...(predictionBasis === null ? {} : { predictionBasis }),
      ...(shadow === null ? {} : { shadow }),
    };
    const modelVersion = asNonEmptyText(
      attempt.modelVersion,
      undefined,
      "modelVersion",
    );
    if (modelVersion === PRECLOSE_START_PRICE_MODEL_VERSION) {
      if (predictedPrice !== startPrice) {
        throw new RangeError("start-price forecast must predict its frozen start price");
      }
      if (predictionBasis !== "start_price") {
        throw new TypeError("start-price forecast must declare start_price basis");
      }
      const expectedRanking = rankPrecloseForecastCells(cells, startPrice)
        .map((item) => item.number);
      const expectedCurrentNumber = rankPrecloseForecastCells(
        cells,
        currentPrice,
      )[0]?.number;
      if (
        expectedRanking.length !== rankedNumbers.length ||
        expectedRanking.some(
          (number, index) => number !== rankedNumbers[index],
        ) ||
        predictedNumber !== expectedRanking[0]
      ) {
        throw new RangeError(
          "start-price forecast ranking must match its frozen cells and start price",
        );
      }
      if (currentNumber !== expectedCurrentNumber) {
        throw new RangeError(
          "start-price forecast current number must match its frozen cells and current price",
        );
      }
      if (shadow?.modelVersion !== PRECLOSE_FORECAST_SHADOW_MODEL_VERSION) {
        throw new TypeError("start-price forecast must include the frozen OLS shadow");
      }
      const expectedWindowSeconds = PRECLOSE_FORECAST_FACTOR_WINDOW_MS / 1_000;
      if (windowSeconds !== expectedWindowSeconds) {
        throw new RangeError(
          `start-price forecast factor window must be ${expectedWindowSeconds} seconds`,
        );
      }
      const windowStartsMs = lockedMs - PRECLOSE_FORECAST_FACTOR_WINDOW_MS;
      let previousSampleMs = null;
      for (const [index, sample] of samples.entries()) {
        const sampleMs = Date.parse(sample.dt);
        if (
          previousSampleMs !== null &&
          sampleMs <= previousSampleMs
        ) {
          throw new RangeError(
            "start-price forecast samples must be strictly increasing with distinct timestamps",
          );
        }
        if (sampleMs < windowStartsMs || sampleMs > factorMs) {
          throw new RangeError(
            `start-price forecast samples[${index}] must be inside the frozen factor window`,
          );
        }
        previousSampleMs = sampleMs;
      }
      const latestSample = samples.at(-1);
      if (
        latestSample.dt !== factorAt ||
        latestSample.v !== currentPrice
      ) {
        throw new RangeError(
          "start-price forecast samples must end at the frozen current price",
        );
      }
      const expectedSecondsToEnd = (roundEndsMs - factorMs) / 1_000;
      const secondsTolerance = Math.max(
        1e-9,
        Math.abs(expectedSecondsToEnd) * Number.EPSILON * 16,
      );
      if (Math.abs(secondsToEnd - expectedSecondsToEnd) > secondsTolerance) {
        throw new RangeError(
          "start-price forecast secondsToEnd must match its frozen timestamps",
        );
      }
      const expectedSlopePerSecond = calculatePrecloseOlsSlope(samples);
      const slopeTolerance = Math.max(
        1e-12,
        Math.abs(expectedSlopePerSecond) * Number.EPSILON * 32,
      );
      if (
        Math.abs(slopePerSecond - expectedSlopePerSecond) > slopeTolerance
      ) {
        throw new RangeError(
          "start-price forecast slope must match its frozen OLS samples",
        );
      }
      const expectedShadowPrice =
        currentPrice + expectedSlopePerSecond * expectedSecondsToEnd;
      const shadowTolerance = Math.max(
        1e-12,
        Math.abs(expectedShadowPrice) * Number.EPSILON * 16,
      );
      if (
        Math.abs(shadow.projectedPrice - expectedShadowPrice) > shadowTolerance
      ) {
        throw new RangeError(
          "start-price forecast OLS shadow does not match its frozen features",
        );
      }
    }

    const primaryOutcome = this.#transaction(() => {
      const existing = this.sqlite
        .prepare(`
          SELECT
            forecasts.id AS forecast_id,
            snapshots.betting_closes_at
          FROM forecast_snapshots AS snapshots
          JOIN round_forecasts AS forecasts ON forecasts.snapshot_id = snapshots.id
          WHERE snapshots.source = ?
            AND snapshots.instrument = ?
            AND snapshots.external_round_id = ?
            AND snapshots.horizon_seconds = ?
          LIMIT 1
        `)
        .get(source, instrument, externalRoundId, horizonSeconds);
      if (existing) {
        let voidInserted = false;
        if (existing.betting_closes_at !== bettingClosesAt) {
          const conflictAt = asTimestamp(
            this.clock(),
            undefined,
            "predictive shadow metadata conflict at",
          );
          voidInserted = this.#recordCurrentCellHorizonMetadataConflict({
            source,
            instrument,
            externalRoundId,
            originalBettingClosesAt: existing.betting_closes_at,
            observedBettingClosesAt: bettingClosesAt,
            observedAt: conflictAt,
            createdAt: conflictAt,
          });
        }
        return {
          inserted: false,
          databaseChanged: voidInserted,
          metadataConflict: existing.betting_closes_at !== bettingClosesAt,
          voidInserted,
          roundId: externalRoundId,
          forecastId: Number(existing.forecast_id),
        };
      }

      const pairSnapshot = this.#buildForecastPairSnapshot({
        source,
        instrument,
        externalRoundId,
        lockedAt,
        modelTop3: rankedNumbers,
      });
      const persistedAt = asTimestamp(this.clock(), undefined, "forecast persistedAt");
      const persistedAtMs = Date.parse(persistedAt);
      const persistedLeadTimeMs = closesMs - persistedAtMs;
      if (persistedAtMs < lockedMs || persistedLeadTimeMs < 5_000) {
        throw new RangeError(
          "forecast must be durably stored at least five seconds before betting closes",
        );
      }
      const consensusSnapshot = combineFrozenTop3({
        modelVersion,
        modelTop3: rankedNumbers,
        pairTop3: pairSnapshot.pairTop3.map((item) => item.number),
        pairStatus: pairSnapshot.status,
        pairModelTop3: pairSnapshot.modelTop3,
        pairSampleSize: pairSnapshot.sampleSize,
        derivedFromSnapshotAt: persistedAt,
      });
      const insertion = this.sqlite
        .prepare(`
          INSERT INTO forecast_snapshots (
            source, instrument, external_round_id, horizon_seconds,
            betting_closes_at, round_ends_at, factor_at, locked_at,
            lead_time_ms, persisted_at, persisted_lead_time_ms,
            current_price, start_price, current_number,
            cells_json, features_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source, instrument, external_round_id, horizon_seconds)
          DO NOTHING
        `)
        .run(
          source,
          instrument,
          externalRoundId,
          horizonSeconds,
          bettingClosesAt,
          roundEndsAt,
          factorAt,
          lockedAt,
          leadTimeMs,
          persistedAt,
          persistedLeadTimeMs,
          currentPrice,
          startPrice,
          currentNumber,
          JSON.stringify(cells),
          JSON.stringify(features),
          persistedAt,
        );

      if (Number(insertion.changes) === 0) {
        const raced = this.sqlite
          .prepare(`
            SELECT forecasts.id AS forecast_id
            FROM forecast_snapshots AS snapshots
            JOIN round_forecasts AS forecasts ON forecasts.snapshot_id = snapshots.id
            WHERE snapshots.source = ?
              AND snapshots.instrument = ?
              AND snapshots.external_round_id = ?
              AND snapshots.horizon_seconds = ?
            LIMIT 1
          `)
          .get(source, instrument, externalRoundId, horizonSeconds);
        if (!raced) {
          throw new Error("conflicting forecast was stored without its forecast row");
        }
        return {
          inserted: false,
          roundId: externalRoundId,
          forecastId: Number(raced.forecast_id),
        };
      }

      const snapshotId = Number(insertion.lastInsertRowid);
      const forecastInsertion = this.sqlite
        .prepare(`
          INSERT INTO round_forecasts (
            snapshot_id, model_version, predicted_price, predicted_number,
            ranked_numbers_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          snapshotId,
          modelVersion,
          predictedPrice,
          predictedNumber,
          JSON.stringify(rankedNumbers),
          persistedAt,
        );
      const forecastId = Number(forecastInsertion.lastInsertRowid);
      this.#insertForecastPairSnapshot(forecastId, pairSnapshot, persistedAt);
      this.#insertForecastConsensusSnapshot(
        forecastId,
        consensusSnapshot,
        persistedAt,
      );
      const commitCheckedAt = asTimestamp(
        this.clock(),
        undefined,
        "forecast commitCheckedAt",
      );
      if (closesMs - Date.parse(commitCheckedAt) < 5_000) {
        throw new RangeError(
          "forecast transaction must finish at least five seconds before betting closes",
        );
      }
      return { inserted: true, roundId: externalRoundId, forecastId };
    });

    let trajectoryShadow = primaryOutcome.inserted
      ? null
      : this.#storedTrajectoryShadowForPredictiveLeader(primaryOutcome.forecastId);
    if (primaryOutcome.inserted) {
      try {
        trajectoryShadow = this.#transaction(() => {
          const frozenShadow = this.#buildForecastTrajectoryShadow({
            source,
            instrument,
            externalRoundId,
            bettingClosesAt,
            roundEndsAt,
            lockedAt,
            startPrice,
            cells,
          });
          const shadowCreatedAt = asTimestamp(
            this.clock(),
            undefined,
            "trajectory shadow createdAt",
          );
          this.#insertForecastTrajectoryShadow(
            primaryOutcome.forecastId,
            frozenShadow,
            shadowCreatedAt,
          );
          return frozenShadow;
        });
      } catch (error) {
        emitLog(
          this.logger,
          "error",
          {
            error,
            source,
            instrument,
            externalRoundId,
            forecastId: primaryOutcome.forecastId,
          },
          "trajectory shadow persistence failed after primary forecast commit",
        );
      }
    }

    let predictiveLeaderOutcome = { inserted: false };
    try {
      predictiveLeaderOutcome = this.#recordPredictiveLeaderSnapshot(
        primaryOutcome.forecastId,
        trajectoryShadow,
      );
    } catch (error) {
      emitLog(
        this.logger,
        "error",
        {
          error,
          source,
          instrument,
          externalRoundId,
          forecastId: primaryOutcome.forecastId,
        },
        "predictive leader persistence failed after primary forecast commit",
      );
    }

    let predictiveLeaderV7Outcome = { inserted: false };
    try {
      predictiveLeaderV7Outcome = this.#recordPredictiveLeaderV7Snapshot(
        primaryOutcome.forecastId,
        trajectoryShadow,
      );
    } catch (error) {
      emitLog(
        this.logger,
        "error",
        {
          error,
          source,
          instrument,
          externalRoundId,
          forecastId: primaryOutcome.forecastId,
        },
        "predictive leader v7 shadow persistence failed without affecting champion",
      );
    }

    let predictiveLeaderWarmTop1PaperOutcome = { placed: 0 };
    if (
      source === PREDICTIVE_SHADOW_FROZEN_STREAM.source
      && instrument === PREDICTIVE_SHADOW_FROZEN_STREAM.instrument
    ) {
      try {
        predictiveLeaderWarmTop1PaperOutcome = this.placePredictiveLeaderWarmTop1PaperBet(
          source,
          instrument,
          primaryOutcome.forecastId,
        );
      } catch (error) {
        emitLog(
          this.logger,
          "error",
          {
            error,
            source,
            instrument,
            externalRoundId,
            forecastId: primaryOutcome.forecastId,
          },
          "predictive leader warm top1 paper placement failed without affecting shadow",
        );
      }
    }

    return {
      inserted: primaryOutcome.inserted,
      databaseChanged:
        primaryOutcome.databaseChanged
        || primaryOutcome.inserted
        || predictiveLeaderOutcome.inserted
        || predictiveLeaderV7Outcome.inserted
        || predictiveLeaderWarmTop1PaperOutcome.placed === 1
        || predictiveLeaderWarmTop1PaperOutcome.voided > 0
        || predictiveLeaderWarmTop1PaperOutcome.settled > 0
        || predictiveLeaderWarmTop1PaperOutcome.reset > 0
        || predictiveLeaderWarmTop1PaperOutcome.databaseChanged === true,
      roundId: externalRoundId,
    };
  }

  #predictiveLeaderWarmTop1CampaignRow(source, instrument) {
    const config = PREDICTIVE_LEADER_WARM_TOP1_PAPER_CAMPAIGN;
    const campaign = this.sqlite.prepare(`
      SELECT * FROM predictive_leader_warm_top1_paper_campaigns
      WHERE campaign_key = ?
    `).get(config.campaignKey);
    if (!campaign) {
      throw new Error("predictive leader warm top1 paper campaign is missing");
    }
    if (campaign.source !== source || campaign.instrument !== instrument) return null;
    const expectedNextStake = calculatePredictiveLeaderV7PaperNextStake(
      Number(campaign.ladder_loss),
      Number(campaign.cycle_staked),
    );
    if (
      Number(campaign.schema_version) !== config.schemaVersion
      || campaign.strategy_version !== config.strategyVersion
      || campaign.algorithm_version !== config.algorithmVersion
      || campaign.gate_version !== config.gateVersion
      || campaign.mode !== config.mode
      || Boolean(campaign.execution_enabled) !== config.executionEnabled
      || Boolean(campaign.advisory_only) !== config.advisoryOnly
      || !["collecting", "confirmed", "rejected", "invalid"]
        .includes(campaign.gate_status)
      || Number(campaign.gate_target_sample_size)
        !== WARM_TOP1_GATE_TARGET_SAMPLE_SIZE
      || !Number.isSafeInteger(Number(campaign.gate_selected_count))
      || !Number.isSafeInteger(Number(campaign.gate_settled_count))
      || Number(campaign.gate_settled_count) > Number(campaign.gate_selected_count)
      || Number(campaign.gate_selected_count) > WARM_TOP1_GATE_TARGET_SAMPLE_SIZE
      || !["running", "exhausted"].includes(campaign.status)
      || Number(campaign.initial_balance) !== config.initialBalance
      || !Number.isSafeInteger(Number(campaign.current_balance))
      || Number(campaign.current_balance) < 0
      || campaign.model_kind !== config.model.kind
      || Number(campaign.next_stake) !== expectedNextStake
      || Number(campaign.ladder_loss) !== Number(campaign.cycle_staked)
      || !Number.isSafeInteger(Number(campaign.first_forecast_id))
      || Number(campaign.first_forecast_id) < 1
      || !Number.isFinite(Date.parse(campaign.started_at))
    ) {
      throw new Error("predictive leader warm top1 paper campaign cursor is invalid");
    }
    return campaign;
  }

  #requirePredictiveLeaderWarmTop1Campaign(source, instrument) {
    const campaign = this.#predictiveLeaderWarmTop1CampaignRow(source, instrument);
    if (!campaign) {
      throw new RangeError(
        "predictive leader warm top1 paper campaign is pinned to its frozen stream",
      );
    }
    return campaign;
  }

  #warmTop1CandidateEvidenceFromRow(row) {
    if (!row) return null;
    const candidate = warmTop1CandidateFromPairSnapshot({
      status: row.pair_status,
      sampleSize: Number(row.sample_size),
      observedFollowerCount: Number(row.observed_follower_count),
      pairTop3: deserializeJson(row.pair_top3_json),
    });
    if (!candidate || candidate.status === "invalid") return null;
    const anchorResultId = row.anchor_result_id == null
      ? null
      : Number(row.anchor_result_id);
    const anchorNumber = row.anchor_number == null ? null : Number(row.anchor_number);
    const historyMaxResultId = row.history_max_result_id == null
      ? null
      : Number(row.history_max_result_id);
    if (
      !candidate.eligible
      || anchorResultId === null
      || anchorNumber === null
      || historyMaxResultId === null
      || !Number.isFinite(Date.parse(row.anchor_settled_at))
      || !Number.isFinite(Date.parse(row.history_cutoff_at))
    ) {
      return {
        ...candidate,
        anchorResultId,
        anchorNumber,
        anchorSettledAt: row.anchor_settled_at ?? null,
        historyMaxResultId,
        historyCutoffAt: row.history_cutoff_at ?? null,
        evidenceSha256: null,
      };
    }
    const canonical = {
      algorithmVersion: candidate.algorithmVersion,
      rank: candidate.rank,
      number: candidate.number,
      occurrenceCount: candidate.occurrenceCount,
      sampleSize: candidate.sampleSize,
      observedFollowerCount: candidate.observedFollowerCount,
      anchorResultId,
      anchorNumber,
      anchorSettledAt: row.anchor_settled_at,
      historyMaxResultId,
      historyCutoffAt: row.history_cutoff_at,
    };
    return {
      ...candidate,
      anchorResultId,
      anchorNumber,
      anchorSettledAt: row.anchor_settled_at,
      historyMaxResultId,
      historyCutoffAt: row.history_cutoff_at,
      evidenceSha256: createHash("sha256")
        .update(JSON.stringify(canonical))
        .digest("hex"),
    };
  }

  #warmTop1ForecastRow(source, instrument, forecastId) {
    return this.sqlite.prepare(`
      SELECT
        forecasts.id AS forecast_id,
        snapshots.source,
        snapshots.instrument,
        snapshots.external_round_id,
        snapshots.horizon_seconds,
        snapshots.locked_at,
        snapshots.betting_closes_at,
        snapshots.round_ends_at,
        pair_snapshots.status AS pair_status,
        pair_snapshots.history_cutoff_at,
        pair_snapshots.captured_at,
        pair_snapshots.history_max_result_id,
        pair_snapshots.anchor_result_id,
        pair_snapshots.anchor_number,
        pair_snapshots.anchor_settled_at,
        pair_snapshots.anchor_continuity_epoch,
        pair_snapshots.sample_size,
        pair_snapshots.observed_follower_count,
        pair_snapshots.pair_top3_json,
        settlements.forecast_id AS settlement_forecast_id,
        settlements.round_result_id,
        settlements.actual_number,
        settlements.settled_at,
        results.id AS known_result_id,
        conflicts.reason AS conflict_reason
      FROM round_forecasts AS forecasts
      JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
      LEFT JOIN forecast_pair_snapshots AS pair_snapshots
        ON pair_snapshots.forecast_id = forecasts.id
      LEFT JOIN forecast_settlements AS settlements
        ON settlements.forecast_id = forecasts.id
      LEFT JOIN round_results AS results
        ON results.source = snapshots.source
       AND results.instrument = snapshots.instrument
       AND results.external_round_id = snapshots.external_round_id
      LEFT JOIN predictive_shadow_round_metadata_conflicts AS conflicts
        ON conflicts.boundary_key = 'predictive-shadow-metadata-integrity-v1'
       AND conflicts.source = snapshots.source
       AND conflicts.instrument = snapshots.instrument
       AND conflicts.external_round_id = snapshots.external_round_id
      WHERE forecasts.id = ? AND snapshots.source = ? AND snapshots.instrument = ?
    `).get(Number(forecastId), source, instrument);
  }

  #refreshPredictiveLeaderWarmTop1GateInTransaction(source, instrument, updatedAt) {
    const campaign = this.#requirePredictiveLeaderWarmTop1Campaign(source, instrument);
    if (["confirmed", "rejected", "invalid"].includes(campaign.gate_status)) {
      return { status: campaign.gate_status, changed: false };
    }
    const rows = this.sqlite.prepare(`
      SELECT
        forecasts.id AS forecast_id,
        snapshots.locked_at,
        pair_snapshots.status AS pair_status,
        pair_snapshots.history_cutoff_at,
        pair_snapshots.history_max_result_id,
        pair_snapshots.anchor_result_id,
        pair_snapshots.anchor_number,
        pair_snapshots.anchor_settled_at,
        pair_snapshots.anchor_continuity_epoch,
        pair_snapshots.sample_size,
        pair_snapshots.observed_follower_count,
        pair_snapshots.pair_top3_json,
        settlements.actual_number,
        conflicts.reason AS conflict_reason
      FROM round_forecasts AS forecasts
      JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
      JOIN forecast_pair_snapshots AS pair_snapshots
        ON pair_snapshots.forecast_id = forecasts.id
      LEFT JOIN forecast_settlements AS settlements
        ON settlements.forecast_id = forecasts.id
      LEFT JOIN predictive_shadow_round_metadata_conflicts AS conflicts
        ON conflicts.boundary_key = 'predictive-shadow-metadata-integrity-v1'
       AND conflicts.source = snapshots.source
       AND conflicts.instrument = snapshots.instrument
       AND conflicts.external_round_id = snapshots.external_round_id
      WHERE forecasts.id >= ?
        AND snapshots.source = ? AND snapshots.instrument = ?
        AND snapshots.horizon_seconds = ?
        AND snapshots.locked_at >= ?
      ORDER BY forecasts.id
    `).all(
      Number(campaign.first_forecast_id),
      source,
      instrument,
      PREDICTIVE_LEADER_V7_FORECAST_HORIZON_SECONDS,
      campaign.started_at,
    );
    const selected = [];
    for (const row of rows) {
      const evidence = this.#warmTop1CandidateEvidenceFromRow(row);
      if (!evidence?.eligible) continue;
      selected.push({ row, evidence });
      if (selected.length === WARM_TOP1_GATE_TARGET_SAMPLE_SIZE) break;
    }
    const frozenWindow = selected.slice(0, WARM_TOP1_GATE_TARGET_SAMPLE_SIZE);
    const selectedCount = frozenWindow.length;
    const settled = frozenWindow.filter(({ row }) => row.actual_number !== null);
    const integrityValid = frozenWindow.every(({ row, evidence }) => (
      row.conflict_reason === null
      && Number(row.anchor_continuity_epoch)
        === Number(campaign.activation_continuity_epoch)
      && evidence.historyCutoffAt === row.locked_at
      && evidence.evidenceSha256 !== null
    ));
    const pureGate = evaluateWarmTop1FixedGate(
      settled.map(({ row }) => ({
        forecastId: Number(row.forecast_id),
        actualNumber: Number(row.actual_number),
        pairSnapshot: {
          status: row.pair_status,
          sampleSize: Number(row.sample_size),
          observedFollowerCount: Number(row.observed_follower_count),
          pairTop3: deserializeJson(row.pair_top3_json),
        },
      })),
      { integrityValid },
    );
    const brierDeltas = settled.map(({ row, evidence }) => {
      const hit = evidence.number === Number(row.actual_number);
      const modelLoss = (evidence.share - Number(hit)) ** 2;
      const uniformLoss = (1 / 37 - Number(hit)) ** 2;
      return modelLoss - uniformLoss;
    });
    const brierHac = brierDeltas.length === WARM_TOP1_GATE_TARGET_SAMPLE_SIZE
      ? hacMeanInterval95(brierDeltas)
      : null;
    const fixedWindowComplete = selectedCount === WARM_TOP1_GATE_TARGET_SAMPLE_SIZE;
    const settlementComplete = fixedWindowComplete
      && settled.length === WARM_TOP1_GATE_TARGET_SAMPLE_SIZE;
    const metadataIntegrity = fixedWindowComplete ? integrityValid : null;
    const exactHitRate = settlementComplete && pureGate.top1Wilson95 !== null
      ? pureGate.top1Wilson95.lower > WARM_TOP1_BREAK_EVEN_RATE
      : null;
    const brierVsUniform = settlementComplete && brierHac?.upper !== null
      ? brierHac.upper < 0
      : null;
    let status = "collecting";
    let reason = fixedWindowComplete
      ? "waiting_fixed_window_settlement"
      : "insufficient_sample";
    if (fixedWindowComplete && !integrityValid) {
      status = "invalid";
      reason = "metadata_integrity_failed";
    } else if (settlementComplete) {
      status = exactHitRate && brierVsUniform ? "confirmed" : "rejected";
      reason = status === "confirmed"
        ? "quality_confirmed"
        : !exactHitRate
          ? "wilson_lower_bound_not_above_break_even"
          : "brier_not_better_than_uniform";
    }
    const gate = {
      ...pureGate,
      status,
      reason,
      eligible: status === "confirmed",
      controlsPaperAction: status === "confirmed",
      selectedCount,
      settledCount: settled.length,
      sampleSize: settled.length,
      hitCount: settled.reduce(
        (total, { row, evidence }) => total + Number(
          evidence.number === Number(row.actual_number),
        ),
        0,
      ),
      fixedWindowComplete,
      settlementComplete,
      windowStartForecastId: frozenWindow[0]
        ? Number(frozenWindow[0].row.forecast_id)
        : null,
      windowEndForecastId: fixedWindowComplete
        ? Number(frozenWindow.at(-1).row.forecast_id)
        : null,
      economicBreakEvenTop1Rate: WARM_TOP1_BREAK_EVEN_RATE,
      binaryBrierDeltaVsUniformHac95: brierHac === null
        ? null
        : { mean: brierHac.mean, lower: brierHac.lower, upper: brierHac.upper },
      criteria: {
        fixedSampleComplete: fixedWindowComplete,
        metadataIntegrity,
        exactHitRate,
        brierVsUniform,
      },
      evidenceSha256: null,
      frozenAt: null,
    };
    if (status !== "collecting") {
      gate.evidenceSha256 = createHash("sha256")
        .update(JSON.stringify(frozenWindow.map(({ row, evidence }) => ({
          forecastId: Number(row.forecast_id),
          candidateEvidenceSha256: evidence.evidenceSha256,
          actualNumber: Number(row.actual_number),
        }))))
        .digest("hex");
      gate.frozenAt = updatedAt;
    }
    const gateMetricsJson = JSON.stringify(gate);
    const storedWindowStart = campaign.gate_window_start_forecast_id === null
      ? null
      : Number(campaign.gate_window_start_forecast_id);
    const storedWindowEnd = campaign.gate_window_end_forecast_id === null
      ? null
      : Number(campaign.gate_window_end_forecast_id);
    const unchanged = campaign.gate_status === status
      && Number(campaign.gate_selected_count) === selectedCount
      && Number(campaign.gate_settled_count) === settled.length
      && Number(campaign.gate_hit_count) === gate.hitCount
      && storedWindowStart === gate.windowStartForecastId
      && storedWindowEnd === gate.windowEndForecastId
      && campaign.gate_metrics_json === gateMetricsJson
      && (campaign.gate_evidence_sha256 ?? null) === (gate.evidenceSha256 ?? null)
      && (campaign.gate_frozen_at ?? null) === (gate.frozenAt ?? null);
    if (unchanged) return { status, changed: false, gate };
    const update = this.sqlite.prepare(`
      UPDATE predictive_leader_warm_top1_paper_campaigns
      SET gate_status = ?, gate_selected_count = ?, gate_settled_count = ?,
        gate_hit_count = ?, gate_window_start_forecast_id = ?,
        gate_window_end_forecast_id = ?, gate_metrics_json = ?,
        gate_evidence_sha256 = ?, gate_frozen_at = ?, updated_at = ?
      WHERE id = ? AND gate_status = 'collecting'
    `).run(
      status,
      selectedCount,
      settled.length,
      gate.hitCount,
      gate.windowStartForecastId,
      gate.windowEndForecastId,
      gateMetricsJson,
      gate.evidenceSha256,
      gate.frozenAt,
      updatedAt,
      Number(campaign.id),
    );
    return { status, changed: Number(update.changes) === 1, gate };
  }

  #voidPredictiveLeaderWarmTop1PendingInTransaction({
    campaign,
    pending,
    reason,
    incidentId = null,
    continuityEpoch = null,
    voidedAt,
  }) {
    if (!["round_metadata_conflict", "integrity_gap"].includes(reason)) {
      throw new TypeError("warm top1 paper void reason is invalid");
    }
    const requestedVoidedAt = asTimestamp(
      voidedAt,
      undefined,
      "predictive leader warm top1 paper voidedAt",
    );
    const safeVoidedAt = new Date(Math.max(
      Date.parse(requestedVoidedAt),
      Date.parse(campaign.updated_at),
      Date.parse(pending.updated_at ?? pending.placed_at),
    )).toISOString();
    const safeIncidentId = reason === "integrity_gap" ? Number(incidentId) : null;
    const safeContinuityEpoch = Number(continuityEpoch ?? pending.continuity_epoch);
    if (
      !Number.isSafeInteger(safeContinuityEpoch)
      || safeContinuityEpoch < 0
      || (reason === "integrity_gap" && (
        !Number.isSafeInteger(safeIncidentId)
        || safeIncidentId < 1
        || safeContinuityEpoch <= Number(pending.continuity_epoch)
      ))
    ) {
      throw new TypeError("warm top1 paper void evidence is invalid");
    }
    const refundedBalance = Number(campaign.current_balance) + Number(pending.stake);
    const updateBet = this.sqlite.prepare(`
      UPDATE predictive_leader_warm_top1_paper_bets
      SET status = 'void', void_reason = ?, void_incident_id = ?,
        void_continuity_epoch = ?, voided_at = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(
      reason,
      safeIncidentId,
      safeContinuityEpoch,
      safeVoidedAt,
      safeVoidedAt,
      Number(pending.id),
    );
    const updateCampaign = this.sqlite.prepare(`
      UPDATE predictive_leader_warm_top1_paper_campaigns
      SET current_balance = ?, status = 'running', exhausted_at = NULL,
        ledger_revision = ledger_revision + 1, updated_at = ?
      WHERE id = ? AND current_balance = ?
    `).run(
      refundedBalance,
      safeVoidedAt,
      Number(campaign.id),
      Number(campaign.current_balance),
    );
    if (Number(updateBet.changes) !== 1 || Number(updateCampaign.changes) !== 1) {
      throw new Error(`warm top1 ${reason} void was not committed exactly once`);
    }
    return {
      settled: 0,
      voided: 1,
      reason,
      forecastId: Number(pending.forecast_id),
      betId: Number(pending.id),
      refundedStake: Number(pending.stake),
    };
  }

  #reconcilePredictiveLeaderWarmTop1PaperInTransaction(source, instrument, updatedAt) {
    let campaign = this.#requirePredictiveLeaderWarmTop1Campaign(source, instrument);
    const pending = this.sqlite.prepare(`
      SELECT
        bets.*,
        settlements.round_result_id AS authoritative_result_id,
        settlements.actual_number AS authoritative_actual_number,
        settlements.settled_at AS authoritative_settled_at,
        conflicts.reason AS conflict_reason
      FROM predictive_leader_warm_top1_paper_bets AS bets
      JOIN round_forecasts AS forecasts ON forecasts.id = bets.forecast_id
      JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
      LEFT JOIN forecast_settlements AS settlements
        ON settlements.forecast_id = bets.forecast_id
      LEFT JOIN predictive_shadow_round_metadata_conflicts AS conflicts
        ON conflicts.boundary_key = 'predictive-shadow-metadata-integrity-v1'
       AND conflicts.source = snapshots.source
       AND conflicts.instrument = snapshots.instrument
       AND conflicts.external_round_id = snapshots.external_round_id
      WHERE bets.campaign_id = ? AND bets.status = 'pending'
      LIMIT 1
    `).get(Number(campaign.id));
    if (!pending) return { settled: 0, voided: 0, reason: "no_pending_bet" };
    if (pending.conflict_reason !== null) {
      return this.#voidPredictiveLeaderWarmTop1PendingInTransaction({
        campaign,
        pending,
        reason: "round_metadata_conflict",
        voidedAt: updatedAt,
      });
    }
    if (pending.authoritative_result_id === null) {
      const continuityEpoch = Number(this.sqlite.prepare(`
        SELECT continuity_epoch FROM stream_state
        WHERE source = ? AND instrument = ?
      `).get(source, instrument)?.continuity_epoch ?? 0);
      if (continuityEpoch < Number(pending.continuity_epoch)) {
        throw new Error("warm top1 continuity epoch moved backwards");
      }
      if (continuityEpoch > Number(pending.continuity_epoch)) {
        const incident = this.sqlite.prepare(`
          SELECT id FROM incidents
          WHERE kind = 'gap' AND source = ? AND instrument = ?
          ORDER BY id DESC LIMIT 1
        `).get(source, instrument);
        if (!incident) {
          throw new Error("warm top1 continuity gap has no durable incident");
        }
        return this.#voidPredictiveLeaderWarmTop1PendingInTransaction({
          campaign,
          pending,
          reason: "integrity_gap",
          incidentId: Number(incident.id),
          continuityEpoch,
          voidedAt: updatedAt,
        });
      }
      return {
        settled: 0,
        voided: 0,
        reason: "awaiting_authoritative_result",
        forecastId: Number(pending.forecast_id),
      };
    }
    if (Number(campaign.current_balance) !== Number(pending.balance_before) - Number(pending.stake)) {
      throw new Error("warm top1 pending balance cursor is invalid");
    }
    const settlement = settlePredictiveLeaderV7PaperLadderBet({
      targetNumber: Number(pending.target_number),
      resultNumber: Number(pending.authoritative_actual_number),
      stake: Number(pending.stake),
      balanceBefore: Number(pending.balance_before),
      cycleSpendBefore: Number(pending.cycle_staked_before),
      ladderLossBefore: Number(pending.ladder_loss_before),
      cycleMissCountBefore: Number(pending.ladder_miss_count_before),
    });
    const cycleNumberAfter = Number(pending.cycle_number_before)
      + Number(settlement.cycleReset);
    const resetCountAfter = Number(campaign.reset_count) + Number(settlement.cycleReset);
    const exhausted = settlement.balanceAfter < settlement.nextStakeAfter;
    const updateBet = this.sqlite.prepare(`
      UPDATE predictive_leader_warm_top1_paper_bets
      SET status = 'settled', result_id = ?, result_number = ?, outcome = ?,
        gross_payout = ?, balance_after = ?, cycle_number_after = ?,
        cycle_staked_after = ?, ladder_loss_after = ?,
        ladder_miss_count_after = ?, next_stake_after = ?, reset_reason = ?,
        settled_at = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(
      Number(pending.authoritative_result_id),
      Number(pending.authoritative_actual_number),
      settlement.outcome,
      settlement.grossPayout,
      settlement.balanceAfter,
      cycleNumberAfter,
      settlement.cycleSpendAfter,
      settlement.ladderLossAfter,
      settlement.cycleMissCountAfter,
      settlement.nextStakeAfter,
      settlement.resetReason,
      pending.authoritative_settled_at,
      updatedAt,
      Number(pending.id),
    );
    const updateCampaign = this.sqlite.prepare(`
      UPDATE predictive_leader_warm_top1_paper_campaigns
      SET current_balance = ?, cycle_number = ?, cycle_staked = ?,
        ladder_loss = ?, ladder_miss_count = ?, reset_count = ?, next_stake = ?,
        status = ?, exhausted_at = ?, ledger_revision = ledger_revision + 1,
        updated_at = ?
      WHERE id = ? AND current_balance = ? AND cycle_number = ?
        AND cycle_staked = ? AND ladder_loss = ? AND ladder_miss_count = ?
    `).run(
      settlement.balanceAfter,
      cycleNumberAfter,
      settlement.cycleSpendAfter,
      settlement.ladderLossAfter,
      settlement.cycleMissCountAfter,
      resetCountAfter,
      settlement.nextStakeAfter,
      exhausted ? "exhausted" : "running",
      exhausted ? updatedAt : null,
      updatedAt,
      Number(campaign.id),
      Number(campaign.current_balance),
      Number(campaign.cycle_number),
      Number(campaign.cycle_staked),
      Number(campaign.ladder_loss),
      Number(campaign.ladder_miss_count),
    );
    if (Number(updateBet.changes) !== 1 || Number(updateCampaign.changes) !== 1) {
      throw new Error("warm top1 settlement was not committed exactly once");
    }
    return {
      settled: 1,
      voided: 0,
      reset: Number(settlement.cycleReset),
      resetReason: settlement.resetReason,
      reason: settlement.outcome,
      forecastId: Number(pending.forecast_id),
    };
  }

  #placePredictiveLeaderWarmTop1PaperBetInTransaction({
    source,
    instrument,
    forecastId,
    placedAt,
  }) {
    const campaign = this.#requirePredictiveLeaderWarmTop1Campaign(source, instrument);
    const safeForecastId = Number(forecastId);
    if (!Number.isSafeInteger(safeForecastId) || safeForecastId < 1) {
      throw new TypeError("forecastId must be a positive safe integer");
    }
    if (campaign.gate_status !== "confirmed") {
      return {
        placed: 0,
        reason: `quality_gate_${campaign.gate_status}`,
        forecastId: safeForecastId,
      };
    }
    const existing = this.sqlite.prepare(`
      SELECT id FROM predictive_leader_warm_top1_paper_bets
      WHERE campaign_id = ? AND forecast_id = ?
    `).get(Number(campaign.id), safeForecastId);
    if (existing) return { placed: 0, reason: "already_recorded", forecastId: safeForecastId };
    const priorPending = this.sqlite.prepare(`
      SELECT id FROM predictive_leader_warm_top1_paper_bets
      WHERE campaign_id = ? AND status = 'pending'
    `).get(Number(campaign.id));
    if (priorPending) return { placed: 0, reason: "prior_pending", forecastId: safeForecastId };
    const stake = Number(campaign.next_stake);
    if (
      campaign.status === "exhausted"
      || Number(campaign.ledger_deficit) > 0
      || Number(campaign.current_balance) < stake
    ) {
      return { placed: 0, reason: "bankroll_exhausted", forecastId: safeForecastId };
    }
    const row = this.#warmTop1ForecastRow(source, instrument, safeForecastId);
    if (!row || row.pair_status === null) {
      return { placed: 0, reason: "pair_snapshot_unavailable", forecastId: safeForecastId };
    }
    const evidence = this.#warmTop1CandidateEvidenceFromRow(row);
    if (!evidence?.eligible || evidence.evidenceSha256 === null) {
      return { placed: 0, reason: "warm_top1_no_signal", forecastId: safeForecastId };
    }
    const continuityEpoch = this.#continuityEpoch(source, instrument);
    if (
      safeForecastId < Number(campaign.first_forecast_id)
      || row.locked_at < campaign.started_at
      || Number(row.horizon_seconds) !== PREDICTIVE_LEADER_V7_FORECAST_HORIZON_SECONDS
      || Number(row.anchor_continuity_epoch) !== continuityEpoch
    ) {
      return { placed: 0, reason: "outside_prospective_boundary", forecastId: safeForecastId };
    }
    if (row.conflict_reason !== null) {
      return { placed: 0, reason: "round_metadata_conflict", forecastId: safeForecastId };
    }
    if (row.settlement_forecast_id !== null || row.known_result_id !== null) {
      return { placed: 0, reason: "result_already_known", forecastId: safeForecastId };
    }
    const latestResult = this.sqlite.prepare(`
      SELECT id, settled_at FROM round_results
      WHERE source = ? AND instrument = ? AND settled_at < ?
      ORDER BY settled_at DESC, id DESC LIMIT 1
    `).get(source, instrument, row.locked_at);
    if (
      !latestResult
      || Number(latestResult.id) !== evidence.anchorResultId
      || latestResult.settled_at !== evidence.anchorSettledAt
    ) {
      return { placed: 0, reason: "anchor_cursor_mismatch", forecastId: safeForecastId };
    }
    const safePlacedAt = asTimestamp(
      placedAt,
      undefined,
      "predictive leader warm top1 paper placedAt",
    );
    if (
      Date.parse(safePlacedAt) < Date.parse(row.locked_at)
      || Date.parse(row.betting_closes_at) - Date.parse(safePlacedAt)
        < PREDICTIVE_LEADER_WARM_TOP1_PAPER_CAMPAIGN.minimumPlacementLeadMs
    ) {
      return { placed: 0, reason: "outside_safe_preclose", forecastId: safeForecastId };
    }
    const rawStake = calculatePredictiveLeaderV7PaperRawStake(
      Number(campaign.ladder_loss),
    );
    const expectedStake = calculatePredictiveLeaderV7PaperNextStake(
      Number(campaign.ladder_loss),
      Number(campaign.cycle_staked),
    );
    if (stake !== expectedStake || campaign.gate_evidence_sha256 === null) {
      throw new Error("warm top1 paper frozen stake or gate evidence is invalid");
    }
    const insertion = this.sqlite.prepare(`
      INSERT INTO predictive_leader_warm_top1_paper_bets (
        campaign_id, forecast_id, external_round_id, continuity_epoch,
        target_number, occurrence_count, sample_size, observed_follower_count,
        anchor_result_id, anchor_number, anchor_settled_at, history_max_result_id,
        evidence_sha256, stake, raw_stake, balance_before,
        cycle_number_before, cycle_staked_before, ladder_loss_before,
        ladder_miss_count_before, locked_at, betting_closes_at,
        status, placed_at, updated_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        'pending', ?, ?, ?)
    `).run(
      Number(campaign.id),
      safeForecastId,
      row.external_round_id,
      continuityEpoch,
      evidence.number,
      evidence.occurrenceCount,
      evidence.sampleSize,
      evidence.observedFollowerCount,
      evidence.anchorResultId,
      evidence.anchorNumber,
      evidence.anchorSettledAt,
      evidence.historyMaxResultId,
      evidence.evidenceSha256,
      stake,
      rawStake,
      Number(campaign.current_balance),
      Number(campaign.cycle_number),
      Number(campaign.cycle_staked),
      Number(campaign.ladder_loss),
      Number(campaign.ladder_miss_count),
      row.locked_at,
      row.betting_closes_at,
      safePlacedAt,
      safePlacedAt,
      safePlacedAt,
    );
    const campaignUpdate = this.sqlite.prepare(`
      UPDATE predictive_leader_warm_top1_paper_campaigns
      SET current_balance = current_balance - ?,
        ledger_revision = ledger_revision + 1, updated_at = ?
      WHERE id = ? AND status = 'running' AND gate_status = 'confirmed'
        AND current_balance = ? AND next_stake = ?
    `).run(
      stake,
      safePlacedAt,
      Number(campaign.id),
      Number(campaign.current_balance),
      stake,
    );
    if (Number(insertion.changes) !== 1 || Number(campaignUpdate.changes) !== 1) {
      throw new Error("warm top1 paper placement was not committed exactly once");
    }
    const commitCheckedAt = asTimestamp(
      this.clock(),
      undefined,
      "predictive leader warm top1 paper commitCheckedAt",
    );
    if (
      Date.parse(commitCheckedAt) < Date.parse(safePlacedAt)
      || Date.parse(row.betting_closes_at) - Date.parse(commitCheckedAt)
        < PREDICTIVE_LEADER_WARM_TOP1_PAPER_CAMPAIGN.minimumPlacementLeadMs
    ) {
      throw new RangeError(
        "warm top1 paper transaction must finish at least five seconds before betting closes",
      );
    }
    return {
      placed: 1,
      reason: "bet_frozen",
      forecastId: safeForecastId,
      stake,
      number: evidence.number,
    };
  }

  initializePredictiveLeaderWarmTop1PaperCampaign(
    source = PREDICTIVE_SHADOW_FROZEN_STREAM.source,
    instrument = PREDICTIVE_SHADOW_FROZEN_STREAM.instrument,
  ) {
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const reconciliation = this.reconcilePredictiveLeaderWarmTop1PaperCampaign(
      safeSource,
      safeInstrument,
    );
    if (
      reconciliation.gateStatus !== "confirmed"
      || Number(reconciliation.settled ?? 0) > 0
      || Number(reconciliation.voided ?? 0) > 0
    ) {
      return reconciliation;
    }
    const campaign = this.#requirePredictiveLeaderWarmTop1Campaign(
      safeSource,
      safeInstrument,
    );
    const recoverable = this.sqlite.prepare(`
      SELECT forecasts.id AS forecast_id
      FROM round_forecasts AS forecasts
      JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
      WHERE forecasts.id >= ? AND snapshots.source = ? AND snapshots.instrument = ?
      ORDER BY forecasts.id DESC LIMIT 1
    `).get(Number(campaign.first_forecast_id), safeSource, safeInstrument);
    if (!recoverable) return reconciliation;
    const placement = this.placePredictiveLeaderWarmTop1PaperBet(
      safeSource,
      safeInstrument,
      Number(recoverable.forecast_id),
    );
    return {
      ...reconciliation,
      ...placement,
      databaseChanged: reconciliation.databaseChanged || placement.databaseChanged,
    };
  }

  reconcilePredictiveLeaderWarmTop1PaperCampaign(
    source = PREDICTIVE_SHADOW_FROZEN_STREAM.source,
    instrument = PREDICTIVE_SHADOW_FROZEN_STREAM.instrument,
  ) {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const now = asTimestamp(
      this.clock(),
      undefined,
      "predictive leader warm top1 paper reconciledAt",
    );
    return this.#transaction(() => {
      const gateBefore = this.#refreshPredictiveLeaderWarmTop1GateInTransaction(
        safeSource,
        safeInstrument,
        now,
      );
      const ledger = this.#reconcilePredictiveLeaderWarmTop1PaperInTransaction(
        safeSource,
        safeInstrument,
        now,
      );
      const gateAfter = this.#refreshPredictiveLeaderWarmTop1GateInTransaction(
        safeSource,
        safeInstrument,
        now,
      );
      return {
        placed: 0,
        ...ledger,
        gateStatus: gateAfter.status,
        databaseChanged:
          gateBefore.changed || gateAfter.changed
          || Number(ledger.settled ?? 0) > 0
          || Number(ledger.voided ?? 0) > 0,
      };
    });
  }

  placePredictiveLeaderWarmTop1PaperBet(
    source = PREDICTIVE_SHADOW_FROZEN_STREAM.source,
    instrument = PREDICTIVE_SHADOW_FROZEN_STREAM.instrument,
    forecastId,
  ) {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const now = asTimestamp(
      this.clock(),
      undefined,
      "predictive leader warm top1 paper placement at",
    );
    return this.#transaction(() => {
      const gate = this.#refreshPredictiveLeaderWarmTop1GateInTransaction(
        safeSource,
        safeInstrument,
        now,
      );
      const reconciliation = this.#reconcilePredictiveLeaderWarmTop1PaperInTransaction(
        safeSource,
        safeInstrument,
        now,
      );
      const placement = Number(reconciliation.settled ?? 0) > 0
        || Number(reconciliation.voided ?? 0) > 0
        ? { placed: 0, reason: "prior_pending_reconciled", forecastId: Number(forecastId) }
        : this.#placePredictiveLeaderWarmTop1PaperBetInTransaction({
            source: safeSource,
            instrument: safeInstrument,
            forecastId,
            placedAt: now,
          });
      return {
        ...placement,
        settled: Number(reconciliation.settled ?? 0),
        voided: Number(reconciliation.voided ?? 0),
        gateStatus: gate.status,
        databaseChanged:
          gate.changed || placement.placed > 0
          || Number(reconciliation.settled ?? 0) > 0
          || Number(reconciliation.voided ?? 0) > 0,
      };
    });
  }

  getPredictiveLeaderWarmTop1PaperState(
    source = PREDICTIVE_SHADOW_FROZEN_STREAM.source,
    instrument = PREDICTIVE_SHADOW_FROZEN_STREAM.instrument,
  ) {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const campaign = this.#requirePredictiveLeaderWarmTop1Campaign(
      safeSource,
      safeInstrument,
    );
    const pendingRow = this.sqlite.prepare(`
      SELECT
        bets.*,
        snapshots.external_round_id,
        snapshots.locked_at,
        snapshots.betting_closes_at,
        snapshots.round_ends_at,
        pair_snapshots.status AS pair_status,
        pair_snapshots.history_cutoff_at,
        pair_snapshots.history_max_result_id,
        pair_snapshots.anchor_result_id,
        pair_snapshots.anchor_number,
        pair_snapshots.anchor_settled_at,
        pair_snapshots.anchor_continuity_epoch,
        pair_snapshots.sample_size,
        pair_snapshots.observed_follower_count,
        pair_snapshots.pair_top3_json,
        settlements.forecast_id AS settlement_forecast_id
      FROM predictive_leader_warm_top1_paper_bets AS bets
      JOIN round_forecasts AS forecasts ON forecasts.id = bets.forecast_id
      JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
      JOIN forecast_pair_snapshots AS pair_snapshots
        ON pair_snapshots.forecast_id = bets.forecast_id
      LEFT JOIN forecast_settlements AS settlements
        ON settlements.forecast_id = bets.forecast_id
      WHERE bets.campaign_id = ? AND bets.status = 'pending'
      LIMIT 1
    `).get(Number(campaign.id));
    const latestForecastRow = pendingRow ?? this.sqlite.prepare(`
      SELECT
        forecasts.id AS forecast_id,
        snapshots.external_round_id,
        snapshots.locked_at,
        snapshots.betting_closes_at,
        snapshots.round_ends_at,
        pair_snapshots.status AS pair_status,
        pair_snapshots.history_cutoff_at,
        pair_snapshots.history_max_result_id,
        pair_snapshots.anchor_result_id,
        pair_snapshots.anchor_number,
        pair_snapshots.anchor_settled_at,
        pair_snapshots.anchor_continuity_epoch,
        pair_snapshots.sample_size,
        pair_snapshots.observed_follower_count,
        pair_snapshots.pair_top3_json,
        settlements.forecast_id AS settlement_forecast_id
      FROM round_forecasts AS forecasts
      JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
      LEFT JOIN forecast_pair_snapshots AS pair_snapshots
        ON pair_snapshots.forecast_id = forecasts.id
      LEFT JOIN forecast_settlements AS settlements
        ON settlements.forecast_id = forecasts.id
      WHERE forecasts.id >= ? AND snapshots.source = ? AND snapshots.instrument = ?
      ORDER BY forecasts.id DESC LIMIT 1
    `).get(Number(campaign.first_forecast_id), safeSource, safeInstrument);
    const candidateEvidence = latestForecastRow?.pair_status
      ? this.#warmTop1CandidateEvidenceFromRow(latestForecastRow)
      : null;
    const actionableEvidence = candidateEvidence?.eligible ? candidateEvidence : null;
    let qualityGate = deserializeJson(campaign.gate_metrics_json);
    if (!qualityGate || typeof qualityGate !== "object" || Array.isArray(qualityGate)) {
      qualityGate = {
        version: campaign.gate_version,
        status: campaign.gate_status,
        reason: "insufficient_sample",
        eligible: false,
        controlsPaperAction: false,
        windowPolicy: "first-1000-selected-settled-prospective-no-roll",
        targetSampleSize: Number(campaign.gate_target_sample_size),
        selectedCount: Number(campaign.gate_selected_count),
        settledCount: Number(campaign.gate_settled_count),
        sampleSize: Number(campaign.gate_settled_count),
        hitCount: Number(campaign.gate_hit_count),
        fixedWindowComplete: false,
        settlementComplete: false,
        windowStartForecastId: campaign.gate_window_start_forecast_id === null
          ? null
          : Number(campaign.gate_window_start_forecast_id),
        windowEndForecastId: campaign.gate_window_end_forecast_id === null
          ? null
          : Number(campaign.gate_window_end_forecast_id),
        economicBreakEvenTop1Rate: WARM_TOP1_BREAK_EVEN_RATE,
        top1Wilson95: null,
        binaryBrierDeltaVsUniformHac95: null,
        criteria: {
          fixedSampleComplete: false,
          metadataIntegrity: null,
          exactHitRate: null,
          brierVsUniform: null,
        },
        evidenceSha256: null,
        frozenAt: null,
      };
    }
    const aggregate = this.sqlite.prepare(`
      SELECT
        COUNT(*) AS bet_count,
        SUM(CASE WHEN status = 'settled' THEN 1 ELSE 0 END) AS settled_count,
        SUM(CASE WHEN status = 'void' THEN 1 ELSE 0 END) AS void_count,
        SUM(CASE WHEN outcome = 'hit' THEN 1 ELSE 0 END) AS hit_count,
        SUM(CASE WHEN outcome = 'miss' THEN 1 ELSE 0 END) AS miss_count,
        SUM(CASE WHEN status IN ('pending', 'settled') THEN stake ELSE 0 END)
          AS total_staked,
        SUM(CASE WHEN status = 'settled' THEN gross_payout ELSE 0 END)
          AS total_gross_payout
      FROM predictive_leader_warm_top1_paper_bets
      WHERE campaign_id = ?
    `).get(Number(campaign.id));
    const latestOutcomeRow = this.sqlite.prepare(`
      SELECT * FROM predictive_leader_warm_top1_paper_bets
      WHERE campaign_id = ? AND status = 'settled'
      ORDER BY id DESC LIMIT 1
    `).get(Number(campaign.id));
    const latestVoidRow = this.sqlite.prepare(`
      SELECT * FROM predictive_leader_warm_top1_paper_bets
      WHERE campaign_id = ? AND status = 'void'
      ORDER BY id DESC LIMIT 1
    `).get(Number(campaign.id));
    const pendingBet = pendingRow
      ? {
          id: Number(pendingRow.id),
          forecastId: Number(pendingRow.forecast_id),
          roundId: pendingRow.external_round_id,
          targetNumber: Number(pendingRow.target_number),
          stake: Number(pendingRow.stake),
          status: "pending",
          decisionSource: "follower-warm-top1",
          algorithmVersion: campaign.algorithm_version,
          gateVersion: campaign.gate_version,
          candidateEvidenceSha256: pendingRow.evidence_sha256,
          gateEvidenceSha256: campaign.gate_evidence_sha256,
          lockedAt: pendingRow.locked_at,
          bettingClosesAt: pendingRow.betting_closes_at,
          placedAt: pendingRow.placed_at,
        }
      : null;
    const nextStake = Number(campaign.next_stake);
    const currentBalance = Number(campaign.current_balance);
    const shortfall = Math.max(0, nextStake - currentBalance);
    const exhausted = campaign.status === "exhausted";
    const settledCount = Number(aggregate.settled_count ?? 0);
    const hitCount = Number(aggregate.hit_count ?? 0);
    return {
      schemaVersion: Number(campaign.schema_version),
      strategyVersion: campaign.strategy_version,
      algorithmVersion: campaign.algorithm_version,
      mode: campaign.mode,
      strategyMode: campaign.mode,
      executionEnabled: Boolean(campaign.execution_enabled),
      advisoryOnly: Boolean(campaign.advisory_only),
      source: safeSource,
      instrument: safeInstrument,
      campaign: {
        campaignKey: campaign.campaign_key,
        firstForecastId: Number(campaign.first_forecast_id),
        startedAt: campaign.started_at,
      },
      forecast: latestForecastRow
        ? {
            id: Number(latestForecastRow.forecast_id),
            roundId: latestForecastRow.external_round_id,
            lockedAt: latestForecastRow.locked_at,
            bettingClosesAt: latestForecastRow.betting_closes_at,
            roundEndsAt: latestForecastRow.round_ends_at,
            settled: latestForecastRow.settlement_forecast_id !== null,
          }
        : null,
      candidateEvidence: actionableEvidence,
      qualityGate,
      account: {
        status: pendingBet ? "pending" : exhausted ? "exhausted" : "waiting",
        reason: pendingBet
          ? "bet_frozen"
          : exhausted
            ? "bankroll_exhausted"
            : campaign.gate_status === "confirmed"
              ? "waiting_next_signal"
              : `quality_gate_${campaign.gate_status}`,
        initialBalance: Number(campaign.initial_balance),
        currentBalance,
        deficit: Number(campaign.ledger_deficit),
        accountingBalance: currentBalance,
        availableBalance: currentBalance,
        reservedStake: pendingBet?.stake ?? 0,
        profit: currentBalance - Number(campaign.initial_balance),
        nextStake,
        canAffordNext: pendingBet === null && !exhausted && shortfall === 0,
        shortfall,
        ledgerRevision: Number(campaign.ledger_revision),
        startedAt: campaign.started_at,
        updatedAt: campaign.updated_at,
        exhaustedAt: campaign.exhausted_at,
      },
      stats: {
        betCount: Number(aggregate.bet_count ?? 0),
        settledCount,
        pendingCount: Number(pendingBet !== null),
        voidCount: Number(aggregate.void_count ?? 0),
        hitCount,
        missCount: Number(aggregate.miss_count ?? 0),
        hitRate: settledCount === 0 ? null : hitCount / settledCount,
        totalStaked: Number(aggregate.total_staked ?? 0),
        totalGrossPayout: Number(aggregate.total_gross_payout ?? 0),
      },
      ladder: {
        cycleNumber: Number(campaign.cycle_number),
        cycleStaked: Number(campaign.cycle_staked),
        ladderLoss: Number(campaign.ladder_loss),
        missCount: Number(campaign.ladder_miss_count),
        resetCount: Number(campaign.reset_count),
        nextStake,
      },
      pendingBet,
      latestOutcome: latestOutcomeRow
        ? {
            betId: Number(latestOutcomeRow.id),
            forecastId: Number(latestOutcomeRow.forecast_id),
            targetNumber: Number(latestOutcomeRow.target_number),
            resultNumber: Number(latestOutcomeRow.result_number),
            stake: Number(latestOutcomeRow.stake),
            outcome: latestOutcomeRow.outcome,
            grossPayout: Number(latestOutcomeRow.gross_payout),
            balanceAfter: Number(latestOutcomeRow.balance_after),
            resetReason: latestOutcomeRow.reset_reason,
            settledAt: latestOutcomeRow.settled_at,
          }
        : null,
      latestVoid: latestVoidRow
        ? {
            betId: Number(latestVoidRow.id),
            forecastId: Number(latestVoidRow.forecast_id),
            reason: latestVoidRow.void_reason,
            voidedAt: latestVoidRow.voided_at,
          }
        : null,
      latestReset: latestOutcomeRow?.reset_reason
        ? {
            betId: Number(latestOutcomeRow.id),
            reason: latestOutcomeRow.reset_reason,
            nextStakeAfter: Number(latestOutcomeRow.next_stake_after),
            occurredAt: latestOutcomeRow.settled_at,
          }
        : null,
    };
  }

  initializePredictiveLeaderV7PaperCampaign(
    source = PREDICTIVE_SHADOW_FROZEN_STREAM.source,
    instrument = PREDICTIVE_SHADOW_FROZEN_STREAM.instrument,
  ) {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    this.#requirePredictiveLeaderV7PaperCampaign(safeSource, safeInstrument);
    this.#requirePredictiveLeaderV7PaperLadderCampaign(safeSource, safeInstrument);
    const now = asTimestamp(
      this.clock(),
      undefined,
      "predictive leader v7 paper initializedAt",
    );
    return this.#transaction(() => {
      const fixedOutcome = this.#reconcilePredictiveLeaderV7PaperInTransaction(
        safeSource,
        safeInstrument,
        now,
      );
      const ladderOutcome = this.#reconcilePredictiveLeaderV7PaperLadderInTransaction(
        safeSource,
        safeInstrument,
        now,
      );
      const fixedPending = this.sqlite.prepare(`
        SELECT 1
        FROM predictive_leader_v7_paper_bets AS bets
        JOIN predictive_leader_v7_paper_campaigns AS campaigns
          ON campaigns.id = bets.campaign_id
        LEFT JOIN predictive_leader_v7_paper_voids AS voids ON voids.bet_id = bets.id
        WHERE campaigns.campaign_key = ? AND bets.status = 'pending'
          AND voids.bet_id IS NULL
        LIMIT 1
      `).get(PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.campaignKey);
      const recoverable = this.sqlite.prepare(`
        SELECT leaders.forecast_id
        FROM forecast_predictive_leader_v7_snapshots AS leaders
        JOIN round_forecasts AS forecasts ON forecasts.id = leaders.forecast_id
        JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
        JOIN predictive_leader_v7_paper_ladder_campaigns AS campaigns
          ON campaigns.candidate_key = leaders.candidate_key
        LEFT JOIN predictive_leader_v7_paper_ladder_bets AS bets
          ON bets.campaign_id = campaigns.id
         AND bets.forecast_id = leaders.forecast_id
        LEFT JOIN forecast_settlements AS settlements
          ON settlements.forecast_id = leaders.forecast_id
        LEFT JOIN round_results AS results
          ON results.source = snapshots.source
         AND results.instrument = snapshots.instrument
         AND results.external_round_id = snapshots.external_round_id
        LEFT JOIN predictive_shadow_round_metadata_conflicts AS conflicts
          ON conflicts.boundary_key = 'predictive-shadow-metadata-integrity-v1'
         AND conflicts.source = snapshots.source
         AND conflicts.instrument = snapshots.instrument
         AND conflicts.external_round_id = snapshots.external_round_id
        WHERE campaigns.campaign_key = ?
          AND campaigns.source = ? AND campaigns.instrument = ?
          AND campaigns.status = 'running'
          AND campaigns.ledger_deficit = 0
          AND campaigns.current_balance >= campaigns.next_stake
          AND leaders.forecast_id >= campaigns.first_forecast_id
          AND leaders.status = 'ready' AND leaders.selected = 1
          AND leaders.locked_at >= campaigns.started_at
          AND leaders.created_at >= campaigns.started_at
          AND leaders.locked_at <= ?
          AND (julianday(snapshots.betting_closes_at) - julianday(?))
            * 86400000 >= 4999
          AND bets.id IS NULL
          AND settlements.forecast_id IS NULL
          AND results.id IS NULL
          AND conflicts.external_round_id IS NULL
        ORDER BY leaders.forecast_id DESC
        LIMIT 1
      `).get(
        PREDICTIVE_LEADER_V7_PAPER_LADDER_CAMPAIGN.campaignKey,
        safeSource,
        safeInstrument,
        now,
        now,
      );
      const placement = !fixedPending && recoverable
        ? this.#placePredictiveLeaderV7PaperLadderBetInTransaction({
            source: safeSource,
            instrument: safeInstrument,
            forecastId: Number(recoverable.forecast_id),
            placedAt: now,
          })
        : {
            placed: 0,
            reason: fixedPending ? "legacy_pending" : "no_recoverable_forecast",
          };
      const settled = Number(fixedOutcome.settled ?? 0)
        + Number(ladderOutcome.settled ?? 0);
      const voided = Number(fixedOutcome.voided ?? 0)
        + Number(ladderOutcome.voided ?? 0);
      const reset = Number(ladderOutcome.reset ?? 0);
      return {
        initialized: 1,
        placed: placement.placed,
        settled,
        voided,
        reset,
        reason: placement.placed > 0
          ? placement.reason
          : ladderOutcome.reason !== "no_pending_bet"
            ? ladderOutcome.reason
            : fixedOutcome.reason,
        databaseChanged:
          placement.placed > 0 || settled > 0 || voided > 0 || reset > 0,
      };
    });
  }

  placePredictiveLeaderV7PaperBet(
    source = PREDICTIVE_SHADOW_FROZEN_STREAM.source,
    instrument = PREDICTIVE_SHADOW_FROZEN_STREAM.instrument,
    forecastId,
  ) {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    this.#requirePredictiveLeaderV7PaperCampaign(safeSource, safeInstrument);
    this.#requirePredictiveLeaderV7PaperLadderCampaign(safeSource, safeInstrument);
    const now = asTimestamp(
      this.clock(),
      undefined,
      "predictive leader v7 paper placement at",
    );
    return this.#transaction(() => {
      const fixedOutcome = this.#reconcilePredictiveLeaderV7PaperInTransaction(
        safeSource,
        safeInstrument,
        now,
      );
      const ladderOutcome = this.#reconcilePredictiveLeaderV7PaperLadderInTransaction(
        safeSource,
        safeInstrument,
        now,
      );
      const fixedPending = this.sqlite.prepare(`
        SELECT 1
        FROM predictive_leader_v7_paper_bets AS bets
        JOIN predictive_leader_v7_paper_campaigns AS campaigns
          ON campaigns.id = bets.campaign_id
        LEFT JOIN predictive_leader_v7_paper_voids AS voids ON voids.bet_id = bets.id
        WHERE campaigns.campaign_key = ? AND bets.status = 'pending'
          AND voids.bet_id IS NULL
        LIMIT 1
      `).get(PREDICTIVE_LEADER_V7_PAPER_CAMPAIGN.campaignKey);
      const placement = fixedPending
        ? { placed: 0, reason: "legacy_pending", forecastId: Number(forecastId) }
        : this.#placePredictiveLeaderV7PaperLadderBetInTransaction({
            source: safeSource,
            instrument: safeInstrument,
            forecastId,
            placedAt: now,
          });
      const settled = Number(fixedOutcome.settled ?? 0)
        + Number(ladderOutcome.settled ?? 0);
      const voided = Number(fixedOutcome.voided ?? 0)
        + Number(ladderOutcome.voided ?? 0);
      const reset = Number(ladderOutcome.reset ?? 0);
      return {
        ...placement,
        settled,
        voided,
        reset,
        databaseChanged:
          placement.placed > 0 || settled > 0 || voided > 0 || reset > 0,
      };
    });
  }

  settlePredictiveLeaderV7PaperCampaign(
    source = PREDICTIVE_SHADOW_FROZEN_STREAM.source,
    instrument = PREDICTIVE_SHADOW_FROZEN_STREAM.instrument,
  ) {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    this.#requirePredictiveLeaderV7PaperCampaign(safeSource, safeInstrument);
    this.#requirePredictiveLeaderV7PaperLadderCampaign(safeSource, safeInstrument);
    const now = asTimestamp(
      this.clock(),
      undefined,
      "predictive leader v7 paper settlement at",
    );
    return this.#transaction(() => {
      const fixedOutcome = this.#settlePredictiveLeaderV7PaperInTransaction(
        safeSource,
        safeInstrument,
        now,
      );
      const ladderOutcome = this.#reconcilePredictiveLeaderV7PaperLadderInTransaction(
        safeSource,
        safeInstrument,
        now,
      );
      const settled = Number(fixedOutcome.settled ?? 0)
        + Number(ladderOutcome.settled ?? 0);
      const voided = Number(fixedOutcome.voided ?? 0)
        + Number(ladderOutcome.voided ?? 0);
      const reset = Number(ladderOutcome.reset ?? 0);
      return {
        placed: 0,
        settled,
        voided,
        reset,
        resetReason: ladderOutcome.resetReason ?? null,
        reason: ladderOutcome.reason !== "no_pending_bet"
          ? ladderOutcome.reason
          : fixedOutcome.reason,
        forecastId: ladderOutcome.forecastId ?? fixedOutcome.forecastId,
        databaseChanged: settled > 0 || voided > 0 || reset > 0,
      };
    });
  }

  reconcilePredictiveLeaderV7PaperCampaign(
    source = PREDICTIVE_SHADOW_FROZEN_STREAM.source,
    instrument = PREDICTIVE_SHADOW_FROZEN_STREAM.instrument,
  ) {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    this.#requirePredictiveLeaderV7PaperCampaign(safeSource, safeInstrument);
    this.#requirePredictiveLeaderV7PaperLadderCampaign(safeSource, safeInstrument);
    const now = asTimestamp(
      this.clock(),
      undefined,
      "predictive leader v7 paper reconciledAt",
    );
    return this.#transaction(() => {
      const fixedOutcome = this.#reconcilePredictiveLeaderV7PaperInTransaction(
        safeSource,
        safeInstrument,
        now,
      );
      const ladderOutcome = this.#reconcilePredictiveLeaderV7PaperLadderInTransaction(
        safeSource,
        safeInstrument,
        now,
      );
      const settled = Number(fixedOutcome.settled ?? 0)
        + Number(ladderOutcome.settled ?? 0);
      const voided = Number(fixedOutcome.voided ?? 0)
        + Number(ladderOutcome.voided ?? 0);
      const reset = Number(ladderOutcome.reset ?? 0);
      return {
        placed: 0,
        settled,
        voided,
        reset,
        resetReason: ladderOutcome.resetReason ?? null,
        reason: ladderOutcome.reason !== "no_pending_bet"
          ? ladderOutcome.reason
          : fixedOutcome.reason,
        forecastId: ladderOutcome.forecastId ?? fixedOutcome.forecastId,
        databaseChanged: settled > 0 || voided > 0 || reset > 0,
      };
    });
  }

  getPredictiveLeaderV7PaperState(
    source = PREDICTIVE_SHADOW_FROZEN_STREAM.source,
    instrument = PREDICTIVE_SHADOW_FROZEN_STREAM.instrument,
  ) {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const campaign = this.#requirePredictiveLeaderV7PaperLadderCampaign(
      safeSource,
      safeInstrument,
    );
    const resetRows = this.sqlite.prepare(`
      SELECT resets.*,
        incidents.kind AS incident_kind,
        incidents.source AS incident_source,
        incidents.instrument AS incident_instrument,
        incident_resolutions.incident_id AS resolved_incident_id
      FROM predictive_leader_v7_paper_ladder_resets AS resets
      LEFT JOIN incidents ON incidents.id = resets.incident_id
      LEFT JOIN incident_resolutions
        ON incident_resolutions.incident_id = resets.incident_id
      WHERE resets.campaign_id = ?
      ORDER BY resets.cycle_number_before, resets.id
    `).all(Number(campaign.id));
    let integrityGapResetCount = 0;
    for (let index = 0; index < resetRows.length; index += 1) {
      const reset = resetRows[index];
      const integrityGap = reset.reason === "integrity_gap";
      if (
        Number(reset.campaign_id) !== Number(campaign.id)
        || Number(reset.cycle_number_before) !== index + 1
        || Number(reset.cycle_number_after) !== index + 2
        || Number(reset.next_stake_after)
          !== PREDICTIVE_LEADER_V7_PAPER_LADDER_CAMPAIGN.model.initialStake
        || reset.occurred_at !== reset.created_at
        || !Number.isFinite(Date.parse(reset.occurred_at))
        || (integrityGap
          ? reset.trigger_bet_id !== null
            || !Number.isSafeInteger(Number(reset.incident_id))
            || Number(reset.incident_id) < 1
            || !Number.isSafeInteger(Number(reset.continuity_epoch))
            || Number(reset.continuity_epoch) < 1
            || reset.incident_kind !== "gap"
            || reset.incident_source !== safeSource
            || reset.incident_instrument !== safeInstrument
            || reset.resolved_incident_id !== null
          : !["hit", "cycle_spend_cap"].includes(reset.reason)
            || !Number.isSafeInteger(Number(reset.trigger_bet_id))
            || Number(reset.trigger_bet_id) < 1
            || reset.incident_id !== null
            || reset.continuity_epoch !== null)
      ) {
        throw new Error("predictive leader v7 paper ladder reset audit is invalid");
      }
      if (integrityGap) integrityGapResetCount += 1;
    }
    const rows = this.sqlite.prepare(`
      SELECT
        bets.*,
        snapshots.external_round_id AS forecast_round_id,
        snapshots.locked_at AS forecast_locked_at,
        snapshots.betting_closes_at AS forecast_betting_closes_at,
        settlements.round_result_id AS authoritative_result_id,
        settlements.actual_number AS authoritative_actual_number,
        settlements.settled_at AS authoritative_settled_at,
        results.source AS result_source,
        results.instrument AS result_instrument,
        results.external_round_id AS result_round_id,
        results.result_number AS authoritative_result_number,
        results.settled_at AS result_settled_at,
        voids.campaign_id AS overlay_campaign_id,
        voids.prior_status AS overlay_prior_status,
        voids.reason AS overlay_reason,
        voids.balance_adjustment AS overlay_balance_adjustment,
        voids.incident_id AS overlay_incident_id,
        voids.continuity_epoch AS overlay_continuity_epoch,
        voids.voided_at AS overlay_voided_at
      FROM predictive_leader_v7_paper_ladder_bets AS bets
      JOIN round_forecasts AS forecasts ON forecasts.id = bets.forecast_id
      JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
      LEFT JOIN forecast_settlements AS settlements
        ON settlements.forecast_id = bets.forecast_id
      LEFT JOIN round_results AS results ON results.id = settlements.round_result_id
      LEFT JOIN predictive_leader_v7_paper_ladder_voids AS voids
        ON voids.bet_id = bets.id
      WHERE bets.campaign_id = ?
      ORDER BY bets.id
    `).all(Number(campaign.id));
    let accountingBalance = Number(campaign.initial_balance);
    let peakBalance = accountingBalance;
    let minimumBalance = accountingBalance;
    let maximumDrawdown = 0;
    let totalStaked = 0;
    let totalGrossPayout = 0;
    let hitCount = 0;
    let missCount = 0;
    let causalSettledCount = 0;
    let pendingBet = null;
    let latestOutcome = null;
    let latestVoid = null;
    let voidCount = 0;
    const gapVoidIncidentIds = new Set();
    let cycleNumber = 1;
    let cycleStaked = 0;
    let ladderLoss = 0;
    let ladderMissCount = 0;
    let resetIndex = 0;
    let handledContinuityEpoch = Number(campaign.last_continuity_epoch)
      - integrityGapResetCount;
    let handledGapIncidentId = Number(campaign.activation_gap_incident_id);
    if (!Number.isSafeInteger(handledContinuityEpoch) || handledContinuityEpoch < 0) {
      throw new Error("predictive leader v7 paper ladder continuity replay is invalid");
    }
    const consumeReset = ({
      bet,
      reason,
      expectedCycleStaked,
      expectedLadderLoss,
      expectedMissCount,
      expectedNextStake,
    }) => {
      const reset = resetRows[resetIndex];
      if (
        !reset
        || reset.reason !== reason
        || Number(reset.trigger_bet_id) !== Number(bet.id)
        || reset.incident_id !== null
        || reset.continuity_epoch !== null
        || Number(reset.cycle_number_before) !== cycleNumber
        || Number(reset.cycle_number_after) !== cycleNumber + 1
        || Number(reset.cycle_staked_before) !== expectedCycleStaked
        || Number(reset.ladder_loss_before) !== expectedLadderLoss
        || Number(reset.ladder_miss_count_before) !== expectedMissCount
        || Number(reset.next_stake_before) !== expectedNextStake
      ) {
        throw new Error("predictive leader v7 paper ladder reset cursor is invalid");
      }
      resetIndex += 1;
      cycleNumber += 1;
      cycleStaked = 0;
      ladderLoss = 0;
      ladderMissCount = 0;
      return reset;
    };
    const consumeGapReset = () => {
      const reset = resetRows[resetIndex];
      if (
        !reset
        || reset.reason !== "integrity_gap"
        || reset.trigger_bet_id !== null
        || Number(reset.cycle_number_before) !== cycleNumber
        || Number(reset.cycle_number_after) !== cycleNumber + 1
        || Number(reset.cycle_staked_before) !== cycleStaked
        || Number(reset.ladder_loss_before) !== ladderLoss
        || Number(reset.ladder_miss_count_before) !== ladderMissCount
        || Number(reset.next_stake_before)
          !== calculatePredictiveLeaderV7PaperNextStake(ladderLoss, cycleStaked)
        || Number(reset.continuity_epoch) !== handledContinuityEpoch + 1
        || Number(reset.incident_id) <= handledGapIncidentId
      ) {
        throw new Error("predictive leader v7 paper ladder gap reset cursor is invalid");
      }
      resetIndex += 1;
      cycleNumber += 1;
      cycleStaked = 0;
      ladderLoss = 0;
      ladderMissCount = 0;
      handledContinuityEpoch += 1;
      handledGapIncidentId = Number(reset.incident_id);
      return reset;
    };
    const consumeGapResetsBeforeCycle = (targetCycleNumber) => {
      while (cycleNumber < targetCycleNumber) {
        consumeGapReset();
      }
    };
    for (const row of rows) {
      consumeGapResetsBeforeCycle(Number(row.cycle_number_before));
      const expectedRawStake = calculatePredictiveLeaderV7PaperRawStake(ladderLoss);
      const expectedStake = calculatePredictiveLeaderV7PaperNextStake(
        ladderLoss,
        cycleStaked,
      );
      if (
        row.candidate_key !== campaign.candidate_key
        || row.external_round_id !== row.forecast_round_id
        || row.locked_at !== row.forecast_locked_at
        || row.betting_closes_at !== row.forecast_betting_closes_at
        || Number(row.cycle_number_before) !== cycleNumber
        || Number(row.cycle_staked_before) !== cycleStaked
        || Number(row.ladder_loss_before) !== ladderLoss
        || Number(row.ladder_miss_count_before) !== ladderMissCount
        || Number(row.raw_stake) !== expectedRawStake
        || Number(row.stake) !== expectedStake
        || Number(row.continuity_epoch) !== handledContinuityEpoch
      ) {
        throw new Error("predictive leader v7 paper ladder bet audit is invalid");
      }
      const overlaid = row.overlay_reason !== null;
      if (overlaid) {
        const expectedAdjustment = row.overlay_prior_status === "pending"
          ? Number(row.stake)
          : row.overlay_prior_status === "settled"
            ? Number(row.stake) - Number(row.gross_payout)
            : null;
        if (
          !["integrity_gap", "round_metadata_conflict"].includes(row.overlay_reason)
          || Number(row.overlay_campaign_id) !== Number(campaign.id)
          || Number(row.overlay_balance_adjustment) !== expectedAdjustment
          || (row.overlay_reason === "integrity_gap"
            && (
              !Number.isSafeInteger(Number(row.overlay_incident_id))
              || Number(row.overlay_incident_id) < 1
              || !Number.isSafeInteger(Number(row.overlay_continuity_epoch))
              || Number(row.overlay_continuity_epoch) < 1
            ))
          || (row.overlay_reason !== "integrity_gap"
            && (
              row.overlay_incident_id !== null
              || row.overlay_continuity_epoch !== null
            ))
          || (row.overlay_prior_status === "pending" && row.status !== "void")
          || (row.overlay_prior_status === "settled" && row.status !== "settled")
          || (row.overlay_prior_status === "pending"
            && (
              row.void_reason !== row.overlay_reason
              || row.void_incident_id !== row.overlay_incident_id
              || row.void_continuity_epoch !== row.overlay_continuity_epoch
              || row.voided_at !== row.overlay_voided_at
            ))
        ) {
          throw new Error("predictive leader v7 paper ladder void overlay is invalid");
        }
        voidCount += 1;
        if (row.overlay_reason === "integrity_gap") {
          gapVoidIncidentIds.add(Number(row.overlay_incident_id));
        }
        const mappedVoid = {
          betId: Number(row.id),
          forecastId: Number(row.forecast_id),
          roundId: row.external_round_id,
          targetNumber: Number(row.target_number),
          stake: Number(row.stake),
          balanceBefore: Number(row.balance_before),
          cycleNumber: Number(row.cycle_number_before),
          cycleStakedBefore: Number(row.cycle_staked_before),
          ladderLossBefore: Number(row.ladder_loss_before),
          missCountBefore: Number(row.ladder_miss_count_before),
          reason: row.overlay_reason,
          voidedAt: row.overlay_voided_at,
        };
        if (
          latestVoid === null
          || mappedVoid.voidedAt > latestVoid.voidedAt
          || (mappedVoid.voidedAt === latestVoid.voidedAt
            && mappedVoid.betId > latestVoid.betId)
        ) latestVoid = mappedVoid;
      }
      if (!overlaid) {
        accountingBalance -= Number(row.stake);
        totalStaked += Number(row.stake);
        minimumBalance = Math.min(minimumBalance, accountingBalance);
        maximumDrawdown = Math.max(maximumDrawdown, peakBalance - accountingBalance);
      }
      if (row.status === "pending") {
        if (overlaid || pendingBet !== null) {
          throw new Error("predictive leader v7 paper ladder pending bet is invalid");
        }
        pendingBet = {
          id: Number(row.id),
          forecastId: Number(row.forecast_id),
          roundId: row.external_round_id,
          targetNumber: Number(row.target_number),
          stake: Number(row.stake),
          rawStake: Number(row.raw_stake),
          balanceBefore: Number(row.balance_before),
          cycleNumber: Number(row.cycle_number_before),
          cycleStakedBefore: Number(row.cycle_staked_before),
          ladderLossBefore: Number(row.ladder_loss_before),
          missCountBefore: Number(row.ladder_miss_count_before),
          lockedAt: row.locked_at,
          bettingClosesAt: row.betting_closes_at,
          placedAt: row.placed_at,
        };
        continue;
      }
      if (row.status === "void") {
        if (!overlaid || row.overlay_prior_status !== "pending") {
          throw new Error("predictive leader v7 paper ladder void overlay is missing");
        }
        continue;
      }
      if (row.status !== "settled") {
        throw new Error("predictive leader v7 paper ladder bet status is invalid");
      }
      causalSettledCount += 1;
      const expectedSettlement = settlePredictiveLeaderV7PaperLadderBet({
        targetNumber: Number(row.target_number),
        resultNumber: Number(row.result_number),
        stake: Number(row.stake),
        balanceBefore: Number(row.balance_before),
        cycleSpendBefore: cycleStaked,
        ladderLossBefore: ladderLoss,
        cycleMissCountBefore: ladderMissCount,
      });
      const expectedCycleNumberAfter = cycleNumber
        + Number(expectedSettlement.cycleReset);
      if (
        row.outcome !== expectedSettlement.outcome
        || Number(row.gross_payout) !== expectedSettlement.grossPayout
        || Number(row.balance_after) !== expectedSettlement.balanceAfter
        || Number(row.cycle_number_after) !== expectedCycleNumberAfter
        || Number(row.cycle_staked_at_settlement)
          !== expectedSettlement.cycleSpendAtSettlement
        || Number(row.cycle_staked_after) !== expectedSettlement.cycleSpendAfter
        || Number(row.ladder_loss_after) !== expectedSettlement.ladderLossAfter
        || Number(row.ladder_miss_count_after)
          !== expectedSettlement.cycleMissCountAfter
        || Number(row.next_stake_after) !== expectedSettlement.nextStakeAfter
        || row.reset_reason !== expectedSettlement.resetReason
        || Number(row.round_result_id) !== Number(row.authoritative_result_id)
        || Number(row.result_number) !== Number(row.authoritative_actual_number)
        || Number(row.result_number) !== Number(row.authoritative_result_number)
        || row.settled_at !== row.authoritative_settled_at
        || row.settled_at !== row.result_settled_at
        || row.result_source !== safeSource
        || row.result_instrument !== safeInstrument
        || (row.result_round_id !== null
          && row.result_round_id !== row.external_round_id)
      ) {
        throw new Error("predictive leader v7 paper ladder settled bet audit is invalid");
      }
      if (expectedSettlement.cycleReset) {
        consumeReset({
          bet: row,
          reason: expectedSettlement.resetReason,
          expectedCycleStaked: expectedSettlement.cycleSpendAtSettlement,
          expectedLadderLoss: expectedSettlement.outcome === "hit"
            ? expectedSettlement.ladderLossBefore
            : expectedSettlement.cycleSpendAtSettlement,
          expectedMissCount: expectedSettlement.cycleMissCountAtSettlement,
          expectedNextStake: Number(row.stake),
        });
      } else {
        cycleStaked = expectedSettlement.cycleSpendAfter;
        ladderLoss = expectedSettlement.ladderLossAfter;
        ladderMissCount = expectedSettlement.cycleMissCountAfter;
      }
      if (overlaid) continue;
      accountingBalance += expectedSettlement.grossPayout;
      totalGrossPayout += expectedSettlement.grossPayout;
      if (expectedSettlement.outcome === "hit") hitCount += 1;
      else missCount += 1;
      peakBalance = Math.max(peakBalance, accountingBalance);
      minimumBalance = Math.min(minimumBalance, accountingBalance);
      maximumDrawdown = Math.max(maximumDrawdown, peakBalance - accountingBalance);
      latestOutcome = {
        betId: Number(row.id),
        forecastId: Number(row.forecast_id),
        resultId: Number(row.round_result_id),
        roundId: row.external_round_id,
        targetNumber: Number(row.target_number),
        resultNumber: Number(row.result_number),
        outcome: row.outcome,
        stake: Number(row.stake),
        grossPayout: expectedSettlement.grossPayout,
        balanceBefore: Number(row.balance_before),
        balanceAfter: Number(row.balance_after),
        cycleNumberBefore: Number(row.cycle_number_before),
        cycleNumberAfter: Number(row.cycle_number_after),
        cycleStakedBefore: Number(row.cycle_staked_before),
        cycleStakedAfter: Number(row.cycle_staked_after),
        ladderLossBefore: Number(row.ladder_loss_before),
        ladderLossAfter: Number(row.ladder_loss_after),
        missCountBefore: Number(row.ladder_miss_count_before),
        missCountAfter: Number(row.ladder_miss_count_after),
        nextStakeAfter: Number(row.next_stake_after),
        resetApplied: row.reset_reason !== null,
        resetReason: row.reset_reason,
        occurredAt: row.settled_at,
      };
    }
    while (resetIndex < resetRows.length) consumeGapReset();
    if (resetIndex !== resetRows.length) {
      throw new Error("predictive leader v7 paper ladder has an orphan reset");
    }
    const expectedNextStake = calculatePredictiveLeaderV7PaperNextStake(
      ladderLoss,
      cycleStaked,
    );
    const persistedEffectiveBalance = Number(campaign.current_balance)
      - Number(campaign.ledger_deficit);
    const expectedLedgerRevision = rows.length + causalSettledCount + voidCount
      + integrityGapResetCount;
    const gapResetIncidentIds = new Set(
      resetRows
        .filter((row) => row.reason === "integrity_gap")
        .map((row) => Number(row.incident_id)),
    );
    if (
      accountingBalance !== persistedEffectiveBalance
      || [...gapVoidIncidentIds].some((incidentId) => !gapResetIncidentIds.has(incidentId))
      || integrityGapResetCount !== Number(campaign.continuity_gap_count)
      || handledContinuityEpoch !== Number(campaign.last_continuity_epoch)
      || handledGapIncidentId > Number(campaign.last_gap_incident_id)
      || cycleNumber !== Number(campaign.cycle_number)
      || cycleStaked !== Number(campaign.cycle_staked)
      || ladderLoss !== Number(campaign.ladder_loss)
      || ladderMissCount !== Number(campaign.ladder_miss_count)
      || resetRows.length !== Number(campaign.reset_count)
      || expectedNextStake !== Number(campaign.next_stake)
      || expectedLedgerRevision !== Number(campaign.ledger_revision)
    ) {
      throw new Error("predictive leader v7 paper ladder campaign ledger is invalid");
    }
    const settledCount = hitCount + missCount;
    const affordabilityExhausted = Number(campaign.ledger_deficit) > 0
      || Number(campaign.current_balance) < expectedNextStake;
    const campaignShouldBeExhausted = pendingBet
      ? Number(campaign.ledger_deficit) > 0
      : affordabilityExhausted;
    if (
      (campaign.status === "exhausted") !== campaignShouldBeExhausted
      || (campaignShouldBeExhausted
        ? campaign.exhausted_at === null
        : campaign.exhausted_at !== null)
    ) {
      throw new Error("predictive leader v7 paper ladder campaign status is invalid");
    }
    const pendingReset = pendingBet !== null
      && pendingBet.cycleStakedBefore + pendingBet.stake
        === PREDICTIVE_LEADER_V7_PAPER_LADDER_CAMPAIGN.model.cycleSpendLimit
      ? "cycle_spend_cap"
      : null;
    const latestResetRow = resetRows.at(-1) ?? null;
    const latestReset = latestResetRow === null
      ? null
      : {
          id: Number(latestResetRow.id),
          betId: latestResetRow.trigger_bet_id === null
            ? null
            : Number(latestResetRow.trigger_bet_id),
          incidentId: latestResetRow.incident_id === null
            ? null
            : Number(latestResetRow.incident_id),
          continuityEpoch: latestResetRow.continuity_epoch === null
            ? null
            : Number(latestResetRow.continuity_epoch),
          cycleNumberBefore: Number(latestResetRow.cycle_number_before),
          cycleNumberAfter: Number(latestResetRow.cycle_number_after),
          reason: latestResetRow.reason,
          cycleStakedBefore: Number(latestResetRow.cycle_staked_before),
          ladderLossBefore: Number(latestResetRow.ladder_loss_before),
          missCountBefore: Number(latestResetRow.ladder_miss_count_before),
          nextStakeBefore: Number(latestResetRow.next_stake_before),
          nextStakeAfter: Number(latestResetRow.next_stake_after),
          occurredAt: latestResetRow.occurred_at,
        };
    return {
      schemaVersion: Number(campaign.schema_version),
      campaignKey: campaign.campaign_key,
      strategyVersion: campaign.strategy_version,
      candidateId: campaign.candidate_key,
      algorithmVersion: campaign.algorithm_version,
      mode: campaign.mode,
      executionEnabled: Boolean(campaign.execution_enabled),
      advisoryOnly: Boolean(campaign.advisory_only),
      promotionEligible: Boolean(campaign.promotion_eligible),
      promotionPolicy: campaign.promotion_policy,
      authorizationReason: campaign.authorization_reason,
      source: safeSource,
      instrument: safeInstrument,
      activationBoundary: {
        firstForecastId: Number(campaign.first_forecast_id),
        startedAt: campaign.started_at,
      },
      status: pendingBet ? "pending" : affordabilityExhausted ? "exhausted" : "waiting",
      reason: pendingBet
        ? "bet_frozen"
        : affordabilityExhausted
          ? "bankroll_exhausted"
          : rows.length === 0
            ? "waiting_first_frozen_v7"
            : "waiting_next_frozen_v7",
      initialBalance: Number(campaign.initial_balance),
      currentBalance: Number(campaign.current_balance),
      deficit: Number(campaign.ledger_deficit),
      accountingBalance,
      availableBalance: Number(campaign.current_balance),
      reservedStake: pendingBet?.stake ?? 0,
      profit: accountingBalance - Number(campaign.initial_balance),
      model: {
        kind: campaign.model_kind,
        initialBalance: Number(campaign.initial_balance),
        initialStake: Number(campaign.initial_stake),
        stakeStep: Number(campaign.stake_step),
        maxStake: Number(campaign.max_stake),
        cycleSpendLimit: Number(campaign.cycle_spend_limit),
        resetPolicy: campaign.reset_policy,
        grossPayoutMultiplier: Number(campaign.gross_payout_multiplier),
        payoutIncludesStake: Boolean(campaign.payout_includes_stake),
      },
      ladder: {
        cycleNumber,
        cycleStaked,
        ladderLoss,
        missCount: ladderMissCount,
        resetCount: resetRows.length,
        nextStake: expectedNextStake,
        pendingReset,
      },
      nextStake: expectedNextStake,
      canAffordNext: pendingBet === null && !affordabilityExhausted,
      shortfall: Math.max(0, expectedNextStake - accountingBalance),
      betCount: rows.length,
      settledCount,
      pendingCount: Number(pendingBet !== null),
      voidCount,
      hitCount,
      missCount,
      hitRate: settledCount === 0 ? null : hitCount / settledCount,
      totalStaked,
      totalGrossPayout,
      peakBalance,
      minimumBalance,
      maximumDrawdown,
      continuityGapCount: Number(campaign.continuity_gap_count),
      ledgerRevision: Number(campaign.ledger_revision),
      pendingBet,
      latestOutcome,
      latestVoid,
      latestReset,
      startedAt: campaign.started_at,
      updatedAt: campaign.updated_at,
      exhaustedAt: campaign.exhausted_at,
    };
  }

  getPredictiveLeaderV7FixedPaperState(
    source = PREDICTIVE_SHADOW_FROZEN_STREAM.source,
    instrument = PREDICTIVE_SHADOW_FROZEN_STREAM.instrument,
  ) {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const campaign = this.#requirePredictiveLeaderV7PaperCampaign(
      safeSource,
      safeInstrument,
    );
    const rows = this.sqlite.prepare(`
      SELECT
        bets.*,
        snapshots.external_round_id AS forecast_round_id,
        snapshots.locked_at AS forecast_locked_at,
        snapshots.betting_closes_at AS forecast_betting_closes_at,
        settlements.round_result_id AS authoritative_result_id,
        settlements.actual_number AS authoritative_actual_number,
        settlements.settled_at AS authoritative_settled_at,
        results.source AS result_source,
        results.instrument AS result_instrument,
        results.external_round_id AS result_round_id,
        results.result_number AS authoritative_result_number,
        results.settled_at AS result_settled_at,
        voids.campaign_id AS overlay_campaign_id,
        voids.prior_status AS overlay_prior_status,
        voids.reason AS overlay_reason,
        voids.balance_adjustment AS overlay_balance_adjustment,
        voids.incident_id AS overlay_incident_id,
        voids.continuity_epoch AS overlay_continuity_epoch,
        voids.voided_at AS overlay_voided_at
      FROM predictive_leader_v7_paper_bets AS bets
      JOIN round_forecasts AS forecasts ON forecasts.id = bets.forecast_id
      JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
      LEFT JOIN forecast_settlements AS settlements
        ON settlements.forecast_id = bets.forecast_id
      LEFT JOIN round_results AS results ON results.id = settlements.round_result_id
      LEFT JOIN predictive_leader_v7_paper_voids AS voids ON voids.bet_id = bets.id
      WHERE bets.campaign_id = ?
      ORDER BY bets.id
    `).all(Number(campaign.id));
    let accountingBalance = Number(campaign.initial_balance);
    let peakBalance = accountingBalance;
    let minimumBalance = accountingBalance;
    let maximumDrawdown = 0;
    let totalStaked = 0;
    let totalGrossPayout = 0;
    let hitCount = 0;
    let missCount = 0;
    let pendingBet = null;
    let latestOutcome = null;
    let latestVoid = null;
    let voidCount = 0;
    let gapVoidCount = 0;
    for (const row of rows) {
      if (
        row.candidate_key !== campaign.candidate_key
        || Number(row.stake) !== Number(campaign.fixed_stake)
        || row.external_round_id !== row.forecast_round_id
        || row.locked_at !== row.forecast_locked_at
        || row.betting_closes_at !== row.forecast_betting_closes_at
      ) {
        throw new Error("predictive leader v7 paper bet audit is invalid");
      }
      const overlaid = row.overlay_reason !== null;
      if (overlaid) {
        const expectedAdjustment = row.overlay_prior_status === "pending"
          ? Number(row.stake)
          : row.overlay_prior_status === "settled"
            ? Number(row.stake) - Number(row.gross_payout)
            : null;
        if (
          !["integrity_gap", "round_metadata_conflict"].includes(row.overlay_reason)
          || Number(row.overlay_campaign_id) !== Number(campaign.id)
          || Number(row.overlay_balance_adjustment) !== expectedAdjustment
          || (row.overlay_prior_status === "pending" && row.status !== "void")
          || (row.overlay_prior_status === "settled" && row.status !== "settled")
          || (row.overlay_prior_status === "pending"
            && (
              row.void_reason !== row.overlay_reason
              || row.void_incident_id !== row.overlay_incident_id
              || row.void_continuity_epoch !== row.overlay_continuity_epoch
              || row.voided_at !== row.overlay_voided_at
            ))
        ) {
          throw new Error("predictive leader v7 paper void overlay is invalid");
        }
        voidCount += 1;
        if (row.overlay_reason === "integrity_gap") gapVoidCount += 1;
        const mappedVoid = {
          betId: Number(row.id),
          forecastId: Number(row.forecast_id),
          roundId: row.external_round_id,
          targetNumber: Number(row.target_number),
          stake: Number(row.stake),
          reason: row.overlay_reason,
          voidedAt: row.overlay_voided_at,
        };
        if (
          latestVoid === null
          || mappedVoid.voidedAt > latestVoid.voidedAt
          || (mappedVoid.voidedAt === latestVoid.voidedAt
            && mappedVoid.betId > latestVoid.betId)
        ) latestVoid = mappedVoid;
        continue;
      }
      if (row.status === "void") {
        throw new Error("predictive leader v7 paper void overlay is missing");
      }
      accountingBalance -= Number(row.stake);
      totalStaked += Number(row.stake);
      minimumBalance = Math.min(minimumBalance, accountingBalance);
      maximumDrawdown = Math.max(maximumDrawdown, peakBalance - accountingBalance);
      if (row.status === "pending") {
        if (pendingBet !== null) {
          throw new Error("predictive leader v7 paper has multiple pending bets");
        }
        pendingBet = {
          id: Number(row.id),
          forecastId: Number(row.forecast_id),
          roundId: row.external_round_id,
          targetNumber: Number(row.target_number),
          stake: Number(row.stake),
          lockedAt: row.locked_at,
          bettingClosesAt: row.betting_closes_at,
          placedAt: row.placed_at,
        };
        continue;
      }
      if (row.status !== "settled") {
        throw new Error("predictive leader v7 paper bet status is invalid");
      }
      const expectedOutcome = Number(row.target_number) === Number(row.result_number)
        ? "hit"
        : "miss";
      const expectedGross = expectedOutcome === "hit"
        ? Number(row.stake) * Number(campaign.gross_payout_multiplier)
        : 0;
      if (
        row.outcome !== expectedOutcome
        || Number(row.gross_payout) !== expectedGross
        || Number(row.balance_after)
          !== Number(row.balance_before) - Number(row.stake) + expectedGross
        || Number(row.round_result_id) !== Number(row.authoritative_result_id)
        || Number(row.result_number) !== Number(row.authoritative_actual_number)
        || Number(row.result_number) !== Number(row.authoritative_result_number)
        || row.settled_at !== row.authoritative_settled_at
        || row.settled_at !== row.result_settled_at
        || row.result_source !== safeSource
        || row.result_instrument !== safeInstrument
        || (row.result_round_id !== null
          && row.result_round_id !== row.external_round_id)
      ) {
        throw new Error("predictive leader v7 paper settled bet audit is invalid");
      }
      accountingBalance += expectedGross;
      totalGrossPayout += expectedGross;
      if (expectedOutcome === "hit") hitCount += 1;
      else missCount += 1;
      peakBalance = Math.max(peakBalance, accountingBalance);
      minimumBalance = Math.min(minimumBalance, accountingBalance);
      maximumDrawdown = Math.max(maximumDrawdown, peakBalance - accountingBalance);
      latestOutcome = {
        betId: Number(row.id),
        forecastId: Number(row.forecast_id),
        resultId: Number(row.round_result_id),
        roundId: row.external_round_id,
        targetNumber: Number(row.target_number),
        resultNumber: Number(row.result_number),
        outcome: row.outcome,
        stake: Number(row.stake),
        grossPayout: expectedGross,
        balanceAfter: Number(row.balance_after),
        occurredAt: row.settled_at,
      };
    }
    const persistedEffectiveBalance = Number(campaign.current_balance)
      - Number(campaign.ledger_deficit);
    if (
      accountingBalance !== persistedEffectiveBalance
      || gapVoidCount !== Number(campaign.continuity_gap_count)
    ) {
      throw new Error("predictive leader v7 paper campaign ledger is invalid");
    }
    const settledCount = hitCount + missCount;
    const affordabilityExhausted = Number(campaign.ledger_deficit) > 0
      || Number(campaign.current_balance) < Number(campaign.fixed_stake);
    const campaignShouldBeExhausted = pendingBet
      ? Number(campaign.ledger_deficit) > 0
      : affordabilityExhausted;
    if (
      (campaign.status === "exhausted") !== campaignShouldBeExhausted
      || (campaignShouldBeExhausted
        ? campaign.exhausted_at === null
        : campaign.exhausted_at !== null)
    ) {
      throw new Error("predictive leader v7 paper campaign status is invalid");
    }
    return {
      schemaVersion: Number(campaign.schema_version),
      campaignKey: campaign.campaign_key,
      strategyVersion: campaign.strategy_version,
      candidateId: campaign.candidate_key,
      algorithmVersion: campaign.algorithm_version,
      mode: campaign.mode,
      executionEnabled: Boolean(campaign.execution_enabled),
      advisoryOnly: Boolean(campaign.advisory_only),
      promotionEligible: Boolean(campaign.promotion_eligible),
      promotionPolicy: campaign.promotion_policy,
      authorizationReason: campaign.authorization_reason,
      source: safeSource,
      instrument: safeInstrument,
      activationBoundary: {
        firstForecastId: Number(campaign.first_forecast_id),
        startedAt: campaign.started_at,
      },
      status: pendingBet ? "pending" : affordabilityExhausted ? "exhausted" : "waiting",
      reason: pendingBet
        ? "bet_frozen"
        : affordabilityExhausted
          ? "bankroll_exhausted"
          : "waiting_next_frozen_v7",
      initialBalance: Number(campaign.initial_balance),
      currentBalance: Number(campaign.current_balance),
      deficit: Number(campaign.ledger_deficit),
      accountingBalance,
      availableBalance: Number(campaign.current_balance),
      reservedStake: pendingBet?.stake ?? 0,
      profit: accountingBalance - Number(campaign.initial_balance),
      model: {
        fixedStake: Number(campaign.fixed_stake),
        grossPayoutMultiplier: Number(campaign.gross_payout_multiplier),
        payoutIncludesStake: Boolean(campaign.payout_includes_stake),
      },
      nextStake: Number(campaign.fixed_stake),
      canAffordNext: pendingBet === null && !affordabilityExhausted
        && Number(campaign.current_balance) >= Number(campaign.fixed_stake),
      shortfall: Math.max(
        0,
        Number(campaign.fixed_stake) - accountingBalance,
      ),
      betCount: rows.length,
      settledCount,
      pendingCount: Number(pendingBet !== null),
      voidCount,
      hitCount,
      missCount,
      hitRate: settledCount === 0 ? null : hitCount / settledCount,
      totalStaked,
      totalGrossPayout,
      peakBalance,
      minimumBalance,
      maximumDrawdown,
      continuityGapCount: Number(campaign.continuity_gap_count),
      pendingBet,
      latestOutcome,
      latestVoid,
      startedAt: campaign.started_at,
      updatedAt: campaign.updated_at,
      exhaustedAt: campaign.exhausted_at,
    };
  }

  settlePredictiveLeaderSignalAccount(
    source = "buleto",
    instrument = "default",
  ) {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const now = asTimestamp(
      this.clock(),
      undefined,
      "predictive leader signal settledAt",
    );
    return this.#transaction(() => {
      const pending = this.sqlite.prepare(`
        SELECT
          bets.*,
          leaders.status AS leader_status,
          leaders.predicted_number AS leader_number,
          gates.policy_version AS frozen_gate_version,
          gates.eligible AS gate_eligible,
          snapshots.source AS forecast_source,
          snapshots.instrument AS forecast_instrument,
          settlements.round_result_id AS settlement_result_id,
          settlements.actual_number AS settlement_actual_number,
          settlements.settled_at AS settlement_occurred_at,
          results.result_number AS stored_result_number,
          results.settled_at AS result_occurred_at
        FROM predictive_leader_gated_fixed_bets AS bets
        JOIN forecast_predictive_leader_snapshots AS leaders
          ON leaders.forecast_id = bets.forecast_id
        JOIN forecast_predictive_leader_quality_snapshots AS gates
          ON gates.forecast_id = bets.forecast_id
        JOIN round_forecasts AS forecasts ON forecasts.id = bets.forecast_id
        JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
        LEFT JOIN forecast_settlements AS settlements
          ON settlements.forecast_id = bets.forecast_id
        LEFT JOIN round_results AS results
          ON results.id = settlements.round_result_id
        WHERE bets.source = ? AND bets.instrument = ? AND bets.status = 'pending'
      `).get(safeSource, safeInstrument);
      if (!pending) return { settled: 0, voided: 0 };
      if (
        Number(pending.schema_version)
          !== PREDICTIVE_LEADER_SIGNAL_ACCOUNT_SCHEMA_VERSION
        || pending.strategy_version
          !== PREDICTIVE_LEADER_SIGNAL_ACCOUNT_STRATEGY_VERSION
        || pending.leader_algorithm_version !== LEARNED_LEADER_ALGORITHM_VERSION
        || pending.gate_version !== PREDICTIVE_LEADER_QUALITY_GATE.version
        || pending.frozen_gate_version !== PREDICTIVE_LEADER_QUALITY_GATE.version
        || Number(pending.gate_eligible) !== 1
        || pending.leader_status !== "ready"
        || Number(pending.target_number) !== Number(pending.leader_number)
        || pending.source !== pending.forecast_source
        || pending.instrument !== pending.forecast_instrument
        || Number(pending.stake) !== PREDICTIVE_LEADER_SIGNAL_STAKE
      ) {
        throw new Error("predictive leader signal cursor is invalid");
      }

      if (pending.settlement_result_id !== null) {
        if (
          Number(pending.settlement_actual_number)
            !== Number(pending.stored_result_number)
          || pending.settlement_occurred_at !== pending.result_occurred_at
        ) {
          throw new Error("predictive leader signal settlement is inconsistent");
        }
        const resultNumber = Number(pending.stored_result_number);
        const hit = resultNumber === Number(pending.target_number);
        const grossPayout = hit
          ? PREDICTIVE_LEADER_SIGNAL_STAKE
            * PREDICTIVE_LEADER_SIGNAL_GROSS_PAYOUT_MULTIPLIER
          : 0;
        const balanceAfter = Number(pending.balance_before)
          - PREDICTIVE_LEADER_SIGNAL_STAKE
          + grossPayout;
        const update = this.sqlite.prepare(`
          UPDATE predictive_leader_gated_fixed_bets
          SET status = 'settled', round_result_id = ?, result_number = ?,
            outcome = ?, gross_payout = ?, balance_after = ?, settled_at = ?,
            updated_at = ?
          WHERE forecast_id = ? AND status = 'pending'
        `).run(
          Number(pending.settlement_result_id),
          resultNumber,
          hit ? "hit" : "miss",
          grossPayout,
          balanceAfter,
          pending.result_occurred_at,
          now,
          Number(pending.forecast_id),
        );
        return { settled: Number(update.changes), voided: 0 };
      }

      const currentEpoch = this.#continuityEpoch(safeSource, safeInstrument) ?? 0;
      if (Number(pending.continuity_epoch) !== currentEpoch) {
        if (
          this.#predictiveLeaderPendingResultIsResolvable(
            Number(pending.forecast_id),
            safeSource,
            safeInstrument,
          )
        ) {
          return { settled: 0, voided: 0 };
        }
        const update = this.sqlite.prepare(`
          UPDATE predictive_leader_gated_fixed_bets
          SET status = 'void', void_reason = 'integrity_gap', settled_at = ?,
            updated_at = ?
          WHERE forecast_id = ? AND status = 'pending'
        `).run(now, now, Number(pending.forecast_id));
        return { settled: 0, voided: Number(update.changes) };
      }
      return { settled: 0, voided: 0 };
    });
  }

  settlePredictiveLeaderAccount(source = "buleto", instrument = "default") {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const now = asTimestamp(this.clock(), undefined, "predictive leader account settledAt");
    return this.#transaction(() => {
      const account = this.sqlite
        .prepare(`
          SELECT *
          FROM predictive_leader_accounts
          WHERE source = ? AND instrument = ?
        `)
        .get(safeSource, safeInstrument);
      if (!account || account.pending_forecast_id === null) return { settled: 0 };
      if (account.status !== "running") {
        throw new Error("exhausted predictive leader account cannot have a pending bet");
      }
      const bet = this.sqlite
        .prepare(`
          SELECT
            bets.*,
            leaders.status AS leader_status,
            leaders.algorithm_version AS stored_leader_algorithm_version,
            leaders.predicted_number AS stored_leader_number,
            snapshots.source AS forecast_source,
            snapshots.instrument AS forecast_instrument,
            settlements.round_result_id AS settlement_result_id,
            settlements.actual_number AS settlement_actual_number,
            settlements.settled_at AS settlement_occurred_at,
            results.result_number AS stored_result_number,
            results.settled_at AS result_occurred_at
          FROM predictive_leader_account_bets AS bets
        CROSS JOIN forecast_predictive_leader_snapshots AS leaders
            ON leaders.forecast_id = bets.forecast_id
          JOIN round_forecasts AS forecasts ON forecasts.id = bets.forecast_id
          JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
          LEFT JOIN forecast_settlements AS settlements
            ON settlements.forecast_id = bets.forecast_id
          LEFT JOIN round_results AS results
            ON results.id = settlements.round_result_id
          WHERE bets.forecast_id = ? AND bets.status = 'pending'
        `)
        .get(Number(account.pending_forecast_id));
      if (!bet) {
        throw new Error("predictive leader account pending pointer is invalid");
      }
      if (bet.settlement_result_id === null) return { settled: 0 };
      const resultNumber = Number(bet.settlement_actual_number);
      if (
        Number(bet.schema_version) !== PREDICTIVE_LEADER_ACCOUNT_SCHEMA_VERSION
        || bet.strategy_version !== PREDICTIVE_LEADER_ACCOUNT_STRATEGY_VERSION
        || bet.leader_algorithm_version !== LEARNED_LEADER_ALGORITHM_VERSION
        || bet.stored_leader_algorithm_version !== LEARNED_LEADER_ALGORITHM_VERSION
        || bet.leader_status !== "ready"
        || Number(bet.target_number) !== Number(bet.stored_leader_number)
        || bet.source !== safeSource
        || bet.instrument !== safeInstrument
        || bet.forecast_source !== safeSource
        || bet.forecast_instrument !== safeInstrument
        || Number(bet.round_result_id ?? bet.settlement_result_id)
          !== Number(bet.settlement_result_id)
        || resultNumber !== Number(bet.stored_result_number)
        || bet.settlement_occurred_at !== bet.result_occurred_at
        || Number(bet.balance_before) !== Number(account.current_balance)
        || Number(bet.ladder_loss_before) !== Number(account.ladder_total_loss)
        || Number(bet.ladder_miss_count_before) !== Number(account.ladder_miss_count)
        || Number(bet.stake) !== Number(account.next_stake)
      ) {
        throw new Error("predictive leader account settlement cursor is invalid");
      }
      const settlement = settlePredictiveLeaderBet({
        targetNumber: Number(bet.target_number),
        resultNumber,
        stake: Number(bet.stake),
        balanceBefore: Number(account.current_balance),
        ladderLossBefore: Number(account.ladder_total_loss),
        model: {
          initialStake: Number(account.initial_stake),
          stakeStep: Number(account.stake_step),
          maxStake: Number(account.max_stake),
          grossPayoutMultiplier: Number(account.gross_payout_multiplier),
          payoutIncludesStake: Boolean(account.payout_includes_stake),
        },
      });
      const ladderMissCountAfter = settlement.outcome === "hit"
        ? 0
        : Number(account.ladder_miss_count) + settlement.ladderMissCountDelta;
      const exhausted = settlement.outcome === "miss"
        && settlement.nextStakeAfter > settlement.balanceAfter;
      const betUpdate = this.sqlite
        .prepare(`
          UPDATE predictive_leader_account_bets
          SET status = 'settled', round_result_id = ?, result_number = ?,
            outcome = ?, gross_payout = ?, balance_after = ?,
            ladder_loss_after = ?, ladder_miss_count_after = ?,
            next_stake_after = ?, recovery_possible = ?, occurred_at = ?,
            settled_at = ?, updated_at = ?
          WHERE forecast_id = ? AND status = 'pending'
        `)
        .run(
          Number(bet.settlement_result_id),
          resultNumber,
          settlement.outcome,
          settlement.grossPayout,
          settlement.balanceAfter,
          settlement.ladderLossAfter,
          ladderMissCountAfter,
          settlement.nextStakeAfter,
          settlement.recoveryPossible ? 1 : 0,
          bet.result_occurred_at,
          now,
          now,
          Number(bet.forecast_id),
        );
      if (Number(betUpdate.changes) !== 1) {
        throw new Error("predictive leader account bet was not settled exactly once");
      }
      const accountUpdate = this.sqlite
        .prepare(`
          UPDATE predictive_leader_accounts
          SET status = ?, current_balance = ?, next_stake = ?,
            ladder_miss_count = ?, ladder_total_loss = ?,
            pending_forecast_id = NULL, updated_at = ?, exhausted_at = ?
          WHERE source = ? AND instrument = ? AND status = 'running'
            AND pending_forecast_id = ?
        `)
        .run(
          exhausted ? "exhausted" : "running",
          settlement.balanceAfter,
          settlement.nextStakeAfter,
          ladderMissCountAfter,
          settlement.ladderLossAfter,
          now,
          exhausted ? bet.result_occurred_at : null,
          safeSource,
          safeInstrument,
          Number(bet.forecast_id),
        );
      if (Number(accountUpdate.changes) !== 1) {
        throw new Error("predictive leader account was not updated exactly once");
      }
      this.#applyPendingPredictiveLeaderAccountResetInTransaction({
        source: safeSource,
        instrument: safeInstrument,
        appliedAt: now,
      });
      return { settled: 1 };
    });
  }

  reconcilePredictiveLeaderAccount(source = "buleto", instrument = "default") {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const now = asTimestamp(
      this.clock(),
      undefined,
      "predictive leader account reconciledAt",
    );
    return this.#transaction(() => {
      const account = this.sqlite
        .prepare(`
          SELECT *
          FROM predictive_leader_accounts
          WHERE source = ? AND instrument = ?
        `)
        .get(safeSource, safeInstrument);
      let voidOutcome = { voided: 0, reason: "no_pending_bet" };
      if (account?.pending_forecast_id !== null && account?.pending_forecast_id !== undefined) {
        const currentEpoch = this.#continuityEpoch(safeSource, safeInstrument);
        const bet = this.sqlite
          .prepare(`
            SELECT continuity_epoch
            FROM predictive_leader_account_bets
            WHERE forecast_id = ? AND status = 'pending'
          `)
          .get(Number(account.pending_forecast_id));
        if (!bet) {
          throw new Error("predictive leader account pending pointer is invalid");
        }
        const betEpoch = bet.continuity_epoch === null
          ? null
          : Number(bet.continuity_epoch);
        if (betEpoch === null || betEpoch < currentEpoch) {
          const incident = this.sqlite
            .prepare(`
              SELECT id
              FROM incidents
              WHERE source = ? AND instrument = ? AND kind = 'gap'
              ORDER BY id DESC
              LIMIT 1
            `)
            .get(safeSource, safeInstrument);
          if (incident) {
            voidOutcome = this.#voidPredictiveLeaderPendingBetForGapInTransaction({
              source: safeSource,
              instrument: safeInstrument,
              incidentId: Number(incident.id),
              continuityEpoch: currentEpoch,
              voidedAt: now,
            });
          }
        } else if (betEpoch > currentEpoch) {
          throw new Error("predictive leader pending bet is ahead of continuity");
        }
      }

      const refreshedAccount = this.sqlite
        .prepare(`
          SELECT pending_forecast_id
          FROM predictive_leader_accounts
          WHERE source = ? AND instrument = ?
        `)
        .get(safeSource, safeInstrument);
      if (refreshedAccount?.pending_forecast_id !== null
        && refreshedAccount?.pending_forecast_id !== undefined) {
        return {
          placed: 0,
          reason: voidOutcome.reason === "result_resolvable"
            ? "result_resolvable"
            : "prior_pending",
          voided: voidOutcome.voided,
        };
      }
      this.#applyPendingPredictiveLeaderAccountResetInTransaction({
        source: safeSource,
        instrument: safeInstrument,
        appliedAt: now,
      });
      if (!this.predictiveLeaderLegacyAccountEnabled) {
        return {
          placed: 0,
          reason: "strategy_retired",
          voided: voidOutcome.voided,
        };
      }

      const candidate = this.sqlite
        .prepare(`
          SELECT
            leaders.*,
            snapshots.source,
            snapshots.instrument,
            snapshots.external_round_id,
            snapshots.betting_closes_at,
            snapshots.locked_at AS forecast_locked_at,
            settlements.forecast_id AS settlement_forecast_id,
            bets.forecast_id AS account_bet_forecast_id
          FROM forecast_predictive_leader_snapshots AS leaders
          JOIN round_forecasts AS forecasts ON forecasts.id = leaders.forecast_id
          JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
          LEFT JOIN forecast_settlements AS settlements
            ON settlements.forecast_id = leaders.forecast_id
          LEFT JOIN predictive_leader_account_bets AS bets
            ON bets.forecast_id = leaders.forecast_id
          WHERE snapshots.source = ?
            AND snapshots.instrument = ?
            AND leaders.algorithm_version = ?
          ORDER BY leaders.forecast_id DESC
          LIMIT 1
        `)
        .get(
          safeSource,
          safeInstrument,
          LEARNED_LEADER_ALGORITHM_VERSION,
        );
      if (!candidate) {
        return { placed: 0, reason: "no_eligible_leader", voided: voidOutcome.voided };
      }
      if (
        candidate.status !== "ready"
        || candidate.settlement_forecast_id !== null
        || candidate.account_bet_forecast_id !== null
      ) {
        return { placed: 0, reason: "no_eligible_leader", voided: voidOutcome.voided };
      }
      if (
        Date.parse(now) < Date.parse(candidate.forecast_locked_at)
        || Date.parse(candidate.betting_closes_at) - Date.parse(now) < 5_000
      ) {
        return { placed: 0, reason: "outside_safe_window", voided: voidOutcome.voided };
      }
      const knownTarget = this.sqlite
        .prepare(`
          SELECT id
          FROM round_results
          WHERE source = ? AND instrument = ? AND external_round_id = ?
          LIMIT 1
        `)
        .get(safeSource, safeInstrument, candidate.external_round_id);
      if (knownTarget) {
        return { placed: 0, reason: "target_known", voided: voidOutcome.voided };
      }
      const decision = normalizeLearnedLeaderDecision(
        deserializeJson(candidate.snapshot_json),
      );
      if (
        !decision
        || !validLearnedLeaderAudit(decision)
        || decision.status !== "ready"
        || decision.algorithmVersion !== LEARNED_LEADER_ALGORITHM_VERSION
        || decision.lockedAt !== candidate.locked_at
        || decision.lockedAt !== candidate.forecast_locked_at
        || Number(decision.leaderNumber) !== Number(candidate.predicted_number)
        || Math.abs(Number(decision.leaderMass) - Number(candidate.score)) > 1e-12
      ) {
        throw new Error("predictive leader reconciliation snapshot is invalid");
      }
      const placement = this.#placePredictiveLeaderAccountBetInTransaction({
        forecastId: Number(candidate.forecast_id),
        source: safeSource,
        instrument: safeInstrument,
        decision,
        historyMaxResultId: candidate.history_max_result_id === null
          ? null
          : Number(candidate.history_max_result_id),
        placedAt: now,
      });
      return {
        placed: Number(placement.placed),
        reason: placement.reason,
        forecastId: Number(candidate.forecast_id),
        voided: voidOutcome.voided,
      };
    });
  }

  settlePrecloseForecasts(source = "buleto", instrument = "default") {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const now = new Date().toISOString();
    const outcome = this.#transaction(() => {
      const rows = this.sqlite
        .prepare(`
          SELECT
            forecasts.id AS forecast_id,
            snapshots.source,
            snapshots.instrument,
            snapshots.external_round_id,
            snapshots.round_ends_at,
            snapshots.current_number,
            forecasts.ranked_numbers_json
          FROM round_forecasts AS forecasts
          JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
          LEFT JOIN forecast_settlements AS settlements
            ON settlements.forecast_id = forecasts.id
          WHERE snapshots.source = ?
            AND snapshots.instrument = ?
            AND settlements.forecast_id IS NULL
          ORDER BY forecasts.id
        `)
        .all(safeSource, safeInstrument);
      const exactResult = this.sqlite.prepare(`
        SELECT id, result_number, settled_at
        FROM round_results
        WHERE source = ? AND instrument = ? AND external_round_id = ?
        LIMIT 1
      `);
      const anonymousResultsNearEnd = this.sqlite.prepare(`
        SELECT id, result_number, settled_at
        FROM round_results
        WHERE source = ?
          AND instrument = ?
          AND external_round_id IS NULL
          AND settled_at >= ?
          AND settled_at <= ?
          AND NOT EXISTS (
            SELECT 1
            FROM forecast_settlements
            WHERE forecast_settlements.round_result_id = round_results.id
          )
        ORDER BY settled_at, id
        LIMIT 2
      `);
      const unsettledForecastsAtEnd = this.sqlite.prepare(`
        SELECT COUNT(*) AS count
        FROM round_forecasts AS forecasts
        JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
        LEFT JOIN forecast_settlements AS settlements
          ON settlements.forecast_id = forecasts.id
        WHERE snapshots.source = ?
          AND snapshots.instrument = ?
          AND snapshots.round_ends_at = ?
          AND settlements.forecast_id IS NULL
      `);
      const insert = this.sqlite.prepare(`
        INSERT INTO forecast_settlements (
          forecast_id, round_result_id, actual_number, settled_at,
          top1_hit, top3_hit, current_cell_hit, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(forecast_id) DO NOTHING
      `);
      let inserted = 0;
      for (const row of rows) {
        let result = exactResult.get(
          row.source,
          row.instrument,
          row.external_round_id,
        );
        if (!result) {
          const expectedEndMs = Date.parse(row.round_ends_at);
          const candidates = Number.isFinite(expectedEndMs)
            ? anonymousResultsNearEnd.all(
                row.source,
                row.instrument,
                new Date(expectedEndMs - 3_000).toISOString(),
                new Date(expectedEndMs + 1_000).toISOString(),
              )
            : [];
          const unsettledCount = Number(
            unsettledForecastsAtEnd.get(
              row.source,
              row.instrument,
              row.round_ends_at,
            ).count,
          );
          if (candidates.length === 1 && unsettledCount === 1) result = candidates[0];
        }
        if (!result) continue;
        const ranked = deserializeJson(row.ranked_numbers_json);
        if (!Array.isArray(ranked) || ranked.length !== 3) {
          throw new Error("stored forecast ranking is invalid");
        }
        const actualNumber = Number(result.result_number);
        inserted += Number(
          insert.run(
            Number(row.forecast_id),
            Number(result.id),
            actualNumber,
            result.settled_at,
            Number(ranked[0]) === actualNumber ? 1 : 0,
            ranked.map(Number).includes(actualNumber) ? 1 : 0,
            Number(row.current_number) === actualNumber ? 1 : 0,
            now,
          ).changes,
        );
      }
      return { settled: inserted };
    });
    if (
      safeSource === PREDICTIVE_SHADOW_FROZEN_STREAM.source
      && safeInstrument === PREDICTIVE_SHADOW_FROZEN_STREAM.instrument
    ) {
      try {
        this.reconcilePredictiveLeaderV7PaperCampaign(safeSource, safeInstrument);
      } catch (error) {
        emitLog(
          this.logger,
          "error",
          { error, source: safeSource, instrument: safeInstrument },
          "predictive leader v7 paper settlement failed without affecting forecasts",
        );
      }
      try {
        this.reconcilePredictiveLeaderWarmTop1PaperCampaign(
          safeSource,
          safeInstrument,
        );
      } catch (error) {
        emitLog(
          this.logger,
          "error",
          { error, source: safeSource, instrument: safeInstrument },
          "predictive leader warm top1 paper settlement failed without affecting forecasts",
        );
      }
    }
    return outcome;
  }

  #writePredictiveLeaderMetricFacts(rows) {
    if (rows.length === 0) return;
    const statement = this.sqlite.prepare(`
      INSERT INTO forecast_predictive_leader_metric_facts (
        forecast_id, metric_version, ready_count, settled_count,
        top1_hits, top3_hits, combined_brier_loss
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(forecast_id) DO UPDATE SET
        metric_version = excluded.metric_version,
        ready_count = excluded.ready_count,
        settled_count = excluded.settled_count,
        top1_hits = excluded.top1_hits,
        top3_hits = excluded.top3_hits,
        combined_brier_loss = excluded.combined_brier_loss
    `);
    const clearDirty = this.sqlite.prepare(`
      DELETE FROM forecast_predictive_leader_metric_dirty WHERE forecast_id = ?
    `);
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        const fact = buildPredictiveLeaderMetricFact(row);
        statement.run(
          Number(row.forecast_id),
          PREDICTIVE_LEADER_METRIC_FACT_VERSION,
          fact.readyCount,
          fact.settledCount,
          fact.top1Hits,
          fact.top3Hits,
          fact.combinedBrierLoss,
        );
        clearDirty.run(Number(row.forecast_id));
      }
      this.sqlite.exec("COMMIT");
    } catch (error) {
      try {
        this.sqlite.exec("ROLLBACK");
      } catch {
        // Preserve the materialization error.
      }
      throw error;
    }
  }

  #ensurePredictiveLeaderMetricFacts(source, instrument, horizonSeconds) {
    const rows = this.sqlite.prepare(`
        WITH candidate_ids AS (
          SELECT forecast_id FROM forecast_predictive_leader_metric_dirty
          UNION
          SELECT leaders.forecast_id
          FROM forecast_predictive_leader_snapshots AS leaders
            INDEXED BY forecast_predictive_leaders_metric_idx
          LEFT JOIN forecast_predictive_leader_metric_facts AS metric_facts
            ON metric_facts.forecast_id = leaders.forecast_id
           AND metric_facts.metric_version = ?
          WHERE leaders.schema_version = ?
            AND leaders.algorithm_version = ?
            AND metric_facts.forecast_id IS NULL
        )
        SELECT
          forecasts.id AS forecast_id,
          snapshots.locked_at,
          leaders.forecast_id AS leader_forecast_id,
          leaders.schema_version AS leader_schema_version,
          leaders.algorithm_version AS leader_algorithm_version,
          leaders.status AS leader_status,
          leaders.locked_at AS leader_locked_at,
          leaders.history_max_result_id AS leader_history_max_result_id,
          leaders.training_through_forecast_id
            AS leader_training_through_forecast_id,
          leaders.training_through_result_id
            AS leader_training_through_result_id,
          leader_training_settlements.round_result_id
            AS leader_expected_training_result_id,
          leaders.training_count AS leader_training_count,
          leaders.predicted_number AS leader_predicted_number,
          leaders.score AS leader_score,
          leaders.snapshot_json AS leader_snapshot_json,
          leaders.created_at AS leader_created_at,
          settlements.round_result_id,
          settlements.actual_number,
          settlements.settled_at,
          settlements.created_at AS settlement_created_at
        FROM candidate_ids AS metric_dirty
        CROSS JOIN forecast_predictive_leader_snapshots AS leaders
          ON leaders.forecast_id = metric_dirty.forecast_id
        JOIN round_forecasts AS forecasts ON forecasts.id = leaders.forecast_id
        JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
        LEFT JOIN forecast_settlements AS settlements
          ON settlements.forecast_id = forecasts.id
        LEFT JOIN forecast_settlements AS leader_training_settlements
          ON leader_training_settlements.forecast_id =
            leaders.training_through_forecast_id
        WHERE snapshots.source = ?
          AND snapshots.instrument = ?
          AND snapshots.horizon_seconds = ?
          AND leaders.schema_version = ?
          AND leaders.algorithm_version = ?
        ORDER BY leaders.forecast_id
      `).all(
      PREDICTIVE_LEADER_METRIC_FACT_VERSION,
      LEARNED_LEADER_SCHEMA_VERSION,
      LEARNED_LEADER_ALGORITHM_VERSION,
      source,
      instrument,
      horizonSeconds,
      LEARNED_LEADER_SCHEMA_VERSION,
      LEARNED_LEADER_ALGORITHM_VERSION,
    );
    this.#writePredictiveLeaderMetricFacts(rows);
  }

  #predictiveLeaderMetricRows(source, instrument, horizonSeconds) {
    this.#ensurePredictiveLeaderMetricFacts(source, instrument, horizonSeconds);
    return this.sqlite.prepare(`
      SELECT
        metric_facts.ready_count,
        metric_facts.settled_count,
        metric_facts.top1_hits,
        metric_facts.top3_hits,
        metric_facts.combined_brier_loss
      FROM forecast_predictive_leader_metric_facts AS metric_facts
      JOIN round_forecasts AS forecasts
        ON forecasts.id = metric_facts.forecast_id
      JOIN forecast_snapshots AS snapshots
        ON snapshots.id = forecasts.snapshot_id
      WHERE metric_facts.metric_version = ?
        AND snapshots.source = ?
        AND snapshots.instrument = ?
        AND snapshots.horizon_seconds = ?
        AND (
          metric_facts.settled_count = 1
          OR (
            NOT EXISTS (
              SELECT 1
              FROM forecast_predictive_leader_evaluation_voids AS evaluation_voids
              WHERE evaluation_voids.forecast_id = metric_facts.forecast_id
                AND NOT EXISTS (
                  SELECT 1
                  FROM incident_resolutions
                  WHERE incident_resolutions.incident_id = evaluation_voids.incident_id
                )
            )
            AND NOT EXISTS (
              SELECT 1
              FROM predictive_leader_account_bets AS bets
              WHERE bets.forecast_id = metric_facts.forecast_id
                AND bets.status = 'void'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM predictive_leader_gated_fixed_bets AS signal_bets
              WHERE signal_bets.forecast_id = metric_facts.forecast_id
                AND signal_bets.status = 'void'
            )
          )
        )
      ORDER BY metric_facts.forecast_id
    `).all(
      PREDICTIVE_LEADER_METRIC_FACT_VERSION,
      source,
      instrument,
      horizonSeconds,
    );
  }

  #predictiveLeaderSignalAccountState(source, instrument) {
    const rows = this.sqlite.prepare(`
      SELECT *
      FROM predictive_leader_gated_fixed_bets
      WHERE source = ? AND instrument = ?
      ORDER BY forecast_id
    `).all(source, instrument);
    let currentBalance = PREDICTIVE_LEADER_SIGNAL_ACCOUNT_STARTING_BALANCE;
    let peakBalance = currentBalance;
    let minimumBalance = currentBalance;
    let maximumDrawdown = 0;
    let totalStaked = 0;
    let totalGrossPayout = 0;
    let pending = null;
    let latestOutcome = null;
    let latestVoid = null;
    let hitCount = 0;
    let missCount = 0;
    let voidCount = 0;
    let startedAt = null;
    let updatedAt = null;

    for (const row of rows) {
      if (
        Number(row.schema_version)
          !== PREDICTIVE_LEADER_SIGNAL_ACCOUNT_SCHEMA_VERSION
        || row.strategy_version
          !== PREDICTIVE_LEADER_SIGNAL_ACCOUNT_STRATEGY_VERSION
        || row.leader_algorithm_version !== LEARNED_LEADER_ALGORITHM_VERSION
        || row.gate_version !== PREDICTIVE_LEADER_QUALITY_GATE.version
        || Number(row.stake) !== PREDICTIVE_LEADER_SIGNAL_STAKE
        || Number(row.balance_before) !== currentBalance
      ) {
        return null;
      }
      startedAt ??= row.placed_at;
      updatedAt = row.updated_at;
      if (row.status === "void") {
        if (row.void_reason !== "integrity_gap") return null;
        voidCount += 1;
        latestVoid = {
          forecastId: Number(row.forecast_id),
          targetNumber: Number(row.target_number),
          stake: Number(row.stake),
          reason: row.void_reason,
          voidedAt: row.settled_at,
        };
        continue;
      }
      totalStaked += Number(row.stake);
      if (row.status === "pending") {
        if (pending !== null) return null;
        currentBalance -= Number(row.stake);
        pending = {
          forecastId: Number(row.forecast_id),
          targetNumber: Number(row.target_number),
          stake: Number(row.stake),
          balanceBefore: Number(row.balance_before),
          gateVersion: row.gate_version,
          placedAt: row.placed_at,
        };
      } else if (row.status === "settled") {
        const expectedOutcome = Number(row.target_number) === Number(row.result_number)
          ? "hit"
          : "miss";
        const expectedGross = expectedOutcome === "hit"
          ? Number(row.stake) * PREDICTIVE_LEADER_SIGNAL_GROSS_PAYOUT_MULTIPLIER
          : 0;
        const expectedBalance = currentBalance - Number(row.stake) + expectedGross;
        if (
          row.outcome !== expectedOutcome
          || Number(row.gross_payout) !== expectedGross
          || Number(row.balance_after) !== expectedBalance
        ) {
          return null;
        }
        currentBalance = expectedBalance;
        totalGrossPayout += expectedGross;
        if (expectedOutcome === "hit") hitCount += 1;
        else missCount += 1;
        latestOutcome = {
          forecastId: Number(row.forecast_id),
          resultId: Number(row.round_result_id),
          targetNumber: Number(row.target_number),
          resultNumber: Number(row.result_number),
          stake: Number(row.stake),
          outcome: row.outcome,
          grossPayout: expectedGross,
          balanceAfter: currentBalance,
          occurredAt: row.settled_at,
        };
      } else {
        return null;
      }
      peakBalance = Math.max(peakBalance, currentBalance);
      minimumBalance = Math.min(minimumBalance, currentBalance);
      maximumDrawdown = Math.max(maximumDrawdown, peakBalance - currentBalance);
    }
    const settledCount = hitCount + missCount;
    const exhausted = pending === null
      && currentBalance < PREDICTIVE_LEADER_SIGNAL_STAKE;
    return {
      schemaVersion: PREDICTIVE_LEADER_SIGNAL_ACCOUNT_SCHEMA_VERSION,
      strategyVersion: PREDICTIVE_LEADER_SIGNAL_ACCOUNT_STRATEGY_VERSION,
      leaderAlgorithmVersion: LEARNED_LEADER_ALGORITHM_VERSION,
      gateVersion: PREDICTIVE_LEADER_QUALITY_GATE.version,
      mode: "quality-gated-fixed-stake-simulation",
      executionEnabled: false,
      advisoryOnly: true,
      status: exhausted ? "exhausted" : pending ? "pending" : "waiting",
      reason: exhausted
        ? "bankroll_exhausted"
        : pending
          ? "bet_frozen"
          : rows.length === 0
            ? "waiting_first_eligible_signal"
            : "waiting_quality_gate",
      initialBalance: PREDICTIVE_LEADER_SIGNAL_ACCOUNT_STARTING_BALANCE,
      currentBalance,
      availableBalance: currentBalance,
      reservedStake: pending?.stake ?? 0,
      profit: currentBalance - PREDICTIVE_LEADER_SIGNAL_ACCOUNT_STARTING_BALANCE,
      model: {
        fixedStake: PREDICTIVE_LEADER_SIGNAL_STAKE,
        grossPayoutMultiplier: PREDICTIVE_LEADER_SIGNAL_GROSS_PAYOUT_MULTIPLIER,
        payoutIncludesStake: true,
      },
      nextStake: PREDICTIVE_LEADER_SIGNAL_STAKE,
      canAffordNext: currentBalance >= PREDICTIVE_LEADER_SIGNAL_STAKE,
      shortfall: Math.max(0, PREDICTIVE_LEADER_SIGNAL_STAKE - currentBalance),
      betCount: rows.length,
      settledCount,
      pendingCount: Number(pending !== null),
      voidCount,
      hitCount,
      missCount,
      hitRate: settledCount === 0 ? null : hitCount / settledCount,
      totalStaked,
      totalGrossPayout,
      peakBalance,
      minimumBalance,
      maximumDrawdown,
      continuityGapCount: voidCount,
      pendingBet: pending,
      latestVoid,
      latestOutcome,
      startedAt,
      updatedAt,
      exhaustedAt: exhausted ? updatedAt : null,
    };
  }

  getPredictiveLeaderSignalAccount(source = "buleto", instrument = "default") {
    this.#assertOpen();
    return this.#predictiveLeaderSignalAccountState(
      asNonEmptyText(source, undefined, "source"),
      asNonEmptyText(instrument, undefined, "instrument"),
    );
  }

  #predictiveLeaderAccountState(source, instrument) {
    const base = {
      schemaVersion: PREDICTIVE_LEADER_ACCOUNT_SCHEMA_VERSION,
      strategyVersion: PREDICTIVE_LEADER_ACCOUNT_STRATEGY_VERSION,
      leaderAlgorithmVersion: LEARNED_LEADER_ALGORITHM_VERSION,
      mode: "prospective-simulation",
      executionEnabled: false,
      advisoryOnly: true,
      status: "waiting",
      reason: "waiting_first_frozen_leader",
      initialBalance: PREDICTIVE_LEADER_ACCOUNT_STARTING_BALANCE,
      currentBalance: PREDICTIVE_LEADER_ACCOUNT_STARTING_BALANCE,
      profit: 0,
      model: {
        ...PREDICTIVE_LEADER_ACCOUNT_MODEL,
        netHitMultiplier: PREDICTIVE_LEADER_ACCOUNT_MODEL.grossPayoutMultiplier
          - Number(PREDICTIVE_LEADER_ACCOUNT_MODEL.payoutIncludesStake),
      },
      nextStake: nextPredictiveLeaderStake(0),
      canAffordNext: true,
      shortfall: 0,
      betCount: 0,
      settledCount: 0,
      pendingCount: 0,
      voidCount: 0,
      hitCount: 0,
      missCount: 0,
      hitRate: null,
      totalStaked: 0,
      totalGrossPayout: 0,
      peakBalance: PREDICTIVE_LEADER_ACCOUNT_STARTING_BALANCE,
      minimumBalance: PREDICTIVE_LEADER_ACCOUNT_STARTING_BALANCE,
      maximumDrawdown: 0,
      continuityGapCount: 0,
      ladder: { missCount: 0, totalLoss: 0 },
      pendingBet: null,
      latestVoid: null,
      latestOutcome: null,
      startedAt: null,
      updatedAt: null,
      exhaustedAt: null,
    };
    const account = this.sqlite
      .prepare(`
        SELECT *
        FROM predictive_leader_accounts
        WHERE source = ? AND instrument = ?
      `)
      .get(source, instrument);
    if (!account) return base;
    if (
      Number(account.schema_version) !== PREDICTIVE_LEADER_ACCOUNT_SCHEMA_VERSION
      || account.strategy_version !== PREDICTIVE_LEADER_ACCOUNT_STRATEGY_VERSION
      || account.leader_algorithm_version !== LEARNED_LEADER_ALGORITHM_VERSION
      || Number(account.initial_balance) !== PREDICTIVE_LEADER_ACCOUNT_STARTING_BALANCE
      || Number(account.initial_stake) !== PREDICTIVE_LEADER_ACCOUNT_MODEL.initialStake
      || Number(account.stake_step) !== PREDICTIVE_LEADER_ACCOUNT_MODEL.stakeStep
      || Number(account.max_stake) !== PREDICTIVE_LEADER_ACCOUNT_MODEL.maxStake
      || Number(account.gross_payout_multiplier)
        !== PREDICTIVE_LEADER_ACCOUNT_MODEL.grossPayoutMultiplier
      || Boolean(account.payout_includes_stake)
        !== PREDICTIVE_LEADER_ACCOUNT_MODEL.payoutIncludesStake
      || !["running", "exhausted"].includes(account.status)
    ) {
      return null;
    }
    const rows = this.sqlite
      .prepare(`
        SELECT
          bets.*,
          incidents.kind AS void_incident_kind,
          incidents.source AS void_incident_source,
          incidents.instrument AS void_incident_instrument
        FROM predictive_leader_account_bets AS bets
        LEFT JOIN incidents ON incidents.id = bets.void_incident_id
        WHERE bets.source = ? AND bets.instrument = ?
        ORDER BY bets.forecast_id
      `)
      .all(source, instrument);
    const resetRows = this.sqlite
      .prepare(`
        SELECT *
        FROM predictive_leader_account_ladder_resets
        WHERE source = ? AND instrument = ?
        ORDER BY id
      `)
      .all(source, instrument);
    const appliedResetByForecastId = new Map();
    let pendingResetCount = 0;
    for (const reset of resetRows) {
      const requestedAtMs = Date.parse(reset.requested_at);
      if (
        reset.reset_key !== PREDICTIVE_LEADER_ACCOUNT_RESET_KEY
        || reset.reason !== PREDICTIVE_LEADER_ACCOUNT_RESET_REASON
        || !Number.isFinite(requestedAtMs)
      ) {
        return null;
      }
      if (reset.status === "pending") {
        pendingResetCount += 1;
        if (
          pendingResetCount > 1
          || reset.applied_after_forecast_id !== null
          || reset.balance_before !== null
          || reset.balance_after !== null
          || reset.ladder_total_loss_before !== null
          || reset.ladder_miss_count_before !== null
          || reset.next_stake_before !== null
          || reset.ladder_total_loss_after !== null
          || reset.ladder_miss_count_after !== null
          || reset.next_stake_after !== null
          || reset.applied_at !== null
        ) {
          return null;
        }
        continue;
      }
      const afterForecastId = Number(reset.applied_after_forecast_id);
      const appliedAtMs = Date.parse(reset.applied_at);
      if (
        reset.status !== "applied"
        || !Number.isSafeInteger(afterForecastId)
        || afterForecastId < 1
        || !Number.isFinite(appliedAtMs)
        || appliedAtMs < requestedAtMs
        || appliedResetByForecastId.has(afterForecastId)
      ) {
        return null;
      }
      appliedResetByForecastId.set(afterForecastId, reset);
    }
    let balance = PREDICTIVE_LEADER_ACCOUNT_STARTING_BALANCE;
    let peakBalance = balance;
    let minimumBalance = balance;
    let maximumDrawdown = 0;
    let totalStaked = 0;
    let totalGrossPayout = 0;
    let hitCount = 0;
    let missCount = 0;
    let ladderMissCount = 0;
    let ladderTotalLoss = 0;
    let lastContinuityEpoch = null;
    let continuityGapCount = 0;
    let voidCount = 0;
    let pendingBet = null;
    let latestVoid = null;
    let latestOutcome = null;
    let priorForecastId = null;
    let priorUpdatedAt = null;
    let appliedResetCount = 0;
    const applyResetBoundary = (forecastId, lowerAt, upperAt = null) => {
      const reset = appliedResetByForecastId.get(forecastId);
      if (!reset) return true;
      const appliedAtMs = Date.parse(reset.applied_at);
      const lowerAtMs = Date.parse(lowerAt);
      const upperAtMs = upperAt === null ? null : Date.parse(upperAt);
      if (
        !Number.isFinite(lowerAtMs)
        || (upperAt !== null && !Number.isFinite(upperAtMs))
        || appliedAtMs < lowerAtMs
        || (upperAtMs !== null && appliedAtMs > upperAtMs)
        || Number(reset.balance_before) !== balance
        || Number(reset.balance_after) !== balance
        || Number(reset.ladder_total_loss_before) !== ladderTotalLoss
        || Number(reset.ladder_miss_count_before) !== ladderMissCount
        || Number(reset.next_stake_before) !== nextPredictiveLeaderStake(ladderTotalLoss)
        || Number(reset.ladder_total_loss_after) !== 0
        || Number(reset.ladder_miss_count_after) !== 0
        || Number(reset.next_stake_after) !== nextPredictiveLeaderStake(0)
      ) {
        return false;
      }
      ladderMissCount = 0;
      ladderTotalLoss = 0;
      appliedResetCount += 1;
      return true;
    };
    for (const row of rows) {
      if (
        priorForecastId !== null
        && !applyResetBoundary(priorForecastId, priorUpdatedAt, row.placed_at)
      ) {
        return null;
      }
      const stake = Number(row.stake);
      const continuityEpoch = row.continuity_epoch === null
        ? null
        : Number(row.continuity_epoch);
      if (
        continuityEpoch !== null
        && (!Number.isSafeInteger(continuityEpoch) || continuityEpoch < 0)
      ) {
        return null;
      }
      if (
        lastContinuityEpoch !== null
        && continuityEpoch !== null
        && continuityEpoch !== lastContinuityEpoch
      ) {
        ladderMissCount = 0;
        ladderTotalLoss = 0;
        continuityGapCount += 1;
      }
      if (
        Number(row.schema_version) !== PREDICTIVE_LEADER_ACCOUNT_SCHEMA_VERSION
        || row.strategy_version !== PREDICTIVE_LEADER_ACCOUNT_STRATEGY_VERSION
        || row.leader_algorithm_version !== LEARNED_LEADER_ALGORITHM_VERSION
        || !Number.isSafeInteger(stake)
        || stake < PREDICTIVE_LEADER_ACCOUNT_MODEL.initialStake
        || stake > PREDICTIVE_LEADER_ACCOUNT_MODEL.maxStake
        || stake % PREDICTIVE_LEADER_ACCOUNT_MODEL.stakeStep !== 0
        || Number(row.balance_before) !== balance
        || Number(row.ladder_loss_before) !== ladderTotalLoss
        || Number(row.ladder_miss_count_before) !== ladderMissCount
        || stake !== nextPredictiveLeaderStake(ladderTotalLoss)
      ) {
        return null;
      }
      lastContinuityEpoch = continuityEpoch;
      priorForecastId = Number(row.forecast_id);
      priorUpdatedAt = row.updated_at;
      if (row.status === "pending") {
        if (
          pendingBet
          || row.round_result_id !== null
          || row.void_incident_id !== null
          || row.void_continuity_epoch !== null
          || row.voided_at !== null
        ) {
          return null;
        }
        pendingBet = {
          forecastId: Number(row.forecast_id),
          targetNumber: Number(row.target_number),
          stake,
          balanceBefore: balance,
          placedAt: row.placed_at,
        };
        continue;
      }
      if (row.status === "void") {
        const voidContinuityEpoch = Number(row.void_continuity_epoch);
        const voidedAtMs = Date.parse(row.voided_at);
        if (
          pendingBet
          || row.void_reason !== "integrity_gap"
          || !Number.isSafeInteger(Number(row.void_incident_id))
          || Number(row.void_incident_id) < 1
          || !Number.isSafeInteger(voidContinuityEpoch)
          || voidContinuityEpoch < 1
          || (continuityEpoch !== null && voidContinuityEpoch <= continuityEpoch)
          || row.void_incident_kind !== "gap"
          || row.void_incident_source !== source
          || row.void_incident_instrument !== instrument
          || !Number.isFinite(voidedAtMs)
          || voidedAtMs < Date.parse(row.placed_at)
          || row.round_result_id !== null
          || row.result_number !== null
          || row.outcome !== null
          || row.gross_payout !== null
          || row.balance_after !== null
        ) {
          return null;
        }
        voidCount += 1;
        ladderMissCount = 0;
        ladderTotalLoss = 0;
        continuityGapCount += 1;
        lastContinuityEpoch = voidContinuityEpoch;
        latestVoid = {
          forecastId: Number(row.forecast_id),
          targetNumber: Number(row.target_number),
          stake,
          reason: row.void_reason,
          voidedAt: row.voided_at,
        };
        continue;
      }
      if (row.status !== "settled" || pendingBet) return null;
      const expectedHit = Number(row.target_number) === Number(row.result_number);
      let expectedSettlement;
      try {
        expectedSettlement = settlePredictiveLeaderBet({
          targetNumber: Number(row.target_number),
          resultNumber: Number(row.result_number),
          stake,
          balanceBefore: balance,
          ladderLossBefore: ladderTotalLoss,
          model: PREDICTIVE_LEADER_ACCOUNT_MODEL,
        });
      } catch {
        return null;
      }
      const grossPayout = Number(row.gross_payout);
      const balanceAfter = Number(row.balance_after);
      const expectedLadderMissCount = expectedHit ? 0 : ladderMissCount + 1;
      if (
        !["hit", "miss"].includes(row.outcome)
        || (row.outcome === "hit") !== expectedHit
        || grossPayout !== expectedSettlement.grossPayout
        || balanceAfter !== expectedSettlement.balanceAfter
        || Number(row.ladder_loss_after) !== expectedSettlement.ladderLossAfter
        || Number(row.ladder_miss_count_after) !== expectedLadderMissCount
        || Number(row.next_stake_after) !== expectedSettlement.nextStakeAfter
        || Boolean(row.recovery_possible) !== expectedSettlement.recoveryPossible
      ) {
        return null;
      }
      totalStaked += stake;
      totalGrossPayout += grossPayout;
      balance = balanceAfter;
      ladderTotalLoss = expectedSettlement.ladderLossAfter;
      ladderMissCount = expectedLadderMissCount;
      hitCount += Number(expectedHit);
      missCount += Number(!expectedHit);
      peakBalance = Math.max(peakBalance, balance);
      minimumBalance = Math.min(minimumBalance, balance);
      maximumDrawdown = Math.max(maximumDrawdown, peakBalance - balance);
      latestOutcome = {
        forecastId: Number(row.forecast_id),
        resultId: Number(row.round_result_id),
        targetNumber: Number(row.target_number),
        resultNumber: Number(row.result_number),
        stake,
        outcome: row.outcome,
        grossPayout,
        balanceAfter,
        occurredAt: row.occurred_at,
      };
    }
    if (
      priorForecastId !== null
      && !applyResetBoundary(priorForecastId, priorUpdatedAt)
    ) {
      return null;
    }
    if (appliedResetCount !== appliedResetByForecastId.size) return null;
    const pendingId = account.pending_forecast_id === null
      ? null
      : Number(account.pending_forecast_id);
    const settledCount = hitCount + missCount;
    const nextStake = Number(account.next_stake);
    const currentBalance = Number(account.current_balance);
    const accountContinuityEpoch = account.last_continuity_epoch === null
      ? null
      : Number(account.last_continuity_epoch);
    if (
      currentBalance !== balance
      || currentBalance
        !== PREDICTIVE_LEADER_ACCOUNT_STARTING_BALANCE
          - totalStaked + totalGrossPayout
      || pendingId !== (pendingBet?.forecastId ?? null)
      || rows.length !== settledCount + voidCount + Number(pendingBet !== null)
      || !Number.isSafeInteger(nextStake)
      || Number(account.ladder_total_loss) !== ladderTotalLoss
      || Number(account.ladder_miss_count) !== ladderMissCount
      || nextStake !== nextPredictiveLeaderStake(ladderTotalLoss)
      || accountContinuityEpoch !== lastContinuityEpoch
      || Number(account.continuity_gap_count) !== continuityGapCount
      || (account.status === "exhausted") !== (nextStake > currentBalance)
    ) {
      return null;
    }
    return {
      ...base,
      status: account.status === "exhausted"
        ? "exhausted"
        : pendingBet
          ? "pending"
          : "waiting",
      reason: account.status === "exhausted"
        ? "bankroll_exhausted"
        : pendingBet
          ? "bet_frozen"
          : "waiting_next_frozen_leader",
      currentBalance,
      profit: currentBalance - PREDICTIVE_LEADER_ACCOUNT_STARTING_BALANCE,
      nextStake,
      canAffordNext: nextStake <= currentBalance,
      shortfall: Math.max(0, nextStake - currentBalance),
      betCount: rows.length,
      settledCount,
      pendingCount: Number(pendingBet !== null),
      voidCount,
      hitCount,
      missCount,
      hitRate: settledCount > 0 ? hitCount / settledCount : null,
      totalStaked,
      totalGrossPayout,
      peakBalance,
      minimumBalance,
      maximumDrawdown,
      continuityGapCount: Number(account.continuity_gap_count),
      ladder: {
        missCount: Number(account.ladder_miss_count),
        totalLoss: Number(account.ladder_total_loss),
      },
      pendingBet,
      latestVoid,
      latestOutcome,
      startedAt: account.started_at,
      updatedAt: account.updated_at,
      exhaustedAt: account.exhausted_at,
    };
  }

  warmPrecloseForecastValidation(source = "buleto", instrument = "default") {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const row = this.sqlite
      .prepare(`
        SELECT
          COUNT(*) AS checked_count,
          COALESCE(SUM(
            trajectory_adaptive_snapshot_valid_v2(
              trajectory_shadows.status,
              trajectory_shadows.cutoff_at,
              snapshots.locked_at,
              trajectory_shadows.lock_price,
              snapshots.current_price,
              trajectory_shadows.median_cell_width,
              trajectory_shadows.direction,
              trajectory_shadows.probabilities_json,
              trajectory_shadows.expected_delta_cell_widths,
              trajectory_shadows.sample_json,
              trajectory_shadows.nearest_ids_json,
              trajectory_shadows.parameters_json,
              trajectory_shadows.current_prefix_json,
              trajectory_shadows.integration_json,
              snapshots.cells_json
            )
          ), 0) AS valid_count
        FROM forecast_trajectory_shadows AS trajectory_shadows
        JOIN round_forecasts AS forecasts
          ON forecasts.id = trajectory_shadows.forecast_id
        JOIN forecast_snapshots AS snapshots
          ON snapshots.id = forecasts.snapshot_id
        WHERE snapshots.source = ?
          AND snapshots.instrument = ?
          AND trajectory_shadows.model_version = ?
          AND trajectory_shadows.status = 'ready'
      `)
      .get(
        safeSource,
        safeInstrument,
        TRAJECTORY_SHADOW_ADAPTIVE_VERSION,
      );
    return {
      checkedCount: Number(row.checked_count),
      validCount: Number(row.valid_count),
      cacheSize: this.trajectoryAdaptiveValidationCache.size,
      hits: this.trajectoryAdaptiveValidationCacheHits,
      misses: this.trajectoryAdaptiveValidationCacheMisses,
    };
  }

  async warmPrecloseForecastValidationIncrementally(
    source = "buleto",
    instrument = "default",
    {
      batchSize = 32,
      yieldControl = () => new Promise((resolve) => setImmediate(resolve)),
      onProgress = null,
      signal = null,
    } = {},
  ) {
    this.#assertOpen();
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
      throw new RangeError("batchSize must be an integer between 1 and 1000");
    }
    if (typeof yieldControl !== "function") {
      throw new TypeError("yieldControl must be a function");
    }
    if (onProgress !== null && typeof onProgress !== "function") {
      throw new TypeError("onProgress must be a function or null");
    }

    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const warmupKey = `${safeSource}\u0000${safeInstrument}`;
    if (this.trajectoryAdaptiveValidationWarmupPromise !== null) {
      if (this.trajectoryAdaptiveValidationWarmupKey === warmupKey) {
        return this.trajectoryAdaptiveValidationWarmupPromise;
      }
      try {
        await this.trajectoryAdaptiveValidationWarmupPromise;
      } catch {
        // A different stream still gets its own attempt after the active one.
      }
      this.#assertOpen();
      return this.warmPrecloseForecastValidationIncrementally(
        safeSource,
        safeInstrument,
        { batchSize, yieldControl, onProgress, signal },
      );
    }
    const operation = this.#runPrecloseForecastValidationWarmup({
      safeSource,
      safeInstrument,
      batchSize,
      yieldControl,
      onProgress,
      signal,
    });
    this.trajectoryAdaptiveValidationWarmupPromise = operation;
    this.trajectoryAdaptiveValidationWarmupKey = warmupKey;
    try {
      return await operation;
    } finally {
      if (this.trajectoryAdaptiveValidationWarmupPromise === operation) {
        this.trajectoryAdaptiveValidationWarmupPromise = null;
        this.trajectoryAdaptiveValidationWarmupKey = null;
      }
    }
  }

  async #runPrecloseForecastValidationWarmup({
    safeSource,
    safeInstrument,
    batchSize,
    yieldControl,
    onProgress,
    signal,
  }) {
    const statement = this.sqlite.prepare(`
      SELECT
        trajectory_shadows.forecast_id,
        trajectory_shadows.status,
        trajectory_shadows.cutoff_at,
        snapshots.locked_at AS snapshot_locked_at,
        trajectory_shadows.lock_price,
        snapshots.current_price AS snapshot_current_price,
        trajectory_shadows.median_cell_width,
        trajectory_shadows.direction,
        trajectory_shadows.probabilities_json,
        trajectory_shadows.expected_delta_cell_widths,
        trajectory_shadows.sample_json,
        trajectory_shadows.nearest_ids_json,
        trajectory_shadows.parameters_json,
        trajectory_shadows.current_prefix_json,
        trajectory_shadows.integration_json,
        snapshots.cells_json,
        settlements.round_result_id,
        settlements.actual_number,
        settlement_results.raw_cell
      FROM forecast_trajectory_shadows AS trajectory_shadows
      JOIN round_forecasts AS forecasts
        ON forecasts.id = trajectory_shadows.forecast_id
      JOIN forecast_snapshots AS snapshots
        ON snapshots.id = forecasts.snapshot_id
      LEFT JOIN forecast_settlements AS settlements
        ON settlements.forecast_id = forecasts.id
      LEFT JOIN round_results AS settlement_results
        ON settlement_results.id = settlements.round_result_id
      WHERE snapshots.source = ?
        AND snapshots.instrument = ?
        AND trajectory_shadows.model_version = ?
        AND trajectory_shadows.status = 'ready'
        AND trajectory_shadows.forecast_id < ?
      ORDER BY trajectory_shadows.forecast_id DESC
      LIMIT ?
    `);
    let checkedCount = 0;
    let validCount = 0;
    let batchCount = 0;
    let beforeForecastId = Number.MAX_SAFE_INTEGER;
    while (signal?.aborted !== true) {
      const rows = statement.all(
        safeSource,
        safeInstrument,
        TRAJECTORY_SHADOW_ADAPTIVE_VERSION,
        beforeForecastId,
        batchSize,
      );
      if (rows.length === 0) break;

      const validatedRows = [];
      for (const row of rows) {
        const isValid = this.#validAdaptiveTrajectorySnapshotSql(
          ...trajectoryAdaptiveValidatorValuesFromRow(row),
        );
        validCount += Number(isValid);
        validatedRows.push({ row, isValid });
      }
      this.#writeTrajectoryMetricFacts(validatedRows);

      checkedCount += rows.length;
      batchCount += 1;
      beforeForecastId = Number(rows.at(-1).forecast_id);
      const progress = {
        checkedCount,
        validCount,
        batchCount,
        cacheSize: this.trajectoryAdaptiveValidationCache.size,
        hits: this.trajectoryAdaptiveValidationCacheHits,
        misses: this.trajectoryAdaptiveValidationCacheMisses,
        aborted: false,
      };
      try {
        onProgress?.(progress);
      } catch {
        // Progress reporting must never change validation semantics.
      }
      if (rows.length < batchSize || signal?.aborted === true) break;
      await yieldControl();
      this.#assertOpen();
    }

    if (signal?.aborted !== true) {
      await this.#warmPredictiveLeaderMetricFactsIncrementally({
        safeSource,
        safeInstrument,
        batchSize,
        yieldControl,
        signal,
      });
    }

    return {
      checkedCount,
      validCount,
      batchCount,
      cacheSize: this.trajectoryAdaptiveValidationCache.size,
      hits: this.trajectoryAdaptiveValidationCacheHits,
      misses: this.trajectoryAdaptiveValidationCacheMisses,
      aborted: signal?.aborted === true,
    };
  }

  async #warmPredictiveLeaderMetricFactsIncrementally({
    safeSource,
    safeInstrument,
    batchSize,
    yieldControl,
    signal,
  }) {
    const statement = this.sqlite.prepare(`
      SELECT
        forecasts.id AS forecast_id,
        snapshots.locked_at,
        leaders.forecast_id AS leader_forecast_id,
        leaders.schema_version AS leader_schema_version,
        leaders.algorithm_version AS leader_algorithm_version,
        leaders.status AS leader_status,
        leaders.locked_at AS leader_locked_at,
        leaders.history_max_result_id AS leader_history_max_result_id,
        leaders.training_through_forecast_id
          AS leader_training_through_forecast_id,
        leaders.training_through_result_id
          AS leader_training_through_result_id,
        leader_training_settlements.round_result_id
          AS leader_expected_training_result_id,
        leaders.training_count AS leader_training_count,
        leaders.predicted_number AS leader_predicted_number,
        leaders.score AS leader_score,
        leaders.snapshot_json AS leader_snapshot_json,
        leaders.created_at AS leader_created_at,
        settlements.round_result_id,
        settlements.actual_number,
        settlements.settled_at,
        settlements.created_at AS settlement_created_at
      FROM forecast_predictive_leader_metric_dirty AS metric_dirty
      JOIN forecast_predictive_leader_snapshots AS leaders
        ON leaders.forecast_id = metric_dirty.forecast_id
      JOIN round_forecasts AS forecasts ON forecasts.id = leaders.forecast_id
      JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
      LEFT JOIN forecast_settlements AS settlements
        ON settlements.forecast_id = forecasts.id
      LEFT JOIN forecast_settlements AS leader_training_settlements
        ON leader_training_settlements.forecast_id =
          leaders.training_through_forecast_id
      WHERE snapshots.source = ?
        AND snapshots.instrument = ?
        AND leaders.schema_version = ?
        AND leaders.algorithm_version = ?
      ORDER BY leaders.forecast_id
      LIMIT ?
    `);
    while (signal?.aborted !== true) {
      const rows = statement.all(
        safeSource,
        safeInstrument,
        LEARNED_LEADER_SCHEMA_VERSION,
        LEARNED_LEADER_ALGORITHM_VERSION,
        batchSize,
      );
      if (rows.length === 0) return;
      this.#writePredictiveLeaderMetricFacts(rows);
      if (rows.length < batchSize || signal?.aborted === true) return;
      await yieldControl();
      this.#assertOpen();
    }
  }

  getPredictiveLeaderV7AuditState(source = "buleto", instrument = "default") {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const cohort = mapPredictiveLeaderV7Cohort(this.sqlite.prepare(`
      SELECT *
      FROM predictive_leader_v7_cohorts
      WHERE candidate_key = ?
    `).get(PREDICTIVE_LEADER_V7_CANDIDATE_CONFIG.candidateId));
    if (!cohort) throw new Error("predictive leader v7 cohort is invalid");
    const boundary = this.sqlite.prepare(`
      SELECT *
      FROM predictive_shadow_integrity_boundaries
      WHERE boundary_key = 'predictive-shadow-metadata-integrity-v1'
        AND v7_candidate_key = ?
    `).get(cohort.candidateId);
    if (
      !boundary
      || boundary.policy_version !== "metadata-conflict-void-v1"
      || !Number.isSafeInteger(Number(boundary.first_forecast_id))
      || Number(boundary.first_forecast_id) < 1
      || boundary.started_at !== boundary.created_at
    ) {
      throw new Error("predictive shadow v29 boundary is invalid");
    }
    if (safeSource !== cohort.source || safeInstrument !== cohort.instrument) {
      throw new RangeError("predictive leader v7 audit is pinned to its frozen stream");
    }

    const rows = this.sqlite.prepare(`
      SELECT
        forecasts.id AS forecast_id,
        snapshots.source,
        snapshots.instrument,
        snapshots.external_round_id,
        snapshots.horizon_seconds,
        snapshots.betting_closes_at,
        snapshots.round_ends_at,
        snapshots.locked_at,
        settlements.round_result_id,
        settlements.actual_number,
        settlements.settled_at,
        settlements.created_at AS settlement_created_at,
        results.id AS result_id,
        results.source AS result_source,
        results.instrument AS result_instrument,
        results.external_round_id AS result_external_round_id,
        results.result_number,
        results.settled_at AS result_settled_at,
        results.observed_at AS result_observed_at,
        results.created_at AS result_created_at,
        v7.forecast_id AS v7_forecast_id,
        v7.candidate_key AS v7_candidate_key,
        v7.schema_version AS v7_schema_version,
        v7.algorithm_version AS v7_algorithm_version,
        v7.config_version AS v7_config_version,
        v7.target_horizon AS v7_target_horizon,
        v7.config_sha256 AS v7_config_sha256,
        v7.status AS v7_status,
        v7.locked_at AS v7_locked_at,
        v7.history_max_result_id AS v7_history_max_result_id,
        v7.predicted_number AS v7_predicted_number,
        v7.leader_mass AS v7_leader_mass,
        v7.margin AS v7_margin,
        v7.selected AS v7_selected,
        v7.snapshot_json AS v7_snapshot_json,
        v7.created_at AS v7_created_at,
        conflicts.reason AS conflict_reason,
        conflicts.original_betting_closes_at AS conflict_original_betting_closes_at,
        conflicts.observed_betting_closes_at AS conflict_observed_betting_closes_at,
        conflicts.observed_at AS conflict_observed_at,
        conflicts.created_at AS conflict_created_at,
        leaders.forecast_id AS leader_forecast_id,
        leaders.schema_version AS leader_schema_version,
        leaders.algorithm_version AS leader_algorithm_version,
        leaders.status AS leader_status,
        leaders.locked_at AS leader_locked_at,
        leaders.history_max_result_id AS leader_history_max_result_id,
        leaders.training_through_forecast_id
          AS leader_training_through_forecast_id,
        leaders.training_through_result_id
          AS leader_training_through_result_id,
        leader_training_settlements.round_result_id
          AS leader_expected_training_result_id,
        leaders.training_count AS leader_training_count,
        leaders.predicted_number AS leader_predicted_number,
        leaders.score AS leader_score,
        leaders.snapshot_json AS leader_snapshot_json,
        leaders.created_at AS leader_created_at
      FROM round_forecasts AS forecasts
      JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
      LEFT JOIN forecast_settlements AS settlements
        ON settlements.forecast_id = forecasts.id
      LEFT JOIN round_results AS results
        ON results.id = settlements.round_result_id
      LEFT JOIN forecast_predictive_leader_v7_snapshots AS v7
        ON v7.forecast_id = forecasts.id AND v7.candidate_key = ?
      LEFT JOIN predictive_shadow_round_metadata_conflicts AS conflicts
        ON conflicts.boundary_key = 'predictive-shadow-metadata-integrity-v1'
       AND conflicts.source = snapshots.source
       AND conflicts.instrument = snapshots.instrument
       AND conflicts.external_round_id = snapshots.external_round_id
      LEFT JOIN forecast_predictive_leader_snapshots AS leaders
        ON leaders.forecast_id = forecasts.id
      LEFT JOIN forecast_settlements AS leader_training_settlements
        ON leader_training_settlements.forecast_id =
          leaders.training_through_forecast_id
      WHERE snapshots.source = ?
        AND snapshots.instrument = ?
        AND snapshots.horizon_seconds = ?
        AND forecasts.id >= ?
        AND snapshots.locked_at >= ?
      ORDER BY forecasts.id
    `).all(
      cohort.candidateId,
      safeSource,
      safeInstrument,
      cohort.forecastHorizonSeconds,
      Number(boundary.first_forecast_id),
      boundary.started_at,
    );
    const mapped = rows.map((row) => ({
      row,
      voided: row.conflict_reason != null,
      v7: row.conflict_reason == null
        ? mapForecastPredictiveLeaderV7(row, cohort)
        : null,
      champion: mapForecastPredictiveLeader(row),
    }));
    const validV7 = mapped.map(({ v7 }) => v7).filter(Boolean);
    const readyV7 = validV7.filter((leader) => leader.status === "ready");
    const selectedV7 = readyV7.filter((leader) => leader.selection.eligible);
    const allPairings = mapped.map(({ v7, champion }) => ({ v7, champion }));
    const fixedSelected = mapped.filter(({ row }) => (
      row.v7_forecast_id != null && Boolean(row.v7_selected)
    )).slice(0, PREDICTIVE_LEADER_V7_GATE_WINDOW_SIZE);
    const fixedEvaluated = fixedSelected.filter(({ v7 }) => (
      v7?.status === "ready"
      && v7.selection.eligible
      && v7.evaluation !== null
    ));
    const fixedWindowEndForecastId = fixedSelected.at(-1)?.row.forecast_id ?? null;
    const coverageRows = mapped.filter(({ row }) => (
      fixedSelected.length < PREDICTIVE_LEADER_V7_GATE_WINDOW_SIZE
        || Number(row.forecast_id) <= fixedWindowEndForecastId
    ));
    const fixedValidSelectedCount = fixedSelected.filter(({ v7 }) => (
      v7?.status === "ready" && v7.selection.eligible
    )).length;
    const selectionCoverage = coverageRows.length === 0
      ? null
      : fixedValidSelectedCount / coverageRows.length;
    const fixedLeaders = fixedEvaluated.map(({ v7 }) => v7);
    const fixedSummary = summarizePredictiveLeaderV7(fixedLeaders);
    const hitRateInterval = wilsonInterval95(
      fixedSummary.top1Hits,
      fixedSummary.settledCount,
    );
    const uniformBrierDeltas = fixedLeaders.map((leader) => (
      leader.evaluation.combinedBrierLoss - LEARNED_LEADER_V7_UNIFORM_BRIER_LOSS
    ));
    const uniformBrierHac95 = hacMeanInterval95(uniformBrierDeltas);
    const fixedPairings = fixedEvaluated.map(({ v7, champion }) => ({ v7, champion }));
    const fixedPairedChampion = summarizePredictiveLeaderV7Pairings(fixedPairings);
    const fixedComplete =
      fixedSelected.length === PREDICTIVE_LEADER_V7_GATE_WINDOW_SIZE
      && fixedEvaluated.length === PREDICTIVE_LEADER_V7_GATE_WINDOW_SIZE;
    const fixedWindowComplete =
      fixedSelected.length === PREDICTIVE_LEADER_V7_GATE_WINDOW_SIZE;
    const fixedMetadataIntegrity = fixedWindowComplete
      && fixedSelected.every(({ voided, v7 }) => !voided && v7 !== null);
    const criterion = (value) => fixedComplete ? value : null;
    const gateCriteria = {
      fixedSampleComplete: fixedComplete,
      metadataIntegrity: fixedWindowComplete ? fixedMetadataIntegrity : null,
      selectionCoverage: criterion(
        selectionCoverage !== null
          && selectionCoverage >= PREDICTIVE_LEADER_V7_MINIMUM_SELECTION_COVERAGE,
      ),
      exactHitRate: criterion(
        hitRateInterval !== null
          && hitRateInterval.lower > PREDICTIVE_LEADER_V7_BREAK_EVEN_RATE,
      ),
      brierVsUniform: criterion(
        uniformBrierHac95 !== null
          && uniformBrierHac95.mean
            <= -PREDICTIVE_LEADER_V7_MINIMUM_BRIER_IMPROVEMENT
          && uniformBrierHac95.upper < 0,
      ),
      pairedBrierVsChampion: criterion(
        fixedPairedChampion.pairedCount === PREDICTIVE_LEADER_V7_GATE_WINDOW_SIZE
          && fixedPairedChampion.meanBrierDelta
            <= -PREDICTIVE_LEADER_V7_MINIMUM_BRIER_IMPROVEMENT
          && fixedPairedChampion.brierDeltaHac95?.upper < 0,
      ),
      pairedExactVsChampion: criterion(
        fixedPairedChampion.pairedCount === PREDICTIVE_LEADER_V7_GATE_WINDOW_SIZE
          && fixedPairedChampion.v7Only > fixedPairedChampion.championOnly
          && fixedPairedChampion.v7BetterOneSidedExactPValue < 0.025,
      ),
    };
    const statisticalSignalsPass = fixedComplete
      && Object.entries(gateCriteria)
        .filter(([key]) => key !== "fixedSampleComplete")
        .every(([, value]) => value === true);
    const regimeBlocks = fixedComplete
      ? Array.from({ length: 4 }, (_, index) => {
          const block = fixedLeaders.slice(index * 250, (index + 1) * 250);
          return {
            index: index + 1,
            startForecastId: block[0].forecastId,
            endForecastId: block.at(-1).forecastId,
            ...summarizePredictiveLeaderV7(block),
          };
        })
      : [];
    const latestMapped = mapped.at(-1) ?? null;
    const latestCandidate = latestMapped === null
      ? null
      : latestMapped.voided
        ? {
            availability: "void",
            status: "void",
            reason: latestMapped.row.conflict_reason,
            originalBettingClosesAt:
              latestMapped.row.conflict_original_betting_closes_at,
            observedBettingClosesAt:
              latestMapped.row.conflict_observed_betting_closes_at,
            observedAt: latestMapped.row.conflict_observed_at,
            createdAt: latestMapped.row.conflict_created_at,
          }
      : latestMapped.v7
        ? {
            availability: latestMapped.v7.status,
            status: latestMapped.v7.status,
            reason: latestMapped.v7.reason,
            leaderNumber: latestMapped.v7.leaderNumber,
            leaderMass: latestMapped.v7.leaderMass,
            runnerUpMass: latestMapped.v7.runnerUpMass,
            margin: latestMapped.v7.margin,
            selected: latestMapped.v7.selection.eligible,
            selection: latestMapped.v7.selection,
            evidence: latestMapped.v7.evidence,
            sourceAudit: latestMapped.v7.sourceAudit,
            evaluation: latestMapped.v7.evaluation,
            createdAt: latestMapped.v7.createdAt,
          }
        : {
            availability: latestMapped.row.v7_forecast_id == null
              ? "missing"
              : "invalid",
          };
    const latestChampion = latestMapped?.champion
      ? {
          availability: latestMapped.champion.status,
          status: latestMapped.champion.status,
          leaderNumber: latestMapped.champion.leaderNumber,
          leaderMass: latestMapped.champion.leaderMass,
          evaluation: latestMapped.champion.evaluation,
        }
      : latestMapped === null
        ? null
        : { availability: "missing_or_invalid" };

    return {
      schemaVersion: LEARNED_LEADER_V7_SCHEMA_VERSION,
      candidateId: cohort.candidateId,
      algorithmVersion: cohort.algorithmVersion,
      configVersion: cohort.configVersion,
      mode: cohort.mode,
      executionEnabled: false,
      advisoryOnly: true,
      source: safeSource,
      instrument: safeInstrument,
      cohort,
      integrityBoundary: {
        boundaryKey: boundary.boundary_key,
        policyVersion: boundary.policy_version,
        firstForecastId: Number(boundary.first_forecast_id),
        firstTrajectoryId: Number(boundary.first_trajectory_id),
        startedAt: boundary.started_at,
        createdAt: boundary.created_at,
      },
      latest: latestMapped === null
        ? null
        : {
            forecastId: Number(latestMapped.row.forecast_id),
            roundId: latestMapped.row.external_round_id,
            lockedAt: latestMapped.row.locked_at,
            bettingClosesAt: latestMapped.row.betting_closes_at,
            roundEndsAt: latestMapped.row.round_ends_at,
            candidate: latestCandidate,
            champion: latestChampion,
            settlement: latestMapped.row.actual_number == null
              ? null
              : {
                  resultId: Number(latestMapped.row.round_result_id),
                  actualNumber: Number(latestMapped.row.actual_number),
                  settledAt: latestMapped.row.settled_at,
                  createdAt: latestMapped.row.settlement_created_at,
                },
          },
      metrics: {
        cohortEligibleForecastCount: rows.length,
        cohortSettledForecastCount: mapped.filter(({ row, voided }) => (
          row.actual_number != null && !voided
        )).length,
        storedCount: mapped.filter(({ row }) => row.v7_forecast_id != null).length,
        missingCount: mapped.filter(({ row, voided }) => (
          row.v7_forecast_id == null && !voided
        )).length,
        voidCount: mapped.filter(({ voided }) => voided).length,
        invalidCount: mapped.filter(({ row, v7, voided }) => (
          row.v7_forecast_id != null && v7 === null && !voided
        )).length,
        readyCount: readyV7.length,
        unavailableCount: validV7.filter((leader) => leader.status === "unavailable").length,
        selectedCount: selectedV7.length,
        overall: summarizePredictiveLeaderV7(validV7),
        selected: summarizePredictiveLeaderV7(selectedV7),
        pairedChampion: summarizePredictiveLeaderV7Pairings(allPairings),
      },
      qualityGateDiagnostic: {
        version: PREDICTIVE_LEADER_V7_GATE_VERSION,
        status: fixedWindowComplete && !fixedMetadataIntegrity
          ? "signals_failed"
          : !fixedComplete
          ? "collecting"
          : statisticalSignalsPass
            ? "signals_pass"
            : "signals_failed",
        windowPolicy: "first-1000-selected-settled-prospective-no-roll",
        targetSampleSize: PREDICTIVE_LEADER_V7_GATE_WINDOW_SIZE,
        selectedCohortSize: fixedSelected.length,
        validSelectedCohortSize: fixedValidSelectedCount,
        sampleSize: fixedEvaluated.length,
        fixedWindowComplete,
        settlementComplete: fixedComplete,
        windowStartForecastId: fixedSelected[0]?.row.forecast_id == null
          ? null
          : Number(fixedSelected[0].row.forecast_id),
        windowEndForecastId: fixedWindowEndForecastId,
        selectionCoverage,
        minimumSelectionCoverage: PREDICTIVE_LEADER_V7_MINIMUM_SELECTION_COVERAGE,
        economicBreakEvenTop1Rate: PREDICTIVE_LEADER_V7_BREAK_EVEN_RATE,
        minimumBrierImprovementVsUniform:
          PREDICTIVE_LEADER_V7_MINIMUM_BRIER_IMPROVEMENT,
        top1Wilson95: hitRateInterval,
        fixed: fixedSummary,
        brierDeltaVsUniformHac95: uniformBrierHac95,
        pairedChampion: fixedPairedChampion,
        regimeBlocks,
        experimentFamilySize: 2,
        familywiseAlpha: 0.05,
        perCandidateAlpha: 0.025,
        multiplicityPolicy: "bonferroni-two-prospective-candidates",
        criteria: gateCriteria,
        statisticalSignalsPass,
        promotionEligible: false,
        promotionPolicy: "manual-review-only-no-automatic-bet-or-promotion",
      },
    };
  }

  getCurrentCellHorizonShadowAuditState(
    source = "buleto",
    instrument = "default",
  ) {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const cohort = mapCurrentCellHorizonCohort(this.sqlite.prepare(`
      SELECT *
      FROM current_cell_horizon_shadow_cohorts
      WHERE cohort_key = ?
    `).get(CURRENT_CELL_HORIZON_SHADOW_COHORT_KEY));
    if (!cohort) throw new Error("current-cell shadow cohort is invalid");
    const boundary = this.sqlite.prepare(`
      SELECT *
      FROM predictive_shadow_integrity_boundaries
      WHERE boundary_key = 'predictive-shadow-metadata-integrity-v1'
        AND current_cell_cohort_key = ?
    `).get(cohort.cohortKey);
    if (
      !boundary
      || boundary.policy_version !== "metadata-conflict-void-v1"
      || !Number.isSafeInteger(Number(boundary.first_trajectory_id))
      || Number(boundary.first_trajectory_id) < 1
      || boundary.started_at !== boundary.created_at
    ) {
      throw new Error("current-cell shadow v29 boundary is invalid");
    }
    if (safeSource !== cohort.source || safeInstrument !== cohort.instrument) {
      throw new RangeError("current-cell shadow audit is pinned to its frozen stream");
    }

    const rows = this.sqlite.prepare(`
      SELECT
        trajectories.id AS trajectory_id,
        trajectories.source,
        trajectories.instrument,
        trajectories.external_round_id,
        trajectories.betting_closes_at,
        trajectories.round_ends_at,
        trajectories.created_at AS trajectory_created_at,
        shadows.trajectory_id AS shadow_trajectory_id,
        shadows.cohort_key AS shadow_cohort_key,
        shadows.schema_version AS shadow_schema_version,
        shadows.algorithm_version AS shadow_algorithm_version,
        shadows.config_version AS shadow_config_version,
        shadows.config_sha256 AS shadow_config_sha256,
        shadows.status AS shadow_status,
        shadows.reason AS shadow_reason,
        shadows.cutoff_at AS shadow_cutoff_at,
        shadows.captured_at AS shadow_captured_at,
        shadows.predicted_number AS shadow_predicted_number,
        shadows.leader_wire_cell AS shadow_leader_wire_cell,
        shadows.leader_probability AS shadow_leader_probability,
        shadows.runner_up_probability AS shadow_runner_up_probability,
        shadows.margin AS shadow_margin,
        shadows.snapshot_json AS shadow_snapshot_json,
        shadows.created_at AS shadow_created_at,
        voids.reason AS void_reason,
        voids.original_betting_closes_at AS void_original_betting_closes_at,
        voids.observed_betting_closes_at AS void_observed_betting_closes_at,
        voids.observed_at AS void_observed_at,
        voids.created_at AS void_created_at,
        evaluations.trajectory_id AS evaluation_trajectory_id,
        evaluations.cohort_key AS evaluation_cohort_key,
        evaluations.round_result_id AS evaluation_round_result_id,
        evaluations.actual_number AS evaluation_actual_number,
        evaluations.top1_hit AS evaluation_top1_hit,
        evaluations.brier_loss AS evaluation_brier_loss,
        evaluations.clipped_log_loss AS evaluation_clipped_log_loss,
        evaluations.evaluation_json,
        evaluations.evaluated_at AS evaluation_evaluated_at,
        results.id AS result_id,
        results.source AS result_source,
        results.instrument AS result_instrument,
        results.external_round_id AS result_external_round_id,
        results.result_number,
        results.settled_at AS result_settled_at,
        results.observed_at AS result_observed_at,
        results.created_at AS result_created_at,
        evaluations.round_result_id AS round_result_id,
        evaluations.actual_number AS actual_number,
        results.settled_at AS settled_at,
        results.created_at AS settlement_created_at,
        v5_forecasts.id AS forecast_id,
        v5_snapshots.locked_at,
        v5_settlements.forecast_id AS v5_settlement_forecast_id,
        v5_settlements.round_result_id AS v5_round_result_id,
        v5_settlements.actual_number AS v5_actual_number,
        v5_settlements.settled_at AS v5_settled_at,
        v5_settlements.created_at AS v5_settlement_created_at,
        v5_results.id AS v5_result_id,
        v5_results.source AS v5_result_source,
        v5_results.instrument AS v5_result_instrument,
        v5_results.external_round_id AS v5_result_external_round_id,
        v5_results.result_number AS v5_result_number,
        v5_results.settled_at AS v5_result_settled_at,
        v5_results.observed_at AS v5_result_observed_at,
        v5_results.created_at AS v5_result_created_at,
        leaders.forecast_id AS leader_forecast_id,
        leaders.schema_version AS leader_schema_version,
        leaders.algorithm_version AS leader_algorithm_version,
        leaders.status AS leader_status,
        leaders.locked_at AS leader_locked_at,
        leaders.history_max_result_id AS leader_history_max_result_id,
        leaders.training_through_forecast_id
          AS leader_training_through_forecast_id,
        leaders.training_through_result_id AS leader_training_through_result_id,
        leader_training_settlements.round_result_id
          AS leader_expected_training_result_id,
        leaders.training_count AS leader_training_count,
        leaders.predicted_number AS leader_predicted_number,
        leaders.score AS leader_score,
        leaders.snapshot_json AS leader_snapshot_json,
        leaders.created_at AS leader_created_at
      FROM round_trajectories AS trajectories
      LEFT JOIN round_trajectory_current_cell_horizon_snapshots AS shadows
        ON shadows.trajectory_id = trajectories.id
       AND shadows.cohort_key = ?
      LEFT JOIN round_trajectory_current_cell_horizon_evaluations AS evaluations
        ON evaluations.trajectory_id = shadows.trajectory_id
       AND evaluations.cohort_key = shadows.cohort_key
      LEFT JOIN predictive_shadow_round_metadata_conflicts AS voids
        ON voids.boundary_key = 'predictive-shadow-metadata-integrity-v1'
       AND voids.source = trajectories.source
       AND voids.instrument = trajectories.instrument
       AND voids.external_round_id = trajectories.external_round_id
      LEFT JOIN round_results AS results
        ON results.id = evaluations.round_result_id
      LEFT JOIN forecast_snapshots AS v5_snapshots
        ON v5_snapshots.source = trajectories.source
       AND v5_snapshots.instrument = trajectories.instrument
       AND v5_snapshots.external_round_id = trajectories.external_round_id
       AND v5_snapshots.horizon_seconds = 8
      LEFT JOIN round_forecasts AS v5_forecasts
        ON v5_forecasts.snapshot_id = v5_snapshots.id
      LEFT JOIN forecast_settlements AS v5_settlements
        ON v5_settlements.forecast_id = v5_forecasts.id
      LEFT JOIN round_results AS v5_results
        ON v5_results.id = v5_settlements.round_result_id
      LEFT JOIN forecast_predictive_leader_snapshots AS leaders
        ON leaders.forecast_id = v5_forecasts.id
      LEFT JOIN forecast_settlements AS leader_training_settlements
        ON leader_training_settlements.forecast_id
          = leaders.training_through_forecast_id
      WHERE trajectories.source = ?
        AND trajectories.instrument = ?
        AND trajectories.id >= ?
        AND trajectories.created_at >= ?
      ORDER BY trajectories.betting_closes_at, trajectories.id
    `).all(
      cohort.cohortKey,
      safeSource,
      safeInstrument,
      Number(boundary.first_trajectory_id),
      boundary.started_at,
    );
    const mapped = rows.map((row) => ({
      row,
      voided: row.void_reason != null,
      current: row.void_reason == null
        ? mapCurrentCellHorizonSnapshot(row, cohort)
        : null,
      champion: mapCurrentCellPairedV5(row),
    }));
    const valid = mapped.map(({ current }) => current).filter(Boolean);
    const ready = valid.filter((snapshot) => snapshot.status === "ready");
    const rawReady = mapped.filter(({ row }) => row.shadow_status === "ready");
    const fixedRows = rawReady.slice(0, CURRENT_CELL_HORIZON_SHADOW_GATE_WINDOW_SIZE);
    const fixedSnapshots = fixedRows.map(({ current }) => current).filter(Boolean);
    const fixedEvaluated = fixedSnapshots.filter(
      (snapshot) => snapshot.status === "ready" && snapshot.evaluation !== null,
    );
    const fixedWindowComplete =
      fixedRows.length === CURRENT_CELL_HORIZON_SHADOW_GATE_WINDOW_SIZE;
    const fixedSettlementComplete = fixedWindowComplete
      && fixedEvaluated.length === CURRENT_CELL_HORIZON_SHADOW_GATE_WINDOW_SIZE;
    const fixedEnd = fixedRows.at(-1)?.row ?? rows.at(-1) ?? null;
    const coverageRows = fixedEnd === null
      ? []
      : mapped.filter(({ row }) => (
          row.betting_closes_at < fixedEnd.betting_closes_at
          || (
            row.betting_closes_at === fixedEnd.betting_closes_at
            && Number(row.trajectory_id) <= Number(fixedEnd.trajectory_id)
          )
        ));
    const readyCoverage = coverageRows.length === 0
      ? null
        : coverageRows.filter(({ row, current }) => (
            row.shadow_status === "ready" && current?.status === "ready"
          )).length
          / coverageRows.length;
    const fixedSummary = summarizeCurrentCellHorizonSnapshots(fixedSnapshots);
    const hitRateInterval = wilsonInterval95(
      fixedSummary.top1Hits,
      fixedSummary.settledCount,
    );
    const uniformBrierDeltas = fixedEvaluated.map(
      (snapshot) => snapshot.evaluation.brierLoss
        - CURRENT_CELL_HORIZON_SHADOW_UNIFORM_BRIER_LOSS,
    );
    const uniformLogLossDeltas = fixedEvaluated.map(
      (snapshot) => snapshot.evaluation.clippedLogLoss
        - CURRENT_CELL_HORIZON_SHADOW_UNIFORM_LOG_LOSS,
    );
    const fixedPairings = fixedRows.map(({ current, champion }) => ({
      current,
      champion,
    }));
    const pairedV5 = summarizeCurrentCellV5Pairings(fixedPairings);
    const pairedV5Coverage = fixedEvaluated.length === 0
      ? null
      : pairedV5.pairedCount / fixedEvaluated.length;
    const minimumPairedV5Count = Math.ceil(
      CURRENT_CELL_HORIZON_SHADOW_GATE_WINDOW_SIZE
        * CURRENT_CELL_HORIZON_SHADOW_MINIMUM_PAIRED_V5_COVERAGE,
    );
    const fixedMetadataIntegrity = fixedWindowComplete
      && fixedRows.every(({ voided, current }) => !voided && current !== null);
    const criterion = (value) => fixedSettlementComplete ? value : null;
    const gateCriteria = {
      fixedSampleComplete: fixedSettlementComplete,
      metadataIntegrity: fixedWindowComplete ? fixedMetadataIntegrity : null,
      readyCoverage: criterion(
        readyCoverage !== null
          && readyCoverage >= CURRENT_CELL_HORIZON_SHADOW_MINIMUM_READY_COVERAGE,
      ),
      exactHitRate: criterion(
        hitRateInterval !== null
          && hitRateInterval.lower > CURRENT_CELL_HORIZON_SHADOW_BREAK_EVEN_RATE,
      ),
      brierVsUniform: criterion(
        hacMeanInterval95(uniformBrierDeltas)?.upper < 0,
      ),
      pairedV5Coverage: criterion(
        pairedV5Coverage !== null
          && pairedV5Coverage
            >= CURRENT_CELL_HORIZON_SHADOW_MINIMUM_PAIRED_V5_COVERAGE
          && pairedV5.pairedCount >= minimumPairedV5Count,
      ),
      pairedBrierVsV5: criterion(
        pairedV5.pairedCount >= minimumPairedV5Count
          && pairedV5.brierDeltaHac95?.upper < 0,
      ),
      pairedExactVsV5: criterion(
        pairedV5.pairedCount >= minimumPairedV5Count
          && pairedV5.currentOnly > pairedV5.v5Only
          && pairedV5.currentBetterOneSidedExactPValue < 0.025,
      ),
    };
    const statisticalSignalsPass = fixedSettlementComplete
      && Object.entries(gateCriteria)
        .filter(([key]) => key !== "fixedSampleComplete")
        .every(([, value]) => value === true);
    const regimeBlocks = fixedSettlementComplete
      ? Array.from({ length: 4 }, (_, index) => {
          const block = fixedSnapshots.slice(index * 250, (index + 1) * 250);
          return {
            index: index + 1,
            startTrajectoryId: block[0].trajectoryId,
            endTrajectoryId: block.at(-1).trajectoryId,
            ...summarizeCurrentCellHorizonSnapshots(block),
          };
        })
      : [];
    const latestMapped = mapped.at(-1) ?? null;
    const latestCurrent = latestMapped === null
      ? null
      : latestMapped.voided
        ? {
            availability: "void",
            status: "void",
            reason: latestMapped.row.void_reason,
            originalBettingClosesAt:
              latestMapped.row.void_original_betting_closes_at,
            observedBettingClosesAt:
              latestMapped.row.void_observed_betting_closes_at,
            observedAt: latestMapped.row.void_observed_at,
            createdAt: latestMapped.row.void_created_at,
          }
      : latestMapped.current
        ? {
            availability: latestMapped.current.status,
            status: latestMapped.current.status,
            reason: latestMapped.current.reason,
            leaderNumber: latestMapped.current.leaderNumber,
            leaderWireCell: latestMapped.current.leaderWireCell,
            leaderProbability: latestMapped.current.leaderProbability,
            runnerUpProbability: latestMapped.current.runnerUpProbability,
            margin: latestMapped.current.margin,
            selectedTick: latestMapped.current.selectedTick,
            audit: latestMapped.current.audit,
            evaluation: latestMapped.current.evaluation,
            capturedAt: latestMapped.current.capturedAt,
            createdAt: latestMapped.current.createdAt,
          }
        : {
            availability: latestMapped.row.shadow_trajectory_id == null
              ? "missing"
              : "invalid",
          };
    const latestChampion = latestMapped?.champion
      ? {
          availability: latestMapped.champion.status,
          status: latestMapped.champion.status,
          leaderNumber: latestMapped.champion.leaderNumber,
          leaderMass: latestMapped.champion.leaderMass,
          evaluation: latestMapped.champion.evaluation,
        }
      : latestMapped === null
        ? null
        : { availability: "missing_or_invalid" };

    return {
      schemaVersion: cohort.schemaVersion,
      cohortKey: cohort.cohortKey,
      algorithmVersion: cohort.algorithmVersion,
      configVersion: cohort.configVersion,
      mode: cohort.mode,
      executionEnabled: false,
      advisoryOnly: true,
      source: safeSource,
      instrument: safeInstrument,
      cohort,
      integrityBoundary: {
        boundaryKey: boundary.boundary_key,
        policyVersion: boundary.policy_version,
        firstForecastId: Number(boundary.first_forecast_id),
        firstTrajectoryId: Number(boundary.first_trajectory_id),
        startedAt: boundary.started_at,
        createdAt: boundary.created_at,
      },
      latest: latestMapped === null
        ? null
        : {
            trajectoryId: Number(latestMapped.row.trajectory_id),
            roundId: latestMapped.row.external_round_id,
            bettingClosesAt: latestMapped.row.betting_closes_at,
            roundEndsAt: latestMapped.row.round_ends_at,
            candidate: latestCurrent,
            championV5: latestChampion,
          },
      metrics: {
        cohortEligibleTrajectoryCount: rows.length,
        storedCount: mapped.filter(({ row }) => row.shadow_trajectory_id != null).length,
        missingCount: mapped.filter(({ row, voided }) => (
          row.shadow_trajectory_id == null && !voided
        )).length,
        voidCount: mapped.filter(({ voided }) => voided).length,
        invalidCount: mapped.filter(({ row, current, voided }) => (
          row.shadow_trajectory_id != null && current === null && !voided
        )).length,
        readyCount: ready.length,
        unavailableCount: valid.filter(
          (snapshot) => snapshot.status === "unavailable",
        ).length,
        overall: summarizeCurrentCellHorizonSnapshots(valid),
        pairedV5: summarizeCurrentCellV5Pairings(
          mapped.map(({ current, champion }) => ({ current, champion })),
        ),
      },
      qualityGateDiagnostic: {
        version: CURRENT_CELL_HORIZON_SHADOW_GATE_VERSION,
        status: fixedWindowComplete && !fixedMetadataIntegrity
          ? "signals_failed"
          : !fixedSettlementComplete
          ? "collecting"
          : statisticalSignalsPass
            ? "signals_pass"
            : "signals_failed",
        windowPolicy: "first-1000-ready-prospective-no-roll",
        targetSampleSize: CURRENT_CELL_HORIZON_SHADOW_GATE_WINDOW_SIZE,
        readyCohortSize: fixedRows.length,
        sampleSize: fixedEvaluated.length,
        fixedWindowComplete,
        settlementComplete: fixedSettlementComplete,
        windowStartTrajectoryId: fixedRows[0]?.row.trajectory_id == null
          ? null
          : Number(fixedRows[0].row.trajectory_id),
        windowEndTrajectoryId: fixedRows.at(-1)?.row.trajectory_id == null
          ? null
          : Number(fixedRows.at(-1).row.trajectory_id),
        readyCoverage,
        minimumReadyCoverage: CURRENT_CELL_HORIZON_SHADOW_MINIMUM_READY_COVERAGE,
        economicBreakEvenTop1Rate:
          CURRENT_CELL_HORIZON_SHADOW_BREAK_EVEN_RATE,
        top1Wilson95: hitRateInterval,
        brierDeltaVsUniformHac95: hacMeanInterval95(uniformBrierDeltas),
        clippedLogLossDeltaVsUniformHac95:
          hacMeanInterval95(uniformLogLossDeltas),
        pairedV5,
        pairedV5Coverage,
        minimumPairedV5Coverage:
          CURRENT_CELL_HORIZON_SHADOW_MINIMUM_PAIRED_V5_COVERAGE,
        minimumPairedV5Count,
        fixed: fixedSummary,
        regimeBlocks,
        experimentFamilySize: 2,
        familywiseAlpha: 0.05,
        perCandidateAlpha: 0.025,
        multiplicityPolicy: "bonferroni-two-prospective-candidates",
        criteria: gateCriteria,
        statisticalSignalsPass,
        promotionEligible: false,
        promotionPolicy: "manual-review-only-no-automatic-bet-or-promotion",
      },
      paperSimulation: currentCellFlatPaperSimulation(valid),
    };
  }

  getPredictiveLeaderReadState(source = "buleto", instrument = "default") {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const latestRow = this.sqlite
      .prepare(`
        SELECT
          forecasts.id AS forecast_id,
          snapshots.source,
          snapshots.instrument,
          snapshots.external_round_id,
          snapshots.horizon_seconds,
          snapshots.betting_closes_at,
          snapshots.round_ends_at,
          snapshots.locked_at,
          settlements.round_result_id,
          settlements.actual_number,
          settlements.settled_at,
          settlements.created_at AS settlement_created_at,
          leaders.forecast_id AS leader_forecast_id,
          leaders.schema_version AS leader_schema_version,
          leaders.algorithm_version AS leader_algorithm_version,
          leaders.status AS leader_status,
          leaders.locked_at AS leader_locked_at,
          leaders.history_max_result_id AS leader_history_max_result_id,
          leaders.training_through_forecast_id
            AS leader_training_through_forecast_id,
          leaders.training_through_result_id
            AS leader_training_through_result_id,
          leader_training_settlements.round_result_id
            AS leader_expected_training_result_id,
          leaders.training_count AS leader_training_count,
          leaders.predicted_number AS leader_predicted_number,
          leaders.score AS leader_score,
          leaders.snapshot_json AS leader_snapshot_json,
          leaders.created_at AS leader_created_at,
          leader_gates.forecast_id AS leader_gate_forecast_id,
          leader_gates.policy_version AS leader_gate_version,
          leader_gates.cutoff_at AS leader_gate_cutoff_at,
          leader_gates.status AS leader_gate_status,
          leader_gates.eligible AS leader_gate_eligible,
          leader_gates.snapshot_json AS leader_gate_snapshot_json
        FROM round_forecasts AS forecasts
        JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
        LEFT JOIN forecast_settlements AS settlements
          ON settlements.forecast_id = forecasts.id
        LEFT JOIN forecast_predictive_leader_snapshots AS leaders
          ON leaders.forecast_id = forecasts.id
        LEFT JOIN forecast_predictive_leader_quality_snapshots AS leader_gates
          ON leader_gates.forecast_id = leaders.forecast_id
        LEFT JOIN forecast_settlements AS leader_training_settlements
          ON leader_training_settlements.forecast_id =
            leaders.training_through_forecast_id
        WHERE snapshots.source = ? AND snapshots.instrument = ?
        ORDER BY snapshots.locked_at DESC, forecasts.id DESC
        LIMIT 1
      `)
      .get(safeSource, safeInstrument);
    const latest = mapPredictiveLeaderForecast(latestRow);
    const activeCycleRow = this.sqlite
      .prepare(`
        SELECT status
        FROM cycles
        WHERE source = ? AND instrument = ? AND status = 'active'
        ORDER BY last_event_at DESC, id DESC
        LIMIT 1
      `)
      .get(safeSource, safeInstrument);
    const warningRows = this.sqlite
      .prepare(`
        SELECT incidents.kind
        FROM incidents
        WHERE incidents.source = ?
          AND incidents.instrument = ?
          AND NOT EXISTS (
            SELECT 1
            FROM incident_resolutions
            WHERE incident_resolutions.incident_id = incidents.id
          )
        ORDER BY incidents.detected_at DESC, incidents.id DESC
        LIMIT 10
      `)
      .all(safeSource, safeInstrument);
    const predictiveLeaderRows = latest
      ? this.#predictiveLeaderMetricRows(
          safeSource,
          safeInstrument,
          latest.horizonSeconds,
        )
      : [];

    return {
      activeCycle: activeCycleRow
        ? { status: activeCycleRow.status, integrityStatus: "ok" }
        : null,
      warnings: warningRows.map((row) => ({ type: row.kind })),
      latestResult: this.getLatestResult(safeSource, safeInstrument),
      precloseForecast: {
        latest,
        predictiveLeaderMetrics: mapPredictiveLeaderMetricFacts(predictiveLeaderRows),
        predictiveLeaderAccount: this.#predictiveLeaderAccountState(
          safeSource,
          safeInstrument,
        ),
        predictiveLeaderSignalAccount: this.#predictiveLeaderSignalAccountState(
          safeSource,
          safeInstrument,
        ),
      },
    };
  }

  getRecentTrajectoryRangeOutcomes(
    source = "buleto",
    instrument = "default",
    limit = 100,
  ) {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const safeLimit = normalizedLimit(limit, 100);
    this.#ensureTrajectoryMetricFacts(safeSource, safeInstrument);

    const rows = this.sqlite.prepare(`
      WITH recent_results AS (
        SELECT
          id,
          external_round_id,
          settled_at,
          result_number,
          raw_cell,
          continuity_epoch
        FROM round_results
        WHERE source = ? AND instrument = ?
        ORDER BY settled_at DESC, id DESC
        LIMIT ?
      )
      SELECT
        results.id AS result_id,
        results.external_round_id,
        results.settled_at,
        results.result_number,
        results.raw_cell,
        results.continuity_epoch,
        settlements.forecast_id,
        snapshots.id AS snapshot_id,
        snapshots.locked_at,
        trajectory_shadows.status AS trajectory_status,
        trajectory_shadows.integration_json,
        metric_facts.evaluated_count,
        metric_facts.display_range_hits
      FROM recent_results AS results
      LEFT JOIN forecast_settlements AS settlements
        ON settlements.round_result_id = results.id
      LEFT JOIN round_forecasts AS forecasts
        ON forecasts.id = settlements.forecast_id
      LEFT JOIN forecast_snapshots AS snapshots
        ON snapshots.id = forecasts.snapshot_id
       AND snapshots.source = ?
       AND snapshots.instrument = ?
      LEFT JOIN forecast_trajectory_shadows AS trajectory_shadows
        ON trajectory_shadows.forecast_id = forecasts.id
       AND snapshots.id IS NOT NULL
       AND trajectory_shadows.model_version = ?
      LEFT JOIN forecast_trajectory_metric_facts AS metric_facts
        ON metric_facts.forecast_id = trajectory_shadows.forecast_id
       AND metric_facts.validator_version = ?
      ORDER BY results.settled_at ASC, results.id ASC
    `).all(
      safeSource,
      safeInstrument,
      safeLimit,
      safeSource,
      safeInstrument,
      TRAJECTORY_SHADOW_ADAPTIVE_VERSION,
      TRAJECTORY_METRIC_FACT_VERSION,
    );

    return rows.map((row) => {
      const base = {
        resultId: Number(row.result_id),
        externalRoundId: row.external_round_id,
        settledAt: row.settled_at,
        resultNumber: Number(row.result_number),
        rawCell: row.raw_cell === null ? null : Number(row.raw_cell),
        continuityEpoch: Number(row.continuity_epoch),
        forecastId: row.forecast_id === null ? null : Number(row.forecast_id),
        lockedAt: row.locked_at,
        targetNumbers: null,
        forecastDisplayHit: null,
      };
      if (row.forecast_id === null || row.trajectory_status !== "ready") {
        return { ...base, availability: "unavailable" };
      }
      if (
        row.snapshot_id === null
        || Number(row.evaluated_count) !== 1
        || typeof row.integration_json !== "string"
      ) {
        return { ...base, availability: "invalid" };
      }
      const lockedMs = Date.parse(row.locked_at);
      const settledMs = Date.parse(row.settled_at);
      if (!Number.isFinite(lockedMs) || !Number.isFinite(settledMs) || lockedMs >= settledMs) {
        return { ...base, availability: "invalid" };
      }

      const cells = deserializeJson(row.integration_json)?.displayRange?.cells;
      const targetNumbers = Array.isArray(cells)
        ? [...new Set(cells.map((cell) => Number(cell?.number)))]
        : [];
      if (
        targetNumbers.length < 1
        || targetNumbers.length > TRAJECTORY_DISPLAY_RANGE_MAX_CELLS
        || targetNumbers.some(
          (number) => !Number.isInteger(number) || number < 0 || number > 36,
        )
      ) {
        return { ...base, availability: "invalid" };
      }
      return {
        ...base,
        availability: "ready",
        targetNumbers,
        forecastDisplayHit: Number(row.display_range_hits) === 1,
      };
    });
  }

  getPredictiveLeaderOutcomes(
    source = "buleto",
    instrument = "default",
    options = {},
  ) {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("options must be an object");
    }
    const safeSince = asTimestamp(options.since, undefined, "since");
    const safeUntil = options.until === null || options.until === undefined
      ? null
      : asTimestamp(options.until, undefined, "until");
    if (safeUntil !== null && Date.parse(safeUntil) <= Date.parse(safeSince)) {
      throw new RangeError("until must be after since");
    }

    const rows = this.sqlite.prepare(`
      SELECT
        results.id AS round_result_id,
        results.external_round_id AS result_external_round_id,
        results.settled_at AS result_settled_at,
        results.result_number,
        results.continuity_epoch,
        settlements.forecast_id AS settlement_forecast_id,
        settlements.round_result_id AS settlement_round_result_id,
        settlements.actual_number,
        settlements.settled_at AS settlement_settled_at,
        settlements.created_at AS settlement_created_at,
        forecasts.id AS forecast_id,
        snapshots.id AS snapshot_id,
        snapshots.source,
        snapshots.instrument,
        snapshots.external_round_id,
        snapshots.horizon_seconds,
        snapshots.betting_closes_at,
        snapshots.round_ends_at,
        snapshots.locked_at,
        snapshots.persisted_at AS snapshot_persisted_at,
        forecasts.created_at AS forecast_created_at,
        leaders.forecast_id AS leader_forecast_id,
        leaders.schema_version AS leader_schema_version,
        leaders.algorithm_version AS leader_algorithm_version,
        leaders.status AS leader_status,
        leaders.locked_at AS leader_locked_at,
        leaders.history_max_result_id AS leader_history_max_result_id,
        leaders.training_through_forecast_id
          AS leader_training_through_forecast_id,
        leaders.training_through_result_id
          AS leader_training_through_result_id,
        leader_training_settlements.round_result_id
          AS leader_expected_training_result_id,
        leaders.training_count AS leader_training_count,
        leaders.predicted_number AS leader_predicted_number,
        leaders.score AS leader_score,
        leaders.snapshot_json AS leader_snapshot_json,
        leaders.created_at AS leader_created_at
      FROM round_results AS results
      LEFT JOIN forecast_settlements AS settlements
        ON settlements.round_result_id = results.id
      LEFT JOIN round_forecasts AS forecasts
        ON forecasts.id = settlements.forecast_id
      LEFT JOIN forecast_snapshots AS snapshots
        ON snapshots.id = forecasts.snapshot_id
       AND snapshots.source = results.source
       AND snapshots.instrument = results.instrument
      LEFT JOIN forecast_predictive_leader_snapshots AS leaders
        ON leaders.forecast_id = forecasts.id
      LEFT JOIN forecast_settlements AS leader_training_settlements
        ON leader_training_settlements.forecast_id =
          leaders.training_through_forecast_id
      WHERE results.source = ?
        AND results.instrument = ?
        AND results.settled_at >= ?
        AND (? IS NULL OR results.settled_at < ?)
      ORDER BY results.settled_at ASC, results.id ASC
    `).all(
      safeSource,
      safeInstrument,
      safeSince,
      safeUntil,
      safeUntil,
    );

    return rows.map(mapPredictiveLeaderOutcome);
  }

  getPrecloseForecastState(source = "buleto", instrument = "default") {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const latestRow = this.sqlite
      .prepare(`
        SELECT
          forecasts.id AS forecast_id,
          forecasts.snapshot_id,
          forecasts.model_version,
          forecasts.predicted_price,
          forecasts.predicted_number,
          forecasts.ranked_numbers_json,
          forecasts.created_at AS forecast_created_at,
          snapshots.source,
          snapshots.instrument,
          snapshots.external_round_id,
          snapshots.horizon_seconds,
          snapshots.betting_closes_at,
          snapshots.round_ends_at,
          snapshots.factor_at,
          snapshots.locked_at,
          snapshots.lead_time_ms,
          snapshots.persisted_at,
          snapshots.persisted_lead_time_ms,
          snapshots.current_price,
          snapshots.start_price,
          snapshots.current_number,
          snapshots.cells_json AS trajectory_cells_json,
          snapshots.features_json,
          settlements.round_result_id,
          settlements.actual_number,
          settlements.settled_at,
          settlements.top1_hit,
          settlements.top3_hit,
          settlements.current_cell_hit,
          settlements.created_at AS settlement_created_at,
          pair_snapshots.schema_version AS pair_schema_version,
          pair_snapshots.status AS pair_status,
          pair_snapshots.history_cutoff_at AS pair_history_cutoff_at,
          pair_snapshots.captured_at AS pair_captured_at,
          pair_snapshots.history_max_result_id AS pair_history_max_result_id,
          pair_snapshots.anchor_result_id AS pair_anchor_result_id,
          pair_snapshots.anchor_number AS pair_anchor_number,
          pair_snapshots.anchor_settled_at AS pair_anchor_settled_at,
          pair_snapshots.anchor_continuity_epoch AS pair_anchor_continuity_epoch,
          pair_snapshots.sample_size AS pair_sample_size,
          pair_snapshots.observed_follower_count AS pair_observed_follower_count,
          pair_snapshots.pair_top3_json,
          pair_snapshots.model_top3_json AS pair_model_top3_json,
          pair_snapshots.overlap_numbers_json AS pair_overlap_numbers_json,
          pair_snapshots.overlap_count AS pair_overlap_count,
          pair_snapshots.same_top1 AS pair_same_top1,
          pair_snapshots.exact_order AS pair_exact_order,
          consensus_snapshots.forecast_id AS consensus_forecast_id,
          consensus_snapshots.schema_version AS consensus_schema_version,
          consensus_snapshots.algorithm_version AS consensus_algorithm_version,
          consensus_snapshots.status AS consensus_status,
          consensus_snapshots.top3_json AS consensus_top3_json,
          consensus_snapshots.inputs_used_json AS consensus_inputs_used_json,
          consensus_snapshots.pair_sample_size AS consensus_pair_sample_size,
          consensus_snapshots.derived_from_snapshot_at
            AS consensus_derived_from_snapshot_at,
          consensus_snapshots.reason AS consensus_reason,
          consensus_snapshots.created_at AS consensus_created_at,
          trajectory_shadows.forecast_id AS trajectory_shadow_forecast_id,
          trajectory_shadows.trajectory_id AS trajectory_shadow_trajectory_id,
          trajectory_shadows.schema_version AS trajectory_shadow_schema_version,
          trajectory_shadows.model_version AS trajectory_shadow_model_version,
          trajectory_shadows.status AS trajectory_shadow_status,
          trajectory_shadows.reason AS trajectory_shadow_reason,
          trajectory_shadows.cutoff_at AS trajectory_shadow_cutoff_at,
          trajectory_shadows.lock_price AS trajectory_shadow_lock_price,
          trajectory_shadows.median_cell_width
            AS trajectory_shadow_median_cell_width,
          trajectory_shadows.direction AS trajectory_shadow_direction,
          trajectory_shadows.probabilities_json
            AS trajectory_shadow_probabilities_json,
          trajectory_shadows.expected_delta_cell_widths
            AS trajectory_shadow_expected_delta_cell_widths,
          trajectory_shadows.sample_json AS trajectory_shadow_sample_json,
          trajectory_shadows.nearest_ids_json
            AS trajectory_shadow_nearest_ids_json,
          trajectory_shadows.parameters_json
            AS trajectory_shadow_parameters_json,
          trajectory_shadows.current_prefix_json
            AS trajectory_shadow_current_prefix_json,
          trajectory_shadows.integration_json
            AS trajectory_shadow_integration_json,
          trajectory_shadows.created_at AS trajectory_shadow_created_at,
          settlement_results.price AS trajectory_actual_price,
          settlement_results.raw_cell AS trajectory_actual_raw_cell,
          predictive_leaders.forecast_id AS leader_forecast_id,
          predictive_leaders.schema_version AS leader_schema_version,
          predictive_leaders.algorithm_version AS leader_algorithm_version,
          predictive_leaders.status AS leader_status,
          predictive_leaders.locked_at AS leader_locked_at,
          predictive_leaders.history_max_result_id AS leader_history_max_result_id,
          predictive_leaders.training_through_forecast_id
            AS leader_training_through_forecast_id,
          predictive_leaders.training_through_result_id
            AS leader_training_through_result_id,
          leader_training_settlements.round_result_id
            AS leader_expected_training_result_id,
          predictive_leaders.training_count AS leader_training_count,
          predictive_leaders.predicted_number AS leader_predicted_number,
          predictive_leaders.score AS leader_score,
          predictive_leaders.snapshot_json AS leader_snapshot_json,
          predictive_leaders.created_at AS leader_created_at,
          leader_gates.forecast_id AS leader_gate_forecast_id,
          leader_gates.policy_version AS leader_gate_version,
          leader_gates.cutoff_at AS leader_gate_cutoff_at,
          leader_gates.status AS leader_gate_status,
          leader_gates.eligible AS leader_gate_eligible,
          leader_gates.snapshot_json AS leader_gate_snapshot_json
        FROM round_forecasts AS forecasts
        JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
        LEFT JOIN forecast_settlements AS settlements
          ON settlements.forecast_id = forecasts.id
        LEFT JOIN forecast_pair_snapshots AS pair_snapshots
          ON pair_snapshots.forecast_id = forecasts.id
        LEFT JOIN forecast_consensus_snapshots AS consensus_snapshots
          ON consensus_snapshots.forecast_id = forecasts.id
        LEFT JOIN forecast_trajectory_shadows AS trajectory_shadows
          ON trajectory_shadows.forecast_id = forecasts.id
        LEFT JOIN forecast_predictive_leader_snapshots AS predictive_leaders
          ON predictive_leaders.forecast_id = forecasts.id
        LEFT JOIN forecast_predictive_leader_quality_snapshots AS leader_gates
          ON leader_gates.forecast_id = predictive_leaders.forecast_id
        LEFT JOIN forecast_settlements AS leader_training_settlements
          ON leader_training_settlements.forecast_id =
            predictive_leaders.training_through_forecast_id
        LEFT JOIN round_results AS settlement_results
          ON settlement_results.id = settlements.round_result_id
        WHERE snapshots.source = ? AND snapshots.instrument = ?
        ORDER BY snapshots.locked_at DESC, forecasts.id DESC
        LIMIT 1
      `)
      .get(safeSource, safeInstrument);
    const latest = mapPrecloseForecast(latestRow);
    const metrics = latest
      ? this.sqlite
          .prepare(`
            SELECT
              COUNT(forecasts.id) AS forecast_count,
              COUNT(settlements.forecast_id) AS settled_count,
              COALESCE(SUM(settlements.top1_hit), 0) AS top1_hits,
              COALESCE(SUM(settlements.top3_hit), 0) AS top3_hits,
              COALESCE(SUM(settlements.current_cell_hit), 0) AS current_cell_hits
            FROM round_forecasts AS forecasts
            JOIN forecast_snapshots AS snapshots ON snapshots.id = forecasts.snapshot_id
            LEFT JOIN forecast_settlements AS settlements
              ON settlements.forecast_id = forecasts.id
            WHERE snapshots.source = ?
              AND snapshots.instrument = ?
              AND snapshots.horizon_seconds = ?
              AND forecasts.model_version = ?
          `)
          .get(
            safeSource,
            safeInstrument,
            latest.horizonSeconds,
            latest.modelVersion,
          )
      : {
          forecast_count: 0,
          settled_count: 0,
          top1_hits: 0,
          top3_hits: 0,
          current_cell_hits: 0,
        };
    const forecastCount = Number(metrics.forecast_count);
    const settledCount = Number(metrics.settled_count);
    this.#ensureTrajectoryMetricFacts(safeSource, safeInstrument);
    const trajectoryMetrics = mapTrajectoryMetrics(
      this.sqlite
        .prepare(`
          SELECT
            COALESCE(SUM(metric_facts.ready_count), 0) AS ready_count,
            COALESCE(SUM(metric_facts.settled_count), 0) AS settled_count,
            COALESCE(SUM(metric_facts.evaluated_count), 0) AS evaluated_count,
            COALESCE(SUM(metric_facts.display_range_hits), 0)
              AS display_range_hits,
            COALESCE(SUM(metric_facts.q50_exact_hits), 0) AS q50_exact_hits,
            COALESCE(SUM(metric_facts.full_corridor_hits), 0)
              AS full_corridor_hits,
            COALESCE(SUM(metric_facts.rank37_ready_count), 0)
              AS rank37_ready_count,
            COALESCE(SUM(metric_facts.rank37_settled_count), 0)
              AS rank37_settled_count,
            COALESCE(SUM(metric_facts.rank37_evaluated_count), 0)
              AS rank37_evaluated_count,
            COALESCE(SUM(metric_facts.rank37_top1_hits), 0)
              AS rank37_top1_hits,
            COALESCE(SUM(metric_facts.rank37_top3_hits), 0)
              AS rank37_top3_hits
          FROM forecast_trajectory_metric_facts AS metric_facts
          JOIN round_forecasts AS forecasts
            ON forecasts.id = metric_facts.forecast_id
          JOIN forecast_snapshots AS snapshots
            ON snapshots.id = forecasts.snapshot_id
          WHERE metric_facts.validator_version = ?
            AND snapshots.source = ?
            AND snapshots.instrument = ?
        `)
        .get(
          TRAJECTORY_METRIC_FACT_VERSION,
          safeSource,
          safeInstrument,
        ),
    );
    const predictiveLeaderRows = latest
      ? this.#predictiveLeaderMetricRows(
          safeSource,
          safeInstrument,
          latest.horizonSeconds,
        )
      : [];
    const predictiveLeaderMetrics = mapPredictiveLeaderMetricFacts(
      predictiveLeaderRows,
    );
    const predictiveLeaderAccount = this.#predictiveLeaderAccountState(
      safeSource,
      safeInstrument,
    );
    const predictiveLeaderSignalAccount = this.#predictiveLeaderSignalAccountState(
      safeSource,
      safeInstrument,
    );
    return {
      mode: "observation",
      executionEnabled: false,
      captureLeadSeconds: {
        min: PRECLOSE_FORECAST_MIN_LEAD_MS / 1_000,
        max: PRECLOSE_FORECAST_MAX_LEAD_MS / 1_000,
      },
      minimumPersistedLeadSeconds: 5,
      latest,
      trajectoryMetrics,
      predictiveLeaderMetrics,
      predictiveLeaderAccount,
      predictiveLeaderSignalAccount,
      metrics: {
        forecastCount,
        settledCount,
        pendingCount: Math.max(0, forecastCount - settledCount),
        top1Hits: Number(metrics.top1_hits),
        top3Hits: Number(metrics.top3_hits),
        currentCellHits: Number(metrics.current_cell_hits),
        top1Rate: settledCount ? Number(metrics.top1_hits) / settledCount : null,
        top3Rate: settledCount ? Number(metrics.top3_hits) / settledCount : null,
        currentCellRate: settledCount
          ? Number(metrics.current_cell_hits) / settledCount
          : null,
      },
    };
  }

  getPrecloseForecastHits(
    source = "buleto",
    instrument = "default",
    limit = 20,
  ) {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const safeLimit = normalizedLimit(limit, 20);
    return this.sqlite
      .prepare(`
        SELECT
          snapshots.external_round_id,
          snapshots.locked_at,
          forecasts.model_version,
          forecasts.ranked_numbers_json,
          settlements.actual_number,
          settlements.settled_at
        FROM forecast_settlements AS settlements
        JOIN round_forecasts AS forecasts
          ON forecasts.id = settlements.forecast_id
        JOIN forecast_snapshots AS snapshots
          ON snapshots.id = forecasts.snapshot_id
        WHERE snapshots.source = ?
          AND snapshots.instrument = ?
          AND settlements.top3_hit = 1
        ORDER BY settlements.settled_at DESC, forecasts.id DESC
        LIMIT ?
      `)
      .all(safeSource, safeInstrument, safeLimit)
      .map(mapPrecloseForecastHit);
  }

  enrichKnownResults(events) {
    this.#assertOpen();
    if (!Array.isArray(events)) throw new TypeError("events must be an array");
    if (events.length === 0) return { received: 0, enriched: 0 };

    const now = new Date().toISOString();
    const normalizedEvents = events.map((event, index) => normalizeEvent(event, index, now));
    const outcome = this.#transaction(() =>
      this.#classifyHistoricalEventsInTransaction(normalizedEvents),
    );
    return { received: outcome.received, enriched: outcome.enriched };
  }

  getRecentResults(limit = DEFAULT_LIMIT) {
    this.#assertOpen();
    const safeLimit = normalizedLimit(limit);
    return this.sqlite
      .prepare(`
        SELECT
          rr.*,
          ce.eliminated AS was_new,
          ce.remaining_count AS remaining_after
        FROM round_results AS rr
        LEFT JOIN cycle_events AS ce ON ce.round_result_id = rr.id
        ORDER BY rr.settled_at DESC, rr.id DESC
        LIMIT ?
      `)
      .all(safeLimit)
      .map(mapRoundResult);
  }

  getCycleAnalogue(source = "buleto", instrument = "default") {
    this.#assertOpen();
    const safeSource = asNonEmptyText(source, undefined, "source");
    const safeInstrument = asNonEmptyText(instrument, undefined, "instrument");
    const generatedAt = asTimestamp(this.clock(), undefined, "clock");
    const responseBase = {
      schemaVersion: 1,
      algorithmVersion: CYCLE_ANALOGUE_ALGORITHM_VERSION,
      interpretation: "descriptive-not-predictive",
      generatedAt,
      anchorDrawCount: CYCLE_ANALOGUE_ANCHOR_DRAW_COUNT,
      anchorResultId: null,
      target: null,
      analogue: null,
      candidateStats: { eligibleCompleted: null },
    };

    const activeRow = this.sqlite
      .prepare(`
        SELECT *
        FROM cycles
        WHERE source = ? AND instrument = ? AND status = 'active'
        ORDER BY last_event_at DESC, id DESC
        LIMIT 1
      `)
      .get(safeSource, safeInstrument);
    const latestRow =
      activeRow ??
      this.sqlite
        .prepare(`
          SELECT *
          FROM cycles
          WHERE source = ? AND instrument = ?
          ORDER BY last_event_at DESC, id DESC
          LIMIT 1
        `)
        .get(safeSource, safeInstrument);

    if (!latestRow) {
      return {
        ...responseBase,
        status: "unavailable",
        reason: "no-cycle",
      };
    }
    if (latestRow.status === "invalid_gap") {
      return {
        ...responseBase,
        status: "integrity_gap",
        reason: "current-cycle-integrity-gap",
      };
    }

    const targetCycle = this.#hydrateCycle(latestRow);
    const targetEvents = this.#cycleEventSequence(targetCycle.id);
    const target = {
      mode: targetCycle.status === "active" ? "active" : "latest_completed",
      cycle: targetCycle,
      events: targetEvents,
    };
    if (targetEvents.length !== targetCycle.eventCount) {
      return {
        ...responseBase,
        status: "unavailable",
        reason: "target-history-incomplete",
      };
    }

    const initialSelection = selectCycleAnalogue(targetEvents, []);
    if (initialSelection.status === "collecting_anchor") {
      return {
        ...responseBase,
        status: "collecting_anchor",
        target,
        reason: "awaiting-anchor",
      };
    }

    const prefixRows = this.sqlite
      .prepare(`
        WITH valid_candidates AS (
          SELECT c.id, c.completed_at
          FROM cycles AS c
          JOIN cycle_events AS ce ON ce.cycle_id = c.id
          JOIN round_results AS rr ON rr.id = ce.round_result_id
          WHERE c.source = ?
            AND c.instrument = ?
            AND c.status = 'completed'
            AND c.id < ?
            AND c.completed_at < ?
            AND c.event_count >= ?
            AND c.eliminated_count = 36
            AND NOT EXISTS (
              SELECT 1
              FROM incidents AS incident
              WHERE incident.cycle_id = c.id
                AND NOT EXISTS (
                  SELECT 1
                  FROM incident_resolutions AS resolution
                  WHERE resolution.incident_id = incident.id
                )
            )
            AND (
              SELECT COUNT(*)
              FROM cycle_numbers AS cn
              WHERE cn.cycle_id = c.id
            ) = 37
            AND (
              SELECT COUNT(*)
              FROM cycle_numbers AS cn
              WHERE cn.cycle_id = c.id AND cn.eliminated_at IS NOT NULL
            ) = 36
          GROUP BY c.id, c.completed_at, c.event_count, c.survivor_number
          HAVING COUNT(*) = c.event_count
            AND SUM(CASE WHEN rr.cycle_id = c.id THEN 0 ELSE 1 END) = 0
            AND COUNT(DISTINCT rr.continuity_epoch) = 1
            AND COUNT(DISTINCT ce.result_number) = 36
            AND SUM(CASE WHEN ce.result_number = c.survivor_number THEN 1 ELSE 0 END) = 0
        ), ordered_prefixes AS (
          SELECT
            candidates.id AS cycle_id,
            candidates.completed_at,
            ce.id AS event_id,
            ce.round_result_id,
            ce.result_number,
            ce.eliminated,
            ce.remaining_count,
            ce.occurred_at,
            ROW_NUMBER() OVER (
              PARTITION BY ce.cycle_id
              ORDER BY ce.occurred_at, ce.round_result_id, ce.id
            ) AS prefix_position
          FROM valid_candidates AS candidates
          JOIN cycle_events AS ce ON ce.cycle_id = candidates.id
        )
        SELECT *
        FROM ordered_prefixes
        WHERE prefix_position <= ?
        ORDER BY cycle_id, prefix_position
      `)
      .all(
        safeSource,
        safeInstrument,
        targetCycle.id,
        targetCycle.startedAt,
        CYCLE_ANALOGUE_ANCHOR_DRAW_COUNT,
        CYCLE_ANALOGUE_ANCHOR_DRAW_COUNT,
      );

    const candidateMap = new Map();
    for (const row of prefixRows) {
      const cycleId = Number(row.cycle_id);
      let candidate = candidateMap.get(cycleId);
      if (!candidate) {
        candidate = {
          id: cycleId,
          completedAt: row.completed_at,
          events: [],
        };
        candidateMap.set(cycleId, candidate);
      }
      candidate.events.push({
        position: Number(row.prefix_position),
        id: Number(row.round_result_id),
        resultId: Number(row.round_result_id),
        eventId: Number(row.event_id),
        number: Number(row.result_number),
        settledAt: row.occurred_at,
        wasNew: Boolean(row.eliminated),
        remainingAfter: Number(row.remaining_count),
      });
    }

    const candidates = [...candidateMap.values()];
    const selection = selectCycleAnalogue(targetEvents, candidates);
    const candidateStats = { eligibleCompleted: candidates.length };
    if (selection.status !== "ready") {
      return {
        ...responseBase,
        status: "unavailable",
        anchorResultId: selection.anchorResultId,
        target,
        candidateStats,
        reason: "no-eligible-completed-history",
      };
    }

    const analogueCycle = this.#cycleById(selection.winner.id);
    const analogueEvents = this.#cycleEventSequence(selection.winner.id);
    const targetAfterAnchor = targetEvents.slice(CYCLE_ANALOGUE_ANCHOR_DRAW_COUNT);
    const analogueAfterAnchor = analogueEvents.slice(CYCLE_ANALOGUE_ANCHOR_DRAW_COUNT);
    const comparedDraws = Math.min(targetAfterAnchor.length, analogueAfterAnchor.length);
    let exactMatches = 0;
    for (let index = 0; index < comparedDraws; index += 1) {
      if (targetAfterAnchor[index].number === analogueAfterAnchor[index].number) {
        exactMatches += 1;
      }
    }

    return {
      ...responseBase,
      status: "ready",
      anchorResultId: selection.anchorResultId,
      target,
      analogue: {
        cycle: analogueCycle,
        events: analogueEvents,
        metrics: selection.metrics,
        afterAnchor: {
          comparedDraws,
          exactMatches,
        },
      },
      candidateStats,
    };
  }

  getCompletedCycles(limit = DEFAULT_LIMIT) {
    this.#assertOpen();
    const safeLimit = normalizedLimit(limit);
    return this.sqlite
      .prepare(`
        SELECT *
        FROM cycles
        WHERE status = 'completed'
        ORDER BY completed_at DESC, id DESC
        LIMIT ?
      `)
      .all(safeLimit)
      .map((row) => this.#hydrateCycle(row));
  }

  markGap(details = {}) {
    this.#assertOpen();
    const now = new Date().toISOString();
    const incident = this.#normalizeGap(details, now);
    const outcome = this.#transaction(() => this.#markGapInTransaction(incident, now));
    const mapped = this.#mapGapOutcome(outcome);
    emitLog(this.logger, "warn", mapped, "roulette result gap recorded");
    return mapped;
  }

  close() {
    if (this.closed) {
      return;
    }
    this.sqlite.close();
    this.trajectoryAdaptiveValidationCache.clear();
    this.closed = true;
  }
}

export function createDatabase(options = {}) {
  return new RouletteDatabase(options);
}
