import { describe, expect, it } from "vitest";
import {
  buildSitemaps,
  fileForPath,
  isSitemapIndex,
  parseLocs,
  setSitemapPath,
} from "./sitemaps.mjs";

const PROD = "https://www.hyperspacevault.com";

describe("sitemaps (§5)", () => {
  const files = buildSitemaps({
    origin: PROD + "/",
    corePaths: ["/", "/cards/", "/cards/sor/", "/cards/twi/", "/cards/gg/"],
    sets: [
      { code: "SOR", paths: ["/cards/sor/005/", "/cards/sor/010/"] },
      { code: "TWI", paths: ["/cards/twi/001/"] },
      { code: "GG", paths: [] },
    ],
    lastmodOf: (p) => (p === "/cards/sor/010/" ? "2026-11-02" : null),
  });
  const byPath = Object.fromEntries(files.map((f) => [f.path, f]));

  it("writes an index at /sitemap.xml pointing at core and one sitemap per set with pages", () => {
    expect(files.map((f) => f.path)).toEqual([
      "/sitemap.xml",
      "/sitemaps/core.xml",
      "/sitemaps/cards-sor.xml",
      "/sitemaps/cards-twi.xml",
    ]);
    const index = byPath["/sitemap.xml"].xml;
    expect(isSitemapIndex(index)).toBe(true);
    expect(parseLocs(index)).toEqual([
      `${PROD}/sitemaps/core.xml`,
      `${PROD}/sitemaps/cards-sor.xml`,
      `${PROD}/sitemaps/cards-twi.xml`,
    ]);
  });

  it("uses absolute URLs on the origin, lastmod only where given, never changefreq or priority", () => {
    const sor = byPath["/sitemaps/cards-sor.xml"].xml;
    expect(isSitemapIndex(sor)).toBe(false);
    expect(sor).toContain(`<url><loc>${PROD}/cards/sor/005/</loc></url>`);
    expect(sor).toContain(
      `<url><loc>${PROD}/cards/sor/010/</loc><lastmod>2026-11-02</lastmod></url>`
    );
    // The index entry carries its child's newest lastmod.
    expect(byPath["/sitemap.xml"].xml).toContain(
      `<sitemap><loc>${PROD}/sitemaps/cards-sor.xml</loc><lastmod>2026-11-02</lastmod></sitemap>`
    );
    for (const f of files) expect(f.xml).not.toMatch(/changefreq|priority/);
    expect(parseLocs(byPath["/sitemaps/core.xml"].xml)).toHaveLength(5);
  });

  it("writes a dev origin when given one", () => {
    const [index] = buildSitemaps({
      origin: "https://swu-dev-jbapps.web.app",
      corePaths: ["/"],
      sets: [],
    });
    expect(parseLocs(index.xml)).toEqual(["https://swu-dev-jbapps.web.app/sitemaps/core.xml"]);
  });

  it("escapes and unescapes XML", () => {
    const [, core] = buildSitemaps({ origin: PROD, corePaths: ["/a&b/"], sets: [] });
    expect(core.xml).toContain("/a&amp;b/");
    expect(parseLocs(core.xml)).toEqual([`${PROD}/a&b/`]);
  });

  it("maps paths to the files Hosting serves", () => {
    expect(fileForPath("/")).toBe("index.html");
    expect(fileForPath("/cards/sor/005/")).toBe("cards/sor/005/index.html");
    expect(fileForPath("/sitemaps/core.xml")).toBe("sitemaps/core.xml");
    expect(setSitemapPath("SOR")).toBe("/sitemaps/cards-sor.xml");
  });
});
