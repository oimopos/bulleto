export const COMBINED_NUMBER_ALGORITHM_VERSION = "predictive-family-index-v4";
export const TRAJECTORY_RANK37_VERSION = "trajectory-rank37-v1";
export const TRAJECTORY_RANK37_BASIS =
  "adaptive-weighted-neighbor-delta-to-current-bands";
export const TRAJECTORY_RANK37_MIN_TRAINING_COUNT = 30;
export const TRAJECTORY_RANK37_MIN_EVIDENCE_CANDIDATES = 3;

const SCORE_EPSILON = 1e-12;
export const TRAJECTORY_RANK37_EVIDENCE_MASS_THRESHOLD =
  SCORE_EPSILON / 0.95;

function safeNonNegativeInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function safeRouletteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 36 ? number : null;
}

function sameEntityId(left, right) {
  return left !== null
    && left !== undefined
    && right !== null
    && right !== undefined
    && String(left) === String(right);
}

function validInstant(value) {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
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

export function combinedTrajectorySignals(
  value,
  minimumTrainingCount = TRAJECTORY_RANK37_MIN_TRAINING_COUNT,
) {
  const unavailable = { ranking: [], weights: [], range: [] };
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
    return unavailable;
  }

  const numberRanking = value.numberRanking;
  if (
    !numberRanking
    || typeof numberRanking !== "object"
    || Array.isArray(numberRanking)
    || numberRanking.version !== TRAJECTORY_RANK37_VERSION
    || numberRanking.basis !== TRAJECTORY_RANK37_BASIS
    || numberRanking.candidateCount !== 37
    || !Number.isSafeInteger(numberRanking.evidenceCandidateCount)
    || numberRanking.evidenceCandidateCount < TRAJECTORY_RANK37_MIN_EVIDENCE_CANDIDATES
    || numberRanking.evidenceCandidateCount > 37
    || !Number.isFinite(numberRanking.evidenceMassThreshold)
    || Math.abs(
      numberRanking.evidenceMassThreshold
      - TRAJECTORY_RANK37_EVIDENCE_MASS_THRESHOLD
    ) > 1e-18
    || typeof numberRanking.tieSeed !== "string"
    || numberRanking.tieSeed.trim() === ""
    || numberRanking.smoothing?.version !== "uniform-mixture-v1"
    || !Number.isFinite(numberRanking.smoothing?.weight)
    || Math.abs(numberRanking.smoothing?.weight - 0.05) > 1e-12
    || !Number.isFinite(numberRanking.smoothing?.baselineMass)
    || Math.abs(numberRanking.smoothing?.baselineMass - (1 / 37)) > 1e-12
    || !Array.isArray(numberRanking.ranking)
    || numberRanking.ranking.length !== 37
  ) {
    return unavailable;
  }
  const ranking = [];
  const seenRankingNumbers = new Set();
  let totalMass = 0;
  let totalRawMass = 0;
  let evidenceCandidateCount = 0;
  let previousMass = Infinity;
  for (let index = 0; index < numberRanking.ranking.length; index += 1) {
    const candidate = numberRanking.ranking[index];
    const number = safeRouletteNumber(candidate?.number);
    const mass = candidate?.mass;
    const rawMass = candidate?.rawMass;
    if (
      candidate?.rank !== index + 1
      || number === null
      || candidate.number !== number
      || seenRankingNumbers.has(number)
      || !Number.isFinite(mass)
      || mass < 0
      || mass > 1
      || !Number.isFinite(rawMass)
      || rawMass < 0
      || rawMass > 1
      || Math.abs(mass - (0.95 * rawMass + 0.05 / 37)) > 1e-12
      || mass > previousMass + SCORE_EPSILON
    ) {
      return unavailable;
    }
    if (
      index > 0
      && Math.abs(mass - previousMass) <= SCORE_EPSILON
      && tiePosition(
        ranking[index - 1],
        `${TRAJECTORY_RANK37_VERSION}:${numberRanking.tieSeed}`,
      ) > tiePosition(
        number,
        `${TRAJECTORY_RANK37_VERSION}:${numberRanking.tieSeed}`,
      )
    ) {
      return unavailable;
    }
    seenRankingNumbers.add(number);
    ranking.push(number);
    totalMass += mass;
    totalRawMass += rawMass;
    if (rawMass > TRAJECTORY_RANK37_EVIDENCE_MASS_THRESHOLD) {
      evidenceCandidateCount += 1;
    }
    previousMass = mass;
  }
  if (
    seenRankingNumbers.size !== 37
    || evidenceCandidateCount !== numberRanking.evidenceCandidateCount
    || Math.abs(totalMass - 1) > 1e-9
    || Math.abs(totalRawMass - 1) > 1e-9
  ) {
    return unavailable;
  }

  const range = value.displayRange.cells.map((cell) => {
    if (
      !Number.isInteger(cell?.wireCell)
      || cell.wireCell < 0
      || cell.wireCell > 37
      || !Number.isInteger(cell?.number)
      || cell.number !== (cell.wireCell === 37 ? 0 : cell.wireCell)
    ) {
      return null;
    }
    return cell.number;
  });
  if (
    range.length < 1
    || range.length > 6
    || range.some((number) => number === null)
    || new Set(range).size !== range.length
  ) {
    return unavailable;
  }

  const evidenceRawMass = numberRanking.ranking.map(({ rawMass }) => (
    rawMass > TRAJECTORY_RANK37_EVIDENCE_MASS_THRESHOLD ? rawMass : 0
  ));
  const evidenceTotal = evidenceRawMass.reduce((total, mass) => total + mass, 0);
  return {
    ranking,
    weights: evidenceRawMass.map((mass) => mass / evidenceTotal),
    range,
  };
}

