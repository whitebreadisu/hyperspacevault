import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { initAnalytics } from "./analytics/analytics";
import { bootScan } from "./mobile/camera/scanBoot";

// BL-253 S7-01: the entry of the isolated scanner document (scan.html, served
// at /scan/). Everything main.tsx does, plus the isolation report and the lazy
// reader (S7-03 / S7-05). Nothing under mobile/camera/ is imported by main.tsx,
// so the scanner code never lands in the main document's chunks.
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
