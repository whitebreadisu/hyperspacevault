import { defineConfig, coverageConfigDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://backend:8000',
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
      '/images/cards': {
        target: 'http://backend:8000',
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
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      exclude: [...coverageConfigDefaults.exclude, 'src/main.tsx'],
      thresholds: {
        lines: 75,
        statements: 74,
      },
    },
  },
})
