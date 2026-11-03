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

// The printed line breaks (App Spec §10.11): SOR 010's source text is
// "Sentinel\n\nFixture text: ...\n". The panel shows "Sentinel" on a line of
// its own (one break, not a blank line: the blank line is folded), and a
// bullet list gains no extra breaks. Measured from layout, not from styles.
test("card text keeps its printed line breaks, with no blank or doubled lines", async ({
  page,
}, info) => {
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
  await page.goto("/cards/sor/010/");
  await page.waitForLoadState("load");
  const body = page.locator(treeId(info)).locator(".cp-text .cp-text__body").first();
  await body.scrollIntoViewIfNeeded();
  const m = await body.evaluate((p) => {
    const node = p.firstChild as Text;
    const rectOf = (word: string) => {
      const i = node.data.indexOf(word);
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + word.length);
      return r.getBoundingClientRect();
    };
    const lineHeight = parseFloat(getComputedStyle(p).lineHeight);
    const first = rectOf("Sentinel");
    const second = rectOf("Fixture");
    return {
      lineHeight,
      gap: second.top - first.top,
      startsAtTop: first.top - p.getBoundingClientRect().top,
    };
  });
  // The next word starts exactly one line down: a break, not a blank line.
  expect(m.gap).toBeGreaterThan(m.lineHeight * 0.5);
  expect(m.gap).toBeLessThan(m.lineHeight * 1.5);
  // No leading blank line.
  expect(m.startsAtTop).toBeLessThan(m.lineHeight * 0.5);

  await page.goto("/cards/shd/200/");
  await page.waitForLoadState("load");
  const text = page.locator(treeId(info)).locator(".cp-text");
  await text.scrollIntoViewIfNeeded();
  const lines = await text.evaluate((t) => {
    const lh = (e: Element) => parseFloat(getComputedStyle(e).lineHeight);
    const rows = [t.querySelector(".cp-text__para")!, ...t.querySelectorAll("li")];
    return rows.map((e) => e.getBoundingClientRect().height / lh(e));
  });
  // The lead-in and each item are one line each (none wraps at these widths).
  expect(lines).toHaveLength(4);
  for (const n of lines) expect(n).toBeLessThan(1.5);
});
