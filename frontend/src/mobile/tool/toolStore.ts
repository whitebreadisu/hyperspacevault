import { useSyncExternalStore } from "react";
import { MOBILE_CAMERA_ENABLED } from "../flags";
import { go } from "../router";
import { addCopy, resetBatchForTest } from "./batch";
import type { NewBatchRow } from "./batch";

// BL-249 S3-01: the tool layer's state (rev4 M.state().pad / padSet /
// padPrecon / toolMode). A plain module store, so it survives the layer
// closing and the card layer opening over it (S3-06), for the session only
// (never persisted; a reload starts on SOR, rev4 data.js:79).
//   - mode: the last-used tool mode. With MOBILE_CAMERA_ENABLED off there is
//     only the keypad, so the camera mode can never be remembered (plan A8).
//   - setCode / preconKey: what the keypad is locked to (S3-05). A deck
//     replaces the set while it is chosen; picking a set clears the deck.
//   - num: the typed card number (digits only, at most 4, no leading zero).
//   - picks: the axis overrides the user made on a shared number -- desktop
//     AddCardsKeypad's draft (cardKey / setKey / stamp / finish).
//   - the batch itself (one row per copy, cap admission, remove one, discard)
//     lives in batch.ts (S3-08); this store keeps only the keypad's own state:
//     `lastAdded` names the batch row the "In batch" panel shows and
//     `preconAdded` the deck-add confirmation line (S3-09).

export type ToolMode = "keypad" | "camera";

export interface PadPicks {
  cardKey: string | null;
  setKey: string | null;
  stamp: string | null;
  finish: string | null;
}

export const NO_PICKS: PadPicks = { cardKey: null, setKey: null, stamp: null, finish: null };

export interface ToolState {
  mode: ToolMode;
  setCode: string;
  preconKey: string | null;
  num: string;
  picks: PadPicks;
  /** The last add (drives the "In batch" panel until the next key press). */
  lastAdded: { entryId: string; at: number } | null;
  /** S3-09: the last "Add deck to batch" (n copies written), shown in the
   * precon panel until the deck or set changes. */
  preconAdded: { key: string; n: number; at: number } | null;
}

const INITIAL: ToolState = {
  mode: "keypad",
  setCode: "SOR",
  preconKey: null,
  num: "",
  picks: NO_PICKS,
  lastAdded: null,
  preconAdded: null,
};

let state: ToolState = INITIAL;
const subs = new Set<() => void>();

function emit(next: ToolState): void {
  state = next;
  subs.forEach((f) => f());
}

export function getToolState(): ToolState {
  return state;
}

export function setToolState(patch: Partial<ToolState>): void {
  emit({ ...state, ...patch });
}

function subscribe(f: () => void): () => void {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

export function useToolState(): ToolState {
  return useSyncExternalStore(subscribe, getToolState, getToolState);
}

/** The route a tool mode lives at. */
export function toolRouteFor(mode: ToolMode): string {
  return mode === "camera" && MOBILE_CAMERA_ENABLED ? "#/camera" : "#/pad";
}

/** S3-01 (rev4 M.setToolMode): remember the mode; ignored for the camera
 * while the camera flag is off. */
export function setToolMode(mode: ToolMode): void {
  if (mode === "camera" && !MOBILE_CAMERA_ENABLED) return;
  if (state.mode !== mode) setToolState({ mode });
}

/** S3-01: the bar's centre button -- opens the mode used last. */
export function openTool(): void {
  go(toolRouteFor(state.mode));
}

/** Keypad key handling (rev4 MPad onKey): digits append (max 4, leading
 * zeros dropped), del removes one, clr empties. Any key drops the axis
 * picks and the last-add panel. Keys rest while a deck is chosen. */
export function padKey(k: string): void {
  if (state.preconKey) return;
  let num = state.num;
  if (k === "del") num = num.slice(0, -1);
  else if (k === "clr") num = "";
  else if (/^\d$/.test(k)) {
    if (num.length >= 4) return;
    num = (num + k).replace(/^0+(?=\d)/, "");
  } else return;
  emit({ ...state, num, picks: NO_PICKS, lastAdded: null });
}

export function setPadPick(axis: keyof PadPicks, value: string | null): void {
  // Desktop AddCardsKeypad: a pick on an upper axis resets the axes under it.
  const order: (keyof PadPicks)[] = ["cardKey", "setKey", "stamp", "finish"];
  const picks = { ...state.picks, [axis]: value };
  for (const a of order.slice(order.indexOf(axis) + 1)) picks[a] = null;
  emit({ ...state, picks });
}

/** S3-05: lock the keypad to a set (clears a chosen deck and the number). */
export function chooseSet(code: string): void {
  emit({
    ...state,
    setCode: code,
    preconKey: null,
    num: "",
    picks: NO_PICKS,
    lastAdded: null,
    preconAdded: null,
  });
}

/** S3-05: lock the keypad to a precon deck. */
export function choosePrecon(key: string): void {
  emit({
    ...state,
    preconKey: key,
    num: "",
    picks: NO_PICKS,
    lastAdded: null,
    preconAdded: null,
  });
}

/** S3-02 / S3-04: Add -- the copy goes in the batch (S3-08), the number
 * clears (the deck restores) and the panel shows the card just added. */
export function addPadEntry(e: NewBatchRow): void {
  const row = addCopy(e);
  emit({
    ...state,
    num: "",
    picks: NO_PICKS,
    lastAdded: { entryId: row.id, at: Date.now() },
  });
}

/** S3-09: the precon panel's confirmation line. */
export function setPreconAdded(key: string, n: number): void {
  emit({ ...state, preconAdded: { key, n, at: Date.now() } });
}

/** Test seam. */
export function resetToolForTest(): void {
  resetBatchForTest();
  emit(INITIAL);
}
