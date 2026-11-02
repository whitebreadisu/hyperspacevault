import { describe, expect, it, vi } from "vitest";
import { GuardError, checkCompleteness, checkShrink, liveCardBaseline } from "./guards.mjs";
import { buildSitemaps } from "./sitemaps.mjs";

const card = (set, num, is_token = false) => ({ set_code: set, base_card_number: num, is_token });

describe("completeness guard (§3 guard 1)", () => {
  const catalog = {
    counts: { SOR: 2, TWI: 1 },
    cards: [card("SOR", "5"), card("SOR", "10"), card("TWI", "1"), card("TWI", "1", true)],
  };
  const list = [{ is_token: false }, { is_token: false }, { is_token: false }, { is_token: true }];

  it("passes when the catalog, sum(counts) and the list's non-token rows agree", () => {
    const r = checkCompleteness({ catalog, baseCardList: list, pagesRendered: 3 });
    expect(r.count).toBe(3);
    expect(r.line).toMatch(/^completeness: 3 non-token cards/);
  });

  it("fails on a partial catalog read", () => {
    const partial = { ...catalog, cards: catalog.cards.slice(1) };
    expect(() => checkCompleteness({ catalog: partial, baseCardList: list })).toThrow(
      /catalog has 2 non-token cards but sum\(counts\) is 3; set SOR: 1 non-token cards, counts says 2/
    );
  });

  it("fails when the list endpoint disagrees (tokens are not counted)", () => {
    expect(() => checkCompleteness({ catalog, baseCardList: list.slice(1) })).toThrow(
      /GET \/api\/base-cards has 2 non-token rows but sum\(counts\) is 3/
    );
  });

  it("fails when equal totals hide a per-set mismatch", () => {
    const skew = { ...catalog, counts: { SOR: 1, TWI: 2 } };
    expect(() => checkCompleteness({ catalog: skew, baseCardList: list })).toThrow(
      /set SOR: 2 .* says 1; set TWI: 1 .* says 2/
    );
  });

  it("fails when fewer pages were rendered than counted", () => {
    expect(() => checkCompleteness({ catalog, baseCardList: list, pagesRendered: 2 })).toThrow(
      GuardError
    );
  });
});

function site(files) {
  return vi.fn(async (url) => {
    const path = new URL(url).pathname;
    if (!(path in files)) return { ok: false, status: 404, text: async () => "" };
    const v = files[path];
    if (typeof v === "number") return { ok: false, status: v, text: async () => "" };
    return { ok: true, status: 200, text: async () => v };
  });
}

const PLAIN = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.hyperspacevault.com/</loc>
    <changefreq>daily</changefreq>
  </url>
</urlset>`;

describe("live baseline (§3 guard 2)", () => {
  it("is 0 for today's one-URL urlset (first deploy)", async () => {
    const r = await liveCardBaseline({
      origin: "https://www.hyperspacevault.com",
      fetch: site({ "/sitemap.xml": PLAIN }),
    });
    expect(r).toEqual({
      baseline: 0,
      source: "live urlset without card URLs (first deploy)",
      sitemaps: 0,
    });
  });

  it("counts card URLs across the index's set sitemaps, not core pages", async () => {
    const files = buildSitemaps({
      origin: "https://swu-dev-jbapps.web.app",
      corePaths: ["/", "/cards/", "/cards/sor/", "/cards/twi/"],
      sets: [
        { code: "SOR", paths: ["/cards/sor/005/", "/cards/sor/010/"] },
        { code: "TWI", paths: ["/cards/twi/001/"] },
      ],
    });
    const served = Object.fromEntries(files.map((f) => [f.path, f.xml]));
    const fetch = site(served);
    const r = await liveCardBaseline({ origin: "https://swu-dev-jbapps.web.app/", fetch });
    expect(r.baseline).toBe(3);
    expect(r.sitemaps).toBe(3);
    expect(fetch).toHaveBeenCalledWith(
      "https://swu-dev-jbapps.web.app/sitemaps/cards-twi.xml",
      expect.anything()
    );
  });

  it("fails closed on an unreadable sitemap", async () => {
    await expect(
      liveCardBaseline({ origin: "https://x", fetch: site({ "/sitemap.xml": 503 }) })
    ).rejects.toThrow(/HTTP 503/);
    await expect(liveCardBaseline({ origin: "https://x", fetch: site({}) })).rejects.toThrow(
      /HTTP 404/
    );
    const index = buildSitemaps({
      origin: "https://x",
      corePaths: ["/"],
      sets: [{ code: "SOR", paths: ["/cards/sor/005/"] }],
    })[0].xml;
    await expect(
      liveCardBaseline({ origin: "https://x", fetch: site({ "/sitemap.xml": index }) })
    ).rejects.toThrow(/sitemaps\/core\.xml returned HTTP 404/);
  });
});

describe("shrink decision (§3 guard 2)", () => {
  it("passes on a 0 baseline", () => {
    expect(checkShrink({ baseline: 0, count: 5 }).line).toMatch(
      /baseline 0 .* passed \(first deploy\)/
    );
  });

  it("passes at exactly 95% and fails just below it", () => {
    expect(checkShrink({ baseline: 100, count: 95 }).ok).toBe(true);
    expect(() => checkShrink({ baseline: 100, count: 94 })).toThrow(
      /94 card pages vs baseline 100 .*94\.0%.*below 95%; set allow shrink/
    );
  });

  it("lets the override through and says so for the job summary", () => {
    const r = checkShrink({
      baseline: 100,
      count: 50,
      allowShrink: true,
      overrideName: "allow_card_page_shrink",
    });
    expect(r).toMatchObject({ ok: true, overridden: true });
    expect(r.line).toMatch(/below 95%, ALLOWED by override \(allow_card_page_shrink\)/);
    expect(checkShrink({ baseline: 100, count: 100, allowShrink: true }).line).toMatch(
      /set, not needed/
    );
  });
});
