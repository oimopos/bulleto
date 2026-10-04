import test from "node:test";
import assert from "node:assert/strict";

import {
  CYCLE_ANALOGUE_ALGORITHM_VERSION,
  CYCLE_ANALOGUE_ANCHOR_DRAW_COUNT,
  scoreCycleAnaloguePrefix,
  selectCycleAnalogue,
} from "../src/cycle-analogue.js";
import { createDatabase } from "../src/database.js";

const BASE_TIME = Date.parse("2026-09-21T00:00:00.000Z");
const SOURCE = "buleto";
const INSTRUMENT = "XPM/RUB";

function shapedEvents(numbers, firstResultId = 1) {
  const seen = new Set();
  return numbers.map((number, index) => {
    const wasNew = !seen.has(number);
    seen.add(number);
    return {
      position: index + 1,
      id: firstResultId + index,
      resultId: firstResultId + index,
      number,
      wasNew,
      remainingAfter: 37 - seen.size,
    };
  });
}

function event(number, fingerprint, offsetSeconds, extra = {}) {
  const settledAt = new Date(BASE_TIME + offsetSeconds * 1_000).toISOString();
  return {
    source: SOURCE,
    instrument: INSTRUMENT,
    settledAt,
    observedAt: settledAt,
    resultNumber: number,
    fingerprint,
    rawPayload: { c: number },
    ...extra,
  };
}

function completedSequence(prefix, survivor = 36) {
  const seen = new Set(prefix);
  assert.equal(seen.has(survivor), false, "prefix must not contain the survivor");
  return [
    ...prefix,
    ...Array.from({ length: 37 }, (_, number) => number).filter(
      (number) => number !== survivor && !seen.has(number),
    ),
  ];
}

function ingestNumbers(database, numbers, prefix, startOffset, extra = {}) {
  return database.ingestBatch(
    numbers.map((number, index) =>
      event(number, `${prefix}-${index}`, startOffset + index, extra),
    ),
  );
}

test("cycle analogue waits for the fixed twentieth draw", () => {
  const nineteen = shapedEvents(Array.from({ length: 19 }, (_, index) => index));
  const result = selectCycleAnalogue(nineteen, [
    {
      id: 1,
      completedAt: "2026-09-20T00:00:00.000Z",
      events: shapedEvents(Array.from({ length: 20 }, (_, index) => index)),
    },
  ]);

  assert.equal(CYCLE_ANALOGUE_ALGORITHM_VERSION, "cycle-analogue-prefix-v1");
  assert.equal(CYCLE_ANALOGUE_ANCHOR_DRAW_COUNT, 20);
  assert.deepEqual(result, {
    status: "collecting_anchor",
    anchorResultId: null,
    collectedDraws: 19,
    drawsUntilAnchor: 1,
    winner: null,
    metrics: null,
  });
});

test("prefix metrics distinguish order, position, aligned pairs, and novelty", () => {
  const target = shapedEvents(Array.from({ length: 20 }, (_, index) => index));
  const shifted = shapedEvents([20, ...Array.from({ length: 19 }, (_, index) => index)]);
  const metrics = scoreCycleAnaloguePrefix(target, shifted);

  assert.deepEqual(metrics, {
    lcsLength: 19,
    positionalMatches: 0,
    alignedPairMatches: 0,
    noveltyMatches: 20,
    uniqueCurveError: 0,
    seenIntersection: 19,
  });
});

test("selection ignores target and candidate tails after the anchor", () => {
  const prefix = Array.from({ length: 20 }, (_, index) => index);
  const weakerPrefix = [...prefix];
  weakerPrefix[0] = 35;
  const candidates = [
    {
      id: 1,
      completedAt: "2026-09-19T00:00:00.000Z",
      events: shapedEvents([...prefix, 20, 21, 22]),
    },
    {
      id: 2,
      completedAt: "2026-09-20T00:00:00.000Z",
      events: shapedEvents([...weakerPrefix, 0, 0, 0]),
    },
  ];

  const atAnchor = selectCycleAnalogue(shapedEvents(prefix, 100), candidates);
  const later = selectCycleAnalogue(shapedEvents([...prefix, 35, 35, 35], 100), [
    { ...candidates[0], events: shapedEvents([...prefix, 1, 1, 1, 1]) },
    { ...candidates[1], events: shapedEvents([...weakerPrefix, 34, 33, 32, 31]) },
  ]);

  assert.equal(atAnchor.status, "ready");
  assert.equal(later.status, "ready");
  assert.equal(atAnchor.winner.id, 1);
  assert.equal(later.winner.id, 1);
  assert.deepEqual(later.metrics, atAnchor.metrics);
  assert.equal(atAnchor.anchorResultId, 119);
  assert.equal(later.anchorResultId, 119);
});

