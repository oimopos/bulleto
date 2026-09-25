export const PRECLOSE_FORECAST_HORIZON_SECONDS = 8;
export const PRECLOSE_FORECAST_MIN_LEAD_MS = 8_000;
export const PRECLOSE_FORECAST_MAX_LEAD_MS = 10_000;
export const PRECLOSE_FORECAST_FACTOR_WINDOW_MS = 12_000;
export const PRECLOSE_FORECAST_MAX_FACTOR_AGE_MS = 5_000;
export const PRECLOSE_FORECAST_MIN_FACTOR_POINTS = 3;
export const PRECLOSE_FORECAST_TOP_COUNT = 3;
export const PRECLOSE_FORECAST_MODEL_VERSION = "linear-trend-12s-to-ed-v1";

export const PRECLOSE_FORECAST_CONSTANTS = Object.freeze({
  horizonSeconds: PRECLOSE_FORECAST_HORIZON_SECONDS,
  minLeadMs: PRECLOSE_FORECAST_MIN_LEAD_MS,
  maxLeadMs: PRECLOSE_FORECAST_MAX_LEAD_MS,
  factorWindowMs: PRECLOSE_FORECAST_FACTOR_WINDOW_MS,
  maxFactorAgeMs: PRECLOSE_FORECAST_MAX_FACTOR_AGE_MS,
  minFactorPoints: PRECLOSE_FORECAST_MIN_FACTOR_POINTS,
  topCount: PRECLOSE_FORECAST_TOP_COUNT,
  modelVersion: PRECLOSE_FORECAST_MODEL_VERSION,
});

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function timestamp(value, label) {
  if (
    !(value instanceof Date) &&
    (typeof value !== "string" || value.trim() === "")
  ) {
    throw new TypeError(`${label} must be a valid timestamp`);
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`${label} must be a valid timestamp`);
  }
  return { milliseconds: date.getTime(), iso: date.toISOString() };
}

function finiteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function externalRoundId(value) {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    (typeof value === "number" && !Number.isSafeInteger(value)) ||
    String(value).trim() === ""
  ) {
    throw new TypeError("round.id must be present");
  }
  return String(value).trim();
}

function canonicalNumber(wireCell) {
  return wireCell === 37 ? 0 : wireCell;
}

function normalizeBands(cells) {
  if (!Array.isArray(cells) || cells.length !== 38) {
    throw new TypeError("round.cls must contain all 38 wire bands");
  }

  const seenWireCells = new Set();
  const bands = cells.map((cell, index) => {
    if (!isObject(cell)) {
      throw new TypeError(`round.cls[${index}] must be an object`);
    }
    const wireCell = cell.c;
    if (!Number.isInteger(wireCell) || wireCell < 0 || wireCell > 37) {
      throw new RangeError(`round.cls[${index}].c must be between 0 and 37`);
    }
    if (seenWireCells.has(wireCell)) {
      throw new TypeError(`round.cls contains duplicate wire cell ${wireCell}`);
    }
    seenWireCells.add(wireCell);

    const upper = finiteNumber(cell.vt, `round.cls[${index}].vt`);
    const lower = finiteNumber(cell.vf, `round.cls[${index}].vf`);
    if (upper <= lower) {
      throw new RangeError(`round.cls[${index}] must have vt greater than vf`);
    }

    return {
      wireCell,
      number: canonicalNumber(wireCell),
      lower,
      upper,
    };
  });

  return bands.sort((left, right) => left.wireCell - right.wireCell);
}

function normalizeFactors(factors, receivedAtMs) {
  if (!Array.isArray(factors)) {
    throw new TypeError("factors must be an array");
  }

  const byTimestamp = new Map();
  for (let index = 0; index < factors.length; index += 1) {
    const factor = factors[index];
    if (!isObject(factor)) {
      throw new TypeError(`factors[${index}] must be an object`);
    }
    const at = timestamp(factor.dt, `factors[${index}].dt`);

    // The server sends a rolling factors array. A point timestamped after the
    // lock cannot be a feature, even if it appears in the same payload.
    if (at.milliseconds > receivedAtMs) continue;

    const price = finiteNumber(factor.v, `factors[${index}].v`);
    byTimestamp.set(at.milliseconds, { at: at.iso, milliseconds: at.milliseconds, price });
  }

  const windowStartMs = receivedAtMs - PRECLOSE_FORECAST_FACTOR_WINDOW_MS;
  return [...byTimestamp.values()]
    .filter((factor) => factor.milliseconds >= windowStartMs)
    .sort((left, right) => left.milliseconds - right.milliseconds);
}

function linearTrendPerSecond(points) {
  const originMs = points.at(-1).milliseconds;
  const samples = points.map((point) => ({
    seconds: (point.milliseconds - originMs) / 1_000,
    price: point.price,
  }));
  const meanSeconds =
    samples.reduce((total, sample) => total + sample.seconds, 0) / samples.length;
  const meanPrice =
    samples.reduce((total, sample) => total + sample.price, 0) / samples.length;
  let covariance = 0;
  let variance = 0;
  for (const sample of samples) {
    const timeDelta = sample.seconds - meanSeconds;
    covariance += timeDelta * (sample.price - meanPrice);
    variance += timeDelta * timeDelta;
  }
  if (!(variance > 0)) {
    throw new RangeError("factor points must have at least three distinct timestamps");
  }
  const trend = covariance / variance;
  if (!Number.isFinite(trend)) {
    throw new RangeError("factor trend is not finite");
  }
  return trend;
}

