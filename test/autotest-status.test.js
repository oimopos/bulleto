import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildAutotestView } from "../public/app.js";

function safeState(overrides = {}) {
  return {
    mode: "simulation",
    executionEnabled: false,
    status: "waiting",
    triggerThreshold: 200,
    longestCandidate: {
      number: 1,
      roundsSinceLast: 153,
    },
    activeSession: null,
    testBank: { status: "running" },
    ...overrides,
  };
}

test("waiting view keeps only the trigger and longest current series", () => {
  assert.deepEqual(buildAutotestView(safeState()), {
    state: "waiting",
    title: "Ждём 200 сохранённых раундов",
    copy: "Самая длинная текущая серия у числа 1: 153 сохранённых раунда без выпадения.",
  });
});

test("waiting view handles an empty continuity epoch", () => {
  const view = buildAutotestView(safeState({ longestCandidate: null }));
  assert.equal(view.title, "Ждём 200 сохранённых раундов");
  assert.equal(view.copy, "Подтверждённой истории пока недостаточно.");
});

test("null numeric fields are not displayed as zero", () => {
  const waiting = buildAutotestView(safeState({
    longestCandidate: { number: null, roundsSinceLast: null },
  }));
  assert.equal(waiting.copy, "Подтверждённой истории пока недостаточно.");

  const armed = buildAutotestView(safeState({
    status: "armed",
    activeSession: { targetNumber: null, triggerRoundsMissed: null },
  }));
  assert.equal(armed.title, "Цель выбрана");
  assert.equal(armed.copy, "Ждём следующий сохранённый раунд.");
});

test("armed view shows the frozen target and waits for the next round", () => {
  const view = buildAutotestView(safeState({
    status: "armed",
    activeSession: {
      targetNumber: 1,
      triggerRoundsMissed: 200,
    },
  }));
  assert.deepEqual(view, {
    state: "armed",
    title: "Цель выбрана: число 1",
    copy: "Серия достигла 200 сохранённых раундов. Ждём следующий сохранённый раунд.",
  });
});

test("active view shows only the target and current miss count", () => {
  const view = buildAutotestView(safeState({
    status: "active",
    activeSession: {
      targetNumber: 7,
      missCount: 3,
    },
  }));
  assert.deepEqual(view, {
    state: "active",
    title: "Автотест идёт: число 7",
    copy: "После выбора цели: 3 сохранённых раунда без совпадения.",
  });
});

test("unsafe or exhausted states do not expose simulation values", () => {
  assert.equal(
    buildAutotestView(safeState({ executionEnabled: true })).state,
    "error",
  );
  assert.deepEqual(buildAutotestView(safeState({
    status: "waiting",
    testBank: { status: "exhausted" },
  })), {
    state: "error",
    title: "Автотест остановлен",
    copy: "Виртуальный лимит исчерпан.",
  });
});

test("browser shell contains only the autotest status card", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]).sort();

  assert.deepEqual(ids, [
    "autotest-card",
    "autotest-heading",
    "autotest-status-copy",
    "autotest-status-title",
  ]);
  assert.equal((html.match(/<section\b/g) ?? []).length, 1);
  assert.doesNotMatch(html, /прогноз|калькулятор|история переходов/i);
});

test("minimal client requests only state and live events", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const endpoints = [...new Set(
    [...source.matchAll(/["`](\/api\/[^"`?]+)["`]/g)].map((match) => match[1]),
  )].sort();

  assert.deepEqual(endpoints, ["/api/events", "/api/state"]);
});
