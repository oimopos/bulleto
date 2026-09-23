import assert from "node:assert/strict";
import test from "node:test";

import { BET_RISK_MODEL, calculateBetRisk } from "../public/risk-calculator.js";

test("risk calculator repeats a stake while its net win still covers prior losses", () => {
  assert.deepEqual(calculateBetRisk(0), {
    roundsMissed: 0,
    nextAttempt: 1,
    nextStake: 10,
    simulatedPriorLoss: 0,
    totalLossIfNextMiss: 10,
    grossPayoutIfHit: 360,
    netIfNextHits: 350,
    capped: false,
    recoveryPossible: true,
  });

  assert.deepEqual(calculateBetRisk(35), {
    roundsMissed: 35,
    nextAttempt: 36,
    nextStake: 10,
    simulatedPriorLoss: 350,
    totalLossIfNextMiss: 360,
    grossPayoutIfHit: 360,
    netIfNextHits: 0,
    capped: false,
    recoveryPossible: true,
  });
});

test("stake rises by the smallest ten-unit step needed to recover", () => {
  assert.deepEqual(calculateBetRisk(36), {
    roundsMissed: 36,
    nextAttempt: 37,
    nextStake: 20,
    simulatedPriorLoss: 360,
    totalLossIfNextMiss: 380,
    grossPayoutIfHit: 720,
    netIfNextHits: 340,
    capped: false,
    recoveryPossible: true,
  });
  assert.deepEqual(calculateBetRisk(54), {
    roundsMissed: 54,
    nextAttempt: 55,
    nextStake: 30,
    simulatedPriorLoss: 720,
    totalLossIfNextMiss: 750,
    grossPayoutIfHit: 1080,
    netIfNextHits: 330,
    capped: false,
    recoveryPossible: true,
  });
});

test("143 missed rounds use the gradual recovery ladder", () => {
  assert.deepEqual(calculateBetRisk(143), {
    roundsMissed: 143,
    nextAttempt: 144,
    nextStake: 310,
    simulatedPriorLoss: 10760,
    totalLossIfNextMiss: 11070,
    grossPayoutIfHit: 11160,
    netIfNextHits: 90,
    capped: false,
    recoveryPossible: true,
  });
});

test("maximum stake eventually prevents full recovery while losses keep growing", () => {
  assert.deepEqual(calculateBetRisk(216), {
    roundsMissed: 216,
    nextAttempt: 217,
    nextStake: 2440,
    simulatedPriorLoss: 85260,
    totalLossIfNextMiss: 87700,
    grossPayoutIfHit: 87840,
    netIfNextHits: 140,
    capped: false,
    recoveryPossible: true,
  });

  assert.deepEqual(calculateBetRisk(217), {
    roundsMissed: 217,
    nextAttempt: 218,
    nextStake: 2500,
    simulatedPriorLoss: 87700,
    totalLossIfNextMiss: 90200,
    grossPayoutIfHit: 90000,
    netIfNextHits: -200,
    capped: true,
    recoveryPossible: false,
  });
});

test("every next round continues from the exact previous modeled loss", () => {
  for (let misses = 0; misses < 300; misses += 1) {
    const current = calculateBetRisk(misses);
    const next = calculateBetRisk(misses + 1);
    assert.equal(next.simulatedPriorLoss, current.totalLossIfNextMiss);
    assert.equal(current.nextStake % BET_RISK_MODEL.stakeStep, 0);
    assert.ok(current.nextStake <= BET_RISK_MODEL.maxStake);
  }
});

test("invalid and excessively large round counts are rejected without overflow", () => {
  for (const value of [null, "", -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => calculateBetRisk(value), TypeError);
  }
  assert.throws(
    () => calculateBetRisk(BET_RISK_MODEL.maxModeledMisses + 1),
    RangeError,
  );
  assert.equal(calculateBetRisk(BET_RISK_MODEL.maxModeledMisses).nextStake, 2500);
});
