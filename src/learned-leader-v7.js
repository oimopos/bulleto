export const LEARNED_LEADER_V7_SCHEMA_VERSION = 1;
export const LEARNED_LEADER_V7_ALGORITHM_VERSION =
  "learned-predictive-exact-calibrated-v7-shadow";
export const LEARNED_LEADER_V7_CONFIG_VERSION =
  "exact-calibrated-config-v1";
export const LEARNED_LEADER_V7_TARGET_HORIZON = 1;

export const LEARNED_LEADER_V7_FAMILIES = Object.freeze([
  "price",
  "conditional-history",
  "baseline",
]);

export const LEARNED_LEADER_V7_UNIFORM_DISTRIBUTION = Object.freeze(
  Array(37).fill(1 / 37),
);
export const LEARNED_LEADER_V7_UNIFORM_BASELINE_CURSOR = deepFreeze({
  kind: "uniform",
  targetHorizon: LEARNED_LEADER_V7_TARGET_HORIZON,
});
export const LEARNED_LEADER_V7_UNIFORM_BRIER_LOSS = 18 / 37;

const NUMBER_COUNT = 37;
const EPSILON = 1e-12;
const SUM_TOLERANCE = 1e-9;
const LOG_LOSS_FLOOR = 1e-15;
const CONFIG_KEYS = Object.freeze([
  "blend",
  "candidateId",
  "history",
  "price",
  "selection",
  "targetHorizon",
  "version",
]);
const BLEND_KEYS = Object.freeze([
  "baseline",
  "conditionalHistory",
  "price",
]);
const HISTORY_KEYS = Object.freeze([
  "pairPriorStrength",
  "tripleBackoffStrength",
]);
const PRICE_KEYS = Object.freeze(["baselineMix", "temperature"]);
const SELECTION_KEYS = Object.freeze([
  "minimumLeaderMass",
  "minimumMargin",
  "minimumPairEffectiveSampleSize",
  "minimumPriceEvidenceCandidates",
]);
function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function closeEnough(left, right, tolerance = SUM_TOLERANCE) {
  return Math.abs(left - right) <= tolerance;
}

