import test from "node:test";
import assert from "node:assert/strict";

import {
  LEARNED_LEADER_ALGORITHM_VERSION,
  LEARNED_LEADER_UNIFORM_BRIER_LOSS,
  buildLearnedLeaderDecision,
  buildLearnedLeaderFamilies,
  evaluateLearnedLeaderDecision,
  learnLeaderFamilyWeights,
  learnedLeaderBrierLoss,
  normalizeLearnedLeaderDecision,
} from "../src/learned-leader.js";

const BASE = Date.parse("2026-10-10T00:00:00.000Z");
const iso = (offsetSeconds) => new Date(BASE + offsetSeconds * 1_000).toISOString();

function pointMass(number) {
  return Array.from({ length: 37 }, (_, candidate) => (
    candidate === number ? 1 : 0
  ));
}

function learningRow({
  id = "1",
  actualNumber = 7,
  price = pointMass(7),
  conditional = pointMass(8),
  lockedAt = iso(0),
  completedAt = iso(10),
  includePrice = true,
  includeConditional = true,
} = {}) {
  return {
    id,
    algorithmVersion: LEARNED_LEADER_ALGORITHM_VERSION,
    lockedAt,
    completedAt,
    actualNumber,
    familyDistributions: {
      ...(includePrice ? { price } : {}),
      ...(includeConditional
        ? { "conditional-history": conditional }
        : {}),
    },
  };
}

const currentSources = [
  {
    id: "price-rank37",
    family: "price",
    numbers: [7, 11, 19],
    weights: [0.6, 0.3, 0.1],
  },
  {
    id: "conditional-pairs",
    family: "conditional-history",
    numbers: [8, 7, 12],
    weights: [0.5, 0.3, 0.2],
  },
];

test("learned leader starts at an exact 50/50 cold start", () => {
  const learning = learnLeaderFamilyWeights([], iso(20));

  assert.equal(learning.status, "cold_start");
  assert.equal(learning.trainingCount, 0);
  assert.equal(learning.familyWeights.price, 0.5);
  assert.equal(learning.familyWeights["conditional-history"], 0.5);
  assert.equal(learning.trainingThroughId, null);
});

test("one settled common-cohort row shifts only future weight toward lower Brier loss", () => {
  const row = learningRow();
  const before = learnLeaderFamilyWeights([row], iso(10));
  const after = learnLeaderFamilyWeights([row], iso(11));

  assert.equal(before.trainingCount, 0);
  assert.equal(before.excludedNotPastCount, 1);
  assert.equal(before.familyWeights.price, 0.5);
  assert.equal(after.trainingCount, 1);
  assert.ok(after.familyWeights.price > 0.5);
  assert.ok(after.familyWeights.price < 0.51, "cold-start shrinkage must be gentle");
  assert.equal(after.trainingThroughId, "1");
});

test("single-family historical rows never train relative family weight", () => {
  const learning = learnLeaderFamilyWeights([
    learningRow({ includeConditional: false }),
  ], iso(11));

  assert.equal(learning.trainingCount, 0);
  assert.equal(learning.skippedIncompleteFamilyCount, 1);
  assert.equal(learning.familyWeights.price, 0.5);
});

test("learning replay is chronological and invariant to input order", () => {
  const rows = [
    learningRow({ id: "a", completedAt: iso(10) }),
    learningRow({
      id: "b",
      actualNumber: 8,
      lockedAt: iso(11),
      completedAt: iso(20),
    }),
  ];
  const forward = learnLeaderFamilyWeights(rows, iso(21));
  const reversed = learnLeaderFamilyWeights([...rows].reverse(), iso(21));

  assert.deepEqual(reversed, forward);
  assert.equal(forward.trainingCount, 2);
  assert.equal(forward.trainingThroughId, "b");
});

