/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_USE_AUTH_EMULATOR?: string;
}

// BL-184: baked in at build time by vite.config.ts's `define` (package.json's
// "version" field) -- no runtime fetch, see that file's comment.
declare const __APP_VERSION__: string;
