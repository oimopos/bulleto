const STORED_STATUSES = new Set(['ready', 'unselected', 'unavailable']);
const PREDICTED_DIRECTIONS = new Set(['up', 'down']);
const OUTCOME_DIRECTIONS = new Set(['up', 'down', 'flat']);

function requireNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function validateNullableDirection(value, name) {
  if (value !== null && !OUTCOME_DIRECTIONS.has(value)) {
    throw new TypeError(`${name} must be one of up, down, flat, or null`);
  }
}

function validateEntry(entry, index, previousForecastId) {
  const prefix = `entries[${index}]`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError(`${prefix} must be an object`);
  }
  if (!Number.isSafeInteger(entry.forecastId) || entry.forecastId <= 0) {
    throw new TypeError(`${prefix}.forecastId must be a positive safe integer`);
  }
  if (previousForecastId !== null && entry.forecastId <= previousForecastId) {
    throw new RangeError('entries must be in strictly increasing forecastId order');
  }
  if (!STORED_STATUSES.has(entry.status)) {
    throw new TypeError(`${prefix}.status must be ready, unselected, or unavailable`);
  }
  if (entry.reason !== null
      && (typeof entry.reason !== 'string' || entry.reason.trim() === '')) {
    throw new TypeError(`${prefix}.reason must be a non-empty string or null`);
  }

  if (entry.status === 'ready') {
    if (!PREDICTED_DIRECTIONS.has(entry.predictedDirection)) {
      throw new TypeError(`${prefix}.predictedDirection must be up or down when ready`);
    }
  } else if (entry.predictedDirection !== null) {
    throw new TypeError(`${prefix}.predictedDirection must be null unless ready`);
  }

  validateNullableDirection(entry.actualDirection, `${prefix}.actualDirection`);
  validateNullableDirection(entry.championDirection, `${prefix}.championDirection`);
  if (typeof entry.settled !== 'boolean') {
    throw new TypeError(`${prefix}.settled must be a boolean`);
  }
  if (!entry.settled && entry.actualDirection !== null) {
    throw new TypeError(`${prefix}.actualDirection requires a settled outcome`);
  }
}

function wilsonInterval(hitCount, sampleSize, z = 1.959963984540054) {
  requireNonNegativeInteger(hitCount, 'hitCount');
  requireNonNegativeInteger(sampleSize, 'sampleSize');
  if (hitCount > sampleSize) {
    throw new RangeError('hitCount cannot exceed sampleSize');
  }
  if (sampleSize === 0) return null;

  const rate = hitCount / sampleSize;
  const zSquared = z ** 2;
  const denominator = 1 + zSquared / sampleSize;
  const center = (rate + zSquared / (2 * sampleSize)) / denominator;
  const radius = z * Math.sqrt(
    (rate * (1 - rate) / sampleSize) + zSquared / (4 * sampleSize ** 2),
  ) / denominator;
  return {
    confidence: 0.95,
    lower: Math.max(0, center - radius),
    upper: Math.min(1, center + radius),
  };
}

function logBinomialCoefficient(n, k) {
  const smallerK = Math.min(k, n - k);
  let result = 0;
  for (let index = 1; index <= smallerK; index += 1) {
    result += Math.log(n - smallerK + index) - Math.log(index);
  }
  return result;
}

function exactTwoSidedBinomialPValue(successes, failures) {
  const sampleSize = successes + failures;
  if (sampleSize === 0) return null;

  const lowerTailThrough = Math.min(successes, failures);
  const logProbabilities = [];
  let maximumLogProbability = Number.NEGATIVE_INFINITY;
  for (let k = 0; k <= lowerTailThrough; k += 1) {
    const logProbability = logBinomialCoefficient(sampleSize, k)
      - sampleSize * Math.log(2);
    logProbabilities.push(logProbability);
    maximumLogProbability = Math.max(maximumLogProbability, logProbability);
  }
  const scaledSum = logProbabilities.reduce(
    (total, logProbability) => total + Math.exp(logProbability - maximumLogProbability),
    0,
  );
  return Math.min(1, 2 * Math.exp(maximumLogProbability) * scaledSum);
}

function emptySideMetrics() {
  return {
    selectedCount: 0,
    evaluatedCount: 0,
    hits: 0,
    rate: null,
  };
}

/**
 * Summarize immutable, prospective trajectory-direction challenger snapshots.
 * Entries must already be normalized and ordered chronologically by forecastId.
 */