test("learning becomes adaptive only after thirty completed common-family snapshots", () => {
  const rows = Array.from({ length: 30 }, (_, index) => learningRow({
    id: String(index + 1),
    lockedAt: iso(index * 2),
    completedAt: iso(index * 2 + 1),
  }));
  const beforeThreshold = learnLeaderFamilyWeights(rows.slice(0, 29), iso(70));
  const atThreshold = learnLeaderFamilyWeights(rows, iso(70));

  assert.equal(beforeThreshold.status, "cold_start");
  assert.equal(beforeThreshold.trainingCount, 29);
  assert.equal(atThreshold.status, "adaptive");
  assert.equal(atThreshold.trainingCount, 30);
  assert.equal(atThreshold.trainingThroughId, "30");
  assert.ok(atThreshold.familyWeights.price > beforeThreshold.familyWeights.price);
  assert.ok(atThreshold.familyWeights.price <= 0.85);
  assert.ok(atThreshold.familyWeights["conditional-history"] >= 0.15);
});

test("family builder preserves explicit mass and averages correlated sources", () => {
  const value = buildLearnedLeaderFamilies([
    ...currentSources,
    {
      id: "price-range",
      family: "price",
      mode: "set",
      numbers: [7, 8],
    },
  ]);

  assert.equal(value.sourceManifest.length, 3);
  assert.ok(Math.abs(value.familyDistributions.price[7] - 0.55) < 1e-12);
  assert.ok(Math.abs(value.familyDistributions.price[8] - 0.25) < 1e-12);
  assert.ok(
    Math.abs(value.familyDistributions.price.reduce((sum, mass) => sum + mass, 0) - 1)
      < 1e-12,
  );
  assert.deepEqual(value.familyDistributions["conditional-history"].slice(7, 9), [0.3, 0.5]);
});

test("source audit cursors are JSON-frozen without affecting evidence deduplication", () => {
  const sources = [
    {
      id: "price-primary",
      family: "price",
      numbers: [7],
      weights: [1],
      cursor: { forecastId: 41, cutoffAt: iso(20) },
    },
    {
      id: "price-alias",
      family: "price",
      numbers: [7],
      weights: [1],
      cursor: { forecastId: 42, cutoffAt: iso(20) },
    },
  ];
  const value = buildLearnedLeaderFamilies(sources);

  assert.equal(value.sourceManifest.length, 1);
  assert.deepEqual(value.sourceManifest[0].cursor, sources[1].cursor);
  assert.deepEqual(sources[0].cursor, { forecastId: 41, cutoffAt: iso(20) });
});

test("decision freezes all 37 masses and exactly one deterministic leader", () => {
  const decision = buildLearnedLeaderDecision({
    sources: currentSources,
    learningRows: [],
    lockedAt: iso(20),
    tieSeed: "round-4105000",
  });

  assert.equal(decision.status, "ready");
  assert.equal(decision.algorithmVersion, LEARNED_LEADER_ALGORITHM_VERSION);
  assert.equal(decision.leaderNumber, 7);
  assert.equal(decision.ranking.length, 37);
  assert.equal(new Set(decision.ranking.map(({ number }) => number)).size, 37);
  assert.equal(decision.combinedDistribution.length, 37);
  assert.deepEqual(decision.familyWeights, {
    price: 0.5,
    "conditional-history": 0.5,
  });
  assert.deepEqual(normalizeLearnedLeaderDecision(decision), decision);
});

test("unweighted ranking and set sources survive the stored decision round trip", () => {
  for (const source of [
    {
      id: "conditional-ranking",
      family: "conditional-history",
      numbers: [7, 11, 19],
    },
    {
      id: "price-range",
      family: "price",
      mode: "set",
      numbers: [7, 8, 9],
    },
  ]) {
    const decision = buildLearnedLeaderDecision({
      sources: [{
        ...source,
        cursor: { cutoffAt: iso(20) },
      }],
      learningRows: [],
      lockedAt: iso(20),
      tieSeed: `round-trip-${source.id}`,
    });

    assert.equal(decision.status, "ready");
    assert.equal(decision.sourceManifest[0].weights, null);
    assert.deepEqual(normalizeLearnedLeaderDecision(decision), decision);
  }
});

