import { useSyncExternalStore } from "react";

// BL-253 S7-08: the camera's remembered settings, localStorage `hsv.scan.v1`
// (the spike's app.js:5-31 pattern): the two guide-alignment offsets (mm), the
// Fast add toggle and the last tool mode -- so camera mode is remembered
// across reloads, the way the keypad's set is not. Unreadable, blocked,
// corrupt or foreign-version storage -> defaults, and the page still works.
//
// Lives under tool/ (not camera/) because toolStore.ts reads `mode` at load
// and the main document must never import mobile/camera/.

export const SCAN_KEY = "hsv.scan.v1";
const VERSION = 1;
/** Both sliders are +/-4 mm (Spec 24.3). */
export const OFFSET_LIMIT_MM = 4;

export interface ScanSettings {
  /** Horizontal guide-alignment offset, mm. */
  boxOffsetMm: number;
  /** Vertical guide-alignment offset, mm. */
  boxOffsetVMm: number;
  fastAdd: boolean;
  mode: "keypad" | "camera";
}

export const DEFAULT_SCAN_SETTINGS: ScanSettings = {
  boxOffsetMm: 0,
  boxOffsetVMm: 0,
  fastAdd: false,
  mode: "keypad",
};

function store(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

const clampMm = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.max(-OFFSET_LIMIT_MM, Math.min(OFFSET_LIMIT_MM, Math.round(v * 10) / 10));
};

/** Parse a stored value field by field; anything invalid falls to its default. */
export function parseScanSettings(raw: string | null): ScanSettings {
  if (!raw) return { ...DEFAULT_SCAN_SETTINGS };
  try {
    const o = JSON.parse(raw) as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || o.v !== VERSION) return { ...DEFAULT_SCAN_SETTINGS };
    return {
      boxOffsetMm: clampMm(o.boxOffsetMm),
      boxOffsetVMm: clampMm(o.boxOffsetVMm),
      fastAdd: o.fastAdd === true,
      mode: o.mode === "camera" ? "camera" : "keypad",
    };
  } catch {
    return { ...DEFAULT_SCAN_SETTINGS };
  }
}

function load(): ScanSettings {
  try {
    return parseScanSettings(store()?.getItem(SCAN_KEY) ?? null);
  } catch {
    return { ...DEFAULT_SCAN_SETTINGS };
  }
}

let current: ScanSettings = load();
const subs = new Set<() => void>();

export function getScanSettings(): ScanSettings {
  return current;
}

/** Merge a patch, persist (best effort), notify. Offsets are clamped to +/-4 mm. */
export function setScanSettings(patch: Partial<ScanSettings>): void {
  const next: ScanSettings = {
    ...current,
    ...patch,
    boxOffsetMm: clampMm(patch.boxOffsetMm ?? current.boxOffsetMm),
    boxOffsetVMm: clampMm(patch.boxOffsetVMm ?? current.boxOffsetVMm),
  };
  if (
    next.boxOffsetMm === current.boxOffsetMm &&
    next.boxOffsetVMm === current.boxOffsetVMm &&
    next.fastAdd === current.fastAdd &&
    next.mode === current.mode
  )
    return;
  current = next;
  try {
    store()?.setItem(SCAN_KEY, JSON.stringify({ v: VERSION, ...next }));
  } catch {
    /* blocked or full: the settings simply do not persist */
  }
  subs.forEach((f) => f());
}

function subscribe(f: () => void): () => void {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

export function useScanSettings(): ScanSettings {
  return useSyncExternalStore(subscribe, getScanSettings, getScanSettings);
}

/** Test seam: re-read the store (after a test seeds or corrupts it). */
export function reloadScanSettingsForTest(): void {
  current = load();
  subs.forEach((f) => f());
}

/** Test seam: forget stored settings and return to the defaults. */
export function resetScanSettingsForTest(): void {
  try {
    store()?.removeItem(SCAN_KEY);
  } catch {
    /* ignore */
  }
  current = { ...DEFAULT_SCAN_SETTINGS };
  subs.forEach((f) => f());
}
