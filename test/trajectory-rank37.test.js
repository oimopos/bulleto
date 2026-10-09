import assert from "node:assert/strict";
import test from "node:test";

import {
  TRAJECTORY_RANK37_BASIS,
  TRAJECTORY_RANK37_EVIDENCE_MASS_THRESHOLD,
  TRAJECTORY_RANK37_MIN_TRAINING_COUNT,
  TRAJECTORY_RANK37_SMOOTHING_WEIGHT,
  TRAJECTORY_RANK37_VERSION,
  buildTrajectoryRank37,
} from "../src/trajectory-rank37.js";

function bands() {
  return Array.from({ length: 38 }, (_, wireCell) => ({
    wireCell,
    number: wireCell === 37 ? 0 : wireCell,
    lower: 37 - wireCell,
    upper: 38 - wireCell,
  }));
}

function readyExpert(id, ensembleWeight, neighborDistribution) {
  return {
    id,
    status: "ready",
    ensembleWeight,
    neighborDistribution,
  };
}

function candidate(result, number) {
  return result.ranking.find((entry) => entry.number === number);
}

function closeTo(actual, expected, epsilon = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function baseInput() {
  return {
    bands: bands(),
    lockPrice: 20.5,
    medianCellWidth: 1,
    adaptive: {
      trainingCount: 30,
      experts: [
        readyExpert("local", 0.6, [
          { id: "local-flat", deltaCellWidths: 0, weight: 0.75 },
          { id: "local-up", deltaCellWidths: 1, weight: 0.25 },
        ]),
        readyExpert("broad", 0.4, [
          { id: "broad-up", deltaCellWidths: 1, weight: 0.5 },
          { id: "broad-down", deltaCellWidths: -1, weight: 0.5 },
        ]),
      ],
    },
    tieSeed: "round-4090339",
  };
}

test("projects frozen adaptive neighbor mass and ranks every canonical number", () => {
  const input = baseInput();
  const before = structuredClone(input);
  const result = buildTrajectoryRank37(input);
  const baseline = 1 / 37;
  const smooth = TRAJECTORY_RANK37_SMOOTHING_WEIGHT;

  assert.equal(TRAJECTORY_RANK37_VERSION, "trajectory-rank37-v1");
  assert.equal(
    TRAJECTORY_RANK37_BASIS,
    "adaptive-weighted-neighbor-delta-to-current-bands",
  );
  assert.equal(smooth, 0.05);
  assert.equal(TRAJECTORY_RANK37_MIN_TRAINING_COUNT, 30);
  assert.equal(result.version, TRAJECTORY_RANK37_VERSION);
  assert.equal(result.basis, TRAJECTORY_RANK37_BASIS);
  assert.equal(result.candidateCount, 37);
  assert.equal(result.evidenceCandidateCount, 3);
  assert.equal(
    result.evidenceMassThreshold,
    TRAJECTORY_RANK37_EVIDENCE_MASS_THRESHOLD,
  );
  assert.equal(result.tieSeed, input.tieSeed);
  assert.deepEqual(result.smoothing, {
    version: "uniform-mixture-v1",
    weight: smooth,
    baselineMass: baseline,
  });
  assert.equal(result.ranking.length, 37);
  assert.deepEqual(
    result.ranking.map((entry) => entry.rank),
    Array.from({ length: 37 }, (_, index) => index + 1),
  );
  assert.equal(new Set(result.ranking.map((entry) => entry.number)).size, 37);
  assert.deepEqual(
    result.ranking.slice(0, 3).map((entry) => entry.number),
    [17, 16, 18],
  );

  closeTo(candidate(result, 17).rawMass, 0.45);
  closeTo(candidate(result, 16).rawMass, 0.35);
  closeTo(candidate(result, 18).rawMass, 0.2);
  closeTo(candidate(result, 17).mass, 0.45 * (1 - smooth) + smooth * baseline);
  closeTo(candidate(result, 16).mass, 0.35 * (1 - smooth) + smooth * baseline);
  closeTo(candidate(result, 18).mass, 0.2 * (1 - smooth) + smooth * baseline);
  closeTo(
    result.ranking.reduce((sum, entry) => sum + entry.rawMass, 0),
    1,
  );
  closeTo(
    result.ranking.reduce((sum, entry) => sum + entry.mass, 0),
    1,
  );
  assert.deepEqual(input, before, "rank37 must not mutate its frozen inputs");
});

test("combines the upper and lower wire zero into one canonical candidate", () => {
  const result = buildTrajectoryRank37({
    bands: bands(),
    lockPrice: 18.5,
    medianCellWidth: 2,
    adaptive: {
      trainingCount: 30,
      experts: [
        readyExpert("two-zero-bands", 1, [
          { id: "above-top", deltaCellWidths: 10, weight: 0.4 },
          { id: "below-bottom", deltaCellWidths: -10, weight: 0.6 },
        ]),
      ],
    },
    tieSeed: "zero-bands",
  });

  assert.equal(result.ranking[0].number, 0);
  assert.equal(result.evidenceCandidateCount, 1);
  closeTo(result.ranking[0].rawMass, 1);
  assert.equal(
    result.ranking.filter((entry) => entry.number === 0).length,
    1,
  );
  assert.ok(result.ranking.slice(1).every((entry) => entry.rawMass === 0));
});

test("is deterministic, order-invariant, and uses the round seed only for ties", () => {
  const input = baseInput();
  const before = structuredClone(input);
  const first = buildTrajectoryRank37(input);
  const repeated = buildTrajectoryRank37(input);
  const reversed = buildTrajectoryRank37({
    ...input,
    adaptive: {
      trainingCount: input.adaptive.trainingCount,
      experts: [...input.adaptive.experts]
        .reverse()
        .map((expert) => ({
          ...expert,
          neighborDistribution: [...expert.neighborDistribution].reverse(),
        })),
    },
  });
  const anotherSeed = buildTrajectoryRank37({
    ...input,
    tieSeed: "round-4090340",
  });

  assert.deepEqual(repeated, first);
  assert.deepEqual(
    reversed.ranking.map((entry) => entry.number),
    first.ranking.map((entry) => entry.number),
  );
  for (const entry of reversed.ranking) {
    closeTo(entry.rawMass, candidate(first, entry.number).rawMass);
    closeTo(entry.mass, candidate(first, entry.number).mass);
  }
  assert.deepEqual(
    anotherSeed.ranking.slice(0, 3).map((entry) => entry.number),
    first.ranking.slice(0, 3).map((entry) => entry.number),
    "a seed must not reorder unequal scores",
  );
  assert.notDeepEqual(
    anotherSeed.ranking.slice(3).map((entry) => entry.number),
    first.ranking.slice(3).map((entry) => entry.number),
    "a different pre-result seed should rotate the equal-score tail",
  );
  assert.deepEqual(input, before);
});

test("ignores unavailable zero-weight experts without changing ready mass", () => {
  const ready = readyExpert("ready", 1, [
    { id: "only-neighbor", deltaCellWidths: 0, weight: 1 },
  ]);
  const baseline = buildTrajectoryRank37({
    bands: bands(),
    lockPrice: 20.5,
    medianCellWidth: 1,
    adaptive: { trainingCount: 30, experts: [ready] },
    tieSeed: "unavailable-expert",
  });
  const withUnavailable = buildTrajectoryRank37({
    bands: bands(),
    lockPrice: 20.5,
    medianCellWidth: 1,
    adaptive: {
      trainingCount: 30,
      experts: [
        {
          id: "not-ready",
          status: "insufficient_neighbors",
          ensembleWeight: 0,
          neighborDistribution: "not-inspected",
        },
        ready,
      ],
    },
    tieSeed: "unavailable-expert",
  });

  assert.deepEqual(withUnavailable, baseline);
});

test("does not count sub-epsilon numerical dust as distinct evidence", () => {
  const tiny = 1e-13;
  const result = buildTrajectoryRank37({
    bands: bands(),
    lockPrice: 20.5,
    medianCellWidth: 1,
    adaptive: {
      trainingCount: 30,
      experts: [readyExpert("dust", 1, [
        { id: "main", deltaCellWidths: 0, weight: 1 - 2 * tiny },
        { id: "tiny-up", deltaCellWidths: 1, weight: tiny },
        { id: "tiny-down", deltaCellWidths: -1, weight: tiny },
      ])],
    },
    tieSeed: "dust-threshold",
  });

  assert.equal(result.evidenceCandidateCount, 1);
  assert.equal(result.ranking[0].number, 17);
  assert.ok(candidate(result, 16).rawMass > 0);
  assert.ok(candidate(result, 16).rawMass < result.evidenceMassThreshold);
});

test("rejects malformed bands, expert weights, and frozen distributions", () => {
  const input = baseInput();
  const cases = [
    {
      mutate(value) {
        value.adaptive.trainingCount = 29;
      },
      message: /trainingCount must be at least 30/,
    },
    {
      mutate(value) {
        value.bands.pop();
      },
      message: /38 wire cells/,
    },
    {
      mutate(value) {
        value.medianCellWidth = 0;
      },
      message: /must be positive/,
    },
    {
      mutate(value) {
        value.tieSeed = " ";
      },
      message: /non-empty string/,
    },
    {
      mutate(value) {
        value.adaptive.experts[0].neighborDistribution = [];
      },
      message: /frozen neighbor distribution/,
    },
    {
      mutate(value) {
        value.adaptive.experts[0].neighborDistribution[0].weight = 0.5;
      },
      message: /sum to one/,
    },
    {
      mutate(value) {
        value.adaptive.experts[0].neighborDistribution[0].deltaCellWidths = 13;
      },
      message: /distribution is invalid/,
    },
    {
      mutate(value) {
        value.adaptive.experts[1].id = value.adaptive.experts[0].id;
      },
      message: /expert.*invalid/,
    },
    {
      mutate(value) {
        value.adaptive.experts[0].ensembleWeight = 0.5;
      },
      message: /expert weights must sum to one/,
    },
  ];

  for (const { mutate, message } of cases) {
    const malformed = structuredClone(input);
    mutate(malformed);
    assert.throws(() => buildTrajectoryRank37(malformed), message);
  }
});
