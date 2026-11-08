import type { Page } from "@playwright/test";
import { expect, test } from "./helpers";
import { recorderFor } from "./mock-api";

// BL-341 R1-1: the desktop header at every width from the phone breakpoint
// (768) to 1920. The Command pod hangs from the top edge in one row with
// the brand and the account slot: header top 0 and 120 px tall, pod top 0,
// nothing wraps (one row of pod items, one line per label and button, a
// one-line tag), nothing overlaps, no horizontal overflow -- signed in (the
// widest pod: Collection + Stashes + [HSV] Updates) and signed out (the
// widest account slot: Feedback + Sign In), and with a share's long name.
// The density step (index.css, NavPod.css) is measured by Header.tsx from
// what the row holds; the old fixed edges (899/900/1079/1080) stay in the
// sweep. Each width also asserts the step is the roomiest that fits.
test.beforeEach(() => {
  test.skip(test.info().project.name !== "desktop-1440", "desktop header");
});
test.afterEach(async ({ page }) => {
  const rec = recorderFor(page);
  expect(rec.pageErrors, "pageerror").toEqual([]);
  expect(rec.consoleErrors, "console errors").toEqual([]);
});

const WIDTHS = [...Array.from({ length: 29 }, (_, i) => 768 + i * 40), 899, 900, 1079, 1080, 1920];

async function measure(page: Page) {
  return page.evaluate(() => {
    const r = (el: Element) => el.getBoundingClientRect();
    const q = (s: string) => document.querySelector(s)!;
    const header = q(".app-header");
    // Text lines only (a label's absolute underline span is not a line).
    const lines = (el: Element) => {
      const tops = new Set<number>();
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const parent = n.parentElement!;
        if (getComputedStyle(parent).display === "none" || !n.textContent!.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const x of Array.from(range.getClientRects()))
          if (x.width > 0) tops.add(Math.round(x.top));
      }
      return tops.size;
    };
    const visible = (el: Element) => r(el).width > 0 && getComputedStyle(el).opacity !== "0";
    const podBtns = Array.from(document.querySelectorAll(".pod__top, .pod__sub")).filter(visible);
    const acctBtns = Array.from(document.querySelectorAll(".app-header__account > *"));
    return {
      top: r(header).top,
      height: r(header).height,
      overflow: header.scrollWidth - header.clientWidth,
      podTop: r(q(".pod")).top,
      podH: r(q(".pod")).height,
      brandRight: r(q(".app-header__brand-btn")).right,
      podLeft: r(q(".pod")).left,
      podRight: r(q(".pod")).right,
      acctLeft: Math.min(...acctBtns.map((e) => r(e).left)),
      podRowTops: new Set(podBtns.map((e) => Math.round(r(e).top))).size,
      podLabelLines: Math.max(
        ...Array.from(document.querySelectorAll(".pod__label, .pod__sub"))
          .filter(visible)
          .map(lines)
      ),
      acctTops: new Set(acctBtns.map((e) => Math.round(r(e).top + r(e).height / 2))).size,
      btnLines: Math.max(
        ...Array.from(document.querySelectorAll(".app-header__account .swu-btn__label")).map(lines)
      ),
      tagLines: lines(q(".app-header__brand-line")),
    };
  });
}

/** Whether a step roomier than the one shown would also fit (it should not). */
function roomierFits(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector(".app-header") as HTMLElement;
    const order = ["full", "compact", "tight", "minimal"];
    const shown = el.getAttribute("data-density") ?? "full";
    let fits = false;
    el.setAttribute("data-measuring", "");
    for (const d of order.slice(0, order.indexOf(shown))) {
      el.setAttribute("data-density", d);
      if (el.scrollWidth <= el.clientWidth) fits = true;
    }
    el.setAttribute("data-density", shown);
    el.removeAttribute("data-measuring");
    return fits;
  });
}

async function sweep(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 700 });
    // Scroll the content: the header never moves with it.
    await page.mouse.move(w / 2, 600);
    await page.mouse.wheel(0, 2000);
    await expect
      .poll(async () => (await measure(page)).podH, { message: `pod settles at ${w}` })
      .toBe(62);
    // The step shown is the roomiest whose row fits (a roomier one would
    // overflow); polled, since the measurement follows a resize observer.
    await expect.poll(() => roomierFits(page), { message: `roomiest step at ${w}` }).toBe(false);
    const m = await measure(page);
    const at = `${w}px ${JSON.stringify(m)}`;
    expect(m.top, at).toBe(0);
    expect(Math.round(m.height), at).toBe(120);
    expect(m.podTop, at).toBe(0);
    expect(m.overflow, at).toBeLessThanOrEqual(0);
    expect(m.podLeft, at).toBeGreaterThanOrEqual(m.brandRight + 8);
    expect(m.podRight, at).toBeLessThanOrEqual(m.acctLeft - 8);
    expect(m.podRowTops, at).toBe(1);
    expect(m.podLabelLines, at).toBe(1);
    expect(m.acctTops, at).toBe(1);
    expect(m.btnLines, at).toBe(1);
    expect(m.tagLines, at).toBe(1);
  }
}

