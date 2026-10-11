import { RELEASE_NOTES } from "../../src/content/releaseNotes";
import { expect, measureEach, test } from "./helpers";
import { expectXTopRight, shellControls } from "./more-helpers";

// S4-03: [HSV] Updates at #/more/updates (rev4 r4-10-updates-renders, with
// desktop's tiebreaker: ALL entries, not rev4's latest only) -- desktop
// NewArrivalsPage at phone width: the quicklink rail (a chip per entry drawn
// as desktop's, About & Legal at its right end, 44 px hits), the starfield
// band (version + date amber), the circuit seam, every entry's sections
// verbatim; X top-right (r4-10-x-top-right).
test.afterEach(measureEach);
test.beforeEach(() => {
  test.skip(!test.info().project.name.startsWith("phone"), "phone Updates");
});

const fmt = (iso: string) => {
  const M = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const [y, m, d] = iso.split("-");
  return `${M[Number(m) - 1]} ${Number(d)}, ${y}`;
};

test("s4-03-updates-renders-all-entries", async ({ page }) => {
  await page.goto("/#/more/updates");
  await expect(page.locator(".m-updates")).toBeVisible();
  const want = RELEASE_NOTES.map((e) => ({
    version: e.kind === "release" ? `v${e.version}` : "",
    title: e.title,
    date: fmt(e.date),
    // a section without a heading renders no heading element (desktop)
    headings: e.kind === "release" ? e.sections.filter((s) => s.heading).map((s) => s.heading) : [],
    items:
      e.kind === "release"
        ? e.sections.flatMap((s) => s.items.map((i) => i.title + "|" + i.body))
        : [],
  }));
  const got = await page.evaluate(() =>
    [...document.querySelectorAll(".m-updates .na-entry")].map((s) => ({
      version: s.querySelector(".na-entry__version")?.textContent ?? "",
      title: s.querySelector(".na-entry__title")!.textContent,
      date: s.querySelector(".na-entry__date")!.textContent,
      headings: [...s.querySelectorAll(".na-section__heading")].map((h) =>
        // the emoji span is decorative; the heading text follows it
        [...h.childNodes]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent)
          .join("")
      ),
      items: [...s.querySelectorAll(".na-item")].map(
        (li) =>
          li.querySelector(".na-item__title")!.textContent +
          "|" +
          li.querySelector(".na-item__body")!.textContent
      ),
    }))
  );
  // Every RELEASE_NOTES entry, newest first, verbatim.
  expect(got).toEqual(want);
  expect(got.length).toBe(RELEASE_NOTES.length);

  const m = await page.evaluate(() => {
    const chips = [...document.querySelectorAll<HTMLElement>(".m-updates__chip")];
    const first = document.querySelector(".na-entry")!;
    const rail = document.querySelector(".m-updates__rail")!.getBoundingClientRect();
    const about = chips[chips.length - 1].getBoundingClientRect();
    const box = getComputedStyle(chips[0].querySelector(".na-quicklink")!);
    return {
      chips: chips.map((c) => c.textContent),
      hits: chips.map((c) => Math.round(c.getBoundingClientRect().height)),
      // About & Legal ends the rail: its last control, flush with the end of
      // the rail's (sideways-scrolling) content.
      aboutAtRight:
        chips[chips.length - 1] === document.querySelector(".m-updates__rail")!.lastElementChild &&
        Math.abs(
          rail.left + document.querySelector(".m-updates__rail")!.scrollWidth - 12 - about.right
        ) <= 1,
      railRows: new Set(chips.map((c) => Math.round(c.getBoundingClientRect().top))).size,
      chipBox: [
        box.borderTopWidth,
        box.borderRadius,
        box.paddingTop,
        box.paddingLeft,
        box.fontSize,
      ],
      band: getComputedStyle(first.querySelector(".na-entry__header")!).backgroundImage,
      version: getComputedStyle(first.querySelector(".na-entry__version")!).color,
      date: getComputedStyle(first.querySelector(".na-entry__date")!).color,
      seamMask: getComputedStyle(first.querySelector(".na-divider")!).maskImage,
    };
  });
  expect(m.chips).toEqual([
    ...RELEASE_NOTES.map((e) => (e.kind === "release" ? `v${e.version}` : fmt(e.date))),
    "About & Legal",
  ]);
  m.hits.forEach((h) => expect(h).toBeGreaterThanOrEqual(44));
  expect(m.aboutAtRight).toBe(true);
  expect(m.railRows).toBe(1);
  expect(m.chipBox).toEqual(["1px", "4px", "5px", "12px", "12px"]);
  expect(m.band).toMatch(/starfield_[A-Z]+\.jpg/);
  expect(m.version).toBe("rgb(217, 154, 31)");
  expect(m.date).toBe("rgb(217, 154, 31)");
  expect(m.seamMask).toContain("swu-separator.svg");

  // A chip jumps to its entry: it lands just under the sticky rail.
  const mid = RELEASE_NOTES[Math.floor(RELEASE_NOTES.length / 2)];
  await page
    .locator(".m-updates__chip")
    .nth(Math.floor(RELEASE_NOTES.length / 2))
    .click();
  await expect
    .poll(() =>
      page.evaluate((k) => {
        const e = document.getElementById(`na-entry-${k}`)!.getBoundingClientRect();
        const r = document.querySelector(".m-updates__rail")!.getBoundingClientRect();
        return Math.abs(Math.round(e.top - r.bottom));
      }, mid.key)
    )
    .toBeLessThanOrEqual(2);
  // The rail's About & Legal opens About.
  await page.locator(".m-updates__chip--about").click();
  await expect(page).toHaveURL(/#\/about$/);
  await expect(page.locator(".m-about")).toBeVisible();
});

test("s4-03-updates-x-top-right", async ({ page }) => {
  await page.goto("/#/more/updates");
  await expect(page.locator(".m-updates")).toBeVisible();
  expectXTopRight(await shellControls(page));
  await page.locator(".m-shell__head [aria-label='Close']").click();
  await expect(page).toHaveURL(/#\/vault$/);
});
