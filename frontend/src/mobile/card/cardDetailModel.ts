import type { CapMode, TypeCategory } from "../../api/settingsLimits";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";
import {
  effectiveLimit,
  enforcementCap,
  limitBucketOf,
  QUANTITY_CEILING,
} from "../../utils/limits";
import type { LimitsMatrix } from "../../utils/limits";
import type { PriceMode } from "../../utils/variantScope";
import { pickRepresentative } from "../vault/cardImage";
import type { NavPosition } from "./navList";

// BL-248 S2-01 / S2-02 / S2-04: the card-detail screen's pure rules. Ports of
// desktop logic that lives inside desktop component files (desktop is not
// edited; BL-254 folds these forks back):
//   - entryVariant  = CardPopup.tsx pickInitialVariant / pickRepresentative
//                     (BL-193), with the list's `?v=` printing first (R5-5);
//   - orderPrintings / groupPrintings = cardPopupShared.ts orderVariants +
//                     CardPopupRail.tsx groupBySet (typed for the catalogue's
//                     InventoryVariant instead of VariantDetail);
//   - railPrice     = CardPopupRail.tsx railPriceText;
//   - starfieldSrc / setLogoSrc = CardPopup.tsx's private helpers;
//   - regionGeom    = rev4 MCardDetail.jsx regionGeom (R3-6 arithmetic).

const finishOf = (v: InventoryVariant) => v.finish ?? v.variant_type;

/** The printing the detail opens on: the printing the list showed (`?v=`,
 * a scoped row or a facet-driven gallery cell), else the scoped finish's
 * printing (desktop BL-193: a scoped Vault only picks the default printing,
 * R5-5), else the representative (Standard, else the first). */
export function entryVariant(
  card: InventoryCard,
  opts: { v?: number | null; scope?: string | null; finishes?: string[] | null } = {}
): InventoryVariant | null {
  const { variants } = card;
  if (variants.length === 0) return null;
  if (opts.v != null) {
    const shown = variants.find((x) => x.variant_id === opts.v);
    if (shown) return shown;
  }
  // S2-09: from a gallery cell, the printing the cell displays (BL-201:
  // the lowest-numbered printing carrying a Finish facet value).
  if (opts.finishes && opts.finishes.length) {
    const fs = new Set(opts.finishes);
    if (variants.some((x) => fs.has(finishOf(x)))) return pickRepresentative(variants, fs);
  }
  if (opts.scope != null) {
    const scoped = variants.find((x) => finishOf(x) === opts.scope);
    if (scoped) return scoped;
  }
  return variants.find((x) => x.finish === "Standard") ?? variants[0];
}

/** Desktop orderVariants: base set first, then other source sets
 * alphabetically, then card number ascending within each set. */
export function orderPrintings(variants: InventoryVariant[], baseSetCode: string) {
  const num = (v: InventoryVariant) => {
    const n = Number(v.card_number);
    return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
  };
  return [...variants].sort((a, b) => {
    const aBase = a.source_set_code === baseSetCode ? 0 : 1;
    const bBase = b.source_set_code === baseSetCode ? 0 : 1;
    if (aBase !== bBase) return aBase - bBase;
    if (a.source_set_code !== b.source_set_code)
      return a.source_set_code.localeCompare(b.source_set_code);
    return num(a) - num(b);
  });
}

export interface PrintingGroup {
  setCode: string;
  label: string;
  items: InventoryVariant[];
}

/** Desktop groupBySet: consecutive runs of one source set, labelled "Base
 * set" for the card's own set, else the set's name (code as fallback). */
export function groupPrintings(
  ordered: InventoryVariant[],
  baseSetCode: string,
  setNameByCode: Record<string, string>
): PrintingGroup[] {
  const groups: PrintingGroup[] = [];
  for (const v of ordered) {
    let g = groups[groups.length - 1];
    if (!g || g.setCode !== v.source_set_code) {
      g = {
        setCode: v.source_set_code,
        label:
          v.source_set_code === baseSetCode
            ? "Base set"
            : (setNameByCode[v.source_set_code] ?? v.source_set_code),
        items: [],
      };
      groups.push(g);
    }
    g.items.push(v);
  }
  return groups;
}

