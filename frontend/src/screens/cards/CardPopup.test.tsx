import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CardPopup } from "./CardPopup";
import type { CardPopupNavigation } from "./CardPopup";
import { LimitsProvider } from "../../context/LimitsContext";
import type { BaseCardDetail, VariantDetail } from "../../api/baseCards";
import type { CapMode, LimitCell } from "../../api/settingsLimits";

// ─── BL-111 F5 disposition summary ───────────────────────────────────────
// This file replaces CardDetailPopup.test.tsx (398 lines) + CardInventoryPopup
// .test.tsx (750 lines) -- see the PR body for the full describe-block-level
// disposition log (PORT / REPLACE / RETIRE, with rationale for each). Short
// version: the enforcement math (hard-cap disable, soft-mode allow, no-limit
// ceiling, singleton vs. standard categories, optimistic update/rollback,
// EmailNotVerifiedError mapping) is PORTed verbatim, re-expressed against a
// single selected-printing stepper instead of one stepper per row (the design
// changed from "every variant editable at once" to "pick a printing, then
// edit that one" -- README §5's "selected-panel"). Anything asserting the
// two-popup split or the anonymous inventory-cell sign-in bounce is REPLACEd
// -- the unified popup opens for anonymous users too, its plate itself being
// the nudge (CardsPage.test.tsx covers the routing change at the page level).

// ─── BL-140 design-conformance pass disposition summary ──────────────────
// (2026-07-21, aligning the original BL-140 build against Jeremy's saved
// DesignSync defaults, extracted to disk after that build shipped without
// reaching them.) The "CardPopup price block (BL-140)" describe block this
// file used to have is RETIREd outright -- pricePlacement=rail-rows is the
// saved default, not the separate grouped price block/Market-Cheapest
// toggle that block asserted, and that whole component (PriceBlock,
// cheapestPricedVariant) no longer exists. Its behaviors' successors:
//   - "quiet unpriced state" / "shows market prominent, low subordinate" /
//     "Market mode follows selection" -> REPLACEd by the new "rail pricing"
//     describe block below (same underlying data, now asserted against
//     rail rows' price-right cells instead of a price-block's figures).
//   - "Cheapest mode shows min(low) printing" / "disables Cheapest when no
//     low price" -> RETIREd, no reason to port: the saved defaults' rail
//     toggle is Market/Low (a price-KIND switch per printing), not a
//     cross-printing cheapest-aggregate concept. There's no successor
//     concept in this popup at all after this pass (BL-141 scope, if ever).
//   - "clicking View price history opens the panel" / "Escape routing" ->
//     REPLACEd by the new "history embed" describe block below (the
//     trigger is now the compact panel's ⤢, not a price-block button; the
//     panel embeds instead of overlaying, but the two-stage Escape routing
//     survives unchanged in spirit).

// BL-161 (popup part, Definition_CosmeticsBatch_2026-07-26.md §1): the info
// column's plain-text rarity value is PORTed onto the shared RarityBadge
// component (already built for the Cards table's Rarity column, same
// slice) instead of the bare getRarityLabel() string -- behavior (which
// rarity renders for which detail) is unchanged, only the assertion target
// moves from the retired `.cp-info__rarity` text span to RarityBadge's own
// `.rarity-badge__icon` / `.rarity-badge__label` elements (see "renders the
// info fields" below).

// BL-111 dev-review wave 1 fix 2: jsdom has no `window.AnimationEvent`,
// which trips react-dom's OWN vendor-prefix feature detection
// (getVendorPrefixedEventName) into registering its onAnimationEnd
// delegated listener against the webkit-prefixed DOM event name instead of
// the real "animationend" -- a jsdom/React quirk (confirmed against this
// project's exact React 19 + jsdom versions), not a component bug. Real
// browsers fire plain "animationend"; dispatching that name here (e.g. via
// testing-library's own fireEvent.animationEnd) silently no-ops. This fires
// the name React actually listens for under jsdom.
function fireAnimationEnd(el: Element) {
  fireEvent(el, new Event("webkitAnimationEnd", { bubbles: true, cancelable: false }));
}

const { getBaseCardDetail, getPriceHistory } = vi.hoisted(() => ({
  getBaseCardDetail: vi.fn(),
  // BL-140: PriceHistoryPanel.tsx imports getPriceHistory from this same
  // module -- must be mocked here too or it's `undefined`. BL-140
  // design-conformance pass: the COMPACT history panel is now always
  // mounted (embedded under the printings rail) once a printing is
  // selected, not just when a "View price history" button is clicked --
  // so every single test in this file that renders a resolved CardPopup
  // now triggers this fetch, not just the history-specific ones below.
  getPriceHistory: vi.fn(),
}));
vi.mock("../../api/baseCards", () => ({ getBaseCardDetail, getPriceHistory }));

// File-level default (runs before every describe block's own beforeEach,
// which only clears call history -- vi.clearAllMocks() does not remove a
// mockResolvedValue's implementation). Individual tests below override this
// with their own mockResolvedValue/mockRejectedValue where the history
// fetch itself is under test.
beforeEach(() => {
  getPriceHistory.mockResolvedValue({ variant_id: 1, range: "90d", series: [] });
});

const { getLimits, putLimits } = vi.hoisted(() => ({
  getLimits: vi.fn(),
  putLimits: vi.fn(),
}));
vi.mock("../../api/settingsLimits", () => ({ getLimits, putLimits }));

const { incrementCard, decrementCard, EmailNotVerifiedError } = vi.hoisted(() => {
  class EmailNotVerifiedError extends Error {}
  return {
    incrementCard: vi.fn(),
    decrementCard: vi.fn(),
    EmailNotVerifiedError,
  };
});
vi.mock("../../api/inventory", () => ({ incrementCard, decrementCard, EmailNotVerifiedError }));

const SET_NAMES: Record<string, string> = {
  SOR: "Spark of Rebellion",
  SHD: "Shadows of the Galaxy",
  ASH: "Ashes of the Resistance",
  SORP: "SOR Weekly Play",
};

function makeVariant(overrides: Partial<VariantDetail> = {}): VariantDetail {
  return {
    variant_id: 1,
    variant_type: "Standard",
    finish: "Standard",
    channel: "Retail",
    stamped: false,
    source_set_code: "SOR",
    source_set_name: "Spark of Rebellion",
    card_number: "12",
    front_image_url: "front-1.png",
    back_image_url: null,
    stamp_group: null,
    quantity: 0,
    ...overrides,
  };
}

function makeDetail(overrides: Partial<BaseCardDetail> = {}): BaseCardDetail {
  return {
    id: 1,
    set_code: "SOR",
    set_name: "Spark of Rebellion",
    base_card_number: "12",
    name: "IG-88",
    subtitle: "Cold-Blooded Killer",
    type: "Unit",
    type2: null,
    double_sided: false,
    rarity: "R",
    cost: 3,
    power: 4,
    hp: 4,
    arena: "Ground",
    is_unique: false,
    front_text: null,
    back_text: null,
    epic_action: null,
    artist: null,
    is_token: false,
    aspects: [],
    keywords: [],
    traits: [],
    variants: [makeVariant({ variant_id: 1 })],
    ...overrides,
  };
}

async function renderPopup(
  detail: BaseCardDetail,
  opts: {
    isAuthenticated?: boolean;
    onClose?: () => void;
    onChanged?: () => void;
    navigation?: CardPopupNavigation;
  } = {}
) {
  getBaseCardDetail.mockResolvedValue(detail);
  const onClose = opts.onClose ?? vi.fn();
  const onChanged = opts.onChanged ?? vi.fn();
  await act(async () => {
    render(
      <CardPopup
        baseCardId={detail.id}
        isAuthenticated={opts.isAuthenticated ?? true}
        setNameByCode={SET_NAMES}
        onClose={onClose}
        onChanged={onChanged}
        navigation={opts.navigation}
      />
    );
  });
  await waitFor(() => screen.getByRole("dialog"));
  return { onClose, onChanged };
}

