import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CURRENT_CELL_HORIZON_SHADOW_CONFIG_SHA256,
  CURRENT_CELL_HORIZON_SHADOW_SOURCE_EXPORT,
  createDatabase,
} from "../src/database.js";
import {
  CURRENT_CELL_HORIZON_SHADOW_ALGORITHM_VERSION,
  CURRENT_CELL_HORIZON_SHADOW_COHORT_KEY,
  CURRENT_CELL_HORIZON_SHADOW_CONFIG,
  CURRENT_CELL_HORIZON_SHADOW_CONFIG_VERSION,
  evaluateCurrentCellHorizonShadow,
} from "../src/current-cell-horizon-shadow.js";
import { buildLearnedLeaderDecision } from "../src/learned-leader.js";

const SOURCE = "buleto";
const INSTRUMENT = "XPM/RUB";
const BASE_MS = Date.parse("2026-10-18T02:00:00.000Z");
const quietLogger = { info() {}, warn() {}, error() {} };

function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function bands() {
  return Array.from({ length: 38 }, (_, wireCell) => ({
    wireCell,
    number: wireCell === 37 ? 0 : wireCell,
    lower: 37 - wireCell,
    upper: 38 - wireCell,
  }));
}

function trajectory(roundId, startsAtMs, factors) {
  const bettingClosesAtMs = startsAtMs + 60_000;
  return {
    schemaVersion: 1,
    source: SOURCE,
    instrument: INSTRUMENT,
    receivedAt: iso(Math.max(...factors.map((factor) => factor.receivedAtMs))),
    round: {
      externalRoundId: String(roundId),
      status: 2,
      startsAt: iso(startsAtMs),
      bettingClosesAt: iso(bettingClosesAtMs),
      bettingStopsAt: iso(startsAtMs + 70_000),
      endsAt: iso(startsAtMs + 100_000),
      startPrice: 35.5,
      bottomPrice: 0,
      topPrice: 38,
      cellBands: bands(),
    },
    factors: factors.map((factor) => ({
      at: iso(factor.atMs),
      receivedAt: iso(factor.receivedAtMs),
      price: factor.price,
    })),
  };
}

function resultEvent(roundId, number, settledAtMs) {
  return {
    source: SOURCE,
    instrument: INSTRUMENT,
    settledAt: iso(settledAtMs),
    resultNumber: number,
    price: 34.5,
    observedAt: iso(settledAtMs),
    externalRoundId: String(roundId),
    fingerprint: `current-cell-${roundId}-${number}`,
    rawPayload: { c: number },
  };
}

function precloseForecast(roundId, startsAtMs) {
  const lockedAtMs = startsAtMs + 52_000;
  return {
    source: SOURCE,
    instrument: INSTRUMENT,
    externalRoundId: String(roundId),
    horizonSeconds: 8,
    bettingClosesAt: iso(startsAtMs + 60_000),
    roundEndsAt: iso(startsAtMs + 100_000),
    factorAt: iso(lockedAtMs),
    lockedAt: iso(lockedAtMs),
    currentPrice: 34.5,
    startPrice: 35.5,
    currentNumber: 3,
    predictedPrice: 34.5,
    predictedNumber: 3,
    rankedNumbers: [3, 2, 4],
    cells: bands().map((band) => ({
      c: band.wireCell,
      vt: band.upper,
      vf: band.lower,
    })),
    features: {
      samples: [
        { dt: iso(lockedAtMs - 4_000), v: 34.7 },
        { dt: iso(lockedAtMs - 2_000), v: 34.6 },
        { dt: iso(lockedAtMs), v: 34.5 },
      ],
      windowSeconds: 2,
      slopePerSecond: -0.05,
      secondsToEnd: 48,
    },
    modelVersion: "preclose-linear-v1",
  };
}

