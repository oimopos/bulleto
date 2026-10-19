import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  PREDICTIVE_LEADER_V7_CANDIDATE_CONFIG,
  PREDICTIVE_LEADER_V7_CONFIG_SHA256,
  createDatabase,
} from "../src/database.js";
import {
  LEARNED_LEADER_V7_ALGORITHM_VERSION,
  LEARNED_LEADER_V7_CONFIG_VERSION,
  LEARNED_LEADER_V7_SCHEMA_VERSION,
  LEARNED_LEADER_V7_TARGET_HORIZON,
  buildLearnedLeaderV7Decision,
} from "../src/learned-leader-v7.js";

const SOURCE = "buleto";
const INSTRUMENT = "XPM/RUB";
const CAMPAIGN_STARTED_MS = Date.parse("2026-10-18T01:00:00.000Z");
const FIRST_ROUND_BASE_MS = CAMPAIGN_STARTED_MS + 60_000;
const ROUND_STRIDE_MS = 110_000;
const quietLogger = { info() {}, warn() {}, error() {} };

function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function databaseAt(path, readNow, options = {}) {
  return createDatabase({
    path,
    clock: () => new Date(readNow()),
    logger: quietLogger,
    predictiveLeaderLegacyAccountEnabled: false,
    ...options,
  });
}

function streamEvent(resultNumber, fingerprint, settledAt, externalRoundId) {
  return {
    source: SOURCE,
    instrument: INSTRUMENT,
    settledAt,
    resultNumber,
    price: 5.4,
    observedAt: settledAt,
    externalRoundId: String(externalRoundId),
    fingerprint,
    rawPayload: { c: resultNumber },
  };
}

function insertUnreconciledGap(database, {
  incidentKey,
  detectedAt,
  reason = "paper-account-test-unhandled-gap",
}) {
  database.sqlite.exec("BEGIN IMMEDIATE");
  try {
    database.sqlite.prepare(`
      INSERT INTO stream_state (source, instrument, continuity_epoch)
      VALUES (?, ?, 1)
      ON CONFLICT(source, instrument) DO UPDATE SET
        continuity_epoch = continuity_epoch + 1
    `).run(SOURCE, INSTRUMENT);
    const insertion = database.sqlite.prepare(`
      INSERT INTO incidents (
        kind, source, instrument, message, incident_key,
        detected_at, details_json, cycle_id, created_at
      ) VALUES ('gap', ?, ?, 'test unhandled gap', ?, ?, ?, NULL, ?)
    `).run(
      SOURCE,
      INSTRUMENT,
      incidentKey,
      detectedAt,
      JSON.stringify({ reason }),
      detectedAt,
    );
    database.sqlite.exec("COMMIT");
    return Number(insertion.lastInsertRowid);
  } catch (error) {
    database.sqlite.exec("ROLLBACK");
    throw error;
  }
}

function selectedDecision(targetNumber, lockedAt, roundId) {
  const priceWeights = Array(37).fill(0);
  priceWeights[targetNumber] = 0.8;
  for (let offset = 1; offset <= 4; offset += 1) {
    priceWeights[(targetNumber + offset) % 37] = 0.05;
  }
  const decision = buildLearnedLeaderV7Decision({
    config: PREDICTIVE_LEADER_V7_CANDIDATE_CONFIG,
    lockedAt,
    tieSeed: `paper-account:${roundId}`,
    sources: [
      {
        id: "price-trajectory-rank37-raw",
        family: "price",
        numbers: Array.from({ length: 37 }, (_, number) => number),
        weights: priceWeights,
        cursor: {
          cutoffAt: lockedAt,
          targetHorizon: LEARNED_LEADER_V7_TARGET_HORIZON,
          scoreKind: "raw-rank37",
          evidenceCandidateCount: 5,
        },
      },
      {
        id: "conditional-pair-full",
        family: "conditional-history",
        numbers: [targetNumber],
        weights: [1],
        cursor: {
          cutoffAt: lockedAt,
          targetHorizon: LEARNED_LEADER_V7_TARGET_HORIZON,
          sampleSize: 100,
          effectiveSampleSize: 100,
        },
      },
    ],
  });
  assert.equal(decision.status, "ready");
  assert.equal(decision.selection.eligible, true);
  assert.equal(decision.leaderNumber, targetNumber);
  return decision;
}

function seedSelectedForecast(database, setNow, {
  roundId,
  baseMs,
  targetNumber = 7,
}) {
  const lockedAt = iso(baseMs + 51_000);
  const createdAt = iso(baseMs + 52_000);
  const bettingClosesAt = iso(baseMs + 60_000);
  const roundEndsAt = iso(baseMs + 100_000);
  setNow(baseMs + 52_000);

  const snapshotId = Number(database.sqlite.prepare(`
    INSERT INTO forecast_snapshots (
      source, instrument, external_round_id, horizon_seconds,
      betting_closes_at, round_ends_at, factor_at, locked_at,
      lead_time_ms, persisted_at, persisted_lead_time_ms,
      current_price, start_price, current_number, cells_json,
      features_json, created_at
    ) VALUES (?, ?, ?, 8, ?, ?, ?, ?, 9000, ?, 8000,
      5.4, 5.35, 11, '[]', '{}', ?)
  `).run(
    SOURCE,
    INSTRUMENT,
    String(roundId),
    bettingClosesAt,
    roundEndsAt,
    lockedAt,
    lockedAt,
    createdAt,
    createdAt,
  ).lastInsertRowid);
  const forecastId = Number(database.sqlite.prepare(`
    INSERT INTO round_forecasts (
      snapshot_id, model_version, predicted_price, predicted_number,
      ranked_numbers_json, created_at
    ) VALUES (?, 'paper-account-fixture-v1', 5.41, ?, ?, ?)
  `).run(
    snapshotId,
    targetNumber,
    JSON.stringify([
      targetNumber,
      (targetNumber + 1) % 37,
      (targetNumber + 2) % 37,
    ]),
    createdAt,
  ).lastInsertRowid);
  const decision = selectedDecision(targetNumber, lockedAt, String(roundId));
  database.sqlite.prepare(`
    INSERT INTO forecast_predictive_leader_v7_snapshots (
      forecast_id, candidate_key, schema_version, algorithm_version,
      config_version, target_horizon, config_sha256, status, locked_at,
      history_max_result_id, predicted_number, leader_mass, margin,
      selected, snapshot_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, NULL, ?, ?, ?, 1, ?, ?)
  `).run(
    forecastId,
    PREDICTIVE_LEADER_V7_CANDIDATE_CONFIG.candidateId,
    LEARNED_LEADER_V7_SCHEMA_VERSION,
    LEARNED_LEADER_V7_ALGORITHM_VERSION,
    LEARNED_LEADER_V7_CONFIG_VERSION,
    LEARNED_LEADER_V7_TARGET_HORIZON,
    PREDICTIVE_LEADER_V7_CONFIG_SHA256,
    lockedAt,
    targetNumber,
    decision.leaderMass,
    decision.margin,
    JSON.stringify(decision),
    createdAt,
  );
  return {
    forecastId,
    roundId: String(roundId),
    targetNumber,
    lockedAt,
    createdAt,
    bettingClosesAt,
    roundEndsAt,
  };
}

