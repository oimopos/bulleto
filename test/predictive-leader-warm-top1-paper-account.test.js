import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  PREDICTIVE_LEADER_WARM_TOP1_PAPER_CAMPAIGN,
  PREDICTIVE_SHADOW_FROZEN_STREAM,
  createDatabase,
} from "../src/database.js";
import { predictiveLeaderWarmTop1PaperSnapshotForApi } from
  "../src/predictive-leader-warm-top1-paper-api.js";

const SOURCE = PREDICTIVE_SHADOW_FROZEN_STREAM.source;
const INSTRUMENT = PREDICTIVE_SHADOW_FROZEN_STREAM.instrument;
const CAMPAIGN_STARTED_MS = Date.parse("2026-10-19T00:00:00.000Z");
const quietLogger = { info() {}, warn() {}, error() {} };

function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function databaseAt(path, readNow) {
  return createDatabase({
    path,
    clock: () => new Date(readNow()),
    logger: quietLogger,
    predictiveLeaderLegacyAccountEnabled: false,
  });
}

function insertResult(database, {
  roundId,
  settledAt,
  number,
  continuityEpoch = 0,
  fingerprint = `warm-top1-result:${roundId}`,
}) {
  const id = Number(database.sqlite.prepare(`
    INSERT INTO round_results (
      source, instrument, settled_at, result_number, price, observed_at,
      external_round_id, raw_cell, fingerprint, raw_payload, cycle_id,
      continuity_epoch, created_at
    ) VALUES (?, ?, ?, ?, 5.4, ?, ?, NULL, ?, '{}', NULL, ?, ?)
  `).run(
    SOURCE,
    INSTRUMENT,
    settledAt,
    number,
    settledAt,
    String(roundId),
    fingerprint,
    continuityEpoch,
    settledAt,
  ).lastInsertRowid);
  return {
    id,
    roundId: String(roundId),
    number,
    settledAt,
    continuityEpoch,
  };
}

