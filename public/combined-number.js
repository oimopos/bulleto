export const COMBINED_NUMBER_ALGORITHM_VERSION = "combined-rank-v1";

function normalizeSource(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const id = typeof value.id === "string" ? value.id.trim() : "";
  const priority = Number.isSafeInteger(value.priority) && value.priority >= 0
    ? value.priority
    : 1_000;
  if (
    id === ""
    || !Array.isArray(value.numbers)
    || value.numbers.length < 1
    || value.numbers.length > 37
  ) {
    return null;
  }

  const numbers = [...value.numbers];
  if (
    numbers.some((number) => !Number.isInteger(number) || number < 0 || number > 36)
    || new Set(numbers).size !== numbers.length
  ) {
    return null;
  }

  return { id, priority, numbers };
}

function unavailableResult() {
  return {
    version: COMBINED_NUMBER_ALGORITHM_VERSION,
    status: "unavailable",
    number: null,
    score: null,
    sourceCount: 0,
    supportCount: 0,
    sourceIds: [],
  };
}

export function combineNumberRankings(value) {
  if (!Array.isArray(value)) return unavailableResult();

  const seenSourceIds = new Set();
  const sources = [];
  for (const rawSource of value) {
    const source = normalizeSource(rawSource);
    if (!source || seenSourceIds.has(source.id)) continue;
    seenSourceIds.add(source.id);
    sources.push(source);
  }

  if (sources.length === 0) return unavailableResult();

  const candidates = new Map();
  for (const source of sources) {
    const size = source.numbers.length;
    source.numbers.forEach((number, index) => {
      const rank = index + 1;
      const candidate = candidates.get(number) ?? {
        number,
        scoreTotal: 0,
        supportCount: 0,
        firstPlaceVotes: 0,
        bestRank: Number.POSITIVE_INFINITY,
        bestSourcePriority: Number.POSITIVE_INFINITY,
      };
      candidate.scoreTotal += (size - index) / size;
      candidate.supportCount += 1;
      candidate.firstPlaceVotes += rank === 1 ? 1 : 0;
      if (rank < candidate.bestRank) {
        candidate.bestRank = rank;
        candidate.bestSourcePriority = source.priority;
      } else if (rank === candidate.bestRank) {
        candidate.bestSourcePriority = Math.min(
          candidate.bestSourcePriority,
          source.priority,
        );
      }
      candidates.set(number, candidate);
    });
  }

  const ranked = [...candidates.values()]
    .map((candidate) => ({
      ...candidate,
      score: candidate.scoreTotal / sources.length,
    }))
    .sort((left, right) => (
      right.score - left.score
      || right.supportCount - left.supportCount
      || right.firstPlaceVotes - left.firstPlaceVotes
      || left.bestRank - right.bestRank
      || left.bestSourcePriority - right.bestSourcePriority
      || left.number - right.number
    ));
  const winner = ranked[0];

  return {
    version: COMBINED_NUMBER_ALGORITHM_VERSION,
    status: sources.length === 1 ? "single_source" : "combined",
    number: winner.number,
    score: winner.score,
    sourceCount: sources.length,
    supportCount: winner.supportCount,
    sourceIds: sources
      .map(({ id, priority }) => ({ id, priority }))
      .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))
      .map(({ id }) => id),
  };
}
