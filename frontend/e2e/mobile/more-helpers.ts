import type { APIRequestContext, Page } from "@playwright/test";
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

// ── BL-250 stage 4b: Import & Export ───────────────────────────────────────

/** The shared e2e account is unverified, and so is the stored session. The
 * verified-email cases use their own account, signed in through the phone's
 * own account slot in a context with no stored session (the Auth emulator
 * lets a project owner flip emailVerified over REST). */
export const VERIFIED_EMAIL = "e2e-verified@hsv.test";
const VERIFIED_PASSWORD = "e2e-password-1";
const EMU = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";

export async function ensureVerifiedUser(request: APIRequestContext) {
  const data = { email: VERIFIED_EMAIL, password: VERIFIED_PASSWORD, returnSecureToken: true };
  let res = await request.post(`${EMU}/accounts:signUp?key=fake`, { data });
  if (!res.ok()) res = await request.post(`${EMU}/accounts:signInWithPassword?key=fake`, { data });
  const { localId } = (await res.json()) as { localId: string };
  const upd = await request.post(`${EMU}/projects/demo-swu/accounts:update`, {
    headers: { Authorization: "Bearer owner" },
    data: { localId, emailVerified: true },
  });
  expect(upd.ok(), "mark the e2e account verified").toBe(true);
}

/** Sign in as the verified account from a fresh (signed-out) page. */
export async function signInVerified(page: Page) {
  await page.goto("/#/vault");
  await page
    .locator(".m-acct")
    .getByRole("button", { name: /^sign in$/i })
    .click();
  const dialog = page.getByRole("dialog", { name: "Log In" });
  await dialog.getByLabel("Email").fill(VERIFIED_EMAIL);
  await dialog.getByLabel("Password").fill(VERIFIED_PASSWORD);
  await dialog.getByRole("button", { name: "Log In", exact: true }).click();
  await expect(page.locator(".m-acct__hit")).toBeVisible({ timeout: 15000 });
  await expect(dialog).toBeHidden();
}

export const NO_SESSION = { cookies: [], origins: [] };

export async function openImportExport(page: Page) {
  await page.goto("/#/more");
  await expect(page.locator(".m-more")).toBeVisible();
  await page.locator('[data-more="importexport"]').click();
  await expect(page).toHaveURL(/#\/more\/importexport$/);
  await expect(page.locator(".m-ie")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

/** A swu-inv/1 file with SOR 87 Standard (resolves; owned 1) and one card
 * the fixture catalogue does not hold (unresolved: unknown_triple). */
export function importFile(name = "vault.json") {
  return {
    name,
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        format_version: "swu-inv/1",
        cards: [
          {
            swuapi_uuid: "u-sor-87",
            set_code: "SOR",
            card_number: "87",
            variant_type: "Standard",
            quantity: 2,
          },
          {
            swuapi_uuid: "u-nope",
            set_code: "SOR",
            card_number: "999",
            variant_type: "Standard",
            quantity: 1,
          },
        ],
      })
    ),
  };
}

export async function configureImport(
  page: Page,
  mode: "Merge (add)" | "Replace" | "Replace All",
  cap: "Add everything" | "Trim to my keep-limits"
) {
  await page.locator("#ie-file-input").setInputFiles(importFile());
  const modes = ["Merge (add)", "Replace", "Replace All"];
  await page.locator('[role=radio][data-group="mode"]').nth(modes.indexOf(mode)).click();
  await page.locator('[role=radio][data-group="cap"]', { hasText: cap }).click();
}
