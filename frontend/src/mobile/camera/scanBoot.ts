import { isolationReport } from "./isolationReport";
import type { IsolationReport } from "./isolationReport";
import { createFallbackReader } from "./fallbackReader";
import type { FallbackReader } from "./fallbackReader";
import { createPaddleClient } from "./readerClient";
import { registerCameraScreen } from "../tool/cameraHop";
import { cueCounts } from "../tool/cue";
import { bindCameraScreen } from "./CameraScreen";
import type { ClientInit, PaddleClient } from "./readerClient";

// What the scanner document does at boot. It reports its own isolation,
// creates the Paddle and Tesseract readers (neither loads until asked) and
// registers the camera screen; the main document never loads this file, so it
// requests nothing under /vendor/scan/. Everything is also reachable on
// `window.__scan` for the e2e specs and for checks on a device.

export interface ScanDebug {
  isolation: IsolationReport;
  reader: PaddleClient;
  fallback: FallbackReader;
  /** Result of the Paddle init once started (null before). */
  readerInit: ClientInit | null;
  /** Start the Paddle reader (idempotent). */
  startReader(): Promise<ClientInit>;
  /** Beep attempts (the e2e observes the cue without hearing it). */
  cues: typeof cueCounts;
}

declare global {
  interface Window {
    __scan?: ScanDebug;
  }
}

export function bootScan(): ScanDebug {
  const isolation = isolationReport();
  console.info("[scan] isolation " + JSON.stringify(isolation));

  const reader = createPaddleClient();
  let initP: Promise<ClientInit> | null = null;
  const fallback = createFallbackReader();
  const dbg: ScanDebug = {
    isolation,
    reader,
    fallback,
    readerInit: null,
    cues: cueCounts,
    startReader() {
      // Memoised: the scan loop asks before every read; a failed init may retry.
      if (initP) return initP;
      initP = dbg.reader.init().then((r) => {
        dbg.readerInit = r;
        console.info("[scan] paddle " + JSON.stringify(r));
        if (!r.ok) initP = null;
        return r;
      });
      return initP;
    },
  };
  window.__scan = dbg;
  // The camera screen, bound to this document's readers, fills the
  // tool layer's camera slot (the main document never registers one).
  registerCameraScreen(bindCameraScreen(window.__scan ?? dbg));
  // The Paddle download starts when the camera screen mounts (the controller
  // calls startReader), never from the route alone: where the phone
  // gate does not match (a desktop window or a tablet, useIsPhone.ts) the
  // camera route renders the desktop tree and nothing is fetched.
  return dbg;
}
