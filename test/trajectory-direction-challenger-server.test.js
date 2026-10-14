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

test('trajectory direction challenger API read is scoped, cached, and read-only', () => {
  const helperSource = functionSource('trajectoryDirectionChallengerForApi');
  const cache = new Map();
  const cacheKeys = [];
  let databaseReads = 0;
  const cachedDatabaseRead = (key, read) => {
    cacheKeys.push(key);
    if (!cache.has(key)) cache.set(key, read());
    return cache.get(key);
  };
  const db = new Proxy(
    {
      getTrajectoryDirectionChallengerState(source, instrument) {
        databaseReads += 1;
        assert.equal(source, 'buleto');
        assert.equal(instrument, 'EURUSD');
        return { mode: 'prospective-shadow', advisoryOnly: true };
      },
    },
    {
      get(target, property, receiver) {
        if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
        throw new Error(`unexpected database access: ${String(property)}`);
      },
    },
  );
  class FixedDate {
    toISOString() {
      return '2026-10-14T12:00:00.000Z';
    }
  }
  const build = new Function(
    'cachedDatabaseRead',
    'db',
    'config',
    'Date',
    `${helperSource}; return trajectoryDirectionChallengerForApi;`,
  );
  const read = build(cachedDatabaseRead, db, { instrument: 'EURUSD' }, FixedDate);

  const first = read();
  const second = read();

  assert.equal(databaseReads, 1, 'repeated GET payload builds must reuse the DB snapshot');
  assert.deepEqual(cacheKeys, [
    'trajectory-direction-challenger-state:buleto:EURUSD',
    'trajectory-direction-challenger-state:buleto:EURUSD',
  ]);
  assert.deepEqual(first, {
    mode: 'prospective-shadow',
    advisoryOnly: true,
    serverTime: '2026-10-14T12:00:00.000Z',
  });
  assert.deepEqual(second, first);
});

test('trajectory direction challenger route returns JSON through no-store response helper', () => {
  const routeStart = server.indexOf(
    "if (pathname === '/api/trajectory-direction/challenger')",
  );
  assert.ok(routeStart >= 0, 'challenger route must exist');
  const route = server.slice(routeStart, server.indexOf('\n    }', routeStart) + 6);
  assert.match(route, /sendJson\(response, 200, trajectoryDirectionChallengerForApi\(\)\);/);
  assert.match(route, /return;/);
  assert.doesNotMatch(route, /db\./);

  const sendJson = functionSource('sendJson');
  assert.match(sendJson, /'Cache-Control': 'no-store'/);
});
