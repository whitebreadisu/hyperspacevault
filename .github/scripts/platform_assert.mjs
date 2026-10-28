// Platform assertions A01-A08 (BL-279 WS-3, W3-11). Dependency-free, Node >= 20. Same family as
// health_check.mjs: pure functions exported for tests, main() does the I/O.
//
//   node .github/scripts/platform_assert.mjs --base <url> --env dev|prod
//        [--only A01,A03] [--spec <SWU_Platform_Spec.md>] [--direct <cloud run url>]
//        [--expect-sha <sha>] [--expect-version <x.y.z>] [--sql-instance <name>] [--json]
//
// Prints one line per row:  A0n <claim> | <observed> | PASS|FAIL|SKIP   then  verdict: ok|check ...
// Exit 1 on any FAIL, 0 otherwise (SKIP never fails).
//
// Environment (credentials; nothing is read from files):
//   VERIFY_FIREBASE_API_KEY                         Firebase Web API key (identitytoolkit sign-in)
//   VERIFY_EMAIL / VERIFY_PASSWORD                  tenant A
//   VERIFY_B_EMAIL / VERIFY_B_PASSWORD              tenant B
//   VERIFY_UNVERIFIED_EMAIL / VERIFY_UNVERIFIED_PASSWORD   the unverified identity
//   ASSERT_SQL_INSTANCE                             Cloud SQL instance for A05 (default swu-prod-pg)
//
// Path facts: Firebase Hosting rewrites /api/**, /images/**, /shared/** and /scan (firebase.json),
// but NOT /health, so /health is probed on --direct (the Cloud Run URL) only; the Hosting base
// uses /api/sets (200) and /api/does-not-exist (404) for header checks. Retry policy: ONE retry when fetch
// throws (connection error / timeout), never on a response; the observed text says
// "(retried once)" when it happened.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { findAppChunk, extractVersion } from "./health_check.mjs";

export const DEFAULT_SPEC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../specification_documents/SWU_Platform_Spec.md",
);
export const ROWS = ["A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08"];
export const GARBAGE_TOKEN = "platform-assert-garbage-token";
export const NONEXISTENT_ID = "2000000000";
export const FIXED_SET = "SOR";

// ---------- HTTP (retry only on a thrown fetch) ----------

export async function http(
  ctx,
  method,
  url,
  { headers = {}, body, readBody = true } = {},
) {
  const doFetch = ctx.fetchImpl ?? fetch;
  const init = {
    method,
    headers: { ...headers },
    redirect: "manual",
  };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    if (!init.headers["content-type"])
      init.headers["content-type"] = "application/json";
  }
  let retried = false;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await doFetch(url, {
        ...init,
        signal: AbortSignal.timeout(ctx.timeoutMs ?? 20000),
      });
      let text = "";
      if (readBody) text = await res.text();
      else await res.body?.cancel();
      return { status: res.status, headers: res.headers, text, retried };
    } catch (e) {
      if (attempt === 0) {
        retried = true;
        continue;
      }
      return {
        status: null,
        headers: new Headers(),
        text: "",
        retried,
        error: e.cause?.code ?? e.name,
      };
    }
  }
}

const tag = (r) => (r.retried ? " (retried once)" : "");
const show = (r) =>
  r.status === null
    ? `no response (${r.error})${tag(r)}`
    : `${r.status}${tag(r)}`;

export function result(id, claim, observed, status, reason = "") {
  return { id, claim, observed, status, reason };
}
const pass = (id, claim, observed) => result(id, claim, observed, "PASS");
const fail = (id, claim, observed, reason = "") =>
  result(id, claim, observed, "FAIL", reason);
const skip = (id, claim, reason) => result(id, claim, "-", "SKIP", reason);

// ---------- A01: the route table parsed from the Spec ----------

// Parses the `| Method | Path | Session | Gates | Since |` table.
export function parseRouteTable(specText) {
  const lines = specText.split(/\r?\n/);
  const head = lines.findIndex((l) =>
    /^\|\s*Method\s*\|\s*Path\s*\|\s*Session\s*\|\s*Gates\s*\|\s*Since\s*\|/.test(
      l,
    ),
  );
  if (head < 0) return [];
  const routes = [];
  for (let i = head + 2; i < lines.length && lines[i].startsWith("|"); i += 1) {
    const cells = lines[i]
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim().replace(/^`|`$/g, ""));
    if (cells.length < 5) continue;
    routes.push({
      method: cells[0],
      path: cells[1],
      session: cells[2],
      gates: cells[3],
      since: cells[4],
    });
  }
  return routes;
}

