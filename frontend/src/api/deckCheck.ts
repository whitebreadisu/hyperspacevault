import { authedFetch } from "./authedFetch";
import { CodedApiError } from "./errors";

/** BL-142: frontend types + client for POST /api/deck-check, mirroring
 * backend/app/schemas/deck_check_schema.py field-for-field
 * (Definition_DeckCheck_2026-07-16.md §6 -- the authoritative contract).
 * Auth-only endpoint (get_db) -- callers must only invoke this when
 * signed in; DeckCheckPage gates on isAuthenticated before ever rendering
 * the entry form. */

export type DeckCheckMode = "standard" | "cheapest";

/** Exactly one of `url` / `deck_json` -- enforced by the caller (see
 * checkDeck below), matching the router's XOR requirement. */
export type DeckCheckRequestBody =
  { url: string; deck_json?: never } | { url?: never; deck_json: Record<string, unknown> };

export interface CardSummary {
  base_card_id: number;
  set_code: string;
  base_card_number: string;
  name: string;
  subtitle: string | null;
  type: string;
  front_image_url: string | null;
}

export interface DeckSlotSummary extends CardSummary {
  count: number;
}

export type DeckSource = "swubase" | "sw-unlimited-db" | "pasted";

export interface DeckSummary {
  name: string | null;
  author: string | null;
  source: DeckSource;
  leader: DeckSlotSummary | null;
  second_leader: DeckSlotSummary | null;
  base: DeckSlotSummary | null;
  main_count: number;
  side_count: number;
}

export interface UnrecognizedCard {
  id: string;
  count: number;
}

export interface MissingCard {
  card: CardSummary;
  need: number;
  have: number;
  unit_price: number | null;
  price_basis: string | null;
  subtotal: number | null;
}

/** BL-142: one row of a scope's COMPLETE card list (the ALL CARDS toggle) --
 * present for every card in the scope, including fully-owned ones, unlike
 * MissingCard which only ever appears for cards still missing at least one
 * copy. `line_value` is unit_price * need (the value of owning every copy
 * the deck calls for), null when the card is unpriced. */
export interface DeckCardEntry {
  card: CardSummary;
  need: number;
  have: number;
  unit_price: number | null;
  price_basis: string | null;
  line_value: number | null;
}

export interface ScopeResult {
  buildable: boolean;
  missing: MissingCard[];
  missing_total: number;
  unpriced_count: number;
  cart_url: string | null;
  /** BL-142 additions -- see DeckCardEntry's doc comment. deck_value is the
   * scope's complete-decklist market value (same mode/price-basis rules as
   * missing_total, priced via unit_price * need rather than the missing
   * quantity); unpriced_value_count counts all_cards entries with no price
   * at all, independent of unpriced_count (which only counts *missing*
   * unpriced cards). */
  all_cards: DeckCardEntry[];
  deck_value: number;
  unpriced_value_count: number;
}

export type DeckScope = "main" | "side" | "together";

export interface ScopesResponse {
  main: ScopeResult;
  side: ScopeResult;
  together: ScopeResult;
}

export interface PricingInfo {
  mode: DeckCheckMode;
  source: string;
  as_of: string | null;
}

export interface DeckCheckResponse {
  deck: DeckSummary;
  unrecognized: UnrecognizedCard[];
  scopes: ScopesResponse;
  pricing: PricingInfo;
}

/** The three typed errors the router raises (deck_check.py's _typed_error) --
 * `unknown` covers anything else (a genuine 401/5xx/network failure) so
 * DeckCheckEntry always has a code to switch on. */
export type DeckCheckErrorCode =
  "unsupported_url" | "fetch_failed" | "invalid_deck_json" | "unknown";

/** BL-154: extends the shared CodedApiError base (api/errors.ts) rather than
 * Error directly -- the code/message/status shape and construction were
 * already the target pattern (the audit's "parsed-body typed errors"
 * convention), so only the base class changed here. */
export class DeckCheckApiError extends CodedApiError<DeckCheckErrorCode> {
  constructor(code: DeckCheckErrorCode, message: string, status: number) {
    super(code, message, status);
    this.name = "DeckCheckApiError";
  }
}

async function readTypedDetail(res: Response): Promise<{ error?: string; message?: string }> {
  try {
    const body = (await res.json()) as { detail?: { error?: string; message?: string } };
    return body?.detail ?? {};
  } catch {
    return {};
  }
}

const KNOWN_CODES: DeckCheckErrorCode[] = ["unsupported_url", "fetch_failed", "invalid_deck_json"];

/** POST /api/deck-check?mode=standard|cheapest. Body carries exactly one of
 * url / deck_json (DeckCheckRequestBody's union enforces that at the type
 * level; callers building the body dynamically should still only set one
 * field). Throws DeckCheckApiError on any non-2xx response. */
export async function checkDeck(
  body: DeckCheckRequestBody,
  mode: DeckCheckMode = "standard"
): Promise<DeckCheckResponse> {
  const res = await authedFetch(`/api/deck-check?mode=${mode}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await readTypedDetail(res);
    const code = KNOWN_CODES.includes(detail.error as DeckCheckErrorCode)
      ? (detail.error as DeckCheckErrorCode)
      : "unknown";
    const message = detail.message ?? `Deck check failed: ${res.status}`;
    throw new DeckCheckApiError(code, message, res.status);
  }

  return (await res.json()) as DeckCheckResponse;
}