function insertWarmForecast(database, {
  roundId,
  anchor,
  lockedAt,
  targetNumber = 17,
  occurrenceCount = 5,
  sampleSize = 100,
  observedFollowerCount = 5,
  actualNumber = null,
}) {
  const lockedMs = Date.parse(lockedAt);
  const createdAt = iso(lockedMs + 1_000);
  const bettingClosesAt = iso(lockedMs + 10_000);
  const roundEndsAt = iso(lockedMs + 60_000);
  const snapshotId = Number(database.sqlite.prepare(`
    INSERT INTO forecast_snapshots (
      source, instrument, external_round_id, horizon_seconds,
      betting_closes_at, round_ends_at, factor_at, locked_at,
      lead_time_ms, persisted_at, persisted_lead_time_ms,
      current_price, start_price, current_number, cells_json,
      features_json, created_at
    ) VALUES (?, ?, ?, 8, ?, ?, ?, ?, 10000, ?, 9000,
      5.4, 5.35, ?, '[]', '{}', ?)
  `).run(
    SOURCE,
    INSTRUMENT,
    String(roundId),
    bettingClosesAt,
    roundEndsAt,
    lockedAt,
    lockedAt,
    createdAt,
    anchor.number,
    createdAt,
  ).lastInsertRowid);
  const forecastId = Number(database.sqlite.prepare(`
    INSERT INTO round_forecasts (
      snapshot_id, model_version, predicted_price, predicted_number,
      ranked_numbers_json, created_at
    ) VALUES (?, 'warm-top1-paper-fixture-v1', 5.41, ?, ?, ?)
  `).run(
    snapshotId,
    targetNumber,
    JSON.stringify([targetNumber, (targetNumber + 1) % 37, (targetNumber + 2) % 37]),
    createdAt,
  ).lastInsertRowid);
  const pairTop3 = [
    {
      number: targetNumber,
      occurrenceCount,
      firstOccurredAt: anchor.settledAt,
      lastOccurredAt: anchor.settledAt,
    },
    {
      number: (targetNumber + 1) % 37,
      occurrenceCount: Math.max(1, occurrenceCount - 1),
      firstOccurredAt: anchor.settledAt,
      lastOccurredAt: anchor.settledAt,
    },
    {
      number: (targetNumber + 2) % 37,
      occurrenceCount: Math.max(1, occurrenceCount - 2),
      firstOccurredAt: anchor.settledAt,
      lastOccurredAt: anchor.settledAt,
    },
  ];
  database.sqlite.prepare(`
    INSERT INTO forecast_pair_snapshots (
      forecast_id, schema_version, status, history_cutoff_at, captured_at,
      history_max_result_id, anchor_result_id, anchor_number,
      anchor_settled_at, anchor_continuity_epoch, sample_size,
      observed_follower_count, pair_top3_json, model_top3_json,
      overlap_numbers_json, overlap_count, same_top1, exact_order, created_at
    ) VALUES (?, 1, 'ready', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 0, ?)
  `).run(
    forecastId,
    lockedAt,
    createdAt,
    anchor.id,
    anchor.id,
    anchor.number,
    anchor.settledAt,
    anchor.continuityEpoch,
    sampleSize,
    observedFollowerCount,
    JSON.stringify(pairTop3),
    JSON.stringify([targetNumber, (targetNumber + 3) % 37, (targetNumber + 4) % 37]),
    JSON.stringify([targetNumber]),
    createdAt,
  );

  let result = null;
  if (actualNumber !== null) {
    result = insertResult(database, {
      roundId,
      settledAt: roundEndsAt,
      number: actualNumber,
      continuityEpoch: anchor.continuityEpoch,
    });
    database.sqlite.prepare(`
      INSERT INTO forecast_settlements (
        forecast_id, round_result_id, actual_number, settled_at,
        top1_hit, top3_hit, current_cell_hit, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      forecastId,
      result.id,
      actualNumber,
      result.settledAt,
      Number(actualNumber === targetNumber),
      Number(pairTop3.some(({ number }) => number === actualNumber)),
      result.settledAt,
    );
  }
  return {
    forecastId,
    roundId: String(roundId),
    targetNumber,
    lockedAt,
    createdAt,
    bettingClosesAt,
    roundEndsAt,
    result,
  };
}

function seedConfirmedGateWindow(database, {
  firstRoundId = 200_000,
  targetNumber = 17,
} = {}) {
  let anchor = insertResult(database, {
    roundId: firstRoundId,
    settledAt: iso(CAMPAIGN_STARTED_MS + 1_000),
    number: 4,
  });
  let lastForecast = null;
  database.sqlite.exec("BEGIN IMMEDIATE");
  try {
    for (let index = 1; index <= 1_000; index += 1) {
      const lockedAt = iso(CAMPAIGN_STARTED_MS + index * 120_000 - 60_000);
      const hit = ((index * 61) % 1_000) < 60;
      lastForecast = insertWarmForecast(database, {
        roundId: firstRoundId + index,
        anchor,
        lockedAt,
        targetNumber,
        actualNumber: hit ? targetNumber : (targetNumber + 1) % 37,
      });
      anchor = lastForecast.result;
    }
    database.sqlite.exec("COMMIT");
  } catch (error) {
    database.sqlite.exec("ROLLBACK");
    throw error;
  }
  return { anchor, lastForecast };
}

function runtimeForForecast(forecast, anchor) {
  return {
    collector: {
      connected: true,
      status: "connected",
      error: null,
      lastResultAt: anchor.settledAt,
      pendingResultCount: 0,
      resultConfirmationPending: false,
      currentRound: {
        id: forecast.roundId,
        status: 2,
        startsAt: forecast.lockedAt,
        bettingClosesAt: forecast.bettingClosesAt,
      },
    },
    latestResult: {
      id: anchor.id,
      roundId: anchor.roundId,
      settledAt: anchor.settledAt,
    },
    pipelinePending: {
      results: 0,
      gaps: 0,
    },
  };
}

test("schema v33 creates the warm Top-1 campaign and rejects future v34", () => {
  const database = databaseAt(":memory:", () => CAMPAIGN_STARTED_MS);
  try {
    assert.equal(database.sqlite.prepare("PRAGMA user_version").get().user_version, 33);
    const tables = new Set(database.sqlite.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table'
    `).all().map(({ name }) => name));
    assert.equal(tables.has("predictive_leader_warm_top1_paper_campaigns"), true);
    assert.equal(tables.has("predictive_leader_warm_top1_paper_bets"), true);
    const campaign = database.sqlite.prepare(`
      SELECT * FROM predictive_leader_warm_top1_paper_campaigns
    `).get();
    assert.equal(campaign.campaign_key, PREDICTIVE_LEADER_WARM_TOP1_PAPER_CAMPAIGN.campaignKey);
    assert.equal(campaign.gate_status, "collecting");
    assert.equal(Number(campaign.first_forecast_id), 1);
  } finally {
    database.close();
  }

  const directory = mkdtempSync(join(tmpdir(), "roulette-warm-top1-v34-"));
  const path = join(directory, "tracker.sqlite");
  const sentinel = new DatabaseSync(path);
  sentinel.exec(`
    CREATE TABLE future_schema_sentinel (value TEXT NOT NULL);
    INSERT INTO future_schema_sentinel (value) VALUES ('preserve-me');
    PRAGMA journal_mode = DELETE;
    PRAGMA user_version = 34;
  `);
  sentinel.close();
  try {
    assert.throws(
      () => databaseAt(path, () => CAMPAIGN_STARTED_MS),
      /schema version 34 is newer than supported version 33/,
    );
    const reopened = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(reopened.prepare("PRAGMA user_version").get().user_version, 34);
      assert.equal(reopened.prepare("PRAGMA journal_mode").get().journal_mode, "delete");
      assert.equal(
        reopened.prepare("SELECT value FROM future_schema_sentinel").get().value,
        "preserve-me",
      );
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("v32 migration freezes a future MAX(forecast)+1 activation boundary", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-warm-top1-boundary-"));
  const path = join(directory, "tracker.sqlite");
  let nowMs = CAMPAIGN_STARTED_MS;
  let database = databaseAt(path, () => nowMs);
  try {
    const anchor = insertResult(database, {
      roundId: 99,
      settledAt: iso(CAMPAIGN_STARTED_MS + 1_000),
      number: 4,
    });
    const historical = insertWarmForecast(database, {
      roundId: 100,
      anchor,
      lockedAt: iso(CAMPAIGN_STARTED_MS + 60_000),
    });
    database.sqlite.exec(`
      DROP TABLE predictive_leader_warm_top1_paper_bets;
      DROP TABLE predictive_leader_warm_top1_paper_campaigns;
      PRAGMA user_version = 31;
    `);
    database.close();

    nowMs = CAMPAIGN_STARTED_MS + 120_000;
    database = databaseAt(path, () => nowMs);
    const campaign = database.sqlite.prepare(`
      SELECT * FROM predictive_leader_warm_top1_paper_campaigns
    `).get();
    assert.equal(Number(campaign.first_forecast_id), historical.forecastId + 1);
    assert.equal(campaign.started_at, iso(nowMs));
    assert.equal(campaign.gate_status, "collecting");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("exact five-percent Top-1 is parsed but collecting gate cannot place", () => {
  let nowMs = CAMPAIGN_STARTED_MS;
  const database = databaseAt(":memory:", () => nowMs);
  try {
    const anchor = insertResult(database, {
      roundId: 500,
      settledAt: iso(CAMPAIGN_STARTED_MS + 1_000),
      number: 4,
    });
    const forecast = insertWarmForecast(database, {
      roundId: 501,
      anchor,
      lockedAt: iso(CAMPAIGN_STARTED_MS + 60_000),
      occurrenceCount: 5,
      sampleSize: 100,
      observedFollowerCount: 5,
    });
    nowMs = Date.parse(forecast.createdAt);

    const initialized = database.initializePredictiveLeaderWarmTop1PaperCampaign(
      SOURCE,
      INSTRUMENT,
    );
    assert.equal(initialized.gateStatus, "collecting");
    assert.equal(initialized.placed, 0);
    assert.equal(initialized.reason, "no_pending_bet");

    const placement = database.placePredictiveLeaderWarmTop1PaperBet(
      SOURCE,
      INSTRUMENT,
      forecast.forecastId,
    );
    assert.equal(placement.placed, 0);
    assert.equal(placement.reason, "quality_gate_collecting");
    assert.equal(placement.gateStatus, "collecting");
    assert.equal(Number(database.sqlite.prepare(`
      SELECT COUNT(*) AS count FROM predictive_leader_warm_top1_paper_bets
    `).get().count), 0);

    const state = database.getPredictiveLeaderWarmTop1PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.candidateEvidence.status, "ready");
    assert.equal(state.candidateEvidence.reason, "threshold_met");
    assert.equal(state.candidateEvidence.eligible, true);
    assert.equal(state.candidateEvidence.rank, 1);
    assert.equal(state.candidateEvidence.number, 17);
    assert.equal(state.candidateEvidence.occurrenceCount, 5);
    assert.equal(state.candidateEvidence.sampleSize, 100);
    assert.equal(state.candidateEvidence.share, 0.05);
    assert.equal(state.candidateEvidence.threshold, 0.05);
    assert.equal(state.candidateEvidence.comparison, "gte");
    assert.match(state.candidateEvidence.evidenceSha256, /^[a-f0-9]{64}$/u);
    assert.equal(state.qualityGate.status, "collecting");
    assert.equal(state.qualityGate.controlsPaperAction, false);
    assert.equal(state.qualityGate.selectedCount, 1);
    assert.equal(state.qualityGate.settledCount, 0);
    assert.equal(state.qualityGate.fixedWindowComplete, false);
    assert.equal(state.pendingBet, null);

    const api = predictiveLeaderWarmTop1PaperSnapshotForApi({
      paperState: state,
      source: SOURCE,
      instrument: INSTRUMENT,
      now: new Date(nowMs),
    });
    assert.equal(api.status, "waiting");
    assert.equal(api.reason, "quality_gate_collecting");
    assert.equal(api.action, "WAIT");
    assert.equal(api.number, null);
    assert.equal(api.stake, null);
    assert.equal(api.qualityGate.status, "collecting");
  } finally {
    database.close();
  }
});

test("confirmed fixed gate permits one paper bet and authoritative settlement", () => {
  let nowMs = CAMPAIGN_STARTED_MS;
  const database = databaseAt(":memory:", () => nowMs);
  try {
    const { anchor } = seedConfirmedGateWindow(database);
    const current = insertWarmForecast(database, {
      roundId: 201_001,
      anchor,
      lockedAt: iso(CAMPAIGN_STARTED_MS + 1_000 * 120_000 + 60_000),
      targetNumber: 17,
    });
    nowMs = Date.parse(current.createdAt);

    const reconciliation = database.reconcilePredictiveLeaderWarmTop1PaperCampaign(
      SOURCE,
      INSTRUMENT,
    );
    assert.equal(reconciliation.gateStatus, "confirmed");
    const stateBefore = database.getPredictiveLeaderWarmTop1PaperState(SOURCE, INSTRUMENT);
    assert.equal(stateBefore.qualityGate.status, "confirmed");
    assert.equal(stateBefore.qualityGate.controlsPaperAction, true);
    assert.equal(stateBefore.qualityGate.selectedCount, 1_000);
    assert.equal(stateBefore.qualityGate.settledCount, 1_000);
    assert.equal(stateBefore.qualityGate.hitCount, 60);
    assert.ok(stateBefore.qualityGate.top1Wilson95.lower > 1 / 36);
    assert.ok(stateBefore.qualityGate.binaryBrierDeltaVsUniformHac95.upper < 0);

    const placement = database.placePredictiveLeaderWarmTop1PaperBet(
      SOURCE,
      INSTRUMENT,
      current.forecastId,
    );
    assert.equal(placement.placed, 1);
    assert.equal(placement.reason, "bet_frozen");
    assert.equal(placement.number, 17);
    assert.equal(placement.stake, 10);
    const readyState = database.getPredictiveLeaderWarmTop1PaperState(
      SOURCE,
      INSTRUMENT,
    );
    const readyApi = predictiveLeaderWarmTop1PaperSnapshotForApi({
      paperState: readyState,
      runtimeState: runtimeForForecast(current, anchor),
      source: SOURCE,
      instrument: INSTRUMENT,
      now: new Date(nowMs),
    });
    assert.equal(readyApi.action, "BET");
    assert.equal(readyApi.actionId, `warm-top1-paper-bet:${readyState.pendingBet.id}`);
    assert.equal(readyApi.number, 17);
    assert.equal(readyApi.stake, 10);

    const result = insertResult(database, {
      roundId: current.roundId,
      settledAt: current.roundEndsAt,
      number: 17,
    });
    database.sqlite.prepare(`
      INSERT INTO forecast_settlements (
        forecast_id, round_result_id, actual_number, settled_at,
        top1_hit, top3_hit, current_cell_hit, created_at
      ) VALUES (?, ?, 17, ?, 1, 1, 0, ?)
    `).run(current.forecastId, result.id, result.settledAt, result.settledAt);
    nowMs = Date.parse(result.settledAt) + 1_000;

    const settled = database.reconcilePredictiveLeaderWarmTop1PaperCampaign(
      SOURCE,
      INSTRUMENT,
    );
    assert.equal(settled.settled, 1);
    assert.equal(settled.reason, "hit");
    const stateAfter = database.getPredictiveLeaderWarmTop1PaperState(SOURCE, INSTRUMENT);
    assert.equal(stateAfter.pendingBet, null);
    assert.equal(stateAfter.latestOutcome.outcome, "hit");
    assert.equal(stateAfter.account.currentBalance, 10_350);
    assert.equal(stateAfter.account.nextStake, 10);
  } finally {
    database.close();
  }
});

test("an integrity gap atomically voids and refunds Warm Top-1 before later placement", () => {
  let nowMs = CAMPAIGN_STARTED_MS;
  const database = databaseAt(":memory:", () => nowMs);
  try {
    const { anchor } = seedConfirmedGateWindow(database);
    const pending = insertWarmForecast(database, {
      roundId: 201_001,
      anchor,
      lockedAt: iso(CAMPAIGN_STARTED_MS + 1_000 * 120_000 + 60_000),
    });
    nowMs = Date.parse(pending.createdAt);
    assert.equal(database.placePredictiveLeaderWarmTop1PaperBet(
      SOURCE,
      INSTRUMENT,
      pending.forecastId,
    ).placed, 1);
    let state = database.getPredictiveLeaderWarmTop1PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.account.currentBalance, 9_990);
    assert.equal(state.account.reservedStake, 10);
    assert.equal(state.pendingBet.forecastId, pending.forecastId);

    const gap = database.markGap({
      source: SOURCE,
      instrument: INSTRUMENT,
      incidentKey: "warm-top1-pending-gap",
      detectedAt: iso(nowMs + 1_000),
      message: "test unresolved Warm Top-1 gap",
    });
    assert.equal(gap.kind, "gap");
    assert.equal(gap.duplicate, false);
    state = database.getPredictiveLeaderWarmTop1PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.pendingBet, null);
    assert.equal(state.account.currentBalance, 10_000);
    assert.equal(state.account.reservedStake, 0);
    assert.equal(state.account.ledgerRevision, 2);
    assert.equal(state.stats.voidCount, 1);
    assert.equal(state.latestVoid.forecastId, pending.forecastId);
    assert.equal(state.latestVoid.reason, "integrity_gap");
    assert.deepEqual({ ...database.sqlite.prepare(`
      SELECT status, void_reason FROM predictive_leader_warm_top1_paper_bets
      WHERE forecast_id = ?
    `).get(pending.forecastId) }, {
      status: "void",
      void_reason: "integrity_gap",
    });

    const duplicate = database.markGap({
      source: SOURCE,
      instrument: INSTRUMENT,
      incidentKey: "warm-top1-pending-gap",
      detectedAt: iso(nowMs + 1_000),
      message: "duplicate Warm Top-1 gap",
    });
    assert.equal(duplicate.duplicate, true);
    state = database.getPredictiveLeaderWarmTop1PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.account.currentBalance, 10_000);
    assert.equal(state.account.ledgerRevision, 2);
    assert.equal(state.stats.voidCount, 1);

    const postGapAnchor = insertResult(database, {
      roundId: 201_002,
      settledAt: iso(Date.parse(pending.roundEndsAt) + 1_000),
      number: 4,
      continuityEpoch: 1,
    });
    const later = insertWarmForecast(database, {
      roundId: 201_003,
      anchor: postGapAnchor,
      lockedAt: iso(Date.parse(postGapAnchor.settledAt) + 60_000),
    });
    nowMs = Date.parse(later.createdAt);
    const laterPlacement = database.placePredictiveLeaderWarmTop1PaperBet(
      SOURCE,
      INSTRUMENT,
      later.forecastId,
    );
    assert.equal(laterPlacement.gateStatus, "confirmed");
    assert.equal(laterPlacement.placed, 1);
    assert.equal(laterPlacement.reason, "bet_frozen");
    state = database.getPredictiveLeaderWarmTop1PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.pendingBet.forecastId, later.forecastId);
    assert.equal(state.account.currentBalance, 9_990);
    assert.equal(state.stats.betCount, 2);
    assert.equal(state.stats.voidCount, 1);
  } finally {
    database.close();
  }
});