// One probe per route: { label, method, path, base: "base"|"direct", headers, body, expect: [statuses], skip? }
export function planA01(routes) {
  const plan = [];
  for (const r of routes) {
    const label = `${r.method} ${r.path}`;
    const hasParam = /\{[^}]+\}/.test(r.path);
    const sub = (v) => r.path.replace(/\{[^}]+\}/g, v);
    const bodyFor = (m) =>
      m === "POST" || m === "PUT" || m === "PATCH" ? {} : undefined;
    if (r.path.startsWith("/api/relay/")) {
      plan.push({ label, skip: "relay forwards to PostHog" });
    } else if (r.path === "/health") {
      plan.push({
        label,
        method: "GET",
        path: "/health",
        base: "direct",
        expect: [200],
      });
    } else if (r.path === "/images/cards/{filename}") {
      // The route redirects any well-formed name (307, to the mirror bucket or the fallback CDN) without
      // checking existence; only a malformed name (dots in the stem, unknown suffix) is a 404.
      plan.push({
        label: `${label} (well-formed name)`,
        method: "GET",
        path: "/images/cards/platform-assert-nonexistent.png",
        base: "base",
        expect: [307],
        location: true,
      });
      plan.push({
        label: `${label} (malformed name)`,
        method: "GET",
        path: "/images/cards/platform..assert.txt",
        base: "base",
        expect: [404],
      });
    } else if (r.session === "get_db") {
      plan.push({
        label,
        method: r.method,
        path: sub(NONEXISTENT_ID),
        base: "base",
        body: bodyFor(r.method),
        expect: [401],
      });
    } else if (r.session === "get_optional_db") {
      plan.push({
        label: `${label} (bad token)`,
        method: r.method,
        path: sub(NONEXISTENT_ID),
        base: "base",
        headers: { authorization: "Bearer garbage" },
        body:
          r.method === "POST"
            ? { message: "platform_assert A01 bad token" }
            : undefined,
        expect: [401],
      });
    } else if (r.session === "get_shared_db") {
      plan.push({
        label,
        method: r.method,
        path: sub(GARBAGE_TOKEN),
        base: "base",
        expect: [404],
      });
    } else if (
      r.session === "get_catalog_db" &&
      r.path.endsWith("/price-history")
    ) {
      // variant_id is a required query parameter: probe a real card (found at run time) for 200 and a
      // nonexistent card for 404.
      plan.push({
        label: `${label} (real card)`,
        method: "GET",
        path: "/api/base-cards/{realId}/price-history?variant_id={realVariantId}",
        base: "base",
        expect: [200],
        needsCard: true,
        readBody: false,
      });
      plan.push({
        label: `${label} (nonexistent card)`,
        method: "GET",
        path: `/api/base-cards/${NONEXISTENT_ID}/price-history?variant_id=1`,
        base: "base",
        expect: [404],
        readBody: false,
      });
    } else if (r.session === "get_catalog_db") {
      const p = r.path.includes("{set_code}")
        ? sub(FIXED_SET)
        : hasParam
          ? sub(NONEXISTENT_ID)
          : r.path;
      plan.push({
        label,
        method: r.method,
        path: p,
        base: "base",
        expect: [200],
        readBody: false,
      });
    } else {
      plan.push({ label, skip: `no expectation for session ${r.session}` });
    }
  }
  return plan;
}

// A real base card and one of its variants, from the public catalog list (no limit parameter exists).
export async function findRealCard(ctx) {
  const r = await http(
    ctx,
    "GET",
    `${ctx.base}/api/base-cards?set_code=${FIXED_SET}`,
  );
  const list = r.status === 200 ? json(r) : null;
  const item = Array.isArray(list)
    ? list.find((c) => c?.variants?.length)
    : null;
  return item ? { id: item.id, variantId: item.variants[0].variant_id } : null;
}

