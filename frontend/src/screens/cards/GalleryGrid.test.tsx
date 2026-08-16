import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { GalleryGrid } from "./GalleryGrid";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";

// CREATE (BL-73 Stage 1): GalleryGrid is new -- there's no prior gallery
// view to port from. Coverage mirrors CardsTable.test.tsx's shape (empty
// state, virtualization-doesn't-mount-everything, click wiring) since both
// components virtualize the same `filtered` array with @tanstack/
// react-virtual -- see src/test/setup.ts for the jsdom offsetWidth/
// offsetHeight mock (1200x600) both components rely on for deterministic
// windowing in tests.
//
// DISPOSITION (BL-111 F4, PORT): GalleryGrid's `isAuthenticated` prop is new
// and required (CardsPage always has a real auth boolean to pass -- see
// utils/inventory.test.ts's precedent of not defaulting tenant-shaped
// props). Every pre-existing render() call above this point was mechanically
// given `isAuthenticated={false}` -- none of those tests assert on plate/
// dossier content, only on art/orientation/click/virtualization behavior
// that BL-111 F4 didn't touch, so signed-out is an inert, uninteresting
// value for them. Plate/dossier coverage itself lives in the new describe
// blocks at the bottom of this file.

function makeCard(overrides: Partial<InventoryCard> = {}): InventoryCard {
  return {
    base_card_id: 1,
    set_code: "SOR",
    base_card_number: "001",
    name: "Test Unit",
    subtitle: null,
    rarity: "Common",
    type: "Unit",
    aspects: [],
    keywords: [],
    traits: [],
    cost: 1,
    power: 1,
    hp: 1,
    arena: "Ground",
    is_token: false,
    variants: [
      {
        variant_id: 101,
        variant_type: "Standard",
        finish: "Standard",
        channel: "Retail",
        source_set_code: "SOR",
        card_number: "001",
        front_image_url: "https://cdn.example.com/001.png",
        back_image_url: null,
        quantity: 0,
      },
    ],
    inventory: { 101: 0 },
    ...overrides,
  };
}

describe("GalleryGrid empty state", () => {
  it("shows the placeholder message and renders no cells when there are no cards", () => {
    const { container } = render(
      <GalleryGrid cards={[]} onSelectCard={vi.fn()} isAuthenticated={false} />
    );
    expect(screen.getByText("No cards match the current filters.")).toBeTruthy();
    expect(container.querySelector(".gallery-cell")).toBeNull();
  });
});

describe("GalleryGrid renders the filtered list in order", () => {
  it("renders a cell per card, in the same order as the input array", () => {
    const cards = [
      makeCard({ base_card_id: 1, name: "Card A" }),
      makeCard({ base_card_id: 2, name: "Card B" }),
      makeCard({ base_card_id: 3, name: "Card C" }),
    ];
    render(<GalleryGrid cards={cards} onSelectCard={vi.fn()} isAuthenticated={false} />);

    const cells = screen.getAllByRole("button");
    expect(cells.map((c) => c.getAttribute("aria-label"))).toEqual(["Card A", "Card B", "Card C"]);
  });

  it("uses the Standard-variant representative's front_image_url for the image", () => {
    const card = makeCard({
      base_card_id: 1,
      name: "Multi Variant",
      variants: [
        {
          variant_id: 1,
          variant_type: "Foil",
          finish: "Standard Foil",
          channel: "Retail",
          source_set_code: "SOR",
          card_number: "001",
          front_image_url: "https://cdn.example.com/foil.png",
          back_image_url: null,
          quantity: 0,
        },
        {
          variant_id: 2,
          variant_type: "Standard",
          finish: "Standard",
          channel: "Retail",
          source_set_code: "SOR",
          card_number: "001",
          front_image_url: "https://cdn.example.com/standard.png",
          back_image_url: null,
          quantity: 0,
        },
      ],
    });
    render(<GalleryGrid cards={[card]} onSelectCard={vi.fn()} isAuthenticated={false} />);
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toBe("https://cdn.example.com/standard.png");
    expect(img.getAttribute("loading")).toBe("lazy");
  });

  it("renders a 320/640 srcset when the API returns derived renditions (BL-76 Phase 3)", () => {
    const card = makeCard({
      variants: [
        {
          variant_id: 101,
          variant_type: "Standard",
          finish: "Standard",
          channel: "Retail",
          source_set_code: "SOR",
          card_number: "001",
          front_image_url: "https://cdn.example.com/001.png",
          front_images: {
            original: "/images/cards/001.png",
            w640: "/images/cards/001_640.webp",
            w320: "/images/cards/001_320.webp",
          },
          back_image_url: null,
          quantity: 0,
        },
      ],
    });
    render(<GalleryGrid cards={[card]} onSelectCard={vi.fn()} isAuthenticated={false} />);
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toContain("/images/cards/001_640.webp");
    expect(img.srcset).toContain("001_320.webp 320w");
    expect(img.srcset).toContain("001_640.webp 640w");
  });

  // BL-76 follow-up fix: an unmirrored single-slash-origin image chains the
  // backend's 307 fallback into a CDN 403 (the redirect can only guess the
  // dominant double-slash form) -- the cell's <img> must recover by swapping
  // to the exact stored URL, once, with srcset stripped.
  it("swaps a failing image to the stored CDN URL on error (one-shot, srcset stripped)", () => {
    const card = makeCard({
      variants: [
        {
          variant_id: 101,
          variant_type: "Standard",
          finish: "Standard",
          channel: "Retail",
          source_set_code: "SOR",
          card_number: "001",
          front_image_url: "https://cdn.example.com/001.png",
          front_images: {
            original: "/images/cards/001.png",
            w640: "/images/cards/001_640.webp",
            w320: "/images/cards/001_320.webp",
          },
          back_image_url: null,
          quantity: 0,
        },
      ],
    });
    render(<GalleryGrid cards={[card]} onSelectCard={vi.fn()} isAuthenticated={false} />);
    const img = screen.getByRole("img") as HTMLImageElement;

    fireEvent.error(img);

    expect(img.getAttribute("src")).toBe("https://cdn.example.com/001.png");
    expect(img.getAttribute("srcset")).toBeNull();
    expect(img.getAttribute("sizes")).toBeNull();

    // The stored URL failing too must not loop -- second error is a no-op.
    fireEvent.error(img);
    expect(img.getAttribute("src")).toBe("https://cdn.example.com/001.png");
  });
});

