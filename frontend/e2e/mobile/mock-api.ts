import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, Request, Route } from "@playwright/test";
import { scanCards } from "./scan-fixture";

// BL-247 S1-10: the API double for the mobile e2e suite. Every /api/** and
// card-image request is answered from committed fixtures (gen-fixtures.mjs);
// anything unanswered is a 404 recorded as a failed request so measure()
// (helpers.ts) fails the test that caused it.

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(join(here, "fixtures", name));
const json = <T>(name: string): T => JSON.parse(read(name).toString("utf8")) as T;
const PX = read("px.webp");

export type CardsFixture = "base-cards" | "base-cards-600" | "base-cards-scan";

interface Slim {
  id: number;
  variants: { variant_id: number; [k: string]: unknown }[];
  [k: string]: unknown;
}

export interface Recorder {
  failed: string[];
  consoleErrors: string[];
  pageErrors: string[];
  /** Bodies POSTed to /api/feedback. */
  feedback: unknown[];
  /** BL-248 S2-05: POST /api/inventory/{id}/adjust calls, in order. */
  adjust: { variantId: number; delta: number }[];
  /** BL-248 S2-07: GET /api/base-cards/{id}/price-history queries, in order. */
  priceHistory: { baseCardId: number; variantId: number; range: string }[];
  /** BL-251 S5-01: PUT /api/settings/limits bodies, in order. */
  limitPuts: { limits: unknown[]; cap_mode?: string }[];
  /** BL-251 S5-07: share calls ("create Name" | "rename Name" | "rotate" |
   * "revoke"), in order. */
  shares: string[];
  /** BL-249 S3-15: POST /api/inventory/import calls (multipart fields + the
   * file's JSON), in order. */
  imports: { mode: string; capHandling: string; stage: string; file: ImportFile }[];
  /** BL-250 S4-09: GET /api/inventory/export?format= and /api/catalog/reference.csv
   * requests ("json" | "csv" | "reference"), in order. */
  exports: string[];
  /** BL-252 S6: GET /api/shared/{token}[/quantities|/limits] paths, in order. */
  sharedReads: string[];
  /** BL-255: requests to a host that is neither this machine nor answered by
   * the harness (stubExternal). Each one was aborted, and the shared `page`
   * fixture fails the test that made it. */
  external: string[];
  /** BL-255 part 5: reads (and the app's log of them) that the page's own
   * navigation aborted -- excused from `failed` / `consoleErrors`, kept here. */
  navAborted: string[];
}

// ── BL-255 part 2: the suite never talks to the internet ───────────────────
// The app under test asks three internet hosts for things at start-up. Each
// is answered here, in the one place every page of the suite goes through:
//
//  - https://apis.google.com/js/api.js (+ its gapi module) -- the Firebase
//    Auth SDK's helper for popup / redirect sign-in. On a phone user agent the
//    SDK waits for it BEFORE it restores the stored session
//    (`_shouldInitProactively`), so the signed-in state of every phone test
//    hung on a live Google request; a dropped one also logged a console error
//    (`net::ERR_CONNECTION_CLOSED`) that failed whichever test was running.
//    Answered with "loader present, gapi.load unavailable": the SDK takes its
//    own "could not load" branch (the error is swallowed by design -- "if
//    this fails, don't halt auth loading"), restores the session at once and
//    never asks for the helper iframe. Email / password sign-in and session
//    restore -- everything the suite uses -- do not need it.
//  - https://fonts.googleapis.com/css2 + https://fonts.gstatic.com/** -- the
//    web fonts (src/index.css). Served from fixtures/fonts (the stylesheet
//    and the 21 files it names), so the text-fit assertions always measure
//    Barlow / Barlow Condensed / Russo One, never a fallback face.
//  - https://cdn.starwarsunlimited.com/** card art: the 1 px image below.
//
// Anything else that is not this machine is aborted and recorded in
// `rec.external`; helpers.ts fails the test on a non-empty list.
const FONT_DIR = join(here, "fixtures", "fonts");
const FONT_CSS = readFileSync(join(FONT_DIR, "google-fonts.css"));
const FONT_FILES = new Map(
  readdirSync(FONT_DIR)
    .filter((f) => f.endsWith(".woff2"))
    .map((f) => [f, readFileSync(join(FONT_DIR, f))] as const)
);
const CORS = { "access-control-allow-origin": "*" };
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The gapi loader's answer: `gapi` exists, `gapi.load` does not, and the
 * SDK's `?onload=` callback is called so its promise settles (an answer that
 * never calls it would leave Auth initialisation waiting for ever). */