export async function a01(ctx) {
  const claim = "route auth matrix (Spec 1.3)";
  const routes = parseRouteTable(ctx.specText ?? "");
  if (routes.length === 0)
    return fail("A01", claim, "no route table found in the spec", "parse");
  const plan = planA01(routes);
  let ok = 0;
  const skipped = [];
  const bad = [];
  let card = null;
  if (plan.some((p) => p.needsCard)) card = await findRealCard(ctx);
  for (const p of plan) {
    if (p.skip) {
      skipped.push(`${p.label} (${p.skip})`);
      continue;
    }
    if (p.needsCard) {
      if (!card) {
        bad.push(
          `${p.label} -> no real card found via GET /api/base-cards?set_code=${FIXED_SET}`,
        );
        continue;
      }
      p.path = p.path
        .replace("{realId}", card.id)
        .replace("{realVariantId}", card.variantId);
    }
    const root = p.base === "direct" ? ctx.direct : ctx.base;
    if (!root) {
      skipped.push(`${p.label} (needs --direct)`);
      continue;
    }
    const r = await http(ctx, p.method, root + p.path, {
      headers: p.headers,
      body: p.body,
      readBody: p.readBody ?? true,
    });
    if (
      r.status !== null &&
      p.expect.includes(r.status) &&
      (!p.location || r.headers.get("location"))
    )
      ok += 1;
    else bad.push(`${p.label} -> ${show(r)} (wanted ${p.expect.join("/")})`);
  }
  const observed = `${routes.length} routes: ${ok} probes ok, ${skipped.length} skipped, ${bad.length} wrong`;
  const res = bad.length
    ? fail("A01", claim, observed, bad.join("; "))
    : pass("A01", claim, observed);
  res.details = [
    ...bad.map((b) => `  wrong: ${b}`),
    ...skipped.map((s) => `  skipped: ${s}`),
  ];
  return res;
}

// ---------- sign-in ----------

export async function signIn(ctx, email, password) {
  const key = ctx.env.VERIFY_FIREBASE_API_KEY;
  if (!key || !email || !password)
    return { ok: false, error: "no credentials" };
  const url = `${ctx.identityUrl ?? "https://identitytoolkit.googleapis.com"}/v1/accounts:signInWithPassword?key=${encodeURIComponent(key)}`;
  const r = await http(ctx, "POST", url, {
    body: { email, password, returnSecureToken: true },
  });
  if (r.status !== 200) return { ok: false, error: `sign-in ${show(r)}` };
  try {
    return { ok: true, token: JSON.parse(r.text).idToken };
  } catch {
    return { ok: false, error: "sign-in response not JSON" };
  }
}

const auth = (token) => ({ authorization: `Bearer ${token}` });
const json = (r) => {
  try {
    return JSON.parse(r.text);
  } catch {
    return null;
  }
};

// ---------- A02: tenant isolation ----------

