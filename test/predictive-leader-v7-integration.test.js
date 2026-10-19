import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  PREDICTIVE_LEADER_V7_CANDIDATE_CONFIG,
  PREDICTIVE_LEADER_V7_CONFIG_SHA256,
  PREDICTIVE_LEADER_V7_SOURCE_EXPORT,
  createDatabase,
} from "../src/database.js";
import {
  LEARNED_LEADER_V7_ALGORITHM_VERSION,
  LEARNED_LEADER_V7_CONFIG_VERSION,
} from "../src/learned-leader-v7.js";
import { buildLearnedLeaderDecision } from "../src/learned-leader.js";
import { TRAJECTORY_SHADOW_ADAPTIVE_VERSION } from "../src/trajectory-shadow-adaptive.js";
import {
  TRAJECTORY_RANK37_BASIS,
  TRAJECTORY_RANK37_EVIDENCE_MASS_THRESHOLD,
  TRAJECTORY_RANK37_SMOOTHING_WEIGHT,
  TRAJECTORY_RANK37_VERSION,
} from "../src/trajectory-rank37.js";

const LIVE_BASE = Date.parse("2026-10-18T01:00:00.000Z");
const SOURCE = "buleto";
const INSTRUMENT = "XPM/RUB";
const quietLogger = { info() {}, warn() {}, error() {} };

function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function resultEvent(number, roundId, baseMs, index) {
  const settledAt = iso(baseMs + index * 1_000);
  return {
    source: SOURCE,
    instrument: INSTRUMENT,
    settledAt,
    resultNumber: number,
    price: 5.4 + index / 10_000,
    observedAt: settledAt,
    externalRoundId: String(roundId),
    fingerprint: `v7-${roundId}-${number}-${index}`,
    rawPayload: { c: number },
  };
}

function forecast(externalRoundId, baseMs) {
  const lockedAt = iso(baseMs + 51_000);
  return {
    source: SOURCE,
    instrument: INSTRUMENT,
    externalRoundId: String(externalRoundId),
    horizonSeconds: 8,
    bettingClosesAt: iso(baseMs + 60_000),
    roundEndsAt: iso(baseMs + 100_000),
    factorAt: lockedAt,
    lockedAt,
    currentPrice: 5.4,
    startPrice: 5.35,
    currentNumber: 11,
    predictedPrice: 5.41,
    predictedNumber: 7,
    rankedNumbers: [7, 11, 19],
    cells: Array.from({ length: 38 }, (_, code) => ({
      c: code,
      vt: 6 - code / 100,
      vf: 5.99 - code / 100,
    })),
    features: {
      samples: [
        { dt: iso(baseMs + 47_000), v: 5.38 },
        { dt: iso(baseMs + 49_000), v: 5.39 },
        { dt: lockedAt, v: 5.4 },
      ],
      windowSeconds: 4,
      slopePerSecond: 0.005,
      secondsToEnd: 46,
    },
    modelVersion: "preclose-linear-v1",
  };
}

function seedPairHistory(database, baseMs) {
  const numbers = [9, 4, 9, 4, 9, 5, 9];
  database.ingestBatch(numbers.map((number, index) => (
    resultEvent(number, 100 + index, baseMs, index)
  )));
  database.sqlite.prepare(`
    UPDATE round_results
    SET created_at = observed_at
    WHERE fingerprint LIKE 'v7-%'
  `).run();
}

