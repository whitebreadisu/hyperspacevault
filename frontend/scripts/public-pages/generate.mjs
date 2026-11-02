// Public card-page generator (design note §0, §3 option A, §7).
//
//   node scripts/public-pages/generate.mjs [--catalog FILE] [--dist DIR]
//
// Runs after the app's `vite build`, into the same dist. Reads one public
// catalog document (the shape the planned GET /api/public/cards returns;
// locally built from a swuapi export by
// backend/scripts/public_catalog_from_export.py) and:
//   1. builds the page's own browser bundle from card.html in a SEPARATE Vite
//      build, so the app's build (entries, chunks, CSS order) is untouched
//      -- a third input to the app build re-split the app's chunks and
//      reordered its CSS;
//   2. builds src/public/render.tsx with Vite's SSR build;
//   3. server-renders every card with the app's own components and writes
//      dist/cards/<set>/<num>/index.html from the built card.html, which is a
//      template, not a page, and is removed afterwards;
//   4. writes the static set pages (dist/cards/<set>/index.html) and the set
//      index (dist/cards/index.html) from the same template, without the
//      page script (nothing on them hydrates).
//
// The page bundle and the renderer replace the app's Firebase module and
// posthog-js with inert stand-ins (inertSdks below).
//
// For the deploy step's own modules: buildBundles() and writePages() are
// exported, and main() runs only when this file is the entry point.
//
// PUBLIC_PAGES_NOINDEX=true (dev deploys) adds a robots noindex meta (R2).
//
// Not yet here (design note §3, §5, §8): reading the route with the
// build_sha wait, the completeness and shrink guards, sitemaps and the
// lastmod manifest, the image-bucket check.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const catalogPath = resolve(root, arg("--catalog", ".public-pages/catalog.json"));
const distDir = resolve(root, arg("--dist", "dist"));
const ssrDir = resolve(root, ".public-pages/ssr");
const noindex = process.env.PUBLIC_PAGES_NOINDEX === "true";

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
function inertSdks() {
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

const MOJIBAKE = /Ã|â€|Â|�/;

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
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
export async function buildBundles({ outDir = distDir } = {}) {
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

function check(label, html, body) {
  if (html.includes("cdn.starwarsunlimited.com")) {
    throw new Error(`${label}: the page names the official CDN`);
  }
  if (MOJIBAKE.test(visibleText(body))) {
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

async function main() {
  const started = Date.now();
  const { template, render } = await buildBundles();
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const written = await writePages({ render, template, catalog, outDir: distDir, noindex });

  for (const w of written) console.log(`  ${w.path}  ${w.bytes} B`);
  const count = (k) => written.filter((w) => w.kind === k).length;
  console.log(
    `public pages: ${count("card")} card, ${count("set")} set, ${count("index")} index ` +
      `written from ${catalog.build_sha} (noindex=${noindex}) in ${Date.now() - started} ms`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