export function combinedTrajectoryRanking(value, minimumTrainingCount = 30) {
  return combinedTrajectorySignals(value, minimumTrainingCount).ranking;
}

export function combinedOverdueRanking(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const candidates = [];
  for (const item of value) {
    const number = safeRouletteNumber(item?.number);
    const roundsSinceLast = safeNonNegativeInteger(item?.roundsSinceLast);
    const lastSeenAt = validInstant(item?.lastSeenAt);
    if (
      number === null
      || seen.has(number)
      || roundsSinceLast === null
      || lastSeenAt === null
    ) {
      continue;
    }
    seen.add(number);
    candidates.push({ number, roundsSinceLast, lastSeenAt });
  }
  return candidates
    .sort((left, right) => (
      right.roundsSinceLast - left.roundsSinceLast
      || left.lastSeenAt - right.lastSeenAt
      || left.number - right.number
    ))
    .slice(0, 3)
    .map(({ number }) => number);
}

export function combinedVirtualRecencySources(value, latestResult) {
  const latestResultId = safeNonNegativeInteger(latestResult?.id);
  const latestEpoch = safeNonNegativeInteger(latestResult?.continuityEpoch);
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.mode !== "simulation"
    || value.executionEnabled !== false
    || latestResultId === null
    || latestResultId < 1
    || latestEpoch === null
  ) {
    return [];
  }

  const sources = [];
  const session = value.activeSession;
  const status = String(value.status || "").toLowerCase();
  const sessionStatus = String(session?.status || "").toLowerCase();
  const targetNumber = safeRouletteNumber(session?.targetNumber);
  const sessionEpoch = safeNonNegativeInteger(session?.continuityEpoch);
  const attemptCount = safeNonNegativeInteger(session?.attemptCount);
  const armedIsCurrent = status === "armed"
    && sessionStatus === "armed"
    && attemptCount === 0
    && sameEntityId(session?.activatedAfterResultId, latestResultId)
    && (session?.lastBetResultId === null || session?.lastBetResultId === undefined);
  const activeIsCurrent = status === "active"
    && sessionStatus === "active"
    && attemptCount !== null
    && attemptCount > 0
    && sameEntityId(session?.lastBetResultId, latestResultId);
  if (
    targetNumber !== null
    && sessionEpoch === latestEpoch
    && (armedIsCurrent || activeIsCurrent)
  ) {
    sources.push({
      id: "recency-virtual-held",
      family: "absence",
      numbers: [targetNumber],
    });
  }
  return sources;
}

function normalizedCycleRecords(cycle) {
  if (!Array.isArray(cycle?.numbers) || cycle.numbers.length !== 37) return null;
  const records = new Map();
  for (const record of cycle.numbers) {
    const number = safeRouletteNumber(record?.number);
    if (
      number === null
      || records.has(number)
      || typeof record?.eliminated !== "boolean"
    ) {
      return null;
    }
    records.set(number, record.eliminated);
  }
  return records.size === 37 ? records : null;
}

