export const LEARNED_LEADER_SCHEMA_VERSION = 1;
export const LEARNED_LEADER_ALGORITHM_VERSION =
  "learned-predictive-family-index-v5";
export const LEARNED_LEADER_LEARNING_VERSION =
  "family-brier-logodds-v1";

export const LEARNED_LEADER_FAMILIES = Object.freeze([
  "price",
  "conditional-history",
]);

export const LEARNED_LEADER_DEFAULTS = Object.freeze({
  decay: 0.995,
  eta: 0.35,
  etaScale: 100,
  shrinkageCount: 30,
  minimumFamilyWeight: 0.15,
  maximumAbsoluteLogOdds: 4,
  minimumAdaptiveTrainingCount: 30,
  learningLimit: 500,
});

export const LEARNED_LEADER_UNIFORM_BRIER_LOSS = 18 / 37;

const SCORE_EPSILON = 1e-12;
const SUM_TOLERANCE = 1e-9;
const ROULETTE_NUMBER_COUNT = 37;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rouletteNumber(value, label) {
  if (
    typeof value !== "number"
    || !Number.isInteger(value)
    || value < 0
    || value >= ROULETTE_NUMBER_COUNT
  ) {
    throw new RangeError(`${label} must be an integer from 0 through 36`);
  }
  return value;
}

function timestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO timestamp`);
  }
  return new Date(value).toISOString();
}

function closeEnough(left, right, tolerance = SUM_TOLERANCE) {
  return Math.abs(left - right) <= tolerance;
}

function normalizedJsonValue(value, label, seen) {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
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
  let normalized;
  if (Array.isArray(value)) {
    normalized = value.map((item, index) => (
      normalizedJsonValue(item, `${label}[${index}]`, seen)
    ));
  } else {
    if (!isPlainObject(value)) throw new TypeError(`${label} must be a JSON object`);
    normalized = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        normalizedJsonValue(item, `${label}.${key}`, seen),
      ]),
    );
  }
  seen.delete(value);
  return normalized;
}

function jsonSafeClone(value, label) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a JSON object`);
  return normalizedJsonValue(value, label, new Set());
}

function sameNumberArray(left, right, tolerance = SCORE_EPSILON) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => (
      Number.isFinite(value)
      && Number.isFinite(right[index])
      && Math.abs(value - right[index]) <= tolerance
    ));
}

function normalizedDistribution(value, label) {
  if (!Array.isArray(value) || value.length !== ROULETTE_NUMBER_COUNT) {
    throw new TypeError(`${label} must contain 37 masses`);
  }
  const distribution = value.map((mass, index) => {
    if (typeof mass !== "number" || !Number.isFinite(mass) || mass < 0 || mass > 1) {
      throw new RangeError(`${label}[${index}] must be between zero and one`);
    }
    return mass;
  });
  const total = distribution.reduce((sum, mass) => sum + mass, 0);
  if (!closeEnough(total, 1)) {
    throw new RangeError(`${label} must sum to one`);
  }
  return distribution.map((mass) => mass / total);
}