describe("GalleryGrid placeholder cells", () => {
  it("renders a dim placeholder frame (no img) for a card whose representative variant has no front_image_url", () => {
    const cards = [
      makeCard({ base_card_id: 1, name: "Has Image" }),
      makeCard({
        base_card_id: 2,
        name: "No Image",
        variants: [
          {
            variant_id: 102,
            variant_type: "Standard",
            finish: "Standard",
            channel: "Retail",
            source_set_code: "SOR",
            card_number: "002",
            front_image_url: null,
            back_image_url: null,
            quantity: 0,
          },
        ],
      }),
    ];
    const { container } = render(
      <GalleryGrid cards={cards} onSelectCard={vi.fn()} isAuthenticated={false} />
    );

    // Sort position is preserved -- both cards still get a cell.
    const cells = screen.getAllByRole("button");
    expect(cells).toHaveLength(2);

    const noImageCell = screen.getByRole("button", { name: "No Image" });
    expect(noImageCell.className).toContain("gallery-cell--empty");
    expect(noImageCell.querySelector("img")).toBeNull();

    expect(container.querySelectorAll(".gallery-cell--empty")).toHaveLength(1);
  });
});

// CREATE (BL-73 orientation rule, from Jeremy's dev review): no card may
// display landscape in the gallery -- leaders show their portrait back
// side, bases (and back-less leaders) rotate their landscape front 90°.
describe("GalleryGrid orientation rule (no landscape)", () => {
  function makeVariantImages(front: string | null, back: string | null) {
    return [
      {
        variant_id: 201,
        variant_type: "Standard",
        finish: "Standard",
        channel: "Retail",
        source_set_code: "SOR",
        card_number: "001",
        front_image_url: front,
        back_image_url: back,
        quantity: 0,
      },
    ];
  }

  it("Leader: shows the representative's back image (portrait side), unrotated", () => {
    const leader = makeCard({
      base_card_id: 1,
      name: "Leader Card",
      type: "Leader",
      variants: makeVariantImages(
        "https://cdn.example.com/leader-front.png",
        "https://cdn.example.com/leader-back.png"
      ),
    });
    render(<GalleryGrid cards={[leader]} onSelectCard={vi.fn()} isAuthenticated={false} />);
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toBe("https://cdn.example.com/leader-back.png");
    expect(img.className).not.toContain("gallery-cell__img--rotated");
  });

  it("Base: shows the front image rotated 90° to fill the portrait cell", () => {
    const base = makeCard({
      base_card_id: 2,
      name: "Base Card",
      type: "Base",
      variants: makeVariantImages("https://cdn.example.com/base-front.png", null),
    });
    render(<GalleryGrid cards={[base]} onSelectCard={vi.fn()} isAuthenticated={false} />);
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toBe("https://cdn.example.com/base-front.png");
    expect(img.className).toContain("gallery-cell__img--rotated");
  });

  it("Leader without a back image: falls back to the rotated front (Base treatment), never landscape", () => {
    const backlessLeader = makeCard({
      base_card_id: 3,
      name: "Backless Leader",
      type: "Leader",
      variants: makeVariantImages("https://cdn.example.com/leader-front-only.png", null),
    });
    render(<GalleryGrid cards={[backlessLeader]} onSelectCard={vi.fn()} isAuthenticated={false} />);
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toBe("https://cdn.example.com/leader-front-only.png");
    expect(img.className).toContain("gallery-cell__img--rotated");
  });

  it("every other type: front image, unrotated (regression guard)", () => {
    const unit = makeCard({
      base_card_id: 4,
      name: "Unit Card",
      type: "Unit",
      variants: makeVariantImages("https://cdn.example.com/unit-front.png", null),
    });
    render(<GalleryGrid cards={[unit]} onSelectCard={vi.fn()} isAuthenticated={false} />);
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toBe("https://cdn.example.com/unit-front.png");
    expect(img.className).not.toContain("gallery-cell__img--rotated");
  });

  it("Leader with no usable image at all (no back, no front) keeps the placeholder cell", () => {
    const imageless = makeCard({
      base_card_id: 5,
      name: "Imageless Leader",
      type: "Leader",
      variants: makeVariantImages(null, null),
    });
    render(<GalleryGrid cards={[imageless]} onSelectCard={vi.fn()} isAuthenticated={false} />);
    const cell = screen.getByRole("button", { name: "Imageless Leader" });
    expect(cell.className).toContain("gallery-cell--empty");
    expect(cell.querySelector("img")).toBeNull();
  });
});

