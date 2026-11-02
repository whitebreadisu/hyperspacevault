import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPages, type PublicCatalog } from "./publicCatalog";
import { renderCardBody } from "./render";

// Design note §5a: a printing whose 320 px rendition is not mirrored renders
// a same-size placeholder panel, never an <img>. The generator drops the
// missing renditions from the page data (scripts/public-pages/lib/images.mjs
// withAvailableArt: images and stored URL null); this pins what the page
// renders from such data, on both layout trees.

const fixture = JSON.parse(
  readFileSync("scripts/public-pages/fixtures/catalog.json", "utf8")
) as PublicCatalog;

function withoutArt(catalog: PublicCatalog): PublicCatalog {
  return {
    ...catalog,
    cards: catalog.cards.map((c) => ({
      ...c,
      variants: c.variants.map((v) => ({
        ...v,
        front_images: null,
        front_image_url: null,
        back_images: null,
        back_image_url: null,
      })),
    })),
  };
}

describe("missing card art", () => {
  const luke = (catalog: PublicCatalog) =>
    buildPages(catalog).find((p) => p.numberLabel === "SOR 005")!;

  it("renders the placeholder panel and no card <img> or flip on either tree", () => {
    document.body.innerHTML = renderCardBody(luke(withoutArt(fixture)));
    const desk = document.getElementById("pc-desktop")!;
    const phone = document.getElementById("pc-phone")!;
    expect(desk.querySelector(".pc-art-ph")).not.toBeNull();
    expect(desk.querySelector("img.cp-image")).toBeNull();
    expect(desk.querySelector("button.cp-flip")).toBeNull();
    expect(phone.querySelector(".m-img-ph")).not.toBeNull();
    expect(phone.querySelector("img.m-art__img")).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/\/images\/cards\//);
  });

  it("renders the art, not the placeholder, when the rendition exists", () => {
    document.body.innerHTML = renderCardBody(luke(fixture));
    const desk = document.getElementById("pc-desktop")!;
    expect(desk.querySelector(".pc-art-ph")).toBeNull();
    expect(desk.querySelector("img.cp-image")!.getAttribute("src")).toBe(
      "/images/cards/card_fx91001_front_320.webp"
    );
  });
});
