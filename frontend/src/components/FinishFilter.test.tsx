import { useState } from "react";
import { render, act, fireEvent, screen, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { FinishFilter } from "./FinishFilter";
import type { FinishTreeRow } from "../utils/filters";

// BL-133 (issue #318): component-level coverage for the Finish field's
// two-tier dropdown -- rendered directly against hand-built FinishTreeRow
// fixtures (not through buildFinishTree/real cards) so each test isolates
// one interaction/accessibility concern without depending on the
// grouping/pairing/ordering rules, which are pure-tested against
// buildFinishTree/shapeFinishTree in utils/filters.test.ts. Divider
// placement and the pinned/below-divider boundary specifically ARE the
// ordering rules' job, so those stay covered there; this file exercises
// what a user/assistive-tech would actually interact with.

function Wrapper({
  tree,
  valid = null,
  showAllValues = false,
  initial = new Set<string>(),
}: {
  tree: FinishTreeRow[];
  valid?: Set<string> | null;
  showAllValues?: boolean;
  initial?: Set<string>;
}) {
  const [values, setValues] = useState<Set<string>>(initial);
  return (
    <FinishFilter
      label="Finish"
      values={values}
      onChange={setValues}
      tree={tree}
      valid={valid}
      showAllValues={showAllValues}
      placeholder="All finishes"
    />
  );
}

async function renderAndOpen(props: Parameters<typeof Wrapper>[0]) {
  await act(async () => {
    render(<Wrapper {...props} />);
  });
  fireEvent.click(screen.getByRole("button", { name: /^Finish —/ }));
}

const STANDARD_PAIR: FinishTreeRow = {
  kind: "pair",
  key: "Standard",
  label: "Standard",
  baseValue: "Standard",
  foilValue: "Standard Foil",
  pinned: true,
};

const PRESTIGE_GROUP: FinishTreeRow = {
  kind: "group",
  key: "Prestige",
  label: "Prestige",
  pinned: true,
  children: [
    { value: "Standard Prestige", displayLabel: "Standard" },
    { value: "Foil Prestige", displayLabel: "Foil" },
    { value: "Serialized Prestige", displayLabel: "Serialized" },
  ],
};

// BL-173 review round 4: Prestige now renders as a CHIP row (see its own
// describe below), so the expandable-group behavior tests use a tournament
// family -- the kind of group that still renders expandable.
const TOURNAMENT_GROUP: FinishTreeRow = {
  kind: "group",
  key: "Galactic Championship",
  label: "Galactic Championship",
  pinned: false,
  children: [
    { value: "GC Top 8", displayLabel: "Top 8" },
    { value: "GC Finalist", displayLabel: "Finalist" },
    { value: "GC Champion", displayLabel: "Champion" },
  ],
};

const SHOWCASE_PLAIN: FinishTreeRow = {
  kind: "plain",
  key: "Showcase",
  value: "Showcase",
  label: "Showcase",
  pinned: true,
};

const CONVENTION_PLAIN: FinishTreeRow = {
  kind: "plain",
  key: "Convention Exclusive",
  value: "Convention Exclusive",
  label: "Convention Exclusive",
  pinned: false,
};

describe("FinishFilter pair rows (Variant B)", () => {
  it("renders one row with the base label and two independently toggleable chips", async () => {
    await renderAndOpen({ tree: [STANDARD_PAIR] });

    expect(screen.getByText("Standard")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Standard" })).toBeTruthy(); // Non-foil chip
    expect(screen.getByRole("button", { name: "Standard Foil" })).toBeTruthy(); // Foil chip
  });

  it("toggles only the clicked chip's raw value, independently of the other chip (CREATE)", async () => {
    await renderAndOpen({ tree: [STANDARD_PAIR] });

    const nonFoilChip = screen.getByRole("button", { name: "Standard" });
    const foilChip = screen.getByRole("button", { name: "Standard Foil" });

    fireEvent.click(nonFoilChip);
    expect(nonFoilChip.getAttribute("aria-pressed")).toBe("true");
    expect(foilChip.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(foilChip);
    expect(nonFoilChip.getAttribute("aria-pressed")).toBe("true");
    expect(foilChip.getAttribute("aria-pressed")).toBe("true");

    // Deselecting one leaves the other lit -- no "Both" segment, no coupling.
    fireEvent.click(nonFoilChip);
    expect(nonFoilChip.getAttribute("aria-pressed")).toBe("false");
    expect(foilChip.getAttribute("aria-pressed")).toBe("true");
  });

  it("degrades to a single chip when the other side is facet-invalid, unselected, and show-all is off", async () => {
    // "Standard Foil" is absent from the facet-valid set.
    await renderAndOpen({ tree: [STANDARD_PAIR], valid: new Set(["Standard"]) });

    expect(screen.getByRole("button", { name: "Standard" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Standard Foil" })).toBeNull();
  });

  it("greys out an inert-but-selected chip instead of hiding it (BL-70 parity)", async () => {
    await renderAndOpen({
      tree: [STANDARD_PAIR],
      valid: new Set(["Standard"]),
      initial: new Set(["Standard Foil"]),
    });

    // Anchored so this doesn't also match the trigger button, whose own
    // accessible name ("Finish — Standard Foil") also contains this text.
    const foilChip = screen.getByRole("button", { name: /^Standard Foil/ });
    expect(foilChip.className).toContain("ifp-finish-pair__chip--inert");
    expect(foilChip.getAttribute("aria-pressed")).toBe("true");
    expect(foilChip).not.toBeDisabled(); // still removable
  });
});

// DISPOSITION (PORT, BL-173 review round 4): this describe originally used
// the Prestige group as its exemplar; Prestige now renders as a chip row
// (owner call, its own describe below), so the SAME group behaviors are
// asserted against a tournament group -- the family that still expands.
describe("FinishFilter expandable groups", () => {
  it("clicking the parent row toggles expand/collapse only -- it never selects anything (CREATE)", async () => {
    await renderAndOpen({ tree: [TOURNAMENT_GROUP] });

    const header = screen.getByRole("button", { name: "Galactic Championship" });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    // No children rendered while collapsed.
    expect(screen.queryByRole("option", { name: /^GC / })).toBeNull();

    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("true");
    // Expanding must not have selected anything.
    expect(screen.getByRole("option", { name: "GC Top 8" }).getAttribute("aria-selected")).toBe(
      "false"
    );

    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
  });

  it("renders children with a prefix/suffix-stripped display label but the full raw value as the accessible name (CREATE)", async () => {
    await renderAndOpen({ tree: [TOURNAMENT_GROUP] });
    fireEvent.click(screen.getByRole("button", { name: "Galactic Championship" }));

    const child = screen.getByRole("option", { name: "GC Top 8" });
    expect(child.textContent).toContain("Top 8");
    expect(child.textContent).not.toContain("GC Top 8");
  });

  it("toggling a child adds/removes its full raw value in the selection Set, not the stripped label (CREATE)", async () => {
    let latest: Set<string> = new Set();
    await act(async () => {
      render(
        <FinishFilter
          label="Finish"
          values={new Set()}
          onChange={(v) => {
            latest = v;
          }}
          tree={[TOURNAMENT_GROUP]}
          valid={null}
          showAllValues={false}
        />
      );
    });
    fireEvent.click(screen.getByRole("button", { name: /^Finish —/ }));
    fireEvent.click(screen.getByRole("button", { name: "Galactic Championship" }));
    fireEvent.click(screen.getByRole("option", { name: "GC Champion" }));

    expect(latest.has("GC Champion")).toBe(true);
    expect(latest.has("Champion")).toBe(false);
  });

  it("shows a selected-count badge on a collapsed parent, and hides it once expanded (CREATE)", async () => {
    await renderAndOpen({
      tree: [TOURNAMENT_GROUP],
      initial: new Set(["GC Top 8", "GC Champion"]),
    });

    // Anchored so this doesn't also match the trigger button, whose own
    // accessible name ("Finish — GC Top 8, GC Champion") also contains the
    // group's own words.
    const header = screen.getByRole("button", { name: /^Galactic Championship/ });
    expect(header.textContent).toContain("2");
    expect(header.className).toContain("ifp-finish-group__header--selected");

    fireEvent.click(header);
    // Expanded: badge no longer needed, children show their own checked state.
    expect(header.textContent).not.toMatch(/·\s*2/);
    expect(screen.getByRole("option", { name: "GC Top 8" }).getAttribute("aria-selected")).toBe(
      "true"
    );
  });

  it("marks the group muted when every child is facet-inert (CREATE: all-children-inert styling)", async () => {
    await renderAndOpen({
      tree: [TOURNAMENT_GROUP],
      valid: new Set(), // nothing valid
      showAllValues: true, // reveal the (now all-inert) children instead of hiding the group
    });

    const groupContainer = screen
      .getByRole("button", { name: "Galactic Championship" })
      .closest(".ifp-finish-group");
    expect(groupContainer?.className).toContain("ifp-finish-group--inert");
  });

  it("expansion state resets to collapsed when the dropdown closes and reopens", async () => {
    await act(async () => {
      render(<Wrapper tree={[TOURNAMENT_GROUP]} />);
    });
    const trigger = screen.getByRole("button", { name: /^Finish —/ });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Galactic Championship" }));
    expect(
      screen.getByRole("button", { name: "Galactic Championship" }).getAttribute("aria-expanded")
    ).toBe("true");

    // Close (Escape) and reopen.
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(trigger);
    expect(
      screen.getByRole("button", { name: "Galactic Championship" }).getAttribute("aria-expanded")
    ).toBe("false");
  });
});

// CREATE (BL-173 review round 4, owner): the Prestige family renders as a
// CHIP row like the foil pairs -- normalized with the Playset scope picker.
// Presentation-tier only: the tree row is still kind "group".
describe("FinishFilter Prestige chip row (BL-173 round 4)", () => {
  it("renders label + three chips (Std/Foil/Serialized faces, full raw values as accessible names) with no expander", async () => {
    await renderAndOpen({ tree: [PRESTIGE_GROUP] });

    // No expandable header for Prestige anymore.
    expect(screen.queryByRole("button", { name: "Prestige" })).toBeNull();

    const std = screen.getByRole("button", { name: "Standard Prestige" });
    expect(std.textContent).toBe("Std");
    expect(screen.getByRole("button", { name: "Foil Prestige" }).textContent).toBe("Foil");
    expect(screen.getByRole("button", { name: "Serialized Prestige" }).textContent).toBe(
      "Serialized"
    );
  });

  it("toggling a chip adds/removes its full raw value; chips reflect checked state via aria-pressed", async () => {
    let latest: Set<string> = new Set();
    await act(async () => {
      render(
        <FinishFilter
          label="Finish"
          values={new Set()}
          onChange={(v) => {
            latest = v;
          }}
          tree={[PRESTIGE_GROUP]}
          valid={null}
          showAllValues={false}
        />
      );
    });
    fireEvent.click(screen.getByRole("button", { name: /^Finish —/ }));
    fireEvent.click(screen.getByRole("button", { name: "Serialized Prestige" }));
    expect(latest.has("Serialized Prestige")).toBe(true);
  });

  it("an inert unselected chip is disabled; an inert selected chip stays clickable (BL-70 parity)", async () => {
    await renderAndOpen({
      tree: [PRESTIGE_GROUP],
      valid: new Set(),
      showAllValues: true,
      initial: new Set(["Foil Prestige"]),
    });
    expect(screen.getByRole("button", { name: "Standard Prestige (0)" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Foil Prestige (0)" })).not.toBeDisabled();
  });
});

describe("FinishFilter plain rows + divider", () => {
  it("keeps plain rows behaving like today's flat options (role=option, checkbox toggle, (0)-suffix when inert)", async () => {
    await renderAndOpen({ tree: [SHOWCASE_PLAIN], valid: new Set(), showAllValues: true });

    const opt = screen.getByRole("option", { name: /Showcase/ });
    expect(opt.textContent).toContain("(0)");
    expect(opt.className).toContain("ifp-multi__item--inert");
    expect(opt).toBeDisabled();
  });

  it("renders a divider between the pinned section and the below-divider section when both are non-empty", async () => {
    await renderAndOpen({ tree: [SHOWCASE_PLAIN, CONVENTION_PLAIN] });

    const items = document.querySelector(".ifp-multi__items")!;
    const dividers = items.querySelectorAll(".ifp-multi__pin-divider");
    expect(dividers).toHaveLength(1);
    const children = Array.from(items.children);
    const idx = children.indexOf(dividers[0]);
    expect(children[idx - 1]).toHaveTextContent("Showcase");
    expect(children[idx + 1]).toHaveTextContent("Convention Exclusive");
  });

  it("renders no divider when every row is pinned", async () => {
    await renderAndOpen({ tree: [SHOWCASE_PLAIN] });
    expect(document.querySelectorAll(".ifp-multi__pin-divider")).toHaveLength(0);
  });
});

describe("FinishFilter menubar", () => {
  it("Clear empties the whole selection across pair/group/plain rows", async () => {
    await renderAndOpen({
      tree: [STANDARD_PAIR, PRESTIGE_GROUP, SHOWCASE_PLAIN],
      initial: new Set(["Standard", "Standard Prestige", "Showcase"]),
    });

    fireEvent.click(within(screen.getByRole("listbox")).getByRole("button", { name: "Clear" }));

    expect(screen.getByRole("button", { name: "Standard" }).getAttribute("aria-pressed")).toBe(
      "false"
    );
    expect(screen.getByRole("option", { name: /Showcase/ }).getAttribute("aria-selected")).toBe(
      "false"
    );
  });
});
