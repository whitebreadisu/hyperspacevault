import { expect, test, type TestInfo } from "@playwright/test";

// Card-text markup tokens on a generated page (App Spec §10, "Card-text
// markup tokens"), in a real browser, after hydration. The fixture's SHD 200
// carries a `<bullet>` list with a `<uq>` in one item; TWI 001 carries `<uq>`
// in its back text and its epic action.

const ONE_PX_WEBP = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");
const treeId = (info: TestInfo) =>
  info.project.name.startsWith("phone") ? "#pc-phone" : "#pc-desktop";
const HYDRATION = /hydrat|did not match|server rendered|Minified React error #(418|423|425)/i;

test("the unique mark and a bullet list render, hydrate and show no literal token", async ({
  page,
}, info) => {
  const bad: string[] = [];
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && HYDRATION.test(m.text()))
      bad.push(m.text());
  });
  page.on("pageerror", (e) => {
    if (HYDRATION.test(e.message)) bad.push(e.message);
  });
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

  for (const path of ["/cards/shd/200/", "/cards/twi/001/"]) {
    await page.goto(path);
    await page.waitForLoadState("load");
    const text = page.locator(treeId(info)).locator(".cp-text");
    await text.scrollIntoViewIfNeeded();
    await expect(text.getByRole("img", { name: "unique" }).first()).toBeVisible();
    await expect(text).not.toContainText("<uq>");
    await expect(text).not.toContainText("<bullet>");
    if (path === "/cards/shd/200/") {
      await expect(text.getByRole("listitem")).toHaveText([
        "Draw a card.",
        "Heal 2 damage from a base.",
        "Exhaust a  unit.",
      ]);
    } else {
      await expect(text.locator(".cp-text__epic-label")).toHaveCount(1);
      await expect(text.getByRole("img", { name: "unique" })).toHaveCount(2);
    }
  }
  expect(bad).toEqual([]);
});
