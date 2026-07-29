import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";

// Fallback values match the "demo-swu" project the local Auth Emulator runs
// under (docker-compose.yml's firebase-emulator service) -- this keeps
// `npm run build` / `vitest run` working in CI with no .env file present.
// Real values for the deployed app are injected as VITE_FIREBASE_* env vars
// by ci.yml's frontend-deploy job (P5 stage 4 prerequisite), sourced from
// terraform/environments/prod's google_firebase_web_app_config.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "demo-api-key",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "demo-swu.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "demo-swu",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

if (import.meta.env.VITE_USE_AUTH_EMULATOR === "true") {
  connectAuthEmulator(auth, "http://localhost:9099");
}
