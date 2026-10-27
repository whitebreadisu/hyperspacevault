// Prod health check (BL-279 WS-2, W2-10; scheduled by W2-15(a)). Dependency-free, Node >= 20.
//
//   node .github/scripts/health_check.mjs [--json] [--expect <version>] [--base <url>]
//
// Prints exactly five labelled lines:
//   version:  the release served by prod (newest release-notes entry in the App chunk that
//             index.html modulepreloads; the notes title is the marker) + the prod-current tag
//   smoke:    GET <base>/api/sets -> HTTP status, latency, set count (the promote smoke route;
//             /api/health does not exist publicly)
//   5xx:      Cloud Run request-log 5xx count, last 24 h, split platform noise ("no available
//             instance" aborts) vs app errors
//   posthog:  events / browsers / $exception events in the last 24 h (HogQL)
//   verdict:  ok | check <what>[, <what>]
// Exit 0 unless the smoke check fails (exit 1). Every source except smoke degrades to
// "unavailable (<why>)" and the run continues.
//
// Environment (no interactive auth anywhere):
//   gcloud on PATH, authenticated with logging read on swu-prod (locally: the owner's login;
//     in Actions: google-github-actions/auth (WIF) + setup-gcloud before this step).
//     HEALTH_GCP_PROJECT overrides the project (default swu-prod).
//   gh on PATH with GH_TOKEN (Actions: github.token) for the prod-current tag; optional.
//   POSTHOG_PERSONAL_API_KEY (read-only personal key) - absent -> "posthog: unavailable (no key)".
//   POSTHOG_PROJECT_ID (default "@current"), POSTHOG_HOST (default https://us.posthog.com).

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const DEFAULT_BASE = "https://www.hyperspacevault.com";
export const REPO = "whitebreadisu/hyperspacevault";
export const PLATFORM_MARKER = "no available instance";
// A burst of platform aborts this large is flagged even though it is not an app error.
export const PLATFORM_BURST = 25;
const LOG_LIMIT = 1000;

// ---------- parsers (pure; covered by health_check.test.mjs) ----------