test("v31 freezes the production v7 config and export provenance in new tables", () => {
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(LIVE_BASE),
    logger: quietLogger,
    predictiveLeaderLegacyAccountEnabled: false,
  });
  try {
    assert.equal(database.sqlite.prepare("PRAGMA user_version").get().user_version, 32);
    const cohort = database.sqlite.prepare(`
      SELECT * FROM predictive_leader_v7_cohorts
    `).get();
    assert.equal(cohort.candidate_key, PREDICTIVE_LEADER_V7_CANDIDATE_CONFIG.candidateId);
    assert.equal(cohort.algorithm_version, LEARNED_LEADER_V7_ALGORITHM_VERSION);
    assert.equal(cohort.config_version, LEARNED_LEADER_V7_CONFIG_VERSION);
    assert.equal(cohort.mode, "prospective-shadow");
    assert.equal(cohort.source, SOURCE);
    assert.equal(cohort.instrument, INSTRUMENT);
    assert.equal(Number(cohort.target_horizon), 1);
    assert.equal(Number(cohort.forecast_horizon_seconds), 8);
    assert.equal(Number(cohort.first_forecast_id), 1);
    assert.deepEqual(JSON.parse(cohort.config_json), PREDICTIVE_LEADER_V7_CANDIDATE_CONFIG);
    assert.equal(
      createHash("sha256").update(cohort.config_json).digest("hex"),
      PREDICTIVE_LEADER_V7_CONFIG_SHA256,
    );
    assert.equal(cohort.source_export_artifact, PREDICTIVE_LEADER_V7_SOURCE_EXPORT.artifact);
    assert.equal(cohort.source_export_sha256, PREDICTIVE_LEADER_V7_SOURCE_EXPORT.sha256);
    assert.equal(cohort.source_export_cutoff_at, "2026-10-18T00:32:03.908Z");
    assert.ok(cohort.started_at > cohort.source_export_cutoff_at);
    assert.deepEqual(
      database.sqlite.prepare(`
        PRAGMA table_info(forecast_predictive_leader_v7_snapshots)
      `).all().map((column) => column.name),
      [
        "forecast_id",
        "candidate_key",
        "schema_version",
        "algorithm_version",
        "config_version",
        "target_horizon",
        "config_sha256",
        "status",
        "locked_at",
        "history_max_result_id",
        "predicted_number",
        "leader_mass",
        "margin",
        "selected",
        "snapshot_json",
        "created_at",
      ],
    );
    assert.throws(
      () => database.getPredictiveLeaderV7AuditState(SOURCE, "OTHER"),
      /pinned to its frozen stream/,
    );
  } finally {
    database.close();
  }
});

