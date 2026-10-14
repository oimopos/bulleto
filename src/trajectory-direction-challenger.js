export const TRAJECTORY_DIRECTION_CHALLENGER_KEY = "structural-center-v1";
export const TRAJECTORY_DIRECTION_STRUCTURAL_VERSION =
  "trajectory-direction-structural-v1";

export const TRAJECTORY_DIRECTION_STRUCTURAL_DEFAULTS = Object.freeze({
  flatThresholdCellWidths: 0.5,
  targetPointPolicy: "core-midpoint-v1",
  eligibilityPolicy: "start-edge-and-lock-remaining-same-sign-v1",
});

const RAW_BAND_COUNT = 38;
const FIRST_CORE_WIRE_CELL = 1;
const LAST_CORE_WIRE_CELL = 36;
const NUMBER_TOLERANCE = 1e-9;

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function unavailable(reason, parameters) {
  return deepFreeze({
    version: TRAJECTORY_DIRECTION_STRUCTURAL_VERSION,
    status: "unavailable",
    reason,
    direction: null,
    probabilities: null,
    expectedDeltaCellWidths: null,
    parameters,
    selection: {
      eligible: false,
      edgeScoreCellWidths: null,
      remainingScoreCellWidths: null,
      thresholdCellWidths: parameters.flatThresholdCellWidths,
      sameSide: null,
    },
    audit: null,
  });
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Object.is(value, -0) ? 0 : value
    : null;
}

function numbersEqual(left, right) {
  return Math.abs(left - right) <=
    NUMBER_TOLERANCE * Math.max(1, Math.abs(left), Math.abs(right));
}

function normalizeBands(value) {
  if (!Array.isArray(value) || value.length !== RAW_BAND_COUNT) return null;
  const normalized = [];
  for (let index = 0; index < value.length; index += 1) {
    const input = value[index];
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const lower = finiteNumber(input.lower);
    const upper = finiteNumber(input.upper);
    const expectedNumber = index === 37 ? 0 : index;
    if (
      input.wireCell !== index
      || input.number !== expectedNumber
      || lower === null
      || upper === null
      || !(upper > lower)
    ) {
      return null;
    }
    if (
      index > 0
      && !(
        normalized[index - 1].upper > upper
        && normalized[index - 1].lower > lower
      )
    ) {
      return null;
    }
    normalized.push({ wireCell: index, number: expectedNumber, lower, upper });
  }
  return normalized;
}

function medianBandWidth(bands) {
  const widths = bands
    .map((band) => band.upper - band.lower)
    .sort((left, right) => left - right);
  const middle = widths.length / 2;
  return (widths[middle - 1] + widths[middle]) / 2;
}

function containsPrice(bands, price) {
  return bands.some((band) => price >= band.lower && price <= band.upper);
}

function scoreSign(score, threshold) {
  if (score > threshold) return 1;
  if (score < -threshold) return -1;
  return 0;
}

function directionForSign(sign) {
  return sign > 0 ? "up" : "down";
}

/**
 * Builds a frozen direction-only structural challenger.
 *
 * The proxy deliberately ignores the duplicated raw zero bands when locating
 * the target. Its target is the midpoint of the unique-number core c1..c36.
 * It emits a direction only while both the round start and the forecast lock
 * remain more than the flat threshold away from that midpoint on the same
 * side. No outcome probabilities are claimed before prospective calibration.
 */
