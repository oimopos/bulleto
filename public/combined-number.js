export const COMBINED_NUMBER_ALGORITHM_VERSION = "combined-family-consensus-v2";

const MINIMUM_FAMILY_SUPPORT = 2;
const SCORE_EPSILON = 1e-12;

function safeNonNegativeInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function sameInstant(left, right) {
  const leftMilliseconds = Date.parse(left);
  const rightMilliseconds = Date.parse(right);
  return Number.isFinite(leftMilliseconds)
    && Number.isFinite(rightMilliseconds)
    && leftMilliseconds === rightMilliseconds;
}

function freshnessResult(status, reason, values = {}) {
  return {
    status,
    reason,
    currentRoundId: null,
    latestRoundId: null,
    latestResultId: null,
    ...values,
  };
}

export function assessCombinedNumberFreshness(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return freshnessResult("waiting", "state_unavailable");
  }

  const collector = state.collector;
  const latestResult = state.latestResult;
  if (
    !collector || typeof collector !== "object" || Array.isArray(collector)
    || !collector.currentRound || typeof collector.currentRound !== "object"
    || !latestResult || typeof latestResult !== "object" || Array.isArray(latestResult)
  ) {
    return freshnessResult("waiting", "cursor_unavailable");
  }

  const currentRoundId = safeNonNegativeInteger(collector.currentRound.id);
  const latestRoundId = safeNonNegativeInteger(
    latestResult.roundId ?? latestResult.externalRoundId,
  );
  const latestResultId = safeNonNegativeInteger(latestResult.id);
  const pendingResultCount = safeNonNegativeInteger(collector.pendingResultCount);
  const pipelineResults = safeNonNegativeInteger(state.pipelinePending?.results);
  const pipelineGaps = safeNonNegativeInteger(state.pipelinePending?.gaps);
  const cursor = { currentRoundId, latestRoundId, latestResultId };

  if (
    currentRoundId === null
    || latestRoundId === null
    || latestRoundId >= Number.MAX_SAFE_INTEGER
    || latestResultId === null
    || latestResultId < 1
    || pendingResultCount === null
    || typeof collector.resultConfirmationPending !== "boolean"
    || pipelineResults === null
    || pipelineGaps === null
  ) {
    return freshnessResult("paused", "cursor_invalid", cursor);
  }
  if (
    collector.connected !== true
    || collector.status !== "connected"
    || (collector.error !== null && collector.error !== undefined)
  ) {
    return freshnessResult("paused", "collector_unavailable", cursor);
  }
  if (collector.resultConfirmationPending || pendingResultCount > 0) {
    return freshnessResult("paused", "collector_pending", cursor);
  }
  if (pipelineResults > 0 || pipelineGaps > 0) {
    return freshnessResult("paused", "persistence_pending", cursor);
  }
  if (!sameInstant(collector.lastResultAt, latestResult.settledAt)) {
    return freshnessResult("paused", "result_cursor_mismatch", cursor);
  }
  if (currentRoundId !== latestRoundId + 1) {
    return freshnessResult("paused", "round_cursor_mismatch", cursor);
  }

  return freshnessResult("ready", "fresh", cursor);
}

export function combinedTrajectoryRanking(value, minimumTrainingCount = 30) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.isAdaptive !== true
    || value.status !== "ready"
    || !Number.isSafeInteger(minimumTrainingCount)
    || minimumTrainingCount < 1
    || !Number.isSafeInteger(value.adaptive?.trainingCount)
    || value.adaptive.trainingCount < minimumTrainingCount
    || !Number.isInteger(value.numberArea?.typical?.wireCell)
    || value.numberArea.typical.wireCell < 0
    || value.numberArea.typical.wireCell > 37
    || !Number.isInteger(value.numberArea?.typical?.number)
    || value.numberArea.typical.number < 0
    || value.numberArea.typical.number > 36
    || value.numberArea.typical.number !== (
      value.numberArea.typical.wireCell === 37
        ? 0
        : value.numberArea.typical.wireCell
    )
    || !Array.isArray(value.displayRange?.cells)
    || !value.displayRange.cells.some((cell) => (
      cell?.wireCell === value.numberArea.typical.wireCell
      && cell?.number === value.numberArea.typical.number
    ))
  ) {
    return [];
  }
  return [value.numberArea.typical.number];
}

