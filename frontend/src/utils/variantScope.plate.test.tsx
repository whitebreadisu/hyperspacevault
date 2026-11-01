import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlaysetCell } from "../screens/cards/PlaysetCell";
import { GalleryGrid } from "../screens/cards/GalleryGrid";
import { Playset } from "../mobile/vault/Playset";
import { GalleryCell } from "../mobile/vault/GalleryCell";
import { plateState } from "../mobile/card/cardDetailModel";
import {
  baseCard,
  HYPERSPACE,
  leaderCard,
  SHOWCASE,
  STANDARD,
  unitCard,
  unpricedCard,
} from "../mobile/vault/phoneCardFixtures";
import type { InventoryCard } from "./inventory";
import { playsetPlate } from "./variantScope";

// Characterisation of the playset plate: the four components that draw a
// card's playset pips (desktop table cell and gallery tile, phone row and
// gallery cell) and the card-detail plate model, over one fixed card set,
// every scope a card can meet, signed in and out. The tables below pin what
// each surface renders today; the invariants assert the surfaces agree.

const CARDS: Record<string, InventoryCard> = {
  "unit 0/0": unitCard(0, 0),
  "unit 2/0": unitCard(2, 0),
  "unit 2/1": unitCard(2, 1),
  "unit 0/3": unitCard(0, 3),
  "unit 1/3": unitCard(1, 3),
  "unit 4/2": unitCard(4, 2),
  "leader 0/0": leaderCard(0, 0),
  "leader 1/0": leaderCard(1, 0),
  "leader 0/1": leaderCard(0, 1),
  "leader 2/1": leaderCard(2, 1),
  "base 0": baseCard(0),
  "base 1": baseCard(1),
  "unpriced 2": unpricedCard(2),
};
const SCOPES: (string | null)[] = [null, STANDARD, HYPERSPACE, SHOWCASE];

interface Case {
  label: string;
  card: InventoryCard;
  scope: string | null;
  auth: boolean;
}
const CASES: Case[] = [];
for (const [name, card] of Object.entries(CARDS))
  for (const scope of SCOPES)
    for (const auth of [true, false])
      CASES.push({
        label: `${name} | ${scope ?? "all"} | ${auth ? "in" : "out"}`,
        card,
        scope,
        auth,
      });

/** What a table-style surface (desktop PlaysetCell, phone Playset) shows. */
interface TableObs {
  chip: string;
  chipComplete: boolean;
  chipEmpty: boolean;
  pips: number;
  filled: number;
  scopedPips: number;
  plateComplete: boolean;
}
/** What a gallery-style surface (desktop GalleryGrid tile, phone GalleryCell) shows. */
interface GalleryObs {
  signedOut: boolean;
  total: string | null;
  totalComplete: boolean;
  pips: number;
  filled: number;
  scopedPips: number;
  plateComplete: boolean;
}

function tableObs(container: HTMLElement): TableObs {
  const chip = container.querySelector(".playset-chip") as HTMLElement;
  const pips = Array.from(container.querySelectorAll(".playset__pip"));
  return {
    chip: chip.textContent ?? "",
    chipComplete: chip.classList.contains("playset-chip--complete"),
    chipEmpty: chip.classList.contains("playset-chip--empty"),
    pips: pips.length,
    filled: pips.filter((p) => p.classList.contains("playset__pip--filled")).length,
    scopedPips: pips.filter((p) => p.classList.contains("playset__pip--scoped")).length,
    plateComplete: !!container.querySelector(".playset__pips--scoped-complete"),
  };
}

function galleryObs(container: HTMLElement): GalleryObs {
  const plate = container.querySelector(".gallery-plate") as HTMLElement;
  const total = container.querySelector(".gallery-plate__total");
  const pips = Array.from(container.querySelectorAll(".gallery-plate__pip"));
  return {
    signedOut: !!container.querySelector(".gallery-plate__sign-in"),
    total: total ? (total.childNodes[0]?.textContent ?? "") : null,
    totalComplete: !!total?.classList.contains("gallery-plate__total--complete"),
    pips: pips.length,
    filled: pips.filter((p) => p.classList.contains("gallery-plate__pip--filled")).length,
    scopedPips: pips.filter((p) => p.classList.contains("gallery-plate__pip--scoped")).length,
    plateComplete: plate.classList.contains("gallery-plate--complete"),
  };
}

