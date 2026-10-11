import type { PriceHistoryPoint, PriceHistoryRange } from "../../api/baseCards";

// BL-248 S2-07: the price chart's pure rules. Data handling = desktop
// PriceHistoryPanel.tsx (ranges, per-range fetch, null markets dropped, the
// 0.12 pad, the sparse rule, formatUsd / formatAsOf); drawing geometry = rev4
// MPriceChart.jsx (342 x 176 viewBox, left axis gutter, three dashed grid
// lines with mono labels, start / end date labels). Desktop's crosshair
// follows onMouseMove (PriceHistoryPanel.tsx:144-151), which a finger cannot
// do; `nearestIndex` is the same fraction -> nearest point rule, fed by a
// pointer down / move instead (the one replacement idiom).

export const RANGE_OPTIONS: { value: PriceHistoryRange; label: string; words: string }[] = [
  { value: "30d", label: "30D", words: "30 days" },
  { value: "90d", label: "90D", words: "90 days" },
  { value: "1y", label: "1Y", words: "1 year" },
  { value: "all", label: "All", words: "all time" },
];

export const RANGE_DAYS: Record<PriceHistoryRange, number> = {
  "30d": 30,
  "90d": 90,
  "1y": 365,
  all: Infinity,
};

export const W = 342;
export const H = 176;
export const PADL = 44;
export const PADR = 10;
export const PADT = 12;
export const PADB = 26;

export interface ChartPoint {
  v: number;
  as_of: string;
}

/** Desktop: points with a market price, in order. */
export function toPoints(series: PriceHistoryPoint[] | null): ChartPoint[] {
  return (series ?? [])
    .filter((p): p is { as_of: string; market: number } => p.market != null)
    .map((p) => ({ v: p.market, as_of: p.as_of }));
}

export function formatUsd(value: number | null | undefined): string {
  if (value == null) return "—";
  return `$${value.toFixed(2)}`;
}

export function formatAsOf(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** rev4 axis date ("Sep 26"). */
export function formatShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Desktop's sparse notice: fewer points than the range asks for. */
export function isSparse(n: number, range: PriceHistoryRange): boolean {
  const want = RANGE_DAYS[range];
  return n > 0 && want !== Infinity && n < want;
}

export interface Geom {
  x: (i: number) => number;
  y: (v: number) => number;
  path: string;
  ticks: number[];
}

export function chartGeom(points: ChartPoint[]): Geom {
  const n = points.length;
  const vals = points.map((p) => p.v);
  const lo0 = Math.min(...vals);
  const hi0 = Math.max(...vals);
  const pad = (hi0 - lo0) * 0.12 || hi0 * 0.1 || 1;
  const hi = hi0 + pad;
  const lo = Math.max(0, lo0 - pad);
  const x = (i: number) => PADL + (n > 1 ? i / (n - 1) : 0.5) * (W - PADL - PADR);
  const y = (v: number) => PADT + (1 - (v - lo) / (hi - lo)) * (H - PADT - PADB);
  const path = points
    .map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p.v).toFixed(1))
    .join(" ");
  return { x, y, path, ticks: [lo + (hi - lo) * 0.15, (lo + hi) / 2, hi - (hi - lo) * 0.15] };
}

/** The point nearest a horizontal position inside the plot (clientX over the
 * svg's on-screen box), clamped to the series. */
export function nearestIndex(clientX: number, left: number, width: number, n: number): number {
  if (n <= 1) return 0;
  const sx = ((clientX - left) / (width || 1)) * W;
  const i = Math.round(((sx - PADL) / (W - PADL - PADR)) * (n - 1));
  return Math.max(0, Math.min(n - 1, i));
}

/** "+12% over 90 days" for the range's first and last points. */
export function changeText(points: ChartPoint[], range: PriceHistoryRange): string {
  const first = points[0]?.v;
  const last = points[points.length - 1]?.v;
  const words = RANGE_OPTIONS.find((r) => r.value === range)?.words ?? "";
  if (!first || last == null) return "";
  const pct = ((last - first) / first) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}% over ${words}`;
}
