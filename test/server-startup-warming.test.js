import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { predictiveLeaderSnapshotForApi } from '../src/predictive-leader-api.js';

const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const database = readFileSync(new URL('../src/database.js', import.meta.url), 'utf8');

function functionBody(name) {
  const signature = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const match = signature.exec(server);
  assert.ok(match, `${name} must be declared`);

  const openBrace = server.indexOf('{', match.index + match[0].length);
  assert.ok(openBrace >= 0, `${name} must have a body`);
  let depth = 0;
  for (let index = openBrace; index < server.length; index += 1) {
    if (server[index] === '{') depth += 1;
    if (server[index] === '}') depth -= 1;
    if (depth === 0) return server.slice(openBrace + 1, index);
  }
  assert.fail(`${name} must have a complete body`);
}

function routeBody(pathname, nextPathname) {
  const start = server.indexOf(`if (pathname === '${pathname}')`);
  const end = server.indexOf(`if (pathname === '${nextPathname}')`, start + 1);
  assert.ok(start >= 0, `${pathname} route must exist`);
  assert.ok(end > start, `${pathname} route must precede ${nextPathname}`);
  return server.slice(start, end);
}

test('HTTP listener and collector start before optional trajectory validation warming', () => {
  const listen = server.lastIndexOf('server.listen(');
  const shutdown = server.indexOf('let shuttingDown', listen);
  assert.ok(listen >= 0 && shutdown > listen, 'server listen block must exist');

  const listenBlock = server.slice(listen, shutdown);
  const collectorStart = listenBlock.indexOf('collector.start()');
  const warmSchedule = listenBlock.indexOf('scheduleTrajectoryValidationWarmup()');
  assert.ok(collectorStart >= 0, 'collector must start from the listen callback');
  assert.ok(warmSchedule > collectorStart, 'warming must be scheduled after collector startup');
  assert.match(
    listenBlock,
    /if\s*\(config\.collectorEnabled\)\s*collector\.start\(\);\s*scheduleTrajectoryValidationWarmup\(\);/,
    'disabled collection must not prevent the independent warm-up schedule',
  );
});

