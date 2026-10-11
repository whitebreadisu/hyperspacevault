import { isolationReport } from "./isolationReport";
import type { IsolationReport } from "./isolationReport";
import { createFallbackReader } from "./fallbackReader";
import type { FallbackReader } from "./fallbackReader";
import { createPaddleClient } from "./readerClient";
import type { ClientInit, PaddleClient } from "./readerClient";

// BL-253 S7-03 / S7-05: what the scanner document does before the camera
// screen exists (stage 7b mounts it). It reports its own isolation, and it
// starts the Paddle reader when the camera route is shown -- the stand-in for
// "the camera screen mounted" -- so `/scan/#/camera` proves the worker end to
// end and the main document (which never loads this file) requests nothing
// under /vendor/scan/. Everything is also reachable on `window.__scan` for the
// e2e specs and for the LAN rounds' device proof.

export interface ScanDebug {
  isolation: IsolationReport;
  reader: PaddleClient;
  fallback: FallbackReader;
  /** Result of the Paddle init once started (null before). */
  readerInit: ClientInit | null;
  /** Start the Paddle reader (idempotent). */
  startReader(): Promise<ClientInit>;
}

declare global {
  interface Window {
    __scan?: ScanDebug;
  }
}

const onCameraRoute = () => /^#\/camera(\/|\?|$)/.test(window.location.hash);

export function bootScan(): ScanDebug {
  const isolation = isolationReport();
  console.info("[scan] isolation " + JSON.stringify(isolation));

  const reader = createPaddleClient();
  const fallback = createFallbackReader();
  const dbg: ScanDebug = {
    isolation,
    reader,
    fallback,
    readerInit: null,
    async startReader() {
      const r = await reader.init();
      dbg.readerInit = r;
      console.info("[scan] paddle " + JSON.stringify(r));
      return r;
    },
  };
  window.__scan = dbg;

  const maybeStart = () => {
    if (onCameraRoute() && reader.state === "idle") void dbg.startReader();
  };
  maybeStart();
  window.addEventListener("hashchange", maybeStart);
  return dbg;
}
