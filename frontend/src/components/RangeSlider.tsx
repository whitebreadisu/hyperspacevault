import "./FilterPanel.css";

// Dual-thumb range slider used by FilterPanel (extracted with RR-22's
// logic/UI split). Styling lives in FilterPanel.css (`ifp-range*` classes).

interface RangeSliderProps {
  label: string;
  min?: number;
  max: number;
  value: [number, number];
  onChange: (next: [number, number]) => void;
}

export function RangeSlider({ label, min = 0, max, value, onChange }: RangeSliderProps) {
  const [lo, hi] = value;
  const pct = (n: number) => `${(n / max) * 100}%`;
  const isAny = lo === min && hi === max;
  const setLo = (n: number) => onChange([Math.min(Math.max(min, n), hi), hi]);
  const setHi = (n: number) => onChange([lo, Math.max(Math.min(max, n), lo)]);

  return (
    <div className="ifp-range">
      <div className="ifp-range__head">
        <span className="ifp-range__label">{label}</span>
        <span className="ifp-range__readout">{isAny ? "Any" : `${lo} – ${hi}`}</span>
      </div>
      <div className="ifp-range__track-wrap">
        <div className="ifp-range__track" />
        <div
          className="ifp-range__fill"
          style={{ left: pct(lo), right: `calc(100% - ${pct(hi)})` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          value={lo}
          onChange={(e) => setLo(Number(e.target.value))}
          className="ifp-range__input ifp-range__input--lo"
          aria-label={`${label} minimum`}
        />
        <input
          type="range"
          min={min}
          max={max}
          value={hi}
          onChange={(e) => setHi(Number(e.target.value))}
          className="ifp-range__input ifp-range__input--hi"
          aria-label={`${label} maximum`}
        />
      </div>
      <div className="ifp-range__scale">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
