import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "./generate.mjs";
import * as render from "../../src/public/render.tsx";

// The generator's backend mode end to end (design note §3 "Guards"): run()
// with hand-authored backend and live-site responses. Every network read goes
// through the injected fetch; the page bundle and renderer are the real
// render module with a minimal template (no Vite build). Each failing case
// must abort before anything is moved into dist.

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(here, "fixtures/catalog.json"), "utf8"));
const BACKEND = "https://backend.test";
const ORIGIN = "https://www.site.test";
const SHA = "abc123";
const TEMPLATE =
  "<!doctype html><html><head><!--pc-head--></head><body><!--pc-body-->" +
  '<script type="module" src="/assets/card.js"></script></body></html>';

const nonTokenRows = (catalog) => catalog.cards.map((c) => ({ is_token: !!c.is_token }));
const FIRST_DEPLOY_SITEMAP = `<?xml version="1.0"?><urlset><url><loc>${ORIGIN}/</loc></url></urlset>`;

function urlset(paths) {
  return `<?xml version="1.0"?><urlset>${paths
    .map((p) => `<url><loc>${ORIGIN}${p}</loc></url>`)
    .join("")}</urlset>`;
}

/** A fake fetch serving the backend's two reads and the live site's
 * sitemap and manifest. */
function fakeFetch({ catalog, list = nonTokenRows(catalog), sitemap = FIRST_DEPLOY_SITEMAP }) {
  const routes = {
    [`${BACKEND}/api/public/cards`]: () => Response.json({ ...catalog, build_sha: SHA }),
    [`${BACKEND}/api/base-cards`]: () => Response.json(list),
    [`${ORIGIN}/sitemap.xml`]: () => new Response(sitemap, { status: 200 }),
    [`${ORIGIN}/sitemaps/manifest.json`]: () => new Response("not found", { status: 404 }),
  };
  return vi.fn(async (url) => (routes[url] ?? (() => new Response("", { status: 599 })))());
}

let dist;
let stage;
beforeEach(() => {
  dist = mkdtempSync(join(tmpdir(), "cp-run-dist-"));
  stage = mkdtempSync(join(tmpdir(), "cp-run-stage-"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><div id=root></div>");
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dist, { recursive: true, force: true });
  rmSync(stage, { recursive: true, force: true });
});

const argv = () => [
  "--backend",
  BACKEND,
  "--expect-sha",
  SHA,
  "--origin",
  ORIGIN,
  "--images",
  "off",
  "--dist",
  dist,
];

function go(fetch) {
  return run(
    argv(),
    {},
    { fetch, buildBundles: async () => ({ template: TEMPLATE, render }), stageDir: stage }
  );
}

function expectNothingPublished() {
  expect(existsSync(join(dist, "cards"))).toBe(false);
  expect(existsSync(join(dist, "sitemaps"))).toBe(false);
  expect(existsSync(join(dist, "sitemap.xml"))).toBe(false);
}

describe("generate run() in backend mode", () => {
  it("publishes a complete catalog on a first deploy", async () => {
    const r = await go(fakeFetch({ catalog: fixture }));
    expect(r.written.filter((w) => w.kind === "card")).toHaveLength(5);
    expect(existsSync(join(dist, "cards/sor/005/index.html"))).toBe(true);
    expect(existsSync(join(dist, "sitemap.xml"))).toBe(true);
  });

  it("aborts a partial catalog (counts mismatch) and publishes nothing", async () => {
    const partial = { ...fixture, cards: fixture.cards.slice(1) };
    await expect(go(fakeFetch({ catalog: partial, list: nonTokenRows(fixture) }))).rejects.toThrow(
      /completeness guard failed/
    );
    expectNothingPublished();
  });

  it("aborts an empty catalog and publishes nothing", async () => {
    const empty = { ...fixture, cards: [], counts: {} };
    await expect(go(fakeFetch({ catalog: empty, list: [] }))).rejects.toThrow(
      /completeness guard failed: .*zero card pages/
    );
    expectNothingPublished();
  });

  it("aborts a shrink of more than 5% against the live sitemap and publishes nothing", async () => {
    // Six card URLs live, five pages now: 83%.
    const live = urlset([
      "/cards/sor/005/",
      "/cards/sor/010/",
      "/cards/sor/020/",
      "/cards/shd/001/",
      "/cards/twi/001/",
      "/cards/twi/002/",
    ]);
    await expect(go(fakeFetch({ catalog: fixture, sitemap: live }))).rejects.toThrow(
      /shrink guard: 5 card pages vs baseline 6 .* below 95%/
    );
    expectNothingPublished();
  });
});
