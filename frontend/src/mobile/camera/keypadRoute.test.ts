import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../analytics/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../analytics/analytics")>()),
  capture: vi.fn(),
}));

import { capture } from "../../analytics/analytics";
import { cameraKeypadRoute, setCameraKeypadExit } from "../tool/cameraHop";
import { keypadRoute } from "./CameraScreen";
import { partialRead } from "./scanLoop";

// BL-253 S7-16: no read -> keypad prefilled. The partial read (the newest of
// the last 8 reads with a parsed code or number, app.js:1017-1022) becomes the
// review deep link `#/pad?set=<code>&num=<n>` -- only when the set exists in
// the app's sets (rev4 MCamera.jsx:143-152) -- and sends
// scan_fallback_keypad {had_partial}. The header's keypad toggle uses the same
// route (cameraKeypadRoute) while the camera is mounted.

const SETS = { SOR: "Spark of Rebellion", ASHP: "Ashes of the Empire Weekly Play" };
const spy = vi.mocked(capture);
beforeEach(() => spy.mockClear());

describe("S7-16 partialRead -> keypad prefill", () => {
  it("code + number -> set + num; code only -> set; unknown set or nothing -> plain keypad", () => {
    expect(keypadRoute({ code: "SOR", num: "229" }, SETS)).toBe("#/pad?set=SOR&num=229");
    expect(keypadRoute({ code: "SOR", num: "007" }, SETS)).toBe("#/pad?set=SOR&num=7");
    expect(keypadRoute({ code: "SOR", num: null }, SETS)).toBe("#/pad?set=SOR");
    expect(keypadRoute({ code: "XYZ", num: "12" }, SETS)).toBe("#/pad");
    expect(keypadRoute({ code: null, num: "12" }, SETS)).toBe("#/pad");
    expect(keypadRoute(null, SETS)).toBe("#/pad");
    expect(spy.mock.calls.map(([, p]) => (p as { had_partial: boolean }).had_partial)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it("the partial comes from the last 8 reads (newest first)", () => {
    const reads = [
      { code: "SOR", num: "22" },
      { code: null, num: null },
      { code: "SOR", num: "229" },
      { code: null, num: null },
    ];
    expect(keypadRoute(partialRead(reads), SETS)).toBe("#/pad?set=SOR&num=229");
  });

  it("the toggle's route follows the mounted camera, else the plain keypad", () => {
    expect(cameraKeypadRoute()).toBe("#/pad");
    setCameraKeypadExit(() => keypadRoute({ code: "ASHP", num: "16" }, SETS));
    expect(cameraKeypadRoute()).toBe("#/pad?set=ASHP&num=16");
    setCameraKeypadExit(null);
    expect(cameraKeypadRoute()).toBe("#/pad");
  });
});
