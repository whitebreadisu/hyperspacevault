import type { ImageRenditions } from "../api/baseCards";
import type { CapMode } from "../api/settingsLimits";
import {
  DEFAULT_LIMITS,
  effectiveLimit,
  enforcementCap,
  limitBucketOf,
  QUANTITY_CEILING,
  typeCategoryOf,
} from "./limits";
import type { LimitsMatrix } from "./limits";

export type RowId = string;

/** Flat per-variant row the resolver needs to match a typed-in card_number
 * against the catalog (BL-44 Slice B). CardsPage derives this by flattening the
 * base-cards list fetch's nested variants. Any `CardWithQty[]` still satisfies
 * it structurally, so existing test fixtures built from `CardWithQty` keep
 * working unchanged. */
export interface AddCardsCatalogEntry {
  id: number;
  name: string;
  subtitle: string | null;
  type: string;
  variant_type: string;
  finish: string | null;
  channel: string;
  /** Home set — the set of this variant's *base card* (its Standard root).
   * A Weekly Play printing (e.g. Cantwell Arrestor Cruiser, source SECP) has
   * source_set_code SECP but set_code SEC, because its Standard root lives in
   * SEC. This is what lets a base-set selection reach its companion-set
   * printings (see resolveRow's family-scoped candidate filter). */
  set_code: string;
  /** Provenance set — the set this specific printing was released in (may be
   * a base set or a long-tail container like SECP / J25 / P26). */
  source_set_code: string;
  card_number: string;
  is_token: boolean;
  quantity: number;
  /** Hotlinked official-CDN front image (BL-62 live preview) -- provenance,
   * kept as the fallback CardImagePreview uses when front_images is absent
   * (a stale cached catalog response) -- see utils/cardImages.ts. */
  front_image_url: string | null;
  /** Same-origin renditions (BL-76 Phase 3), additive/optional. */
  front_images?: ImageRenditions | null;
  /** BL-111 F7: the back-side hotlink -- Leaders preview their portrait back
   * side in the console restyle's resolve-panel image (design handoff §7),
   * matching GalleryGrid's cellImage rule (front_image_url on a card with no
   * back stays null; not every variant carries one). */
  back_image_url: string | null;
  /** Same-origin back renditions (BL-76 Phase 3 shape), additive/optional. */
  back_images?: ImageRenditions | null;
}

// Four-axis ambiguity-gated Add Cards resolver: Card -> Set -> Stamp -> Finish.
// Each axis surfaces as a control only when it is genuinely ambiguous.
//
//   • Card   — which physical card the number refers to (SOR/SHD/TWI collisions
//              + cross-family collisions like SEC #1 Palpatine vs SECP #1
//              Cantwell). Defaults to the base-set retail card, overridable.
//   • Set    — the card's *event/provenance*, decoded from variant_type (Base
//              Set, Weekly Play, Store Showdown, Planetary Qualifier, ...).
//              Read-only except the ~4 Base-Set-vs-Prerelease cases; defaults
//              to Base Set, overridable.
//   • Stamp  — the tournament achievement / sub-variant (Top 8, Champion,
//              Judge, ...). Hidden entirely unless the card carries stamps;
//              a required pick when >1 (e.g. Mace Windu's Store Showdown tiers).
//   • Finish — the real finish only (Standard, Standard Foil, Hyperspace, ...).
//              A required pick when >1 (the SOR/SHD/TWI shared-number cases).
//
// The set family scope: a selected set S gathers a printing when set_code === S
// (S is the printing's home base set — pulls companion printings in) OR
// source_set_code === S (S is where it was released — a long-tail selection
// then sees only its own printings). See BL-80 for the "Weekly Play" language.

export interface Row {
  id: RowId;
  /** The source set this row was entered against (BL-61) — e.g. "SOR", "SECP".
   * Carried per-row so a single batch can span multiple sets: changing the
   * Add Cards modal's active set no longer needs to (and must not) touch
   * rows already committed under a different set. Not to be confused with
   * `setKey`, which is the *event* axis (Base Set vs Prerelease, etc.). */
  setCode: string;
  cardNumber: string;
  cardKey: string | null;
  setKey: string | null;
  stamp: string | null;
  finish: string | null;
}

