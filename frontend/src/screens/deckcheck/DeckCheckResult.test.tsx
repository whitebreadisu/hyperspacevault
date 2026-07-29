import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DeckCheckResult } from "./DeckCheckResult";
import type { DeckCardEntry, DeckCheckResponse, ScopeResult } from "../../api/deckCheck";

function makeCard(
  overrides: Partial<DeckCheckResponse["scopes"]["main"]["missing"][0]["card"]> = {}
) {
  return {
    base_card_id: 1,
    set_code: "SOR",
    base_card_number: "001",
    name: "Test Card",
    subtitle: null,
    type: "Unit",
    front_image_url: null,
    ...overrides,
  };
}

/** BL-142: ScopeResult now carries the all_cards/deck_value/
 * unpriced_value_count triple alongside the original missing-only fields --
 * this factory fills sane defaults (empty/zero) so tests that only care
 * about the missing-list behavior don't have to know about the value
 * extension, while tests that DO care (the toggle/tile-value tests below)
 * can override exactly what they need. */
function makeScope(overrides: Partial<ScopeResult> = {}): ScopeResult {
  return {
    buildable: true,
    missing: [],
    missing_total: 0,
    unpriced_count: 0,
    cart_url: null,
    all_cards: [],
    deck_value: 0,
    unpriced_value_count: 0,
    ...overrides,
  };
}

function makeAllCardsEntry(overrides: Partial<DeckCardEntry> = {}): DeckCardEntry {
  return {
    card: makeCard(),
    need: 1,
    have: 1,
    unit_price: null,
    price_basis: null,
    line_value: null,
    ...overrides,
  };
}

function baseResult(overrides: Partial<DeckCheckResponse> = {}): DeckCheckResponse {
  return {
    deck: {
      name: "Bounty Board Blitz",
      author: "korrath",
      source: "swubase",
      leader: null,
      second_leader: null,
      base: null,
      main_count: 50,
      side_count: 10,
    },
    unrecognized: [],
    scopes: {
      main: makeScope(),
      side: makeScope(),
      together: makeScope(),
    },
    pricing: { mode: "standard", source: "tcgplayer", as_of: "2026-07-16" },
    ...overrides,
  };
}

