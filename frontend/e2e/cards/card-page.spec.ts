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
 * (the hydrated price history) is an empty series, and "/" (where every call
 * to action goes, as `/?card=sor-005`) is a stub document so the app does not
 * boot. */
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
    // The price and its date in one block: the desktop rail / the phone's
    // Variants section.
    const prices = tree.locator(isPhone(info) ? "section.m-printings" : ".cp-rail");
    await expect(prices.getByText("$3.99").first()).toBeVisible();
    await expect(prices.getByText(/as of Nov 1, 2026/)).toBeVisible();
    await expect(page).toHaveTitle(/Luke Skywalker - Faithful Friend · SOR 005/);
  });
});

test.describe("with JavaScript", () => {
  // Every JS test fails on any hydration warning (design note §8).
  let hydration: string[] = [];
  test.beforeEach(async ({ page }) => {
    hydration = watchHydration(page);
    await stubSite(page);
  });
  test.afterEach(async ({ page }) => {
    await page.waitForLoadState("load");
    expect(hydration).toEqual([]);
  });

  test("switching printing changes price and image; the leader flips", async ({ page }, info) => {
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
    const flip = tree.locator("button.cp-flip");
    if (isPhone(info)) {
      const expand = tree.getByRole("button", { name: "Show the card at full size" });
      await expect(expand.or(flip).first()).toBeVisible();
      if (await expand.isVisible()) await expand.click();
    }
    await expect(flip).toBeVisible();
    await flip.click();
    await expect(art).toHaveAttribute("src", /card_fx91002_back_320\.webp$/);
    await expect(flip).toContainText("Show front");
  });

  test("the call to action opens this card in the app", async ({ page }, info) => {
    await page.goto(PATH);
    const tree = page.locator(treeId(info));
    await tree.getByRole("button", { name: "Create free account" }).click();
    await expect(page).toHaveURL(/\/\?card=sor-005&signup=1$/);
    expect(new URL(page.url()).pathname).toBe("/");
  });

  test("Sign in opens this card in the app without signup", async ({ page }, info) => {
    await page.goto(PATH);
    await page.locator(treeId(info)).getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/\?card=sor-005$/);
  });

  test("a browser that has opened the app goes straight to the card in the app", async ({
    page,
  }) => {
    await page.addInitScript(() => window.localStorage.setItem("hsv_app_seen", "1"));
    await page.goto("/cards/");
    await page.goto(PATH);
    await expect(page).toHaveURL(/\/\?card=sor-005$/);
    // location.replace: Back skips the card page instead of redirecting again.
    await page.goBack();
    await expect(page).toHaveURL(/\/cards\/$/);
  });

  test("the redirect is the head script's: it works with the page bundle blocked", async ({
    page,
  }) => {
    await page.addInitScript(() => window.localStorage.setItem("hsv_app_seen", "1"));
    await page.route("**/assets/*.js", (r) => r.abort());
    await page.goto(PATH);
    await expect(page).toHaveURL(/\/\?card=sor-005$/);
  });

  test("a returning browser on a printing's link lands on that printing in the app", async ({
    page,
  }) => {
    await page.addInitScript(() => window.localStorage.setItem("hsv_app_seen", "1"));
    await page.goto(`${PATH}?v=hyperspace-sor-271`);
    await expect(page).toHaveURL(/\/\?card=sor-005&v=hyperspace-sor-271$/);
  });

  test("the head script alone carries the printing too", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("hsv_app_seen", "1"));
    await page.route("**/assets/*.js", (r) => r.abort());
    await page.goto(`${PATH}?v=hyperspace-sor-271`);
    await expect(page).toHaveURL(/\/\?card=sor-005&v=hyperspace-sor-271$/);
  });

  test("after a printing switch the calls to action open that printing", async ({ page }, info) => {
    await page.goto(PATH);
    const tree = page.locator(treeId(info));
    const hyperspace = tree.getByRole("button", { name: /Hyperspace/ }).first();
    await expect(async () => {
      await hyperspace.click();
      await expect(page).toHaveURL(/[?&]v=hyperspace-sor-271$/, { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    // The phone's region may have collapsed on the way to the Variants list,
    // so the plate's links are checked by attribute and the bar's link is
    // the one followed.
    for (const sel of [".pc-brand", ".pc-bar__open", ".pc-cta__signin"]) {
      await expect(tree.locator(sel)).toHaveAttribute(
        "href",
        "/?card=sor-005&v=hyperspace-sor-271"
      );
    }
    await tree.locator(".pc-bar__open").click();
    await expect(page).toHaveURL(/\/\?card=sor-005&v=hyperspace-sor-271$/);
  });

  test("a phone-tree previous / next link opens the neighbour in the app", async ({
    page,
  }, info) => {
    test.skip(!isPhone(info), "the text links are the phone tree's");
    await page.goto(PATH);
    const next = page.locator("#pc-phone .pc-setnav a").last();
    await expect(next).toHaveAttribute("href", "/?card=sor-010");
    await next.click();
    await expect(page).toHaveURL(/\/\?card=sor-010$/);
  });

  test("?page keeps a returning browser on the card page", async ({ page }, info) => {
    await page.addInitScript(() => window.localStorage.setItem("hsv_app_seen", "1"));
    await page.goto(`${PATH}?page`);
    await expect(nameIn(page, treeId(info))).toBeVisible();
    // Hydrated: selecting a printing writes ?v= and keeps ?page.
    const tree = page.locator(treeId(info));
    const hyperspace = tree.getByRole("button", { name: /Hyperspace/ }).first();
    await expect(async () => {
      await hyperspace.click();
      await expect(page).toHaveURL(/[?&]v=hyperspace-sor-271$/, { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    expect(new URL(page.url()).searchParams.has("page")).toBe(true);
    expect(new URL(page.url()).pathname).toBe(PATH);
  });

  test("the layout follows the project's width", async ({ page }, info) => {
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

  test("crossing the width switch hydrates the revealed tree", async ({ page }, info) => {
    await page.goto(PATH);
    await expect(nameIn(page, treeId(info))).toBeVisible();
    // Wait for the first tree's hydration before resizing.
    await page.waitForLoadState("load");
    const other = otherTreeId(info);
    const toPhone = !isPhone(info);
    await page.setViewportSize(
      toPhone ? { width: 390, height: 844 } : { width: 1440, height: 900 }
    );
    await expect(nameIn(page, other)).toBeVisible();
    const tree = page.locator(other);
    const art = toPhone ? tree.locator("img.m-art__img") : tree.locator("img.cp-image");
    await expect(art).toHaveAttribute("src", /card_fx91001_front_320\.webp$/);
    // A live control in the revealed tree: switching printing changes its art.
    const hyperspace = tree.getByRole("button", { name: /Hyperspace/ }).first();
    await expect(async () => {
      await hyperspace.click();
      await expect(art).toHaveAttribute("src", /card_fx91002_front_320\.webp$/, { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(page).toHaveURL(/[?&]v=hyperspace-sor-271$/);
  });

  test("one printing selection across both trees, crossing back and forth", async ({
    page,
  }, info) => {
    const sizes = { phone: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } };
    const artOf = (id: string) =>
      page.locator(id).locator(id === "#pc-phone" ? "img.m-art__img" : "img.cp-image");
    const pick = async (id: string, name: RegExp, stem: RegExp) => {
      const button = page.locator(id).getByRole("button", { name }).first();
      await expect(async () => {
        await button.click();
        await expect(artOf(id)).toHaveAttribute("src", stem, { timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
    };
    const first = treeId(info);
    const second = otherTreeId(info);
    const sizeOf = (id: string) => (id === "#pc-phone" ? sizes.phone : sizes.desktop);
    await page.goto(PATH);
    await page.waitForLoadState("load");
    await pick(first, /Hyperspace/, /card_fx91002_front_320\.webp$/);
    await expect(page).toHaveURL(/[?&]v=hyperspace-sor-271$/);

    await page.setViewportSize(sizeOf(second));
    await expect(nameIn(page, second)).toBeVisible();
    await expect(artOf(second)).toHaveAttribute("src", /card_fx91002_front_320\.webp$/);
    await pick(second, /^Standard/, /card_fx91001_front_320\.webp$/);
    expect(new URL(page.url()).searchParams.has("v")).toBe(false);

    // Back, and across twice more: each tree hydrated once, still live.
    await page.setViewportSize(sizeOf(first));
    await expect(artOf(first)).toHaveAttribute("src", /card_fx91001_front_320\.webp$/);
    await page.setViewportSize(sizeOf(second));
    await page.setViewportSize(sizeOf(first));
    await pick(first, /Hyperspace/, /card_fx91002_front_320\.webp$/);
    await expect(page).toHaveURL(/[?&]v=hyperspace-sor-271$/);
  });
});