test('trajectory warming is incremental, asynchronous, and has explicit terminal state', () => {
  assert.match(
    server,
    /trajectoryValidation\s*:\s*'pending'/,
    'startup state begins fail-closed before warming is scheduled',
  );

  const schedule = functionBody('scheduleTrajectoryValidationWarmup');
  assert.match(schedule, /setImmediate\s*\(/);
  assert.match(schedule, /runTrajectoryValidationWarmup\s*\(\s*\)/);

  const run = functionBody('runTrajectoryValidationWarmup');
  assert.match(run, /trajectoryValidation\s*:\s*'warming'/);
  assert.match(
    run,
    /await\s+db\.warmPrecloseForecastValidationIncrementally\s*\(/,
    'the server must await the yielding database warm-up API',
  );
  assert.match(run, /trajectoryValidation\s*:\s*'ready'/);
  assert.match(run, /trajectoryValidation\s*:\s*'failed'/);
  assert.match(run, /retrying in \$\{retryDelayMs\}ms/);
  assert.match(run, /setTimeout\s*\(\s*\(\)\s*=>\s*\{[\s\S]*?scheduleTrajectoryValidationWarmup\(\)/);
  assert.doesNotMatch(
    run,
    /db\.warmPrecloseForecastValidation\s*\(/,
    'the legacy synchronous full-table warm-up may not be scheduled as one task',
  );

  const warming = run.indexOf("trajectoryValidation: 'warming'");
  const awaited = run.indexOf('await db.warmPrecloseForecastValidationIncrementally');
  const ready = run.indexOf("trajectoryValidation: 'ready'");
  assert.ok(warming >= 0 && awaited > warming && ready > awaited);

  const availability = functionBody('trajectoryValidationIsWarming');
  assert.match(
    availability,
    /startupState\.trajectoryValidation\s*!==\s*'ready'/,
    'a failed warm-up must remain fail-closed while its retry is pending',
  );
});

test('database warm-up bounds synchronous work and yields between batches', () => {
  const start = database.indexOf('async warmPrecloseForecastValidationIncrementally(');
  const end = database.indexOf('\n  getPredictiveLeaderReadState(', start);
  assert.ok(start >= 0 && end > start, 'incremental database warm-up must exist');
  const incrementalWarmup = database.slice(start, end);

  assert.match(incrementalWarmup, /batchSize\s*=\s*\d+/);
  assert.match(incrementalWarmup, /LIMIT \?/);
  assert.match(incrementalWarmup, /while\s*\(/);
  assert.match(incrementalWarmup, /await\s+yieldControl\s*\(\s*\)/);
  assert.match(incrementalWarmup, /setImmediate/);
  assert.doesNotMatch(
    incrementalWarmup,
    /COALESCE\s*\(\s*SUM\s*\(/,
    'incremental warm-up must not validate the full history in one aggregate query',
  );
  assert.doesNotMatch(
    incrementalWarmup,
    /WarmupActive|WarmupComputing/,
    'the deterministic validator may not change answers between yielded batches',
  );
});

test('forecast persistence remains enabled while read-side history warming is in progress', () => {
  const start = server.indexOf("collector.on('preclose-forecast'");
  const end = server.indexOf("collector.on('round'", start);
  const handler = server.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(handler, /db\.recordPrecloseForecast\s*\(/);
  assert.doesNotMatch(
    handler,
    /trajectoryValidationIsWarming\s*\(\)[\s\S]*?return/,
    'a valid pre-close forecast must not be dropped during background warming',
  );

  const buildStart = database.indexOf('const learningCandidateStatement = this.sqlite.prepare(');
  const buildEnd = database.indexOf('const learningRows = [];', buildStart);
  const learningRead = database.slice(buildStart, buildEnd);
  assert.ok(buildStart >= 0 && buildEnd > buildStart);
  assert.match(database, /const TRAJECTORY_SHADOW_LEARNING_CANDIDATE_LIMIT = 1_000;/);
  assert.match(learningRead, /LIMIT \?/);
  assert.match(learningRead, /TRAJECTORY_SHADOW_LEARNING_CANDIDATE_LIMIT/);
  assert.doesNotMatch(learningRead, /OFFSET|while\s*\(/);
  assert.match(learningRead, /#validAdaptiveTrajectorySnapshotSql\s*\(/);
  assert.doesNotMatch(
    learningRead,
    /trajectory_adaptive_snapshot_valid_v2\s*\(/,
    'forecast learning must validate bounded recent batches instead of scanning all cold rows in SQL',
  );
});

test('warming keeps liveness up while heavy state reads fail closed with retry metadata', () => {
  const warmingResponse = functionBody('sendStartupWarming');
  assert.match(warmingResponse, /503/);
  assert.match(warmingResponse, /startup_warming/);
  assert.match(warmingResponse, /['"]Retry-After['"]/);

  const stateRoute = routeBody('/api/state', '/api/results');
  assert.match(stateRoute, /trajectoryValidationIsWarming\s*\(\s*\)/);
  assert.match(stateRoute, /sendStartupWarming\s*\(\s*response\s*\)/);
  assert.match(stateRoute, /sendJson\s*\(\s*response,\s*200,\s*dashboardState\s*\(\s*\)/);

  const forecastsRoute = routeBody('/api/forecasts', '/api/predictive-leader');
  assert.match(forecastsRoute, /trajectoryValidationIsWarming\s*\(\s*\)/);
  assert.match(forecastsRoute, /sendStartupWarming\s*\(\s*response\s*\)/);
  assert.match(forecastsRoute, /precloseForecastStateFromDatabase\s*\(\s*\)/);

  const liveRoute = routeBody('/api/live', '/api/health');
  assert.match(liveRoute, /sendJson\s*\(\s*response,\s*200,/);
  assert.match(liveRoute, /startup/);
  assert.doesNotMatch(liveRoute, /startup_warming|sendStartupWarming|503/);
});

test('predictive leader stays HTTP-readable but cannot expose a number while warming', () => {
  const predictiveRoute = routeBody('/api/predictive-leader', '/api/forecasts/hits');
  assert.match(predictiveRoute, /sendJson\s*\(\s*response,\s*200,/);
  assert.match(predictiveRoute, /trajectoryValidationIsWarming\(\)/);
  assert.match(predictiveRoute, /predictiveLeaderForApi\(\)/);
  assert.match(
    predictiveRoute,
    /predictiveLeaderSnapshotForApi\s*\(\s*\{[\s\S]*?state\s*:\s*null/,
    'pending/warming startup must use the API constructor\'s state_unavailable snapshot',
  );

  const unavailable = predictiveLeaderSnapshotForApi({
    state: null,
    source: 'buleto',
    instrument: 'XPM/RUB',
    now: '2026-10-15T00:00:00.000Z',
  });
  assert.equal(unavailable.status, 'waiting');
  assert.equal(unavailable.reason, 'state_unavailable');
  assert.equal(unavailable.number, null);
});