function normalizeSource(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const id = typeof value.id === "string" ? value.id.trim() : "";
  const family = typeof value.family === "string" ? value.family.trim() : "";
  if (
    id === ""
    || family === ""
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

  return { id, family, numbers };
}

function emptyResult(status, sources = [], families = []) {
  return {
    version: COMBINED_NUMBER_ALGORITHM_VERSION,
    status,
    number: null,
    score: null,
    sourceCount: sources.length,
    familyCount: families.length,
    supportCount: 0,
    familySupportCount: 0,
    sourceIds: sources.map(({ id }) => id).sort(),
    familyIds: [...families].sort(),
  };
}

export function combineNumberRankings(value) {
  if (!Array.isArray(value)) return emptyResult("unavailable");

  const normalizedSources = value.map(normalizeSource).filter(Boolean);
  const sourceIdCounts = new Map();
  for (const { id } of normalizedSources) {
    sourceIdCounts.set(id, (sourceIdCounts.get(id) ?? 0) + 1);
  }

  const seenFamilyRankings = new Set();
  const sources = [];
  for (const source of normalizedSources
    .filter(({ id }) => sourceIdCounts.get(id) === 1)
    .sort((left, right) => left.id.localeCompare(right.id))) {
    const familyRankingKey = `${source.family}\u0000${source.numbers.join(",")}`;
    if (seenFamilyRankings.has(familyRankingKey)) continue;
    seenFamilyRankings.add(familyRankingKey);
    sources.push(source);
  }

  if (sources.length === 0) return emptyResult("unavailable");

  const familySources = new Map();
  for (const source of sources) {
    const members = familySources.get(source.family) ?? [];
    members.push(source);
    familySources.set(source.family, members);
  }
  const familyIds = [...familySources.keys()];
  if (familyIds.length < MINIMUM_FAMILY_SUPPORT) {
    return emptyResult("insufficient_families", sources, familyIds);
  }

  const candidates = new Map();
  for (const members of familySources.values()) {
    const familyCandidates = new Map();
    for (const source of members) {
      const size = source.numbers.length;
      source.numbers.forEach((number, index) => {
        const candidate = familyCandidates.get(number) ?? {
          scoreTotal: 0,
          supportCount: 0,
        };
        candidate.scoreTotal += (2 * (size - index)) / (size * (size + 1));
        candidate.supportCount += 1;
        familyCandidates.set(number, candidate);
      });
    }

    for (const [number, familyCandidate] of familyCandidates) {
      const candidate = candidates.get(number) ?? {
        number,
        scoreTotal: 0,
        familySupportCount: 0,
        supportCount: 0,
      };
      candidate.scoreTotal += familyCandidate.scoreTotal / members.length;
      candidate.familySupportCount += 1;
      candidate.supportCount += familyCandidate.supportCount;
      candidates.set(number, candidate);
    }
  }

  const ranked = [...candidates.values()]
    .filter((candidate) => (
      candidate.familySupportCount >= MINIMUM_FAMILY_SUPPORT
    ))
    .map((candidate) => ({
      ...candidate,
      score: candidate.scoreTotal,
    }))
    .sort((left, right) => (
      right.familySupportCount - left.familySupportCount
      || right.score - left.score
    ));

  if (ranked.length === 0) {
    return emptyResult("no_consensus", sources, familyIds);
  }

  const winner = ranked[0];
  const tied = ranked.filter((candidate) => (
    candidate.familySupportCount === winner.familySupportCount
    && Math.abs(candidate.score - winner.score) <= SCORE_EPSILON
  ));
  if (tied.length > 1) {
    return emptyResult("ambiguous", sources, familyIds);
  }

  return {
    version: COMBINED_NUMBER_ALGORITHM_VERSION,
    status: "consensus",
    number: winner.number,
    score: winner.score,
    sourceCount: sources.length,
    familyCount: familyIds.length,
    supportCount: winner.supportCount,
    familySupportCount: winner.familySupportCount,
    sourceIds: sources.map(({ id }) => id).sort(),
    familyIds: [...familyIds].sort(),
  };
}
