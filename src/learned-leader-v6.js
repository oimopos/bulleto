export const LEARNED_LEADER_V6_SCHEMA_VERSION = 1;
export const LEARNED_LEADER_V6_ALGORITHM_VERSION =
  "learned-predictive-hierarchical-v6-shadow";
export const LEARNED_LEADER_V6_LEARNING_VERSION =
  "regularized-family-brier-v1";

export const LEARNED_LEADER_V6_FAMILIES = Object.freeze([
  "price",
  "conditional-history",
]);

export const LEARNED_LEADER_V6_DEFAULTS = Object.freeze({
  priceUniformMix: 0.15,
  // Rank-37 `mass` already contains its frozen 5% uniform calibration.
  // Do not silently smooth that probability vector for a second time.
  smoothedPriceUniformMix: 0,
  pairPriorStrength: 74,
  tripleBackoffStrength: 50,
  staticPriceWeight: 0.7,
  minimumPriceWeight: 0.6,
  maximumPriceWeight: 0.85,
  decay: 0.995,
  eta: 0.25,
  etaScale: 100,
  learningShrinkageCount: 100,
  minimumAdaptiveTrainingCount: 30,
  minimumSelectivePriceEvidenceCandidates: 5,
  minimumSelectivePairEffectiveSampleSize: 100,
  minimumSelectiveMargin: 0.002,
});

export const LEARNED_LEADER_V6_UNIFORM_BRIER_LOSS = 18 / 37;

