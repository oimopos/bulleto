export const PREDICTIVE_LEADER_QUALITY_GATE = Object.freeze({
  version: "top1-first-settled-cohort-wilson95-v2",
  requiredSampleSize: 1_000,
  baselineRate: 1 / 37,
  confidenceLevel: 0.95,
});

export function wilsonInterval(hitCount, sampleSize, z = 1.959963984540054) {
  if (!Number.isSafeInteger(sampleSize) || sampleSize <= 0) return null;
  const rate = hitCount / sampleSize;
  const denominator = 1 + (z ** 2) / sampleSize;
  const center = (rate + (z ** 2) / (2 * sampleSize)) / denominator;
  const radius = z * Math.sqrt(
    (rate * (1 - rate) / sampleSize) + (z ** 2) / (4 * sampleSize ** 2),
  ) / denominator;
  return {
    confidence: PREDICTIVE_LEADER_QUALITY_GATE.confidenceLevel,
    lower: Math.max(0, center - radius),
    upper: Math.min(1, center + radius),
  };
}

export function assessPredictiveLeaderQualityGate(readyLeaders, invalidReadyCount = 0) {
  if (!Array.isArray(readyLeaders)) {
    throw new TypeError("readyLeaders must be an array");
  }
  if (!Number.isSafeInteger(invalidReadyCount) || invalidReadyCount < 0) {
    throw new TypeError("invalidReadyCount must be a non-negative integer");
  }

  const {
    requiredSampleSize,
    baselineRate,
    confidenceLevel,
  } = PREDICTIVE_LEADER_QUALITY_GATE;
  // A historical gap can leave a ready leader unresolved forever. Build the
  // cohort from authoritative outcomes so a permanently missing slot cannot
  // block later prospective evidence.
  const settled = readyLeaders.filter((leader) => leader.evaluation !== null);
  const cohort = settled.slice(0, requiredSampleSize);
  const cohortSize = Math.min(readyLeaders.length, requiredSampleSize);
  const hitCount = cohort.reduce(
    (total, leader) => total + Number(leader.evaluation.top1Hit),
    0,
  );
  const cohortComplete = cohort.length === requiredSampleSize;
  const interval = cohortComplete && invalidReadyCount === 0
    ? wilsonInterval(hitCount, cohort.length)
    : null;
  let status = "collecting";
  let reason = "insufficient_sample";
  if (invalidReadyCount > 0) {
    status = "invalid";
    reason = "invalid_evaluation";
  } else if (cohortSize === requiredSampleSize && !cohortComplete) {
    status = "pending";
    reason = "cohort_pending";
  } else if (cohortComplete) {
    status = interval.lower > baselineRate ? "confirmed" : "rejected";
    reason = status === "confirmed" ? "confirmed" : "not_above_baseline";
  }

  return {
    ...PREDICTIVE_LEADER_QUALITY_GATE,
    status,
    reason,
    eligible: status === "confirmed",
    cohortSize,
    sampleSize: cohort.length,
    hitCount,
    hitRate: cohort.length > 0 ? hitCount / cohort.length : null,
    lowerBound: interval?.lower ?? null,
  };
}
