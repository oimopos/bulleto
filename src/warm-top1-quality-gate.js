export const WARM_TOP1_ALGORITHM_VERSION = 'follower-warm-top5-next-v1';
export const WARM_TOP1_GATE_VERSION =
  'warm-top1-fixed-first-1000-prospective-v1';
export const WARM_TOP1_GATE_TARGET_SAMPLE_SIZE = 1_000;
export const WARM_TOP1_BREAK_EVEN_RATE = 1 / 36;

export const WARM_TOP1_MINIMUM_OBSERVED_FOLLOWERS = 5;
export const WARM_TOP1_SHARE_THRESHOLD_PERCENT = 5;
export const WARM_TOP1_GATE_CONFIDENCE_LEVEL = 0.95;

const WILSON_95_Z_SCORE = 1.959963984540054;
const ROULETTE_NUMBER_COUNT = 37;

export const WARM_TOP1_GATE = Object.freeze({
  version: WARM_TOP1_GATE_VERSION,
  algorithmVersion: WARM_TOP1_ALGORITHM_VERSION,
  windowPolicy: 'first-1000-selected-settled-prospective-no-roll',
  targetSampleSize: WARM_TOP1_GATE_TARGET_SAMPLE_SIZE,
  breakEvenRate: WARM_TOP1_BREAK_EVEN_RATE,
  confidenceLevel: WARM_TOP1_GATE_CONFIDENCE_LEVEL,
  shareThresholdPercent: WARM_TOP1_SHARE_THRESHOLD_PERCENT,
  minimumObservedFollowerCount: WARM_TOP1_MINIMUM_OBSERVED_FOLLOWERS,
});

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function rouletteNumber(value) {
  return Number.isInteger(value)
    && value >= 0
    && value < ROULETTE_NUMBER_COUNT;
}

function nonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function sameFiniteNumber(left, right) {
  return typeof left === 'number'
    && Number.isFinite(left)
    && Math.abs(left - right) <= Number.EPSILON * Math.max(1, Math.abs(right)) * 8;
}

function arrayFromSnapshot(value) {
  const candidates = [value.pairTop3, value.pair_top3, value.top3]
    .filter((item) => item !== undefined);
  if (value.pair_top3_json !== undefined) {
    if (typeof value.pair_top3_json !== 'string') return null;
    try {
      candidates.push(JSON.parse(value.pair_top3_json));
    } catch {
      return null;
    }
  }
  if (candidates.length !== 1 || !Array.isArray(candidates[0])) return null;
  return candidates[0];
}

function integerField(value, camelName, snakeName) {
  const camel = value[camelName];
  const snake = value[snakeName];
  if (camel !== undefined && snake !== undefined) return null;
  return camel === undefined ? snake : camel;
}

function candidateResult({
  status,
  reason,
  eligible = false,
  number = null,
  occurrenceCount = null,
  sampleSize = null,
  observedFollowerCount = null,
  share = null,
}) {
  return Object.freeze({
    algorithmVersion: WARM_TOP1_ALGORITHM_VERSION,
    status,
    reason,
    eligible,
    rank: number === null ? null : 1,
    number,
    occurrenceCount,
    sampleSize,
    observedFollowerCount,
    share,
    threshold: WARM_TOP1_SHARE_THRESHOLD_PERCENT / 100,
    comparison: 'gte',
    shareThresholdPercent: WARM_TOP1_SHARE_THRESHOLD_PERCENT,
    minimumObservedFollowerCount: WARM_TOP1_MINIMUM_OBSERVED_FOLLOWERS,
  });
}

function invalidCandidate() {
  return candidateResult({
    status: 'invalid',
    reason: 'invalid_pair_snapshot',
  });
}

/**
 * Extracts the single frozen leader from a causal pair snapshot.
 *
 * Canonical callers should provide `pairTop3`, `sampleSize`, and
 * `observedFollowerCount`. The persisted snake_case spellings and the public
 * API's `top3` spelling are accepted as mutually exclusive aliases so the
 * same validator can sit directly at either boundary.
 */
