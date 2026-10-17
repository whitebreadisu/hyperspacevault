import { readFileSync } from "node:fs";
import { expect, measureEach, test } from "./helpers";
import { key, openPad, typeNum } from "./tool-helpers";

// S3-02 / S3-03: the keypad (rev4 pad-ready, pad-resolved, pad-not-in-set,
// pad-four-digits) on desktop's resolver, and the readout (rev4
// f-1-readout-over-limit-red, r4-7-keypad-readout-keeps-fraction).
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone tool");
});

test("s3-02-number-resolves", async ({ page }) => {
  await openPad(page);
  // pad-ready: numeric only, no Card # label, dimmed Verify on the entry row.
  const ready = await page.evaluate(() => {
    const k = document.querySelector(".m-key:not(.m-key--fn)")!;
    const cs = getComputedStyle(k);
    return {
      keys: document.querySelectorAll(".m-keys .m-key").length,
      font: cs.fontFamily,
      h: Math.round(k.getBoundingClientRect().height),
      verifyDim: !!document.querySelector(".m-pad__entry .m-logbtn--empty[aria-disabled=true]"),
      numFont: getComputedStyle(document.querySelector(".m-padnum__val")!).fontFamily,
      placeholder: document.querySelector(".m-padnum__val")!.textContent,
      set: document.querySelector(".m-padset__code")!.textContent,
    };
  });
  expect(ready.keys).toBe(12);
  expect(ready.font).toMatch(/Russo One/);
  expect(ready.numFont).toMatch(/Russo One/);
  expect(ready.h).toBe(58);
  expect(ready.verifyDim).toBe(true);
  expect(ready.placeholder).toBe("000");
  expect(ready.set).toBe("SOR");
  await expect(page.locator(".m-padidle__lead")).toHaveText("Type the number printed on a card.");

  await typeNum(page, 87);
  await expect(page.locator(".m-padnum__val")).toHaveText("87");
  await expect(page.locator(".m-ident__name")).toHaveText("Darth Vader");
  await expect(page.locator(".m-ident__meta")).toHaveText("SOR 87 · Standard");
  await expect(page.locator(".m-ident__frame img")).toHaveCount(1);
  await expect(page.locator(".m-ident__add .swu-btn")).toHaveText("Add to batch");
  await expect(page.locator(".m-ident__details")).toBeVisible();

  // pad-four-digits + del / clear.
  await typeNum(page, 123);
  await expect(page.locator(".m-padnum__val")).toHaveText("8712");
  await key(page, "Delete digit");
  await expect(page.locator(".m-padnum__val")).toHaveText("871");
  await key(page, "Clear number");
  await expect(page.locator(".m-padnum__val")).toHaveText("000");
  // A leading zero is dropped (card numbers are unpadded).
  await typeNum(page, "087");
  await expect(page.locator(".m-padnum__val")).toHaveText("87");
});

test("s3-02-not-in-set", async ({ page }) => {
  await openPad(page);
  await typeNum(page, 57);
  await expect(page.locator(".m-padmsg__err")).toHaveText("Not in this set");
  await expect(page.locator(".m-padmsg__rec")).toContainText("Card# 57 is not valid");
  expect(await page.locator(".m-padnum").evaluate((e) => getComputedStyle(e).borderTopColor)).toBe(
    "rgb(192, 32, 46)"
  );
  // BL-270: a miss never shrinks the deck either (only the user does).
  await expect(page.locator(".m-pad--compact")).toHaveCount(0);
});

const RED = "rgb(239, 68, 68)";
async function lineColor(page: import("@playwright/test").Page, re: RegExp) {
  const line = page.locator(".m-ident .ac-pad__readout-line", { hasText: re });
  await expect(line).toHaveCount(1);
  return line.evaluate((e) => ({
    c: getComputedStyle(e).color,
    red: e.classList.contains("ac-pad__readout-line--red"),
  }));
}

test("s3-03-readout-over-limit-red", async ({ page }) => {
  // r4-7: the fraction stays on the keypad readout; no count chip there.
  await openPad(page, "#/pad?set=SOR&num=87");
  await expect(page.locator(".m-ident .ac-pad__readout-line").first()).toHaveText("In vault 1/3");
  await expect(page.locator(".m-ident .ac-pad__readout-line").nth(1)).toHaveText("After add 2/3");
  await expect(page.locator(".m-ident .playset-chip")).toHaveCount(0);
  await expect(page.locator(".m-ident .m-pips--lg .playset__pip")).toHaveCount(3);

  // At the limit (SOR 35 Standard owned 3 of 3): red.
  await openPad(page, "#/pad?set=SOR&num=35");
  expect(await lineColor(page, /^In vault 3\/3 \(at limit\)$/)).toEqual({ c: RED, red: true });
  await expect(page.locator(".m-readout__sub")).toHaveText("Adding goes past your keep limit");

  // One short (ASH 112 Standard owned 2 of 3): one copy entered, then the
  // next After add is past the limit and red.
  await openPad(page, "#/pad?set=ASH&num=112");
  await page.locator(".m-ident__add .swu-btn").click();
  await expect(page.locator(".m-ident__added")).toHaveText("In batch");
  await typeNum(page, 112);
  expect(await lineColor(page, /^After add 4\/3 \(over limit\)$/)).toEqual({ c: RED, red: true });
  expect(await lineColor(page, /^In vault 2\/3$/)).toEqual({ c: "rgb(34, 164, 76)", red: false });
});

test("s3-03-readout-over-limit-red-soft", async ({ page }) => {
  // Over the limit (keep-limit lowered to 2, LAW 214 owned 3): red, never amber.
  const limits = JSON.parse(readFileSync("e2e/mobile/fixtures/limits.json", "utf8")) as {
    cap_mode: string;
    limits: { type_category: string; limit_bucket: string; max_quantity: number }[];
  };
  limits.cap_mode = "soft";
  for (const l of limits.limits)
    if (l.type_category === "standard" && l.limit_bucket === "Standard") l.max_quantity = 2;
  await page.route(
    (u) => u.pathname === "/api/settings/limits",
    (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(limits) })
  );
  await openPad(page, "#/pad?set=LAW&num=214");
  expect(await lineColor(page, /^In vault 3\/2 \(over limit\)$/)).toEqual({ c: RED, red: true });
  await expect(page.locator(".m-readout--amber")).toHaveCount(0);
});