function place(database, forecast) {
  return database.placePredictiveLeaderV7PaperBet(
    SOURCE,
    INSTRUMENT,
    forecast.forecastId,
  );
}

function attachAuthoritativeSettlement(
  database,
  setNow,
  forecast,
  actualNumber,
  { anonymous = false } = {},
) {
  const settledAt = forecast.roundEndsAt;
  const createdAt = iso(Date.parse(settledAt) + 1_000);
  setNow(Date.parse(createdAt));
  const continuityEpoch = Number(database.sqlite.prepare(`
    SELECT continuity_epoch FROM stream_state
    WHERE source = ? AND instrument = ?
  `).get(SOURCE, INSTRUMENT).continuity_epoch);
  const resultId = Number(database.sqlite.prepare(`
    INSERT INTO round_results (
      source, instrument, settled_at, result_number, price, observed_at,
      external_round_id, raw_cell, fingerprint, raw_payload, cycle_id,
      continuity_epoch, created_at
    ) VALUES (?, ?, ?, ?, 5.4, ?, ?, NULL, ?, '{}', NULL, ?, ?)
  `).run(
    SOURCE,
    INSTRUMENT,
    settledAt,
    actualNumber,
    settledAt,
    anonymous ? null : forecast.roundId,
    `paper-account-result:${forecast.roundId}`,
    continuityEpoch,
    createdAt,
  ).lastInsertRowid);
  const ranked = [
    forecast.targetNumber,
    (forecast.targetNumber + 1) % 37,
    (forecast.targetNumber + 2) % 37,
  ];
  database.sqlite.prepare(`
    INSERT INTO forecast_settlements (
      forecast_id, round_result_id, actual_number, settled_at,
      top1_hit, top3_hit, current_cell_hit, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    forecast.forecastId,
    resultId,
    actualNumber,
    settledAt,
    Number(actualNumber === forecast.targetNumber),
    Number(ranked.includes(actualNumber)),
    Number(actualNumber === 11),
    createdAt,
  );
  return resultId;
}

function settle(database) {
  return database.settlePredictiveLeaderV7PaperCampaign(SOURCE, INSTRUMENT);
}

function insertLegacyFixedPending(database, forecast) {
  const campaign = database.sqlite.prepare(`
    SELECT * FROM predictive_leader_v7_paper_campaigns
  `).get();
  database.sqlite.prepare(`
    INSERT INTO stream_state (source, instrument, continuity_epoch)
    VALUES (?, ?, 0)
    ON CONFLICT(source, instrument) DO NOTHING
  `).run(SOURCE, INSTRUMENT);
  const continuityEpoch = Number(database.sqlite.prepare(`
    SELECT continuity_epoch FROM stream_state
    WHERE source = ? AND instrument = ?
  `).get(SOURCE, INSTRUMENT).continuity_epoch);
  database.sqlite.exec("BEGIN IMMEDIATE");
  try {
    database.sqlite.prepare(`
      INSERT INTO predictive_leader_v7_paper_bets (
        campaign_id, forecast_id, candidate_key, external_round_id,
        continuity_epoch, target_number, stake, balance_before, locked_at,
        betting_closes_at, status, placed_at, updated_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 10, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(
      Number(campaign.id),
      forecast.forecastId,
      campaign.candidate_key,
      forecast.roundId,
      continuityEpoch,
      forecast.targetNumber,
      Number(campaign.current_balance),
      forecast.lockedAt,
      forecast.bettingClosesAt,
      forecast.createdAt,
      forecast.createdAt,
      forecast.createdAt,
    );
    const update = database.sqlite.prepare(`
      UPDATE predictive_leader_v7_paper_campaigns
      SET current_balance = current_balance - fixed_stake,
        last_continuity_epoch = ?, updated_at = ?
      WHERE id = ? AND status = 'running' AND current_balance = ?
        AND ledger_deficit = 0
    `).run(
      continuityEpoch,
      forecast.createdAt,
      Number(campaign.id),
      Number(campaign.current_balance),
    );
    assert.equal(Number(update.changes), 1);
    database.sqlite.exec("COMMIT");
  } catch (error) {
    database.sqlite.exec("ROLLBACK");
    throw error;
  }
}

function settleMissSeries(database, setNow, {
  count,
  firstIndex = 1,
  roundPrefix,
}) {
  for (let offset = 0; offset < count; offset += 1) {
    const index = firstIndex + offset;
    const miss = seedSelectedForecast(database, setNow, {
      roundId: `${roundPrefix}-${index}`,
      baseMs: FIRST_ROUND_BASE_MS + index * ROUND_STRIDE_MS,
    });
    assert.equal(place(database, miss).placed, 1);
    attachAuthoritativeSettlement(database, setNow, miss, 8);
    assert.equal(settle(database).reason, "miss");
  }
}

test("a newer database schema is rejected without touching its data", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-v7-paper-future-schema-"));
  const path = join(directory, "tracker.sqlite");
  const sentinel = new DatabaseSync(path);
  sentinel.exec(`
    CREATE TABLE future_schema_sentinel (value TEXT NOT NULL);
    INSERT INTO future_schema_sentinel (value) VALUES ('preserve-me');
    PRAGMA journal_mode = DELETE;
    PRAGMA user_version = 32;
  `);
  sentinel.close();
  try {
    assert.throws(
      () => databaseAt(path, () => CAMPAIGN_STARTED_MS),
      /schema version 32 is newer than supported version 31/,
    );
    const reopened = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(reopened.prepare("PRAGMA user_version").get().user_version, 32);
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

test("v31 ladder campaign starts at MAX(forecast)+1 without rewriting fixed-v1", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-v7-paper-boundary-"));
  const path = join(directory, "tracker.sqlite");
  let nowMs = CAMPAIGN_STARTED_MS;
  let database = databaseAt(path, () => nowMs);
  try {
    database.sqlite.exec(`
      DROP TRIGGER predictive_leader_v7_paper_fixed_v1_retired;
      DROP TRIGGER predictive_leader_v7_paper_fixed_v1_void_chronology;
      DROP TRIGGER predictive_leader_v7_paper_ladder_epoch_no_rollback;
      DROP TABLE predictive_leader_v7_paper_ladder_resets;
      DROP TABLE predictive_leader_v7_paper_ladder_voids;
      DROP TABLE predictive_leader_v7_paper_ladder_bets;
      DROP TABLE predictive_leader_v7_paper_ladder_campaigns;
      PRAGMA user_version = 30;
    `);
    const historical = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "historical-before-paper",
      baseMs: FIRST_ROUND_BASE_MS,
    });
    nowMs += 1_000;
    const preactivationGapId = insertUnreconciledGap(database, {
      incidentKey: "paper-account-preactivation-gap",
      detectedAt: iso(nowMs),
      reason: "preactivation-test-gap",
    });
    database.close();

    nowMs = CAMPAIGN_STARTED_MS + 60 * 60_000;
    database = databaseAt(path, () => nowMs);
    const initialized = database.initializePredictiveLeaderV7PaperCampaign(
      SOURCE,
      INSTRUMENT,
    );
    assert.equal(initialized.initialized, 1);
    assert.equal(initialized.databaseChanged, false);
    assert.equal(initialized.reason, "no_pending_bet");

    let state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.activationBoundary.firstForecastId, historical.forecastId + 1);
    assert.equal(state.schemaVersion, 2);
    assert.equal(state.model.kind, "loss-recovery-ladder");
    assert.equal(state.model.cycleSpendLimit, 1_000);
    assert.equal(state.betCount, 0);
    assert.equal(state.currentBalance, 10_000);
    assert.equal(state.continuityGapCount, 0);
    assert.deepEqual({ ...database.sqlite.prepare(`
      SELECT last_continuity_epoch, activation_gap_incident_id, last_gap_incident_id
      FROM predictive_leader_v7_paper_ladder_campaigns
    `).get() }, {
      last_continuity_epoch: 1,
      activation_gap_incident_id: preactivationGapId,
      last_gap_incident_id: preactivationGapId,
    });
    assert.deepEqual(state.ladder, {
      cycleNumber: 1,
      cycleStaked: 0,
      ladderLoss: 0,
      missCount: 0,
      resetCount: 0,
      nextStake: 10,
      pendingReset: null,
    });
    database.markGap({
      source: SOURCE,
      instrument: INSTRUMENT,
      incidentKey: "paper-account-preactivation-gap",
      detectedAt: iso(CAMPAIGN_STARTED_MS + 1_000),
      message: "duplicate preactivation gap",
    });
    state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.continuityGapCount, 0);
    assert.equal(state.ladder.resetCount, 0);
    assert.deepEqual(place(database, historical), {
      placed: 0,
      reason: "outside_prospective_boundary",
      forecastId: historical.forecastId,
      settled: 0,
      voided: 0,
      reset: 0,
      databaseChanged: false,
    });

    const prospective = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "first-paper-round",
      baseMs: nowMs + 60_000,
    });
    assert.equal(place(database, prospective).placed, 1);
    state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.betCount, 1);
    assert.equal(state.pendingBet.forecastId, prospective.forecastId);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("v31 retires a live fixed-v1 pending bet before accepting ladder history", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-v7-paper-v1-pending-"));
  const path = join(directory, "tracker.sqlite");
  let nowMs = CAMPAIGN_STARTED_MS;
  let database = databaseAt(path, () => nowMs);
  try {
    database.sqlite.exec(`
      DROP TRIGGER predictive_leader_v7_paper_fixed_v1_retired;
      DROP TRIGGER predictive_leader_v7_paper_fixed_v1_void_chronology;
      DROP TRIGGER predictive_leader_v7_paper_ladder_epoch_no_rollback;
      DROP TABLE predictive_leader_v7_paper_ladder_resets;
      DROP TABLE predictive_leader_v7_paper_ladder_voids;
      DROP TABLE predictive_leader_v7_paper_ladder_bets;
      DROP TABLE predictive_leader_v7_paper_ladder_campaigns;
      PRAGMA user_version = 30;
    `);
    const legacy = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "live-v1-pending",
      baseMs: FIRST_ROUND_BASE_MS,
    });
    insertLegacyFixedPending(database, legacy);
    database.close();

    nowMs = Date.parse(legacy.createdAt) + 1_000;
    database = databaseAt(path, () => nowMs);
    let state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.activationBoundary.firstForecastId, legacy.forecastId + 1);
    assert.equal(state.betCount, 0);
    assert.equal(state.currentBalance, 10_000);

    const initialized = database.initializePredictiveLeaderV7PaperCampaign(
      SOURCE,
      INSTRUMENT,
    );
    assert.equal(initialized.placed, 0);
    assert.equal(initialized.settled, 0);
    assert.equal(initialized.reason, "awaiting_authoritative_result");
    assert.equal(Number(database.sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM predictive_leader_v7_paper_bets
      WHERE status = 'pending'
    `).get().count), 1);

    attachAuthoritativeSettlement(
      database,
      (value) => { nowMs = value; },
      legacy,
      legacy.targetNumber,
    );
    const retired = settle(database);
    assert.equal(retired.settled, 1);
    assert.equal(retired.reason, "hit");
    assert.equal(retired.reset, 0);
    assert.equal(database.sqlite.prepare(`
      SELECT status FROM predictive_leader_v7_paper_bets
    `).get().status, "settled");
    assert.equal(Number(database.sqlite.prepare(`
      SELECT current_balance FROM predictive_leader_v7_paper_campaigns
    `).get().current_balance), 1_350);

    const prospective = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "first-v2-after-v1-retired",
      baseMs: FIRST_ROUND_BASE_MS + ROUND_STRIDE_MS,
    });
    assert.throws(
      () => insertLegacyFixedPending(database, prospective),
      /v7 paper fixed-v1 campaign is retired/,
    );
    assert.equal(place(database, prospective).placed, 1);
    state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.betCount, 1);
    assert.equal(state.pendingBet.forecastId, prospective.forecastId);
    assert.equal(state.currentBalance, 9_990);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("placement is idempotent and a pending ledger survives restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-v7-paper-restart-"));
  const path = join(directory, "tracker.sqlite");
  let nowMs = CAMPAIGN_STARTED_MS;
  let database = databaseAt(path, () => nowMs);
  try {
    const forecast = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "restart-pending",
      baseMs: FIRST_ROUND_BASE_MS,
    });
    assert.deepEqual(place(database, forecast), {
      placed: 1,
      reason: "bet_frozen",
      forecastId: forecast.forecastId,
      stake: 10,
      settled: 0,
      voided: 0,
      reset: 0,
      databaseChanged: true,
    });
    assert.equal(place(database, forecast).reason, "already_recorded");
    let state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.status, "pending");
    assert.equal(state.currentBalance, 9_990);
    assert.equal(state.ledgerRevision, 1);
    assert.equal(state.pendingBet.forecastId, forecast.forecastId);
    database.close();

    nowMs += 1_000;
    database = databaseAt(path, () => nowMs);
    state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.status, "pending");
    assert.equal(state.currentBalance, 9_990);
    assert.equal(state.pendingBet.forecastId, forecast.forecastId);
    assert.equal(place(database, forecast).reason, "already_recorded");

    attachAuthoritativeSettlement(
      database,
      (value) => { nowMs = value; },
      forecast,
      forecast.targetNumber,
    );
    assert.equal(settle(database).reason, "hit");
    database.close();

    nowMs += 1_000;
    database = databaseAt(path, () => nowMs);
    state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.status, "waiting");
    assert.equal(state.currentBalance, 10_350);
    assert.equal(state.hitCount, 1);
    assert.equal(state.latestOutcome.forecastId, forecast.forecastId);
    assert.equal(state.latestReset.reason, "hit");
    assert.equal(state.ladder.cycleNumber, 2);
    assert.equal(state.ladder.resetCount, 1);
    assert.equal(state.ledgerRevision, 2);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("startup initialization recovers one still-open selected forecast exactly once", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-v7-paper-recovery-"));
  const path = join(directory, "tracker.sqlite");
  let nowMs = CAMPAIGN_STARTED_MS;
  let database = databaseAt(path, () => nowMs);
  try {
    const forecast = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "startup-recovery",
      baseMs: FIRST_ROUND_BASE_MS,
    });
    assert.equal(
      Number(database.sqlite.prepare(`
        SELECT COUNT(*) AS count FROM predictive_leader_v7_paper_ladder_bets
      `).get().count),
      0,
    );
    database.close();

    nowMs = Date.parse(forecast.createdAt) + 1_000;
    database = databaseAt(path, () => nowMs);
    const recovered = database.initializePredictiveLeaderV7PaperCampaign(
      SOURCE,
      INSTRUMENT,
    );
    assert.equal(recovered.initialized, 1);
    assert.equal(recovered.placed, 1);
    assert.equal(recovered.reason, "bet_frozen");
    assert.equal(recovered.databaseChanged, true);

    const repeated = database.initializePredictiveLeaderV7PaperCampaign(
      SOURCE,
      INSTRUMENT,
    );
    assert.equal(repeated.placed, 0);
    assert.equal(repeated.reason, "awaiting_authoritative_result");
    assert.equal(repeated.databaseChanged, false);
    const state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.betCount, 1);
    assert.equal(state.pendingBet.forecastId, forecast.forecastId);
    assert.equal(state.currentBalance, 9_990);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("placement rolls back when the commit-time clock crosses the safe cutoff", () => {
  let nowMs = CAMPAIGN_STARTED_MS;
  let scriptedTimes = null;
  const database = databaseAt(":memory:", () => (
    scriptedTimes?.length > 0 ? scriptedTimes.shift() : nowMs
  ));
  try {
    const forecast = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "commit-cutoff",
      baseMs: FIRST_ROUND_BASE_MS,
    });
    scriptedTimes = [
      Date.parse(forecast.createdAt),
      Date.parse(forecast.bettingClosesAt) - 4_999,
    ];
    assert.throws(
      () => place(database, forecast),
      /transaction must finish at least five seconds before betting closes/,
    );
    scriptedTimes = null;

    let state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.betCount, 0);
    assert.equal(state.currentBalance, 10_000);
    assert.equal(state.status, "waiting");

    nowMs = Date.parse(forecast.createdAt);
    assert.equal(place(database, forecast).placed, 1);
    state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.betCount, 1);
    assert.equal(state.currentBalance, 9_990);
  } finally {
    database.close();
  }
});

test("authoritative settlements debit misses and credit 36x gross hits exactly once", () => {
  let nowMs = CAMPAIGN_STARTED_MS;
  const database = databaseAt(":memory:", () => nowMs);
  try {
    const hit = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "settle-hit",
      baseMs: FIRST_ROUND_BASE_MS,
      targetNumber: 7,
    });
    assert.equal(place(database, hit).placed, 1);
    attachAuthoritativeSettlement(database, (value) => { nowMs = value; }, hit, 7);
    assert.deepEqual(settle(database), {
      placed: 0,
      settled: 1,
      voided: 0,
      reset: 1,
      resetReason: "hit",
      reason: "hit",
      forecastId: hit.forecastId,
      databaseChanged: true,
    });
    assert.equal(settle(database).reason, "no_pending_bet");

    const miss = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "settle-miss",
      baseMs: FIRST_ROUND_BASE_MS + ROUND_STRIDE_MS,
      targetNumber: 7,
    });
    assert.equal(place(database, miss).placed, 1);
    attachAuthoritativeSettlement(database, (value) => { nowMs = value; }, miss, 8);
    assert.equal(settle(database).reason, "miss");

    const state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.status, "waiting");
    assert.equal(state.betCount, 2);
    assert.equal(state.settledCount, 2);
    assert.equal(state.hitCount, 1);
    assert.equal(state.missCount, 1);
    assert.equal(state.totalStaked, 20);
    assert.equal(state.totalGrossPayout, 360);
    assert.equal(state.currentBalance, 10_340);
    assert.equal(state.accountingBalance, 10_340);
    assert.equal(state.profit, 340);
    assert.equal(state.latestOutcome.outcome, "miss");
    assert.equal(state.latestOutcome.balanceAfter, 10_340);
    assert.equal(state.ladder.cycleNumber, 2);
    assert.equal(state.ladder.cycleStaked, 10);
    assert.equal(state.ladder.ladderLoss, 10);
    assert.equal(state.ladder.missCount, 1);
    assert.equal(state.ladder.resetCount, 1);
    assert.equal(state.ladder.nextStake, 10);
  } finally {
    database.close();
  }
});

test("the final cycle stake is clamped and a cap miss resets the ladder durably", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-v7-paper-cap-reset-"));
  const path = join(directory, "tracker.sqlite");
  let nowMs = CAMPAIGN_STARTED_MS;
  let database = databaseAt(path, () => nowMs);
  try {
    settleMissSeries(database, (value) => { nowMs = value; }, {
      count: 63,
      roundPrefix: "cycle-cap-prefix",
    });
    let state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.currentBalance, 9_010);
    assert.equal(state.ladder.cycleStaked, 990);
    assert.equal(state.ladder.ladderLoss, 990);
    assert.equal(state.ladder.missCount, 63);
    assert.equal(state.ladder.nextStake, 10);
    assert.equal(state.ladder.resetCount, 0);

    const final = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "cycle-cap-final",
      baseMs: FIRST_ROUND_BASE_MS + 64 * ROUND_STRIDE_MS,
    });
    const placement = place(database, final);
    assert.equal(placement.placed, 1);
    assert.equal(placement.stake, 10);
    state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.pendingBet.rawStake, 30);
    assert.equal(state.pendingBet.stake, 10);
    assert.equal(state.ladder.pendingReset, "cycle_spend_cap");

    attachAuthoritativeSettlement(database, (value) => { nowMs = value; }, final, 8);
    assert.deepEqual(settle(database), {
      placed: 0,
      settled: 1,
      voided: 0,
      reset: 1,
      resetReason: "cycle_spend_cap",
      reason: "miss",
      forecastId: final.forecastId,
      databaseChanged: true,
    });
    state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.currentBalance, 9_000);
    assert.deepEqual(state.ladder, {
      cycleNumber: 2,
      cycleStaked: 0,
      ladderLoss: 0,
      missCount: 0,
      resetCount: 1,
      nextStake: 10,
      pendingReset: null,
    });
    assert.equal(state.latestReset.reason, "cycle_spend_cap");
    assert.equal(state.latestReset.cycleStakedBefore, 1_000);
    assert.equal(state.latestReset.ladderLossBefore, 1_000);
    assert.equal(state.latestReset.missCountBefore, 64);
    assert.equal(state.latestReset.nextStakeBefore, 10);
    assert.equal(state.ledgerRevision, 128);

    database.close();
    nowMs += 1_000;
    database = databaseAt(path, () => nowMs);
    state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.ladder.cycleNumber, 2);
    assert.equal(state.ladder.resetCount, 1);
    assert.equal(state.latestReset.reason, "cycle_spend_cap");
    assert.equal(state.currentBalance, 9_000);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a recovered stake uses its frozen amount for the 36x gross payout", () => {
  let nowMs = CAMPAIGN_STARTED_MS;
  const database = databaseAt(":memory:", () => nowMs);
  try {
    settleMissSeries(database, (value) => { nowMs = value; }, {
      count: 36,
      roundPrefix: "twenty-unit-recovery",
    });
    let state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.ladder.nextStake, 20);
    assert.equal(state.currentBalance, 9_640);

    const hit = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "twenty-unit-hit",
      baseMs: FIRST_ROUND_BASE_MS + 37 * ROUND_STRIDE_MS,
    });
    assert.equal(place(database, hit).stake, 20);
    attachAuthoritativeSettlement(database, (value) => { nowMs = value; }, hit, 7);
    assert.equal(settle(database).reason, "hit");
    state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.latestOutcome.stake, 20);
    assert.equal(state.latestOutcome.grossPayout, 720);
    assert.equal(state.currentBalance, 10_340);
    assert.equal(state.ladder.cycleStaked, 0);
    assert.equal(state.ladder.nextStake, 10);
    assert.equal(state.latestReset.reason, "hit");
    assert.equal(state.latestReset.cycleStakedBefore, 380);
    assert.equal(state.latestReset.ladderLossBefore, 360);
    assert.equal(state.latestReset.nextStakeBefore, 20);
  } finally {
    database.close();
  }
});

test("an anonymous authoritative result settles and remains auditable in getState", () => {
  let nowMs = CAMPAIGN_STARTED_MS;
  const database = databaseAt(":memory:", () => nowMs);
  try {
    const forecast = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "anonymous-settlement",
      baseMs: FIRST_ROUND_BASE_MS,
      targetNumber: 7,
    });
    assert.equal(place(database, forecast).placed, 1);
    const resultId = attachAuthoritativeSettlement(
      database,
      (value) => { nowMs = value; },
      forecast,
      7,
      { anonymous: true },
    );
    assert.equal(settle(database).reason, "hit");

    const result = database.sqlite.prepare(`
      SELECT external_round_id FROM round_results WHERE id = ?
    `).get(resultId);
    assert.equal(result.external_round_id, null);
    const state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.currentBalance, 10_350);
    assert.equal(state.hitCount, 1);
    assert.equal(state.latestOutcome.resultId, resultId);
    assert.equal(state.latestOutcome.roundId, forecast.roundId);
    assert.equal(state.latestOutcome.outcome, "hit");
  } finally {
    database.close();
  }
});

test("a leading gap defers void for the uniquely matchable anonymous result", () => {
  let nowMs = CAMPAIGN_STARTED_MS;
  const database = databaseAt(":memory:", () => nowMs);
  try {
    const forecast = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "anonymous-leading-gap",
      baseMs: FIRST_ROUND_BASE_MS,
      targetNumber: 7,
    });
    assert.equal(place(database, forecast).placed, 1);
    const settledAt = forecast.roundEndsAt;
    nowMs = Date.parse(settledAt) + 1_000;
    const continuityEpoch = Number(database.sqlite.prepare(`
      SELECT continuity_epoch FROM stream_state
      WHERE source = ? AND instrument = ?
    `).get(SOURCE, INSTRUMENT).continuity_epoch);
    database.sqlite.prepare(`
      INSERT INTO round_results (
        source, instrument, settled_at, result_number, price, observed_at,
        external_round_id, raw_cell, fingerprint, raw_payload, cycle_id,
        continuity_epoch, created_at
      ) VALUES (?, ?, ?, 7, 5.4, ?, NULL, NULL, ?, '{}', NULL, ?, ?)
    `).run(
      SOURCE,
      INSTRUMENT,
      settledAt,
      settledAt,
      "paper-account-result:anonymous-leading-gap",
      continuityEpoch,
      iso(nowMs),
    );
    database.markGap({
      source: SOURCE,
      instrument: INSTRUMENT,
      incidentKey: "paper-account-anonymous-leading-gap",
      detectedAt: iso(nowMs + 1_000),
      message: "test anonymous result with a leading gap",
    });

    let state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.pendingCount, 1);
    assert.equal(state.voidCount, 0);
    assert.equal(database.settlePrecloseForecasts(SOURCE, INSTRUMENT).settled, 1);
    state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.pendingCount, 0);
    assert.equal(state.voidCount, 0);
    assert.equal(state.hitCount, 1);
    assert.equal(state.currentBalance, 10_350);
  } finally {
    database.close();
  }
});

test("an unresolved continuity gap voids and refunds one pending bet", () => {
  let nowMs = CAMPAIGN_STARTED_MS;
  const database = databaseAt(":memory:", () => nowMs);
  try {
    const forecast = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "gap-pending",
      baseMs: FIRST_ROUND_BASE_MS,
    });
    assert.equal(place(database, forecast).placed, 1);
    const gap = database.markGap({
      source: SOURCE,
      instrument: INSTRUMENT,
      incidentKey: "paper-account-unresolved-gap",
      detectedAt: iso(nowMs + 1_000),
      message: "test unresolved paper gap",
    });
    assert.equal(gap.kind, "gap");

    let state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.status, "waiting");
    assert.equal(state.betCount, 1);
    assert.equal(state.pendingCount, 0);
    assert.equal(state.voidCount, 1);
    assert.equal(state.continuityGapCount, 1);
    assert.equal(state.currentBalance, 10_000);
    assert.equal(state.accountingBalance, 10_000);
    assert.equal(state.totalStaked, 0);
    assert.equal(state.latestVoid.forecastId, forecast.forecastId);
    assert.equal(state.latestVoid.reason, "integrity_gap");
    assert.equal(state.ladder.cycleNumber, 2);
    assert.equal(state.ladder.resetCount, 1);
    assert.equal(state.ladder.nextStake, 10);
    assert.equal(state.latestReset.reason, "integrity_gap");

    database.markGap({
      source: SOURCE,
      instrument: INSTRUMENT,
      incidentKey: "paper-account-unresolved-gap",
      detectedAt: iso(nowMs + 1_000),
      message: "duplicate test unresolved paper gap",
    });
    state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.voidCount, 1);
    assert.equal(state.continuityGapCount, 1);
    assert.equal(state.currentBalance, 10_000);
  } finally {
    database.close();
  }
});

test("a gap between bets resets a nonzero ladder cursor exactly once", () => {
  let nowMs = CAMPAIGN_STARTED_MS;
  const database = databaseAt(":memory:", () => nowMs);
  try {
    const miss = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "gap-between-bets-miss",
      baseMs: FIRST_ROUND_BASE_MS,
    });
    assert.equal(place(database, miss).placed, 1);
    attachAuthoritativeSettlement(database, (value) => { nowMs = value; }, miss, 8);
    assert.equal(settle(database).reason, "miss");
    assert.equal(
      database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT).ladder.cycleStaked,
      10,
    );

    const gap = database.markGap({
      source: SOURCE,
      instrument: INSTRUMENT,
      incidentKey: "paper-account-gap-between-bets",
      detectedAt: iso(nowMs + 1_000),
      message: "test gap between settled and next bet",
    });
    assert.equal(gap.kind, "gap");

    let state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.currentBalance, 9_990);
    assert.equal(state.continuityGapCount, 1);
    assert.equal(state.ledgerRevision, 3);
    assert.deepEqual(state.ladder, {
      cycleNumber: 2,
      cycleStaked: 0,
      ladderLoss: 0,
      missCount: 0,
      resetCount: 1,
      nextStake: 10,
      pendingReset: null,
    });
    assert.equal(state.latestReset.reason, "integrity_gap");
    assert.equal(state.latestReset.betId, null);
    assert.equal(state.latestReset.incidentId, gap.id);
    assert.equal(state.latestReset.continuityEpoch, 1);
    assert.equal(state.latestReset.cycleStakedBefore, 10);
    assert.equal(state.latestReset.ladderLossBefore, 10);
    assert.equal(state.latestReset.missCountBefore, 1);

    database.markGap({
      source: SOURCE,
      instrument: INSTRUMENT,
      incidentKey: "paper-account-gap-between-bets",
      detectedAt: iso(nowMs + 1_000),
      message: "duplicate gap between settled and next bet",
    });
    state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.continuityGapCount, 1);
    assert.equal(state.ladder.resetCount, 1);
    assert.equal(state.ledgerRevision, 3);

    database.markGap({
      source: SOURCE,
      instrument: INSTRUMENT,
      incidentKey: "paper-account-gap-between-bets-second",
      detectedAt: iso(nowMs + 2_000),
      message: "second gap between settled and next bet",
    });
    database.markGap({
      source: SOURCE,
      instrument: INSTRUMENT,
      incidentKey: "paper-account-gap-between-bets",
      detectedAt: iso(nowMs + 1_000),
      message: "old duplicate after a newer gap",
    });
    state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.continuityGapCount, 2);
    assert.equal(state.ladder.resetCount, 2);
    assert.equal(state.ledgerRevision, 4);
  } finally {
    database.close();
  }
});

test("a resolvable pending result settles before one independent gap reset", () => {
  let nowMs = CAMPAIGN_STARTED_MS;
  const database = databaseAt(":memory:", () => nowMs);
  try {
    const hit = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "gap-resolvable-pending-hit",
      baseMs: FIRST_ROUND_BASE_MS,
      targetNumber: 7,
    });
    assert.equal(place(database, hit).placed, 1);
    nowMs += 1_000;
    const incidentId = insertUnreconciledGap(database, {
      incidentKey: "paper-account-resolvable-pending-gap",
      detectedAt: iso(nowMs),
    });
    const resultId = attachAuthoritativeSettlement(
      database,
      (value) => { nowMs = value; },
      hit,
      7,
    );
    assert.deepEqual({ ...database.sqlite.prepare(`
      SELECT bets.continuity_epoch AS bet_epoch,
        results.continuity_epoch AS result_epoch
      FROM predictive_leader_v7_paper_ladder_bets AS bets
      JOIN round_results AS results ON results.id = ?
    `).get(resultId) }, { bet_epoch: 0, result_epoch: 1 });
    const settlement = settle(database);
    assert.equal(settlement.settled, 1);
    assert.equal(settlement.reset, 2);
    assert.equal(settlement.reason, "hit");

    const state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.pendingCount, 0);
    assert.equal(state.voidCount, 0);
    assert.equal(state.hitCount, 1);
    assert.equal(state.currentBalance, 10_350);
    assert.equal(state.continuityGapCount, 1);
    assert.equal(state.ledgerRevision, 3);
    assert.deepEqual(state.ladder, {
      cycleNumber: 3,
      cycleStaked: 0,
      ladderLoss: 0,
      missCount: 0,
      resetCount: 2,
      nextStake: 10,
      pendingReset: null,
    });
    assert.equal(state.latestOutcome.outcome, "hit");
    assert.equal(state.latestOutcome.cycleNumberAfter, 2);
    assert.equal(state.latestReset.reason, "integrity_gap");
    assert.equal(state.latestReset.betId, null);
    assert.equal(state.latestReset.incidentId, incidentId);
    assert.equal(state.latestReset.continuityEpoch, 1);
    assert.equal(state.latestReset.cycleNumberBefore, 2);
    assert.equal(state.latestReset.cycleNumberAfter, 3);
    assert.deepEqual(database.sqlite.prepare(`
      SELECT reason FROM predictive_leader_v7_paper_ladder_resets ORDER BY id
    `).all().map((row) => row.reason), ["hit", "integrity_gap"]);

    const repeated = settle(database);
    assert.equal(repeated.databaseChanged, false);
    assert.equal(repeated.reset, 0);
  } finally {
    database.close();
  }
});

test("restart catch-up drains an unhandled gap before placement and stays idempotent", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-v7-paper-gap-restart-"));
  const path = join(directory, "tracker.sqlite");
  let nowMs = CAMPAIGN_STARTED_MS;
  let database = databaseAt(path, () => nowMs);
  try {
    const miss = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "restart-gap-miss",
      baseMs: FIRST_ROUND_BASE_MS,
    });
    assert.equal(place(database, miss).placed, 1);
    attachAuthoritativeSettlement(database, (value) => { nowMs = value; }, miss, 8);
    assert.equal(settle(database).reason, "miss");

    nowMs += 1_000;
    const incidentId = insertUnreconciledGap(database, {
      incidentKey: "paper-account-restart-unhandled-gap",
      detectedAt: iso(nowMs),
    });
    const next = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "restart-gap-next-bet",
      baseMs: nowMs + 60_000,
    });
    database.close();

    database = databaseAt(path, () => nowMs);
    const placement = place(database, next);
    assert.equal(placement.placed, 1);
    assert.equal(placement.reset, 1);
    assert.equal(placement.databaseChanged, true);
    let state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.continuityGapCount, 1);
    assert.equal(state.latestReset.incidentId, incidentId);
    assert.equal(state.latestReset.betId, null);
    assert.equal(state.pendingBet.forecastId, next.forecastId);
    assert.equal(state.pendingBet.cycleNumber, 2);
    assert.equal(state.pendingBet.cycleStakedBefore, 0);
    assert.equal(state.pendingBet.ladderLossBefore, 0);
    assert.equal(state.ladder.cycleNumber, 2);
    assert.equal(state.ladder.resetCount, 1);
    assert.equal(state.ledgerRevision, 4);
    database.close();

    nowMs += 1_000;
    database = databaseAt(path, () => nowMs);
    const recovered = database.initializePredictiveLeaderV7PaperCampaign(
      SOURCE,
      INSTRUMENT,
    );
    assert.equal(recovered.reset, 0);
    assert.equal(recovered.databaseChanged, false);
    state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.continuityGapCount, 1);
    assert.equal(state.ladder.resetCount, 1);
    assert.equal(state.ledgerRevision, 4);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("restart cannot reconcile away a shutdown gap after its ladder reset", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-v7-paper-gap-v9-veto-"));
  const path = join(directory, "tracker.sqlite");
  const baseMs = CAMPAIGN_STARTED_MS + 10 * 60_000;
  let nowMs = baseMs + 400_000;
  let database = databaseAt(path, () => nowMs, { gapThresholdSeconds: 135 });
  try {
    database.ingestBatch([
      streamEvent(20, "paper-v9-left-1", iso(baseMs), 900),
      streamEvent(14, "paper-v9-left-2", iso(baseMs + 90_000), 901),
      streamEvent(14, "paper-v9-left-3", iso(baseMs + 180_000), 902),
    ]);
    database.ingestBatchAfterGap(
      {
        source: SOURCE,
        instrument: INSTRUMENT,
        reason: "shutdown-with-unconfirmed-round-result",
        incidentKey: "paper-account-v9-shutdown-gap",
        detectedAt: iso(baseMs + 270_100),
        message: "test shutdown gap protected by paper reset",
      },
      [
        streamEvent(31, "paper-v9-right-1", iso(baseMs + 270_000), 903),
        streamEvent(35, "paper-v9-right-2", iso(baseMs + 360_000), 904),
      ],
    );

    let state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.continuityGapCount, 1);
    assert.equal(state.ladder.resetCount, 1);
    assert.equal(state.latestReset.reason, "integrity_gap");
    assert.equal(Number(database.sqlite.prepare(`
      SELECT continuity_epoch FROM stream_state
      WHERE source = ? AND instrument = ?
    `).get(SOURCE, INSTRUMENT).continuity_epoch), 1);
    assert.throws(
      () => database.sqlite.prepare(`
        UPDATE stream_state SET continuity_epoch = 0
        WHERE source = ? AND instrument = ?
      `).run(SOURCE, INSTRUMENT),
      /v7 paper ladder continuity epoch cannot roll back/,
    );

    database.sqlite.exec("PRAGMA user_version = 8");
    database.close();
    database = databaseAt(path, () => nowMs + 1_000, { gapThresholdSeconds: 135 });
    assert.equal(Number(database.sqlite.prepare(`
      SELECT continuity_epoch FROM stream_state
      WHERE source = ? AND instrument = ?
    `).get(SOURCE, INSTRUMENT).continuity_epoch), 1);
    assert.equal(Number(database.sqlite.prepare(`
      SELECT COUNT(*) AS count FROM incident_resolutions
    `).get().count), 0);
    assert.equal(Number(database.sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM predictive_leader_v7_paper_ladder_resets
      WHERE reason = 'integrity_gap'
    `).get().count), 1);

    const recovered = database.initializePredictiveLeaderV7PaperCampaign(
      SOURCE,
      INSTRUMENT,
    );
    assert.equal(recovered.reset, 0);
    assert.equal(recovered.databaseChanged, false);
    state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.continuityGapCount, 1);
    assert.equal(state.ladder.resetCount, 1);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("round metadata conflict voids a pending bet once and refunds its stake", () => {
  let nowMs = CAMPAIGN_STARTED_MS;
  const database = databaseAt(":memory:", () => nowMs);
  try {
    const forecast = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "metadata-pending",
      baseMs: FIRST_ROUND_BASE_MS,
    });
    assert.equal(place(database, forecast).placed, 1);
    assert.throws(
      () => database.sqlite.exec(`
        UPDATE predictive_leader_v7_paper_ladder_bets SET target_number = 8
      `),
      /immutable/,
    );
    assert.throws(
      () => database.sqlite.exec(`DELETE FROM predictive_leader_v7_paper_ladder_bets`),
      /bet cannot be deleted/,
    );
    nowMs += 1_000;
    const conflict = database.recordCurrentCellHorizonMetadataConflict(
      SOURCE,
      INSTRUMENT,
      forecast.roundId,
      forecast.bettingClosesAt,
      iso(Date.parse(forecast.bettingClosesAt) + 250),
      iso(nowMs),
    );
    assert.equal(conflict.inserted, true);
    assert.equal(conflict.reason, "metadata_conflict_recorded");

    let state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.status, "waiting");
    assert.equal(state.currentBalance, 10_000);
    assert.equal(state.pendingCount, 0);
    assert.equal(state.voidCount, 1);
    assert.equal(state.latestVoid.reason, "round_metadata_conflict");
    assert.throws(
      () => database.sqlite.exec(`
        UPDATE predictive_leader_v7_paper_ladder_voids SET voided_at = voided_at
      `),
      /void is immutable/,
    );
    assert.throws(
      () => database.sqlite.exec(`DELETE FROM predictive_leader_v7_paper_ladder_voids`),
      /void cannot be deleted/,
    );
    assert.throws(
      () => database.sqlite.exec(`
        UPDATE predictive_leader_v7_paper_ladder_bets SET status = 'pending'
      `),
      /terminal bet is immutable/,
    );

    const duplicate = database.recordCurrentCellHorizonMetadataConflict(
      SOURCE,
      INSTRUMENT,
      forecast.roundId,
      forecast.bettingClosesAt,
      iso(Date.parse(forecast.bettingClosesAt) + 500),
      iso(nowMs),
    );
    assert.equal(duplicate.inserted, false);
    assert.equal(duplicate.reason, "already_recorded");
    state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.currentBalance, 10_000);
    assert.equal(state.voidCount, 1);
  } finally {
    database.close();
  }
});

