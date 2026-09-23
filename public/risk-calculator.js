export const BET_RISK_MODEL = Object.freeze({
  initialStake: 10,
  stakeStep: 10,
  maxStake: 2500,
  grossPayoutMultiplier: 36,
  rouletteNumbers: 37,
  maxModeledMisses: 1_000_000
});

const netWinMultiplier = BET_RISK_MODEL.grossPayoutMultiplier - 1;

function recoveryStakeFor(priorLoss) {
  const requiredSteps = Math.ceil(
    priorLoss / (netWinMultiplier * BET_RISK_MODEL.stakeStep)
  );
  return Math.min(
    BET_RISK_MODEL.maxStake,
    Math.max(BET_RISK_MODEL.initialStake, requiredSteps * BET_RISK_MODEL.stakeStep)
  );
}

export function calculateBetRisk(roundsMissed) {
  const misses = roundsMissed;
  if (typeof misses !== "number" || !Number.isSafeInteger(misses) || misses < 0) {
    throw new TypeError("roundsMissed must be a non-negative safe integer");
  }
  if (misses > BET_RISK_MODEL.maxModeledMisses) {
    throw new RangeError(`roundsMissed must not exceed ${BET_RISK_MODEL.maxModeledMisses}`);
  }

  let simulatedPriorLoss = 0;
  let processedMisses = 0;

  while (processedMisses < misses) {
    const stake = recoveryStakeFor(simulatedPriorLoss);
    if (stake === BET_RISK_MODEL.maxStake) {
      simulatedPriorLoss += (misses - processedMisses) * stake;
      processedMisses = misses;
      break;
    }
    simulatedPriorLoss += stake;
    processedMisses += 1;
  }

  const nextStake = recoveryStakeFor(simulatedPriorLoss);
  const totalLossIfNextMiss = simulatedPriorLoss + nextStake;
  const grossPayoutIfHit = nextStake * BET_RISK_MODEL.grossPayoutMultiplier;
  const netIfNextHits = grossPayoutIfHit - totalLossIfNextMiss;

  if (![simulatedPriorLoss, nextStake, totalLossIfNextMiss, grossPayoutIfHit, netIfNextHits]
    .every(Number.isSafeInteger)) {
    throw new RangeError("Calculated amounts exceed the safe integer range");
  }

  return Object.freeze({
    roundsMissed: misses,
    nextAttempt: misses + 1,
    nextStake,
    simulatedPriorLoss,
    totalLossIfNextMiss,
    grossPayoutIfHit,
    netIfNextHits,
    capped: nextStake === BET_RISK_MODEL.maxStake,
    recoveryPossible: netIfNextHits >= 0
  });
}
