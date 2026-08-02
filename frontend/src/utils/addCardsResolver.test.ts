import { describe, it, expect } from "vitest";
import {
  resolveRow,
  inventoryStatus,
  splitForVerification,
  maxCopies,
  cardKeyOf,
  decompose,
} from "./addCardsResolver";
import { QUANTITY_CEILING, toMatrix } from "./limits";
import type { CardWithQty } from "../api/inventory";
import type { LimitCell } from "../api/settingsLimits";
import type { Row } from "./addCardsResolver";

// Four-axis Add Cards resolver (Card -> Set -> Stamp -> Finish). Each axis
// surfaces only when ambiguous; the resolver returns a uniform per-axis view
// and a "pending" | "resolved" status. This suite supersedes the earlier
// provenance/finish two-axis tests (BL-80 language: "Weekly Play", not "OP").
//
// DISPOSITION (BL-61 — cross-set batch persistence): `resolveRow`,
// `inventoryStatus`, and `splitForVerification` dropped their separate
// `sourceSetCode` parameter in favor of a `setCode` field carried on each
// `Row` (so a single batch can span multiple sets). Every existing test below
// is PORTed unchanged in intent — `makeRow` now defaults `setCode: "SOR"`
// (matching the string every one of these tests used to pass as the first
// arg), and call sites drop that now-redundant leading argument. Tests that
// previously passed a set other than "SOR" set it via `makeRow({ setCode })`
// instead. New coverage for the cross-set behavior itself lives in the
// "cross-set batch (BL-61)" describe block at the end of this file.

const CAP_CITY = cardKeyOf("Capital City", null);
const VEERS = cardKeyOf("General Veers", "Blizzard Force Commander");
const PALPATINE = cardKeyOf("Chancellor Palpatine", "Playing His Hand");
const CANTWELL = cardKeyOf("Cantwell Arrestor Cruiser", null);
const IDEN = cardKeyOf("Iden Versio", "Inferno Squad Commander");
const MACE = cardKeyOf("Mace Windu", "Party Crasher");

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeCard(overrides: Partial<CardWithQty>): CardWithQty {
  return {
    id: 1,
    base_card_id: 1,
    set_id: 1,
    set_code: "SOR",
    base_card_number: "1",
    card_number: "1",
    name: "Test Card",
    subtitle: null,
    rarity: "C",
    type: "Unit",
    variant_type: "Standard",
    finish: "Standard",
    channel: "Retail",
    stamped: false,
    is_token: false,
    source_set_code: "SOR",
    swuapi_id: "uuid-1",
    front_image_url: null,
    back_image_url: null,
    stamp_group: null,
    aspects: [],
    keywords: [],
    traits: [],
    cost: 3,
    power: 2,
    hp: 3,
    arena: "Ground",
    quantity: 0,
    ...overrides,
  };
}

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "test",
    setCode: "SOR",
    cardNumber: "20",
    cardKey: null,
    setKey: null,
    stamp: null,
    finish: null,
    ...overrides,
  };
}

// ─── Test catalog ────────────────────────────────────────────────────────────
//
// SOR #20: Capital City (Base Set) + General Veers (Weekly Play Std/Foil) —
//   two card identities; defaults to the retail Capital City, overridable.
// SOR #286: Capital City Hyperspace — single candidate, auto-resolves.
// SOR #69 / #334: Resilient Std/Foil and Hyper/Hyper-Foil — finish-only picks.
// SOR #10: Luke Skywalker Leader (max 1).
// SOR #2: Mace Windu Store Showdown tiers (Top 8 / Champion) — the Stamp axis.
// SOR #40: Grand Inquisitor Base Set + Prerelease — the Set axis (default Base).
// SEC #1: Chancellor Palpatine (Base Set) vs Cantwell Arrestor Cruiser (SECP
//   Weekly Play, home SEC) — cross-set family collision.
// SEC #900: two companion cards, no retail default — the blocking card pick.
// SEC #8 / #272: Bail Organa Standard / Hyperspace under their own numbering.
// SORP #520: General Veers Hyperspace Weekly-Play promo (channel drives event).

const sorCapCity = makeCard({
  id: 1,
  base_card_id: 1,
  base_card_number: "20",
  card_number: "20",
  type: "Base",
  name: "Capital City",
  subtitle: null,
});
const sorVeersWp = makeCard({
  id: 2,
  base_card_id: 2,
  base_card_number: "230",
  card_number: "20",
  type: "Unit",
  name: "General Veers",
  subtitle: "Blizzard Force Commander",
  channel: "Weekly Play",
  variant_type: "Weekly Play",
  source_set_code: "SOR",
});
const sorVeersWpFoil = makeCard({
  id: 3,
  base_card_id: 2,
  base_card_number: "230",
  card_number: "20",
  type: "Unit",
  name: "General Veers",
  subtitle: "Blizzard Force Commander",
  channel: "Weekly Play",
  variant_type: "Weekly Play Foil",
  source_set_code: "SOR",
});

// SORP Hyperspace promos: variant_type is a plain finish ("Hyperspace") but the
// channel is Weekly Play, so the Set/event must follow the channel, not the
// variant_type. Own SORP numbering (#520), home set_code "SOR".
const sorpHyperPromo = makeCard({
  id: 9,
  base_card_id: 2,
  base_card_number: "230",
  card_number: "520",
  type: "Unit",
  name: "General Veers",
  subtitle: "Blizzard Force Commander",
  channel: "Weekly Play",
  variant_type: "Hyperspace",
  finish: "Hyperspace",
  set_code: "SOR",
  source_set_code: "SORP",
});
const sorpHyperPromoFoil = makeCard({
  id: 11,
  base_card_id: 2,
  base_card_number: "230",
  card_number: "520",
  type: "Unit",
  name: "General Veers",
  subtitle: "Blizzard Force Commander",
  channel: "Weekly Play",
  variant_type: "Hyperspace Foil",
  finish: "Hyperspace Foil",
  set_code: "SOR",
  source_set_code: "SORP",
});

