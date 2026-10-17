const ROULETTE_NUMBER_COUNT = 37;
const SELECTION_COUNT = 3;

const DEFAULT_MODEL = Object.freeze({
  initialBalance: 1_000,
  initialStakePerNumber: 10,
  stakeStepPerNumber: 10,
  maxStakePerNumber: 2_500,
  grossPayoutMultiplier: 36,
  payoutIncludesStake: true,
});

export const PREDICTIVE_LEADER_NEIGHBOR_BACKTEST_MODEL = DEFAULT_MODEL;

function asSafeInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function normalizeModel(model = {}) {
  const normalized = {
    ...DEFAULT_MODEL,
    ...model,
  };
  asSafeInteger(normalized.initialBalance, "initialBalance");
  asSafeInteger(normalized.initialStakePerNumber, "initialStakePerNumber", { min: 1 });
  asSafeInteger(normalized.stakeStepPerNumber, "stakeStepPerNumber", { min: 1 });
  asSafeInteger(normalized.maxStakePerNumber, "maxStakePerNumber", { min: 1 });
  asSafeInteger(normalized.grossPayoutMultiplier, "grossPayoutMultiplier", {
    min: SELECTION_COUNT + 1,
  });
  if (normalized.payoutIncludesStake !== true) {
    throw new RangeError("payoutIncludesStake must be true");
  }
  if (normalized.initialStakePerNumber > normalized.maxStakePerNumber) {
    throw new RangeError("initialStakePerNumber cannot exceed maxStakePerNumber");
  }
  if (normalized.initialStakePerNumber % normalized.stakeStepPerNumber !== 0) {
    throw new RangeError("initialStakePerNumber must be a multiple of stakeStepPerNumber");
  }
  if (normalized.maxStakePerNumber % normalized.stakeStepPerNumber !== 0) {
    throw new RangeError("maxStakePerNumber must be a multiple of stakeStepPerNumber");
  }
  return Object.freeze(normalized);
}