export async function a02(ctx) {
  const claim = "tenant isolation across identities";
  if (ctx.envName !== "dev")
    return skip("A02", claim, "needs tenant B (dev only)");
  const a = await signIn(ctx, ctx.env.VERIFY_EMAIL, ctx.env.VERIFY_PASSWORD);
  const b = await signIn(
    ctx,
    ctx.env.VERIFY_B_EMAIL,
    ctx.env.VERIFY_B_PASSWORD,
  );
  if (!a.ok || !b.ok)
    return skip(
      "A02",
      claim,
      `credentials unavailable (A: ${a.error ?? "ok"}, B: ${b.error ?? "ok"})`,
    );
  const base = ctx.base;
  const problems = [];
  const notes = [];
  let bWroteLimits = false;
  const create = await http(ctx, "POST", `${base}/api/shares`, {
    headers: auth(a.token),
    body: { name: "assert A02" },
  });
  let share = create.status === 201 ? json(create) : null;
  if (create.status === 409) {
    // an earlier run left a share: find it, then use it
    const list = json(
      await http(ctx, "GET", `${base}/api/shares`, { headers: auth(a.token) }),
    );
    share = Array.isArray(list) ? list[0] : null;
  }
  if (!share?.id)
    return fail("A02", claim, `could not create a share as A: ${show(create)}`);
  try {
    const bList = await http(ctx, "GET", `${base}/api/shares`, {
      headers: auth(b.token),
    });
    const seen = json(bList);
    if (
      bList.status !== 200 ||
      !Array.isArray(seen) ||
      seen.some((s) => s.id === share.id)
    )
      problems.push(`B sees A's share (${show(bList)})`);
    for (const [method, suffix, body] of [
      ["PATCH", "", { name: "stolen" }],
      ["POST", "/rotate", undefined],
      ["DELETE", "", undefined],
    ]) {
      const r = await http(
        ctx,
        method,
        `${base}/api/shares/${share.id}${suffix}`,
        { headers: auth(b.token), body },
      );
      if (r.status !== 404)
        problems.push(`B ${method} A's share -> ${show(r)} (wanted 404)`);
    }
    const aQty =
      json(
        await http(ctx, "GET", `${base}/api/inventory/quantities`, {
          headers: auth(a.token),
        }),
      ) ?? [];
    const bQty =
      json(
        await http(ctx, "GET", `${base}/api/inventory/quantities`, {
          headers: auth(b.token),
        }),
      ) ?? [];
    const aIds = new Set(aQty.map((q) => q.variant_id));
    const leaked = bQty.filter((q) => aIds.has(q.variant_id));
    if (leaked.length)
      problems.push(`B quantities contain ${leaked.length} of A's variant ids`);
    // B writes one NON-default override; A's limits must not move. B's own read proves the write
    // took effect (otherwise "A unchanged" would hold trivially).
    const limitsOf = async (token) =>
      json(
        await http(ctx, "GET", `${base}/api/settings/limits`, {
          headers: auth(token),
        }),
      );
    const aBefore = await limitsOf(a.token);
    const cell = aBefore?.limits?.[0];
    if (!cell) {
      problems.push("A's limits response has no cells to override");
    } else {
      const marker = cell.max_quantity === 37 ? 38 : 37;
      bWroteLimits = true;
      const put = await http(ctx, "PUT", `${base}/api/settings/limits`, {
        headers: auth(b.token),
        body: {
          limits: [
            {
              type_category: cell.type_category,
              limit_bucket: cell.limit_bucket,
              max_quantity: marker,
            },
          ],
        },
      });
      const bAfter = await limitsOf(b.token);
      const bCell = bAfter?.limits?.find(
        (c) =>
          c.type_category === cell.type_category &&
          c.limit_bucket === cell.limit_bucket,
      );
      if (put.status !== 200 || bCell?.max_quantity !== marker)
        problems.push(
          `B's non-default override did not apply (PUT ${show(put)}), so the limits check proves nothing`,
        );
      const aAfter = await limitsOf(a.token);
      if (JSON.stringify(aBefore) !== JSON.stringify(aAfter))
        problems.push("A's limits changed after B's PUT");
    }
  } finally {
    if (bWroteLimits) {
      const reset = await http(ctx, "PUT", `${base}/api/settings/limits`, {
        headers: auth(b.token),
        body: { limits: [] },
      });
      if (reset.status !== 200) notes.push(`B limits reset ${show(reset)}`);
    }
    const del = await http(ctx, "DELETE", `${base}/api/shares/${share.id}`, {
      headers: auth(a.token),
    });
    if (del.status !== 204) notes.push(`cleanup DELETE ${show(del)}`);
    ctx.state.deletedToken = share.token;
  }
  const observed = problems.length
    ? problems.join("; ")
    : `B sees none of A's data${notes.length ? `; ${notes.join("; ")}` : ""}`;
  return problems.length
    ? fail("A02", claim, observed)
    : pass("A02", claim, observed);
}

// ---------- A03: forged leading X-Forwarded-For ----------

