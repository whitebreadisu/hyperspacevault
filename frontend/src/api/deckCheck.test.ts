import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkDeck, DeckCheckApiError } from "./deckCheck";
import type { DeckCheckResponse } from "./deckCheck";

// Same mocking shape as authedFetch.test.ts -- authedFetch itself is real
// (unmocked), only the underlying global fetch + firebase auth state are
// stubbed, since deckCheck.ts's contract is "what does authedFetch get
// called with, and how are non-2xx responses turned into a typed error".
const { authState } = vi.hoisted(() => ({
  authState: { currentUser: null as { getIdToken: () => Promise<string> } | null },
}));

vi.mock("../firebase", () => ({
  auth: authState,
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SAMPLE_RESPONSE: DeckCheckResponse = {
  deck: {
    name: "Test Deck",
    author: "someone",
    source: "pasted",
    leader: null,
    second_leader: null,
    base: null,
    main_count: 50,
    side_count: 10,
  },
  unrecognized: [],
  scopes: {
    // BL-142 (PORT): extended with all_cards/deck_value/unpriced_value_count
    // when those fields were added to ScopeResult -- the checkDeck/typed-
    // error behavior this file actually tests is unaffected, so the
    // fixture is just widened to satisfy the type, not re-authored.
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

describe("checkDeck", () => {
  beforeEach(() => {
    authState.currentUser = null;
    vi.restoreAllMocks();
  });

  it("posts to /api/deck-check with the default mode=standard query param and JSON body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(SAMPLE_RESPONSE));
    await checkDeck({ url: "https://swubase.com/decks/abc" });

    const [calledUrl, init] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe("/api/deck-check?mode=standard");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ url: "https://swubase.com/decks/abc" });
  });

  it("posts with mode=cheapest when explicitly requested", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(SAMPLE_RESPONSE));
    await checkDeck({ deck_json: { leader: {} } }, "cheapest");

    const [calledUrl] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe("/api/deck-check?mode=cheapest");
  });

  it("returns the parsed response body on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(SAMPLE_RESPONSE));
    const result = await checkDeck({ url: "https://swubase.com/decks/abc" });
    expect(result).toEqual(SAMPLE_RESPONSE);
  });

  it("throws a DeckCheckApiError with the router's typed error code (unsupported_url)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        {
          detail: {
            error: "unsupported_url",
            message: "melee.gg is not supported -- paste JSON instead.",
          },
        },
        422
      )
    );
    await expect(checkDeck({ url: "https://melee.gg/decks/x" })).rejects.toMatchObject({
      name: "DeckCheckApiError",
      code: "unsupported_url",
      status: 422,
      message: "melee.gg is not supported -- paste JSON instead.",
    });
  });

  it("throws a DeckCheckApiError with code invalid_deck_json for malformed deck_json", async () => {
    // mockImplementation (not mockResolvedValue) -- a Response body can only
    // be read once, and this test's assertions each trigger their own
    // checkDeck() call/fetch/`.json()` read, so each call needs its own
    // fresh Response instance rather than sharing one already-consumed one.
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        jsonResponse({ detail: { error: "invalid_deck_json", message: "missing 'deck' key" } }, 422)
      )
    );
    await expect(checkDeck({ deck_json: {} })).rejects.toBeInstanceOf(DeckCheckApiError);
    await expect(checkDeck({ deck_json: {} })).rejects.toMatchObject({ code: "invalid_deck_json" });
  });

  it("throws a DeckCheckApiError with code fetch_failed for an unreachable provider", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ detail: { error: "fetch_failed", message: "provider timed out" } }, 502)
    );
    await expect(checkDeck({ url: "https://swubase.com/decks/x" })).rejects.toMatchObject({
      code: "fetch_failed",
      status: 502,
    });
  });

  it("falls back to code 'unknown' for a response with no recognized typed-error shape", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    await expect(checkDeck({ url: "https://swubase.com/decks/x" })).rejects.toMatchObject({
      code: "unknown",
      status: 401,
    });
  });
});
