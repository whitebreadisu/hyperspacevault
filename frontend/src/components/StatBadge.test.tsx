import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StatBadge } from "./StatBadge";

// DISPOSITION (BL-111 F1, CREATE): new component, no prior coverage exists.
// StatBadge isn't wired into any screen yet (later BL-111 features do that),
// so this suite is its only consumer in this PR -- it locks in the geometry
// contract (shape identity, gradient ids, sizing) the design handoff
// specifies as final, ahead of integration.
describe("StatBadge (BL-111 F1)", () => {
  it("renders the cost badge with its hexagon path and gradient", () => {
    render(<StatBadge type="cost" value={4} />);
    const svg = screen.getByTestId("stat-badge-cost");
    expect(svg.querySelector("path")).toHaveAttribute(
      "d",
      "M50 3 L96 14.5 L96 90.5 L50 102 L4 90.5 L4 14.5 Z"
    );
    expect(svg.querySelector("linearGradient#swu-cost-g")).toBeInTheDocument();
    expect(svg).toHaveAttribute("viewBox", "0 0 100 105");
    expect(screen.getAllByText("4")[0]).toBeInTheDocument();
  });

  it("renders the power badge with its narrow hexagon path, gradient, and corner tabs", () => {
    render(<StatBadge type="power" value={7} />);
    const svg = screen.getByTestId("stat-badge-power");
    expect(svg.querySelector("path")).toHaveAttribute(
      "d",
      "M50 3 L91 19 L91 86 L50 102 L9 86 L9 19 Z"
    );
    expect(svg.querySelector("linearGradient#swu-power-g")).toBeInTheDocument();
    expect(svg.querySelectorAll("rect")).toHaveLength(4);
    expect(svg).toHaveAttribute("preserveAspectRatio", "none");
    expect(screen.getAllByText("7")[0]).toBeInTheDocument();
  });

  it("renders the hp badge with its rounded-square path, gradient, corner tabs, and rivets", () => {
    render(<StatBadge type="hp" value={30} />);
    const svg = screen.getByTestId("stat-badge-hp");
    expect(svg.querySelector("path")).toHaveAttribute(
      "d",
      "M35.7 4.5 C44.4 3.5 55.6 3.5 64.3 4.5 C78.5 7 93.8 18 94.8 34 C95.4 42 93.5 47 93.5 52.5 C93.5 58 95.4 63 94.8 71 C93.8 87 78.5 98 64.3 100.5 C55.6 101.5 44.4 101.5 35.7 100.5 C21.5 98 6.1 87 5.2 71 C4.6 63 6.5 58 6.5 52.5 C6.5 47 4.6 42 5.2 34 C6.1 18 21.5 7 35.7 4.5 Z"
    );
    expect(svg.querySelector("linearGradient#swu-hp-g")).toBeInTheDocument();
    expect(svg.querySelectorAll("rect")).toHaveLength(4);
    expect(svg.querySelectorAll("circle")).toHaveLength(4);
    expect(svg).toHaveAttribute("preserveAspectRatio", "none");
    expect(screen.getAllByText("30")[0]).toBeInTheDocument();
  });

  it("keeps each type's gradient distinct from the others", () => {
    const { rerender } = render(<StatBadge type="cost" value={1} />);
    expect(document.querySelector("#swu-cost-g")).toBeInTheDocument();
    expect(document.querySelector("#swu-power-g")).not.toBeInTheDocument();

    rerender(<StatBadge type="power" value={1} />);
    expect(document.querySelector("#swu-power-g")).toBeInTheDocument();
    expect(document.querySelector("#swu-cost-g")).not.toBeInTheDocument();

    rerender(<StatBadge type="hp" value={1} />);
    expect(document.querySelector("#swu-hp-g")).toBeInTheDocument();
    expect(document.querySelector("#swu-power-g")).not.toBeInTheDocument();
  });

  it("defaults size to 40 and derives cost height as 1.05x, power/hp height as 1.1x", () => {
    render(<StatBadge type="cost" value={1} />);
    const cost = screen.getByTestId("stat-badge-cost");
    expect(cost).toHaveAttribute("width", "40");
    expect(cost).toHaveAttribute("height", "42"); // round(40 * 1.05)
  });

  it("scales width and derived height with the size prop", () => {
    render(<StatBadge type="power" value={1} size={80} />);
    const power = screen.getByTestId("stat-badge-power");
    expect(power).toHaveAttribute("width", "80");
    expect(power).toHaveAttribute("height", "88"); // round(80 * 1.1)
  });

  // DISPOSITION (BL-132 J2, PORT): the component's null -> "—" fallback is
  // still real and still worth locking in, but it's no longer exercised by
  // any shipped caller -- CardsTable and CardPopup both now suppress the
  // badge entirely for a null stat instead of rendering this placeholder
  // (see StatBadge.tsx's Props doc comment). This is a component-contract
  // case only (a defensive fallback for any future caller that does pass
  // null), not a description of current app behavior.
  it("renders an em-dash placeholder when value is null (component-contract only -- no shipped caller passes null post-BL-132)", () => {
    render(<StatBadge type="hp" value={null} />);
    const svg = screen.getByTestId("stat-badge-hp");
    expect(svg).toHaveAttribute("aria-label", "HP —");
    expect(screen.getAllByText("—")[0]).toBeInTheDocument();
  });
});