function gapiStub(url: URL): string {
  const cb = url.searchParams.get("onload") ?? "";
  return (
    "window.gapi = window.gapi || {};\n" +
    (/^[\w$]+$/.test(cb) ? `if (typeof window.${cb} === "function") window.${cb}();\n` : "")
  );
}

/** Answer the app's internet requests locally and abort every other
 * non-local request, recording it in `external`. Installed by
 * installApiMocks; a spec that opens a page of its own calls it directly. */
export async function stubExternal(page: Page, external: string[]): Promise<void> {
  // Registered first, so every route added after it (below, in
  // installApiMocks, or by a spec) is asked before this catch-all.
  await page.route(
    (u) => /^https?:$/.test(u.protocol) && !LOCAL_HOSTS.has(u.hostname),
    (route) => {
      external.push(`${route.request().method()} ${route.request().url()}`);
      return route.abort("blockedbyclient");
    }
  );
  await page.route("https://apis.google.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: gapiStub(new URL(route.request().url())),
    })
  );
  await page.route("https://fonts.googleapis.com/css2**", (route) =>
    route.fulfill({ status: 200, contentType: "text/css", headers: CORS, body: FONT_CSS })
  );
  await page.route("https://fonts.gstatic.com/**", (route) => {
    const body = FONT_FILES.get(new URL(route.request().url()).pathname.split("/").pop() ?? "");
    // A file the stylesheet fixture does not name: let the catch-all record it.
    if (!body) return route.fallback();
    return route.fulfill({ status: 200, contentType: "font/woff2", headers: CORS, body });
  });
}

// ── BL-255 part 5: reads aborted by the test's own navigation ──────────────
// Since the suite is hermetic (part 2) Firebase Auth resolves at once, so the
// app starts its signed-in API reads (limits, sets, ...) the moment a document
// loads. A test that navigates again straight away (page.goto / page.reload)
// aborts those reads in the browser. Two things then reach the health check:
//   1. the request ends `requestfailed` with net::ERR_ABORTED, same origin
//      (counted in `failed`, which only excuses images / third parties), and
//   2. the app's own catch logs console.error("Failed to fetch inventory
//      limits:", TypeError: Failed to fetch) (LimitsContext, FilterPanel,
//      CardsPage) -- counted in `consoleErrors`.
// Both are artefacts of the test leaving the document, not of the app failing.
//
// The rule, deliberately narrow so it cannot hide a real failure:
//  - A request is "navigation-aborted" only if ALL hold: it is a main-frame
//    fetch / xhr to this machine and an /api/ path (or the Auth emulator's own
//    token calls); it ended net::ERR_ABORTED; and a main-frame NAVIGATION
//    request had been issued by then that had not yet committed its document
//    (or committed after this request started). The comparison is on one
//    event counter, not on clocks. (A request can START after the navigation
//    request is issued: the old document keeps running until the new one
//    commits -- seen on CI-like load.) A 4xx/5xx, route.abort() ("failed"), a
//    refused connection, or an ERR_ABORTED with no navigation pending is not
//    excused and is recorded as before.
//  - A console error is excused only if it is one of the app's three
//    read-failure messages, ends in "TypeError: Failed to fetch" (what fetch()
//    throws for an abort), AND there is a navigation-aborted request for the
//    path that message names, that started before the message, not already
//    claimed by an earlier message (one request excuses one message). Any other
//    console error text, or a second message for the same request, stays.
// Excused entries move to `rec.navAborted`, so they stay visible to a test.
const READ_LOG: { message: RegExp; path: RegExp }[] = [
  {
    message: /^Failed to fetch inventory limits: TypeError: Failed to fetch(\n|$)/,
    path: /^\/api\/settings\/limits$/,
  },
  {
    message: /^Failed to fetch shared vault limits: TypeError: Failed to fetch(\n|$)/,
    path: /^\/api\/shared\/[^/]+\/limits$/,
  },
  {
    message: /^Failed to load sets: TypeError: Failed to fetch(\n|$)/,
    path: /^\/api\/sets$/,
  },
];