test("v27 starts at MAX(forecast)+1 and never backfills an older forecast", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-v7-boundary-"));
  const path = join(directory, "tracker.sqlite");
  let nowMs = LIVE_BASE;
  let database = createDatabase({
    path,
    clock: () => new Date(nowMs),
    logger: quietLogger,
    predictiveLeaderLegacyAccountEnabled: false,
  });
  try {
    const oldBase = Date.parse("2026-10-18T00:20:00.000Z");
    nowMs = oldBase + 52_000;
    assert.equal(database.recordPrecloseForecast(forecast("legacy", oldBase)).inserted, true);
    database.sqlite.exec(`
      DROP TRIGGER predictive_leader_v7_paper_fixed_v1_retired;
      DROP TRIGGER predictive_leader_v7_paper_fixed_v1_void_chronology;
      DROP TRIGGER predictive_leader_v7_paper_ladder_epoch_no_rollback;
      DROP TABLE predictive_leader_v7_paper_ladder_resets;
      DROP TABLE predictive_leader_v7_paper_ladder_voids;
      DROP TABLE predictive_leader_v7_paper_ladder_bets;
      DROP TABLE predictive_leader_v7_paper_ladder_campaigns;
      DROP TABLE predictive_leader_v7_paper_voids;
      DROP TABLE predictive_leader_v7_paper_bets;
      DROP TABLE predictive_leader_v7_paper_campaigns;
      DROP TABLE predictive_shadow_round_metadata_conflicts;
      DROP TABLE predictive_shadow_integrity_boundaries;
      DROP TABLE forecast_predictive_leader_v7_snapshots;
      DROP TABLE predictive_leader_v7_cohorts;
      PRAGMA user_version = 26;
    `);
    database.close();

    nowMs = Date.parse("2026-10-18T02:00:00.000Z");
    database = createDatabase({
      path,
      clock: () => new Date(nowMs),
      logger: quietLogger,
      predictiveLeaderLegacyAccountEnabled: false,
    });
    const cohort = database.sqlite.prepare(`
      SELECT first_forecast_id, started_at
      FROM predictive_leader_v7_cohorts
    `).get();
    assert.equal(Number(cohort.first_forecast_id), 2);
    assert.equal(cohort.started_at, "2026-10-18T02:00:00.000Z");
    assert.equal(
      Number(database.sqlite.prepare(`
        SELECT COUNT(*) AS count FROM forecast_predictive_leader_v7_snapshots
      `).get().count),
      0,
    );

    const newBase = Date.parse("2026-10-18T02:01:00.000Z");
    nowMs = newBase + 52_000;
    assert.equal(database.recordPrecloseForecast(forecast("live", newBase)).inserted, true);
    assert.deepEqual(
      database.sqlite.prepare(`
        SELECT forecast_id FROM forecast_predictive_leader_v7_snapshots
      `).all().map((row) => Number(row.forecast_id)),
      [2],
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("v27 keeps its v7 cohort and prospective snapshots append-only", () => {
  let nowMs = LIVE_BASE;
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(nowMs),
    logger: quietLogger,
    predictiveLeaderLegacyAccountEnabled: false,
  });
  try {
    nowMs = LIVE_BASE + 52_000;
    assert.equal(database.recordPrecloseForecast(forecast("append-only", LIVE_BASE)).inserted,
      true);
    assert.equal(
      Number(database.sqlite.prepare(`
        SELECT COUNT(*) AS count FROM forecast_predictive_leader_v7_snapshots
      `).get().count),
      1,
    );

    assert.throws(
      () => database.sqlite.prepare(`
        UPDATE predictive_leader_v7_cohorts SET config_json = config_json
      `).run(),
      /v7 shadow cohort is immutable/,
    );
    assert.throws(
      () => database.sqlite.prepare(`
        DELETE FROM predictive_leader_v7_cohorts
      `).run(),
      /v7 shadow cohort is immutable/,
    );
    assert.throws(
      () => database.sqlite.prepare(`
        UPDATE forecast_predictive_leader_v7_snapshots
        SET snapshot_json = snapshot_json
      `).run(),
      /v7 shadow snapshot is immutable/,
    );
    assert.throws(
      () => database.sqlite.prepare(`
        DELETE FROM forecast_predictive_leader_v7_snapshots
      `).run(),
      /v7 shadow snapshot is immutable/,
    );

    assert.equal(
      Number(database.sqlite.prepare(`
        SELECT COUNT(*) AS count FROM predictive_leader_v7_cohorts
      `).get().count),
      1,
    );
    assert.equal(
      Number(database.sqlite.prepare(`
        SELECT COUNT(*) AS count FROM forecast_predictive_leader_v7_snapshots
      `).get().count),
      1,
    );
  } finally {
    database.close();
  }
});

test("v7 shadow stays frozen, causal, read-only, and evaluates only after settlement", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-v7-lifecycle-"));
  const path = join(directory, "tracker.sqlite");
  let nowMs = LIVE_BASE;
  let database = createDatabase({
    path,
    clock: () => new Date(nowMs),
    logger: quietLogger,
    predictiveLeaderLegacyAccountEnabled: false,
  });
  try {
    nowMs = LIVE_BASE + 10_000;
    seedPairHistory(database, LIVE_BASE);
    nowMs = LIVE_BASE + 52_000;
    assert.deepEqual(database.recordPrecloseForecast(forecast("107", LIVE_BASE)), {
      inserted: true,
      databaseChanged: true,
      roundId: "107",
    });
    const frozen = database.sqlite.prepare(`
      SELECT * FROM forecast_predictive_leader_v7_snapshots
    `).get();
    const snapshot = JSON.parse(frozen.snapshot_json);
    assert.equal(frozen.status, "ready");
    assert.equal(Number(frozen.selected), 0);
    assert.equal(snapshot.shadow, true);
    assert.equal(snapshot.targetHorizon, 1);
    assert.deepEqual(snapshot.config, PREDICTIVE_LEADER_V7_CANDIDATE_CONFIG);
    assert.equal(snapshot.sourceManifest.length, 1);
    assert.equal(snapshot.sourceManifest[0].id, "conditional-pair-full");
    assert.equal(snapshot.sourceManifest[0].cursor.targetHorizon, 1);
    assert.equal(snapshot.sourceManifest[0].cursor.historyMaxResultId, 7);
    assert.equal(snapshot.sourceManifest[0].cursor.effectiveSampleSize, 3);

    let audit = database.getPredictiveLeaderV7AuditState(SOURCE, INSTRUMENT);
    assert.equal(audit.executionEnabled, false);
    assert.equal(audit.advisoryOnly, true);
    assert.equal(audit.metrics.storedCount, 1);
    assert.equal(audit.metrics.invalidCount, 0);
    assert.equal(audit.metrics.overall.pendingCount, 1);
    assert.equal(audit.qualityGateDiagnostic.status, "collecting");
    assert.equal(audit.qualityGateDiagnostic.fixed.settledCount, 0);
    assert.equal(audit.qualityGateDiagnostic.fixed.top1Hits, 0);
    assert.equal(audit.qualityGateDiagnostic.promotionEligible, false);

    assert.deepEqual(database.recordPrecloseForecast(forecast("107", LIVE_BASE)), {
      inserted: false,
      databaseChanged: false,
      roundId: "107",
    });
    nowMs = LIVE_BASE + 101_000;
    database.ingestBatch([resultEvent(4, 107, LIVE_BASE, 100)]);
    assert.equal(database.settlePrecloseForecasts(SOURCE, INSTRUMENT).settled, 1);
    audit = database.getPredictiveLeaderV7AuditState(SOURCE, INSTRUMENT);
    assert.equal(audit.metrics.overall.settledCount, 1);
    assert.equal(audit.metrics.overall.top1Hits, 1);
    assert.equal(audit.qualityGateDiagnostic.fixed.settledCount, 0);
    assert.equal(audit.qualityGateDiagnostic.fixed.top1Hits, 0);
    assert.equal(audit.latest.candidate.evaluation.actualNumber, 4);
    assert.equal(audit.latest.candidate.evaluation.top1Hit, true);
    assert.equal(
      database.sqlite.prepare(`
        SELECT snapshot_json FROM forecast_predictive_leader_v7_snapshots
      `).get().snapshot_json,
      frozen.snapshot_json,
      "settlement must not rewrite the prospective decision",
    );

    database.close();
    database = createDatabase({
      path,
      clock: () => new Date(nowMs),
      logger: quietLogger,
      predictiveLeaderLegacyAccountEnabled: false,
    });
    assert.equal(
      database.sqlite.prepare(`
        SELECT snapshot_json FROM forecast_predictive_leader_v7_snapshots
      `).get().snapshot_json,
      frozen.snapshot_json,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("v29 excludes a v7 snapshot after duplicate round metadata changes", () => {
  let nowMs = LIVE_BASE;
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(nowMs),
    logger: quietLogger,
    predictiveLeaderLegacyAccountEnabled: false,
  });
  try {
    nowMs = LIVE_BASE + 10_000;
    seedPairHistory(database, LIVE_BASE);
    nowMs = LIVE_BASE + 52_000;
    assert.equal(database.recordPrecloseForecast(
      forecast("v29-conflict", LIVE_BASE),
    ).inserted, true);

    const corrected = forecast("v29-conflict", LIVE_BASE);
    corrected.bettingClosesAt = iso(LIVE_BASE + 60_100);
    nowMs = LIVE_BASE + 53_000;
    assert.deepEqual(database.recordPrecloseForecast(corrected), {
      inserted: false,
      databaseChanged: true,
      roundId: "v29-conflict",
    });

    let audit = database.getPredictiveLeaderV7AuditState(SOURCE, INSTRUMENT);
    assert.equal(audit.metrics.storedCount, 1);
    assert.equal(audit.metrics.voidCount, 1);
    assert.equal(audit.metrics.readyCount, 0);
    assert.equal(audit.metrics.overall.settledCount, 0);
    assert.equal(audit.latest.candidate.availability, "void");

    nowMs = LIVE_BASE + 101_000;
    database.ingestBatch([resultEvent(4, "v29-conflict", LIVE_BASE, 100)]);
    assert.equal(database.settlePrecloseForecasts(SOURCE, INSTRUMENT).settled, 1);
    audit = database.getPredictiveLeaderV7AuditState(SOURCE, INSTRUMENT);
    assert.equal(audit.metrics.overall.settledCount, 0);
    assert.equal(audit.metrics.pairedChampion.pairedCount, 0);
  } finally {
    database.close();
  }
});

test("v7 failure is isolated from v5 and an idempotent retry repairs only the shadow", () => {
  const errors = [];
  let nowMs = LIVE_BASE;
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(nowMs),
    predictiveLeaderLegacyAccountEnabled: false,
    logger: {
      error(payload, message) {
        errors.push({ payload, message });
      },
    },
  });
  try {
    nowMs = LIVE_BASE + 10_000;
    seedPairHistory(database, LIVE_BASE);
    database.sqlite.exec(`
      CREATE TRIGGER reject_v7_shadow
      BEFORE INSERT ON forecast_predictive_leader_v7_snapshots
      BEGIN
        SELECT RAISE(ABORT, 'v7 sabotage');
      END;
    `);
    nowMs = LIVE_BASE + 52_000;
    assert.deepEqual(database.recordPrecloseForecast(forecast("107", LIVE_BASE)), {
      inserted: true,
      databaseChanged: true,
      roundId: "107",
    });
    assert.equal(
      Number(database.sqlite.prepare(`
        SELECT COUNT(*) AS count FROM forecast_predictive_leader_snapshots
      `).get().count),
      1,
    );
    assert.equal(
      Number(database.sqlite.prepare(`
        SELECT COUNT(*) AS count FROM forecast_predictive_leader_v7_snapshots
      `).get().count),
      0,
    );
    assert.equal(errors.at(-1).message,
      "predictive leader v7 shadow persistence failed without affecting champion");
    assert.match(errors.at(-1).payload.error.message, /v7 sabotage/);

    database.sqlite.exec("DROP TRIGGER reject_v7_shadow");
    assert.deepEqual(database.recordPrecloseForecast(forecast("107", LIVE_BASE)), {
      inserted: false,
      databaseChanged: true,
      roundId: "107",
    });
    assert.equal(
      Number(database.sqlite.prepare(`
        SELECT COUNT(*) AS count FROM forecast_predictive_leader_v7_snapshots
      `).get().count),
      1,
    );
  } finally {
    database.close();
  }
});

