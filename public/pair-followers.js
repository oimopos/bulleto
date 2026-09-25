export const ROULETTE_NUMBER_COUNT = 37;

function rouletteNumber(value, numberCount) {
  const number = typeof value === "string" && value.trim() !== ""
    ? Number(value)
    : value;
  return Number.isInteger(number) && number >= 0 && number < numberCount
    ? number
    : null;
}

function positiveCount(value) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0 ? count : null;
}

function timestampValue(value) {
  if (typeof value !== "string" || value === "") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function earlierTimestamp(current, candidate) {
  const currentValue = timestampValue(current);
  const candidateValue = timestampValue(candidate);
  if (candidateValue === null) return current;
  if (currentValue === null || candidateValue < currentValue) return candidate;
  return current;
}

function laterTimestamp(current, candidate) {
  const currentValue = timestampValue(current);
  const candidateValue = timestampValue(candidate);
  if (candidateValue === null) return current;
  if (currentValue === null || candidateValue > currentValue) return candidate;
  return current;
}

export function buildFollowerStats(pairItems, sourceNumber, {
  numberCount = ROULETTE_NUMBER_COUNT
} = {}) {
  if (!Number.isInteger(numberCount) || numberCount < 1) {
    throw new TypeError("numberCount must be a positive integer");
  }

  const source = rouletteNumber(sourceNumber, numberCount);
  if (source === null) {
    throw new TypeError("sourceNumber must be a valid roulette number");
  }

  const followers = Array.from({ length: numberCount }, (_, number) => ({
    number,
    occurrenceCount: 0,
    firstOccurredAt: null,
    lastOccurredAt: null
  }));

  for (const pair of Array.isArray(pairItems) ? pairItems : []) {
    const numbers = Array.isArray(pair?.numbers) ? pair.numbers : [];
    if (numbers.length !== 2) continue;

    const from = rouletteNumber(numbers[0], numberCount);
    const to = rouletteNumber(numbers[1], numberCount);
    const count = positiveCount(pair?.occurrenceCount);
    if (from !== source || to === null || count === null) continue;

    const follower = followers[to];
    follower.occurrenceCount += count;
    follower.firstOccurredAt = earlierTimestamp(
      follower.firstOccurredAt,
      pair?.firstOccurredAt
    );
    follower.lastOccurredAt = laterTimestamp(
      follower.lastOccurredAt,
      pair?.lastOccurredAt
    );
  }

  const sampleSize = followers.reduce(
    (total, follower) => total + follower.occurrenceCount,
    0
  );
  const items = followers
    .map((follower) => ({
      ...follower,
      share: sampleSize > 0 ? follower.occurrenceCount / sampleSize : null
    }))
    .sort((left, right) => {
      if (right.occurrenceCount !== left.occurrenceCount) {
        return right.occurrenceCount - left.occurrenceCount;
      }
      const rightLast = timestampValue(right.lastOccurredAt) ?? -Infinity;
      const leftLast = timestampValue(left.lastOccurredAt) ?? -Infinity;
      if (rightLast !== leftLast) return rightLast - leftLast;
      return left.number - right.number;
    });

  return {
    sourceNumber: source,
    sampleSize,
    observedFollowerCount: items.filter((item) => item.occurrenceCount > 0).length,
    items
  };
}
