import { useState } from "react";
import type {
  CardSummary,
  DeckCardEntry,
  DeckCheckResponse,
  DeckSource,
  ScopeResult,
} from "../../api/deckCheck";
import { SWUButton } from "../../components/SWUButton";

interface Props {
  result: DeckCheckResponse;
  onCheckAnother: () => void;
}

const GREEN = "#3fb950";
const RED = "#e0565b";

const SOURCE_LABEL: Record<DeckSource, string> = {
  swubase: "SwuBase",
  "sw-unlimited-db": "sw-unlimited-db",
  pasted: "Pasted JSON",
};

function usd(n: number | null): string {
  return n == null ? "—" : `$${n.toFixed(2)}`;
}

/** Total missing COPIES (not distinct cards) across a scope's missing list --
 * matches the design's "N missing" language on the buy button and tile
 * fraction ("47/50 owned"), which counts copies, not card rows. */
function missingCopies(scope: ScopeResult): number {
  return scope.missing.reduce((sum, m) => sum + Math.max(0, m.need - m.have), 0);
}

/** Common row shape both list modes render through -- MissingCard and
 * DeckCardEntry carry identical need/have/unit_price fields (BL-142's
 * all_cards is a strict superset of missing, verified backend-side), so a
 * single DeckCardRow can render either without needing the row's own
 * subtotal/line_value: the per-row cost is always unit_price * (need -
 * have) -- zero (rendered as an em dash, never "$0.00") for a fully-owned
 * row, which is exactly how the design's ALL CARDS rows show no dollar
 * figure for cards you already own in full. */
interface DisplayRow {
  key: string;
  name: string;
  subtitle: string | null;
  need: number;
  have: number;
  unitPrice: number | null;
}

function toDisplayRows(
  entries: { card: CardSummary; need: number; have: number; unit_price: number | null }[]
): DisplayRow[] {
  return entries.map((e) => ({
    key: `${e.card.set_code}-${e.card.base_card_number}`,
    name: e.card.name,
    subtitle: e.card.subtitle,
    need: e.need,
    have: e.have,
    unitPrice: e.unit_price,
  }));
}

/** ALL CARDS mode: missing cards first (so the 6-row cap never hides an
 * actionable row behind fully-owned ones), fully-owned cards after --
 * Array.prototype.sort is stable, so each group keeps its own original
 * relative order. */
function orderAllCardsEntries(entries: DeckCardEntry[]): DeckCardEntry[] {
  return [...entries].sort((a, b) => {
    const aMissing = a.need > a.have ? 0 : 1;
    const bMissing = b.need > b.have ? 0 : 1;
    return aMissing - bMissing;
  });
}

interface ScopeColumnProps {
  label: string;
  scope: ScopeResult;
  size: number;
  showAll: boolean;
}

