import {
  constants as fsConstants,
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  statSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BuletoCollector } from './collector.js';
import { createDatabase } from './database.js';
import { ResultPipeline } from './result-pipeline.js';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = resolve(ROOT_DIR, 'public');

function integerEnv(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} должен быть целым числом от ${min} до ${max}`);
  }
  return value;
}

function booleanEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  throw new Error(`${name} должен быть true или false`);
}

const config = {
  host: process.env.HOST || '0.0.0.0',
  port: integerEnv('PORT', 8787, { min: 1, max: 65_535 }),
  databasePath:
    process.env.DATABASE_PATH === ':memory:'
      ? ':memory:'
      : resolve(ROOT_DIR, process.env.DATABASE_PATH || './data/buleto.sqlite'),
  databaseSeedPath:
    process.env.DATABASE_SEED_PATH
      ? resolve(ROOT_DIR, process.env.DATABASE_SEED_PATH)
      : null,
  wsUrl: process.env.BULETO_WS_URL || 'wss://buleto.com/ws',
  instrument: process.env.BULETO_INSTRUMENT || 'XPM/RUB',
  collectorEnabled: booleanEnv('COLLECTOR_ENABLED', true),
  gapThresholdSeconds: integerEnv('GAP_THRESHOLD_SECONDS', 135, { min: 30, max: 86_400 }),
  reconnectMinMs: integerEnv('RECONNECT_MIN_MS', 1_000, { min: 100, max: 60_000 }),
  reconnectMaxMs: integerEnv('RECONNECT_MAX_MS', 30_000, { min: 1_000, max: 600_000 }),
  staleAfterMs: integerEnv('STALE_AFTER_MS', 180_000, { min: 30_000, max: 3_600_000 }),
  virtualStartingBalance: integerEnv('VIRTUAL_STARTING_BALANCE', 87_700, {
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
  }),
};

if (config.reconnectMaxMs < config.reconnectMinMs) {
  throw new Error('RECONNECT_MAX_MS не может быть меньше RECONNECT_MIN_MS');
}

if (config.databasePath !== ':memory:') {
  mkdirSync(dirname(config.databasePath), { recursive: true });
  if (
    config.databaseSeedPath !== null &&
    existsSync(config.databaseSeedPath) &&
    !existsSync(config.databasePath)
  ) {
    try {
      copyFileSync(
        config.databaseSeedPath,
        config.databasePath,
        fsConstants.COPYFILE_EXCL,
      );
    } catch (error) {
      // Another process may have initialized the persistent disk after the
      // existence check. Never replace that database with the seed.
      if (error?.code !== 'EEXIST') throw error;
    }
  }
}

const db = createDatabase({
  path: config.databasePath,
  logger: console,
  gapThresholdSeconds: config.gapThresholdSeconds,
  virtualStartingBalance: config.virtualStartingBalance,
});
const collector = new BuletoCollector({
  url: config.wsUrl,
  instrument: config.instrument,
  reconnectMinMs: config.reconnectMinMs,
  reconnectMaxMs: config.reconnectMaxMs,
  staleAfterMs: config.staleAfterMs,
  logger: console,
});
const resultPipeline = new ResultPipeline({
  db,
  source: 'buleto',
  instrument: config.instrument,
  gapThresholdSeconds: config.gapThresholdSeconds,
  logger: console,
});

// The paper bettor only records a simulation in this local database. It has
// no credentials, browser automation, payment access, or Buleto write calls.
db.initializeVirtualBettor('buleto', config.instrument);

const sseClients = new Set();

function securityHeaders(extra = {}) {
  return {
    'Content-Security-Policy':
      "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...extra,
  };
}

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(
    statusCode,
    securityHeaders({
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
    }),
  );
  response.end(payload);
}

function broadcastUpdate(reason) {
  const chunk = `event: update\ndata: ${JSON.stringify({ reason, at: new Date().toISOString() })}\n\n`;
  for (const response of sseClients) {
    try {
      response.write(chunk);
    } catch {
      sseClients.delete(response);
    }
  }
}

function openEventStream(request, response) {
  response.writeHead(
    200,
    securityHeaders({
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    }),
  );
  response.write(`retry: 3000\nevent: update\ndata: ${JSON.stringify({ reason: 'connected' })}\n\n`);
  sseClients.add(response);

  const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 25_000);
  heartbeat.unref?.();

  request.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(response);
  });
}

function resultForApi(result) {
  if (!result) return null;
  return {
    ...result,
    number: result.number ?? result.resultNumber ?? null,
    roundId: result.roundId ?? result.externalRoundId ?? null,
    wasNew: result.wasNew ?? result.eliminated ?? null,
    remainingAfter: result.remainingAfter ?? result.remainingCount ?? null,
  };
}

function cycleForApi(cycle) {
  if (!cycle) return null;
  const integrityStatus =
    cycle.integrityStatus ?? (cycle.status === 'invalid_gap' ? 'gap' : 'ok');
  return {
    ...cycle,
    totalDraws: cycle.totalDraws ?? cycle.eventCount ?? 0,
    uniqueCount: cycle.uniqueCount ?? cycle.eliminatedCount ?? 0,
    integrityStatus,
    origin: cycle.origin ?? 'stream',
  };
}

function databaseStateForApi() {
  const state = db.getDashboardState();
  const totals = state.stats ?? state.totals ?? {};
  const incidents = state.warnings ?? state.recentIncidents ?? [];
  const latestCompletedCycle = cycleForApi(state.latestCompletedCycle);
  const latestCycle = cycleForApi(state.latestCycle);
  return {
    ...state,
    // После определения survivor цикл уже terminal. До следующего результата
    // продолжаем показывать его на главном поле, а не пустые 37 клеток.
    activeCycle:
      cycleForApi(state.activeCycle) ??
      (latestCycle?.status === 'completed' ? latestCycle : null),
    activeCycles: (state.activeCycles ?? []).map(cycleForApi),
    latestCycle,
    latestCompletedCycle,
    latestResult: resultForApi(state.latestResult),
    numberStats: db.getNumberStats('buleto', config.instrument),
    virtualBettor: db.getVirtualBettorState('buleto', config.instrument),
    stats: {
      totalResults: totals.totalResults ?? totals.results ?? 0,
      completedCycles: totals.completedCycles ?? 0,
      totalCycles: totals.totalCycles ?? totals.cycles ?? 0,
      incidents: totals.incidents ?? 0,
    },
    warnings: incidents.map((incident) => ({
      ...incident,
      type: incident.type ?? incident.kind ?? 'warning',
      occurredAt: incident.occurredAt ?? incident.detectedAt ?? incident.createdAt ?? null,
    })),
  };
}

function dashboardState() {
  return {
    ...databaseStateForApi(),
    collector: collector.getStatus(),
    serverTime: new Date().toISOString(),
  };
}

function clampLimit(rawValue, fallback, max) {
  if (rawValue === null || rawValue === '') return fallback;
  const value = Number(rawValue);
  return Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback;
}

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webmanifest', 'application/manifest+json'],
]);

function serveStatic(request, response, pathname) {
  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname === '/' ? 'index.html' : pathname.slice(1));
  } catch {
    sendJson(response, 400, { error: 'Некорректный URL' });
    return;
  }

  const filePath = resolve(PUBLIC_DIR, relativePath);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${sep}`)) {
    sendJson(response, 403, { error: 'Доступ запрещён' });
    return;
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    sendJson(response, 404, { error: 'Не найдено' });
    return;
  }

  const contentType = mimeTypes.get(extname(filePath).toLowerCase()) || 'application/octet-stream';
  const headers = securityHeaders({
    'Cache-Control': relativePath === 'index.html' ? 'no-cache' : 'public, max-age=300',
    'Content-Type': contentType,
    'Content-Length': statSync(filePath).size,
  });
  response.writeHead(200, headers);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}