/** Stable, human-readable identity key for a card within a (set, number)
 * group — doubles as the option label in the "which card?" picker. */
export function cardKeyOf(name: string, subtitle: string | null): string {
  return subtitle ? `${name} — ${subtitle}` : name;
}

/** One selectable card in a shared-number collision. */
export interface CardChoice {
  key: string;
  name: string;
  subtitle: string | null;
}

/** UI state for one of the Set / Stamp / Finish axes. `show` controls whether
 * the field renders at all; `options.length > 1` means render a <select>
 * (otherwise `value` is shown read-only); `needsPick` blocks commit. */
export interface AxisView {
  show: boolean;
  value: string | null;
  options: string[];
  needsPick: boolean;
}

export interface CardAxisView {
  show: boolean;
  choices: CardChoice[];
  selectedKey: string | null;
  needsPick: boolean;
}

interface ResolveState {
  name: string | null;
  subtitle: string | null;
  channel: string | null;
  card: CardAxisView;
  set: AxisView;
  stamp: AxisView;
  finish: AxisView;
}

export type ResolveResult =
  | { status: "empty" }
  | { status: "error"; message: string }
  | ({ status: "pending"; variantId: null; type: string | null } & ResolveState)
  | ({ status: "resolved"; variantId: number; type: string } & ResolveState);

export interface InventoryStatus {
  // BL-35: "amber" is soft-mode's over-effective-limit-but-still-added state
  // -- distinct from "red" (which always means "blocked", whether by the
  // per-tenant limit in hard mode or by the unconditional 999 ceiling in
  // either mode). See inventoryStatus's mode parameter.
  color: "green" | "amber" | "red";
  owned: number;
  max: number;
  /** BL-111 F7: the resolved variant's true effective limit
   * (utils/limits.ts's effectiveLimit) -- null means "No limit". Distinct
   * from `max`, which substitutes the 999 ceiling for "No limit" (the
   * pre-check comparison value) -- the two-line inventory readout needs to
   * tell "No limit" apart from a very high configured number so it can drop
   * the "/y" and never show "(AT LIMIT)" for that bucket. */
  effectiveLimit: number | null;
  /** owned + the count of this exact variant already in the batch through
   * and including this row -- what inventory would read immediately after
   * this row is added. Reuses the same `wouldBe` accounting the color
   * decision below is already computed from (no duplicate walk of `rows`) --
   * the two-line readout's "AFTER ADD" value. */
  afterAdd: number;
}

export interface VerificationItem {
  row: Row;
  resolved: Extract<ResolveResult, { status: "resolved" }>;
  inv: InventoryStatus;
}

/** BL-151 S2b (§4-REV): the flattened per-row view AddCardsVerification's
 * table actually renders -- now the shared "Verify Cards" contract common to
 * both the manual (hand-typed) flow AND the precon-deck flow. VerificationItem
 * above still carries the FULL resolver state the keypad/axis pickers need;
 * VerificationRow is deliberately smaller -- exactly the handful of fields
 * the table cells read -- so a precon dry-run (which never touches this
 * axis resolver at all; its rows come back already resolved from the BL-54
 * import engine) can populate the identical shape from its own, completely
 * different source data (ImportReport rows, see utils/preconImport.ts's
 * verificationRowsFromReport) without fabricating meaningless ResolveResult
 * internals it has no way to produce honestly. */
export interface VerificationRow {
  id: string;
  /** Grouping key for the table's per-set header rows -- `row.setCode` for
   * the manual flow, `card.set_code` for precon. */
  groupKey: string;
  cardNumber: string;
  name: string;
  subtitle: string | null;
  /** The "Set" column's text -- manual: event + stamp (e.g. "Store Showdown
   * · Top 8"); precon: the constant "Base Set" (§3's rows are always the
   * Standard variant of their printed set). */
  setText: string;
  /** Colors the Set column the OP/tournament tint when true (manual only --
   * precon product decks never carry OP prints). */
  isOP: boolean;
  finishText: string;
  /** Pre-formatted Inventory column text -- manual: "owned/max"; precon:
   * "current → resulting" (the dry-run report's own before/after). */
  inventoryText: string;
  dotColor: "green" | "amber" | "red";
  /** BL-35's soft-cap "will still be added" note idiom, reused as-is by
   * precon's partially-trimmed rows. */
  overLimitNote?: string | null;
  /** Reason column text, skip-section rows only. */
  skipReason?: string | null;
}

