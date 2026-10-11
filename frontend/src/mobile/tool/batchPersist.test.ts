import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addCopy, discardBatch, getBatch, rehydrateBatch, removeCopy } from "./batch";
import type { NewBatchRow } from "./batch";
import { TOOL_KEY, parsePersisted, readPersisted } from "./batchPersist";
import {
  getScanSettings,
  parseScanSettings,
  reloadScanSettingsForTest,
  setScanSettings,
  SCAN_KEY,
} from "./scanSettings";
import { NO_PICKS, chooseSet, getToolState, rehydrateTool, resetToolForTest } from "./toolStore";

// BL-253 S7-08: the batch (and the tool fields that must outlive it) survive
// the hop between the main document and the isolated /scan/ document, and the
// camera's settings are remembered across reloads. A "hop" here is a module
// re-read of the sessionStorage mirror: rehydrateBatch / rehydrateTool run the
// same hydration the module load does.

const row = (n: number): NewBatchRow => ({
  via: "keypad",
  force: false,
  setCode: "SOR",
  cardNumber: String(n),
  picks: NO_PICKS,
  variantId: 7000 + n,
  baseCardId: 100 + n,
});

beforeEach(() => resetToolForTest());
afterEach(() => vi.restoreAllMocks());

describe("S7-08 batch survives the document hop", () => {
  it("round-trips rows, ids and the tool fields through sessionStorage", () => {
    chooseSet("JTL");
    addCopy(row(1));
    addCopy(row(2));
    const stored = JSON.parse(sessionStorage.getItem(TOOL_KEY) as string);
    expect(stored.v).toBe(1);
    expect(stored.rows).toHaveLength(2);
    expect(stored.tool).toEqual({ mode: "keypad", setCode: "JTL", preconKey: null });

    // the other document wrote a third copy meanwhile
    const next = { ...stored, rows: [...stored.rows, { ...stored.rows[0], id: "b-9" }], seq: 9 };
    sessionStorage.setItem(TOOL_KEY, JSON.stringify(next));
    rehydrateBatch();
    rehydrateTool();
    expect(getBatch().map((r) => r.id)).toEqual(["b-1", "b-2", "b-9"]);
    expect(getToolState().setCode).toBe("JTL");
    // ids keep counting past the restored ones
    expect(addCopy(row(3)).id).toBe("b-10");
  });

  it("every change writes through: remove one, discard all", () => {
    const a = addCopy(row(1));
    addCopy(row(2));
    removeCopy(a.id);
    expect(readPersisted()?.rows.map((r) => r.cardNumber)).toEqual(["2"]);
    discardBatch();
    expect(readPersisted()?.rows).toEqual([]);
  });

  it("a tool write before any batch write does not wipe the restored rows", () => {
    addCopy(row(1));
    // a fresh module view of the same storage: prime from the mirror, then change the tool
    readPersisted();
    chooseSet("LAW");
    expect(readPersisted()?.rows).toHaveLength(1);
    expect(readPersisted()?.tool?.setCode).toBe("LAW");
  });

  it("corrupt JSON, a foreign version and non-objects are treated as absent", () => {
    for (const bad of ["{not json", '{"v":2,"rows":[]}', "null", "[]", '"x"', ""])
      expect(parsePersisted(bad), bad).toBeNull();
    sessionStorage.setItem(TOOL_KEY, "{not json");
    rehydrateBatch();
    expect(getBatch()).toEqual([]);
    rehydrateTool();
    expect(getToolState().setCode).toBe("SOR");
  });

  it("drops invalid rows and invalid tool fields individually, keeps the rest", () => {
    const good = {
      id: "b-1",
      via: "keypad",
      force: false,
      setCode: "SOR",
      cardNumber: "5",
      picks: {},
      variantId: 1,
      baseCardId: 2,
    };
    const p = parsePersisted(
      JSON.stringify({
        v: 1,
        seq: 1,
        rows: [good, { id: 3 }, null, "x", { ...good, id: "b-7", variantId: "no" }],
        tool: { mode: "spaceship", setCode: "SOR", preconKey: null },
      })
    );
    expect(p?.rows.map((r) => r.id)).toEqual(["b-1"]);
    expect(p?.tool).toBeNull();
  });

  it("blocked storage: the stores still work and nothing throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => addCopy(row(1))).not.toThrow();
    expect(() => chooseSet("SHD")).not.toThrow();
    expect(getBatch()).toHaveLength(1);
    expect(getToolState().setCode).toBe("SHD");
    expect(() => rehydrateBatch()).not.toThrow();
    expect(readPersisted()).toBeNull();
    expect(getBatch()).toEqual([]); // nothing readable: an empty batch, the page still works
  });

  it("resetBatchForTest / resetToolForTest clear the mirror", () => {
    addCopy(row(1));
    expect(sessionStorage.getItem(TOOL_KEY)).not.toBeNull();
    resetToolForTest();
    expect(sessionStorage.getItem(TOOL_KEY)).toBeNull();
    expect(getBatch()).toEqual([]);
  });
});

