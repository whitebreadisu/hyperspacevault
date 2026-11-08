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
// Every sweep runs as three tests over thirds of WIDTHS (same widths, same
// assertions): a whole sweep could pass the 30 s test timeout on a loaded
// runner (main CI run 42512316231; --repeat-each with parallel workers here).
const SORTED = [...WIDTHS].sort((a, b) => a - b);
const PARTS = [0, 1, 2].map((k) =>
  SORTED.slice(Math.round((k * SORTED.length) / 3), Math.round(((k + 1) * SORTED.length) / 3))
);

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
/** Whether a step roomier than the one shown would also fit (it should
 * not): the row's width at that step, measured as Header.tsx does, on a
 * copy of the pod in its final state. */
function roomierFits(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector(".app-header") as HTMLElement;
    const pod = el.querySelector(".pod") as HTMLElement;
    const order = ["full", "compact", "tight", "minimal"];
    const shown = el.getAttribute("data-density") ?? "full";
    const copy = pod.cloneNode(true) as HTMLElement;
    copy.classList.add("pod--measure");
    copy.removeAttribute("data-testid");
    copy
      .querySelectorAll(".pod__row, .pod__top, .pod__subs")
      .forEach((n) => n.removeAttribute("style"));
    el.appendChild(copy);
    const w = (s: string) => (el.querySelector(s) as HTMLElement).getBoundingClientRect().width;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    let fits = false;
    for (const d of order.slice(0, order.indexOf(shown))) {
      el.setAttribute("data-density", d);
      const need =
        w(".app-header__brand") +
        w(".app-header__account") +
        copy.getBoundingClientRect().width +
        2 * gap;
      if (need <= el.clientWidth + 0.5) fits = true;
    }
    el.setAttribute("data-density", shown);
    copy.remove();
    return fits;
  });
}

/** Wait `n` animation frames. */
function frames(page: Page, n: number) {
  return page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
    n
  );
}

/** The header's step, sub-item cap, pod width and re-measure count. */
function state(page: Page) {
  return page.evaluate(() => {
    const h = document.querySelector(".app-header") as HTMLElement;
    return {
      density: h.getAttribute("data-density"),
      cap: h.style.getPropertyValue("--pod-sub-max"),
      pod: Math.round(document.querySelector(".pod")!.getBoundingClientRect().width),
      fits: (window as unknown as { __fits: number }).__fits,
    };
  });
}

