// Public card-page generator (design note §0, §3 option A, §5, §7).
//
//   npm run public-pages -- (--catalog FILE | --backend URL --expect-sha SHA) --origin ORIGIN
//       [--allow-shrink [true|false]] [--override-name TEXT] [--images-bucket NAME]
//       [--images off|auto|bucket|probe] [--summary FILE] [--dist DIR]
//   env: PUBLIC_PAGES_NOINDEX=true (dev deploys), GCS_ACCESS_TOKEN
//   (lib/args.mjs has the exact rules)
//
// Runs after the app's `vite build`, into the same dist:
//   1. reads the catalog: --catalog FILE (local runs, the CI fixture check), or
//      GET <backend>/api/public/cards straight from Cloud Run, waiting up to
//      5 min until its build_sha is the SHA being deployed (lib/fetchCatalog);
//      then the existing GET /api/base-cards list for the completeness guard;
//   2. the image check (lib/images): which 320 px renditions the card-images
//      bucket holds; a printing without one renders the same-size placeholder
//      panel, never an <img> that would redirect to the official CDN;
//   3. builds the page's own browser bundle from card.html in a SEPARATE Vite
//      build (so the app's build is untouched) and src/public/render.tsx with
//      Vite's SSR build, and renders every page into a STAGING directory
//      (frontend/.public-pages/stage): card pages, set pages, the set index;
//   4. the guards (lib/guards): completeness (catalog = sum(counts) = list =
//      pages rendered) and shrink (against the --origin site's live
//      sitemaps, override --allow-shrink);
//   5. hashes every page, reads the live /sitemaps/manifest.json and writes
//      the new manifest and the sitemaps (lib/manifest, lib/sitemaps);
//   6. only then moves cards/, sitemaps/ and sitemap.xml into dist. A failed
//      read or guard leaves dist without pages, and the deploy step fails
//      before `firebase deploy` (design note §3 guard 4).
// Every guard's line goes to stdout and to --summary (the job summary), also
// when the run fails.
//
// buildBundles(), writePages() and staticTemplate() are exported for tests
// and tools; main() runs only when this file is the entry point.

import { cp, mkdir, readFile, rm, writeFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { UsageError, parseArgs } from "./lib/args.mjs";
import { fetchBaseCardList, fetchCatalog, assertCatalogShape } from "./lib/fetchCatalog.mjs";
import { checkCompleteness, checkShrink, liveCardBaseline } from "./lib/guards.mjs";
import { catalogStems, imageAvailability, withAvailableArt } from "./lib/images.mjs";
import {
  MANIFEST_PATH,
  buildManifest,
  contentHash,
  fetchLiveManifest,
  manifestSummary,
  utcDate,
} from "./lib/manifest.mjs";
import { buildSitemaps, fileForPath } from "./lib/sitemaps.mjs";
import { namesOfficialCdn } from "./lib/officialCdn.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const ssrDir = resolve(root, ".public-pages/ssr");
const stageDir = resolve(root, ".public-pages/stage");

// The public pages never sign anyone in and never load the app's analytics
// SDK (design note §3 "How the app takes over", §6 C7): in BOTH builds (the
// page's browser bundle and the server renderer) the app's Firebase module
// and posthog-js are replaced by inert stand-ins. The shared components'
// capture() calls stay no-ops either way (initAnalytics() never runs on a
// public page); the stand-ins keep the SDKs' bytes out of the page. Any other
// route to the Firebase SDK fails the build instead of shipping it.
const INERT = {
  "virtual:pc-firebase": "export const auth = { currentUser: null }; export const app = {};",
  "virtual:pc-posthog": "export default {};",
};
const APP_FIREBASE = resolve(root, "src/firebase");
export function inertSdks() {
  return {
    name: "pc-inert-sdks",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "posthog-js") return "\0virtual:pc-posthog";
      if (importer && source.startsWith(".")) {
        const target = resolve(dirname(importer), source).replace(/\.tsx?$/, "");
        if (target === APP_FIREBASE) return "\0virtual:pc-firebase";
      }
      if (source === "firebase" || source.startsWith("firebase/")) {
        this.error(
          `public pages must not bundle the Firebase SDK: ${source} imported by ${importer}`
        );
      }
      return null;
    },
    load(id) {
      if (id.startsWith("\0virtual:pc-")) return INERT[id.slice(1)];
      return null;
    },
  };
}