export function combinedCycleNumberSignals(cycle, latestResult) {
  const unavailable = { remaining: [], survivor: [] };
  if (
    !cycle
    || typeof cycle !== "object"
    || Array.isArray(cycle)
    || String(cycle.integrityStatus || "").toLowerCase() !== "ok"
    || !sameEntityId(cycle.id, latestResult?.cycleId)
    || !sameInstant(cycle.lastEventAt, latestResult?.settledAt)
  ) {
    return unavailable;
  }
  const eventCount = safeNonNegativeInteger(cycle.eventCount);
  const totalDraws = safeNonNegativeInteger(cycle.totalDraws);
  const remainingCount = safeNonNegativeInteger(cycle.remainingCount);
  const eliminatedCount = safeNonNegativeInteger(cycle.eliminatedCount);
  const uniqueCount = safeNonNegativeInteger(cycle.uniqueCount);
  const records = normalizedCycleRecords(cycle);
  const rawRemaining = Array.isArray(cycle.remainingNumbers)
    ? cycle.remainingNumbers.map(safeRouletteNumber)
    : null;
  if (
    eventCount === null
    || eventCount < 1
    || totalDraws !== eventCount
    || !records
    || !rawRemaining
    || rawRemaining.some((number) => number === null)
    || new Set(rawRemaining).size !== rawRemaining.length
    || remainingCount !== rawRemaining.length
    || eliminatedCount !== 37 - rawRemaining.length
    || uniqueCount !== eliminatedCount
    || (
      latestResult?.remainingAfter !== null
      && latestResult?.remainingAfter !== undefined
      && safeNonNegativeInteger(latestResult.remainingAfter) !== rawRemaining.length
    )
  ) {
    return unavailable;
  }
  const remainingSet = new Set(rawRemaining);
  if ([...records].some(([number, eliminated]) => (
    eliminated === remainingSet.has(number)
  ))) {
    return unavailable;
  }

  const status = String(cycle.status || "").toLowerCase();
  if (status === "active" && rawRemaining.length > 0) {
    return { remaining: rawRemaining, survivor: [] };
  }
  const survivor = safeRouletteNumber(cycle.survivorNumber);
  if (
    status === "completed"
    && survivor !== null
    && rawRemaining.length === 1
    && rawRemaining[0] === survivor
    && eliminatedCount === 36
    && uniqueCount === 36
  ) {
    return { remaining: [], survivor: [survivor] };
  }
  return unavailable;
}

function normalizedCycleEventSequence(value) {
  if (!Array.isArray(value)) return null;
  const events = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    const resultId = safeNonNegativeInteger(item?.resultId ?? item?.id);
    const number = safeRouletteNumber(item?.number);
    const settledAt = validInstant(item?.settledAt);
    if (
      item?.position !== index + 1
      || resultId === null
      || resultId < 1
      || number === null
      || settledAt === null
    ) {
      return null;
    }
    events.push({ resultId, number, settledAt });
  }
  return events;
}

export function combinedCycleAnalogueRanking(value, activeCycle, latestResult) {
  const targetEvents = normalizedCycleEventSequence(value?.target?.events);
  const analogueEvents = normalizedCycleEventSequence(value?.analogue?.events);
  const targetDraws = safeNonNegativeInteger(value?.target?.cycle?.totalDraws);
  const targetEventCount = safeNonNegativeInteger(value?.target?.cycle?.eventCount);
  const analogueDraws = safeNonNegativeInteger(value?.analogue?.cycle?.totalDraws);
  const analogueEventCount = safeNonNegativeInteger(value?.analogue?.cycle?.eventCount);
  const activeDraws = safeNonNegativeInteger(activeCycle?.totalDraws);
  const activeEventCount = safeNonNegativeInteger(activeCycle?.eventCount);
  if (
    !value
    || value.schemaVersion !== 1
    || value.algorithmVersion !== "cycle-analogue-prefix-v1"
    || value.interpretation !== "descriptive-not-predictive"
    || value.anchorDrawCount !== 20
    || value.status !== "ready"
    || value.target?.mode !== "active"
    || !targetEvents
    || !analogueEvents
    || targetEvents.length < 20
    || String(activeCycle?.status || "").toLowerCase() !== "active"
    || String(activeCycle?.integrityStatus || "").toLowerCase() !== "ok"
    || String(value.target?.cycle?.status || "").toLowerCase() !== "active"
    || String(value.target?.cycle?.integrityStatus || "").toLowerCase() !== "ok"
    || String(value.analogue?.cycle?.status || "").toLowerCase() !== "completed"
    || String(value.analogue?.cycle?.integrityStatus || "").toLowerCase() !== "ok"
    || !sameEntityId(value.target?.cycle?.id, activeCycle?.id)
    || targetDraws === null
    || targetEventCount !== targetDraws
    || targetDraws !== targetEvents.length
    || activeDraws !== targetDraws
    || activeEventCount !== activeDraws
    || analogueDraws === null
    || analogueEventCount !== analogueDraws
    || analogueDraws !== analogueEvents.length
  ) {
    return [];
  }
  const latestResultId = safeNonNegativeInteger(latestResult?.id);
  const latestNumber = safeRouletteNumber(latestResult?.number);
  const lastTarget = targetEvents.at(-1);
  const anchor = targetEvents[19];
  const nextAnalogue = analogueEvents[targetEvents.length];
  if (
    latestResultId === null
    || latestResultId < 1
    || latestNumber === null
    || !lastTarget
    || !anchor
    || !nextAnalogue
    || lastTarget.resultId !== latestResultId
    || lastTarget.number !== latestNumber
    || lastTarget.settledAt !== validInstant(latestResult?.settledAt)
    || !sameEntityId(value.anchorResultId, anchor.resultId)
  ) {
    return [];
  }
  return [nextAnalogue.number];
}

