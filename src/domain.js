/**
 * Canonical European roulette numbers. Wire value 37 is an alias for zero.
 * The module is intentionally pure so the state transitions can be tested
 * independently from the collector and SQLite.
 */

export const ROULETTE_NUMBERS = Object.freeze(
  Array.from({ length: 37 }, (_, number) => number),
);

function integerValue(value, label) {
  const candidate = typeof value === "string" ? value.trim() : value;

  if (
    (typeof candidate !== "number" && typeof candidate !== "string") ||
    candidate === ""
  ) {
    throw new TypeError(`${label} must be an integer`);
  }

  const number = Number(candidate);
  if (!Number.isInteger(number)) {
    throw new TypeError(`${label} must be an integer`);
  }

  return number;
}

/**
 * Convert a result as sent by Buleto to the canonical 0..36 range.
 * The site represents zero as c=37 in some payloads.
 */
export function canonicalizeWireNumber(value) {
  const wireValue =
    typeof value === "object" && value !== null && "c" in value
      ? value.c
      : value;
  const number = integerValue(wireValue, "wire number");

  if (number === 37) {
    return 0;
  }

  if (number < 0 || number > 36) {
    throw new RangeError("wire number must be between 0 and 37");
  }

  return number;
}

export const normalizeWireNumber = canonicalizeWireNumber;
export const canonicalRouletteNumber = canonicalizeWireNumber;

export function assertCanonicalNumber(value) {
  const number = integerValue(value, "roulette number");
  if (number < 0 || number > 36) {
    throw new RangeError("roulette number must be between 0 and 36");
  }
  return number;
}

export function createRemainingNumbers() {
  return [...ROULETTE_NUMBERS];
}

function validateRemainingNumbers(remainingNumbers) {
  if (!Array.isArray(remainingNumbers)) {
    throw new TypeError("remainingNumbers must be an array");
  }

  if (remainingNumbers.length === 0) {
    throw new RangeError("remainingNumbers cannot be empty");
  }

  const validated = remainingNumbers.map(assertCanonicalNumber);
  if (new Set(validated).size !== validated.length) {
    throw new TypeError("remainingNumbers cannot contain duplicates");
  }

  return validated;
}

/**
 * Apply one canonical result to an active elimination cycle.
 * A repeated result produces an event, but does not shrink the remainder.
 */
export function eliminateNumber(remainingNumbers, resultNumber) {
  const remaining = validateRemainingNumbers(remainingNumbers);
  const canonicalNumber = assertCanonicalNumber(resultNumber);

  if (remaining.length === 1) {
    throw new Error("the cycle is already complete");
  }

  const eliminated = remaining.includes(canonicalNumber);
  const nextRemaining = eliminated
    ? remaining.filter((number) => number !== canonicalNumber)
    : [...remaining];
  const completed = nextRemaining.length === 1;

  return {
    resultNumber: canonicalNumber,
    eliminated,
    repeated: !eliminated,
    remainingNumbers: nextRemaining,
    remainingCount: nextRemaining.length,
    completed,
    survivorNumber: completed ? nextRemaining[0] : null,
  };
}

export function createCycleState() {
  return {
    status: "active",
    remainingNumbers: createRemainingNumbers(),
    remainingCount: ROULETTE_NUMBERS.length,
    survivorNumber: null,
    eventCount: 0,
  };
}

/**
 * Pure cycle state machine. Passing a completed state starts a fresh cycle
 * before applying the next result.
 */
export function advanceCycle(state, wireNumber) {
  if (state !== null && state !== undefined && typeof state !== "object") {
    throw new TypeError("state must be an object, null, or undefined");
  }

  const startedNewCycle = !state || state.status === "completed";
  const current = startedNewCycle ? createCycleState() : state;

  if (current.status !== "active") {
    throw new TypeError('cycle status must be "active" or "completed"');
  }

  const canonicalNumber = canonicalizeWireNumber(wireNumber);
  const transition = eliminateNumber(
    current.remainingNumbers,
    canonicalNumber,
  );
  const nextState = {
    status: transition.completed ? "completed" : "active",
    remainingNumbers: transition.remainingNumbers,
    remainingCount: transition.remainingCount,
    survivorNumber: transition.survivorNumber,
    eventCount: Number(current.eventCount ?? 0) + 1,
  };

  return {
    ...transition,
    cycle: nextState,
    startedNewCycle,
  };
}