describe("CardPopup basics (PORT from CardDetailPopup.test.tsx)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state before data resolves", async () => {
    let resolveFn: (v: BaseCardDetail) => void = () => {};
    getBaseCardDetail.mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      })
    );
    render(
      <CardPopup
        baseCardId={1}
        isAuthenticated={true}
        setNameByCode={SET_NAMES}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText(/loading/i)).toBeTruthy();
    await act(async () => {
      resolveFn(makeDetail());
    });
  });

  it("shows an error state when the fetch fails", async () => {
    getBaseCardDetail.mockRejectedValue(new Error("boom"));
    await act(async () => {
      render(
        <CardPopup
          baseCardId={1}
          isAuthenticated={true}
          setNameByCode={SET_NAMES}
          onClose={vi.fn()}
        />
      );
    });
    await waitFor(() => expect(screen.getByText("boom")).toBeTruthy());
  });

  it("calls onClose when Escape is pressed", async () => {
    const { onClose } = await renderPopup(makeDetail());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when the backdrop is clicked", async () => {
    const { onClose } = await renderPopup(makeDetail());
    const overlay = document.querySelector(".cp-overlay")!;
    fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose on the × click", async () => {
    const { onClose } = await renderPopup(makeDetail());
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("defaults the initial selection to the Standard representative even when it's not first in array order", async () => {
    await renderPopup(
      makeDetail({
        variants: [
          makeVariant({
            variant_id: 1,
            finish: "Standard Foil",
            card_number: "13",
            front_image_url: "front-foil.png",
          }),
          makeVariant({
            variant_id: 2,
            finish: "Standard",
            card_number: "12",
            front_image_url: "front-standard.png",
          }),
        ],
      })
    );
    const img = document.querySelector(".cp-image") as HTMLImageElement;
    expect(img.src).toContain("front-standard.png");
    const active = document.querySelector(".cp-rail__item--active");
    expect(active?.getAttribute("title")).toBe("Standard – #12 – SOR");
  });

  it("falls back to the first variant in array order when none is Standard", async () => {
    await renderPopup(
      makeDetail({
        variants: [
          makeVariant({
            variant_id: 1,
            finish: "Standard Foil",
            card_number: "13",
            front_image_url: "front-foil.png",
          }),
          makeVariant({
            variant_id: 2,
            finish: "Hyperspace",
            card_number: "14",
            front_image_url: "front-hyperspace.png",
          }),
        ],
      })
    );
    const active = document.querySelector(".cp-rail__item--active");
    expect(active?.getAttribute("title")).toBe("Standard Foil – #13 – SOR");
  });

  it("clicking a printing selects it and updates the image", async () => {
    await renderPopup(
      makeDetail({
        variants: [
          makeVariant({
            variant_id: 1,
            finish: "Standard",
            card_number: "12",
            front_image_url: "front-standard.png",
          }),
          makeVariant({
            variant_id: 2,
            finish: "Standard Foil",
            card_number: "13",
            front_image_url: "front-foil.png",
          }),
        ],
      })
    );

    fireEvent.click(screen.getByTitle("Standard Foil – #13 – SOR"));

    const img = document.querySelector(".cp-image") as HTMLImageElement;
    expect(img.src).toContain("front-foil.png");
    expect(document.querySelector(".cp-rail__item--active")?.getAttribute("title")).toBe(
      "Standard Foil – #13 – SOR"
    );
  });

  it("groups printings by set -- the card's own set is labeled Base set, others by full set name", async () => {
    await renderPopup(
      makeDetail({
        set_code: "SOR",
        variants: [
          makeVariant({ variant_id: 1, source_set_code: "SOR", card_number: "12" }),
          makeVariant({
            variant_id: 2,
            source_set_code: "SORP",
            variant_type: "Weekly Play",
            finish: null,
            channel: "Weekly Play",
            card_number: "1",
          }),
        ],
      })
    );
    const groupLabels = Array.from(document.querySelectorAll(".cp-rail__group-label")).map(
      (el) => el.textContent
    );
    expect(groupLabels).toEqual(["Base set", "SOR Weekly Play"]);
  });

  // BL-147 dev-review fix (BL-140 review finding, CREATE): printing rows must
  // NEVER ellipsize the finish name -- the old .cp-rail__item-finish rule
  // (overflow:hidden/text-overflow:ellipsis) is gone, and .cp-body's rail
  // column was widened (222 -> 300px) to fit the longest real finish names
  // single-line at full font size. jsdom has no layout engine so this can't
  // assert the CSS actually avoids visual clipping, but it does guard the
  // one thing a regression could plausibly reintroduce on the JS side: the
  // full, untruncated finish string rendering in the DOM, for each of the
  // three longest known values, at once (many printings, matching how the
  // rail actually renders in production for a heavily-reprinted card).
  it("renders the full finish name for every longest-known variant, never truncated", async () => {
    await renderPopup(
      makeDetail({
        variants: [
          makeVariant({ variant_id: 1, finish: "Serialized Prestige", card_number: "1" }),
          makeVariant({ variant_id: 2, finish: "Hyperspace Foil", card_number: "2" }),
          makeVariant({ variant_id: 3, finish: "Event Exclusive", card_number: "3" }),
        ],
      })
    );
    const finishEls = document.querySelectorAll(".cp-rail__item-finish");
    const finishTexts = Array.from(finishEls).map((el) => el.textContent);
    expect(finishTexts).toEqual(["Serialized Prestige", "Hyperspace Foil", "Event Exclusive"]);
  });

  // DISPOSITION (CREATE, BL-129 R1): the rail heading's label was "Printings"
  // -- renamed to "Variants" (owner-decided; the filter/Add Cards "Finish"
  // labels are deliberately untouched). No prior test asserted this text.
  it('labels the printings rail "Variants · <count>"', async () => {
    await renderPopup(
      makeDetail({
        variants: [
          makeVariant({ variant_id: 1, card_number: "1" }),
          makeVariant({ variant_id: 2, card_number: "2" }),
        ],
      })
    );
    expect(document.querySelector(".cp-rail__heading")?.textContent).toBe("Variants · 2");
  });

  it("front/back toggle appears only when both images exist", async () => {
    await renderPopup(
      makeDetail({ variants: [makeVariant({ variant_id: 1, back_image_url: "back-1.png" })] })
    );
    expect(screen.getByRole("button", { name: /show back/i })).toBeTruthy();
  });

  it("front/back toggle is absent when there is no back image", async () => {
    await renderPopup(
      makeDetail({ variants: [makeVariant({ variant_id: 1, back_image_url: null })] })
    );
    expect(screen.queryByRole("button", { name: /show back/i })).toBeNull();
  });

  // BL-111 dev-review wave 1 fix 2 (DISPOSITION: REPLACE -- the flip is now
  // a deterministic two-phase animation, not a synchronous swap-then-pulse,
  // so the old single-click-then-assert shape no longer matches the
  // implementation). Asserts the full sequence: click starts the "out" phase
  // with the OLD image still showing and the label not yet flipped; the
  // "out" phase's animationend is where the data swap actually happens
  // (mid-sequence, matching CardPopup.tsx's handleFlipAnimationEnd); the
  // "in" phase's animationend settles the flip back to idle with no further
  // visible change.
  it("toggling front/back plays the flip out-phase on the old image, swaps mid-sequence, then plays the in-phase on the new image", async () => {
    await renderPopup(
      makeDetail({
        variants: [
          makeVariant({
            variant_id: 1,
            front_image_url: "front-1.png",
            back_image_url: "back-1.png",
          }),
        ],
      })
    );
    const toggle = screen.getByRole("button", { name: /show back/i });
    const flipEl = document.querySelector(".cp-image-flip") as HTMLElement;
    const img = document.querySelector(".cp-image") as HTMLImageElement;

    fireEvent.click(toggle);

    // Mid-flight (the "out" phase animating the OLD side away): neither the
    // image nor the button label has changed yet, and re-clicking is a
    // no-op -- the phase machine ignores clicks while a flip is in flight.
    expect(flipEl.className).toContain("cp-image-flip--out");
    expect(img.src).toContain("front-1.png");
    expect(screen.getByRole("button", { name: /show back/i })).toBeTruthy();
    expect(toggle).toBeDisabled();

    // The "out" phase's animationend is the deterministic swap point --
    // this is the actual assertion that the data swap happens mid-sequence,
    // not at click time and not at the very end.
    fireAnimationEnd(flipEl);
    expect(flipEl.className).toContain("cp-image-flip--in");
    expect(img.src).toContain("back-1.png");
    expect(screen.getByRole("button", { name: /show front/i })).toBeTruthy();

    // The "in" phase's animationend just settles the machine back to idle --
    // no further change to image or label.
    fireAnimationEnd(flipEl);
    expect(flipEl.className).not.toContain("cp-image-flip--in");
    expect(flipEl.className).not.toContain("cp-image-flip--out");
    expect(img.src).toContain("back-1.png");
    expect(screen.getByRole("button", { name: /show front/i })).toBeTruthy();
  });

  it("renders the info fields: aspects, typeline, rarity, set, card number, artist", async () => {
    await renderPopup(
      makeDetail({
        aspects: ["Villainy", "Vigilance"],
        type: "Unit",
        type2: "Trooper",
        rarity: "R",
        artist: "Johnny Morrow",
      })
    );
    // PORT (owner dev review 2026-07-26 round 4): aspect icons opt into the
    // styled AspectIcon tooltip here, which replaces the native title --
    // assert via alt text + the tooltip bubble instead of getByTitle.
    // PORT (BL-173 review round 4, 2026-07-27): type + aspects moved INTO
    // the set row's right-aligned .cp-info__typeaspects group (the
    // standalone .cp-info__aspects row is retired) -- selector updated,
    // same two-bubble assertion.
    expect(screen.getByAltText("Vigilance")).toBeTruthy();
    expect(screen.getByAltText("Villainy")).toBeTruthy();
    expect(document.querySelectorAll(".cp-info__typeaspects .aspect-tip__bubble")).toHaveLength(2);
    expect(screen.getByText("Unit · Trooper")).toBeTruthy();
    // Rarity/set-name/card-number/qty labels also appear in the printings
    // rail's compact rows (finish + card number, and -- signed-in -- a qty
    // badge), so these are scoped to the info column's own elements rather
    // than a global getByText to avoid ambiguous multi-match failures.
    // BL-161: rarity is the shared RarityBadge. PORT (owner dev review
    // 2026-07-26 round 2): the SYMBOL moved out of the meta line to a large
    // icon at the set-row level (left of the two-line text stack); the
    // colored label stays inline in the meta line beside the card number.
    const rarityIcon = document.querySelector(
      ".cp-info__set-row > .rarity-badge .rarity-badge__icon"
    ) as HTMLImageElement;
    expect(rarityIcon).toBeTruthy();
    expect(rarityIcon.src).toContain("rare");
    expect(document.querySelector(".cp-info__meta .rarity-badge__label")?.textContent).toBe("Rare");
    expect(document.querySelector(".cp-info__set-name")?.textContent).toBe("Base set");
    expect(document.querySelector(".cp-info__cardnum")?.textContent).toBe("#12");
    expect(screen.getByText("Artist — Johnny Morrow")).toBeTruthy();
  });

  // BL-161 (popup part): dedicated coverage for the symbol + colored-label
  // treatment itself (RarityBadge's contract, RarityBadge.test.tsx covers
  // every rarity/size/fallback case exhaustively) -- this test just proves
  // CardPopup wires a real catalog rarity through to the right color class
  // and default 20px icon, for a rarity other than the one the info-fields
  // test above already exercises.
  // REPLACE (owner dev review 2026-07-26 round 2): the plate symbol is the
  // 34px iconOnly badge at the set-row level; the meta line's labelOnly
  // badge renders NO icon of its own.
  it("colors the rarity label per rarity (Legendary); 34px plate symbol, icon-free meta line", async () => {
    await renderPopup(makeDetail({ rarity: "L" }));
    const rarityIcon = document.querySelector(
      ".cp-info__set-row > .rarity-badge .rarity-badge__icon"
    ) as HTMLImageElement;
    expect(rarityIcon).toBeTruthy();
    expect(rarityIcon.src).toContain("legendary");
    expect(rarityIcon).toHaveAttribute("width", "34");
    expect(rarityIcon).toHaveAttribute("height", "34");
    expect(document.querySelector(".cp-info__meta .rarity-badge__icon")).toBeNull();
    const labelEl = document.querySelector(".cp-info__meta .rarity-badge__label")!;
    expect(labelEl.textContent).toBe("Legendary");
    expect(labelEl.className).toContain("rarity-badge__label--legendary");
  });

  it("shows the non-base set's full long name (not the base set) for a non-base selection", async () => {
    await renderPopup(
      makeDetail({
        set_code: "SOR",
        variants: [
          makeVariant({ variant_id: 1, source_set_code: "SOR", card_number: "12" }),
          makeVariant({
            variant_id: 2,
            source_set_code: "SHD",
            card_number: "5",
            finish: "Standard",
          }),
        ],
      })
    );
    fireEvent.click(screen.getByTitle("Standard – #5 – SHD"));
    // Scoped to the info column: the rail's OWN "Base set" group label for
    // the other (unselected) SOR printing legitimately stays on screen, so
    // asserting a global absence of "Base set" text would be wrong here.
    expect(document.querySelector(".cp-info__set-name")?.textContent).toBe("Shadows of the Galaxy");
  });

  // Design handoff §5: keywords/traits/arena labels are hidden entirely (not
  // an em-dash placeholder) when the card has no value for them -- a
  // deliberate REPLACE of CardDetailPopup's old InfoField, which always
  // rendered every field with a "—" fallback.
  it("hides the keywords/traits/arena rows entirely when empty (REPLACE: no em-dash fallback)", async () => {
    await renderPopup(makeDetail({ keywords: [], traits: [], arena: null }));
    expect(document.querySelector(".cp-facts")?.children.length).toBe(0);
  });

  it("shows keywords/traits/arena rows with their labels when present", async () => {
    await renderPopup(
      makeDetail({ keywords: ["Restore"], traits: ["Bounty Hunter"], arena: "Ground" })
    );
    expect(screen.getByText("KEYWORDS")).toBeTruthy();
    expect(screen.getByText("Restore")).toBeTruthy();
    expect(screen.getByText("TRAITS")).toBeTruthy();
    expect(screen.getByText("Bounty Hunter")).toBeTruthy();
    expect(screen.getByText("ARENA")).toBeTruthy();
    expect(screen.getByText("Ground")).toBeTruthy();
  });

  it("shows Front/Back section headers with a divider for double-sided cards", async () => {
    await renderPopup(
      makeDetail({
        type: "Leader",
        type2: "Trooper",
        double_sided: true,
        front_text: "Front text.",
        back_text: "Back side text.",
      })
    );
    expect(document.querySelector(".cp-text__back")).toBeTruthy();
    const headers = Array.from(document.querySelectorAll(".cp-text__header")).map(
      (el) => el.textContent
    );
    expect(headers).toEqual(["Leader", "Trooper"]);
  });

  it("renders rules text with no Front/Back cue for single-sided cards", async () => {
    await renderPopup(
      makeDetail({ double_sided: false, back_text: null, front_text: "Action [Exhaust]: draw." })
    );
    expect(document.querySelector(".cp-text__back")).toBeNull();
    expect(document.querySelector(".cp-text__header")).toBeNull();
    expect(screen.getByText(/Action \[Exhaust\]/)).toBeTruthy();
  });

  it("renders a srcset when the API returns derived renditions (BL-76 Phase 3)", async () => {
    await renderPopup(
      makeDetail({
        variants: [
          makeVariant({
            variant_id: 1,
            front_image_url: "https://cdn.example.com/front.png",
            front_images: {
              original: "/images/cards/front.png",
              w640: "/images/cards/front_640.webp",
              w320: "/images/cards/front_320.webp",
            },
          }),
        ],
      })
    );
    const img = document.querySelector(".cp-image") as HTMLImageElement;
    expect(img.srcset).toContain("front_640.webp");
    expect(img.srcset).toContain("/images/cards/front.png");
  });

  it("falls back to the plain hotlink (no srcset) when renditions are absent", async () => {
    await renderPopup(makeDetail());
    const img = document.querySelector(".cp-image") as HTMLImageElement;
    expect(img.src).toContain("front-1.png");
    expect(img.srcset).toBe("");
  });

  it("swaps a failing image to the stored CDN URL on error (one-shot, BL-76 follow-up)", async () => {
    await renderPopup(
      makeDetail({
        variants: [
          makeVariant({
            variant_id: 1,
            front_image_url: "https://cdn.example.com/front.png",
            front_images: {
              original: "/images/cards/front.png",
              w640: "/images/cards/front_640.webp",
              w320: "/images/cards/front_320.webp",
            },
          }),
        ],
      })
    );
    const img = document.querySelector(".cp-image") as HTMLImageElement;
    fireEvent.error(img);
    expect(img.getAttribute("src")).toBe("https://cdn.example.com/front.png");
    expect(img.getAttribute("srcset")).toBeNull();
    fireEvent.error(img);
    expect(img.getAttribute("src")).toBe("https://cdn.example.com/front.png");
  });
});

