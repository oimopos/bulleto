import { PRECLOSE_START_PRICE_MODEL_VERSION } from "./preclose-forecast.js";

export const FORECAST_CONSENSUS_BORDA_ALGORITHM_VERSION = "consensus-borda-v1";
export const FORECAST_CONSENSUS_MODEL_AUTHORITATIVE_ALGORITHM_VERSION =
  "model-authoritative-v1";
export const FORECAST_CONSENSUS_AUTHORITATIVE_MODEL_VERSION =
  PRECLOSE_START_PRICE_MODEL_VERSION;

// Backward-compatible alias used by existing readers and callers. Historical
// forecasts continue to mean Borda v1 unless their exact model version opts in
// to the model-authoritative finalization policy below.
export const FORECAST_CONSENSUS_ALGORITHM_VERSION =
  FORECAST_CONSENSUS_BORDA_ALGORITHM_VERSION;

export function resolveForecastConsensusAlgorithm(modelVersion) {
  return modelVersion === FORECAST_CONSENSUS_AUTHORITATIVE_MODEL_VERSION
    ? FORECAST_CONSENSUS_MODEL_AUTHORITATIVE_ALGORITHM_VERSION
    : FORECAST_CONSENSUS_BORDA_ALGORITHM_VERSION;
}

function validateRanking(value) {
  if (value === null || value === undefined) {
    return { valid: true, numbers: [] };
  }
  if (!Array.isArray(value) || value.length > 3) {
    return { valid: false, numbers: [] };
  }

  const numbers = [];
  const seen = new Set();
  for (const number of value) {
    if (
      !Number.isInteger(number) ||
      number < 0 ||
      number > 36 ||
      seen.has(number)
    ) {
      return { valid: false, numbers: [] };
    }
    seen.add(number);
    numbers.push(number);
  }
  return { valid: true, numbers };
}

function sameRanking(left, right) {
  return (
    left.length === right.length &&
    left.every((number, index) => number === right[index])
  );
}

function normalizeSampleSize(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizeSnapshotTime(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function baseResult(pairSampleSize, derivedFromSnapshotAt, algorithmVersion) {
  return {
    algorithmVersion,
    pairSampleSize: normalizeSampleSize(pairSampleSize),
    derivedFromSnapshotAt: normalizeSnapshotTime(derivedFromSnapshotAt),
  };
}

function rankCandidates(rankings) {
  const candidates = new Map();
  for (const ranking of rankings) {
    for (const [index, number] of ranking.entries()) {
      const rank = index + 1;
      const candidate = candidates.get(number) ?? {
        number,
        support: 0,
        borda: 0,
        bestRank: rank,
        worstRank: rank,
      };
      candidate.support += 1;
      candidate.borda += 4 - rank;
      candidate.bestRank = Math.min(candidate.bestRank, rank);
      candidate.worstRank = Math.max(candidate.worstRank, rank);
      candidates.set(number, candidate);
    }
  }

  return [...candidates.values()]
    .sort(
      (left, right) =>
        right.support - left.support ||
        right.borda - left.borda ||
        left.worstRank - right.worstRank ||
        left.bestRank - right.bestRank ||
        left.number - right.number,
    )
    .slice(0, 3)
    .map((candidate) => candidate.number);
}

export function combineFrozenTop3({
  modelVersion,
  modelTop3,
  pairTop3,
  pairStatus,
  pairModelTop3,
  pairSampleSize = null,
  derivedFromSnapshotAt = null,
} = {}) {
  const algorithmVersion = resolveForecastConsensusAlgorithm(modelVersion);
  const metadata = baseResult(
    pairSampleSize,
    derivedFromSnapshotAt,
    algorithmVersion,
  );
  const model = validateRanking(modelTop3);
  const pair = validateRanking(pairTop3);
  const snapshotModel = validateRanking(pairModelTop3);
  const completeModel = model.valid && model.numbers.length === 3;

  if (
    algorithmVersion ===
    FORECAST_CONSENSUS_MODEL_AUTHORITATIVE_ALGORITHM_VERSION
  ) {
    if (completeModel) {
      return {
        status: "model_fallback",
        top3: [...model.numbers],
        ...metadata,
        inputsUsed: ["model"],
        reason: "authoritative_model",
      };
    }

    return {
      status: "unavailable",
      top3: [],
      ...metadata,
      inputsUsed: [],
      reason: model.valid ? "incomplete_model_ranking" : "invalid_model_ranking",
    };
  }

  const readyPair =
    pairStatus === "ready" && pair.valid && pair.numbers.length > 0;
  const matchingSnapshotModel =
    completeModel &&
    snapshotModel.valid &&
    snapshotModel.numbers.length === 3 &&
    sameRanking(model.numbers, snapshotModel.numbers);

  if (completeModel && readyPair && matchingSnapshotModel) {
    return {
      status: "combined",
      top3: rankCandidates([model.numbers, pair.numbers]),
      ...metadata,
      inputsUsed: ["model", "pair"],
      reason: "frozen_model_and_pair",
    };
  }

  if (completeModel) {
    let reason = "pair_not_ready";
    if (pairStatus === "ready" && !pair.valid) {
      reason = "invalid_pair_ranking";
    } else if (pairStatus === "ready" && pair.numbers.length === 0) {
      reason = "empty_pair_ranking";
    } else if (pairStatus === "ready" && !matchingSnapshotModel) {
      reason = "pair_snapshot_model_mismatch";
    }
    return {
      status: "model_fallback",
      top3: [...model.numbers],
      ...metadata,
      inputsUsed: ["model"],
      reason,
    };
  }

  const modelWasUnavailable =
    model.valid && model.numbers.length === 0;
  const completeFrozenPair =
    readyPair &&
    pair.numbers.length === 3 &&
    snapshotModel.valid &&
    snapshotModel.numbers.length === 3;
  if (modelWasUnavailable && completeFrozenPair) {
    return {
      status: "pair_fallback",
      top3: [...pair.numbers],
      ...metadata,
      inputsUsed: ["pair"],
      reason: "model_unavailable",
    };
  }

  return {
    status: "unavailable",
    top3: [],
    ...metadata,
    inputsUsed: [],
    reason: model.valid ? "incomplete_model_ranking" : "invalid_model_ranking",
  };
}
