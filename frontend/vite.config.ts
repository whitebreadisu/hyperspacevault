import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, coverageConfigDefaults } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { ENTRY_INPUTS } from "./src/mobile/camera/scanEntries.ts";
import { headersFor, scanRewrite } from "./src/mobile/camera/scanHeaders.ts";

// BL-253 S7-01 / S7-02: the scanner document. `/scan` and `/scan/` are served
// scan.html (Firebase does the same with a rewrite in prod), and the scoped
// isolation headers (COOP / COEP / Permissions-Policy on the document, immutable
// caching + COEP on the vendored reader payload and the worker script) are set
// by the same pure `headersFor` that firebase.json's rule is asserted against.
// The main document and every other asset get nothing (plan A11).
function scanDocument(): Plugin {
  const middleware = (
    req: { url?: string },
    res: { setHeader(k: string, v: string): void },
    next: () => void
  ) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const h = headersFor(url.pathname);
    if (h) for (const [k, v] of Object.entries(h)) res.setHeader(k, v);
    const to = scanRewrite(url.pathname);
    if (to) req.url = to + url.search;
    next();
  };
  return {
    name: "hsv-scan-document",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

// BL-184: package.json's "version" is the single source of truth for the
// app's displayed version (Header's footer label + the release-notes
// content module's newest-entry version). Read via fs.readFileSync + JSON.parse
// rather than a JSON import (avoids relying on Node's still-maturing
// `with { type: "json" }` syntax support) and baked in at build time via a
// Vite `define` -- no runtime fetch, no version drift between what's built
// and what's displayed.
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf-8")
) as { version: string };

// BL-279 WS-3 W3-07 / A06: index.html carries <meta name="build-sha"> so a
// journey run can prove which commit an environment serves. Deploy builds set
// VITE_GIT_SHA (ci.yml deploy-dev, the promote-prod action); anything else
// (local dev, the plain CI build) renders "local" instead of the literal
// %VITE_GIT_SHA% placeholder.
process.env.VITE_GIT_SHA ||= "local";

// BL-279 WS-3 W3-07: the dev server proxies /api and /images/cards to the
// compose backend by default; the CI local stack points it at uvicorn on
// localhost instead.
const API_PROXY_TARGET = process.env.VITE_API_PROXY_TARGET ?? "http://backend:8000";

export default defineConfig({
  plugins: [react(), scanDocument()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    // S7-01: two entries -- the app and the isolated scanner document.
    rollupOptions: { input: ENTRY_INPUTS },
  },
  worker: {
    // S7-05: the reader worker is an ES module worker, emitted under a fixed
    // folder so the scoped COEP header rule can name it (scanHeaders.ts).
    format: "es",
    rollupOptions: { output: { entryFileNames: "scan-workers/[name]-[hash].js" } },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: API_PROXY_TARGET,
        changeOrigin: true,
      },
      // BL-76 Phase 3 (ADR-0012): same-origin card images, mirroring the
      // /api rewrite -- dev compose talks to the same backend container.
      //
      // BL-114: narrowed from a blanket '/images' rule to the backend's
      // actual namespace, '/images/cards' (backend/app/routers/images.py's
      // only route is GET /images/cards/{filename}). The blanket rule used
      // to intercept every /images/* request, including Vite `public/`
      // statics that also live under /images (set_*.png, starfields/*,
      // circuit-tile.webp) -- those got forwarded to the backend, which
      // 404s them (it has no route for them), so the dev server rendered
      // blank set logos/background art. Prod is unaffected: Firebase
      // Hosting's static-file-wins-over-rewrite precedence already serves
      // those correctly regardless of this rule.
      "/images/cards": {
        target: API_PROXY_TARGET,
        changeOrigin: true,
      },
    },
    watch: {
      // Required for hot reload inside Docker on Windows (no native FS events)
      usePolling: true,
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    // BL-247 S1-10: Playwright specs live in e2e/ and are not vitest tests.
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      exclude: [...coverageConfigDefaults.exclude, "src/main.tsx"],
      thresholds: {
        lines: 75,
        statements: 74,
      },
    },
  },
});
