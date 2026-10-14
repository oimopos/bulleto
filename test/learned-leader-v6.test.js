import test from "node:test";
import assert from "node:assert/strict";

import {
  LEARNED_LEADER_V6_ALGORITHM_VERSION,
  buildLearnedLeaderV6Decision,
  buildLearnedLeaderV6Families,
  evaluateLearnedLeaderV6Decision,
  learnLeaderV6FamilyWeights,
  normalizeLearnedLeaderV6Decision,
} from "../src/learned-leader-v6.js";

const BASE = Date.parse("2026-10-14T00:00:00.000Z");
const iso = (seconds) => new Date(BASE + seconds * 1_000).toISOString();

function pointMass(number) {
  return Array.from({ length: 37 }, (_, candidate) => (
    candidate === number ? 1 : 0
  ));
}

function priceSource(overrides = {}) {
  return {
    id: "price-trajectory-rank37",
    family: "price",
    numbers: [7, 8],
    weights: [0.8, 0.2],
    cursor: {
      forecastId: 41,
      cutoffAt: iso(100),
      evidenceCandidateCount: 8,
    },
    ...overrides,
  };
}

function conditionalSource(kind, {
  id = `conditional-${kind}-full`,
  numbers = [7],
  weights = [1],
  sampleSize = 1,
  effectiveSampleSize,
} = {}) {
  return {
    id,
    family: "conditional-history",
    numbers,
    weights,
    cursor: {
      historyMaxResultId: 900,
      cutoffAt: iso(100),
      sampleSize,
      ...(effectiveSampleSize === undefined ? {} : { effectiveSampleSize }),
    },
  };
}

function learningRow({
  id = "row-1",
  lockedAt = iso(0),
  completedAt = iso(10),
  actualNumber = 7,
  algorithmVersion = LEARNED_LEADER_V6_ALGORITHM_VERSION,
} = {}) {
  return {
    id,
    algorithmVersion,
    lockedAt,
    completedAt,
    actualNumber,
    familyDistributions: {
      price: pointMass(7),
      "conditional-history": pointMass(8),
    },
  };
}

test("price is one calibrated distribution and range does not cast a second vote", () => {
  const families = buildLearnedLeaderV6Families([
    priceSource(),
    {
      id: "price-trajectory-range",
      family: "price",
      mode: "set",
      numbers: [20, 21, 22],
      cursor: { forecastId: 41, cutoffAt: iso(100) },
    },
  ]);

  const expectedSeven = 0.85 * 0.8 + 0.15 / 37;
  assert.ok(Math.abs(families.familyDistributions.price[7] - expectedSeven) < 1e-12);
  assert.equal(families.evidence.price.sourceId, "price-trajectory-rank37");
  assert.equal(
    families.sourceAudit.find(({ id }) => id === "price-trajectory-range").used,
    false,
  );
  assert.ok(Math.abs(families.familyDistributions.price[20] - 0.15 / 37) < 1e-12);
});

test("an already smoothed Rank-37 distribution is preserved without a second mix", () => {
  const source = priceSource({
    id: "price-trajectory-rank37-smoothed",
    cursor: {
      forecastId: 41,
      cutoffAt: iso(100),
      evidenceCandidateCount: 8,
      massKind: "smoothed",
    },
  });
  const families = buildLearnedLeaderV6Families([source]);
  const expected = Array(37).fill(0);
  expected[7] = 0.8;
  expected[8] = 0.2;

  assert.deepEqual(families.familyDistributions.price, expected);
  assert.equal(families.evidence.price.uniformMix, 0);
});

