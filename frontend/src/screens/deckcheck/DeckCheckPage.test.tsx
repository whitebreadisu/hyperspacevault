import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DeckCheckPage } from "./DeckCheckPage";

// Same vi.hoisted real-class pattern SettingsPage.test.tsx uses for
// LimitsApiError -- the instanceof check in DeckCheckPage's catch block
// needs to see the same reference the tests throw.
const { checkDeck, DeckCheckApiError } = vi.hoisted(() => {
  class DeckCheckApiError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return { checkDeck: vi.fn(), DeckCheckApiError };
});
vi.mock("../../api/deckCheck", () => ({ checkDeck, DeckCheckApiError }));

const SAMPLE_RESULT = {
  deck: {
    name: "My Deck",
    author: "Someone",
    source: "pasted",
    leader: null,
    second_leader: null,
    base: null,
    main_count: 50,
    side_count: 10,
  },
  unrecognized: [],
  scopes: {
    // BL-142 (PORT): widened with all_cards/deck_value/unpriced_value_count
    // when those fields were added to ScopeResult -- this file's coverage
    // is page-level orchestration (sign-in gate, submit/result wiring,
    // error surfacing), unaffected by the value extension itself.
    main: {
      buildable: true,
      missing: [],
      missing_total: 0,
      unpriced_count: 0,
      cart_url: null,
      all_cards: [],
      deck_value: 0,
      unpriced_value_count: 0,
    },
    side: {
      buildable: true,
      missing: [],
      missing_total: 0,
      unpriced_count: 0,
      cart_url: null,
      all_cards: [],
      deck_value: 0,
      unpriced_value_count: 0,
    },
    together: {
      buildable: true,
      missing: [],
      missing_total: 0,
      unpriced_count: 0,
      cart_url: null,
      all_cards: [],
      deck_value: 0,
      unpriced_value_count: 0,
    },
  },
  pricing: { mode: "standard", source: "tcgplayer", as_of: "2026-07-16" },
};

// DISPOSITION (BL-142 design pull, PORT + one REPLACE): most of this
// file's coverage (sign-in gate, submit -> result, typed/generic error
// surfacing, Check Another Deck) survives unchanged -- the page-level
// orchestration is the same regardless of which Entry/Result shape is
// wired underneath. The one behavior that does NOT survive is the
// mode-switch/recompute-error test -- neither Claude Design template
// exposes a pricing-mode control (see DeckCheckPage.tsx's doc comment), so
// DeckCheckPage no longer has a mode-switch code path to test at all.
describe("DeckCheckPage (BL-142)", () => {
  beforeEach(() => {
    checkDeck.mockReset();
  });

  it("shows a sign-in gate (not the entry form) for anonymous visitors, wired to onRequestSignIn", () => {
    const onRequestSignIn = vi.fn();
    render(<DeckCheckPage isAuthenticated={false} onRequestSignIn={onRequestSignIn} />);

    expect(screen.getByText(/sign in to check a deck/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/deck url/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    expect(onRequestSignIn).toHaveBeenCalledTimes(1);
  });

  it("shows the entry form for authenticated visitors", () => {
    render(<DeckCheckPage isAuthenticated={true} onRequestSignIn={vi.fn()} />);
    expect(screen.getByLabelText(/deck url/i)).toBeInTheDocument();
    expect(screen.queryByText(/sign in to check a deck/i)).not.toBeInTheDocument();
  });

  it("submits to checkDeck (default mode, no mode arg needed) and renders the result on success", async () => {
    checkDeck.mockResolvedValue(SAMPLE_RESULT);
    render(<DeckCheckPage isAuthenticated={true} onRequestSignIn={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/deck url/i), {
      target: { value: "https://swubase.com/decks/abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check deck" }));

    await waitFor(() => expect(screen.getByText("My Deck")).toBeInTheDocument());
    expect(checkDeck).toHaveBeenCalledWith({ url: "https://swubase.com/decks/abc" });
    expect(screen.queryByLabelText(/deck url/i)).not.toBeInTheDocument();
  });

  it("surfaces a typed API error on the entry screen without switching to the result view", async () => {
    checkDeck.mockRejectedValue(
      new DeckCheckApiError(
        "unsupported_url",
        "melee.gg isn't supported -- paste JSON instead.",
        422
      )
    );
    render(<DeckCheckPage isAuthenticated={true} onRequestSignIn={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/deck url/i), {
      target: { value: "https://melee.gg/decks/x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check deck" }));

    await waitFor(() =>
      expect(screen.getByText(/that site can't be fetched/i)).toBeInTheDocument()
    );
    expect(screen.getByLabelText(/deck url/i)).toBeInTheDocument();
  });

  it("falls back to a generic message for a non-DeckCheckApiError failure", async () => {
    checkDeck.mockRejectedValue(new Error("network exploded"));
    render(<DeckCheckPage isAuthenticated={true} onRequestSignIn={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/deck url/i), {
      target: { value: "https://swubase.com/decks/abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check deck" }));

    await waitFor(() =>
      expect(screen.getByText(/something went wrong checking your deck/i)).toBeInTheDocument()
    );
  });

  it("returns to a blank entry form via Check Another Deck", async () => {
    checkDeck.mockResolvedValue(SAMPLE_RESULT);
    render(<DeckCheckPage isAuthenticated={true} onRequestSignIn={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/deck url/i), {
      target: { value: "https://swubase.com/decks/abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check deck" }));
    await waitFor(() => expect(screen.getByText("My Deck")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /check another deck/i }));
    expect(screen.getByLabelText(/deck url/i)).toHaveValue("");
  });
});

// BL-147 dev-review fix (BL-142 review finding, CREATE), refined in owner
// dev-review round 2 (2026-07-21, BL-142 family): both deck-check views
// must read horizontally centered in the pane -- the entry screen used to
// additionally center vertically but round 2 top-aligns it instead
// (deckcheck.css's `.deckcheck-screen--entry`, `display: grid; justify-
// items: center; align-items: start`, matching the pulled design's wrapper
// horizontally while reading top-anchored like the result screen), which
// stays on the base `.deckcheck-screen` (margin:auto, horizontal-only --
// its long scrolling list needs to anchor to the top too). jsdom has no
// layout engine, so this only asserts the modifier class is applied in
// exactly the states it's meant for -- the actual alignment math is the
// CSS rule itself.
describe("DeckCheckPage centering modifier (BL-147)", () => {
  function screenEl(): HTMLElement {
    return document.querySelector(".deckcheck-screen") as HTMLElement;
  }

  it("applies the entry-centering modifier while the entry form is showing", () => {
    render(<DeckCheckPage isAuthenticated={true} onRequestSignIn={vi.fn()} />);
    expect(screenEl().className).toContain("deckcheck-screen--entry");
  });

  it("does not apply the entry-centering modifier once a result is showing", async () => {
    checkDeck.mockResolvedValue(SAMPLE_RESULT);
    render(<DeckCheckPage isAuthenticated={true} onRequestSignIn={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/deck url/i), {
      target: { value: "https://swubase.com/decks/abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check deck" }));
    await waitFor(() => expect(screen.getByText("My Deck")).toBeInTheDocument());

    expect(screenEl().className).not.toContain("deckcheck-screen--entry");
  });

  it("does not apply the entry-centering modifier on the anonymous sign-in gate", () => {
    render(<DeckCheckPage isAuthenticated={false} onRequestSignIn={vi.fn()} />);
    expect(screenEl().className).not.toContain("deckcheck-screen--entry");
  });
});
