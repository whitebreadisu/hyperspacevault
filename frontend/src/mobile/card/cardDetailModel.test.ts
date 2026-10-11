import { describe, expect, it } from "vitest";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";
import {
  entryVariant,
  navEntryVariant,
  groupPrintings,
  orderPrintings,
  railPrice,
  regionGeom,
  stepperState,
} from "./cardDetailModel";
import { navPosition } from "./navList";

const v = (
  id: number,
  finish: string,
  set: string,
  num: string,
  extra: Partial<InventoryVariant> = {}
): InventoryVariant => ({
  variant_id: id,
  variant_type: finish,
  finish,
  channel: "Retail",
  source_set_code: set,
  card_number: num,
  front_image_url: null,
  back_image_url: null,
  quantity: 0,
  ...extra,
});

const card = (variants: InventoryVariant[], type = "Unit"): InventoryCard => ({
  base_card_id: 87,
  set_code: "SOR",
  base_card_number: "87",
  name: "Darth Vader",
  subtitle: null,
  type,
  rarity: "Legendary",
  aspects: [],
  keywords: [],
  traits: [],
  cost: 7,
  power: 5,
  hp: 8,
  arena: "Ground",
  is_token: false,
  variants,
  inventory: {},
});

const VADER = card([
  v(3760, "GC Day Three", "P25", "103"),
  v(7221, "Standard", "SOR", "87"),
  v(6795, "Hyperspace", "SOR", "351"),
  v(269, "Convention Exclusive", "C24", "2"),
]);

describe("S2-01 entry printing resolution", () => {
  it("opens on the printing the list showed (?v=) first", () => {
    expect(entryVariant(VADER, { v: 6795, scope: "Standard" })?.variant_id).toBe(6795);
  });
  it("an unknown ?v= falls through to the scoped default", () => {
    expect(entryVariant(VADER, { v: 999, scope: "Hyperspace" })?.variant_id).toBe(6795);
  });
  it("a scoped Vault picks the scoped finish's printing (R5-5 default only)", () => {
    expect(entryVariant(VADER, { scope: "Hyperspace" })?.variant_id).toBe(6795);
  });
  it("a scope the card does not carry falls back to the representative", () => {
    expect(entryVariant(VADER, { scope: "Showcase" })?.variant_id).toBe(7221);
  });
  it("no ?v=, no scope: the representative (Standard, else the first)", () => {
    expect(entryVariant(VADER)?.variant_id).toBe(7221);
    const noStd = card([v(1, "Hyperspace", "SOR", "300"), v(2, "Showcase", "SOR", "9")]);
    expect(entryVariant(noStd)?.variant_id).toBe(1);
  });
  it("n of m: the published list when it holds the card, else the fallback, never narrowed", () => {
    const ctx = { ids: [5, 87, 9], narrowed: true, scope: "Hyperspace" };
    expect(navPosition(87, ctx, [1, 2, 87])).toEqual({
      list: [5, 87, 9],
      pos: 1,
      narrowed: true,
      scope: "Hyperspace",
      // S2-09 PORT: the position now also carries the list surface + facet
      // values (a context published without them reads as rows, no facet).
      source: "row",
      finishes: [],
    });
    expect(navPosition(2, ctx, [1, 2, 87])).toEqual({
      list: [1, 2, 87],
      pos: 1,
      narrowed: false,
      scope: null,
      source: null,
      finishes: [],
    });
    expect(navPosition(2, null, [1, 2]).narrowed).toBe(false);
  });
});

describe("S2-04 printings order and labels (desktop CardPopupRail)", () => {
  it("base set first, other sources alphabetically, numbers ascending", () => {
    const ordered = orderPrintings(VADER.variants, "SOR").map((x) => x.variant_id);
    expect(ordered).toEqual([7221, 6795, 269, 3760]);
    const groups = groupPrintings(orderPrintings(VADER.variants, "SOR"), "SOR", {
      P25: "2025 Promos",
    });
    expect(groups.map((g) => g.label)).toEqual(["Base set", "C24", "2025 Promos"]);
  });
  it("rail price: two decimals for the mode, an em dash when unpriced", () => {
    const priced = { price: { market: 6.8, low: 4, as_of: "2026-10-01" } };
    expect(railPrice(priced, "market")).toBe("$6.80");
    expect(railPrice(priced, "low")).toBe("$4.00");
    expect(railPrice({ price: null }, "market")).toBe("—");
    expect(railPrice({ price: { market: null, low: 1, as_of: "x" } }, "market")).toBe("—");
  });
});