interface Aborted {
  path: string;
  startSeq: number;
  claimed: boolean;
}

/** A main-frame document request: issued at `req`, and not yet `done` (its
 * document committed, or the request itself failed) until `commit` is set. */
interface Nav {
  req: number;
  url: string;
  commit: number | null;
}

const noFragment = (u: string): string => u.split("#")[0];

class NavAbortLedger {
  private seq = 0;
  private started = new Map<Request, number>();
  private navs: Nav[] = [];
  private navOf = new Map<Request, Nav>();
  private aborted: Aborted[] = [];
  private consoleSeen: { text: string; seq: number }[] = [];

  constructor(
    private page: Page,
    private rec: Recorder
  ) {}

  onRequest(r: Request): void {
    const n = ++this.seq;
    this.started.set(r, n);
    if (r.isNavigationRequest() && this.isMain(r)) {
      const nav = { req: n, url: noFragment(r.url()), commit: null };
      this.navs.push(nav);
      this.navOf.set(r, nav);
    }
  }

  /** The main frame committed a document at `url` (a same-document hash change
   * the app made itself has a different fragment-less URL, or none pending). */
  onFrameNavigated(url: string): void {
    const n = ++this.seq;
    const nav = this.navs.find((x) => x.commit === null && x.url === noFragment(url));
    if (nav) nav.commit = n;
  }

  /** True when `r` is a read the page's own navigation aborted. */
  onRequestFailed(r: Request): boolean {
    const end = ++this.seq;
    const nav = this.navOf.get(r);
    if (nav && nav.commit === null) nav.commit = end; // the navigation itself failed: no longer pending
    const start = this.started.get(r);
    if (start === undefined || r.failure()?.errorText !== "net::ERR_ABORTED") return false;
    if (r.resourceType() !== "fetch" && r.resourceType() !== "xhr") return false;
    const url = new URL(r.url());
    if (!LOCAL_HOSTS.has(url.hostname) || !this.isMain(r)) return false;
    const api = url.pathname.startsWith("/api/");
    const authEmulator =
      url.port === "9099" &&
      /^\/(identitytoolkit|securetoken)\.googleapis\.com\//.test(url.pathname);
    if (!api && !authEmulator) return false;
    // Aborted by a navigation: one was requested before this failure and either
    // had not committed yet, or committed after this request started.
    if (!this.navs.some((x) => x.req < end && (x.commit === null || x.commit > start)))
      return false;
    if (api) this.aborted.push({ path: url.pathname, startSeq: start, claimed: false });
    this.rec.navAborted.push(`${r.method()} ${r.url()}`);
    this.reconcile();
    return true;
  }

  onConsoleError(text: string): void {
    this.consoleSeen.push({ text, seq: ++this.seq });
    this.reconcile();
  }

  private isMain(r: Request): boolean {
    try {
      return r.frame() === this.page.mainFrame();
    } catch {
      return false; // a request with no frame (service worker): never excused
    }
  }

  /** Move every console error that a navigation-aborted read explains out of
   * `rec.consoleErrors`. Re-run on each event, because the console message can
   * reach us before the `requestfailed` that explains it. */
  private reconcile(): void {
    for (const c of [...this.consoleSeen]) {
      const rule = READ_LOG.find((l) => l.message.test(c.text));
      if (!rule) continue;
      const hit = this.aborted.find(
        (a) => !a.claimed && a.startSeq < c.seq && rule.path.test(a.path)
      );
      if (!hit) continue;
      hit.claimed = true;
      this.consoleSeen.splice(this.consoleSeen.indexOf(c), 1);
      const i = this.rec.consoleErrors.indexOf(c.text);
      if (i >= 0) this.rec.consoleErrors.splice(i, 1);
      this.rec.navAborted.push(`console: ${c.text.split("\n")[0]}`);
    }
  }
}