export function combinedTripleFollowerRanking(value, latestResult) {
  const latestResultId = safeNonNegativeInteger(latestResult?.id);
  const latestNumber = safeRouletteNumber(latestResult?.number);
  const latestEpoch = safeNonNegativeInteger(latestResult?.continuityEpoch);
  const historyThroughResultId = safeNonNegativeInteger(value?.historyThroughResultId);
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || value.schemaVersion !== 1
    || value.algorithmVersion !== "triple-follower-current-v1"
    || value.definition !== "next-result-after-ordered-pair-within-continuity-epoch"
    || value.tieBreak !== "occurrence-count-desc,last-occurred-at-desc,number-asc"
    || !["waiting_anchor", "no_samples", "ready"].includes(value.status)
    || latestResultId === null
    || latestResultId < 1
    || latestNumber === null
    || latestEpoch === null
    || historyThroughResultId !== latestResultId
    || !sameInstant(value.historyThrough, latestResult?.settledAt)
    || !Array.isArray(value.candidates)
  ) {
    return null;
  }
  if (value.status === "waiting_anchor") {
    return value.anchor === null
      && value.sampleSize === 0
      && value.observedFollowerCount === 0
      && value.candidates.length === 0
      ? []
      : null;
  }

  const anchorEpoch = safeNonNegativeInteger(value.anchor?.continuityEpoch);
  const previousResultId = safeNonNegativeInteger(value.anchor?.previous?.resultId);
  const previousNumber = safeRouletteNumber(value.anchor?.previous?.number);
  const currentResultId = safeNonNegativeInteger(value.anchor?.current?.resultId);
  const currentNumber = safeRouletteNumber(value.anchor?.current?.number);
  const sampleSize = safeNonNegativeInteger(value.sampleSize);
  const observedFollowerCount = safeNonNegativeInteger(value.observedFollowerCount);
  const previousAt = validInstant(value.anchor?.previous?.settledAt);
  const currentAt = validInstant(value.anchor?.current?.settledAt);
  const historyThrough = validInstant(value.historyThrough);
  if (
    anchorEpoch !== latestEpoch
    || previousResultId === null
    || previousResultId < 1
    || previousResultId === latestResultId
    || previousNumber === null
    || currentResultId !== latestResultId
    || currentNumber !== latestNumber
    || currentAt !== validInstant(latestResult?.settledAt)
    || previousAt === null
    || previousAt > currentAt
    || historyThrough === null
    || sampleSize === null
    || observedFollowerCount === null
    || observedFollowerCount !== value.candidates.length
    || observedFollowerCount > 37
  ) {
    return null;
  }
  if (value.status === "no_samples") {
    return sampleSize === 0 && observedFollowerCount === 0 ? [] : null;
  }
  if (sampleSize < 1 || observedFollowerCount < 1) return null;

  const numbers = [];
  const seen = new Set();
  let countedSamples = 0;
  let previousCandidate = null;
  for (let index = 0; index < value.candidates.length; index += 1) {
    const candidate = value.candidates[index];
    const number = safeRouletteNumber(candidate?.number);
    const occurrenceCount = safeNonNegativeInteger(candidate?.occurrenceCount);
    const share = Number(candidate?.share);
    const lastOccurredAt = validInstant(candidate?.lastOccurredAt);
    if (
      candidate?.rank !== index + 1
      || number === null
      || seen.has(number)
      || occurrenceCount === null
      || occurrenceCount < 1
      || !Number.isFinite(share)
      || Math.abs(share - occurrenceCount / sampleSize) > 1e-12
      || lastOccurredAt === null
      || lastOccurredAt > historyThrough
      || (
        previousCandidate
        && (
          occurrenceCount > previousCandidate.occurrenceCount
          || (
            occurrenceCount === previousCandidate.occurrenceCount
            && lastOccurredAt > previousCandidate.lastOccurredAt
          )
          || (
            occurrenceCount === previousCandidate.occurrenceCount
            && lastOccurredAt === previousCandidate.lastOccurredAt
            && number < previousCandidate.number
          )
        )
      )
    ) {
      return null;
    }
    seen.add(number);
    numbers.push(number);
    countedSamples += occurrenceCount;
    previousCandidate = { number, occurrenceCount, lastOccurredAt };
  }
  return countedSamples === sampleSize ? numbers : null;
}

