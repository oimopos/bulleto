import test from "node:test";
import assert from "node:assert/strict";

import {
  FORECAST_CONSENSUS_ALGORITHM_VERSION,
  FORECAST_CONSENSUS_AUTHORITATIVE_MODEL_VERSION,
  FORECAST_CONSENSUS_BORDA_ALGORITHM_VERSION,
  FORECAST_CONSENSUS_MODEL_AUTHORITATIVE_ALGORITHM_VERSION,
  combineFrozenTop3,
  resolveForecastConsensusAlgorithm,
} from "../src/forecast-consensus.js";

const SNAPSHOT_AT = "2026-09-29T12:34:56.000Z";

function combine(modelTop3, pairTop3, overrides = {}) {
  return combineFrozenTop3({
    modelTop3,
    pairTop3,
    pairStatus: "ready",
    pairModelTop3: modelTop3,
    pairSampleSize: 40,
    derivedFromSnapshotAt: SNAPSHOT_AT,
    ...overrides,
  });
}

test("consensus-borda-v1 deterministically combines the two frozen rankings", () => {
  const cases = [
    {
      label: "identical rankings",
      model: [12, 16, 7],
      pair: [12, 16, 7],
      expected: [12, 16, 7],
    },
    {
      label: "reverse rankings use worst rank before the number tie-break",
      model: [1, 2, 3],
      pair: [3, 2, 1],
      expected: [2, 1, 3],
    },
    {
      label: "an overlap at rank three outranks unsupported rank-one candidates",
      model: [1, 2, 9],
      pair: [3, 4, 9],
      expected: [9, 1, 3],
    },
    {
      label: "two overlaps stay ahead of a one-source candidate",
      model: [12, 16, 7],
      pair: [12, 32, 16],
      expected: [12, 16, 32],
    },
    {
      label: "one overlap is followed by deterministic rank and number ties",
      model: [5, 10, 20],
      pair: [20, 7, 8],
      expected: [20, 5, 7],
    },
    {
      label: "disjoint rankings use equal source weights",
      model: [1, 2, 3],
      pair: [4, 5, 6],
      expected: [1, 4, 2],
    },
    {
      label: "a matching one-number pair ranking reinforces the model",
      model: [4, 12, 16],
      pair: [4],
      expected: [4, 12, 16],
    },
    {
      label: "a new one-number pair ranking participates in the ordering",
      model: [4, 12, 16],
      pair: [9],
      expected: [4, 9, 12],
    },
    {
      label: "roulette boundaries zero and thirty-six are valid",
      model: [0, 36, 18],
      pair: [36, 0, 1],
      expected: [0, 36, 1],
    },
  ];

  for (const { label, model, pair, expected } of cases) {
    const result = combine(model, pair);
    assert.equal(result.status, "combined", label);
    assert.deepEqual(result.top3, expected, label);
    assert.deepEqual(result.inputsUsed, ["model", "pair"], label);
    assert.equal(result.reason, "frozen_model_and_pair", label);
  }
});

test("consensus ordering is invariant when the equally weighted sources are swapped", () => {
  const modelFirst = combine([1, 2, 3], [4, 5, 6]);
  const pairFirst = combine([4, 5, 6], [1, 2, 3]);

  assert.deepEqual(modelFirst.top3, [1, 4, 2]);
  assert.deepEqual(pairFirst.top3, modelFirst.top3);
});

test("consensus returns complete provenance metadata without using a result", () => {
  const input = {
    modelTop3: [12, 16, 7],
    pairTop3: [12, 32, 16],
    pairStatus: "ready",
    pairModelTop3: [12, 16, 7],
    pairSampleSize: 87,
    derivedFromSnapshotAt: SNAPSHOT_AT,
    settlement: { actualNumber: 7 },
  };

  assert.deepEqual(combineFrozenTop3(input), {
    status: "combined",
    top3: [12, 16, 32],
    algorithmVersion: FORECAST_CONSENSUS_ALGORITHM_VERSION,
    pairSampleSize: 87,
    derivedFromSnapshotAt: SNAPSHOT_AT,
    inputsUsed: ["model", "pair"],
    reason: "frozen_model_and_pair",
  });
  assert.deepEqual(input.modelTop3, [12, 16, 7]);
  assert.deepEqual(input.pairTop3, [12, 32, 16]);
});

