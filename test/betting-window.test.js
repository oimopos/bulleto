import assert from "node:assert/strict";
import test from "node:test";

import {
  bettingWindowForApi,
  virtualBettingForApi,
} from "../src/betting-window.js";

const OPENS_AT = "2026-10-07T17:43:40.000Z";
const CLOSES_AT = "2026-10-07T17:44:20.000Z";

function collectorState(overrides = {}) {
  const currentRound = {
    id: 4_102_101,
    status: 2,
    startsAt: "2026-10-07T17:43:40Z",
    bettingClosesAt: "2026-10-07T17:44:20Z",
    ...overrides.currentRound,
  };

  return {
    connected: true,
    currentRound,
    ...overrides,
    currentRound: overrides.currentRound === null ? null : currentRound,
  };
}

function expectedWindow(overrides = {}) {
  return {
    roundId: 4_102_101,
    isOpen: false,
    opensAt: OPENS_AT,
    closesAt: CLOSES_AT,
    secondsUntilClose: null,
    ...overrides,
  };
}

test("connected open round exposes the betting window and rounded-up countdown", () => {
  assert.deepEqual(
    bettingWindowForApi(
      collectorState(),
      new Date("2026-10-07T17:43:57.001Z"),
    ),
    expectedWindow({
      isOpen: true,
      secondsUntilClose: 23,
    }),
  );
});

test("betting is available at the inclusive opening boundary", () => {
  assert.deepEqual(
    bettingWindowForApi(collectorState(), new Date(OPENS_AT)),
    expectedWindow({
      isOpen: true,
      secondsUntilClose: 40,
    }),
  );
});

test("betting is unavailable before the round starts", () => {
  assert.deepEqual(
    bettingWindowForApi(
      collectorState(),
      new Date("2026-10-07T17:43:39.999Z"),
    ),
    expectedWindow(),
  );
});

test("betting is unavailable at the exclusive closing boundary", () => {
  assert.deepEqual(
    bettingWindowForApi(collectorState(), new Date(CLOSES_AT)),
    expectedWindow(),
  );
});

test("upstream round status must explicitly be open", () => {
  for (const status of [4, "2", " 2 ", "0x2", [2], true]) {
    assert.deepEqual(
      bettingWindowForApi(
        collectorState({ currentRound: { status } }),
        new Date("2026-10-07T17:44:00.000Z"),
      ),
      expectedWindow(),
    );
  }
});

test("unavailable or untrusted collector timing returns null", () => {
  const cases = [
    {
      label: "disconnected collector",
      state: collectorState({ connected: false }),
    },
    {
      label: "collector with an active error",
      state: collectorState({ error: "websocket failed" }),
    },
    {
      label: "missing current round",
      state: collectorState({ currentRound: null }),
    },
    {
      label: "missing opening time",
      state: collectorState({ currentRound: { startsAt: null } }),
    },
    {
      label: "invalid opening time",
      state: collectorState({ currentRound: { startsAt: "not-a-date" } }),
    },
    {
      label: "missing closing time",
      state: collectorState({ currentRound: { bettingClosesAt: null } }),
    },
    {
      label: "invalid closing time",
      state: collectorState({ currentRound: { bettingClosesAt: "not-a-date" } }),
    },
    {
      label: "non-positive window",
      state: collectorState({ currentRound: { bettingClosesAt: OPENS_AT } }),
    },
  ];

  for (const { label, state } of cases) {
    assert.equal(
      bettingWindowForApi(state, new Date("2026-10-07T17:44:00.000Z")),
      null,
      label,
    );
  }
});

test("virtual readiness is separate from the live betting window", () => {
  const now = new Date("2026-10-07T17:44:00.000Z");
  const openWindow = {
    ...expectedWindow({ isOpen: true, secondsUntilClose: 20 }),
    strategyReady: false,
    canBetNow: false,
  };

  assert.deepEqual(
    virtualBettingForApi(collectorState(), "waiting", now),
    openWindow,
  );
  for (const status of ["armed", "active"]) {
    assert.deepEqual(
      virtualBettingForApi(collectorState(), status, now),
      {
        ...openWindow,
        strategyReady: true,
        canBetNow: true,
      },
    );
  }
});