// SOR #2 shares a number between the Base Set card (Iden Versio) and a
// tournament card (Mace Windu's Store Showdown tiers). Both classify as channel
// "Retail" (the base-set tournament-tier quirk), so the default must key off
// the Base Set *event*, not the channel — Iden Versio, never Mace Windu.
const idenVersio = makeCard({
  id: 62,
  base_card_id: 62,
  base_card_number: "2",
  card_number: "2",
  type: "Leader",
  name: "Iden Versio",
  subtitle: "Inferno Squad Commander",
  variant_type: "Standard",
  channel: "Retail",
  finish: "Standard",
});
// Store Showdown tiers of one card at one number → the Stamp axis.
const maceWinduTop8 = makeCard({
  id: 60,
  base_card_id: 60,
  base_card_number: "2",
  card_number: "2",
  type: "Leader",
  name: "Mace Windu",
  subtitle: "Party Crasher",
  variant_type: "SS Top 8",
  channel: "Retail",
  finish: null,
});
const maceWinduChampion = makeCard({
  id: 61,
  base_card_id: 60,
  base_card_number: "2",
  card_number: "2",
  type: "Leader",
  name: "Mace Windu",
  subtitle: "Party Crasher",
  variant_type: "SS Champion",
  channel: "Retail",
  finish: null,
});

// Base Set + Prerelease of one card at one number → the Set axis.
const inquisitorStd = makeCard({
  id: 70,
  base_card_id: 70,
  base_card_number: "40",
  card_number: "40",
  type: "Unit",
  name: "Grand Inquisitor",
  subtitle: "Hunting the Jedi",
  variant_type: "Standard",
  channel: "Retail",
  finish: "Standard",
});
const inquisitorPrerelease = makeCard({
  id: 71,
  base_card_id: 70,
  base_card_number: "40",
  card_number: "40",
  type: "Unit",
  name: "Grand Inquisitor",
  subtitle: "Hunting the Jedi",
  variant_type: "Prerelease Promo",
  channel: "Prerelease",
  finish: null,
});

// Cross-set family collision (SEC #1) — Palpatine (Base Set) vs Cantwell (SECP).
const secPalpatine = makeCard({
  id: 30,
  base_card_id: 30,
  set_code: "SEC",
  base_card_number: "1",
  card_number: "1",
  type: "Leader",
  name: "Chancellor Palpatine",
  subtitle: "Playing His Hand",
  source_set_code: "SEC",
});
const secpCantwell = makeCard({
  id: 31,
  base_card_id: 31,
  set_code: "SEC",
  base_card_number: "37",
  card_number: "1",
  type: "Unit",
  name: "Cantwell Arrestor Cruiser",
  subtitle: null,
  variant_type: "Weekly Play",
  channel: "Weekly Play",
  finish: null,
  source_set_code: "SECP",
});

// Companion-vs-companion collision at SEC #900 (no retail card to default to).
const secpCompanionA = makeCard({
  id: 32,
  base_card_id: 32,
  set_code: "SEC",
  base_card_number: "300",
  card_number: "900",
  type: "Unit",
  name: "Companion A",
  variant_type: "Weekly Play",
  channel: "Weekly Play",
  finish: null,
  source_set_code: "SECP",
});
const secJudgeCompanionB = makeCard({
  id: 33,
  base_card_id: 33,
  set_code: "SEC",
  base_card_number: "301",
  card_number: "900",
  type: "Unit",
  name: "Companion B",
  variant_type: "Judge Program",
  channel: "Judge",
  finish: null,
  source_set_code: "J25",
});

const sorCapCityHyper = makeCard({
  id: 4,
  base_card_id: 1,
  base_card_number: "20",
  card_number: "286",
  type: "Base",
  name: "Capital City",
  subtitle: null,
  finish: "Hyperspace",
  variant_type: "Hyperspace",
});

const sorResilient = makeCard({
  id: 5,
  base_card_id: 5,
  base_card_number: "69",
  card_number: "69",
  type: "Upgrade",
  name: "Resilient",
  subtitle: null,
});
const sorResilientFoil = makeCard({
  id: 6,
  base_card_id: 5,
  base_card_number: "69",
  card_number: "69",
  type: "Upgrade",
  name: "Resilient",
  subtitle: null,
  finish: "Standard Foil",
  variant_type: "Standard Foil",
  quantity: 2,
});

const sorResilientHyper = makeCard({
  id: 7,
  base_card_id: 5,
  base_card_number: "69",
  card_number: "334",
  type: "Upgrade",
  name: "Resilient",
  subtitle: null,
  finish: "Hyperspace",
  variant_type: "Hyperspace",
});
const sorResilientHyperFoil = makeCard({
  id: 8,
  base_card_id: 5,
  base_card_number: "69",
  card_number: "334",
  type: "Upgrade",
  name: "Resilient",
  subtitle: null,
  finish: "Hyperspace Foil",
  variant_type: "Hyperspace Foil",
});

const sorLeader = makeCard({
  id: 10,
  base_card_id: 10,
  base_card_number: "10",
  card_number: "10",
  type: "Leader",
  name: "Luke Skywalker",
  subtitle: "Faithful Friend",
  quantity: 1,
});

const secStandard = makeCard({
  id: 20,
  base_card_id: 20,
  set_code: "SEC",
  base_card_number: "8",
  card_number: "8",
  type: "Leader",
  name: "Bail Organa",
  subtitle: "Doing Everything He Can",
  source_set_code: "SEC",
});
const secHyperspace = makeCard({
  id: 21,
  base_card_id: 20,
  set_code: "SEC",
  base_card_number: "8",
  card_number: "272",
  type: "Leader",
  name: "Bail Organa",
  subtitle: "Doing Everything He Can",
  finish: "Hyperspace",
  variant_type: "Hyperspace",
  source_set_code: "SEC",
});

