import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { initAnalytics } from "./analytics/analytics";
import { bootScan } from "./mobile/camera/scanBoot";

// The entry of the isolated scanner document (scan.html, served at /scan/;
// App Spec §25.7). Everything main.tsx does, plus bootScan (the isolation
// report and the lazy reader). Nothing under mobile/camera/ is imported by
// main.tsx, so the scanner code never lands in the main document's chunks.
initAnalytics();

if (import.meta.env.VITE_FIREBASE_PROJECT_ID !== "swu-prod") {
  document.title = `(DEV) ${document.title}`;
}

bootScan();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
