import { useState } from "react";
import { SWUButton } from "../../components/SWUButton";
import type { DeckCheckRequestBody } from "../../api/deckCheck";

export interface DeckCheckEntryError {
  code: string;
  message: string;
}

interface Props {
  loading: boolean;
  error: DeckCheckEntryError | null;
  onSubmit: (body: DeckCheckRequestBody) => void;
}

/** Best-effort provider label for the loading state's "Fetching deck from
 * <site>…" copy (Claude Design's deck-check-entry template, `loading`
 * state) -- purely cosmetic, the actual allowlist enforcement is the
 * backend's (deck_fetch.py). Falls back to a generic phrase for pasted
 * JSON or an unrecognized host, rather than guessing wrong. */
function providerLabel(input: string): string {
  if (input.includes("swubase.com")) return "SWUBase";
  if (input.includes("sw-unlimited-db.com")) return "sw-unlimited-db";
  return "your deck source";
}

/** BL-142 entry screen -- Claude Design `templates/deck-check-entry`
 * (project 8145e927), DEFAULT-marked variant: `inputStyle: smart-single`
 * (ONE field for either a deck URL or pasted JSON -- NOT the two-input
 * variant) with `providerHints: inline`. Read from the pulled design file
 * (claude_design/extracted_2026-07-21/DeckCheckEntry.dc.html, reference
 * only, not committed) since DesignSync itself was unreachable from this
 * agent's session (see PR description). The five `screenState` values --
 * idle / loading / error-unsupported / error-fetch / error-json -- are
 * reproduced verbatim (including their exact copy) as this component's
 * loading/error states; `error-unsupported`/`error-json`/`error-fetch` map
 * onto the router's typed errors (deck_check.py's _typed_error) of the same
 * name plus `unknown` for anything else. No pricing-mode control appears in
 * this template -- BL-137's mode param defaults to "standard" with no entry-
 * screen switch, matching the design as pulled. */
export function DeckCheckEntry({ loading, error, onSubmit }: Props) {
  const [text, setText] = useState("");
  // JSON-syntax failures are caught before ever reaching the backend --
  // the design's `error-json` state is a post-submission server response
  // ("parsed but no leader/deck inside"), so a raw parse failure is a
  // distinct, client-only case. It reuses the same red coach-box treatment
  // with adjusted copy rather than inventing a new visual state.
  const [localError, setLocalError] = useState<string | null>(null);

  function handleSubmit() {
    if (loading) return;
    setLocalError(null);
    const trimmed = text.trim();
    if (!trimmed) return;

    if (trimmed.startsWith("{")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        setLocalError("Couldn't parse that as JSON -- check for a missing brace or quote.");
        return;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setLocalError("Expected a JSON object (e.g. SWUDB's “Copy deck JSON” output).");
        return;
      }
      onSubmit({ deck_json: parsed as Record<string, unknown> });
    } else {
      onSubmit({ url: trimmed });
    }
  }

  const serverState = error?.code; // "unsupported_url" | "fetch_failed" | "invalid_deck_json" | "unknown"

  return (
    <div className="dce-frame">
      <div className="dce-panel">
        <div className="dce-head">
          <h2 className="dce-title">Deck Check</h2>
          <span className="dce-subtitle">Paste a deck — see if your collection can build it.</span>
        </div>

        <div className="dce-field">
          <label className="dce-label" htmlFor="dce-smart">
            Deck URL — or pasted JSON
          </label>
          <textarea
            id="dce-smart"
            className="dce-textarea"
            rows={3}
            placeholder="https://swubase.com/deck/…   — or paste the deck's JSON"
            value={text}
            disabled={loading}
            onChange={(e) => {
              setText(e.target.value);
              setLocalError(null);
            }}
          />
          <span className="dce-hint">
            SWUBase &amp; sw-unlimited-db links are fetched automatically; anything starting with{" "}
            <span className="dce-mono">{"{"}</span> is read as deck JSON.
          </span>
        </div>

        {localError && (
          <div className="dce-coach dce-coach--error" role="alert">
            <span className="dce-coach__title dce-coach__title--error">
              Couldn&apos;t read that
            </span>
            <span className="dce-coach__body">{localError}</span>
          </div>
        )}

        {!localError && serverState === "unsupported_url" && (
          <div className="dce-coach dce-coach--shortcut" role="alert">
            <span className="dce-coach__head">
              <span className="dce-coach__badge">Shortcut</span>
              <span className="dce-coach__title">That site can&apos;t be fetched directly</span>
            </span>
            <span className="dce-coach__body">
              No problem — on SWUDB choose <strong>⋯ → Copy deck JSON</strong> and paste it above.
              Same result, one extra click.
            </span>
          </div>
        )}

        {!localError && serverState === "fetch_failed" && (
          <div className="dce-coach dce-coach--error" role="alert">
            <span className="dce-coach__title dce-coach__title--error">
              Couldn&apos;t fetch that deck
            </span>
            <span className="dce-coach__body">
              The site didn&apos;t respond — it may be down, or the deck may be private. Try again
              in a moment, or paste the deck&apos;s JSON instead.
            </span>
          </div>
        )}

        {!localError && serverState === "invalid_deck_json" && (
          <div className="dce-coach dce-coach--error" role="alert">
            <span className="dce-coach__title dce-coach__title--error">
              That JSON isn&apos;t a deck
            </span>
            <span className="dce-coach__body">
              It parsed, but there&apos;s no <span className="dce-mono">leader</span> or{" "}
              <span className="dce-mono">deck</span> list inside. Re-copy with the site&apos;s
              &ldquo;Copy deck JSON&rdquo; option.
            </span>
          </div>
        )}

        {!localError && serverState === "unknown" && (
          <div className="dce-coach dce-coach--error" role="alert">
            <span className="dce-coach__title dce-coach__title--error">Something went wrong</span>
            <span className="dce-coach__body">{error?.message}</span>
          </div>
        )}

        {loading ? (
          <div className="dce-loading">
            <span aria-hidden="true" className="dce-spinner" />
            <span className="dce-loading__text">
              <span className="dce-loading__title">Fetching deck from {providerLabel(text)}…</span>
              <span className="dce-loading__sub">Usually a couple of seconds.</span>
            </span>
          </div>
        ) : (
          <div className="dce-submit-row">
            <SWUButton size="sm" onClick={handleSubmit} ariaDisabled={text.trim().length === 0}>
              Check deck
            </SWUButton>
          </div>
        )}
      </div>
    </div>
  );
}
