import {
  TRAJECTORY_SHADOW_VERSION,
  predictTrajectoryShadow,
} from "./trajectory-shadow.js";

export const TRAJECTORY_SHADOW_ADAPTIVE_VERSION =
  "trajectory-shadow-adaptive-v2";

const SHARED_EXPERT_OPTIONS = Object.freeze({
  minHistory: 30,
  minNeighbors: 10,
  flatThresholdCellWidths: 0.5,
  maxAbsDeltaCellWidths: 12,
});

function frozenExpert(id, resamplePoints, neighbors, maxDistanceCellWidths) {
  return Object.freeze({
    id,
    options: Object.freeze({
      ...SHARED_EXPERT_OPTIONS,
      resamplePoints,
      neighbors,
      maxDistanceCellWidths,
    }),
  });
}

export const TRAJECTORY_SHADOW_ADAPTIVE_EXPERTS = Object.freeze([
  frozenExpert("local-12x10-r3", 12, 10, 3),
  frozenExpert("balanced-16x15-r4", 16, 15, 4),
  frozenExpert("broad-20x20-r5", 20, 20, 5),
]);

export const TRAJECTORY_SHADOW_ADAPTIVE_DEFAULTS = Object.freeze({
  eta: 0.75,
  decay: 0.995,
  directionLossWeight: 0.5,
  deltaLossWeight: 0.5,
  flatThresholdCellWidths: SHARED_EXPERT_OPTIONS.flatThresholdCellWidths,
  maxAbsDeltaCellWidths: SHARED_EXPERT_OPTIONS.maxAbsDeltaCellWidths,
});

const DIRECTIONS = Object.freeze(["up", "down", "flat"]);
const UNAVAILABLE_STATUSES = new Set([
  "insufficient_history",
  "insufficient_neighbors",
]);

function asObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function asId(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function asTimestamp(value, label) {
  if (
    !(value instanceof Date) &&
    (typeof value !== "string" || value.trim() === "")
  ) {
    throw new TypeError(`${label} must be a valid timestamp`);
  }
  const milliseconds = new Date(value).getTime();
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError(`${label} must be a valid timestamp`);
  }
  return milliseconds;
}

function asFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function plainOptions(options) {
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

function sameExpertOptions(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(expected).every(([key, expectedValue]) =>
    value[key] === expectedValue,
  );
}

function normalizedProbabilities(value, label) {
  const probabilities = asObject(value, label);
  const result = {};
  let total = 0;
  for (const direction of DIRECTIONS) {
    const probability = asFiniteNumber(
      probabilities[direction],
      `${label}.${direction}`,
    );
    if (probability < 0 || probability > 1) {
      throw new RangeError(`${label}.${direction} must be between zero and one`);
    }
    result[direction] = probability;
    total += probability;
  }
  if (Math.abs(total - 1) > 1e-9) {
    throw new RangeError(`${label} must sum to one`);
  }
  return result;
}

function normalizedDeltaRange(value, label) {
  const range = asObject(value, label);
  const lowerQuantile = asFiniteNumber(
    range.lowerQuantile,
    `${label}.lowerQuantile`,
  );
  const upperQuantile = asFiniteNumber(
    range.upperQuantile,
    `${label}.upperQuantile`,
  );
  const lower = asFiniteNumber(range.lower, `${label}.lower`);
  const median = asFiniteNumber(range.median, `${label}.median`);
  const upper = asFiniteNumber(range.upper, `${label}.upper`);
  if (
    Math.abs(lowerQuantile - 0.2) > 1e-12 ||
    Math.abs(upperQuantile - 0.8) > 1e-12 ||
    lower > median ||
    median > upper
  ) {
    throw new RangeError(`${label} must be an ordered q20/q50/q80 range`);
  }
  return { lowerQuantile, upperQuantile, lower, median, upper };
}

function directionForDelta(delta) {
  const threshold =
    TRAJECTORY_SHADOW_ADAPTIVE_DEFAULTS.flatThresholdCellWidths;
  if (delta > threshold) return "up";
  if (delta < -threshold) return "down";
  return "flat";
}

function winningDirection(probabilities, expectedDelta) {
  const maximum = Math.max(
    ...DIRECTIONS.map((direction) => probabilities[direction]),
  );
  const tied = DIRECTIONS.filter(
    (direction) =>
      Math.abs(probabilities[direction] - maximum) <= Number.EPSILON * 8,
  );
  if (tied.length === 1) return tied[0];
  if (tied.includes("flat")) return "flat";
  const expectedDirection = expectedDelta >= 0 ? "up" : "down";
  return tied.includes(expectedDirection)
    ? expectedDirection
    : [...tied].sort()[0];
}

function initialWeightObject() {
  const equalWeight = 1 / TRAJECTORY_SHADOW_ADAPTIVE_EXPERTS.length;
  return Object.fromEntries(
    TRAJECTORY_SHADOW_ADAPTIVE_EXPERTS.map((expert) => [
      expert.id,
      equalWeight,
    ]),
  );
}

function weightsFromLogWeights(logWeights) {
  const maximum = Math.max(...Object.values(logWeights));
  const exponentials = Object.fromEntries(
    TRAJECTORY_SHADOW_ADAPTIVE_EXPERTS.map((expert) => [
      expert.id,
      Math.exp(logWeights[expert.id] - maximum),
    ]),
  );
  const total = Object.values(exponentials).reduce(
    (sum, weight) => sum + weight,
    0,
  );
  if (!(total > 0) || !Number.isFinite(total)) {
    throw new RangeError("adaptive expert weights cannot be normalized");
  }
  return Object.fromEntries(
    TRAJECTORY_SHADOW_ADAPTIVE_EXPERTS.map((expert) => [
      expert.id,
      exponentials[expert.id] / total,
    ]),
  );
}

function expertSnapshot(snapshot, expert, label) {
  const input = asObject(snapshot, label);
  if (asId(input.id, `${label}.id`) !== expert.id) {
    throw new TypeError(`${label}.id does not match its frozen expert`);
  }
  if (input.modelVersion !== TRAJECTORY_SHADOW_VERSION) {
    throw new TypeError(`${label}.modelVersion is invalid`);
  }
  if (!sameExpertOptions(input.options, expert.options)) {
    throw new TypeError(`${label}.options do not match the frozen expert`);
  }
  const status = String(input.status ?? "");
  if (status === "ready") {
    const probabilities = normalizedProbabilities(
      input.probabilities,
      `${label}.probabilities`,
    );
    const expectedDeltaCellWidths = asFiniteNumber(
      input.expectedDeltaCellWidths,
      `${label}.expectedDeltaCellWidths`,
    );
    const deltaRangeCellWidths = normalizedDeltaRange(
      input.deltaRangeCellWidths,
      `${label}.deltaRangeCellWidths`,
    );
    if (!DIRECTIONS.includes(input.direction)) {
      throw new TypeError(`${label}.direction is invalid`);
    }
    const cap = TRAJECTORY_SHADOW_ADAPTIVE_DEFAULTS.maxAbsDeltaCellWidths;
    if (
      Math.abs(expectedDeltaCellWidths) > cap ||
      Math.abs(deltaRangeCellWidths.lower) > cap ||
      Math.abs(deltaRangeCellWidths.median) > cap ||
      Math.abs(deltaRangeCellWidths.upper) > cap ||
      input.direction !==
        winningDirection(probabilities, expectedDeltaCellWidths)
    ) {
      throw new RangeError(`${label} is inconsistent with the frozen model`);
    }
    return {
      status,
      direction: input.direction,
      probabilities,
      expectedDeltaCellWidths,
      deltaRangeCellWidths,
    };
  }
  if (!UNAVAILABLE_STATUSES.has(status)) {
    throw new TypeError(`${label}.status is invalid`);
  }
  return {
    status,
    direction: null,
    probabilities: null,
    expectedDeltaCellWidths: null,
    deltaRangeCellWidths: null,
  };
}

function normalizedLearningRow(input, index, currentLockedAt) {
  const row = asObject(input, `learningRows[${index}]`);
  const id = asId(row.id, `learningRows[${index}].id`);
  const completedAt = asTimestamp(
    row.completedAt,
    `learningRows[${index}].completedAt`,
  );

  // A same-cutoff or future outcome is unavailable. Do not inspect its label
  // or snapshots, so malformed future data cannot affect a past prediction.
  if (completedAt >= currentLockedAt) {
    return { id, completedAt, excludedNotPast: true };
  }

  const lockedAt = asTimestamp(
    row.lockedAt,
    `learningRows[${index}].lockedAt`,
  );
  if (lockedAt >= completedAt) {
    throw new RangeError(
      `learningRows[${index}].completedAt must be after lockedAt`,
    );
  }
  const actualDeltaCellWidths = asFiniteNumber(
    row.actualDeltaCellWidths,
    `learningRows[${index}].actualDeltaCellWidths`,
  );
  if (!Array.isArray(row.experts)) {
    throw new TypeError(`learningRows[${index}].experts must be an array`);
  }
  const provided = new Map();
  for (let expertIndex = 0; expertIndex < row.experts.length; expertIndex += 1) {
    const candidate = asObject(
      row.experts[expertIndex],
      `learningRows[${index}].experts[${expertIndex}]`,
    );
    const expertId = asId(
      candidate.id,
      `learningRows[${index}].experts[${expertIndex}].id`,
    );
    if (provided.has(expertId)) {
      throw new TypeError(
        `learningRows[${index}] contains duplicate expert ${expertId}`,
      );
    }
    const expert = TRAJECTORY_SHADOW_ADAPTIVE_EXPERTS.find(
      (entry) => entry.id === expertId,
    );
    if (!expert) {
      throw new TypeError(
        `learningRows[${index}] contains unknown expert ${expertId}`,
      );
    }
    provided.set(
      expertId,
      expertSnapshot(
        candidate,
        expert,
        `learningRows[${index}].experts[${expertIndex}]`,
      ),
    );
  }
  const commonReady = TRAJECTORY_SHADOW_ADAPTIVE_EXPERTS.every(
    (expert) => provided.get(expert.id)?.status === "ready",
  );
  return {
    id,
    lockedAt,
    completedAt,
    completedAtIso: new Date(completedAt).toISOString(),
    actualDeltaCellWidths,
    snapshots: provided,
    commonReady,
    excludedNotPast: false,
  };
}

function compareLearningRows(left, right) {
  return (
    left.completedAt - right.completedAt ||
    left.lockedAt - right.lockedAt ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
}

function normalizedBrierLoss(probabilities, actualDirection) {
  return (
    DIRECTIONS.reduce(
      (total, direction) =>
        total +
        (probabilities[direction] - (direction === actualDirection ? 1 : 0)) **
          2,
      0,
    ) / 2
  );
}

function normalizedDeltaLoss(predictedMedian, actualDelta) {
  const cap = TRAJECTORY_SHADOW_ADAPTIVE_DEFAULTS.maxAbsDeltaCellWidths;
  const clippedActual = Math.max(-cap, Math.min(cap, actualDelta));
  return Math.min(Math.abs(predictedMedian - clippedActual) / cap, 1);
}

function combinedLoss(snapshot, actualDelta) {
  const actualDirection = directionForDelta(actualDelta);
  const directionLoss = normalizedBrierLoss(
    snapshot.probabilities,
    actualDirection,
  );
  const deltaLoss = normalizedDeltaLoss(
    snapshot.deltaRangeCellWidths.median,
    actualDelta,
  );
  return (
    TRAJECTORY_SHADOW_ADAPTIVE_DEFAULTS.directionLossWeight * directionLoss +
    TRAJECTORY_SHADOW_ADAPTIVE_DEFAULTS.deltaLossWeight * deltaLoss
  );
}

function learnedWeights(learningRows, currentLockedAt) {
  const normalized = learningRows.map((row, index) =>
    normalizedLearningRow(row, index, currentLockedAt),
  );
  const eligible = normalized.filter((row) => !row.excludedNotPast);
  const seen = new Set();
  for (const row of eligible) {
    if (seen.has(row.id)) {
      throw new TypeError(`learningRows contains duplicate eligible id ${row.id}`);
    }
    seen.add(row.id);
  }
  eligible.sort(compareLearningRows);

  const priorWeights = initialWeightObject();
  const logWeights = Object.fromEntries(
    Object.entries(priorWeights).map(([id, weight]) => [id, Math.log(weight)]),
  );
  let trainingCount = 0;
  let skippedNotCommonReadyCount = 0;
  let lastTrainingCompletedAt = null;
  for (const row of eligible) {
    if (!row.commonReady) {
      skippedNotCommonReadyCount += 1;
      continue;
    }
    for (const expert of TRAJECTORY_SHADOW_ADAPTIVE_EXPERTS) {
      const loss = combinedLoss(
        row.snapshots.get(expert.id),
        row.actualDeltaCellWidths,
      );
      logWeights[expert.id] =
        TRAJECTORY_SHADOW_ADAPTIVE_DEFAULTS.decay * logWeights[expert.id] -
        TRAJECTORY_SHADOW_ADAPTIVE_DEFAULTS.eta * loss;
    }
    trainingCount += 1;
    lastTrainingCompletedAt = row.completedAtIso;
  }

  return {
    priorWeights,
    currentWeights: weightsFromLogWeights(logWeights),
    trainingCount,
    eligibleLearningRowCount: eligible.length,
    skippedNotCommonReadyCount,
    excludedNotPastCount: normalized.length - eligible.length,
    lastTrainingCompletedAt,
  };
}

function currentExpertPredictions(current, history) {
  return TRAJECTORY_SHADOW_ADAPTIVE_EXPERTS.map((expert) => {
    const result = predictTrajectoryShadow({
      current,
      history,
      options: expert.options,
    });
    return {
      id: expert.id,
      modelVersion: result.version,
      options: plainOptions(expert.options),
      status: result.status,
      direction: result.direction,
      probabilities: result.probabilities,
      expectedDeltaCellWidths: result.expectedDeltaCellWidths,
      deltaRangeCellWidths: result.deltaRangeCellWidths,
      sample: result.sample,
      nearestIds: [...result.nearestIds],
      neighborDistribution: result.neighborDistribution.map((neighbor) => ({
        ...neighbor,
      })),
    };
  });
}

function ensembleWeights(experts, currentWeights) {
  const ready = experts.filter((expert) => expert.status === "ready");
  const readyTotal = ready.reduce(
    (total, expert) => total + currentWeights[expert.id],
    0,
  );
  if (ready.length > 0 && (!(readyTotal > 0) || !Number.isFinite(readyTotal))) {
    throw new RangeError("ready adaptive expert weights cannot be normalized");
  }
  return Object.fromEntries(
    experts.map((expert) => [
      expert.id,
      expert.status === "ready" ? currentWeights[expert.id] / readyTotal : 0,
    ]),
  );
}

function adaptiveMetadata(experts, learning, readyWeights, currentLockedAt) {
  return {
    experts: experts.map((expert) => ({
      ...expert,
      priorWeight: learning.priorWeights[expert.id],
      learnedWeight: learning.currentWeights[expert.id],
      ensembleWeight: readyWeights[expert.id],
    })),
    priorWeights: { ...learning.priorWeights },
    currentWeights: { ...learning.currentWeights },
    ensembleWeights: { ...readyWeights },
    trainingCount: learning.trainingCount,
    eligibleLearningRowCount: learning.eligibleLearningRowCount,
    skippedNotCommonReadyCount: learning.skippedNotCommonReadyCount,
    excludedNotPastCount: learning.excludedNotPastCount,
    lastTrainingCompletedAt: learning.lastTrainingCompletedAt,
    learningCutoffAt: new Date(currentLockedAt).toISOString(),
  };
}

function adaptiveParameters() {
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
      options: plainOptions(expert.options),
    })),
  };
}

