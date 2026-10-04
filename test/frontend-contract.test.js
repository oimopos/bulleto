import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

test("every app DOM reference exists exactly once in the dashboard", () => {
  const htmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const idCounts = new Map();
  htmlIds.forEach((id) => idCounts.set(id, (idCounts.get(id) || 0) + 1));

  const referencedIds = [
    ...app.matchAll(/document\.getElementById\("([^"]+)"\)/g),
  ].map((match) => match[1]);

  assert.deepEqual(
    htmlIds.filter((id) => idCounts.get(id) > 1),
    [],
    "HTML must not contain duplicate IDs",
  );
  assert.deepEqual(
    referencedIds.filter((id) => idCounts.get(id) !== 1),
    [],
    "every getElementById reference must resolve exactly once",
  );
});

test("top-5 horizon block exposes all renderer targets and cumulative horizons", () => {
  for (const id of [
    "follower-horizon",
    "follower-horizon-list",
    "follower-horizon-status",
    "follower-horizon-note",
  ]) {
    assert.match(html, new RegExp(`\\bid="${id}"`));
  }
  assert.match(app, /const FOLLOWER_HIT_HORIZONS = \[1, 2, 3, 5, 10, 20\]/);
  assert.match(app, /top5HitByHorizon/);
  assert.match(app, /follower-top5-walk-forward-v1/);
  assert.match(app, /случайная база/);
  assert.match(html, /Ретроспективная реконструкция/);
});