test("a singleton triple backs off almost entirely to its smoothed pair", () => {
  const withoutTriple = buildLearnedLeaderV6Families([
    conditionalSource("pair", {
      numbers: [7, 8],
      weights: [0.9, 0.1],
      sampleSize: 500,
    }),
  ]);
  const withTriple = buildLearnedLeaderV6Families([
    conditionalSource("pair", {
      numbers: [7, 8],
      weights: [0.9, 0.1],
      sampleSize: 500,
    }),
    conditionalSource("triple", {
      numbers: [36],
      weights: [1],
      sampleSize: 1,
    }),
  ]);

  const base = withoutTriple.familyDistributions["conditional-history"];
  const backedOff = withTriple.familyDistributions["conditional-history"];
  assert.ok(backedOff[7] > backedOff[36]);
  assert.ok(backedOff[36] - base[36] < 0.02);
  assert.equal(withTriple.evidence.conditionalHistory.tripleReliability, 1 / 51);
});

test("large pair evidence dominates a sparse triple in the final decision", () => {
  const decision = buildLearnedLeaderV6Decision({
    sources: [
      priceSource({ numbers: [7, 8], weights: [0.51, 0.49] }),
      conditionalSource("pair", {
        numbers: [7, 8],
        weights: [0.95, 0.05],
        sampleSize: 1_000,
      }),
      conditionalSource("triple", {
        numbers: [36],
        weights: [1],
        sampleSize: 1,
      }),
    ],
    lockedAt: iso(100),
    tieSeed: "large-pair-sparse-triple",
  });

  assert.equal(decision.status, "ready");
  assert.equal(decision.leaderNumber, 7);
  assert.ok(decision.familyDistributions["conditional-history"][7] > 0.8);
  assert.ok(decision.familyWeights["conditional-history"] < 0.3);
});

test("duplicate evidence aliases and live-fixed do not change probability mass", () => {
  const baseSources = [
    priceSource(),
    conditionalSource("pair", { sampleSize: 500 }),
  ];
  const base = buildLearnedLeaderV6Decision({
    sources: baseSources,
    lockedAt: iso(100),
    tieSeed: "duplicates",
  });
  const duplicated = buildLearnedLeaderV6Decision({
    sources: [
      ...baseSources,
      priceSource({ id: "price-alias" }),
      conditionalSource("pair", { id: "conditional-pair-alias", sampleSize: 500 }),
      {
        id: "conditional-live-fixed",
        family: "conditional-history",
        numbers: [36, 35, 34, 33, 32],
        cursor: { historyMaxResultId: 900, cutoffAt: iso(100) },
      },
    ],
    lockedAt: iso(100),
    tieSeed: "duplicates",
  });

  assert.deepEqual(duplicated.combinedDistribution, base.combinedDistribution);
  assert.equal(duplicated.leaderNumber, base.leaderNumber);
  assert.equal(
    duplicated.sourceAudit.find(({ id }) => id === "conditional-live-fixed").reason,
    "derived_live_vote",
  );
  assert.equal(duplicated.usedSourceCount, 2);
});

test("snapshot is normalized, deterministic, immutable, and JSON round-trippable", () => {
  const args = {
    sources: [
      priceSource(),
      conditionalSource("pair", { sampleSize: 571 }),
      conditionalSource("triple", {
        numbers: [8, 7],
        weights: [0.6, 0.4],
        sampleSize: 15,
      }),
    ],
    learningRows: [],
    lockedAt: iso(100),
    tieSeed: "round-4108230",
  };
  const first = buildLearnedLeaderV6Decision(args);
  const second = buildLearnedLeaderV6Decision({
    ...args,
    sources: [...args.sources].reverse(),
  });

  assert.deepEqual(second, first);
  assert.ok(Math.abs(first.combinedDistribution.reduce((sum, mass) => sum + mass, 0) - 1)
    < 1e-12);
  assert.equal(first.ranking.length, 37);
  assert.equal(new Set(first.ranking.map(({ number }) => number)).size, 37);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.combinedDistribution), true);
  assert.equal(first.selection.eligible, true);
  assert.equal(first.selection.reason, "eligible");
  assert.throws(() => first.combinedDistribution[0] = 1, TypeError);

  const wire = JSON.parse(JSON.stringify(first));
  assert.deepEqual(normalizeLearnedLeaderV6Decision(wire), first);
  assert.equal(normalizeLearnedLeaderV6Decision({ ...wire, leaderNumber: 36 }), null);
  const evaluation = evaluateLearnedLeaderV6Decision(first, first.leaderNumber);
  assert.equal(evaluation.top1Hit, true);
  assert.equal(evaluation.selected, true);
  assert.equal(Number.isFinite(evaluation.combinedClippedLogLoss), true);
  assert.equal(
    evaluation.familyEvaluations.price.top1Number,
    first.familyDistributions.price.indexOf(
      Math.max(...first.familyDistributions.price),
    ),
  );
  assert.equal(Object.isFrozen(evaluation), true);
});

