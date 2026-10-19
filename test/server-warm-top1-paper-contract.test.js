import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

function functionSource(name) {
  const start = server.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const bodyStart = server.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < server.length; index += 1) {
    if (server[index] === '{') depth += 1;
    if (server[index] === '}') depth -= 1;
    if (depth === 0) return server.slice(start, index + 1);
  }
  throw new Error(`Could not find the end of ${name}`);
}

test('server exposes the read-only Warm Top-1 paper contract from durable and live state', () => {
  const view = functionSource('predictiveLeaderWarmTop1PaperForApi');

  assert.match(
    server,
    /import \{\s*predictiveLeaderWarmTop1PaperSnapshotForApi,?\s*\} from '\.\/predictive-leader-warm-top1-paper-api\.js';/,
  );
  assert.match(
    view,
    /cachedDatabaseRead\(\s*'predictive-leader-warm-top1-paper-state'/,
  );
  assert.match(
    view,
    /db\.getPredictiveLeaderWarmTop1PaperState\(source, instrument\)/,
  );
  assert.match(view, /collector: collector\.getStatus\(\)/);
  assert.match(view, /latestResult: resultForApi\(latestResultFromDatabase\(\)\)/);
  assert.match(view, /pipelinePending: resultPipeline\.getPendingCounts\(\)/);
  assert.match(
    server,
    /pathname === '\/api\/predictive-leader\/warm-top1-paper'[\s\S]*?predictiveLeaderWarmTop1PaperForApi\(\)/,
  );
});

test('startup initializes Warm Top-1 but only reconciles the retired V7 campaign', () => {
  const warmInitialization = server.indexOf(
    'db.initializePredictiveLeaderWarmTop1PaperCampaign(',
  );
  const v7Reconciliation = server.indexOf(
    'db.reconcilePredictiveLeaderV7PaperCampaign(',
  );
  const listen = server.indexOf('server.listen(');

  assert.ok(v7Reconciliation >= 0 && v7Reconciliation < listen);
  assert.ok(warmInitialization >= 0 && warmInitialization < listen);
  assert.doesNotMatch(server, /db\.initializePredictiveLeaderV7PaperCampaign\(/);
  assert.doesNotMatch(server, /db\.placePredictiveLeaderV7PaperBet\(/);
  assert.doesNotMatch(server, /db\.placePredictiveLeaderWarmTop1PaperBet\(/);
  assert.match(server, /db\.recordPrecloseForecast\(/);
  assert.match(server, /db\.settlePrecloseForecasts\('buleto', config\.instrument\)/);
});

test('Warm Top-1 revisions invalidate cached GETs and emit SSE after forecast and result writes', () => {
  const revision = functionSource('predictiveLeaderWarmTop1PaperRevisionFor');
  const refresh = functionSource(
    'broadcastPredictiveLeaderWarmTop1PaperUpdateIfChanged',
  );
  const pipeline = functionSource('publishPipelineOutcome');
  const precloseStart = server.indexOf("collector.on('preclose-forecast'");
  const precloseEnd = server.indexOf("collector.on('round'", precloseStart);
  const preclose = server.slice(precloseStart, precloseEnd);

  assert.match(server, /'predictive-leader-warm-top1-paper',/);
  assert.match(revision, /account\?\.ledgerRevision/);
  assert.match(revision, /gate\?\.status/);
  assert.match(revision, /gate\?\.selectedCount/);
  assert.match(revision, /gate\?\.settledCount/);
  assert.match(revision, /gate\?\.evidenceSha256/);
  assert.match(revision, /pendingBet\?\.id/);
  assert.match(
    refresh,
    /db\.getPredictiveLeaderWarmTop1PaperState\([\s\S]*?'buleto'[\s\S]*?config\.instrument/,
  );
  assert.match(
    refresh,
    /broadcastUpdate\('predictive-leader-warm-top1-paper'\)/,
  );
  assert.match(
    pipeline,
    /db\.settlePrecloseForecasts[\s\S]*?broadcastPredictiveLeaderWarmTop1PaperUpdateIfChanged\(\)/,
  );
  assert.match(
    preclose,
    /db\.recordPrecloseForecast[\s\S]*?broadcastPredictiveLeaderWarmTop1PaperUpdateIfChanged\(\)/,
  );
  assert.match(
    server,
    /broadcastUpdate\('predictive-shadow-metadata-conflict'\);\s*.*broadcastPredictiveLeaderV7PaperUpdateIfChanged\(\);\s*.*broadcastPredictiveLeaderWarmTop1PaperUpdateIfChanged\(\)/,
  );
});