test("a pair snapshot that is not ready falls back to the complete model ranking", () => {
  assert.deepEqual(
    combineFrozenTop3({
      modelTop3: [7, 11, 19],
      pairTop3: [],
      pairStatus: "no_samples",
      pairModelTop3: [7, 11, 19],
      pairSampleSize: 0,
      derivedFromSnapshotAt: SNAPSHOT_AT,
    }),
    {
      status: "model_fallback",
      top3: [7, 11, 19],
      algorithmVersion: FORECAST_CONSENSUS_ALGORITHM_VERSION,
      pairSampleSize: 0,
      derivedFromSnapshotAt: SNAPSHOT_AT,
      inputsUsed: ["model"],
      reason: "pair_not_ready",
    },
  );
});

test("a stale or corrupt pair snapshot cannot alter a complete model ranking", () => {
  const cases = [
    {
      label: "snapshot model mismatch",
      pairTop3: [12, 32, 16],
      pairModelTop3: [12, 7, 16],
      reason: "pair_snapshot_model_mismatch",
    },
    {
      label: "duplicate pair number",
      pairTop3: [12, 12, 16],
      pairModelTop3: [12, 16, 7],
      reason: "invalid_pair_ranking",
    },
    {
      label: "out-of-range pair number",
      pairTop3: [12, 37, 16],
      pairModelTop3: [12, 16, 7],
      reason: "invalid_pair_ranking",
    },
    {
      label: "non-integer pair number",
      pairTop3: [12, 16.5, 7],
      pairModelTop3: [12, 16, 7],
      reason: "invalid_pair_ranking",
    },
    {
      label: "numeric strings are not accepted",
      pairTop3: ["12", 16, 7],
      pairModelTop3: [12, 16, 7],
      reason: "invalid_pair_ranking",
    },
    {
      label: "more than three pair numbers",
      pairTop3: [12, 16, 7, 32],
      pairModelTop3: [12, 16, 7],
      reason: "invalid_pair_ranking",
    },
  ];

  for (const { label, pairTop3, pairModelTop3, reason } of cases) {
    const result = combine([12, 16, 7], pairTop3, { pairModelTop3 });
    assert.equal(result.status, "model_fallback", label);
    assert.deepEqual(result.top3, [12, 16, 7], label);
    assert.deepEqual(result.inputsUsed, ["model"], label);
    assert.equal(result.reason, reason, label);
  }
});

test("a complete trusted pair ranking is a fallback only when the model is absent", () => {
  assert.deepEqual(
    combineFrozenTop3({
      modelTop3: null,
      pairTop3: [4, 12, 16],
      pairStatus: "ready",
      pairModelTop3: [7, 11, 19],
      pairSampleSize: 12,
      derivedFromSnapshotAt: SNAPSHOT_AT,
    }),
    {
      status: "pair_fallback",
      top3: [4, 12, 16],
      algorithmVersion: FORECAST_CONSENSUS_ALGORITHM_VERSION,
      pairSampleSize: 12,
      derivedFromSnapshotAt: SNAPSHOT_AT,
      inputsUsed: ["pair"],
      reason: "model_unavailable",
    },
  );
});

