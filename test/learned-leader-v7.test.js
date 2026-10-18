import assert from "node:assert/strict";
import test from "node:test";

import {
  LEARNED_LEADER_V7_ALGORITHM_VERSION,
  LEARNED_LEADER_V7_CONFIG_VERSION,
  LEARNED_LEADER_V7_TARGET_HORIZON,
  LEARNED_LEADER_V7_UNIFORM_BRIER_LOSS,
  LEARNED_LEADER_V7_UNIFORM_BASELINE_CURSOR,
  LEARNED_LEADER_V7_UNIFORM_DISTRIBUTION,
  buildLearnedLeaderV7Decision,
  buildLearnedLeaderV7Families,
  createLearnedLeaderV7Config,
  evaluateLearnedLeaderV7Decision,
  learnedLeaderV7BrierLoss,
  learnedLeaderV7ClippedLogLoss,
  normalizeLearnedLeaderV7Decision,
} from "../src/learned-leader-v7.js";

const LOCKED_AT = "2026-10-18T10:00:00.000Z";
const NUMBERS = Object.freeze(Array.from({ length: 37 }, (_, number) => number));

function closeTo(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function pointMass(number) {
  return NUMBERS.map((candidate) => (candidate === number ? 1 : 0));
}

function candidateConfig(overrides = {}) {
  return {
    version: LEARNED_LEADER_V7_CONFIG_VERSION,
    candidateId: "unit-test-candidate-only",
    targetHorizon: LEARNED_LEADER_V7_TARGET_HORIZON,
    price: {
      temperature: 2,
      baselineMix: 0.25,
      ...overrides.price,
    },
    history: {
      pairPriorStrength: 37,
      tripleBackoffStrength: 10,
      ...overrides.history,
    },
    blend: {
      price: 0.5,
      conditionalHistory: 0.3,
      baseline: 0.2,
      ...overrides.blend,
    },
    selection: {
      minimumPriceEvidenceCandidates: 2,
      minimumPairEffectiveSampleSize: 5,
      minimumLeaderMass: 0.04,
      minimumMargin: 0.001,
      ...overrides.selection,
    },
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => ![
        "price",
        "history",
        "blend",
        "selection",
      ].includes(key)),
    ),
  };
}

function rawPriceSource({
  id = "price-trajectory-rank37-raw",
  distribution = pointMass(7),
  cutoffAt = LOCKED_AT,
  evidenceCandidateCount,
} = {}) {
  return {
    id,
    family: "price",
    numbers: [...NUMBERS],
    weights: [...distribution],
    cursor: {
      cutoffAt,
      targetHorizon: LEARNED_LEADER_V7_TARGET_HORIZON,
      scoreKind: "raw-rank37",
      evidenceCandidateCount: evidenceCandidateCount
        ?? distribution.filter((mass) => mass > 1e-12).length,
    },
  };
}

function historySource({
  kind = "pair",
  id = kind === "pair" ? "conditional-pair-full" : "conditional-triple-full",
  number = kind === "pair" ? 8 : 9,
  sampleSize = 10,
  effectiveSampleSize = sampleSize,
  cutoffAt = LOCKED_AT,
} = {}) {
  return {
    id,
    family: "conditional-history",
    numbers: [number],
    weights: [1],
    cursor: {
      cutoffAt,
      targetHorizon: LEARNED_LEADER_V7_TARGET_HORIZON,
      sampleSize,
      effectiveSampleSize,
    },
  };
}

test("requires an explicit, canonical and deeply frozen candidate config", () => {
  assert.throws(
    () => buildLearnedLeaderV7Families({ sources: [] }),
    /config must have the canonical v7 shape/,
  );

  const input = candidateConfig();
  const config = createLearnedLeaderV7Config(input);

  assert.deepEqual(config, input);
  assert.notEqual(config, input);
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.price));
  assert.ok(Object.isFrozen(config.selection));
  assert.throws(() => {
    config.price.temperature = 99;
  }, TypeError);
  assert.throws(
    () => createLearnedLeaderV7Config({ ...input, unexpected: true }),
    /canonical v7 shape/,
  );
  assert.throws(
    () => createLearnedLeaderV7Config(candidateConfig({
      blend: { price: 0.5, conditionalHistory: 0.5, baseline: 0 },
    })),
    /baseline must be positive/,
  );
});