// DISPOSITION (CREATE, BL-132 J2): a null stat now renders neither its badge
// nor its label -- an orphaned "COST" caption with nothing above it would
// read as broken, so the two are suppressed together. If the card has none
// of the three stats the whole .cp-stats strip disappears rather than
// leaving an empty shell. Zero is a real value and still renders.
describe("CardPopup absent-stat badge suppression (BL-132 J2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders only the COST item when power/hp are null (e.g. an Event)", async () => {
    await renderPopup(makeDetail({ type: "Event", type2: null, cost: 2, power: null, hp: null }));
    const items = document.querySelectorAll(".cp-stats__item");
    expect(items).toHaveLength(1);
    expect(screen.getByText("COST")).toBeTruthy();
    expect(screen.queryByText("POWER")).toBeNull();
    expect(screen.queryByText("HP")).toBeNull();
    expect(document.querySelector('[data-testid="stat-badge-cost"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="stat-badge-power"]')).toBeNull();
    expect(document.querySelector('[data-testid="stat-badge-hp"]')).toBeNull();
  });

  it("renders no .cp-stats strip at all when cost/power/hp are all null", async () => {
    await renderPopup(makeDetail({ cost: null, power: null, hp: null }));
    expect(document.querySelector(".cp-stats")).toBeNull();
  });

  it("still renders the cost badge when cost is 0 (a real value, not absent)", async () => {
    await renderPopup(makeDetail({ cost: 0, power: null, hp: null }));
    const badge = document.querySelector('[data-testid="stat-badge-cost"]');
    expect(badge).not.toBeNull();
    expect(badge).toHaveAttribute("aria-label", "Cost 0");
  });
});