/** The manual flow's own VerificationItem -> VerificationRow adapter: a pure
 * flattening, never a reclassification (an item splitForVerification already
 * sorted into willAdd/willSkip stays there). `skipReason` is the same
 * constant for every manual skip row today -- passed in by the caller
 * (AddCardsModal) rather than hardcoded here, so this module carries no UI
 * copy of its own. */
export function toVerificationRow(
  item: VerificationItem,
  skipReason: string | null = null
): VerificationRow {
  const { row, resolved, inv } = item;
  return {
    id: row.id,
    groupKey: row.setCode,
    cardNumber: row.cardNumber,
    name: resolved.name ?? "",
    subtitle: resolved.subtitle,
    setText: [resolved.set.value, resolved.stamp.value].filter(Boolean).join(" · "),
    isOP: resolved.channel !== "Retail",
    finishText: resolved.finish.value ?? "",
    // Owner dev review 2026-07-26 (round 7): "current → resulting", the same
    // display the precon flow's rows use (verificationRowsFromReport) --
    // replaces the old "owned/max". A red row is BLOCKED (nothing adds, in
    // both enforcement modes), so its resulting value is unchanged inventory,
    // not the afterAdd the batch would have produced.
    inventoryText: `${inv.owned} → ${inv.color === "red" ? inv.owned : inv.afterAdd}`,
    dotColor: inv.color,
    overLimitNote: inv.color === "amber" ? "Over your keep-limit — will still be added" : null,
    skipReason,
  };
}

/** BL-25: the Add Cards pre-check's per-variant cap. Pre-BL-24 this was a
 * pure function of base-card type (Leader/Base 1, else 3); it is now
 * bucket-aware and limits-aware -- the variant's bucket (finish ?? channel,
 * see utils/limits.ts) and category resolve against the tenant's effective
 * matrix, with "No limit" treated as the 999 technical ceiling. Stays a pure
 * function (the matrix is an argument, not module state): with no matrix
 * (anonymous / unfetched) or no bucket it returns the code defaults,
 * identical to the old constants. */
export function maxCopies(
  type: string,
  bucket: string | null = null,
  limits: LimitsMatrix | null = null
): number {
  const category = typeCategoryOf(type);
  if (bucket === null) return DEFAULT_LIMITS[category];
  return enforcementCap(limits, category, bucket);
}

// ── variant_type decomposition: (event, stamp, finish) ──────────────────────

const FROZEN_FINISHES = new Set([
  "Standard",
  "Standard Foil",
  "Hyperspace",
  "Hyperspace Foil",
  "Standard Prestige",
  "Foil Prestige",
  "Serialized Prestige",
  "Showcase",
]);

// Tournament event prefixes (BL-80 vocabulary, confirmed 2026-07-05).
const TOURNAMENT_EVENTS: Record<string, string> = {
  SS: "Store Showdown",
  PQ: "Planetary Qualifier",
  RQ: "Regional Qualifier",
  GC: "Galactic Championship",
  SQ: "Sector Qualifier",
};

// Non-prefixed labels that name their own event.
const STANDALONE_EVENTS: Record<string, string> = {
  "Judge Program": "Judge",
  "Convention Exclusive": "Convention",
  "Movie Promo": "Movie Promo",
  "Event Exclusive": "Event Exclusive",
};

// Fallback event when the variant_type carries no tournament/prerelease prefix:
// follow the backend-derived `channel` (which already folds in source_set_code,
// so a SORP "Hyperspace" promo reads as Weekly Play, not Base Set). BL-80.
const CHANNEL_TO_EVENT: Record<string, string> = {
  Retail: "Base Set",
  "Weekly Play": "Weekly Play",
  Judge: "Judge",
  Convention: "Convention",
  Movie: "Movie Promo",
  Prerelease: "Prerelease",
  "Promo / Tournament-tier": "Promo",
};

