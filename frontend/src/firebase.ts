import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  indexedDBLocalPersistence,
  initializeAuth,
} from "firebase/auth";

// Fallback values match the "demo-swu" project the local Auth Emulator runs
// under (docker-compose.yml's firebase-emulator service) -- this keeps
// `npm run build` / `vitest run` working in CI with no .env file present.
// Real values for the deployed app are injected as VITE_FIREBASE_* env vars
// by ci.yml's frontend-deploy job (P5 stage 4 prerequisite), sourced from
// terraform outputs. authDomain is each env's own Hosting domain, NOT the
// default <project>.firebaseapp.com (BL-211: the auth handler must be
// same-origin or Safari's storage partitioning breaks Google sign-in).
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "demo-api-key",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "demo-swu.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "demo-swu",
};

export const app = initializeApp(firebaseConfig);
// BL-253 S7-02: the scanner document (/scan/) is cross-origin isolated (COEP
// require-corp), and an isolated page cannot embed Firebase Auth's helper iframe
// (the frame would need its own COEP header; the Auth emulator's is a
// different origin entirely). getAuth() loads that iframe at startup for the
// popup/redirect resolver, so an isolated document initialises Auth WITHOUT the
// resolver: same persistence stack, hence the same signed-in session as the
// main document, and email/password plus session restore all work; Google
// sign-in (a popup) cannot run in an isolated document and bounces to the main
// document (stage 7b). Every non-isolated document is unchanged: getAuth().
export const auth =
  typeof window !== "undefined" && window.crossOriginIsolated
    ? initializeAuth(app, {
        persistence: [
          indexedDBLocalPersistence,
          browserLocalPersistence,
          browserSessionPersistence,
        ],
      })
    : getAuth(app);

if (import.meta.env.VITE_USE_AUTH_EMULATOR === "true") {
  connectAuthEmulator(auth, "http://localhost:9099");
}