// vite.config.ts does the same for index.html's build-sha meta.
process.env.VITE_GIT_SHA ||= "local";

async function buildPageBundle(outDir) {
  await build({
    root,
    configFile: false,
    logLevel: "warn",
    plugins: [react(), inertSdks()],
    define: { __APP_VERSION__: JSON.stringify("public") },
    build: {
      outDir,
      emptyOutDir: false,
      // Both builds emit (never inline) small assets such as the rarity
      // symbols, so the server markup and the hydrated markup name the same
      // /assets/ file and a set page lists ~260 rows without ~260 data URIs.
      assetsInlineLimit: 0,
      rollupOptions: { input: { card: resolve(root, "card.html") } },
    },
  });
}

async function buildRenderer() {
  await build({
    root,
    configFile: false,
    logLevel: "warn",
    plugins: [react(), inertSdks()],
    define: { __APP_VERSION__: JSON.stringify("public") },
    build: {
      ssr: "src/public/render.tsx",
      outDir: ssrDir,
      emptyOutDir: true,
      assetsInlineLimit: 0,
    },
  });
  return import(pathToFileURL(join(ssrDir, "render.js")).href);
}

function visibleText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ");
}

/** The built card.html as the template of a static page (set pages, the set
 * index): the same stylesheet, no page script and no module preloads, since
 * nothing on those pages hydrates. */
export function staticTemplate(template) {
  return template
    .replace(/\s*<script type="module"[^>]*><\/script>/g, "")
    .replace(/\s*<link rel="modulepreload"[^>]*>/g, "");
}

/** Builds the page bundle (into outDir, default --dist) and the server
 * renderer; returns the card-page template (<outDir>/card.html, read and
 * then removed: it is a template, not a page) and the renderer module. */
export async function buildBundles({ outDir = resolve(root, "dist") } = {}) {
  await buildPageBundle(outDir);
  const templatePath = join(outDir, "card.html");
  const template = await readFile(templatePath, "utf8");
  if (!template.includes("<!--pc-head-->") || !template.includes("<!--pc-body-->")) {
    throw new Error("dist/card.html has no <!--pc-head--> / <!--pc-body--> placeholders");
  }
  await rm(templatePath);
  const render = await buildRenderer();
  return { template, render };
}

/** The census pattern (design note §8) comes from the render module, the
 * same one the page data's repair uses, so the generator cannot drift from it. */
function checkPage(label, html, body, mojibake) {
  if (namesOfficialCdn(html)) {
    throw new Error(`${label}: the page names the official CDN`);
  }
  if (mojibake.test(visibleText(body))) {
    throw new Error(`${label}: mojibake survives in the page text`);
  }
}

async function writePage(outDir, urlPath, html) {
  const file = join(outDir, ...urlPath.split("/").filter(Boolean), "index.html");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html, "utf8");
  return { path: urlPath, file, bytes: Buffer.byteLength(html) };
}

/** Renders and writes every public page from one catalog document:
 *   - a card page per non-token card: dist/cards/<set>/<num>/index.html
 *   - a set page per set:              dist/cards/<set>/index.html
 *   - the set index:                   dist/cards/index.html
 * Returns one entry per page written: { kind: "card" | "set" | "index",
 * path: "/cards/sor/005/", file, bytes }. */