// SOR #777: synthetic Prestige std/foil pair -- BL-191's conservative-guard
// fixture. Neither finish string is "Standard" or "Hyperspace", so the
// default rule doesn't apply and this stays a required pick.
const sorPrestigeStd = makeCard({
  id: 30,
  base_card_id: 30,
  base_card_number: "777",
  card_number: "777",
  type: "Leader",
  name: "Prestige Test Card",
  subtitle: null,
  finish: "Standard Prestige",
  variant_type: "Standard Prestige",
});
const sorPrestigeFoil = makeCard({
  id: 31,
  base_card_id: 30,
  base_card_number: "777",
  card_number: "777",
  type: "Leader",
  name: "Prestige Test Card",
  subtitle: null,
  finish: "Foil Prestige",
  variant_type: "Foil Prestige",
});

const catalog: CardWithQty[] = [
  sorCapCity,
  sorVeersWp,
  sorVeersWpFoil,
  sorpHyperPromo,
  sorpHyperPromoFoil,
  maceWinduTop8,
  maceWinduChampion,
  idenVersio,
  inquisitorStd,
  inquisitorPrerelease,
  sorCapCityHyper,
  sorResilient,
  sorResilientFoil,
  sorResilientHyper,
  sorResilientHyperFoil,
  sorLeader,
  secStandard,
  secHyperspace,
  secPalpatine,
  secpCantwell,
  secpCompanionA,
  secJudgeCompanionB,
  sorPrestigeStd,
  sorPrestigeFoil,
];

// ─── decompose ────────────────────────────────────────────────────────────────

describe("decompose", () => {
  it("maps a frozen finish to Base Set with that finish and no stamp", () => {
    expect(decompose("Standard", "Retail")).toEqual({
      event: "Base Set",
      stamp: null,
      finish: "Standard",
    });
    expect(decompose("Hyperspace Foil", "Retail")).toEqual({
      event: "Base Set",
      stamp: null,
      finish: "Hyperspace Foil",
    });
  });

  it("derives the event from channel when there is no structured prefix", () => {
    // A plain-finish variant_type from a Weekly Play source set is Weekly Play.
    expect(decompose("Hyperspace", "Weekly Play")).toEqual({
      event: "Weekly Play",
      stamp: null,
      finish: "Hyperspace",
    });
    expect(decompose("Weekly Play", "Weekly Play")).toEqual({
      event: "Weekly Play",
      stamp: null,
      finish: "Standard",
    });
    expect(decompose("Weekly Play Foil", "Weekly Play").finish).toBe("Standard Foil");
  });

  it("splits a tournament prefix into event + stamp, finish Standard", () => {
    expect(decompose("SS Top 8", "Retail")).toEqual({
      event: "Store Showdown",
      stamp: "Top 8",
      finish: "Standard",
    });
    expect(decompose("PQ Champion", "Retail").event).toBe("Planetary Qualifier");
    expect(decompose("GC VIP Promo", "Promo / Tournament-tier").stamp).toBe("VIP Promo");
  });

  it("splits Prerelease into event Prerelease + stamp", () => {
    expect(decompose("Prerelease Promo", "Prerelease")).toEqual({
      event: "Prerelease",
      stamp: "Promo",
      finish: "Standard",
    });
    expect(decompose("Prerelease Judge", "Judge").stamp).toBe("Judge");
  });

  it("maps standalone named events", () => {
    expect(decompose("Judge Program", "Judge").event).toBe("Judge");
    expect(decompose("Convention Exclusive", "Convention").event).toBe("Convention");
  });
});

// ─── maxCopies ───────────────────────────────────────────────────────────────
//
// DISPOSITION (BL-25, PORT): maxCopies grew from a pure function of base-card
// type into a (type, bucket, limits)-aware lookup against the tenant's
// effective matrix. The four pre-BL-25 assertions survive with identical
// numbers -- with no matrix fetched (anonymous/unfetched) the code defaults
// are byte-identical to the old hardcoded 1/3 -- re-expressed against the new
// signature's no-matrix path. The override / No-limit / ceiling behavior is
// net-new (CREATE) coverage below.

describe("maxCopies — defaults (no matrix fetched)", () => {
  it("returns 1 for Leader", () => expect(maxCopies("Leader")).toBe(1));
  it("returns 1 for Base", () => expect(maxCopies("Base")).toBe(1));
  it("returns 3 for Unit", () => expect(maxCopies("Unit")).toBe(3));
  it("returns 3 for Event", () => expect(maxCopies("Event")).toBe(3));

  it("returns the code defaults when a bucket is given but the matrix is null (unfetched fallback)", () => {
    expect(maxCopies("Leader", "Standard", null)).toBe(1);
    expect(maxCopies("Unit", "Weekly Play", null)).toBe(3);
  });
});

describe("maxCopies — effective limits (BL-25, CREATE)", () => {
  const limitCell = (overrides: Partial<LimitCell>): LimitCell => ({
    type_category: "standard",
    limit_bucket: "Standard",
    max_quantity: 3,
    is_default: true,
    ...overrides,
  });

  const limits = toMatrix([
    limitCell({ type_category: "standard", limit_bucket: "Standard", max_quantity: 3 }),
    limitCell({
      type_category: "standard",
      limit_bucket: "Showcase",
      max_quantity: 1,
      is_default: false,
    }),
    limitCell({
      type_category: "standard",
      limit_bucket: "Weekly Play",
      max_quantity: null,
      is_default: false,
    }),
    limitCell({
      type_category: "singleton",
      limit_bucket: "Standard",
      max_quantity: 2,
      is_default: false,
    }),
  ]);

  it("returns the fetched default cell's value", () => {
    expect(maxCopies("Unit", "Standard", limits)).toBe(3);
  });

  it("returns an override cell's value, per category", () => {
    expect(maxCopies("Unit", "Showcase", limits)).toBe(1);
    expect(maxCopies("Leader", "Standard", limits)).toBe(2);
  });

  it('treats "No limit" (null) as the 999 technical ceiling for pre-checks', () => {
    expect(maxCopies("Unit", "Weekly Play", limits)).toBe(QUANTITY_CEILING);
  });

  it("falls back to the code default for a bucket missing from the matrix", () => {
    expect(maxCopies("Unit", "Judge", limits)).toBe(3);
    expect(maxCopies("Base", "Judge", limits)).toBe(1);
  });
});

