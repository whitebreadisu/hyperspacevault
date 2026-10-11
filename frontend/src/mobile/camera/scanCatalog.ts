import type { ScanCatalogData } from "./scanCore";

// BL-253 S7-07: the scan catalogue, derived from the catalogue the app already
// loads (useVaultData's cards + sets), so it never goes stale. A TypeScript
// port of spikes/bl238/tools/build_catalog.py:16-56 (which reduced the live
// API to public/catalog.json). Denominators are not in the API; they are
// derived:
//   main[base]  = count of Standard non-token printings released in the home
//                 base set (the number after the slash on a Standard card)
//   cls         t token | m Standard (prints N/<main>) | w Weekly Play
//                 (prints N/20) | n Hyperspace / Showcase (no denominator) |
//                 2 prerelease / judge / SS / PQ small series (N/2, 00N/002) |
//                 x promo / other code (denominator ignored)
//   early sets  SOR / SHD / TWI, whose promo codes SORP / SHDP / TWIP fold
//               into the same printed code (a leader pair prints N/2, the
//               rest join the N/20 Weekly Play run)
//   printed[code] = the source sets one printed code may belong to, incl. the
//               ASHP -> P26 extra (owner evidence 2026-10-10: the Grogu Store
//               Showdown promo prints "ASHP" while the API says P26).
// Open question carried from the spike: whether LAWP / SECP / LOFP P25-era
// promos collide the same way is not generalised without physical evidence.

/** The slice of the app's catalogue shapes this needs (InventoryCard and
 * CardSet satisfy it structurally). */
export interface ScanSourceCard {
  base_card_id: number;
  set_code: string;
  base_card_number: string;
  name: string;
  subtitle: string | null;
  type: string | null;
  is_token: boolean;
  variants: {
    variant_id: number;
    variant_type: string;
    source_set_code: string;
    card_number: string;
  }[];
}

export interface ScanSourceSet {
  code: string;
  name: string;
  is_base_set: boolean;
}

const EARLY = ["SOR", "SHD", "TWI"];
const EARLY_P: Record<string, string> = { SORP: "SOR", SHDP: "SHD", TWIP: "TWI" };
const PRINTED_EXTRA: Record<string, string[]> = { ASHP: ["P26"] };

const isDigits = (s: string) => /^\d+$/.test(s);

export function buildScanCatalog(
  cards: ScanSourceCard[],
  sets: ScanSourceSet[],
  snapshot?: string
): ScanCatalogData {
  const baseCodes = sets.filter((s) => s.is_base_set).map((s) => s.code);
  const rows: { c: ScanSourceCard; v: ScanSourceCard["variants"][number]; n: number }[] = [];
  for (const c of cards)
    for (const v of c.variants) {
      // the spike asserted digit-only numbers; a printing without one cannot
      // be keyed by a printed number, so it is not scannable.
      if (!isDigits(v.card_number)) continue;
      rows.push({ c, v, n: parseInt(v.card_number, 10) });
    }

  // main-set size = count of Standard non-token printings released in the home base set
  const main: Record<string, number> = {};
  for (const b of baseCodes) {
    const nums = new Set<number>();
    for (const { c, v, n } of rows)
      if (
        c.set_code === b &&
        v.source_set_code === b &&
        v.variant_type === "Standard" &&
        !c.is_token
      )
        nums.add(n);
    if (nums.size) main[b] = nums.size;
  }

  const wpNums: Record<string, Set<number>> = {};
  for (const { v, n } of rows) {
    if (
      EARLY.includes(v.source_set_code) &&
      (v.variant_type === "Weekly Play" || v.variant_type === "Weekly Play Foil")
    )
      (wpNums[v.source_set_code] ??= new Set()).add(n);
  }

  function cls(c: ScanSourceCard, v: ScanSourceCard["variants"][number], n: number): string {
    const src = v.source_set_code;
    const vt = v.variant_type;
    if (c.is_token) return "t";
    if (EARLY.includes(src)) {
      if (vt === "Standard" || vt === "Standard Foil") return "m"; // prints N/<main>
      if (vt === "Weekly Play" || vt === "Weekly Play Foil") return "w"; // prints N/20
      if (vt === "Hyperspace" || vt === "Hyperspace Foil" || vt === "Showcase") return "n";
      return "2"; // prerelease / judge / SS / PQ small series (N/2, 00N/002)
    }
    if (src in EARLY_P) return wpNums[EARLY_P[src]]?.has(n) ? "2" : "w"; // leader pair prints N/2; the rest join the N/20 run
    if (src in main) return vt === "Standard" ? "m" : "n"; // JTL+: only Standard carries /<main>
    return "x"; // promo/other code: denominator ignored
  }

  const printedSets: Record<string, Set<string>> = {};
  for (const { v } of rows) {
    const s = v.source_set_code;
    (printedSets[EARLY_P[s] ?? s] ??= new Set()).add(s);
  }
  for (const [k, extra] of Object.entries(PRINTED_EXTRA))
    for (const e of extra) (printedSets[k] ??= new Set()).add(e);

  const vts = [...new Set(rows.map((r) => r.v.variant_type))].sort();
  const outCards: ScanCatalogData["cards"] = [];
  const cidx = new Map<number, number>();
  const p: ScanCatalogData["p"] = [];
  for (const { c, v, n } of rows) {
    if (!cidx.has(c.base_card_id)) {
      cidx.set(c.base_card_id, outCards.length);
      outCards.push([
        c.name,
        c.subtitle || "",
        c.type || "",
        c.set_code,
        parseInt(c.base_card_number, 10),
      ]);
    }
    p.push([
      v.source_set_code,
      n,
      cidx.get(c.base_card_id)!,
      v.variant_id,
      vts.indexOf(v.variant_type),
      cls(c, v, n),
    ]);
  }

  const printed: Record<string, string[]> = {};
  for (const k of Object.keys(printedSets).sort()) printed[k] = [...printedSets[k]].sort();
  const setNames: Record<string, string> = {};
  for (const s of sets) setNames[s.code] = s.name;

  return {
    v: 1,
    ...(snapshot ? { snapshot } : {}),
    main,
    early: EARLY,
    printed,
    setNames,
    vt: vts,
    cards: outCards,
    p,
  };
}