test("weighted Rank-37 and its unweighted display range round trip together", () => {
  const decision = buildLearnedLeaderDecision({
    sources: [
      {
        id: "price-trajectory-rank37",
        family: "price",
        numbers: [25, 13, 5],
        weights: [0.5, 0.3, 0.2],
        cursor: { forecastId: 41, cutoffAt: iso(20) },
      },
      {
        id: "price-trajectory-range",
        family: "price",
        mode: "set",
        numbers: [19, 20, 21],
        cursor: { forecastId: 41, cutoffAt: iso(20) },
      },
    ],
    learningRows: [],
    lockedAt: iso(20),
    tieSeed: "production-shaped-price-family",
  });

  assert.equal(decision.status, "ready");
  assert.equal(decision.sourceManifest.length, 2);
  assert.deepEqual(normalizeLearnedLeaderDecision(decision), decision);
});

test("settlement evaluates the immutable decision with proper Brier and hit metrics", () => {
  const decision = buildLearnedLeaderDecision({
    sources: currentSources,
    learningRows: [],
    lockedAt: iso(20),
    tieSeed: "round-4105000",
  });
  const hit = evaluateLearnedLeaderDecision(decision, 7);
  const miss = evaluateLearnedLeaderDecision(decision, 8);

  assert.equal(hit.top1Hit, true);
  assert.equal(hit.top3Hit, true);
  assert.equal(miss.top1Hit, false);
  assert.equal(miss.top3Hit, true);
  assert.equal(hit.uniformBrierLoss, LEARNED_LEADER_UNIFORM_BRIER_LOSS);
  assert.ok(hit.familyLosses.price < hit.familyLosses["conditional-history"]);
  assert.ok(learnedLeaderBrierLoss(pointMass(7), 7) === 0);
  assert.ok(learnedLeaderBrierLoss(pointMass(7), 8) === 1);
});

test("unavailable decision is explicit and never invents a number", () => {
  const decision = buildLearnedLeaderDecision({
    sources: [],
    learningRows: [],
    lockedAt: iso(20),
    tieSeed: "round-4105000",
  });

  assert.equal(decision.status, "unavailable");
  assert.equal(decision.leaderNumber, null);
  assert.deepEqual(decision.ranking, []);
  assert.deepEqual(normalizeLearnedLeaderDecision(decision), decision);
  assert.throws(() => evaluateLearnedLeaderDecision(decision, 7));
});

test("invalid sources, duplicate learning rows, and tampered decisions fail closed", () => {
  assert.throws(() => buildLearnedLeaderFamilies([
    currentSources[0],
    { ...currentSources[0] },
  ]), /duplicate source id/);
  assert.throws(() => learnLeaderFamilyWeights([
    learningRow({ id: "same" }),
    learningRow({ id: "same" }),
  ], iso(11)), /duplicate learning row/);

  const decision = buildLearnedLeaderDecision({
    sources: currentSources,
    learningRows: [],
    lockedAt: iso(20),
    tieSeed: "round-4105000",
  });
  assert.equal(normalizeLearnedLeaderDecision({
    ...decision,
    leaderNumber: 36,
  }), null);
  assert.equal(normalizeLearnedLeaderDecision({
    ...decision,
    combinedDistribution: decision.combinedDistribution.map((mass, index) => (
      index === 0 ? mass + 0.01 : mass
    )),
  }), null);
  assert.equal(normalizeLearnedLeaderDecision({
    ...decision,
    learning: {
      ...decision.learning,
      trainingCount: "0",
    },
  }), null);
  assert.equal(normalizeLearnedLeaderDecision({
    ...decision,
    familyWeights: {
      price: 0.6,
      "conditional-history": 0.4,
    },
    combinedDistribution: decision.combinedDistribution,
  }), null);
  assert.throws(() => buildLearnedLeaderFamilies([{
    id: "numeric-string",
    family: "price",
    numbers: ["7"],
  }]));
  assert.throws(() => buildLearnedLeaderFamilies([{
    id: "invalid-cursor",
    family: "price",
    numbers: [7],
    cursor: { historyMaxResultId: Number.NaN },
  }]));
});
