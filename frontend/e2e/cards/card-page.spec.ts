import { expect, test, type Page, type TestInfo } from "@playwright/test";

// v2.3 public card pages (design note §8 "Journeys"), against pages generated
// from scripts/public-pages/fixtures/catalog.json (playwright.cards.config.ts).
// The fixture's SOR 005 is a double-sided leader with an epic action and
// three printings: Standard $3.99, Hyperspace (#271) $7.50, Foil unpriced,
// all as of 2026-11-01.
//
// Selectors: roles and text first. The two layout trees are reached through
// their wrapper ids (#pc-desktop / #pc-phone), which are also what the output
// checker and the hydration entry key on; inside them a few app classes are
// used where the app gives the element no role or label (the art <img>, the
// selected printing's price).

const PATH = "/cards/sor/005/";
const ONE_PX_WEBP = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");

const isPhone = (info: TestInfo) => info.project.name.startsWith("phone");
const treeId = (info: TestInfo) => (isPhone(info) ? "#pc-phone" : "#pc-desktop");
const otherTreeId = (info: TestInfo) => (isPhone(info) ? "#pc-desktop" : "#pc-phone");

/** A tree is "shown" when the card name inside it is visible. The phone
 * tree's wrapper itself has no box (the phone layout is positioned), so the
 * wrapper's own visibility says nothing; display:none on the other tree
 * hides everything in it. */
const nameIn = (page: Page, id: string) =>
  page.locator(id).getByText("Luke Skywalker", { exact: true }).first();

/** No backend behind `vite preview`: card art is a 1 px WebP, every API read
 * (the hydrated price history) is an empty series, and "/" (where the call to
 * action goes) is a stub document so the app does not boot. */
async function stubSite(page: Page) {
  await page.route("**/images/cards/**", (r) =>
    r.fulfill({ status: 200, contentType: "image/webp", body: ONE_PX_WEBP })
  );
  await page.route("**/api/**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"variant_id":0,"range":"90d","series":[]}',
    })
  );
  await page.route(
    (url) => url.pathname === "/",
    (r) =>
      r.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>app</title><p>app</p>",
      })
  );
}

/** Console lines and page errors that mean a hydration mismatch. A production
 * React build reports one as a minified error (#418, #423, #425). */
function watchHydration(page: Page) {
  const bad: string[] = [];
  const HYDRATION = /hydrat|did not match|server rendered|Minified React error #(418|423|425)/i;
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && HYDRATION.test(m.text()))
      bad.push(m.text());
  });
  page.on("pageerror", (e) => {
    if (HYDRATION.test(e.message)) bad.push(e.message);
  });
  return bad;
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("shows the name, rules text and a dated price", async ({ page }, info) => {
    await stubSite(page);
    const res = await page.goto(PATH);
    expect(res?.status()).toBe(200);
    const tree = page.locator(treeId(info));
    await expect(nameIn(page, treeId(info))).toBeVisible();
    await expect(nameIn(page, otherTreeId(info))).toBeHidden();
    await expect(tree.getByText("Give a Shield token", { exact: false }).first()).toBeVisible();
    await expect(tree.getByText("$3.99").first()).toBeVisible();
    await expect(tree.getByText(/as of Nov 1, 2026/).first()).toBeVisible();
    await expect(page).toHaveTitle(/Luke Skywalker - Faithful Friend · SOR 005/);
  });
});

test.describe("with JavaScript", () => {
  test("switching printing changes price and image; the leader flips; no hydration warning", async ({
    page,
  }, info) => {
    await stubSite(page);
    const hydration = watchHydration(page);
    await page.goto(PATH);
    const tree = page.locator(treeId(info));
    await expect(nameIn(page, treeId(info))).toBeVisible();
    const art = isPhone(info) ? tree.locator("img.m-art__img") : tree.locator("img.cp-image");
    const price = isPhone(info)
      ? tree.locator(".m-dreg__cprice")
      : tree.locator('.cp-rail__item[aria-pressed="true"]');
    await expect(art).toHaveAttribute("src", /card_fx91001_front_320\.webp$/);
    await expect(price).toContainText("$3.99");

    // Select the Hyperspace printing (#271). Hydration may still be settling:
    // the click is retried until the selection takes.
    const hyperspace = tree.getByRole("button", { name: /Hyperspace/ }).first();
    await expect(async () => {
      await hyperspace.click();
      await expect(art).toHaveAttribute("src", /card_fx91002_front_320\.webp$/, { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(price).toContainText("$7.50");
    await expect(page).toHaveURL(/[?&]v=hyperspace-sor-271$/);

    // The leader flips to its back. On the phone, reaching the Variants list
    // scrolls the page and collapses the art region; expand it first (the
    // app's own "full size" control) so the flip control is on screen.
    if (isPhone(info)) {
      const expand = tree.getByRole("button", { name: "Show the card at full size" });
      if (await expand.isVisible()) await expand.click();
    }
    await expect(tree.locator("button.cp-flip")).toBeVisible();
    await tree.locator("button.cp-flip").click();
    await expect(art).toHaveAttribute("src", /card_fx91002_back_320\.webp$/);
    await expect(tree.locator("button.cp-flip")).toContainText("Show front");

    expect(hydration).toEqual([]);
  });

  test("the call to action lands on /", async ({ page }, info) => {
    await stubSite(page);
    await page.goto(PATH);
    const tree = page.locator(treeId(info));
    await tree.getByRole("button", { name: "Create free account" }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(new URL(page.url()).pathname).toBe("/");
  });

  test("the layout follows the project's width", async ({ page }, info) => {
    await stubSite(page);
    await page.goto(PATH);
    if (isPhone(info)) {
      await expect(nameIn(page, "#pc-phone")).toBeVisible();
      await expect(nameIn(page, "#pc-desktop")).toBeHidden();
      // The phone card detail's own structure: the Variants list of buttons.
      await expect(page.locator("#pc-phone .m-print__main")).toHaveCount(3);
    } else {
      await expect(nameIn(page, "#pc-desktop")).toBeVisible();
      await expect(nameIn(page, "#pc-phone")).toBeHidden();
      await expect(page.locator("#pc-desktop .cp-rail__item")).toHaveCount(3);
    }
  });
});