function normalizedSource(value, index) {
  if (!isPlainObject(value)) {
    throw new TypeError(`sources[${index}] must be an object`);
  }
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const family = typeof value.family === "string" ? value.family.trim() : "";
  const mode = value.mode === undefined ? "ranking" : value.mode;
  if (
    id === ""
    || !LEARNED_LEADER_FAMILIES.includes(family)
    || !["ranking", "set"].includes(mode)
    || !Array.isArray(value.numbers)
    || value.numbers.length < 1
    || value.numbers.length > ROULETTE_NUMBER_COUNT
  ) {
    throw new TypeError(`sources[${index}] has an invalid identity or shape`);
  }

  const numbers = value.numbers.map((number, numberIndex) =>
    rouletteNumber(number, `sources[${index}].numbers[${numberIndex}]`));
  if (new Set(numbers).size !== numbers.length) {
    throw new TypeError(`sources[${index}].numbers must be unique`);
  }
  if (mode === "set") numbers.sort((left, right) => left - right);

  let weights = null;
  if (value.weights !== undefined) {
    if (
      mode !== "ranking"
      || !Array.isArray(value.weights)
      || value.weights.length !== numbers.length
    ) {
      throw new TypeError(`sources[${index}].weights does not match its ranking`);
    }
    weights = value.weights.map((weight, weightIndex) => {
      if (
        typeof weight !== "number"
        || !Number.isFinite(weight)
        || weight < 0
        || weight > 1
      ) {
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

  const cursor = jsonSafeClone(value.cursor, `sources[${index}].cursor`);
  return { id, family, mode, numbers, weights, cursor };
}

function sourceDistribution(source) {
  const distribution = Array(ROULETTE_NUMBER_COUNT).fill(0);
  const size = source.numbers.length;
  source.numbers.forEach((number, index) => {
    distribution[number] = source.weights !== null
      ? source.weights[index]
      : source.mode === "set"
        ? 1 / size
        : (2 * (size - index)) / (size * (size + 1));
  });
  return normalizedDistribution(distribution, `source ${source.id}`);
}

export function buildLearnedLeaderFamilies(value) {
  if (!Array.isArray(value)) throw new TypeError("sources must be an array");
  const normalized = value.map(normalizedSource);
  const ids = new Set();
  for (const source of normalized) {
    if (ids.has(source.id)) throw new TypeError(`duplicate source id ${source.id}`);
    ids.add(source.id);
  }

  const deduplicated = [];
  const seenRankings = new Set();
  for (const source of [...normalized].sort((left, right) => left.id.localeCompare(right.id))) {
    const key = JSON.stringify([
      source.family,
      source.mode,
      source.numbers,
      source.weights,
    ]);
    if (seenRankings.has(key)) continue;
    seenRankings.add(key);
    deduplicated.push(source);
  }

  const familyMembers = new Map();
  for (const source of deduplicated) {
    const members = familyMembers.get(source.family) ?? [];
    members.push(sourceDistribution(source));
    familyMembers.set(source.family, members);
  }

  const familyDistributions = {};
  for (const family of LEARNED_LEADER_FAMILIES) {
    const members = familyMembers.get(family);
    if (!members || members.length === 0) continue;
    const distribution = Array(ROULETTE_NUMBER_COUNT).fill(0);
    for (const member of members) {
      member.forEach((mass, number) => {
        distribution[number] += mass / members.length;
      });
    }
    familyDistributions[family] = normalizedDistribution(
      distribution,
      `family ${family}`,
    );
  }

  return {
    sourceManifest: deduplicated.map((source) => ({
      ...source,
      weights: source.weights === null ? null : [...source.weights],
      numbers: [...source.numbers],
    })),
    familyDistributions,
  };
}

export function learnedLeaderBrierLoss(distribution, actualNumber) {
  const safeDistribution = normalizedDistribution(distribution, "distribution");
  const actual = rouletteNumber(actualNumber, "actualNumber");
  return safeDistribution.reduce(
    (total, mass, number) => total + (mass - (number === actual ? 1 : 0)) ** 2,
    0,
  ) / 2;
}

function normalizedLearningParameters(value = LEARNED_LEADER_DEFAULTS) {
  if (!isPlainObject(value)) throw new TypeError("learning parameters are invalid");
  const keys = Object.keys(LEARNED_LEADER_DEFAULTS);
  if (
    Object.keys(value).length !== keys.length
    || keys.some((key) => !Number.isFinite(value[key]))
    || keys.some((key) => value[key] !== LEARNED_LEADER_DEFAULTS[key])
  ) {
    throw new TypeError(
      `${LEARNED_LEADER_ALGORITHM_VERSION} requires its frozen learning parameters`,
    );
  }
  return { ...LEARNED_LEADER_DEFAULTS };
}

function normalizedLearningRow(value, index, cutoffMs) {
  if (!isPlainObject(value)) {
    throw new TypeError(`learningRows[${index}] must be an object`);
  }
  const id = String(value.id ?? value.forecastId ?? "").trim();
  if (id === "") throw new TypeError(`learningRows[${index}].id is required`);
  if (
    value.algorithmVersion !== undefined
    && value.algorithmVersion !== LEARNED_LEADER_ALGORITHM_VERSION
  ) {
    throw new TypeError(`learningRows[${index}] has a different algorithm version`);
  }
  const lockedAt = timestamp(value.lockedAt, `learningRows[${index}].lockedAt`);
  const completedAt = timestamp(
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
  for (const family of LEARNED_LEADER_FAMILIES) {
    if (value.familyDistributions[family] === undefined) continue;
    familyDistributions[family] = normalizedDistribution(
      value.familyDistributions[family],
      `learningRows[${index}].familyDistributions.${family}`,
    );
  }
  return {
    id,
    lockedAt,
    completedAt,
    actualNumber,
    familyDistributions,
    excludedNotPast: Date.parse(completedAt) >= cutoffMs,
  };
}

function sigmoid(value) {
  return value >= 0
    ? 1 / (1 + Math.exp(-value))
    : Math.exp(value) / (1 + Math.exp(value));
}

export function learnLeaderFamilyWeights(
  value,
  currentLockedAt,
  parameters = LEARNED_LEADER_DEFAULTS,
) {
  if (!Array.isArray(value)) throw new TypeError("learningRows must be an array");
  const safeParameters = normalizedLearningParameters(parameters);
  const cutoffAt = timestamp(currentLockedAt, "currentLockedAt");
  const cutoffMs = Date.parse(cutoffAt);
  const rows = value.map((row, index) => normalizedLearningRow(row, index, cutoffMs));
  const eligible = rows.filter((row) => !row.excludedNotPast);
  const ids = new Set();
  for (const row of eligible) {
    if (ids.has(row.id)) throw new TypeError(`duplicate learning row ${row.id}`);
    ids.add(row.id);
  }
  eligible.sort((left, right) => (
    Date.parse(left.completedAt) - Date.parse(right.completedAt)
    || Date.parse(left.lockedAt) - Date.parse(right.lockedAt)
    || left.id.localeCompare(right.id)
  ));

  let logOdds = 0;
  let effectiveCount = 0;
  let trainingCount = 0;
  let skippedIncompleteFamilyCount = 0;
  let lastTrainingCompletedAt = null;
  let trainingThroughId = null;
  for (const row of eligible) {
    const price = row.familyDistributions.price;
    const conditional = row.familyDistributions["conditional-history"];
    if (!price || !conditional) {
      skippedIncompleteFamilyCount += 1;
      continue;
    }
    const priceLoss = learnedLeaderBrierLoss(price, row.actualNumber);
    const conditionalLoss = learnedLeaderBrierLoss(conditional, row.actualNumber);
    const eta = safeParameters.eta
      / Math.sqrt(1 + trainingCount / safeParameters.etaScale);
    logOdds = safeParameters.decay * logOdds
      - eta * (priceLoss - conditionalLoss);
    logOdds = Math.max(
      -safeParameters.maximumAbsoluteLogOdds,
      Math.min(safeParameters.maximumAbsoluteLogOdds, logOdds),
    );
    effectiveCount = safeParameters.decay * effectiveCount + 1;
    trainingCount += 1;
    lastTrainingCompletedAt = row.completedAt;
    trainingThroughId = row.id;
  }

  const shrinkage = effectiveCount / (effectiveCount + safeParameters.shrinkageCount);
  const priceShare = safeParameters.minimumFamilyWeight
    + (1 - 2 * safeParameters.minimumFamilyWeight)
      * sigmoid(shrinkage * logOdds);
  const familyWeights = {
    price: priceShare,
    "conditional-history": 1 - priceShare,
  };

  return {
    version: LEARNED_LEADER_LEARNING_VERSION,
    parameters: safeParameters,
    status: trainingCount < safeParameters.minimumAdaptiveTrainingCount
      ? "cold_start"
      : "adaptive",
    trainingCount,
    eligibleRowCount: eligible.length,
    skippedIncompleteFamilyCount,
    excludedNotPastCount: rows.length - eligible.length,
    effectiveCount,
    logOdds,
    shrinkage,
    familyWeights,
    learningCutoffAt: cutoffAt,
    lastTrainingCompletedAt,
    trainingThroughId,
  };
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
  const offset = hash32(`${seed}:offset`) % ROULETTE_NUMBER_COUNT;
  const step = (hash32(`${seed}:step`) % (ROULETTE_NUMBER_COUNT - 1)) + 1;
  let current = offset;
  for (let index = 0; index < ROULETTE_NUMBER_COUNT; index += 1) {
    if (current === number) return index;
    current = (current + step) % ROULETTE_NUMBER_COUNT;
  }
  return ROULETTE_NUMBER_COUNT;
}

function rankDistribution(distribution, familyDistributions, tieSeed) {
  const candidates = distribution.map((mass, number) => ({
    number,
    mass,
    familySupportCount: Object.values(familyDistributions).reduce(
      (count, familyDistribution) => (
        count + (familyDistribution[number] > SCORE_EPSILON ? 1 : 0)
      ),
      0,
    ),
  }));
  candidates.sort((left, right) => {
    if (!closeEnough(left.mass, right.mass, SCORE_EPSILON)) {
      return right.mass - left.mass;
    }
    if (left.familySupportCount !== right.familySupportCount) {
      return right.familySupportCount - left.familySupportCount;
    }
    return tiePosition(
      left.number,
      `${LEARNED_LEADER_ALGORITHM_VERSION}:${tieSeed}`,
    ) - tiePosition(
      right.number,
      `${LEARNED_LEADER_ALGORITHM_VERSION}:${tieSeed}`,
    );
  });
  return candidates.map((candidate, index) => ({
    rank: index + 1,
    ...candidate,
  }));
}

export function buildLearnedLeaderDecision({
  sources,
  learningRows = [],
  lockedAt,
  tieSeed,
}) {
  const cutoffAt = timestamp(lockedAt, "lockedAt");
  const safeTieSeed = String(tieSeed ?? "");
  if (safeTieSeed === "") throw new TypeError("tieSeed is required");
  const { sourceManifest, familyDistributions } = buildLearnedLeaderFamilies(sources);
  const learning = learnLeaderFamilyWeights(learningRows, cutoffAt);
  const familyIds = LEARNED_LEADER_FAMILIES.filter(
    (family) => familyDistributions[family] !== undefined,
  );
  if (familyIds.length === 0) {
    return {
      schemaVersion: LEARNED_LEADER_SCHEMA_VERSION,
      algorithmVersion: LEARNED_LEADER_ALGORITHM_VERSION,
      status: "unavailable",
      reason: "no_valid_family",
      lockedAt: cutoffAt,
      tieSeed: safeTieSeed,
      sourceManifest,
      familyDistributions,
      familyWeights: {},
      combinedDistribution: [],
      ranking: [],
      leaderNumber: null,
      leaderMass: null,
      runnerUpMass: null,
      margin: null,
      tieCount: 0,
      tieBreakApplied: false,
      sourceCount: sourceManifest.length,
      familyCount: 0,
      learning,
    };
  }

  const learnedWeights = learning.familyWeights;
  const availableTotal = familyIds.reduce(
    (total, family) => total + learnedWeights[family],
    0,
  );
  const familyWeights = Object.fromEntries(
    familyIds.map((family) => [family, learnedWeights[family] / availableTotal]),
  );
  const combinedDistribution = Array(ROULETTE_NUMBER_COUNT).fill(0);
  for (const family of familyIds) {
    familyDistributions[family].forEach((mass, number) => {
      combinedDistribution[number] += familyWeights[family] * mass;
    });
  }
  const normalizedCombined = normalizedDistribution(
    combinedDistribution,
    "combinedDistribution",
  );
  const ranking = rankDistribution(
    normalizedCombined,
    familyDistributions,
    safeTieSeed,
  );
  const leader = ranking[0];
  const runnerUp = ranking[1];
  const maximumMass = leader.mass;
  const bestSupport = Math.max(
    ...ranking
      .filter(({ mass }) => closeEnough(mass, maximumMass, SCORE_EPSILON))
      .map(({ familySupportCount }) => familySupportCount),
  );
  const tieCount = ranking.filter(({ mass, familySupportCount }) => (
    closeEnough(mass, maximumMass, SCORE_EPSILON)
    && familySupportCount === bestSupport
  )).length;

  return {
    schemaVersion: LEARNED_LEADER_SCHEMA_VERSION,
    algorithmVersion: LEARNED_LEADER_ALGORITHM_VERSION,
    status: "ready",
    reason: learning.status,
    lockedAt: cutoffAt,
    tieSeed: safeTieSeed,
    sourceManifest,
    familyDistributions,
    familyWeights,
    combinedDistribution: normalizedCombined,
    ranking,
    leaderNumber: leader.number,
    leaderMass: leader.mass,
    runnerUpMass: runnerUp.mass,
    margin: leader.mass - runnerUp.mass,
    tieCount,
    tieBreakApplied: tieCount > 1,
    sourceCount: sourceManifest.length,
    familyCount: familyIds.length,
    learning,
  };
}

function sameDistributionObject(left, right) {
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index] && sameNumberArray(left[key], right[key])
    ));
}

function normalizedStoredLearning(value, lockedAt) {
  if (
    !isPlainObject(value)
    || value.version !== LEARNED_LEADER_LEARNING_VERSION
    || !["cold_start", "adaptive"].includes(value.status)
  ) {
    return null;
  }
  let parameters;
  try {
    parameters = normalizedLearningParameters(value.parameters);
  } catch {
    return null;
  }
  const integerFields = [
    "trainingCount",
    "eligibleRowCount",
    "skippedIncompleteFamilyCount",
    "excludedNotPastCount",
  ];
  if (integerFields.some((field) => (
    !Number.isSafeInteger(value[field]) || value[field] < 0
  ))) {
    return null;
  }
  if (
    value.trainingCount + value.skippedIncompleteFamilyCount
      !== value.eligibleRowCount
    || !Number.isFinite(value.effectiveCount)
    || value.effectiveCount < 0
    || value.effectiveCount > value.trainingCount + SCORE_EPSILON
    || !Number.isFinite(value.logOdds)
    || Math.abs(value.logOdds) > parameters.maximumAbsoluteLogOdds + SCORE_EPSILON
    || !Number.isFinite(value.shrinkage)
  ) {
    return null;
  }
  const expectedShrinkage = value.effectiveCount
    / (value.effectiveCount + parameters.shrinkageCount);
  const expectedStatus = value.trainingCount < parameters.minimumAdaptiveTrainingCount
    ? "cold_start"
    : "adaptive";
  if (
    value.status !== expectedStatus
    || !closeEnough(value.shrinkage, expectedShrinkage, SCORE_EPSILON)
  ) {
    return null;
  }
  let learningCutoffAt;
  try {
    learningCutoffAt = timestamp(value.learningCutoffAt, "learningCutoffAt");
  } catch {
    return null;
  }
  if (learningCutoffAt !== lockedAt) return null;
  if (value.trainingCount === 0) {
    if (
      value.lastTrainingCompletedAt !== null
      || value.trainingThroughId !== null
      || Math.abs(value.logOdds) > SCORE_EPSILON
      || Math.abs(value.effectiveCount) > SCORE_EPSILON
    ) {
      return null;
    }
  } else {
    try {
      if (
        timestamp(value.lastTrainingCompletedAt, "lastTrainingCompletedAt")
          >= lockedAt
        || String(value.trainingThroughId ?? "").trim() === ""
      ) {
        return null;
      }
    } catch {
      return null;
    }
  }
  const expectedPriceShare = parameters.minimumFamilyWeight
    + (1 - 2 * parameters.minimumFamilyWeight)
      * sigmoid(expectedShrinkage * value.logOdds);
  if (
    !isPlainObject(value.familyWeights)
    || Object.keys(value.familyWeights).length !== LEARNED_LEADER_FAMILIES.length
    || !Number.isFinite(value.familyWeights.price)
    || !Number.isFinite(value.familyWeights["conditional-history"])
    || !closeEnough(value.familyWeights.price, expectedPriceShare, SCORE_EPSILON)
    || !closeEnough(
      value.familyWeights["conditional-history"],
      1 - expectedPriceShare,
      SCORE_EPSILON,
    )
  ) {
    return null;
  }
  return structuredClone({ ...value, parameters, learningCutoffAt });
}

export function normalizeLearnedLeaderDecision(value) {
  try {
    if (
      !isPlainObject(value)
      || value.schemaVersion !== LEARNED_LEADER_SCHEMA_VERSION
      || value.algorithmVersion !== LEARNED_LEADER_ALGORITHM_VERSION
      || !["ready", "unavailable"].includes(value.status)
    ) {
      return null;
    }
    const lockedAt = timestamp(value.lockedAt, "lockedAt");
    const tieSeed = String(value.tieSeed ?? "");
    if (tieSeed === "" || !Array.isArray(value.sourceManifest)) return null;
    const rebuiltFamilies = buildLearnedLeaderFamilies(value.sourceManifest);
    if (!sameDistributionObject(
      rebuiltFamilies.familyDistributions,
      value.familyDistributions,
    )) {
      return null;
    }
    const learning = normalizedStoredLearning(value.learning, lockedAt);
    if (!learning) return null;
    const learningWeights = learning.familyWeights;

    const familyIds = LEARNED_LEADER_FAMILIES.filter(
      (family) => rebuiltFamilies.familyDistributions[family] !== undefined,
    );
    if (value.status === "unavailable") {
      if (
        familyIds.length !== 0
        || value.reason !== "no_valid_family"
        || value.leaderNumber !== null
        || !Array.isArray(value.combinedDistribution)
        || value.combinedDistribution.length !== 0
        || !Array.isArray(value.ranking)
        || value.ranking.length !== 0
      ) {
        return null;
      }
      if (
        !Number.isSafeInteger(value.sourceCount)
        || value.sourceCount !== rebuiltFamilies.sourceManifest.length
        || value.familyCount !== 0
        || value.leaderMass !== null
        || value.runnerUpMass !== null
        || value.margin !== null
        || value.tieCount !== 0
        || value.tieBreakApplied !== false
      ) {
        return null;
      }
      return structuredClone({ ...value, lockedAt, learning });
    }
    if (familyIds.length === 0 || !isPlainObject(value.familyWeights)) return null;
    const storedFamilyWeights = {};
    let availableWeightTotal = 0;
    for (const family of familyIds) {
      const weight = value.familyWeights[family];
      if (
        typeof weight !== "number"
        || !Number.isFinite(weight)
        || weight < 0
        || weight > 1
      ) return null;
      storedFamilyWeights[family] = weight;
      availableWeightTotal += weight;
    }
    if (!closeEnough(availableWeightTotal, 1)) return null;
    if (Object.keys(value.familyWeights).length !== familyIds.length) return null;
    const learnedAvailableTotal = familyIds.reduce(
      (total, family) => total + learningWeights[family],
      0,
    );
    if (familyIds.some((family) => !closeEnough(
      storedFamilyWeights[family],
      learningWeights[family] / learnedAvailableTotal,
      SCORE_EPSILON,
    ))) {
      return null;
    }

    const combined = Array(ROULETTE_NUMBER_COUNT).fill(0);
    for (const family of familyIds) {
      rebuiltFamilies.familyDistributions[family].forEach((mass, number) => {
        combined[number] += storedFamilyWeights[family] * mass;
      });
    }
    const normalizedCombined = normalizedDistribution(combined, "combinedDistribution");
    if (!sameNumberArray(normalizedCombined, value.combinedDistribution)) return null;
    const expectedRanking = rankDistribution(
      normalizedCombined,
      rebuiltFamilies.familyDistributions,
      tieSeed,
    );
    const maximumMass = expectedRanking[0].mass;
    const bestSupport = Math.max(
      ...expectedRanking
        .filter(({ mass }) => closeEnough(mass, maximumMass, SCORE_EPSILON))
        .map(({ familySupportCount }) => familySupportCount),
    );
    const expectedTieCount = expectedRanking.filter(({ mass, familySupportCount }) => (
      closeEnough(mass, maximumMass, SCORE_EPSILON)
      && familySupportCount === bestSupport
    )).length;
    if (
      !Array.isArray(value.ranking)
      || value.ranking.length !== ROULETTE_NUMBER_COUNT
      || expectedRanking.some((candidate, index) => (
        candidate.rank !== value.ranking[index]?.rank
        || candidate.number !== value.ranking[index]?.number
        || candidate.familySupportCount
          !== value.ranking[index]?.familySupportCount
        || typeof value.ranking[index]?.mass !== "number"
        || !closeEnough(candidate.mass, value.ranking[index].mass, SCORE_EPSILON)
      ))
      || rouletteNumber(value.leaderNumber, "leaderNumber")
        !== expectedRanking[0].number
      || typeof value.leaderMass !== "number"
      || !closeEnough(value.leaderMass, expectedRanking[0].mass)
      || typeof value.runnerUpMass !== "number"
      || !closeEnough(value.runnerUpMass, expectedRanking[1].mass)
      || typeof value.margin !== "number"
      || !closeEnough(
        value.margin,
        expectedRanking[0].mass - expectedRanking[1].mass,
      )
      || !Number.isSafeInteger(value.sourceCount)
      || value.sourceCount !== rebuiltFamilies.sourceManifest.length
      || !Number.isSafeInteger(value.familyCount)
      || value.familyCount !== familyIds.length
      || value.reason !== learning.status
      || !Number.isSafeInteger(value.tieCount)
      || value.tieCount !== expectedTieCount
      || value.tieBreakApplied !== (expectedTieCount > 1)
    ) {
      return null;
    }
    return structuredClone({ ...value, lockedAt, learning });
  } catch {
    return null;
  }
}

export function evaluateLearnedLeaderDecision(value, actualNumber) {
  const decision = normalizeLearnedLeaderDecision(value);
  if (!decision || decision.status !== "ready") {
    throw new TypeError("decision must be a valid ready learned leader snapshot");
  }
  const actual = rouletteNumber(actualNumber, "actualNumber");
  const familyLosses = Object.fromEntries(
    Object.entries(decision.familyDistributions).map(([family, distribution]) => [
      family,
      learnedLeaderBrierLoss(distribution, actual),
    ]),
  );
  return {
    actualNumber: actual,
    top1Hit: decision.leaderNumber === actual,
    top3Hit: decision.ranking.slice(0, 3).some(({ number }) => number === actual),
    combinedBrierLoss: learnedLeaderBrierLoss(
      decision.combinedDistribution,
      actual,
    ),
    uniformBrierLoss: LEARNED_LEADER_UNIFORM_BRIER_LOSS,
    familyLosses,
  };
}
