import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryVariant } from "../../utils/inventory";

vi.mock("../../api/baseCards", async (orig) => ({
  ...(await orig<typeof import("../../api/baseCards")>()),
  getPriceHistory: vi.fn(),
}));
import { getPriceHistory } from "../../api/baseCards";
import { PriceChart } from "./PriceChart";
import { chartGeom, changeText, nearestIndex, PADL, PADR, toPoints, W } from "./priceChartModel";

const hist = vi.mocked(getPriceHistory);
const V: InventoryVariant = {
  variant_id: 7221,
  variant_type: "Standard",
  finish: "Standard",
  channel: "Retail",
  source_set_code: "SOR",
  card_number: "87",
  front_image_url: null,
  back_image_url: null,
  quantity: 0,
};
const series = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    as_of: `2026-09-${String(i + 1).padStart(2, "0")}`,
    market: i === 2 ? null : 10 + i,
  }));

describe("S2-07 price history: range -> query, touch crosshair rule", () => {
  beforeEach(() => {
    hist.mockReset();
    hist.mockImplementation(async (_b, v, range) => ({
      variant_id: v,
      range: range ?? "90d",
      series: series(5),
    }));
  });

  it("fetches 90D first, then each range desktop offers (30D / 1Y / All)", async () => {
    const engage = vi.fn();
    render(<PriceChart baseCardId={87} variant={V} onEngage={engage} />);
    await waitFor(() => expect(hist).toHaveBeenCalledWith(87, 7221, "90d"));
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "30D",
      "90D",
      "1Y",
      "All",
    ]);
    for (const [label, range] of [
      ["30D", "30d"],
      ["1Y", "1y"],
      ["All", "all"],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      await waitFor(() => expect(hist).toHaveBeenLastCalledWith(87, 7221, range));
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "true");
    }
    // The first deliberate use reports once.
    expect(engage).toHaveBeenCalledTimes(1);
  });

  it("the neighbour page (live=false) never fetches", () => {
    render(<PriceChart baseCardId={87} variant={V} live={false} />);
    expect(hist).not.toHaveBeenCalled();
  });

  it("readout = the latest point until a touch; null markets are dropped (desktop)", async () => {
    render(<PriceChart baseCardId={87} variant={V} />);
    await waitFor(() => expect(screen.getByText("$14.00")).toBeInTheDocument());
    expect(screen.getByText("Sep 5, 2026")).toBeInTheDocument();
    expect(toPoints(series(5)).map((p) => p.v)).toEqual([10, 11, 13, 14]);
  });

  it("nearestIndex: a finger's x maps to the nearest point, clamped", () => {
    // svg drawn 342 px wide at x=0: plot spans PADL .. W - PADR.
    const at = (frac: number) => PADL + frac * (W - PADL - PADR);
    expect(nearestIndex(at(0), 0, W, 5)).toBe(0);
    expect(nearestIndex(at(0.49), 0, W, 5)).toBe(2);
    expect(nearestIndex(at(0.63), 0, W, 5)).toBe(3);
    expect(nearestIndex(-50, 0, W, 5)).toBe(0);
    expect(nearestIndex(W + 50, 0, W, 5)).toBe(4);
    // Scaled svg (drawn at half size): same fraction, same point.
    expect(nearestIndex(at(0.63) / 2, 0, W / 2, 5)).toBe(3);
  });

  it("geometry + change line (desktop pad, rev4 ticks)", () => {
    const pts = toPoints(series(5));
    const g = chartGeom(pts);
    expect(g.ticks).toHaveLength(3);
    expect(g.path.startsWith("M")).toBe(true);
    expect(changeText(pts, "90d")).toBe("+40% over 90 days");
    expect(changeText(pts, "all")).toBe("+40% over all time");
  });
});