test("v7 adapter reproduces frozen smoothed Rank-37 mass and raw evidence", () => {
  let nowMs = LIVE_BASE;
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(nowMs),
    logger: quietLogger,
    predictiveLeaderLegacyAccountEnabled: false,
  });
  try {
    nowMs = LIVE_BASE + 10_000;
    seedPairHistory(database, LIVE_BASE);
    database.sqlite.exec(`
      CREATE TRIGGER defer_v7_adapter_test
      BEFORE INSERT ON forecast_predictive_leader_v7_snapshots
      BEGIN
        SELECT RAISE(ABORT, 'defer v7');
      END;
    `);
    nowMs = LIVE_BASE + 52_000;
    database.recordPrecloseForecast(forecast("107", LIVE_BASE));
    database.sqlite.exec("DROP TRIGGER defer_v7_adapter_test");

    const lockedAt = iso(LIVE_BASE + 51_000);
    const champion = buildLearnedLeaderDecision({
      sources: [
        {
          id: "price-trajectory-rank37",
          family: "price",
          numbers: Array.from({ length: 37 }, (_, number) => number),
          weights: Array.from({ length: 37 }, (_, number) => (
            number < 5 ? 0.2 : 0
          )),
          cursor: { forecastId: 1, cutoffAt: lockedAt },
        },
        {
          id: "conditional-pair-full",
          family: "conditional-history",
          numbers: [4, 5],
          weights: [2 / 3, 1 / 3],
          cursor: {
            historyMaxResultId: 7,
            anchorResultId: 7,
            continuityEpoch: 0,
            cutoffAt: lockedAt,
            sampleSize: 3,
          },
        },
      ],
      learningRows: [],
      lockedAt,
      tieSeed: "7:107",
    });
    database.sqlite.prepare(`
      UPDATE forecast_predictive_leader_snapshots
      SET status = ?, predicted_number = ?, score = ?, snapshot_json = ?
      WHERE forecast_id = 1
    `).run(
      champion.status,
      champion.leaderNumber,
      champion.leaderMass,
      JSON.stringify(champion),
    );
    const rawMass = Array.from({ length: 37 }, (_, number) => (
      number < 5 ? 0.2 : 0
    ));
    const ranking = rawMass.map((mass, number) => ({
      number,
      rawMass: mass,
      mass: (1 - TRAJECTORY_RANK37_SMOOTHING_WEIGHT) * mass
        + TRAJECTORY_RANK37_SMOOTHING_WEIGHT / 37,
    })).sort((left, right) => right.mass - left.mass)
      .map((candidate, index) => ({ rank: index + 1, ...candidate }));
    const integration = {
      adaptive: { trainingCount: 30 },
      numberRanking: {
        version: TRAJECTORY_RANK37_VERSION,
        basis: TRAJECTORY_RANK37_BASIS,
        candidateCount: 37,
        evidenceCandidateCount: 5,
        evidenceMassThreshold: TRAJECTORY_RANK37_EVIDENCE_MASS_THRESHOLD,
        tieSeed: "adapter-test",
        smoothing: {
          version: "uniform-mixture-v1",
          weight: TRAJECTORY_RANK37_SMOOTHING_WEIGHT,
          baselineMass: 1 / 37,
        },
        ranking,
      },
    };
    const trajectoryId = Number(database.sqlite.prepare(`
      INSERT INTO round_trajectories (
        schema_version, source, instrument, external_round_id, starts_at,
        betting_closes_at, betting_stops_at, round_ends_at, start_price,
        bottom_price, top_price, bands_json, first_received_at, created_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      SOURCE,
      INSTRUMENT,
      "107",
      iso(LIVE_BASE),
      iso(LIVE_BASE + 60_000),
      iso(LIVE_BASE + 70_000),
      iso(LIVE_BASE + 100_000),
      5.35,
      5,
      6,
      JSON.stringify(Array(38).fill(0)),
      iso(LIVE_BASE),
      iso(LIVE_BASE + 52_000),
    ).lastInsertRowid);
    database.sqlite.prepare(`
      UPDATE forecast_trajectory_shadows
      SET trajectory_id = ?, model_version = ?, status = 'ready', reason = NULL,
        lock_price = 5.4, median_cell_width = 0.01, direction = 'flat',
        probabilities_json = '{}', expected_delta_cell_widths = 0,
        integration_json = ?
      WHERE forecast_id = 1
    `).run(trajectoryId, TRAJECTORY_SHADOW_ADAPTIVE_VERSION, JSON.stringify(integration));

    assert.deepEqual(database.recordPrecloseForecast(forecast("107", LIVE_BASE)), {
      inserted: false,
      databaseChanged: true,
      roundId: "107",
    });
    const v7 = JSON.parse(database.sqlite.prepare(`
      SELECT snapshot_json FROM forecast_predictive_leader_v7_snapshots
    `).get().snapshot_json);
    const price = v7.sourceManifest.find((source) => source.family === "price");
    const pair = v7.sourceManifest.find(
      (source) => source.id === "conditional-pair-full",
    );
    assert.equal(price.id, "price-trajectory-rank37-smoothed");
    assert.equal(price.cursor.scoreKind, "smoothed-rank37");
    assert.equal(price.cursor.evidenceCandidateCount, 5);
    assert.equal(price.cursor.rawEvidenceCandidateCount, 5);
    assert.equal(price.cursor.forecastId, 1);
    assert.equal(price.cursor.targetHorizon, 1);
    assert.deepEqual(price.numbers, ranking.map(({ number }) => number));
    assert.deepEqual(price.weights, ranking.map(({ mass }) => mass));
    assert.equal(pair.cursor.historyMaxResultId, 7);
    assert.equal(pair.cursor.sampleSize, 3);
    assert.equal(pair.cursor.effectiveSampleSize, 3);
    assert.equal(pair.cursor.targetHorizon, 1);
    assert.equal(v7.evidence.price.scoreKind, "smoothed-rank37");
  } finally {
    database.close();
  }
});