export async function a03(ctx) {
  const claim =
    "forged leading X-Forwarded-For is ignored by the per-IP limiter";
  if (ctx.envName !== "dev")
    return skip("A03", claim, "would write to the feedback table");
  const paths = [["hosting", ctx.base]];
  if (ctx.direct) paths.push(["direct", ctx.direct]);
  const parts = [];
  const problems = [];
  for (const [name, root] of paths) {
    const statuses = [];
    for (let n = 1; n <= 6; n += 1) {
      const r = await http(ctx, "POST", `${root}/api/feedback`, {
        headers: { "x-forwarded-for": `203.0.113.${n}` },
        body: {
          message: `platform_assert A03 ${ctx.runId} ${name} ${n}`,
          contact_ok: false,
        },
      });
      statuses.push(r.status ?? "x");
    }
    parts.push(`${name}: ${statuses.join(",")}`);
    const limited = statuses.slice(0, 6).includes(429);
    const clean = statuses.every((s) => s === 429 || (s >= 200 && s < 300));
    if (!limited)
      problems.push(
        `${name} never reached 429 in six requests (the forgery is honoured)`,
      );
    else if (!clean) problems.push(`${name} returned a non-2xx/429 status`);
  }
  if (!ctx.direct) parts.push("direct: not probed (no --direct)");
  const observed = parts.join(" | ");
  return problems.length
    ? fail("A03", claim, observed, problems.join("; "))
    : pass("A03", claim, observed);
}

// ---------- A04: security headers ----------

const BACKEND_HEADERS = {
  "x-content-type-options": /nosniff/i,
  "x-frame-options": /DENY/i,
  "referrer-policy": /no-referrer/i,
  "strict-transport-security": /max-age=\d+/i,
};

export function checkHeaders(h, rules) {
  const problems = [];
  for (const [name, want] of Object.entries(rules.present ?? {})) {
    const v = h.get(name);
    if (v === null || !want.test(v)) problems.push(`${name}: ${v ?? "absent"}`);
  }
  for (const name of rules.absent ?? []) {
    if (h.get(name) !== null) problems.push(`${name} present (${h.get(name)})`);
  }
  return problems;
}

export async function a04(ctx) {
  const claim = "security headers as claimed";
  const probes = [];
  const noCsp = ["content-security-policy"];
  if (ctx.direct)
    probes.push([
      "direct /health",
      `${ctx.direct}/health`,
      { present: BACKEND_HEADERS, absent: noCsp },
    ]);
  if (ctx.direct)
    probes.push([
      "direct /api/sets",
      `${ctx.direct}/api/sets`,
      { present: BACKEND_HEADERS, absent: noCsp },
    ]);
  probes.push([
    "/api/sets",
    `${ctx.base}/api/sets`,
    { present: BACKEND_HEADERS, absent: noCsp },
  ]);
  probes.push([
    "/api/does-not-exist",
    `${ctx.base}/api/does-not-exist`,
    { present: BACKEND_HEADERS, absent: noCsp },
  ]);
  probes.push([
    "/scan",
    `${ctx.base}/scan`,
    {
      present: {
        "cross-origin-opener-policy": /^same-origin$/i,
        "cross-origin-embedder-policy": /^require-corp$/i,
        "permissions-policy": /camera=\(self\)/i,
        "cache-control": /no-cache/i,
      },
      absent: noCsp,
    },
  ]);
  probes.push([
    "/shared/x",
    `${ctx.base}/shared/x`,
    { present: { "x-robots-tag": /noindex,\s*nofollow/i }, absent: noCsp },
  ]);
  probes.push([
    "/",
    `${ctx.base}/`,
    {
      absent: [
        ...noCsp,
        "cross-origin-opener-policy",
        "cross-origin-embedder-policy",
      ],
    },
  ]);
  const problems = [];
  for (const [label, url, rules] of probes) {
    const r = await http(ctx, "GET", url, { readBody: false });
    if (r.status === null) {
      problems.push(`${label}: ${show(r)}`);
      continue;
    }
    for (const p of checkHeaders(r.headers, rules))
      problems.push(`${label} ${p}`);
  }
  const observed = problems.length
    ? problems.join("; ")
    : `${probes.length} paths carry exactly the claimed headers${ctx.direct ? "" : " (/health and direct paths skipped: no --direct)"}`;
  return problems.length
    ? fail("A04", claim, observed)
    : pass("A04", claim, observed);
}

// ---------- A05: backups (prod, via gcloud) ----------