// DISPOSITION (BL-142 design pull, REPLACE): the original build of this
// component (before the Claude Design deck-check-result file could be
// pulled -- see DeckCheckResult.tsx's doc comment) rendered three
// tab-selected scope cards (Main/Side/Together) with a pricing-mode toggle
// and a recompute-error banner. The pulled design's saved defaults show
// TWO always-visible scope columns (Main Deck/Sideboard) plus an aggregate
// footer strip -- no "Together" tile, no mode control anywhere in the
// template. Every test below is rewritten against that shape; none of the
// old tab-switching/mode-toggle/recompute-error behavior survives (it was
// never shipped, so there's nothing to port forward).
//
// DISPOSITION (BL-142 API extension, PORT): the ScopeResult fixtures below
// were widened with makeScope()'s all_cards/deck_value/unpriced_value_count
// defaults when those fields were added to the schema; every pre-existing
// assertion in this file is otherwise unchanged (the toggle defaults to
// MISSING ONLY, matching the design's saved default, so the original
// missing-only behavior this file already covered is still exercised
// exactly as before). New tests for the ALL CARDS toggle and scope-tile
// value block are appended in their own describe block below.
describe("DeckCheckResult (BL-142)", () => {
  it("renders the deck header (name, author, main/side counts, source chip)", () => {
    render(<DeckCheckResult result={baseResult()} onCheckAnother={vi.fn()} />);
    expect(screen.getByText("Bounty Board Blitz")).toBeInTheDocument();
    expect(screen.getByText(/by korrath/i)).toBeInTheDocument();
    expect(screen.getByText(/50 main \+ 10 sideboard/i)).toBeInTheDocument();
    expect(screen.getByText("SwuBase")).toBeInTheDocument();
  });

  it("shows both scope columns with fraction-owned derived from main/side counts minus missing copies", () => {
    const result = baseResult();
    result.scopes.main = makeScope({
      buildable: false,
      missing: [
        { card: makeCard(), need: 2, have: 0, unit_price: 1, price_basis: "standard", subtotal: 2 },
      ],
      missing_total: 2,
    });
    render(<DeckCheckResult result={result} onCheckAnother={vi.fn()} />);
    expect(screen.getByText("48/50")).toBeInTheDocument(); // 50 - 2 missing copies
    expect(screen.getByText("10/10")).toBeInTheDocument(); // side untouched, all owned
  });

  it("shows a Complete row for a scope with nothing missing, and a missing-card row otherwise", () => {
    const result = baseResult();
    result.scopes.main = makeScope({
      buildable: false,
      missing: [
        {
          card: makeCard({ name: "Fennec Shand", subtitle: "Honest Work" }),
          need: 3,
          have: 1,
          unit_price: 4.8,
          price_basis: "standard",
          subtotal: 9.6,
        },
      ],
      missing_total: 9.6,
      cart_url: "https://tcgplayer.com/massentry?c=2 Fennec Shand",
    });
    result.scopes.together = { ...result.scopes.main };
    render(<DeckCheckResult result={result} onCheckAnother={vi.fn()} />);

    expect(screen.getByText("✓ Complete")).toBeInTheDocument(); // Sideboard, nothing missing
    expect(screen.getByText("Fennec Shand")).toBeInTheDocument();
    expect(screen.getByText(/— Honest Work/)).toBeInTheDocument();
    // 2 missing copies (need 3, have 1) at $4.80 each: "2 × $4.80 ="
    expect(screen.getByText("2 × $4.80 =")).toBeInTheDocument();
    // "$9.60" appears four times: the row's own subtotal, the Main
    // section's own "to complete" total, and (since `together` is set to
    // the same single-row scope here) the footer's "Main Deck" column plus
    // its grand "To Complete" column -- all genuinely equal because there
    // is only the one missing row in this scenario.
    expect(screen.getAllByText("$9.60")).toHaveLength(4);
  });

  it("renders green/red playset dots matching have vs need", () => {
    const result = baseResult();
    result.scopes.main = makeScope({
      buildable: false,
      missing: [
        { card: makeCard(), need: 3, have: 1, unit_price: 1, price_basis: "standard", subtotal: 2 },
      ],
      missing_total: 2,
    });
    render(<DeckCheckResult result={result} onCheckAnother={vi.fn()} />);
    const row = screen.getByText("Test Card").closest(".dcr-row") as HTMLElement;
    const dots = row.querySelectorAll(".dcr-dot");
    expect(dots).toHaveLength(3);
    expect(dots[0]).toHaveStyle({ background: "rgb(63, 185, 80)" }); // owned -> GREEN
    expect(dots[1]).toHaveStyle({ background: "rgb(224, 86, 91)" }); // missing -> RED
  });

  it("shows an em dash (not a per-unit line) for an unpriced missing card", () => {
    const result = baseResult();
    result.scopes.main = makeScope({
      buildable: false,
      missing: [
        { card: makeCard(), need: 1, have: 0, unit_price: null, price_basis: null, subtotal: null },
      ],
      unpriced_count: 1,
    });
    render(<DeckCheckResult result={result} onCheckAnother={vi.fn()} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/×/)).not.toBeInTheDocument();
  });

  it("shows a per-scope Buy CTA only when a cart_url is present, labeled with the missing copy count", () => {
    const result = baseResult();
    result.scopes.main = makeScope({
      buildable: false,
      missing: [
        { card: makeCard(), need: 2, have: 0, unit_price: 1, price_basis: "standard", subtotal: 2 },
      ],
      missing_total: 2,
      cart_url: "https://tcgplayer.com/massentry?c=2 Test Card",
    });
    render(<DeckCheckResult result={result} onCheckAnother={vi.fn()} />);
    expect(screen.getByRole("button", { name: /buy 2 missing/i })).toBeInTheDocument();
  });

  it("omits the Buy CTA when a scope has missing cards but no cart_url", () => {
    const result = baseResult();
    result.scopes.main = makeScope({
      buildable: false,
      missing: [
        { card: makeCard(), need: 1, have: 0, unit_price: null, price_basis: null, subtotal: null },
      ],
      unpriced_count: 1,
    });
    render(<DeckCheckResult result={result} onCheckAnother={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /buy.*missing/i })).not.toBeInTheDocument();
  });

  it("shows the unrecognized-cards banner with a copy-count-based message when present", () => {
    render(
      <DeckCheckResult
        result={baseResult({ unrecognized: [{ id: "XYZ_999", count: 2 }] })}
        onCheckAnother={vi.fn()}
      />
    );
    expect(screen.getByText("Partial result")).toBeInTheDocument();
    expect(screen.getByText(/2 cards are from a set we don't recognize yet/i)).toBeInTheDocument();
  });

  it("shows the subtle win banner when together is buildable and nothing is unrecognized", () => {
    render(<DeckCheckResult result={baseResult()} onCheckAnother={vi.fn()} />);
    expect(screen.getByText("Fully buildable")).toBeInTheDocument();
    expect(screen.getByText(/all 60 copies are in your vault/i)).toBeInTheDocument();
  });

  it("does not show the win banner when together isn't buildable", () => {
    const result = baseResult();
    result.scopes.together = makeScope({
      buildable: false,
      missing: [
        { card: makeCard(), need: 1, have: 0, unit_price: 1, price_basis: "standard", subtotal: 1 },
      ],
      missing_total: 1,
      cart_url: "https://tcgplayer.com/massentry?c=1 Test Card",
    });
    render(<DeckCheckResult result={result} onCheckAnother={vi.fn()} />);
    expect(screen.queryByText("Fully buildable")).not.toBeInTheDocument();
  });

  it("shows the starting-fresh banner when every copy in the deck is missing", () => {
    const result = baseResult({
      deck: {
        name: "Empty Test",
        author: null,
        source: "pasted",
        leader: null,
        second_leader: null,
        base: null,
        main_count: 2,
        side_count: 1,
      },
    });
    const missingMain = [
      { card: makeCard(), need: 2, have: 0, unit_price: 1, price_basis: "standard", subtotal: 2 },
    ];
    const missingSide = [
      {
        card: makeCard({ base_card_number: "002" }),
        need: 1,
        have: 0,
        unit_price: 1,
        price_basis: "standard",
        subtotal: 1,
      },
    ];
    result.scopes.main = makeScope({
      buildable: false,
      missing: missingMain,
      missing_total: 2,
      cart_url: "x",
    });
    result.scopes.side = makeScope({
      buildable: false,
      missing: missingSide,
      missing_total: 1,
      cart_url: "x",
    });
    result.scopes.together = makeScope({
      buildable: false,
      missing: [...missingMain, ...missingSide],
      missing_total: 3,
      cart_url: "x",
    });
    render(<DeckCheckResult result={result} onCheckAnother={vi.fn()} />);
    expect(screen.getByText("Starting fresh")).toBeInTheDocument();
  });

  it("renders the grand-total footer strip with per-column costs and a Buy-all CTA", () => {
    const result = baseResult();
    result.scopes.main = makeScope({
      buildable: false,
      missing: [
        { card: makeCard(), need: 1, have: 0, unit_price: 2, price_basis: "standard", subtotal: 2 },
      ],
      missing_total: 2,
      // No per-scope cart_url here -- this test is about the FOOTER's own
      // Buy-all CTA; a per-scope one would collide on the same "Buy 1
      // missing" text since both totals happen to be 1 copy.
      cart_url: null,
    });
    result.scopes.together = makeScope({
      buildable: false,
      missing: result.scopes.main.missing,
      missing_total: 2,
      cart_url: "https://tcgplayer.com/massentry?c=1 Test Card",
    });
    render(<DeckCheckResult result={result} onCheckAnother={vi.fn()} />);

    expect(screen.getByText("Total missing")).toBeInTheDocument();
    expect(screen.getByText("To Complete")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /buy 1 missing/i })).toBeInTheDocument();
    expect(screen.getByText(/prices via tcgplayer/i)).toBeInTheDocument();
    expect(screen.getByText(/name-based carts/i)).toBeInTheDocument();
  });

  it("omits the footer strip entirely when together has nothing missing", () => {
    render(<DeckCheckResult result={baseResult()} onCheckAnother={vi.fn()} />);
    expect(screen.queryByText("Total missing")).not.toBeInTheDocument();
  });

  it("calls onCheckAnother when the Check Another Deck control is clicked", () => {
    const onCheckAnother = vi.fn();
    render(<DeckCheckResult result={baseResult()} onCheckAnother={onCheckAnother} />);
    fireEvent.click(screen.getByRole("button", { name: /check another deck/i }));
    expect(onCheckAnother).toHaveBeenCalledTimes(1);
  });

  // BL-147 dev-review fix (BL-142 review finding, owner override, CREATE):
  // the pulled design's 6-row cap is removed entirely -- MISSING ONLY mode
  // must render every missing row, however many there are, with no "+N
  // more cards" overflow row appearing.
  it("renders every missing row with no cap, even well past the old 6-row limit", () => {
    const result = baseResult();
    result.scopes.main = makeScope({
      buildable: false,
      missing: Array.from({ length: 9 }, (_, i) => ({
        card: makeCard({ name: `Missing ${i}`, base_card_number: String(i).padStart(3, "0") }),
        need: 1,
        have: 0,
        unit_price: 1,
        price_basis: "standard",
        subtotal: 1,
      })),
      missing_total: 9,
    });
    render(<DeckCheckResult result={result} onCheckAnother={vi.fn()} />);
    for (let i = 0; i < 9; i++) {
      expect(screen.getByText(`Missing ${i}`)).toBeInTheDocument();
    }
    expect(screen.queryByText(/more cards?/i)).not.toBeInTheDocument();
  });

  it("still shows the ✓ Complete row for a scope with nothing missing (unaffected by the cap removal)", () => {
    render(<DeckCheckResult result={baseResult()} onCheckAnother={vi.fn()} />);
    // Both scopes (Main Deck + Sideboard) have nothing missing in baseResult().
    expect(screen.getAllByText("✓ Complete")).toHaveLength(2);
  });
});