function desktopCell(c: Case): TableObs {
  const { container, unmount } = render(
    <table>
      <tbody>
        <tr>
          <PlaysetCell card={c.card} isAuthenticated={c.auth} onOpen={vi.fn()} scope={c.scope} />
        </tr>
      </tbody>
    </table>
  );
  const o = tableObs(container);
  unmount();
  return o;
}
function phoneRow(c: Case): TableObs {
  const { container, unmount } = render(
    <Playset card={c.card} scope={c.scope} isAuthenticated={c.auth} />
  );
  const o = tableObs(container);
  unmount();
  return o;
}
function desktopTile(c: Case): GalleryObs {
  const { container, unmount } = render(
    <GalleryGrid cards={[c.card]} onSelectCard={vi.fn()} isAuthenticated={c.auth} scope={c.scope} />
  );
  const o = galleryObs(container);
  unmount();
  return o;
}
function phoneTile(c: Case): GalleryObs {
  const { container, unmount } = render(
    <GalleryCell
      card={c.card}
      finishes={new Set()}
      scope={c.scope}
      gallerySize={2}
      isAuthenticated={c.auth}
      onOpen={vi.fn()}
    />
  );
  const o = galleryObs(container);
  unmount();
  return o;
}

/** One case as a compact string: table surface | gallery surface. Fields:
 * table = chip, chip state (C complete / E empty / - ), filled/pips,
 * scoped pips, plate (P scoped-complete / -); gallery = total (or OUT),
 * total state (C / -), filled/pips, scoped pips, plate (P complete / -). */
function line(t: TableObs, g: GalleryObs): string {
  const ts = `${t.chip} ${t.chipComplete ? "C" : t.chipEmpty ? "E" : "-"} ${t.filled}/${t.pips} s${t.scopedPips} ${t.plateComplete ? "P" : "-"}`;
  const gs = g.signedOut
    ? `OUT ${g.plateComplete ? "P" : "-"}`
    : `${g.total} ${g.totalComplete ? "C" : "-"} ${g.filled}/${g.pips} s${g.scopedPips} ${g.plateComplete ? "P" : "-"}`;
  return `${ts} || ${gs}`;
}

