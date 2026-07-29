import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PriceHistoryPanel } from "./PriceHistoryPanel";
import type { VariantDetail } from "../../api/baseCards";

// ─── BL-140 design-conformance pass disposition summary ──────────────────
// This file replaces the pre-conformance-pass PriceHistoryPanel.test.tsx
// (191 lines, overlay-shaped). Disposition per describe block below (PORT /
// REPLACE / RETIRE) -- see CardPopup.test.tsx's own disposition note for the
// embed-orchestration side (compact mount, expand/collapse, Escape routing)
// that moved OUT of this file since it's no longer this component's own
// concern once it stopped being a self-contained overlay.
//
// - RETIRE: "calls onClose on backdrop click but not on a click inside the
//   panel" -- there is no backdrop anymore (not an overlay). No successor;
//   the behavior is designed away.
// - RETIRE: "shows the variant's finish/card number/set in the subtitle" --
//   the overlay's header no longer exists (cardName prop dropped); the full
//   mode's printing label ("Foil · #123") is a narrower REPLACEMENT, covered
//   below.
// - PORT: default-range fetch/loading, error state, range-button
//   active-state + refetch, null-market-day skip -- same behavior, new
//   component shape (compact/full modes instead of one overlay shape).
// - REPLACE: the old single "fewer than 2 priced days" catch-all message
//   ("Not enough price history yet for this range.") is now the design's
//   distinct sparse ("Only N days of data available", n===1 case) vs.
//   isEmpty ("No price data for this printing" + attribution sub-line,
//   n===0 case) states -- both asserted with the new copy/testids.
// - CREATE: hover crosshair/tooltip, sparse notice alongside a rendered
//   chart (n>1 but still short of the requested range), compact vs. full
//   mode differences (expand affordance vs. printing label + close +
//   footer).

const { getPriceHistory } = vi.hoisted(() => ({ getPriceHistory: vi.fn() }));
vi.mock("../../api/baseCards", () => ({ getPriceHistory }));

function makeVariant(overrides: Partial<VariantDetail> = {}): VariantDetail {
  return {
    variant_id: 1,
    variant_type: "Standard",
    finish: "Standard",
    channel: "Retail",
    stamped: false,
    source_set_code: "SOR",
    source_set_name: "Spark of Rebellion",
    card_number: "12",
    front_image_url: null,
    back_image_url: null,
    stamp_group: null,
    quantity: 0,
    ...overrides,
  };
}

async function renderCompact(opts: { variant?: VariantDetail; onExpand?: () => void } = {}) {
  const onExpand = opts.onExpand ?? vi.fn();
  await act(async () => {
    render(
      <PriceHistoryPanel
        baseCardId={1}
        variant={opts.variant ?? makeVariant()}
        compact
        onExpand={onExpand}
      />
    );
  });
  return { onExpand };
}

async function renderFull(opts: { variant?: VariantDetail; onClose?: () => void } = {}) {
  const onClose = opts.onClose ?? vi.fn();
  await act(async () => {
    render(
      <PriceHistoryPanel
        baseCardId={1}
        variant={opts.variant ?? makeVariant()}
        compact={false}
        onClose={onClose}
      />
    );
  });
  return { onClose };
}

