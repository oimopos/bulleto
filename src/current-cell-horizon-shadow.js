export const CURRENT_CELL_HORIZON_SHADOW_SCHEMA_VERSION = 1;
export const CURRENT_CELL_HORIZON_SHADOW_ALGORITHM_VERSION =
  "current-cell-10s-calibrated-v1";
export const CURRENT_CELL_HORIZON_SHADOW_CONFIG_VERSION =
  "current-cell-10s-frozen-20261018-v1";
export const CURRENT_CELL_HORIZON_SHADOW_COHORT_KEY =
  "current-cell-10s-prospective";
export const CURRENT_CELL_HORIZON_SHADOW_SOURCE = "buleto";
export const CURRENT_CELL_HORIZON_SHADOW_INSTRUMENT = "XPM/RUB";

const NUMBER_COUNT = 37;
const WIRE_CELL_COUNT = 38;
const ISO_TOLERANCE_MS = 2_500;
const DEVELOPMENT_HIT_COUNT = 172;
// The exact horizon-selection development cohort: 4,244 train + 1,698 tune.
// Do not substitute 5,945 here: that is the independently split h=10-only
// cohort, whose membership and 70% chronological boundary are different.
const DEVELOPMENT_SAMPLE_SIZE = 5_942;
const LEADER_PROBABILITY = DEVELOPMENT_HIT_COUNT / DEVELOPMENT_SAMPLE_SIZE;
const OTHER_PROBABILITY = (1 - LEADER_PROBABILITY) / (NUMBER_COUNT - 1);
const LOG_LOSS_FLOOR = 1e-15;
export const CURRENT_CELL_HORIZON_SHADOW_UNIFORM_BRIER_LOSS = 18 / 37;
export const CURRENT_CELL_HORIZON_SHADOW_UNIFORM_LOG_LOSS = Math.log(37);

/**
 * This configuration is deliberately immutable. The 10-second horizon was
 * selected before the prospective cohort starts from a chronological
 * train/tune split. The listed development counts calibrate probability only;
 * they must never be updated with prospective outcomes in place.
 */