export function evaluateBackup(
  describe,
  backups,
  now = Date.now(),
  maxHours = 26,
) {
  const cfg = describe?.settings?.backupConfiguration ?? {};
  const problems = [];
  if (cfg.enabled !== true) problems.push("backups not enabled");
  if (cfg.pointInTimeRecoveryEnabled !== true)
    problems.push("PITR not enabled");
  const latest = Array.isArray(backups) ? backups[0] : null;
  let ageH = null;
  if (!latest?.endTime) problems.push("no successful backup found");
  else {
    ageH = (now - Date.parse(latest.endTime)) / 3600000;
    if (!(ageH < maxHours))
      problems.push(
        `latest backup ${ageH.toFixed(1)} h old (limit ${maxHours} h)`,
      );
  }
  return { ok: problems.length === 0, problems, ageH };
}

// A prod run must never turn a credential or CLI error into a quiet SKIP.
function gcloudError(what, r) {
  const text = (r.error?.message ?? r.stderr ?? "").toString().trim();
  const last = text.split(/\r?\n/).filter(Boolean).pop() ?? "no output";
  return `${what} failed (exit ${r.status ?? "none"}): ${last}`;
}

export async function a05(ctx) {
  const claim =
    "backups enabled with PITR; a successful backup in the last 26 h";
  if (ctx.envName !== "prod")
    return skip("A05", claim, "no dev credentials in the gate");
  const instance = ctx.sqlInstance;
  const project = ctx.env.HEALTH_GCP_PROJECT || "swu-prod";
  const run =
    ctx.runCommand ??
    ((cmd, args) =>
      spawnSync(cmd, args, {
        encoding: "utf8",
        shell: process.platform === "win32",
      }));
  const d = run("gcloud", [
    "sql",
    "instances",
    "describe",
    instance,
    `--project=${project}`,
    "--format=json",
  ]);
  if (d.error || d.status !== 0)
    return fail("A05", claim, gcloudError("gcloud sql instances describe", d));
  const b = run("gcloud", [
    "sql",
    "backups",
    "list",
    `--instance=${instance}`,
    `--project=${project}`,
    "--filter=status=SUCCESSFUL",
    "--sort-by=~endTime",
    "--limit=1",
    "--format=json",
  ]);
  if (b.error || b.status !== 0)
    return fail("A05", claim, gcloudError("gcloud sql backups list", b));
  let describe, backups;
  try {
    describe = JSON.parse(d.stdout);
    backups = JSON.parse(b.stdout || "[]");
  } catch {
    return fail("A05", claim, "gcloud output was not JSON");
  }
  const e = evaluateBackup(describe, backups, ctx.now ?? Date.now());
  const observed = e.ok
    ? `enabled, PITR on, latest backup ${e.ageH.toFixed(1)} h ago`
    : e.problems.join("; ");
  return e.ok ? pass("A05", claim, observed) : fail("A05", claim, observed);
}

// ---------- A06: the served build ----------

