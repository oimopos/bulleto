import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { createDatabase } from "../src/database.js";

const BASE_TIME = Date.parse("2026-09-21T00:00:00.000Z");

function event(resultNumber, fingerprint, offsetSeconds = 0, extra = {}) {
  const settledAt = new Date(BASE_TIME + offsetSeconds * 1_000).toISOString();
  return {
    source: "buleto",
    instrument: "PRIMECOIN(XPM)/RUB",
    settledAt,
    resultNumber,
    price: 5.4 + offsetSeconds / 10_000,
    observedAt: settledAt,
    fingerprint,
    rawPayload: { c: resultNumber },
    ...extra,
  };
}

function virtualTriggerEvents(
  prefix,
  targetNumber = 1,
  fillerNumber = 2,
  extra = {},
) {
  const otherNumbers = Array.from({ length: 37 }, (_, number) => number).filter(
    (number) => number !== targetNumber,
  );
  const rotation = otherNumbers.indexOf(fillerNumber);
  const rotated =
    rotation < 0
      ? otherNumbers
      : [...otherNumbers.slice(rotation), ...otherNumbers.slice(0, rotation)];
  return [
    event(targetNumber, `${prefix}-target`, 0, extra),
    ...Array.from({ length: 200 }, (_, index) =>
      event(rotated[index % rotated.length], `${prefix}-miss-${index}`, index + 1, extra),
    ),
  ];
}

