import { describe, expect, it } from "vitest";
import raw from "../../../e2e/mobile/fixtures/scan-raw-sor-ash.json";
import snapshot from "../../../e2e/mobile/fixtures/scan-catalog.snapshot.json";
import { buildScanCatalog } from "./scanCatalog";
import type { ScanSourceCard, ScanSourceSet } from "./scanCatalog";
import { Catalog } from "./scanCore";
import type { ScanCatalogData } from "./scanCore";

// BL-253 S7-07: the gate on the port of build_catalog.py. The spike's
// catalog.json (generated once from the live API) is turned back into the
// shape the app holds (cards with nested variants, sets with is_base_set);
// the app-side derivation must reproduce it exactly -- every printing's
// class, the main sizes, the printed-code sets and the ASHP -> P26 extra.
// (A one-off run of the same builder over the spike's raw API cache, logged
// in the S7 build log, covers the part this round-trip cannot: cls is
// recomputed here from variant_type / source set, but is_token is read back
// from cls 't'.)

const SNAP = snapshot as unknown as ScanCatalogData;

function appShape(s: ScanCatalogData): { cards: ScanSourceCard[]; sets: ScanSourceSet[] } {
  const byCard = new Map<number, ScanSourceCard>();
  s.p.forEach(([src, num, ci, vid, vti, cls]) => {
    let c = byCard.get(ci);
    if (!c) {
      const [name, subtitle, type, home, baseNum] = s.cards[ci];
      c = {
        base_card_id: ci + 1,
        set_code: home,
        base_card_number: String(baseNum),
        name,
        subtitle: subtitle || null,
        type,
        is_token: cls === "t",
        variants: [],
      };
      byCard.set(ci, c);
    }
    c.variants.push({
      variant_id: vid,
      variant_type: s.vt[vti],
      source_set_code: src,
      card_number: String(num),
    });
  });
  const names = s.setNames ?? {};
  const sets = Object.keys(names).map((code) => ({
    code,
    name: names[code],
    is_base_set: code in s.main,
  }));
  return { cards: [...byCard.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]), sets };
}

describe("S7-07 scan catalogue derived from the app's data", () => {
  const { cards, sets } = appShape(SNAP);
  const built = buildScanCatalog(cards, sets);

  it("reproduces the spike's catalog.json (main, early, printed, vt, cards, printings)", () => {
    expect(built.main).toEqual(SNAP.main);
    expect(built.early).toEqual(SNAP.early);
    expect(built.printed).toEqual(SNAP.printed);
    expect(built.vt).toEqual(SNAP.vt);
    expect(built.setNames).toEqual(SNAP.setNames);
    expect(built.cards).toEqual(SNAP.cards);
    expect(built.p).toEqual(SNAP.p);
  });

  it("same keys for a list of printings, whichever catalogue resolves them", () => {
    const a = new Catalog(SNAP);
    const b = new Catalog(built);
    const reads = [
      "SOR • EN R 229/252", // Standard, N/main
      "SOR • EN U 12/20", // early Weekly Play
      "SOR • EN S 1/2", // tournament tier: always a pick
      "SOR • EN C T01/T02", // token
      "JTL • EN U 598", // Hyperspace / Showcase: no denominator
      "ASHP • EN 16", // collision: ASHP and P26
      "P26 • EN 16",
      "LAW • EN C 100/264",
      "HMW • EN C 1/272",
      "J25 • EN L 16", // later-set promo: denominator ignored
      "SOR EN 229/262", // denominator one digit off: corrected
    ];
    for (const raw of reads) {
      const ea = a.evaluate(raw);
      const eb = b.evaluate(raw);
      expect(eb.result, raw).toBe(ea.result);
      expect(eb.best?.key, raw).toBe(ea.best?.key);
      expect(eb.reason, raw).toBe(ea.reason);
      expect(
        eb.best?.cards.map((c) => [c.name, c.subtitle, c.printings.map((p) => p.vid)]),
        raw
      ).toEqual(ea.best?.cards.map((c) => [c.name, c.subtitle, c.printings.map((p) => p.vid)]));
    }
  });

  it("the derivation rules, from first principles", () => {
    const set = (code: string, is_base_set: boolean): ScanSourceSet => ({
      code,
      name: code,
      is_base_set,
    });
    const card = (
      id: number,
      home: string,
      baseNum: number,
      variants: [string, string, string][],
      is_token = false
    ): ScanSourceCard => ({
      base_card_id: id,
      set_code: home,
      base_card_number: String(baseNum),
      name: "N" + id,
      subtitle: null,
      type: "Unit",
      is_token,
      variants: variants.map(([vt, src, num], i) => ({
        variant_id: id * 10 + i,
        variant_type: vt,
        source_set_code: src,
        card_number: num,
      })),
    });
    const cat = buildScanCatalog(
      [
        card(1, "SOR", 1, [
          ["Standard", "SOR", "1"],
          ["Hyperspace", "SOR", "300"],
          ["Weekly Play", "SOR", "5"],
          ["Prerelease Promo", "SOR", "9"],
        ]),
        card(2, "SOR", 2, [
          ["Standard", "SOR", "2"],
          ["Standard Foil", "SOR", "2"],
        ]),
        card(3, "SOR", 3, [["Standard", "SOR", "1"]], true),
        card(4, "SOR", 4, [
          ["Weekly Play", "SORP", "7"],
          ["Weekly Play", "SORP", "8"],
        ]),
        card(5, "SOR", 5, [["Standard", "SORP", "5"]]),
        card(6, "JTL", 1, [
          ["Standard", "JTL", "1"],
          ["Showcase", "JTL", "2"],
        ]),
        card(7, "ASH", 1, [["Standard", "P26", "16"]]),
        card(8, "ASH", 2, [["Standard", "ASH", "2"]]),
        card(9, "ASH", 3, [["Standard", "ASH", "x1"]]),
      ],
      [set("SOR", true), set("JTL", true), set("ASH", true), set("P26", false)]
    );
    expect(cat.main).toEqual({ SOR: 2, JTL: 1, ASH: 1 });
    const cls = (vid: number) => cat.p.find((r) => r[3] === vid)![5];
    expect(cls(10)).toBe("m"); // early Standard
    expect(cls(11)).toBe("n"); // Hyperspace
    expect(cls(12)).toBe("w"); // Weekly Play
    expect(cls(13)).toBe("2"); // prerelease small series
    expect(cls(21)).toBe("m"); // Standard Foil prints N/main too
    expect(cls(30)).toBe("t"); // token
    expect(cls(41)).toBe("w"); // SORP number outside the leader pairs
    expect(cls(50)).toBe("2"); // SORP 5 pairs with SOR Weekly Play 5: a leader pair prints N/2
    expect(cls(60)).toBe("m"); // JTL Standard
    expect(cls(61)).toBe("n"); // JTL Showcase
    expect(cls(70)).toBe("x"); // promo code: denominator ignored
    expect(cat.printed.SOR).toEqual(["SOR", "SORP"]);
    expect(cat.printed.ASHP).toEqual(["P26"]); // the owner-evidenced collision extra
    expect(cat.p.some((r) => r[3] === 90)).toBe(false); // a non-numeric printing is not scannable
  });
});

