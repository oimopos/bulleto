import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

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