const server = createServer((request, response) => {
  try {
    if (!request.url) {
      sendJson(response, 400, { error: 'Пустой URL' });
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const { pathname } = url;

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { error: 'Метод не разрешён' });
      return;
    }

    if (pathname === '/api/events') {
      if (request.method === 'HEAD') {
        response.writeHead(200, securityHeaders({ 'Content-Type': 'text/event-stream' }));
        response.end();
        return;
      }
      openEventStream(request, response);
      return;
    }

    if (pathname === '/api/state') {
      sendJson(response, 200, dashboardState());
      return;
    }

    if (pathname === '/api/results') {
      const limit = clampLimit(url.searchParams.get('limit'), 80, 1_000);
      sendJson(response, 200, { items: db.getRecentResults(limit).map(resultForApi) });
      return;
    }

    if (pathname === '/api/pairs') {
      const source = 'buleto';
      const instrument = config.instrument;
      const items = db.getPairStats(source, instrument);
      const totalResults = db
        .getNumberStats(source, instrument)
        .reduce((total, item) => total + item.occurrenceCount, 0);
      const totalPairOccurrences = items.reduce(
        (total, item) => total + item.occurrenceCount,
        0,
      );
      sendJson(response, 200, {
        length: 2,
        ordered: true,
        source,
        instrument,
        totalResults,
        totalPairOccurrences,
        distinctPairCount: items.length,
        continuitySegmentCount: totalResults - totalPairOccurrences,
        hasMore: false,
        items,
      });
      return;
    }

    if (pathname === '/api/cycles') {
      const limit = clampLimit(url.searchParams.get('limit'), 10, 100);
      sendJson(response, 200, { items: db.getCompletedCycles(limit).map(cycleForApi) });
      return;
    }

    if (pathname === '/api/sequences') {
      const limit = clampLimit(url.searchParams.get('limit'), 50, 100);
      const matches = db.getRepeatedTriples('buleto', config.instrument, limit + 1);
      sendJson(response, 200, {
        length: 3,
        items: matches.slice(0, limit),
        hasMore: matches.length > limit,
      });
      return;
    }

    if (pathname === '/api/virtual-bettor/sessions') {
      const limit = clampLimit(url.searchParams.get('limit'), 20, 100);
      sendJson(response, 200, {
        mode: 'simulation',
        executionEnabled: false,
        items: db.getVirtualBetSessions('buleto', config.instrument, limit),
      });
      return;
    }

    if (pathname === '/api/live') {
      sendJson(response, 200, {
        ok: true,
        database: 'ready',
        time: new Date().toISOString(),
      });
      return;
    }

    if (pathname === '/api/health') {
      const collectorStatus = collector.getStatus();
      const resultAgeMs = collectorStatus.lastResultAt
        ? Date.now() - new Date(collectorStatus.lastResultAt).getTime()
        : null;
      const resultFresh =
        resultAgeMs !== null && Number.isFinite(resultAgeMs) && resultAgeMs <= config.staleAfterMs;
      const healthOk =
        !config.collectorEnabled ||
        (collectorStatus.connected === true && resultFresh);
      sendJson(response, healthOk ? 200 : 503, {
        ok: healthOk,
        collector: collectorStatus.status,
        resultFresh: config.collectorEnabled ? resultFresh : null,
        lastResultAt: collectorStatus.lastResultAt,
        database: 'ready',
        time: new Date().toISOString(),
      });
      return;
    }

    if (pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: 'API-метод не найден' });
      return;
    }

    serveStatic(request, response, pathname);
  } catch (error) {
    console.error('[http] request failed', error);
    if (!response.headersSent) {
      sendJson(response, 500, { error: 'Внутренняя ошибка сервера' });
    } else {
      response.destroy();
    }
  }
});

