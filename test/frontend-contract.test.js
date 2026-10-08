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

test("dashboard keeps the exact read-only fetch URL list", () => {
  const fetchUrls = [...app.matchAll(/fetchJson\("([^"]+)"\)/g)].map(
    (match) => match[1],
  );

  assert.deepEqual(fetchUrls, [
    "/api/state",
    "/api/results?limit=80",
    "/api/cycles?limit=10",
    "/api/sequences?limit=50",
    "/api/pairs",
    "/api/forecasts/hits?limit=20",
    "/api/cycle-comparison",
  ]);
  assert.equal(
    [...app.matchAll(/\bfetchJson\(/g)].length,
    fetchUrls.length + 1,
    "the helper definition plus the exact literal GET calls are the only fetchJson uses",
  );
});

test("trajectory shadow is additive, prospective, and observation-only", () => {
  const rendererIds = [
    "trajectory-shadow-panel",
    "trajectory-shadow-badge",
    "trajectory-shadow-status",
    "trajectory-shadow-shares",
    "trajectory-shadow-sample",
  ];
  const semanticIds = ["trajectory-shadow-title", "trajectory-shadow-note"];

  for (const id of [...rendererIds, ...semanticIds]) {
    assert.match(html, new RegExp(`\\bid="${id}"`));
  }
  for (const id of rendererIds) {
    assert.match(app, new RegExp(`getElementById\\("${id}"\\)`));
  }

  const blockStart = html.indexOf('id="trajectory-shadow-panel"');
  const blockEnd = html.indexOf('id="preclose-hit-history"');
  const block = html.slice(blockStart, blockEnd);
  assert.ok(blockStart >= 0 && blockEnd > blockStart);
  assert.match(block, /Shadow · только наблюдение/);
  assert.match(block, /последней доступной точки перед forecast lock/);
  assert.match(block, /возраст точки не более 5 с/);
  assert.match(block, /а не следующий тик и не порядок чисел рулетки/);
  assert.match(block, /Доли похожих завершённых траекторий/);
  assert.match(block, /Outcome этого prospective shadow пока не валидирован/);
  assert.match(block, /не меняет итоговый Top‑3 и виртуальный билет/);
  assert.doesNotMatch(block, /вероятност|шанс/iu);
  assert.doesNotMatch(block, /roulette-(?:red|green|black)|is-(?:hit|positive|loss)/);

  assert.match(app, /const TRAJECTORY_SHADOW_VERSION = "trajectory-shadow-knn-v1"/);
  assert.match(app, /function normalizedTrajectoryShadow\(value\)/);
  assert.match(app, /function renderTrajectoryShadow\(value\)/);
  assert.match(app, /"insufficient_current"/);
  assert.match(app, /Текущий график неполный/);
  assert.match(app, /renderTrajectoryShadow\(matchesCurrent \? latest\?\.trajectoryShadow : null\)/);
  assert.match(app, /Полные сопоставимые раунды:/);
  assert.match(app, /Доли похожих завершённых траекторий:/);
  assert.doesNotMatch(app, /trajectoryShadowPanel\.(?:dataset|classList)/);
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

test("warm next-round forecast exposes a strict 5-percent walk-forward contract", () => {
  for (const id of [
    "follower-dynamic-next",
    "follower-dynamic-next-status",
    "follower-dynamic-next-hits",
    "follower-dynamic-next-misses",
    "follower-dynamic-next-rate",
    "follower-dynamic-next-sample",
    "follower-dynamic-next-source",
    "follower-dynamic-next-picks",
    "follower-dynamic-next-current-meta",
    "follower-dynamic-next-audit",
  ]) {
    assert.match(html, new RegExp(`\\bid="${id}"`));
    assert.match(app, new RegExp(`getElementById\\("${id}"\\)`));
  }

  assert.match(app, /const FOLLOWER_WARM_THRESHOLD = 0\.05/);
  assert.match(app, /function normalizedFollowerWarmNextRound\(\)/);
  assert.match(app, /follower-warm-top5-next-v1/);
  assert.match(app, /anchors-with-known-next-round/);
  assert.match(
    app,
    /candidate\.occurrenceCount \* 100 >= sampleSize \* 5/,
  );
  assert.match(app, /\["ready", "no_signal", "waiting_training", "gap", "empty"\]/);
  assert.match(app, /function renderFollowerWarmCurrent\(signal\)/);
  assert.match(app, /function renderFollowerDynamicNext\(\)/);
  assert.match(
    app,
    /function renderFollowerHitCurve\(\) \{\s*renderFollowerDynamicNext\(\);/,
  );
  assert.match(html, /id="follower-dynamic-next-title"[^>]*>[^<]*≥5%/);
  assert.match(html, /id="follower-dynamic-next-note"[^>]*>[\s\S]*?5%/);
  assert.match(html, /styles\.css\?v=26/);
  assert.match(html, /app\.js\?v=27/);
  assert.match(styles, /\.follower-dynamic-next\s*\{/);
  assert.match(styles, /\.follower-warm-current\s*\{/);
  assert.match(styles, /\.follower-warm-picks\s*\{/);
  assert.match(styles, /\.follower-dynamic-next__metrics\s*\{/);
  assert.match(
    styles,
    /@media \(max-width: 680px\)[\s\S]*?\.follower-warm-picks\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  );
});

test("raw dynamic top-5 archival account uses one strict shared ticket ladder", () => {
  for (const id of [
    "follower-warm-account",
    "follower-warm-account-status",
    "follower-warm-account-balance",
    "follower-warm-account-result-card",
    "follower-warm-account-result",
    "follower-warm-account-bets",
    "follower-warm-account-record",
    "follower-warm-account-drawdown",
    "follower-warm-account-risk",
    "follower-warm-account-audit",
  ]) {
    assert.match(html, new RegExp(`\\bid="${id}"`));
    assert.match(app, new RegExp(`getElementById\\("${id}"\\)`));
  }

  assert.match(app, /function normalizedFollowerWarmHistoricalAccount\(value, currentSignal\)/);
  assert.match(app, /follower-warm-top5-ladder-v2/);
  assert.match(app, /strategy\?\.selectionMode !== "dynamic-top5"/);
  assert.match(app, /strategy\?\.selectionCount !== 5/);
  assert.match(app, /strategy\?\.threshold !== null/);
  assert.match(app, /eligibleAnchorPolicy !== "every-known-next"/);
  assert.match(app, /gapPolicy !== "reset-ladder-keep-balance"/);
  assert.match(app, /exhaustionPolicy !== "permanent-stop"/);
  assert.match(app, /model\?\.modelVersion !== "2\.0\.0"/);
  assert.match(app, /model\?\.initialStakePerNumber !== 10/);
  assert.match(app, /model\?\.stakeStepPerNumber !== 10/);
  assert.match(app, /model\?\.maxStakePerNumber !== 2_500/);
  assert.match(app, /model\?\.numbersPerRound !== 5/);
  assert.match(app, /model\?\.grossPayoutMultiplier !== 36/);
  assert.match(app, /model\?\.netHitMultiplier !== 31/);
  assert.match(app, /value\.executionEnabled !== false/);
  assert.match(app, /initialBalance !== 10_000/);
  assert.match(app, /nextRoundCost !== expectedNextRoundCost/);
  assert.match(app, /betCount \+ skippedAfterExhaustionCount !== eligibleAnchorCount/);
  assert.match(app, /totalGrossPayout - totalStaked !== netResult/);
  assert.match(app, /ladderTotalLoss \/ \(model\.netHitMultiplier \* model\.stakeStepPerNumber\)/);
  assert.match(app, /\["ready", "no_signal"\]\.includes\(currentSignal\?\.status\)/);
  assert.match(app, /currentSignal\.candidates\.map\(\(\{ number \}\) => number\)/);
  assert.match(app, /historicalAccount\.eligibleAnchorCount === eligibleCount/);
  assert.match(app, /function renderFollowerWarmHistoricalAccount\(account,/);
  assert.doesNotMatch(app, /"Для счёта"|выбран для исторического счёта|is-account-pick/);
  assert.doesNotMatch(styles, /\.follower-warm-pick\.is-account-pick|\.follower-warm-pick__account/);
  assert.match(html, /Архивная симуляция · динамический Top‑5/);
  assert.match(html, /Исторический счёт общего билета/);
  assert.match(html, /Билеты Top‑5/);
  assert.match(html, /старт 10 000/);
  assert.match(html, /Счёт начинается с 10 000 условных единиц/);
  assert.doesNotMatch(html, /Счёт начинается с 1 000 условных единиц/);
  assert.match(html, /на каждое из 5 чисел необрезанного динамического Top‑5/);
  assert.match(html, /старт по 10 \(билет 50\), шаг по 10, максимум по 2 500 \(билет 12 500\)/);
  assert.match(html, /×36 начисляется только на одно выигравшее число/);
  assert.match(html, /коэффициент восстановления равен 31/);
  assert.match(html, /Порог ≥5% относится только к тёплому прогнозу выше/);
  assert.match(styles, /\.follower-warm-account\s*\{/);
  assert.match(styles, /\.follower-warm-account__metrics\s*\{/);
  assert.match(
    styles,
    /@media \(max-width: 680px\)[\s\S]*?\.follower-warm-account__metrics\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    styles,
    /@media \(max-width: 360px\)[\s\S]*?\.follower-warm-account__metrics\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
  );
});

test("live fixed top-5 account gates one shared ticket ladder on cumulative 80 percent", () => {
  for (const id of [
    "follower-live-account",
    "follower-live-account-status",
    "follower-live-account-balance",
    "follower-live-account-result-card",
    "follower-live-account-result",
    "follower-live-account-bets",
    "follower-live-account-record",
    "follower-live-account-stake",
    "follower-live-account-ticket",
    "follower-live-account-gate",
    "follower-live-account-audit",
  ]) {
    assert.match(html, new RegExp(`\\bid="${id}"`));
    assert.match(app, new RegExp(`getElementById\\("${id}"\\)`));
  }
  assert.match(html, /\bid="follower-live-account-note"/);

  assert.match(app, /const FOLLOWER_LIVE_ACCOUNT_THRESHOLD = 0\.8/);
  assert.match(app, /function normalizedFollowerLiveGateEvidence\(value\)/);
  assert.match(app, /function normalizedFollowerLiveGatedAccount\(value, currentSession, trackerStatus\)/);
  assert.match(app, /follower-top5-cumulative80-ladder-v1/);
  assert.match(app, /persisted-session-retrospective/);
  assert.match(app, /thresholdMetric !== "cumulative-hit-by-attempt"/);
  assert.match(app, /evaluationTiming !== "pre-attempt-walk-forward"/);
  assert.match(app, /startPolicy !== "latch-for-session"/);
  assert.match(app, /noCrossingPolicy !== "observe-only"/);
  assert.match(app, /initialBalance !== 10_000/);
  assert.match(app, /trackedAttemptCount !== observedWithoutBetCount \+ eligibleBetCount/);
  assert.match(app, /eligibleBetCount !== betCount \+ skippedAfterExhaustionCount/);
  assert.match(app, /hitCount \+ missCount !== betCount/);
  assert.match(app, /startEvidence\.rate < strategy\.threshold/);
  assert.match(app, /function renderFollowerLiveGatedAccount\(account,/);
  assert.match(app, /renderFollowerLiveGatedAccount\(tracker\.gatedAccount, \{ stale \}\)/);
  assert.match(app, /liveGatePercentFormatter/);
  assert.match(html, /Счёт с накопительным порогом 80%/);
  assert.match(html, /Порог 80% — накопительная архивная доля/);
  assert.match(html, /а не вероятность следующего раунда/);
  assert.match(html, /Независимый шанс попадания пяти чисел[^<]*5 из 37/);
  assert.match(html, /с 10 000 условных единиц/);
  assert.match(html, /одна общая лестница/);
  assert.match(html, /одинаково на все 5 зафиксированных чисел/);
  assert.match(html, /чистый коэффициент восстановления равен 31/);
  assert.match(styles, /\.follower-live-account\s*\{/);
  assert.match(styles, /\.follower-live-account__metrics\s*\{/);
  assert.match(
    styles,
    /@media \(max-width: 680px\)[\s\S]*?\.follower-live-account__metrics\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    styles,
    /@media \(max-width: 360px\)[\s\S]*?\.follower-live-account__metrics\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
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
  assert.match(html, /href="\/styles\.css\?v=26"/);
  assert.match(html, /src="\/app\.js\?v=27"/);
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