async function sweep(page: Page, widths: number[]) {
  await page.evaluate(() => document.fonts.ready);
  for (const w of widths) {
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

  for (const [i, widths] of PARTS.entries())
    test(`r1-01-header-pinned-every-width-signed-in (part ${i + 1} of ${PARTS.length})`, async ({
      page,
    }) => {
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
      await sweep(page, widths);
    });

  // The Stashes page carries the same header. Its own test (main CI run
  // 42512316231: two full sweeps in one test passed the 30 s test timeout
  // on a loaded runner; the header itself was idle).
  for (const [i, widths] of PARTS.entries())
    test(`r1-01-header-pinned-every-width-stashes-page (part ${i + 1} of ${PARTS.length})`, async ({
      page,
    }) => {
      await page.addInitScript(() => {
        try {
          localStorage.removeItem("swu.releaseNotes.lastSeen");
        } catch {
          /* the Updates item shows while unread */
        }
      });
      await page.goto("/");
      await page.locator('[data-sub="stashes"]').click();
      await expect(page.locator(".sp-page")).toBeVisible();
      await expect(page.locator('[data-top="updates"]')).toBeVisible();
      await sweep(page, widths);
    });

  // The fit converges in one pass and then stays put: across 20 frames after
  // settling, no re-measure runs and the step and the sub-item cap do not
  // change -- at a full, a compact, a tight and a minimal width.
  test("r1-01-header-step-is-stable-after-settling", async ({ page }) => {
    await page.goto("/shared/tok-long");
    await page.locator('[data-sub="own"]').click();
    await expect(page.locator('[data-sub="collection"]')).toHaveAttribute("aria-current", "page");
    await page.evaluate(() => {
      const h = document.querySelector(".app-header")!;
      const w = window as unknown as { __fits: number };
      w.__fits = 0;
      // Each measure adds the header's measuring copy of the pod.
      new MutationObserver((ms) => {
        for (const m of ms)
          m.addedNodes.forEach((n) => {
            if (n instanceof HTMLElement && n.classList.contains("pod--measure")) w.__fits += 1;
          });
      }).observe(h, { childList: true });
    });
    // The invariants Header.tsx's fit sum relies on (its `over`): brand and
    // account slot pinned to their content width, no padding on the nav
    // wrapper or the header's sides.
    const layout = await page.evaluate(() => {
      const cs = (s: string) => getComputedStyle(document.querySelector(s)!);
      return {
        brand: cs(".app-header__brand").justifySelf,
        account: cs(".app-header__account").justifySelf,
        navPad: [cs(".app-header__nav").paddingLeft, cs(".app-header__nav").paddingRight],
        headerPad: [cs(".app-header").paddingLeft, cs(".app-header").paddingRight],
      };
    });
    expect(layout).toEqual({
      brand: "start",
      account: "end",
      navPad: ["0px", "0px"],
      headerPad: ["0px", "0px"],
    });
    for (const width of [1920, 1100, 900, 768]) {
      await page.setViewportSize({ width, height: 700 });
      await expect.poll(() => roomierFits(page), { message: `settles at ${width}` }).toBe(false);
      await frames(page, 2);
      const before = await state(page);
      await frames(page, 20);
      const after = await state(page);
      expect(after, `stable at ${width}`).toEqual(before);
      expect(after.fits - before.fits, `re-measures at ${width}`).toBe(0);
    }
  });
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const [i, widths] of PARTS.entries())
    test(`r1-01-header-pinned-every-width-signed-out (part ${i + 1} of ${PARTS.length})`, async ({
      page,
    }) => {
      await page.goto("/");
      await expect(page.locator(".app-header__account").getByText("Sign In")).toBeVisible();
      await sweep(page, widths);
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

  for (const [i, widths] of PARTS.entries())
    test(`r1-01-header-pinned-every-width-viewing-a-share (part ${i + 1} of ${PARTS.length})`, async ({
      page,
    }) => {
      await page.goto("/shared/tok-long");
      await expect(page.locator('[data-sub="shared"]')).toHaveAttribute("aria-current", "page");
      await expect(page.locator('[data-sub="own"]')).toBeVisible();
      await sweep(page, widths);
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

  for (const [i, widths] of PARTS.entries())
    test(`r1-01-header-pinned-every-width-holding-a-share (part ${i + 1} of ${PARTS.length})`, async ({
      page,
    }) => {
      await page.goto("/shared/tok-long");
      await expect(page.locator('[data-sub="shared"]')).toHaveAttribute("aria-current", "page");
      await page.locator('[data-sub="own"]').click();
      await expect(page.locator('[data-sub="collection"]')).toHaveAttribute("aria-current", "page");
      await expect(page.locator('[data-sub="stashes"]')).toBeVisible();
      await expect(page.locator('[data-sub="shared"]')).toBeVisible();
      await sweep(page, widths);
    });
});

// CI fold-in: the header must fit whatever the font metrics (CI's Linux
// rendering came out ~10 px wider than ours). The header's text is forced
// into a much wider face here (Arial / DejaVu Sans); the minimal step's
// measured last resort (sub items capped with an ellipsis) has to absorb it.
test.describe("with wider font metrics", () => {
  test.use({ storageState: "e2e/.auth/phone.json" });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const s = document.createElement("style");
        s.textContent =
          '.app-header, .app-header * { font-family: Arial, "DejaVu Sans", sans-serif !important; }';
        document.head.appendChild(s);
      });
    });
  });

  for (const [i, widths] of PARTS.entries())
    test(`r1-01-header-fits-wide-metrics-signed-in (part ${i + 1} of ${PARTS.length})`, async ({
      page,
    }) => {
      await page.goto("/");
      await expect(page.locator('[data-sub="collection"]')).toHaveAttribute("aria-current", "page");
      await sweep(page, widths);
    });

  for (const [i, widths] of PARTS.entries())
    test(`r1-01-header-fits-wide-metrics-holding-a-share (part ${i + 1} of ${PARTS.length})`, async ({
      page,
    }) => {
      await page.goto("/shared/tok-long");
      await page.locator('[data-sub="own"]').click();
      await expect(page.locator('[data-sub="collection"]')).toHaveAttribute("aria-current", "page");
      await sweep(page, widths);
      // Capped items keep their full names.
      await page.setViewportSize({ width: 768, height: 700 });
      await expect(page.locator('[data-sub="shared"]')).toHaveText(
        "Rowan's Big Hyperspace Binder!"
      );
      // The measured cap is in use here, and it holds still once settled.
      await expect.poll(() => roomierFits(page)).toBe(false);
      await frames(page, 2);
      const before = await state(page);
      expect(before.density).toBe("minimal");
      expect(before.cap).not.toBe("");
      await frames(page, 20);
      const after = await state(page);
      expect({ ...after, fits: 0 }).toEqual({ ...before, fits: 0 });
    });
});