export interface Decomposition {
  event: string;
  stamp: string | null;
  finish: string;
}

/** Split a variant into its event (Set), stamp, and finish. Finish + stamp come
 * from the raw `variant_type`; the event follows a tournament/prerelease prefix
 * when present, else the `channel` (so provenance encoded via source set — e.g.
 * a SORP Hyperspace Weekly-Play promo — lands in the right event).
 *
 * NOTE (deferred, BL-31/40): the 21 SEC "Serialized Prestige" senator cards are
 * three physical finishes (Carbonite / Gold / Rose Gold) that share this exact
 * variant_type and differ only by image-filename suffix — so they collapse here
 * (one representative). When that distinction is parsed out later, per Jeremy's
 * 2026-07-05 call the three values belong in the **Finish** axis, not Stamp. */
export function decompose(variantType: string, channel: string): Decomposition {
  const finish = FROZEN_FINISHES.has(variantType)
    ? variantType
    : variantType.includes("Foil")
      ? "Standard Foil"
      : "Standard";

  const sp = variantType.indexOf(" ");
  const first = sp === -1 ? variantType : variantType.slice(0, sp);
  const rest = sp === -1 ? "" : variantType.slice(sp + 1);
  const stampOf = (s: string) => s.replace(/\s*Foil\s*$/, "").trim() || null;

  if (first in TOURNAMENT_EVENTS) {
    return { event: TOURNAMENT_EVENTS[first], stamp: stampOf(rest), finish };
  }
  if (first === "Prerelease") {
    return { event: "Prerelease", stamp: stampOf(rest), finish };
  }
  if (variantType in STANDALONE_EVENTS) {
    return { event: STANDALONE_EVENTS[variantType], stamp: null, finish };
  }
  // No structured prefix — the event is the card's provenance channel.
  return { event: CHANNEL_TO_EVENT[channel] ?? channel, stamp: null, finish };
}

// ── resolution ──────────────────────────────────────────────────────────────

interface Dec extends Decomposition {
  c: AddCardsCatalogEntry;
}

/** Exported for reuse by the keypad chip list and verification table, which
 * both group rows by `setCode` (BL-61). */
export function groupBy<T>(items: T[], keyOf: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = keyOf(it);
    const b = m.get(k);
    if (b) b.push(it);
    else m.set(k, [it]);
  }
  return m;
}

const HIDDEN_AXIS: AxisView = { show: false, value: null, options: [], needsPick: false };

/**
 * Resolve a row against the catalog, one axis at a time. Returns a uniform
 * per-axis view the keypad renders directly; `status` is "resolved" once every
 * axis has settled to a single value, "pending" while any axis needs a pick.
 */