function ScopeColumn({ label, scope, size, showAll }: ScopeColumnProps) {
  const miss = missingCopies(scope);
  const owned = Math.max(0, size - miss);
  const color = scope.buildable ? GREEN : RED;

  // BL-147 dev-review fix (BL-142 review finding, owner override): the
  // design's 6-row cap + "+N more cards" overflow row are retired entirely
  // -- every row renders, in both MISSING ONLY and ALL CARDS mode. Long
  // scrolling lists are explicitly accepted "for now" (owner decision,
  // 2026-07-21) rather than reintroducing a cap or an internal scroll
  // region; .dcr-list has no max-height/overflow, so the page simply grows.
  const rows = showAll
    ? toDisplayRows(orderAllCardsEntries(scope.all_cards))
    : toDisplayRows(scope.missing);

  return (
    <div className="dcr-scope" style={{ ["--dcr-edge" as string]: color }}>
      <div className="dcr-scope__tile">
        <span className="dcr-scope__info">
          <span className="dcr-scope__label">{label}</span>
          <span className="dcr-scope__fraction-row">
            <span className="dcr-scope__fraction" style={{ color }}>
              {owned}/{size}
            </span>
            <span className="dcr-scope__owned-text">owned</span>
          </span>
        </span>
        <span className="dcr-scope__value">
          <span className="dcr-scope__value-label">{label} Value</span>
          <span className="dcr-scope__value-amount">{usd(scope.deck_value)}</span>
        </span>
      </div>

      <section className="dcr-list">
        <div className="dcr-list__head">
          <span>{showAll ? "Full List" : "Missing"}</span>
        </div>

        {!showAll && rows.length === 0 ? (
          <div className="dcr-list__complete">✓ Complete</div>
        ) : (
          rows.map((row) => <DeckCardRow key={row.key} row={row} />)
        )}

        {scope.missing.length > 0 && (
          <div className="dcr-list__footer">
            <span className="dcr-list__to-complete">
              <span className="dcr-list__to-complete-label">To complete</span>
              <span className="dcr-list__to-complete-row">
                <span className="dcr-list__to-complete-amount">{usd(scope.missing_total)}</span>
                {scope.unpriced_count > 0 && (
                  <span className="dcr-list__unpriced">+{scope.unpriced_count} unpriced</span>
                )}
              </span>
            </span>
            {scope.cart_url && (
              <SWUButton
                size="sm"
                onClick={() => window.open(scope.cart_url!, "_blank", "noopener,noreferrer")}
              >
                Buy {miss} missing ↗
              </SWUButton>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function DeckCardRow({ row }: { row: DisplayRow }) {
  const missingQty = Math.max(0, row.need - row.have);
  const hasPer = row.unitPrice != null && missingQty > 1;
  const subOn = row.unitPrice != null && missingQty > 0;

  return (
    <div className="dcr-row">
      <span className="dcr-row__name">
        {row.name}
        {row.subtitle && <span className="dcr-row__subtitle"> — {row.subtitle}</span>}
      </span>
      <span className="dcr-row__dots">
        {Array.from({ length: row.need }, (_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="dcr-dot"
            style={{ background: i < row.have ? GREEN : RED }}
          />
        ))}
      </span>
      <span className="dcr-row__cost">
        {hasPer && (
          <span className="dcr-row__per">
            {missingQty} × {usd(row.unitPrice)} =
          </span>
        )}
        <span
          className={subOn ? "dcr-row__subtotal" : "dcr-row__subtotal dcr-row__subtotal--unpriced"}
        >
          {subOn ? usd(row.unitPrice! * missingQty) : "—"}
        </span>
      </span>
    </div>
  );
}

/** BL-142 result screen -- Claude Design `templates/deck-check-result`
 * (project 8145e927), DEFAULT-marked variant: `celebration: subtle` (a
 * banner row, NOT the full-screen takeover), `deckValuePlacement:
 * scope-cards`. Read from the pulled design file
 * (claude_design/extracted_2026-07-21/DeckCheckResult.dc.html, reference
 * only, not committed) since DesignSync itself was unreachable from this
 * agent's session that first built this screen (see PR #363's description).
 *
 * PR #363 shipped this screen with two deliberate cuts, both since restored
 * by the API extension backing this build (owner decision, issue #354):
 *  1. The MISSING ONLY / ALL CARDS toggle -- `scopes.*.all_cards` is now a
 *     complete per-scope card list (owned rows included), so ALL CARDS mode
 *     switches each ScopeColumn's row source from `missing` to `all_cards`
 *     (ordered missing-first so the row cap never hides an actionable row).
 *  2. The scope-tile market value line ("MAIN DECK VALUE $x") -- now backed
 *     by `scopes.*.deck_value`, the scope's complete-decklist value
 *     (present regardless of ownership, unlike missing_total).
 *
 * The prototype's three "resultState" scenarios (partial / main-buildable /
 * all-buildable / unrecognized / empty-inventory) are mutually-exclusive
 * *preview* scenarios for the design tool; real responses can combine them
 * (e.g. some unrecognized cards AND a fully-buildable main scope), so this
 * component derives each banner/color independently from the real payload
 * rather than switching on one named state. */
export function DeckCheckResult({ result, onCheckAnother }: Props) {
  const { deck, unrecognized, scopes, pricing } = result;
  const [showAll, setShowAll] = useState(false);

  const allBuildable = scopes.together.buildable && unrecognized.length === 0;
  const unrecognizedCopies = unrecognized.reduce((sum, u) => sum + u.count, 0);
  const totalCopies = deck.main_count + deck.side_count;
  // Proxy for the prototype's "empty-inventory" scenario: every single copy
  // in the deck (main + side) is missing -- i.e. nothing in this deck is
  // owned yet. There's no account-wide "is the Vault empty" flag in the
  // contract, so this is scoped to "empty for this deck" rather than
  // "empty account-wide" -- matches the design's own copy, which is itself
  // phrased in terms of this deck ("here's the deck's full list").
  const missingCopiesTotal = missingCopies(scopes.together);
  const startingFresh = missingCopiesTotal > 0 && missingCopiesTotal === totalCopies;

  return (
    <div className="dcr">
      <div className="dcr-header-frame">
        <div className="dcr-header">
          {(deck.leader?.front_image_url || deck.base?.front_image_url) && (
            <span className="dcr-header__art">
              {deck.leader?.front_image_url && (
                <img
                  className="dcr-header__art-img"
                  src={deck.leader.front_image_url}
                  alt="Leader"
                />
              )}
              {deck.base?.front_image_url && (
                <img className="dcr-header__art-img" src={deck.base.front_image_url} alt="Base" />
              )}
            </span>
          )}
          <span className="dcr-header__info">
            <span className="dcr-header__name">{deck.name ?? "Unnamed Deck"}</span>
            <span className="dcr-header__meta">
              {deck.author ? `by ${deck.author} · ` : ""}
              {deck.main_count} main + {deck.side_count} sideboard
            </span>
            <span className="dcr-header__chip-row">
              <span className="dcr-header__chip">{SOURCE_LABEL[deck.source]}</span>
              <span className="dcr-header__fine">checked just now — results aren&apos;t saved</span>
            </span>
          </span>
          <button type="button" className="dcr-check-another" onClick={onCheckAnother}>
            Check Another Deck
          </button>
        </div>
      </div>

      {unrecognized.length > 0 && (
        <div className="dcr-banner dcr-banner--amber" role="status">
          <span className="dcr-banner__title">Partial result</span>
          <span className="dcr-banner__body">
            {unrecognizedCopies} {unrecognizedCopies === 1 ? "card is" : "cards are"} from a set we
            don&apos;t recognize yet — {unrecognizedCopies === 1 ? "it isn't" : "they aren't"}{" "}
            counted below.
          </span>
        </div>
      )}

      {startingFresh && !allBuildable && (
        <div className="dcr-banner dcr-banner--blue" role="status">
          <span className="dcr-banner__title">Starting fresh</span>
          <span className="dcr-banner__body">
            Nothing in your Vault yet for this deck — here&apos;s the full list, priced, so you know
            exactly where to start.
          </span>
        </div>
      )}

      {allBuildable && (
        <div className="dcr-banner dcr-banner--win" role="status">
          <span aria-hidden="true" className="dcr-banner__check">
            ✓
          </span>
          <span className="dcr-banner__win-text">
            <span className="dcr-banner__title dcr-banner__title--win">Fully buildable</span>
            <span className="dcr-banner__body">
              All {totalCopies} copies are in your Vault. Results aren&apos;t saved — run another
              check anytime.
            </span>
          </span>
        </div>
      )}

      <div className="dcr-toggle-row">
        <span className="dcr-toggle" role="group" aria-label="Card list view">
          <button
            type="button"
            className={`dcr-toggle__btn${!showAll ? " dcr-toggle__btn--active" : ""}`}
            aria-pressed={!showAll}
            onClick={() => setShowAll(false)}
          >
            Missing Only
          </button>
          <button
            type="button"
            className={`dcr-toggle__btn${showAll ? " dcr-toggle__btn--active" : ""}`}
            aria-pressed={showAll}
            onClick={() => setShowAll(true)}
          >
            All Cards
          </button>
        </span>
        <span className="dcr-toggle-row__caption">market value · {pricing.source}</span>
      </div>

      <div className="dcr-scopes">
        <ScopeColumn
          label="Main Deck"
          scope={scopes.main}
          size={deck.main_count}
          showAll={showAll}
        />
        <ScopeColumn
          label="Sideboard"
          scope={scopes.side}
          size={deck.side_count}
          showAll={showAll}
        />
      </div>

      {scopes.together.missing.length > 0 && (
        <>
          <div className="dcr-total">
            <span className="dcr-total__label">Total missing</span>
            {scopes.together.unpriced_count > 0 && (
              <span className="dcr-total__unpriced">
                {scopes.together.unpriced_count} unpriced — excluded from totals.
              </span>
            )}
            <span className="dcr-total__amounts">
              <span className="dcr-total__col">
                <span className="dcr-total__col-label">Main Deck</span>
                <span className="dcr-total__col-value">{usd(scopes.main.missing_total)}</span>
              </span>
              <span className="dcr-total__col">
                <span className="dcr-total__col-label">Sideboard</span>
                <span className="dcr-total__col-value">{usd(scopes.side.missing_total)}</span>
              </span>
              <span className="dcr-total__col dcr-total__col--grand">
                <span className="dcr-total__col-label">To Complete</span>
                <span className="dcr-total__col-value">{usd(scopes.together.missing_total)}</span>
              </span>
              {scopes.together.cart_url && (
                <SWUButton
                  size="sm"
                  onClick={() =>
                    window.open(scopes.together.cart_url!, "_blank", "noopener,noreferrer")
                  }
                >
                  Buy {missingCopiesTotal} missing ↗
                </SWUButton>
              )}
            </span>
          </div>
          <p className="dcr-fine-print">
            Prices via {pricing.source}
            {pricing.as_of ? ` · as of ${pricing.as_of}` : ""}
            {scopes.together.cart_url
              ? " · Name-based carts — exact printing/finish may vary."
              : ""}
          </p>
        </>
      )}
    </div>
  );
}
