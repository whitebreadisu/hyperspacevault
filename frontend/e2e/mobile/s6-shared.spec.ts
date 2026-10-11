import { readFileSync } from "node:fs";
import { expect, measureEach, test } from "./helpers";
import { recorderFor } from "./mock-api";
import type { Page } from "@playwright/test";

// BL-252 stage 6a: the shared vault on the phone (rev4 R4-8 + the round-5
// delta R5-7), seeded from the rev4 check steps r4-8-shared-renders,
// r4-8-no-keypad-tab, r4-8-no-steppers, r4-8-invalid-token and
// r4-8-name-in-header. The share double lives in mock-api.ts: `tok-1` =
// "Rowan" with its own quantities (the first printing of every third
// catalogue card, x2), `tok-long` a 30-character name, `tok-slow` a 1.5 s
// resolve, `tok-404` / `tok-429` the invalid / rate-limited answers.
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone shared vault");
});

const CARDS = JSON.parse(readFileSync("e2e/mobile/fixtures/base-cards.json", "utf8")) as {
  id: number;
  name: string;
  variants: { variant_id: number }[];
}[];
/** Cards the share owns (mock-api: every third catalogue card). */
const SHARED_OWNED = CARDS.filter((_, i) => i % 3 === 0);

const SH = '.m-app__screen[data-pane="shared"]';
const OWN = '.m-app__screen[data-pane="own"]';
const ANON = { cookies: [], origins: [] };

async function openShare(page: Page, token = "tok-1", hash = "#/vault") {
  await page.goto(`/shared/${token}${hash}`);
  await expect(page.locator(`${SH} .m-row`).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

/** Chromium logs a 4xx resource load as a console error; the share's 404 /
 * 429 answers are the point of the test, not a failure. */
function forgiveStatus(page: Page, codes: number[]) {
  const rec = recorderFor(page);
  rec.consoleErrors = rec.consoleErrors.filter(
    (m) => !codes.some((c) => m.includes(`status of ${c}`))
  );
}

/** Deterministic wait: the element's running animations have finished. */
async function settled(page: Page, sel: string) {
  await page
    .locator(sel)
    .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)).then(() => true));
}

/** Running animations of one element: every keyframe property is transform /
 * opacity. */
const transformOnly = (sel: string) => {
  const el = document.querySelector(sel);
  if (!el) return ["missing " + sel];
  const bad: string[] = [];
  for (const a of el.getAnimations()) {
    const kf = (a.effect as KeyframeEffect | null)?.getKeyframes?.() ?? [];
    for (const k of kf)
      for (const p of Object.keys(k))
        if (
          !["offset", "computedOffset", "easing", "composite", "transform", "opacity"].includes(p)
        )
          bad.push(p);
  }
  return bad;
};