export async function writePages({ render, template, catalog, outDir, noindex }) {
  if (!(render.MOJIBAKE instanceof RegExp)) {
    throw new Error("the render module exports no MOJIBAKE pattern");
  }
  const check = (label, html, body) => checkPage(label, html, body, render.MOJIBAKE);
  const written = [];
  const fill = (tpl, head, body) =>
    tpl.replace("<!--pc-head-->", head).replace("<!--pc-body-->", body);

  for (const page of render.buildPages(catalog)) {
    const c = page.card;
    const body = render.renderCardBody(page);
    const html = fill(template, render.headHtml(page, { noindex }), body);
    check(`${c.set_code} ${c.base_card_number}`, html, body);
    const urlPath = render.cardPath(c.set_code, c.base_card_number);
    written.push({ kind: "card", ...(await writePage(outDir, urlPath, html)) });
  }

  const plain = staticTemplate(template);
  for (const set of render.buildSetPages(catalog)) {
    const body = render.renderSetBody(set);
    const html = fill(plain, render.setHeadHtml(set, { noindex }), body);
    check(`set ${set.code}`, html, body);
    written.push({ kind: "set", ...(await writePage(outDir, set.path, html)) });
  }

  const index = render.buildIndexPage(catalog);
  const indexBody = render.renderIndexBody(index);
  const indexHtml = fill(plain, render.indexHeadHtml(index, { noindex }), indexBody);
  check("set index", indexHtml, indexBody);
  written.push({ kind: "index", ...(await writePage(outDir, "/cards/", indexHtml)) });
  return written;
}

/** Job-summary and console lines. Warnings and errors also print as GitHub
 * annotations. flush() appends everything to --summary (when given). */
function summaryLog(file) {
  const lines = [];
  return {
    line(text) {
      console.log(text);
      lines.push(`- ${text}`);
    },
    warning(text) {
      console.log(`::warning::${text}`);
      lines.push(`- :warning: ${text}`);
    },
    error(text) {
      console.log(`::error::${text}`);
      lines.push(`- :x: ${text}`);
    },
    async flush() {
      if (!file || lines.length === 0) return;
      await appendFile(file, `\n### Card pages\n\n${lines.join("\n")}\n`, "utf8");
    },
  };
}

/** The sitemaps' sections, in the order the pages were written: `/`,
 * `/cards/`, every set page, then one card list per set. */
function sitemapSections(written) {
  const setPages = written.filter((w) => w.kind === "set");
  const bySet = new Map(setPages.map((s) => [s.path, []]));
  for (const w of written.filter((x) => x.kind === "card")) {
    const setUrl = w.path.replace(/[^/]+\/$/, "");
    if (!bySet.has(setUrl)) bySet.set(setUrl, []);
    bySet.get(setUrl).push(w.path);
  }
  return {
    corePaths: ["/", "/cards/", ...setPages.map((s) => s.path)],
    sets: [...bySet.entries()].map(([setUrl, paths]) => ({
      code: setUrl.split("/").filter(Boolean)[1],
      paths: paths.sort(),
    })),
  };
}

/** Moves the staged output into dist: cards/, sitemaps/, sitemap.xml. */
async function publish(stage, dist) {
  for (const name of ["cards", "sitemaps"]) {
    await rm(join(dist, name), { recursive: true, force: true });
    await cp(join(stage, name), join(dist, name), { recursive: true });
  }
  await cp(join(stage, "sitemap.xml"), join(dist, "sitemap.xml"));
}