export function warmTop1CandidateFromPairSnapshot(value) {
  try {
    if (!isPlainObject(value)) return invalidCandidate();
    if (!['ready', 'no_anchor', 'no_samples'].includes(value.status)) {
      return invalidCandidate();
    }

    const sampleSize = integerField(value, 'sampleSize', 'sample_size');
    const observedFollowerCount = integerField(
      value,
      'observedFollowerCount',
      'observed_follower_count',
    );
    const pairTop3 = arrayFromSnapshot(value);
    if (
      !nonNegativeSafeInteger(sampleSize)
      || !nonNegativeSafeInteger(observedFollowerCount)
      || observedFollowerCount > ROULETTE_NUMBER_COUNT
      || pairTop3 === null
      || pairTop3.length > 3
    ) {
      return invalidCandidate();
    }

    if (value.status !== 'ready') {
      if (sampleSize !== 0 || observedFollowerCount !== 0 || pairTop3.length !== 0) {
        return invalidCandidate();
      }
      return candidateResult({
        status: 'no_signal',
        reason: value.status,
        sampleSize,
        observedFollowerCount,
      });
    }
    if (
      sampleSize < 1
      || observedFollowerCount < 1
      || observedFollowerCount > sampleSize
      || pairTop3.length < 1
      || pairTop3.length > observedFollowerCount
    ) {
      return invalidCandidate();
    }

    const normalized = [];
    const numbers = new Set();
    for (let index = 0; index < pairTop3.length; index += 1) {
      const item = pairTop3[index];
      if (!isPlainObject(item)) return invalidCandidate();
      const occurrenceCount = integerField(
        item,
        'occurrenceCount',
        'occurrence_count',
      );
      if (
        !rouletteNumber(item.number)
        || !positiveSafeInteger(occurrenceCount)
        || occurrenceCount > sampleSize
        || numbers.has(item.number)
        || (item.rank !== undefined && item.rank !== index + 1)
        || (
          item.share !== undefined
          && !sameFiniteNumber(item.share, occurrenceCount / sampleSize)
        )
      ) {
        return invalidCandidate();
      }
      if (
        index > 0
        && occurrenceCount > normalized[index - 1].occurrenceCount
      ) {
        return invalidCandidate();
      }
      numbers.add(item.number);
      normalized.push({ number: item.number, occurrenceCount });
    }

    const leader = normalized[0];
    const base = {
      number: leader.number,
      occurrenceCount: leader.occurrenceCount,
      sampleSize,
      observedFollowerCount,
      share: leader.occurrenceCount / sampleSize,
    };
    if (observedFollowerCount < WARM_TOP1_MINIMUM_OBSERVED_FOLLOWERS) {
      return candidateResult({
        ...base,
        status: 'no_signal',
        reason: 'insufficient_observed_followers',
      });
    }

    // BigInt keeps the persisted integer policy exact even near MAX_SAFE_INTEGER.
    const passesShareThreshold =
      BigInt(leader.occurrenceCount) * 100n
      >= BigInt(sampleSize) * BigInt(WARM_TOP1_SHARE_THRESHOLD_PERCENT);
    if (!passesShareThreshold) {
      return candidateResult({
        ...base,
        status: 'no_signal',
        reason: 'below_share_threshold',
      });
    }
    return candidateResult({
      ...base,
      status: 'ready',
      reason: 'threshold_met',
      eligible: true,
    });
  } catch {
    return invalidCandidate();
  }
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

function gateResult({
  status,
  reason,
  eligible = false,
  sampleSize = 0,
  hitCount = 0,
  hitRate = null,
  lowerBound = null,
  upperBound = null,
  windowStartForecastId = null,
  windowEndForecastId = null,
}) {
  return Object.freeze({
    version: WARM_TOP1_GATE_VERSION,
    algorithmVersion: WARM_TOP1_ALGORITHM_VERSION,
    status,
    reason,
    eligible,
    windowPolicy: WARM_TOP1_GATE.windowPolicy,
    targetSampleSize: WARM_TOP1_GATE_TARGET_SAMPLE_SIZE,
    selectedCount: sampleSize,
    settledCount: sampleSize,
    sampleSize,
    hitCount,
    missCount: sampleSize - hitCount,
    hitRate,
    breakEvenRate: WARM_TOP1_BREAK_EVEN_RATE,
    confidenceLevel: WARM_TOP1_GATE_CONFIDENCE_LEVEL,
    lowerBound,
    upperBound,
    economicBreakEvenTop1Rate: WARM_TOP1_BREAK_EVEN_RATE,
    top1Wilson95: lowerBound === null || upperBound === null
      ? null
      : Object.freeze({ lower: lowerBound, upper: upperBound }),
    fixedWindowComplete: sampleSize === WARM_TOP1_GATE_TARGET_SAMPLE_SIZE,
    settlementComplete: sampleSize === WARM_TOP1_GATE_TARGET_SAMPLE_SIZE,
    windowStartForecastId,
    windowEndForecastId,
  });
}

function invalidGate(reason = 'invalid_input') {
  return gateResult({ status: 'invalid', reason });
}

/**
 * Evaluates the first 1,000 qualifying settled samples supplied after the
 * caller's frozen prospective boundary. Later samples can never roll or
 * replace that window.
 *
 * A sample has the shape `{ forecastId, actualNumber, pairSnapshot }`.
 * `pairSnapshot` is validated by `warmTop1CandidateFromPairSnapshot`.
 */
export function evaluateWarmTop1FixedGate(samples, options = {}) {
  try {
    if (!Array.isArray(samples) || !isPlainObject(options)) {
      return invalidGate();
    }
    const optionKeys = Object.keys(options);
    if (
      optionKeys.some((key) => key !== 'integrityValid')
      || (
        Object.hasOwn(options, 'integrityValid')
        && typeof options.integrityValid !== 'boolean'
      )
    ) {
      return invalidGate('invalid_options');
    }
    if (options.integrityValid === false) {
      return invalidGate('integrity_not_confirmed');
    }

    const ids = new Set();
    const qualified = [];
    for (const sample of samples) {
      if (
        !isPlainObject(sample)
        || !positiveSafeInteger(sample.forecastId)
        || !rouletteNumber(sample.actualNumber)
        || !isPlainObject(sample.pairSnapshot)
        || ids.has(sample.forecastId)
      ) {
        return invalidGate('invalid_sample');
      }
      ids.add(sample.forecastId);
      const candidate = warmTop1CandidateFromPairSnapshot(sample.pairSnapshot);
      if (candidate.status === 'invalid') {
        return invalidGate('invalid_pair_snapshot');
      }
      if (candidate.eligible) {
        qualified.push({
          forecastId: sample.forecastId,
          hit: candidate.number === sample.actualNumber,
        });
      }
    }

    qualified.sort((left, right) => left.forecastId - right.forecastId);
    const window = qualified.slice(0, WARM_TOP1_GATE_TARGET_SAMPLE_SIZE);
    const sampleSize = window.length;
    const hitCount = window.reduce(
      (total, sample) => total + Number(sample.hit),
      0,
    );
    const hitRate = sampleSize === 0 ? null : hitCount / sampleSize;
    const { lowerBound, upperBound } = wilson95Interval(hitCount, sampleSize);
    const metrics = {
      sampleSize,
      hitCount,
      hitRate,
      lowerBound,
      upperBound,
      windowStartForecastId: window[0]?.forecastId ?? null,
      windowEndForecastId: window.at(-1)?.forecastId ?? null,
    };

    if (sampleSize < WARM_TOP1_GATE_TARGET_SAMPLE_SIZE) {
      return gateResult({
        ...metrics,
        status: 'collecting',
        reason: 'insufficient_selected_sample',
      });
    }
    if (lowerBound <= WARM_TOP1_BREAK_EVEN_RATE) {
      return gateResult({
        ...metrics,
        status: 'rejected',
        reason: 'wilson_lower_bound_not_above_break_even',
      });
    }
    return gateResult({
      ...metrics,
      status: 'confirmed',
      reason: 'quality_confirmed',
      eligible: true,
    });
  } catch {
    return invalidGate();
  }
}
