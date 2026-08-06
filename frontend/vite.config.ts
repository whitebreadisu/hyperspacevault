import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, coverageConfigDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

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

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://backend:8000",
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
        target: "http://backend:8000",
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
