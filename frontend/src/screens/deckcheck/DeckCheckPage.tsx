import { useState } from "react";
import { checkDeck, DeckCheckApiError } from "../../api/deckCheck";
import type { DeckCheckRequestBody, DeckCheckResponse } from "../../api/deckCheck";
import { DeckCheckEntry } from "./DeckCheckEntry";
import type { DeckCheckEntryError } from "./DeckCheckEntry";
import { DeckCheckResult } from "./DeckCheckResult";
import "./deckcheck.css";

interface Props {
  isAuthenticated: boolean;
  /** BL-56 §5.5 idiom: opens the shell's AuthModal (App-owned). Deck Check
   * is auth-only (BL-137's decided policy -- see api/deckCheck.ts's doc
   * comment), so this is the anonymous visitor's only affordance here,
   * mirroring CardsPage's onRequestSignIn for its own inert anonymous
   * controls. */
  onRequestSignIn: () => void;
}

/** BL-142: top-level Deck Check pane -- entry screen (URL/paste-JSON) ->
 * result screen (per-scope diff + costs + cart links), per
 * Definition_DeckCheck_2026-07-16.md §6 and the Claude Design
 * deck-check-entry/deck-check-result templates (project 8145e927, pulled to
 * claude_design/extracted_2026-07-21/ -- see those components' own doc
 * comments for the authoritative-variant notes). Neither design template
 * exposes a pricing-mode (standard/cheapest) control, so this always
 * requests the API's default ("standard") -- no mode plumbing here.
 *
 * App.tsx mounts this pane unconditionally (like CardsPage), never
 * only-while-authenticated (unlike SettingsPage) -- Deck Check is a real
 * peer nav tab (BL-142 backlog entry), so an anonymous visitor who clicks
 * it sees this pane's own sign-in gate rather than nothing happening. */
export function DeckCheckPage({ isAuthenticated, onRequestSignIn }: Props) {
  const [result, setResult] = useState<DeckCheckResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<DeckCheckEntryError | null>(null);

  async function handleSubmit(body: DeckCheckRequestBody) {
    setLoading(true);
    setError(null);
    try {
      const response = await checkDeck(body);
      setResult(response);
    } catch (err) {
      if (err instanceof DeckCheckApiError) {
        setError({ code: err.code, message: err.message });
      } else {
        setError({
          code: "unknown",
          message: "Something went wrong checking your deck. Please try again.",
        });
      }
    } finally {
      setLoading(false);
    }
  }

  function handleCheckAnother() {
    setResult(null);
    setError(null);
  }

  if (!isAuthenticated) {
    return (
      <div className="screen deckcheck-screen">
        <h1 className="screen-heading">Deck Check</h1>
        <div className="deckcheck-gate">
          <p>Sign in to check a deck against your Vault.</p>
          <button
            type="button"
            className="deckcheck-btn deckcheck-btn--primary"
            onClick={onRequestSignIn}
          >
            Sign In
          </button>
        </div>
      </div>
    );
  }

  // BL-147 dev-review fix (BL-142 review finding), refined in owner
  // dev-review round 2 (2026-07-21): the entry screen gets an extra
  // modifier that horizontally centers it in the pane and top-aligns it
  // vertically (deckcheck.css's `.deckcheck-screen--entry`, `display: grid;
  // justify-items: center; align-items: start`, matching the pulled
  // design's wrapper horizontally but anchored to the top like the result
  // screen) -- the result screen stays on the base `.deckcheck-screen`
  // (horizontal centering only, via margin:auto), since its long scrolling
  // card lists need to anchor to the top too.
  return (
    <div className={`screen deckcheck-screen${result ? "" : " deckcheck-screen--entry"}`}>
      {result ? (
        <DeckCheckResult result={result} onCheckAnother={handleCheckAnother} />
      ) : (
        <DeckCheckEntry loading={loading} error={error} onSubmit={handleSubmit} />
      )}
    </div>
  );
}