/** Desktop railPriceText: two decimals, an em dash when unpriced. */
export function railPrice(v: Pick<InventoryVariant, "price">, mode: PriceMode): string {
  if (v.price == null) return "—";
  const val = mode === "market" ? v.price.market : v.price.low;
  return val == null ? "—" : `$${val.toFixed(2)}`;
}

/** Desktop CardPopup.tsx STARFIELD_SET_CODES / LOGO_SET_CODES. */
const STARFIELD_SET_CODES = new Set([
  "SOR",
  "SHD",
  "TWI",
  "JTL",
  "LOF",
  "SEC",
  "LAW",
  "ASH",
  "HMW",
  "IBH",
]);
const LOGO_SET_CODES = new Set([...STARFIELD_SET_CODES, "TS26"]);

export function starfieldSrc(code: string): string | null {
  return STARFIELD_SET_CODES.has(code) ? `/images/starfields/starfield_${code}.jpg` : null;
}
export function setLogoSrc(code: string): string | null {
  return LOGO_SET_CODES.has(code) ? `/images/set_${code}.png` : null;
}

/** Leaders' and bases' fronts are landscape (desktop cellImage rule). */
export function isLandscapeFront(card: Pick<InventoryCard, "type">): boolean {
  return card.type === "Leader" || card.type === "Base";
}

/** The region's collapsed layout height (R3-6): the box never changes. */
export const REG_MIN = 100;

export interface RegionGeom {
  hasBack: boolean;
  land: boolean;
  artH: number;
  artW: number;
  cH: number;
  cW: number;
  ownTop: number;
  full: number;
  delta: number;
  flipTop: number;
}

/** rev4 regionGeom: pure arithmetic per card / printing / face, so nothing
 * is measured. Expanded art = 392 px tall portrait or 238 px tall landscape
 * (a base, a leader's front), centred; collapsed = an 80 px thumbnail. */
export function regionGeom(
  card: Pick<InventoryCard, "type">,
  variant: Pick<InventoryVariant, "back_image_url">,
  back: boolean
): RegionGeom {
  const hasBack = !!variant.back_image_url;
  const land = !back && isLandscapeFront(card);
  const artH = land ? 238 : 392;
  const artW = Math.round(land ? (artH * 7) / 5 : (artH * 5) / 7);
  const cH = 80;
  const cW = Math.round(land ? (cH * 7) / 5 : (cH * 5) / 7);
  const ownTop = 14 + artH + 12;
  const full = ownTop + 52 + (hasBack ? 54 : 0) + 12;
  return {
    hasBack,
    land,
    artH,
    artW,
    cH,
    cW,
    ownTop,
    full,
    delta: full - REG_MIN,
    flipTop: ownTop + 58,
  };
}

/** The stepper's limit rules, ported from desktop CardPopupInventory.tsx
 * InventoryPlate: `+` stops at the enforcement cap (hard) or the 999 ceiling
 * (soft); `−` stops at 0; the readout is red at / past the keep-limit and
 * amber ("Over limit") past it in soft mode. */
export function stepperState(
  variant: Pick<InventoryVariant, "finish" | "channel">,
  qty: number,
  typeCategory: TypeCategory,
  limits: LimitsMatrix | null,
  capMode: CapMode
) {
  const bucket = limitBucketOf(variant.finish, variant.channel);
  const rawLimit = effectiveLimit(limits, typeCategory, bucket);
  const cap = enforcementCap(limits, typeCategory, bucket);
  return {
    rawLimit,
    incDisabled: capMode === "soft" ? qty >= QUANTITY_CEILING : qty >= cap,
    decDisabled: qty <= 0,
    atOrOverLimit: rawLimit !== null && qty >= rawLimit,
    softOverLimit: capMode === "soft" && rawLimit !== null && qty > rawLimit,
  };
}

/** S2-09 (rev4 M.navEntry, desktop BL-193 / BL-201): the printing a card
 * opens on inside the list it was reached from -- `?v=` first; then, from a
 * gallery, the printing the cell displays; from rows, the scoped printing;
 * else the representative. Prev / next use the same rule for the neighbour. */
export function navEntryVariant(
  card: InventoryCard,
  nav: Pick<NavPosition, "source" | "scope" | "finishes">,
  v: number | null = null
): InventoryVariant | null {
  const gallery = nav.source === "gallery";
  return entryVariant(card, {
    v,
    scope: gallery ? null : nav.scope,
    finishes: gallery ? nav.finishes : null,
  });
}
