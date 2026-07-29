import type { AddCardsCatalogEntry } from "./addCardsResolver";
import type { PreconDeck, PreconEntry, PreconDeckCard } from "../data/preconDecks";

/** BL-164 §5 (Definition_CosmeticsBatch_2026-07-26.md): the precon dropdown's
 * hover-preview composition needs each deck's Leader(s) and Base card --
 * `preconDecks.json` rows carry no `type` field of their own (see
 * PreconDeckCard), so this module resolves each deck's cards against the
 * app's live catalog (the same `AddCardsCatalogEntry[]` AddCardsModal already
 * threads through -- no new fetch). */

/** Matches one deck card row against the catalog the same way
 * addCardsResolver.ts's resolveRow scopes its own candidates: `set_code`
 * matches either the printing's home base set OR its provenance set (a
 * companion-set deck row still resolves against a base-set catalog family),
 * card_number exact, tokens excluded. When more than one candidate remains
 * (a shared card_number across finishes), prefers the row's own
 * `variant_type` -- else the first candidate deterministically, mirroring
 * resolveRow's own "first match wins" fallback for the Serialized Prestige
 * image-collision case. */
function findCatalogEntry(
  card: PreconDeckCard,
  catalog: AddCardsCatalogEntry[]
): AddCardsCatalogEntry | null {
  const candidates = catalog.filter(
    (c) =>
      (c.set_code === card.set_code || c.source_set_code === card.set_code) &&
      c.card_number === card.card_number &&
      !c.is_token
  );
  if (candidates.length === 0) return null;
  return candidates.find((c) => c.variant_type === card.variant_type) ?? candidates[0];
}

export interface DeckLeaderBase {
  /** Every catalog-resolved Leader row found among the deck's cards -- 1 for
   * a standard precon, 2 for a Twin Suns dual-leader deck. */
  leaders: AddCardsCatalogEntry[];
  /** The deck's Base card, or null if it couldn't be resolved against the
   * catalog (reported by the caller -- never silently substituted). */
  base: AddCardsCatalogEntry | null;
  /** Deck rows whose (set_code, card_number) had no catalog match at all --
   * a genuine data-integrity gap (the deck data is uuid-resolved at prep
   * time, so this should never happen with real preconDecks.json content,
   * but is reported rather than swallowed, same posture as the precon
   * import's own unresolved-row handling). */
  unresolvedCardNumbers: string[];
}

/** Resolves one deck's Leader(s)/Base from the catalog. Never throws --
 * degrades to fewer entries and reports the gap via
 * `unresolvedCardNumbers`. */
export function resolveDeckLeaderBase(
  deck: PreconDeck,
  catalog: AddCardsCatalogEntry[]
): DeckLeaderBase {
  const leaders: AddCardsCatalogEntry[] = [];
  let base: AddCardsCatalogEntry | null = null;
  const unresolvedCardNumbers: string[] = [];

  for (const card of deck.cards) {
    const entry = findCatalogEntry(card, catalog);
    if (!entry) {
      unresolvedCardNumbers.push(card.card_number);
      continue;
    }
    if (entry.type === "Leader") leaders.push(entry);
    else if (entry.type === "Base" && !base) base = entry;
  }

  return { leaders, base, unresolvedCardNumbers };
}

/** One leader + its own base (IBH half-deck pairing). */
export interface PreviewPair {
  leader: AddCardsCatalogEntry;
  base: AddCardsCatalogEntry | null;
}

/** The hover-preview's owner-locked composition per deck kind (§5):
 *  - "standard": one leader front, its base centered behind (title-bar peek).
 *  - "dual": Twin Suns decks -- both leaders side by side, ONE base behind.
 *  - "ibh": the IBH whole-box entry -- both half-decks side by side,
 *    Twin-Suns-style, each leader with its OWN base peeking behind it.
 *  - "unresolved": no leader could be resolved for at least one deck/half --
 *    the caller renders no composition rather than a broken partial one
 *    (still shows the plain text block underneath). */
export type PreconPreview =
  | { kind: "standard"; leader: AddCardsCatalogEntry; base: AddCardsCatalogEntry | null }
  | {
      kind: "dual";
      leaders: [AddCardsCatalogEntry, AddCardsCatalogEntry];
      base: AddCardsCatalogEntry | null;
    }
  | { kind: "ibh"; halves: [PreviewPair, PreviewPair] }
  | { kind: "unresolved"; unresolvedCardNumbers: string[] };

/** Builds the preview composition for one dropdown entry. The dual-leader
 * ("Twin Suns") shape is detected structurally -- exactly how many Leader
 * rows the catalog resolves for the deck -- rather than by set code or the
 * deck's own `aspects: null` convention, so it stays correct even if a
 * future non-TS26 dual-leader product ships. */
export function buildPreconPreview(
  entry: PreconEntry,
  catalog: AddCardsCatalogEntry[]
): PreconPreview {
  if (entry.kind === "ibhBox") {
    const a = resolveDeckLeaderBase(entry.deckA, catalog);
    const b = resolveDeckLeaderBase(entry.deckB, catalog);
    if (a.leaders.length === 0 || b.leaders.length === 0) {
      return {
        kind: "unresolved",
        unresolvedCardNumbers: [...a.unresolvedCardNumbers, ...b.unresolvedCardNumbers],
      };
    }
    return {
      kind: "ibh",
      halves: [
        { leader: a.leaders[0], base: a.base },
        { leader: b.leaders[0], base: b.base },
      ],
    };
  }

  const { leaders, base, unresolvedCardNumbers } = resolveDeckLeaderBase(entry.deck, catalog);
  if (leaders.length >= 2) {
    return { kind: "dual", leaders: [leaders[0], leaders[1]], base };
  }
  if (leaders.length === 1) {
    return { kind: "standard", leader: leaders[0], base };
  }
  return { kind: "unresolved", unresolvedCardNumbers };
}