export interface ImportFile {
  format_version: string;
  cards: {
    swuapi_uuid: string;
    set_code: string;
    card_number: string;
    variant_type: string;
    quantity: number;
  }[];
}

/** The multipart body runImport sends: string fields + one JSON file part. */
function parseImport(body: string) {
  const field = (n: string) => body.match(new RegExp(`name="${n}"\r\n\r\n([^\r]*)`))?.[1] ?? "";
  const fileM = body.match(/filename="[^"]*"\r\nContent-Type: [^\r]*\r\n\r\n([\s\S]*?)\r\n--/);
  return {
    mode: field("mode"),
    capHandling: field("cap_handling"),
    stage: field("stage"),
    file: JSON.parse(fileM?.[1] ?? "{}") as ImportFile,
  };
}

const recorders = new WeakMap<Page, Recorder>();
export const recorderFor = (page: Page): Recorder =>
  recorders.get(page) ?? {
    failed: [],
    consoleErrors: [],
    pageErrors: [],
    feedback: [],
    adjust: [],
    priceHistory: [],
    limitPuts: [],
    shares: [],
    imports: [],
    exports: [],
    sharedReads: [],
    external: [],
    navAborted: [],
  };

/** S2-07: the price-history double -- daily points ending at PRICE_AS_OF, a
 * gentle deterministic wave that ends exactly on the printing's market price
 * (so the chart's latest reading equals the rail price); empty for a
 * printing with no market price. */
export const PRICE_AS_OF = "2026-09-26";
const RANGE_N: Record<string, number> = { "30d": 30, "90d": 90, "1y": 365, all: 400 };
export function priceSeries(market: number | null, range: string) {
  if (market == null) return [];
  const n = RANGE_N[range] ?? 90;
  const end = Date.parse(PRICE_AS_OF + "T00:00:00Z");
  return Array.from({ length: n }, (_, i) => {
    const back = n - 1 - i;
    const f = 1 + 0.25 * Math.sin(back / 9) * (back / n);
    return {
      as_of: new Date(end - back * 86400000).toISOString().slice(0, 10),
      market: Math.round(market * f * 100) / 100,
    };
  });
}

