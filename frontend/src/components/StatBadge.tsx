// Console-styled Cost/Power/HP stat badge (BL-111 F1, design handoff
// claude_design/design_handoff_swu_restyle/README.md §1 -- geometry, colors,
// and numeral transforms are copied verbatim from the canonical prototype
// prototypes/stat-badges/StatBadge.dc.html). Foundation component for the
// screens-restyle arc: not wired into any screen yet (that lands in later
// BL-111 features), so its only consumer in this PR is its own test suite.
//
// All three shapes share one `viewBox="0 0 100 105"`. Cost renders at
// `1.05 x size` tall with a uniform scale; Power/HP render at `1.1 x size`
// tall with `preserveAspectRatio="none"` (a deliberate vertical stretch of
// the narrower shapes). The numeral transforms below undo each shape's
// stretch factor so all three numerals read as the same visual size --
// see the prototype's `numTransform`/`numTransformTall` computation.
//
// BL-123: the numeral used to be a `<foreignObject>` wrapping an HTML
// `<div>`/`<span>` pair (CSS `WebkitTextStroke` for the dark outline layer,
// a second span for the fill layer). WebKit (Safari) renders `foreignObject`
// children at *CSS-pixel* scale instead of the SVG viewBox scale its
// siblings use, so the 54px numeral drew ~54 real px over a badge that's
// often rendered well under 54px wide (size=22 in CardsTable) -- text the
// size of the whole badge, spilling past its bottom-right corner. Chromium
// and Firefox don't have this bug (verified: both scale foreignObject
// content with the viewBox like every other SVG child), so it was invisible
// in normal dev/CI browsing.
//
// Fixed with a native SVG `<text>` element instead -- text is SVG content,
// so every engine scales it with the viewBox by construction; there's no
// foreignObject/HTML boundary left to disagree about. `paintOrder="stroke"`
// plus one `stroke`/`fill` pair replaces the old two-span stroke-then-fill
// layering (a single element can't do "stroke layer, then fill layer" with
// two colors any other way -- paint-order is the standard mechanism).
//
// Centering: `dominant-baseline` has known cross-engine inconsistencies for
// exact vertical centering, so this uses an explicit `y`/`dy` pair instead
// (0 / "0.40em", tuned by pixel-diffing screenshots against the prior
// foreignObject rendering in Chromium until the two matched -- see the
// BL-123 PR description).
// Per-type scale compensation (the old CSS `scale(0.9, 1.111)` /
// `scale(0.9, 1.0605)` transforms) is now an SVG `transform` on the <text>
// itself: `translate(50 52.5) scale(sx sy)` with the text drawn at local
// `x=0 y=0/dy` -- SVG transform lists apply right-to-left to a point, so the
// scale happens first (about the origin) and the translate moves that
// already-scaled origin to the shape's center (50, 52.5), which is
// equivalent to CSS's old `transform-origin: center` scale behavior on the
// foreignObject div (which was itself centered at that same point via CSS
// grid `placeItems: center`).
// Owner dev review 2026-07-26 (round 4, +round 5): anchor y 52.5 -> 48 -> 44
// — the numeral read low everywhere it renders (1 viewBox unit = size/100 px,
// so the cumulative -8.5 units ≈ -3.9px at the popup's size-46 badges,
// ≈ -1.9px at the table's 22). Owner-calibrated in two small steps from the
// pixel-diffed BL-123 baseline above — deliberately NOT a re-derived
// "perfect" centering (past attempts at that overshot).
const NUMERAL_FONT_FAMILY = "'Russo One','Arial Black',Arial,sans-serif";
const NUMERAL_FONT_SIZE = 54;
// Round 6: 44 overshot (owner) -- 46. Round 7: 47. Round 8: the 46/47 steps
// were SUB-PIXEL (1 unit = size/100 px, so ~0.5px at the popup's 46) --
// that's why the numeral "didn't move". Known bracket: 52.5 reads low,
// 44 reads high; 50 is a visible step (~1.4px down from 47 at popup size)
// just above the bracket midpoint. Calibrate in >=2-unit steps from here.
const NUMERAL_TRANSFORM_COST = "translate(50 50) scale(0.9 1.1110)";
const NUMERAL_TRANSFORM_TALL = "translate(50 50) scale(0.9 1.0605)";

export type StatBadgeType = "cost" | "power" | "hp";

interface Props {
  type: StatBadgeType;
  /** Cost/power/hp arrive as `number | null` from the catalog API (see
   * utils/catalog.ts's BaseCard). BL-132 J2: both shipped consumers
   * (CardsTable, CardPopup) now suppress the badge entirely for a null stat,
   * so they never pass null anymore -- the "--" placeholder rendering below
   * is kept as the component's defensive contract for any future caller
   * rather than a path the app exercises. */
  value: number | string | null;
  /** Rendered width in px; height is derived per-type. Default 40. */
  size?: number;
}

