import { describe, it, expect } from "vitest";
import { sortedEntries } from "./AddCardsPreconBar";
import { preconEntries } from "../../data/preconDecks";

// CREATE (BL-258): FR2-07 -- precon decks follow the shared set rank (newest
// main set first; the IBH box and the TS26 decks last), with the order of
// decks inside one set untouched. Literal expectations, not derived.
describe("FR2-07 precon deck order (BL-258)", () => {
  const keys = sortedEntries(preconEntries()).map((e) => e.key);

  it("fr2-07 the newest main set's decks lead; the IBH box and TS26 decks are last", () => {
    expect(keys[0]).toBe("HMW-CHEWBACCA");
    expect(keys[1]).toBe("HMW-TARKIN");
    expect(keys.slice(-5)).toEqual([
      "IBH",
      "TS26-IMPROVISED",
      "TS26-DOOKU",
      "TS26-MAUL",
      "TS26-ANAKIN",
    ]);
    expect(keys).toHaveLength(23);
  });

  it("fr2-07 main sets run HMW, ASH, LAW, SEC, LOF, JTL, TWI, SHD, SOR", () => {
    const sets = sortedEntries(preconEntries()).map((e) => e.setCode);
    expect([...new Set(sets)]).toEqual([
      "HMW",
      "ASH",
      "LAW",
      "SEC",
      "LOF",
      "JTL",
      "TWI",
      "SHD",
      "SOR",
      "IBH",
      "TS26",
    ]);
  });

  it("fr2-07 decks inside one set keep their data order (SOR: Luke then Vader)", () => {
    const sor = keys.filter((k) => k.startsWith("SOR-"));
    expect(sor).toEqual(["SOR-LUKE", "SOR-VADER"]);
    const lof = keys.filter((k) => k.startsWith("LOF-"));
    expect(lof).toEqual(["LOF-QUIGON", "LOF-MAUL"]);
  });
});