const NUMBER_COUNT = 37;
const EPSILON = 1e-12;
const SUM_TOLERANCE = 1e-9;
const LOG_LOSS_FLOOR = 1e-15;
const UNIFORM = Object.freeze(Array(NUMBER_COUNT).fill(1 / NUMBER_COUNT));

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function closeEnough(left, right, tolerance = SUM_TOLERANCE) {
  return Math.abs(left - right) <= tolerance;
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function rouletteNumber(value, label) {
  if (!Number.isInteger(value) || value < 0 || value >= NUMBER_COUNT) {
    throw new RangeError(`${label} must be an integer from 0 through 36`);
  }
  return value;
}

function isoTimestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO timestamp`);
  }
  return new Date(value).toISOString();
}

function jsonValue(value, label, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
    return value;
  }
  if (typeof value !== "object" || value === undefined) {
    throw new TypeError(`${label} must be JSON-safe`);
  }
  if (seen.has(value)) throw new TypeError(`${label} must not be cyclic`);
  seen.add(value);
  let output;
  if (Array.isArray(value)) {
    output = value.map((item, index) => jsonValue(item, `${label}[${index}]`, seen));
  } else {
    if (!isPlainObject(value)) throw new TypeError(`${label} must be a JSON object`);
    output = Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      jsonValue(item, `${label}.${key}`, seen),
    ]));
  }
  seen.delete(value);
  return output;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function normalizeDistribution(value, label) {
  if (!Array.isArray(value) || value.length !== NUMBER_COUNT) {
    throw new TypeError(`${label} must contain 37 masses`);
  }
  const distribution = value.map((mass, index) => {
    if (!Number.isFinite(mass) || mass < 0 || mass > 1) {
      throw new RangeError(`${label}[${index}] must be between zero and one`);
    }
    return mass;
  });
  const total = distribution.reduce((sum, mass) => sum + mass, 0);
  if (!closeEnough(total, 1)) throw new RangeError(`${label} must sum to one`);
  return distribution.map((mass) => mass / total);
}

function sameDistribution(left, right, tolerance = EPSILON) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === NUMBER_COUNT
    && right.length === NUMBER_COUNT
    && left.every((mass, index) => (
      Number.isFinite(mass)
      && Number.isFinite(right[index])
      && closeEnough(mass, right[index], tolerance)
    ));
}

function sameJsonValue(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => sameJsonValue(value, right[index]));
  }
  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => (
        key === rightKeys[index] && sameJsonValue(left[key], right[key])
      ));
  }
  return false;
}

function sameSourceManifests(left, right) {
  const sourceKeys = ["id", "family", "mode", "numbers", "weights", "cursor"];
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((source, index) => {
      const expected = right[index];
      const weightsMatch = source?.weights === null || expected?.weights === null
        ? source?.weights === expected?.weights
        : Array.isArray(source?.weights)
          && Array.isArray(expected?.weights)
          && source.weights.length === expected.weights.length
          && source.weights.every((weight, weightIndex) => (
            closeEnough(weight, expected.weights[weightIndex], EPSILON)
          ));
      return hasExactKeys(source, sourceKeys)
        && source.id === expected?.id
        && source.family === expected?.family
        && source.mode === expected?.mode
        && sameJsonValue(source.numbers, expected?.numbers)
        && weightsMatch
        && sameJsonValue(source.cursor, expected?.cursor);
    });
}

function weightedMix(primary, secondary, primaryShare) {
  return normalizeDistribution(primary.map((mass, index) => (
    primaryShare * mass + (1 - primaryShare) * secondary[index]
  )), "mixed distribution");
}

function sourceDistribution(source) {
  const output = Array(NUMBER_COUNT).fill(0);
  source.numbers.forEach((number, index) => {
    output[number] = source.weights !== null
      ? source.weights[index]
      : source.mode === "set"
        ? 1 / source.numbers.length
        : (2 * (source.numbers.length - index))
          / (source.numbers.length * (source.numbers.length + 1));
  });
  return normalizeDistribution(output, `source ${source.id}`);
}

function normalizeSource(value, index) {
  if (!isPlainObject(value)) throw new TypeError(`sources[${index}] must be an object`);
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const family = typeof value.family === "string" ? value.family.trim() : "";
  const mode = value.mode === undefined ? "ranking" : value.mode;
  if (
    id === ""
    || !LEARNED_LEADER_V6_FAMILIES.includes(family)
    || !["ranking", "set"].includes(mode)
    || !Array.isArray(value.numbers)
    || value.numbers.length < 1
    || value.numbers.length > NUMBER_COUNT
  ) {
    throw new TypeError(`sources[${index}] has an invalid identity or shape`);
  }
  const numbers = value.numbers.map((number, numberIndex) => (
    rouletteNumber(number, `sources[${index}].numbers[${numberIndex}]`)
  ));
  if (new Set(numbers).size !== numbers.length) {
    throw new TypeError(`sources[${index}].numbers must be unique`);
  }
  if (mode === "set") numbers.sort((left, right) => left - right);

  let weights = null;
  if (value.weights !== undefined && value.weights !== null) {
    if (mode !== "ranking" || !Array.isArray(value.weights)
      || value.weights.length !== numbers.length) {
      throw new TypeError(`sources[${index}].weights does not match its ranking`);
    }
    weights = value.weights.map((weight, weightIndex) => {
      if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
        throw new RangeError(
          `sources[${index}].weights[${weightIndex}] must be between zero and one`,
        );
      }
      return weight;
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (!closeEnough(total, 1)) {
      throw new RangeError(`sources[${index}].weights must sum to one`);
    }
    weights = weights.map((weight) => weight / total);
  }

  const cursor = value.cursor == null
    ? null
    : jsonValue(value.cursor, `sources[${index}].cursor`);
  if (cursor !== null && !isPlainObject(cursor)) {
    throw new TypeError(`sources[${index}].cursor must be a JSON object`);
  }
  return { id, family, mode, numbers, weights, cursor };
}

function sourceKind(source) {
  const id = source.id.toLowerCase();
  if (source.family === "price") return "price";
  if (id.includes("live-fixed") || id.includes("live_fixed")) return "live-fixed";
  if (id.includes("triple")) return "triple";
  if (id.includes("pair")) return "pair";
  return "unknown-conditional";
}

function evidenceSize(source, label) {
  const sampleSize = source.cursor?.sampleSize;
  if (sampleSize === undefined || sampleSize === null) {
    return { sampleSize: 0, effectiveSampleSize: 0 };
  }
  if (!Number.isSafeInteger(sampleSize) || sampleSize < 0) {
    throw new RangeError(`${label}.cursor.sampleSize must be a non-negative integer`);
  }
  const suppliedEffective = source.cursor?.effectiveSampleSize;
  if (suppliedEffective === undefined || suppliedEffective === null) {
    return { sampleSize, effectiveSampleSize: sampleSize };
  }
  if (!Number.isFinite(suppliedEffective)
    || suppliedEffective < 0
    || suppliedEffective > sampleSize) {
    throw new RangeError(
      `${label}.cursor.effectiveSampleSize must be between zero and sampleSize`,
    );
  }
  return { sampleSize, effectiveSampleSize: suppliedEffective };
}

function isSmoothedPriceSource(source) {
  const marker = source.cursor?.massKind ?? source.cursor?.distributionKind;
  return marker === "smoothed" || source.id.toLowerCase().includes("smoothed");
}

function priceEvidenceCandidateCount(source) {
  const value = source.cursor?.evidenceCandidateCount;
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > NUMBER_COUNT) {
    throw new RangeError(
      `source ${source.id}.cursor.evidenceCandidateCount must be from zero through 37`,
    );
  }
  return value;
}

function pricePriority(source) {
  return (isSmoothedPriceSource(source) ? 10_000 : 0)
    + (source.weights !== null ? 1_000 : 0)
    + (source.mode === "set" ? 100 : 0)
    + (source.numbers.length === NUMBER_COUNT ? 50 : 0)
    + (source.id.toLowerCase().includes("rank37") ? 25 : 0)
    + source.numbers.length / 100;
}

function distributionKey(distribution) {
  return JSON.stringify(distribution);
}

function choosePriceSource(sources) {
  if (sources.length === 0) return null;
  const candidates = sources.map((source) => ({
    source,
    distribution: sourceDistribution(source),
  })).sort((left, right) => (
    pricePriority(right.source) - pricePriority(left.source)
    || left.source.id.localeCompare(right.source.id)
  ));
  return candidates[0];
}

function chooseConditionalSource(sources, kind) {
  const candidates = sources.filter((source) => sourceKind(source) === kind)
    .map((source) => ({
      source,
      distribution: sourceDistribution(source),
      ...evidenceSize(source, `source ${source.id}`),
    }))
    .filter(({ effectiveSampleSize }) => effectiveSampleSize > 0)
    .sort((left, right) => (
      right.effectiveSampleSize - left.effectiveSampleSize
      || right.sampleSize - left.sampleSize
      || left.source.id.localeCompare(right.source.id)
    ));
  return candidates[0] ?? null;
}

function auditSources(sources, price, pair, triple) {
  const selected = new Map([
    [price?.source.id, "price-primary"],
    [pair?.source.id, "pair-primary"],
    [triple?.source.id, "triple-primary"],
  ].filter(([id]) => id !== undefined));
  const selectedDistributions = new Map([
    [price?.source.id, price?.distribution],
    [pair?.source.id, pair?.distribution],
    [triple?.source.id, triple?.distribution],
  ].filter(([id]) => id !== undefined));

  return sources.map((source) => {
    const kind = sourceKind(source);
    const selectedRole = selected.get(source.id);
    let sampleSize = null;
    let effectiveSampleSize = null;
    if (["pair", "triple"].includes(kind)) {
      ({ sampleSize, effectiveSampleSize } = evidenceSize(source, `source ${source.id}`));
    }
    if (selectedRole) {
      return {
        id: source.id,
        family: source.family,
        kind,
        used: true,
        role: selectedRole,
        reason: "selected",
        sampleSize,
        effectiveSampleSize,
      };
    }
    const ownDistribution = kind === "live-fixed" || kind === "unknown-conditional"
      ? null
      : sourceDistribution(source);
    const sameKindSelected = [price, pair, triple].find((candidate) => (
      candidate && sourceKind(candidate.source) === kind
    ));
    const duplicate = ownDistribution && sameKindSelected
      && distributionKey(ownDistribution) === distributionKey(
        selectedDistributions.get(sameKindSelected.source.id),
      );
    return {
      id: source.id,
      family: source.family,
      kind,
      used: false,
      role: "ignored",
      reason: kind === "live-fixed"
        ? "derived_live_vote"
        : kind === "unknown-conditional"
          ? "unknown_conditional_shape"
          : duplicate
            ? "duplicate_distribution"
            : "lower_reliability_source",
      sampleSize,
      effectiveSampleSize,
    };
  });
}

export function buildLearnedLeaderV6Families(value) {
  if (!Array.isArray(value)) throw new TypeError("sources must be an array");
  const sources = value.map(normalizeSource)
    .sort((left, right) => left.id.localeCompare(right.id));
  const ids = new Set();
  for (const source of sources) {
    if (ids.has(source.id)) throw new TypeError(`duplicate source id ${source.id}`);
    ids.add(source.id);
  }

  const price = choosePriceSource(sources.filter((source) => source.family === "price"));
  const pair = chooseConditionalSource(sources, "pair");
  const triple = chooseConditionalSource(sources, "triple");
  const familyDistributions = {};
  const familyReliability = {};
  const evidence = {
    price: null,
    conditionalHistory: null,
  };

  if (price) {
    const uniformMix = isSmoothedPriceSource(price.source)
      ? LEARNED_LEADER_V6_DEFAULTS.smoothedPriceUniformMix
      : LEARNED_LEADER_V6_DEFAULTS.priceUniformMix;
    familyDistributions.price = weightedMix(price.distribution, UNIFORM, 1 - uniformMix);
    familyReliability.price = 1;
    evidence.price = {
      sourceId: price.source.id,
      inputKind: price.source.weights !== null ? "explicit-weights" : price.source.mode,
      uniformMix,
      evidenceCandidateCount: priceEvidenceCandidateCount(price.source),
    };
  }

  const pairEffective = pair?.effectiveSampleSize ?? 0;
  const tripleEffective = triple?.effectiveSampleSize ?? 0;
  if (pairEffective > 0 || tripleEffective > 0) {
    const pairReliability = pairEffective
      / (pairEffective + LEARNED_LEADER_V6_DEFAULTS.pairPriorStrength);
    const pairPosterior = pairEffective > 0
      ? weightedMix(pair.distribution, UNIFORM, pairReliability)
      : [...UNIFORM];
    const tripleReliability = tripleEffective
      / (tripleEffective + LEARNED_LEADER_V6_DEFAULTS.tripleBackoffStrength);
    const history = tripleEffective > 0
      ? weightedMix(triple.distribution, pairPosterior, tripleReliability)
      : pairPosterior;
    familyDistributions["conditional-history"] = history;
    familyReliability["conditional-history"] = pairReliability
      + (1 - pairReliability) * tripleReliability;
    evidence.conditionalHistory = {
      pairSourceId: pair?.source.id ?? null,
      pairSampleSize: pair?.sampleSize ?? 0,
      pairEffectiveSampleSize: pairEffective,
      pairReliability,
      tripleSourceId: triple?.source.id ?? null,
      tripleSampleSize: triple?.sampleSize ?? 0,
      tripleEffectiveSampleSize: tripleEffective,
      tripleReliability,
      backoff: tripleEffective > 0 ? "triple-to-smoothed-pair" : "pair-to-uniform",
    };
  }

  return deepFreeze({
    sourceManifest: sources.map((source) => ({
      ...source,
      numbers: [...source.numbers],
      weights: source.weights === null ? null : [...source.weights],
      cursor: source.cursor === null ? null : jsonValue(source.cursor, "cursor"),
    })),
    sourceAudit: auditSources(sources, price, pair, triple),
    familyDistributions,
    familyReliability,
    evidence,
  });
}

export function learnedLeaderV6BrierLoss(distribution, actualNumber) {
  const safe = normalizeDistribution(distribution, "distribution");
  const actual = rouletteNumber(actualNumber, "actualNumber");
  return safe.reduce((loss, mass, number) => (
    loss + (mass - (number === actual ? 1 : 0)) ** 2
  ), 0) / 2;
}

function sigmoid(value) {
  return value >= 0
    ? 1 / (1 + Math.exp(-value))
    : Math.exp(value) / (1 + Math.exp(value));
}

function logit(value) {
  return Math.log(value / (1 - value));
}

function normalizeLearningRow(value, index, cutoffMs) {
  if (!isPlainObject(value)) {
    throw new TypeError(`learningRows[${index}] must be an object`);
  }
  const id = String(value.id ?? value.forecastId ?? "").trim();
  if (id === "") throw new TypeError(`learningRows[${index}].id is required`);
  const lockedAt = isoTimestamp(value.lockedAt, `learningRows[${index}].lockedAt`);
  const completedAt = isoTimestamp(
    value.completedAt,
    `learningRows[${index}].completedAt`,
  );
  if (Date.parse(completedAt) < Date.parse(lockedAt)) {
    throw new RangeError(`learningRows[${index}] completed before it was locked`);
  }
  const actualNumber = rouletteNumber(
    value.actualNumber,
    `learningRows[${index}].actualNumber`,
  );
  if (!isPlainObject(value.familyDistributions)) {
    throw new TypeError(`learningRows[${index}].familyDistributions is invalid`);
  }
  const familyDistributions = {};
  for (const family of LEARNED_LEADER_V6_FAMILIES) {
    if (value.familyDistributions[family] !== undefined) {
      familyDistributions[family] = normalizeDistribution(
        value.familyDistributions[family],
        `learningRows[${index}].familyDistributions.${family}`,
      );
    }
  }
  return {
    id,
    lockedAt,
    completedAt,
    actualNumber,
    familyDistributions,
    incompatibleAlgorithm: value.algorithmVersion !== undefined
      && value.algorithmVersion !== LEARNED_LEADER_V6_ALGORITHM_VERSION,
    excludedNotPast: Date.parse(completedAt) >= cutoffMs,
  };
}

export function learnLeaderV6FamilyWeights(value, currentLockedAt) {
  if (!Array.isArray(value)) throw new TypeError("learningRows must be an array");
  const cutoffAt = isoTimestamp(currentLockedAt, "currentLockedAt");
  const cutoffMs = Date.parse(cutoffAt);
  const rows = value.map((row, index) => normalizeLearningRow(row, index, cutoffMs));
  const ids = new Set();
  for (const row of rows) {
    if (ids.has(row.id)) throw new TypeError(`duplicate learning row ${row.id}`);
    ids.add(row.id);
  }
  const eligible = rows.filter((row) => !row.excludedNotPast && !row.incompatibleAlgorithm)
    .sort((left, right) => (
      Date.parse(left.completedAt) - Date.parse(right.completedAt)
      || Date.parse(left.lockedAt) - Date.parse(right.lockedAt)
      || left.id.localeCompare(right.id)
    ));

  const parameters = { ...LEARNED_LEADER_V6_DEFAULTS };
  const priorLogOdds = logit(parameters.staticPriceWeight);
  let rawLogOdds = priorLogOdds;
  let effectiveCount = 0;
  let trainingCount = 0;
  let skippedIncompleteFamilyCount = 0;
  let lastTrainingCompletedAt = null;
  let trainingThroughId = null;
  for (const row of eligible) {
    const price = row.familyDistributions.price;
    const history = row.familyDistributions["conditional-history"];
    if (!price || !history) {
      skippedIncompleteFamilyCount += 1;
      continue;
    }
    const priceLoss = learnedLeaderV6BrierLoss(price, row.actualNumber);
    const historyLoss = learnedLeaderV6BrierLoss(history, row.actualNumber);
    const eta = parameters.eta
      / Math.sqrt(1 + trainingCount / parameters.etaScale);
    rawLogOdds = priorLogOdds
      + parameters.decay * (rawLogOdds - priorLogOdds)
      - eta * (priceLoss - historyLoss);
    effectiveCount = parameters.decay * effectiveCount + 1;
    trainingCount += 1;
    lastTrainingCompletedAt = row.completedAt;
    trainingThroughId = row.id;
  }
  const shrinkage = effectiveCount
    / (effectiveCount + parameters.learningShrinkageCount);
  const regularizedLogOdds = priorLogOdds
    + shrinkage * (rawLogOdds - priorLogOdds);
  const priceWeight = Math.max(
    parameters.minimumPriceWeight,
    Math.min(parameters.maximumPriceWeight, sigmoid(regularizedLogOdds)),
  );
  const familyWeights = {
    price: priceWeight,
    "conditional-history": 1 - priceWeight,
  };
  return deepFreeze({
    version: LEARNED_LEADER_V6_LEARNING_VERSION,
    parameters,
    status: trainingCount < parameters.minimumAdaptiveTrainingCount
      ? "regularized_static"
      : "adaptive",
    trainingCount,
    eligibleRowCount: eligible.length,
    skippedIncompleteFamilyCount,
    skippedAlgorithmCount: rows.filter((row) => row.incompatibleAlgorithm).length,
    excludedNotPastCount: rows.filter((row) => row.excludedNotPast).length,
    effectiveCount,
    priorLogOdds,
    rawLogOdds,
    regularizedLogOdds,
    shrinkage,
    familyWeights,
    learningCutoffAt: cutoffAt,
    lastTrainingCompletedAt,
    trainingThroughId,
  });
}

function hash32(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function tiePosition(number, seed) {
  const offset = hash32(`${seed}:offset`) % NUMBER_COUNT;
  const step = (hash32(`${seed}:step`) % (NUMBER_COUNT - 1)) + 1;
  return ((number - offset + NUMBER_COUNT) * (() => {
    for (let inverse = 1; inverse < NUMBER_COUNT; inverse += 1) {
      if ((step * inverse) % NUMBER_COUNT === 1) return inverse;
    }
    return 1;
  })()) % NUMBER_COUNT;
}

function rankDistribution(distribution, familyDistributions, tieSeed) {
  return distribution.map((mass, number) => ({
    number,
    mass,
    familySupportCount: Object.values(familyDistributions).reduce((count, family) => (
      count + (family[number] > EPSILON ? 1 : 0)
    ), 0),
  })).sort((left, right) => (
    !closeEnough(left.mass, right.mass, EPSILON)
      ? right.mass - left.mass
      : left.familySupportCount !== right.familySupportCount
        ? right.familySupportCount - left.familySupportCount
        : tiePosition(left.number, tieSeed) - tiePosition(right.number, tieSeed)
  )).map((candidate, index) => ({ rank: index + 1, ...candidate }));
}

function actualFamilyWeights(familyDistributions, familyReliability, learning) {
  const hasPrice = familyDistributions.price !== undefined;
  const hasHistory = familyDistributions["conditional-history"] !== undefined;
  if (hasPrice && hasHistory) {
    const historyWeight = learning.familyWeights["conditional-history"]
      * familyReliability["conditional-history"];
    return {
      price: 1 - historyWeight,
      "conditional-history": historyWeight,
    };
  }
  if (hasPrice) return { price: 1 };
  if (hasHistory) return { "conditional-history": 1 };
  return {};
}

function selectiveGate({ evidence, familyDistributions, margin }) {
  const parameters = {
    minimumPriceEvidenceCandidates:
      LEARNED_LEADER_V6_DEFAULTS.minimumSelectivePriceEvidenceCandidates,
    minimumPairEffectiveSampleSize:
      LEARNED_LEADER_V6_DEFAULTS.minimumSelectivePairEffectiveSampleSize,
    minimumMargin: LEARNED_LEADER_V6_DEFAULTS.minimumSelectiveMargin,
  };
  const signals = {
    hasPrice: familyDistributions.price !== undefined,
    hasConditionalHistory:
      familyDistributions["conditional-history"] !== undefined,
    priceEvidenceCandidateCount:
      evidence.price?.evidenceCandidateCount ?? null,
    pairEffectiveSampleSize:
      evidence.conditionalHistory?.pairEffectiveSampleSize ?? 0,
    margin,
  };
  const reasons = [];
  if (!signals.hasPrice) reasons.push("price_unavailable");
  if (!signals.hasConditionalHistory) reasons.push("history_unavailable");
  if (
    signals.priceEvidenceCandidateCount === null
    || signals.priceEvidenceCandidateCount
      < parameters.minimumPriceEvidenceCandidates
  ) reasons.push("weak_price_evidence");
  if (
    signals.pairEffectiveSampleSize
      < parameters.minimumPairEffectiveSampleSize
  ) reasons.push("sparse_pair_history");
  if (!(margin >= parameters.minimumMargin)) reasons.push("small_margin");
  return {
    version: "prelock-quality-gate-v1",
    eligible: reasons.length === 0,
    reason: reasons.length === 0 ? "eligible" : reasons[0],
    reasons,
    parameters,
    signals,
  };
}

export function buildLearnedLeaderV6Decision({
  sources,
  learningRows = [],
  lockedAt,
  tieSeed,
}) {
  const cutoffAt = isoTimestamp(lockedAt, "lockedAt");
  const safeTieSeed = String(tieSeed ?? "").trim();
  if (safeTieSeed === "") throw new TypeError("tieSeed is required");
  const families = buildLearnedLeaderV6Families(sources);
  if (families.sourceManifest.some((source) => (
    !isPlainObject(source.cursor) || source.cursor.cutoffAt !== cutoffAt
  ))) {
    throw new RangeError("every source cursor cutoffAt must equal lockedAt");
  }
  const learning = learnLeaderV6FamilyWeights(learningRows, cutoffAt);
  const familyIds = LEARNED_LEADER_V6_FAMILIES.filter(
    (family) => families.familyDistributions[family] !== undefined,
  );
  const common = {
    schemaVersion: LEARNED_LEADER_V6_SCHEMA_VERSION,
    algorithmVersion: LEARNED_LEADER_V6_ALGORITHM_VERSION,
    shadow: true,
    lockedAt: cutoffAt,
    tieSeed: safeTieSeed,
    sourceManifest: families.sourceManifest,
    sourceAudit: families.sourceAudit,
    familyDistributions: families.familyDistributions,
    familyReliability: families.familyReliability,
    evidence: families.evidence,
    learning,
    sourceCount: families.sourceManifest.length,
    usedSourceCount: families.sourceAudit.filter(({ used }) => used).length,
    familyCount: familyIds.length,
  };
  if (familyIds.length === 0) {
    return deepFreeze({
      ...common,
      status: "unavailable",
      reason: "no_reliable_family",
      familyWeights: {},
      combinedDistribution: [],
      ranking: [],
      leaderNumber: null,
      leaderMass: null,
      runnerUpMass: null,
      margin: null,
      tieCount: 0,
      tieBreakApplied: false,
      selection: selectiveGate({
        evidence: families.evidence,
        familyDistributions: families.familyDistributions,
        margin: null,
      }),
    });
  }
  const familyWeights = actualFamilyWeights(
    families.familyDistributions,
    families.familyReliability,
    learning,
  );
  const combined = Array(NUMBER_COUNT).fill(0);
  for (const family of familyIds) {
    families.familyDistributions[family].forEach((mass, number) => {
      combined[number] += familyWeights[family] * mass;
    });
  }
  const combinedDistribution = normalizeDistribution(combined, "combinedDistribution");
  const ranking = rankDistribution(
    combinedDistribution,
    families.familyDistributions,
    `${LEARNED_LEADER_V6_ALGORITHM_VERSION}:${safeTieSeed}`,
  );
  const maximumMass = ranking[0].mass;
  const bestSupport = Math.max(...ranking
    .filter(({ mass }) => closeEnough(mass, maximumMass, EPSILON))
    .map(({ familySupportCount }) => familySupportCount));
  const tieCount = ranking.filter(({ mass, familySupportCount }) => (
    closeEnough(mass, maximumMass, EPSILON) && familySupportCount === bestSupport
  )).length;
  const margin = ranking[0].mass - ranking[1].mass;
  return deepFreeze({
    ...common,
    status: "ready",
    reason: learning.status,
    familyWeights,
    combinedDistribution,
    ranking,
    leaderNumber: ranking[0].number,
    leaderMass: ranking[0].mass,
    runnerUpMass: ranking[1].mass,
    margin,
    tieCount,
    tieBreakApplied: tieCount > 1,
    selection: selectiveGate({
      evidence: families.evidence,
      familyDistributions: families.familyDistributions,
      margin,
    }),
  });
}

function sameObjectDistributions(left, right) {
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index] && sameDistribution(left[key], right[key])
    ));
}

function validLearning(value, lockedAt) {
  if (!isPlainObject(value)
    || value.version !== LEARNED_LEADER_V6_LEARNING_VERSION
    || !["regularized_static", "adaptive"].includes(value.status)
    || value.learningCutoffAt !== lockedAt
    || !isPlainObject(value.parameters)
    || Object.keys(value.parameters).length
      !== Object.keys(LEARNED_LEADER_V6_DEFAULTS).length
    || Object.keys(LEARNED_LEADER_V6_DEFAULTS).some(
      (key) => value.parameters[key] !== LEARNED_LEADER_V6_DEFAULTS[key],
    )
    || !hasExactKeys(value.familyWeights, LEARNED_LEADER_V6_FAMILIES)
  ) return false;
  const integerFields = [
    "trainingCount",
    "eligibleRowCount",
    "skippedIncompleteFamilyCount",
    "skippedAlgorithmCount",
    "excludedNotPastCount",
  ];
  if (integerFields.some((field) => !Number.isSafeInteger(value[field]) || value[field] < 0)) {
    return false;
  }
  if (value.trainingCount + value.skippedIncompleteFamilyCount !== value.eligibleRowCount
    || !Number.isFinite(value.effectiveCount)
    || value.effectiveCount < 0
    || value.effectiveCount > value.trainingCount + EPSILON
    || !Number.isFinite(value.priorLogOdds)
    || !Number.isFinite(value.rawLogOdds)
    || !Number.isFinite(value.regularizedLogOdds)
    || !Number.isFinite(value.shrinkage)) return false;
  const expectedPrior = logit(LEARNED_LEADER_V6_DEFAULTS.staticPriceWeight);
  const expectedShrinkage = value.effectiveCount
    / (value.effectiveCount + LEARNED_LEADER_V6_DEFAULTS.learningShrinkageCount);
  const expectedRegularized = expectedPrior
    + expectedShrinkage * (value.rawLogOdds - expectedPrior);
  const expectedPrice = Math.max(
    LEARNED_LEADER_V6_DEFAULTS.minimumPriceWeight,
    Math.min(LEARNED_LEADER_V6_DEFAULTS.maximumPriceWeight, sigmoid(expectedRegularized)),
  );
  if (!closeEnough(value.priorLogOdds, expectedPrior, EPSILON)
    || !closeEnough(value.shrinkage, expectedShrinkage, EPSILON)
    || !closeEnough(value.regularizedLogOdds, expectedRegularized, EPSILON)
    || value.status !== (
      value.trainingCount
        < LEARNED_LEADER_V6_DEFAULTS.minimumAdaptiveTrainingCount
        ? "regularized_static"
        : "adaptive"
    )
    || !isPlainObject(value.familyWeights)
    || !closeEnough(value.familyWeights.price, expectedPrice, EPSILON)
    || !closeEnough(value.familyWeights["conditional-history"], 1 - expectedPrice, EPSILON)) {
    return false;
  }
  if (value.trainingCount === 0) {
    return value.trainingThroughId === null
      && value.lastTrainingCompletedAt === null
      && closeEnough(value.rawLogOdds, expectedPrior, EPSILON)
      && closeEnough(value.effectiveCount, 0, EPSILON);
  }
  return typeof value.trainingThroughId === "string"
    && value.trainingThroughId !== ""
    && typeof value.lastTrainingCompletedAt === "string"
    && Number.isFinite(Date.parse(value.lastTrainingCompletedAt))
    && Date.parse(value.lastTrainingCompletedAt) < Date.parse(lockedAt);
}

export function normalizeLearnedLeaderV6Decision(value) {
  try {
    if (!isPlainObject(value)
      || value.schemaVersion !== LEARNED_LEADER_V6_SCHEMA_VERSION
      || value.algorithmVersion !== LEARNED_LEADER_V6_ALGORITHM_VERSION
      || value.shadow !== true
      || !["ready", "unavailable"].includes(value.status)
      || !Array.isArray(value.sourceManifest)) return null;
    const lockedAt = isoTimestamp(value.lockedAt, "lockedAt");
    const tieSeed = String(value.tieSeed ?? "").trim();
    if (
      value.lockedAt !== lockedAt
      || value.tieSeed !== tieSeed
      || tieSeed === ""
      || !validLearning(value.learning, lockedAt)
    ) return null;
    const rebuilt = buildLearnedLeaderV6Families(value.sourceManifest);
    if (!sameSourceManifests(value.sourceManifest, rebuilt.sourceManifest)
      || rebuilt.sourceManifest.some((source) => (
        !isPlainObject(source.cursor) || source.cursor.cutoffAt !== lockedAt
      ))
      || !sameObjectDistributions(rebuilt.familyDistributions, value.familyDistributions)
      || JSON.stringify(rebuilt.familyReliability) !== JSON.stringify(value.familyReliability)
      || JSON.stringify(rebuilt.evidence) !== JSON.stringify(value.evidence)
      || JSON.stringify(rebuilt.sourceAudit) !== JSON.stringify(value.sourceAudit)
      || value.sourceCount !== rebuilt.sourceManifest.length
      || value.usedSourceCount !== rebuilt.sourceAudit.filter(({ used }) => used).length) {
      return null;
    }
    const familyIds = LEARNED_LEADER_V6_FAMILIES.filter(
      (family) => rebuilt.familyDistributions[family] !== undefined,
    );
    if (value.familyCount !== familyIds.length) return null;
    if (familyIds.length === 0) {
      if (value.status !== "unavailable"
        || value.reason !== "no_reliable_family"
        || JSON.stringify(value.familyWeights) !== "{}"
        || !Array.isArray(value.combinedDistribution)
        || value.combinedDistribution.length !== 0
        || !Array.isArray(value.ranking)
        || value.ranking.length !== 0
        || value.leaderNumber !== null
        || value.leaderMass !== null
        || value.runnerUpMass !== null
        || value.margin !== null
        || value.tieCount !== 0
        || value.tieBreakApplied !== false
        || JSON.stringify(value.selection) !== JSON.stringify(selectiveGate({
          evidence: rebuilt.evidence,
          familyDistributions: rebuilt.familyDistributions,
          margin: null,
        }))) return null;
      return deepFreeze(jsonValue(value, "decision"));
    }
    if (value.status !== "ready" || value.reason !== value.learning.status) return null;
    const expectedWeights = actualFamilyWeights(
      rebuilt.familyDistributions,
      rebuilt.familyReliability,
      value.learning,
    );
    if (JSON.stringify(expectedWeights) !== JSON.stringify(value.familyWeights)) return null;
    const combined = Array(NUMBER_COUNT).fill(0);
    for (const family of familyIds) {
      rebuilt.familyDistributions[family].forEach((mass, number) => {
        combined[number] += expectedWeights[family] * mass;
      });
    }
    const normalizedCombined = normalizeDistribution(combined, "combinedDistribution");
    if (!sameDistribution(normalizedCombined, value.combinedDistribution)) return null;
    const ranking = rankDistribution(
      normalizedCombined,
      rebuilt.familyDistributions,
      `${LEARNED_LEADER_V6_ALGORITHM_VERSION}:${tieSeed}`,
    );
    if (!Array.isArray(value.ranking)
      || value.ranking.length !== NUMBER_COUNT
      || ranking.some((candidate, index) => (
        candidate.rank !== value.ranking[index]?.rank
        || candidate.number !== value.ranking[index]?.number
        || candidate.familySupportCount !== value.ranking[index]?.familySupportCount
        || !closeEnough(candidate.mass, value.ranking[index]?.mass, EPSILON)
      ))) return null;
    const maximumMass = ranking[0].mass;
    const bestSupport = Math.max(...ranking
      .filter(({ mass }) => closeEnough(mass, maximumMass, EPSILON))
      .map(({ familySupportCount }) => familySupportCount));
    const tieCount = ranking.filter(({ mass, familySupportCount }) => (
      closeEnough(mass, maximumMass, EPSILON) && familySupportCount === bestSupport
    )).length;
    const margin = ranking[0].mass - ranking[1].mass;
    if (value.leaderNumber !== ranking[0].number
      || !closeEnough(value.leaderMass, ranking[0].mass, EPSILON)
      || !closeEnough(value.runnerUpMass, ranking[1].mass, EPSILON)
      || !closeEnough(value.margin, margin, EPSILON)
      || value.tieCount !== tieCount
      || value.tieBreakApplied !== (tieCount > 1)
      || JSON.stringify(value.selection) !== JSON.stringify(selectiveGate({
        evidence: rebuilt.evidence,
        familyDistributions: rebuilt.familyDistributions,
        margin,
      }))) return null;
    return deepFreeze(jsonValue(value, "decision"));
  } catch {
    return null;
  }
}

export function evaluateLearnedLeaderV6Decision(value, actualNumber) {
  const decision = normalizeLearnedLeaderV6Decision(value);
  if (!decision || decision.status !== "ready") {
    throw new TypeError("decision must be a valid ready v6 shadow snapshot");
  }
  const actual = rouletteNumber(actualNumber, "actualNumber");
  const clippedLogLoss = (distribution) => (
    -Math.log(Math.max(LOG_LOSS_FLOOR, distribution[actual]))
  );
  const familyEvaluations = Object.fromEntries(
    Object.entries(decision.familyDistributions).map(([family, distribution]) => {
      const ranking = rankDistribution(
        distribution,
        { [family]: distribution },
        `${LEARNED_LEADER_V6_ALGORITHM_VERSION}:${decision.tieSeed}:${family}`,
      );
      return [family, {
        top1Number: ranking[0].number,
        top1Hit: ranking[0].number === actual,
        top3Numbers: ranking.slice(0, 3).map(({ number }) => number),
        top3Hit: ranking.slice(0, 3).some(({ number }) => number === actual),
        brierLoss: learnedLeaderV6BrierLoss(distribution, actual),
        clippedLogLoss: clippedLogLoss(distribution),
      }];
    }),
  );
  return deepFreeze({
    actualNumber: actual,
    top1Hit: decision.leaderNumber === actual,
    top3Hit: decision.ranking.slice(0, 3).some(({ number }) => number === actual),
    combinedBrierLoss: learnedLeaderV6BrierLoss(decision.combinedDistribution, actual),
    combinedClippedLogLoss: clippedLogLoss(decision.combinedDistribution),
    uniformBrierLoss: LEARNED_LEADER_V6_UNIFORM_BRIER_LOSS,
    familyLosses: Object.fromEntries(Object.entries(decision.familyDistributions)
      .map(([family, distribution]) => [
        family,
        learnedLeaderV6BrierLoss(distribution, actual),
      ])),
    familyEvaluations,
    selected: decision.selection.eligible,
  });
}