test("late hit void preserves the newer pending bet's frozen ladder cursor", () => {
  let nowMs = CAMPAIGN_STARTED_MS;
  const database = databaseAt(":memory:", () => nowMs);
  try {
    const hit = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "late-zero-hit",
      baseMs: FIRST_ROUND_BASE_MS,
    });
    assert.equal(place(database, hit).placed, 1);
    attachAuthoritativeSettlement(
      database,
      (value) => { nowMs = value; },
      hit,
      hit.targetNumber,
    );
    assert.equal(settle(database).reason, "hit");
    settleMissSeries(database, (value) => { nowMs = value; }, {
      count: 36,
      roundPrefix: "late-frozen-miss",
    });
    let state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.currentBalance, 9_990);
    assert.equal(state.ladder.cycleNumber, 2);
    assert.equal(state.ladder.cycleStaked, 360);
    assert.equal(state.ladder.nextStake, 20);

    const pending = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "late-frozen-pending",
      baseMs: FIRST_ROUND_BASE_MS + 37 * ROUND_STRIDE_MS,
    });
    assert.equal(place(database, pending).stake, 20);
    nowMs += 1_000;
    assert.equal(database.recordCurrentCellHorizonMetadataConflict(
      SOURCE,
      INSTRUMENT,
      hit.roundId,
      hit.bettingClosesAt,
      iso(Date.parse(hit.bettingClosesAt) + 250),
      iso(nowMs),
    ).inserted, true);

    const campaign = database.sqlite.prepare(`
      SELECT status, current_balance, ledger_deficit, exhausted_at
      FROM predictive_leader_v7_paper_ladder_campaigns
    `).get();
    assert.equal(campaign.status, "running");
    assert.equal(Number(campaign.current_balance), 9_620);
    assert.equal(Number(campaign.ledger_deficit), 0);
    assert.equal(campaign.exhausted_at, null);
    state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.status, "pending");
    assert.equal(state.currentBalance, 9_620);
    assert.equal(state.deficit, 0);
    assert.equal(state.pendingBet.forecastId, pending.forecastId);
    assert.equal(state.pendingBet.balanceBefore, 9_990);
    assert.equal(state.pendingBet.stake, 20);
    assert.equal(state.pendingBet.cycleNumber, 2);
    assert.equal(state.pendingBet.cycleStakedBefore, 360);
    assert.equal(state.pendingBet.ladderLossBefore, 360);
    assert.equal(state.pendingBet.missCountBefore, 36);
    assert.equal(state.ladder.cycleNumber, 2);
    assert.equal(state.ladder.cycleStaked, 360);
    assert.equal(state.ladder.resetCount, 1);
    assert.equal(state.latestReset.reason, "hit");
    assert.equal(state.hitCount, 0);
    assert.equal(state.missCount, 36);
    assert.equal(state.voidCount, 1);
    assert.equal(state.totalStaked, 380);
    assert.equal(state.canAffordNext, false);
  } finally {
    database.close();
  }
});