// ─── resolveRow: basic + card axis ────────────────────────────────────────────

describe("resolveRow — card axis", () => {
  it("returns empty when cardNumber is blank", () => {
    expect(resolveRow(makeRow({ cardNumber: "" }), catalog).status).toBe("empty");
  });

  it("returns error for an invalid card number", () => {
    const result = resolveRow(makeRow({ cardNumber: "999" }), catalog);
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.message).toMatch(/not valid/i);
  });

  it("resolves directly with no pickers when exactly one candidate exists", () => {
    const result = resolveRow(makeRow({ cardNumber: "286" }), catalog);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.variantId).toBe(sorCapCityHyper.id);
      expect(result.finish.value).toBe("Hyperspace");
      expect(result.set.value).toBe("Base Set");
      expect(result.card.show).toBe(false);
      expect(result.stamp.show).toBe(false);
    }
  });

  it("defaults a shared card_number to the retail card and exposes the alternatives", () => {
    const result = resolveRow(makeRow({ cardNumber: "20" }), catalog);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.variantId).toBe(sorCapCity.id);
      expect(result.card.show).toBe(true);
      expect(result.card.selectedKey).toBe(CAP_CITY);
      expect(result.card.choices.map((c) => c.key)).toEqual([CAP_CITY, VEERS]);
    }
  });

  it("blocks (pending) with a card pick only when no retail printing exists to default to", () => {
    const result = resolveRow(makeRow({ setCode: "SEC", cardNumber: "900" }), catalog);
    expect(result.status).toBe("pending");
    if (result.status === "pending") {
      expect(result.card.needsPick).toBe(true);
      expect(result.card.choices).toHaveLength(2);
    }
  });

  it("resolves once a card choice narrows to a single-finish card", () => {
    const result = resolveRow(makeRow({ cardNumber: "20", cardKey: CAP_CITY }), catalog);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.variantId).toBe(sorCapCity.id);
      expect(result.set.value).toBe("Base Set");
    }
  });

  // DISPOSITION (BL-191 — default the finish on shared-number early-set
  // cards, REPLACE): this used to assert `pending` + `needsPick` once General
  // Veers narrowed the card pick -- the finish axis now defaults to Standard
  // immediately (same rule exercised directly in "resolveRow — finish axis"
  // below), still overridable via the Finish options.
  it("after choosing General Veers at #20, the finish axis defaults to Standard — BL-191", () => {
    const result = resolveRow(makeRow({ cardNumber: "20", cardKey: VEERS }), catalog);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.name).toBe("General Veers");
      expect(result.set.value).toBe("Weekly Play");
      expect(result.finish.value).toBe("Standard");
      expect(result.finish.needsPick).toBe(false);
      expect(result.finish.defaulted).toBe(true);
      expect(result.finish.options).toEqual(["Standard", "Standard Foil"]);
    }
  });

  it("resolves the chosen Veers finish once card + finish are set", () => {
    const result = resolveRow(
      makeRow({ cardNumber: "20", cardKey: VEERS, finish: "Standard Foil" }),
      catalog
    );
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.variantId).toBe(sorVeersWpFoil.id);
      expect(result.set.value).toBe("Weekly Play");
      expect(result.finish.value).toBe("Standard Foil");
    }
  });

  it("clearing the card choice re-defaults to the retail card (ignores a stale finish)", () => {
    const result = resolveRow(
      makeRow({ cardNumber: "20", cardKey: null, finish: "Standard Foil" }),
      catalog
    );
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.variantId).toBe(sorCapCity.id);
      expect(result.card.selectedKey).toBe(CAP_CITY);
    }
  });
});

// ─── Cross-set family scoping (SEC #1) ────────────────────────────────────────

describe("resolveRow — family scoping", () => {
  it("base set reaches a companion-set printing, defaulting to the retail card", () => {
    const result = resolveRow(makeRow({ setCode: "SEC", cardNumber: "1" }), catalog);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.variantId).toBe(secPalpatine.id);
      expect(result.card.selectedKey).toBe(PALPATINE);
      expect(result.card.choices.map((c) => c.key)).toEqual([PALPATINE, CANTWELL]);
    }
  });

  it("switches to the companion printing when the alt card is explicitly picked", () => {
    const result = resolveRow(
      makeRow({ setCode: "SEC", cardNumber: "1", cardKey: CANTWELL }),
      catalog
    );
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.variantId).toBe(secpCantwell.id);
      expect(result.set.value).toBe("Weekly Play");
    }
  });

  it("a long-tail set selection scopes to its own printings only (no picker)", () => {
    const result = resolveRow(makeRow({ setCode: "SECP", cardNumber: "1" }), catalog);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.variantId).toBe(secpCantwell.id);
      expect(result.card.show).toBe(false);
      expect(result.set.value).toBe("Weekly Play");
    }
  });

  it("resolves fully within a long-tail source set once finish is picked", () => {
    const result = resolveRow(
      makeRow({ setCode: "SORP", cardNumber: "520", finish: "Hyperspace" }),
      catalog
    );
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.variantId).toBe(sorpHyperPromo.id);
      expect(result.set.value).toBe("Weekly Play");
    }
  });
});

// ─── Set axis (Base Set vs Prerelease) ────────────────────────────────────────

describe("resolveRow — set axis", () => {
  it("defaults to Base Set but exposes Prerelease as an overridable option", () => {
    const result = resolveRow(makeRow({ cardNumber: "40" }), catalog);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.variantId).toBe(inquisitorStd.id);
      expect(result.set.value).toBe("Base Set");
      expect(result.set.options).toEqual(["Base Set", "Prerelease"]);
    }
  });

  it("switches to the Prerelease printing when the Set is overridden", () => {
    const result = resolveRow(makeRow({ cardNumber: "40", setKey: "Prerelease" }), catalog);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.variantId).toBe(inquisitorPrerelease.id);
      expect(result.set.value).toBe("Prerelease");
      expect(result.stamp.value).toBe("Promo");
    }
  });
});

