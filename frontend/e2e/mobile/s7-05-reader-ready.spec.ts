import { expect, measureEach, test } from "./helpers";

// S7-05: the Paddle reader runs in a module worker (never on the UI thread).
// On the camera route of the scanner document it starts, loads its models and
// reports ready; the load time and thread count are logged for the build log.
test.afterEach(measureEach);

test("s7-05-reader-ready", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/scan/#/camera");
  await expect(page.locator(".m-app")).toBeVisible();
  const init = await page.evaluate(() => {
    const s = (window as unknown as { __scan: { startReader(): Promise<unknown> } }).__scan;
    return s.startReader();
  });
  console.log("[s7-05] paddle init " + JSON.stringify(init));
  const i = init as { ok: boolean; loadMs: number; threads: number; crossOriginIsolated: boolean };
  expect(i.ok).toBe(true);
  expect(i.crossOriginIsolated).toBe(true);
  expect(i.threads).toBeGreaterThanOrEqual(1);
  const state = await page.evaluate(
    () => (window as unknown as { __scan: { reader: { state: string } } }).__scan.reader.state
  );
  expect(state).toBe("ready");

  // A synthetic strip read in the worker: the frame is an ImageBitmap that
  // travels by transfer; the answer has the spike's shape.
  const read = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 620;
    c.height = 60;
    const g = c.getContext("2d")!;
    g.fillStyle = "#101014";
    g.fillRect(0, 0, 620, 60);
    g.fillStyle = "#f2f2f2";
    g.font = "bold 28px Arial";
    g.fillText("SOR • EN  R  229/252", 20, 40);
    const bmp = await createImageBitmap(c);
    const s = (
      window as unknown as { __scan: { reader: { read(f: ImageBitmap): Promise<unknown> } } }
    ).__scan;
    return s.reader.read(bmp);
  });
  console.log("[s7-05] synthetic read " + JSON.stringify(read));
  const r = read as { ok: boolean; text: string; confidence: number; glyph_px: number | null };
  expect(r.ok).toBe(true);
  expect(r.text).toContain("229");
  expect(typeof r.confidence).toBe("number");
});
