import type { Page } from "@playwright/test";
import { expect, measureEach, wideText } from "./helpers";
import { LANDSCAPE, PORTRAIT, test } from "./clip-helpers";

// BL-257 FR5-06 (owner decision 2026-10-12, F-18), the scanner half. In an
// s7-* file because only those run in the `scan` project. The isolated /scan/
// document renders the same phone app, so a phone on its side gets the same
// "Turn your phone upright" screen there; while it shows no card is accepted
// (the read loop is paused through the camera's existing "something is over
// the preview" block) and the stream is NOT stopped -- turning upright does
// not restart the camera, does not show "Camera paused" and does not re-enter
// the "Focusing…" start state; reading resumes by itself.
//
// The clip is fake_v2_std (Cell Block Guard SOR 229/252), which s7-20 reads to
// a prompt in a few seconds when the phone is upright. The turn is
// `setViewportSize` (see fr5-06-landscape.spec.ts: Playwright sets
// `screen.orientation.type` from the viewport of an isMobile context).
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(test.info().project.name !== "scan", "scan project only");
});

declare global {
  interface Window {
    __camLog?: { attr: string; v: string | null }[];
  }
}

const cam = (page: Page) => page.locator(".m-cam");
const panel = (page: Page) => page.locator(".m-rotate");
const ocrCalls = (page: Page) =>
  page.evaluate(() => window.__ocrCalls!.paddle + window.__ocrCalls!.tesseract);
/** The live MediaStream on the preview: its id and its video track's state. */
const streamOf = (page: Page) =>
  page.evaluate(() => {
    const s = document.querySelector<HTMLVideoElement>(".m-cam video")!
      .srcObject as MediaStream | null;
    const t = s?.getVideoTracks()[0];
    return { id: s?.id ?? null, track: t?.id ?? null, state: t?.readyState ?? null };
  });

test.describe("a phone on its side at the scanner", () => {
  test.use({ clip: "fake_v2_std", clipViewport: LANDSCAPE });

  test("s7-25-fr5-06-scan-landscape rotate screen: no read, stream kept, reading resumes upright", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/scan/#/camera");
    // The phone app (the scanner), not the desktop tree -- under the panel.
    await expect(panel(page)).toBeVisible();
    await expect(page.locator(".m-app")).toHaveCount(1);
    await expect(page.locator(".app-layout")).toHaveCount(0);
    expect(await page.evaluate(() => screen.orientation.type)).toMatch(/^landscape/);
    await expect(panel(page).locator(".m-rotate__title")).toHaveText("Turn your phone upright");
    await expect(panel(page).locator(".m-rotate__sub")).toHaveText(
      "Hyperspace Vault is built for portrait on phones."
    );
    await expect(page.locator("#root")).toHaveAttribute("inert", "");
    // The camera starts beneath it and is not reading.
    await expect(cam(page)).toHaveAttribute("data-stream", "live", { timeout: 20000 });
    await expect(cam(page)).toHaveAttribute("data-reading", "paused");
    const before = await streamOf(page);
    expect(before.state).toBe("live");

    // Every later change of the stream / start state / phase is logged.
    await page.evaluate(() => {
      window.__camLog = [];
      const el = document.querySelector(".m-cam")!;
      new MutationObserver((ms) => {
        for (const m of ms)
          window.__camLog!.push({ attr: m.attributeName!, v: el.getAttribute(m.attributeName!) });
      }).observe(el, {
        attributes: true,
        attributeFilter: ["data-stream", "data-settle", "data-phase"],
      });
    });

    // Upright this clip is read in a few seconds; on its side, nothing.
    await page.waitForTimeout(8000);
    await expect(cam(page)).toHaveAttribute("data-phase", "searching");
    expect(await ocrCalls(page), "nothing was read while the rotate screen showed").toBe(0);
    await expect(page.locator(".m-cam__bar .m-logbtn")).toHaveClass(/m-logbtn--empty/);
    await expect(page.locator(".m-cam__panel .m-ident__name")).toHaveCount(0);
    // The panel fits here too, under both text conditions.
    const fits = () =>
      page.evaluate(() => {
        const p = document.querySelector<HTMLElement>(".m-rotate")!;
        const b = p.getBoundingClientRect();
        const lines = [...p.querySelectorAll<HTMLElement>("p")].map((e) => {
          const r = document.createRange();
          r.selectNodeContents(e);
          const x = r.getBoundingClientRect();
          return (
            x.left >= b.left - 0.5 &&
            x.right <= b.right + 0.5 &&
            e.scrollWidth <= e.clientWidth + 0.5
          );
        });
        return (
          lines.every(Boolean) &&
          p.scrollWidth <= p.clientWidth + 0.5 &&
          b.width >= innerWidth - 0.5 &&
          b.height >= innerHeight - 0.5
        );
      });
    expect(await fits(), "fits, normal text").toBe(true);
    await wideText(page, ".m-rotate");
    expect(await fits(), "fits, wide text").toBe(true);

    // Turn upright: the same stream, reading resumes by itself.
    await page.setViewportSize(PORTRAIT);
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator("#root")).not.toHaveAttribute("inert", /.*/);
    await expect(cam(page)).toHaveAttribute("data-reading", "on");
    await expect(cam(page)).toHaveAttribute("data-phase", "found", { timeout: 20000 });
    await expect(page.locator(".m-cam__panel .m-ident__name")).toHaveText("Cell Block Guard");
    await expect(page.locator(".m-cam__panel .m-cam__code")).toHaveText("SOR 229/252");
    expect(await ocrCalls(page)).toBeGreaterThan(0);
    const after = await streamOf(page);
    expect(after, "the stream was never stopped or replaced").toEqual(before);
    const log = await page.evaluate(() => window.__camLog!);
    expect(
      log.filter((l) => l.attr === "data-stream"),
      "the stream state never changed (no restart, no pause)"
    ).toEqual([]);
    expect(
      log.filter((l) => l.attr === "data-settle" && l.v === "settling"),
      'the "Focusing…" start state was not re-entered'
    ).toEqual([]);
    // (`m-cam--paused` is the prompt's own class -- a card is showing -- not
    // the stream's; the stream's paused state is data-stream, checked above.)
    expect(log.filter((l) => l.attr === "data-phase").map((l) => l.v)).toEqual(["found"]);
    await expect(page.getByText("Camera paused")).toHaveCount(0);

    // On its side again with a card prompted: nothing can be added; upright,
    // the prompt is still there and Add works.
    const add = page.locator(".m-cam__panel .m-ident__add .swu-btn");
    const at = (await add.boundingBox())!;
    await page.setViewportSize(LANDSCAPE);
    await expect(panel(page)).toBeVisible();
    await expect(cam(page)).toHaveAttribute("data-reading", "paused");
    const again = (await add.boundingBox())!;
    for (const b of [at, again])
      await page.touchscreen.tap(
        Math.min(b.x + b.width / 2, LANDSCAPE.width - 2),
        Math.min(b.y + b.height / 2, LANDSCAPE.height - 2)
      );
    await page.waitForTimeout(400);
    await page.setViewportSize(PORTRAIT);
    await expect(panel(page)).toHaveCount(0);
    await expect(cam(page)).toHaveAttribute("data-phase", "found");
    await expect(page.locator(".m-cam__bar .m-logbtn")).toHaveClass(/m-logbtn--empty/);
    await add.click();
    await expect(page.locator(".m-cam__bar .m-logbtn__n")).toHaveText("1");
    expect(await streamOf(page)).toEqual(before);
  });
});