test("equal prefix metrics use completion time and then cycle id", () => {
  const events = shapedEvents(Array.from({ length: 20 }, (_, index) => index));
  const target = shapedEvents(Array.from({ length: 20 }, (_, index) => index), 100);
  const newerWins = selectCycleAnalogue(target, [
    { id: 50, completedAt: "2026-09-19T00:00:00.000Z", events },
    { id: 10, completedAt: "2026-09-20T00:00:00.000Z", events },
  ]);
  const greaterIdWins = selectCycleAnalogue(target, [
    { id: 7, completedAt: "2026-09-20T00:00:00.000Z", events },
    { id: 8, completedAt: "2026-09-20T00:00:00.000Z", events },
  ]);

  assert.equal(newerWins.winner.id, 10);
  assert.equal(greaterIdWins.winner.id, 8);
});

test("database returns the full target and winner while keeping the anchor fixed", () => {
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(BASE_TIME + 1_000_000),
  });
  try {
    const prefix = Array.from({ length: 20 }, (_, index) => index);
    ingestNumbers(database, completedSequence(prefix), "history", 0);
    ingestNumbers(database, prefix.slice(0, 19), "target", 100);

    const collecting = database.getCycleAnalogue(SOURCE, INSTRUMENT);
    assert.equal(collecting.status, "collecting_anchor");
    assert.equal(collecting.target.mode, "active");
    assert.equal(collecting.target.events.length, 19);
    assert.equal(collecting.analogue, null);

    ingestNumbers(database, [19], "target-anchor", 119);
    const ready = database.getCycleAnalogue(SOURCE, INSTRUMENT);
    assert.equal(ready.status, "ready");
    assert.equal(ready.algorithmVersion, "cycle-analogue-prefix-v1");
    assert.equal(ready.interpretation, "descriptive-not-predictive");
    assert.equal(ready.anchorDrawCount, 20);
    assert.equal(ready.candidateStats.eligibleCompleted, 1);
    assert.equal(ready.target.events.length, 20);
    assert.equal(ready.analogue.events.length, 36);
    assert.deepEqual(
      ready.analogue.events.map((item) => item.number),
      completedSequence(prefix),
    );
    assert.deepEqual(ready.analogue.metrics, {
      lcsLength: 20,
      positionalMatches: 20,
      alignedPairMatches: 19,
      noveltyMatches: 20,
      uniqueCurveError: 0,
      seenIntersection: 20,
    });
    assert.deepEqual(ready.analogue.afterAnchor, {
      comparedDraws: 0,
      exactMatches: 0,
    });

    ingestNumbers(database, [20], "target-after-anchor", 120);
    const advanced = database.getCycleAnalogue(SOURCE, INSTRUMENT);
    assert.equal(advanced.analogue.cycle.id, ready.analogue.cycle.id);
    assert.deepEqual(advanced.analogue.metrics, ready.analogue.metrics);
    assert.deepEqual(advanced.analogue.afterAnchor, {
      comparedDraws: 1,
      exactMatches: 1,
    });
    assert.deepEqual(
      advanced.target.events.map((item) => item.number),
      [...prefix, 20],
    );
  } finally {
    database.close();
  }
});

test("database excludes incomplete and mixed-epoch completed histories", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const prefix = Array.from({ length: 20 }, (_, index) => index);
    ingestNumbers(database, completedSequence(prefix), "bad-count", 0);
    database.sqlite.prepare("UPDATE cycles SET event_count = event_count + 1 WHERE id = 1").run();

    ingestNumbers(database, completedSequence(prefix), "bad-epoch", 100);
    database.sqlite
      .prepare("UPDATE round_results SET continuity_epoch = continuity_epoch + 1 WHERE cycle_id = 2 AND id = (SELECT MIN(id) FROM round_results WHERE cycle_id = 2)")
      .run();

    ingestNumbers(database, prefix, "target-filter", 200);
    const comparison = database.getCycleAnalogue(SOURCE, INSTRUMENT);

    assert.equal(comparison.status, "unavailable");
    assert.equal(comparison.reason, "no-eligible-completed-history");
    assert.equal(comparison.candidateStats.eligibleCompleted, 0);
    assert.equal(comparison.target.events.length, 20);
  } finally {
    database.close();
  }
});

