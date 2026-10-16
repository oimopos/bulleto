import { LEARNED_LEADER_UNIFORM_BRIER_LOSS } from './learned-leader.js';

export const PREDICTIVE_LEADER_QUALITY_GATE_VERSION =
  'rolling-1000-wilson95-brier-v1';
export const PREDICTIVE_LEADER_QUALITY_GATE_WINDOW_SIZE = 1_000;
export const PREDICTIVE_LEADER_QUALITY_GATE_BASELINE_RATE = 1 / 36;
export const PREDICTIVE_LEADER_QUALITY_GATE_CONFIDENCE_LEVEL = 0.95;
export const PREDICTIVE_LEADER_QUALITY_GATE = Object.freeze({
  version: PREDICTIVE_LEADER_QUALITY_GATE_VERSION,
  windowSize: PREDICTIVE_LEADER_QUALITY_GATE_WINDOW_SIZE,
  baselineRate: PREDICTIVE_LEADER_QUALITY_GATE_BASELINE_RATE,
  confidenceLevel: PREDICTIVE_LEADER_QUALITY_GATE_CONFIDENCE_LEVEL,
  uniformBrierLoss: LEARNED_LEADER_UNIFORM_BRIER_LOSS,
});

const WILSON_95_Z_SCORE = 1.959963984540054;
const QUALITY_FACT_KEYS = Object.freeze([
  'combinedBrierLoss',
  'forecastId',
  'top1Hit',
]);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function frozenResult({
  status,
  reason,
  eligible = false,
  sampleSize = 0,
  hitCount = 0,
  hitRate = null,
  lowerBound = null,
  upperBound = null,
  meanBrierLoss = null,
  brierDelta = null,
  windowStartForecastId = null,
  windowEndForecastId = null,
}) {
  return Object.freeze({
    version: PREDICTIVE_LEADER_QUALITY_GATE.version,
    status,
    reason,
    eligible,
    windowSize: PREDICTIVE_LEADER_QUALITY_GATE.windowSize,
    sampleSize,
    hitCount,
    hitRate,
    baselineRate: PREDICTIVE_LEADER_QUALITY_GATE.baselineRate,
    confidenceLevel: PREDICTIVE_LEADER_QUALITY_GATE.confidenceLevel,
    lowerBound,
    upperBound,
    meanBrierLoss,
    uniformBrierLoss: PREDICTIVE_LEADER_QUALITY_GATE.uniformBrierLoss,
    brierDelta,
    windowStartForecastId,
    windowEndForecastId,
  });
}

function invalidResult(reason) {
  return frozenResult({ status: 'invalid', reason });
}

function normalizedFacts(value) {
  if (!Array.isArray(value)) return null;
  const ids = new Set();
  const facts = [];

  for (const fact of value) {
    if (!isPlainObject(fact)) return null;
    const keys = Object.keys(fact).sort();
    if (
      keys.length !== QUALITY_FACT_KEYS.length
      || keys.some((key, index) => key !== QUALITY_FACT_KEYS[index])
      || !Number.isSafeInteger(fact.forecastId)
      || fact.forecastId < 1
      || typeof fact.top1Hit !== 'boolean'
      || typeof fact.combinedBrierLoss !== 'number'
      || !Number.isFinite(fact.combinedBrierLoss)
      || fact.combinedBrierLoss < 0
      || fact.combinedBrierLoss > 1
      || ids.has(fact.forecastId)
    ) {
      return null;
    }
    ids.add(fact.forecastId);
    facts.push({
      forecastId: fact.forecastId,
      top1Hit: fact.top1Hit,
      combinedBrierLoss: fact.combinedBrierLoss,
    });
  }

  facts.sort((left, right) => left.forecastId - right.forecastId);
  return facts;
}

function wilson95Interval(hitCount, sampleSize) {
  if (sampleSize === 0) return { lowerBound: null, upperBound: null };
  const rate = hitCount / sampleSize;
  const zSquared = WILSON_95_Z_SCORE ** 2;
  const denominator = 1 + zSquared / sampleSize;
  const center = (rate + zSquared / (2 * sampleSize)) / denominator;
  const margin = WILSON_95_Z_SCORE * Math.sqrt(
    (rate * (1 - rate) + zSquared / (4 * sampleSize)) / sampleSize,
  ) / denominator;
  return {
    lowerBound: Math.max(0, center - margin),
    upperBound: Math.min(1, center + margin),
  };
}

export function evaluatePredictiveLeaderQualityGate(value) {
  try {
    if (!isPlainObject(value)) return invalidResult('invalid_input');
    const { facts, currentFamilyCount } = value;
    if (!Number.isSafeInteger(currentFamilyCount) || currentFamilyCount < 0) {
      return invalidResult('invalid_current_family_count');
    }
    const normalized = normalizedFacts(facts);
    if (normalized === null) return invalidResult('malformed_facts');

    const window = normalized.slice(-PREDICTIVE_LEADER_QUALITY_GATE_WINDOW_SIZE);
    const sampleSize = window.length;
    const hitCount = window.reduce(
      (total, fact) => total + Number(fact.top1Hit),
      0,
    );
    const hitRate = sampleSize === 0 ? null : hitCount / sampleSize;
    let meanBrierLoss = null;
    for (let index = 0; index < sampleSize; index += 1) {
      meanBrierLoss ??= window[index].combinedBrierLoss;
      if (index > 0) {
        meanBrierLoss += (
          window[index].combinedBrierLoss - meanBrierLoss
        ) / (index + 1);
      }
    }
    const brierDelta = meanBrierLoss === null
      ? null
      : LEARNED_LEADER_UNIFORM_BRIER_LOSS - meanBrierLoss;
    const { lowerBound, upperBound } = wilson95Interval(hitCount, sampleSize);
    const metrics = {
      sampleSize,
      hitCount,
      hitRate,
      lowerBound,
      upperBound,
      meanBrierLoss,
      brierDelta,
      windowStartForecastId: window[0]?.forecastId ?? null,
      windowEndForecastId: window.at(-1)?.forecastId ?? null,
    };

    if (sampleSize < PREDICTIVE_LEADER_QUALITY_GATE_WINDOW_SIZE) {
      return frozenResult({
        ...metrics,
        status: 'collecting',
        reason: 'insufficient_sample',
      });
    }
    if (currentFamilyCount !== 2) {
      return frozenResult({
        ...metrics,
        status: 'rejected',
        reason: 'current_family_count_not_two',
      });
    }
    if (lowerBound <= PREDICTIVE_LEADER_QUALITY_GATE_BASELINE_RATE) {
      return frozenResult({
        ...metrics,
        status: 'rejected',
        reason: 'wilson_lower_bound_not_above_break_even',
      });
    }
    if (meanBrierLoss >= LEARNED_LEADER_UNIFORM_BRIER_LOSS) {
      return frozenResult({
        ...metrics,
        status: 'rejected',
        reason: 'mean_brier_loss_not_below_uniform',
      });
    }
    return frozenResult({
      ...metrics,
      status: 'confirmed',
      reason: 'quality_confirmed',
      eligible: true,
    });
  } catch {
    return invalidResult('invalid_input');
  }
}