function distanceToBand(price, band) {
  if (price < band.lower) return band.lower - price;
  if (price > band.upper) return price - band.upper;
  return 0;
}

function rankCanonicalBands(bands, projectedPrice) {
  const nearestByNumber = new Map();
  for (const band of bands) {
    const distance = distanceToBand(projectedPrice, band);
    const centerDistance = Math.abs(projectedPrice - (band.lower + band.upper) / 2);
    const candidate = { ...band, distance, centerDistance };
    const previous = nearestByNumber.get(band.number);
    if (
      !previous ||
      candidate.distance < previous.distance ||
      (candidate.distance === previous.distance &&
        candidate.centerDistance < previous.centerDistance) ||
      (candidate.distance === previous.distance &&
        candidate.centerDistance === previous.centerDistance &&
        candidate.wireCell < previous.wireCell)
    ) {
      nearestByNumber.set(band.number, candidate);
    }
  }

  return [...nearestByNumber.values()]
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.centerDistance - right.centerDistance ||
        left.wireCell - right.wireCell ||
        left.number - right.number,
    )
    .slice(0, PRECLOSE_FORECAST_TOP_COUNT)
    .map((band, index) => ({
      rank: index + 1,
      number: band.number,
      wireCell: band.wireCell,
      lower: band.lower,
      upper: band.upper,
      distanceToBand: band.distance,
    }));
}

/**
 * Builds an auditable pre-close forecast from an unfinished round and only
 * factor points that existed when the message was received. Expected absence
 * of a usable signal is represented by a thrown validation error so callers
 * fail closed instead of manufacturing a late or incomplete prediction.
 */
export function buildPrecloseForecast({ round, factors, receivedAt } = {}) {
  if (!isObject(round)) {
    throw new TypeError("round must be an object");
  }
  if ("rr" in round) {
    throw new TypeError("round with rr is final and cannot be used for a pre-close forecast");
  }
  if (round.s !== 2) {
    throw new RangeError("round must still be open with status s=2");
  }

  const lockedAt = timestamp(receivedAt, "receivedAt");
  const bettingClosesAt = timestamp(round.bcd, "round.bcd");
  const endsAt = timestamp(round.ed, "round.ed");
  const leadTimeMs = bettingClosesAt.milliseconds - lockedAt.milliseconds;
  if (
    leadTimeMs < PRECLOSE_FORECAST_MIN_LEAD_MS ||
    leadTimeMs > PRECLOSE_FORECAST_MAX_LEAD_MS
  ) {
    throw new RangeError("forecast must be locked between 8 and 10 seconds before round.bcd");
  }
  if (endsAt.milliseconds <= bettingClosesAt.milliseconds) {
    throw new RangeError("round.ed must be after round.bcd");
  }

  const bands = normalizeBands(round.cls);
  const startPrice = finiteNumber(round.sv, "round.sv");
  const selectedFactors = normalizeFactors(factors, lockedAt.milliseconds);
  if (selectedFactors.length < PRECLOSE_FORECAST_MIN_FACTOR_POINTS) {
    throw new RangeError(
      `at least ${PRECLOSE_FORECAST_MIN_FACTOR_POINTS} factor points are required in the last 12 seconds`,
    );
  }

  const latestFactor = selectedFactors.at(-1);
  const factorAgeMs = lockedAt.milliseconds - latestFactor.milliseconds;
  if (factorAgeMs > PRECLOSE_FORECAST_MAX_FACTOR_AGE_MS) {
    throw new RangeError("latest factor is more than 5 seconds old");
  }

  const trendPerSecond = linearTrendPerSecond(selectedFactors);
  const projectionSeconds =
    (endsAt.milliseconds - latestFactor.milliseconds) / 1_000;
  const projectedPrice =
    latestFactor.price + trendPerSecond * projectionSeconds;
  if (!Number.isFinite(projectedPrice)) {
    throw new RangeError("projected price is not finite");
  }

  const top3 = rankCanonicalBands(bands, projectedPrice);
  const currentBand = rankCanonicalBands(bands, latestFactor.price)[0];
  if (top3.length !== PRECLOSE_FORECAST_TOP_COUNT) {
    throw new RangeError("round.cls does not provide three unique canonical bands");
  }

  // This is deliberately a whitelist. Raw round/factors payloads, status, rr,
  // and any fields introduced by the upstream service are never copied here.
  return {
    modelVersion: PRECLOSE_FORECAST_MODEL_VERSION,
    status: "predicted",
    horizonSeconds: PRECLOSE_FORECAST_HORIZON_SECONDS,
    round: {
      externalRoundId: externalRoundId(round.id),
      bettingClosesAt: bettingClosesAt.iso,
      endsAt: endsAt.iso,
      lockedAt: lockedAt.iso,
    },
    features: {
      leadTimeMs,
      factorWindowMs: PRECLOSE_FORECAST_FACTOR_WINDOW_MS,
      factorCount: selectedFactors.length,
      factorPoints: selectedFactors.map((factor) => ({
        at: factor.at,
        price: factor.price,
      })),
      latestFactorAt: latestFactor.at,
      latestPrice: latestFactor.price,
      startPrice,
      currentNumber: currentBand.number,
      factorAgeMs,
      trendPerSecond,
      projectionSeconds,
      projectedPrice,
      cellBands: bands,
    },
    prediction: {
      number: top3[0].number,
      top3,
    },
  };
}