test("no-reload lifetime bank can be exhausted by a late void deficit", () => {
  let nowMs = CAMPAIGN_STARTED_MS;
  const database = databaseAt(":memory:", () => nowMs);
  try {
    const hit = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "late-void-hit",
      baseMs: FIRST_ROUND_BASE_MS,
    });
    assert.equal(place(database, hit).placed, 1);
    attachAuthoritativeSettlement(
      database,
      (value) => { nowMs = value; },
      hit,
      hit.targetNumber,
    );
    assert.equal(settle(database).reason, "hit");

    settleMissSeries(database, (value) => { nowMs = value; }, {
      count: 640,
      roundPrefix: "late-void-miss",
    });
    let state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.currentBalance, 350);
    assert.equal(state.deficit, 0);
    assert.equal(state.ladder.cycleNumber, 12);
    assert.equal(state.ladder.resetCount, 11);
    assert.equal(state.ladder.cycleStaked, 0);

    const pending = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "late-void-pending-miss",
      baseMs: FIRST_ROUND_BASE_MS + 641 * ROUND_STRIDE_MS,
    });
    assert.equal(place(database, pending).placed, 1);
    assert.equal(
      database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT).currentBalance,
      340,
    );

    nowMs += 1_000;
    const conflict = database.recordCurrentCellHorizonMetadataConflict(
      SOURCE,
      INSTRUMENT,
      hit.roundId,
      hit.bettingClosesAt,
      iso(Date.parse(hit.bettingClosesAt) + 250),
      iso(nowMs),
    );
    assert.equal(conflict.inserted, true);
    state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.status, "pending");
    assert.equal(state.reason, "bet_frozen");
    assert.equal(database.sqlite.prepare(`
      SELECT status FROM predictive_leader_v7_paper_ladder_campaigns
    `).get().status, "exhausted");
    assert.equal(state.currentBalance, 0);
    assert.equal(state.deficit, 10);
    assert.equal(state.accountingBalance, -10);
    assert.equal(state.pendingCount, 1);
    assert.equal(state.voidCount, 1);
    assert.equal(state.hitCount, 0);
    assert.equal(state.latestVoid.forecastId, hit.forecastId);
    assert.equal(state.latestVoid.reason, "round_metadata_conflict");

    attachAuthoritativeSettlement(database, (value) => { nowMs = value; }, pending, 8);
    assert.equal(settle(database).reason, "miss");
    state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.status, "exhausted");
    assert.equal(state.reason, "bankroll_exhausted");
    assert.equal(state.currentBalance, 0);
    assert.equal(state.deficit, 10);
    assert.equal(state.pendingCount, 0);
    assert.equal(state.settledCount, 641);
    assert.equal(state.missCount, 641);
    assert.equal(state.voidCount, 1);
    assert.equal(state.ladder.cycleNumber, 12);
    assert.equal(state.ladder.cycleStaked, 10);
    assert.equal(state.ladder.resetCount, 11);

    const rejected = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "after-bank-exhaustion",
      baseMs: FIRST_ROUND_BASE_MS + 642 * ROUND_STRIDE_MS,
    });
    const placement = place(database, rejected);
    assert.equal(placement.placed, 0);
    assert.equal(placement.reason, "bankroll_exhausted");
    assert.equal(placement.databaseChanged, false);
  } finally {
    database.close();
  }
});