// DISPOSITION (BL-123, PORT): the pre-fix suite above never asserted HOW the
// numeral was rendered (its `getAllByText` queries pass against either a
// foreignObject/div pair or a native <text> element, so they didn't need
// changing) -- but that also means nothing here locked in the fix or would
// catch a regression back to foreignObject. Adding coverage for the new
// native-<text> mechanism itself: WebKit renders `foreignObject` children at
// CSS-pixel scale instead of the SVG viewBox scale, oversizing the numeral;
// native SVG `<text>` is immune by construction since it's real SVG
// geometry, scaled by the viewBox like every sibling shape.
describe("StatBadge numeral rendering (BL-123 -- foreignObject -> native <text>)", () => {
  it("renders the numeral as a native SVG <text> element, not a foreignObject/HTML pair", () => {
    render(<StatBadge type="cost" value={4} />);
    const svg = screen.getByTestId("stat-badge-cost");
    expect(svg.querySelector("foreignObject")).not.toBeInTheDocument();
    const text = svg.querySelector("text");
    expect(text).toBeInTheDocument();
    expect(text).toHaveTextContent("4");
  });

  it("paints the stroke layer under the fill via paint-order, in one element per numeral", () => {
    render(<StatBadge type="power" value={9} />);
    const svg = screen.getByTestId("stat-badge-power");
    const texts = svg.querySelectorAll("text");
    expect(texts).toHaveLength(1);
    const text = texts[0];
    expect(text).toHaveAttribute("paint-order", "stroke");
    expect(text).toHaveAttribute("stroke", "#330608");
    expect(text).toHaveAttribute("stroke-width", "8");
    expect(text).toHaveAttribute("fill", "#FBEFEA");
    expect(text).toHaveAttribute("text-anchor", "middle");
  });

  it("uses each type's own stroke/fill colors for the numeral", () => {
    const { rerender } = render(<StatBadge type="cost" value={1} />);
    let text = screen.getByTestId("stat-badge-cost").querySelector("text");
    expect(text).toHaveAttribute("stroke", "#3A2E0C");
    expect(text).toHaveAttribute("fill", "#FBF3DC");

    rerender(<StatBadge type="hp" value={1} />);
    text = screen.getByTestId("stat-badge-hp").querySelector("text");
    expect(text).toHaveAttribute("stroke", "#0C2137");
    expect(text).toHaveAttribute("fill", "#FFFFFF");
  });

  // REPLACE (owner dev review 2026-07-26 rounds 4-6): anchor y 52.5 -> 48 -> 44 -> 46 -> 47 -> 50 (visible-step recalibration) (the
  // numeral read ~2px low at popup size; see StatBadge.tsx's constant note).
  it("scales the numeral about the shape's center via an SVG transform (translate then scale)", () => {
    render(<StatBadge type="cost" value={1} />);
    const text = screen.getByTestId("stat-badge-cost").querySelector("text");
    expect(text).toHaveAttribute("transform", expect.stringMatching(/^translate\(50 50\) scale\(/));

    render(<StatBadge type="hp" value={1} />);
    const hpTexts = screen.getAllByTestId("stat-badge-hp");
    const hpText = hpTexts[hpTexts.length - 1].querySelector("text");
    expect(hpText).toHaveAttribute(
      "transform",
      expect.stringMatching(/^translate\(50 50\) scale\(/)
    );
  });

  it("renders the null-value em-dash through the same native <text> element", () => {
    render(<StatBadge type="power" value={null} />);
    const text = screen.getByTestId("stat-badge-power").querySelector("text");
    expect(text).toHaveTextContent("—");
    expect(text).toHaveAttribute("paint-order", "stroke");
  });
});