test("database excludes a cycle whose completion is not before the target start", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const prefix = Array.from({ length: 20 }, (_, index) => index);
    ingestNumbers(database, completedSequence(prefix), "future-completion", 0);
    ingestNumbers(database, prefix, "target-after-start", 100);
    database.sqlite
      .prepare("UPDATE cycles SET completed_at = ? WHERE id = 1")
      .run(new Date(BASE_TIME + 300_000).toISOString());

    const comparison = database.getCycleAnalogue(SOURCE, INSTRUMENT);
    assert.equal(comparison.status, "unavailable");
    assert.equal(comparison.candidateStats.eligibleCompleted, 0);
    assert.equal(comparison.target.cycle.id, 2);
  } finally {
    database.close();
  }
});

test("full RAW event order preserves zero and repeats", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const prefix = [0, 0, 1, 0, 2, 2, 3, 4, 3, 5, 6, 6, 7, 8, 9, 9, 10, 11, 12, 12];
    ingestNumbers(database, completedSequence(prefix), "repeat-history", 0);
    ingestNumbers(database, prefix, "repeat-target", 100);

    const comparison = database.getCycleAnalogue(SOURCE, INSTRUMENT);
    assert.equal(comparison.status, "ready");
    assert.deepEqual(
      comparison.target.events.map((item) => item.number),
      prefix,
    );
    assert.deepEqual(
      comparison.target.events.map((item) => item.wasNew),
      [true, false, true, false, true, false, true, true, false, true, true, false, true, true, true, false, true, true, true, false],
    );
    assert.equal(comparison.target.events[0].number, 0);
    assert.equal(comparison.analogue.metrics.positionalMatches, 20);
  } finally {
    database.close();
  }
});

test("an invalid current cycle never falls back to an older completed cycle", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const prefix = Array.from({ length: 20 }, (_, index) => index);
    ingestNumbers(database, completedSequence(prefix), "valid-history", 0);
    ingestNumbers(database, [1, 2, 3, 4, 5], "before-gap", 100);
    database.markGap({
      source: SOURCE,
      instrument: INSTRUMENT,
      incidentKey: "cycle-analogue-gap",
      detectedAt: new Date(BASE_TIME + 200_000).toISOString(),
      message: "known missing round",
    });

    const comparison = database.getCycleAnalogue(SOURCE, INSTRUMENT);
    assert.equal(comparison.status, "integrity_gap");
    assert.equal(comparison.target, null);
    assert.equal(comparison.analogue, null);
    assert.equal(comparison.reason, "current-cycle-integrity-gap");
  } finally {
    database.close();
  }
});

test("a completed target remains visible and the next result starts a new anchor", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const firstPrefix = Array.from({ length: 20 }, (_, index) => index);
    const secondPrefix = Array.from({ length: 20 }, (_, index) => (index + 5) % 36);
    ingestNumbers(database, completedSequence(firstPrefix), "first-completed", 0);
    ingestNumbers(database, completedSequence(secondPrefix), "second-completed", 100);

    const completed = database.getCycleAnalogue(SOURCE, INSTRUMENT);
    assert.equal(completed.status, "ready");
    assert.equal(completed.target.mode, "latest_completed");
    assert.equal(completed.target.events.length, 36);
    assert.equal(completed.analogue.cycle.id, 1);

    ingestNumbers(database, [0], "new-cycle", 200);
    const restarted = database.getCycleAnalogue(SOURCE, INSTRUMENT);
    assert.equal(restarted.status, "collecting_anchor");
    assert.equal(restarted.target.mode, "active");
    assert.deepEqual(restarted.target.events.map((item) => item.number), [0]);
    assert.equal(restarted.analogue, null);
  } finally {
    database.close();
  }
});
