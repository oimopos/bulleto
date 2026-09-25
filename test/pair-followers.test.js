import assert from "node:assert/strict";
import test from "node:test";

import { buildFollowerStats } from "../public/pair-followers.js";

test("follower statistics rank all 37 numbers by historical share", () => {
  const stats = buildFollowerStats([
    {
      numbers: [3, 20],
      occurrenceCount: 2,
      firstOccurredAt: "2026-09-25T08:00:00.000Z",
      lastOccurredAt: "2026-09-25T09:00:00.000Z"
    },
    {
      numbers: [3, 7],
      occurrenceCount: 1,
      firstOccurredAt: "2026-09-25T08:30:00.000Z",
      lastOccurredAt: "2026-09-25T08:30:00.000Z"
    },
    { numbers: [2, 20], occurrenceCount: 99 },
    { numbers: [3, 99], occurrenceCount: 99 },
    { numbers: [3, 8], occurrenceCount: 0 }
  ], 3);

  assert.equal(stats.sourceNumber, 3);
  assert.equal(stats.sampleSize, 3);
  assert.equal(stats.observedFollowerCount, 2);
  assert.equal(stats.items.length, 37);
  assert.deepEqual(
    stats.items.slice(0, 2).map(({ number, occurrenceCount, share }) => ({
      number,
      occurrenceCount,
      share
    })),
    [
      { number: 20, occurrenceCount: 2, share: 2 / 3 },
      { number: 7, occurrenceCount: 1, share: 1 / 3 }
    ]
  );
  assert.equal(stats.items.at(-1).occurrenceCount, 0);
  assert.equal(
    stats.items.reduce((total, item) => total + (item.share ?? 0), 0),
    1
  );
});

test("follower statistics merge duplicate rows and use the latest occurrence as a tie-break", () => {
  const stats = buildFollowerStats([
    {
      numbers: [3, 5],
      occurrenceCount: 1,
      firstOccurredAt: "2026-09-25T08:00:00.000Z",
      lastOccurredAt: "2026-09-25T08:00:00.000Z"
    },
    {
      numbers: [3, 5],
      occurrenceCount: 1,
      firstOccurredAt: "2026-09-25T07:00:00.000Z",
      lastOccurredAt: "2026-09-25T10:00:00.000Z"
    },
    {
      numbers: [3, 9],
      occurrenceCount: 2,
      lastOccurredAt: "2026-09-25T09:00:00.000Z"
    }
  ], 3);

  assert.equal(stats.sampleSize, 4);
  assert.equal(stats.items[0].number, 5);
  assert.equal(stats.items[0].firstOccurredAt, "2026-09-25T07:00:00.000Z");
  assert.equal(stats.items[0].lastOccurredAt, "2026-09-25T10:00:00.000Z");
  assert.equal(stats.items[1].number, 9);
});

test("follower statistics distinguish no sample from a zero-percent observation", () => {
  const stats = buildFollowerStats([], 3);

  assert.equal(stats.sampleSize, 0);
  assert.equal(stats.observedFollowerCount, 0);
  assert.equal(stats.items.length, 37);
  assert.equal(stats.items.every((item) => item.share === null), true);
  assert.throws(() => buildFollowerStats([], 37), /sourceNumber/);
});