// Pinned on the unmodified components (2026-10-31).
const PINNED: Record<string, string> = {
  "unit 0/0 | all | in": "0 E 0/3 s0 - || 0 - 0/3 s0 -",
  "unit 0/0 | all | out": "— - 0/3 s0 - || OUT -",
  "unit 0/0 | Standard | in": "0 E 0/3 s0 - || 0 - 0/3 s0 -",
  "unit 0/0 | Standard | out": "— - 0/3 s0 - || OUT -",
  "unit 0/0 | Hyperspace | in": "0 E 0/3 s0 - || 0 - 0/3 s0 -",
  "unit 0/0 | Hyperspace | out": "— - 0/3 s0 - || OUT -",
  "unit 0/0 | Showcase | in": "0 E 0/3 s0 - || 0 - 0/3 s0 -",
  "unit 0/0 | Showcase | out": "— - 0/3 s0 - || OUT -",
  "unit 2/0 | all | in": "2 - 2/3 s0 - || 2 - 2/3 s0 -",
  "unit 2/0 | all | out": "— - 0/3 s0 - || OUT -",
  "unit 2/0 | Standard | in": "2 - 2/3 s2 - || 2 - 2/3 s2 -",
  "unit 2/0 | Standard | out": "— - 0/3 s0 - || OUT -",
  "unit 2/0 | Hyperspace | in": "2 - 0/3 s0 - || 2 - 0/3 s0 -",
  "unit 2/0 | Hyperspace | out": "— - 0/3 s0 - || OUT -",
  "unit 2/0 | Showcase | in": "2 - 0/3 s0 - || 2 - 0/3 s0 -",
  "unit 2/0 | Showcase | out": "— - 0/3 s0 - || OUT -",
  "unit 2/1 | all | in": "3 C 3/3 s0 - || 3 C 3/3 s0 P",
  "unit 2/1 | all | out": "— - 0/3 s0 - || OUT -",
  "unit 2/1 | Standard | in": "3 C 2/3 s2 - || 3 C 2/3 s2 -",
  "unit 2/1 | Standard | out": "— - 0/3 s0 - || OUT -",
  "unit 2/1 | Hyperspace | in": "3 C 1/3 s1 - || 3 C 1/3 s1 -",
  "unit 2/1 | Hyperspace | out": "— - 0/3 s0 - || OUT -",
  "unit 2/1 | Showcase | in": "3 C 0/3 s0 - || 3 C 0/3 s0 -",
  "unit 2/1 | Showcase | out": "— - 0/3 s0 - || OUT -",
  "unit 0/3 | all | in": "3 C 3/3 s0 - || 3 C 3/3 s0 P",
  "unit 0/3 | all | out": "— - 0/3 s0 - || OUT -",
  "unit 0/3 | Standard | in": "3 C 0/3 s0 - || 3 C 0/3 s0 -",
  "unit 0/3 | Standard | out": "— - 0/3 s0 - || OUT -",
  "unit 0/3 | Hyperspace | in": "3 C 3/3 s3 P || 3 C 3/3 s3 P",
  "unit 0/3 | Hyperspace | out": "— - 0/3 s0 - || OUT -",
  "unit 0/3 | Showcase | in": "3 C 0/3 s0 - || 3 C 0/3 s0 -",
  "unit 0/3 | Showcase | out": "— - 0/3 s0 - || OUT -",
  "unit 1/3 | all | in": "4 C 3/3 s0 - || 4 C 3/3 s0 P",
  "unit 1/3 | all | out": "— - 0/3 s0 - || OUT -",
  "unit 1/3 | Standard | in": "4 C 1/3 s1 - || 4 C 1/3 s1 -",
  "unit 1/3 | Standard | out": "— - 0/3 s0 - || OUT -",
  "unit 1/3 | Hyperspace | in": "4 C 3/3 s3 P || 4 C 3/3 s3 P",
  "unit 1/3 | Hyperspace | out": "— - 0/3 s0 - || OUT -",
  "unit 1/3 | Showcase | in": "4 C 0/3 s0 - || 4 C 0/3 s0 -",
  "unit 1/3 | Showcase | out": "— - 0/3 s0 - || OUT -",
  "unit 4/2 | all | in": "6 C 3/3 s0 - || 6 C 3/3 s0 P",
  "unit 4/2 | all | out": "— - 0/3 s0 - || OUT -",
  "unit 4/2 | Standard | in": "6 C 3/3 s3 P || 6 C 3/3 s3 P",
  "unit 4/2 | Standard | out": "— - 0/3 s0 - || OUT -",
  "unit 4/2 | Hyperspace | in": "6 C 2/3 s2 - || 6 C 2/3 s2 -",
  "unit 4/2 | Hyperspace | out": "— - 0/3 s0 - || OUT -",
  "unit 4/2 | Showcase | in": "6 C 0/3 s0 - || 6 C 0/3 s0 -",
  "unit 4/2 | Showcase | out": "— - 0/3 s0 - || OUT -",
  "leader 0/0 | all | in": "0 E 0/1 s0 - || 0 - 0/1 s0 -",
  "leader 0/0 | all | out": "— - 0/1 s0 - || OUT -",
  "leader 0/0 | Standard | in": "0 E 0/1 s0 - || 0 - 0/1 s0 -",
  "leader 0/0 | Standard | out": "— - 0/1 s0 - || OUT -",
  "leader 0/0 | Hyperspace | in": "0 E 0/1 s0 - || 0 - 0/1 s0 -",
  "leader 0/0 | Hyperspace | out": "— - 0/1 s0 - || OUT -",
  "leader 0/0 | Showcase | in": "0 E 0/1 s0 - || 0 - 0/1 s0 -",
  "leader 0/0 | Showcase | out": "— - 0/1 s0 - || OUT -",
  "leader 1/0 | all | in": "1 C 1/1 s0 - || 1 C 1/1 s0 P",
  "leader 1/0 | all | out": "— - 0/1 s0 - || OUT -",
  "leader 1/0 | Standard | in": "1 C 1/1 s1 P || 1 C 1/1 s1 P",
  "leader 1/0 | Standard | out": "— - 0/1 s0 - || OUT -",
  "leader 1/0 | Hyperspace | in": "1 C 0/1 s0 - || 1 C 0/1 s0 -",
  "leader 1/0 | Hyperspace | out": "— - 0/1 s0 - || OUT -",
  "leader 1/0 | Showcase | in": "1 C 0/1 s0 - || 1 C 0/1 s0 -",
  "leader 1/0 | Showcase | out": "— - 0/1 s0 - || OUT -",
  "leader 0/1 | all | in": "1 C 1/1 s0 - || 1 C 1/1 s0 P",
  "leader 0/1 | all | out": "— - 0/1 s0 - || OUT -",
  "leader 0/1 | Standard | in": "1 C 0/1 s0 - || 1 C 0/1 s0 -",
  "leader 0/1 | Standard | out": "— - 0/1 s0 - || OUT -",
  "leader 0/1 | Hyperspace | in": "1 C 0/1 s0 - || 1 C 0/1 s0 -",
  "leader 0/1 | Hyperspace | out": "— - 0/1 s0 - || OUT -",
  "leader 0/1 | Showcase | in": "1 C 1/1 s1 P || 1 C 1/1 s1 P",
  "leader 0/1 | Showcase | out": "— - 0/1 s0 - || OUT -",
  "leader 2/1 | all | in": "3 C 1/1 s0 - || 3 C 1/1 s0 P",
  "leader 2/1 | all | out": "— - 0/1 s0 - || OUT -",
  "leader 2/1 | Standard | in": "3 C 1/1 s1 P || 3 C 1/1 s1 P",
  "leader 2/1 | Standard | out": "— - 0/1 s0 - || OUT -",
  "leader 2/1 | Hyperspace | in": "3 C 0/1 s0 - || 3 C 0/1 s0 -",
  "leader 2/1 | Hyperspace | out": "— - 0/1 s0 - || OUT -",
  "leader 2/1 | Showcase | in": "3 C 1/1 s1 P || 3 C 1/1 s1 P",
  "leader 2/1 | Showcase | out": "— - 0/1 s0 - || OUT -",
  "base 0 | all | in": "0 E 0/1 s0 - || 0 - 0/1 s0 -",
  "base 0 | all | out": "— - 0/1 s0 - || OUT -",
  "base 0 | Standard | in": "0 E 0/1 s0 - || 0 - 0/1 s0 -",
  "base 0 | Standard | out": "— - 0/1 s0 - || OUT -",
  "base 0 | Hyperspace | in": "0 E 0/1 s0 - || 0 - 0/1 s0 -",
  "base 0 | Hyperspace | out": "— - 0/1 s0 - || OUT -",
  "base 0 | Showcase | in": "0 E 0/1 s0 - || 0 - 0/1 s0 -",
  "base 0 | Showcase | out": "— - 0/1 s0 - || OUT -",
  "base 1 | all | in": "1 C 1/1 s0 - || 1 C 1/1 s0 P",
  "base 1 | all | out": "— - 0/1 s0 - || OUT -",
  "base 1 | Standard | in": "1 C 1/1 s1 P || 1 C 1/1 s1 P",
  "base 1 | Standard | out": "— - 0/1 s0 - || OUT -",
  "base 1 | Hyperspace | in": "1 C 0/1 s0 - || 1 C 0/1 s0 -",
  "base 1 | Hyperspace | out": "— - 0/1 s0 - || OUT -",
  "base 1 | Showcase | in": "1 C 0/1 s0 - || 1 C 0/1 s0 -",
  "base 1 | Showcase | out": "— - 0/1 s0 - || OUT -",
  "unpriced 2 | all | in": "2 - 2/3 s0 - || 2 - 2/3 s0 -",
  "unpriced 2 | all | out": "— - 0/3 s0 - || OUT -",
  "unpriced 2 | Standard | in": "2 - 2/3 s2 - || 2 - 2/3 s2 -",
  "unpriced 2 | Standard | out": "— - 0/3 s0 - || OUT -",
  "unpriced 2 | Hyperspace | in": "2 - 0/3 s0 - || 2 - 0/3 s0 -",
  "unpriced 2 | Hyperspace | out": "— - 0/3 s0 - || OUT -",
  "unpriced 2 | Showcase | in": "2 - 0/3 s0 - || 2 - 0/3 s0 -",
  "unpriced 2 | Showcase | out": "— - 0/3 s0 - || OUT -",
};