describe("PriceHistoryPanel (BL-140 design-conformance pass)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches the selected variant's 90d history by default and shows loading first", async () => {
    let resolveFn: (v: unknown) => void = () => {};
    getPriceHistory.mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      })
    );
    render(<PriceHistoryPanel baseCardId={1} variant={makeVariant()} compact onExpand={vi.fn()} />);
    expect(screen.getByText(/loading price history/i)).toBeTruthy();
    expect(getPriceHistory).toHaveBeenCalledWith(1, 1, "90d");
    await act(async () => {
      resolveFn({ variant_id: 1, range: "90d", series: [] });
    });
  });

  it("shows an error state when the fetch fails", async () => {
    getPriceHistory.mockRejectedValue(new Error("network down"));
    await renderCompact();
    await waitFor(() => expect(screen.getByText("network down")).toBeTruthy());
  });

  // REPLACE: distinct isEmpty copy (design's exact wording) for a genuinely
  // empty series, rather than the retired catch-all "Not enough..." message.
  it("shows the empty state (exact design copy) for a genuinely empty series", async () => {
    getPriceHistory.mockResolvedValue({ variant_id: 1, range: "90d", series: [] });
    await renderCompact();
    await waitFor(() => expect(screen.getByTestId("price-history-empty")).toBeTruthy());
    expect(screen.getByText("No price data for this printing")).toBeTruthy();
    expect(screen.getByText("History appears once TCGplayer lists it")).toBeTruthy();
    expect(screen.queryByTestId("price-history-chart")).toBeNull();
    expect(screen.queryByTestId("price-history-sparse")).toBeNull();
  });

  // REPLACE: a single priced day is sparse (not "empty" -- there IS data,
  // just not enough to draw a line), and shows the distinct sparse message
  // with no chart at all (hasChart needs n>1).
  it("shows the sparse notice (not the empty state) for exactly one priced day, with no chart", async () => {
    getPriceHistory.mockResolvedValue({
      variant_id: 1,
      range: "90d",
      series: [{ as_of: "2026-07-19", market: 10 }],
    });
    await renderCompact();
    await waitFor(() => expect(screen.getByTestId("price-history-sparse")).toBeTruthy());
    expect(screen.getByText("Only 1 day of data available")).toBeTruthy();
    expect(screen.queryByTestId("price-history-chart")).toBeNull();
    expect(screen.queryByTestId("price-history-empty")).toBeNull();
  });

  // CREATE: the sparse notice and the chart are NOT mutually exclusive --
  // n>1 but still short of the requested range's day-count shows both.
  it("shows the sparse notice ALONGSIDE a rendered chart when there's more than one point but fewer than the range wants", async () => {
    getPriceHistory.mockResolvedValue({
      variant_id: 1,
      range: "90d",
      series: [
        { as_of: "2026-07-17", market: 10 },
        { as_of: "2026-07-18", market: 11 },
        { as_of: "2026-07-19", market: 12 },
      ],
    });
    await renderCompact();
    await waitFor(() => expect(screen.getByTestId("price-history-chart")).toBeTruthy());
    expect(screen.getByTestId("price-history-sparse")).toBeTruthy();
    expect(screen.getByText("Only 3 days of data available")).toBeTruthy();
  });

  it("renders the chart once 2+ priced days come back", async () => {
    getPriceHistory.mockResolvedValue({
      variant_id: 1,
      range: "90d",
      series: [
        { as_of: "2026-07-17", market: 10 },
        { as_of: "2026-07-18", market: 11 },
        { as_of: "2026-07-19", market: 12.5 },
      ],
    });
    await renderCompact();
    await waitFor(() => expect(screen.getByTestId("price-history-chart")).toBeTruthy());
  });

  it("skips null-market days rather than breaking the chart (tcgcsv tier gaps)", async () => {
    getPriceHistory.mockResolvedValue({
      variant_id: 1,
      range: "90d",
      series: [
        { as_of: "2026-07-17", market: 10 },
        { as_of: "2026-07-18", market: null },
        { as_of: "2026-07-19", market: 12 },
      ],
    });
    await renderCompact();
    await waitFor(() => expect(screen.getByTestId("price-history-chart")).toBeTruthy());
  });

  it("re-fetches with the new range when a range button is clicked", async () => {
    getPriceHistory.mockResolvedValue({
      variant_id: 1,
      range: "90d",
      series: [
        { as_of: "2026-07-18", market: 10 },
        { as_of: "2026-07-19", market: 12 },
      ],
    });
    await renderCompact();
    await waitFor(() => expect(getPriceHistory).toHaveBeenCalledWith(1, 1, "90d"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "1Y" }));
    });
    expect(getPriceHistory).toHaveBeenCalledWith(1, 1, "1y");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "All" }));
    });
    expect(getPriceHistory).toHaveBeenCalledWith(1, 1, "all");
  });

  it("marks the active range button", async () => {
    getPriceHistory.mockResolvedValue({ variant_id: 1, range: "90d", series: [] });
    await renderCompact();
    const ninety = screen.getByRole("button", { name: "90D" });
    expect(ninety.getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "30D" }));
    });
    expect(screen.getByRole("button", { name: "30D" }).getAttribute("aria-pressed")).toBe("true");
    expect(ninety.getAttribute("aria-pressed")).toBe("false");
  });

  // CREATE: hover crosshair + tooltip (the pre-conformance-pass chart was
  // deliberately non-interactive -- this is the design-conformance fix).
  describe("hover crosshair (CREATE, design-conformance fix)", () => {
    it("shows a tooltip with the hovered point's date + price on mousemove, and clears it on mouseleave", async () => {
      getPriceHistory.mockResolvedValue({
        variant_id: 1,
        range: "90d",
        series: [
          { as_of: "2026-07-17", market: 10 },
          { as_of: "2026-07-18", market: 11 },
          { as_of: "2026-07-19", market: 12 },
        ],
      });
      await renderCompact();
      const chart = await screen.findByTestId("price-history-chart");
      vi.spyOn(chart, "getBoundingClientRect").mockReturnValue({
        left: 0,
        top: 0,
        width: 100,
        height: 40,
        right: 100,
        bottom: 40,
        x: 0,
        y: 0,
        toJSON: () => "",
      });

      expect(screen.queryByTestId("price-history-tooltip")).toBeNull();

      fireEvent.mouseMove(chart, { clientX: 99 });
      // $12.00 legitimately renders twice once the tooltip is up (the
      // y-axis max label AND the tooltip's own price, since the hovered
      // point here happens to be the series max) -- scope to the tooltip.
      const tooltip = screen.getByTestId("price-history-tooltip");
      expect(tooltip.textContent).toContain("Jul 19, 2026");
      expect(tooltip.textContent).toContain("$12.00");

      fireEvent.mouseMove(chart, { clientX: 0 });
      const tooltipAfterMove = screen.getByTestId("price-history-tooltip");
      expect(tooltipAfterMove.textContent).toContain("Jul 17, 2026");
      expect(tooltipAfterMove.textContent).toContain("$10.00");

      fireEvent.mouseLeave(chart);
      expect(screen.queryByTestId("price-history-tooltip")).toBeNull();
    });
  });

  describe("compact mode", () => {
    it("shows the expand (⤢) affordance and calls onExpand when clicked", async () => {
      getPriceHistory.mockResolvedValue({ variant_id: 1, range: "90d", series: [] });
      const { onExpand } = await renderCompact();
      const expandBtn = screen.getByRole("button", { name: /expand price history/i });
      fireEvent.click(expandBtn);
      expect(onExpand).toHaveBeenCalledOnce();
    });

    it("has no close button and no footer", async () => {
      getPriceHistory.mockResolvedValue({
        variant_id: 1,
        range: "90d",
        series: [
          { as_of: "2026-07-18", market: 10 },
          { as_of: "2026-07-19", market: 12 },
        ],
      });
      await renderCompact();
      await waitFor(() => expect(screen.getByTestId("price-history-chart")).toBeTruthy());
      expect(screen.queryByRole("button", { name: /close price history/i })).toBeNull();
      expect(screen.queryByText(/Prices via TCGplayer/)).toBeNull();
    });

    it("has no printing label in the heading (only the full panel shows one)", async () => {
      getPriceHistory.mockResolvedValue({ variant_id: 1, range: "90d", series: [] });
      await renderCompact({ variant: makeVariant({ finish: "Standard Foil", card_number: "13" }) });
      expect(screen.queryByText("Standard Foil · #13")).toBeNull();
    });
  });

  describe("full mode", () => {
    it("shows the printing label in the heading", async () => {
      getPriceHistory.mockResolvedValue({ variant_id: 2, range: "90d", series: [] });
      await renderFull({
        variant: makeVariant({ variant_id: 2, finish: "Standard Foil", card_number: "13" }),
      });
      expect(screen.getByText("Standard Foil · #13")).toBeTruthy();
    });

    it("calls onClose on the × click", async () => {
      getPriceHistory.mockResolvedValue({ variant_id: 1, range: "90d", series: [] });
      const { onClose } = await renderFull();
      fireEvent.click(screen.getByRole("button", { name: /close price history/i }));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("has no expand affordance", async () => {
      getPriceHistory.mockResolvedValue({ variant_id: 1, range: "90d", series: [] });
      await renderFull();
      expect(screen.queryByRole("button", { name: /expand price history/i })).toBeNull();
    });

    it("shows the footer's attribution + as-of date once priced, and a present (no-op) Full view affordance", async () => {
      getPriceHistory.mockResolvedValue({
        variant_id: 1,
        range: "90d",
        series: [
          { as_of: "2026-07-18", market: 10 },
          { as_of: "2026-07-19", market: 12 },
        ],
      });
      const { onClose } = await renderFull();
      await waitFor(() =>
        expect(screen.getByText(/Prices via TCGplayer · as of Jul 19, 2026/)).toBeTruthy()
      );
      const fullView = screen.getByRole("button", { name: /full view/i });
      fireEvent.click(fullView);
      // No-op per PRICING_DEFAULTS_SPEC.md's "keep as no-op" build-judgment
      // option -- present, clickable, doesn't call onClose or throw.
      expect(onClose).not.toHaveBeenCalled();
    });

    it("shows just the attribution (no as-of) when nothing is priced", async () => {
      getPriceHistory.mockResolvedValue({ variant_id: 1, range: "90d", series: [] });
      await renderFull();
      await waitFor(() => expect(screen.getByTestId("price-history-empty")).toBeTruthy());
      expect(screen.getByText("Prices via TCGplayer")).toBeTruthy();
    });
  });
});