// DISPOSITION (CREATE, BL-132 J3): structural coverage for the leader flip
// height morph -- jsdom has no layout engine, so this can't observe real
// pixel geometry or the CSS transition itself, only the computed VALUES that
// feed the inline `style={{ height }}` (imageWrapWidth from a forced resize,
// frontAspect/backAspect from simulated <img> onLoad events). The existing
// "toggling front/back plays the flip..." test above already covers the
// phase machine (out -> swap -> in) unmodified by J3; this test covers the
// height math layered on top of it. Back-aspect capture is simulated via the
// SAME visible <img> element's onLoad AFTER the mid-flip src swap (not the
// separate preload-effect `new Image()`, which jsdom never fires onload
// for) -- see the inline comments below for why that's the reachable path.
describe("CardPopup leader flip height morph (BL-132 J3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets an explicit inline height from the measured wrap width + loaded front aspect, then morphs it to the back image's aspect across the flip", async () => {
    await renderPopup(
      makeDetail({
        variants: [
          makeVariant({
            variant_id: 1,
            front_image_url: "front-1.png",
            back_image_url: "back-1.png",
          }),
        ],
      })
    );

    const wrap = document.querySelector(".cp-image-wrap") as HTMLElement;
    const flipEl = document.querySelector(".cp-image-flip") as HTMLElement;
    const img = document.querySelector(".cp-image") as HTMLImageElement;

    // No layout yet (jsdom's clientWidth is always 0, and neither aspect has
    // loaded) -- no inline height, the pre-J3 auto-height fallback.
    expect(flipEl.style.height).toBe("");

    // Front image loads portrait (300x418) -- captured via the <img>'s own
    // onLoad (handleImageLoad in CardPopup.tsx).
    Object.defineProperty(img, "naturalWidth", { value: 300, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 418, configurable: true });
    fireEvent.load(img);

    // The wrap measures 340px wide. jsdom never reports a real clientWidth,
    // so this forces the measuring effect's resize listener (CardPopup.tsx)
    // to re-read it rather than waiting on the mount-time measurement, which
    // ran before this defineProperty and saw 0.
    Object.defineProperty(wrap, "clientWidth", { value: 340, configurable: true });
    fireEvent(window, new Event("resize"));

    // height = round(340 / (300/418)) = 474.
    expect(flipEl.style.height).toBe("474px");

    const toggle = screen.getByRole("button", { name: /show back/i });
    fireEvent.click(toggle);

    // Mid-flight "out" phase: the morph's target flips to the back side the
    // instant the flip starts (targetShowsBack, CardPopup.tsx), but backAspect
    // isn't known yet -- no inline height until it is.
    expect(flipEl.className).toContain("cp-image-flip--out");
    expect(flipEl.style.height).toBe("");

    // The "out" phase's animationend is the deterministic swap point
    // (handleFlipAnimationEnd) -- `src` now points at the back image, and
    // the SAME <img> element's onLoad fires again for it (this is the only
    // onLoad path reachable from a test: the preload effect's own `new
    // Image()` is internal to the component with jsdom never firing its
    // onload). Simulate the back side loading landscape (800x560).
    fireAnimationEnd(flipEl);
    Object.defineProperty(img, "naturalWidth", { value: 800, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 560, configurable: true });
    fireEvent.load(img);

    // height = round(340 / (800/560)) = 238 -- morphed to the landscape back
    // side's aspect, distinct from the portrait front height above. Proves
    // the height target tracks the flip rather than staying pinned to the
    // side that was visible when the flip started.
    expect(flipEl.style.height).toBe("238px");
  });
});

// ─── Signed-out plate (REPLACE: the popup itself is now the nudge) ────────
describe("CardPopup signed-out (BL-56/BL-111 F5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the signed-out message instead of a stepper", async () => {
    await renderPopup(makeDetail(), { isAuthenticated: false });
    expect(screen.getByText("Sign in to manage inventory")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /increment/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /decrement/i })).toBeNull();
  });

  it("routes the plate's Sign in button through onRequestSignIn", async () => {
    const onRequestSignIn = vi.fn();
    getBaseCardDetail.mockResolvedValue(makeDetail());
    await act(async () => {
      render(
        <CardPopup
          baseCardId={1}
          isAuthenticated={false}
          setNameByCode={SET_NAMES}
          onClose={vi.fn()}
          onRequestSignIn={onRequestSignIn}
        />
      );
    });
    await waitFor(() => screen.getByRole("dialog"));
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onRequestSignIn).toHaveBeenCalledOnce();
  });

  it("does not render a qty badge on printing-picker rows for anonymous users", async () => {
    await renderPopup(makeDetail({ variants: [makeVariant({ variant_id: 1, quantity: 3 })] }), {
      isAuthenticated: false,
    });
    expect(document.querySelector(".cp-rail__item-qty")).toBeNull();
  });
});