function compareCanonicalText(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function jsonValue(value, label, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
    return Object.is(value, -0) ? 0 : value;
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

function isoTimestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be an ISO timestamp`);
  }
  return new Date(value).toISOString();
}

function rouletteNumber(value, label) {
  if (!Number.isInteger(value) || value < 0 || value >= NUMBER_COUNT) {
    throw new RangeError(`${label} must be an integer from 0 through 36`);
  }
  return value;
}

function finiteRange(value, label, { minimum = 0, maximum = 1 } = {}) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be between ${minimum} and ${maximum}`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function positiveFinite(value, label) {
  if (!Number.isFinite(value) || !(value > 0)) {
    throw new RangeError(`${label} must be positive`);
  }
  return value;
}

function nonNegativeFinite(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be non-negative`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function normalizeDistribution(value, label, { strictlyPositive = false } = {}) {
  if (!Array.isArray(value) || value.length !== NUMBER_COUNT) {
    throw new TypeError(`${label} must contain 37 masses`);
  }
  const distribution = value.map((mass, index) => {
    if (!Number.isFinite(mass) || mass < 0 || mass > 1) {
      throw new RangeError(`${label}[${index}] must be between zero and one`);
    }
    if (strictlyPositive && !(mass > 0)) {
      throw new RangeError(`${label}[${index}] must be positive`);
    }
    return Object.is(mass, -0) ? 0 : mass;
  });
  const total = distribution.reduce((sum, mass) => sum + mass, 0);
  if (!closeEnough(total, 1)) throw new RangeError(`${label} must sum to one`);
  return distribution;
}

function normalizeWeights(value, label) {
  if (!hasExactKeys(value, BLEND_KEYS)) {
    throw new TypeError(`${label} must contain the three v7 blend weights`);
  }
  const weights = {
    price: finiteRange(value.price, `${label}.price`),
    conditionalHistory: finiteRange(
      value.conditionalHistory,
      `${label}.conditionalHistory`,
    ),
    baseline: finiteRange(value.baseline, `${label}.baseline`),
  };
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  if (!closeEnough(total, 1)) throw new RangeError(`${label} must sum to one`);
  if (!(weights.baseline > 0)) {
    throw new RangeError(`${label}.baseline must be positive`);
  }
  return weights;
}

/**
 * Validates and freezes an explicit candidate configuration. There is no
 * numerical default on purpose: every deployed candidate must carry the exact
 * parameters selected before its prospective cohort starts.
 */
export function createLearnedLeaderV7Config(value) {
  if (!hasExactKeys(value, CONFIG_KEYS)) {
    throw new TypeError("config must have the canonical v7 shape");
  }
  const candidateId = typeof value.candidateId === "string"
    ? value.candidateId.trim()
    : "";
  if (candidateId === "" || candidateId !== value.candidateId) {
    throw new TypeError("config.candidateId must be canonical non-empty text");
  }
  if (value.version !== LEARNED_LEADER_V7_CONFIG_VERSION) {
    throw new RangeError("config.version is incompatible with v7");
  }
  if (value.targetHorizon !== LEARNED_LEADER_V7_TARGET_HORIZON) {
    throw new RangeError("config.targetHorizon must be exactly one round");
  }
  if (!hasExactKeys(value.price, PRICE_KEYS)) {
    throw new TypeError("config.price must have the canonical v7 shape");
  }
  if (!hasExactKeys(value.history, HISTORY_KEYS)) {
    throw new TypeError("config.history must have the canonical v7 shape");
  }
  if (!hasExactKeys(value.selection, SELECTION_KEYS)) {
    throw new TypeError("config.selection must have the canonical v7 shape");
  }
  const minimumPriceEvidenceCandidates =
    value.selection.minimumPriceEvidenceCandidates;
  if (
    !Number.isSafeInteger(minimumPriceEvidenceCandidates)
    || minimumPriceEvidenceCandidates < 0
    || minimumPriceEvidenceCandidates > NUMBER_COUNT
  ) {
    throw new RangeError(
      "config.selection.minimumPriceEvidenceCandidates must be from zero through 37",
    );
  }

  return deepFreeze({
    version: LEARNED_LEADER_V7_CONFIG_VERSION,
    candidateId,
    targetHorizon: LEARNED_LEADER_V7_TARGET_HORIZON,
    price: {
      temperature: positiveFinite(
        value.price.temperature,
        "config.price.temperature",
      ),
      baselineMix: finiteRange(
        value.price.baselineMix,
        "config.price.baselineMix",
      ),
    },
    history: {
      pairPriorStrength: positiveFinite(
        value.history.pairPriorStrength,
        "config.history.pairPriorStrength",
      ),
      tripleBackoffStrength: positiveFinite(
        value.history.tripleBackoffStrength,
        "config.history.tripleBackoffStrength",
      ),
    },
    blend: normalizeWeights(value.blend, "config.blend"),
    selection: {
      minimumPriceEvidenceCandidates,
      minimumPairEffectiveSampleSize: nonNegativeFinite(
        value.selection.minimumPairEffectiveSampleSize,
        "config.selection.minimumPairEffectiveSampleSize",
      ),
      minimumLeaderMass: finiteRange(
        value.selection.minimumLeaderMass,
        "config.selection.minimumLeaderMass",
      ),
      minimumMargin: finiteRange(
        value.selection.minimumMargin,
        "config.selection.minimumMargin",
      ),
    },
  });
}

function normalizeSource(value, index) {
  if (!isPlainObject(value)) throw new TypeError(`sources[${index}] must be an object`);
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const family = typeof value.family === "string" ? value.family.trim() : "";
  if (
    id === ""
    || id !== value.id
    || !["price", "conditional-history"].includes(family)
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

  let weights = null;
  if (value.weights !== undefined && value.weights !== null) {
    if (!Array.isArray(value.weights) || value.weights.length !== numbers.length) {
      throw new TypeError(`sources[${index}].weights does not match its numbers`);
    }
    weights = value.weights.map((weight, weightIndex) => finiteRange(
      weight,
      `sources[${index}].weights[${weightIndex}]`,
    ));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (!closeEnough(total, 1)) {
      throw new RangeError(`sources[${index}].weights must sum to one`);
    }
  }

  if (!isPlainObject(value.cursor)) {
    throw new TypeError(`sources[${index}].cursor must be a JSON object`);
  }
  const cursor = jsonValue(value.cursor, `sources[${index}].cursor`);
  const cutoffAt = isoTimestamp(cursor.cutoffAt, `sources[${index}].cursor.cutoffAt`);
  if (cursor.cutoffAt !== cutoffAt) {
    throw new TypeError(
      `sources[${index}].cursor.cutoffAt must be canonical ISO time`,
    );
  }
  if (cursor.targetHorizon !== LEARNED_LEADER_V7_TARGET_HORIZON) {
    throw new RangeError(
      `sources[${index}].cursor.targetHorizon must be exactly one round`,
    );
  }
  return { id, family, numbers, weights, cursor };
}

function isUniformDistribution(distribution) {
  return distribution.every(
    (mass, number) => mass === LEARNED_LEADER_V7_UNIFORM_DISTRIBUTION[number],
  );
}

function normalizeBaselineCursor(value, distribution) {
  if (isUniformDistribution(distribution)) {
    if (value === undefined || value === null) {
      return { ...LEARNED_LEADER_V7_UNIFORM_BASELINE_CURSOR };
    }
    const cursor = jsonValue(value, "baselineCursor");
    if (!sameJsonValue(cursor, LEARNED_LEADER_V7_UNIFORM_BASELINE_CURSOR)) {
      throw new TypeError("uniform baselineCursor must use the deterministic marker");
    }
    return cursor;
  }

  if (!isPlainObject(value)) {
    throw new TypeError("non-uniform baseline requires a causal baselineCursor");
  }
  const cursor = jsonValue(value, "baselineCursor");
  const kind = typeof cursor.kind === "string" ? cursor.kind.trim() : "";
  if (kind === "" || kind !== cursor.kind || kind === "uniform") {
    throw new TypeError("non-uniform baselineCursor.kind must identify causal data");
  }
  const cutoffAt = isoTimestamp(cursor.cutoffAt, "baselineCursor.cutoffAt");
  if (cursor.cutoffAt !== cutoffAt) {
    throw new TypeError("baselineCursor.cutoffAt must be canonical ISO time");
  }
  if (cursor.targetHorizon !== LEARNED_LEADER_V7_TARGET_HORIZON) {
    throw new RangeError("baselineCursor.targetHorizon must be exactly one round");
  }
  return cursor;
}

function sourceKind(source) {
  const id = source.id.toLowerCase();
  if (source.family === "price") {
    if (id.includes("range")) return "derived-price";
    const scoreKind = source.cursor?.scoreKind ?? source.cursor?.massKind;
    if (
      id.includes("rank37")
      && scoreKind === "smoothed-rank37"
      && Number.isSafeInteger(source.cursor?.rawEvidenceCandidateCount)
    ) {
      return "price-smoothed";
    }
    if (id.includes("rank37") && scoreKind === "raw-rank37") return "price-raw";
    if (id.includes("rank37")) return "uncalibrated-price-alias";
    return "unknown-price";
  }
  if (id.includes("live-fixed") || id.includes("live_fixed")) return "live-fixed";
  if (id.includes("triple")) return "triple";
  if (id.includes("pair")) return "pair";
  return "unknown-conditional";
}

function sourceDistribution(source, label) {
  if (source.weights === null) throw new TypeError(`${label} requires explicit weights`);
  const output = Array(NUMBER_COUNT).fill(0);
  source.numbers.forEach((number, index) => {
    output[number] = source.weights[index];
  });
  return normalizeDistribution(output, label);
}

function evidenceSize(source, label) {
  const sampleSize = source.cursor?.sampleSize;
  if (!Number.isSafeInteger(sampleSize) || sampleSize < 0) {
    throw new RangeError(`${label}.cursor.sampleSize must be a non-negative integer`);
  }
  const suppliedEffective = source.cursor?.effectiveSampleSize;
  if (suppliedEffective === undefined || suppliedEffective === null) {
    return { sampleSize, effectiveSampleSize: sampleSize };
  }
  if (
    !Number.isFinite(suppliedEffective)
    || suppliedEffective < 0
    || suppliedEffective > sampleSize
  ) {
    throw new RangeError(
      `${label}.cursor.effectiveSampleSize must be between zero and sampleSize`,
    );
  }
  return { sampleSize, effectiveSampleSize: suppliedEffective };
}

function priceEvidenceCandidateCount(source, kind) {
  const measured = source.weights?.filter((weight) => weight > EPSILON).length ?? 0;
  const supplied = source.cursor?.evidenceCandidateCount;
  if ((supplied === undefined || supplied === null) && kind === "price-raw") {
    return measured;
  }
  if (!Number.isSafeInteger(supplied) || supplied < 0 || supplied > NUMBER_COUNT) {
    throw new RangeError(
      `source ${source.id}.cursor.evidenceCandidateCount must be from zero through 37`,
    );
  }
  if (kind === "price-smoothed") {
    const rawEvidenceCandidateCount = source.cursor?.rawEvidenceCandidateCount;
    if (
      !Number.isSafeInteger(rawEvidenceCandidateCount)
      || rawEvidenceCandidateCount < 0
      || rawEvidenceCandidateCount > NUMBER_COUNT
      || rawEvidenceCandidateCount !== supplied
    ) {
      throw new RangeError(
        `source ${source.id}.cursor raw evidence must match evidenceCandidateCount`,
      );
    }
  }
  if (kind === "price-raw" && supplied !== measured) {
    throw new RangeError(
      `source ${source.id}.cursor.evidenceCandidateCount does not match raw mass`,
    );
  }
  return supplied;
}

function canonicalPriority(source, kind) {
  const canonicalIds = {
    "price-smoothed": "price-trajectory-rank37-smoothed",
    "price-raw": "price-trajectory-rank37-raw",
    pair: "conditional-pair-full",
    triple: "conditional-triple-full",
  };
  return source.id === canonicalIds[kind] ? 1 : 0;
}

function choosePriceSource(sources) {
  return sources
    .map((source) => ({ source, kind: sourceKind(source) }))
    .filter(({ kind }) => ["price-smoothed", "price-raw"].includes(kind))
    .map(({ source, kind }) => ({
      source,
      kind,
      distribution: sourceDistribution(source, `source ${source.id}`),
      evidenceCandidateCount: priceEvidenceCandidateCount(source, kind),
    }))
    .filter(({ source }) => (
      source.numbers.length === NUMBER_COUNT && source.weights !== null
    ))
    .sort((left, right) => (
      Number(right.kind === "price-smoothed") - Number(left.kind === "price-smoothed")
      || canonicalPriority(right.source, right.kind)
        - canonicalPriority(left.source, left.kind)
      || right.evidenceCandidateCount - left.evidenceCandidateCount
      || compareCanonicalText(left.source.id, right.source.id)
    ))[0] ?? null;
}

function chooseConditionalSource(sources, kind) {
  return sources
    .filter((source) => sourceKind(source) === kind)
    .map((source) => ({
      source,
      distribution: sourceDistribution(source, `source ${source.id}`),
      ...evidenceSize(source, `source ${source.id}`),
    }))
    .filter(({ effectiveSampleSize }) => effectiveSampleSize > 0)
    .sort((left, right) => (
      canonicalPriority(right.source, kind) - canonicalPriority(left.source, kind)
      || right.effectiveSampleSize - left.effectiveSampleSize
      || right.sampleSize - left.sampleSize
      || compareCanonicalText(left.source.id, right.source.id)
    ))[0] ?? null;
}

function temperedDistribution(distribution, temperature) {
  const positiveLogMasses = distribution
    .filter((mass) => mass > 0)
    .map((mass) => Math.log(mass));
  const maximumLogMass = Math.max(...positiveLogMasses);
  const transformed = distribution.map((mass) => (
    mass === 0
      ? 0
      : Math.exp((Math.log(mass) - maximumLogMass) / temperature)
  ));
  const total = transformed.reduce((sum, mass) => sum + mass, 0);
  if (!(total > 0) || !Number.isFinite(total)) {
    throw new RangeError("tempered price scores cannot be normalized");
  }
  return normalizeDistribution(
    transformed.map((mass) => mass / total),
    "tempered price distribution",
  );
}

function mixDistribution(primary, secondary, primaryShare, label) {
  return normalizeDistribution(primary.map((mass, number) => (
    primaryShare * mass + (1 - primaryShare) * secondary[number]
  )), label);
}

function auditSources(sources, selections) {
  const selectedById = new Map([
    [selections.price?.source.id, "price-primary"],
    [selections.pair?.source.id, "pair-primary"],
    [selections.triple?.source.id, "triple-primary"],
  ].filter(([id]) => id !== undefined));
  return sources.map((source) => {
    const kind = sourceKind(source);
    const role = selectedById.get(source.id);
    let sampleSize = null;
    let effectiveSampleSize = null;
    if (["pair", "triple"].includes(kind)) {
      ({ sampleSize, effectiveSampleSize } = evidenceSize(
        source,
        `source ${source.id}`,
      ));
    }
    if (role) {
      return {
        id: source.id,
        family: source.family,
        kind,
        used: true,
        role,
        reason: "selected",
        sampleSize,
        effectiveSampleSize,
      };
    }
    const sameLineageSelected = (
      (["price-smoothed", "price-raw"].includes(kind) && selections.price)
      || (kind === "pair" && selections.pair)
      || (kind === "triple" && selections.triple)
    );
    const reason = sameLineageSelected
      ? "duplicate_lineage"
      : kind === "derived-price"
        ? "derived_price_vote"
        : kind === "live-fixed"
          ? "derived_live_vote"
          : kind === "uncalibrated-price-alias"
            ? "non_raw_price_score"
            : "unsupported_source";
    return {
      id: source.id,
      family: source.family,
      kind,
      used: false,
      role: "ignored",
      reason,
      sampleSize,
      effectiveSampleSize,
    };
  });
}

export function buildLearnedLeaderV7Families({
  sources,
  baselineDistribution = LEARNED_LEADER_V7_UNIFORM_DISTRIBUTION,
  baselineCursor,
  config,
} = {}) {
  if (!Array.isArray(sources)) throw new TypeError("sources must be an array");
  const safeConfig = createLearnedLeaderV7Config(config);
  const baseline = normalizeDistribution(
    baselineDistribution,
    "baselineDistribution",
    { strictlyPositive: true },
  );
  const safeBaselineCursor = normalizeBaselineCursor(
    baselineCursor,
    baseline,
  );
  const manifest = sources.map(normalizeSource)
    .sort((left, right) => compareCanonicalText(left.id, right.id));
  const ids = new Set();
  for (const source of manifest) {
    if (ids.has(source.id)) throw new TypeError(`duplicate source id ${source.id}`);
    ids.add(source.id);
  }
  const price = choosePriceSource(manifest);
  const pair = chooseConditionalSource(manifest, "pair");
  const triple = chooseConditionalSource(manifest, "triple");
  const familyDistributions = { baseline };
  const evidence = { price: null, conditionalHistory: null };

  if (price) {
    const tempered = temperedDistribution(
      price.distribution,
      safeConfig.price.temperature,
    );
    familyDistributions.price = mixDistribution(
      tempered,
      baseline,
      1 - safeConfig.price.baselineMix,
      "calibrated price distribution",
    );
    evidence.price = {
      sourceId: price.source.id,
      scoreKind: price.kind === "price-smoothed"
        ? "smoothed-rank37"
        : "raw-rank37",
      evidenceCandidateCount: price.evidenceCandidateCount,
      temperature: safeConfig.price.temperature,
      baselineMix: safeConfig.price.baselineMix,
    };
  }

  const pairEffective = pair?.effectiveSampleSize ?? 0;
  const tripleEffective = triple?.effectiveSampleSize ?? 0;
  if (pairEffective > 0 || tripleEffective > 0) {
    const pairPriorStrength = safeConfig.history.pairPriorStrength;
    const pairPosterior = pairEffective > 0
      ? mixDistribution(
          pair.distribution,
          baseline,
          pairEffective / (pairEffective + pairPriorStrength),
          "pair posterior",
        )
      : [...baseline];
    const tripleBackoffStrength = safeConfig.history.tripleBackoffStrength;
    const history = tripleEffective > 0
      ? mixDistribution(
          triple.distribution,
          pairPosterior,
          tripleEffective / (tripleEffective + tripleBackoffStrength),
          "triple posterior",
        )
      : pairPosterior;
    familyDistributions["conditional-history"] = history;
    evidence.conditionalHistory = {
      pairSourceId: pair?.source.id ?? null,
      pairSampleSize: pair?.sampleSize ?? 0,
      pairEffectiveSampleSize: pairEffective,
      pairPriorStrength,
      tripleSourceId: triple?.source.id ?? null,
      tripleSampleSize: triple?.sampleSize ?? 0,
      tripleEffectiveSampleSize: tripleEffective,
      tripleBackoffStrength,
      backoff: tripleEffective > 0
        ? "triple-to-pair-posterior"
        : "pair-to-baseline",
    };
  }

  const selections = { price, pair, triple };
  return deepFreeze({
    config: safeConfig,
    baselineDistribution: baseline,
    baselineCursor: safeBaselineCursor,
    sourceManifest: manifest.map((source) => ({
      ...source,
      numbers: [...source.numbers],
      weights: source.weights === null ? null : [...source.weights],
      cursor: source.cursor === null ? null : jsonValue(source.cursor, "cursor"),
    })),
    sourceAudit: auditSources(manifest, selections),
    familyDistributions,
    evidence,
  });
}

export function learnedLeaderV7BrierLoss(distribution, actualNumber) {
  const safe = normalizeDistribution(distribution, "distribution");
  const actual = rouletteNumber(actualNumber, "actualNumber");
  return safe.reduce((loss, mass, number) => (
    loss + (mass - (number === actual ? 1 : 0)) ** 2
  ), 0) / 2;
}

export function learnedLeaderV7ClippedLogLoss(distribution, actualNumber) {
  const safe = normalizeDistribution(distribution, "distribution");
  const actual = rouletteNumber(actualNumber, "actualNumber");
  const loss = -Math.log(Math.max(LOG_LOSS_FLOOR, safe[actual]));
  return Object.is(loss, -0) ? 0 : loss;
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
  let current = offset;
  for (let index = 0; index < NUMBER_COUNT; index += 1) {
    if (current === number) return index;
    current = (current + step) % NUMBER_COUNT;
  }
  return NUMBER_COUNT;
}

function rankDistribution(distribution, tieSeed) {
  return distribution.map((mass, number) => ({ number, mass }))
    .sort((left, right) => (
      !closeEnough(left.mass, right.mass, EPSILON)
        ? right.mass - left.mass
        : tiePosition(left.number, tieSeed) - tiePosition(right.number, tieSeed)
    ))
    .map((candidate, index) => ({ rank: index + 1, ...candidate }));
}

function actualBlendWeights(familyDistributions, config) {
  const requested = {
    price: config.blend.price,
    "conditional-history": config.blend.conditionalHistory,
    baseline: config.blend.baseline,
  };
  const available = Object.keys(requested).filter(
    (family) => familyDistributions[family] !== undefined && requested[family] > 0,
  );
  const total = available.reduce((sum, family) => sum + requested[family], 0);
  if (!(total > 0)) throw new RangeError("available v7 blend weights must be positive");
  return Object.fromEntries(available.map((family) => [
    family,
    requested[family] / total,
  ]));
}

function selectiveGate({ evidence, familyDistributions, leaderMass, margin, config }) {
  const signals = {
    requiresPrice: config.blend.price > 0,
    requiresConditionalHistory: config.blend.conditionalHistory > 0,
    hasPrice: familyDistributions.price !== undefined,
    hasConditionalHistory:
      familyDistributions["conditional-history"] !== undefined,
    priceEvidenceCandidateCount:
      evidence.price?.evidenceCandidateCount ?? null,
    pairEffectiveSampleSize:
      evidence.conditionalHistory?.pairEffectiveSampleSize ?? 0,
    leaderMass,
    margin,
  };
  const reasons = [];
  if (signals.requiresPrice && !signals.hasPrice) reasons.push("price_unavailable");
  if (
    signals.requiresConditionalHistory
    && !signals.hasConditionalHistory
  ) reasons.push("history_unavailable");
  if (
    signals.requiresPrice
    && (
      signals.priceEvidenceCandidateCount === null
      || signals.priceEvidenceCandidateCount
        < config.selection.minimumPriceEvidenceCandidates
    )
  ) reasons.push("weak_price_evidence");
  if (
    signals.requiresConditionalHistory
    && signals.pairEffectiveSampleSize
      < config.selection.minimumPairEffectiveSampleSize
  ) reasons.push("sparse_pair_history");
  if (
    leaderMass === null
    || !(leaderMass >= config.selection.minimumLeaderMass)
  ) {
    reasons.push("leader_mass_below_threshold");
  }
  if (margin === null || !(margin >= config.selection.minimumMargin)) {
    reasons.push("small_margin");
  }
  return {
    version: "frozen-selective-policy-v1",
    eligible: reasons.length === 0,
    reason: reasons.length === 0 ? "eligible" : reasons[0],
    reasons,
    parameters: { ...config.selection },
    signals,
  };
}

export function buildLearnedLeaderV7Decision({
  sources,
  baselineDistribution = LEARNED_LEADER_V7_UNIFORM_DISTRIBUTION,
  baselineCursor,
  config,
  lockedAt,
  tieSeed,
} = {}) {
  const cutoffAt = isoTimestamp(lockedAt, "lockedAt");
  if (cutoffAt !== lockedAt) throw new TypeError("lockedAt must be canonical ISO time");
  const safeTieSeed = typeof tieSeed === "string" ? tieSeed.trim() : "";
  if (safeTieSeed === "" || safeTieSeed !== tieSeed) {
    throw new TypeError("tieSeed must be canonical non-empty text");
  }
  const families = buildLearnedLeaderV7Families({
    sources,
    baselineDistribution,
    baselineCursor,
    config,
  });
  if (families.sourceManifest.some((source) => (
    source.cursor.cutoffAt !== cutoffAt
    || source.cursor.targetHorizon !== LEARNED_LEADER_V7_TARGET_HORIZON
  ))) {
    throw new RangeError(
      "every source cursor must match lockedAt and the one-round horizon",
    );
  }
  if (
    families.baselineCursor.kind !== "uniform"
    && families.baselineCursor.cutoffAt !== cutoffAt
  ) {
    throw new RangeError("causal baselineCursor.cutoffAt must equal lockedAt");
  }

  const requestedPredictiveWeights = {
    price: families.config.blend.price,
    "conditional-history": families.config.blend.conditionalHistory,
  };
  const predictiveFamilies = Object.entries(requestedPredictiveWeights)
    .filter(([family, weight]) => (
      weight > 0 && families.familyDistributions[family] !== undefined
    ))
    .map(([family]) => family);
  const common = {
    schemaVersion: LEARNED_LEADER_V7_SCHEMA_VERSION,
    algorithmVersion: LEARNED_LEADER_V7_ALGORITHM_VERSION,
    shadow: true,
    targetHorizon: LEARNED_LEADER_V7_TARGET_HORIZON,
    lockedAt: cutoffAt,
    tieSeed: safeTieSeed,
    config: families.config,
    baselineDistribution: families.baselineDistribution,
    baselineCursor: families.baselineCursor,
    sourceManifest: families.sourceManifest,
    sourceAudit: families.sourceAudit,
    familyDistributions: families.familyDistributions,
    evidence: families.evidence,
    sourceCount: families.sourceManifest.length,
    usedSourceCount: families.sourceAudit.filter(({ used }) => used).length,
    familyCount: predictiveFamilies.length,
    componentCount: Object.keys(families.familyDistributions).length,
  };
  if (predictiveFamilies.length === 0) {
    return deepFreeze({
      ...common,
      status: "unavailable",
      reason: "no_predictive_family",
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
        leaderMass: null,
        margin: null,
        config: families.config,
      }),
    });
  }

  const familyWeights = actualBlendWeights(
    families.familyDistributions,
    families.config,
  );
  const combined = Array(NUMBER_COUNT).fill(0);
  for (const [family, weight] of Object.entries(familyWeights)) {
    families.familyDistributions[family].forEach((mass, number) => {
      combined[number] += weight * mass;
    });
  }
  const combinedDistribution = normalizeDistribution(combined, "combinedDistribution");
  const ranking = rankDistribution(
    combinedDistribution,
    `${LEARNED_LEADER_V7_ALGORITHM_VERSION}:${safeTieSeed}`,
  );
  const maximumMass = ranking[0].mass;
  const tieCount = ranking.filter(({ mass }) => (
    closeEnough(mass, maximumMass, EPSILON)
  )).length;
  const margin = ranking[0].mass - ranking[1].mass;
  return deepFreeze({
    ...common,
    status: "ready",
    reason: "frozen_config",
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
      leaderMass: ranking[0].mass,
      margin,
      config: families.config,
    }),
  });
}

export function normalizeLearnedLeaderV7Decision(value) {
  try {
    if (!isPlainObject(value)
      || value.schemaVersion !== LEARNED_LEADER_V7_SCHEMA_VERSION
      || value.algorithmVersion !== LEARNED_LEADER_V7_ALGORITHM_VERSION
      || value.shadow !== true
      || value.targetHorizon !== LEARNED_LEADER_V7_TARGET_HORIZON
      || !["ready", "unavailable"].includes(value.status)
      || !Array.isArray(value.sourceManifest)) return null;
    const rebuilt = buildLearnedLeaderV7Decision({
      sources: value.sourceManifest,
      baselineDistribution: value.baselineDistribution,
      baselineCursor: value.baselineCursor,
      config: value.config,
      lockedAt: value.lockedAt,
      tieSeed: value.tieSeed,
    });
    if (!sameJsonValue(value, rebuilt)) return null;
    return deepFreeze(jsonValue(value, "decision"));
  } catch {
    return null;
  }
}

export function evaluateLearnedLeaderV7Decision(value, actualNumber) {
  const decision = normalizeLearnedLeaderV7Decision(value);
  if (!decision || decision.status !== "ready") {
    throw new TypeError("decision must be a valid ready v7 shadow snapshot");
  }
  const actual = rouletteNumber(actualNumber, "actualNumber");
  const familyEvaluations = Object.fromEntries(
    Object.entries(decision.familyDistributions).map(([family, distribution]) => {
      const ranking = rankDistribution(
        distribution,
        `${LEARNED_LEADER_V7_ALGORITHM_VERSION}:${decision.tieSeed}:${family}`,
      );
      return [family, {
        top1Number: ranking[0].number,
        top1Hit: ranking[0].number === actual,
        top3Numbers: ranking.slice(0, 3).map(({ number }) => number),
        top3Hit: ranking.slice(0, 3).some(({ number }) => number === actual),
        brierLoss: learnedLeaderV7BrierLoss(distribution, actual),
        clippedLogLoss: learnedLeaderV7ClippedLogLoss(distribution, actual),
      }];
    }),
  );
  return deepFreeze({
    actualNumber: actual,
    top1Hit: decision.leaderNumber === actual,
    top3Hit: decision.ranking.slice(0, 3).some(({ number }) => number === actual),
    combinedBrierLoss: learnedLeaderV7BrierLoss(
      decision.combinedDistribution,
      actual,
    ),
    combinedClippedLogLoss: learnedLeaderV7ClippedLogLoss(
      decision.combinedDistribution,
      actual,
    ),
    baselineBrierLoss: learnedLeaderV7BrierLoss(
      decision.baselineDistribution,
      actual,
    ),
    baselineClippedLogLoss: learnedLeaderV7ClippedLogLoss(
      decision.baselineDistribution,
      actual,
    ),
    familyEvaluations,
    selected: decision.selection.eligible,
  });
}