test("v28 creates an immutable, empty, no-backfill prospective cohort", () => {
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(BASE_MS),
    logger: quietLogger,
    predictiveLeaderLegacyAccountEnabled: false,
  });
  try {
    assert.equal(database.sqlite.prepare("PRAGMA user_version").get().user_version, 29);
    const cohort = database.sqlite.prepare(`
      SELECT * FROM current_cell_horizon_shadow_cohorts
    `).get();
    assert.equal(cohort.cohort_key, CURRENT_CELL_HORIZON_SHADOW_COHORT_KEY);
    assert.equal(cohort.algorithm_version, CURRENT_CELL_HORIZON_SHADOW_ALGORITHM_VERSION);
    assert.equal(cohort.config_version, CURRENT_CELL_HORIZON_SHADOW_CONFIG_VERSION);
    assert.equal(Number(cohort.first_trajectory_id), 1);
    assert.equal(cohort.mode, "prospective-shadow");
    assert.equal(cohort.source, SOURCE);
    assert.equal(cohort.instrument, INSTRUMENT);
    assert.deepEqual(JSON.parse(cohort.config_json), CURRENT_CELL_HORIZON_SHADOW_CONFIG);
    assert.equal(cohort.config_sha256, CURRENT_CELL_HORIZON_SHADOW_CONFIG_SHA256);
    assert.equal(
      cohort.source_export_sha256,
      CURRENT_CELL_HORIZON_SHADOW_SOURCE_EXPORT.sha256,
    );
    assert.ok(cohort.started_at > cohort.source_export_cutoff_at);
    assert.equal(database.sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM round_trajectory_current_cell_horizon_snapshots
    `).get().count, 0);

    const audit = database.getCurrentCellHorizonShadowAuditState(SOURCE, INSTRUMENT);
    assert.equal(audit.latest, null);
    assert.equal(audit.metrics.storedCount, 0);
    assert.equal(audit.metrics.pairedV5.pairedCount, 0);
    assert.equal(audit.qualityGateDiagnostic.status, "collecting");
    assert.equal(audit.qualityGateDiagnostic.promotionEligible, false);
    assert.equal(
      audit.qualityGateDiagnostic.multiplicityPolicy,
      "bonferroni-two-prospective-candidates",
    );
    assert.equal(audit.qualityGateDiagnostic.minimumPairedV5Coverage, 0.9);
    assert.equal(audit.qualityGateDiagnostic.minimumPairedV5Count, 900);
    assert.equal(
      Object.hasOwn(audit.qualityGateDiagnostic, "minimumBrierImprovementVsUniform"),
      false,
    );
    assert.throws(
      () => database.getCurrentCellHorizonShadowAuditState(SOURCE, "OTHER"),
      /pinned to its frozen stream/,
    );
    assert.deepEqual(
      database.recordCurrentCellHorizonShadow(
        SOURCE,
        "OTHER",
        "missing",
        iso(BASE_MS + 60_000),
      ),
      { inserted: false, reason: "outside_frozen_stream", retryable: false },
    );
    assert.throws(() => database.sqlite.prepare(`
      UPDATE current_cell_horizon_shadow_cohorts SET config_json = config_json
    `).run(), /cohort is immutable/);
    assert.throws(() => database.sqlite.prepare(`
      DELETE FROM current_cell_horizon_shadow_cohorts
    `).run(), /cohort is immutable/);
  } finally {
    database.close();
  }
});

test("v28 captures only causal ticks, enforces identity, then settles append-only", () => {
  let nowMs = BASE_MS;
  let clockQueue = [];
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(clockQueue.length > 0 ? clockQueue.shift() : nowMs),
    logger: quietLogger,
    predictiveLeaderLegacyAccountEnabled: false,
  });
  const startsAtMs = BASE_MS + 60_000;
  const closesAtMs = startsAtMs + 60_000;
  const cutoffMs = closesAtMs - 10_000;
  try {
    nowMs = cutoffMs - 100;
    database.recordRoundTrajectory(trajectory("live-1", startsAtMs, [{
      atMs: cutoffMs - 1_000,
      receivedAtMs: cutoffMs - 900,
      price: 34.5,
    }]));

    // This tick exists in SQLite, but receipt and persistence are after the
    // frozen cutoff, so the dedicated capture query must exclude it.
    nowMs = cutoffMs + 50;
    database.recordRoundTrajectory(trajectory("live-1", startsAtMs, [{
      atMs: cutoffMs - 50,
      receivedAtMs: cutoffMs + 10,
      price: 33.5,
    }]));

    nowMs = cutoffMs + 100;
    assert.deepEqual(
      database.recordCurrentCellHorizonShadow(
        SOURCE,
        INSTRUMENT,
        "live-1",
        iso(closesAtMs),
      ),
      {
        inserted: true,
        reason: "frozen",
        retryable: false,
        trajectoryId: 1,
        status: "ready",
      },
    );
    assert.equal(
      database.recordCurrentCellHorizonShadow(
        SOURCE,
        INSTRUMENT,
        "live-1",
        iso(closesAtMs),
      ).reason,
      "already_frozen",
    );
    const stored = database.sqlite.prepare(`
      SELECT * FROM round_trajectory_current_cell_horizon_snapshots
    `).get();
    const snapshot = JSON.parse(stored.snapshot_json);
    assert.equal(snapshot.leaderNumber, 3);
    assert.equal(snapshot.tickManifest.length, 1);
    assert.equal(snapshot.tickManifest[0].price, 34.5);
    assert.ok(
      closesAtMs - Date.parse(snapshot.capturedAt)
        >= CURRENT_CELL_HORIZON_SHADOW_CONFIG.minimumExecutionBufferMs,
    );

    const evaluation = evaluateCurrentCellHorizonShadow(snapshot, 3);
    const insertTamperedEvaluation = (resultId, evaluatedAt) => database.sqlite.prepare(`
      INSERT INTO round_trajectory_current_cell_horizon_evaluations (
        trajectory_id, cohort_key, round_result_id, actual_number, top1_hit,
        brier_loss, clipped_log_loss, evaluation_json, evaluated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      1,
      CURRENT_CELL_HORIZON_SHADOW_COHORT_KEY,
      resultId,
      evaluation.actualNumber,
      Number(evaluation.top1Hit),
      evaluation.brierLoss,
      evaluation.clippedLogLoss,
      JSON.stringify(evaluation),
      evaluatedAt,
    );

    database.sqlite.exec("SAVEPOINT temporal_tamper");
    const temporalResultId = Number(database.sqlite.prepare(`
      INSERT INTO round_results (
        source, instrument, settled_at, result_number, price, observed_at,
        external_round_id, raw_cell, fingerprint, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      SOURCE,
      INSTRUMENT,
      snapshot.capturedAt,
      3,
      34.5,
      snapshot.capturedAt,
      "live-1",
      3,
      "current-cell-temporal-tamper",
      snapshot.capturedAt,
    ).lastInsertRowid);
    assert.throws(
      () => insertTamperedEvaluation(temporalResultId, iso(closesAtMs + 1_000)),
      /evaluation identity is invalid/,
    );
    database.sqlite.exec("ROLLBACK TO temporal_tamper; RELEASE temporal_tamper");

    database.sqlite.exec("SAVEPOINT identity_tamper");
    const wrongResultId = Number(database.sqlite.prepare(`
      INSERT INTO round_results (
        source, instrument, settled_at, result_number, price, observed_at,
        external_round_id, raw_cell, fingerprint, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      SOURCE,
      INSTRUMENT,
      iso(closesAtMs + 1_000),
      3,
      34.5,
      iso(closesAtMs + 1_000),
      "another-round",
      3,
      "current-cell-identity-tamper",
      iso(closesAtMs + 1_000),
    ).lastInsertRowid);
    assert.throws(
      () => insertTamperedEvaluation(wrongResultId, iso(closesAtMs + 2_000)),
      /evaluation identity is invalid/,
    );
    database.sqlite.exec("ROLLBACK TO identity_tamper; RELEASE identity_tamper");

    nowMs = closesAtMs - 7_500;
    assert.equal(
      database.recordPrecloseForecast(precloseForecast("live-1", startsAtMs)).inserted,
      true,
    );
    const lockedAt = iso(startsAtMs + 52_000);
    const champion = buildLearnedLeaderDecision({
      sources: [{
        id: "current-cell-paired-price",
        family: "price",
        numbers: [3],
        weights: [1],
        cursor: { forecastId: 1, cutoffAt: lockedAt },
      }],
      learningRows: [],
      lockedAt,
      tieSeed: "current-cell-paired-v5",
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

    nowMs = closesAtMs + 30_000;
    database.ingestBatch([resultEvent("live-1", 3, closesAtMs + 20_000)]);
    database.sqlite.prepare(`
      UPDATE round_results SET created_at = observed_at WHERE fingerprint = ?
    `).run("current-cell-live-1-3");
    const settlementIdentity = database.sqlite.prepare(`
      SELECT
        snapshots.snapshot_json,
        trajectories.source,
        trajectories.instrument,
        trajectories.external_round_id,
        trajectories.betting_closes_at,
        results.result_number,
        results.settled_at,
        results.observed_at,
        results.created_at
      FROM round_trajectory_current_cell_horizon_snapshots AS snapshots
      JOIN round_trajectories AS trajectories ON trajectories.id = snapshots.trajectory_id
      JOIN round_results AS results
        ON results.source = trajectories.source
       AND results.instrument = trajectories.instrument
       AND results.external_round_id = trajectories.external_round_id
    `).get();
    assert.deepEqual({
      source: settlementIdentity.source,
      instrument: settlementIdentity.instrument,
      roundId: settlementIdentity.external_round_id,
      bettingClosesAt: settlementIdentity.betting_closes_at,
      actualNumber: Number(settlementIdentity.result_number),
      resultAfterCapture: [
        settlementIdentity.settled_at,
        settlementIdentity.observed_at,
        settlementIdentity.created_at,
      ].every((value) => value > snapshot.capturedAt),
    }, {
      source: snapshot.source,
      instrument: snapshot.instrument,
      roundId: snapshot.externalRoundId,
      bettingClosesAt: snapshot.bettingClosesAt,
      actualNumber: 3,
      resultAfterCapture: true,
    });
    assert.deepEqual(
      database.settleCurrentCellHorizonShadows(SOURCE, INSTRUMENT),
      { settled: 1 },
    );
    assert.deepEqual(
      database.settleCurrentCellHorizonShadows(SOURCE, INSTRUMENT),
      { settled: 0 },
    );
    let audit = database.getCurrentCellHorizonShadowAuditState(SOURCE, INSTRUMENT);
    assert.equal(audit.metrics.invalidCount, 0);
    assert.equal(audit.metrics.overall.settledCount, 1);
    assert.equal(audit.metrics.overall.top1Hits, 1);
    assert.equal(audit.metrics.pairedV5.pairedCount, 0);
    assert.equal(audit.latest.championV5.evaluation, null);
    assert.equal(audit.latest.candidate.evaluation.top1Hit, true);

    database.sqlite.exec("SAVEPOINT v5_settlement_tamper");
    const tamperedV5ResultId = Number(database.sqlite.prepare(`
      INSERT INTO round_results (
        source, instrument, settled_at, result_number, price, observed_at,
        external_round_id, raw_cell, fingerprint, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      SOURCE,
      INSTRUMENT,
      iso(closesAtMs + 21_000),
      3,
      34.5,
      iso(closesAtMs + 21_000),
      "wrong-v5-round",
      3,
      "current-cell-v5-settlement-tamper",
      iso(closesAtMs + 21_000),
    ).lastInsertRowid);
    database.sqlite.prepare(`
      INSERT INTO forecast_settlements (
        forecast_id, round_result_id, actual_number, settled_at, top1_hit,
        top3_hit, current_cell_hit, created_at
      ) VALUES (1, ?, 3, ?, 1, 1, 1, ?)
    `).run(
      tamperedV5ResultId,
      iso(closesAtMs + 21_000),
      iso(closesAtMs + 21_000),
    );
    audit = database.getCurrentCellHorizonShadowAuditState(SOURCE, INSTRUMENT);
    assert.equal(audit.metrics.pairedV5.pairedCount, 0);
    assert.equal(audit.latest.championV5.availability, "missing_or_invalid");
    database.sqlite.exec("ROLLBACK TO v5_settlement_tamper; RELEASE v5_settlement_tamper");

    assert.equal(database.settlePrecloseForecasts(SOURCE, INSTRUMENT).settled, 1);
    database.sqlite.prepare(`
      UPDATE forecast_settlements SET created_at = settled_at WHERE forecast_id = 1
    `).run();
    audit = database.getCurrentCellHorizonShadowAuditState(SOURCE, INSTRUMENT);
    assert.equal(audit.metrics.pairedV5.pairedCount, 1);
    assert.equal(audit.metrics.pairedV5.bothCorrect, 1);
    assert.equal(
      Number.isFinite(audit.metrics.pairedV5.meanClippedLogLossDelta),
      true,
    );
    assert.equal(
      Number.isFinite(audit.metrics.pairedV5.clippedLogLossDeltaHac95?.mean),
      true,
    );
    assert.equal(audit.metrics.pairedV5.clippedLogLossDeltaHac95.upper, null);
    assert.deepEqual(audit.paperSimulation, {
      mode: "audit-only-flat-paper",
      executionEnabled: false,
      startingBalance: 1_000,
      stakePerRound: 10,
      grossPayoutMultiplier: 36,
      attemptedCount: 1,
      settledCount: 1,
      pendingCount: 0,
      hitCount: 1,
      totalStaked: 10,
      grossPayout: 360,
      netResult: 350,
      currentBalance: 1_350,
      stoppedAtTrajectoryId: null,
    });
    assert.throws(() => database.sqlite.prepare(`
      UPDATE round_trajectory_current_cell_horizon_snapshots
      SET snapshot_json = snapshot_json
    `).run(), /snapshot is immutable/);
    assert.throws(() => database.sqlite.prepare(`
      DELETE FROM round_trajectory_current_cell_horizon_evaluations
    `).run(), /evaluation is immutable/);
  } finally {
    database.close();
  }
});

test("v28 rolls back a capture if commit loses the execution buffer", () => {
  let nowMs = BASE_MS;
  let clockQueue = [];
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(clockQueue.length > 0 ? clockQueue.shift() : nowMs),
    logger: quietLogger,
    predictiveLeaderLegacyAccountEnabled: false,
  });
  const startsAtMs = BASE_MS + 180_000;
  const closesAtMs = startsAtMs + 60_000;
  const cutoffMs = closesAtMs - 10_000;
  try {
    nowMs = cutoffMs - 100;
    database.recordRoundTrajectory(trajectory("buffer", startsAtMs, [{
      atMs: cutoffMs - 1_000,
      receivedAtMs: cutoffMs - 900,
      price: 34.5,
    }]));
    nowMs = cutoffMs + 100;
    clockQueue = [cutoffMs + 100, closesAtMs - 4_999];
    assert.throws(
      () => database.recordCurrentCellHorizonShadow(
        SOURCE,
        INSTRUMENT,
        "buffer",
        iso(closesAtMs),
      ),
      /finish at least five seconds before betting closes/,
    );
    assert.equal(database.sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM round_trajectory_current_cell_horizon_snapshots
    `).get().count, 0);
  } finally {
    database.close();
  }
});

test("v29 persists a scheduler metadata conflict before trajectory capture", () => {
  let nowMs = BASE_MS;
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(nowMs),
    logger: quietLogger,
    predictiveLeaderLegacyAccountEnabled: false,
  });
  const startsAtMs = BASE_MS + 300_000;
  const originalClosesAtMs = startsAtMs + 60_000;
  const observedClosesAtMs = originalClosesAtMs + 1_000;
  try {
    nowMs = startsAtMs + 1_000;
    assert.deepEqual(
      database.recordCurrentCellHorizonMetadataConflict(
        SOURCE,
        INSTRUMENT,
        "pre-capture-conflict",
        iso(originalClosesAtMs),
        iso(observedClosesAtMs),
        iso(nowMs),
      ),
      {
        inserted: true,
        databaseChanged: true,
        reason: "metadata_conflict_recorded",
      },
    );

    const input = trajectory("pre-capture-conflict", startsAtMs, [{
      atMs: startsAtMs + 500,
      receivedAtMs: startsAtMs + 600,
      price: 34.5,
    }]);
    input.round.bettingClosesAt = iso(observedClosesAtMs);
    nowMs = observedClosesAtMs - 9_900;
    database.recordRoundTrajectory(input);
    assert.deepEqual(
      database.recordCurrentCellHorizonShadow(
        SOURCE,
        INSTRUMENT,
        "pre-capture-conflict",
        iso(observedClosesAtMs),
      ),
      {
        inserted: false,
        reason: "metadata_conflict",
        retryable: false,
        voidInserted: false,
        databaseChanged: false,
      },
    );
    const audit = database.getCurrentCellHorizonShadowAuditState(SOURCE, INSTRUMENT);
    assert.equal(audit.metrics.voidCount, 1);
    assert.equal(audit.metrics.readyCount, 0);
    assert.equal(audit.latest.candidate.availability, "void");
    assert.equal(database.sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM round_trajectory_current_cell_horizon_snapshots
    `).get().count, 0);
  } finally {
    database.close();
  }
});

test("v29 voids an already captured snapshot and remains fail-closed after restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "current-cell-v29-conflict-"));
  const path = join(directory, "state.sqlite");
  let nowMs = BASE_MS;
  let database = createDatabase({
    path,
    clock: () => new Date(nowMs),
    logger: quietLogger,
    predictiveLeaderLegacyAccountEnabled: false,
  });
  const startsAtMs = BASE_MS + 420_000;
  const closesAtMs = startsAtMs + 60_000;
  const cutoffMs = closesAtMs - 10_000;
  try {
    nowMs = cutoffMs - 100;
    database.recordRoundTrajectory(trajectory("post-capture-conflict", startsAtMs, [{
      atMs: cutoffMs - 1_000,
      receivedAtMs: cutoffMs - 900,
      price: 34.5,
    }]));
    nowMs = cutoffMs + 100;
    assert.equal(database.recordCurrentCellHorizonShadow(
      SOURCE,
      INSTRUMENT,
      "post-capture-conflict",
      iso(closesAtMs),
    ).inserted, true);

    const correction = trajectory("post-capture-conflict", startsAtMs, [{
      atMs: cutoffMs,
      receivedAtMs: cutoffMs + 200,
      price: 34.4,
    }]);
    correction.round.bettingClosesAt = iso(closesAtMs + 1_000);
    nowMs = cutoffMs + 300;
    assert.deepEqual(database.recordRoundTrajectory(correction), {
      inserted: false,
      ticksInserted: 0,
      trajectoryId: 1,
      metadataConflict: true,
      voidInserted: true,
      databaseChanged: true,
    });

    nowMs = closesAtMs + 30_000;
    database.ingestBatch([resultEvent("post-capture-conflict", 3, closesAtMs + 20_000)]);
    assert.deepEqual(
      database.settleCurrentCellHorizonShadows(SOURCE, INSTRUMENT),
      { settled: 0 },
    );
    let audit = database.getCurrentCellHorizonShadowAuditState(SOURCE, INSTRUMENT);
    assert.equal(audit.metrics.voidCount, 1);
    assert.equal(audit.metrics.overall.settledCount, 0);
    assert.equal(audit.paperSimulation.attemptedCount, 0);
    assert.equal(audit.latest.candidate.availability, "void");

    database.close();
    database = createDatabase({
      path,
      clock: () => new Date(nowMs),
      logger: quietLogger,
      predictiveLeaderLegacyAccountEnabled: false,
    });
    audit = database.getCurrentCellHorizonShadowAuditState(SOURCE, INSTRUMENT);
    assert.equal(audit.metrics.voidCount, 1);
    assert.equal(audit.metrics.overall.settledCount, 0);
    assert.equal(database.sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM round_trajectory_current_cell_horizon_evaluations
    `).get().count, 0);
    assert.throws(() => database.sqlite.prepare(`
      DELETE FROM predictive_shadow_round_metadata_conflicts
    `).run(), /void is immutable/);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("v29 voids a captured snapshot when the final payload corrects bcd", () => {
  let nowMs = BASE_MS;
  const database = createDatabase({
    path: ":memory:",
    clock: () => new Date(nowMs),
    logger: quietLogger,
    predictiveLeaderLegacyAccountEnabled: false,
  });
  const startsAtMs = BASE_MS + 540_000;
  const closesAtMs = startsAtMs + 60_000;
  const cutoffMs = closesAtMs - 10_000;
  try {
    nowMs = cutoffMs - 100;
    database.recordRoundTrajectory(trajectory("final-bcd-conflict", startsAtMs, [{
      atMs: cutoffMs - 1_000,
      receivedAtMs: cutoffMs - 900,
      price: 34.5,
    }]));
    nowMs = cutoffMs + 100;
    assert.equal(database.recordCurrentCellHorizonShadow(
      SOURCE,
      INSTRUMENT,
      "final-bcd-conflict",
      iso(closesAtMs),
    ).inserted, true);

    nowMs = closesAtMs + 30_000;
    const finalResult = resultEvent(
      "final-bcd-conflict",
      3,
      closesAtMs + 20_000,
    );
    finalResult.rawPayload.bcd = iso(closesAtMs + 1_000);
    const ingestion = database.ingestBatch([finalResult]);
    assert.equal(ingestion.inserted, 1);
    assert.equal(ingestion.metadataConflictCount, 1);
    assert.equal(ingestion.databaseChanged, true);
    assert.deepEqual(
      database.settleCurrentCellHorizonShadows(SOURCE, INSTRUMENT),
      { settled: 0 },
    );
    const audit = database.getCurrentCellHorizonShadowAuditState(SOURCE, INSTRUMENT);
    assert.equal(audit.metrics.voidCount, 1);
    assert.equal(audit.metrics.overall.settledCount, 0);
    assert.equal(audit.paperSimulation.attemptedCount, 0);
  } finally {
    database.close();
  }
});