// ─── Signed-in stepper mechanics (PORT from CardInventoryPopup.test.tsx) ──
describe("CardPopup signed-in stepper (PORT)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("+ calls incrementCard for the selected variant_id and reflects the new quantity", async () => {
    incrementCard.mockResolvedValue({
      variant_id: 1,
      quantity: 1,
      playset_complete: false,
      blocked: false,
      reason: null,
    });
    await renderPopup(makeDetail({ variants: [makeVariant({ variant_id: 1, quantity: 0 })] }));

    const incBtn = screen.getByRole("button", { name: /increment/i });
    await act(async () => {
      fireEvent.click(incBtn);
    });

    expect(incrementCard).toHaveBeenCalledWith(1);
    await waitFor(() => expect(screen.getByText("1 / 3")).toBeTruthy());
  });

  it("− calls decrementCard for the selected variant_id and reflects the new quantity", async () => {
    decrementCard.mockResolvedValue({ variant_id: 1, quantity: 1 });
    await renderPopup(makeDetail({ variants: [makeVariant({ variant_id: 1, quantity: 2 })] }));

    const decBtn = screen.getByRole("button", { name: /decrement/i });
    await act(async () => {
      fireEvent.click(decBtn);
    });

    expect(decrementCard).toHaveBeenCalledWith(1);
    await waitFor(() => expect(screen.getByText("1 / 3")).toBeTruthy());
  });

  it("− is disabled at quantity 0", async () => {
    await renderPopup(makeDetail({ variants: [makeVariant({ variant_id: 1, quantity: 0 })] }));
    const decBtn = screen.getByRole("button", { name: /decrement/i }) as HTMLButtonElement;
    expect(decBtn.disabled).toBe(true);
  });

  // DISPOSITION (PORT, per-variant enforcement, BL-24): selecting between two
  // printings independently reflects each one's own quantity/limit state --
  // the single-stepper UI now shows this by re-rendering per selection
  // instead of one row per variant, but the underlying per-variant
  // enforcement is unchanged.
  it("selecting a different printing shows that printing's own quantity/disable state (per-variant enforcement)", async () => {
    await renderPopup(
      makeDetail({
        type: "Unit",
        variants: [
          makeVariant({ variant_id: 1, quantity: 3, card_number: "12" }),
          makeVariant({
            variant_id: 2,
            finish: "Standard Foil",
            quantity: 2,
            card_number: "13",
          }),
        ],
      })
    );
    // Standard (default selection) is at its default limit (3) -- + disabled.
    expect((screen.getByRole("button", { name: /increment/i }) as HTMLButtonElement).disabled).toBe(
      true
    );

    fireEvent.click(screen.getByTitle("Standard Foil – #13 – SOR"));
    // Standard Foil is under its own default limit (3) -- + enabled.
    expect((screen.getByRole("button", { name: /increment/i }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it("+ is disabled at quantity 1 for a Leader variant (singleton cap)", async () => {
    await renderPopup(
      makeDetail({
        type: "Leader",
        variants: [makeVariant({ variant_id: 1, quantity: 1, card_number: "1" })],
      })
    );
    const incBtn = screen.getByRole("button", { name: /increment/i }) as HTMLButtonElement;
    expect(incBtn.disabled).toBe(true);
  });

  it("+ does not apply the increment when the response is blocked", async () => {
    incrementCard.mockResolvedValue({
      variant_id: 1,
      quantity: 2,
      playset_complete: false,
      blocked: true,
      reason: "trade_sell",
    });
    await renderPopup(
      makeDetail({
        type: "Unit",
        variants: [makeVariant({ variant_id: 1, quantity: 2, card_number: "12" })],
      })
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /increment/i }));
    });
    expect(screen.getByText("2 / 3")).toBeTruthy();
  });

  it("calls onChanged on close only if a change was made", async () => {
    decrementCard.mockResolvedValue({ variant_id: 1, quantity: 1 });
    const { onClose, onChanged } = await renderPopup(
      makeDetail({ variants: [makeVariant({ variant_id: 1, quantity: 2 })] })
    );

    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("calls onChanged on close after a change was made", async () => {
    decrementCard.mockResolvedValue({ variant_id: 1, quantity: 1 });
    const { onChanged } = await renderPopup(
      makeDetail({ variants: [makeVariant({ variant_id: 1, quantity: 2 })] })
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /decrement/i }));
    });
    await waitFor(() => expect(screen.getByText("1 / 3")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("+ maps an EmailNotVerifiedError to a banner-pointing message instead of applying the mutation", async () => {
    incrementCard.mockRejectedValue(new EmailNotVerifiedError());
    await renderPopup(makeDetail({ variants: [makeVariant({ variant_id: 1, quantity: 0 })] }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /increment/i }));
    });

    expect(screen.getByText(/verify your email to manage inventory/i)).toBeInTheDocument();
    expect(screen.getByText("0 / 3")).toBeTruthy();
  });

  it("− maps an EmailNotVerifiedError to a banner-pointing message", async () => {
    decrementCard.mockRejectedValue(new EmailNotVerifiedError());
    await renderPopup(makeDetail({ variants: [makeVariant({ variant_id: 1, quantity: 2 })] }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /decrement/i }));
    });

    expect(screen.getByText(/verify your email to manage inventory/i)).toBeInTheDocument();
  });

  it("+ shows a generic message for a non-verification error", async () => {
    incrementCard.mockRejectedValue(new Error("network error"));
    await renderPopup(makeDetail({ variants: [makeVariant({ variant_id: 1, quantity: 0 })] }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /increment/i }));
    });

    expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
  });

  it("clears a prior mutation error on the next successful mutation", async () => {
    incrementCard.mockRejectedValueOnce(new EmailNotVerifiedError());
    incrementCard.mockResolvedValueOnce({
      variant_id: 1,
      quantity: 1,
      playset_complete: false,
      blocked: false,
      reason: null,
    });
    await renderPopup(makeDetail({ variants: [makeVariant({ variant_id: 1, quantity: 0 })] }));

    const incBtn = screen.getByRole("button", { name: /increment/i });
    await act(async () => {
      fireEvent.click(incBtn);
    });
    expect(screen.getByText(/verify your email to manage inventory/i)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(incBtn);
    });
    expect(screen.queryByText(/verify your email to manage inventory/i)).not.toBeInTheDocument();
  });

  it('renders the "OWNED — <printing> <cardnum>" label (design handoff §5)', async () => {
    await renderPopup(
      makeDetail({
        variants: [
          makeVariant({ variant_id: 1, finish: "Standard Foil", card_number: "13", quantity: 1 }),
        ],
      })
    );
    expect(screen.getByText("OWNED — Standard Foil #13")).toBeTruthy();
  });

  it("owned printings show a green qty badge in the picker; unowned show muted", async () => {
    await renderPopup(
      makeDetail({
        variants: [
          makeVariant({ variant_id: 1, quantity: 2, card_number: "12" }),
          makeVariant({ variant_id: 2, finish: "Standard Foil", quantity: 0, card_number: "13" }),
        ],
      })
    );
    const owned = screen.getByTitle("Standard – #12 – SOR").querySelector(".cp-rail__item-qty");
    const unowned = screen
      .getByTitle("Standard Foil – #13 – SOR")
      .querySelector(".cp-rail__item-qty");
    expect(owned?.className).toContain("cp-rail__item-qty--owned");
    expect(unowned?.className).not.toContain("cp-rail__item-qty--owned");
  });
});