// ─── Stamp axis (Store Showdown tiers) ────────────────────────────────────────

describe("resolveRow — stamp axis", () => {
  it("defaults SOR #2 to the Base Set card (Iden Versio), not the same-number tournament card", () => {
    // Both Iden Versio (Base Set) and Mace Windu (Store Showdown tiers, channel
    // Retail) share #2 — the default must key off the Base Set event.
    const result = resolveRow(makeRow({ cardNumber: "2" }), catalog);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.variantId).toBe(idenVersio.id);
      expect(result.card.selectedKey).toBe(IDEN);
      expect(result.card.choices.map((c) => c.key)).toContain(MACE);
      expect(result.set.value).toBe("Base Set");
    }
  });

  it("surfaces the Stamp picker (required) once Mace Windu is chosen", () => {
    const result = resolveRow(makeRow({ cardNumber: "2", cardKey: MACE }), catalog);
    expect(result.status).toBe("pending");
    if (result.status === "pending") {
      expect(result.name).toBe("Mace Windu");
      expect(result.set.value).toBe("Store Showdown");
      expect(result.set.options).toEqual([]); // one event → read-only
      expect(result.stamp.show).toBe(true);
      expect(result.stamp.needsPick).toBe(true);
      expect(result.stamp.options).toEqual(["Top 8", "Champion"]);
    }
  });

  it("resolves to the chosen tier once card + Stamp are picked", () => {
    const result = resolveRow(
      makeRow({ cardNumber: "2", cardKey: MACE, stamp: "Champion" }),
      catalog
    );
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.variantId).toBe(maceWinduChampion.id);
      expect(result.set.value).toBe("Store Showdown");
      expect(result.stamp.value).toBe("Champion");
      expect(result.finish.value).toBe("Standard");
    }
  });
});

// ─── Finish axis ──────────────────────────────────────────────────────────────

describe("resolveRow — finish axis", () => {
  // DISPOSITION (BL-191 — default the finish for shared-number early-set
  // cards, REPLACE): these two used to assert `pending` + `needsPick` for
  // every multi-finish card_number. The resolver now defaults to the
  // probable (non-foil) finish -- Standard / Hyperspace -- and resolves
  // immediately, keeping the picker up (both options) as an overridable,
  // cued default rather than a block. The explicit-pick and single-option
  // tests below are UNCHANGED (existing explicit-selection path).
  it("defaults finish to Standard when a card_number maps to >1 finish (standard/foil) — BL-191", () => {
    const result = resolveRow(makeRow({ cardNumber: "69" }), catalog);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.variantId).toBe(sorResilient.id);
      expect(result.finish.value).toBe("Standard");
      expect(result.finish.needsPick).toBe(false);
      expect(result.finish.defaulted).toBe(true);
      expect(result.finish.options).toEqual(["Standard", "Standard Foil"]);
    }
  });

  it("defaults finish to Hyperspace for the hyperspace/hyperspace-foil pair — BL-191", () => {
    const result = resolveRow(makeRow({ cardNumber: "334" }), catalog);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.variantId).toBe(sorResilientHyper.id);
      expect(result.finish.value).toBe("Hyperspace");
      expect(result.finish.needsPick).toBe(false);
      expect(result.finish.defaulted).toBe(true);
      expect(result.finish.options).toEqual(["Hyperspace", "Hyperspace Foil"]);
    }
  });

  // BL-191: an option set with neither "Standard" nor "Hyperspace" to
  // default to keeps the original required-pick behavior (conservative
  // guard) -- exercised via a synthetic Prestige-style pair.
  it("keeps finish a required pick when the option set has neither Standard nor Hyperspace to default to", () => {
    const result = resolveRow(makeRow({ cardNumber: "777" }), catalog);
    expect(result.status).toBe("pending");
    if (result.status === "pending") {
      expect(result.finish.needsPick).toBe(true);
      expect(result.finish.defaulted).toBeFalsy();
      expect(result.finish.options).toEqual(["Standard Prestige", "Foil Prestige"]);
    }
  });

  it("resolves once finish is picked from a multi-finish card_number", () => {
    const result = resolveRow(makeRow({ cardNumber: "69", finish: "Standard Foil" }), catalog);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.variantId).toBe(sorResilientFoil.id);
      expect(result.finish.value).toBe("Standard Foil");
    }
  });

  it("resolves a hyperspace variant via its own card_number in a different source set", () => {
    const result = resolveRow(makeRow({ setCode: "SEC", cardNumber: "272" }), catalog);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.variantId).toBe(secHyperspace.id);
      expect(result.finish.value).toBe("Hyperspace");
    }
  });

  it("resolves the standard variant via its base card_number in a different source set", () => {
    const result = resolveRow(makeRow({ setCode: "SEC", cardNumber: "8" }), catalog);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.variantId).toBe(secStandard.id);
  });

  it("a card_number absent from the selected set family errors", () => {
    expect(resolveRow(makeRow({ cardNumber: "8" }), catalog).status).toBe("error");
  });

  it("uses the real subtitle field directly (no hyphen-splitting)", () => {
    const result = resolveRow(makeRow({ cardNumber: "10" }), catalog);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.name).toBe("Luke Skywalker");
      expect(result.subtitle).toBe("Faithful Friend");
    }
  });
});

// ─── inventoryStatus ─────────────────────────────────────────────────────────

