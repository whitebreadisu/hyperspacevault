import { useEffect, useMemo, useState } from "react";
import { getPriceHistory } from "../../api/baseCards";
import type { PriceHistoryPoint, PriceHistoryRange, VariantDetail } from "../../api/baseCards";
import "./PriceHistoryPanel.css";

/** BL-140 design-conformance pass (2026-07-21): aligns the history panel
 * with Jeremy's saved DesignSync defaults, extracted to disk at
 * claude_design/extracted_2026-07-21/{PRICING_DEFAULTS_SPEC.md,
 * HistoryPanel.dc.html} after the original build (DesignSync was
 * unreachable from that agent's tool set). The original build shipped this
 * as an independent overlay opened by a "View price history" button, no
 * hover interaction. The saved defaults (chartPlacement=under-printings,
 * historyEmbed=expand-below) call for a COMPACT panel permanently embedded
 * under the printings rail -- re-rendering on printing selection -- with an
 * expand (⤢) affordance opening a FULL panel appended BELOW the popup's grid;
 * never an overlay. CardPopup.tsx now mounts two instances of this
 * component (compact=true always-on, compact=false only while expanded)
 * that each own their own range state/fetch independently, matching the
 * mock's per-instance range toggle.
 *
 * Recorded deviations from the .dc mock:
 * - The mock assumes one upfront fetch of a printing's FULL history with
 *   client-side range slicing (`pts.slice(-want)`). This app's
 *   GET .../price-history takes a `range` query param and the backend does
 *   the slicing server-side (only VariantPrice rows inside the window come
 *   back -- backend/app/repositories/pricing.py's get_price_history), so
 *   this component re-fetches per range change instead of slicing
 *   client-side.
 * - Because of that, "isEmpty"/sparse detection is necessarily PER THE
 *   SELECTED RANGE (no data in this window) rather than the mock's per-all-
 *   time signal (no data ever, in any window) -- there's no single "does
 *   this printing have ANY history" signal without an extra full-range
 *   fetch, and the range toggle already gives the user an escape hatch
 *   (try a wider range) that makes the distinction low-value here.
 * - The mock's `newSet` flag (a distinct "New printing -- N days" sparse
 *   message) has no backend signal to key off -- collapsed to the single
 *   "Only N days of data available" message in both cases.
 * - "Full view →" (full mode footer) maps to nothing yet in the mock either
 *   (its own onClick is a placeholder alert) -- kept as a present, inert
 *   affordance here rather than dropped, per the spec's "keep as a no-op"
 *   option. */

const RANGE_OPTIONS: { value: PriceHistoryRange; label: string }[] = [
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "1y", label: "1Y" },
  { value: "all", label: "All" },
];

const RANGE_DAYS: Record<PriceHistoryRange, number> = {
  "30d": 30,
  "90d": 90,
  "1y": 365,
  all: Infinity,
};

function formatUsd(value: number | null | undefined): string {
  if (value == null) return "—";
  return `$${value.toFixed(2)}`;
}

function formatAsOf(iso: string | null | undefined): string {
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

/** m/d for sub-year ranges, m/yy at 1y+/all -- HistoryPanel.dc.html's `fmt`. */
function formatTick(iso: string, wantDays: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const m = d.getUTCMonth() + 1;
  if (wantDays === Infinity || wantDays >= 365) {
    return `${m}/${String(d.getUTCFullYear()).slice(-2)}`;
  }
  return `${m}/${d.getUTCDate()}`;
}

/** "Foil · #123" -- HistoryPanel.dc.html's full-mode `printingLabel`. */
function printingLabel(v: VariantDetail): string {
  return `${v.finish ?? v.variant_type} · #${v.card_number}`;
}

interface ChartPoint {
  v: number;
  as_of: string;
}

/** SVG line chart w/ hover crosshair (HistoryPanel.dc.html's Component.
 * renderVals chart block) -- 560x170 viewBox, non-uniform scale
 * (preserveAspectRatio="none") so the same markup serves the shorter compact
 * embed (chartH=110) and the taller full panel (chartH=170) via just the
 * rendered <svg height>. */
function HistoryChart({
  points,
  chartH,
  wantDays,
}: {
  points: ChartPoint[];
  chartH: number;
  wantDays: number;
}) {
  const [hoverIdx, setHoverIdx] = useState(-1);
  const n = points.length;
  const width = 560;
  const height = 170;

  const { top, bot } = useMemo(() => {
    const lo = Math.min(...points.map((p) => p.v));
    const hi = Math.max(...points.map((p) => p.v));
    const pad = (hi - lo) * 0.12 || hi * 0.1 || 1;
    return { top: hi + pad, bot: Math.max(0, lo - pad) };
  }, [points]);

  const coords = useMemo(
    () =>
      points.map((p, i) => ({
        x: n > 1 ? (i * width) / (n - 1) : width / 2,
        y: (1 - (p.v - bot) / (top - bot)) * height,
      })),
    [points, n, top, bot]
  );
  const chartPoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");

  const yMaxLabel = formatUsd(Math.max(...points.map((p) => p.v)));
  const yMinLabel = formatUsd(Math.min(...points.map((p) => p.v)));

  const tickIdxs = [...new Set([0, Math.floor((n - 1) / 3), Math.floor((2 * (n - 1)) / 3), n - 1])];
  const xTicks = tickIdxs.map((i) => ({ key: i, label: formatTick(points[i].as_of, wantDays) }));

  const hasHover = hoverIdx >= 0 && hoverIdx < n;
  const hoverPoint = hasHover ? points[hoverIdx] : null;
  const hoverCoord = hasHover ? coords[hoverIdx] : null;
  const hoverLeftPct = hoverCoord ? (hoverCoord.x / width) * 100 : 0;
  const hoverTopPct = hoverCoord ? (hoverCoord.y / height) * 100 : 0;
  const tipLeftPct = Math.min(84, Math.max(16, hoverLeftPct));

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (n < 1) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const w = rect.width || 1;
    const fr = Math.min(1, Math.max(0, (e.clientX - rect.left) / w));
    setHoverIdx(n > 1 ? Math.round(fr * (n - 1)) : 0);
  };
  const onLeave = () => setHoverIdx(-1);

  return (
    <div className="php-chart-box">
      <div
        className="php-chart-hover"
        data-testid="price-history-chart"
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        <svg
          className="php-chart"
          width="100%"
          height={chartH}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Daily market price history"
        >
          <line x1="0" y1="0.5" x2={width} y2="0.5" className="php-chart__hairline" />
          <line
            x1="0"
            y1={height / 2}
            x2={width}
            y2={height / 2}
            className="php-chart__hairline php-chart__hairline--dashed"
          />
          <line
            x1="0"
            y1={height - 0.5}
            x2={width}
            y2={height - 0.5}
            className="php-chart__hairline"
          />
          <polyline points={chartPoints} className="php-chart__line" fill="none" />
        </svg>
        <span className="php-chart__ylabel php-chart__ylabel--max">{yMaxLabel}</span>
        <span className="php-chart__ylabel php-chart__ylabel--min">{yMinLabel}</span>
        {hasHover && hoverPoint && (
          <>
            <div className="php-chart__hoverline" style={{ left: `${hoverLeftPct}%` }} />
            <div
              className="php-chart__hoverdot"
              style={{ left: `${hoverLeftPct}%`, top: `${hoverTopPct}%` }}
            />
            <div
              className="php-chart__tooltip"
              style={{ left: `${tipLeftPct}%` }}
              data-testid="price-history-tooltip"
            >
              <span className="php-chart__tooltip-date">{formatAsOf(hoverPoint.as_of)}</span>
              <span className="php-chart__tooltip-price">{formatUsd(hoverPoint.v)}</span>
            </div>
          </>
        )}
      </div>
      <div className="php-chart__xticks">
        {xTicks.map((tk) => (
          <span key={tk.key}>{tk.label}</span>
        ))}
      </div>
    </div>
  );
}