test.describe("signed in", () => {
  test.use({
    storageState: "e2e/.auth/phone.json",
    stashSeed: {
      stashes: [
        { id: 1, name: "Red binder", description: null, created_at: "2026-11-01T00:00:00Z" },
      ],
      stashItems: [{ stash_id: 1, variant_id: 17, quantity: 1 }],
    },
  });

  test("r1-01-header-pinned-every-width-signed-in", async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.removeItem("swu.releaseNotes.lastSeen");
      } catch {
        /* the Updates item shows while unread */
      }
    });
    await page.goto("/");
    await expect(page.locator('[data-sub="stashes"]')).toBeVisible();
    await expect(page.locator('[data-top="updates"]')).toBeVisible();
    await sweep(page);
    // The Stashes page carries the same header.
    await page.setViewportSize({ width: 1440, height: 700 });
    await page.locator('[data-sub="stashes"]').click();
    await expect(page.locator(".sp-page")).toBeVisible();
    await sweep(page);
  });
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("r1-01-header-pinned-every-width-signed-out", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".app-header__account").getByText("Sign In")).toBeVisible();
    await sweep(page);
  });
});

test("r1-01-feedback-label-steps-down", async ({ page }) => {
  await page.goto("/");
  const fb = page.getByRole("button", { name: "Leave Feedback" });
  const shown = () =>
    fb.evaluate((el) => (el as HTMLElement).innerText.replace(/\s+/g, " ").trim());
  await page.setViewportSize({ width: 1440, height: 700 });
  await expect(page.locator(".app-header")).toHaveAttribute("data-density", "full");
  await expect.poll(shown).toMatch(/^leave feedback$/i);
  // At the tight step the button reads "Feedback" (the phone header's
  // label); its accessible name stays "Leave Feedback".
  await page.setViewportSize({ width: 768, height: 700 });
  await expect(page.locator(".app-header")).toHaveAttribute("data-density", "tight");
  await expect.poll(shown).toMatch(/^feedback$/i);
  await expect(fb).toHaveAccessibleName("Leave Feedback");
});

// Review fold-in: a share's name is the one user-supplied label in the pod.
// Signed in, holding a share (Collection + Stashes + the share's name) and
// viewing it (My vault + the name, amber), with the long fixture name.
test.describe("with a share", () => {
  test.use({
    storageState: "e2e/.auth/phone.json",
    stashSeed: {
      stashes: [
        { id: 1, name: "Red binder", description: null, created_at: "2026-11-01T00:00:00Z" },
      ],
      stashItems: [{ stash_id: 1, variant_id: 17, quantity: 1 }],
    },
  });

  test("r1-01-header-pinned-every-width-viewing-a-share", async ({ page }) => {
    await page.goto("/shared/tok-long");
    await expect(page.locator('[data-sub="shared"]')).toHaveAttribute("aria-current", "page");
    await expect(page.locator('[data-sub="own"]')).toBeVisible();
    await sweep(page);
  });

  test("r1-01-minimal-step-icon-only-items-keep-their-names", async ({ page }) => {
    await page.goto("/shared/tok-long");
    await page.locator('[data-sub="own"]').click();
    await expect(page.locator('[data-sub="collection"]')).toHaveAttribute("aria-current", "page");
    await page.setViewportSize({ width: 768, height: 700 });
    const header = page.locator(".app-header");
    await expect(header).toHaveAttribute("data-density", "minimal");
    const pod = page.getByTestId("nav-pod");
    for (const [top, name] of [
      ["vault", "Vault"],
      ["decks", "Decks"],
    ]) {
      const b = pod.locator(`[data-top="${top}"]`);
      await expect(b.locator(".pod__label")).toBeHidden();
      await expect(b).toHaveAccessibleName(name);
      await expect(b).toHaveAttribute("title", name);
    }
    await expect(pod.getByRole("button", { name: "Vault" })).toBeVisible();
    // Roomier again: the labels and no tooltips.
    await page.setViewportSize({ width: 1920, height: 700 });
    await expect(header).not.toHaveAttribute("data-density", "minimal");
    await expect(pod.locator('[data-top="vault"] .pod__label')).toBeVisible();
    await expect(pod.locator('[data-top="vault"]')).not.toHaveAttribute("title", /.*/);
  });

  test("r1-01-header-pinned-every-width-holding-a-share", async ({ page }) => {
    await page.goto("/shared/tok-long");
    await expect(page.locator('[data-sub="shared"]')).toHaveAttribute("aria-current", "page");
    await page.locator('[data-sub="own"]').click();
    await expect(page.locator('[data-sub="collection"]')).toHaveAttribute("aria-current", "page");
    await expect(page.locator('[data-sub="stashes"]')).toBeVisible();
    await expect(page.locator('[data-sub="shared"]')).toBeVisible();
    await sweep(page);
  });
});