export function extractBuildSha(html) {
  const m =
    html.match(
      /<meta\s+[^>]*name=["']build-sha["'][^>]*content=["']([^"']*)["']/i,
    ) ??
    html.match(
      /<meta\s+[^>]*content=["']([^"']*)["'][^>]*name=["']build-sha["']/i,
    );
  return m ? m[1] : null;
}

// The release-notes version at the prod-current tag: the first release entry of releaseNotes.ts.
export function notesVersionFromSource(ts) {
  const m = ts.match(
    /kind:\s*"release",\s*key:\s*"[^"]*",\s*version:\s*"([^"]+)"/,
  );
  return m ? m[1] : null;
}

const normVersion = (v) => String(v).replace(/(\.0)+$/, "");

async function servedVersion(ctx) {
  const idx = await http(ctx, "GET", `${ctx.base}/`);
  const chunk = idx.status === 200 ? findAppChunk(idx.text) : null;
  if (!chunk) return { error: "no App chunk in index.html" };
  const js = await http(ctx, "GET", new URL(chunk, `${ctx.base}/`).href);
  const v = js.status === 200 ? extractVersion(js.text) : null;
  return v
    ? { version: v.version }
    : { error: "no release marker in the App chunk" };
}

function taggedVersion(ctx) {
  const run =
    ctx.runCommand ??
    ((cmd, args) =>
      spawnSync(cmd, args, {
        encoding: "utf8",
        shell: process.platform === "win32",
      }));
  const repo = ctx.repo ?? "whitebreadisu/hyperspacevault";
  const sha = run("gh", [
    "api",
    `repos/${repo}/commits/prod-current`,
    "--jq",
    ".sha",
  ]);
  const shaText = (sha.stdout ?? "").trim();
  if (sha.error || sha.status !== 0 || !/^[0-9a-f]{40}$/.test(shaText))
    return { error: gcloudError("gh api commits/prod-current", sha) };
  const file = run("gh", [
    "api",
    `repos/${repo}/contents/frontend/src/content/releaseNotes.ts?ref=${shaText}`,
    "-H",
    "Accept: application/vnd.github.raw+json",
  ]);
  const version =
    file.status === 0 ? notesVersionFromSource(file.stdout ?? "") : null;
  return version
    ? { version, sha: shaText }
    : { error: "release notes at prod-current unreadable" };
}

// Dev: the served index.html build-sha meta (compared with --expect-sha when given). Prod
// additionally: the release-notes version served in the App chunk must equal the version in
// releaseNotes.ts at the prod-current tag (or --expect-version). A missing build-sha meta is a
// FAIL (the meta ships since #324).
export async function a06(ctx) {
  const claim = "the environment serves the SHA under test";
  const r = await http(ctx, "GET", `${ctx.base}/`);
  if (r.status !== 200) return fail("A06", claim, `GET / -> ${show(r)}`);
  const sha = extractBuildSha(r.text);
  if (!sha) return fail("A06", claim, "index.html carries no build-sha meta");
  const problems = [];
  const parts = [`build-sha ${sha}`];
  let compared = false;
  if (ctx.expectSha) {
    compared = true;
    const ok =
      sha === ctx.expectSha ||
      ctx.expectSha.startsWith(sha) ||
      sha.startsWith(ctx.expectSha);
    if (!ok) problems.push(`build-sha ${sha}, expected ${ctx.expectSha}`);
  }
  if (ctx.envName === "prod") {
    const served = await servedVersion(ctx);
    if (served.error) problems.push(`served version: ${served.error}`);
    else {
      parts.push(`served version ${served.version}`);
      const want = ctx.expectVersion
        ? { version: ctx.expectVersion }
        : taggedVersion(ctx);
      if (want.error) problems.push(want.error);
      else {
        compared = true;
        if (normVersion(want.version) !== normVersion(served.version))
          problems.push(
            `served version ${served.version}, expected ${want.version}`,
          );
      }
    }
  }
  const observed = problems.length ? problems.join("; ") : parts.join(", ");
  if (problems.length) return fail("A06", claim, observed);
  if (!compared)
    return skip("A06", claim, `${observed}; no --expect-sha given`);
  return pass("A06", claim, observed);
}

// ---------- A07: the verified-email gate ----------

export async function a07(ctx) {
  const claim =
    "an unverified identity is refused on inventory writes, allowed reads";
  if (ctx.envName !== "dev")
    return skip("A07", claim, "needs the unverified identity (dev only)");
  const u = await signIn(
    ctx,
    ctx.env.VERIFY_UNVERIFIED_EMAIL,
    ctx.env.VERIFY_UNVERIFIED_PASSWORD,
  );
  if (!u.ok) return skip("A07", claim, `credentials unavailable (${u.error})`);
  const inc = await http(ctx, "POST", `${ctx.base}/api/inventory/1/increment`, {
    headers: auth(u.token),
  });
  const qty = await http(ctx, "GET", `${ctx.base}/api/inventory/quantities`, {
    headers: auth(u.token),
  });
  const exp = await http(ctx, "GET", `${ctx.base}/api/inventory/export`, {
    headers: auth(u.token),
  });
  const code = json(inc)?.detail?.code ?? json(inc)?.detail;
  const problems = [];
  if (inc.status !== 403) problems.push(`increment ${show(inc)} (wanted 403)`);
  else if (!JSON.stringify(code ?? inc.text).includes("email_not_verified"))
    problems.push("increment 403 without email_not_verified");
  if (qty.status !== 200) problems.push(`quantities ${show(qty)} (wanted 200)`);
  if (exp.status !== 403) problems.push(`export ${show(exp)} (wanted 403)`);
  const observed = `increment ${show(inc)}, quantities ${show(qty)}, export ${show(exp)}`;
  return problems.length
    ? fail("A07", claim, observed, problems.join("; "))
    : pass("A07", claim, observed);
}

// ---------- A08: share tokens ----------

export async function a08(ctx) {
  const claim = "a garbage or deleted share token is a 404";
  const g = await http(ctx, "GET", `${ctx.base}/api/shared/${GARBAGE_TOKEN}`, {
    readBody: false,
  });
  let observed = `garbage ${show(g)}`;
  let ok = g.status === 404;
  if (ctx.envName === "dev") {
    if (ctx.state.deletedToken) {
      const d = await http(
        ctx,
        "GET",
        `${ctx.base}/api/shared/${ctx.state.deletedToken}`,
        { readBody: false },
      );
      observed += `, deleted ${show(d)}`;
      ok = ok && d.status === 404;
    } else observed += ", deleted token: not probed (A02 did not run)";
  }
  return ok ? pass("A08", claim, observed) : fail("A08", claim, observed);
}

// ---------- output ----------

export const CHECKS = {
  A01: a01,
  A02: a02,
  A03: a03,
  A04: a04,
  A05: a05,
  A06: a06,
  A07: a07,
  A08: a08,
};

export function formatLines(results) {
  const lines = [];
  for (const r of results) {
    const status = r.status === "SKIP" ? `SKIP(${r.reason})` : r.status;
    lines.push(`${r.id} ${r.claim} | ${r.observed} | ${status}`);
    if (r.status === "FAIL" && r.reason && !r.details)
      lines.push(`  why: ${r.reason}`);
    for (const d of r.details ?? []) lines.push(d);
  }
  const failed = results.filter((r) => r.status === "FAIL").map((r) => r.id);
  const skipped = results.filter((r) => r.status === "SKIP").length;
  lines.push(
    failed.length
      ? `verdict: check ${failed.join(", ")}`
      : `verdict: ok (${results.length - skipped} run, ${skipped} skipped)`,
  );
  return lines;
}

export function exitCodeFor(results) {
  return results.some((r) => r.status === "FAIL") ? 1 : 0;
}

export function parseArgs(argv) {
  const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
  return {
    help: argv.includes("--help") || argv.includes("-h"),
    base: opt("--base")?.replace(/\/$/, ""),
    env: opt("--env"),
    only: opt("--only")
      ?.split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
    spec: opt("--spec") ?? DEFAULT_SPEC,
    direct: opt("--direct")?.replace(/\/$/, ""),
    expectSha: opt("--expect-sha"),
    expectVersion: opt("--expect-version"),
    sqlInstance: opt("--sql-instance"),
    json: argv.includes("--json"),
  };
}

export const USAGE = `usage: node .github/scripts/platform_assert.mjs --base <url> --env dev|prod
       [--only A01,A03] [--spec <SWU_Platform_Spec.md>] [--direct <cloud run url>]
       [--expect-sha <sha>] [--expect-version <x.y.z>] [--sql-instance <name>] [--json]
rows: ${ROWS.join(" ")}   exit 1 on any FAIL; SKIP never fails.`;

export async function runChecks(ctx, only) {
  const ids = ROWS.filter((id) => !only || only.includes(id));
  const out = [];
  for (const id of ids) out.push(await CHECKS[id](ctx));
  return out;
}

async function main(argv) {
  const a = parseArgs(argv);
  if (a.help) {
    console.log(USAGE);
    return;
  }
  if (!a.base || !["dev", "prod"].includes(a.env)) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const ctx = {
    base: a.base,
    direct: a.direct,
    envName: a.env,
    env: process.env,
    specText: readFileSync(a.spec, "utf8"),
    expectSha: a.expectSha,
    expectVersion: a.expectVersion,
    sqlInstance:
      a.sqlInstance || process.env.ASSERT_SQL_INSTANCE || "swu-prod-pg",
    runId: new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, "")
      .slice(0, 14),
    state: {},
  };
  const results = await runChecks(ctx, a.only);
  console.log(
    a.json ? JSON.stringify(results, null, 2) : formatLines(results).join("\n"),
  );
  process.exitCode = exitCodeFor(results);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main(process.argv.slice(2));
}
