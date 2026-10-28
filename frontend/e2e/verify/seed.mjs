/* global process, console, fetch, FormData, Blob, URL */
// BL-279 WS-3 W3-05: reset the verification tenants to the committed fixture.
//
//   VERIFY_BASE_URL=https://swu-dev-jbapps.web.app VERIFY_FIREBASE_API_KEY=... \
//   VERIFY_EMAIL=... VERIFY_PASSWORD=... [VERIFY_B_EMAIL=... VERIFY_B_PASSWORD=...] \
//   node e2e/verify/seed.mjs
//
// Tenant A: inventory = e2e/journeys/seed-a.csv via the public import endpoint
// (mode=replace_all, cap_handling=add_above, stage=commit); every share
// deleted; limits reset. Tenant B (only when VERIFY_B_EMAIL/VERIFY_B_PASSWORD are
// set): inventory = e2e/journeys/seed-empty.csv (header only), limits reset.
//
// Limits "default" body: a fresh tenant has no overrides and cap_mode "hard"
// (settings_schema.LimitsUpdateRequest: limits=[] resets every cell to the code
// default; cap_mode "hard" is the default enforcement mode). So the reset is
// PUT /api/settings/limits {"limits": [], "cap_mode": "hard"}.
//
// E2E_LOCAL=1 signs in against the Auth emulator instead of Firebase: the user
// is created (accounts:signUp) when sign-in answers EMAIL_NOT_FOUND, then marked
// email-verified through the emulator's accounts:update with the admin bearer
// token "owner" and signed in again so the id token carries email_verified.
//
// Output, one line per tenant:
//   seed <role>: variants=<n> copies=<n> shares=0 limits=<sha1 of canonical JSON>
// A second run prints identical lines. Exit 1 on any failure (status + first 200
// characters of the body). Passwords and tokens are never printed.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const LOCAL = process.env.E2E_LOCAL === "1";
const EMULATOR = process.env.VERIFY_EMULATOR_URL ?? "http://127.0.0.1:9099";
const IDP = LOCAL
  ? `${EMULATOR}/identitytoolkit.googleapis.com/v1`
  : "https://identitytoolkit.googleapis.com/v1";
const API_KEY = LOCAL ? "fake" : process.env.VERIFY_FIREBASE_API_KEY;
const BASE = (process.env.VERIFY_BASE_URL ?? "").replace(/\/+$/, "");

function fail(message) {
  console.error(`seed failed: ${message}`);
  process.exit(1);
}

function need(name) {
  const v = process.env[name];
  if (!v) fail(`missing environment variable ${name}`);
  return v;
}

async function check(res, what) {
  if (res.ok) return res;
  const body = (await res.text()).slice(0, 200);
  return fail(`${what}: HTTP ${res.status} ${body}`);
}

async function idp(method, body, headers = {}) {
  const res = await fetch(`${IDP}/accounts:${method}?key=${API_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return res;
}

async function signIn(email, password) {
  return idp("signInWithPassword", { email, password, returnSecureToken: true });
}

async function idToken(email, password) {
  let res = await signIn(email, password);
  if (LOCAL && res.status === 400) {
    const text = await res.clone().text();
    if (text.includes("EMAIL_NOT_FOUND")) {
      await check(
        await idp("signUp", { email, password, returnSecureToken: true }),
        "emulator signUp"
      );
      res = await signIn(email, password);
    }
  }
  await check(res, "sign-in");
  const { idToken: token, localId } = await res.json();
  if (!LOCAL) return token;
  // Emulator: mark the email verified (admin bearer "owner"), then sign in again
  // so the new token carries email_verified=true.
  await check(
    await idp("update", { localId, emailVerified: true }, { authorization: "Bearer owner" }),
    "emulator accounts:update (emailVerified)"
  );
  const again = await check(await signIn(email, password), "sign-in (after verify)");
  return (await again.json()).idToken;
}

async function api(token, method, path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  return check(res, `${method} ${path}`);
}

async function importCsv(token, csvName) {
  const text = await readFile(here(`../journeys/${csvName}`), "utf-8");
  const form = new FormData();
  form.append("file", new Blob([text], { type: "text/csv" }), csvName);
  form.append("mode", "replace_all");
  form.append("cap_handling", "add_above");
  form.append("stage", "commit");
  const report = await (await api(token, "POST", "/api/inventory/import", { body: form })).json();
  const t = report.totals ?? {};
  if (!report.committed || t.unresolved || t.ambiguous) {
    fail(
      `import ${csvName}: committed=${report.committed} unresolved=${t.unresolved} ` +
        `ambiguous=${t.ambiguous} (is the catalog loaded?)`
    );
  }
}

// Stable stringify: sorted object keys at every level; the limits array is
// sorted by (type_category, limit_bucket) first.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function seedTenant(role, email, password, csvName) {
  const token = await idToken(email, password);
  // Limits first, so the import is the last write to the inventory.
  const limitsRes = await api(token, "PUT", "/api/settings/limits", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ limits: [], cap_mode: "hard" }),
  });
  const limits = await limitsRes.json();
  limits.limits.sort(
    (a, b) =>
      a.type_category.localeCompare(b.type_category) || a.limit_bucket.localeCompare(b.limit_bucket)
  );
  await importCsv(token, csvName);

  const shares = await (await api(token, "GET", "/api/shares")).json();
  for (const s of shares) await api(token, "DELETE", `/api/shares/${s.id}`);
  const left = await (await api(token, "GET", "/api/shares")).json();

  const hash = createHash("sha1").update(canonical(limits)).digest("hex");

  // W3-08: count owned variants only. A card a journey stepped up and back
  // down keeps an inventory row at quantity 0, and replace_all leaves that row
  // in place (observed on dev 2026-10-28: variants=11 copies=18 after J2), so
  // qty.length alone drifts from run to run.
  const qty = await (await api(token, "GET", "/api/inventory/quantities")).json();
  const owned = qty.filter((r) => r.quantity > 0);
  const copies = owned.reduce((n, r) => n + r.quantity, 0);
  console.log(
    `seed ${role}: variants=${owned.length} copies=${copies} shares=${left.length} limits=${hash}`
  );
}

if (!BASE) fail("missing environment variable VERIFY_BASE_URL");
if (!LOCAL) need("VERIFY_FIREBASE_API_KEY");

await seedTenant("A", need("VERIFY_EMAIL"), need("VERIFY_PASSWORD"), "seed-a.csv");
if (process.env.VERIFY_B_EMAIL && process.env.VERIFY_B_PASSWORD) {
  await seedTenant(
    "B",
    process.env.VERIFY_B_EMAIL,
    process.env.VERIFY_B_PASSWORD,
    "seed-empty.csv"
  );
}
