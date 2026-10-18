import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function databaseAt(path, readNow) {
  return createDatabase({
    path,
    clock: () => new Date(readNow()),
    logger: quietLogger,
    predictiveLeaderLegacyAccountEnabled: false,
  });
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

test("v30 paper campaign starts at MAX(forecast)+1 and never backfills", () => {
  const directory = mkdtempSync(join(tmpdir(), "roulette-v7-paper-boundary-"));
  const path = join(directory, "tracker.sqlite");
  let nowMs = CAMPAIGN_STARTED_MS;
  let database = databaseAt(path, () => nowMs);
  try {
    database.sqlite.exec(`
      DROP TABLE predictive_leader_v7_paper_voids;
      DROP TABLE predictive_leader_v7_paper_bets;
      DROP TABLE predictive_leader_v7_paper_campaigns;
      PRAGMA user_version = 29;
    `);
    const historical = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "historical-before-paper",
      baseMs: FIRST_ROUND_BASE_MS,
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
    assert.equal(state.betCount, 0);
    assert.equal(state.currentBalance, 1_000);
    assert.deepEqual(place(database, historical), {
      placed: 0,
      reason: "outside_prospective_boundary",
      forecastId: historical.forecastId,
      settled: 0,
      voided: 0,
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
      settled: 0,
      voided: 0,
      databaseChanged: true,
    });
    assert.equal(place(database, forecast).reason, "already_recorded");
    let state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.status, "pending");
    assert.equal(state.currentBalance, 990);
    assert.equal(state.pendingBet.forecastId, forecast.forecastId);
    database.close();

    nowMs += 1_000;
    database = databaseAt(path, () => nowMs);
    state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.status, "pending");
    assert.equal(state.currentBalance, 990);
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
    assert.equal(state.currentBalance, 1_350);
    assert.equal(state.hitCount, 1);
    assert.equal(state.latestOutcome.forecastId, forecast.forecastId);
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
        SELECT COUNT(*) AS count FROM predictive_leader_v7_paper_bets
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
    assert.equal(state.currentBalance, 990);
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
    assert.equal(state.currentBalance, 1_000);
    assert.equal(state.status, "waiting");

    nowMs = Date.parse(forecast.createdAt);
    assert.equal(place(database, forecast).placed, 1);
    state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.betCount, 1);
    assert.equal(state.currentBalance, 990);
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
    assert.equal(state.currentBalance, 1_340);
    assert.equal(state.accountingBalance, 1_340);
    assert.equal(state.profit, 340);
    assert.equal(state.latestOutcome.outcome, "miss");
    assert.equal(state.latestOutcome.balanceAfter, 1_340);
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
    assert.equal(state.currentBalance, 1_350);
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
    assert.equal(state.currentBalance, 1_350);
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
    assert.equal(state.currentBalance, 1_000);
    assert.equal(state.accountingBalance, 1_000);
    assert.equal(state.totalStaked, 0);
    assert.equal(state.latestVoid.forecastId, forecast.forecastId);
    assert.equal(state.latestVoid.reason, "integrity_gap");

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
    assert.equal(state.currentBalance, 1_000);
  } finally {
    database.close();
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
        UPDATE predictive_leader_v7_paper_bets SET target_number = 8
      `),
      /immutable/,
    );
    assert.throws(
      () => database.sqlite.exec(`DELETE FROM predictive_leader_v7_paper_bets`),
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
    assert.equal(state.currentBalance, 1_000);
    assert.equal(state.pendingCount, 0);
    assert.equal(state.voidCount, 1);
    assert.equal(state.latestVoid.reason, "round_metadata_conflict");
    assert.throws(
      () => database.sqlite.exec(`
        UPDATE predictive_leader_v7_paper_voids SET voided_at = voided_at
      `),
      /void is immutable/,
    );
    assert.throws(
      () => database.sqlite.exec(`DELETE FROM predictive_leader_v7_paper_voids`),
      /void cannot be deleted/,
    );
    assert.throws(
      () => database.sqlite.exec(`
        UPDATE predictive_leader_v7_paper_bets SET status = 'pending'
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
    assert.equal(state.currentBalance, 1_000);
    assert.equal(state.voidCount, 1);
  } finally {
    database.close();
  }
});

test("late hit void keeps a zero-balance campaign running while a newer bet is pending", () => {
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
      count: 99,
      roundPrefix: "late-zero-miss",
    });
    assert.equal(
      database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT).currentBalance,
      360,
    );

    const pending = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "late-zero-pending",
      baseMs: FIRST_ROUND_BASE_MS + 100 * ROUND_STRIDE_MS,
    });
    assert.equal(place(database, pending).placed, 1);
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
      FROM predictive_leader_v7_paper_campaigns
    `).get();
    assert.equal(campaign.status, "running");
    assert.equal(Number(campaign.current_balance), 0);
    assert.equal(Number(campaign.ledger_deficit), 0);
    assert.equal(campaign.exhausted_at, null);
    const state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.status, "pending");
    assert.equal(state.currentBalance, 0);
    assert.equal(state.deficit, 0);
    assert.equal(state.pendingBet.forecastId, pending.forecastId);
    assert.equal(state.canAffordNext, false);
  } finally {
    database.close();
  }
});

test("late metadata void can create a ledger deficit and exhaust the bank", () => {
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
      count: 100,
      roundPrefix: "late-void-miss",
    });
    let state = database.getPredictiveLeaderV7PaperState(SOURCE, INSTRUMENT);
    assert.equal(state.currentBalance, 350);
    assert.equal(state.deficit, 0);

    const pending = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "late-void-pending-miss",
      baseMs: FIRST_ROUND_BASE_MS + 101 * ROUND_STRIDE_MS,
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
      SELECT status FROM predictive_leader_v7_paper_campaigns
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
    assert.equal(state.settledCount, 101);
    assert.equal(state.missCount, 101);
    assert.equal(state.voidCount, 1);

    const rejected = seedSelectedForecast(database, (value) => { nowMs = value; }, {
      roundId: "after-bank-exhaustion",
      baseMs: FIRST_ROUND_BASE_MS + 102 * ROUND_STRIDE_MS,
    });
    const placement = place(database, rejected);
    assert.equal(placement.placed, 0);
    assert.equal(placement.reason, "bankroll_exhausted");
    assert.equal(placement.databaseChanged, false);
  } finally {
    database.close();
  }
});
