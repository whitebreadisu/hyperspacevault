import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, Route } from "@playwright/test";
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
  };
  recorders.set(page, rec);

  page.on("pageerror", (e) => rec.pageErrors.push(String(e)));
  page.on("console", (m) => {
    // onnxruntime-web logs this CPU-detection line as console.error on every
    // load; the BL-238 spike filtered it too (smoke_test.js). Not an app error.
    if (m.type() === "error" && !/Unknown CPU vendor/.test(m.text()))
      rec.consoleErrors.push(m.text());
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