test("invalid or incomplete model rankings cannot produce an untrusted top-three", () => {
  const cases = [
    { value: [1, 2], reason: "incomplete_model_ranking" },
    { value: [1, 1, 2], reason: "invalid_model_ranking" },
    { value: [-1, 1, 2], reason: "invalid_model_ranking" },
    { value: [0, 1, 37], reason: "invalid_model_ranking" },
    { value: [0, 1.5, 2], reason: "invalid_model_ranking" },
    { value: ["0", 1, 2], reason: "invalid_model_ranking" },
    { value: [0, 1, 2, 3], reason: "invalid_model_ranking" },
    { value: "0,1,2", reason: "invalid_model_ranking" },
  ];

  for (const { value, reason } of cases) {
    const result = combineFrozenTop3({
      modelTop3: value,
      pairTop3: [4, 12, 16],
      pairStatus: "ready",
      pairModelTop3: [7, 11, 19],
    });
    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.top3, []);
    assert.deepEqual(result.inputsUsed, []);
    assert.equal(result.reason, reason);
  }
});

test("invalid optional provenance metadata is returned as null", () => {
  const result = combine([1, 2, 3], [1, 2, 3], {
    pairSampleSize: -1,
    derivedFromSnapshotAt: "not-a-date",
  });

  assert.equal(result.pairSampleSize, null);
  assert.equal(result.derivedFromSnapshotAt, null);
});

test("only the exact start-price-v2 model version selects model-authoritative finalization", () => {
  assert.equal(
    FORECAST_CONSENSUS_AUTHORITATIVE_MODEL_VERSION,
    "start-price-v2",
  );
  assert.equal(
    resolveForecastConsensusAlgorithm(
      FORECAST_CONSENSUS_AUTHORITATIVE_MODEL_VERSION,
    ),
    FORECAST_CONSENSUS_MODEL_AUTHORITATIVE_ALGORITHM_VERSION,
  );
  assert.equal(
    FORECAST_CONSENSUS_ALGORITHM_VERSION,
    FORECAST_CONSENSUS_BORDA_ALGORITHM_VERSION,
  );

  for (const modelVersion of [
    undefined,
    null,
    "",
    "start-price-v1",
    "start-price-v3",
    "start-price-v2 ",
    "Start-price-v2",
    "start-price-v20",
  ]) {
    assert.equal(
      resolveForecastConsensusAlgorithm(modelVersion),
      FORECAST_CONSENSUS_BORDA_ALGORITHM_VERSION,
      String(modelVersion),
    );
  }
});

test("start-price-v2 keeps its complete frozen model Top3 authoritative", () => {
  const modelTop3 = [1, 2, 3];
  const pairTop3 = [4, 5, 6];
  const result = combineFrozenTop3({
    modelVersion: FORECAST_CONSENSUS_AUTHORITATIVE_MODEL_VERSION,
    modelTop3,
    pairTop3,
    pairStatus: "ready",
    pairModelTop3: modelTop3,
    pairSampleSize: 87,
    derivedFromSnapshotAt: SNAPSHOT_AT,
  });

  assert.deepEqual(result, {
    status: "model_fallback",
    top3: [1, 2, 3],
    algorithmVersion:
      FORECAST_CONSENSUS_MODEL_AUTHORITATIVE_ALGORITHM_VERSION,
    pairSampleSize: 87,
    derivedFromSnapshotAt: SNAPSHOT_AT,
    inputsUsed: ["model"],
    reason: "authoritative_model",
  });
  assert.deepEqual(modelTop3, [1, 2, 3]);
  assert.deepEqual(pairTop3, [4, 5, 6]);
});

