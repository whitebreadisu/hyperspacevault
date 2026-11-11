/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_USE_AUTH_EMULATOR?: string;
}

// Baked in at build time by vite.config.ts's `define` (package.json's
// "version" field) -- no runtime fetch, see that file's comment.
declare const __APP_VERSION__: string;

// The commit SHA this bundle was built from ("local" off a deploy
// build) -- vite.config.ts's `define`, also published as /build.json.
declare const __BUILD_ID__: string;