// index.html -> the App chunk path (modulepreload of /assets/App-*.js; falls back to the entry script).
export function findAppChunk(html) {
  const links = [...html.matchAll(/<link\b[^>]*rel=["']?modulepreload["']?[^>]*>/gi)].map(
    (m) => m[0]
  );
  for (const l of links) {
    const href = l.match(/href=["']?([^"' >]+)/i)?.[1];
    if (href && /\/App-[^/]*\.js$/.test(href)) return href;
  }
  const script = html.match(/<script\b[^>]*type=["']?module["']?[^>]*src=["']?([^"' >]+)/i);
  return script ? script[1] : null;
}

// App chunk -> newest release entry ({ version, date, title }) + the analytics app_version.
// The minifier may emit backticks, double or single quotes; the first release entry is the newest
// (releaseNotes.ts is newest first and the bundle preserves array order).
export function extractVersion(js) {
  const m = js.match(/kind:([`"'])release\1,/);
  const fields = {};
  if (m) {
    let i = m.index + m[0].length;
    for (const k of ["key", "version", "date", "title"]) {
      const lit = readLiteral(js, i, `${k}:`);
      if (!lit) break;
      fields[k] = lit.value;
      i = lit.end + 1; // skip the comma
    }
  }
  const av = js.match(/app_version:([`"'])([^`"']+)\1/);
  const version = fields.version ?? (av ? av[2] : null);
  if (!version) return null;
  return {
    version,
    date: fields.date ?? null,
    title: fields.title ?? null,
    appVersion: av ? av[2] : null,
  };
}

// js[i..] must be `<label><quote>...<quote>`; returns { value, end } (end = index after the closing quote).
function readLiteral(js, i, label) {
  if (!js.startsWith(label, i)) return null;
  const q = js[i + label.length];
  if (!"`\"'".includes(q)) return null;
  let j = i + label.length + 1;
  let value = "";
  while (j < js.length && js[j] !== q) {
    if (js[j] === "\\") j += 1;
    value += js[j];
    j += 1;
  }
  return j < js.length ? { value, end: j + 1 } : null;
}

// gcloud logging read --format=json output -> { total, platform, app, topApp }
export function count5xx(entries) {
  let platform = 0;
  const app = new Map();
  for (const e of entries) {
    const status = Number(e?.httpRequest?.status);
    if (!(status >= 500)) continue;
    const text = String(e.textPayload ?? e.jsonPayload?.message ?? "");
    if (text.toLowerCase().includes(PLATFORM_MARKER)) platform += 1;
    else {
      let p = String(e.httpRequest.requestUrl ?? "?");
      try {
        p = new URL(p).pathname;
      } catch {
        /* keep the raw value */
      }
      const key = `${status} ${p}`;
      app.set(key, (app.get(key) ?? 0) + 1);
    }
  }
  const appCount = [...app.values()].reduce((a, b) => a + b, 0);
  const topApp = [...app.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  return { total: platform + appCount, platform, app: appCount, topApp };
}

// Pure verdict rules. Returns { verdict, issues, exitCode }.
export function decide(r, expect) {
  const issues = [];
  if (!r.smoke?.ok) issues.push("smoke");
  if (!r.version?.version) issues.push("version (unreadable)");
  else if (expect && r.version.version !== expect)
    issues.push(`version (expected ${expect}, served ${r.version.version})`);
  if (!r.fivexx?.available) issues.push("5xx (unavailable)");
  else {
    if (r.fivexx.app > 0) issues.push(`5xx (app ${r.fivexx.app})`);
    if (r.fivexx.platform >= PLATFORM_BURST)
      issues.push(`5xx (platform burst ${r.fivexx.platform})`);
  }
  if (!r.posthog?.available) issues.push("posthog (unavailable)");
  else if (!(r.posthog.events > 0)) issues.push("posthog (no events)");
  return {
    verdict: issues.length ? `check ${issues.join(", ")}` : "ok",
    issues,
    exitCode: r.smoke?.ok ? 0 : 1,
  };
}

export function formatLines(r, d) {
  const v = r.version;
  const versionLine = v?.version
    ? `${v.version}${v.title ? ` "${v.title}"` : ""}${v.date ? ` (${v.date})` : ""} [${v.source}]` +
      (r.prodCurrent ? ` prod-current ${r.prodCurrent.slice(0, 7)}` : "")
    : `unavailable (${v?.error ?? "no marker"})` +
      (r.prodCurrent ? ` prod-current ${r.prodCurrent.slice(0, 7)}` : "");
  const s = r.smoke;
  const smokeLine = s.status
    ? `${s.status} in ${s.ms} ms, ${s.sets ?? "?"} sets${s.ok ? "" : ` FAIL (${s.error})`}`
    : `FAIL (${s.error})`;
  const f = r.fivexx;
  const fiveLine = f.available
    ? `${f.total}${f.capped ? "+" : ""} in 24h (platform ${f.platform} "${PLATFORM_MARKER}", app ${f.app}` +
      (f.topApp ? `; top ${f.topApp[0]} x${f.topApp[1]}` : "") +
      `) [${f.project}]`
    : `unavailable (${f.error})`;
  const p = r.posthog;
  const phLine = p.available
    ? `${p.events} events, ${p.browsers} browsers, ${p.exceptions} $exception in 24h`
    : `unavailable (${p.error})`;
  return [
    `version: ${versionLine}`,
    `smoke: ${smokeLine}`,
    `5xx: ${fiveLine}`,
    `posthog: ${phLine}`,
    `verdict: ${d.verdict}`,
  ];
}

// ---------- sources (network / child processes) ----------

function run(cmd, args) {
  // gcloud and gh are .cmd shims on Windows: Node refuses them without a shell, so quote by hand there.
  const win = process.platform === "win32";
  const res = win
    ? spawnSync([cmd, ...args.map((a) => (/[\s"<>|&^]/.test(a) ? `"${a}"` : a))].join(" "), {
        shell: true,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      })
    : spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return res;
}

function notFound(res) {
  return (
    res.error?.code === "ENOENT" ||
    res.status === 9009 ||
    res.status === 127 ||
    /is not recognized|not found/i.test(res.stderr ?? "")
  );
}

async function timedFetch(url, init = {}) {
  const t0 = performance.now();
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  return { res, ms: Math.round(performance.now() - t0) };
}

async function getVersion(base) {
  try {
    const { res } = await timedFetch(`${base}/`);
    const html = await res.text();
    const chunk = findAppChunk(html);
    if (!chunk) return { error: "no App chunk in index.html" };
    const js = await (await timedFetch(new URL(chunk, `${base}/`).href)).res.text();
    const v = extractVersion(js);
    if (!v) return { error: `no release marker in ${path.basename(chunk)}` };
    return { ...v, source: path.basename(chunk) };
  } catch (e) {
    return { error: `fetch failed: ${e.cause?.code ?? e.name}` };
  }
}

function getProdCurrent() {
  const res = run("gh", ["api", `repos/${REPO}/commits/prod-current`, "--jq", ".sha"]);
  const sha = (res.stdout ?? "").trim();
  return res.status === 0 && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

async function getSmoke(base) {
  try {
    const { res, ms } = await timedFetch(`${base}/api/sets`);
    let sets = null;
    try {
      const body = await res.json();
      sets = Array.isArray(body) ? body.length : null;
    } catch {
      /* non-JSON body */
    }
    const ok = res.status === 200 && sets > 0;
    return {
      ok,
      status: res.status,
      ms,
      sets,
      error: ok ? null : sets === 0 ? "empty sets" : `HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      ok: false,
      status: null,
      ms: null,
      sets: null,
      error: `fetch failed: ${e.cause?.code ?? e.name}`,
    };
  }
}

function get5xx() {
  const project = process.env.HEALTH_GCP_PROJECT || "swu-prod";
  // No inner quotes (cmd.exe quoting on Windows); --freshness bounds the window to 24 h.
  const filter =
    "resource.type=cloud_run_revision AND resource.labels.service_name=backend AND httpRequest.status>=500";
  const res = run("gcloud", [
    "logging",
    "read",
    filter,
    `--project=${project}`,
    "--freshness=24h",
    "--format=json",
    `--limit=${LOG_LIMIT}`,
    "--quiet",
  ]);
  if (notFound(res)) return { available: false, error: "gcloud not found" };
  if (res.status !== 0) {
    const err = (res.stderr ?? "").trim().split(/\r?\n/).pop() ?? "";
    const why = /auth|credential|login|token/i.test(err)
      ? "gcloud not authenticated"
      : `gcloud exit ${res.status}`;
    return { available: false, error: why };
  }
  let entries;
  try {
    entries = JSON.parse(res.stdout || "[]");
  } catch {
    return { available: false, error: "gcloud output not JSON" };
  }
  return { available: true, project, capped: entries.length >= LOG_LIMIT, ...count5xx(entries) };
}

async function getPosthog() {
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  if (!key) return { available: false, error: "no key" };
  const host = (process.env.POSTHOG_HOST || "https://us.posthog.com").replace(/\/$/, "");
  const project = process.env.POSTHOG_PROJECT_ID || "@current";
  const query =
    "SELECT count(), count(DISTINCT distinct_id), countIf(event = '$exception') FROM events " +
    "WHERE timestamp > now() - INTERVAL 24 HOUR LIMIT 1";
  try {
    const { res } = await timedFetch(`${host}/api/projects/${project}/query/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
    });
    if (!res.ok) return { available: false, error: `HTTP ${res.status}` };
    const row = (await res.json())?.results?.[0];
    if (!row) return { available: false, error: "empty result" };
    return { available: true, events: row[0], browsers: row[1], exceptions: row[2] };
  } catch (e) {
    return { available: false, error: `fetch failed: ${e.cause?.code ?? e.name}` };
  }
}

async function main(argv) {
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  const base = (opt("--base") || DEFAULT_BASE).replace(/\/$/, "");
  const expect = opt("--expect");
  const [version, smoke, posthog] = await Promise.all([
    getVersion(base),
    getSmoke(base),
    getPosthog(),
  ]);
  const fivexx = get5xx();
  const prodCurrent = getProdCurrent();
  const r = {
    checkedAt: new Date().toISOString(),
    base,
    version,
    prodCurrent,
    smoke,
    fivexx,
    posthog,
  };
  const d = decide(r, expect);
  if (argv.includes("--json")) console.log(JSON.stringify({ ...r, ...d }, null, 2));
  else console.log(formatLines(r, d).join("\n"));
  process.exitCode = d.exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
