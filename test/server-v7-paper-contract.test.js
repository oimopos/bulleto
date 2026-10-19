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

test('server exposes the read-only V7 paper view from durable and live state', () => {
  const view = functionSource('predictiveLeaderV7PaperForApi');

  assert.match(
    server,
    /import \{ predictiveLeaderV7PaperSnapshotForApi \} from '\.\/predictive-leader-v7-paper-api\.js';/,
  );
  assert.match(view, /db\.getPredictiveLeaderV7PaperState\(source, instrument\)/);
  assert.match(view, /db\.getPredictiveLeaderV7AuditState\(source, instrument\)/);
  assert.match(view, /collector: collector\.getStatus\(\)/);
  assert.match(view, /latestResult: resultForApi\(latestResultFromDatabase\(\)\)/);
  assert.match(view, /pipelinePending: resultPipeline\.getPendingCounts\(\)/);
  assert.match(
    server,
    /pathname === '\/api\/predictive-leader\/v7-paper'[\s\S]*?predictiveLeaderV7PaperForApi\(\)/,
  );
});

test('server initializes V7 paper once and leaves placement and settlement in database lifecycle', () => {
  const initialization = server.indexOf('db.initializePredictiveLeaderV7PaperCampaign(');
  const listen = server.indexOf('server.listen(');

  assert.ok(initialization >= 0 && initialization < listen);
  assert.doesNotMatch(server, /db\.placePredictiveLeaderV7PaperBet\(/);
  assert.doesNotMatch(server, /db\.settlePredictiveLeaderV7PaperCampaign\(/);
  assert.match(server, /db\.recordPrecloseForecast\(/);
  assert.match(server, /db\.settlePrecloseForecasts\('buleto', config\.instrument\)/);
});

test('V7 paper ledger revisions invalidate cached GETs and emit SSE after DB lifecycle writes', () => {
  const revision = functionSource('predictiveLeaderV7PaperRevisionFor');
  const refresh = functionSource('broadcastPredictiveLeaderV7PaperUpdateIfChanged');
  const pipeline = functionSource('publishPipelineOutcome');
  const precloseStart = server.indexOf("collector.on('preclose-forecast'");
  const precloseEnd = server.indexOf("collector.on('round'", precloseStart);
  const preclose = server.slice(precloseStart, precloseEnd);

  assert.match(server, /'predictive-leader-v7-paper',/);
  assert.match(revision, /state\.strategyVersion/);
  assert.match(revision, /state\.ledgerRevision/);
  assert.match(revision, /state\.nextStake/);
  assert.match(revision, /state\.ladder\?\.cycleNumber/);
  assert.match(revision, /state\.ladder\?\.resetCount/);
  assert.match(revision, /state\.latestReset\?\.id/);
  assert.match(refresh, /db\.getPredictiveLeaderV7PaperState\('buleto', config\.instrument\)/);
  assert.match(refresh, /broadcastUpdate\('predictive-leader-v7-paper'\)/);
  assert.match(
    pipeline,
    /db\.settlePrecloseForecasts[\s\S]*?broadcastPredictiveLeaderV7PaperUpdateIfChanged\(\)/,
  );
  assert.match(
    preclose,
    /db\.recordPrecloseForecast[\s\S]*?broadcastPredictiveLeaderV7PaperUpdateIfChanged\(\)/,
  );
  assert.match(
    server,
    /broadcastUpdate\('predictive-shadow-metadata-conflict'\);\s*.*broadcastPredictiveLeaderV7PaperUpdateIfChanged\(\)/,
  );
});