describe("inventoryStatus", () => {
  it("returns green when owned + pending is under max", () => {
    const row = makeRow({ cardNumber: "69", finish: "Standard Foil" });
    const resolved = resolveRow(row, catalog);
    expect(resolved.status).toBe("resolved");
    if (resolved.status !== "resolved") return;
    const status = inventoryStatus([row], row, resolved, catalog);
    expect(status.color).toBe("green");
    expect(status.owned).toBe(2);
    expect(status.max).toBe(3);
  });

  it("returns red when owned + pending exceeds max", () => {
    const row1 = makeRow({ id: "r1", cardNumber: "69", finish: "Standard Foil" });
    const row2 = makeRow({ id: "r2", cardNumber: "69", finish: "Standard Foil" });
    const rows = [row1, row2];
    const resolved = resolveRow(row2, catalog);
    expect(resolved.status).toBe("resolved");
    if (resolved.status !== "resolved") return;
    expect(inventoryStatus(rows, row2, resolved, catalog).color).toBe("red");
  });

  it("counts only rows up to and including the current row (not later rows)", () => {
    const row1 = makeRow({ id: "r1", cardNumber: "20", cardKey: CAP_CITY });
    const row2 = makeRow({ id: "r2", cardNumber: "20", cardKey: CAP_CITY });
    const row3 = makeRow({ id: "r3", cardNumber: "20", cardKey: CAP_CITY });
    const rows = [row1, row2, row3];
    const resolved = resolveRow(row1, catalog);
    expect(resolved.status).toBe("resolved");
    if (resolved.status !== "resolved") return;
    expect(inventoryStatus(rows, row1, resolved, catalog).owned).toBe(0);
    expect(inventoryStatus(rows, row3, resolved, catalog).color).toBe("red"); // 0+3 > 1
  });

  it("returns red for a Leader already at limit (max=1)", () => {
    const row = makeRow({ cardNumber: "10" });
    const resolved = resolveRow(row, catalog);
    expect(resolved.status).toBe("resolved");
    if (resolved.status !== "resolved") return;
    const status = inventoryStatus([row], row, resolved, catalog);
    expect(status.color).toBe("red");
    expect(status.max).toBe(1);
  });

  // CREATE (BL-25): the matrix threads through to the pre-check -- the
  // variant's own bucket (finish ?? channel) picks the effective cell.
  it("uses an override for the variant's bucket when a matrix is passed", () => {
    // #69 Standard Foil, owned 2: default max 3 is green; a Standard Foil
    // override of 2 makes owned+pending (2+1) exceed max -> red.
    const limits = toMatrix([
      {
        type_category: "standard",
        limit_bucket: "Standard Foil",
        max_quantity: 2,
        is_default: false,
      },
    ]);
    const row = makeRow({ cardNumber: "69", finish: "Standard Foil" });
    const resolved = resolveRow(row, catalog);
    expect(resolved.status).toBe("resolved");
    if (resolved.status !== "resolved") return;
    const status = inventoryStatus([row], row, resolved, catalog, limits);
    expect(status.max).toBe(2);
    expect(status.color).toBe("red");
  });

  it('a "No limit" cell lifts a Leader that was red at the default to green (max=999)', () => {
    const limits = toMatrix([
      {
        type_category: "singleton",
        limit_bucket: "Standard",
        max_quantity: null,
        is_default: false,
      },
    ]);
    const row = makeRow({ cardNumber: "10" });
    const resolved = resolveRow(row, catalog);
    expect(resolved.status).toBe("resolved");
    if (resolved.status !== "resolved") return;
    const status = inventoryStatus([row], row, resolved, catalog, limits);
    expect(status.max).toBe(QUANTITY_CEILING);
    expect(status.color).toBe("green");
  });

  // CREATE (BL-111 F7): the two-line inventory readout (AddCardsKeypad's
  // InventoryReadout) needs both the true effective limit (distinct from
  // `max`, which substitutes the 999 ceiling for "No limit") and the
  // after-this-add count. Both are additive fields -- every assertion above
  // this block only reads .color/.owned/.max, so nothing already covered
  // changes shape.
  describe("effectiveLimit / afterAdd (BL-111 F7)", () => {
    it("effectiveLimit matches max and afterAdd is owned+1 for a fresh green add", () => {
      const row = makeRow({ cardNumber: "69", finish: "Standard Foil" }); // owned 2, max 3
      const resolved = resolveRow(row, catalog);
      expect(resolved.status).toBe("resolved");
      if (resolved.status !== "resolved") return;
      const status = inventoryStatus([row], row, resolved, catalog);
      expect(status.effectiveLimit).toBe(3);
      expect(status.owned).toBe(2);
      expect(status.afterAdd).toBe(3);
    });

    it("afterAdd counts earlier batch copies of the same variant plus this one", () => {
      const row1 = makeRow({ id: "r1", cardNumber: "20", cardKey: CAP_CITY });
      const row2 = makeRow({ id: "r2", cardNumber: "20", cardKey: CAP_CITY });
      const rows = [row1, row2];
      const resolved = resolveRow(row2, catalog);
      expect(resolved.status).toBe("resolved");
      if (resolved.status !== "resolved") return;
      // Capital City (Base) owned 0; row1 + row2 both resolve to it, so by
      // row2 afterAdd should be 0 + 1 (row1) + 1 (row2 itself) = 2.
      const status = inventoryStatus(rows, row2, resolved, catalog);
      expect(status.afterAdd).toBe(2);
    });

    it('effectiveLimit is null for a "No limit" bucket even though max substitutes the 999 ceiling', () => {
      const limits = toMatrix([
        {
          type_category: "singleton",
          limit_bucket: "Standard",
          max_quantity: null,
          is_default: false,
        },
      ]);
      const row = makeRow({ cardNumber: "10" });
      const resolved = resolveRow(row, catalog);
      expect(resolved.status).toBe("resolved");
      if (resolved.status !== "resolved") return;
      const status = inventoryStatus([row], row, resolved, catalog, limits);
      expect(status.max).toBe(QUANTITY_CEILING);
      expect(status.effectiveLimit).toBeNull();
      expect(status.afterAdd).toBe(2); // owned 1 + this add
    });

    it("effectiveLimit reflects a per-bucket override, matching max", () => {
      const limits = toMatrix([
        {
          type_category: "standard",
          limit_bucket: "Standard Foil",
          max_quantity: 2,
          is_default: false,
        },
      ]);
      const row = makeRow({ cardNumber: "69", finish: "Standard Foil" });
      const resolved = resolveRow(row, catalog);
      expect(resolved.status).toBe("resolved");
      if (resolved.status !== "resolved") return;
      const status = inventoryStatus([row], row, resolved, catalog, limits);
      expect(status.effectiveLimit).toBe(2);
      expect(status.max).toBe(2);
      expect(status.color).toBe("red"); // owned 2 + this add (3) > 2
      expect(status.afterAdd).toBe(3);
    });
  });
});