test("temperature-calibrates only raw Rank-37 mass, then shrinks to baseline", () => {
  const raw = pointMass(7).map(() => 0);
  raw[7] = 0.8;
  raw[8] = 0.2;
  const families = buildLearnedLeaderV7Families({
    sources: [rawPriceSource({ distribution: raw })],
    config: candidateConfig(),
  });
  const price = families.familyDistributions.price;

  closeTo(price[7], 0.75 * (2 / 3) + 0.25 / 37);
  closeTo(price[8], 0.75 * (1 / 3) + 0.25 / 37);
  closeTo(price[0], 0.25 / 37);
  closeTo(price.reduce((sum, mass) => sum + mass, 0), 1);
  assert.deepEqual(families.evidence.price, {
    sourceId: "price-trajectory-rank37-raw",
    scoreKind: "raw-rank37",
    evidenceCandidateCount: 2,
    temperature: 2,
    baselineMix: 0.25,
  });
});

test("temperature calibration remains finite for every positive finite setting", () => {
  const raw = Array(37).fill(1 / 37);
  raw[7] += 1e-6;
  raw[8] -= 1e-6;
  const families = buildLearnedLeaderV7Families({
    sources: [rawPriceSource({ distribution: raw })],
    config: candidateConfig({
      price: { temperature: Number.MIN_VALUE, baselineMix: 0 },
    }),
  });
  const price = families.familyDistributions.price;

  assert.equal(price[7], 1);
  assert.ok(price.every(Number.isFinite));
  closeTo(price.reduce((sum, mass) => sum + mass, 0), 1);
});

test("applies hierarchical pair-to-baseline and triple-to-pair shrinkage", () => {
  const families = buildLearnedLeaderV7Families({
    sources: [
      historySource({ kind: "pair", number: 7, sampleSize: 37 }),
      historySource({ kind: "triple", number: 8, sampleSize: 10 }),
    ],
    config: candidateConfig(),
  });
  const history = families.familyDistributions["conditional-history"];
  const pairAtSeven = 0.5 + 0.5 / 37;
  const pairElsewhere = 0.5 / 37;

  closeTo(history[7], 0.5 * pairAtSeven);
  closeTo(history[8], 0.5 + 0.5 * pairElsewhere);
  closeTo(history[9], 0.5 * pairElsewhere);
  closeTo(history.reduce((sum, mass) => sum + mass, 0), 1);
  assert.deepEqual(families.evidence.conditionalHistory, {
    pairSourceId: "conditional-pair-full",
    pairSampleSize: 37,
    pairEffectiveSampleSize: 37,
    pairPriorStrength: 37,
    tripleSourceId: "conditional-triple-full",
    tripleSampleSize: 10,
    tripleEffectiveSampleSize: 10,
    tripleBackoffStrength: 10,
    backoff: "triple-to-pair-posterior",
  });
});