export function buildTrajectoryDirectionChallenger({
  bands,
  startPrice,
  lockPrice,
  medianCellWidth,
  flatThresholdCellWidths =
    TRAJECTORY_DIRECTION_STRUCTURAL_DEFAULTS.flatThresholdCellWidths,
} = {}) {
  const threshold = finiteNumber(flatThresholdCellWidths);
  const parameters = deepFreeze({
    flatThresholdCellWidths:
      threshold !== null && threshold >= 0
        ? threshold
        : TRAJECTORY_DIRECTION_STRUCTURAL_DEFAULTS.flatThresholdCellWidths,
    targetPointPolicy:
      TRAJECTORY_DIRECTION_STRUCTURAL_DEFAULTS.targetPointPolicy,
    eligibilityPolicy:
      TRAJECTORY_DIRECTION_STRUCTURAL_DEFAULTS.eligibilityPolicy,
  });
  if (threshold === null || threshold < 0) {
    return unavailable("invalid_flat_threshold", parameters);
  }

  const normalizedBands = normalizeBands(bands);
  if (!normalizedBands) return unavailable("invalid_bands", parameters);

  const normalizedStartPrice = finiteNumber(startPrice);
  if (normalizedStartPrice === null) {
    return unavailable("invalid_start_price", parameters);
  }
  const normalizedLockPrice = finiteNumber(lockPrice);
  if (normalizedLockPrice === null) {
    return unavailable("invalid_lock_price", parameters);
  }
  const suppliedWidth = finiteNumber(medianCellWidth);
  if (suppliedWidth === null || !(suppliedWidth > 0)) {
    return unavailable("invalid_median_cell_width", parameters);
  }

  const computedWidth = medianBandWidth(normalizedBands);
  if (!(computedWidth > 0) || !numbersEqual(suppliedWidth, computedWidth)) {
    return unavailable("median_cell_width_mismatch", parameters);
  }
  if (!containsPrice(normalizedBands, normalizedStartPrice)) {
    return unavailable("start_price_outside_bands", parameters);
  }
  if (!containsPrice(normalizedBands, normalizedLockPrice)) {
    return unavailable("lock_price_outside_bands", parameters);
  }

  const coreTop = normalizedBands[FIRST_CORE_WIRE_CELL].upper;
  const coreBottom = normalizedBands[LAST_CORE_WIRE_CELL].lower;
  if (!(coreTop > coreBottom)) return unavailable("invalid_core", parameters);
  const coreMidpoint = (coreTop + coreBottom) / 2;
  if (!Number.isFinite(coreMidpoint)) {
    return unavailable("invalid_core", parameters);
  }

  const edgeScoreCellWidths =
    (coreMidpoint - normalizedStartPrice) / computedWidth;
  const remainingScoreCellWidths =
    (coreMidpoint - normalizedLockPrice) / computedWidth;
  if (
    !Number.isFinite(edgeScoreCellWidths)
    || !Number.isFinite(remainingScoreCellWidths)
  ) {
    return unavailable("invalid_scores", parameters);
  }

  const edgeSign = scoreSign(edgeScoreCellWidths, threshold);
  const remainingSign = scoreSign(remainingScoreCellWidths, threshold);
  const sameSide = edgeSign !== 0 && edgeSign === remainingSign;
  const selection = {
    eligible: sameSide,
    edgeScoreCellWidths,
    remainingScoreCellWidths,
    thresholdCellWidths: threshold,
    sameSide,
  };
  const audit = {
    basis: "start-and-lock-same-side-of-core-midpoint",
    rawBandCount: RAW_BAND_COUNT,
    coreWireCells: {
      first: FIRST_CORE_WIRE_CELL,
      last: LAST_CORE_WIRE_CELL,
    },
    coreTop,
    coreBottom,
    coreMidpoint,
    startPrice: normalizedStartPrice,
    lockPrice: normalizedLockPrice,
    medianCellWidth: computedWidth,
  };

  if (edgeSign === 0) {
    return deepFreeze({
      version: TRAJECTORY_DIRECTION_STRUCTURAL_VERSION,
      status: "unselected",
      reason: "start_within_center_band",
      direction: null,
      probabilities: null,
      expectedDeltaCellWidths: null,
      parameters,
      selection,
      audit,
    });
  }
  if (remainingSign === 0) {
    return deepFreeze({
      version: TRAJECTORY_DIRECTION_STRUCTURAL_VERSION,
      status: "unselected",
      reason: "lock_within_center_band",
      direction: null,
      probabilities: null,
      expectedDeltaCellWidths: null,
      parameters,
      selection,
      audit,
    });
  }
  if (!sameSide) {
    return deepFreeze({
      version: TRAJECTORY_DIRECTION_STRUCTURAL_VERSION,
      status: "unselected",
      reason: "center_side_changed",
      direction: null,
      probabilities: null,
      expectedDeltaCellWidths: null,
      parameters,
      selection,
      audit,
    });
  }

  return deepFreeze({
    version: TRAJECTORY_DIRECTION_STRUCTURAL_VERSION,
    status: "ready",
    reason: null,
    direction: directionForSign(remainingSign),
    probabilities: null,
    expectedDeltaCellWidths: null,
    parameters,
    selection,
    audit,
  });
}
