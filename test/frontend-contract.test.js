import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const combinedNumber = readFileSync(
  new URL("../public/combined-number.js", import.meta.url),
  "utf8",
);
const styles = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const server = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

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

test("server exposes a separate read-only predictive leader GET", () => {
  assert.match(
    server,
    /if \(pathname === '\/api\/predictive-leader'\) \{[\s\S]*?sendJson\(response, 200, predictiveLeaderForApi\(\)\)/,
  );
  assert.match(server, /predictiveLeaderSnapshotForApi\(\{/);
  assert.match(server, /state: dashboardState\(\)/);
});

test("combined leader is the first dashboard block and renders exactly one number", () => {
  const rendererIds = [
    "combined-pick",
    "combined-pick-number",
    "combined-pick-status",
    "combined-pick-sources",
  ];
  for (const id of rendererIds) {
    assert.match(html, new RegExp(`\\bid="${id}"`));
    assert.match(app, new RegExp(`getElementById\\("${id}"\\)`));
  }

  const gapStart = html.indexOf('id="gap-alert"');
  const blockStart = html.indexOf('id="combined-pick"');
  const headingStart = html.indexOf('class="page-heading"');
  const block = html.slice(blockStart, headingStart);
  assert.ok(gapStart >= 0 && blockStart > gapStart && headingStart > blockStart);
  assert.doesNotMatch(block, /\bhidden\b/);
  assert.match(block, /data-algorithm="learned-predictive-family-index-v5"/);
  assert.match(block, /id="combined-pick-status" role="status" aria-live="polite" aria-atomic="true"/);
  assert.equal([...block.matchAll(/<output\b/g)].length, 1);
  assert.match(block, /id="combined-pick-number"/);
  assert.doesNotMatch(block, /<(?:ol|ul)\b/);
  assert.match(block, /Актуальные прогнозные сигналы · один итог/);
  assert.match(block, /Сервер заранее фиксирует полные распределения/);
  assert.match(block, /Семейные веса начинают с 50\/50 и меняются только по прошлым завершённым общим снимкам/);
  assert.match(block, /текущий результат в расчёт не попадает/);
  assert.match(block, /эвристический ранговый индекс, не вероятность и не гарантия преимущества/);
  assert.match(block, /Давность, виртуальная цель, невыпавшие числа, survivor и исторический аналог остаются только наблюдением/);
  assert.match(block, /1 из 37 \(≈2,7%\)/);
  assert.match(html, /<script type="module" src="\/app\.js\?v=39"><\/script>/);

  assert.match(app, /from "\.\/combined-number\.js\?v=6"/);
  assert.match(app, /assessCombinedNumberFreshness\(store\.state\)/);
  assert.match(app, /const LEARNED_LEADER_SCHEMA_VERSION = 1/);
  assert.match(app, /const LEARNED_LEADER_ALGORITHM_VERSION = "learned-predictive-family-index-v5"/);
  assert.match(app, /function normalizedPredictiveLeader\(value\)/);
  assert.match(app, /value\.schemaVersion !== LEARNED_LEADER_SCHEMA_VERSION/);
  assert.match(app, /value\.algorithmVersion !== LEARNED_LEADER_ALGORITHM_VERSION/);
  assert.match(app, /value\.ranking\.length !== 37/);
  assert.match(app, /normalizedLearnedLeaderDistribution/);
  assert.match(app, /normalizedLearnedLeaderLearning/);
  assert.match(app, /function normalizedPredictiveLeaderMetrics\(value\)/);
  assert.match(app, /function currentCombinedNumberContext\(\)/);
  assert.match(app, /function renderCombinedPick\(\)/);
  assert.match(app, /function currentPriceTrajectorySignals\(latestForecast\)/);
  assert.match(app, /combinedTrajectorySignals\(/);
  assert.match(server, /pipelinePending: resultPipeline\.getPendingCounts\(\)/);
  assert.ok(
    [...app.matchAll(/renderCombinedPick\(\)/g)].length >= 3,
    "combined leader must render on normal and failed refresh paths",
  );

  const contextStart = app.indexOf("function currentCombinedNumberContext()");
  const contextEnd = app.indexOf("function renderCombinedPick", contextStart);
  const contextBlock = app.slice(contextStart, contextEnd);
  assert.ok(contextStart >= 0 && contextEnd > contextStart);
  assert.match(contextBlock, /stateHasIntegrityGap\(store\.state\)/);
  assert.match(contextBlock, /assessCombinedNumberFreshness\(store\.state\)/);
  assert.match(contextBlock, /sameEntityId\(latestForecast\.roundId, currentRoundId\)/);
  assert.match(contextBlock, /latestForecast\.settlement !== null/);
  assert.match(contextBlock, /latestForecast\.predictiveLeader/);
  assert.match(contextBlock, /normalizedPredictiveLeader\(latestForecast\.predictiveLeader\)/);
  assert.match(contextBlock, /sameTimestamp\(leader\.lockedAt, latestForecast\.lockedAt\)/);
  assert.match(contextBlock, /leader\.status !== "ready"/);
  assert.match(contextBlock, /predictiveLeaderMetrics/);
  assert.doesNotMatch(contextBlock, /combineNumberRankings|combinedTripleFollowerRanking/);
  assert.doesNotMatch(contextBlock, /rankedNumbers|trajectoryShadow|pairHistory|followerTop5Tracker|tripleFollowerSignal/);
  assert.doesNotMatch(contextBlock, /currentOverdueRanking|currentVirtualRecencySignals/);
  assert.doesNotMatch(contextBlock, /currentActiveCycleRemaining|currentCompletedCycleSurvivor/);
  assert.doesNotMatch(contextBlock, /currentCycleAnalogueRanking/);
  assert.doesNotMatch(contextBlock, /recency-overdue-top3|recency-virtual-held/);
  assert.doesNotMatch(contextBlock, /cycle-remaining|cycle-completed-survivor|cycle-analogue-next/);
  assert.doesNotMatch(contextBlock, /family: "absence"|family: "cycle-analogue"/);
  assert.doesNotMatch(contextBlock, /historicalAccount|actualNumber/);

  const renderStart = app.indexOf("function renderCombinedPick()");
  const renderEnd = app.indexOf("function renderPrecloseComparison", renderStart);
  const renderBlock = app.slice(renderStart, renderEnd);
  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  assert.match(renderBlock, /const \{ leader, metrics \} = context/);
  assert.match(renderBlock, /leader\.number/);
  assert.match(renderBlock, /зафиксировано сервером до результата/);
  assert.match(renderBlock, /обучение \$\{leader\.learning\.trainingCount\}/);
  assert.match(renderBlock, /вес цены/);
  assert.match(renderBlock, /истории/);
  assert.match(renderBlock, /Top‑1/);
  assert.match(renderBlock, /улучшение не гарантируется/);
  assert.doesNotMatch(renderBlock, /combineNumberRankings|leaderMass|score|вероятност/);
  assert.doesNotMatch(app, /\bcombineNumberRankings\b|\bcombinedTripleFollowerRanking\b/);
  assert.match(styles, /\.combined-pick\s*\{/);
  assert.match(styles, /\.combined-pick__result \.combined-pick__number\s*\{/);
  assert.match(
    styles,
    /@media \(max-width: 430px\)[\s\S]*?\.combined-pick\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
  );
});

test("predictive leader account is an independent strict paper simulation", () => {
  const accountIds = [
    "combined-pick-account",
    "combined-pick-account-status",
    "combined-pick-account-balance-card",
    "combined-pick-account-balance",
    "combined-pick-account-profit",
    "combined-pick-account-record",
    "combined-pick-account-settled",
    "combined-pick-account-rate",
    "combined-pick-account-rate-detail",
    "combined-pick-account-stake-label",
    "combined-pick-account-stake",
    "combined-pick-account-ladder",
  ];
  for (const id of accountIds) {
    assert.match(html, new RegExp(`\\bid="${id}"`));
    assert.match(app, new RegExp(`getElementById\\("${id}"\\)`));
  }

  const blockStart = html.indexOf('id="combined-pick"');
  const blockEnd = html.indexOf('class="page-heading"', blockStart);
  const block = html.slice(blockStart, blockEnd);
  const accountStart = block.indexOf('id="combined-pick-account"');
  const accountBlock = block.slice(accountStart);
  assert.ok(accountStart > block.indexOf('id="combined-pick-number"'));
  assert.equal([...block.matchAll(/<output\b/g)].length, 1);
  assert.equal([...accountBlock.matchAll(/<output\b/g)].length, 0);
  assert.equal([...accountBlock.matchAll(/<dd\b/g)].length, 4);
  assert.match(accountBlock, /Проспективная симуляция · один лидер/);
  assert.match(accountBlock, /Виртуальный счёт лестницы/);
  assert.match(accountBlock, /Текущий счёт/);
  assert.match(accountBlock, /Попадания \/ промахи/);
  assert.match(accountBlock, /Наблюдаемая частота попаданий/);
  assert.match(accountBlock, /Следующая ставка/);
  assert.match(accountBlock, /Старт 1 000, ставка и шаг 10, максимум 2 500/);
  assert.match(accountBlock, /Частота — прошлое наблюдение, не вероятность следующего результата/);
  assert.match(accountBlock, /виртуальная \(«бумажная»\) симуляция; реальных ставок и действий нет/i);

  assert.match(app, /const PREDICTIVE_LEADER_ACCOUNT_SCHEMA_VERSION = 1/);
  assert.match(
    app,
    /const PREDICTIVE_LEADER_ACCOUNT_STRATEGY_VERSION = "predictive-leader-single-ladder-v1"/,
  );
  assert.match(app, /const PREDICTIVE_LEADER_ACCOUNT_STARTING_BALANCE = 1_000/);
  assert.match(app, /initialStake: 10[\s\S]*?stakeStep: 10[\s\S]*?maxStake: 2_500/);
  assert.match(app, /grossPayoutMultiplier: 36[\s\S]*?payoutIncludesStake: true[\s\S]*?netHitMultiplier: 35/);

  const normalizerStart = app.indexOf("function normalizedPredictiveLeaderAccount(value)");
  const normalizerEnd = app.indexOf("function currentPredictiveLeaderAccountContext", normalizerStart);
  const normalizer = app.slice(normalizerStart, normalizerEnd);
  assert.ok(normalizerStart >= 0 && normalizerEnd > normalizerStart);
  assert.match(normalizer, /value\.schemaVersion !== PREDICTIVE_LEADER_ACCOUNT_SCHEMA_VERSION/);
  assert.match(normalizer, /value\.strategyVersion !== PREDICTIVE_LEADER_ACCOUNT_STRATEGY_VERSION/);
  assert.match(normalizer, /value\.leaderAlgorithmVersion !== LEARNED_LEADER_ALGORITHM_VERSION/);
  assert.match(normalizer, /value\.mode !== "prospective-simulation"/);
  assert.match(normalizer, /value\.executionEnabled !== false/);
  assert.match(normalizer, /value\.advisoryOnly !== true/);
  assert.match(normalizer, /value\.model\.netHitMultiplier !== PREDICTIVE_LEADER_ACCOUNT_MODEL\.netHitMultiplier/);
  assert.match(normalizer, /value\.betCount !== value\.settledCount \+ value\.pendingCount/);
  assert.match(normalizer, /value\.settledCount !== value\.hitCount \+ value\.missCount/);
  assert.match(normalizer, /value\.currentBalance !== computedBalance/);
  assert.match(normalizer, /value\.nextStake !== expectedNextStake/);
  assert.match(normalizer, /value\.hitRate - value\.hitCount \/ value\.settledCount/);
  assert.match(normalizer, /\(value\.status === "pending"\) !== \(pendingBet !== null\)/);
  assert.match(normalizer, /\(value\.status === "exhausted"\) !== !value\.canAffordNext/);

  const contextStart = app.indexOf("function currentPredictiveLeaderAccountContext()");
  const contextEnd = app.indexOf("function renderPredictiveLeaderAccount", contextStart);
  const context = app.slice(contextStart, contextEnd);
  assert.ok(contextStart >= 0 && contextEnd > contextStart);
  assert.match(context, /store\.state\.precloseForecast\?\.predictiveLeaderAccount/);
  assert.match(context, /normalizedPredictiveLeaderAccount/);
  assert.doesNotMatch(context, /currentCombinedNumberContext|predictiveLeaderMetrics|latestForecast/);

  const rendererStart = app.indexOf("function renderPredictiveLeaderAccount()");
  const rendererEnd = app.indexOf("function currentPriceTrajectorySignals", rendererStart);
  const renderer = app.slice(rendererStart, rendererEnd);
  assert.ok(rendererStart >= 0 && rendererEnd > rendererStart);
  assert.match(renderer, /context\.state !== "ready"/);
  assert.match(renderer, /combinedPickAccountBalance, "—"/);
  assert.match(renderer, /account\.currentBalance/);
  assert.match(renderer, /account\.hitCount/);
  assert.match(renderer, /account\.missCount/);
  assert.match(renderer, /trajectoryShadowShareFormatter\.format\(account\.hitRate\)/);
  assert.match(renderer, /account\.nextStake/);
  assert.match(renderer, /account\.ladder\.missCount/);
  assert.match(renderer, /не вероятность/);
  assert.doesNotMatch(renderer, /вероятность следующего|улучшит|повысит шанс/);
  assert.ok(
    [...app.matchAll(/renderPredictiveLeaderAccount\(\)/g)].length >= 3,
    "account must render on normal and failed refresh paths",
  );

  assert.match(styles, /\.combined-pick-account\s*\{[\s\S]*?grid-column: 1 \/ -1/);
  assert.match(
    styles,
    /\.combined-pick-account__metrics\s*\{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/,
  );
  const tabletStyles = styles.slice(
    styles.indexOf("@media (max-width: 680px)"),
    styles.indexOf("@media (max-width: 430px)"),
  );
  const narrowStyles = styles.slice(
    styles.indexOf("@media (max-width: 360px)"),
    styles.indexOf("@media (prefers-reduced-motion: reduce)"),
  );
  assert.match(tabletStyles, /\.combined-pick-account__metrics\s*\{[\s\S]*?repeat\(2/);
  assert.match(narrowStyles, /\.combined-pick-account__metrics\s*\{[\s\S]*?minmax\(0, 1fr\)/);
});

test("experimental forecast shows only the first three places of the full Rank-37", () => {
  const blockStart = html.indexOf('id="preclose-panel"');
  const blockEnd = html.indexOf('id="follower-panel"', blockStart);
  const block = html.slice(blockStart, blockEnd);
  assert.ok(blockStart >= 0 && blockEnd > blockStart);
  assert.match(block, /Экспериментальный прогноз/);
  assert.match(block, /Первые 3 места полного Rank‑37/);
  assert.match(block, /aria-label="Первые три места полного рейтинга всех 37 чисел"/);
  assert.match(block, /Ранговая масса — не вероятность и не доказанное преимущество/);
  assert.match(block, /start-price-v2<\/code> остаётся служебным архивом/);
  assert.match(block, /не получает веса ни в новом списке, ни в верхнем едином лидере/);

  const renderStart = app.indexOf("  function renderPrecloseForecast() {");
  const renderEnd = app.indexOf("  function renderCollector", renderStart);
  const renderBlock = app.slice(renderStart, renderEnd);
  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  assert.match(renderBlock, /const rankedNumbers = trajectory\.ranking\.slice\(0, 3\)/);
  assert.match(renderBlock, /Первые три места полного рейтинга 37 чисел/);
  assert.match(renderBlock, /все 37 чисел отранжированы, показаны три первых/);
  assert.match(renderBlock, /старый статичный Top‑3 не показывается/);
  assert.doesNotMatch(renderBlock, /finalForecast\.numbers|price-start/);
});

test("trajectory shadow is prospective and exposes the full Rank-37 contract", () => {
  const rendererIds = [
    "trajectory-shadow-panel",
    "trajectory-shadow-badge",
    "trajectory-shadow-status",
    "trajectory-shadow-shares",
    "trajectory-shadow-number-area",
    "trajectory-shadow-training",
    "trajectory-shadow-range-metrics",
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
  assert.match(block, /а не следующий тик/);
  assert.match(block, /Доли похожих завершённых траекторий/);
  assert.match(block, /ПРОГНОЗ УЧАСТКА: НЕТ ДАННЫХ/);
  assert.match(block, /не более 6 соседних ценовых полос вокруг типичного q50/);
  assert.match(block, /полного коридора q20\/q80/);
  assert.match(block, /Adaptive v2 фиксирует при lock/);
  assert.match(block, /legacy KNN v1/);
  assert.match(block, /от 0 сверху к 36 снизу/);
  assert.match(block, /нижняя дублирующая нулевая полоса/);
  assert.match(
    block,
    /id="trajectory-shadow-number-area" aria-live="polite" aria-atomic="true"/,
  );
  assert.match(block, /Обучение: — результатов/);
  assert.match(block, /Участок: — из —/);
  assert.match(block, /Rank‑37 проверяются только на проспективно зафиксированных/);
  assert.match(block, /не являются вероятностью следующего раунда/);
  assert.match(block, /Rank‑37 входит с замороженной исходной массой/);
  assert.match(block, /нулевой массой данных не получают вес/);
  assert.match(block, /не создаёт второй независимый вес/);
  assert.doesNotMatch(block, /roulette-(?:red|green|black)|is-(?:hit|positive|loss)/);

  assert.match(app, /const TRAJECTORY_SHADOW_LEGACY_VERSION = "trajectory-shadow-knn-v1"/);
  assert.match(app, /const TRAJECTORY_SHADOW_ADAPTIVE_VERSION = "trajectory-shadow-adaptive-v2"/);
  assert.match(app, /const TRAJECTORY_NUMBER_AREA_VERSION = "trajectory-number-area-v1"/);
  assert.match(app, /const TRAJECTORY_DISPLAY_RANGE_VERSION = "trajectory-display-range-v1"/);
  assert.match(app, /const TRAJECTORY_DISPLAY_RANGE_POLICY = "q50-centered-contiguous-max6-v1"/);
  assert.match(app, /TRAJECTORY_RANK37_VERSION,/);
  assert.match(app, /TRAJECTORY_RANK37_BASIS,/);
  assert.match(combinedNumber, /evidenceCandidateCount/);
  assert.match(combinedNumber, /weights: evidenceRawMass\.map/);
  assert.match(app, /const TRAJECTORY_NUMBER_AREA_MAX_DISPLAY_CELLS = 6/);
  assert.match(app, /function normalizedTrajectoryNumberArea\(value\)/);
  assert.match(app, /function normalizedTrajectoryDisplayRange\(value, numberArea\)/);
  assert.match(app, /function normalizedTrajectoryAdaptive\(value\)/);
  assert.match(app, /function normalizedTrajectoryEvaluation\(value, \{ numberArea, displayRange \}\)/);
  assert.match(app, /function normalizedTrajectoryMetrics\(value\)/);
  assert.match(app, /function trajectoryNumberAreaDisplayCells\(area\)/);
  assert.match(app, /function trajectoryShadowDisplayCells\(shadow\)/);
  assert.match(app, /function trajectoryNumberAreaText\(shadow\)/);
  assert.match(app, /function normalizedTrajectoryShadow\(value\)/);
  assert.match(app, /function renderTrajectoryShadow\(value, metricsValue\)/);
  assert.match(app, /"insufficient_current"/);
  assert.match(app, /график неполный/);
  assert.match(
    app,
    /renderTrajectoryShadow\(\s*matchesCurrent \? latest\?\.trajectoryShadow : null,\s*forecastState\?\.trajectoryMetrics,\s*\)/,
  );
  assert.match(app, /shadow\.isAdaptive\s*\? shadow\.displayRange\?\.cells \?\? \[\]/);
  assert.match(app, /value\.modelVersion !== TRAJECTORY_SHADOW_ADAPTIVE_VERSION/);
  assert.match(app, /value\.displayRangeVersion !== TRAJECTORY_DISPLAY_RANGE_VERSION/);
  assert.match(app, /value\.rank37Version !== TRAJECTORY_RANK37_VERSION/);
  assert.match(app, /value\.rank37Basis !== TRAJECTORY_RANK37_BASIS/);
  assert.match(app, /value\.readyCount !== value\.settledCount \+ value\.pendingCount/);
  assert.match(app, /value\.settledCount !== value\.evaluatedCount \+ value\.ungradableCount/);
  assert.match(app, /Обучение: \$\{trainingCount\}/);
  assert.match(app, /Участок: \$\{displayRangeHits\} из \$\{evaluatedCount\}/);
  assert.match(app, /Rank‑37: Top‑1/);
  assert.match(app, /Top‑3 \$\{metrics\.rank37Top3Hits\}/);
  assert.match(app, /проспективное наблюдение/);
  assert.match(app, /Полные сопоставимые раунды:/);
  assert.match(app, /Доли похожих завершённых траекторий:/);
  assert.ok(app.includes("ПРОГНОЗ УЧАСТКА: ОТ ${from} ДО ${to}"));
  assert.match(
    app,
    /return cells\.slice\(start, start \+ size\)/,
  );
  assert.doesNotMatch(
    app,
    /trajectoryNumberAreaLabel\(area\.corridor\.(?:top|bottom)\)/,
  );
  assert.match(app, /ПРОГНОЗ УЧАСТКА: НЕДОСТАТОЧНО ПОХОЖИХ ГРАФИКОВ/);
  assert.match(
    app,
    /if \(point\.wireCell === 37\) return "0 \(НИЖНЯЯ ПОЛОСА\)"/,
  );
  assert.match(
    app,
    /if \(point\.wireCell === 0\) return "0 \(ВЕРХНЯЯ ПОЛОСА\)"/,
  );
  assert.match(styles, /\.trajectory-shadow__range\s*\{[\s\S]*?font-size: clamp\(18px, 4vw, 28px\)/);
  assert.doesNotMatch(app, /trajectoryShadowPanel\.(?:dataset|classList)/);
});

test("trajectory number area display keeps at most six cells around q50", () => {
  const functionStart = app.indexOf("  function trajectoryNumberAreaDisplayCells(area) {");
  const functionEnd = app.indexOf("\n\n  function trajectoryNumberAreaText(shadow)", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const functionSource = app.slice(functionStart, functionEnd);
  const build = new Function(
    "TRAJECTORY_NUMBER_AREA_MAX_DISPLAY_CELLS",
    `"use strict"; ${functionSource}; return { trajectoryNumberAreaDisplayCells, trajectoryShadowDisplayCells };`,
  );
  const {
    trajectoryNumberAreaDisplayCells: displayCells,
    trajectoryShadowDisplayCells: shadowDisplayCells,
  } = build(6);
  const point = (wireCell) => ({
    wireCell,
    number: wireCell === 37 ? 0 : wireCell,
  });
  const area = (from, to, typical) => ({
    typical: point(typical),
    corridor: {
      cells: Array.from({ length: to - from + 1 }, (_, index) => point(from + index)),
    },
  });

  assert.deepEqual(displayCells(area(13, 17, 15)).map(({ wireCell }) => wireCell), [13, 14, 15, 16, 17]);
  assert.deepEqual(displayCells(area(13, 18, 15)).map(({ wireCell }) => wireCell), [13, 14, 15, 16, 17, 18]);
  assert.deepEqual(displayCells(area(13, 19, 16)).map(({ wireCell }) => wireCell), [14, 15, 16, 17, 18, 19]);
  assert.deepEqual(displayCells(area(0, 20, 10)).map(({ wireCell }) => wireCell), [8, 9, 10, 11, 12, 13]);
  assert.deepEqual(displayCells(area(0, 20, 0)).map(({ wireCell }) => wireCell), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(displayCells(area(20, 37, 37)).map(({ wireCell }) => wireCell), [32, 33, 34, 35, 36, 37]);
  assert.deepEqual(displayCells(area(10, 20, 9)), []);

  const frozenInput = area(5, 25, 15);
  const before = structuredClone(frozenInput);
  displayCells(frozenInput);
  assert.deepEqual(frozenInput, before);

  const legacy = { isAdaptive: false, numberArea: area(5, 25, 15) };
  assert.deepEqual(
    shadowDisplayCells(legacy).map(({ wireCell }) => wireCell),
    [13, 14, 15, 16, 17, 18],
  );
  const frozenRange = [point(0), point(1), point(2)];
  const adaptive = {
    isAdaptive: true,
    numberArea: area(5, 25, 15),
    displayRange: { cells: frozenRange },
  };
  assert.equal(shadowDisplayCells(adaptive), frozenRange);
});

test("adaptive trajectory display range accepts only the frozen contiguous max-six contract", () => {
  const functionStart = app.indexOf("  function normalizedTrajectoryWirePoint(point) {");
  const functionEnd = app.indexOf("\n\n  function normalizedTrajectoryAdaptive(value)", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const functionSource = app.slice(functionStart, functionEnd);
  const build = new Function(
    "TRAJECTORY_NUMBER_AREA_VERSION",
    "TRAJECTORY_DISPLAY_RANGE_VERSION",
    "TRAJECTORY_DISPLAY_RANGE_POLICY",
    "TRAJECTORY_NUMBER_AREA_MAX_DISPLAY_CELLS",
    `"use strict"; ${functionSource}; return normalizedTrajectoryDisplayRange;`,
  );
  const normalize = build(
    "trajectory-number-area-v1",
    "trajectory-display-range-v1",
    "q50-centered-contiguous-max6-v1",
    6,
  );
  const point = (wireCell) => ({
    wireCell,
    number: wireCell === 37 ? 0 : wireCell,
  });
  const area = (from, to, typical) => ({
    typical: point(typical),
    corridor: {
      top: point(from),
      bottom: point(to),
      cells: Array.from({ length: to - from + 1 }, (_, index) => point(from + index)),
    },
  });
  const range = (from, to) => ({
    version: "trajectory-display-range-v1",
    policy: "q50-centered-contiguous-max6-v1",
    maxCells: 6,
    top: point(from),
    bottom: point(to),
    cells: Array.from({ length: to - from + 1 }, (_, index) => point(from + index)),
  });

  assert.deepEqual(
    normalize(range(0, 5), area(0, 20, 0)).cells.map(({ wireCell }) => wireCell),
    [0, 1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    normalize(range(32, 37), area(20, 37, 37)).cells.map(({ wireCell }) => wireCell),
    [32, 33, 34, 35, 36, 37],
  );
  assert.deepEqual(
    normalize(range(1, 6), area(0, 20, 3)).cells.map(({ wireCell }) => wireCell),
    [1, 2, 3, 4, 5, 6],
  );
  assert.equal(normalize(range(0, 6), area(0, 20, 3)), null);
  assert.equal(normalize(range(0, 5), area(0, 20, 3)), null);
  assert.equal(normalize(range(0, 5), area(0, 20, 10)), null);
  assert.equal(
    normalize({ ...range(0, 5), maxCells: "6" }, area(0, 20, 0)),
    null,
  );
});

test("adaptive trajectory metrics fail closed on inconsistent prospective counts", () => {
  const functionStart = app.indexOf("  function normalizedTrajectoryMetrics(value) {");
  const functionEnd = app.indexOf("\n\n  function normalizedTrajectoryShadow(value)", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const functionSource = app.slice(functionStart, functionEnd);
  const build = new Function(
    "TRAJECTORY_SHADOW_ADAPTIVE_VERSION",
    "TRAJECTORY_DISPLAY_RANGE_VERSION",
    "TRAJECTORY_RANK37_VERSION",
    "TRAJECTORY_RANK37_BASIS",
    `"use strict"; ${functionSource}; return normalizedTrajectoryMetrics;`,
  );
  const normalize = build(
    "trajectory-shadow-adaptive-v2",
    "trajectory-display-range-v1",
    "trajectory-rank37-v1",
    "adaptive-weighted-neighbor-delta-to-current-bands",
  );
  const valid = {
    modelVersion: "trajectory-shadow-adaptive-v2",
    displayRangeVersion: "trajectory-display-range-v1",
    rank37Version: "trajectory-rank37-v1",
    rank37Basis: "adaptive-weighted-neighbor-delta-to-current-bands",
    readyCount: 5,
    settledCount: 4,
    pendingCount: 1,
    evaluatedCount: 3,
    ungradableCount: 1,
    displayRangeHits: 2,
    q50ExactHits: 1,
    fullCorridorHits: 3,
    rank37ReadyCount: 5,
    rank37SettledCount: 4,
    rank37PendingCount: 1,
    rank37EvaluatedCount: 3,
    rank37UngradableCount: 1,
    rank37Top1Hits: 1,
    rank37Top3Hits: 2,
    displayRangeRate: 2 / 3,
    q50ExactRate: 1 / 3,
    fullCorridorRate: 1,
    rank37Top1Rate: 1 / 3,
    rank37Top3Rate: 2 / 3,
    coverageRate: 3 / 4,
  };

  assert.deepEqual(normalize(valid), {
    rank37Version: "trajectory-rank37-v1",
    rank37Basis: "adaptive-weighted-neighbor-delta-to-current-bands",
    readyCount: 5,
    settledCount: 4,
    pendingCount: 1,
    evaluatedCount: 3,
    ungradableCount: 1,
    displayRangeHits: 2,
    q50ExactHits: 1,
    fullCorridorHits: 3,
    rank37ReadyCount: 5,
    rank37SettledCount: 4,
    rank37PendingCount: 1,
    rank37EvaluatedCount: 3,
    rank37UngradableCount: 1,
    rank37Top1Hits: 1,
    rank37Top3Hits: 2,
    displayRangeRate: 2 / 3,
    q50ExactRate: 1 / 3,
    fullCorridorRate: 1,
    rank37Top1Rate: 1 / 3,
    rank37Top3Rate: 2 / 3,
    coverageRate: 3 / 4,
  });
  assert.equal(normalize({ ...valid, evaluatedCount: 4 }), null);
  assert.equal(normalize({ ...valid, displayRangeRate: 0.5 }), null);
  assert.equal(normalize({ ...valid, readyCount: "5" }), null);
  assert.equal(normalize({ ...valid, rank37ReadyCount: 6 }), null);
  assert.equal(normalize({ ...valid, rank37SettledCount: 5, rank37PendingCount: 0 }), null);
  assert.equal(normalize({ ...valid, rank37EvaluatedCount: 4, rank37UngradableCount: 0 }), null);
});

test("trajectory shadow normalizer keeps legacy v1 readable and requires frozen v2 fields", () => {
  const functionStart = app.indexOf("  function normalizedTrajectoryWirePoint(point) {");
  const functionEnd = app.indexOf("\n\n  function trajectoryNumberAreaLabel(point)", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const functionSource = app.slice(functionStart, functionEnd);
  const build = new Function(
    "TRAJECTORY_SHADOW_LEGACY_VERSION",
    "TRAJECTORY_SHADOW_ADAPTIVE_VERSION",
    "TRAJECTORY_NUMBER_AREA_VERSION",
    "TRAJECTORY_DISPLAY_RANGE_VERSION",
    "TRAJECTORY_DISPLAY_RANGE_POLICY",
    "TRAJECTORY_NUMBER_AREA_MAX_DISPLAY_CELLS",
    "TRAJECTORY_SHADOW_DIRECTION_LABELS",
    `"use strict"; ${functionSource}; return normalizedTrajectoryShadow;`,
  );
  const normalize = build(
    "trajectory-shadow-knn-v1",
    "trajectory-shadow-adaptive-v2",
    "trajectory-number-area-v1",
    "trajectory-display-range-v1",
    "q50-centered-contiguous-max6-v1",
    6,
    { up: "вверх", down: "вниз", flat: "без движения" },
  );
  const point = (wireCell) => ({
    wireCell,
    number: wireCell === 37 ? 0 : wireCell,
  });
  const cells = Array.from({ length: 6 }, (_, wireCell) => point(wireCell));
  const numberArea = {
    version: "trajectory-number-area-v1",
    basis: "weighted-neighbor-delta-q20-q50-q80",
    centralWeight: 0.6,
    scale: "wire-cell-top-to-bottom",
    current: point(2),
    typical: {
      ...point(2),
      price: 1,
      deltaCellWidths: 0,
      direction: "flat",
      agreesWithDirection: false,
    },
    corridor: {
      lowerQuantile: 0.2,
      upperQuantile: 0.8,
      top: point(0),
      bottom: point(5),
      cells,
    },
  };
  const sample = {
    historyCount: 30,
    eligibleCount: 30,
    excludedNotPastCount: 0,
    withinDistanceCount: 10,
    neighborCount: 10,
    requiredHistory: 30,
    requiredNeighbors: 10,
  };
  const base = {
    status: "ready",
    direction: "up",
    probabilities: { up: 0.5, down: 0.3, flat: 0.2 },
    sample,
    numberArea,
    evaluation: null,
  };

  const legacy = normalize({
    ...base,
    version: "trajectory-shadow-knn-v1",
    modelVersion: "trajectory-shadow-knn-v1",
  });
  assert.equal(legacy.isAdaptive, false);
  assert.equal(legacy.displayRange, null);

  const displayRange = {
    version: "trajectory-display-range-v1",
    policy: "q50-centered-contiguous-max6-v1",
    maxCells: 6,
    top: point(0),
    bottom: point(5),
    cells,
  };
  const adaptiveInput = {
    ...base,
    version: "trajectory-shadow-adaptive-v2",
    modelVersion: "trajectory-shadow-adaptive-v2",
    adaptive: { trainingCount: 4 },
    displayRange,
  };
  const adaptive = normalize(adaptiveInput);
  assert.equal(adaptive.isAdaptive, true);
  assert.equal(adaptive.adaptive.trainingCount, 4);
  assert.deepEqual(adaptive.displayRange.cells, cells);
  const priceLessSettlement = normalize({
    ...adaptiveInput,
    evaluation: {
      rawCell: 2,
      displayRangeHit: true,
      q50ExactHit: true,
      fullCorridorHit: true,
      directionHit: null,
    },
  });
  assert.notEqual(priceLessSettlement, null);
  assert.deepEqual(priceLessSettlement.evaluation, {
    rawCell: 2,
    displayRangeHit: true,
    q50ExactHit: true,
    fullCorridorHit: true,
    directionHit: null,
  });
  assert.equal(normalize({ ...adaptiveInput, displayRange: null }), null);
  assert.equal(normalize({ ...adaptiveInput, adaptive: null }), null);
  assert.equal(normalize({ ...adaptiveInput, adaptive: { trainingCount: "4" } }), null);
});

test("trajectory evaluation distinguishes both zero bands and leaves missing raw cells ungraded", () => {
  const functionStart = app.indexOf("  function normalizedTrajectoryEvaluation(value, { numberArea, displayRange }) {");
  const functionEnd = app.indexOf("\n\n  function normalizedTrajectoryMetrics(value)", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const functionSource = app.slice(functionStart, functionEnd);
  const normalize = new Function(
    `"use strict"; ${functionSource}; return normalizedTrajectoryEvaluation;`,
  )();
  const point = (wireCell) => ({
    wireCell,
    number: wireCell === 37 ? 0 : wireCell,
  });
  const context = (from, to, typical) => {
    const cells = Array.from(
      { length: to - from + 1 },
      (_, index) => point(from + index),
    );
    return {
      numberArea: { typical: point(typical), corridor: { cells } },
      displayRange: { cells },
    };
  };

  assert.deepEqual(
    normalize({
      rawCell: 0,
      displayRangeHit: true,
      q50ExactHit: true,
      fullCorridorHit: true,
      directionHit: true,
    }, context(0, 5, 0)),
    {
      rawCell: 0,
      displayRangeHit: true,
      q50ExactHit: true,
      fullCorridorHit: true,
      directionHit: true,
    },
  );
  assert.deepEqual(
    normalize({
      rawCell: 37,
      displayRangeHit: true,
      q50ExactHit: true,
      fullCorridorHit: true,
      directionHit: false,
    }, context(32, 37, 37)),
    {
      rawCell: 37,
      displayRangeHit: true,
      q50ExactHit: true,
      fullCorridorHit: true,
      directionHit: false,
    },
  );
  assert.deepEqual(
    normalize({
      rawCell: 2,
      displayRangeHit: true,
      q50ExactHit: true,
      fullCorridorHit: true,
      directionHit: null,
    }, context(0, 5, 2)),
    {
      rawCell: 2,
      displayRangeHit: true,
      q50ExactHit: true,
      fullCorridorHit: true,
      directionHit: null,
    },
  );
  assert.deepEqual(
    normalize({
      rawCell: null,
      displayRangeHit: null,
      q50ExactHit: null,
      fullCorridorHit: null,
      directionHit: true,
    }, context(0, 5, 0)),
    {
      rawCell: null,
      displayRangeHit: null,
      q50ExactHit: null,
      fullCorridorHit: null,
      directionHit: true,
    },
  );
  assert.equal(
    normalize({
      rawCell: null,
      displayRangeHit: false,
      q50ExactHit: null,
      fullCorridorHit: null,
      directionHit: true,
    }, context(0, 5, 0)),
    false,
  );
});

test("top-5 horizon block stays hidden while preserving renderer targets and cumulative horizons", () => {
  for (const id of [
    "follower-horizon",
    "follower-horizon-list",
    "follower-horizon-status",
    "follower-horizon-note",
  ]) {
    assert.match(html, new RegExp(`\\bid="${id}"`));
  }
  assert.match(html, /id="follower-horizon"[^>]*\bhidden\b/);
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
  assert.match(html, /styles\.css\?v=29/);
  assert.match(html, /app\.js\?v=39/);
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

test("full-cycle comparison block stays hidden while preserving every renderer target", () => {
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
  assert.match(html, /id="cycle-comparison-panel"[^>]*\bhidden\b/);
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
  assert.match(html, /href="\/styles\.css\?v=29"/);
  assert.match(html, /src="\/app\.js\?v=39"/);
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