test("deduplicates correlated source lineages and never counts derived votes twice", () => {
  const canonicalSources = [
    rawPriceSource({ distribution: pointMass(5) }),
    historySource({ kind: "pair", number: 6, sampleSize: 1 }),
  ];
  const withAliases = [
    {
      id: "conditional-live-fixed",
      family: "conditional-history",
      numbers: [20],
      weights: [1],
      cursor: {
        cutoffAt: LOCKED_AT,
        targetHorizon: LEARNED_LEADER_V7_TARGET_HORIZON,
      },
    },
    rawPriceSource({
      id: "price-rank37-raw-alias",
      distribution: [...LEARNED_LEADER_V7_UNIFORM_DISTRIBUTION],
      evidenceCandidateCount: 37,
    }),
    {
      ...rawPriceSource({
        id: "price-trajectory-rank37-smoothed",
        distribution: pointMass(31),
      }),
      cursor: {
        cutoffAt: LOCKED_AT,
        targetHorizon: LEARNED_LEADER_V7_TARGET_HORIZON,
        scoreKind: "smoothed-rank37",
        evidenceCandidateCount: 1,
      },
    },
    {
      id: "price-trajectory-range",
      family: "price",
      numbers: [11, 12, 13],
      weights: null,
      cursor: {
        cutoffAt: LOCKED_AT,
        targetHorizon: LEARNED_LEADER_V7_TARGET_HORIZON,
      },
    },
    historySource({
      kind: "pair",
      id: "conditional-pair-alias",
      number: 10,
      sampleSize: 99,
    }),
    ...canonicalSources,
  ];
  const config = candidateConfig();
  const canonical = buildLearnedLeaderV7Families({
    sources: canonicalSources,
    config,
  });
  const deduplicated = buildLearnedLeaderV7Families({
    sources: withAliases,
    config,
  });

  assert.deepEqual(
    deduplicated.familyDistributions,
    canonical.familyDistributions,
  );
  assert.equal(
    deduplicated.sourceAudit.find(({ id }) => id === "price-rank37-raw-alias").reason,
    "duplicate_lineage",
  );
  assert.equal(
    deduplicated.sourceAudit.find(({ id }) => id === "conditional-pair-alias").reason,
    "duplicate_lineage",
  );
  assert.equal(
    deduplicated.sourceAudit.find(({ id }) => id === "price-trajectory-range").reason,
    "derived_price_vote",
  );
  assert.equal(
    deduplicated.sourceAudit.find(
      ({ id }) => id === "price-trajectory-rank37-smoothed",
    ).reason,
    "non_raw_price_score",
  );
  assert.equal(
    deduplicated.sourceAudit.find(({ id }) => id === "conditional-live-fixed").reason,
    "derived_live_vote",
  );
  assert.equal(deduplicated.sourceAudit.filter(({ used }) => used).length, 2);

  assert.throws(() => buildLearnedLeaderV7Families({
    sources: [rawPriceSource({
      distribution: pointMass(5),
      evidenceCandidateCount: 37,
    })],
    config,
  }), /evidenceCandidateCount does not match raw mass/);
});

test("unavailable snapshots fail closed and preserve every selective reason", () => {
  const decision = buildLearnedLeaderV7Decision({
    sources: [],
    config: candidateConfig({
      selection: {
        minimumPriceEvidenceCandidates: 0,
        minimumPairEffectiveSampleSize: 1,
        minimumLeaderMass: 0,
        minimumMargin: 0,
      },
    }),
    lockedAt: LOCKED_AT,
    tieSeed: "unavailable-round",
  });

  assert.equal(decision.status, "unavailable");
  assert.equal(decision.leaderNumber, null);
  assert.deepEqual(decision.ranking, []);
  assert.deepEqual(decision.selection.reasons, [
    "price_unavailable",
    "history_unavailable",
    "weak_price_evidence",
    "sparse_pair_history",
    "leader_mass_below_threshold",
    "small_margin",
  ]);
  assert.equal(decision.selection.eligible, false);
  assert.deepEqual(normalizeLearnedLeaderV7Decision(decision), decision);
  assert.throws(() => evaluateLearnedLeaderV7Decision(decision, 7));
});