test("a standalone metadata conflict immediately refunds Warm Top-1 and API never emits BET", () => {
  let nowMs = CAMPAIGN_STARTED_MS;
  const database = databaseAt(":memory:", () => nowMs);
  try {
    const { anchor } = seedConfirmedGateWindow(database);
    const pending = insertWarmForecast(database, {
      roundId: 201_001,
      anchor,
      lockedAt: iso(CAMPAIGN_STARTED_MS + 1_000 * 120_000 + 60_000),
    });
    nowMs = Date.parse(pending.createdAt);
    assert.equal(database.placePredictiveLeaderWarmTop1PaperBet(
      SOURCE,
      INSTRUMENT,
      pending.forecastId,
    ).placed, 1);

    nowMs += 1_000;
    const conflict = database.recordCurrentCellHorizonMetadataConflict(
      SOURCE,
      INSTRUMENT,
      pending.roundId,
      pending.bettingClosesAt,
      iso(Date.parse(pending.bettingClosesAt) + 250),
      iso(nowMs),
    );
    assert.equal(conflict.inserted, true);
    assert.equal(conflict.reason, "metadata_conflict_recorded");

    let state = database.getPredictiveLeaderWarmTop1PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.pendingBet, null);
    assert.equal(state.account.currentBalance, 10_000);
    assert.equal(state.account.reservedStake, 0);
    assert.equal(state.account.ledgerRevision, 2);
    assert.equal(state.stats.voidCount, 1);
    assert.equal(state.latestVoid.forecastId, pending.forecastId);
    assert.equal(state.latestVoid.reason, "round_metadata_conflict");

    const api = predictiveLeaderWarmTop1PaperSnapshotForApi({
      paperState: state,
      runtimeState: runtimeForForecast(pending, anchor),
      source: SOURCE,
      instrument: INSTRUMENT,
      now: new Date(nowMs),
    });
    assert.equal(api.action, "WAIT");
    assert.equal(api.reason, "paper_bet_not_pending");
    assert.equal(api.number, null);
    assert.equal(api.stake, null);

    const duplicate = database.recordCurrentCellHorizonMetadataConflict(
      SOURCE,
      INSTRUMENT,
      pending.roundId,
      pending.bettingClosesAt,
      iso(Date.parse(pending.bettingClosesAt) + 500),
      iso(nowMs),
    );
    assert.equal(duplicate.inserted, false);
    assert.equal(duplicate.reason, "already_recorded");
    state = database.getPredictiveLeaderWarmTop1PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.account.currentBalance, 10_000);
    assert.equal(state.account.ledgerRevision, 2);
    assert.equal(state.stats.voidCount, 1);
  } finally {
    database.close();
  }
});

