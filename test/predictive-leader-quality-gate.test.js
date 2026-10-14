import assert from "node:assert/strict";
import test from "node:test";

import {
  assessPredictiveLeaderQualityGate,
  PREDICTIVE_LEADER_QUALITY_GATE,
} from "../src/predictive-leader-quality-gate.js";

function settledLeader(top1Hit) {
  return { evaluation: { top1Hit } };
}

test("quality gate waits for a complete fixed cohort of 1000 prospective leaders", () => {
  const partial = assessPredictiveLeaderQualityGate(
    Array.from({ length: 999 }, () => settledLeader(true)),
  );
  assert.equal(partial.status, "collecting");
  assert.equal(partial.reason, "insufficient_sample");
  assert.equal(partial.eligible, false);
  assert.equal(partial.cohortSize, 999);
  assert.equal(partial.sampleSize, 999);
  assert.equal(partial.lowerBound, null);

  const pending = assessPredictiveLeaderQualityGate([
    ...Array.from({ length: 999 }, () => settledLeader(true)),
    { evaluation: null },
  ]);
  assert.equal(pending.status, "pending");
  assert.equal(pending.reason, "cohort_pending");
  assert.equal(pending.eligible, false);
  assert.equal(pending.sampleSize, 999);
});

test("quality gate confirms only when the fixed cohort lower Wilson bound beats roulette", () => {
  const strong = assessPredictiveLeaderQualityGate([
    ...Array.from({ length: 100 }, () => settledLeader(true)),
    ...Array.from({ length: 900 }, () => settledLeader(false)),
  ]);
  assert.equal(strong.status, "confirmed");
  assert.equal(strong.eligible, true);
  assert.equal(strong.cohortSize, PREDICTIVE_LEADER_QUALITY_GATE.requiredSampleSize);
  assert.ok(strong.lowerBound > 1 / 37);

  const chanceLike = assessPredictiveLeaderQualityGate(
    Array.from({ length: 1_000 }, () => settledLeader(false)),
  );
  assert.equal(chanceLike.status, "rejected");
  assert.equal(chanceLike.eligible, false);
  assert.ok(chanceLike.lowerBound <= 1 / 37);
});

test("quality gate freezes the first cohort and fails closed on invalid rows", () => {
  const rejected = assessPredictiveLeaderQualityGate([
    ...Array.from({ length: 1_000 }, () => settledLeader(false)),
    ...Array.from({ length: 1_000 }, () => settledLeader(true)),
  ]);
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.cohortSize, 1_000);
  assert.equal(rejected.sampleSize, 1_000);

  const invalid = assessPredictiveLeaderQualityGate(
    Array.from({ length: 1_000 }, () => settledLeader(true)),
    1,
  );
  assert.equal(invalid.status, "invalid");
  assert.equal(invalid.reason, "invalid_evaluation");
  assert.equal(invalid.eligible, false);
  assert.equal(invalid.lowerBound, null);
});