// ─── splitForVerification ────────────────────────────────────────────────────

describe("splitForVerification", () => {
  it("puts green rows in willAdd and red rows in willSkip", () => {
    const rowFoil = makeRow({ id: "f", cardNumber: "69", finish: "Standard Foil" });
    const rowLeader = makeRow({ id: "l", cardNumber: "10" });
    const { willAdd, willSkip } = splitForVerification([rowFoil, rowLeader], catalog);
    expect(willAdd.some((x) => x.row.id === "f")).toBe(true);
    expect(willSkip.some((x) => x.row.id === "l")).toBe(true);
  });

  // DISPOSITION (BL-191, REPLACE): the pending fixture row used to be
  // cardNumber "69" (Standard/Standard Foil), which now defaults instead of
  // pending. Swapped to "777" (the synthetic Prestige pair, neither finish
  // defaultable) -- still genuinely pending, preserving this test's intent.
  it("ignores empty, error, and pending (not-yet-disambiguated) rows", () => {
    const rows = [
      makeRow({ id: "e", cardNumber: "" }),
      makeRow({ id: "x", cardNumber: "999" }),
      makeRow({ id: "p", cardNumber: "777" }), // pending: needs a finish pick
    ];
    const { willAdd, willSkip } = splitForVerification(rows, catalog);
    expect(willAdd).toHaveLength(0);
    expect(willSkip).toHaveLength(0);
  });

  // CREATE (BL-25): the matrix threads through the verification split too --
  // the same Leader row that skips at the default singleton limit adds once
  // its cell is "No limit".
  it("applies a passed limits matrix when splitting willAdd/willSkip", () => {
    const limits = toMatrix([
      {
        type_category: "singleton",
        limit_bucket: "Standard",
        max_quantity: null,
        is_default: false,
      },
    ]);
    const rowLeader = makeRow({ id: "l", cardNumber: "10" });
    const { willAdd, willSkip } = splitForVerification([rowLeader], catalog, limits);
    expect(willAdd.some((x) => x.row.id === "l")).toBe(true);
    expect(willSkip).toHaveLength(0);
  });
});

// ─── cap_mode-aware inventoryStatus / splitForVerification (BL-35) ──────────
//
// CREATE: net-new "soft" mode parameter. In hard mode (the default, no
// mode arg) behavior is unchanged, per the tests above; these cover the
// soft-mode amber flag, "No limit" never flagging, and the ceiling still
// blocking (red) regardless of mode.

describe("inventoryStatus — cap_mode (BL-35)", () => {
  it("soft mode flags an over-limit row amber instead of red", () => {
    // Leader at #10 already owns 1 (== the default singleton limit of 1).
    const row = makeRow({ cardNumber: "10" });
    const resolved = resolveRow(row, catalog);
    expect(resolved.status).toBe("resolved");
    if (resolved.status !== "resolved") return;

    const hard = inventoryStatus([row], row, resolved, catalog, null, "hard");
    expect(hard.color).toBe("red");

    const soft = inventoryStatus([row], row, resolved, catalog, null, "soft");
    expect(soft.color).toBe("amber");
    expect(soft.max).toBe(1);
  });

  it('a "No limit" bucket never flags amber in soft mode', () => {
    const limits = toMatrix([
      {
        type_category: "singleton",
        limit_bucket: "Standard",
        max_quantity: null,
        is_default: false,
      },
    ]);
    const row = makeRow({ cardNumber: "10" });
    const resolved = resolveRow(row, catalog);
    expect(resolved.status).toBe("resolved");
    if (resolved.status !== "resolved") return;

    const status = inventoryStatus([row], row, resolved, catalog, limits, "soft");
    expect(status.color).toBe("green");
  });

  it("defaults to hard mode when no mode argument is passed", () => {
    const row = makeRow({ cardNumber: "10" });
    const resolved = resolveRow(row, catalog);
    expect(resolved.status).toBe("resolved");
    if (resolved.status !== "resolved") return;
    expect(inventoryStatus([row], row, resolved, catalog).color).toBe("red");
  });

  it("green stays green in soft mode (below the limit)", () => {
    const row = makeRow({ cardNumber: "69", finish: "Standard Foil" }); // owned 2, max 3
    const resolved = resolveRow(row, catalog);
    expect(resolved.status).toBe("resolved");
    if (resolved.status !== "resolved") return;
    expect(inventoryStatus([row], row, resolved, catalog, null, "soft").color).toBe("green");
  });
});