export function resolveRow(row: Row, catalog: AddCardsCatalogEntry[]): ResolveResult {
  if (!row.cardNumber) return { status: "empty" };

  // Tokens share card_number space with playable cards (JTL #1 = Asajj Ventress
  // AND TIE Fighter Token). Exclude them so a token never silently resolves.
  const candidates = catalog.filter(
    (c) =>
      (c.set_code === row.setCode || c.source_set_code === row.setCode) &&
      c.card_number === row.cardNumber &&
      !c.is_token
  );
  if (candidates.length === 0) {
    return { status: "error", message: "Card# is not valid for the selected set." };
  }

  const dec: Dec[] = candidates.map((c) => ({ c, ...decompose(c.variant_type, c.channel) }));

  // ── Axis 1: which card (name + subtitle identity) ──
  const byCard = groupBy(dec, (d) => cardKeyOf(d.c.name, d.c.subtitle));
  const cardChoices: CardChoice[] = [...byCard.entries()].map(([key, ds]) => ({
    key,
    name: ds[0].c.name,
    subtitle: ds[0].c.subtitle,
  }));
  const cardShow = byCard.size > 1;

  let cardKey: string;
  if (byCard.size > 1) {
    let chosen: string | null = null;
    if (row.cardKey && byCard.has(row.cardKey)) chosen = row.cardKey;
    else {
      // Default to the true base-set card — the one with a Base Set *event*.
      // (Channel "Retail" is too weak: base-set tournament tiers like Mace
      // Windu's Store Showdown printings also classify as Retail, so at SOR #2
      // that would wrongly default to Mace Windu instead of Iden Versio.)
      // Blocking only when no base-set printing exists at this number.
      const baseSet = dec.find((d) => d.event === "Base Set");
      if (baseSet) chosen = cardKeyOf(baseSet.c.name, baseSet.c.subtitle);
    }
    if (!chosen) {
      return pending(null, null, null, {
        card: { show: true, choices: cardChoices, selectedKey: null, needsPick: true },
        set: HIDDEN_AXIS,
        stamp: HIDDEN_AXIS,
        finish: HIDDEN_AXIS,
      });
    }
    cardKey = chosen;
  } else {
    cardKey = cardChoices[0].key;
  }
  const dCard = byCard.get(cardKey)!;
  const { name, subtitle } = dCard[0].c;
  const cardAxis: CardAxisView = {
    show: cardShow,
    choices: cardChoices,
    selectedKey: cardKey,
    needsPick: false,
  };

  // ── Axis 2: Set (event) — default Base Set, overridable ──
  const byEvent = groupBy(dCard, (d) => d.event);
  const eventOptions = [...byEvent.keys()];
  let setValue: string;
  if (byEvent.size > 1) {
    let chosen: string | null = null;
    if (row.setKey && byEvent.has(row.setKey)) chosen = row.setKey;
    else if (byEvent.has("Base Set")) chosen = "Base Set";
    if (!chosen) {
      // No Base Set to default to — the user must pick the event.
      return pending(name, subtitle, null, {
        card: cardAxis,
        set: { show: true, value: null, options: eventOptions, needsPick: true },
        stamp: HIDDEN_AXIS,
        finish: HIDDEN_AXIS,
      });
    }
    setValue = chosen;
  } else {
    setValue = eventOptions[0];
  }
  const setAxis: AxisView = {
    show: true,
    value: setValue,
    options: byEvent.size > 1 ? eventOptions : [],
    needsPick: false,
  };
  const dEvent = byEvent.get(setValue)!;

  // ── Axis 3: Stamp — hidden unless the event carries stamps; required pick >1 ──
  const stampOptions = [...new Set(dEvent.map((d) => d.stamp).filter((s): s is string => !!s))];
  const stampShow = stampOptions.length > 0;
  let dStamp = dEvent;
  let stampValue: string | null = null;
  if (stampOptions.length > 1) {
    if (row.stamp && stampOptions.includes(row.stamp)) {
      stampValue = row.stamp;
      dStamp = dEvent.filter((d) => d.stamp === row.stamp);
    } else {
      return pending(name, subtitle, null, {
        card: cardAxis,
        set: setAxis,
        stamp: { show: true, value: null, options: stampOptions, needsPick: true },
        finish: HIDDEN_AXIS,
      });
    }
  } else if (stampOptions.length === 1) {
    stampValue = stampOptions[0];
    dStamp = dEvent.filter((d) => d.stamp === stampValue);
  }
  const stampAxis: AxisView = {
    show: stampShow,
    value: stampValue,
    options: stampOptions.length > 1 ? stampOptions : [],
    needsPick: false,
  };

  // ── Axis 4: Finish — required pick when >1 ──
  const finishOptions = [...new Set(dStamp.map((d) => d.finish))];
  let dFinish = dStamp;
  let finishValue = finishOptions[0];
  if (finishOptions.length > 1) {
    if (row.finish && finishOptions.includes(row.finish)) {
      finishValue = row.finish;
      dFinish = dStamp.filter((d) => d.finish === row.finish);
    } else {
      return pending(name, subtitle, null, {
        card: cardAxis,
        set: setAxis,
        stamp: stampAxis,
        finish: { show: true, value: null, options: finishOptions, needsPick: true },
      });
    }
  }
  const finishAxis: AxisView = {
    show: true,
    value: finishValue,
    options: finishOptions.length > 1 ? finishOptions : [],
    needsPick: false,
  };

  // dFinish should be a single variant; a genuine duplicate (the Serialized
  // Prestige image-collision case) resolves to the first deterministically.
  const chosenVariant = dFinish[0].c;
  return {
    status: "resolved",
    variantId: chosenVariant.id,
    type: chosenVariant.type,
    name,
    subtitle,
    channel: chosenVariant.channel,
    card: cardAxis,
    set: setAxis,
    stamp: stampAxis,
    finish: finishAxis,
  };
}