describe("playset plate: the four surfaces render the pinned plate", () => {
  it("covers every case in the pinned table", () => {
    expect(CASES.map((c) => c.label).sort()).toEqual(Object.keys(PINNED).sort());
  });

  for (const c of CASES) {
    it(c.label, () => {
      const cell = desktopCell(c);
      const row = phoneRow(c);
      const tile = desktopTile(c);
      const phone = phoneTile(c);
      // The two table surfaces agree with each other, and the two gallery
      // surfaces with each other.
      expect(row).toEqual(cell);
      expect(phone).toEqual(tile);
      expect(line(cell, tile)).toBe(PINNED[c.label]);
    });
  }
});

describe("playset plate: table and gallery read the same five values", () => {
  for (const c of CASES.filter((x) => x.auth)) {
    it(c.label, () => {
      const t = desktopCell(c);
      const g = desktopTile(c);
      // size, filled and owned are the same number on both surfaces.
      expect(g.pips).toBe(t.pips);
      expect(g.filled).toBe(t.filled);
      expect(g.scopedPips).toBe(t.scopedPips);
      expect(g.total).toBe(t.chip);
      // complete drives the chip and the gallery total alike.
      expect(g.totalComplete).toBe(t.chipComplete);
      // scopedComplete: the table shows it only while scoped; the gallery
      // plate shows it while scoped and the overall complete otherwise.
      if (c.scope != null) expect(g.plateComplete).toBe(t.plateComplete);
      else expect(g.plateComplete).toBe(t.chipComplete);
    });
  }
});

