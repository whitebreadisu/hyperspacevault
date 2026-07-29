import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// Prefix the browser-tab title with (DEV) on every non-production build so a
// dev tab is distinguishable from a prod tab at a glance. Prod is identified
// by its Firebase project id; local + swu-dev both fall through to the prefix.
if (import.meta.env.VITE_FIREBASE_PROJECT_ID !== "swu-prod") {
  document.title = `(DEV) ${document.title}`;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
