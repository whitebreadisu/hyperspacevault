import { capturePhone, phoneScreenViewed } from "../phoneAnalytics";
import type { ScanDecision } from "./cameraFlow";
import { timeBucket } from "./scanLoop";
import type { Accepted } from "./scanLoop";

// BL-253 S7-18 (BL-244, additive): the camera's analytics, through
// capturePhone (so every event carries layout: "phone"). Enums, buckets and
// booleans only -- NEVER the raw OCR text, a key, a card name or an image
// (App Spec §22 property standard; the S7-18 guard test checks it).
//   screen_viewed        {screen: "camera"}
//   scan_recognised      {reader: paddle | tesseract, key_strength: weak | strong,
//                         time_bucket: <1s | 1-2s | 2-5s | 5-10s | >10s}
//                         (first text -> prompt)
//   scan_decision        {decision: add | details | wrong_card | pick}
//   scan_pick_shown      {reason: printed_code_collision | small_series_N_of_2 |
//                         several_cards | number_conflict | reading_conflict}
//   scan_fallback_keypad {had_partial: boolean}
// add_cards_committed.method gains camera / camera_fast_add (commit.ts).

export const PICK_REASONS = [
  "printed_code_collision",
  "small_series_N_of_2",
  "several_cards",
  "number_conflict",
  "reading_conflict",
] as const;
export type PickReason = (typeof PICK_REASONS)[number];

export function cameraScreenViewed(): void {
  phoneScreenViewed("camera");
}

export function scanRecognised(a: Pick<Accepted, "reader" | "keyStrength" | "tAcceptMs">): void {
  capturePhone("scan_recognised", {
    reader: a.reader === "paddle" ? "paddle" : "tesseract",
    key_strength: a.keyStrength === "strong" ? "strong" : "weak",
    time_bucket: timeBucket(a.tAcceptMs),
  });
}

export function scanDecision(decision: ScanDecision): void {
  capturePhone("scan_decision", { decision });
}

/** Any reason outside the registered enum is reported as several_cards
 * (the generic "more than one card" case) rather than leaking a raw string. */
export function scanPickShown(reason: string): void {
  const r = (PICK_REASONS as readonly string[]).includes(reason)
    ? (reason as PickReason)
    : "several_cards";
  capturePhone("scan_pick_shown", { reason: r });
}

export function scanFallbackKeypad(hadPartial: boolean): void {
  capturePhone("scan_fallback_keypad", { had_partial: hadPartial });
}
