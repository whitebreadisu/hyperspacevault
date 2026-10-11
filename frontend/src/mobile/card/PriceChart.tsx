import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { getPriceHistory } from "../../api/baseCards";
import type { PriceHistoryPoint, PriceHistoryRange } from "../../api/baseCards";
import type { InventoryVariant } from "../../utils/inventory";
import {
  changeText,
  chartGeom,
  formatAsOf,
  formatShort,
  formatUsd,
  H,
  isSparse,
  nearestIndex,
  PADB,
  PADL,
  PADR,
  PADT,
  RANGE_OPTIONS,
  toPoints,
  W,
} from "./priceChartModel";

// BL-248 S2-07: price history for the selected printing (rev4
// MPriceChart.jsx at phone size over desktop PriceHistoryPanel.tsx's data:
// getPriceHistory per range, 30D / 90D / 1Y / All, 90D default, line chart
// only -- owner decision). The readout above the plot shows the latest point
// until a finger touches the plot: a pointer down / move sets the reading to
// the nearest point and it stays where the finger lifts (desktop's hover
// crosshair has no touch equivalent; this is the replacement idiom). The plot
// keeps vertical panning (touch-action: pan-y) and the card swipe ignores
// touches that start on it. Numerals and the axis are --font-mono.

interface Props {
  baseCardId: number;
  variant: InventoryVariant;
  /** False for the neighbour page drawn during a swipe: no fetch. */
  live?: boolean;
  /** First deliberate use (a range tap or a touch on the plot). */
  onEngage?: () => void;
}

export function PriceChart({ baseCardId, variant, live = true, onEngage }: Props) {
  const [range, setRange] = useState<PriceHistoryRange>("90d");
  const [series, setSeries] = useState<PriceHistoryPoint[] | null>(null);
  const [loading, setLoading] = useState(live);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const engaged = useRef(false);
  const engage = () => {
    if (engaged.current) return;
    engaged.current = true;
    onEngage?.();
  };

  useEffect(() => {
    if (!live) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPin(null);
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
  }, [baseCardId, variant.variant_id, range, live]);

  const points = toPoints(series);
  const n = points.length;
  const latest = n ? points[n - 1] : null;
  const idx = pin == null ? n - 1 : Math.min(pin, n - 1);
  const cur = n ? points[idx] : null;

  const pick = (clientX: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    setPin(nearestIndex(clientX, r.left, r.width, n));
  };
  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    e.stopPropagation();
    engage();
    svgRef.current?.setPointerCapture?.(e.pointerId);
    pick(e.clientX);
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.buttons || e.pointerType === "touch") {
      e.stopPropagation();
      pick(e.clientX);
    }
  };

  const ranges = (
    <span className="m-seg m-seg--sm m-chart__ranges" role="group" aria-label="Date range">
      {RANGE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={"m-seg__btn" + (range === opt.value ? " m-seg__btn--on" : "")}
          aria-pressed={range === opt.value}
          onClick={() => {
            engage();
            setRange(opt.value);
          }}
        >
          {opt.label}
        </button>
      ))}
    </span>
  );

  let body;
  if (loading) body = <div className="php-status">Loading price history…</div>;
  else if (error) body = <div className="php-status php-status--error">{error}</div>;
  else if (n === 0)
    body = (
      <div className="php-empty" data-testid="price-history-empty">
        <span className="php-empty__dash">—</span>
        <span className="php-empty__title">No price data for this printing</span>
        <span className="php-empty__sub">History appears once TCGplayer lists it</span>
      </div>
    );
  else if (n === 1) body = null;
  else {
    const g = chartGeom(points);
    body = (
      <svg
        ref={svgRef}
        className="m-chart__svg"
        viewBox={`0 0 ${W} ${H}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        role="img"
        aria-label={`Market price. ${formatAsOf(cur?.as_of)}: ${formatUsd(cur?.v)}`}
      >
        {g.ticks.map((t, i) => (
          <g key={i}>
            <line x1={PADL} x2={W - PADR} y1={g.y(t)} y2={g.y(t)} className="m-chart__grid" />
            <text x={PADL - 6} y={g.y(t) + 3.5} textAnchor="end" className="m-chart__axis">
              {t < 10 ? "$" + t.toFixed(2) : "$" + t.toFixed(0)}
            </text>
          </g>
        ))}
        <text x={PADL} y={H - 6} className="m-chart__axis">
          {formatShort(points[0].as_of)}
        </text>
        <text x={W - PADR} y={H - 6} textAnchor="end" className="m-chart__axis">
          {formatShort(points[n - 1].as_of)}
        </text>
        <path d={g.path} className="m-chart__line" />
        {cur ? (
          <g data-idx={idx}>
            <line
              x1={g.x(idx)}
              x2={g.x(idx)}
              y1={PADT - 4}
              y2={H - PADB}
              className="m-chart__cross"
            />
            <circle cx={g.x(idx)} cy={g.y(cur.v)} r="4.5" className="m-chart__dot" />
          </g>
        ) : null}
      </svg>
    );
  }

  return (
    <div className="m-chart" data-testid="price-history-panel">
      <div className="m-chart__head">
        <div className="m-chart__readout" aria-live="polite">
          <span className="m-chart__date">{cur ? formatAsOf(cur.as_of) : "—"}</span>
          <span className={"m-chart__price" + (cur ? "" : " m-chart__price--none")}>
            {formatUsd(cur?.v)}
          </span>
          {n > 1 ? <span className="m-chart__chg">{changeText(points, range)}</span> : null}
        </div>
        {ranges}
      </div>
      {!loading && !error && isSparse(n, range) ? (
        <div className="php-sparse" data-testid="price-history-sparse">
          Only {n} day{n === 1 ? "" : "s"} of data available
        </div>
      ) : null}
      {body}
      {!loading && !error && n > 0 ? (
        <div className="m-fine m-chart__fine">
          Prices via TCGplayer{latest ? ` · as of ${formatAsOf(latest.as_of)}` : ""}.
          {n > 1 ? " Drag across the chart to read a date." : ""}
        </div>
      ) : null}
    </div>
  );
}