// ─── Effective limits (PORT from CardInventoryPopup.test.tsx "BL-25") ─────
function makeLimitCell(overrides: Partial<LimitCell>): LimitCell {
  return {
    type_category: "standard",
    limit_bucket: "Standard",
    max_quantity: 3,
    is_default: true,
    ...overrides,
  };
}

async function renderPopupWithLimits(
  detail: BaseCardDetail,
  cells: LimitCell[],
  capMode: CapMode = "hard",
  isAuthenticated = true
) {
  getLimits.mockResolvedValue({ limits: cells, cap_mode: capMode });
  getBaseCardDetail.mockResolvedValue(detail);
  const onClose = vi.fn();
  await act(async () => {
    render(
      <LimitsProvider isAuthenticated={isAuthenticated}>
        <CardPopup
          baseCardId={detail.id}
          isAuthenticated={isAuthenticated}
          setNameByCode={SET_NAMES}
          onClose={onClose}
          onChanged={vi.fn()}
        />
      </LimitsProvider>
    );
  });
  await waitFor(() => screen.getByRole("dialog"));
}

describe("CardPopup effective limits (PORT, BL-25)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("+ stays enabled past the old constant when the bucket has a higher override", async () => {
    await renderPopupWithLimits(
      makeDetail({
        type: "Unit",
        variants: [makeVariant({ variant_id: 1, quantity: 3, card_number: "12" })],
      }),
      [makeLimitCell({ max_quantity: 5, is_default: false })]
    );
    const incBtn = screen.getByRole("button", { name: /increment/i }) as HTMLButtonElement;
    expect(incBtn.disabled).toBe(false);
  });

  it("+ is disabled at the override value, not the old constant", async () => {
    await renderPopupWithLimits(
      makeDetail({
        type: "Unit",
        variants: [makeVariant({ variant_id: 1, quantity: 2, card_number: "12" })],
      }),
      [makeLimitCell({ max_quantity: 2, is_default: false })]
    );
    const incBtn = screen.getByRole("button", { name: /increment/i }) as HTMLButtonElement;
    expect(incBtn.disabled).toBe(true);
  });

  it("per-variant buckets: an override on one finish leaves the other finish on its default", async () => {
    await renderPopupWithLimits(
      makeDetail({
        type: "Unit",
        variants: [
          makeVariant({ variant_id: 1, quantity: 2, card_number: "12" }),
          makeVariant({ variant_id: 2, finish: "Standard Foil", quantity: 2, card_number: "13" }),
        ],
      }),
      [makeLimitCell({ limit_bucket: "Standard", max_quantity: 2, is_default: false })]
    );
    // Standard (default selection) is at its override (2) -- + disabled.
    expect((screen.getByRole("button", { name: /increment/i }) as HTMLButtonElement).disabled).toBe(
      true
    );
    fireEvent.click(screen.getByTitle("Standard Foil – #13 – SOR"));
    // Standard Foil still defaults to 3 -- + enabled at quantity 2.
    expect((screen.getByRole("button", { name: /increment/i }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it('"No limit" enables + far past any constant but still disables at the 999 ceiling, and hides the "/y" suffix and bar', async () => {
    await renderPopupWithLimits(
      makeDetail({
        type: "Unit",
        variants: [makeVariant({ variant_id: 1, quantity: 42, card_number: "12" })],
      }),
      [makeLimitCell({ max_quantity: null, is_default: false })]
    );
    expect((screen.getByRole("button", { name: /increment/i }) as HTMLButtonElement).disabled).toBe(
      false
    );
    // "42" legitimately renders twice (the stepper's big central number AND
    // the readout, since there's no "/y" suffix to distinguish them here) --
    // scope to the readout specifically rather than a global getByText.
    expect(document.querySelector(".cp-plate__count")?.textContent).toBe("42");
    expect(document.querySelector(".cp-plate__bar")).toBeNull();
  });

  it('"No limit" still disables + at the 999 technical ceiling', async () => {
    await renderPopupWithLimits(
      makeDetail({
        type: "Unit",
        variants: [makeVariant({ variant_id: 1, quantity: 999, card_number: "12" })],
      }),
      [makeLimitCell({ max_quantity: null, is_default: false })]
    );
    const incBtn = screen.getByRole("button", { name: /increment/i }) as HTMLButtonElement;
    expect(incBtn.disabled).toBe(true);
  });

  it("a channel-bucketed variant (finish null) resolves its limit from its channel cell", async () => {
    await renderPopupWithLimits(
      makeDetail({
        type: "Unit",
        variants: [
          makeVariant({
            variant_id: 1,
            variant_type: "Weekly Play",
            finish: null,
            channel: "Weekly Play",
            quantity: 1,
            card_number: "12",
          }),
        ],
      }),
      [makeLimitCell({ limit_bucket: "Weekly Play", max_quantity: 1, is_default: false })]
    );
    const incBtn = screen.getByRole("button", { name: /increment/i }) as HTMLButtonElement;
    expect(incBtn.disabled).toBe(true);
  });
});

// ─── cap_mode (PORT from CardInventoryPopup.test.tsx "BL-35") ─────────────
describe("CardPopup cap_mode (PORT, BL-35)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("soft mode: + stays enabled at (and past) the effective limit", async () => {
    await renderPopupWithLimits(
      makeDetail({
        type: "Unit",
        variants: [makeVariant({ variant_id: 1, quantity: 3, card_number: "12" })],
      }),
      [makeLimitCell({ max_quantity: 3 })],
      "soft"
    );
    const incBtn = screen.getByRole("button", { name: /increment/i }) as HTMLButtonElement;
    expect(incBtn.disabled).toBe(false);
  });

  it("soft mode: + is still disabled at the 999 technical ceiling", async () => {
    await renderPopupWithLimits(
      makeDetail({
        type: "Unit",
        variants: [makeVariant({ variant_id: 1, quantity: 999, card_number: "12" })],
      }),
      [makeLimitCell({ max_quantity: null, is_default: false })],
      "soft"
    );
    const incBtn = screen.getByRole("button", { name: /increment/i }) as HTMLButtonElement;
    expect(incBtn.disabled).toBe(true);
  });

  it("soft mode: shows the amber over-limit tag once quantity exceeds the effective limit", async () => {
    await renderPopupWithLimits(
      makeDetail({
        type: "Unit",
        variants: [makeVariant({ variant_id: 1, quantity: 5, card_number: "12" })],
      }),
      [makeLimitCell({ max_quantity: 3 })],
      "soft"
    );
    expect(screen.getByText("Over limit")).toBeInTheDocument();
    const count = document.querySelector(".cp-plate__count") as HTMLElement;
    expect(count.className).toContain("cp-plate__count--over-limit");
  });

  it("soft mode: no over-limit tag while at or below the effective limit", async () => {
    await renderPopupWithLimits(
      makeDetail({
        type: "Unit",
        variants: [makeVariant({ variant_id: 1, quantity: 3, card_number: "12" })],
      }),
      [makeLimitCell({ max_quantity: 3 })],
      "soft"
    );
    expect(screen.queryByText("Over limit")).not.toBeInTheDocument();
  });

  it('soft mode: a "No limit" bucket never shows the over-limit tag, however high the quantity', async () => {
    await renderPopupWithLimits(
      makeDetail({
        type: "Unit",
        variants: [makeVariant({ variant_id: 1, quantity: 500, card_number: "12" })],
      }),
      [makeLimitCell({ max_quantity: null, is_default: false })],
      "soft"
    );
    expect(screen.queryByText("Over limit")).not.toBeInTheDocument();
  });

  it("hard mode: no over-limit tag even when quantity already sits past a since-lowered limit", async () => {
    await renderPopupWithLimits(
      makeDetail({
        type: "Unit",
        variants: [makeVariant({ variant_id: 1, quantity: 5, card_number: "12" })],
      }),
      [makeLimitCell({ max_quantity: 3 })],
      "hard"
    );
    expect(screen.queryByText("Over limit")).not.toBeInTheDocument();
    const incBtn = screen.getByRole("button", { name: /increment/i }) as HTMLButtonElement;
    expect(incBtn.disabled).toBe(true);
  });

  it("soft mode: incrementing past the limit commits and keeps the readout over-limit-flagged", async () => {
    incrementCard.mockResolvedValue({
      variant_id: 1,
      quantity: 4,
      playset_complete: false,
      blocked: false,
      reason: null,
      over_limit: true,
    });
    await renderPopupWithLimits(
      makeDetail({
        type: "Unit",
        variants: [makeVariant({ variant_id: 1, quantity: 3, card_number: "12" })],
      }),
      [makeLimitCell({ max_quantity: 3 })],
      "soft"
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /increment/i }));
    });

    await waitFor(() => expect(screen.getByText("4 / 3")).toBeInTheDocument());
    expect(screen.getByText("Over limit")).toBeInTheDocument();
  });
});