test("decision and normalizer reject non-causal or non-canonical source manifests", () => {
  assert.throws(() => buildLearnedLeaderV6Decision({
    sources: [priceSource({
      cursor: {
        forecastId: 41,
        cutoffAt: iso(101),
        evidenceCandidateCount: 8,
      },
    })],
    lockedAt: iso(100),
    tieSeed: "future-source",
  }), /cutoffAt must equal lockedAt/);

  const decision = buildLearnedLeaderV6Decision({
    sources: [priceSource()],
    lockedAt: iso(100),
    tieSeed: "canonical-source",
  });
  const extraSourceField = JSON.parse(JSON.stringify(decision));
  extraSourceField.sourceManifest[0].unexpected = true;
  assert.equal(normalizeLearnedLeaderV6Decision(extraSourceField), null);

  const paddedSeed = JSON.parse(JSON.stringify(decision));
  paddedSeed.tieSeed = ` ${paddedSeed.tieSeed} `;
  assert.equal(normalizeLearnedLeaderV6Decision(paddedSeed), null);

  const extraLearningWeight = JSON.parse(JSON.stringify(decision));
  extraLearningWeight.learning.familyWeights.unexpected = 0;
  assert.equal(normalizeLearnedLeaderV6Decision(extraLearningWeight), null);
});

test("selective gate abstains on sparse history without suppressing the shadow ranking", () => {
  const decision = buildLearnedLeaderV6Decision({
    sources: [
      priceSource(),
      conditionalSource("pair", { sampleSize: 3 }),
    ],
    lockedAt: iso(100),
    tieSeed: "sparse-selective-gate",
  });

  assert.equal(decision.status, "ready");
  assert.equal(Number.isInteger(decision.leaderNumber), true);
  assert.equal(decision.selection.eligible, false);
  assert.equal(decision.selection.reason, "sparse_pair_history");
  assert.ok(decision.selection.reasons.includes("sparse_pair_history"));
});

test("learning is causal: a row completed at or after lock cannot train it", () => {
  const future = learningRow({
    id: "future",
    lockedAt: iso(90),
    completedAt: iso(100),
  });
  const before = learnLeaderV6FamilyWeights([future], iso(100));
  assert.equal(before.trainingCount, 0);
  assert.equal(before.excludedNotPastCount, 1);
  assert.equal(before.familyWeights.price, 0.7);

  const after = learnLeaderV6FamilyWeights([future], iso(101));
  assert.equal(after.trainingCount, 1);
  assert.ok(after.familyWeights.price > 0.7);
  assert.equal(after.trainingThroughId, "future");
});

test("incompatible historical rows fall back to the static regularized blend", () => {
  const learning = learnLeaderV6FamilyWeights([
    learningRow({ algorithmVersion: "learned-predictive-family-index-v5" }),
  ], iso(20));

  assert.equal(learning.status, "regularized_static");
  assert.equal(learning.trainingCount, 0);
  assert.equal(learning.skippedAlgorithmCount, 1);
  assert.deepEqual(learning.familyWeights, {
    price: 0.7,
    "conditional-history": 0.30000000000000004,
  });
});
