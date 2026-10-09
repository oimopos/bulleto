export const TRAJECTORY_RANK37_VERSION = "trajectory-rank37-v1";
export const TRAJECTORY_RANK37_BASIS =
  "adaptive-weighted-neighbor-delta-to-current-bands";
export const TRAJECTORY_RANK37_SMOOTHING_WEIGHT = 0.05;
export const TRAJECTORY_RANK37_MIN_TRAINING_COUNT = 30;
export const TRAJECTORY_RANK37_MIN_EVIDENCE_CANDIDATES = 3;

const ROULETTE_NUMBER_COUNT = 37;
const WIRE_CELL_COUNT = 38;
const SCORE_EPSILON = 1e-12;
export const TRAJECTORY_RANK37_EVIDENCE_MASS_THRESHOLD =
  SCORE_EPSILON / (1 - TRAJECTORY_RANK37_SMOOTHING_WEIGHT);
const NORMALIZATION_EPSILON = 1e-9;
const MAX_ABS_DELTA_CELL_WIDTHS = 12;

function asObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function finiteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function normalizeBands(value) {
  if (!Array.isArray(value) || value.length !== WIRE_CELL_COUNT) {
    throw new TypeError("bands must contain all 38 wire cells");
  }
  const bands = value.map((entry, index) => {
    const band = asObject(entry, `bands[${index}]`);
    const wireCell = band.wireCell;
    const number = band.number;
    const lower = finiteNumber(band.lower, `bands[${index}].lower`);
    const upper = finiteNumber(band.upper, `bands[${index}].upper`);
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

function normalizeReadyExperts(value) {
  const adaptive = asObject(value, "adaptive");
  if (
    !Number.isSafeInteger(adaptive.trainingCount)
    || adaptive.trainingCount < TRAJECTORY_RANK37_MIN_TRAINING_COUNT
  ) {
    throw new RangeError(
      `adaptive.trainingCount must be at least ${TRAJECTORY_RANK37_MIN_TRAINING_COUNT}`,
    );
  }
  if (!Array.isArray(adaptive.experts) || adaptive.experts.length === 0) {
    throw new TypeError("adaptive.experts must be a non-empty array");
  }

  const ready = [];
  const seenExpertIds = new Set();
  for (let expertIndex = 0; expertIndex < adaptive.experts.length; expertIndex += 1) {
    const expert = asObject(
      adaptive.experts[expertIndex],
      `adaptive.experts[${expertIndex}]`,
    );
    const id = typeof expert.id === "string" ? expert.id.trim() : "";
    const ensembleWeight = finiteNumber(
      expert.ensembleWeight,
      `adaptive.experts[${expertIndex}].ensembleWeight`,
    );
    if (
      id === ""
      || seenExpertIds.has(id)
      || ensembleWeight < 0
      || ensembleWeight > 1
    ) {
      throw new RangeError(`adaptive.experts[${expertIndex}] is invalid`);
    }
    seenExpertIds.add(id);

    if (expert.status !== "ready") {
      if (ensembleWeight !== 0) {
        throw new RangeError("an unavailable expert cannot have ensemble weight");
      }
      continue;
    }
    if (
      !Array.isArray(expert.neighborDistribution)
      || expert.neighborDistribution.length < 1
      || expert.neighborDistribution.length > 25
    ) {
      throw new TypeError("a ready expert must expose its frozen neighbor distribution");
    }

    const seenNeighborIds = new Set();
    const distribution = expert.neighborDistribution.map((entry, index) => {
      const neighbor = asObject(
        entry,
        `adaptive.experts[${expertIndex}].neighborDistribution[${index}]`,
      );
      const neighborId = typeof neighbor.id === "string" ? neighbor.id.trim() : "";
      const deltaCellWidths = finiteNumber(
        neighbor.deltaCellWidths,
        `adaptive.experts[${expertIndex}].neighborDistribution[${index}].deltaCellWidths`,
      );
      const weight = finiteNumber(
        neighbor.weight,
        `adaptive.experts[${expertIndex}].neighborDistribution[${index}].weight`,
      );
      if (
        neighborId === ""
        || seenNeighborIds.has(neighborId)
        || Math.abs(deltaCellWidths) > MAX_ABS_DELTA_CELL_WIDTHS
        || !(weight > 0)
        || weight > 1
      ) {
        throw new RangeError("adaptive neighbor distribution is invalid");
      }
      seenNeighborIds.add(neighborId);
      return { id: neighborId, deltaCellWidths, weight };
    });
    const distributionTotal = distribution.reduce(
      (total, neighbor) => total + neighbor.weight,
      0,
    );
    if (Math.abs(distributionTotal - 1) > NORMALIZATION_EPSILON) {
      throw new RangeError("adaptive neighbor weights must sum to one");
    }
    ready.push({ id, ensembleWeight, distribution });
  }

  const ensembleTotal = ready.reduce(
    (total, expert) => total + expert.ensembleWeight,
    0,
  );
  if (ready.length === 0 || Math.abs(ensembleTotal - 1) > NORMALIZATION_EPSILON) {
    throw new RangeError("ready adaptive expert weights must sum to one");
  }
  return ready;
}

function distanceToBand(price, band) {
  if (price < band.lower) return band.lower - price;
  if (price > band.upper) return price - band.upper;
  return 0;
}

function locateWireBand(bands, price) {
  let best = null;
  for (const band of bands) {
    const candidate = {
      ...band,
      distance: distanceToBand(price, band),
      centerDistance: Math.abs(price - (band.lower + band.upper) / 2),
    };
    if (
      best === null
      || candidate.distance < best.distance
      || (
        candidate.distance === best.distance
        && candidate.centerDistance < best.centerDistance
      )
      || (
        candidate.distance === best.distance
        && candidate.centerDistance === best.centerDistance
        && candidate.wireCell < best.wireCell
      )
    ) {
      best = candidate;
    }
  }
  return best;
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

/**
 * Projects the frozen weighted neighbor deltas into the current round's wire
 * bands. The result is a complete rank over canonical roulette numbers. Its
 * mass is a relative KNN ranking score, not a calibrated win probability.
 */
export function buildTrajectoryRank37({
  bands,
  lockPrice,
  medianCellWidth,
  adaptive,
  tieSeed,
} = {}) {
  const normalizedBands = normalizeBands(bands);
  const normalizedLockPrice = finiteNumber(lockPrice, "lockPrice");
  const normalizedWidth = finiteNumber(medianCellWidth, "medianCellWidth");
  if (!(normalizedWidth > 0)) {
    throw new RangeError("medianCellWidth must be positive");
  }
  if (typeof tieSeed !== "string" || tieSeed.trim() === "") {
    throw new TypeError("tieSeed must be a non-empty string");
  }
  const normalizedTieSeed = tieSeed.trim();
  const readyExperts = normalizeReadyExperts(adaptive);
  const rawMass = Array.from({ length: ROULETTE_NUMBER_COUNT }, () => 0);

  for (const expert of readyExperts) {
    for (const neighbor of expert.distribution) {
      const projectedPrice = normalizedLockPrice
        + neighbor.deltaCellWidths * normalizedWidth;
      const band = locateWireBand(normalizedBands, projectedPrice);
      rawMass[band.number] += expert.ensembleWeight * neighbor.weight;
    }
  }

  const rawTotal = rawMass.reduce((total, mass) => total + mass, 0);
  if (Math.abs(rawTotal - 1) > NORMALIZATION_EPSILON) {
    throw new RangeError("projected neighbor mass must sum to one");
  }
  const uniformMass = 1 / ROULETTE_NUMBER_COUNT;
  const smoothingWeight = TRAJECTORY_RANK37_SMOOTHING_WEIGHT;
  const evidenceCandidateCount = rawMass.filter(
    (mass) => mass > TRAJECTORY_RANK37_EVIDENCE_MASS_THRESHOLD,
  ).length;
  const ranked = rawMass.map((mass, number) => ({
    number,
    rawMass: mass,
    mass: (1 - smoothingWeight) * mass + smoothingWeight * uniformMass,
  })).sort((left, right) => {
    const difference = right.mass - left.mass;
    if (Math.abs(difference) > SCORE_EPSILON) return difference;
    return tiePosition(
      left.number,
      `${TRAJECTORY_RANK37_VERSION}:${normalizedTieSeed}`,
    ) - tiePosition(
      right.number,
      `${TRAJECTORY_RANK37_VERSION}:${normalizedTieSeed}`,
    );
  });

  return {
    version: TRAJECTORY_RANK37_VERSION,
    basis: TRAJECTORY_RANK37_BASIS,
    candidateCount: ROULETTE_NUMBER_COUNT,
    evidenceCandidateCount,
    evidenceMassThreshold: TRAJECTORY_RANK37_EVIDENCE_MASS_THRESHOLD,
    tieSeed: normalizedTieSeed,
    smoothing: {
      version: "uniform-mixture-v1",
      weight: smoothingWeight,
      baselineMass: uniformMass,
    },
    ranking: ranked.map((candidate, index) => ({
      rank: index + 1,
      number: candidate.number,
      mass: candidate.mass,
      rawMass: candidate.rawMass,
    })),
  };
}
