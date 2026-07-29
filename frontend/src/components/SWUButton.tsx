// Three-piece angled parallelogram button modeled on starwarsunlimited.com.
// Left cap SVG + center stripe (SVG bg + label) + right cap SVG.
// Non-scaling-stroke keeps the cream outline uniform across caps and center.

const SWU_SIZES = { sm: 40, md: 52, lg: 64 } as const;
const MAIN_TOP = 8;
const MAIN_BOTTOM = 124.75;
const TOTAL_H = 150.43;
const CAP_W = 86.67;
const LINE_Y = 145;

interface Props {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  size?: keyof typeof SWU_SIZES;
  /** BL-56 §5.5: anonymous "inert teaser" controls (e.g. Add Cards) stay
   * clickable -- the click still needs to fire the sign-in prompt -- but are
   * flagged aria-disabled for assistive tech / testability. Deliberately NOT
   * the native `disabled` attribute, which would swallow the click event. */
  ariaDisabled?: boolean;
}

export function SWUButton({
  children,
  active = true,
  onClick,
  size = "sm",
  ariaDisabled = false,
}: Props) {
  const h = SWU_SIZES[size];
  const capW = Math.round((CAP_W * h) / TOTAL_H);
  const fill = active ? "var(--color-primary)" : "var(--color-btn-off)";
  const edge = active ? "var(--color-button-edge)" : "var(--color-button-edge-dim)";
  const text = active ? "#ffffff" : "rgba(255,255,255,0.85)";

  const topPct = (MAIN_TOP / TOTAL_H) * 100;
  const botPct = (MAIN_BOTTOM / TOTAL_H) * 100;

  const OFFSET = LINE_Y - MAIN_BOTTOM;
  const leftTipX = 18.27 + OFFSET * -0.8;
  const leftTipY = 81.65 + OFFSET * 0.6;
  const leftCornerX = leftTipX + 0.6 * ((LINE_Y - leftTipY) / 0.8);
  const rightTipX = 68.4 + OFFSET * 0.8;
  const rightTipY = 81.65 + OFFSET * 0.6;
  const rightCornerX = rightTipX + 0.6 * ((LINE_Y - rightTipY) / -0.8);

  const fmt = (n: number) => n.toFixed(2);
  const leftLine = `${fmt(leftTipX)},${fmt(leftTipY)} ${fmt(leftCornerX)},${LINE_Y} 86.67,${LINE_Y}`;
  const rightLine = `0,${LINE_Y} ${fmt(rightCornerX)},${LINE_Y} ${fmt(rightTipX)},${fmt(rightTipY)}`;

  const padTop = (topPct / 100) * h;
  const padBot = ((100 - botPct) / 100) * h;

  return (
    <button
      type="button"
      onClick={onClick}
      className="swu-btn"
      style={{ height: h }}
      aria-disabled={ariaDisabled || undefined}
    >
      <svg
        className="swu-btn__cap"
        width={capW}
        height={h}
        viewBox="0 0 86.67 150.43"
        preserveAspectRatio="none"
        overflow="visible"
        aria-hidden="true"
      >
        <polygon fill={fill} points="55.43,8 18.27,81.65 50.59,124.75 86.67,124.75 86.67,8" />
        <polyline
          fill="none"
          stroke={edge}
          strokeWidth="2"
          strokeLinejoin="miter"
          vectorEffect="non-scaling-stroke"
          points="86.67,8 55.43,8 18.27,81.65 50.59,124.75 86.67,124.75"
        />
        <polyline
          fill="none"
          stroke={edge}
          strokeWidth="2"
          strokeLinejoin="miter"
          vectorEffect="non-scaling-stroke"
          points={leftLine}
        />
      </svg>

      <span className="swu-btn__center">
        <svg
          className="swu-btn__center-bg"
          viewBox="0 0 100 150.43"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <rect x="0" y={MAIN_TOP} width="100" height={MAIN_BOTTOM - MAIN_TOP} fill={fill} />
          <line
            x1="0"
            y1={MAIN_TOP}
            x2="100"
            y2={MAIN_TOP}
            stroke={edge}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1="0"
            y1={MAIN_BOTTOM}
            x2="100"
            y2={MAIN_BOTTOM}
            stroke={edge}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1="0"
            y1={LINE_Y}
            x2="100"
            y2={LINE_Y}
            stroke={edge}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          className="swu-btn__label"
          style={{
            paddingTop: padTop,
            paddingBottom: padBot,
            color: text,
            fontSize: size === "lg" ? 18 : size === "md" ? 15 : 13,
          }}
        >
          {children}
        </span>
      </span>

      <svg
        className="swu-btn__cap"
        width={capW}
        height={h}
        viewBox="0 0 86.67 150.43"
        preserveAspectRatio="none"
        overflow="visible"
        aria-hidden="true"
      >
        <polygon fill={fill} points="36.08,124.75 68.4,81.65 31.24,8 0,8 0,124.75" />
        <polyline
          fill="none"
          stroke={edge}
          strokeWidth="2"
          strokeLinejoin="miter"
          vectorEffect="non-scaling-stroke"
          points="0,8 31.24,8 68.4,81.65 36.08,124.75 0,124.75"
        />
        <polyline
          fill="none"
          stroke={edge}
          strokeWidth="2"
          strokeLinejoin="miter"
          vectorEffect="non-scaling-stroke"
          points={rightLine}
        />
      </svg>
    </button>
  );
}