test.describe("anonymous viewer", () => {
  test.use({ storageState: ANON });

  test("s6-01-shared-renders", async ({ page }) => {
    const rec = recorderFor(page);
    await openShare(page);
    // r4-8-shared-renders: the Vault tree, read-only -- rows, filters, the
    // status row; no stepper, no Add / Import / Share, no tool button.
    const facts = await page.evaluate((sh) => {
      const pane = document.querySelector(sh)!;
      const visibleButtons = [...document.querySelectorAll(".m-app button")].filter(
        (b) => !b.closest('[aria-hidden="true"]') && b.getBoundingClientRect().width > 0
      );
      return {
        rows: pane.querySelectorAll(".m-row").length > 10,
        count: pane.querySelector(".m-count")!.textContent,
        stepper: !!document.querySelector(".m-stepper"),
        centre: !!document.querySelector(".m-nav__center"),
        mutating: visibleButtons
          .map((b) => (b.textContent ?? "").trim())
          .filter((t) => /^(Add|Add to vault|Add Cards|Import|Share)/.test(t)),
        filters: !!pane.querySelector(".m-filterbtn"),
        status: !!pane.querySelector(".m-vault__status"),
        flag: document.querySelector(".m-app")!.getAttribute("data-share"),
        path: location.pathname,
        hash: location.hash,
        session: sessionStorage.getItem("swu.share.session"),
      };
    }, SH);
    expect(facts).toEqual({
      rows: true,
      count: `${CARDS.length} cards`,
      stepper: false,
      centre: false,
      mutating: [],
      filters: true,
      status: true,
      flag: "shown",
      path: "/shared/tok-1",
      hash: "#/vault",
      session: JSON.stringify({ token: "tok-1", name: "Rowan" }),
    });
    // Only the three token-scoped reads (no auth, as desktop sharedView.ts).
    expect([...new Set(rec.sharedReads)].sort()).toEqual([
      "/api/shared/tok-1",
      "/api/shared/tok-1/limits",
      "/api/shared/tok-1/quantities",
    ]);
    // The hash router works beneath the pathname: a card opens at
    // /shared/tok-1#/card/<id> and closing it stays in the share.
    await page.locator(`${SH} .m-row .m-row__main`).first().click();
    await expect(page).toHaveURL(/\/shared\/tok-1#\/card\/\d+/);
    await expect(page.locator(".m-cardlayer")).toBeVisible();
    await page.getByRole("button", { name: "Close card" }).click();
    await expect(page.locator(".m-cardlayer")).toHaveCount(0);
    await expect(page).toHaveURL(/\/shared\/tok-1#\/vault$/);
    await expect(page.locator(".m-app")).toHaveAttribute("data-share", "shown");
    // A reload on the share path lands back on the shared vault.
    await page.reload();
    await expect(page.locator(`${SH} .m-row`).first()).toBeVisible();
    await expect(page.locator(".m-vswitch__face--shared")).toHaveText("Rowan");
  });

  test("s6-02-invalid-token", async ({ page }) => {
    const text = page.locator(".m-shared-status__text");
    // Pending -> desktop's loading sentence, then the vault.
    await page.goto("/shared/tok-slow#/vault");
    await expect(text).toHaveText("Loading shared vault…");
    await expect(text).toHaveAttribute("role", "status");
    await expect(page.locator(`${SH} .m-row`).first()).toBeVisible({ timeout: 6000 });
    await expect(text).toHaveCount(0);
    // 429 -> the rate-limited sentence.
    await page.goto("/shared/tok-429#/vault");
    await expect(text).toHaveText(
      "This shared vault is getting a lot of traffic right now — please try again in a moment."
    );
    await expect(text).toHaveAttribute("role", "alert");
    // 404 (invalid and revoked are indistinguishable) -> no longer available.
    await page.goto("/shared/tok-404#/vault");
    await expect(text).toHaveText("This shared vault is no longer available.");
    await expect(page.locator(".m-vault:visible")).toHaveCount(0);
    // In the normal frame: the brand header (About) and the bar; the plain
    // Vault tab (no name to show) takes the viewer to their own vault.
    await expect(page.getByRole("button", { name: "About & Legal" })).toBeVisible();
    await expect(page.locator(".m-vswitch")).toHaveCount(0);
    await expect(page.locator(".m-nav__center")).toHaveCount(0);
    await page.locator(".m-nav .m-tab", { hasText: "Vault" }).click();
    await expect(page.locator(`${OWN} .m-row`).first()).toBeVisible();
    await expect(page.locator(".m-nav__center")).toBeVisible();
    forgiveStatus(page, [404, 429]);
  });

  test("s6-03-name-in-header", async ({ page }) => {
    await openShare(page);
    // r4-8-name-in-header: the title slot reads ROWAN'S COLLECTION; no
    // account bubble, a Sign in link; Leave feedback stays; the wordmark is
    // not truncated (390 + 430 = the two phone projects).
    const f = await page.evaluate((sh) => {
      const pane = document.querySelector(sh)!;
      const l = pane.querySelector(".m-summary__label")!;
      const w = pane.querySelector<HTMLElement>(".m-vh__word")!;
      const link = pane.querySelector<HTMLElement>(".m-acct--shared .m-shared-signin");
      return {
        label: l.textContent,
        upper: getComputedStyle(l).textTransform,
        bubble: !!pane.querySelector(".m-acct__hit, .m-acct__avatar"),
        link: link ? [link.textContent, getComputedStyle(link).fontSize] : null,
        linkBox: link ? link.getBoundingClientRect().height >= 44 : false,
        fb: !!pane.querySelector(".m-vh__fb"),
        word: w.scrollWidth <= w.clientWidth + 1,
        ver: !!pane.querySelector(".m-vh__tag .m-vh__ver"),
      };
    }, SH);
    expect(f).toEqual({
      label: "Rowan's collection",
      upper: "uppercase",
      bubble: false,
      link: ["Sign in", "13px"],
      linkBox: true,
      fb: true,
      word: true,
      ver: true,
    });
    // The title chooser still works.
    await page.locator(`${SH} .m-vh__brandtext`).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    // Sign in opens the auth layer.
    await page.locator(`${SH} .m-shared-signin`).click();
    await expect(page.getByText("Log In").first()).toBeVisible();
  });

  test("s6-04-vault-toggle-expands", async ({ page }) => {
    await openShare(page);
    const face = page.locator(".m-vswitch__face--shared");
    // Amber, the name in the icon's place, no VAULT label.
    const look = await face.evaluate((b) => {
      const n = b.querySelector<HTMLElement>(".m-vswitch__name")!;
      const cs = getComputedStyle(n);
      return {
        text: n.textContent,
        color: cs.color,
        border: cs.borderTopColor,
        label: !!b.querySelector(".m-tab__label"),
        icon: !!b.querySelector("svg"),
      };
    });
    expect(look).toEqual({
      text: "Rowan",
      color: "rgb(242, 193, 78)",
      border: "rgba(217, 154, 31, 0.6)",
      label: false,
      icon: false,
    });
    // r4-8-no-keypad-tab: Vault + More only, re-centred.
    const mids = await page.evaluate(() => {
      const kids = [...document.querySelectorAll(".m-nav__row > *")];
      const r = kids.map((k) => k.getBoundingClientRect());
      return { n: kids.length, sum: r[0].left + r[0].width / 2 + r[1].left + r[1].width / 2 };
    });
    expect(mids.n).toBe(2);
    expect(Math.abs(mids.sum - (await page.evaluate(() => innerWidth)))).toBeLessThan(4);
    // Tap: expands horizontally within the bar (transform / opacity only).
    await face.click();
    const panel = page.locator(".m-vswitch__panel");
    await expect(panel).toBeVisible();
    expect(await page.evaluate(transformOnly, ".m-vswitch__panel")).toEqual([]);
    await settled(page, ".m-vswitch__panel");
    const choices = await panel.evaluate((p) => {
      const nav = document.querySelector(".m-nav")!.getBoundingClientRect();
      const r = p.getBoundingClientRect();
      return {
        inBar: r.top >= nav.top - 1 && r.bottom <= nav.bottom + 1 && r.right <= innerWidth,
        buttons: [...p.querySelectorAll("button")].map((b) => {
          const br = b.getBoundingClientRect();
          return [
            b.getAttribute("aria-label"),
            br.width >= 44 && br.height >= 44,
            b.getAttribute("aria-pressed"),
          ];
        }),
        amber: getComputedStyle(p.querySelector(".m-vswitch__share")!).color,
        full: p.querySelector(".m-vswitch__full")!.textContent,
      };
    });
    expect(choices).toEqual({
      inBar: true,
      buttons: [
        ["Your vault", true, "false"],
        ["Rowan's vault", true, "true"],
      ],
      amber: "rgb(242, 193, 78)",
      full: "Rowan",
    });
    // A tap outside collapses it, nothing else changes.
    await page.locator(`${SH} .m-count`).click();
    await expect(panel).toHaveCount(0);
    // Own vault: the keypad returns, the face is the plain-looking Vault tab.
    await face.click();
    await page.getByRole("button", { name: "Your vault" }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.locator(`${OWN}:not(.m-app__screen--parked) .m-row`).first()).toBeVisible();
    await expect(page.locator(".m-nav__center")).toBeVisible();
    await expect(page.locator(".m-vswitch__face--shared")).toHaveCount(0);
    await expect(page.locator(".m-app")).not.toHaveAttribute("data-share", "shown");
    // ... and back to the share.
    await page.getByRole("button", { name: "Vault: switch vault" }).click();
    await page.getByRole("button", { name: "Rowan's vault" }).click();
    await expect(face).toBeVisible();
    await expect(page.locator(".m-nav__center")).toHaveCount(0);
  });

  test("s6-04-long-name-ellipsis", async ({ page }) => {
    await openShare(page, "tok-long");
    const name = await page.locator(".m-vswitch__name").evaluate((n) => ({
      cut: n.scrollWidth > n.clientWidth,
      overflow: getComputedStyle(n).textOverflow,
    }));
    expect(name).toEqual({ cut: true, overflow: "ellipsis" });
    await page.locator(".m-vswitch__face--shared").click();
    await expect(page.locator(".m-vswitch__full")).toHaveText("Rowan's Big Hyperspace Binder!");
    await settled(page, ".m-vswitch__panel");
    const fits = await page.locator(".m-vswitch__panel").evaluate((p) => {
      const r = p.getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth;
    });
    expect(fits).toBe(true);
  });

  test("s6-04-no-keypad-in-share", async ({ page }) => {
    await openShare(page);
    await expect(page.locator(".m-nav .swu-btn")).toHaveCount(0);
    // A keypad deep link inside a share lands on the shared vault.
    await page.goto("/shared/tok-1#/pad");
    await expect(page).toHaveURL(/\/shared\/tok-1#\/vault$/);
    await expect(page.locator(".m-toollayer, .m-tool")).toHaveCount(0);
    await expect(page.locator(`${SH} .m-row`).first()).toBeVisible();
    // More keeps the two-item bar.
    await page.locator(".m-nav .m-tab", { hasText: "More" }).click();
    await expect(page.locator(".m-more")).toBeVisible();
    await expect(page.locator(".m-nav__row > *")).toHaveCount(2);
    await expect(page.locator(".m-nav__center")).toHaveCount(0);
  });

  test("s6-05-no-steppers", async ({ page }) => {
    await openShare(page);
    // The first rendered row the share owns (the list is virtualised).
    const ids = new Set(SHARED_OWNED.map((c) => c.id));
    const rendered = await page
      .locator(`${SH} .m-row`)
      .evaluateAll((rs) => rs.map((r) => Number((r as HTMLElement).dataset.card)));
    const card = SHARED_OWNED.find((c) => c.id === rendered.find((id) => ids.has(id)))!;
    const v0 = card.variants[0].variant_id;
    // The row's cluster opens Owned by finish for the SHARE's quantities.
    await page.locator(`${SH} .m-row[data-card="${card.id}"] .m-row__own`).click();
    const fin = page.locator(".m-sheet-layer--finish");
    await expect(fin).toBeVisible();
    await expect(fin.locator(".m-dossier__head .playset-chip")).toHaveText("2");
    await expect(fin.locator(`.m-dossier__row[data-variant="${v0}"] .playset-chip`)).toHaveText(
      "2"
    );
    // Open card: every printing shows xN, no stepper (r4-8-no-steppers).
    await fin.getByText("Open card").click();
    await expect(page).toHaveURL(new RegExp(`/shared/tok-1#/card/${card.id}`));
    await expect(page.locator(".m-cardlayer .m-print").first()).toBeVisible();
    const rail = await page.evaluate(() => {
      const prints = [
        ...document.querySelectorAll(".m-cardlayer .m-page:not(.m-page--ghost) .m-print"),
      ];
      return {
        n: prints.length,
        qty: prints.map((p) => p.querySelector(".m-print__qty")?.textContent ?? null),
        stepper: !!document.querySelector(".m-cardlayer .m-stepper, .m-cardlayer .m-step"),
      };
    });
    expect(rail.n).toBe(card.variants.length);
    expect(rail.stepper).toBe(false);
    expect(rail.qty.every((q) => q != null && /^×\d+$/.test(q))).toBe(true);
    expect(rail.qty).toContain("×2");
    // The plate reads the share too; it opens Owned by finish.
    await page
      .locator(".m-cardlayer .m-page:not(.m-page--ghost) .m-plate-hit--btn")
      .first()
      .click();
    await expect(page.locator(".m-sheet-layer--finish .m-dossier__head .playset-chip")).toHaveText(
      "2"
    );
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Close card" }).click();
    await expect(page).toHaveURL(/\/shared\/tok-1#\/vault$/);
    await expect(page.locator(".m-app")).toHaveAttribute("data-share", "shown");
  });

  test("s6-05-collection-toggles-live", async ({ page }) => {
    await openShare(page, "tok-1", "#/vault?sheet=filters");
    const sheet = page.locator(".m-sheet-layer--filters");
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(350);
    // Live for an anonymous viewer: the share's data, not sign-in.
    const row = sheet.locator('[data-fpick="collection"]').first();
    await expect(row).not.toContainText("Sign in to filter");
    await row.click();
    const col = page.locator(".m-sheet-layer--fpick-collection");
    await expect(col).toBeVisible();
    await expect(col.locator('[data-fv="owned"]')).not.toHaveAttribute("aria-disabled", "true");
    await col.locator('[data-fv="owned"]').click();
    await col.locator(".m-picker__done").click();
    await expect(col).toHaveCount(0);
    await sheet.locator(".m-sheet__close").click();
    await expect(sheet).toHaveCount(0);
    await expect(page.locator(".m-auth, .auth-modal-card")).toHaveCount(0);
    await expect(page.locator(`${SH} .m-count`)).toHaveText(`${SHARED_OWNED.length} cards`);
    await expect(page).toHaveURL(/\/shared\/tok-1#\/vault/);
  });

  test("s6-06-more-trimmed-in-share-anonymous", async ({ page }) => {
    await openShare(page, "tok-1", "#/vault");
    await page.locator(".m-nav .m-tab", { hasText: "More" }).click();
    await expect(page.locator(".m-more")).toBeVisible();
    const keys = await page
      .locator(".m-morerow")
      .evaluateAll((rs) => rs.map((r) => (r as HTMLElement).dataset.more));
    expect(keys).toEqual(["about", "updates", "feedback", "signin"]);
    await expect(page.locator(".m-more .m-shared-signin")).toBeVisible();
  });
});

test("s6-03-signed-in-bubble", async ({ page }) => {
  await openShare(page);
  await expect(page.locator(`${SH} .m-acct__hit`)).toBeVisible();
  await expect(page.locator(`${SH} .m-shared-signin`)).toHaveCount(0);
  await expect(page.locator(`${SH} .m-summary__label`)).toHaveText("Rowan's collection");
  // The bubble's Settings leaves the share for the viewer's own account.
  await page.locator(`${SH} .m-acct__hit`).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/shared\/tok-1#\/more\/settings$/);
  await expect(page.locator(".m-app")).not.toHaveAttribute("data-share", "shown");
  await expect(page.locator(".m-nav__center")).toBeVisible();
});

test("s6-06-more-trimmed-in-share", async ({ page }) => {
  await openShare(page);
  await page.locator(".m-nav .m-tab", { hasText: "More" }).click();
  await expect(page.locator(".m-more")).toBeVisible();
  const keys = await page
    .locator(".m-morerow")
    .evaluateAll((rs) => rs.map((r) => (r as HTMLElement).dataset.more));
  // Import & Export, Sharing, Settings, Change Password absent; About,
  // Updates, Feedback stay; Log Out stays for a signed-in viewer.
  expect(keys).toEqual(["about", "updates", "feedback", "logout"]);
  await expect(page.locator(".m-more__deckcheck")).toBeVisible();
  // Own-account routes land on the trimmed More inside a share; Delete is
  // blocked (rev4 D2).
  for (const r of ["settings", "delete", "password", "sharing", "importexport"]) {
    await page.goto(`/shared/tok-1#/more/${r}`);
    await expect(page).toHaveURL(/\/shared\/tok-1#\/more$/);
    await expect(page.locator(".m-more")).toBeVisible();
    await expect(page.locator(".m-acctlayer, .m-settings, .m-ie")).toHaveCount(0);
  }
});

test("s6-07-own-vault-state-survives", async ({ page }) => {
  await openShare(page);
  const search = (pane: string) => page.locator(`${pane} .m-search__input`);
  const scroller = (pane: string) => page.locator(`${pane} .m-vault__scroll`);
  // The share: search "a", scroll down a little.
  await search(SH).fill("a");
  await search(SH).blur();
  const sharedCount = await page.locator(`${SH} .m-count`).textContent();
  await scroller(SH).evaluate((e) => void (e.scrollTop = 120));
  // Own vault: its own (empty) state; set a different search + scroll.
  await page.locator(".m-vswitch__face--shared").click();
  await page.getByRole("button", { name: "Your vault" }).click();
  await expect(page.locator(`${OWN}:not(.m-app__screen--parked)`)).toBeVisible();
  await expect(search(OWN)).toHaveValue("");
  await search(OWN).fill("Luke");
  await search(OWN).blur();
  await expect(page.locator(`${OWN} .m-count`)).not.toHaveText(`${CARDS.length} cards`);
  const ownCount = await page.locator(`${OWN} .m-count`).textContent();
  // Back to the share: its search, count and scroll are where they were.
  await page.getByRole("button", { name: "Vault: switch vault" }).click();
  await page.getByRole("button", { name: "Rowan's vault" }).click();
  await expect(page.locator(`${SH}:not(.m-app__screen--parked)`)).toBeVisible();
  await expect(search(SH)).toHaveValue("a");
  await expect(page.locator(`${SH} .m-count`)).toHaveText(sharedCount!);
  expect(await scroller(SH).evaluate((e) => e.scrollTop)).toBe(120);
  // And the own vault kept its own.
  await page.locator(".m-vswitch__face--shared").click();
  await page.getByRole("button", { name: "Your vault" }).click();
  await expect(search(OWN)).toHaveValue("Luke");
  await expect(page.locator(`${OWN} .m-count`)).toHaveText(ownCount!);
});
