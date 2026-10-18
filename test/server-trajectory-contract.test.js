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

test('current-cell capture carries the scheduled close through the database boundary', () => {
  const metadataQueueStart = server.indexOf(
    'const metadataConflictRetryQueue = createCurrentCellMetadataConflictRetryQueue',
  );
  const schedulerStart = server.indexOf(
    'const currentCellHorizonScheduler = createCurrentCellHorizonScheduler',
  );
  const permanentErrorStart = server.indexOf(
    'function isPermanentRoundTrajectoryError',
    schedulerStart,
  );
  assert.ok(
    metadataQueueStart >= 0
      && schedulerStart > metadataQueueStart
      && permanentErrorStart > schedulerStart,
  );
  const metadataQueue = server.slice(metadataQueueStart, schedulerStart);
  const scheduler = server.slice(schedulerStart, permanentErrorStart);
  assert.match(metadataQueue, /createCurrentCellMetadataConflictRetryQueue\(\{/);
  assert.match(metadataQueue, /maxPending: MAX_PENDING_METADATA_CONFLICTS/);
  assert.match(
    metadataQueue,
    /persist\(conflict\)[\s\S]*db\.recordCurrentCellHorizonMetadataConflict\(/,
  );
  assert.match(metadataQueue, /isTransientError: isTransientSqliteLock/);
  assert.match(
    metadataQueue,
    /onDatabaseChanged\(\)[\s\S]*broadcastUpdate\('predictive-shadow-metadata-conflict'\)/,
  );
  assert.match(
    scheduler,
    /if \(!metadataConflictRetryQueue\.drain\(\)\) return \{ reason: 'transient' \};/,
  );
  assert.match(
    scheduler,
    /db\.recordCurrentCellHorizonShadow\(\s*attempt\.source,\s*attempt\.instrument,\s*attempt\.externalRoundId,\s*attempt\.bettingClosesAt,\s*\)/,
  );
  assert.match(scheduler, /outcome\.reason === 'metadata_conflict'/);
  assert.match(scheduler, /outcome\.databaseChanged/);
  assert.match(
    server,
    /error\?\.code === 'ERR_SQLITE_ERROR'[\s\S]*error\.errcode === 5[\s\S]*error\.errcode === 6/,
  );
  assert.match(scheduler, /isTransientSqliteLock\(error\)/);

  const roundListener = server.slice(server.indexOf("collector.on('round',"));
  assert.match(roundListener, /scheduleOutcome\.status === 'metadata_conflict'/);
  assert.match(
    roundListener,
    /metadataConflictRetryQueue\.enqueue\(\{[\s\S]*originalBettingClosesAt: scheduleOutcome\.originalBettingClosesAt,[\s\S]*observedBettingClosesAt: scheduleOutcome\.observedBettingClosesAt/,
  );
});

test('shutdown cancels trajectory backoff and joins the final FIFO drain', () => {
  const shutdown = server.slice(server.indexOf('function shutdown(signal)'));
  assert.match(shutdown, /metadataConflictRetryQueue\.cancelRetry\(\);/);
  assert.match(shutdown, /clearTimeout\(roundTrajectoryRetryTimer\);/);
  assert.match(
    shutdown,
    /const metadataConflictsPersisted = metadataConflictRetryQueue\.drain\(\{ retry: false \}\);/,
  );
  assert.match(
    shutdown,
    /const trajectoriesPersisted = drainRoundTrajectoryQueue\(\{ retry: false \}\);/,
  );
  assert.match(
    shutdown,
    /metadataConflictsPersisted[\s\S]*&& trajectoriesPersisted[\s\S]*&& pending\.results === 0[\s\S]*&& pending\.gaps === 0/,
  );
});