// ─── Rail pricing (BL-140 design-conformance pass, REPLACE) ───────────────
// pricePlacement=rail-rows: prices live ON each printing row (price-right
// format), with a rail-header Market/Low toggle, a loading skeleton for
// `price: undefined` rows, and a rail-footer attribution line -- replacing
// the retired PriceBlock's separate grouped panel + Market/Cheapest toggle.
describe("CardPopup rail pricing (BL-140 design-conformance pass)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function railPrice(title: string): string | null {
    const row = screen.getByTitle(title);
    return row.querySelector('[data-testid="rail-price-text"]')?.textContent ?? null;
  }

  it("shows the selected printing's own market price on its rail row by default", async () => {
    await renderPopup(
      makeDetail({
        variants: [
          makeVariant({
            variant_id: 1,
            card_number: "12",
            price: { market: 12.5, low: 9.99, as_of: "2026-07-19" },
          }),
        ],
      })
    );
    expect(railPrice("Standard – #12 – SOR")).toBe("$12.50");
  });

  it("shows an em-dash on an unpriced printing's row", async () => {
    await renderPopup(
      makeDetail({ variants: [makeVariant({ variant_id: 1, card_number: "12", price: null })] })
    );
    expect(railPrice("Standard – #12 – SOR")).toBe("—");
  });

  it("shows a skeleton (not a dash) for a row whose price hasn't loaded yet (additive-field stale-cache case)", async () => {
    await renderPopup(
      makeDetail({
        variants: [makeVariant({ variant_id: 1, card_number: "12" /* price omitted entirely */ })],
      })
    );
    const row = screen.getByTitle("Standard – #12 – SOR");
    expect(row.querySelector('[data-testid="rail-price-skeleton"]')).toBeTruthy();
    expect(row.querySelector('[data-testid="rail-price-text"]')).toBeNull();
  });

  it("the rail header's Market/Low toggle switches every row's shown price kind", async () => {
    await renderPopup(
      makeDetail({
        variants: [
          makeVariant({
            variant_id: 1,
            card_number: "12",
            price: { market: 12.5, low: 9.99, as_of: "2026-07-19" },
          }),
        ],
      })
    );
    expect(railPrice("Standard – #12 – SOR")).toBe("$12.50");
    fireEvent.click(screen.getByRole("button", { name: "Low" }));
    expect(railPrice("Standard – #12 – SOR")).toBe("$9.99");
    fireEvent.click(screen.getByRole("button", { name: "Market" }));
    expect(railPrice("Standard – #12 – SOR")).toBe("$12.50");
  });

  it("Low mode shows an em-dash for a printing priced on market but not low", async () => {
    await renderPopup(
      makeDetail({
        variants: [
          makeVariant({
            variant_id: 1,
            card_number: "12",
            price: { market: 12.5, low: null, as_of: "2026-07-19" },
          }),
        ],
      })
    );
    fireEvent.click(screen.getByRole("button", { name: "Low" }));
    expect(railPrice("Standard – #12 – SOR")).toBe("—");
  });

  it("rail footer shows plain attribution when every printing is priced", async () => {
    await renderPopup(
      makeDetail({
        variants: [
          makeVariant({
            variant_id: 1,
            price: { market: 5, low: 4, as_of: "2026-07-19" },
          }),
        ],
      })
    );
    expect(screen.getByText("Prices via TCGplayer")).toBeTruthy();
  });

  it("rail footer appends the unpriced count when some printings lack a price", async () => {
    await renderPopup(
      makeDetail({
        variants: [
          makeVariant({ variant_id: 1, finish: "Standard", card_number: "12", price: null }),
          makeVariant({
            variant_id: 2,
            finish: "Standard Foil",
            card_number: "13",
            price: { market: 20, low: 15, as_of: "2026-07-19" },
          }),
        ],
      })
    );
    expect(screen.getByText("Prices via TCGplayer · 1 unpriced")).toBeTruthy();
  });
});