// Owner, 2026-11-08: switching Vault <-> Decks must glide -- the pod's width
// moves straight from its old size to its new one (no frame wider than the
// larger or narrower than the smaller, never back the other way) and ends
// on the target. Sampled every frame at 1440 and at 1000 (where the switch
// also changes the density step). Reduced motion: the final width at once.
test.describe("the pod glides between menu states", () => {
  test.use({ storageState: "e2e/.auth/phone.json" });

  /** Click a top item and sample the pod's width every frame for 700 ms. */
  async function switchAndSample(page: Page, top: string) {
    await page.evaluate(() => {
      const w = window as unknown as { __samples: number[] };
      w.__samples = [];
      const t0 = performance.now();
      const tick = () => {
        w.__samples.push(document.querySelector(".pod")!.getBoundingClientRect().width);
        if (performance.now() - t0 < 700) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.locator(`[data-top="${top}"]`).click();
    await page.waitForTimeout(800);
    return page.evaluate(() => (window as unknown as { __samples: number[] }).__samples);
  }

  for (const width of [1440, 1000])
    test(`r1-01-pod-glides-monotonically-at-${width}`, async ({ page }) => {
      await page.goto("/");
      await expect(page.locator('[data-sub="collection"]')).toBeVisible();
      await page.setViewportSize({ width, height: 700 });
      await frames(page, 30);
      for (const top of ["decks", "vault", "decks", "vault"]) {
        const samples = await switchAndSample(page, top);
        const from = samples[0];
        const to = samples[samples.length - 1];
        const lo = Math.min(from, to) - 0.5;
        const hi = Math.max(from, to) + 0.5;
        const at = `${width} -> ${top}: ${samples.map((x) => Math.round(x)).join(" ")}`;
        expect(Math.abs(to - from), at).toBeGreaterThan(1); // the switch does resize
        for (const x of samples) {
          expect(x, at).toBeGreaterThanOrEqual(lo);
          expect(x, at).toBeLessThanOrEqual(hi);
        }
        const dir = Math.sign(to - from);
        for (let i = 1; i < samples.length; i++)
          expect(dir * (samples[i] - samples[i - 1]), at).toBeGreaterThanOrEqual(-0.5);
        // A glide, not a jump: some frames sit strictly between the ends.
        expect(samples.filter((x) => x > lo + 2 && x < hi - 2).length, at).toBeGreaterThan(2);
        // It ends on the target the header measures (the settled width).
        await frames(page, 2);
        const settled = await page.evaluate(
          () => document.querySelector(".pod")!.getBoundingClientRect().width
        );
        expect(Math.abs(settled - to), at).toBeLessThan(0.5);
      }
    });

  test("r1-01-pod-reduced-motion-is-instant", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator('[data-sub="collection"]')).toBeVisible();
    await frames(page, 30);
    for (const top of ["decks", "vault"]) {
      const samples = await switchAndSample(page, top);
      const from = samples[0];
      const to = samples[samples.length - 1];
      // Every frame is either the old width or the new one.
      for (const x of samples)
        expect(Math.min(Math.abs(x - from), Math.abs(x - to)), top).toBeLessThan(0.5);
    }
  });
});