let pipelineRetryTimer = null;
let pipelineFlushTimer = null;
let pipelineRetryAttempt = 0;

function publishPipelineOutcome(outcome) {
  if (!outcome) return;
  if (outcome.inserted > 0) {
    console.info(`[collector] saved ${outcome.inserted} new result(s)`);
  }
  if (outcome.gaps > 0) broadcastUpdate('gap');
  if (outcome.changed) broadcastUpdate('results');
}

function schedulePipelineRetry(error) {
  console.error('[collector] persistence failed; data retained for retry', error);
  if (pipelineRetryTimer || shuttingDown) return;
  pipelineRetryAttempt += 1;
  const delay = Math.min(30_000, 1_000 * 2 ** Math.min(pipelineRetryAttempt - 1, 5));
  pipelineRetryTimer = setTimeout(() => {
    pipelineRetryTimer = null;
    try {
      const outcome = resultPipeline.drain();
      pipelineRetryAttempt = 0;
      publishPipelineOutcome(outcome);
    } catch (retryError) {
      schedulePipelineRetry(retryError);
    }
  }, delay);
  pipelineRetryTimer.unref?.();
}

function schedulePipelineFlush() {
  if (pipelineFlushTimer || shuttingDown) return;
  pipelineFlushTimer = setTimeout(() => {
    pipelineFlushTimer = null;
    try {
      const outcome = resultPipeline.drain();
      pipelineRetryAttempt = 0;
      publishPipelineOutcome(outcome);
    } catch (error) {
      schedulePipelineRetry(error);
    }
  }, 0);
  pipelineFlushTimer.unref?.();
}