test("zero-weight families are audit-only and cannot make a baseline-only candidate ready", () => {
  const baselineOnly = buildLearnedLeaderV7Decision({
    sources: [rawPriceSource()],
    config: candidateConfig({
      blend: { price: 0, conditionalHistory: 0, baseline: 1 },
    }),
    lockedAt: LOCKED_AT,
    tieSeed: "baseline-only",
  });
  assert.equal(baselineOnly.status, "unavailable");
  assert.equal(baselineOnly.familyCount, 0);
  assert.equal(baselineOnly.selection.signals.requiresPrice, false);
  assert.ok(!baselineOnly.selection.reasons.includes("price_unavailable"));
  assert.ok(!baselineOnly.selection.reasons.includes("weak_price_evidence"));

  const historyOnly = buildLearnedLeaderV7Decision({
    sources: [historySource({ kind: "pair", sampleSize: 20 })],
    config: candidateConfig({
      blend: { price: 0, conditionalHistory: 0.8, baseline: 0.2 },
    }),
    lockedAt: LOCKED_AT,
    tieSeed: "history-only",
  });
  assert.equal(historyOnly.status, "ready");
  assert.equal(historyOnly.familyCount, 1);
  assert.ok(!historyOnly.selection.reasons.includes("price_unavailable"));
  assert.ok(!historyOnly.selection.reasons.includes("weak_price_evidence"));
});

test("decision is order-invariant, immutable, deterministic and self-validating", () => {
  const sources = [
    rawPriceSource({ distribution: pointMass(7) }),
    historySource({ kind: "pair", number: 8, sampleSize: 20 }),
    historySource({ kind: "triple", number: 9, sampleSize: 4 }),
  ];
  const input = structuredClone(sources);
  const args = {
    config: candidateConfig(),
    lockedAt: LOCKED_AT,
    tieSeed: "round-immutable",
  };
  const forward = buildLearnedLeaderV7Decision({ sources, ...args });
  const reversed = buildLearnedLeaderV7Decision({
    sources: [...sources].reverse(),
    ...args,
  });

  assert.deepEqual(reversed, forward);
  assert.deepEqual(sources, input);
  assert.equal(forward.algorithmVersion, LEARNED_LEADER_V7_ALGORITHM_VERSION);
  assert.equal(forward.shadow, true);
  assert.equal(forward.targetHorizon, 1);
  assert.deepEqual(
    forward.baselineCursor,
    LEARNED_LEADER_V7_UNIFORM_BASELINE_CURSOR,
  );
  assert.equal(forward.status, "ready");
  assert.equal(forward.ranking.length, 37);
  assert.ok(Object.isFrozen(forward));
  assert.ok(Object.isFrozen(forward.sourceManifest[0].cursor));
  assert.ok(Object.isFrozen(forward.combinedDistribution));
  assert.throws(() => {
    forward.combinedDistribution[0] = 1;
  }, TypeError);
  assert.deepEqual(
    normalizeLearnedLeaderV7Decision(JSON.parse(JSON.stringify(forward))),
    forward,
  );

  const tamperedMass = structuredClone(forward);
  tamperedMass.combinedDistribution[0] += 0.01;
  assert.equal(normalizeLearnedLeaderV7Decision(tamperedMass), null);
  const tamperedManifest = structuredClone(forward);
  tamperedManifest.sourceManifest[0].unexpected = "not-canonical";
  assert.equal(normalizeLearnedLeaderV7Decision(tamperedManifest), null);
});

test("enforces the prospective lock boundary on every frozen source", () => {
  assert.throws(() => buildLearnedLeaderV7Decision({
    sources: [rawPriceSource({ cutoffAt: "2026-10-18T10:00:01.000Z" })],
    config: candidateConfig(),
    lockedAt: LOCKED_AT,
    tieSeed: "future-source",
  }), /every source cursor must match lockedAt/);

  assert.throws(() => buildLearnedLeaderV7Decision({
    sources: [{
      ...rawPriceSource(),
      cursor: {
        cutoffAt: LOCKED_AT,
      },
    }],
    config: candidateConfig(),
    lockedAt: LOCKED_AT,
    tieSeed: "missing-source-cursor",
  }), /targetHorizon must be exactly one round/);
});

