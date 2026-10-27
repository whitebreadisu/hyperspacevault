// Parser + verdict tests for health_check.mjs (no network). Run: node --test .github/scripts/health_check.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findAppChunk,
  extractVersion,
  count5xx,
  decide,
  formatLines,
  PLATFORM_BURST,
} from "./health_check.mjs";

const HTML = `<!doctype html><html><head>
<script type="module" crossorigin src="/assets/main-DOiYxr99.js"></script>
<link rel="modulepreload" crossorigin href="/assets/vendor-AAAA.js">
<link rel="modulepreload" crossorigin href="/assets/App-CNauIlCl.js">
</head><body></body></html>`;

// Shape of the minified chunk as served on 2026-10-27 (backtick literals), two entries newest first.
const CHUNK =
  "X_.register({app_version:`2.1.1`}),pv();var RE=[{kind:`release`,key:`2.1.1`,version:`2.1.1`," +
  "date:`2026-10-25`,title:`Low prices that make sense`,sections:[]},{kind:`release`,key:`2.1`," +
  "version:`2.1`,date:`2026-10-19`,title:`Older`,sections:[]}]";

test("findAppChunk picks the App modulepreload, not the first preload", () => {
  assert.equal(findAppChunk(HTML), "/assets/App-CNauIlCl.js");
});

test("findAppChunk falls back to the module entry script", () => {
  assert.equal(
    findAppChunk('<script type="module" src="/assets/main-X.js"></script>'),
    "/assets/main-X.js"
  );
  assert.equal(findAppChunk("<html></html>"), null);
});

test("extractVersion reads the newest release entry and app_version", () => {
  assert.deepEqual(extractVersion(CHUNK), {
    version: "2.1.1",
    date: "2026-10-25",
    title: "Low prices that make sense",
    appVersion: "2.1.1",
  });
});

test("extractVersion handles double quotes and an apostrophe in the title", () => {
  const js = `{kind:"release",key:"2.2",version:"2.2",date:"2026-11-01",title:"You'll like this"}`;
  const v = extractVersion(js);
  assert.equal(v.version, "2.2");
  assert.equal(v.title, "You'll like this");
  assert.equal(v.appVersion, null);
});

test("extractVersion falls back to app_version, and returns null with no marker", () => {
  assert.deepEqual(extractVersion("register({app_version:'2.0.1'})"), {
    version: "2.0.1",
    date: null,
    title: null,
    appVersion: "2.0.1",
  });
  assert.equal(extractVersion("var a=1"), null);
});

const LOGS = [
  {
    httpRequest: { status: 500, requestUrl: "https://backend-x.a.run.app/images/cards/a.webp" },
    textPayload:
      "The request was aborted because there was no available instance. Additional troubleshooting ...",
  },
  {
    httpRequest: { status: 503, requestUrl: "https://backend-x.a.run.app/api/sets" },
    textPayload: "The request was aborted because there was no available instance.",
  },
  { httpRequest: { status: 500, requestUrl: "https://backend-x.a.run.app/api/inventory?x=1" } },
  { httpRequest: { status: 500, requestUrl: "https://backend-x.a.run.app/api/inventory" } },
  { httpRequest: { status: 502, requestUrl: "https://backend-x.a.run.app/api/me" } },
  { httpRequest: { status: 404, requestUrl: "https://backend-x.a.run.app/nope" } },
];

test("count5xx splits platform aborts from app errors and finds the top app path", () => {
  const c = count5xx(LOGS);
  assert.equal(c.total, 5);
  assert.equal(c.platform, 2);
  assert.equal(c.app, 3);
  assert.deepEqual(c.topApp, ["500 /api/inventory", 2]);
  assert.deepEqual(count5xx([]), { total: 0, platform: 0, app: 0, topApp: null });
});

const GOOD = {
  smoke: { ok: true, status: 200, ms: 120, sets: 12 },
  version: { version: "2.1.1", title: "T", date: "2026-10-25", source: "App-X.js" },
  fivexx: { available: true, total: 3, platform: 3, app: 0, topApp: null, project: "swu-prod" },
  posthog: { available: true, events: 900, browsers: 40, exceptions: 1 },
};

test("decide: all healthy -> ok, exit 0; platform noise below the burst line is not flagged", () => {
  assert.deepEqual(decide(GOOD), { verdict: "ok", issues: [], exitCode: 0 });
});

test("decide: smoke failure is the only exit-1 case", () => {
  const d = decide({ ...GOOD, smoke: { ok: false, error: "HTTP 503" } });
  assert.equal(d.exitCode, 1);
  assert.equal(d.verdict, "check smoke");
  const d2 = decide({ ...GOOD, posthog: { available: false, error: "no key" } });
  assert.equal(d2.exitCode, 0);
  assert.equal(d2.verdict, "check posthog (unavailable)");
});

test("decide: app 5xx, platform burst, version mismatch, unavailable gcloud, zero events", () => {
  assert.equal(
    decide({ ...GOOD, fivexx: { ...GOOD.fivexx, app: 2 } }).verdict,
    "check 5xx (app 2)"
  );
  assert.equal(
    decide({ ...GOOD, fivexx: { ...GOOD.fivexx, platform: PLATFORM_BURST } }).verdict,
    `check 5xx (platform burst ${PLATFORM_BURST})`
  );
  assert.equal(decide(GOOD, "2.2").verdict, "check version (expected 2.2, served 2.1.1)");
  assert.equal(
    decide({ ...GOOD, fivexx: { available: false, error: "gcloud not found" } }).verdict,
    "check 5xx (unavailable)"
  );
  assert.equal(
    decide({ ...GOOD, posthog: { ...GOOD.posthog, events: 0 } }).verdict,
    "check posthog (no events)"
  );
});

test("formatLines prints the five labelled lines in order, ASCII only", () => {
  const lines = formatLines(
    { ...GOOD, prodCurrent: "a3da607b20df780b8847dff788392f9efc98d285" },
    decide(GOOD)
  );
  assert.deepEqual(
    lines.map((l) => l.split(":")[0]),
    ["version", "smoke", "5xx", "posthog", "verdict"]
  );
  assert.match(
    lines[0],
    /^version: 2\.1\.1 "T" \(2026-10-25\) \[App-X\.js\] prod-current a3da607$/
  );
  for (const l of lines) assert.match(l, /^[\x20-\x7e]*$/);
});