collector.on('results', (results) => {
  clearTimeout(pipelineFlushTimer);
  pipelineFlushTimer = null;
  try {
    const outcome = resultPipeline.ingest(results);
    pipelineRetryAttempt = 0;
    publishPipelineOutcome(outcome);
  } catch (error) {
    schedulePipelineRetry(error);
  }
});

collector.on('status', () => broadcastUpdate('collector-status'));
collector.on('collector-error', (error) => {
  console.error('[collector]', error);
  broadcastUpdate('collector-error');
});
collector.on('integrity-gap', (details) => {
  try {
    resultPipeline.enqueueIntegrityGap(details);
    schedulePipelineFlush();
  } catch (error) {
    schedulePipelineRetry(error);
  }
});

server.listen(config.port, config.host, () => {
  console.info(`[server] dashboard: http://${config.host}:${config.port}`);
  console.info(`[server] database: ${config.databasePath}`);
  if (config.collectorEnabled) collector.start();
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[server] ${signal}: shutting down`);
  try {
    collector.flushPendingForShutdown();
  } catch (error) {
    console.error('[collector] failed to expose pending shutdown results', error);
  }
  collector.stop();
  clearTimeout(pipelineFlushTimer);
  pipelineFlushTimer = null;
  clearTimeout(pipelineRetryTimer);
  pipelineRetryTimer = null;
  for (const response of sseClients) response.end();
  sseClients.clear();

  const persistenceDeadline = Date.now() + 8_000;
  let persistenceRetryTimer = null;
  let forceExitTimer = null;

  const finish = (exitCode) => {
    clearTimeout(persistenceRetryTimer);
    clearTimeout(forceExitTimer);
    try {
      db.close();
    } catch (error) {
      console.error('[server] failed to close database', error);
      exitCode = 1;
    }
    process.exit(exitCode);
  };

  const drainAndExit = () => {
    try {
      publishPipelineOutcome(resultPipeline.drain());
      const pending = resultPipeline.getPendingCounts();
      if (pending.results === 0 && pending.gaps === 0) {
        finish(0);
        return;
      }
    } catch (error) {
      console.error('[collector] final persistence drain failed', error);
    }

    if (Date.now() >= persistenceDeadline) {
      console.error('[server] shutdown persistence deadline exceeded');
      finish(1);
      return;
    }
    persistenceRetryTimer = setTimeout(drainAndExit, 250);
  };

  server.close(() => {
    drainAndExit();
  });

  forceExitTimer = setTimeout(() => finish(1), 12_000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
