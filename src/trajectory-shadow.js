export const TRAJECTORY_SHADOW_VERSION = "trajectory-shadow-knn-v1";

export const TRAJECTORY_SHADOW_DEFAULTS = Object.freeze({
  resamplePoints: 16,
  neighbors: 15,
  minHistory: 30,
  minNeighbors: 10,
  maxDistanceCellWidths: 4,
  flatThresholdCellWidths: 0.5,
  maxAbsDeltaCellWidths: 12,
});

const DIRECTIONS = Object.freeze(["up", "down", "flat"]);

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

function asFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
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

function asInteger(value, fallback, label, minimum, maximum) {
  const candidate = value === undefined ? fallback : value;
  if (
    !Number.isInteger(candidate) ||
    candidate < minimum ||
    candidate > maximum
  ) {
    throw new RangeError(
      `${label} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return candidate;
}

function asPositiveNumber(value, fallback, label) {
  const candidate = value === undefined ? fallback : value;
  if (
    typeof candidate !== "number" ||
    !Number.isFinite(candidate) ||
    candidate <= 0
  ) {
    throw new RangeError(`${label} must be a positive finite number`);
  }
  return candidate;
}

function normalizedOptions(input) {
  const options = input === undefined ? {} : asObject(input, "options");
  const normalized = {
    resamplePoints: asInteger(
      options.resamplePoints,
      TRAJECTORY_SHADOW_DEFAULTS.resamplePoints,
      "options.resamplePoints",
      4,
      64,
    ),
    neighbors: asInteger(
      options.neighbors,
      TRAJECTORY_SHADOW_DEFAULTS.neighbors,
      "options.neighbors",
      1,
      25,
    ),
    minHistory: asInteger(
      options.minHistory,
      TRAJECTORY_SHADOW_DEFAULTS.minHistory,
      "options.minHistory",
      1,
      10_000,
    ),
    minNeighbors: asInteger(
      options.minNeighbors,
      TRAJECTORY_SHADOW_DEFAULTS.minNeighbors,
      "options.minNeighbors",
      1,
      25,
    ),
    maxDistanceCellWidths: asPositiveNumber(
      options.maxDistanceCellWidths,
      TRAJECTORY_SHADOW_DEFAULTS.maxDistanceCellWidths,
      "options.maxDistanceCellWidths",
    ),
    flatThresholdCellWidths:
      options.flatThresholdCellWidths === undefined
        ? TRAJECTORY_SHADOW_DEFAULTS.flatThresholdCellWidths
        : asFiniteNumber(
            options.flatThresholdCellWidths,
            "options.flatThresholdCellWidths",
          ),
    maxAbsDeltaCellWidths: asPositiveNumber(
      options.maxAbsDeltaCellWidths,
      TRAJECTORY_SHADOW_DEFAULTS.maxAbsDeltaCellWidths,
      "options.maxAbsDeltaCellWidths",
    ),
  };
  if (normalized.minNeighbors > normalized.neighbors) {
    throw new RangeError("options.minNeighbors cannot exceed options.neighbors");
  }
  if (normalized.flatThresholdCellWidths < 0) {
    throw new RangeError(
      "options.flatThresholdCellWidths must be non-negative",
    );
  }
  if (
    normalized.maxAbsDeltaCellWidths <
    normalized.flatThresholdCellWidths
  ) {
    throw new RangeError(
      "options.maxAbsDeltaCellWidths cannot be below the flat threshold",
    );
  }
  return normalized;
}

function medianCellWidth(widths, label) {
  if (!Array.isArray(widths) || widths.length === 0) {
    throw new TypeError(`${label} must be a non-empty array`);
  }
  const sorted = widths
    .map((width, index) =>
      asPositiveNumber(width, undefined, `${label}[${index}]`),
    )
    .sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  if (!Number.isFinite(median)) {
    throw new RangeError(`${label} has no finite median`);
  }
  return median;
}

function normalizedPrefix(points, lockedAtMs, label) {
  if (!Array.isArray(points) || points.length < 3) {
    throw new RangeError(`${label} must contain at least three points`);
  }
  let previousAt = null;
  return points.map((point, index) => {
    asObject(point, `${label}[${index}]`);
    const at = asTimestamp(point.at, `${label}[${index}].at`);
    const price = asFiniteNumber(point.price, `${label}[${index}].price`);
    if (previousAt !== null && at <= previousAt) {
      throw new RangeError(
        `${label} must be strictly increasing with distinct timestamps`,
      );
    }
    if (at > lockedAtMs) {
      throw new RangeError(`${label}[${index}] is after lockedAt`);
    }
    previousAt = at;
    return { at, price };
  });
}

function resampledShape(points, width, count, label) {
  const first = points[0];
  const last = points.at(-1);
  const duration = last.at - first.at;
  if (!(duration > 0)) {
    throw new RangeError(`${label} must span a positive duration`);
  }

  const result = [];
  let rightIndex = 1;
  for (let index = 0; index < count; index += 1) {
    const target = index === count - 1
      ? last.at
      : first.at + (duration * index) / (count - 1);
    while (
      rightIndex < points.length - 1 &&
      points[rightIndex].at < target
    ) {
      rightIndex += 1;
    }
    const left = points[rightIndex - 1];
    const right = points[rightIndex];
    const fraction = (target - left.at) / (right.at - left.at);
    const price = left.price + (right.price - left.price) * fraction;
    const normalized = (price - first.price) / width;
    if (!Number.isFinite(normalized)) {
      throw new RangeError(`${label} cannot be normalized to cell widths`);
    }
    result.push(normalized);
  }
  return result;
}

function shapeDistance(left, right) {
  const differences = left.map((value, index) => value - right[index]);
  return Math.hypot(...differences) / Math.sqrt(differences.length);
}

function compareCandidates(left, right) {
  const distanceDifference = left.distance - right.distance;
  const distanceTolerance =
    Math.max(1, Math.abs(left.distance), Math.abs(right.distance)) *
    Number.EPSILON *
    64;
  if (Math.abs(distanceDifference) > distanceTolerance) {
    return distanceDifference;
  }
  if (left.completedAt !== right.completedAt) {
    return right.completedAt - left.completedAt;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function classifyDelta(delta, flatThreshold) {
  if (delta > flatThreshold) return "up";
  if (delta < -flatThreshold) return "down";
  return "flat";
}

function baseSample(
  historyCount,
  eligibleCount,
  excludedNotPastCount,
  withinDistanceCount,
  options,
) {
  return {
    historyCount,
    eligibleCount,
    excludedNotPastCount,
    withinDistanceCount,
    neighborCount: 0,
    requiredHistory: options.minHistory,
    requiredNeighbors: options.minNeighbors,
  };
}

function unavailable(status, sample, options) {
  return {
    version: TRAJECTORY_SHADOW_VERSION,
    status,
    direction: null,
    probabilities: null,
    expectedDeltaCellWidths: null,
    sample,
    nearestIds: [],
    parameters: { ...options },
  };
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

/**
 * Compares the current, fully observed pre-close prefix only with trajectories
 * that had completed before the current lock. Each historical outcome is the
 * price change from its lock to end, expressed in its own median cell width.
 */
export function predictTrajectoryShadow({ current, history, options } = {}) {
  const settings = normalizedOptions(options);
  const currentInput = asObject(current, "current");
  const currentId = asId(currentInput.id, "current.id");
  const currentLockedAt = asTimestamp(currentInput.lockedAt, "current.lockedAt");
  const currentPoints = normalizedPrefix(
    currentInput.prefix,
    currentLockedAt,
    "current.prefix",
  );
  const currentWidth = medianCellWidth(
    currentInput.cellWidths,
    "current.cellWidths",
  );
  const currentShape = resampledShape(
    currentPoints,
    currentWidth,
    settings.resamplePoints,
    "current.prefix",
  );
  if (!Array.isArray(history)) {
    throw new TypeError("history must be an array");
  }

  const candidates = [];
  const seenIds = new Set();
  let excludedNotPastCount = 0;
  for (let index = 0; index < history.length; index += 1) {
    const input = asObject(history[index], `history[${index}]`);
    const id = asId(input.id, `history[${index}].id`);
    const completedAt = asTimestamp(
      input.completedAt,
      `history[${index}].completedAt`,
    );

    // Do not inspect a not-yet-available trajectory beyond the two fields
    // needed for the cutoff. Future outcomes cannot invalidate or alter a run.
    if (completedAt >= currentLockedAt) {
      excludedNotPastCount += 1;
      continue;
    }
    if (id === currentId || seenIds.has(id)) {
      throw new TypeError(`history contains duplicate eligible id ${id}`);
    }
    seenIds.add(id);

    const lockedAt = asTimestamp(input.lockedAt, `history[${index}].lockedAt`);
    if (lockedAt >= completedAt) {
      throw new RangeError(
        `history[${index}].completedAt must be after lockedAt`,
      );
    }
    const prefix = normalizedPrefix(
      input.prefix,
      lockedAt,
      `history[${index}].prefix`,
    );
    const width = medianCellWidth(
      input.cellWidths,
      `history[${index}].cellWidths`,
    );
    const shape = resampledShape(
      prefix,
      width,
      settings.resamplePoints,
      `history[${index}].prefix`,
    );
    const distance = shapeDistance(currentShape, shape);
    if (!Number.isFinite(distance)) {
      throw new RangeError(`history[${index}] has a non-finite shape distance`);
    }
    const lockPrice = asFiniteNumber(
      input.lockPrice,
      `history[${index}].lockPrice`,
    );
    const endPrice = asFiniteNumber(
      input.endPrice,
      `history[${index}].endPrice`,
    );
    const rawDelta = (endPrice - lockPrice) / width;
    if (!Number.isFinite(rawDelta)) {
      throw new RangeError(`history[${index}] has a non-finite normalized delta`);
    }
    const direction = classifyDelta(
      rawDelta,
      settings.flatThresholdCellWidths,
    );
    const delta = Math.max(
      -settings.maxAbsDeltaCellWidths,
      Math.min(settings.maxAbsDeltaCellWidths, rawDelta),
    );
    candidates.push({
      id,
      completedAt,
      distance,
      delta,
      direction,
    });
  }

  const withinDistance = candidates
    .filter((candidate) => candidate.distance <= settings.maxDistanceCellWidths)
    .sort(compareCandidates);
  const sample = baseSample(
    history.length,
    candidates.length,
    excludedNotPastCount,
    withinDistance.length,
    settings,
  );
  if (candidates.length < settings.minHistory) {
    return unavailable("insufficient_history", sample, settings);
  }

  const nearest = withinDistance.slice(0, settings.neighbors);
  if (nearest.length < settings.minNeighbors) {
    return unavailable("insufficient_neighbors", sample, settings);
  }

  const weightedDirections = { up: 0, down: 0, flat: 0 };
  let totalWeight = 0;
  let weightedDelta = 0;
  for (const neighbor of nearest) {
    const weight = 1 / (1 + neighbor.distance * neighbor.distance);
    totalWeight += weight;
    weightedDelta += weight * neighbor.delta;
    weightedDirections[neighbor.direction] += weight;
  }
  const probabilities = {
    up: weightedDirections.up / totalWeight,
    down: weightedDirections.down / totalWeight,
    flat: weightedDirections.flat / totalWeight,
  };
  const expectedDeltaCellWidths = weightedDelta / totalWeight;

  return {
    version: TRAJECTORY_SHADOW_VERSION,
    status: "ready",
    direction: winningDirection(probabilities, expectedDeltaCellWidths),
    probabilities,
    expectedDeltaCellWidths,
    sample: { ...sample, neighborCount: nearest.length },
    nearestIds: nearest.map((neighbor) => neighbor.id),
    parameters: { ...settings },
  };
}
