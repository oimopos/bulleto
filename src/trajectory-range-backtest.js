const DEFAULT_MODEL = Object.freeze({
  initialBalance: 1_000,
  initialStakePerNumber: 10,
  stakeStepPerNumber: 10,
  maxStakePerNumber: 2_500,
  grossPayoutMultiplier: 36,
  payoutIncludesStake: true,
});

export const TRAJECTORY_RANGE_BACKTEST_MODEL = DEFAULT_MODEL;

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
  asSafeInteger(normalized.grossPayoutMultiplier, "grossPayoutMultiplier", { min: 2 });
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

function normalizeTargetNumbers(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) return null;
  const numbers = value.map(Number);
  if (
    numbers.some((number) => !Number.isInteger(number) || number < 0 || number > 36)
    || new Set(numbers).size !== numbers.length
  ) {
    return null;
  }
  return numbers;
}

function nextStakePerNumber(ladderLoss, selectionCount, model) {
  const netHitMultiplier = model.grossPayoutMultiplier - selectionCount;
  if (netHitMultiplier <= 0) {
    throw new RangeError("selectionCount must be below grossPayoutMultiplier");
  }
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

/**
 * Replays already-settled rounds. Each target range must have been frozen before
 * its result; callers are responsible for loading those immutable snapshots.
 */
export function runTrajectoryRangeBacktest(
  observations,
  {
    requestedRoundCount = 100,
    source = "buleto",
    instrument = "default",
    model: modelOverrides,
  } = {},
) {
  if (!Array.isArray(observations)) {
    throw new TypeError("observations must be an array");
  }
  asSafeInteger(requestedRoundCount, "requestedRoundCount", { min: 1 });
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
  let stoppedBeforeResultId = null;
  let hitCount = 0;
  let missCount = 0;
  let betCount = 0;
  let totalStaked = 0;
  let totalGrossPayout = 0;
  let maxStakePerNumber = 0;
  let maxTicketCost = 0;
  let continuityGapCount = 0;
  let validRangeCount = 0;
  let unavailableRangeCount = 0;
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
    if (gapBefore) {
      continuityGapCount += 1;
    }
    if (ladderResetBefore) {
      ladderLoss = 0;
      ladderMissCount = 0;
    }
    previousContinuityEpoch = hasContinuityEpoch ? continuityEpoch : null;

    const common = {
      resultId: observation.resultId ?? null,
      externalRoundId: observation.externalRoundId ?? null,
      settledAt: observation.settledAt ?? null,
      forecastId: observation.forecastId ?? null,
      lockedAt: observation.lockedAt ?? null,
      continuityEpoch: hasContinuityEpoch ? continuityEpoch : null,
      gapBefore,
      ladderResetBefore,
      resultNumber: observation.resultNumber ?? null,
      rawCell: observation.rawCell ?? null,
      forecastDisplayHit: observation.forecastDisplayHit ?? null,
      targetNumbers: null,
      selectionCount: 0,
    };
    const availability = observation.availability ?? "ready";
    const targetNumbers = availability === "ready"
      ? normalizeTargetNumbers(observation.targetNumbers)
      : null;
    const resultNumber = Number(observation.resultNumber);
    const resultIsValid = Number.isInteger(resultNumber)
      && resultNumber >= 0
      && resultNumber <= 36;
    const unavailable = availability === "unavailable";
    const rangeIsValid = availability === "ready"
      && targetNumbers !== null
      && resultIsValid;
    if (rangeIsValid) validRangeCount += 1;
    else if (unavailable) unavailableRangeCount += 1;
    else invalidDataCount += 1;

    const normalizedCommon = rangeIsValid
      ? {
          ...common,
          resultNumber,
          targetNumbers,
          selectionCount: targetNumbers.length,
        }
      : common;

    if (exhausted) {
      skippedAfterExhaustionCount += 1;
      return {
        ...normalizedCommon,
        status: "not_played_after_exhaustion",
        skipReason: "bankroll_exhausted",
        balanceBefore: balance,
        balanceAfter: balance,
        ladderLossBefore: ladderLoss,
        ladderLossAfter: ladderLoss,
      };
    }

    if (!rangeIsValid) {
      return {
        ...common,
        status: "skipped",
        skipReason: unavailable ? "range_unavailable" : "invalid_snapshot",
        balanceBefore: balance,
        balanceAfter: balance,
        ladderLossBefore: ladderLoss,
        ladderLossAfter: ladderLoss,
      };
    }

    const selectionCount = targetNumbers.length;
    const ladderLossBefore = ladderLoss;
    const ladderMissCountBefore = ladderMissCount;
    const stake = nextStakePerNumber(ladderLossBefore, selectionCount, model);
    const ticketCost = selectionCount * stake.stakePerNumber;
    const balanceBefore = balance;
    if (ticketCost > balanceBefore) {
      exhausted = true;
      exhaustedAt = observation.settledAt ?? null;
      stoppedBeforeResultId = observation.resultId ?? null;
      return {
        ...normalizedCommon,
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

    const hit = targetNumbers.includes(resultNumber);
    const grossPayout = hit
      ? model.grossPayoutMultiplier * stake.stakePerNumber
      : 0;
    const netChange = grossPayout - ticketCost;
    balance = balanceBefore + netChange;
    totalStaked += ticketCost;
    totalGrossPayout += grossPayout;
    betCount += 1;
    maxStakePerNumber = Math.max(maxStakePerNumber, stake.stakePerNumber);
    maxTicketCost = Math.max(maxTicketCost, ticketCost);
    firstBetAt ??= observation.settledAt ?? null;
    lastBetAt = observation.settledAt ?? null;
    if (hit) {
      hitCount += 1;
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
      ...normalizedCommon,
      status: "bet",
      skipReason: null,
      outcome: hit ? "hit" : "miss",
      hit,
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
    strategyMode: "frozen-trajectory-display-range-ladder",
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
      missingRangePolicy: "skip-round-keep-ladder",
      exhaustionPolicy: "stop-before-unaffordable-ticket",
      selectionMode: "frozen-before-result-display-range",
    },
    model,
    initialBalance: model.initialBalance,
    finalBalance: balance,
    netResult: balance - model.initialBalance,
    betCount,
    hitCount,
    missCount,
    hitRate: betCount > 0 ? hitCount / betCount : null,
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
    stoppedBeforeResultId,
    ladder: {
      missCount: ladderMissCount,
      totalLoss: ladderLoss,
    },
    coverage: {
      requestedRoundCount,
      roundCount,
      validRangeCount,
      unavailableRangeCount,
      invalidDataCount,
      skippedAfterExhaustionCount,
      continuityGapCount,
      completeWindow: roundCount === requestedRoundCount,
      allRoundsBettable: validRangeCount === roundCount,
      firstResultId: observations[0]?.resultId ?? null,
      lastResultId: observations.at(-1)?.resultId ?? null,
      from: observations[0]?.settledAt ?? null,
      to: observations.at(-1)?.settledAt ?? null,
    },
    rounds,
  };
}
