import { describe, expect, it } from "vitest";
import type { PreconDeck, PreconEntry } from "../../data/preconDecks";
import type { AddCardsCatalogEntry } from "../../utils/addCardsResolver";
import { deriveRenditions } from "../../utils/cardImages";
import { DECK_ART, deckArtBox, deckRowArt, deckRowArts } from "./deckArtModel";

let nextId = 1;
function cat(
  type: string,
  set: string,
  num: string,
  o: Partial<AddCardsCatalogEntry> = {}
): AddCardsCatalogEntry {
  const url = `https://cdn.starwarsunlimited.com//card_${set}_${num}_${type}.png`;
  return {
    id: nextId++,
    name: `${type} ${set} ${num}`,
    subtitle: null,
    type,
    variant_type: "Standard",
    finish: "Standard",
    channel: "Retail",
    set_code: set,
    source_set_code: set,
    card_number: num,
    is_token: false,
    quantity: 0,
    front_image_url: url,
    front_images: deriveRenditions(url),
    back_image_url: null,
    ...o,
  };
}
function deck(code: string, set: string, numbers: string[]): PreconDeck {
  return {
    code,
    set_code: set,
    product: "Test",
    name: code,
    aspects: null,
    cards: numbers.map((n) => ({
      swuapi_uuid: `${set}-${n}`,
      set_code: set,
      card_number: n,
      variant_type: "Standard",
      name: n,
      quantity: 1,
    })),
  };
}
const entry = (d: PreconDeck): PreconEntry => ({
  kind: "deck",
  key: d.code,
  setCode: d.set_code,
  deck: d,
});

describe("FR3-03 deck row art model", () => {
  const leader = cat("Leader", "AAA", "1");
  const base = cat("Base", "AAA", "20");
  const unit = cat("Unit", "AAA", "30");
  const leader2 = cat("Leader", "AAA", "2");
  const catalog = [leader, base, unit, leader2];

  it("single: one leader, its base, the small image variant", () => {
    const art = deckRowArt(entry(deck("S", "AAA", ["1", "20", "30"])), catalog);
    expect(art.kind).toBe("single");
    if (art.kind === "none") throw new Error("art expected");
    expect(art.leaders.map((l) => l.id)).toEqual([leader.id]);
    expect(art.bases.map((b) => b?.id)).toEqual([base.id]);
    const img = art.leaders[0].img;
    expect(img.src).toBe(leader.front_images!.w640);
    expect(img.srcSet).toBe(`${leader.front_images!.w320} 320w, ${leader.front_images!.w640} 640w`);
    expect(img.sizes).toBe(`${DECK_ART.leaderW}px`);
    expect(typeof img.onError).toBe("function");
  });

  it("single without a resolvable base keeps the leader", () => {
    const art = deckRowArt(entry(deck("S", "AAA", ["1", "30"])), catalog);
    expect(art).toMatchObject({ kind: "single", bases: [null] });
  });

  it("dual (Twin Suns): two leaders, one base sized for the wider slot", () => {
    const art = deckRowArt(entry(deck("D", "AAA", ["1", "2", "20"])), catalog);
    expect(art.kind).toBe("dual");
    if (art.kind === "none") throw new Error("art expected");
    expect(art.leaders.map((l) => l.id)).toEqual([leader.id, leader2.id]);
    expect(art.bases).toHaveLength(1);
    expect(art.bases[0]!.id).toBe(base.id);
    expect(art.bases[0]!.img.sizes).toBe(
      `${Math.round(deckArtBox("dual").w * DECK_ART.dualBase)}px`
    );
  });

  it("ibh (the Hoth box): two leaders, each with its own base", () => {
    const base2 = cat("Base", "AAA", "21");
    const box: PreconEntry = {
      kind: "ibhBox",
      key: "IBH",
      setCode: "IBH",
      deckA: deck("A", "AAA", ["1", "20"]),
      deckB: deck("B", "AAA", ["2", "21"]),
    };
    const art = deckRowArt(box, [...catalog, base2]);
    expect(art.kind).toBe("ibh");
    if (art.kind === "none") throw new Error("art expected");
    expect(art.leaders.map((l) => l.id)).toEqual([leader.id, leader2.id]);
    expect(art.bases.map((b) => b?.id)).toEqual([base.id, base2.id]);
    // One half without a leader: no art at all (never a partial box).
    expect(deckRowArt({ ...box, deckB: deck("B", "AAA", ["21"]) }, [...catalog, base2]).kind).toBe(
      "none"
    );
  });

  it("unresolved leader, or a leader with no image: no art", () => {
    expect(deckRowArt(entry(deck("U", "AAA", ["99", "20"])), catalog)).toEqual({ kind: "none" });
    const bare = cat("Leader", "BBB", "1", { front_image_url: null, front_images: null });
    expect(deckRowArt(entry(deck("N", "BBB", ["1"])), [bare])).toEqual({ kind: "none" });
  });

  it("every kind draws leaders at one size; two-leader kinds are twice as wide", () => {
    const { leaderW, leaderH, peek, gap } = DECK_ART;
    expect(leaderW).toBeGreaterThan(leaderH); // landscape
    expect(deckArtBox("single")).toEqual({ w: leaderW, h: leaderH + peek });
    expect(deckArtBox("dual")).toEqual({ w: 2 * leaderW + gap, h: leaderH + peek });
    expect(deckArtBox("ibh")).toEqual(deckArtBox("dual"));
  });

  it("deckRowArts matches the whole-catalogue result (a same-number promo leader stays out)", () => {
    // SOR 74 is the deck's event "Repair"; a promo leader printing whose home
    // set is SOR also carries number 74. The event is the Standard match, so
    // the deck has ONE leader -- narrowing the catalogue by type would lose
    // the event and make the row a false Twin Suns pair.
    const event = cat("Event", "AAA", "74");
    const promoLeader = cat("Leader", "AAA", "74", {
      source_set_code: "P25",
      variant_type: "Showcase",
    });
    const full = [promoLeader, ...catalog, event];
    const e = entry(deck("T", "AAA", ["1", "20", "74"]));
    const arts = deckRowArts([e, entry(deck("U", "ZZZ", ["1"]))], full);
    const ids = (a: ReturnType<typeof deckRowArt>) =>
      a.kind === "none" ? null : [a.kind, a.leaders.map((l) => l.id), a.bases.map((b) => b?.id)];
    expect(ids(arts.get("T")!)).toEqual(ids(deckRowArt(e, full)));
    expect(ids(arts.get("T")!)).toEqual(["single", [leader.id], [base.id]]);
    expect(arts.get("U")).toEqual({ kind: "none" });
  });
});