function normalizeRouletteNumber(value) {
  if (
    value === null
    || value === undefined
    || typeof value === "boolean"
    || (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number < ROULETTE_NUMBER_COUNT
    ? number
    : null;
}

export function numericNeighborTargetsForLeader(value) {
  const leaderNumber = normalizeRouletteNumber(value);
  if (leaderNumber === null) {
    throw new RangeError("leaderNumber must be an integer between 0 and 36");
  }
  return [
    (leaderNumber + ROULETTE_NUMBER_COUNT - 1) % ROULETTE_NUMBER_COUNT,
    leaderNumber,
    (leaderNumber + 1) % ROULETTE_NUMBER_COUNT,
  ];
}

function nextStakePerNumber(ladderLoss, model) {
  const netHitMultiplier = model.grossPayoutMultiplier - SELECTION_COUNT;
  const recoverySteps = Math.ceil(
    ladderLoss / (netHitMultiplier * model.stakeStepPerNumber),
  );
  const requiredStakePerNumber = Math.max(
    model.initialStakePerNumber,
    recoverySteps * model.stakeStepPerNumber,
  );
  const stakePerNumber = Math.min(
    model.maxStakePerNumber,
    requiredStakePerNumber,
  );
  return {
    requiredStakePerNumber,
    stakePerNumber,
    recoveryPossible: netHitMultiplier * stakePerNumber >= ladderLoss,
  };
}

function hitKind(leaderNumber, resultNumber) {
  if (resultNumber === leaderNumber) return "exact";
  if (
    resultNumber
    === (leaderNumber + ROULETTE_NUMBER_COUNT - 1) % ROULETTE_NUMBER_COUNT
  ) {
    return "previous_numeric_neighbor";
  }
  if (resultNumber === (leaderNumber + 1) % ROULETTE_NUMBER_COUNT) {
    return "next_numeric_neighbor";
  }
  return null;
}

/**
 * Replays chronological, already-settled predictive-leader snapshots. Callers
 * are responsible for loading leaders that were immutably frozen before their
 * corresponding outcomes; this function never recomputes a historical leader.
 */
export function runPredictiveLeaderNeighborBacktest(
  observations,
  {
    requestedRoundCount,
    source = "buleto",
    instrument = "default",
    model: modelOverrides,
  } = {},
) {
  if (!Array.isArray(observations)) {
    throw new TypeError("observations must be an array");
  }
  const safeRequestedRoundCount = requestedRoundCount ?? observations.length;
  asSafeInteger(safeRequestedRoundCount, "requestedRoundCount");
  const model = normalizeModel(modelOverrides);

  let balance = model.initialBalance;
  let peakBalance = balance;
  let minimumBalance = balance;
  let maximumDrawdown = 0;
  let ladderLoss = 0;
  let ladderMissCount = 0;
  let previousContinuityEpoch = null;
  let exhausted = false;
  let exhaustedAt = null;
  let stoppedBeforeForecastId = null;
  let stoppedBeforeResultId = null;
  let betCount = 0;
  let hitCount = 0;
  let exactHitCount = 0;
  let neighborOnlyHitCount = 0;
  let missCount = 0;
  let totalStaked = 0;
  let totalGrossPayout = 0;
  let maxStakePerNumber = 0;
  let maxTicketCost = 0;
  let continuityGapCount = 0;
  let validLeaderCount = 0;
  let unavailableLeaderCount = 0;
  let invalidDataCount = 0;
  let skippedAfterExhaustionCount = 0;
  let firstBetAt = null;
  let lastBetAt = null;

  const rounds = observations.map((observation, index) => {
    if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
      throw new TypeError(`observations[${index}] must be an object`);
    }

    const continuityEpoch = Number(observation.continuityEpoch);
    const hasContinuityEpoch = Number.isInteger(continuityEpoch) && continuityEpoch >= 0;
    const gapBefore = previousContinuityEpoch !== null
      && (!hasContinuityEpoch || continuityEpoch !== previousContinuityEpoch);
    const ladderResetBefore = gapBefore && !exhausted;
    if (gapBefore) continuityGapCount += 1;
    if (ladderResetBefore) {
      ladderLoss = 0;
      ladderMissCount = 0;
    }
    previousContinuityEpoch = hasContinuityEpoch ? continuityEpoch : null;

    const availability = observation.availability ?? "ready";
    const leaderNumber = availability === "ready"
      ? normalizeRouletteNumber(observation.leaderNumber)
      : null;
    const resultNumber = normalizeRouletteNumber(observation.resultNumber);
    const unavailable = availability === "unavailable";
    const observationIsValid = availability === "ready"
      && leaderNumber !== null
      && resultNumber !== null;
    if (observationIsValid) validLeaderCount += 1;
    else if (unavailable) unavailableLeaderCount += 1;
    else invalidDataCount += 1;

    const targetNumbers = observationIsValid
      ? numericNeighborTargetsForLeader(leaderNumber)
      : null;
    const common = {
      resultId: observation.resultId ?? null,
      externalRoundId: observation.externalRoundId ?? null,
      settledAt: observation.settledAt ?? null,
      forecastId: observation.forecastId ?? null,
      lockedAt: observation.lockedAt ?? null,
      continuityEpoch: hasContinuityEpoch ? continuityEpoch : null,
      gapBefore,
      ladderResetBefore,
      leaderNumber,
      resultNumber: observationIsValid ? resultNumber : observation.resultNumber ?? null,
      targetNumbers,
      selectionCount: observationIsValid ? SELECTION_COUNT : 0,
    };

    if (exhausted) {
      skippedAfterExhaustionCount += 1;
      return {
        ...common,
        status: "not_played_after_exhaustion",
        skipReason: "bankroll_exhausted",
        balanceBefore: balance,
        balanceAfter: balance,
        ladderLossBefore: ladderLoss,
        ladderLossAfter: ladderLoss,
      };
    }

    if (!observationIsValid) {
      return {
        ...common,
        status: "skipped",
        skipReason: unavailable ? "leader_unavailable" : "invalid_snapshot",
        balanceBefore: balance,
        balanceAfter: balance,
        ladderLossBefore: ladderLoss,
        ladderLossAfter: ladderLoss,
      };
    }

    const ladderLossBefore = ladderLoss;
    const ladderMissCountBefore = ladderMissCount;
    const stake = nextStakePerNumber(ladderLossBefore, model);
    const ticketCost = SELECTION_COUNT * stake.stakePerNumber;
    const balanceBefore = balance;
    if (ticketCost > balanceBefore) {
      exhausted = true;
      exhaustedAt = observation.settledAt ?? null;
      stoppedBeforeForecastId = observation.forecastId ?? null;
      stoppedBeforeResultId = observation.resultId ?? null;
      return {
        ...common,
        status: "not_played",
        skipReason: "bankroll_exhausted",
        balanceBefore,
        balanceAfter: balance,
        ladderLossBefore,
        ladderLossAfter: ladderLoss,
        ladderMissCountBefore,
        ladderMissCountAfter: ladderMissCount,
        ...stake,
        ticketCost,
        shortfall: ticketCost - balanceBefore,
      };
    }

    const kind = hitKind(leaderNumber, resultNumber);
    const hit = kind !== null;
    const exactHit = kind === "exact";
    const grossPayout = hit
      ? model.grossPayoutMultiplier * stake.stakePerNumber
      : 0;
    const netChange = grossPayout - ticketCost;
    balance = balanceBefore + netChange;
    betCount += 1;
    totalStaked += ticketCost;
    totalGrossPayout += grossPayout;
    maxStakePerNumber = Math.max(maxStakePerNumber, stake.stakePerNumber);
    maxTicketCost = Math.max(maxTicketCost, ticketCost);
    firstBetAt ??= observation.settledAt ?? null;
    lastBetAt = observation.settledAt ?? null;
    if (hit) {
      hitCount += 1;
      exactHitCount += Number(exactHit);
      neighborOnlyHitCount += Number(!exactHit);
      ladderLoss = 0;
      ladderMissCount = 0;
    } else {
      missCount += 1;
      ladderLoss += ticketCost;
      ladderMissCount += 1;
    }
    peakBalance = Math.max(peakBalance, balance);
    minimumBalance = Math.min(minimumBalance, balance);
    maximumDrawdown = Math.max(maximumDrawdown, peakBalance - balance);

    return {
      ...common,
      status: "bet",
      skipReason: null,
      outcome: hit ? "hit" : "miss",
      hit,
      exactHit,
      hitKind: kind,
      balanceBefore,
      balanceAfter: balance,
      ladderLossBefore,
      ladderLossAfter: ladderLoss,
      ladderMissCountBefore,
      ladderMissCountAfter: ladderMissCount,
      ...stake,
      ticketCost,
      grossPayout,
      netChange,
    };
  });

  const roundCount = observations.length;
  const status = roundCount === 0 ? "empty" : exhausted ? "exhausted" : "completed";
  return {
    schemaVersion: 1,
    mode: "retrospective-simulation",
    strategyMode: "frozen-predictive-leader-numeric-neighbor-ladder",
    executionEnabled: false,
    advisoryOnly: true,
    status,
    reason: status === "exhausted"
      ? "bankroll_exhausted"
      : status === "empty"
        ? "no_settled_rounds"
        : "window_completed",
    source,
    instrument,
    strategy: {
      order: "settled-at-ascending",
      windowStartPolicy: "reset-ladder",
      continuityGapPolicy: "reset-ladder-keep-balance",
      missingLeaderPolicy: "skip-round-keep-ladder",
      exhaustionPolicy: "stop-before-unaffordable-ticket",
      selectionMode: "frozen-before-result-leader-plus-numeric-neighbors",
      neighborPolicy: "modulo-37",
    },
    model,
    initialBalance: model.initialBalance,
    finalBalance: balance,
    netResult: balance - model.initialBalance,
    betCount,
    hitCount,
    exactHitCount,
    neighborOnlyHitCount,
    missCount,
    hitRate: betCount > 0 ? hitCount / betCount : null,
    exactHitRate: betCount > 0 ? exactHitCount / betCount : null,
    totalStaked,
    totalGrossPayout,
    peakBalance,
    minimumBalance,
    maximumDrawdown,
    maxStakePerNumber,
    maxTicketCost,
    firstBetAt,
    lastBetAt,
    exhaustedAt,
    stoppedBeforeForecastId,
    stoppedBeforeResultId,
    ladder: {
      missCount: ladderMissCount,
      totalLoss: ladderLoss,
    },
    coverage: {
      requestedRoundCount: safeRequestedRoundCount,
      roundCount,
      validLeaderCount,
      unavailableLeaderCount,
      invalidDataCount,
      skippedAfterExhaustionCount,
      continuityGapCount,
      completeWindow: roundCount === safeRequestedRoundCount,
      allRoundsBettable: validLeaderCount === roundCount,
      firstResultId: observations[0]?.resultId ?? null,
      lastResultId: observations.at(-1)?.resultId ?? null,
      from: observations[0]?.settledAt ?? null,
      to: observations.at(-1)?.settledAt ?? null,
    },
    rounds,
  };
}
