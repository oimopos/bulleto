export const CYCLE_ANALOGUE_ALGORITHM_VERSION = "cycle-analogue-prefix-v1";
export const CYCLE_ANALOGUE_ANCHOR_DRAW_COUNT = 20;

function eventNumber(event, label) {
  const value = typeof event === "object" && event !== null ? event.number : event;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 36) {
    throw new TypeError(`${label} must contain roulette numbers between 0 and 36`);
  }
  return number;
}

function prefixShape(events, label) {
  if (!Array.isArray(events)) {
    throw new TypeError(`${label} must be an array`);
  }

  const seen = new Set();
  return events.slice(0, CYCLE_ANALOGUE_ANCHOR_DRAW_COUNT).map((event, index) => {
    const number = eventNumber(event, label);
    const derivedWasNew = !seen.has(number);
    seen.add(number);
    return {
      number,
      wasNew:
        typeof event === "object" && event !== null && typeof event.wasNew === "boolean"
          ? event.wasNew
          : derivedWasNew,
      uniqueCount: seen.size,
      position: index + 1,
    };
  });
}

function lcsLength(left, right) {
  let previous = new Uint8Array(right.length + 1);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = new Uint8Array(right.length + 1);
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] =
        left[leftIndex - 1] === right[rightIndex - 1]
          ? previous[rightIndex - 1] + 1
          : Math.max(previous[rightIndex], current[rightIndex - 1]);
    }
    previous = current;
  }
  return Number(previous[right.length]);
}

export function scoreCycleAnaloguePrefix(targetEvents, candidateEvents) {
  const target = prefixShape(targetEvents, "targetEvents");
  const candidate = prefixShape(candidateEvents, "candidateEvents");
  if (
    target.length !== CYCLE_ANALOGUE_ANCHOR_DRAW_COUNT ||
    candidate.length !== CYCLE_ANALOGUE_ANCHOR_DRAW_COUNT
  ) {
    throw new RangeError(
      `both cycles must contain at least ${CYCLE_ANALOGUE_ANCHOR_DRAW_COUNT} events`,
    );
  }

  let positionalMatches = 0;
  let alignedPairMatches = 0;
  let noveltyMatches = 0;
  let uniqueCurveError = 0;
  const targetSeen = new Set();
  const candidateSeen = new Set();

  for (let index = 0; index < CYCLE_ANALOGUE_ANCHOR_DRAW_COUNT; index += 1) {
    const targetEvent = target[index];
    const candidateEvent = candidate[index];
    targetSeen.add(targetEvent.number);
    candidateSeen.add(candidateEvent.number);
    if (targetEvent.number === candidateEvent.number) positionalMatches += 1;
    if (targetEvent.wasNew === candidateEvent.wasNew) noveltyMatches += 1;
    uniqueCurveError += Math.abs(targetEvent.uniqueCount - candidateEvent.uniqueCount);

    if (
      index < CYCLE_ANALOGUE_ANCHOR_DRAW_COUNT - 1 &&
      targetEvent.number === candidateEvent.number &&
      target[index + 1].number === candidate[index + 1].number
    ) {
      alignedPairMatches += 1;
    }
  }

  let seenIntersection = 0;
  for (const number of targetSeen) {
    if (candidateSeen.has(number)) seenIntersection += 1;
  }

  return {
    lcsLength: lcsLength(
      target.map((event) => event.number),
      candidate.map((event) => event.number),
    ),
    positionalMatches,
    alignedPairMatches,
    noveltyMatches,
    uniqueCurveError,
    seenIntersection,
  };
}

function compareIsoDescending(left, right) {
  return String(right ?? "").localeCompare(String(left ?? ""));
}

export function compareCycleAnalogueCandidates(left, right) {
  return (
    right.metrics.lcsLength - left.metrics.lcsLength ||
    right.metrics.positionalMatches - left.metrics.positionalMatches ||
    right.metrics.alignedPairMatches - left.metrics.alignedPairMatches ||
    right.metrics.noveltyMatches - left.metrics.noveltyMatches ||
    left.metrics.uniqueCurveError - right.metrics.uniqueCurveError ||
    right.metrics.seenIntersection - left.metrics.seenIntersection ||
    compareIsoDescending(left.candidate.completedAt, right.candidate.completedAt) ||
    Number(right.candidate.id) - Number(left.candidate.id)
  );
}

export function selectCycleAnalogue(targetEvents, candidates) {
  if (!Array.isArray(targetEvents)) {
    throw new TypeError("targetEvents must be an array");
  }
  if (!Array.isArray(candidates)) {
    throw new TypeError("candidates must be an array");
  }

  const collectedDraws = targetEvents.length;
  const anchorEvent = targetEvents[CYCLE_ANALOGUE_ANCHOR_DRAW_COUNT - 1] ?? null;
  const anchorResultId =
    anchorEvent && typeof anchorEvent === "object" && anchorEvent.resultId != null
      ? Number(anchorEvent.resultId)
      : null;

  if (collectedDraws < CYCLE_ANALOGUE_ANCHOR_DRAW_COUNT) {
    return {
      status: "collecting_anchor",
      anchorResultId: null,
      collectedDraws,
      drawsUntilAnchor: CYCLE_ANALOGUE_ANCHOR_DRAW_COUNT - collectedDraws,
      winner: null,
      metrics: null,
    };
  }

  const ranked = candidates
    .filter(
      (candidate) =>
        candidate &&
        Array.isArray(candidate.events) &&
        candidate.events.length >= CYCLE_ANALOGUE_ANCHOR_DRAW_COUNT,
    )
    .map((candidate) => ({
      candidate,
      metrics: scoreCycleAnaloguePrefix(targetEvents, candidate.events),
    }))
    .sort(compareCycleAnalogueCandidates);

  if (ranked.length === 0) {
    return {
      status: "unavailable",
      anchorResultId,
      collectedDraws,
      drawsUntilAnchor: 0,
      winner: null,
      metrics: null,
    };
  }

  return {
    status: "ready",
    anchorResultId,
    collectedDraws,
    drawsUntilAnchor: 0,
    winner: ranked[0].candidate,
    metrics: ranked[0].metrics,
  };
}