test("uses a uniform default baseline but accepts an explicit positive causal baseline", () => {
  const defaultFamilies = buildLearnedLeaderV7Families({
    sources: [historySource({ kind: "pair", number: 7, sampleSize: 37 })],
    config: candidateConfig(),
  });
  assert.deepEqual(
    defaultFamilies.baselineDistribution,
    LEARNED_LEADER_V7_UNIFORM_DISTRIBUTION,
  );

  const causalBaseline = Array(37).fill(0.5 / 36);
  causalBaseline[0] = 0.5;
  const explicitFamilies = buildLearnedLeaderV7Families({
    sources: [historySource({ kind: "pair", number: 7, sampleSize: 37 })],
    baselineDistribution: causalBaseline,
    baselineCursor: {
      kind: "causal-climatology",
      cutoffAt: LOCKED_AT,
      targetHorizon: LEARNED_LEADER_V7_TARGET_HORIZON,
      trainingCount: 100,
    },
    config: candidateConfig(),
  });
  closeTo(explicitFamilies.baselineDistribution[0], 0.5);
  closeTo(
    explicitFamilies.familyDistributions["conditional-history"][0],
    0.25,
  );
  assert.deepEqual(causalBaseline, [0.5, ...Array(36).fill(0.5 / 36)]);
});

test("non-uniform baseline fails closed without a matching causal cutoff", () => {
  const causalBaseline = Array(37).fill(0.5 / 36);
  causalBaseline[0] = 0.5;

  assert.throws(() => buildLearnedLeaderV7Families({
    sources: [],
    baselineDistribution: causalBaseline,
    config: candidateConfig(),
  }), /causal baselineCursor/);

  assert.throws(() => buildLearnedLeaderV7Decision({
    sources: [],
    baselineDistribution: causalBaseline,
    baselineCursor: {
      kind: "causal-climatology",
      cutoffAt: "2026-10-18T09:59:59.000Z",
      targetHorizon: LEARNED_LEADER_V7_TARGET_HORIZON,
    },
    config: candidateConfig(),
    lockedAt: LOCKED_AT,
    tieSeed: "stale-baseline",
  }), /baselineCursor.cutoffAt must equal lockedAt/);
});

test("scores the frozen exact-number distribution with Brier and clipped log loss", () => {
  const hit = pointMass(7);
  const miss = pointMass(8);

  assert.equal(learnedLeaderV7BrierLoss(hit, 7), 0);
  assert.equal(learnedLeaderV7BrierLoss(miss, 7), 1);
  closeTo(
    learnedLeaderV7BrierLoss(LEARNED_LEADER_V7_UNIFORM_DISTRIBUTION, 7),
    LEARNED_LEADER_V7_UNIFORM_BRIER_LOSS,
  );
  assert.equal(learnedLeaderV7ClippedLogLoss(hit, 7), 0);
  closeTo(learnedLeaderV7ClippedLogLoss(miss, 7), -Math.log(1e-15));

  const decision = buildLearnedLeaderV7Decision({
    sources: [
      rawPriceSource({ distribution: hit }),
      historySource({ kind: "pair", number: 8, sampleSize: 20 }),
    ],
    config: candidateConfig(),
    lockedAt: LOCKED_AT,
    tieSeed: "exact-objective",
  });
  const evaluation = evaluateLearnedLeaderV7Decision(decision, 7);

  assert.equal(evaluation.actualNumber, 7);
  assert.equal(evaluation.top1Hit, decision.leaderNumber === 7);
  assert.equal(evaluation.selected, decision.selection.eligible);
  closeTo(
    evaluation.combinedBrierLoss,
    learnedLeaderV7BrierLoss(decision.combinedDistribution, 7),
  );
  closeTo(evaluation.baselineBrierLoss, LEARNED_LEADER_V7_UNIFORM_BRIER_LOSS);
  assert.deepEqual(
    Object.keys(evaluation.familyEvaluations).sort(),
    ["baseline", "conditional-history", "price"],
  );
  assert.ok(Number.isFinite(evaluation.combinedClippedLogLoss));
});
