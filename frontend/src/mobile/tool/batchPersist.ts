import type { BatchRow } from "./batch";
import type { ToolMode } from "./toolStore";

// BL-253 S7-08: the batch survives the document hop. The camera runs in the
// isolated /scan/ document (an in-app layer cannot be cross-origin isolated),
// and a full navigation empties every module store -- so the batch rows and
// the tool fields that must outlive the hop (mode, set, precon deck) are
// mirrored to sessionStorage, `hsv.tool.v1`, on every change and rehydrated
// by both documents at load (and on a bfcache `pageshow`, because the other
// document may have changed the batch while this one was frozen).
//
// sessionStorage is per tab and origin-wide: /scan/ and / share it, and a new
// tab starts empty (the batch is a session thing, as S3 built it). Every
// read and write is try/catch'd and versioned: an unreadable, corrupt or
// foreign-version value is treated as absent, a blocked store makes the
// mirror a no-op -- the page works exactly as it did before this module.
//
// Leaf module: it imports only TYPES from batch.ts / toolStore.ts (which call
// into it), so there is no import cycle.

export const TOOL_KEY = "hsv.tool.v1";
const VERSION = 1;

/** The tool fields that outlive the hop (toolStore.ts keeps the rest). */
export interface PersistedTool {
  mode: ToolMode;
  setCode: string;
  preconKey: string | null;
}

export interface Persisted {
  seq: number;
  rows: BatchRow[];
  /** null when the stored value carried no usable tool fields. */
  tool: PersistedTool | null;
}

function store(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

const isStr = (v: unknown): v is string => typeof v === "string";

/** A stored row is kept only if the fields the batch view reads are there. */
function isBatchRow(v: unknown): v is BatchRow {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    isStr(r.id) &&
    isStr(r.via) &&
    typeof r.force === "boolean" &&
    isStr(r.setCode) &&
    isStr(r.cardNumber) &&
    !!r.picks &&
    typeof r.picks === "object" &&
    (r.variantId === null || typeof r.variantId === "number") &&
    (r.baseCardId === null || typeof r.baseCardId === "number")
  );
}

function toolOf(v: unknown): PersistedTool | null {
  if (!v || typeof v !== "object") return null;
  const t = v as Record<string, unknown>;
  if ((t.mode !== "keypad" && t.mode !== "camera") || !isStr(t.setCode)) return null;
  if (t.preconKey !== null && !isStr(t.preconKey)) return null;
  return { mode: t.mode, setCode: t.setCode, preconKey: t.preconKey as string | null };
}

/** Parse a stored string; null for anything that is not a valid v1 value. */
export function parsePersisted(raw: string | null): Persisted | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || o.v !== VERSION) return null;
    const rows = Array.isArray(o.rows) ? o.rows.filter(isBatchRow) : [];
    // New ids must not collide with restored ones ("b-<n>").
    let seq = typeof o.seq === "number" && Number.isFinite(o.seq) ? o.seq : 0;
    for (const r of rows) {
      const n = /^b-(\d+)$/.exec(r.id);
      if (n && +n[1] > seq) seq = +n[1];
    }
    return { seq, rows, tool: toolOf(o.tool) };
  } catch {
    return null;
  }
}

// The two halves are written by two stores; the last of each is remembered so
// either one can write the whole value (and reading primes them, so a store
// that writes first cannot wipe the half the other one just restored).
let lastBatch: { rows: BatchRow[]; seq: number } = { rows: [], seq: 0 };
let lastTool: PersistedTool | null = null;

/** Read the mirror (hydration / pageshow). Primes the remembered halves. */
export function readPersisted(): Persisted | null {
  let p: Persisted | null = null;
  try {
    p = parsePersisted(store()?.getItem(TOOL_KEY) ?? null);
  } catch {
    p = null;
  }
  lastBatch = p ? { rows: p.rows, seq: p.seq } : { rows: [], seq: 0 };
  lastTool = p ? p.tool : null;
  return p;
}

function flush(): void {
  try {
    store()?.setItem(
      TOOL_KEY,
      JSON.stringify({
        v: VERSION,
        seq: lastBatch.seq,
        rows: lastBatch.rows,
        ...(lastTool ? { tool: lastTool } : {}),
      })
    );
  } catch {
    /* blocked or full: the mirror is best effort */
  }
}

export function writeBatch(rows: BatchRow[], seq: number): void {
  lastBatch = { rows, seq };
  flush();
}

export function writeTool(tool: PersistedTool): void {
  if (
    lastTool &&
    lastTool.mode === tool.mode &&
    lastTool.setCode === tool.setCode &&
    lastTool.preconKey === tool.preconKey
  )
    return;
  lastTool = tool;
  flush();
}

/** Forget everything (resetBatchForTest / resetToolForTest, tests). */
export function clearPersisted(): void {
  lastBatch = { rows: [], seq: 0 };
  lastTool = null;
  try {
    store()?.removeItem(TOOL_KEY);
  } catch {
    /* ignore */
  }
}