// S7-F4: the non-circular half of the gate. The fixture is a trimmed copy of
// the RAW swuapi cache (is_token and is_base_set as the API returns them, not
// read back from the snapshot): the SOR and ASH base cards. The catalogue the
// app derives from it must equal the matching slice of the spike's snapshot,
// printing by printing (SOR: Weekly Play pairs, early-set classes; ASH: the
// ASHP -> P26 collision, hyperspace / showcase numbering).
describe("S7-F4 the derivation from raw API data equals the snapshot slice", () => {
  const sets = raw.sets.map(([code, name, isBase]) => ({
    code: code as string,
    name: name as string,
    is_base_set: isBase as boolean,
  }));
  const cards: ScanSourceCard[] = (raw.cards as unknown[][]).map((c) => ({
    base_card_id: c[0] as number,
    set_code: c[1] as string,
    base_card_number: c[2] as string,
    name: c[3] as string,
    subtitle: c[4] as string | null,
    type: c[5] as string | null,
    is_token: c[6] as boolean,
    variants: (c[7] as [number, string, string, string][]).map(
      ([variant_id, variant_type, source_set_code, card_number]) => ({
        variant_id,
        variant_type,
        source_set_code,
        card_number,
      })
    ),
  }));
  const built = buildScanCatalog(cards, sets);

  // One comparable tuple per printing, the card index resolved to its fields.
  const resolve = (d: ScanCatalogData, onlyHomes?: string[]) =>
    d.p
      .map(([src, num, ci, vid, vti, cls]) => ({
        src,
        num,
        card: d.cards[ci],
        vid,
        vt: d.vt[vti],
        cls,
      }))
      .filter((r) => !onlyHomes || onlyHomes.includes(r.card[3]));

  it("every printing (source, number, card, variant, type, class) matches", () => {
    const got = resolve(built);
    const want = resolve(SNAP, ["SOR", "ASH"]);
    expect(got.length).toBe(want.length);
    expect(got.length).toBeGreaterThan(2000);
    expect(got).toEqual(want);
  });

  it("main sizes and printed-code sets match, incl. ASHP -> P26", () => {
    expect(built.main.SOR).toBe(SNAP.main.SOR);
    expect(built.main.ASH).toBe(SNAP.main.ASH);
    expect(built.printed.ASHP).toEqual(SNAP.printed.ASHP);
    expect(built.printed.ASHP).toContain("P26");
    expect(built.early).toEqual(SNAP.early);
    expect(built.setNames).toEqual(SNAP.setNames);
  });
});