function unavailableResult(experts, learning, readyWeights, currentLockedAt) {
  const representative = experts.find(
    (expert) => expert.status === "insufficient_history",
  ) ?? experts[0];
  return {
    version: TRAJECTORY_SHADOW_ADAPTIVE_VERSION,
    status: representative.status,
    direction: null,
    probabilities: null,
    expectedDeltaCellWidths: null,
    deltaRangeCellWidths: null,
    sample: { ...representative.sample },
    nearestIds: [],
    parameters: adaptiveParameters(),
    adaptive: adaptiveMetadata(
      experts,
      learning,
      readyWeights,
      currentLockedAt,
    ),
  };
}

/**
 * Builds an adaptive ensemble from fixed kNN experts. Learning rows contain
 * only frozen expert snapshots from earlier locks; their outcomes update the
 * weights strictly after completion and can affect only later predictions.
 */
export function predictAdaptiveTrajectoryShadow({
  current,
  history,
  learningRows = [],
} = {}) {
  const currentInput = asObject(current, "current");
  const currentLockedAt = asTimestamp(
    currentInput.lockedAt,
    "current.lockedAt",
  );
  if (!Array.isArray(history)) {
    throw new TypeError("history must be an array");
  }
  if (!Array.isArray(learningRows)) {
    throw new TypeError("learningRows must be an array");
  }

  const learning = learnedWeights(learningRows, currentLockedAt);
  const experts = currentExpertPredictions(currentInput, history);
  const readyWeights = ensembleWeights(experts, learning.currentWeights);
  const ready = experts.filter((expert) => expert.status === "ready");
  if (ready.length === 0) {
    return unavailableResult(
      experts,
      learning,
      readyWeights,
      currentLockedAt,
    );
  }

  const probabilities = { up: 0, down: 0, flat: 0 };
  let expectedDeltaCellWidths = 0;
  const deltaRangeCellWidths = {
    lowerQuantile: 0.2,
    upperQuantile: 0.8,
    lower: 0,
    median: 0,
    upper: 0,
  };
  for (const expert of ready) {
    const weight = readyWeights[expert.id];
    for (const direction of DIRECTIONS) {
      probabilities[direction] += weight * expert.probabilities[direction];
    }
    expectedDeltaCellWidths += weight * expert.expectedDeltaCellWidths;
    deltaRangeCellWidths.lower +=
      weight * expert.deltaRangeCellWidths.lower;
    deltaRangeCellWidths.median +=
      weight * expert.deltaRangeCellWidths.median;
    deltaRangeCellWidths.upper +=
      weight * expert.deltaRangeCellWidths.upper;
  }
  const probabilityTotal = DIRECTIONS.reduce(
    (total, direction) => total + probabilities[direction],
    0,
  );
  for (const direction of DIRECTIONS) {
    probabilities[direction] /= probabilityTotal;
  }

  const reference = ready.reduce((best, expert) =>
    readyWeights[expert.id] > readyWeights[best.id] ? expert : best,
  );
  const nearestIds = [];
  const seenNearestIds = new Set();
  for (const expert of ready) {
    for (const id of expert.nearestIds) {
      if (seenNearestIds.has(id)) continue;
      seenNearestIds.add(id);
      nearestIds.push(id);
    }
  }

  return {
    version: TRAJECTORY_SHADOW_ADAPTIVE_VERSION,
    status: "ready",
    direction: winningDirection(probabilities, expectedDeltaCellWidths),
    probabilities,
    expectedDeltaCellWidths,
    deltaRangeCellWidths,
    sample: { ...reference.sample },
    nearestIds,
    parameters: adaptiveParameters(),
    adaptive: adaptiveMetadata(
      experts,
      learning,
      readyWeights,
      currentLockedAt,
    ),
  };
}
