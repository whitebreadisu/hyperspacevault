import { expect, measureEach, scrollBy, test } from "./helpers";
import {
  expectBackLeft,
  expectXTopRight,
  openMore,
  openVault,
  shellControls,
} from "./more-helpers";

// S4-02: About & Legal at #/about and #/more/about (rev4 r4-10-about-copy,
// r4-10-wordmark-opens-about -- now through the R5-2 chooser --,
// r4-10-about-from-account-menu, r4-10-x-top-right): the steel-ring full
// shell, AboutModal.tsx's copy verbatim, 14 px prose, desktop's Close (44 px).
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone About");
});

// AboutModal.tsx, whitespace-normalised, in document order.
const WANT = [
  "About This Project",
  "Disclaimer",
  "HyperspaceVault is an unofficial fan project. It is not affiliated with, endorsed by, sponsored by, or approved by Disney, Lucasfilm Ltd., Fantasy Flight Games, or the Asmodee Group. Star Wars: Unlimited and all associated card names, images, logos, and trademarks are the property of their respective owners and are used here for identification and informational purposes only.",
  "Privacy",
  "What we store: your account email address and your card collection — nothing else.",
  "Where it lives: Google Cloud Platform, us-central1 (Iowa, USA).",
  "Leaving: deletion is self-service — Delete Account in the account menu permanently removes your account and all your data.",
  "Usage analytics: to guide improvements, we collect anonymous usage data — which features get used, plus session replays with everything you type masked out. It is never linked to your account, and you can turn it off any time in Settings under Usage Analytics. Processed by PostHog (USA). No ads, no advertising trackers, and your data is never sold.",
  "Feedback: if you send feedback, we store your message (and your email only if you opt in to contact).",
  "Attribution",
  "Card catalog data and images are sourced via the community swuapi.com API from official Star Wars: Unlimited assets. Star Wars: Unlimited is a trading card game by Fantasy Flight Games.",
  "Close",
];

test("s4-02-about-copy", async ({ page }) => {
  await page.goto("/#/about");
  await expect(page.locator(".m-about")).toBeVisible();
  const r = await page.evaluate(() => {
    const n = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim();
    const root = document.querySelector(".m-about")!;
    const texts = [
      ...root.querySelectorAll(
        ".m-shell__title, .about-section__label, .about-section__text, .about-section__list li, .about-submit"
      ),
    ].map((e) => n(e.textContent));
    const shell = getComputedStyle(root.querySelector(".m-shell")!);
    const panel = getComputedStyle(root.querySelector(".m-shell__panel")!);
    const close = root.querySelector(".about-submit")!.getBoundingClientRect();
    return {
      texts,
      bullets: root.querySelectorAll(".about-section__list li").length,
      shellClip: shell.clipPath,
      shellBg: shell.backgroundColor,
      panelClip: panel.clipPath,
      prose: [...root.querySelectorAll(".about-section__text, .about-section__list")].map(
        (e) => getComputedStyle(e).fontSize
      ),
      close: { h: close.height, w: close.width },
      closeBg: getComputedStyle(root.querySelector(".about-submit")!).backgroundColor,
    };
  });
  expect(r.texts).toEqual(WANT);
  expect(r.bullets).toBe(5);
  expect(r.shellClip).toContain("polygon(18px 0px");
  expect(r.panelClip).toContain("polygon(17px 0px");
  expect(r.shellBg).toBe("rgba(211, 211, 212, 0.28)");
  expect(r.prose).toEqual(["14px", "14px", "14px"]);
  expect(r.close.h).toBeGreaterThanOrEqual(44);
  expect(r.closeBg).toBe("rgb(37, 99, 235)");
  // Close returns where the screen came from (here: nothing of ours -> the Vault).
  await page.locator(".about-submit").click();
  await expect(page).toHaveURL(/#\/vault$/);
});

test("s4-02-about-from-chooser-more-menu", async ({ page }) => {
  // Expanded title -> chooser -> About & Legal.
  await openVault(page);
  await page.locator(".m-vh__brandtext").click();
  await page.locator(".m-chooser .swu-btn", { hasText: "About & Legal" }).click();
  await expect(page).toHaveURL(/#\/about$/);
  await expect(page.locator(".m-about")).toContainText("About This Project");
  expectXTopRight(await shellControls(page));
  await page.locator(".m-shell__head [aria-label='Close']").click();
  await expect(page).toHaveURL(/#\/vault$/);

  // Collapsed badge -> chooser -> About & Legal.
  await expect(page.locator(".m-row").first()).toBeVisible();
  await scrollBy(page, ".m-vault__scroll", 420);
  await expect(page.locator(".m-vh--collapsed")).toHaveCount(1);
  await page.locator(".m-vh__hsv").click();
  await page.locator(".m-chooser .swu-btn", { hasText: "About & Legal" }).click();
  await expect(page).toHaveURL(/#\/about$/);
  await expect(page.locator(".m-about")).toBeVisible();

  // The account menu's About & Legal -> the same screen, X top-right.
  await openVault(page);
  await page.locator(".m-acct__hit").click();
  await page.locator(".m-acct__menu [role=menuitem]", { hasText: "About & Legal" }).click();
  await expect(page).toHaveURL(/#\/about$/);
  await expect(page.locator(".m-about")).toContainText("About This Project");
  expectXTopRight(await shellControls(page));

  // More's entry -> #/more/about, the same screen (back chevron, S4-05).
  await openMore(page);
  await page.locator('[data-more="about"]').click();
  await expect(page).toHaveURL(/#\/more\/about$/);
  await expect(page.locator(".m-about")).toContainText("About This Project");
  expectBackLeft(await shellControls(page));
});

test("s4-02-x-top-right", async ({ page }) => {
  await page.goto("/#/about");
  await expect(page.locator(".m-about")).toBeVisible();
  expectXTopRight(await shellControls(page));
  // Escape closes as desktop's useModalDismiss.
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/#\/vault$/);
});