function pending(
  name: string | null,
  subtitle: string | null,
  channel: string | null,
  axes: Pick<ResolveState, "card" | "set" | "stamp" | "finish">
): ResolveResult {
  return { status: "pending", variantId: null, type: null, name, subtitle, channel, ...axes };
}

/** BL-35: "hard" (default) treats at/over-the-effective-limit as a hard
 * block (red, willSkip); "soft" instead flags it (amber, stays in willAdd)
 * -- see InventoryStatus.color and splitForVerification. The 999
 * QUANTITY_CEILING blocks (red) unconditionally in both modes. A "No
 * limit" bucket (effective limit null) never flags in either mode -- there
 * is no boundary to be over. */
export function inventoryStatus(
  rows: Row[],
  row: Row,
  resolved: Extract<ResolveResult, { status: "resolved" }>,
  catalog: AddCardsCatalogEntry[],
  limits: LimitsMatrix | null = null,
  mode: CapMode = "hard"
): InventoryStatus {
  const entry = catalog.find((c) => c.id === resolved.variantId);
  const owned = entry?.quantity ?? 0;
  const category = typeCategoryOf(resolved.type);
  // BL-25: per-variant effective limit -- the variant's own bucket
  // (finish ?? channel) resolved against the tenant's matrix. `entry` is
  // always found in practice (resolved.variantId came from this catalog);
  // the null-bucket fallback keeps the impossible branch on code defaults.
  const bucket = entry ? limitBucketOf(entry.finish, entry.channel) : null;
  const rawLimit =
    bucket === null ? DEFAULT_LIMITS[category] : effectiveLimit(limits, category, bucket);
  const max = rawLimit ?? QUANTITY_CEILING;

  const idx = rows.indexOf(row);
  let pendingThroughThis = 0;
  for (let i = 0; i <= idx; i++) {
    // Each row resolves against its own setCode (BL-61) — a cross-set batch
    // counts duplicate variants correctly even when rows span multiple sets.
    const rr = resolveRow(rows[i], catalog);
    if (rr.status === "resolved" && rr.variantId === resolved.variantId) {
      pendingThroughThis++;
    }
  }

  const wouldBe = owned + pendingThroughThis;

  // The 999 ceiling always blocks, in both modes -- checked first so it can
  // never be shadowed by an amber flag (only possible if rawLimit is a
  // number well below 999 and wouldBe somehow clears both).
  if (wouldBe > QUANTITY_CEILING) {
    return { color: "red", owned, max, effectiveLimit: rawLimit, afterAdd: wouldBe };
  }
  if (rawLimit !== null && wouldBe > rawLimit) {
    return {
      color: mode === "soft" ? "amber" : "red",
      owned,
      max,
      effectiveLimit: rawLimit,
      afterAdd: wouldBe,
    };
  }
  return { color: "green", owned, max, effectiveLimit: rawLimit, afterAdd: wouldBe };
}

export function splitForVerification(
  rows: Row[],
  catalog: AddCardsCatalogEntry[],
  limits: LimitsMatrix | null = null,
  mode: CapMode = "hard"
): { willAdd: VerificationItem[]; willSkip: VerificationItem[] } {
  const willAdd: VerificationItem[] = [];
  const willSkip: VerificationItem[] = [];

  rows.forEach((row) => {
    const res = resolveRow(row, catalog);
    if (res.status !== "resolved") return;
    const inv = inventoryStatus(rows, row, res, catalog, limits, mode);
    const item: VerificationItem = { row, resolved: res, inv };
    // BL-35: only a genuine block (red -- hard-mode over-limit, or the
    // ceiling in either mode) skips; amber (soft-mode over-limit) stays in
    // willAdd, just flagged.
    if (inv.color === "red") willSkip.push(item);
    else willAdd.push(item);
  });

  return { willAdd, willSkip };
}