// ─── History embed (BL-140 design-conformance pass, REPLACE) ─────────────
// historyEmbed=expand-below / chartPlacement=under-printings: a COMPACT
// history panel is permanently embedded under the printings rail (re-
// rendering on selection), and its ⤢ affordance expands a FULL panel below
// the popup's grid -- replacing the retired price block's "View price
// history" button + independent overlay panel.
describe("CardPopup history embed (BL-140 design-conformance pass)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPriceHistory.mockResolvedValue({ variant_id: 1, range: "90d", series: [] });
  });

  it("the compact history panel is present as soon as a printing is selected, with no user action needed", async () => {
    await renderPopup(makeDetail({ variants: [makeVariant({ variant_id: 1 })] }));
    await waitFor(() => expect(getPriceHistory).toHaveBeenCalledWith(1, 1, "90d"));
    const panels = screen.getAllByTestId("price-history-panel");
    expect(panels).toHaveLength(1);
    expect(document.querySelector(".cp-rail__history")).toBeTruthy();
  });

  it("the compact panel re-fetches for the newly selected printing when a different printing is chosen", async () => {
    await renderPopup(
      makeDetail({
        variants: [
          makeVariant({ variant_id: 1, finish: "Standard", card_number: "12" }),
          makeVariant({ variant_id: 2, finish: "Standard Foil", card_number: "13" }),
        ],
      })
    );
    await waitFor(() => expect(getPriceHistory).toHaveBeenCalledWith(1, 1, "90d"));
    fireEvent.click(screen.getByTitle("Standard Foil – #13 – SOR"));
    await waitFor(() => expect(getPriceHistory).toHaveBeenCalledWith(1, 2, "90d"));
  });

  it("the expand (⤢) affordance opens a full panel below the popup's grid, without removing the compact one", async () => {
    await renderPopup(makeDetail({ variants: [makeVariant({ variant_id: 1 })] }));
    await waitFor(() => expect(getPriceHistory).toHaveBeenCalledWith(1, 1, "90d"));
    expect(document.querySelector(".cp-history-expand")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /expand price history/i }));

    expect(document.querySelector(".cp-history-expand")).toBeTruthy();
    expect(screen.getAllByTestId("price-history-panel")).toHaveLength(2);
  });

  it("closing the full panel (×) returns to compact-only", async () => {
    await renderPopup(makeDetail({ variants: [makeVariant({ variant_id: 1 })] }));
    await waitFor(() => expect(getPriceHistory).toHaveBeenCalledWith(1, 1, "90d"));
    fireEvent.click(screen.getByRole("button", { name: /expand price history/i }));
    expect(document.querySelector(".cp-history-expand")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /close price history/i }));

    expect(document.querySelector(".cp-history-expand")).toBeNull();
    expect(screen.getAllByTestId("price-history-panel")).toHaveLength(1);
  });

  it("Escape collapses the expanded full panel first, then closes the popup on a second Escape", async () => {
    const onClose = vi.fn();
    await renderPopup(makeDetail({ variants: [makeVariant({ variant_id: 1 })] }), { onClose });
    await waitFor(() => expect(getPriceHistory).toHaveBeenCalledWith(1, 1, "90d"));
    fireEvent.click(screen.getByRole("button", { name: /expand price history/i }));
    expect(document.querySelector(".cp-history-expand")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector(".cp-history-expand")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ─── Prev/next navigation (BL-148, CREATE) ────────────────────────────────
// The popup itself only ever sees a `navigation` prop (canPrev/canNext +
// onPrev/onNext) -- it has no idea it's being browsed through a filtered
// list; that ordering/snapshotting lives in CardsPage (CardsPage.test.tsx's
// own BL-148 block covers order fidelity and the filter-change-mid-session
// state model). This file's job is the popup's half: render the affordance
// correctly per `canPrev`/`canNext`, wire clicks and the guarded
// ArrowLeft/ArrowRight shortcuts to the right callback, and confirm
// navigating to a different base card resets per-card state (selected
// printing, history re-key) the same way the existing baseCardId-keyed
// effect already does for any other "open a different card" path.
describe("CardPopup prev/next navigation (BL-148, CREATE)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPriceHistory.mockResolvedValue({ variant_id: 1, range: "90d", series: [] });
  });

  function makeNav(overrides: Partial<CardPopupNavigation> = {}): CardPopupNavigation {
    return {
      canPrev: true,
      canNext: true,
      onPrev: vi.fn(),
      onNext: vi.fn(),
      ...overrides,
    };
  }

  it("renders no nav controls when no navigation context is wired (every pre-BL-148 caller/test)", async () => {
    await renderPopup(makeDetail());
    expect(screen.queryByRole("button", { name: /previous card/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /next card/i })).toBeNull();
  });

  it("renders both chevrons enabled when both directions are available", async () => {
    await renderPopup(makeDetail(), { navigation: makeNav() });
    expect(
      (screen.getByRole("button", { name: /previous card/i }) as HTMLButtonElement).disabled
    ).toBe(false);
    expect((screen.getByRole("button", { name: /next card/i }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it("disables (not wraps) the prev chevron at the start of the list", async () => {
    await renderPopup(makeDetail(), { navigation: makeNav({ canPrev: false }) });
    expect(
      (screen.getByRole("button", { name: /previous card/i }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect((screen.getByRole("button", { name: /next card/i }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it("disables (not wraps) the next chevron at the end of the list", async () => {
    await renderPopup(makeDetail(), { navigation: makeNav({ canNext: false }) });
    expect((screen.getByRole("button", { name: /next card/i }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it("clicking the prev/next chevrons calls the navigation callbacks", async () => {
    const nav = makeNav();
    await renderPopup(makeDetail(), { navigation: nav });

    fireEvent.click(screen.getByRole("button", { name: /previous card/i }));
    expect(nav.onPrev).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: /next card/i }));
    expect(nav.onNext).toHaveBeenCalledOnce();
  });

  it("ArrowLeft/ArrowRight call the navigation callbacks when enabled", async () => {
    const nav = makeNav();
    await renderPopup(makeDetail(), { navigation: nav });

    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(nav.onPrev).toHaveBeenCalledOnce();

    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(nav.onNext).toHaveBeenCalledOnce();
  });

  it("ArrowLeft/ArrowRight are no-ops at a disabled boundary", async () => {
    const nav = makeNav({ canPrev: false, canNext: false });
    await renderPopup(makeDetail(), { navigation: nav });

    fireEvent.keyDown(document, { key: "ArrowLeft" });
    fireEvent.keyDown(document, { key: "ArrowRight" });

    expect(nav.onPrev).not.toHaveBeenCalled();
    expect(nav.onNext).not.toHaveBeenCalled();
  });

  it("ArrowLeft/ArrowRight are no-ops with no navigation context at all", async () => {
    await renderPopup(makeDetail());
    // Should not throw, and there's nothing to have called.
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    fireEvent.keyDown(document, { key: "ArrowRight" });
  });

  it("ArrowLeft/ArrowRight are suppressed while focus is in an input/textarea (guard)", async () => {
    const nav = makeNav();
    await renderPopup(makeDetail(), { navigation: nav });

    // Simulate a focused text field somewhere on the page (e.g. a future
    // search box, or focus left over in a background element) -- the
    // keydown's target is what the guard inspects, not the popup's own DOM.
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { key: "ArrowLeft" });
    fireEvent.keyDown(input, { key: "ArrowRight" });

    expect(nav.onPrev).not.toHaveBeenCalled();
    expect(nav.onNext).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it("Escape still closes as normal when a navigation context is present (no interference)", async () => {
    const onClose = vi.fn();
    await renderPopup(makeDetail(), { navigation: makeNav(), onClose });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  // DISPOSITION (CREATE): navigating to a different card is, from the
  // popup's own point of view, indistinguishable from any other path that
  // changes the `baseCardId` prop (a table name click, a gallery cell
  // click) -- the existing baseCardId-keyed effect already resets
  // selectedVariantId (back to Standard-first via pickRepresentative) and
  // historyExpanded (back to collapsed) on every such change. This test
  // proves that reset actually fires across a simulated "prev/next" prop
  // change: select a non-default printing and expand the full history panel
  // on card A, then re-render with a different baseCardId (what CardsPage
  // does when a nav callback fires setPopupBaseCardId), landing on card B.
  it("navigating to a different card resets the selected printing to Standard-first and collapses the expanded history panel", async () => {
    const cardA = makeDetail({
      id: 1,
      variants: [
        makeVariant({ variant_id: 1, finish: "Standard", card_number: "12" }),
        makeVariant({ variant_id: 2, finish: "Standard Foil", card_number: "13" }),
      ],
    });
    const cardB = makeDetail({
      id: 2,
      name: "Different Card",
      variants: [makeVariant({ variant_id: 3, finish: "Standard", card_number: "1" })],
    });

    getBaseCardDetail.mockImplementation((id: number) => Promise.resolve(id === 1 ? cardA : cardB));

    const { rerender } = render(
      <CardPopup
        baseCardId={1}
        isAuthenticated={true}
        setNameByCode={SET_NAMES}
        onClose={vi.fn()}
        navigation={makeNav()}
      />
    );
    await waitFor(() => screen.getByRole("dialog"));
    await waitFor(() => expect(getPriceHistory).toHaveBeenCalledWith(1, 1, "90d"));

    // Select the non-default printing and expand the full history panel.
    fireEvent.click(screen.getByTitle("Standard Foil – #13 – SOR"));
    expect(document.querySelector(".cp-rail__item--active")?.getAttribute("title")).toBe(
      "Standard Foil – #13 – SOR"
    );
    fireEvent.click(screen.getByRole("button", { name: /expand price history/i }));
    expect(document.querySelector(".cp-history-expand")).toBeTruthy();

    // Simulate CardsPage's onNext handler swapping the popup to card B.
    await act(async () => {
      rerender(
        <CardPopup
          baseCardId={2}
          isAuthenticated={true}
          setNameByCode={SET_NAMES}
          onClose={vi.fn()}
          navigation={makeNav()}
        />
      );
    });
    await waitFor(() => expect(screen.getByText("Different Card")).toBeTruthy());

    // Standard-first default for the new card's only variant, not a stale
    // selection carried over from card A.
    expect(document.querySelector(".cp-rail__item--active")?.getAttribute("title")).toBe(
      "Standard – #1 – SOR"
    );
    // History collapses back to compact-only for the new card.
    expect(document.querySelector(".cp-history-expand")).toBeNull();
  });
});