describe("S2-02 region geometry (rev4 regionGeom)", () => {
  it("portrait unit: 392 x 280, collapsed 80 x 57, delta = full - 100", () => {
    const g = regionGeom({ type: "Unit" }, { back_image_url: null }, false);
    expect([g.artH, g.artW, g.cH, g.cW, g.land]).toEqual([392, 280, 80, 57, false]);
    expect(g.delta).toBe(g.full - 100);
  });
  it("a base is landscape (238 x 333, collapsed 80 x 112); a leader's back is portrait", () => {
    const b = regionGeom({ type: "Base" }, { back_image_url: null }, false);
    expect([b.artH, b.artW, b.cW, b.land]).toEqual([238, 333, 112, true]);
    const front = regionGeom({ type: "Leader" }, { back_image_url: "x" }, false);
    const back = regionGeom({ type: "Leader" }, { back_image_url: "x" }, true);
    expect(front.land).toBe(true);
    expect(back.land).toBe(false);
    expect(front.full - back.full).toBe(238 - 392);
    expect(front.hasBack).toBe(true);
  });
});

describe("S2-05 stepper limit rules (desktop InventoryPlate)", () => {
  const std = { finish: "Standard", channel: "Retail" };
  it("hard mode: + stops at the cap, readout red at the limit", () => {
    const s = stepperState(std, 3, "standard", null, "hard");
    expect(s.rawLimit).toBe(3);
    expect(s.incDisabled).toBe(true);
    expect(s.atOrOverLimit).toBe(true);
    expect(s.softOverLimit).toBe(false);
  });
  it("soft mode: + continues, amber over the limit; − stops at 0", () => {
    const s = stepperState(std, 4, "standard", null, "soft");
    expect(s.incDisabled).toBe(false);
    expect(s.softOverLimit).toBe(true);
    expect(stepperState(std, 0, "standard", null, "soft").decDisabled).toBe(true);
  });
});

describe("S2-09 nav entry resolution (prev / next on the matching printing)", () => {
  // rev4 M.navEntry + desktop BL-193 / BL-201: the neighbour opens on the
  // printing its own surface would show -- a scoped row its scoped
  // printing, a gallery cell the printing it displays.
  const SHD = card([
    v(1, "Standard", "SHD", "40"),
    v(2, "Hyperspace", "SHD", "300"),
    v(3, "Hyperspace", "SHD", "299"),
    v(4, "Foil", "SHD", "40"),
  ]);
  it("rows: the scoped printing (first printing carrying the scope)", () => {
    const nav = { source: "row" as const, scope: "Hyperspace", finishes: ["Hyperspace"] };
    expect(navEntryVariant(SHD, nav)?.variant_id).toBe(2);
    expect(navEntryVariant(VADER, nav)?.variant_id).toBe(6795);
  });
  it("gallery: the displayed printing (lowest-numbered carrying a facet value)", () => {
    const nav = { source: "gallery" as const, scope: "Hyperspace", finishes: ["Hyperspace"] };
    expect(navEntryVariant(SHD, nav)?.variant_id).toBe(3);
    const two = { source: "gallery" as const, scope: null, finishes: ["Foil", "Hyperspace"] };
    expect(navEntryVariant(SHD, two)?.variant_id).toBe(4);
  });
  it("no scope / no facet / no match: the representative", () => {
    expect(navEntryVariant(SHD, { source: "row", scope: null, finishes: [] })?.variant_id).toBe(1);
    expect(
      navEntryVariant(VADER, { source: "gallery", scope: null, finishes: ["Foil"] })?.variant_id
    ).toBe(7221);
    expect(navEntryVariant(SHD, { source: null, scope: null, finishes: [] })?.variant_id).toBe(1);
  });
  it("?v= still wins over the list rule", () => {
    const nav = { source: "row" as const, scope: "Hyperspace", finishes: [] };
    expect(navEntryVariant(SHD, nav, 4)?.variant_id).toBe(4);
  });
  it("navPosition carries the list's surface and facet values", () => {
    const ctx = {
      ids: [9, 87],
      narrowed: true,
      scope: "Hyperspace",
      source: "gallery" as const,
      finishes: ["Hyperspace"],
    };
    expect(navPosition(87, ctx, [])).toMatchObject({
      pos: 1,
      source: "gallery",
      finishes: ["Hyperspace"],
    });
    expect(navPosition(5, ctx, [5])).toMatchObject({
      pos: 0,
      source: null,
      finishes: [],
      narrowed: false,
    });
  });
});