test("start-price-v2 ignores pair readiness, overlap, and corruption when the model is complete", () => {
  const cases = [
    {
      label: "matching ready pair",
      pairTop3: [12, 16, 7],
      pairStatus: "ready",
      pairModelTop3: [12, 16, 7],
    },
    {
      label: "ready pair would reorder Borda",
      pairTop3: [7, 16, 12],
      pairStatus: "ready",
      pairModelTop3: [12, 16, 7],
    },
    {
      label: "ready pair snapshot model mismatch",
      pairTop3: [32, 4, 9],
      pairStatus: "ready",
      pairModelTop3: [1, 2, 3],
    },
    {
      label: "invalid ready pair",
      pairTop3: [32, 32, 9],
      pairStatus: "ready",
      pairModelTop3: [12, 16, 7],
    },
    {
      label: "pair not ready",
      pairTop3: [],
      pairStatus: "no_samples",
      pairModelTop3: [12, 16, 7],
    },
  ];

  for (const testCase of cases) {
    const result = combineFrozenTop3({
      modelVersion: "start-price-v2",
      modelTop3: [12, 16, 7],
      pairTop3: testCase.pairTop3,
      pairStatus: testCase.pairStatus,
      pairModelTop3: testCase.pairModelTop3,
      pairSampleSize: 40,
      derivedFromSnapshotAt: SNAPSHOT_AT,
    });

    assert.equal(result.status, "model_fallback", testCase.label);
    assert.deepEqual(result.top3, [12, 16, 7], testCase.label);
    assert.equal(
      result.algorithmVersion,
      FORECAST_CONSENSUS_MODEL_AUTHORITATIVE_ALGORITHM_VERSION,
      testCase.label,
    );
    assert.deepEqual(result.inputsUsed, ["model"], testCase.label);
    assert.equal(result.reason, "authoritative_model", testCase.label);
  }
});

test("start-price-v2 never falls back to a pair when its model ranking is unavailable", () => {
  const cases = [
    { modelTop3: null, reason: "incomplete_model_ranking" },
    { modelTop3: [], reason: "incomplete_model_ranking" },
    { modelTop3: [1, 2], reason: "incomplete_model_ranking" },
    { modelTop3: [1, 1, 2], reason: "invalid_model_ranking" },
    { modelTop3: [1, 2, 37], reason: "invalid_model_ranking" },
  ];

  for (const { modelTop3, reason } of cases) {
    const result = combineFrozenTop3({
      modelVersion: "start-price-v2",
      modelTop3,
      pairTop3: [4, 12, 16],
      pairStatus: "ready",
      pairModelTop3: [7, 11, 19],
      pairSampleSize: 50,
      derivedFromSnapshotAt: SNAPSHOT_AT,
    });

    assert.deepEqual(result, {
      status: "unavailable",
      top3: [],
      algorithmVersion:
        FORECAST_CONSENSUS_MODEL_AUTHORITATIVE_ALGORITHM_VERSION,
      pairSampleSize: 50,
      derivedFromSnapshotAt: SNAPSHOT_AT,
      inputsUsed: [],
      reason,
    });
  }
});

test("near-miss model versions retain historical Borda ordering", () => {
  for (const modelVersion of [undefined, "start-price-v1", "start-price-v2 "]) {
    const result = combineFrozenTop3({
      modelVersion,
      modelTop3: [1, 2, 3],
      pairTop3: [4, 5, 6],
      pairStatus: "ready",
      pairModelTop3: [1, 2, 3],
      pairSampleSize: 40,
      derivedFromSnapshotAt: SNAPSHOT_AT,
    });

    assert.equal(result.status, "combined");
    assert.deepEqual(result.top3, [1, 4, 2]);
    assert.equal(
      result.algorithmVersion,
      FORECAST_CONSENSUS_BORDA_ALGORITHM_VERSION,
    );
    assert.deepEqual(result.inputsUsed, ["model", "pair"]);
    assert.equal(result.reason, "frozen_model_and_pair");
  }
});

test("start-price-v2 normalizes optional provenance without consulting pair data", () => {
  const result = combineFrozenTop3({
    modelVersion: "start-price-v2",
    modelTop3: [0, 36, 18],
    pairTop3: "not-a-ranking",
    pairStatus: "ready",
    pairModelTop3: null,
    pairSampleSize: -1,
    derivedFromSnapshotAt: "not-a-date",
  });

  assert.deepEqual(result, {
    status: "model_fallback",
    top3: [0, 36, 18],
    algorithmVersion:
      FORECAST_CONSENSUS_MODEL_AUTHORITATIVE_ALGORITHM_VERSION,
    pairSampleSize: null,
    derivedFromSnapshotAt: null,
    inputsUsed: ["model"],
    reason: "authoritative_model",
  });
});