interface Props {
  baseCardId: number;
  variant: VariantDetail;
  /** compact=true: embedded under the printings rail, always mounted while a
   * printing is selected (chartH=110, shows the ⤢ expand affordance).
   * compact=false: the full panel appended below the popup's grid once
   * expanded (chartH=170, shows the printing label + × close + footer). */
  compact: boolean;
  onExpand?: () => void;
  onClose?: () => void;
}

export function PriceHistoryPanel({ baseCardId, variant, compact, onExpand, onClose }: Props) {
  const [range, setRange] = useState<PriceHistoryRange>("90d");
  const [series, setSeries] = useState<PriceHistoryPoint[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getPriceHistory(baseCardId, variant.variant_id, range)
      .then((res) => {
        if (cancelled) return;
        setSeries(res.series);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load price history");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [baseCardId, variant.variant_id, range]);

  const points: ChartPoint[] = (series ?? [])
    .filter((p): p is { as_of: string; market: number } => p.market != null)
    .map((p) => ({ v: p.market, as_of: p.as_of }));

  const wantDays = RANGE_DAYS[range];
  const n = points.length;
  const hasChart = n > 1;
  const isEmpty = n === 0;
  const sparseVisible = n > 0 && wantDays !== Infinity && n < wantDays;
  const latest = n > 0 ? points[n - 1] : null;

  return (
    <div
      className={`php-panel${compact ? " php-panel--compact" : " php-panel--full"}`}
      data-testid="price-history-panel"
    >
      <div className="php-heading">
        <span className="php-label">Price history</span>
        {!compact && <span className="php-printing">{printingLabel(variant)}</span>}
        <span className="php-ranges" role="group" aria-label="Date range">
          {RANGE_OPTIONS.map((opt) => (
            <button
              type="button"
              key={opt.value}
              className={`php-range-btn${range === opt.value ? " php-range-btn--active" : ""}`}
              aria-pressed={range === opt.value}
              onClick={() => setRange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </span>
        {compact && onExpand && (
          <button
            type="button"
            className="php-expand"
            title="Expand price history"
            aria-label="Expand price history"
            onClick={onExpand}
          >
            ⤢
          </button>
        )}
        {!compact && onClose && (
          <button
            type="button"
            className="php-close"
            onClick={onClose}
            aria-label="Close price history"
          >
            ×
          </button>
        )}
      </div>

      {loading && <div className="php-status">Loading price history…</div>}
      {!loading && error && <div className="php-status php-status--error">{error}</div>}

      {!loading && !error && sparseVisible && (
        <div className="php-sparse" data-testid="price-history-sparse">
          Only {n} day{n === 1 ? "" : "s"} of data available
        </div>
      )}

      {!loading && !error && hasChart && (
        <HistoryChart points={points} chartH={compact ? 110 : 170} wantDays={wantDays} />
      )}

      {!loading && !error && isEmpty && (
        <div className="php-empty" data-testid="price-history-empty">
          <span className="php-empty__dash">—</span>
          <span className="php-empty__title">No price data for this printing</span>
          <span className="php-empty__sub">History appears once TCGplayer lists it</span>
        </div>
      )}

      {!compact && !loading && !error && (
        <div className="php-footer">
          <span className="php-footer__asof">
            Prices via TCGplayer{latest ? ` · as of ${formatAsOf(latest.as_of)}` : ""}
          </span>
          <button type="button" className="php-fullview" onClick={() => {}}>
            Full view →
          </button>
        </div>
      )}
    </div>
  );
}