export const CURRENT_CELL_HORIZON_SHADOW_CONFIG = deepFreeze({
  version: CURRENT_CELL_HORIZON_SHADOW_CONFIG_VERSION,
  mode: "prospective-shadow",
  executionEnabled: false,
  advisoryOnly: true,
  horizonSeconds: 10,
  captureGraceMs: ISO_TOLERANCE_MS,
  minimumExecutionBufferMs: 5_000,
  cutoffPolicy: "factor-received-created-lte-cutoff-v1",
  tickSelectionPolicy: "latest-causal-tick-v1",
  bandSelectionPolicy: "nearest-wire-band-v1",
  selectionAudit: {
    version: "chronological-train-tune-holdout-v1",
    candidateHorizonsSeconds: [15, 12, 10, 8],
    selectionRule: "maximum-tune-top1-with-train-tiebreak-v1",
    cohortPolicy: "complete-candidate-horizons-v1",
    chronologicalOrder: "settled-at-then-result-id-v1",
    splitPolicy: "floor-50pct-train-floor-70pct-development-v1",
    developmentStartsAt: "2026-10-08T16:08:58.000Z",
    developmentThroughAt: "2026-10-15T08:10:29.000Z",
    developmentStartResultId: 15_314,
    developmentThroughResultId: 21_409,
    developmentStartExternalRoundId: "4102997",
    developmentThroughExternalRoundId: "4109398",
    commonTrainThroughAt: "2026-10-13T11:01:29.000Z",
    commonTrainThroughResultId: 19_603,
    commonTrainThroughExternalRoundId: "4107592",
    commonTuneStartsAt: "2026-10-13T11:02:58.000Z",
    commonTuneStartResultId: 19_604,
    commonTuneStartExternalRoundId: "4107593",
    commonTrainCount: 4_244,
    commonTrainHitCount: 118,
    commonTuneCount: 1_698,
    commonTuneHitCount: 54,
    commonDevelopmentCount: DEVELOPMENT_SAMPLE_SIZE,
    commonDevelopmentHitCount: DEVELOPMENT_HIT_COUNT,
  },
  calibration: {
    version: "binary-leader-rest-uniform-v1",
    developmentHitCount: DEVELOPMENT_HIT_COUNT,
    developmentSampleSize: DEVELOPMENT_SAMPLE_SIZE,
    leaderProbability: LEADER_PROBABILITY,
    otherProbability: OTHER_PROBABILITY,
    uniformProbability: 1 / NUMBER_COUNT,
  },
});

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function canonicalInstant(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be a canonical ISO timestamp`);
  }
  const normalized = new Date(value).toISOString();
  if (normalized !== value) {
    throw new TypeError(`${label} must be a canonical ISO timestamp`);
  }
  return normalized;
}

function finiteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return value;
}

function nonEmptyText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function rouletteNumber(value, label) {
  if (!Number.isInteger(value) || value < 0 || value >= NUMBER_COUNT) {
    throw new RangeError(`${label} must be an integer from 0 through 36`);
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

function normalizedDistribution(value, label) {
  if (!Array.isArray(value) || value.length !== NUMBER_COUNT) {
    throw new TypeError(`${label} must contain 37 probabilities`);
  }
  const distribution = value.map((mass, index) => {
    const probability = finiteNumber(mass, `${label}[${index}]`);
    if (probability < 0 || probability > 1) {
      throw new RangeError(`${label}[${index}] must be between zero and one`);
    }
    return probability;
  });
  const total = distribution.reduce((sum, mass) => sum + mass, 0);
  if (Math.abs(total - 1) > 1e-9) {
    throw new RangeError(`${label} must sum to one`);
  }
  return distribution.map((mass) => mass / total);
}

function normalizedBands(value) {
  if (!Array.isArray(value) || value.length !== WIRE_CELL_COUNT) {
    throw new TypeError("bands must contain all 38 wire cells");
  }
  const bands = value.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new TypeError(`bands[${index}] must be an object`);
    }
    const wireCell = entry.wireCell;
    const number = entry.number;
    const lower = finiteNumber(entry.lower, `bands[${index}].lower`);
    const upper = finiteNumber(entry.upper, `bands[${index}].upper`);
    if (
      !Number.isInteger(wireCell)
      || wireCell < 0
      || wireCell >= WIRE_CELL_COUNT
      || number !== (wireCell === 37 ? 0 : wireCell)
      || !(upper > lower)
    ) {
      throw new RangeError(`bands[${index}] is not a canonical wire band`);
    }
    return { wireCell, number, lower, upper };
  }).sort((left, right) => left.wireCell - right.wireCell);
  if (
    bands.some((band, index) => band.wireCell !== index)
    || bands.some((band, index) => (
      index > 0
      && !(
        bands[index - 1].upper > band.upper
        && bands[index - 1].lower > band.lower
      )
    ))
  ) {
    throw new RangeError("bands must be complete and ordered from top to bottom");
  }
  return bands;
}

function normalizedTicks(value) {
  if (!Array.isArray(value)) throw new TypeError("ticks must be an array");
  return value.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new TypeError(`ticks[${index}] must be an object`);
    }
    const factorAt = canonicalInstant(entry.factorAt, `ticks[${index}].factorAt`);
    const receivedAt = canonicalInstant(
      entry.receivedAt,
      `ticks[${index}].receivedAt`,
    );
    const createdAt = canonicalInstant(entry.createdAt, `ticks[${index}].createdAt`);
    if (Date.parse(factorAt) > Date.parse(receivedAt)) {
      throw new RangeError(`ticks[${index}] was received before its factor time`);
    }
    if (Date.parse(receivedAt) > Date.parse(createdAt)) {
      throw new RangeError(`ticks[${index}] was created before it was received`);
    }
    return {
      factorAt,
      receivedAt,
      createdAt,
      price: finiteNumber(entry.price, `ticks[${index}].price`),
    };
  });
}

function distanceToBand(price, band) {
  if (price < band.lower) return band.lower - price;
  if (price > band.upper) return price - band.upper;
  return 0;
}

function locateBand(bands, price) {
  return bands.map((band) => ({
    ...band,
    distance: distanceToBand(price, band),
    centerDistance: Math.abs(price - (band.lower + band.upper) / 2),
  })).sort((left, right) => (
    left.distance - right.distance
    || left.centerDistance - right.centerDistance
    || left.wireCell - right.wireCell
  ))[0];
}

function latestCausalTick(ticks, cutoffMs) {
  const eligible = ticks.filter((tick) => (
    Date.parse(tick.factorAt) <= cutoffMs
    && Date.parse(tick.receivedAt) <= cutoffMs
    && Date.parse(tick.createdAt) <= cutoffMs
  )).sort((left, right) => (
    Date.parse(right.factorAt) - Date.parse(left.factorAt)
    || Date.parse(right.receivedAt) - Date.parse(left.receivedAt)
    || Date.parse(right.createdAt) - Date.parse(left.createdAt)
    || left.price - right.price
  ));
  if (eligible.length < 2) return { tick: eligible[0] ?? null, ambiguous: false };
  const first = eligible[0];
  const second = eligible[1];
  const sameInstant = first.factorAt === second.factorAt
    && first.receivedAt === second.receivedAt
    && first.createdAt === second.createdAt;
  return {
    tick: first,
    ambiguous: sameInstant && first.price !== second.price,
  };
}

function calibratedDistribution(leaderNumber) {
  const distribution = Array(NUMBER_COUNT).fill(OTHER_PROBABILITY);
  distribution[leaderNumber] = LEADER_PROBABILITY;
  return distribution;
}

function unavailable(common, reason, audit) {
  return deepFreeze({
    ...common,
    status: "unavailable",
    reason,
    leaderNumber: null,
    leaderWireCell: null,
    leaderProbability: null,
    runnerUpProbability: null,
    margin: null,
    distribution: [],
    selectedTick: null,
    audit,
  });
}

export function buildCurrentCellHorizonShadow({
  trajectoryId,
  source,
  instrument,
  cohortKey = CURRENT_CELL_HORIZON_SHADOW_COHORT_KEY,
  externalRoundId,
  bettingClosesAt,
  capturedAt,
  bands,
  ticks,
} = {}) {
  const safeTrajectoryId = positiveInteger(trajectoryId, "trajectoryId");
  const safeSource = nonEmptyText(source, "source");
  const safeInstrument = nonEmptyText(instrument, "instrument");
  if (
    safeSource !== CURRENT_CELL_HORIZON_SHADOW_SOURCE
    || safeInstrument !== CURRENT_CELL_HORIZON_SHADOW_INSTRUMENT
  ) {
    throw new RangeError("source and instrument are not the frozen current-cell stream");
  }
  const safeCohortKey = nonEmptyText(cohortKey, "cohortKey");
  if (safeCohortKey !== CURRENT_CELL_HORIZON_SHADOW_COHORT_KEY) {
    throw new RangeError("cohortKey is not the frozen current-cell cohort");
  }
  const roundId = String(externalRoundId ?? "").trim();
  if (roundId === "") throw new TypeError("externalRoundId is required");
  const closesAt = canonicalInstant(bettingClosesAt, "bettingClosesAt");
  const frozenAt = canonicalInstant(capturedAt, "capturedAt");
  const closeMs = Date.parse(closesAt);
  const capturedMs = Date.parse(frozenAt);
  const cutoffMs = closeMs
    - CURRENT_CELL_HORIZON_SHADOW_CONFIG.horizonSeconds * 1_000;
  const cutoffAt = new Date(cutoffMs).toISOString();
  const safeBands = normalizedBands(bands);
  const safeTicks = normalizedTicks(ticks);
  const causalTickCount = safeTicks.filter((tick) => (
    Date.parse(tick.factorAt) <= cutoffMs
    && Date.parse(tick.receivedAt) <= cutoffMs
    && Date.parse(tick.createdAt) <= cutoffMs
  )).length;
  const audit = {
    suppliedTickCount: safeTicks.length,
    causalTickCount,
    excludedFutureTickCount: safeTicks.length - causalTickCount,
    executionBufferMs: closeMs - capturedMs,
  };
  const common = {
    schemaVersion: CURRENT_CELL_HORIZON_SHADOW_SCHEMA_VERSION,
    algorithmVersion: CURRENT_CELL_HORIZON_SHADOW_ALGORITHM_VERSION,
    mode: CURRENT_CELL_HORIZON_SHADOW_CONFIG.mode,
    executionEnabled: false,
    advisoryOnly: true,
    trajectoryId: safeTrajectoryId,
    source: safeSource,
    instrument: safeInstrument,
    cohortKey: safeCohortKey,
    externalRoundId: roundId,
    bettingClosesAt: closesAt,
    cutoffAt,
    capturedAt: frozenAt,
    config: CURRENT_CELL_HORIZON_SHADOW_CONFIG,
    bandManifest: safeBands,
    tickManifest: safeTicks,
  };
  if (capturedMs < cutoffMs) {
    return unavailable(common, "cutoff_not_reached", audit);
  }
  if (
    closeMs - capturedMs
      < CURRENT_CELL_HORIZON_SHADOW_CONFIG.minimumExecutionBufferMs
  ) {
    return unavailable(common, "insufficient_execution_buffer", audit);
  }
  if (capturedMs > cutoffMs + CURRENT_CELL_HORIZON_SHADOW_CONFIG.captureGraceMs) {
    return unavailable(common, "capture_late", audit);
  }
  const selected = latestCausalTick(safeTicks, cutoffMs);
  if (selected.ambiguous) {
    return unavailable(common, "ambiguous_latest_tick", audit);
  }
  if (selected.tick === null) {
    return unavailable(common, "no_causal_tick", audit);
  }
  const band = locateBand(safeBands, selected.tick.price);
  const distribution = calibratedDistribution(band.number);
  return deepFreeze({
    ...common,
    status: "ready",
    reason: "latest_causal_current_cell",
    leaderNumber: band.number,
    leaderWireCell: band.wireCell,
    leaderProbability: LEADER_PROBABILITY,
    runnerUpProbability: OTHER_PROBABILITY,
    margin: LEADER_PROBABILITY - OTHER_PROBABILITY,
    distribution,
    selectedTick: {
      ...selected.tick,
      ageAtCutoffMs: cutoffMs - Date.parse(selected.tick.factorAt),
    },
    audit,
  });
}

export function normalizeCurrentCellHorizonShadow(value) {
  try {
    if (
      !isPlainObject(value)
      || value.schemaVersion !== CURRENT_CELL_HORIZON_SHADOW_SCHEMA_VERSION
      || value.algorithmVersion !== CURRENT_CELL_HORIZON_SHADOW_ALGORITHM_VERSION
      || value.mode !== CURRENT_CELL_HORIZON_SHADOW_CONFIG.mode
      || value.executionEnabled !== false
      || value.advisoryOnly !== true
      || value.cohortKey !== CURRENT_CELL_HORIZON_SHADOW_COHORT_KEY
      || !["ready", "unavailable"].includes(value.status)
      || !Array.isArray(value.bandManifest)
      || !Array.isArray(value.tickManifest)
    ) return null;
    const rebuilt = buildCurrentCellHorizonShadow({
      trajectoryId: value.trajectoryId,
      source: value.source,
      instrument: value.instrument,
      cohortKey: value.cohortKey,
      externalRoundId: value.externalRoundId,
      bettingClosesAt: value.bettingClosesAt,
      capturedAt: value.capturedAt,
      bands: value.bandManifest,
      ticks: value.tickManifest,
    });
    if (!sameJsonValue(value, rebuilt)) return null;
    return deepFreeze(jsonValue(value, "shadow"));
  } catch {
    return null;
  }
}

export function currentCellHorizonBrierLoss(distribution, actualNumber) {
  const safe = normalizedDistribution(distribution, "distribution");
  const actual = rouletteNumber(actualNumber, "actualNumber");
  return safe.reduce((loss, mass, number) => (
    loss + (mass - (number === actual ? 1 : 0)) ** 2
  ), 0) / 2;
}

export function currentCellHorizonClippedLogLoss(distribution, actualNumber) {
  const safe = normalizedDistribution(distribution, "distribution");
  const actual = rouletteNumber(actualNumber, "actualNumber");
  const loss = -Math.log(Math.max(LOG_LOSS_FLOOR, safe[actual]));
  return Object.is(loss, -0) ? 0 : loss;
}

export function evaluateCurrentCellHorizonShadow(value, actualNumber) {
  const shadow = normalizeCurrentCellHorizonShadow(value);
  if (!shadow || shadow.status !== "ready") {
    throw new TypeError("shadow must be a valid ready current-cell snapshot");
  }
  const actual = rouletteNumber(actualNumber, "actualNumber");
  return deepFreeze({
    actualNumber: actual,
    top1Hit: shadow.leaderNumber === actual,
    brierLoss: currentCellHorizonBrierLoss(shadow.distribution, actual),
    clippedLogLoss: currentCellHorizonClippedLogLoss(
      shadow.distribution,
      actual,
    ),
    uniformBrierLoss: CURRENT_CELL_HORIZON_SHADOW_UNIFORM_BRIER_LOSS,
    uniformClippedLogLoss: CURRENT_CELL_HORIZON_SHADOW_UNIFORM_LOG_LOSS,
  });
}

export function createCurrentCellHorizonShadowCohort({
  source,
  instrument,
  firstTrajectoryId,
  startedAt,
} = {}) {
  const safeSource = nonEmptyText(source, "source");
  const safeInstrument = nonEmptyText(instrument, "instrument");
  if (
    safeSource !== CURRENT_CELL_HORIZON_SHADOW_SOURCE
    || safeInstrument !== CURRENT_CELL_HORIZON_SHADOW_INSTRUMENT
  ) {
    throw new RangeError("source and instrument are not the frozen current-cell stream");
  }
  return deepFreeze({
    cohortKey: CURRENT_CELL_HORIZON_SHADOW_COHORT_KEY,
    schemaVersion: CURRENT_CELL_HORIZON_SHADOW_SCHEMA_VERSION,
    algorithmVersion: CURRENT_CELL_HORIZON_SHADOW_ALGORITHM_VERSION,
    configVersion: CURRENT_CELL_HORIZON_SHADOW_CONFIG_VERSION,
    mode: CURRENT_CELL_HORIZON_SHADOW_CONFIG.mode,
    source: safeSource,
    instrument: safeInstrument,
    firstTrajectoryId: positiveInteger(firstTrajectoryId, "firstTrajectoryId"),
    startedAt: canonicalInstant(startedAt, "startedAt"),
    config: CURRENT_CELL_HORIZON_SHADOW_CONFIG,
  });
}