// CREATE (BL-73 follow-up, Jeremy's 2nd dev-review pass, issue #203):
// finish-filter-aware representative image. When a Finish filter is active,
// the cell should show a variant matching the filter's selected finish(es)
// instead of always falling back to Standard -- matching semantics mirror
// applyFilters' own finish check (`v.finish ?? v.variant_type` against the
// filter Set, utils/filters.ts) so a card guaranteed to have >=1 matching
// variant (by virtue of being in the already-filtered `cards` array) always
// finds one here too.
describe("GalleryGrid finish-filter-aware representative", () => {
  function variant(overrides: Partial<InventoryVariant> = {}) {
    return {
      variant_id: 1,
      variant_type: "Standard",
      finish: "Standard",
      channel: "Retail",
      source_set_code: "SOR",
      card_number: "001",
      front_image_url: "https://cdn.example.com/default.png",
      back_image_url: null,
      quantity: 0,
      ...overrides,
    };
  }

  it("no finish filter active (activeFinishes omitted): unchanged Standard-representative behavior", () => {
    const card = makeCard({
      base_card_id: 1,
      name: "No Filter",
      variants: [
        variant({
          variant_id: 1,
          finish: "Standard",
          front_image_url: "https://cdn.example.com/standard.png",
        }),
        variant({
          variant_id: 2,
          finish: "Hyperspace",
          front_image_url: "https://cdn.example.com/hyperspace.png",
        }),
      ],
    });
    render(<GalleryGrid cards={[card]} onSelectCard={vi.fn()} isAuthenticated={false} />);
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toBe("https://cdn.example.com/standard.png");
  });

  it("no finish filter active (empty Set): unchanged Standard-representative behavior", () => {
    const card = makeCard({
      base_card_id: 1,
      name: "Empty Filter",
      variants: [
        variant({
          variant_id: 1,
          finish: "Standard",
          front_image_url: "https://cdn.example.com/standard.png",
        }),
        variant({
          variant_id: 2,
          finish: "Hyperspace",
          front_image_url: "https://cdn.example.com/hyperspace.png",
        }),
      ],
    });
    render(
      <GalleryGrid
        cards={[card]}
        onSelectCard={vi.fn()}
        isAuthenticated={false}
        activeFinishes={new Set()}
      />
    );
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toBe("https://cdn.example.com/standard.png");
  });

  it("single-finish filter match: swaps the image to the matching variant", () => {
    const card = makeCard({
      base_card_id: 1,
      name: "Hyperspace Match",
      variants: [
        variant({
          variant_id: 1,
          finish: "Standard",
          front_image_url: "https://cdn.example.com/standard.png",
        }),
        variant({
          variant_id: 2,
          finish: "Hyperspace",
          front_image_url: "https://cdn.example.com/hyperspace.png",
        }),
      ],
    });
    render(
      <GalleryGrid
        cards={[card]}
        onSelectCard={vi.fn()}
        isAuthenticated={false}
        activeFinishes={new Set(["Hyperspace"])}
      />
    );
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toBe("https://cdn.example.com/hyperspace.png");
  });

  it("matches on variant_type when finish is null, same fallback applyFilters uses", () => {
    const card = makeCard({
      base_card_id: 1,
      name: "Variant Type Match",
      variants: [
        variant({
          variant_id: 1,
          finish: "Standard",
          front_image_url: "https://cdn.example.com/standard.png",
        }),
        variant({
          variant_id: 2,
          variant_type: "Foil",
          finish: null as unknown as string,
          front_image_url: "https://cdn.example.com/foil.png",
        }),
      ],
    });
    render(
      <GalleryGrid
        cards={[card]}
        onSelectCard={vi.fn()}
        isAuthenticated={false}
        activeFinishes={new Set(["Foil"])}
      />
    );
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toBe("https://cdn.example.com/foil.png");
  });

  it("multiple selected finishes matching multiple variants: lowest card_number wins", () => {
    const card = makeCard({
      base_card_id: 1,
      name: "Multi Match",
      variants: [
        variant({
          variant_id: 1,
          finish: "Hyperspace",
          card_number: "132",
          front_image_url: "https://cdn.example.com/hyperspace-132.png",
        }),
        variant({
          variant_id: 2,
          finish: "Showcase",
          card_number: "045",
          front_image_url: "https://cdn.example.com/showcase-045.png",
        }),
      ],
    });
    render(
      <GalleryGrid
        cards={[card]}
        onSelectCard={vi.fn()}
        isAuthenticated={false}
        activeFinishes={new Set(["Hyperspace", "Showcase"])}
      />
    );
    const img = screen.getByRole("img") as HTMLImageElement;
    // "045" < "132" numerically -- must beat a naive string compare too
    // (both are 3-digit here, but the rule is numeric, not lexical).
    expect(img.src).toBe("https://cdn.example.com/showcase-045.png");
  });

  it("numeric (not lexical) compare: a 2-digit card_number beats a 3-digit one that would sort first as a string", () => {
    const card = makeCard({
      base_card_id: 1,
      name: "Numeric Compare",
      variants: [
        variant({
          variant_id: 1,
          finish: "Hyperspace",
          card_number: "9",
          front_image_url: "https://cdn.example.com/nine.png",
        }),
        variant({
          variant_id: 2,
          finish: "Showcase",
          card_number: "10",
          front_image_url: "https://cdn.example.com/ten.png",
        }),
      ],
    });
    render(
      <GalleryGrid
        cards={[card]}
        onSelectCard={vi.fn()}
        isAuthenticated={false}
        activeFinishes={new Set(["Hyperspace", "Showcase"])}
      />
    );
    const img = screen.getByRole("img") as HTMLImageElement;
    // Numerically 9 < 10, so "9" wins even though "10" < "9" lexically.
    expect(img.src).toBe("https://cdn.example.com/nine.png");
  });

  it("tie case (equal card_number): simplest wins -- first match in array order", () => {
    const card = makeCard({
      base_card_id: 1,
      name: "Tie",
      variants: [
        variant({
          variant_id: 1,
          finish: "Hyperspace",
          card_number: "045",
          front_image_url: "https://cdn.example.com/first.png",
        }),
        variant({
          variant_id: 2,
          finish: "Showcase",
          card_number: "045",
          front_image_url: "https://cdn.example.com/second.png",
        }),
      ],
    });
    render(
      <GalleryGrid
        cards={[card]}
        onSelectCard={vi.fn()}
        isAuthenticated={false}
        activeFinishes={new Set(["Hyperspace", "Showcase"])}
      />
    );
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toBe("https://cdn.example.com/first.png");
  });

  it("composition with the leader-back rule: finish-filtered leader still shows that variant's back image", () => {
    const leader = makeCard({
      base_card_id: 1,
      name: "Filtered Leader",
      type: "Leader",
      variants: [
        variant({
          variant_id: 1,
          finish: "Standard",
          front_image_url: "https://cdn.example.com/standard-front.png",
          back_image_url: "https://cdn.example.com/standard-back.png",
        }),
        variant({
          variant_id: 2,
          finish: "Hyperspace",
          front_image_url: "https://cdn.example.com/hyperspace-front.png",
          back_image_url: "https://cdn.example.com/hyperspace-back.png",
        }),
      ],
    });
    render(
      <GalleryGrid
        cards={[leader]}
        onSelectCard={vi.fn()}
        isAuthenticated={false}
        activeFinishes={new Set(["Hyperspace"])}
      />
    );
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toBe("https://cdn.example.com/hyperspace-back.png");
    expect(img.className).not.toContain("gallery-cell__img--rotated");
  });

  it("composition with the base rotation rule: finish-filtered base still rotates that variant's front image", () => {
    const base = makeCard({
      base_card_id: 1,
      name: "Filtered Base",
      type: "Base",
      variants: [
        variant({
          variant_id: 1,
          finish: "Standard",
          front_image_url: "https://cdn.example.com/standard-front.png",
        }),
        variant({
          variant_id: 2,
          finish: "Hyperspace",
          front_image_url: "https://cdn.example.com/hyperspace-front.png",
        }),
      ],
    });
    render(
      <GalleryGrid
        cards={[base]}
        onSelectCard={vi.fn()}
        isAuthenticated={false}
        activeFinishes={new Set(["Hyperspace"])}
      />
    );
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toBe("https://cdn.example.com/hyperspace-front.png");
    expect(img.className).toContain("gallery-cell__img--rotated");
  });

  it("no variant matches the active finish (shouldn't happen given the filtered-array guarantee): falls back to the Standard rule", () => {
    const card = makeCard({
      base_card_id: 1,
      name: "No Match Fallback",
      variants: [
        variant({
          variant_id: 1,
          finish: "Standard",
          front_image_url: "https://cdn.example.com/standard.png",
        }),
      ],
    });
    render(
      <GalleryGrid
        cards={[card]}
        onSelectCard={vi.fn()}
        isAuthenticated={false}
        activeFinishes={new Set(["Hyperspace"])}
      />
    );
    const img = screen.getByRole("img") as HTMLImageElement;
    expect(img.src).toBe("https://cdn.example.com/standard.png");
  });
});

