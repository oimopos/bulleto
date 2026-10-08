import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

test('server keeps round trajectories in a bounded ordered retry queue', () => {
  assert.match(server, /const MAX_PENDING_ROUND_TRAJECTORIES = 4_096;/);
  assert.match(server, /const MAX_ROUND_TRAJECTORY_RETRIES = 8;/);
  assert.match(server, /const pendingRoundTrajectories = \[\];/);

  const drainStart = server.indexOf('function drainRoundTrajectoryQueue');
  const enqueueStart = server.indexOf('function enqueueRoundTrajectory');
  assert.ok(drainStart >= 0 && enqueueStart > drainStart);
  const drain = server.slice(drainStart, enqueueStart);
  assert.match(drain, /const pending = pendingRoundTrajectories\[0\];/);
  assert.match(drain, /db\.recordRoundTrajectory\(pending\.trajectory\);/);
  assert.match(drain, /pending\.failureCount \+= 1;/);
  assert.match(drain, /persistenceError = error;\s+break;/);
  assert.match(drain, /scheduleRoundTrajectoryRetry\(\);/);
  assert.ok(
    drain.indexOf('db.recordRoundTrajectory(pending.trajectory)') <
      drain.lastIndexOf('pendingRoundTrajectories.shift()'),
    'the FIFO head is removed only after persistence or an explicit bounded poison policy',
  );
});

test('trajectory listener is wired before primary forecast without gating it', () => {
  const trajectoryListener = server.indexOf("collector.on('round-trajectory'");
  const forecastListener = server.indexOf("collector.on('preclose-forecast'");
  const roundListener = server.indexOf("collector.on('round',", forecastListener);
  assert.ok(trajectoryListener >= 0 && forecastListener > trajectoryListener);
  assert.match(
    server.slice(trajectoryListener, forecastListener),
    /enqueueRoundTrajectory\(trajectory\);/,
  );

  const forecastHandler = server.slice(forecastListener, roundListener);
  assert.match(forecastHandler, /db\.recordPrecloseForecast\(/);
  assert.doesNotMatch(forecastHandler, /pendingRoundTrajectories|roundTrajectoryRetry/);
  assert.doesNotMatch(forecastHandler, /same-frame trajectory|trajectory is not persisted/);
});

test('shutdown cancels trajectory backoff and joins the final FIFO drain', () => {
  const shutdown = server.slice(server.indexOf('function shutdown(signal)'));
  assert.match(shutdown, /clearTimeout\(roundTrajectoryRetryTimer\);/);
  assert.match(
    shutdown,
    /const trajectoriesPersisted = drainRoundTrajectoryQueue\(\{ retry: false \}\);/,
  );
  assert.match(
    shutdown,
    /if \(trajectoriesPersisted && pending\.results === 0 && pending\.gaps === 0\)/,
  );
});
