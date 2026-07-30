import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AddCardsSetBar } from "./AddCardsSetBar";
import type { CardSet } from "../../api/sets";
import type { AddCardsCatalogEntry } from "../../utils/addCardsResolver";

// Locked-header logo derivation (headerLogoCodesFor): the header always
// shows BASE-set marks -- a Weekly Play or Exclusives selection displays the
// base set(s) its printings belong to, not its own (asset-less) code. The
// pure ordering/derivation cases live in setGrouping.test.ts; these cover
// the wiring: which <img> marks the locked bar actually renders.

const set = (code: string, name: string, is_base_set: boolean, id: number): CardSet => ({
  id,
  code,
  name,
  is_base_set,
  release_date: null,
});

const SETS: CardSet[] = [
  set("SOR", "Spark of Rebellion", true, 1),
  set("TWI", "Twilight of the Republic", true, 3),
  set("SORP", "Spark of Rebellion Weekly Play", false, 34),
  set("J25", "2025 Judge Program", false, 21),
  set("GG", "Gamegenic", false, 19),
];

/** Only set_code/source_set_code are read by the logo derivation. */
const entry = (set_code: string, source_set_code: string): AddCardsCatalogEntry =>
  ({ set_code, source_set_code }) as AddCardsCatalogEntry;

function renderLocked(setCode: string, catalog: AddCardsCatalogEntry[] = []) {
  return render(
    <AddCardsSetBar
      sets={SETS}
      catalog={catalog}
      setCode={setCode}
      onChoose={vi.fn()}
      onChangeSet={vi.fn()}
    />
  );
}

describe("AddCardsSetBar locked-header logo", () => {
  it("a base set shows its own mark", () => {
    renderLocked("SOR");
    expect(screen.getByAltText("SOR logo")).toBeTruthy();
  });

  it("a Weekly Play selection shows its base set's mark, not its own code", () => {
    renderLocked("SORP");
    expect(screen.getByAltText("SOR logo")).toBeTruthy();
    expect(screen.queryByAltText("SORP logo")).toBeNull();
  });

  it("an Exclusives selection spanning base sets shows each home base mark in canonical order", () => {
    renderLocked("J25", [
      entry("TWI", "J25"),
      entry("SOR", "J25"),
      entry("SOR", "P26"), // other container -- must not leak in
    ]);
    const marks = screen.getAllByRole("img").map((img) => img.getAttribute("alt"));
    expect(marks).toEqual(["SOR logo", "TWI logo"]);
  });

  it("an unmappable selection renders no mark rather than a broken image", () => {
    renderLocked("GG", [entry("GG", "GG")]);
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });
});
