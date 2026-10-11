import { beforeEach, describe, expect, it, vi } from "vitest";

// BL-253 S7-08 with the camera flag ON (it flips in stage 7b): camera mode is
// remembered across reloads and across the document hop. The stores are
// re-imported (vi.resetModules) so hydration runs exactly as on a page load.

vi.mock("../flags", () => ({ MOBILE_CAMERA_ENABLED: true }));

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.resetModules();
});

async function load() {
  const tool = await import("./toolStore");
  const batch = await import("./batch");
  return { tool, batch };
}

describe("S7-08 camera mode is remembered", () => {
  it("setToolMode('camera') writes the session mirror and hsv.scan.v1", async () => {
    const { tool } = await load();
    tool.setToolMode("camera");
    expect(JSON.parse(sessionStorage.getItem("hsv.tool.v1") as string).tool.mode).toBe("camera");
    expect(JSON.parse(localStorage.getItem("hsv.scan.v1") as string).mode).toBe("camera");
  });

  it("the next document (session mirror) opens in camera mode with the batch", async () => {
    const a = await load();
    a.tool.setToolMode("camera");
    a.batch.addCopy({
      via: "keypad",
      force: false,
      setCode: "SOR",
      cardNumber: "229",
      picks: a.tool.NO_PICKS,
      variantId: 1,
      baseCardId: 2,
    });
    vi.resetModules(); // the hop: a new document, a fresh module graph
    const b = await load();
    expect(b.tool.getToolState().mode).toBe("camera");
    expect(b.batch.getBatch().map((r) => r.cardNumber)).toEqual(["229"]);
  });

  it("a reload in a new tab (no session mirror) still opens in the remembered mode", async () => {
    const a = await load();
    a.tool.setToolMode("camera");
    sessionStorage.clear(); // a new tab: session storage is empty, localStorage is not
    vi.resetModules();
    const b = await load();
    expect(b.tool.getToolState().mode).toBe("camera");
    expect(b.batch.getBatch()).toEqual([]);
    expect(b.tool.toolRouteFor("camera")).toBe("#/camera");
  });

  it("the keypad is remembered the same way, and storage failures leave the keypad", async () => {
    const a = await load();
    a.tool.setToolMode("camera");
    a.tool.setToolMode("keypad");
    vi.resetModules();
    expect((await load()).tool.getToolState().mode).toBe("keypad");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.resetModules();
    expect((await load()).tool.getToolState().mode).toBe("keypad");
    vi.restoreAllMocks();
  });
});