export async function installApiMocks(
  page: Page,
  opts: { fixture?: CardsFixture } = {}
): Promise<Recorder> {
  const rec: Recorder = {
    failed: [],
    consoleErrors: [],
    pageErrors: [],
    feedback: [],
    adjust: [],
    priceHistory: [],
    limitPuts: [],
    shares: [],
    imports: [],
    exports: [],
    sharedReads: [],
    external: [],
    navAborted: [],
  };
  recorders.set(page, rec);
  await stubExternal(page, rec.external);

  page.on("pageerror", (e) => rec.pageErrors.push(String(e)));
  // BL-255 part 5: reads the TEST's own navigation aborted are not failures
  // (rule and limits: NavAbortLedger, above).
  const ledger = new NavAbortLedger(page, rec);
  page.on("request", (r) => ledger.onRequest(r));
  page.on("framenavigated", (f) => f === page.mainFrame() && ledger.onFrameNavigated(f.url()));
  page.on("console", (m) => {
    // onnxruntime-web logs this CPU-detection line as console.error on every
    // load; the BL-238 spike filtered it too (smoke_test.js). Not an app error.
    if (m.type() === "error" && !/Unknown CPU vendor/.test(m.text())) {
      rec.consoleErrors.push(m.text());
      ledger.onConsoleError(m.text());
    }
  });
  page.on("requestfailed", (r) => {
    // S1-19: an image the virtualised list unmounts (or a navigation drops)
    // mid-load is cancelled by the browser -- not a failed request.
    if (r.resourceType() === "image" && r.failure()?.errorText === "net::ERR_ABORTED") return;
    // S7 (7c): the document hop to /scan/ (a full navigation) can abort the
    // Auth emulator's helper iframe that the leaving document was still
    // loading -- the navigation did it, not a failed request.
    if (r.failure()?.errorText === "net::ERR_ABORTED" && r.url().includes("/emulator/auth/iframe"))
      return;
    // BL-255: a request the hermetic catch-all aborted is reported once, by
    // name, through `rec.external` (not a second time as a failed request).
    if (r.failure()?.errorText === "net::ERR_BLOCKED_BY_CLIENT") return;
    // BL-255 part 5: an /api/ read the page's own navigation aborted.
    if (ledger.onRequestFailed(r)) return;
    // A reload/navigation aborts in-flight third-party pixels (e.g. google.com
    // cleardot.gif) -- noise. Only same-origin (the app's localhost) aborts count.
    if (r.failure()?.errorText === "net::ERR_ABORTED") {
      let host = "";
      try {
        host = new URL(r.url()).hostname;
      } catch {
        /* unparsable URL: treat as same-origin and keep failing */
      }
      if (host && host !== "localhost" && host !== "127.0.0.1") return;
    }
    rec.failed.push(`${r.method()} ${r.url()} (${r.failure()?.errorText})`);
  });

  const cards =
    opts.fixture === "base-cards-scan"
      ? (scanCards() as Slim[])
      : json<Slim[]>(`${opts.fixture ?? "base-cards"}.json`);
  const sets = json<{ code: string; name: string }[]>("sets.json");
  const quantities = json<{ variant_id: number; quantity: number }[]>("quantities.json");
  const qtyById = new Map(quantities.map((q) => [q.variant_id, q.quantity]));
  const markets = new Map<number, number | null>();
  for (const c of cards)
    for (const v of c.variants)
      markets.set(
        v.variant_id,
        (v as { price?: { market: number | null } | null }).price?.market ?? null
      );
  type LimitsFixture = {
    cap_mode: string;
    limits: { type_category: string; limit_bucket: string; max_quantity: number | null }[];
  };
  let limitsOverrides: LimitsFixture["limits"] = [];
  let limitsCapMode: string | null = null;
  const limitsBody = () => {
    const base = json<LimitsFixture>("limits.json");
    return {
      cap_mode: limitsCapMode ?? base.cap_mode,
      limits: base.limits.map((c) => {
        const o = limitsOverrides.find(
          (x) => x.type_category === c.type_category && x.limit_bucket === c.limit_bucket
        );
        return o ? { ...c, max_quantity: o.max_quantity, is_default: false } : c;
      }),
    };
  };
  // S5-07: the shares double -- one active inventory share at most (§19.1),
  // starting empty; rotate mints a new token, revoke clears it.
  type ShareRow = {
    id: number;
    name: string;
    scope: "inventory";
    token: string;
    created_at: string;
    revoked: boolean;
  };
  let share: ShareRow | null = null;
  let tokenSeq = 0;
  const nextToken = () => `e2e-share-token-${++tokenSeq}`;
  const ok = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  // Path-prefix match, not a glob: Vite serves source modules from /src/api/*.
  await page.route(
    (u) => u.pathname.startsWith("/api/"),
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const path = url.pathname;
      const method = req.method();

      if (method === "GET" && path === "/api/base-cards") return ok(route, cards);
      if (method === "GET" && path === "/api/sets") return ok(route, sets);
      // S3-15: the quantities reflect the adjust / import doubles below, so a
      // refresh after a commit reads what was written (a fresh page = fixture).
      if (method === "GET" && path === "/api/inventory/quantities")
        return ok(
          route,
          [...qtyById].map(([variant_id, quantity]) => ({ variant_id, quantity }))
        );
      // S5-01: the limits double keeps what the last PUT wrote (a full
      // replacement of the override set, as the backend does).
      if (method === "GET" && path === "/api/settings/limits") return ok(route, limitsBody());
      if (method === "PUT" && path === "/api/settings/limits") {
        const body = req.postDataJSON() as {
          limits: { type_category: string; limit_bucket: string; max_quantity: number | null }[];
          cap_mode?: string;
        };
        rec.limitPuts.push(body);
        limitsOverrides = body.limits;
        if (body.cap_mode) limitsCapMode = body.cap_mode;
        return ok(route, limitsBody());
      }
      if (path === "/api/shares" && method === "GET") return ok(route, share ? [share] : []);
      if (path === "/api/shares" && method === "POST") {
        const { name } = req.postDataJSON() as { name: string };
        rec.shares.push("create " + name);
        share = {
          id: 1,
          name,
          scope: "inventory",
          token: nextToken(),
          created_at: "2026-10-11T12:00:00Z",
          revoked: false,
        };
        return ok(route, share, 201);
      }
      const shareId = path.match(/^\/api\/shares\/(\d+)(\/rotate)?$/);
      if (shareId && share) {
        if (method === "PATCH") {
          const { name } = req.postDataJSON() as { name: string };
          rec.shares.push("rename " + name);
          share = { ...share, name };
          return ok(route, share);
        }
        if (method === "POST" && shareId[2]) {
          rec.shares.push("rotate");
          share = { ...share, token: nextToken() };
          return ok(route, share);
        }
        if (method === "DELETE") {
          rec.shares.push("revoke");
          share = null;
          // The real endpoint answers 204. F4 (2026-10-11): fulfill({ status: 204 }) with no
          // body still aborts in Chromium (ERR_ABORTED, "failed requests"); revokeShare only
          // checks res.ok -- so 200 + {}.
          return ok(route, {});
        }
      }
      // BL-252 S6: the read-only share surface (api/sharedView.ts). `tok-1`
      // resolves to "Rowan" with its own quantities (the first printing of
      // every third catalogue card, x2 -- distinct from the caller's own);
      // `tok-long` carries a 30-character name; `tok-slow` answers after
      // 1.5 s; `tok-404` / `tok-429` are the invalid and rate-limited answers.
      const shared = path.match(/^\/api\/shared\/([^/]+)(\/quantities|\/limits)?$/);
      if (method === "GET" && shared) {
        rec.sharedReads.push(path);
        const tok = decodeURIComponent(shared[1]);
        const names: Record<string, string> = {
          "tok-1": "Rowan",
          "tok-slow": "Rowan",
          "tok-long": "Rowan's Big Hyperspace Binder!",
        };
        if (tok === "tok-429")
          return route.fulfill({
            status: 429,
            headers: { "Retry-After": "30" },
            contentType: "application/json",
            body: '{"detail":"rate limited"}',
          });
        if (!names[tok]) return ok(route, { detail: "Not found" }, 404);
        if (shared[2] === "/quantities")
          return ok(
            route,
            cards
              .filter((_, i) => i % 3 === 0)
              .map((c) => ({ variant_id: c.variants[0].variant_id, quantity: 2 }))
          );
        if (shared[2] === "/limits") return ok(route, json("limits.json"));
        if (tok === "tok-slow") await new Promise((r) => setTimeout(r, 1500));
        return ok(route, { name: names[tok], scope: "inventory" });
      }
      if (method === "GET" && path === "/api/account") return ok(route, json("account.json"));
      // S2-05: the stepper's batched adjust; the double keeps the quantities
      // it answers with (a later GET of /quantities still reads the fixture).
      const adj = path.match(/^\/api\/inventory\/(\d+)\/adjust$/);
      if (method === "POST" && adj) {
        const variantId = Number(adj[1]);
        const delta = Number((req.postDataJSON() as { delta: number }).delta);
        rec.adjust.push({ variantId, delta });
        const quantity = Math.max(0, (qtyById.get(variantId) ?? 0) + delta);
        qtyById.set(variantId, quantity);
        return ok(route, {
          variant_id: variantId,
          quantity,
          applied: delta,
          requested: delta,
          blocked: false,
          reason: null,
          over_limit: false,
          playset_complete: false,
        });
      }
      // S3-15: precon commits (runImport). Rows resolve on set | number |
      // variant_type against the fixture catalogue; a commit writes them.
      if (method === "POST" && path === "/api/inventory/import") {
        const imp = parseImport(req.postDataBuffer()?.toString("latin1") ?? "");
        rec.imports.push(imp);
        const seen = new Set<number>();
        const rows = imp.file.cards.map((c, i) => {
          let vid: number | null = null;
          for (const card of cards)
            for (const v of card.variants)
              if (
                v["source_set_code"] === c.set_code &&
                v["card_number"] === c.card_number &&
                v["variant_type"] === c.variant_type
              )
                vid ??= v.variant_id;
          if (vid === null)
            return { row_number: i + 1, status: "unresolved", reason: "unknown_triple", card: c };
          const cur = qtyById.get(vid) ?? 0;
          const next = imp.mode === "merge_add" ? cur + c.quantity : c.quantity;
          seen.add(vid);
          if (imp.stage === "commit") qtyById.set(vid, next);
          return {
            row_number: i + 1,
            status: "resolved",
            card: c,
            file_quantity: c.quantity,
            current_quantity: cur,
            resulting_quantity: next,
          };
        });
        // replace_all: everything owned that the file does not list goes
        // (S4-11: the removal list the confirmation counts).
        const removed =
          imp.mode === "replace_all"
            ? [...qtyById]
                .filter(([vid, q]) => q > 0 && !seen.has(vid))
                .map(([vid, q]) => ({ card: { swuapi_uuid: "variant-" + vid }, quantity: q }))
            : [];
        if (imp.stage === "commit" && imp.mode === "replace_all")
          for (const r of removed) qtyById.set(Number(r.card.swuapi_uuid.slice(8)), 0);
        const resolved = rows.filter((r) => r.status === "resolved").length;
        return ok(route, {
          stage: imp.stage,
          mode: imp.mode,
          cap_handling: imp.capHandling,
          committed: imp.stage === "commit",
          totals: {
            rows: rows.length,
            resolved,
            matched_by_fallback: 0,
            unresolved: rows.length - resolved,
            ambiguous: 0,
            trimmed: 0,
            ceiling_clamped: 0,
            duplicate_rows_merged: 0,
            unrecognized_columns: [],
            removed_by_replace_all: removed.length,
          },
          rows,
          removed,
        });
      }
      // S4-09: the two inventory exports and the public catalogue reference.
      if (method === "GET" && path === "/api/inventory/export") {
        const format = url.searchParams.get("format") ?? "";
        rec.exports.push(format);
        return route.fulfill({
          status: 200,
          contentType: format === "csv" ? "text/csv" : "application/json",
          headers: {
            "Content-Disposition": `attachment; filename="hyperspacevault-inventory.${format}"`,
          },
          body: format === "csv" ? "set_code,card_number\n" : "{}",
        });
      }
      if (method === "GET" && path === "/api/catalog/reference.csv") {
        rec.exports.push("reference");
        return route.fulfill({
          status: 200,
          contentType: "text/csv",
          headers: {
            "Content-Disposition": 'attachment; filename="hyperspacevault-catalog-reference.csv"',
          },
          body: "set_code,card_number\n",
        });
      }
      if (method === "POST" && path === "/api/feedback") {
        rec.feedback.push(req.postDataJSON());
        return ok(route, { ok: true });
      }
      const price = path.match(/^\/api\/base-cards\/(\d+)\/price-history$/);
      if (method === "GET" && price) {
        const variantId = Number(url.searchParams.get("variant_id") ?? 0);
        const range = url.searchParams.get("range") ?? "90d";
        rec.priceHistory.push({ baseCardId: Number(price[1]), variantId, range });
        return ok(route, {
          variant_id: variantId,
          range,
          series: priceSeries(markets.get(variantId) ?? null, range),
        });
      }
      const detail = path.match(/^\/api\/base-cards\/(\d+)$/);
      if (method === "GET" && detail) {
        const c = cards.find((x) => x.id === Number(detail[1]));
        if (c) {
          return ok(route, {
            ...c,
            set_name: sets.find((s) => s.code === c["set_code"])?.name ?? c["set_code"],
            type2: null,
            double_sided: false,
            is_unique: null,
            front_text: null,
            back_text: null,
            epic_action: null,
            artist: null,
            variants: c.variants.map((v) => ({
              ...v,
              stamped: false,
              source_set_name: "",
              stamp_group: null,
              quantity: qtyById.get(v.variant_id) ?? 0,
            })),
          });
        }
      }
      // An unanswered API call is a test failure (measure() reads this list).
      rec.failed.push(`${method} ${req.url()} (no fixture)`);
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: '{"detail":"no fixture"}',
      });
    }
  );

  const image = (route: Route) =>
    route.fulfill({ status: 200, contentType: "image/webp", body: PX });
  await page.route((u) => u.pathname.startsWith("/images/cards/"), image);
  await page.route("https://cdn.starwarsunlimited.com/**", image);
  return rec;
}