function Numeral({
  value,
  strokeColor,
  fillColor,
  transform,
}: {
  value: string;
  strokeColor: string;
  fillColor: string;
  transform: string;
}) {
  return (
    <text
      x="0"
      y="0"
      dy="0.40em"
      textAnchor="middle"
      fontFamily={NUMERAL_FONT_FAMILY}
      fontSize={NUMERAL_FONT_SIZE}
      letterSpacing="-1"
      paintOrder="stroke"
      stroke={strokeColor}
      strokeWidth="8"
      strokeLinejoin="round"
      fill={fillColor}
      transform={transform}
    >
      {value}
    </text>
  );
}

export function StatBadge({ type, value, size = 40 }: Props) {
  const displayValue = value == null ? "—" : String(value);
  const w = size;

  if (type === "cost") {
    const h = Math.round(size * 1.05);
    return (
      <svg
        width={w}
        height={h}
        viewBox="0 0 100 105"
        role="img"
        aria-label={`Cost ${displayValue}`}
        data-testid="stat-badge-cost"
      >
        <defs>
          <linearGradient id="swu-cost-g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFD84D" />
            <stop offset="100%" stopColor="#F0A81C" />
          </linearGradient>
        </defs>
        <path
          d="M50 3 L96 14.5 L96 90.5 L50 102 L4 90.5 L4 14.5 Z"
          fill="url(#swu-cost-g)"
          stroke="#3A2E0C"
          strokeWidth="6"
          strokeLinejoin="round"
        />
        <Numeral
          value={displayValue}
          strokeColor="#3A2E0C"
          fillColor="#FBF3DC"
          transform={NUMERAL_TRANSFORM_COST}
        />
      </svg>
    );
  }

  if (type === "power") {
    const hTall = Math.round(size * 1.1);
    return (
      <svg
        width={w}
        height={hTall}
        viewBox="0 0 100 105"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Power ${displayValue}`}
        data-testid="stat-badge-power"
      >
        <defs>
          <linearGradient id="swu-power-g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E04046" />
            <stop offset="100%" stopColor="#8E1216" />
          </linearGradient>
        </defs>
        {/* Corner tabs sit BEHIND the hexagon, at the midpoints of its four
            angled edges. */}
        <g fill="#8E1216" stroke="#330608" strokeWidth="4">
          <rect x="24.5" y="5.5" width="11" height="11" rx="2" />
          <rect x="64.5" y="5.5" width="11" height="11" rx="2" />
          <rect x="24.5" y="88.5" width="11" height="11" rx="2" />
          <rect x="64.5" y="88.5" width="11" height="11" rx="2" />
        </g>
        <path
          d="M50 3 L91 19 L91 86 L50 102 L9 86 L9 19 Z"
          fill="url(#swu-power-g)"
          stroke="#330608"
          strokeWidth="6"
          strokeLinejoin="round"
        />
        <Numeral
          value={displayValue}
          strokeColor="#330608"
          fillColor="#FBEFEA"
          transform={NUMERAL_TRANSFORM_TALL}
        />
      </svg>
    );
  }

  // hp
  const hTall = Math.round(size * 1.1);
  return (
    <svg
      width={w}
      height={hTall}
      viewBox="0 0 100 105"
      preserveAspectRatio="none"
      role="img"
      aria-label={`HP ${displayValue}`}
      data-testid="stat-badge-hp"
    >
      <defs>
        <linearGradient id="swu-hp-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4FB3E8" />
          <stop offset="100%" stopColor="#1370B4" />
        </linearGradient>
      </defs>
      {/* Corner tabs + rivets sit BEHIND the rounded-square shape. */}
      <g fill="#1979B8" stroke="#0C2137" strokeWidth="4">
        <rect x="7" y="9" width="14" height="14" rx="2.5" />
        <rect x="79" y="9" width="14" height="14" rx="2.5" />
        <rect x="7" y="82" width="14" height="14" rx="2.5" />
        <rect x="79" y="82" width="14" height="14" rx="2.5" />
      </g>
      <g fill="#0C2137">
        <circle cx="14" cy="16" r="2.2" />
        <circle cx="86" cy="16" r="2.2" />
        <circle cx="14" cy="89" r="2.2" />
        <circle cx="86" cy="89" r="2.2" />
      </g>
      <path
        d="M35.7 4.5 C44.4 3.5 55.6 3.5 64.3 4.5 C78.5 7 93.8 18 94.8 34 C95.4 42 93.5 47 93.5 52.5 C93.5 58 95.4 63 94.8 71 C93.8 87 78.5 98 64.3 100.5 C55.6 101.5 44.4 101.5 35.7 100.5 C21.5 98 6.1 87 5.2 71 C4.6 63 6.5 58 6.5 52.5 C6.5 47 4.6 42 5.2 34 C6.1 18 21.5 7 35.7 4.5 Z"
        fill="url(#swu-hp-g)"
        stroke="#0C2137"
        strokeWidth="6"
        strokeLinejoin="round"
      />
      <Numeral
        value={displayValue}
        strokeColor="#0C2137"
        fillColor="#FFFFFF"
        transform={NUMERAL_TRANSFORM_TALL}
      />
    </svg>
  );
}