// BL-142: the ALL CARDS toggle + scope-tile market value block -- both
// restored in this build via the API extension (scopes.*.all_cards /
// scopes.*.deck_value), see DeckCheckResult.tsx's doc comment.
describe("DeckCheckResult -- ALL CARDS toggle (BL-142)", () => {
  function deckWithMainAllCards(allCards: DeckCardEntry[], missing: ScopeResult["missing"] = []) {
    const result = baseResult();
    result.scopes.main = makeScope({
      buildable: missing.length === 0,
      missing,
      missing_total: missing.reduce((sum, m) => sum + (m.subtotal ?? 0), 0),
      all_cards: allCards,
    });
    return result;
  }

  it("defaults to MISSING ONLY -- the full list is not shown until toggled", () => {
    const result = deckWithMainAllCards([
      makeAllCardsEntry({ card: makeCard({ name: "Owned Card" }), need: 2, have: 2 }),
    ]);
    render(<DeckCheckResult result={result} onCheckAnother={vi.fn()} />);
    expect(screen.getByRole("button", { name: /missing only/i })).toHaveClass(
      "dcr-toggle__btn--active"
    );
    expect(screen.queryByText("Owned Card")).not.toBeInTheDocument();
    // One "Missing" list-head label per scope column (Main Deck + Sideboard).
    expect(screen.getAllByText("Missing")).toHaveLength(2);
  });

  it("switching to ALL CARDS renders owned rows (and relabels the list Full List)", () => {
    const result = deckWithMainAllCards(
      [
        makeAllCardsEntry({ card: makeCard({ name: "Owned Card" }), need: 2, have: 2 }),
        {
          card: makeCard({ name: "Missing Card", base_card_number: "002" }),
          need: 1,
          have: 0,
          unit_price: 3,
          price_basis: "standard",
          line_value: 3,
        },
      ],
      [
        {
          card: makeCard({ name: "Missing Card", base_card_number: "002" }),
          need: 1,
          have: 0,
          unit_price: 3,
          price_basis: "standard",
          subtotal: 3,
        },
      ]
    );
    render(<DeckCheckResult result={result} onCheckAnother={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /all cards/i }));
    expect(screen.getByRole("button", { name: /all cards/i })).toHaveClass(
      "dcr-toggle__btn--active"
    );
    expect(screen.getByText("Owned Card")).toBeInTheDocument();
    expect(screen.getByText("Missing Card")).toBeInTheDocument();
    // One "Full List" list-head label per scope column.
    expect(screen.getAllByText("Full List")).toHaveLength(2);
    expect(screen.queryByText("Missing")).not.toBeInTheDocument();
  });

  it("an owned row in ALL CARDS mode shows all-green dots and an em dash cost (never $0.00)", () => {
    const result = deckWithMainAllCards([
      makeAllCardsEntry({
        card: makeCard({ name: "Owned Card" }),
        need: 2,
        have: 2,
        unit_price: 9.4,
        line_value: 18.8,
      }),
    ]);
    render(<DeckCheckResult result={result} onCheckAnother={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /all cards/i }));

    const row = screen.getByText("Owned Card").closest(".dcr-row") as HTMLElement;
    const dots = row.querySelectorAll(".dcr-dot");
    expect(dots).toHaveLength(2);
    dots.forEach((dot) => expect(dot).toHaveStyle({ background: "rgb(63, 185, 80)" }));
    expect(row.querySelector(".dcr-row__subtotal")?.textContent).toBe("—");
  });

  it("does NOT show the ✓ Complete row in ALL CARDS mode even when nothing is missing", () => {
    const result = deckWithMainAllCards([
      makeAllCardsEntry({ card: makeCard({ name: "Owned Card" }), need: 1, have: 1 }),
    ]);
    render(<DeckCheckResult result={result} onCheckAnother={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /all cards/i }));
    expect(screen.queryByText("✓ Complete")).not.toBeInTheDocument();
    expect(screen.getByText("Owned Card")).toBeInTheDocument();
  });

  // DISPOSITION (BL-147 dev-review fix, REPLACE): the owner overrode the
  // pulled design's 6-row cap -- every row renders now, in both toggle
  // modes; the "+N more cards" overflow row (the cap's only UI) is retired
  // along with it. This test's old assertion (rows beyond 6 collapse into
  // an overflow row) describes behavior that no longer exists; superseded
  // by the two "renders every row, no cap" tests below (ALL CARDS here,
  // MISSING ONLY in the top-level describe block).
  it("renders every row in ALL CARDS mode with no cap, even well past the old 6-row limit", () => {
    const allCards = Array.from({ length: 9 }, (_, i) =>
      makeAllCardsEntry({
        card: makeCard({ name: `Card ${i}`, base_card_number: String(i).padStart(3, "0") }),
        need: 1,
        have: 1,
      })
    );
    const result = deckWithMainAllCards(allCards);
    render(<DeckCheckResult result={result} onCheckAnother={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /all cards/i }));
    for (let i = 0; i < 9; i++) {
      expect(screen.getByText(`Card ${i}`)).toBeInTheDocument();
    }
    expect(screen.queryByText(/more cards?/i)).not.toBeInTheDocument();
  });

  it("shows the scope-tile market value (MAIN DECK VALUE) driven by scope.deck_value", () => {
    const result = baseResult();
    result.scopes.main = makeScope({ deck_value: 142.75 });
    result.scopes.side = makeScope({ deck_value: 31.2 });
    render(<DeckCheckResult result={result} onCheckAnother={vi.fn()} />);
    expect(screen.getByText(/main deck value/i)).toBeInTheDocument();
    expect(screen.getByText("$142.75")).toBeInTheDocument();
    expect(screen.getByText(/sideboard value/i)).toBeInTheDocument();
    expect(screen.getByText("$31.20")).toBeInTheDocument();
  });

  it("shows a market-value/TCGplayer attribution caption near the toggle", () => {
    render(<DeckCheckResult result={baseResult()} onCheckAnother={vi.fn()} />);
    expect(screen.getByText(/market value · tcgplayer/i)).toBeInTheDocument();
  });
});
