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
//      template, not a page, and is removed afterwards.
//
// PUBLIC_PAGES_NOINDEX=true (dev deploys) adds a robots noindex meta (R2).
//
// Not yet here (design note §3, §5, §8): reading the route with the
// build_sha wait, the completeness and shrink guards, sitemaps and the
// lastmod manifest, set and index pages, the image-bucket check.

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

// Server rendering never signs anyone in and never sends analytics: the
// Firebase app and the PostHog client are replaced by inert stand-ins in the
// SSR build only (the browser bundle is the normal one).
const SERVER_STUBS = {
  "virtual:pc-firebase": "export const auth = { currentUser: null }; export const app = {};",
  "virtual:pc-posthog": "export default {};",
};
function serverStubs() {
  return {
    name: "pc-server-stubs",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "posthog-js") return "\0virtual:pc-posthog";
      if (
        importer &&
        /[\\/]src[\\/]api[\\/]authedFetch\.ts$/.test(importer) &&
        source === "../firebase"
      )
        return "\0virtual:pc-firebase";
      return null;
    },
    load(id) {
      if (id.startsWith("\0virtual:pc-")) return SERVER_STUBS[id.slice(1)];
      return null;
    },
  };
}

// vite.config.ts does the same for index.html's build-sha meta.
process.env.VITE_GIT_SHA ||= "local";

async function buildPageBundle() {
  await build({
    root,
    configFile: false,
    logLevel: "warn",
    plugins: [react()],
    define: { __APP_VERSION__: JSON.stringify("public") },
    build: {
      outDir: distDir,
      emptyOutDir: false,
      rollupOptions: { input: { card: resolve(root, "card.html") } },
    },
  });
}

async function buildRenderer() {
  await build({
    root,
    configFile: false,
    logLevel: "warn",
    plugins: [react(), serverStubs()],
    define: { __APP_VERSION__: JSON.stringify("public") },
    build: {
      ssr: "src/public/render.tsx",
      outDir: ssrDir,
      emptyOutDir: true,
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

async function main() {
  const started = Date.now();
  await buildPageBundle();
  const template = await readFile(join(distDir, "card.html"), "utf8");
  if (!template.includes("<!--pc-head-->") || !template.includes("<!--pc-body-->")) {
    throw new Error("dist/card.html has no <!--pc-head--> / <!--pc-body--> placeholders");
  }
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const render = await buildRenderer();
  const pages = render.buildPages(catalog);

  const written = [];
  for (const page of pages) {
    const c = page.card;
    const body = render.renderCardBody(page);
    const html = template
      .replace("<!--pc-head-->", render.headHtml(page, { noindex }))
      .replace("<!--pc-body-->", body);
    if (html.includes("cdn.starwarsunlimited.com")) {
      throw new Error(`${c.set_code} ${c.base_card_number}: the page names the official CDN`);
    }
    if (MOJIBAKE.test(visibleText(body))) {
      throw new Error(`${c.set_code} ${c.base_card_number}: mojibake survives in the page text`);
    }
    const num = /^\d+$/.test(c.base_card_number)
      ? c.base_card_number.padStart(3, "0")
      : c.base_card_number.toLowerCase();
    const rel = join("cards", c.set_code.toLowerCase(), num, "index.html");
    await mkdir(dirname(join(distDir, rel)), { recursive: true });
    await writeFile(join(distDir, rel), html, "utf8");
    written.push({
      path: "/" + rel.replace(/\\/g, "/").replace(/index\.html$/, ""),
      bytes: Buffer.byteLength(html),
    });
  }
  await rm(join(distDir, "card.html"));

  for (const w of written) console.log(`  ${w.path}  ${w.bytes} B`);
  console.log(
    `card pages: ${written.length} written from ${catalog.build_sha} ` +
      `(noindex=${noindex}) in ${Date.now() - started} ms`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
