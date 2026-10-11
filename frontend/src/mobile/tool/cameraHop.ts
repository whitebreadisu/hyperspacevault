import { createElement } from "react";
import type { ComponentType, ReactNode } from "react";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";
import { getBgRoute, go, navDepth, back } from "../router";

// BL-253 S7-09: the hop between the main document (`/`) and the isolated
// scanner document (`/scan/`, COOP + COEP -- an in-app layer cannot be
// isolated). The scanner document serves the FULL app bundle (orchestrator
// ruling 1), so once there the tool, Verify, Card details and More all work
// in place: only entering the camera from `/` and closing a camera that was
// entered that way cross documents. The batch and the tool mode travel in the
// sessionStorage mirror (S7-08).
//
// Nothing here imports mobile/camera/: the camera screen registers itself
// into `cameraSlot` from the scanner entry (scan.tsx -> scanBoot), so the main
// document's chunks never carry camera code.

export const SCAN_PATH = "/scan/";
const HOP_KEY = "hsv.scan.hop";
const SIGNIN_KEY = "hsv.scan.signin";

/** This document is the isolated scanner document. */
export function isScanDocument(): boolean {
  return typeof location !== "undefined" && /^\/scan(\/|\.html|$)/.test(location.pathname);
}

function session(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}
function sget(k: string): string | null {
  try {
    return session()?.getItem(k) ?? null;
  } catch {
    return null;
  }
}
function sset(k: string, v: string | null): void {
  try {
    if (v === null) session()?.removeItem(k);
    else session()?.setItem(k, v);
  } catch {
    /* blocked storage: the hop still works, the return falls back to the Vault */
  }
}

/** Test seam: the navigation `location.assign` / `replace` would do. */
export interface Nav {
  assign(url: string): void;
  replace(url: string): void;
  historyBack(): void;
}
const realNav: Nav = {
  assign: (u) => window.location.assign(u),
  replace: (u) => window.location.replace(u),
  historyBack: () => window.history.back(),
};
let nav: Nav = realNav;
export function setNavForTest(n: Nav | null): void {
  nav = n ?? realNav;
  hopping = false;
}

/** From the main document: the main document's history entry becomes the
 * screen the tool was opened over (so Back from the camera lands there, not
 * on a tool route that would hop again), then the scanner document opens on
 * the camera. `replace` for a cold `/#/camera` deep link. */
let hopping = false;
// A page restored from the back/forward cache may hop again.
if (typeof window !== "undefined")
  window.addEventListener("pageshow", () => {
    hopping = false;
  });

export function hopToCamera(replace = false): void {
  // One navigation per hop (StrictMode runs the deep-link effect twice).
  if (hopping) return;
  hopping = true;
  sset(HOP_KEY, "1");
  go(getBgRoute(), true);
  const url = SCAN_PATH + "#/camera";
  if (replace) nav.replace(url);
  else nav.assign(url);
}

/** Open the camera mode: in place inside the scanner document, else the hop. */
export function openCamera(replace = false): void {
  if (isScanDocument()) go("#/camera", replace);
  else hopToCamera(replace);
}

/** Close the tool (keypad or camera X). Inside the scanner document with
 * nothing of ours to walk back, a camera entered by the hop returns to the
 * main document (history back = the screen the tool was opened over). */
export function closeTool(): void {
  if (navDepth() > 0 || !isScanDocument() || sget(HOP_KEY) !== "1") {
    back();
    return;
  }
  sset(HOP_KEY, null);
  nav.historyBack();
}

// ── Sign-in from the scanner document (7a FINDING 2, ruling 1) ─────────────
// The isolated document initialises Firebase Auth without the popup resolver
// (COEP blocks the auth helper iframe), so Google sign-in cannot run there:
// sign-in bounces to the main document, which opens the auth layer and, once
// signed in, returns to where the user was.

/** In the scanner document: leave for `/` with the return URL remembered. */
export function bounceSignIn(): void {
  sset(SIGNIN_KEY, SCAN_PATH + (window.location.hash || "#/camera"));
  nav.assign("/#/vault");
}

/** In the main document: a pending bounce (the return URL), or null. */
export function pendingSignInReturn(): string | null {
  const v = sget(SIGNIN_KEY);
  return v && v.startsWith(SCAN_PATH) ? v : null;
}

/** Finish a bounce: signed in -> back to the scanner document; abandoned ->
 * history back (to the scanner document's page). */
export function finishSignInBounce(signedIn: boolean): void {
  const ret = pendingSignInReturn();
  sset(SIGNIN_KEY, null);
  if (!ret) return;
  if (signedIn) nav.assign(ret);
  else nav.historyBack();
}

// ── The camera screen slot ─────────────────────────────────────────────────

export interface CameraScreenProps {
  /** The card layer is over the camera (Card details): stay mounted, paused. */
  covered: boolean;
  /** A sheet or the close guard is over the camera: reading pauses. */
  busy: boolean;
  onRequestSignIn: () => void;
  /** Card details: the S2 card layer over the tool (S3-06 handler). */
  onOpenCard: (card: InventoryCard, variant: InventoryVariant) => void;
  onOpenVerify: () => void;
}

let cameraScreen: ComponentType<CameraScreenProps> | null = null;

/** Called once by the scanner entry before the app renders. */
export function registerCameraScreen(c: ComponentType<CameraScreenProps>): void {
  cameraScreen = c;
}

export function getCameraScreen(): ComponentType<CameraScreenProps> | null {
  return cameraScreen;
}

/** The registered camera screen as an element (null on the main document). */
export function renderCameraScreen(props: CameraScreenProps): ReactNode {
  return cameraScreen ? createElement(cameraScreen, props) : null;
}

// ── Leaving the camera for the keypad (S7-16) ──────────────────────────────
// The header's keypad toggle lives in ToolLayer; the camera knows the partial
// read. While mounted the camera provides the keypad route to land on
// (`#/pad?set=&num=` when a partial read names a known set, else `#/pad`).

let keypadExit: (() => string) | null = null;

export function setCameraKeypadExit(f: (() => string) | null): void {
  keypadExit = f;
}

/** The keypad route the camera leaves to (and its scan_fallback_keypad). */
export function cameraKeypadRoute(): string {
  return keypadExit ? keypadExit() : "#/pad";
}
