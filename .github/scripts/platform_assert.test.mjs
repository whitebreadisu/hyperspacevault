// Tests for platform_assert.mjs (stub HTTP servers on node:http, no network). Run:
//   node --test .github/scripts/platform_assert.test.mjs
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  parseRouteTable,
  planA01,
  http as request,
  a01,
  a02,
  a03,
  a04,
  a05,
  a06,
  a07,
  a08,
  evaluateBackup,
  extractBuildSha,
  notesVersionFromSource,
  checkHeaders,
  formatLines,
  exitCodeFor,
  parseArgs,
  runChecks,
} from "./platform_assert.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const TABLE = readFileSync(
  path.join(here, "fixtures/platform_assert/spec_route_table.md"),
  "utf8",
);

// Every stub server is closed once the file's tests finish, even if an assertion threw first,
// so a leftover server cannot keep the process (and the CI job) alive.
const openServers = new Set();
after(async () => {
  for (const s of openServers) await s.close();
});

async function serve(handler) {
  const hits = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
      });
      handler(req, res, hits, body);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const handle = {
    url: `http://127.0.0.1:${server.address().port}`,
    hits,
    close: () =>
      new Promise(
        (r) => (server.closeAllConnections(), server.close(() => r())),
      ),
  };
  openServers.add(handle);
  return handle;
}
const send = (res, status, body = "", headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

// ---------- parser and plan ----------

test("parseRouteTable reads the Spec's route table verbatim copy", () => {
  const routes = parseRouteTable(TABLE);
  assert.equal(routes.length, 29);
  assert.deepEqual(routes[0], {
    method: "DELETE",
    path: "/api/account",
    session: "get_db",
    gates: "require_recent_auth",
    since: "BL-87",
  });
  assert.ok(routes.some((r) => r.path === "/health" && r.session === "none"));
  assert.ok(
    routes.some(
      (r) =>
        r.path === "/api/shared/{token}/limits" &&
        r.session === "get_shared_db",
    ),
  );
});

test("parseRouteTable finds nothing in unrelated text", () => {
  assert.deepEqual(parseRouteTable("# nothing here\n| a | b |\n"), []);
});

test("planA01 maps each session kind to its expectation", () => {
  const plan = planA01(parseRouteTable(TABLE));
  const by = (label) => plan.find((p) => p.label.startsWith(label));
  assert.deepEqual(by("DELETE /api/account").expect, [401]);
  assert.equal(
    by("POST /api/inventory/{variant_id}/adjust").path,
    "/api/inventory/2000000000/adjust",
  );
  assert.deepEqual(by("GET /api/sets/{set_code}").expect, [200]);
  assert.equal(by("GET /api/sets/{set_code}").path, "/api/sets/SOR");
  assert.deepEqual(by("GET /api/sets").expect, [200]);
  assert.deepEqual(by("GET /api/shared/{token}").expect, [404]);
  const opt = by("GET /api/base-cards/{base_card_id} ");
  assert.equal(opt.headers.authorization, "Bearer garbage");
  assert.deepEqual(
    by("GET /images/cards/{filename} (well-formed").expect,
    [307],
  );
  assert.equal(by("GET /images/cards/{filename} (well-formed").location, true);
  assert.deepEqual(by("GET /images/cards/{filename} (malformed").expect, [404]);
  assert.equal(by("GET /images/cards/{filename} (malformed").base, "base");
  const ph = plan.filter((p) => p.label.includes("price-history"));
  assert.equal(ph.length, 2);
  assert.ok(
    ph[0].needsCard && ph[0].path.includes("variant_id={realVariantId}"),
  );
  assert.deepEqual(ph[1].expect, [404]);
  assert.equal(by("GET /health").base, "direct");
  const relay = plan.filter((p) => p.label.includes("/api/relay/"));
  assert.equal(relay.length, 2);
  assert.ok(relay.every((p) => p.skip === "relay forwards to PostHog"));
});

// ---------- retry policy ----------

test("fetch that throws is retried once; a response is never retried", async () => {
  let n = 0;
  const flaky = await serve((req, res) => {
    n += 1;
    if (n === 1) req.socket.destroy();
    else send(res, 200, {});
  });
  const r = await request({ timeoutMs: 3000 }, "GET", flaky.url + "/x");
  assert.equal(r.status, 200);
  assert.equal(r.retried, true);
  await flaky.close();

  const bad = await serve((_req, res) => send(res, 500, "boom"));
  const r2 = await request({ timeoutMs: 3000 }, "GET", bad.url + "/x");
  assert.equal(r2.status, 500);
  assert.equal(r2.retried, false);
  assert.equal(bad.hits.length, 1);
  await bad.close();
});

test("two thrown fetches give no response and exactly two attempts", async () => {
  const dead = await serve((req) => req.socket.destroy());
  const r = await request({ timeoutMs: 3000 }, "GET", dead.url + "/x");
  assert.equal(r.status, null);
  assert.equal(r.retried, true);
  assert.equal(dead.hits.length, 2);
  await dead.close();
});

test("a retried probe says so in the observed text", async () => {
  let n = 0;
  const flaky = await serve((req, res) => {
    n += 1;
    if (n === 1) req.socket.destroy();
    else send(res, 404, "");
  });
  const r = await a08({
    base: flaky.url,
    envName: "prod",
    state: {},
    timeoutMs: 3000,
  });
  assert.equal(r.status, "PASS");
  assert.match(r.observed, /404 \(retried once\)/);
  await flaky.close();
});

// ---------- A01 ----------

function backendStub(routes) {
  return (req, res) => {
    const url = req.url.split("?")[0];
    if (url === "/health") return send(res, 200, { status: "ok" });
    if (url.startsWith("/images/cards/"))
      return url.includes("..")
        ? send(res, 404, "")
        : send(res, 307, "", { location: "https://cdn.example/x.png" });
    if (req.url.startsWith("/api/base-cards?set_code="))
      return send(res, 200, [{ id: 7, variants: [{ variant_id: 70 }] }]);
    if (url.endsWith("/price-history")) {
      if (!req.url.includes("variant_id=")) return send(res, 422, "");
      return send(res, url.includes("2000000000") ? 404 : 200, "{}");
    }
    if (url.startsWith("/api/shared/")) return send(res, 404, "");
    if (
      url.startsWith("/api/sets") ||
      url.startsWith("/api/base-cards") ||
      url.startsWith("/api/catalog")
    ) {
      if (req.headers.authorization === "Bearer garbage")
        return send(res, 401, "");
      return send(res, url.match(/\d{6}|ZZZZ/) ? 404 : 200, "[]");
    }
    if (url === "/api/feedback" && req.headers.authorization)
      return send(res, 401, "");
    return send(res, routes.unauthStatus ?? 401, "");
  };
}

test("A01 passes against a stub that enforces the matrix", async () => {
  const s = await serve(backendStub({}));
  const r = await a01({
    base: s.url,
    direct: s.url,
    specText: TABLE,
    state: {},
    timeoutMs: 3000,
  });
  assert.equal(r.status, "PASS", JSON.stringify(r));
  assert.match(r.observed, /29 routes: 29 probes ok, 2 skipped, 0 wrong/);
  assert.ok(r.details.some((d) => d.includes("relay forwards to PostHog")));
  await s.close();
});

test("A01 fails when a get_db route answers an anonymous caller", async () => {
  const s = await serve(backendStub({ unauthStatus: 200 }));
  const r = await a01({
    base: s.url,
    direct: s.url,
    specText: TABLE,
    state: {},
    timeoutMs: 3000,
  });
  assert.equal(r.status, "FAIL");
  assert.ok(
    r.details.some((d) =>
      d.includes("DELETE /api/account -> 200 (wanted 401)"),
    ),
  );
  await s.close();
});

test("A01 skips /health and /images without --direct", async () => {
  const s = await serve(backendStub({}));
  const r = await a01({
    base: s.url,
    specText: TABLE,
    state: {},
    timeoutMs: 3000,
  });
  assert.equal(r.status, "PASS");
  assert.ok(r.details.some((d) => d.includes("GET /health (needs --direct)")));
  await s.close();
});

test("A01 fails cleanly when the spec has no table", async () => {
  const r = await a01({
    base: "http://127.0.0.1:1",
    specText: "no table",
    state: {},
  });
  assert.equal(r.status, "FAIL");
});

// ---------- A03 ----------

function limiter(honourForged) {
  const counts = new Map();
  return (req, res) => {
    const xff = (req.headers["x-forwarded-for"] ?? "")
      .split(",")
      .map((s) => s.trim());
    const key = honourForged ? xff[0] : "real-client";
    counts.set(key, (counts.get(key) ?? 0) + 1);
    send(res, counts.get(key) > 5 ? 429 : 201, {});
  };
}

test("A03 passes when the sixth POST on each path is 429", async () => {
  const hosting = await serve(limiter(false));
  const direct = await serve(limiter(false));
  const r = await a03({
    base: hosting.url,
    direct: direct.url,
    envName: "dev",
    runId: "T",
    state: {},
    timeoutMs: 3000,
  });
  assert.equal(r.status, "PASS");
  assert.match(
    r.observed,
    /hosting: 201,201,201,201,201,429 \| direct: 201,201,201,201,201,429/,
  );
  assert.equal(hosting.hits[0].headers["x-forwarded-for"], "203.0.113.1");
  assert.equal(hosting.hits[5].headers["x-forwarded-for"], "203.0.113.6");
  await hosting.close();
  await direct.close();
});

test("A03 fails when forged leading entries are honoured", async () => {
  const s = await serve(limiter(true));
  const r = await a03({
    base: s.url,
    direct: s.url,
    envName: "dev",
    runId: "T",
    state: {},
    timeoutMs: 3000,
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.reason, /forgery is honoured/);
  await s.close();
});

test("A03 is skipped on prod", async () => {
  const r = await a03({ base: "http://x", envName: "prod", state: {} });
  assert.equal(r.status, "SKIP");
  assert.match(r.reason, /feedback table/);
});

// ---------- A04 ----------

const BACKEND = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
};

function headerStub(mutate = () => {}) {
  return (req, res) => {
    const u = req.url;
    let h = {};
    if (u === "/health" || u.startsWith("/api/")) h = { ...BACKEND };
    else if (u === "/scan")
      h = {
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-embedder-policy": "require-corp",
        "permissions-policy": "camera=(self)",
        "cache-control": "no-cache",
      };
    else if (u.startsWith("/shared/"))
      h = { "x-robots-tag": "noindex, nofollow" };
    mutate(u, h);
    send(res, u.startsWith("/api/does") ? 404 : 200, "", h);
  };
}

test("A04 passes on the claimed headers", async () => {
  const s = await serve(headerStub());
  const r = await a04({
    base: s.url,
    direct: s.url,
    state: {},
    timeoutMs: 3000,
  });
  assert.equal(r.status, "PASS", r.observed);
  await s.close();
});

test("A04 fails on a missing header, a CSP, or COOP on the sign-in page", async () => {
  const s = await serve(
    headerStub((u, h) => {
      if (u === "/health") delete h["x-frame-options"];
      if (u === "/scan") h["content-security-policy"] = "default-src 'self'";
      if (u === "/") h["cross-origin-opener-policy"] = "same-origin";
    }),
  );
  const r = await a04({
    base: s.url,
    direct: s.url,
    state: {},
    timeoutMs: 3000,
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.observed, /direct \/health x-frame-options: absent/);
  assert.match(r.observed, /\/scan content-security-policy present/);
  assert.match(r.observed, /\/ cross-origin-opener-policy present/);
  await s.close();
});

test("checkHeaders is pure", () => {
  const h = new Headers({ a: "1" });
  assert.deepEqual(checkHeaders(h, { present: { a: /1/ }, absent: ["b"] }), []);
  assert.deepEqual(checkHeaders(h, { present: { b: /1/ } }), ["b: absent"]);
});

// ---------- A05 ----------

test("evaluateBackup: pass, PITR off, stale backup, none", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  const ok = {
    settings: {
      backupConfiguration: { enabled: true, pointInTimeRecoveryEnabled: true },
    },
  };
  assert.equal(
    evaluateBackup(ok, [{ endTime: "2026-10-28T03:00:00Z" }], now).ok,
    true,
  );
  const noPitr = {
    settings: {
      backupConfiguration: { enabled: true, pointInTimeRecoveryEnabled: false },
    },
  };
  assert.deepEqual(
    evaluateBackup(noPitr, [{ endTime: "2026-10-28T03:00:00Z" }], now).problems,
    ["PITR not enabled"],
  );
  assert.match(
    evaluateBackup(ok, [{ endTime: "2026-10-26T03:00:00Z" }], now).problems[0],
    /old/,
  );
  assert.deepEqual(evaluateBackup(ok, [], now).problems, [
    "no successful backup found",
  ]);
});

test("A05 skips on dev, runs gcloud on prod through the injected runner", async () => {
  assert.equal((await a05({ envName: "dev" })).status, "SKIP");
  const calls = [];
  const runCommand = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args.includes("describe"))
      return {
        status: 0,
        stdout: JSON.stringify({
          settings: {
            backupConfiguration: {
              enabled: true,
              pointInTimeRecoveryEnabled: true,
            },
          },
        }),
      };
    return {
      status: 0,
      stdout: JSON.stringify([{ endTime: "2026-10-28T03:00:00Z" }]),
    };
  };
  const now = Date.parse("2026-10-28T12:00:00Z");
  const r = await a05({
    envName: "prod",
    sqlInstance: "swu-prod-pg",
    env: {},
    runCommand,
    now,
  });
  assert.equal(r.status, "PASS");
  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes("swu-prod-pg"));
  const down = await a05({
    envName: "prod",
    sqlInstance: "x",
    env: {},
    runCommand: () => ({
      status: 1,
      stdout: "",
      stderr: "ERROR: (gcloud.sql) You do not currently have an active account",
    }),
  });
  assert.equal(down.status, "FAIL");
  assert.match(
    down.observed,
    /gcloud sql instances describe failed \(exit 1\)/,
  );
  assert.match(down.observed, /active account/);
  const noBinary = await a05({
    envName: "prod",
    sqlInstance: "x",
    env: {},
    runCommand: () => ({
      error: new Error("spawn gcloud ENOENT"),
      status: null,
    }),
  });
  assert.equal(noBinary.status, "FAIL");
  assert.match(noBinary.observed, /ENOENT/);
});