function normalizeSource(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const id = typeof value.id === "string" ? value.id.trim() : "";
  const family = typeof value.family === "string" ? value.family.trim() : "";
  const mode = value.mode === undefined ? "ranking" : value.mode;
  const hasWeights = value.weights !== undefined;
  if (
    id === ""
    || family === ""
    || !["ranking", "set"].includes(mode)
    || !Array.isArray(value.numbers)
    || value.numbers.length < 1
    || value.numbers.length > 37
    || (hasWeights && mode !== "ranking")
    || (hasWeights && !Array.isArray(value.weights))
    || (hasWeights && value.weights.length !== value.numbers.length)
  ) {
    return null;
  }

  const numbers = mode === "set"
    ? [...value.numbers].sort((left, right) => left - right)
    : [...value.numbers];
  if (
    numbers.some((number) => !Number.isInteger(number) || number < 0 || number > 36)
    || new Set(numbers).size !== numbers.length
  ) {
    return null;
  }

  let weights = null;
  if (hasWeights) {
    weights = [...value.weights];
    if (
      weights.some((weight) => (
        typeof weight !== "number"
        || !Number.isFinite(weight)
        || weight < 0
        || weight > 1
      ))
    ) {
      return null;
    }
    const totalWeight = weights.reduce((total, weight) => total + weight, 0);
    if (Math.abs(totalWeight - 1) > 1e-9) return null;
  }

  return { id, family, mode, numbers, weights };
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
    tieCount: 0,
    tieBreakApplied: false,
    sourceIds: sources.map(({ id }) => id).sort(),
    familyIds: [...families].sort(),
  };
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
  const offset = hash32(`${seed}:offset`) % 37;
  const step = (hash32(`${seed}:step`) % 36) + 1;
  let current = offset;
  for (let index = 0; index < 37; index += 1) {
    if (current === number) return index;
    current = (current + step) % 37;
  }
  return 37;
}

export function combineNumberRankings(value, { tieSeed = "" } = {}) {
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
    const weightKey = source.weights === null
      ? "default"
      : source.weights.map((weight) => weight.toPrecision(17)).join(",");
    const familyRankingKey = `${source.family}\u0000${source.mode}\u0000${source.numbers.join(",")}\u0000${weightKey}`;
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

  const candidates = new Map();
  for (const members of familySources.values()) {
    const familyCandidates = new Map();
    for (const source of members) {
      const size = source.numbers.length;
      source.numbers.forEach((number, index) => {
        const contribution = source.weights !== null
          ? source.weights[index]
          : source.mode === "set"
            ? 1 / size
            : (2 * (size - index)) / (size * (size + 1));
        if (!(contribution > SCORE_EPSILON)) return;
        const candidate = familyCandidates.get(number) ?? {
          scoreTotal: 0,
          supportCount: 0,
        };
        candidate.scoreTotal += contribution;
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

  const ranked = [...candidates.values()].map((candidate) => ({
    ...candidate,
    score: candidate.scoreTotal / familyIds.length,
  }));
  const bestScore = Math.max(...ranked.map(({ score }) => score));
  const scoreTied = ranked.filter(({ score }) => (
    Math.abs(score - bestScore) <= SCORE_EPSILON
  ));
  const bestFamilySupport = Math.max(
    ...scoreTied.map(({ familySupportCount }) => familySupportCount),
  );
  const tied = scoreTied
    .filter(({ familySupportCount }) => (
      familySupportCount === bestFamilySupport
    ))
    .sort((left, right) => (
      tiePosition(left.number, `${COMBINED_NUMBER_ALGORITHM_VERSION}:${tieSeed}`)
      - tiePosition(right.number, `${COMBINED_NUMBER_ALGORITHM_VERSION}:${tieSeed}`)
    ));
  const winner = tied[0];

  return {
    version: COMBINED_NUMBER_ALGORITHM_VERSION,
    status: "ranked",
    number: winner.number,
    score: winner.score,
    sourceCount: sources.length,
    familyCount: familyIds.length,
    supportCount: winner.supportCount,
    familySupportCount: winner.familySupportCount,
    tieCount: tied.length,
    tieBreakApplied: tied.length > 1,
    sourceIds: sources.map(({ id }) => id).sort(),
    familyIds: [...familyIds].sort(),
  };
}