export function summarizeTrajectoryDirectionChallenger(
  entries,
  { eligibleForecastCount, totalStoredCount } = {},
) {
  if (!Array.isArray(entries)) {
    throw new TypeError('entries must be an array');
  }

  let previousForecastId = null;
  entries.forEach((entry, index) => {
    validateEntry(entry, index, previousForecastId);
    previousForecastId = entry.forecastId;
  });

  const validStoredCount = entries.length;
  const storedCount = totalStoredCount === undefined
    ? validStoredCount
    : requireNonNegativeInteger(totalStoredCount, 'totalStoredCount');
  if (storedCount < validStoredCount) {
    throw new RangeError('totalStoredCount cannot be smaller than entries.length');
  }
  const eligibleCount = eligibleForecastCount === undefined
    ? storedCount
    : requireNonNegativeInteger(eligibleForecastCount, 'eligibleForecastCount');
  if (eligibleCount < storedCount) {
    throw new RangeError('eligibleForecastCount cannot be smaller than totalStoredCount');
  }

  let selectedCount = 0;
  let unselectedCount = 0;
  let unavailableCount = 0;
  let evaluatedSelected = 0;
  let settledSelected = 0;
  let pendingSelected = 0;
  let ungradableSelected = 0;
  let hits = 0;
  let longestPredictedDirectionRun = 0;
  let currentPredictedDirectionRun = 0;
  let previousPredictedDirection = null;
  let predictedDirectionTransitionCount = 0;
  const reasons = {};
  const byPredictedDirection = {
    up: emptySideMetrics(),
    down: emptySideMetrics(),
  };
  const actualDistribution = { up: 0, down: 0, flat: 0 };
  const paired = {
    count: 0,
    challengerHits: 0,
    championHits: 0,
    challengerRate: null,
    championRate: null,
    uplift: null,
    bothHit: 0,
    challengerOnly: 0,
    championOnly: 0,
    bothWrong: 0,
    discordantCount: 0,
    exactTwoSidedMcNemarPValue: null,
  };

  for (const entry of entries) {
    if (entry.status !== 'ready') {
      if (entry.status === 'unselected') unselectedCount += 1;
      else unavailableCount += 1;
      const reason = entry.reason ?? 'unspecified';
      reasons[reason] = (reasons[reason] ?? 0) + 1;
      continue;
    }

    selectedCount += 1;
    byPredictedDirection[entry.predictedDirection].selectedCount += 1;
    if (entry.predictedDirection === previousPredictedDirection) {
      currentPredictedDirectionRun += 1;
    } else {
      if (previousPredictedDirection !== null) {
        predictedDirectionTransitionCount += 1;
      }
      previousPredictedDirection = entry.predictedDirection;
      currentPredictedDirectionRun = 1;
    }
    longestPredictedDirectionRun = Math.max(
      longestPredictedDirectionRun,
      currentPredictedDirectionRun,
    );

    if (!entry.settled) {
      pendingSelected += 1;
      continue;
    }
    settledSelected += 1;
    if (entry.actualDirection === null) {
      ungradableSelected += 1;
      continue;
    }
    evaluatedSelected += 1;
    actualDistribution[entry.actualDirection] += 1;
    const challengerHit = entry.predictedDirection === entry.actualDirection;
    hits += Number(challengerHit);
    const side = byPredictedDirection[entry.predictedDirection];
    side.evaluatedCount += 1;
    side.hits += Number(challengerHit);

    if (entry.championDirection === null) continue;
    const championHit = entry.championDirection === entry.actualDirection;
    paired.count += 1;
    paired.challengerHits += Number(challengerHit);
    paired.championHits += Number(championHit);
    if (challengerHit && championHit) paired.bothHit += 1;
    else if (challengerHit) paired.challengerOnly += 1;
    else if (championHit) paired.championOnly += 1;
    else paired.bothWrong += 1;
  }

  for (const direction of PREDICTED_DIRECTIONS) {
    const side = byPredictedDirection[direction];
    side.rate = side.evaluatedCount > 0 ? side.hits / side.evaluatedCount : null;
  }

  paired.discordantCount = paired.challengerOnly + paired.championOnly;
  paired.challengerRate = paired.count > 0
    ? paired.challengerHits / paired.count
    : null;
  paired.championRate = paired.count > 0
    ? paired.championHits / paired.count
    : null;
  paired.uplift = paired.count > 0
    ? (paired.challengerHits - paired.championHits) / paired.count
    : null;
  paired.exactTwoSidedMcNemarPValue = exactTwoSidedBinomialPValue(
    paired.challengerOnly,
    paired.championOnly,
  );

  const possibleTransitions = Math.max(0, selectedCount - 1);
  return {
    eligibleCount,
    storedCount,
    validStoredCount,
    selectedCount,
    unselectedCount,
    unavailableCount,
    reasons,
    decisionCoverage: validStoredCount > 0 ? selectedCount / validStoredCount : null,
    decisionCoverageWilson95: wilsonInterval(selectedCount, validStoredCount),
    evaluatedSelected,
    settledSelected,
    pendingSelected,
    ungradableSelected,
    hits,
    selectiveAccuracy: evaluatedSelected > 0 ? hits / evaluatedSelected : null,
    selectiveAccuracyWilson95: wilsonInterval(hits, evaluatedSelected),
    byPredictedDirection,
    actualDistribution,
    paired,
    longestPredictedDirectionRun,
    predictedDirectionTransitionCount,
    predictedDirectionTransitionRate: possibleTransitions > 0
      ? predictedDirectionTransitionCount / possibleTransitions
      : null,
  };
}