describe("S7-08 persisted camera settings (hsv.scan.v1)", () => {
  it("defaults, then round-trips offsets, Fast add and mode", () => {
    expect(getScanSettings()).toEqual({
      boxOffsetMm: 0,
      boxOffsetVMm: 0,
      fastAdd: false,
      mode: "keypad",
    });
    setScanSettings({ boxOffsetMm: 1.5, boxOffsetVMm: -2.3, fastAdd: true, mode: "camera" });
    expect(JSON.parse(localStorage.getItem(SCAN_KEY) as string)).toEqual({
      v: 1,
      boxOffsetMm: 1.5,
      boxOffsetVMm: -2.3,
      fastAdd: true,
      mode: "camera",
    });
    reloadScanSettingsForTest();
    expect(getScanSettings()).toMatchObject({
      boxOffsetMm: 1.5,
      boxOffsetVMm: -2.3,
      fastAdd: true,
      mode: "camera",
    });
  });

  it("offsets are clamped to +/-4 mm and rounded to 0.1", () => {
    setScanSettings({ boxOffsetMm: 9, boxOffsetVMm: -9 });
    expect(getScanSettings()).toMatchObject({ boxOffsetMm: 4, boxOffsetVMm: -4 });
    setScanSettings({ boxOffsetMm: 1.2345 });
    expect(getScanSettings().boxOffsetMm).toBe(1.2);
  });

  it("corrupt, foreign-version and partly invalid storage fall back field by field", () => {
    expect(parseScanSettings("{nope")).toEqual(getDefaults());
    expect(parseScanSettings('{"v":9,"fastAdd":true}')).toEqual(getDefaults());
    expect(parseScanSettings('{"v":1,"boxOffsetMm":"x","fastAdd":"yes","mode":"camera"}')).toEqual({
      ...getDefaults(),
      mode: "camera",
    });
  });

  it("blocked localStorage: defaults, setting does not throw", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    reloadScanSettingsForTest();
    expect(getScanSettings()).toEqual(getDefaults());
    expect(() => setScanSettings({ fastAdd: true })).not.toThrow();
    expect(getScanSettings().fastAdd).toBe(true); // kept in memory for the page
  });

  it("the last tool mode is remembered, but the camera cannot be entered while the flag is off", () => {
    // MOBILE_CAMERA_ENABLED is false until stage 7b: the camera mode is ignored.
    localStorage.setItem(SCAN_KEY, JSON.stringify({ v: 1, mode: "camera" }));
    reloadScanSettingsForTest();
    rehydrateTool();
    expect(getToolState().mode).toBe("keypad");
  });
});

function getDefaults() {
  return { boxOffsetMm: 0, boxOffsetVMm: 0, fastAdd: false, mode: "keypad" };
}
