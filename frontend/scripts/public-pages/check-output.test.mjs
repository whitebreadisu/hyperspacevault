import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkOutput, checkPage, pageKind } from "./check-output.mjs";
import { buildSitemaps, fileForPath } from "./lib/sitemaps.mjs";

const PROD = "https://www.hyperspacevault.com";

function head(
  path,
  { noindex = false, desc = "Luke Skywalker, SOR 005. Leader. Current TCGplayer prices.", ld } = {}
) {
  const breadcrumb =
    ld ??
    JSON.stringify({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [],
    });
  return [
    `<title>Page ${path}</title>`,
    `<meta name="description" content="${desc}" />`,
    `<link rel="canonical" href="${PROD}${path}" />`,
    noindex ? `<meta name="robots" content="noindex" />` : "",
    `<meta property="og:description" content="${desc}" />`,
    `<script type="application/ld+json">${breadcrumb}</script>`,
    `<script type="module" crossorigin src="/assets/card-Ab12.js"></script>`,
  ].join("\n");
}

function cardPage(path, opts = {}) {
  const body =
    opts.body ??
    `<div id="pc-desktop"><h1>Luke Skywalker</h1><span>$3.99 as of Nov 1, 2026</span></div>
     <div id="pc-phone"><div class="m-title">Luke Skywalker</div></div>
     <script type="application/json" id="card-data">{"numberLabel":"SOR 005"}</script>`;
  return `<!doctype html><html><head>${head(path, opts)}</head><body>${body}</body></html>`;
}

const listPage = (path, opts = {}) =>
  `<!doctype html><html><head>${head(path, opts)}</head><body><h1>Cards</h1></body></html>`;

let dist;
function write(rel, text) {
  const f = join(dist, rel);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, text);
}

/** A small, valid dist: index, one set page, two card pages, sitemaps, manifest. */
function goodDist({ noindex = false } = {}) {
  const cards = ["/cards/sor/005/", "/cards/sor/010/"];
  write("index.html", "<!doctype html><div id=root></div>");
  write("assets/card-Ab12.js", "console.log('page bundle')");
  write("cards/index.html", listPage("/cards/", { noindex }));
  write("cards/sor/index.html", listPage("/cards/sor/", { noindex }));
  for (const p of cards) write(fileForPath(p), cardPage(p, { noindex }));
  for (const f of buildSitemaps({
    origin: PROD,
    corePaths: ["/", "/cards/", "/cards/sor/"],
    sets: [{ code: "SOR", paths: cards }],
  })) {
    write(fileForPath(f.path), f.xml);
  }
  const pages = Object.fromEntries(
    ["/cards/", "/cards/sor/", ...cards].map((p) => [p, { hash: "sha256:x", lastmod: null }])
  );
  write("sitemaps/manifest.json", JSON.stringify({ version: 1, pages }));
}

beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), "cp-check-"));
});
afterEach(() => rmSync(dist, { recursive: true, force: true }));

describe("checkOutput", () => {
  it("passes a valid prod dist with --expect-index", () => {
    goodDist();
    const r = checkOutput(dist, { expectNoindex: false });
    expect(r.problems).toEqual([]);
    expect(r).toMatchObject({ pages: 4, kinds: { card: 2, set: 1, index: 1 }, sitemapUrls: 5 });
  });

  it("passes a dev dist only with --expect-noindex, and a prod dist fails it", () => {
    goodDist({ noindex: true });
    expect(checkOutput(dist, { expectNoindex: true }).problems).toEqual([]);
    const asProd = checkOutput(dist, { expectNoindex: false }).problems;
    expect(asProd).toHaveLength(4);
    expect(asProd[0]).toMatch(/robots noindex meta present/);
  });

  it("flags a dev dist without noindex", () => {
    goodDist();
    expect(checkOutput(dist, { expectNoindex: true }).problems[0]).toMatch(
      /no robots noindex meta/
    );
  });

  it("flags a sitemap URL with no file and a page in no sitemap", () => {
    goodDist();
    rmSync(join(dist, "cards/sor/010"), { recursive: true });
    write("cards/sor/025/index.html", cardPage("/cards/sor/025/"));
    const p = checkOutput(dist, { expectNoindex: false }).problems;
    expect(p).toContain("/sitemaps/cards-sor.xml lists /cards/sor/010/, which has no file");
    expect(p).toContain("cards/sor/025/index.html is in no sitemap");
    expect(p).toContain("/sitemaps/manifest.json has no hash for /cards/sor/025/");
  });

  it("flags the official CDN in a page asset and a plain-urlset sitemap.xml", () => {
    goodDist();
    write("assets/card-Ab12.js", "fallback('https://cdn.starwarsunlimited.com//x.png')");
    write("sitemap.xml", `<urlset><url><loc>${PROD}/</loc></url></urlset>`);
    const p = checkOutput(dist, { expectNoindex: false }).problems;
    expect(p).toContain("page asset /assets/card-Ab12.js names cdn.starwarsunlimited.com");
    expect(p).toContain("sitemap.xml is not a sitemap index");
  });

  it("flags a missing dist outright", () => {
    expect(checkOutput(join(dist, "nope"), { expectNoindex: false }).problems).toContain(
      "no pages under cards/"
    );
  });
});