describe("GalleryGrid click wiring", () => {
  // REPLACE (BL-201): the click now also reports the displayed finish --
  // null here, because no Finish filter drove the image pick.
  it("clicking a cell calls onSelectCard with the base_card_id and a null displayed finish", () => {
    const onSelectCard = vi.fn();
    const cards = [makeCard({ base_card_id: 42, name: "Clickable Card" })];
    render(<GalleryGrid cards={cards} onSelectCard={onSelectCard} isAuthenticated={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Clickable Card" }));
    expect(onSelectCard).toHaveBeenCalledWith(42, null);
  });

  // BL-201 (CREATE): a filter-driven display carries its finish to the
  // click-through, so CardsPage can open the popup on the printing the
  // collector was looking at.
  it("clicking a finish-filtered cell passes the displayed finish", () => {
    const onSelectCard = vi.fn();
    const card = makeCard({
      base_card_id: 7,
      name: "Filtered Card",
      variants: [
        variant({
          variant_id: 1,
          finish: "Standard",
          front_image_url: "https://cdn.example.com/standard.png",
        }),
        variant({
          variant_id: 2,
          finish: "Hyperspace",
          front_image_url: "https://cdn.example.com/hyperspace.png",
        }),
      ],
    });
    render(
      <GalleryGrid
        cards={[card]}
        onSelectCard={onSelectCard}
        isAuthenticated={false}
        activeFinishes={new Set(["Hyperspace"])}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Filtered Card" }));
    expect(onSelectCard).toHaveBeenCalledWith(7, "Hyperspace");
  });

  // BL-201 (CREATE): an ACTIVE filter whose fallback ran (no variant of the
  // card matches -- the keeps-function-total branch) must NOT claim its
  // display was filter-driven.
  it("a non-matching filter falls back to Standard and passes null", () => {
    const onSelectCard = vi.fn();
    const card = makeCard({
      base_card_id: 8,
      name: "Fallback Card",
      variants: [
        variant({
          variant_id: 1,
          finish: "Standard",
          front_image_url: "https://cdn.example.com/standard.png",
        }),
      ],
    });
    render(
      <GalleryGrid
        cards={[card]}
        onSelectCard={onSelectCard}
        isAuthenticated={false}
        activeFinishes={new Set(["Showcase"])}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Fallback Card" }));
    expect(onSelectCard).toHaveBeenCalledWith(8, null);
  });
});

// DISPOSITION (CREATE, mirrors CardsTable's virtualization test): proves a
// large list does not mount a cell per card -- asserts on rendered cell
// *count* (fewer than data length), not on react-virtual/jsdom-measurement
// internals.
describe("GalleryGrid virtualization (BL-73 Stage 1)", () => {
  it("renders a windowful of rows without mounting every card", () => {
    const manyCards: InventoryCard[] = Array.from({ length: 300 }, (_, i) =>
      makeCard({ base_card_id: i + 1, base_card_number: String(i + 1).padStart(3, "0") })
    );
    const { container } = render(
      <GalleryGrid cards={manyCards} onSelectCard={vi.fn()} isAuthenticated={false} />
    );

    const renderedCells = container.querySelectorAll(".gallery-cell");
    expect(renderedCells.length).toBeGreaterThan(0);
    expect(renderedCells.length).toBeLessThan(manyCards.length);
  });

  it("keeps filtering (the already-computed card list) intact -- fewer cards in means fewer cells out", () => {
    const cards = [
      makeCard({ base_card_id: 1, name: "A" }),
      makeCard({ base_card_id: 2, name: "B" }),
    ];
    const { container: fullContainer } = render(
      <GalleryGrid cards={cards} onSelectCard={vi.fn()} isAuthenticated={false} />
    );
    expect(fullContainer.querySelectorAll(".gallery-cell")).toHaveLength(2);

    const { container: narrowedContainer } = render(
      <GalleryGrid cards={[cards[0]]} onSelectCard={vi.fn()} isAuthenticated={false} />
    );
    expect(narrowedContainer.querySelectorAll(".gallery-cell")).toHaveLength(1);
  });
});

// CREATE (BL-111 F4, design handoff §4 -- Option D "Plate + hover dossier"):
// the console plate footer and its hover dossier. Semantics are playset
// completion (utils/inventory.ts's getPlaysetSize/cardOwnedTotal/
// isPlaysetComplete -- the same functions PlaysetCell.tsx uses for the
// table), deliberately NOT the configurable keep-limits system -- these
// tests exercise ownership/completeness only, never limits.ts.
function variant(overrides: Partial<InventoryVariant> = {}): InventoryVariant {
  return {
    variant_id: 1,
    variant_type: "Standard",
    finish: "Standard",
    channel: "Retail",
    source_set_code: "SOR",
    card_number: "001",
    front_image_url: "https://cdn.example.com/001.png",
    back_image_url: null,
    quantity: 0,
    ...overrides,
  };
}

describe("GalleryGrid console plate -- signed-in states", () => {
  it("0 owned: pips unfilled, total muted, plate not marked complete", () => {
    const card = makeCard({
      variants: [variant({ variant_id: 101, quantity: 0 })],
      inventory: { 101: 0 },
    });
    const { container } = render(
      <GalleryGrid cards={[card]} onSelectCard={vi.fn()} isAuthenticated={true} />
    );

    expect(container.querySelector(".gallery-plate--complete")).toBeNull();
    expect(container.querySelectorAll(".gallery-plate__pip--filled")).toHaveLength(0);
    const total = container.querySelector(".gallery-plate__total");
    expect(total?.className).toContain("gallery-plate__total--empty");
    // REPLACE (BL-222 point 5): the "/N" denominator is dropped -- the plate
    // now shows the raw owned count alone.
    expect(total?.textContent).toBe("0");
  });

  it("partial (owned < playset size): some pips filled, total present, not complete", () => {
    const card = makeCard({
      variants: [
        variant({ variant_id: 101, finish: "Standard", quantity: 2 }),
        variant({ variant_id: 102, finish: "Hyperspace", quantity: 0 }),
      ],
      inventory: { 101: 2, 102: 0 },
    });
    const { container } = render(
      <GalleryGrid cards={[card]} onSelectCard={vi.fn()} isAuthenticated={true} />
    );

    expect(container.querySelector(".gallery-plate--complete")).toBeNull();
    expect(container.querySelectorAll(".gallery-plate__pip--filled")).toHaveLength(2);
    const total = container.querySelector(".gallery-plate__total");
    expect(total?.className).not.toContain("gallery-plate__total--empty");
    expect(total?.className).not.toContain("gallery-plate__total--complete");
    // REPLACE (BL-222 point 5): denominator dropped.
    expect(total?.textContent).toBe("2");
  });

  it("complete (owned >= playset size): all pips filled green, plate + total marked complete", () => {
    const card = makeCard({
      variants: [
        variant({ variant_id: 101, finish: "Standard", quantity: 2 }),
        variant({ variant_id: 102, finish: "Hyperspace", quantity: 1 }),
      ],
      inventory: { 101: 2, 102: 1 },
    });
    const { container } = render(
      <GalleryGrid cards={[card]} onSelectCard={vi.fn()} isAuthenticated={true} />
    );

    expect(container.querySelector(".gallery-plate--complete")).not.toBeNull();
    expect(container.querySelectorAll(".gallery-plate__pip--filled")).toHaveLength(3);
    const total = container.querySelector(".gallery-plate__total");
    expect(total?.className).toContain("gallery-plate__total--complete");
    // REPLACE (BL-222 point 5): denominator dropped.
    expect(total?.textContent).toBe("3");
  });

  it("overflow (owned > playset size): pips cap at the playset size, total still shows the raw count", () => {
    const card = makeCard({
      variants: [variant({ variant_id: 101, finish: "Standard", quantity: 4 })],
      inventory: { 101: 4 },
    });
    const { container } = render(
      <GalleryGrid cards={[card]} onSelectCard={vi.fn()} isAuthenticated={true} />
    );

    expect(container.querySelectorAll(".gallery-plate__pip")).toHaveLength(3);
    expect(container.querySelectorAll(".gallery-plate__pip--filled")).toHaveLength(3);
    const total = container.querySelector(".gallery-plate__total");
    // REPLACE (BL-222 point 5): denominator dropped -- raw count only.
    expect(total?.textContent).toBe("4");
  });

  it("singleton type (Leader/Base): exactly one pip, complete at 1 owned", () => {
    const leader = makeCard({
      type: "Leader",
      variants: [variant({ variant_id: 101, quantity: 1 })],
      inventory: { 101: 1 },
    });
    const { container } = render(
      <GalleryGrid cards={[leader]} onSelectCard={vi.fn()} isAuthenticated={true} />
    );

    expect(container.querySelectorAll(".gallery-plate__pip")).toHaveLength(1);
    expect(container.querySelector(".gallery-plate--complete")).not.toBeNull();
    const total = container.querySelector(".gallery-plate__total");
    // REPLACE (BL-222 point 5): denominator dropped.
    expect(total?.textContent).toBe("1");
  });
});

describe("GalleryGrid console plate -- signed-out state", () => {
  it('shows "SIGN IN TO TRACK" instead of pips/total, and never renders a dossier even on hover', () => {
    const card = makeCard({
      variants: [variant({ variant_id: 101, quantity: 3 })],
      inventory: { 101: 3 },
    });
    render(<GalleryGrid cards={[card]} onSelectCard={vi.fn()} isAuthenticated={false} />);

    expect(screen.getByText("SIGN IN TO TRACK")).toBeTruthy();
    expect(document.querySelector(".gallery-plate__total")).toBeNull();
    expect(document.querySelector(".gallery-plate__pips")).toBeNull();

    // PORT (round 3): hover the plate itself -- the true negative test for
    // the signed-out state now that the plate is the dossier's trigger.
    fireEvent.mouseEnter(
      screen.getByRole("button", { name: "Test Unit" }).querySelector(".gallery-plate")!
    );
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("GalleryGrid hover dossier -- signed-in", () => {
  it("hidden until hovered, and hides again on mouse-leave", () => {
    const card = makeCard({
      variants: [variant({ variant_id: 101, quantity: 1 })],
      inventory: { 101: 1 },
    });
    render(<GalleryGrid cards={[card]} onSelectCard={vi.fn()} isAuthenticated={true} />);
    // PORT (owner dev review 2026-07-26 round 3): the dossier's hover target
    // is the inventory PLATE, not the whole tile (same scoping the table's
    // Playset chip got in round 2).
    const cell = screen.getByRole("button", { name: "Test Unit" });
    const plate = cell.querySelector(".gallery-plate")!;

    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.mouseEnter(plate);
    expect(screen.getByRole("tooltip")).toBeTruthy();

    fireEvent.mouseLeave(plate);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("empty state: 0 owned shows OWNED 0/3 and NO COPIES OWNED, no finish rows", () => {
    const card = makeCard({
      variants: [
        variant({ variant_id: 101, finish: "Standard", quantity: 0 }),
        variant({ variant_id: 102, finish: "Hyperspace", quantity: 0 }),
      ],
      inventory: { 101: 0, 102: 0 },
    });
    render(<GalleryGrid cards={[card]} onSelectCard={vi.fn()} isAuthenticated={true} />);
    fireEvent.mouseEnter(
      screen.getByRole("button", { name: "Test Unit" }).querySelector(".gallery-plate")!
    );

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("OWNED");
    // REPLACE (BL-222 point 5): denominator dropped from the dossier's OWNED
    // row too -- "0", not "0/3".
    expect(tooltip.querySelector(".gallery-plate__total")?.textContent).toBe("0");
    expect(screen.getByText("NO COPIES OWNED")).toBeTruthy();
    expect(tooltip.querySelectorAll(".gallery-dossier__row")).toHaveLength(0);
  });

  it("one row per owned finish, with the full finish name and its own count -- unowned finishes are omitted", () => {
    const card = makeCard({
      variants: [
        variant({ variant_id: 101, finish: "Standard", quantity: 2 }),
        variant({ variant_id: 102, finish: "Hyperspace Foil", quantity: 1 }),
        variant({ variant_id: 103, finish: "Showcase", quantity: 0 }),
      ],
      inventory: { 101: 2, 102: 1, 103: 0 },
    });
    render(<GalleryGrid cards={[card]} onSelectCard={vi.fn()} isAuthenticated={true} />);
    fireEvent.mouseEnter(
      screen.getByRole("button", { name: "Test Unit" }).querySelector(".gallery-plate")!
    );

    const tooltip = screen.getByRole("tooltip");
    const rows = Array.from(tooltip.querySelectorAll(".gallery-dossier__row"));
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Standard");
    expect(rows[0].textContent).toContain("2");
    expect(rows[1].textContent).toContain("Hyperspace Foil");
    expect(rows[1].textContent).toContain("1");
    expect(tooltip.textContent).not.toContain("Showcase");
  });

  it("falls back to variant_type for a row's label when finish is null (same fallback the plate/image logic uses elsewhere)", () => {
    const card = makeCard({
      variants: [
        variant({
          variant_id: 101,
          variant_type: "Foil",
          finish: null as unknown as string,
          quantity: 1,
        }),
      ],
      inventory: { 101: 1 },
    });
    render(<GalleryGrid cards={[card]} onSelectCard={vi.fn()} isAuthenticated={true} />);
    fireEvent.mouseEnter(
      screen.getByRole("button", { name: "Test Unit" }).querySelector(".gallery-plate")!
    );

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("Foil");
  });
});

// CREATE (BL-222, Issue #134): the plate pips become scope-aware (the same
// BL-195 scopedOwnedCount/scopedPlaysetComplete utilities PlaysetCell's
// table pips use), and the plate's complete/incomplete visual keys off
// PIPS-STATE (scoped completion while scoped, overall completion otherwise)
// -- NOT off overall completion unconditionally. PlateTotal (the right-side
// number) is proven to stay on the OVERALL value regardless of scope, per
// BL-222 point 5.
describe("GalleryGrid scoped pips (BL-222, CREATE)", () => {
  it("fill from the scoped owned count, not the total", () => {
    const card = makeCard({
      variants: [
        variant({ variant_id: 101, finish: "Standard", quantity: 2 }),
        variant({ variant_id: 102, finish: "Hyperspace", quantity: 1 }),
      ],
      inventory: { 101: 2, 102: 1 },
    });
    const { container } = render(
      <GalleryGrid
        cards={[card]}
        onSelectCard={vi.fn()}
        isAuthenticated={true}
        scope="Hyperspace"
      />
    );

    // Scoped owned count (Hyperspace only) is 1, not the total of 3.
    expect(container.querySelectorAll(".gallery-plate__pip--filled")).toHaveLength(1);
  });

  it("filled scoped pips carry the amber --scoped modifier while incomplete", () => {
    const card = makeCard({
      variants: [
        variant({ variant_id: 101, finish: "Standard", quantity: 2 }),
        variant({ variant_id: 102, finish: "Hyperspace", quantity: 1 }),
      ],
      inventory: { 101: 2, 102: 1 },
    });
    const { container } = render(
      <GalleryGrid
        cards={[card]}
        onSelectCard={vi.fn()}
        isAuthenticated={true}
        scope="Hyperspace"
      />
    );

    expect(
      container.querySelectorAll(".gallery-plate__pip--filled.gallery-plate__pip--scoped")
    ).toHaveLength(1);
  });

  it("unscoped rendering never carries the --scoped pip modifier (regression guard)", () => {
    const card = makeCard({
      variants: [variant({ variant_id: 101, finish: "Standard", quantity: 2 })],
      inventory: { 101: 2 },
    });
    const { container } = render(
      <GalleryGrid cards={[card]} onSelectCard={vi.fn()} isAuthenticated={true} />
    );

    expect(container.querySelector(".gallery-plate__pip--scoped")).toBeNull();
  });
});

describe("GalleryGrid plate complete-visual keys off pips-state (BL-222, CREATE)", () => {
  it("scoped: the ring is NOT marked complete for an overall-complete card scoped to an unowned finish, but PlateTotal still reads complete-colored (overall, unaffected by scope)", () => {
    const card = makeCard({
      type: "Unit",
      variants: [
        // Overall-complete via Standard alone (3/3).
        variant({ variant_id: 101, finish: "Standard", quantity: 3 }),
        // The scoped-to finish -- zero owned, scoped-incomplete.
        variant({ variant_id: 102, finish: "Hyperspace", quantity: 0 }),
      ],
      inventory: { 101: 3, 102: 0 },
    });
    const { container } = render(
      <GalleryGrid
        cards={[card]}
        onSelectCard={vi.fn()}
        isAuthenticated={true}
        scope="Hyperspace"
      />
    );

    // Pips-state (scoped) is incomplete -- no green ring/amber fill.
    expect(container.querySelector(".gallery-plate--complete")).toBeNull();
    // PlateTotal is the OVERALL value -- still complete-colored, and still
    // just the raw count (no denominator, BL-222 point 5).
    const total = container.querySelector(".gallery-plate__total");
    expect(total?.className).toContain("gallery-plate__total--complete");
    expect(total?.textContent).toBe("3");
  });

  it("scoped: the ring IS marked complete once the scoped finish alone reaches the playset size", () => {
    const card = makeCard({
      type: "Unit",
      variants: [
        variant({ variant_id: 101, finish: "Standard", quantity: 0 }),
        variant({ variant_id: 102, finish: "Hyperspace", quantity: 3 }),
      ],
      inventory: { 101: 0, 102: 3 },
    });
    const { container } = render(
      <GalleryGrid
        cards={[card]}
        onSelectCard={vi.fn()}
        isAuthenticated={true}
        scope="Hyperspace"
      />
    );

    expect(container.querySelector(".gallery-plate--complete")).not.toBeNull();
  });

  it("unscoped: the ring keys off overall completion exactly as before (regression guard)", () => {
    const card = makeCard({
      type: "Unit",
      variants: [variant({ variant_id: 101, finish: "Standard", quantity: 3 })],
      inventory: { 101: 3 },
    });
    const { container } = render(
      <GalleryGrid cards={[card]} onSelectCard={vi.fn()} isAuthenticated={true} />
    );

    expect(container.querySelector(".gallery-plate--complete")).not.toBeNull();
  });
});