test("startup initialization recovers one current eligible Warm Top-1 forecast once", () => {
  let nowMs = CAMPAIGN_STARTED_MS;
  const database = databaseAt(":memory:", () => nowMs);
  try {
    const { anchor } = seedConfirmedGateWindow(database);
    const current = insertWarmForecast(database, {
      roundId: 201_001,
      anchor,
      lockedAt: iso(CAMPAIGN_STARTED_MS + 1_000 * 120_000 + 60_000),
    });
    nowMs = Date.parse(current.createdAt);

    const recovered = database.initializePredictiveLeaderWarmTop1PaperCampaign(
      SOURCE,
      INSTRUMENT,
    );
    assert.equal(recovered.gateStatus, "confirmed");
    assert.equal(recovered.placed, 1);
    assert.equal(recovered.reason, "bet_frozen");
    let state = database.getPredictiveLeaderWarmTop1PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.pendingBet.forecastId, current.forecastId);
    assert.equal(state.account.currentBalance, 9_990);
    assert.equal(state.stats.betCount, 1);

    const repeated = database.initializePredictiveLeaderWarmTop1PaperCampaign(
      SOURCE,
      INSTRUMENT,
    );
    assert.equal(repeated.placed, 0);
    state = database.getPredictiveLeaderWarmTop1PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.pendingBet.forecastId, current.forecastId);
    assert.equal(state.account.currentBalance, 9_990);
    assert.equal(state.stats.betCount, 1);
  } finally {
    database.close();
  }
});