describe("checkPage", () => {
  const rel = "cards/sor/005/index.html";
  const check = (html, expectNoindex = false) => checkPage(html, { rel, expectNoindex });

  it("classifies pages by path", () => {
    expect(pageKind("cards/index.html")).toBe("index");
    expect(pageKind("cards/sor/index.html")).toBe("set");
    expect(pageKind(rel)).toBe("card");
    expect(pageKind("cards/sor/005/data.json")).toBeNull();
  });

  it("wants exactly one h1 (both layout trees count)", () => {
    const two = cardPage("/cards/sor/005/", {
      body: `<div id="pc-desktop"><h1>A</h1></div><div id="pc-phone"><h1 class="x">A</h1></div><script type="application/json" id="card-data">{}</script>`,
    });
    expect(check(two)).toEqual([`${rel}: 2 <h1> elements (want exactly 1)`]);
  });

  it("wants both trees and parseable card data", () => {
    const p = check(
      cardPage("/cards/sor/005/", {
        body: `<div id="pc-desktop"><h1>A</h1></div><script type="application/json" id="card-data">{oops</script>`,
      })
    );
    expect(p).toEqual([
      `${rel}: no phone layout tree (#pc-phone)`,
      `${rel}: #card-data JSON does not parse`,
    ]);
  });

  it("wants a canonical to prod for its own path, a title and a description", () => {
    const html = cardPage("/cards/sor/006/")
      .replace(/<title>[^<]*<\/title>/, "")
      .replace(/<meta name="description"[^>]*>/, "");
    expect(check(html)).toEqual([
      `${rel}: 0 <title> elements or an empty title`,
      `${rel}: canonical ${PROD}/cards/sor/006/ (want ${PROD}/cards/sor/005/)`,
      `${rel}: missing or empty meta description`,
    ]);
  });

  it("rejects price figures in snippets and JSON-LD, and bad JSON-LD", () => {
    expect(check(cardPage("/cards/sor/005/", { desc: "Now $3.99" }))).toEqual([
      `${rel}: price figure in meta description: $3.99`,
      `${rel}: price figure in og:description: $3.99`,
    ]);
    const offer = JSON.stringify({
      "@type": "Product",
      offers: { "@type": "Offer", price: "3.99" },
    });
    expect(check(cardPage("/cards/sor/005/", { ld: offer }))).toEqual([
      `${rel}: JSON-LD carries an Offer or a price`,
    ]);
    expect(check(cardPage("/cards/sor/005/", { ld: "{nope" }))[0]).toMatch(
      /JSON-LD does not parse/
    );
  });

  it("allows a price in the page body (only snippets are policed)", () => {
    expect(check(cardPage("/cards/sor/005/"))).toEqual([]);
  });

  it("rejects the official CDN anywhere in the page", () => {
    const html = cardPage("/cards/sor/005/").replace(
      "</body>",
      `<img src="https://cdn.starwarsunlimited.com//a.png"></body>`
    );
    expect(check(html)).toEqual([`${rel}: names cdn.starwarsunlimited.com`]);
  });
});