test("schema contains all persistence tables", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const tables = database.sqlite
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `)
      .all()
      .map((row) => row.name);

    assert.deepEqual(tables, [
      "cycle_events",
      "cycle_numbers",
      "cycles",
      "incidents",
      "round_results",
      "stream_state",
      "virtual_bankrolls",
      "virtual_bet_sessions",
      "virtual_bets",
    ]);
    assert.equal(database.sqlite.prepare("PRAGMA user_version").get().user_version, 8);
  } finally {
    database.close();
  }
});

test("version 5 history is backfilled into continuity epochs before migration completes", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-v5-"));
  const path = join(directory, "legacy.sqlite");
  const legacy = new DatabaseSync(path);
  try {
    legacy.exec(`
      CREATE TABLE cycles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        instrument TEXT NOT NULL,
        status TEXT NOT NULL,
        origin TEXT NOT NULL,
        started_at TEXT NOT NULL,
        last_event_at TEXT NOT NULL,
        completed_at TEXT,
        survivor_number INTEGER,
        event_count INTEGER NOT NULL DEFAULT 0,
        eliminated_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE round_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        instrument TEXT NOT NULL,
        settled_at TEXT NOT NULL,
        result_number INTEGER NOT NULL,
        price REAL,
        observed_at TEXT NOT NULL,
        external_round_id TEXT,
        raw_cell INTEGER,
        fingerprint TEXT NOT NULL UNIQUE,
        raw_payload TEXT,
        cycle_id INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE TABLE incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        source TEXT NOT NULL,
        instrument TEXT NOT NULL,
        message TEXT,
        detected_at TEXT NOT NULL,
        details_json TEXT,
        cycle_id INTEGER,
        created_at TEXT NOT NULL
      );
      PRAGMA user_version = 5;
    `);
    const insert = legacy.prepare(`
      INSERT INTO round_results (
        source, instrument, settled_at, result_number, price, observed_at,
        external_round_id, raw_cell, fingerprint, raw_payload, cycle_id, created_at
      ) VALUES ('buleto', 'PRIMECOIN(XPM)/RUB', ?, ?, 5.4, ?, NULL, ?, ?, NULL, NULL, ?)
    `);
    [1, 2, 3, 1, 2, 3].forEach((number, index) => {
      const time = new Date(BASE_TIME + index * 1_000).toISOString();
      insert.run(time, number, time, number, `legacy-${index}`, time);
    });
    const gapTime = new Date(BASE_TIME + 2_000).toISOString();
    legacy.prepare(`
      INSERT INTO incidents (
        kind, source, instrument, message, detected_at, details_json, cycle_id, created_at
      ) VALUES ('gap', 'buleto', 'PRIMECOIN(XPM)/RUB', 'legacy gap', ?, NULL, NULL, ?)
    `).run(gapTime, gapTime);
  } finally {
    legacy.close();
  }

  const database = createDatabase({ path });
  try {
    assert.equal(database.sqlite.prepare("PRAGMA user_version").get().user_version, 8);
    assert.deepEqual(
      database.sqlite
        .prepare("SELECT continuity_epoch FROM round_results ORDER BY settled_at, id")
        .all()
        .map((row) => Number(row.continuity_epoch)),
      [0, 0, 1, 1, 1, 1],
    );
    assert.equal(
      database
        .getRepeatedTriples("buleto", "PRIMECOIN(XPM)/RUB", 20)
        .some((item) => item.numbers.join(",") === "1,2,3"),
      false,
    );
    assert.equal(
      database.sqlite.prepare("SELECT COUNT(*) AS count FROM virtual_bet_sessions").get()
        .count,
      0,
    );
    assert.equal(
      database.sqlite.prepare("SELECT COUNT(*) AS count FROM virtual_bets").get().count,
      0,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ingestion stores canonical zero and preserves raw cell 37 for audit", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const payload = { id: "round-1", s: 5, rr: { dt: 1, c: 37, v: 5.4 } };
    const ingested = database.ingestBatch([
      event(0, "fp-zero", 0, {
        externalRoundId: "round-1",
        rawPayload: payload,
      }),
    ]);

    assert.equal(ingested.inserted, 1);
    assert.equal(ingested.duplicates, 0);
    assert.equal(ingested.results[0].resultNumber, 0);
    assert.equal(ingested.results[0].rawCell, 37);
    assert.equal(ingested.results[0].externalRoundId, "round-1");
    assert.deepEqual(ingested.results[0].rawPayload, payload);
    assert.equal(ingested.state.activeCycle.remainingCount, 36);
    assert.equal(ingested.state.activeCycle.remainingNumbers.includes(0), false);
    assert.equal(ingested.state.activeCycle.integrityStatus, "ok");
    assert.equal(ingested.state.activeCycle.origin, "round");
    assert.equal(ingested.state.activeCycle.totalDraws, 1);
    assert.equal(ingested.state.activeCycle.uniqueCount, 1);
    assert.deepEqual(
      ingested.state.activeCycle.numbers.find((item) => item.number === 0),
      {
        number: 0,
        occurrenceCount: 1,
        eliminated: true,
        firstSeenAt: "2026-09-21T00:00:00.000Z",
      },
    );

    const stored = database.sqlite
      .prepare("SELECT result_number, raw_cell FROM round_results")
      .get();
    assert.equal(stored.result_number, 0);
    assert.equal(stored.raw_cell, 37);
  } finally {
    database.close();
  }
});

test("number statistics always cover 0 through 36 and use the latest saved result", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const emptyStats = database.getNumberStats("buleto", "PRIMECOIN(XPM)/RUB");
    assert.equal(emptyStats.length, 37);
    assert.deepEqual(
      emptyStats.map((item) => item.number),
      Array.from({ length: 37 }, (_, number) => number),
    );
    assert.ok(emptyStats.every((item) => item.occurrenceCount === 0));
    assert.ok(emptyStats.every((item) => item.lastSeenAt === null));
    assert.ok(emptyStats.every((item) => item.roundsSinceLast === null));

    database.ingestBatch([
      event(37, "history-zero", 0),
      event(7, "history-seven-early", 10),
      event(7, "history-seven-latest", 40),
      event(7, "history-seven-late-ingest", 20),
      event(9, "history-other-stream", 50, { instrument: "OTHER" }),
    ]);
    database.ingestBatch([event(7, "history-seven-latest", 90)]);

    const stats = database.getNumberStats("buleto", "PRIMECOIN(XPM)/RUB");
    assert.deepEqual(stats[0], {
      number: 0,
      occurrenceCount: 1,
      lastSeenAt: "2026-09-21T00:00:00.000Z",
      roundsSinceLast: 3,
    });
    assert.deepEqual(stats[7], {
      number: 7,
      occurrenceCount: 3,
      lastSeenAt: "2026-09-21T00:00:40.000Z",
      roundsSinceLast: 0,
    });
    assert.deepEqual(stats[9], {
      number: 9,
      occurrenceCount: 0,
      lastSeenAt: null,
      roundsSinceLast: null,
    });
    assert.deepEqual(database.getNumberStats("buleto", "OTHER")[9], {
      number: 9,
      occurrenceCount: 1,
      lastSeenAt: "2026-09-21T00:00:50.000Z",
      roundsSinceLast: 0,
    });
  } finally {
    database.close();
  }
});

test("pair statistics preserve order, count overlaps, and include every observed pair", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const numbers = [3, 20, 3, 20, 3, 7, 7, 7];
    database.ingestBatch(
      numbers.map((number, index) => event(number, `pair-${index}`, index)),
    );

    assert.deepEqual(
      database.getPairStats("buleto", "PRIMECOIN(XPM)/RUB"),
      [
        {
          numbers: [7, 7],
          occurrenceCount: 2,
          firstOccurredAt: "2026-09-21T00:00:06.000Z",
          lastOccurredAt: "2026-09-21T00:00:07.000Z",
        },
        {
          numbers: [20, 3],
          occurrenceCount: 2,
          firstOccurredAt: "2026-09-21T00:00:02.000Z",
          lastOccurredAt: "2026-09-21T00:00:04.000Z",
        },
        {
          numbers: [3, 20],
          occurrenceCount: 2,
          firstOccurredAt: "2026-09-21T00:00:01.000Z",
          lastOccurredAt: "2026-09-21T00:00:03.000Z",
        },
        {
          numbers: [3, 7],
          occurrenceCount: 1,
          firstOccurredAt: "2026-09-21T00:00:05.000Z",
          lastOccurredAt: "2026-09-21T00:00:05.000Z",
        },
      ],
    );
  } finally {
    database.close();
  }
});

test("pair statistics cover history beyond the latest 500 results", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const numbers = [31, 32, ...Array.from({ length: 501 }, () => 7)];
    database.ingestBatch(
      numbers.map((number, index) => event(number, `long-pair-${index}`, index)),
    );

    assert.deepEqual(
      database
        .getPairStats("buleto", "PRIMECOIN(XPM)/RUB")
        .find((item) => item.numbers[0] === 31 && item.numbers[1] === 32),
      {
        numbers: [31, 32],
        occurrenceCount: 1,
        firstOccurredAt: "2026-09-21T00:00:01.000Z",
        lastOccurredAt: "2026-09-21T00:00:01.000Z",
      },
    );
  } finally {
    database.close();
  }
});

test("an integrity gap prevents pair statistics from joining continuity epochs", () => {
  const database = createDatabase({ path: ":memory:" });
  const gap = {
    source: "buleto",
    instrument: "PRIMECOIN(XPM)/RUB",
    incidentKey: "pair-gap",
    detectedAt: "2026-09-21T00:00:02.000Z",
    message: "known missing result",
  };
  try {
    database.ingestBatch([
      event(1, "gap-pair-0", 0),
      event(2, "gap-pair-1", 1),
    ]);
    database.ingestBatchAfterGap(gap, [
      event(3, "gap-pair-2", 2),
      event(1, "gap-pair-3", 3),
      event(2, "gap-pair-4", 4),
      event(3, "gap-pair-5", 5),
    ]);

    assert.deepEqual(
      database.getPairStats("buleto", "PRIMECOIN(XPM)/RUB"),
      [
        {
          numbers: [1, 2],
          occurrenceCount: 2,
          firstOccurredAt: "2026-09-21T00:00:01.000Z",
          lastOccurredAt: "2026-09-21T00:00:04.000Z",
        },
        {
          numbers: [2, 3],
          occurrenceCount: 1,
          firstOccurredAt: "2026-09-21T00:00:05.000Z",
          lastOccurredAt: "2026-09-21T00:00:05.000Z",
        },
        {
          numbers: [3, 1],
          occurrenceCount: 1,
          firstOccurredAt: "2026-09-21T00:00:03.000Z",
          lastOccurredAt: "2026-09-21T00:00:03.000Z",
        },
      ],
    );
  } finally {
    database.close();
  }
});

test("repeated triples preserve order and count overlapping appearances", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const numbers = [3, 20, 18, 9, 3, 20, 18, 7, 7, 7, 7];
    database.ingestBatch(
      numbers.map((number, index) => event(number, `triple-${index}`, index)),
    );

    const triples = database.getRepeatedTriples(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
      20,
    );
    assert.deepEqual(
      triples.find((item) => item.numbers.join(",") === "3,20,18"),
      {
        numbers: [3, 20, 18],
        occurrenceCount: 2,
        firstOccurredAt: "2026-09-21T00:00:02.000Z",
        lastOccurredAt: "2026-09-21T00:00:06.000Z",
      },
    );
    assert.deepEqual(
      triples.find((item) => item.numbers.join(",") === "7,7,7"),
      {
        numbers: [7, 7, 7],
        occurrenceCount: 2,
        firstOccurredAt: "2026-09-21T00:00:09.000Z",
        lastOccurredAt: "2026-09-21T00:00:10.000Z",
      },
    );
    assert.equal(
      triples.some((item) => item.numbers.join(",") === "18,20,3"),
      false,
    );
  } finally {
    database.close();
  }
});

test("an integrity gap breaks triples while a duplicate gap does not split them again", () => {
  const database = createDatabase({ path: ":memory:" });
  const gap = {
    source: "buleto",
    instrument: "PRIMECOIN(XPM)/RUB",
    incidentKey: "triple-gap",
    detectedAt: "2026-09-21T00:00:02.000Z",
    message: "known missing result",
  };
  try {
    database.ingestBatch([
      event(1, "gap-triple-0", 0),
      event(2, "gap-triple-1", 1),
    ]);
    database.ingestBatchAfterGap(gap, [event(3, "gap-triple-2", 2)]);
    database.ingestBatch([
      event(1, "gap-triple-3", 3),
      event(2, "gap-triple-4", 4),
      event(3, "gap-triple-5", 5),
      event(9, "gap-triple-6", 6),
      event(1, "gap-triple-7", 7),
      event(2, "gap-triple-8", 8),
    ]);
    database.markGap(gap);
    database.ingestBatch([event(3, "gap-triple-9", 9)]);

    const triples = database.getRepeatedTriples(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
      20,
    );
    assert.deepEqual(
      triples.find((item) => item.numbers.join(",") === "1,2,3"),
      {
        numbers: [1, 2, 3],
        occurrenceCount: 2,
        firstOccurredAt: "2026-09-21T00:00:05.000Z",
        lastOccurredAt: "2026-09-21T00:00:09.000Z",
      },
    );

    const epochs = database.sqlite
      .prepare("SELECT continuity_epoch FROM round_results ORDER BY settled_at, id")
      .all()
      .map((row) => Number(row.continuity_epoch));
    assert.deepEqual(epochs, [0, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
  } finally {
    database.close();
  }
});

test("a normally completed cycle does not break a consecutive triple", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const numbers = [
      ...Array.from({ length: 36 }, (_, number) => number),
      0,
      9,
      34,
      35,
      0,
    ];
    database.ingestBatch(
      numbers.map((number, index) => event(number, `cycle-triple-${index}`, index)),
    );

    const match = database
      .getRepeatedTriples("buleto", "PRIMECOIN(XPM)/RUB", 20)
      .find((item) => item.numbers.join(",") === "34,35,0");
    assert.deepEqual(match, {
      numbers: [34, 35, 0],
      occurrenceCount: 2,
      firstOccurredAt: "2026-09-21T00:00:36.000Z",
      lastOccurredAt: "2026-09-21T00:00:40.000Z",
    });
    assert.equal(database.getDashboardState().totals.completedCycles, 1);
    assert.deepEqual(
      database.sqlite
        .prepare("SELECT DISTINCT continuity_epoch FROM round_results")
        .all()
        .map((row) => Number(row.continuity_epoch)),
      [0],
    );
  } finally {
    database.close();
  }
});

test("fingerprints dedupe results and a richer duplicate only enriches the row", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    database.ingestBatch([event(5, "same-result")]);
    const richerPayload = {
      id: "server-round-5",
      s: 5,
      rr: { dt: 2, c: 5, v: 5.401 },
    };
    const duplicate = database.ingestBatch([
      event(5, "same-result", 1, {
        externalRoundId: "server-round-5",
        rawPayload: richerPayload,
      }),
    ]);

    assert.equal(duplicate.inserted, 0);
    assert.equal(duplicate.duplicates, 1);
    assert.equal(duplicate.state.totals.results, 1);
    assert.equal(duplicate.state.activeCycle.eventCount, 1);
    assert.equal(duplicate.state.activeCycle.remainingCount, 36);

    const [stored] = database.getRecentResults(1);
    assert.equal(stored.externalRoundId, "server-round-5");
    assert.equal(stored.rawCell, 5);
    assert.deepEqual(stored.rawPayload, richerPayload);

    const eventCount = database.sqlite
      .prepare("SELECT COUNT(*) AS count FROM cycle_events")
      .get().count;
    assert.equal(eventCount, 1);
  } finally {
    database.close();
  }
});

test("external round id dedupes even when a fingerprint changes", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    database.ingestBatch([
      event(8, "first-fingerprint", 0, { externalRoundId: "round-8" }),
    ]);
    const duplicate = database.ingestBatch([
      event(8, "second-fingerprint", 1, { externalRoundId: "round-8" }),
    ]);

    assert.equal(duplicate.inserted, 0);
    assert.equal(duplicate.duplicates, 1);
    assert.equal(database.getDashboardState().totals.results, 1);
  } finally {
    database.close();
  }
});

test("external round ids are isolated by instrument", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const outcome = database.ingestBatch([
      event(8, "instrument-a", 0, { externalRoundId: "round-8", instrument: "A" }),
      event(9, "instrument-b", 1, { externalRoundId: "round-8", instrument: "B" }),
    ]);

    assert.equal(outcome.inserted, 2);
    assert.equal(database.getLatestResult("buleto", "A").fingerprint, "instrument-a");
    assert.equal(database.getLatestResult("buleto", "B").fingerprint, "instrument-b");
  } finally {
    database.close();
  }
});

test("a repeated result does not reduce the cycle remainder", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const result = database.ingestBatch([
      event(12, "repeat-1", 0),
      event(12, "repeat-2", 1),
    ]);

    assert.equal(result.inserted, 2);
    assert.equal(result.state.activeCycle.eventCount, 2);
    assert.equal(result.state.activeCycle.eliminatedCount, 1);
    assert.equal(result.state.activeCycle.remainingCount, 36);

    const recent = database.getRecentResults(1)[0];
    assert.equal(recent.number, 12);
    assert.equal(recent.wasNew, false);
    assert.equal(recent.remainingAfter, 36);

    const cycleEvents = database.sqlite
      .prepare("SELECT eliminated, remaining_count FROM cycle_events ORDER BY id")
      .all();
    assert.deepEqual(
      cycleEvents.map((row) => [row.eliminated, row.remaining_count]),
      [
        [1, 36],
        [0, 36],
      ],
    );
  } finally {
    database.close();
  }
});

test("cycle completes at one survivor; the next result opens a new cycle", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    const firstCycleEvents = Array.from({ length: 36 }, (_, number) =>
      event(number, `cycle-1-${number}`, number, {
        externalRoundId: `round-${number}`,
      }),
    );
    const completed = database.ingestBatch(firstCycleEvents);

    assert.equal(completed.inserted, 36);
    assert.equal(completed.completedCycles.length, 1);
    assert.equal(completed.completedCycles[0].status, "completed");
    assert.equal(completed.completedCycles[0].survivorNumber, 36);
    assert.deepEqual(completed.completedCycles[0].remainingNumbers, [36]);
    assert.equal(completed.state.activeCycle, null);

    const next = database.ingestBatch([event(12, "cycle-2-12", 40)]);
    assert.equal(next.state.activeCycle.status, "active");
    assert.equal(next.state.activeCycle.id, 2);
    assert.equal(next.state.activeCycle.remainingCount, 36);
    assert.equal(next.state.activeCycle.remainingNumbers.includes(12), false);

    const history = database.getCompletedCycles(10);
    assert.equal(history.length, 1);
    assert.equal(history[0].survivorNumber, 36);
    assert.equal(database.getRecentResults(2)[0].fingerprint, "cycle-2-12");
  } finally {
    database.close();
  }
});

test("batch validation is atomic and a gap invalidates the active cycle", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    assert.throws(
      () =>
        database.ingestBatch([
          event(1, "would-be-valid"),
          event(99, "invalid-number", 1),
        ]),
      /wire number/,
    );
    assert.equal(database.getDashboardState().totals.results, 0);

    database.ingestBatch([event(4, "before-gap", 2)]);
    assert.equal(database.getDashboardState().activeCycle.id, 1);

    const gap = database.markGap({
      source: "buleto",
      instrument: "PRIMECOIN(XPM)/RUB",
      detectedAt: "2026-09-21T00:10:00.000Z",
      message: "missing result between snapshots",
      previousFingerprint: "before",
      nextFingerprint: "after",
    });
    assert.equal(gap.kind, "gap");
    assert.equal(gap.details.previousFingerprint, "before");
    assert.equal(gap.cycleId, 1);
    assert.equal(gap.invalidatedCycle.status, "invalid_gap");
    assert.equal(gap.invalidatedCycle.integrityStatus, "gap");
    assert.equal(gap.invalidatedCycle.survivorNumber, null);
    const state = database.getDashboardState();
    assert.equal(state.totals.incidents, 1);
    assert.equal(state.totals.invalidCycles, 1);
    assert.equal(state.activeCycle, null);
    assert.equal(state.recentIncidents[0].message, "missing result between snapshots");

    const afterGap = database.ingestBatch([event(9, "after-gap", 601)]);
    assert.equal(afterGap.state.activeCycle.id, 2);
    assert.equal(afterGap.state.activeCycle.status, "active");
    assert.equal(afterGap.state.activeCycle.remainingCount, 36);
  } finally {
    database.close();
  }
});

test("the same durable gap key cannot invalidate a later healthy cycle", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    database.ingestBatch([event(4, "durable-gap-before")]);
    const details = {
      source: "buleto",
      instrument: "PRIMECOIN(XPM)/RUB",
      incidentKey: "automatic:before:after",
      detectedAt: "2026-09-21T00:10:00.000Z",
      message: "durable gap",
    };
    const first = database.markGap(details);
    assert.equal(first.duplicate, false);

    database.ingestBatch([event(9, "durable-gap-after", 601)]);
    const duplicate = database.markGap(details);
    const state = database.getDashboardState();

    assert.equal(duplicate.duplicate, true);
    assert.equal(state.totals.incidents, 1);
    assert.equal(state.totals.invalidCycles, 1);
    assert.equal(state.activeCycle.id, 2);
    assert.equal(state.activeCycle.status, "active");
  } finally {
    database.close();
  }
});

test("late known results can be enriched without inserting unknown history", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    database.ingestBatch([event(7, "known-history")]);
    const richerPayload = { id: "round-7", rr: { c: 7, v: 5.4 } };
    const enrichment = database.enrichKnownResults([
      event(7, "known-history", 0, {
        externalRoundId: "round-7",
        rawPayload: richerPayload,
      }),
      event(8, "unknown-history", 1, { externalRoundId: "round-8" }),
    ]);

    assert.equal(enrichment.enriched, 1);
    assert.equal(database.getDashboardState().totals.results, 1);
    const stored = database.getRecentResults(1)[0];
    assert.equal(stored.externalRoundId, "round-7");
    assert.deepEqual(stored.rawPayload, richerPayload);
  } finally {
    database.close();
  }
});

test("latest result lookup is isolated by source and instrument", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    database.ingestBatch([
      event(1, "stream-a", 0, { instrument: "A" }),
      event(2, "stream-b", 100, { instrument: "B" }),
    ]);

    assert.equal(database.getLatestResult("buleto", "A").fingerprint, "stream-a");
    assert.equal(database.getLatestResult("buleto", "B").fingerprint, "stream-b");
    assert.equal(database.getLatestResult("buleto", "missing"), null);
  } finally {
    database.close();
  }
});

test("gap invalidation and its first result commit atomically", () => {
  const database = createDatabase({ path: ":memory:" });
  const gap = {
    source: "buleto",
    instrument: "PRIMECOIN(XPM)/RUB",
    incidentKey: "atomic-gap",
    detectedAt: "2026-09-21T00:05:00.000Z",
    message: "atomic boundary",
  };
  try {
    database.ingestBatch([event(1, "atomic-before")]);
    assert.throws(
      () => database.ingestBatchAfterGap(gap, [event(99, "atomic-invalid", 301)]),
      /wire number/,
    );

    let state = database.getDashboardState();
    assert.equal(state.totals.results, 1);
    assert.equal(state.totals.incidents, 0);
    assert.equal(state.totals.invalidCycles, 0);
    assert.equal(state.activeCycle.id, 1);

    const committed = database.ingestBatchAfterGap(gap, [event(2, "atomic-after", 301)]);
    state = database.getDashboardState();
    assert.equal(committed.inserted, 1);
    assert.equal(committed.gap.duplicate, false);
    assert.equal(state.totals.results, 2);
    assert.equal(state.totals.incidents, 1);
    assert.equal(state.totals.invalidCycles, 1);
    assert.equal(state.activeCycle.id, 2);
    assert.equal(state.latestResult.fingerprint, "atomic-after");
  } finally {
    database.close();
  }
});

test("virtual bettor arms at 200 misses and starts betting only on the next tail result", () => {
  const database = createDatabase({ path: ":memory:" });
  const history = virtualTriggerEvents("virtual-threshold");
  try {
    database.ingestBatch(history.slice(0, -1));
    let state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "waiting");
    assert.equal(state.longestCandidate.number, 1);
    assert.equal(state.longestCandidate.roundsSinceLast, 199);
    assert.equal(state.longestCandidate.eligible, false);
    assert.equal(state.activeSession, null);

    database.ingestBatch(history.slice(-1));
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.mode, "simulation");
    assert.equal(state.executionEnabled, false);
    assert.equal(state.status, "armed");
    assert.equal(state.triggerThreshold, 200);
    assert.deepEqual(state.model, {
      triggerThreshold: 200,
      initialStake: 10,
      stakeStep: 10,
      maxStake: 2500,
      grossPayoutMultiplier: 36,
      payoutIncludesStake: true,
      modelVersion: "1.0.0",
    });
    assert.equal(state.longestCandidate.number, 1);
    assert.equal(state.longestCandidate.roundsSinceLast, 200);
    assert.equal(state.longestCandidate.eligible, true);
    assert.equal(state.activeSession.targetNumber, 1);
    assert.equal(state.activeSession.status, "armed");
    assert.equal(state.activeSession.attemptCount, 0);
    assert.equal(state.activeSession.totalStaked, 0);
    assert.equal(state.activeSession.nextStake, 10);
    assert.equal(state.activeSession.selectedAt, "2026-09-21T00:03:20.000Z");
    assert.equal(state.activeSession.startedAt, null);
    assert.deepEqual(state.testBank, {
      mode: "simulation",
      status: "running",
      initialBalance: 87_700,
      currentBalance: 87_700,
      netResult: 0,
      nextStake: 10,
      canAffordNext: true,
      shortfall: 0,
      startedAt: state.testBank.startedAt,
      exhaustedAt: null,
      dataComplete: true,
    });
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) AS count FROM virtual_bets").get().count, 0);

    const initialized = database.initializeVirtualBettor(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(initialized.activeSession.id, state.activeSession.id);
    assert.equal(initialized.lifetime.totalSessions, 1);

    database.ingestBatch([event(3, "virtual-first-miss", 201)]);
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "active");
    assert.equal(state.activeSession.attemptCount, 1);
    assert.equal(state.activeSession.missCount, 1);
    assert.equal(state.activeSession.totalStaked, 10);
    assert.equal(state.activeSession.nextStake, 10);
    assert.equal(state.activeSession.startedAt, "2026-09-21T00:03:21.000Z");
    assert.equal(state.testBank.currentBalance, 87_690);
    assert.equal(state.testBank.netResult, -10);

    database.ingestBatch([event(3, "virtual-first-miss", 202)]);
    database.ingestBatch([event(4, "virtual-late-history", 50)]);
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.activeSession.attemptCount, 1);
    assert.equal(state.lifetime.totalBets, 1);

    database.ingestBatch([event(1, "virtual-hit", 202)]);
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "waiting");
    assert.equal(state.activeSession, null);
    assert.equal(state.recentSessions[0].status, "completed");
    assert.equal(state.recentSessions[0].attemptCount, 2);
    assert.equal(state.recentSessions[0].missCount, 1);
    assert.equal(state.recentSessions[0].totalStaked, 20);
    assert.equal(state.recentSessions[0].grossPayout, 360);
    assert.equal(state.recentSessions[0].netResult, 340);
    assert.equal(state.recentSessions[0].endReason, "hit");
    assert.equal(state.testBank.currentBalance, 88_040);
    assert.equal(state.testBank.netResult, 340);
    assert.deepEqual(state.lifetime, {
      totalSessions: 1,
      completedSessions: 1,
      invalidatedSessions: 0,
      totalBets: 2,
      winningBets: 1,
      losingBets: 1,
      totalStaked: 20,
      grossPayout: 360,
      netResult: 340,
    });
    assert.equal(
      database.getVirtualBetSessions("buleto", "PRIMECOIN(XPM)/RUB", 10)[0]
        .startedAt,
      "2026-09-21T00:03:21.000Z",
    );
  } finally {
    database.close();
  }
});

test("virtual bettor includes never-seen numbers in the current epoch", () => {
  const database = createDatabase({ path: ":memory:" });
  const history = Array.from({ length: 200 }, (_, index) =>
    event(1, `virtual-unseen-${index}`, index),
  );
  try {
    assert.equal(
      database.getVirtualBettorState("buleto", "PRIMECOIN(XPM)/RUB")
        .longestCandidate,
      null,
    );
    database.ingestBatch(history.slice(0, -1));
    let state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.deepEqual(state.longestCandidate, {
      number: 0,
      roundsSinceLast: 199,
      occurrenceCount: 0,
      lastSeenAt: null,
      lastResultId: null,
      lastPosition: null,
      continuityEpoch: 0,
      eligible: false,
    });
    assert.equal(state.status, "waiting");

    database.ingestBatch(history.slice(-1));
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.deepEqual(state.longestCandidate, {
      number: 0,
      roundsSinceLast: 200,
      occurrenceCount: 0,
      lastSeenAt: null,
      lastResultId: null,
      lastPosition: null,
      continuityEpoch: 0,
      eligible: true,
    });
    assert.equal(state.status, "armed");
    assert.equal(state.activeSession.targetNumber, 0);
    assert.equal(state.activeSession.triggerRoundsMissed, 200);
    assert.equal(state.activeSession.attemptCount, 0);
    assert.equal(state.activeSession.totalStaked, 0);

    database.ingestBatch([event(1, "virtual-unseen-next", 200)]);
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "active");
    assert.equal(state.activeSession.targetNumber, 0);
    assert.equal(state.activeSession.attemptCount, 1);
    assert.equal(state.activeSession.totalStaked, 10);
    assert.equal(state.activeSession.nextStake, 10);
  } finally {
    database.close();
  }
});

test("a novel gap invalidates a live virtual session and a duplicate gap is inert", () => {
  const database = createDatabase({ path: ":memory:" });
  const details = {
    source: "buleto",
    instrument: "PRIMECOIN(XPM)/RUB",
    incidentKey: "virtual-gap",
    detectedAt: "2026-09-21T00:04:00.000Z",
    message: "virtual bettor integrity boundary",
  };
  try {
    database.ingestBatch(virtualTriggerEvents("virtual-gap"));
    database.ingestBatch([event(3, "virtual-gap-miss", 201)]);
    assert.equal(
      database.getVirtualBettorState("buleto", "PRIMECOIN(XPM)/RUB").status,
      "active",
    );

    const first = database.markGap(details);
    let state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(first.duplicate, false);
    assert.equal(state.status, "waiting");
    assert.equal(state.longestCandidate, null);
    assert.equal(state.recentSessions[0].status, "invalid_gap");
    assert.equal(state.recentSessions[0].attemptCount, 1);
    assert.equal(state.recentSessions[0].totalStaked, 10);
    assert.equal(state.recentSessions[0].netResult, -10);
    assert.equal(state.recentSessions[0].endReason, "integrity_gap");
    assert.equal(state.testBank.currentBalance, 87_690);
    assert.equal(state.testBank.status, "running");
    assert.equal(state.testBank.dataComplete, false);
    assert.equal(state.lifetime.totalBets, 1);
    assert.equal(state.lifetime.totalStaked, 10);
    assert.equal(state.lifetime.netResult, -10);

    const duplicate = database.markGap(details);
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(duplicate.duplicate, true);
    assert.equal(state.recentSessions.length, 1);
    assert.equal(state.lifetime.invalidatedSessions, 1);
    assert.equal(
      Number(
        database.sqlite
          .prepare(`
            SELECT continuity_epoch
            FROM stream_state
            WHERE source = 'buleto' AND instrument = 'PRIMECOIN(XPM)/RUB'
          `)
          .get().continuity_epoch,
      ),
      1,
    );
  } finally {
    database.close();
  }
});

test("virtual bet settlement rolls back with the result and can be retried", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    database.ingestBatch(virtualTriggerEvents("virtual-atomic"));
    database.sqlite.exec(`
      CREATE TRIGGER fail_virtual_bet
      BEFORE INSERT ON virtual_bets
      BEGIN
        SELECT RAISE(ABORT, 'forced virtual bet failure');
      END;
    `);

    assert.throws(
      () => database.ingestBatch([event(3, "virtual-atomic-next", 201)]),
      /forced virtual bet failure/,
    );
    let state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(database.getDashboardState().totals.results, 201);
    assert.equal(state.status, "armed");
    assert.equal(state.activeSession.attemptCount, 0);
    assert.equal(state.lifetime.totalBets, 0);
    assert.equal(state.testBank.currentBalance, 87_700);

    database.sqlite.exec("DROP TRIGGER fail_virtual_bet");
    const retry = database.ingestBatch([event(3, "virtual-atomic-next", 201)]);
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(retry.inserted, 1);
    assert.equal(state.status, "active");
    assert.equal(state.activeSession.attemptCount, 1);
    assert.equal(state.lifetime.totalBets, 1);
    assert.equal(state.testBank.currentBalance, 87_690);
  } finally {
    database.close();
  }
});

test("virtual bettor state persists and resumes after reopening the database", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-virtual-"));
  const path = join(directory, "paper-bettor.sqlite");
  let database = createDatabase({ path });
  try {
    database.ingestBatch(virtualTriggerEvents("virtual-persist"));
    const armedId = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    ).activeSession.id;
    database.close();

    database = createDatabase({ path });
    let state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "armed");
    assert.equal(state.activeSession.id, armedId);
    assert.equal(state.activeSession.attemptCount, 0);

    database.ingestBatch([event(3, "virtual-persist-next", 201)]);
    database.close();
    database = createDatabase({ path });
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "active");
    assert.equal(state.activeSession.id, armedId);
    assert.equal(state.activeSession.attemptCount, 1);
    assert.equal(state.activeSession.totalStaked, 10);
    assert.equal(state.lifetime.totalBets, 1);
    assert.equal(state.testBank.currentBalance, 87_690);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("database settlement follows the recovery ladder and isolates instruments", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    database.ingestBatch(virtualTriggerEvents("virtual-ladder"));
    database.ingestBatch(
      virtualTriggerEvents("virtual-ladder-other", 7, 8, {
        instrument: "OTHER",
      }),
    );

    let primary = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    let other = database.getVirtualBettorState("buleto", "OTHER");
    assert.equal(primary.status, "armed");
    assert.equal(primary.activeSession.targetNumber, 1);
    assert.equal(other.status, "armed");
    assert.equal(other.activeSession.targetNumber, 7);
    assert.notEqual(primary.activeSession.id, other.activeSession.id);

    database.ingestBatch(
      Array.from({ length: 36 }, (_, index) =>
        event(3, `virtual-ladder-first-${index}`, 201 + index),
      ),
    );
    primary = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    other = database.getVirtualBettorState("buleto", "OTHER");
    assert.equal(primary.activeSession.attemptCount, 36);
    assert.equal(primary.activeSession.missCount, 36);
    assert.equal(primary.activeSession.totalStaked, 360);
    assert.equal(primary.activeSession.nextStake, 20);
    assert.equal(other.status, "armed");
    assert.equal(other.activeSession.attemptCount, 0);
    assert.equal(other.activeSession.totalStaked, 0);
    assert.equal(primary.testBank.currentBalance, 87_340);
    assert.equal(other.testBank.currentBalance, 87_700);

    database.ingestBatch(
      Array.from({ length: 18 }, (_, index) =>
        event(3, `virtual-ladder-second-${index}`, 237 + index),
      ),
    );
    primary = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(primary.activeSession.attemptCount, 54);
    assert.equal(primary.activeSession.totalStaked, 720);
    assert.equal(primary.activeSession.nextStake, 30);
    assert.equal(primary.lifetime.totalBets, 54);
    assert.equal(primary.lifetime.totalStaked, 720);
  } finally {
    database.close();
  }
});

test("a one-stake bankroll exhausts after one miss and cannot place more paper bets", () => {
  const database = createDatabase({
    path: ":memory:",
    virtualStartingBalance: 10,
  });
  try {
    database.ingestBatch(virtualTriggerEvents("virtual-bankroll-exhaust"));
    let state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "armed");
    assert.equal(state.testBank.currentBalance, 10);

    database.ingestBatch([event(3, "virtual-bankroll-exhaust-miss", 201)]);
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "bankroll_exhausted");
    assert.equal(state.activeSession, null);
    assert.deepEqual(state.testBank, {
      mode: "simulation",
      status: "exhausted",
      initialBalance: 10,
      currentBalance: 0,
      netResult: -10,
      nextStake: 10,
      canAffordNext: false,
      shortfall: 10,
      startedAt: state.testBank.startedAt,
      exhaustedAt: "2026-09-21T00:03:21.000Z",
      dataComplete: true,
    });
    assert.equal(state.recentSessions[0].status, "completed");
    assert.equal(state.recentSessions[0].endReason, "bankroll_exhausted");
    assert.equal(state.recentSessions[0].attemptCount, 1);
    assert.equal(state.recentSessions[0].netResult, -10);

    const betCount = state.lifetime.totalBets;
    const sessionCount = state.lifetime.totalSessions;
    database.ingestBatch([
      event(1, "virtual-bankroll-exhaust-later-hit", 202),
      event(3, "virtual-bankroll-exhaust-later-miss", 203),
    ]);
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "bankroll_exhausted");
    assert.equal(state.testBank.currentBalance, 0);
    assert.equal(state.lifetime.totalBets, betCount);
    assert.equal(state.lifetime.totalSessions, sessionCount);
  } finally {
    database.close();
  }
});

test("the default 87700 bank funds 216 misses and attempt 217 exactly", () => {
  const database = createDatabase({ path: ":memory:" });
  try {
    database.ingestBatch(virtualTriggerEvents("virtual-bankroll-default-limit"));
    database.ingestBatch(
      Array.from({ length: 216 }, (_, index) =>
        event(
          3,
          `virtual-bankroll-default-limit-session-miss-${index}`,
          201 + index,
        ),
      ),
    );

    let state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "active");
    assert.equal(state.activeSession.attemptCount, 216);
    assert.equal(state.activeSession.totalStaked, 85_260);
    assert.equal(state.activeSession.nextStake, 2_440);
    assert.equal(state.testBank.currentBalance, 2_440);
    assert.equal(state.testBank.canAffordNext, true);

    database.ingestBatch([
      event(3, "virtual-bankroll-default-limit-session-miss-216", 417),
    ]);
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.status, "bankroll_exhausted");
    assert.equal(state.testBank.currentBalance, 0);
    assert.equal(state.testBank.nextStake, 2_500);
    assert.equal(state.testBank.shortfall, 2_500);
    assert.equal(state.recentSessions[0].attemptCount, 217);
    assert.equal(state.recentSessions[0].totalStaked, 87_700);
    assert.equal(state.recentSessions[0].netResult, -87_700);
    assert.equal(state.recentSessions[0].endReason, "bankroll_exhausted");
  } finally {
    database.close();
  }
});

test("duplicate results never charge the virtual bankroll twice", () => {
  const database = createDatabase({
    path: ":memory:",
    virtualStartingBalance: 100,
  });
  try {
    database.ingestBatch(virtualTriggerEvents("virtual-bankroll-duplicate"));
    const next = event(3, "virtual-bankroll-duplicate-next", 201);
    database.ingestBatch([next]);
    const duplicate = database.ingestBatch([next]);
    const state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(duplicate.inserted, 0);
    assert.equal(duplicate.duplicates, 1);
    assert.equal(state.lifetime.totalBets, 1);
    assert.equal(state.testBank.currentBalance, 90);
  } finally {
    database.close();
  }
});

test("v7 paper history initializes v8 bankroll with all known net results exactly once", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-bankroll-v7-"));
  const path = join(directory, "paper-bankroll.sqlite");
  let database = createDatabase({ path });
  try {
    database.ingestBatch(virtualTriggerEvents("virtual-bankroll-migrate"));
    database.ingestBatch([
      ...Array.from({ length: 14 }, (_, index) =>
        event(3, `virtual-bankroll-migrate-next-miss-${index}`, 201 + index),
      ),
      event(1, "virtual-bankroll-migrate-hit", 215),
    ]);
    let state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.lifetime.netResult, 210);
    assert.equal(state.testBank.currentBalance, 87_910);
    database.close();

    const legacy = new DatabaseSync(path);
    try {
      legacy.exec(`
        DROP TABLE virtual_bankrolls;
        UPDATE virtual_bet_sessions SET end_reason = NULL;
        PRAGMA user_version = 7;
      `);
    } finally {
      legacy.close();
    }

    database = createDatabase({ path, virtualStartingBalance: 87_700 });
    state = database.initializeVirtualBettor(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(database.sqlite.prepare("PRAGMA user_version").get().user_version, 8);
    assert.equal(state.testBank.initialBalance, 87_700);
    assert.equal(state.testBank.currentBalance, 87_910);
    assert.equal(state.testBank.netResult, 210);
    assert.equal(state.recentSessions[0].endReason, "hit");
    assert.equal(
      database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM virtual_bankrolls")
        .get().count,
      1,
    );
    database.close();

    database = createDatabase({ path, virtualStartingBalance: 1 });
    state = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    assert.equal(state.testBank.initialBalance, 87_700);
    assert.equal(state.testBank.currentBalance, 87_910);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("virtual bankroll persists across reopen and remains isolated per stream", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-bankroll-streams-"));
  const path = join(directory, "paper-bankroll.sqlite");
  let database = createDatabase({ path, virtualStartingBalance: 50 });
  try {
    database.ingestBatch(virtualTriggerEvents("virtual-bankroll-primary"));
    database.ingestBatch(
      virtualTriggerEvents("virtual-bankroll-other", 7, 8, {
        instrument: "OTHER",
      }),
    );
    database.ingestBatch([event(3, "virtual-bankroll-primary-miss", 201)]);
    database.ingestBatch([
      event(7, "virtual-bankroll-other-hit", 201, { instrument: "OTHER" }),
    ]);

    let primary = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    let other = database.getVirtualBettorState("buleto", "OTHER");
    assert.equal(primary.testBank.currentBalance, 40);
    assert.equal(other.testBank.currentBalance, 400);
    database.close();

    database = createDatabase({ path, virtualStartingBalance: 999 });
    primary = database.getVirtualBettorState(
      "buleto",
      "PRIMECOIN(XPM)/RUB",
    );
    other = database.getVirtualBettorState("buleto", "OTHER");
    assert.equal(primary.testBank.initialBalance, 50);
    assert.equal(primary.testBank.currentBalance, 40);
    assert.equal(other.testBank.initialBalance, 50);
    assert.equal(other.testBank.currentBalance, 400);
    assert.equal(
      database.sqlite
        .prepare("SELECT COUNT(*) AS count FROM virtual_bankrolls")
        .get().count,
      2,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