// ---------- A06 ----------

test("extractBuildSha reads the meta tag in either attribute order", () => {
  assert.equal(
    extractBuildSha('<meta name="build-sha" content="abc123">'),
    "abc123",
  );
  assert.equal(
    extractBuildSha('<meta content="def456" name="build-sha">'),
    "def456",
  );
  assert.equal(extractBuildSha("<html></html>"), null);
});

test("A06 pass, fail, skip without --expect-sha, and FAIL without a meta tag", async () => {
  const page = (sha) => (_req, res) =>
    send(
      res,
      200,
      sha ? `<meta name="build-sha" content="${sha}">` : "<html></html>",
    );
  const s1 = await serve(page("abc1234"));
  assert.equal(
    (
      await a06({
        base: s1.url,
        envName: "dev",
        expectSha: "abc1234def",
        state: {},
      })
    ).status,
    "PASS",
  );
  assert.equal(
    (
      await a06({
        base: s1.url,
        envName: "dev",
        expectSha: "zzz9999",
        state: {},
      })
    ).status,
    "FAIL",
  );
  assert.equal(
    (await a06({ base: s1.url, envName: "dev", state: {} })).status,
    "SKIP",
  );
  const s2 = await serve(page(null));
  const r = await a06({
    base: s2.url,
    envName: "dev",
    expectSha: "abc",
    state: {},
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.observed, /no build-sha meta/);
});

test("notesVersionFromSource reads the first release entry", () => {
  const ts =
    'x = [{\n    kind: "release",\n    key: "2.1.1",\n    version: "2.1.1",\n    date: "d",\n  }, {\n    kind: "release",\n    key: "2.1",\n    version: "2.1",\n  }]';
  assert.equal(notesVersionFromSource(ts), "2.1.1");
  assert.equal(notesVersionFromSource("nothing"), null);
});

function prodSite(version) {
  return (req, res) => {
    if (req.url === "/")
      return send(
        res,
        200,
        '<meta name="build-sha" content="abc1234"><link rel="modulepreload" href="/assets/App-X.js">',
      );
    if (req.url === "/assets/App-X.js")
      return send(
        res,
        200,
        `X.register({app_version:\`${version}\`});var RE=[{kind:\`release\`,key:\`${version}\`,version:\`${version}\`,date:\`2026-10-25\`,title:\`T\`,sections:[]}]`,
      );
    return send(res, 404, "");
  };
}

test("A06 prod compares the served notes version with the prod-current tag", async () => {
  const sha = "a".repeat(40);
  const gh = (version) => (cmd, args) => {
    assert.equal(cmd, "gh");
    if (args[1].endsWith("commits/prod-current"))
      return { status: 0, stdout: `${sha}\n` };
    assert.ok(args[1].includes(`ref=${sha}`));
    return {
      status: 0,
      stdout: `kind: "release",\n key: "${version}",\n version: "${version}",\n`,
    };
  };
  const site = await serve(prodSite("2.1.1"));
  const base = {
    base: site.url,
    envName: "prod",
    state: {},
    expectSha: "abc1234",
  };
  const same = await a06({ ...base, runCommand: gh("2.1.1") });
  assert.equal(same.status, "PASS", same.observed);
  assert.match(same.observed, /served version 2.1.1/);
  assert.equal((await a06({ ...base, runCommand: gh("2.1") })).status, "FAIL");
  assert.equal(
    (await a06({ ...base, runCommand: gh("2.2.0") })).status,
    "FAIL",
  );
  assert.equal(
    (await a06({ ...base, expectVersion: "2.1.1.0" })).status,
    "PASS",
  );
  const down = await a06({
    ...base,
    runCommand: () => ({ status: 1, stdout: "", stderr: "gh: not logged in" }),
  });
  assert.equal(down.status, "FAIL");
  assert.match(down.observed, /not logged in/);
});

// ---------- sign-in, A07, A08, A02 ----------

function identityStub(users) {
  return (req, res, _hits, body) => {
    const { email, password } = JSON.parse(body || "{}");
    if (users[email] === password)
      return send(res, 200, { idToken: `tok:${email}` });
    return send(res, 400, { error: { message: "INVALID_PASSWORD" } });
  };
}

test("A07 passes against a gate that refuses writes, and fails when it does not", async () => {
  const id = await serve(identityStub({ "u@x": "pw" }));
  const gate = (writeStatus) => (req, res) => {
    if (req.url.endsWith("/increment"))
      return send(res, writeStatus, { detail: { code: "email_not_verified" } });
    if (req.url.endsWith("/export")) return send(res, writeStatus, {});
    return send(res, 200, []);
  };
  const env = {
    VERIFY_FIREBASE_API_KEY: "k",
    VERIFY_UNVERIFIED_EMAIL: "u@x",
    VERIFY_UNVERIFIED_PASSWORD: "pw",
  };
  const ok = await serve(gate(403));
  assert.equal(
    (
      await a07({
        base: ok.url,
        envName: "dev",
        env,
        identityUrl: id.url,
        state: {},
      })
    ).status,
    "PASS",
  );
  const open = await serve(gate(200));
  assert.equal(
    (
      await a07({
        base: open.url,
        envName: "dev",
        env,
        identityUrl: id.url,
        state: {},
      })
    ).status,
    "FAIL",
  );
  assert.equal(
    (await a07({ base: ok.url, envName: "dev", env: {}, state: {} })).status,
    "SKIP",
  );
  assert.equal(
    (await a07({ base: ok.url, envName: "prod", env, state: {} })).status,
    "SKIP",
  );
  await Promise.all([id.close(), ok.close(), open.close()]);
});

test("A08 garbage token, plus the deleted token on dev", async () => {
  const s = await serve((_req, res) => send(res, 404, ""));
  const prod = await a08({ base: s.url, envName: "prod", state: {} });
  assert.equal(prod.status, "PASS");
  const dev = await a08({
    base: s.url,
    envName: "dev",
    state: { deletedToken: "tok" },
  });
  assert.match(dev.observed, /deleted 404/);
  assert.ok(s.hits.some((h) => h.url === "/api/shared/tok"));
  const live = await serve((_req, res) => send(res, 200, {}));
  assert.equal(
    (await a08({ base: live.url, envName: "dev", state: {} })).status,
    "FAIL",
  );
  await Promise.all([s.close(), live.close()]);
});

function tenantStub({ leak, leakLimits = false, ignorePut = false }) {
  const shares = [];
  const overrides = {};
  let nextId = 1;
  return (req, res, _hits, body) => {
    const who = (req.headers.authorization ?? "").replace("Bearer tok:", "");
    const url = req.url;
    const m = url.match(/^\/api\/shares\/(\d+)/);
    if (req.method === "POST" && url === "/api/shares") {
      const s = {
        id: nextId++,
        owner: who,
        token: `t${nextId}`,
        name: JSON.parse(body).name,
      };
      shares.push(s);
      return send(res, 201, s);
    }
    if (req.method === "GET" && url === "/api/shares")
      return send(
        res,
        200,
        shares.filter((s) => leak || s.owner === who),
      );
    if (m) {
      const s = shares.find((x) => x.id === Number(m[1]));
      if (!s || (s.owner !== who && !leak)) return send(res, 404, "");
      if (req.method === "DELETE") shares.splice(shares.indexOf(s), 1);
      return req.method === "DELETE" ? send(res, 204, "") : send(res, 200, s);
    }
    if (url === "/api/inventory/quantities")
      return send(
        res,
        200,
        who === "a@x"
          ? [{ variant_id: 1, quantity: 2 }]
          : leak
            ? [{ variant_id: 1, quantity: 2 }]
            : [],
      );
    if (url === "/api/settings/limits") {
      const key = leakLimits ? "shared" : who;
      if (req.method === "PUT") {
        if (!ignorePut) {
          const [o] = JSON.parse(body).limits;
          if (o) overrides[key] = o.max_quantity;
          else delete overrides[key];
        }
        return send(res, 200, {});
      }
      return send(res, 200, {
        limits: [
          {
            type_category: "standard",
            limit_bucket: "Standard",
            max_quantity: overrides[key] ?? null,
          },
        ],
        cap_mode: "warn",
      });
    }
    return send(res, 404, "");
  };
}

test("A02 passes when B sees nothing of A, and fails when it does", async () => {
  const id = await serve(identityStub({ "a@x": "pa", "b@x": "pb" }));
  const env = {
    VERIFY_FIREBASE_API_KEY: "k",
    VERIFY_EMAIL: "a@x",
    VERIFY_PASSWORD: "pa",
    VERIFY_B_EMAIL: "b@x",
    VERIFY_B_PASSWORD: "pb",
  };
  const good = await serve(tenantStub({ leak: false }));
  const state = {};
  const r = await a02({
    base: good.url,
    envName: "dev",
    env,
    identityUrl: id.url,
    state,
  });
  assert.equal(r.status, "PASS", r.observed);
  assert.ok(state.deletedToken);
  const bad = await serve(tenantStub({ leak: true }));
  const r2 = await a02({
    base: bad.url,
    envName: "dev",
    env,
    identityUrl: id.url,
    state: {},
  });
  assert.equal(r2.status, "FAIL");
  assert.match(r2.observed, /B sees A's share/);
  assert.equal(
    (await a02({ base: good.url, envName: "prod", env, state: {} })).status,
    "SKIP",
  );
  assert.equal(
    (await a02({ base: good.url, envName: "dev", env: {}, state: {} })).status,
    "SKIP",
  );
});

test("A02 limits check: a leak of B's override into A fails; an ineffective write fails", async () => {
  const id = await serve(identityStub({ "a@x": "pa", "b@x": "pb" }));
  const env = {
    VERIFY_FIREBASE_API_KEY: "k",
    VERIFY_EMAIL: "a@x",
    VERIFY_PASSWORD: "pa",
    VERIFY_B_EMAIL: "b@x",
    VERIFY_B_PASSWORD: "pb",
  };
  const run = (stub) =>
    serve(stub).then((s) =>
      a02({
        base: s.url,
        envName: "dev",
        env,
        identityUrl: id.url,
        state: {},
      }).then((r) => ({ r, s })),
    );
  const leak = await run(tenantStub({ leak: false, leakLimits: true }));
  assert.equal(leak.r.status, "FAIL");
  assert.match(leak.r.observed, /A's limits changed after B's PUT/);
  const noop = await run(tenantStub({ leak: false, ignorePut: true }));
  assert.equal(noop.r.status, "FAIL");
  assert.match(noop.r.observed, /did not apply/);
  const clean = await run(tenantStub({ leak: false }));
  assert.equal(clean.r.status, "PASS", clean.r.observed);
  // cleanup: B's override was reset to default after the check
  const bLimits = await request(
    { timeoutMs: 3000 },
    "GET",
    `${clean.s.url}/api/settings/limits`,
    {
      headers: { authorization: "Bearer tok:b@x" },
    },
  );
  assert.equal(JSON.parse(bLimits.text).limits[0].max_quantity, null);
  const last = clean.s.hits.filter((h) => h.method === "PUT").at(-1);
  assert.deepEqual(JSON.parse(last.body), { limits: [] });
});

// ---------- output and CLI ----------

test("formatLines prints the row format and a verdict; exit code follows FAIL only", () => {
  const rows = [
    { id: "A01", claim: "c1", observed: "o1", status: "PASS", reason: "" },
    {
      id: "A05",
      claim: "c5",
      observed: "-",
      status: "SKIP",
      reason: "no creds",
    },
  ];
  assert.deepEqual(formatLines(rows), [
    "A01 c1 | o1 | PASS",
    "A05 c5 | - | SKIP(no creds)",
    "verdict: ok (1 run, 1 skipped)",
  ]);
  assert.equal(exitCodeFor(rows), 0);
  const failing = [
    ...rows,
    { id: "A03", claim: "c3", observed: "o3", status: "FAIL", reason: "why" },
  ];
  assert.equal(exitCodeFor(failing), 1);
  const lines = formatLines(failing);
  assert.equal(lines.at(-1), "verdict: check A03");
  assert.ok(lines.includes("  why: why"));
});

test("parseArgs and --only selection", async () => {
  const a = parseArgs([
    "--base",
    "https://x/",
    "--env",
    "dev",
    "--only",
    "a01, A03",
    "--direct",
    "https://d/",
  ]);
  assert.equal(a.base, "https://x");
  assert.equal(a.direct, "https://d");
  assert.deepEqual(a.only, ["A01", "A03"]);
  assert.equal(parseArgs(["--help"]).help, true);
  const seen = await runChecks(
    { base: "http://x", envName: "prod", env: {}, state: {} },
    ["A07", "A03"],
  );
  assert.deepEqual(
    seen.map((r) => r.id),
    ["A03", "A07"],
  );
});