test("dynamic top-5 next-round summary uses the validated full-20 cohort", () => {
  for (const id of [
    "follower-dynamic-next",
    "follower-dynamic-next-status",
    "follower-dynamic-next-hits",
    "follower-dynamic-next-misses",
    "follower-dynamic-next-rate",
    "follower-dynamic-next-sample",
  ]) {
    assert.match(html, new RegExp(`\\bid="${id}"`));
    assert.match(app, new RegExp(`getElementById\\("${id}"\\)`));
  }

  assert.match(app, /function renderFollowerDynamicNext\(\)/);
  assert.match(app, /normalizedFollowerAllPoints\(\)/);
  assert.match(app, /point\.horizon === 1/);
  assert.match(app, /const misses = sample - hits/);
  assert.match(
    app,
    /function renderFollowerHitCurve\(\) \{\s*renderFollowerDynamicNext\(\);/,
  );
  assert.match(html, /пятёрка заново рассчитывалась только по уже известным данным/);
  assert.match(html, /полными 20 будущими раундами/);
  assert.match(html, /не текущая серия с зафиксированной пятёркой/);
  assert.match(styles, /\.follower-dynamic-next\s*\{/);
  assert.match(styles, /\.follower-dynamic-next__metrics\s*\{/);
  assert.match(
    styles,
    /@media \(max-width: 680px\)[\s\S]*?\.follower-dynamic-next__metrics\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  );
});

test("full-cycle comparison block exposes every renderer target and stays above forecasts", () => {
  const rendererIds = [
    "cycle-comparison-panel",
    "cycle-comparison-badge",
    "cycle-comparison-status",
    "cycle-comparison-current-title",
    "cycle-comparison-current-meta",
    "cycle-comparison-current-sequence",
    "cycle-comparison-analogue-card",
    "cycle-comparison-analogue-title",
    "cycle-comparison-analogue-meta",
    "cycle-comparison-metrics",
    "cycle-comparison-anchor-meta",
    "cycle-comparison-analogue-sequence",
    "cycle-comparison-continuation",
    "cycle-comparison-continuation-meta",
    "cycle-comparison-continuation-sequence",
  ];
  const semanticIds = [
    "cycle-comparison-title",
    "cycle-comparison-anchor-title",
    "cycle-comparison-continuation-title",
    "cycle-comparison-note",
  ];

  for (const id of [...rendererIds, ...semanticIds]) {
    assert.match(html, new RegExp(`\\bid="${id}"`));
  }
  for (const id of rendererIds) {
    assert.match(app, new RegExp(`getElementById\\("${id}"\\)`));
  }

  assert.match(
    html,
    /<section class="overview-grid"[\s\S]*?<section class="panel cycle-comparison-panel"[\s\S]*?<section class="panel preclose-panel"/,
  );
  assert.match(html, /id="cycle-comparison-status" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html, /id="cycle-comparison-panel"[\s\S]*?aria-busy="true"/);
  assert.match(html, /id="cycle-comparison-current-sequence"[\s\S]*?aria-busy="true"/);
});

test("cycle analogue uses the fixed 20-draw contract and renders the entire archive tail", () => {
  assert.match(app, /const CYCLE_COMPARISON_ANCHOR_DRAWS = 20/);
  assert.match(app, /const CYCLE_COMPARISON_ALGORITHM_VERSION = "cycle-analogue-prefix-v1"/);
  assert.match(app, /fetchJson\("\/api\/cycle-comparison"\)/);
  assert.match(app, /value\.schemaVersion !== 1/);
  assert.match(app, /value\.algorithmVersion !== CYCLE_COMPARISON_ALGORITHM_VERSION/);
  assert.match(app, /value\.interpretation !== "descriptive-not-predictive"/);
  assert.match(app, /\["ready", "collecting_anchor", "unavailable", "integrity_gap"\]/);
  assert.match(app, /analogue\.events\.slice\(0, comparison\.anchorDrawCount\)/);
  assert.match(app, /analogue\.events\.slice\(comparison\.anchorDrawCount\)/);
  assert.match(app, /compareEvents: comparison\.target\.events/);
  assert.match(app, /is-position-match/);
  assert.match(app, /is-position-mismatch/);
  assert.match(app, /buildCycleStageMarker/);
  assert.match(app, /stageMarker\.position === event\.position/);
  assert.match(app, /markerRole: "current"/);
  assert.match(app, /markerRole: "reference"/);
  assert.match(app, /aria-current/);
  assert.match(app, /Сейчас сравниваем/);
  assert.match(app, /Исторический аналог завершился на ходе/);
  assert.match(styles, /\.cycle-sequence-event\.is-stage-marker/);
  assert.match(styles, /\.cycle-sequence-event\.is-marker-red/);
  assert.match(styles, /\.cycle-sequence-event\.is-marker-black/);
  assert.match(styles, /\.cycle-sequence-event\.is-marker-green/);
  assert.match(app, /не меняется до завершения круга/);
  assert.match(app, /function renderCycleComparison\(value\)/);
  assert.match(app, /setCycleComparisonState\("loading"/);
  assert.match(app, /setCycleComparisonState\(\s*"error"/);
  assert.match(app, /setCycleComparisonState\(\s*"stale"/);
  assert.match(app, /state = "collecting"/);
  assert.ok(
    [...app.matchAll(/renderCycleComparison\(store\.cycleComparison\)/g)].length >= 2,
    "comparison must render on normal and failed refresh paths",
  );
});

test("cycle comparison language is descriptive, responsive, and cache-busted", () => {
  const blockStart = html.indexOf('id="cycle-comparison-panel"');
  const blockEnd = html.indexOf('id="preclose-panel"');
  const block = html.slice(blockStart, blockEnd);

  assert.ok(blockStart >= 0 && blockEnd > blockStart);
  assert.match(block, /не прогноз/);
  assert.match(block, /не предсказывает следующее число/);
  assert.doesNotMatch(block, /должн/iu);
  assert.match(html, /href="\/styles\.css\?v=21"/);
  assert.match(html, /src="\/app\.js\?v=21"/);
  assert.match(styles, /\.cycle-sequence-list\s*\{[\s\S]*?repeat\(auto-fill, minmax\(50px, 1fr\)\)/);
  assert.match(
    styles,
    /@media \(max-width: 680px\)[\s\S]*?\.cycle-sequence-list\s*\{\s*grid-template-columns: repeat\(5, minmax\(42px, 1fr\)\)/,
  );
  assert.match(
    styles,
    /@media \(max-width: 430px\)[\s\S]*?\.cycle-sequence-list\s*\{\s*grid-template-columns: repeat\(4, minmax\(40px, 1fr\)\)/,
  );
});
