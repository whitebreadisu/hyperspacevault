import { readFileSync } from "node:fs";
import { expect } from "./helpers";
import type { Page } from "@playwright/test";

// BL-248 stage 2B-1: shared bits for the Filters-sheet specs (s2-12 … s2-16),
// ports of the rev4 check script's fsheet / tapIn / b1Targets / b1NoOverflow /
// b1Motion helpers (.ds-sync/mobile-check-rev4.mjs:339-380, 473).

export const FSHEET = ".m-sheet-layer--filters";

export const CARDS = JSON.parse(readFileSync("e2e/mobile/fixtures/base-cards.json", "utf8")) as {
  set_code: string;
  rarity: string;
  variants: { source_set_code: string; finish: string | null; variant_type: string }[];
}[];
export const SETS = JSON.parse(readFileSync("e2e/mobile/fixtures/sets.json", "utf8")) as {
  code: string;
  is_base_set: boolean;
}[];
export const BASE_SETS = SETS.filter((s) => s.is_base_set).map((s) => s.code);

/** Open the Vault (optionally with params) and wait for the Filters sheet
 * when `?sheet=filters` is in the hash. */
export async function openFilters(page: Page, hash = "#/vault?sheet=filters") {
  await page.goto("/" + hash);
  await expect(page.locator(".m-row").first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  if (hash.includes("sheet=filters")) await expect(page.locator(FSHEET)).toBeVisible();
  // The sheet's rise (0.2 s) has finished.
  await page.waitForTimeout(350);
}

/** Tap inside the Filters sheet (rev4 tapIn). */
export const tapIn = (page: Page, sel: string) => page.locator(`${FSHEET} ${sel}`).first().click();

/** Every control in the top sheet is at least 44 x 44 (rev4 b1Targets). */
export const b1Targets = () => {
  const layers = document.querySelectorAll(".m-sheet-layer");
  const layer = layers[layers.length - 1];
  const small = [...layer.querySelectorAll("button, input, [role=slider], [role=switch]")]
    .map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter(
      ({ e, r }) =>
        r.width &&
        r.height &&
        getComputedStyle(e).visibility !== "hidden" &&
        (r.width < 43.5 || r.height < 43.5)
    )
    .map(
      ({ e, r }) =>
        `${Math.round(r.width)}x${Math.round(r.height)} ${e.className.toString().slice(0, 30)}`
    );
  return small;
};

/** Nothing in the top sheet runs past the viewport or scrolls sideways
 * (rev4 b1NoOverflow; the scrolling region is .m-filters__scroll here). */
export const b1NoOverflow = () => {
  const layers = document.querySelectorAll(".m-sheet-layer");
  const layer = layers[layers.length - 1];
  const scroll = (layer.querySelector(".m-filters__scroll") ??
    layer.querySelector(".m-sheet__body"))!;
  const out = [...layer.querySelectorAll(".m-sheet *")].filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width && (r.right > innerWidth + 0.5 || r.left < -0.5);
  });
  return {
    out: out.slice(0, 5).map((e) => e.className.toString().slice(0, 40)),
    sideways: scroll.scrollWidth > scroll.clientWidth + 1,
    page: document.documentElement.scrollWidth > innerWidth + 1,
  };
};

/** Motion (rev4 b1Motion): nothing in the top sheet transitions a layout
 * property; inside the body only transform / opacity transition (the
 * SWUButton keeps its colour glow); the sheet's own keyframes animate
 * transform / opacity only. Returns the offenders. */
export const b1Motion = () => {
  const layers = document.querySelectorAll(".m-sheet-layer");
  const layer = layers[layers.length - 1];
  const layout =
    /(^|,\s*)(height|width|padding[a-z-]*|margin[a-z-]*|top|left|right|bottom|max-height|min-height|grid-template-rows|inset|all)(\s*,|$)/;
  const bad: string[] = [];
  for (const e of layer.querySelectorAll("*")) {
    const cs = getComputedStyle(e);
    if (!cs.transitionDuration.split(",").some((d) => parseFloat(d) > 0)) continue;
    const props = cs.transitionProperty.split(",").map((s) => s.trim());
    const inSwu = !!e.closest(".swu-btn");
    if (layout.test(cs.transitionProperty))
      bad.push(e.className.toString().slice(0, 30) + " :: " + cs.transitionProperty);
    else if (
      !inSwu &&
      e.closest(".m-sheet__body") &&
      props.some((p) => p !== "transform" && p !== "opacity")
    )
      bad.push(e.className.toString().slice(0, 30) + " :: " + cs.transitionProperty);
  }
  const sheet = layer.querySelector(".m-sheet")!;
  const name = getComputedStyle(sheet).animationName;
  const kf = [...document.styleSheets]
    .flatMap((s) => {
      try {
        return [...s.cssRules];
      } catch {
        return [];
      }
    })
    .filter((r): r is CSSKeyframesRule => r instanceof CSSKeyframesRule && r.name === name);
  const kfOk =
    kf.length > 0 &&
    kf.every((r) =>
      [...r.cssRules].every((k) =>
        [...(k as CSSKeyframeRule).style].every((p) => p === "transform" || p === "opacity")
      )
    );
  if (!kfOk) bad.push("sheet keyframes " + name);
  return bad;
};
