import assert from "node:assert/strict";
import test from "node:test";

import { buildCycleStageMarker } from "../public/cycle-stage-marker.js";

function events(count, offset = 0) {
  return Array.from({ length: count }, (_, index) => ({
    position: index + 1,
    number: (index + offset) % 37,
  }));
}

test("marker points to the same twentieth position in both cycles", () => {
  const marker = buildCycleStageMarker(
    { mode: "active", events: events(20, 3) },
    { events: events(80, 11) },
  );

  assert.deepEqual(marker, {
    position: 20,
    number: 22,
    active: true,
    referenceAvailable: true,
    referenceNumber: 30,
    referenceLength: 80,
  });
});

test("marker keeps absolute positions after the twenty-draw anchor", () => {
  const marker = buildCycleStageMarker(
    { mode: "active", events: events(21, 0) },
    { events: events(70, 5) },
  );

  assert.equal(marker.position, 21);
  assert.equal(marker.referenceAvailable, true);
  assert.equal(marker.referenceNumber, 25);
});

test("marker does not invent a counterpart after the analogue ended", () => {
  const marker = buildCycleStageMarker(
    { mode: "active", events: events(90, 0) },
    { events: events(75, 2) },
  );

  assert.equal(marker.position, 90);
  assert.equal(marker.referenceAvailable, false);
  assert.equal(marker.referenceNumber, null);
  assert.equal(marker.referenceLength, 75);
});

test("collecting target still marks its latest current position", () => {
  const marker = buildCycleStageMarker({ mode: "active", events: events(7, 0) });

  assert.equal(marker.position, 7);
  assert.equal(marker.referenceAvailable, false);
  assert.equal(marker.referenceLength, 0);
});

test("empty or malformed target has no marker", () => {
  assert.equal(buildCycleStageMarker({ mode: "active", events: [] }), null);
  assert.equal(
    buildCycleStageMarker({ mode: "active", events: [{ position: 0, number: 7 }] }),
    null,
  );
});

test("completed target is marked as static instead of live", () => {
  const marker = buildCycleStageMarker(
    { mode: "latest_completed", events: events(36, 0) },
    { events: events(60, 1) },
  );

  assert.equal(marker.position, 36);
  assert.equal(marker.active, false);
  assert.equal(marker.referenceAvailable, true);
});

test("a refresh moves the marker and leaves the previous position behind", () => {
  const analogue = { events: events(80, 8) };
  const before = buildCycleStageMarker({ mode: "active", events: events(30, 0) }, analogue);
  const after = buildCycleStageMarker({ mode: "active", events: events(31, 0) }, analogue);

  assert.equal(before.position, 30);
  assert.equal(after.position, 31);
});