describe("splitForVerification — cap_mode (BL-35)", () => {
  it("soft mode keeps an over-limit row in willAdd (amber), not willSkip", () => {
    const rowLeader = makeRow({ cardNumber: "10" }); // already at the Leader limit
    const { willAdd, willSkip } = splitForVerification([rowLeader], catalog, null, "soft");

    expect(willSkip).toHaveLength(0);
    expect(willAdd).toHaveLength(1);
    expect(willAdd[0].inv.color).toBe("amber");
  });

  it("hard mode (default) still skips the same over-limit row", () => {
    const rowLeader = makeRow({ cardNumber: "10" });
    const { willAdd, willSkip } = splitForVerification([rowLeader], catalog);

    expect(willAdd).toHaveLength(0);
    expect(willSkip).toHaveLength(1);
  });

  it("the 999 ceiling still skips (red) in soft mode even for an unlimited bucket", () => {
    const limits = toMatrix([
      {
        type_category: "standard",
        limit_bucket: "Standard Foil",
        max_quantity: null,
        is_default: false,
      },
    ]);
    // #69 Standard Foil is owned 2 in the fixture catalog; simulate it
    // already sitting at the ceiling via a variant with quantity 999.
    const ceilingCard = makeCard({
      id: 999,
      base_card_id: 5,
      base_card_number: "69",
      card_number: "69",
      type: "Upgrade",
      name: "Resilient",
      finish: "Standard Foil",
      variant_type: "Standard Foil",
      quantity: QUANTITY_CEILING,
    });
    const ceilingCatalog = [...catalog.filter((c) => c.id !== 6), ceilingCard];
    const row = makeRow({ cardNumber: "69", finish: "Standard Foil" });
    const resolved = resolveRow(row, ceilingCatalog);
    expect(resolved.status).toBe("resolved");
    if (resolved.status !== "resolved") return;

    const { willAdd, willSkip } = splitForVerification([row], ceilingCatalog, limits, "soft");
    expect(willSkip).toHaveLength(1);
    expect(willAdd).toHaveLength(0);
    expect(willSkip[0].inv.color).toBe("red");
  });
});

// ─── Token exclusion (BL-67) ─────────────────────────────────────────────────

describe("resolveRow — token exclusion", () => {
  const jtlLeader = makeCard({
    id: 100,
    set_code: "JTL",
    source_set_code: "JTL",
    card_number: "1",
    base_card_number: "1",
    name: "Asajj Ventress",
    type: "Leader",
    is_token: false,
  });
  const jtlToken = makeCard({
    id: 101,
    set_code: "JTL",
    source_set_code: "JTL",
    card_number: "1",
    base_card_number: "1",
    name: "TIE Fighter Token",
    type: "Unit",
    is_token: true,
  });
  const jtlCatalog = [jtlLeader, jtlToken];

  it("resolves to the playable card, not the token, when both share a card_number", () => {
    const result = resolveRow(makeRow({ setCode: "JTL", cardNumber: "1" }), jtlCatalog);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.variantId).toBe(100);
      expect(result.name).toBe("Asajj Ventress");
    }
  });

  it("does not surface a card pick due to a token sharing the same number", () => {
    // With the token excluded only the Leader remains, so it resolves rather
    // than looking like a two-card collision.
    const result = resolveRow(makeRow({ setCode: "JTL", cardNumber: "1" }), jtlCatalog);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.card.show).toBe(false);
  });

  it("errors when only a token exists at the card_number (no playable card)", () => {
    const result = resolveRow(makeRow({ setCode: "JTL", cardNumber: "1" }), [jtlToken]);
    expect(result.status).toBe("error");
  });
});

// ─── Cross-set batch (BL-61) ─────────────────────────────────────────────────
// A single batch can now contain rows entered against different sets; each
// row must resolve against — and only against — its own setCode.

describe("resolveRow / splitForVerification — cross-set batch (BL-61)", () => {
  it("resolves each row correctly against its own set when a batch mixes SOR and SEC rows", () => {
    const sorRow = makeRow({ id: "sor-row", setCode: "SOR", cardNumber: "10" });
    const secRow = makeRow({ id: "sec-row", setCode: "SEC", cardNumber: "8" });

    const sorResult = resolveRow(sorRow, catalog);
    const secResult = resolveRow(secRow, catalog);

    expect(sorResult.status).toBe("resolved");
    expect(secResult.status).toBe("resolved");
    if (sorResult.status === "resolved" && secResult.status === "resolved") {
      expect(sorResult.variantId).toBe(sorLeader.id);
      expect(secResult.variantId).toBe(secStandard.id);
    }
  });

  it("a card_number valid in one set but not the other errors only for the wrong set", () => {
    // #8 exists in the SEC family (Bail Organa) but not in the SOR family.
    const secRow = makeRow({ id: "sec-row", setCode: "SEC", cardNumber: "8" });
    const sorRow = makeRow({ id: "sor-row", setCode: "SOR", cardNumber: "8" });
    expect(resolveRow(secRow, catalog).status).toBe("resolved");
    expect(resolveRow(sorRow, catalog).status).toBe("error");
  });

  it("splitForVerification resolves a mixed-set batch, keeping each row's own set", () => {
    const sorRow = makeRow({ id: "sor-row", setCode: "SOR", cardNumber: "10" });
    const secRow = makeRow({ id: "sec-row", setCode: "SEC", cardNumber: "8" });
    const { willAdd, willSkip } = splitForVerification([sorRow, secRow], catalog);

    // Luke Skywalker (SOR #10) is already at his Leader limit (quantity 1) —
    // it should skip, while Bail Organa (SEC #8, quantity 0) should add.
    expect(willSkip.some((x) => x.row.id === "sor-row")).toBe(true);
    expect(willAdd.some((x) => x.row.id === "sec-row")).toBe(true);
    expect(willAdd.find((x) => x.row.id === "sec-row")?.row.setCode).toBe("SEC");
    expect(willSkip.find((x) => x.row.id === "sor-row")?.row.setCode).toBe("SOR");
  });

  it("counts duplicate-variant inventory pressure within matching rows only, across sets", () => {
    // Two rows both resolving to the same SEC #8 variant (id 20) should stack
    // against that variant's max=1 (Leader) even though other rows in the
    // batch belong to a different set entirely.
    const secRow1 = makeRow({ id: "sec-1", setCode: "SEC", cardNumber: "8" });
    const secRow2 = makeRow({ id: "sec-2", setCode: "SEC", cardNumber: "8" });
    const sorRow = makeRow({
      id: "sor-row",
      setCode: "SOR",
      cardNumber: "69",
      finish: "Standard Foil",
    });
    const rows = [secRow1, sorRow, secRow2];

    const resolvedSecRow2 = resolveRow(secRow2, catalog);
    expect(resolvedSecRow2.status).toBe("resolved");
    if (resolvedSecRow2.status !== "resolved") return;
    expect(inventoryStatus(rows, secRow2, resolvedSecRow2, catalog).color).toBe("red"); // 0+2 > 1
  });
});
