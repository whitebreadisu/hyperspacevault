import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, Route } from "@playwright/test";

// BL-247 S1-10: the API double for the mobile e2e suite. Every /api/** and
// card-image request is answered from committed fixtures (gen-fixtures.mjs);
// anything unanswered is a 404 recorded as a failed request so measure()
// (helpers.ts) fails the test that caused it.

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(join(here, "fixtures", name));
const json = <T>(name: string): T => JSON.parse(read(name).toString("utf8")) as T;
const PX = read("px.webp");

export type CardsFixture = "base-cards" | "base-cards-600";

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
  };
  recorders.set(page, rec);

  page.on("pageerror", (e) => rec.pageErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") rec.consoleErrors.push(m.text());
  });
  page.on("requestfailed", (r) => {
    // S1-19: an image the virtualised list unmounts (or a navigation drops)
    // mid-load is cancelled by the browser -- not a failed request.
    if (r.resourceType() === "image" && r.failure()?.errorText === "net::ERR_ABORTED") return;
    rec.failed.push(`${r.method()} ${r.url()} (${r.failure()?.errorText})`);
  });

  const cards = json<Slim[]>(`${opts.fixture ?? "base-cards"}.json`);
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
      if (method === "GET" && path === "/api/inventory/quantities") return ok(route, quantities);
      if (method === "GET" && path === "/api/settings/limits")
        return ok(route, json("limits.json"));
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
