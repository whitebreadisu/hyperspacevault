import type { Page } from "@playwright/test";
import { expect } from "./helpers";

// BL-250 stage 4a: shared helpers for the More / About / Updates specs.

/** A fresh visitor: nothing seen, so the newest release note is unread. */
export async function unreadNotes(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("swu.releaseNotes.lastSeen");
    } catch {
      /* ignore */
    }
  });
}

export async function openMore(page: Page) {
  await page.goto("/#/more");
  await expect(page.locator(".m-more")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

export async function openVault(page: Page) {
  await page.goto("/#/vault");
  await expect(page.locator(".m-row").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

/** Running animations: every keyframe property is opacity / transform
 * (rev4 d2-0-cue-opacity-only animsOk). */
export const anims = () => {
  const bad: string[] = [];
  const all = document.getAnimations();
  for (const a of all) {
    const kf = (a.effect as KeyframeEffect | null)?.getKeyframes?.() ?? [];
    const props = new Set<string>();
    kf.forEach((k) =>
      Object.keys(k).forEach((x) => {
        if (!["offset", "computedOffset", "easing", "composite"].includes(x)) props.add(x);
      })
    );
    if ([...props].some((x) => x !== "opacity" && x !== "transform"))
      bad.push(((a as CSSAnimation).animationName ?? "?") + ":" + [...props].join("/"));
  }
  const cue = all.filter(
    (a) => (a as CSSAnimation).animationName === "d2-cue-glow" && a.playState === "running"
  );
  return { cue: cue.length, bad };
};

/** Deterministic settle: wait until no CSS transition is running (the bar's
 * 0.15 s tab colour transition, row colour, etc.) before sampling animations. */
export async function transitionsDone(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => !(a instanceof CSSTransition))
  );
}

/** Where the shell header's controls sit (X top-right / back chevron left). */
export async function shellControls(page: Page) {
  return page.evaluate(() => {
    const box = (sel: string) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, w: r.width, h: r.height };
    };
    return {
      x: box(".m-shell__head [aria-label='Close']"),
      back: box(".m-shell__head [aria-label='Back']"),
      iw: innerWidth,
    };
  });
}

export function expectXTopRight(c: Awaited<ReturnType<typeof shellControls>>) {
  expect(c.x, "X present").not.toBeNull();
  expect(c.back, "no back chevron").toBeNull();
  expect(c.x!.w).toBeGreaterThanOrEqual(44);
  expect(c.x!.h).toBeGreaterThanOrEqual(44);
  expect(c.x!.right).toBeGreaterThan(c.iw - 40);
  expect(c.x!.top).toBeLessThan(120);
}

export function expectBackLeft(c: Awaited<ReturnType<typeof shellControls>>) {
  expect(c.back, "back chevron present").not.toBeNull();
  expect(c.x, "no X").toBeNull();
  expect(c.back!.w).toBeGreaterThanOrEqual(44);
  expect(c.back!.h).toBeGreaterThanOrEqual(44);
  expect(c.back!.left).toBeLessThan(40);
  expect(c.back!.top).toBeLessThan(120);
}