export async function run(argv = process.argv.slice(2), env = process.env) {
  const started = Date.now();
  const opts = parseArgs(argv, env);
  const dist = resolve(root, opts.dist);
  const log = summaryLog(opts.summary);
  try {
    if (!existsSync(join(dist, "index.html"))) {
      throw new Error(`${dist} has no index.html: run the app build (npm run build) first`);
    }
    log.line(
      `mode ${opts.mode}, origin ${opts.origin}, noindex=${opts.noindex}, ` +
        `${opts.overrideName}=${opts.allowShrink}`
    );
    if (opts.allowShrink) log.warning(`shrink override set (${opts.overrideName}=true)`);

    // 1. The catalog and the list it is checked against.
    let catalog;
    let baseCardList;
    const listLabel = opts.mode === "catalog" ? "the catalog file (no list endpoint)" : undefined;
    if (opts.mode === "catalog") {
      catalog = assertCatalogShape(JSON.parse(await readFile(resolve(root, opts.catalog), "utf8")));
      baseCardList = catalog.cards;
      log.line(
        `catalog: ${opts.catalog} (build_sha ${catalog.build_sha}; no list endpoint, no live reads)`
      );
    } else {
      const got = await fetchCatalog({
        backendUrl: opts.backend,
        expectSha: opts.expectSha,
        log: (l) => console.log(l),
      });
      catalog = got.catalog;
      log.line(
        `catalog: build_sha ${catalog.build_sha} after ${got.attempts} attempt(s), ` +
          `${Math.round(got.waitedMs / 1000)} s`
      );
      baseCardList = await fetchBaseCardList({ backendUrl: opts.backend });
    }
    // Fail fast on a partial read, before any build work.
    checkCompleteness({ catalog, baseCardList, listLabel });

    // 2. Art.
    const art = await imageAvailability({
      stems: catalogStems(catalog),
      bucket: opts.imagesBucket,
      token: opts.token,
      origin: opts.origin,
      mode: opts.images,
    });
    for (const w of art.warnings) log.warning(w);
    log.line(art.line);
    const pageCatalog = withAvailableArt(catalog, art.present);

    // 3. Render into the staging directory.
    const { template, render } = await buildBundles({ outDir: dist });
    await rm(stageDir, { recursive: true, force: true });
    await mkdir(stageDir, { recursive: true });
    const written = await writePages({
      render,
      template,
      catalog: pageCatalog,
      outDir: stageDir,
      noindex: opts.noindex,
    });
    const count = (k) => written.filter((w) => w.kind === k).length;
    const cards = count("card");

    // 4. Guards.
    log.line(checkCompleteness({ catalog, baseCardList, pagesRendered: cards, listLabel }).line);
    let live = { sitemaps: 0 };
    if (opts.mode === "catalog") {
      log.line(`shrink guard: skipped (--catalog: no live site read); ${cards} card pages`);
    } else {
      live = await liveCardBaseline({ origin: opts.origin });
      log.line(
        checkShrink({
          baseline: live.baseline,
          count: cards,
          allowShrink: opts.allowShrink,
          overrideName: opts.overrideName,
          source: live.source,
        }).line
      );
    }

    // 5. Manifest and sitemaps.
    let liveManifest = null;
    if (opts.mode === "backend") {
      const m = await fetchLiveManifest({ origin: opts.origin });
      liveManifest = m.manifest;
      if (!liveManifest && live.sitemaps > 0) {
        // The live site already serves card pages but no manifest: lastmod
        // restarts from nothing this once. A warning, not a failure: lastmod
        // is a crawl hint, and blocking a deploy over it would trade a real
        // risk (stale pages) for a cosmetic one.
        log.warning(
          `${opts.origin} serves a sitemap index but no ${MANIFEST_PATH}; no lastmod this deploy`
        );
      }
    }
    const hashes = {};
    for (const w of written) hashes[w.path] = contentHash(await readFile(w.file, "utf8"));
    const manifest = buildManifest({ live: liveManifest, hashes, today: utcDate(Date.now()) });
    log.line(manifestSummary(manifest.stats));
    const files = buildSitemaps({
      origin: opts.origin,
      ...sitemapSections(written),
      lastmodOf: manifest.lastmodOf,
    });
    for (const f of [...files, { path: MANIFEST_PATH, xml: JSON.stringify(manifest.manifest) }]) {
      const out = join(stageDir, fileForPath(f.path));
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, f.xml, "utf8");
    }

    // 6. Publish into dist.
    await publish(stageDir, dist);
    log.line(
      `public pages: ${cards} card, ${count("set")} set, ${count("index")} index and ` +
        `${files.length} sitemap files written to ${opts.dist} from ${catalog.build_sha} ` +
        `in ${Math.round((Date.now() - started) / 1000)} s`
    );
    return { written, files, manifest };
  } catch (err) {
    log.error(err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    await log.flush();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().catch((err) => {
    if (err instanceof UsageError) console.error(err.message);
    else console.error(err);
    process.exit(1);
  });
}
