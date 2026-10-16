import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  connectAuthEmulator,
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
// BL-263 (2.0.1): Auth is initialised WITHOUT the popup/redirect resolver in
// every document. getAuth() wires that resolver in at start-up, and on a phone
// user agent and on any Safari the SDK loads it (https://apis.google.com/js/api.js
// and its gapi module) BEFORE it restores the stored session
// (`_shouldInitProactively`) -- so a slow or hanging Google host held the whole
// app on "Loading..." (measured: loader held 8 s -> phone shell at 9.95 s). The
// persistence list is getAuth()'s own, so the signed-in session is unchanged.
// The resolver is passed only to the calls that need it -- Google popup,
// redirect, reauthenticate and the redirect-completion read (`googleResolver`
// below) -- so it loads on a Google sign-in, never on a page load.
//
// This also covers BL-253 S7-02: the scanner document (/scan/) is cross-origin
// isolated (COEP require-corp) and cannot embed the resolver's helper iframe;
// it used to be the one document initialised this way. Google sign-in (a popup)
// still cannot run there and bounces to the main document (stage 7b).
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
});

/** The popup/redirect resolver, for the Google sign-in calls only (BL-263). */
export const googleResolver = browserPopupRedirectResolver;

if (import.meta.env.VITE_USE_AUTH_EMULATOR === "true") {
  connectAuthEmulator(auth, "http://localhost:9099");
}