describe("playset plate: the card-detail plate equals a scoped gallery tile", () => {
  for (const c of CASES.filter((x) => x.scope != null)) {
    it(c.label, () => {
      const s = plateState(c.card.variants, c.scope as string, c.card.type, c.auth);
      const t = desktopCell(c);
      expect(s.size).toBe(t.pips);
      expect(s.filled).toBe(t.filled);
      expect(s.scoped).toBe(c.auth);
      expect(s.pipsComplete).toBe(t.plateComplete);
      if (c.auth) {
        const g = desktopTile(c);
        expect(String(s.owned)).toBe(g.total);
        expect(s.totalComplete).toBe(g.totalComplete);
        expect(s.pipsComplete).toBe(g.plateComplete);
      } else {
        expect(s.totalComplete).toBe(false);
      }
    });
  }
});

describe("playset plate: an empty-string scope", () => {
  // Pinned as found: the components treat "" as unscoped for the pip count
  // (`scope ? ... : owned`) but as scoped for the amber idiom
  // (`scope != null`); the card-detail plate counts the "" finish (none).
  it("the components fill from the total; the card-detail plate fills none", () => {
    const card = unitCard(2, 1);
    const c: Case = { label: "", card, scope: "", auth: true };
    expect(line(desktopCell(c), desktopTile(c))).toBe("3 C 3/3 s3 - || 3 C 3/3 s3 -");
    expect(line(phoneRow(c), phoneTile(c))).toBe("3 C 3/3 s3 - || 3 C 3/3 s3 -");
    expect(plateState(card.variants, "", card.type, true)).toMatchObject({
      filled: 0,
      pipsComplete: false,
    });
  });
});

describe("playsetPlate: the values the surfaces draw", () => {
  for (const c of CASES)
    it(c.label, () => {
      const p = playsetPlate(c.card, c.scope, c.auth);
      const t = desktopCell(c);
      expect(p.size).toBe(t.pips);
      expect(p.filled).toBe(t.filled);
      expect(p.scoped && p.filled > 0 ? p.filled : 0).toBe(t.scopedPips);
      expect(p.complete).toBe(t.chipComplete);
      expect(p.scopedComplete).toBe(t.plateComplete);
      if (c.auth) {
        const g = desktopTile(c);
        expect(String(p.owned)).toBe(g.total);
        expect(p.pipsComplete).toBe(g.plateComplete);
      } else {
        expect(p).toMatchObject({ scoped: false, filled: 0, pipsComplete: false });
      }
    });

  it("an empty-string scope fills from the total, as the surfaces do", () => {
    expect(playsetPlate(unitCard(2, 1), "", true)).toMatchObject({
      scoped: true,
      filled: 3,
      scopedComplete: false,
      pipsComplete: false,
    });
  });
});
