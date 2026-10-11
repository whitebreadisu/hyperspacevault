import { expect, layoutProbe, measureEach, test } from "./helpers";
import { anims, openMore, openVault, transitionsDone, unreadNotes } from "./more-helpers";

// S4-04 (R5-2 + D2-0): the unread cue. The title / badge glow stays the
// primary cue; the More tab never glows; More opened first -> its Updates row
// pulses through an opacity-only layer (rev4 d2-0-cue-opacity-only on the
// More row + title); the collapse keeps its layout bound while the cue runs
// (d2-0-probe-with-cue-animating); only the real Updates screen clears.
test.afterEach(measureEach);
test.beforeEach(async ({ page }) => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone cue");
  await unreadNotes(page);
});

const moreTabAnims = () => {
  const more = document.querySelector(".m-nav .m-tab:last-child")!;
  return [more, ...more.querySelectorAll("*")].flatMap((e) => [
    getComputedStyle(e).animationName,
    getComputedStyle(e, "::before").animationName,
    getComputedStyle(e, "::after").animationName,
  ]);
};

test("s4-04-cue-opacity-only", async ({ page }) => {
  // The title on the Vault.
  await openVault(page);
  await transitionsDone(page);
  let r = await page.evaluate(anims);
  expect(r.bad).toEqual([]);
  expect(r.cue).toBeGreaterThanOrEqual(1);

  // More opened before the title: the Updates row pulses, opacity only.
  await page.locator(".m-nav .m-tab", { hasText: "More" }).click();
  await expect(page).toHaveURL(/#\/more$/);
  const row = page.locator('.m-morerow--cue[data-more="updates"]');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("aria-label", "[HSV] Updates, unread release notes");
  await transitionsDone(page);
  r = await page.evaluate(anims);
  expect(r.bad).toEqual([]);
  expect(r.cue).toBe(1);
  const t = await page.evaluate(() => {
    const title = document.querySelector('[data-more="updates"] .m-morerow__title')!;
    const a = getComputedStyle(title, "::after");
    return {
      own: getComputedStyle(title).animationName,
      name: a.animationName,
      dur: a.animationDuration,
      iter: a.animationIterationCount,
      pos: a.position,
      content: a.content,
    };
  });
  expect(t).toEqual({
    own: "none",
    name: "d2-cue-glow",
    dur: "2s",
    iter: "infinite",
    pos: "absolute",
    content: '"[HSV] Updates"',
  });

  // Opening Updates clears every cue for the session.
  await row.click();
  await expect(page).toHaveURL(/#\/more\/updates$/);
  await expect(page.locator(".m-updates")).toBeVisible();
  await page.locator(".m-shell__head [aria-label='Back']").click();
  await expect(page).toHaveURL(/#\/more$/);
  await expect(page.locator(".m-morerow--cue, .m-cue")).toHaveCount(0);
  await page.locator(".m-nav .m-tab", { hasText: "Vault" }).click();
  await expect(page.locator(".m-vh__word")).toBeVisible();
  await expect(page.locator(".m-cue")).toHaveCount(0);

  // Reduced motion: a steady glow on the More row, no pulse.
  await page.evaluate(() => localStorage.removeItem("swu.releaseNotes.lastSeen"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await openMore(page);
  await page.reload(); // a new session reads the cleared storage
  await expect(page.locator('.m-morerow--cue[data-more="updates"]')).toHaveCount(1);
  const rm = await page.evaluate(() => {
    const a = getComputedStyle(
      document.querySelector('[data-more="updates"] .m-morerow__title')!,
      "::after"
    );
    return { name: a.animationName, op: +a.opacity };
  });
  expect(rm.name).toBe("none");
  expect(rm.op).toBeCloseTo(0.85, 2);
});

test("s4-04-probe-with-cue", async ({ page }) => {
  // More first (row pulsing), then the Vault: the title cue still runs and
  // the collapse keeps its bound (<= 4 layouts, 0 shifts) while it does.
  await openMore(page);
  await expect(page.locator(".m-morerow--cue")).toHaveCount(1);
  await page.locator(".m-nav .m-tab", { hasText: "Vault" }).click();
  await expect(page.locator(".m-row").first()).toBeVisible();
  const cue = () => {
    const a = document
      .getAnimations()
      .filter((x) => (x as CSSAnimation).animationName === "d2-cue-glow");
    return {
      running: a.filter((x) => x.playState === "running").length,
      t: a.map((x) => Math.round(Number(x.currentTime ?? 0))),
    };
  };
  const before = await page.evaluate(cue);
  const probe = await layoutProbe(page, () => {
    document.querySelector(".m-vault__scroll")!.scrollTop = 60;
  });
  const after = await page.evaluate(cue);
  await expect(page.locator(".m-vh--collapsed")).toHaveCount(1);
  expect(before.running).toBeGreaterThanOrEqual(1);
  expect(after.running).toBe(before.running);
  after.t.forEach((v, i) => expect(v).toBeGreaterThan(before.t[i] + 300));
  expect(probe.layouts, JSON.stringify(probe)).toBeLessThanOrEqual(4);
  expect(probe.shifts).toBe(0);
  console.log(`s4-04 probe-with-cue ${test.info().project.name}: ${JSON.stringify(probe)}`);
});

test("s4-04-more-tab-never-glows", async ({ page }) => {
  await openVault(page);
  expect((await page.evaluate(moreTabAnims)).every((a) => a === "none")).toBe(true);
  // The chooser open (cue on its Updates button) -- the tab still never glows.
  await page.locator(".m-vh__brandtext").click();
  await expect(page.locator(".m-chooser__btn--cue .m-cue")).toHaveCount(1);
  expect((await page.evaluate(moreTabAnims)).every((a) => a === "none")).toBe(true);
  await page.locator(".m-chooser__x").click();
  // On More itself (title came first here, so the row stays still too).
  await page.locator(".m-nav .m-tab", { hasText: "More" }).click();
  await expect(page.locator(".m-more")).toBeVisible();
  expect((await page.evaluate(moreTabAnims)).every((a) => a === "none")).toBe(true);
  await expect(page.locator(".m-nav .m-tab:last-child [class*=cue]")).toHaveCount(0);
  await expect(page.locator(".m-morerow--cue")).toHaveCount(0);
});
