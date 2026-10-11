import { useRef } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { AspectIcon } from "../../components/AspectIcon";
import { ASPECT_MATCH_MODES, NO_ASPECT } from "../../utils/filters";
import type { AspectMatchMode, FilterState } from "../../utils/filters";
import type { InventoryCard } from "../../utils/inventory";
import { MIcon } from "../icons";
import {
  ARENA_UNIVERSE,
  ASPECT_UNIVERSE,
  fieldOptions,
  MODE_MEANING,
  optionState,
  RANGE_MAX,
  TYPE_UNIVERSE,
} from "./filterModel";
import type { filterActions, RangeField } from "./filterModel";
import { FChip } from "./pickerParts";

// BL-248 (R4-2; rev4 MFilters.jsx GameplayFacet): the Gameplay disclosure,
// collapsed by default (local state, so every fresh open starts collapsed).
// Head = the label in the rows' 86 px column, "· n active" by the badge rule
// (one per group), a one-line hint while closed, the chevron. Stage 2B-2
// (S2-19) body, desktop FilterPanel's Gameplay order with Aspects first
// where the owner put them: Aspects (seven chits + Any / Within / Exact and
// its one-line meaning), Type, Arena, Keyword, Trait (rows opening the
// full-height pickers), Cost, Power, HP (one track, two 44 px thumbs).

export function GameplaySection({
  count,
  open,
  onToggle,
  children,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="m-fgroup m-fmore m-fgame" data-facet="gameplay" aria-label="Gameplay">
      <button
        type="button"
        className="m-fmore__head m-fgame__head"
        aria-expanded={open}
        aria-controls="fgame-body"
        onClick={onToggle}
      >
        <span className="m-fgame__k">Gameplay</span>
        {count ? <span className="m-fmore__n">· {count} active</span> : null}
        <span className="m-fmore__hint">
          {open ? "" : "Aspects, type, arena, keyword, trait, cost, power, HP"}
        </span>
        <MIcon
          name="chevdown"
          size={18}
          className={"m-ffin__chev" + (open ? " m-ffin__chev--open" : "")}
        />
      </button>
      {open ? (
        <div className="m-fmore__body m-fgame__body" id="fgame-body">
          {children}
        </div>
      ) : null}
    </section>
  );
}

const MODE_LABEL: Record<AspectMatchMode, string> = {
  any: "Any",
  within: "Within",
  exact: "Exact",
};

/** The Gameplay body (S2-19). */
export function GameplayBody({
  f,
  facetCards,
  act,
  onPick,
}: {
  f: FilterState;
  facetCards: InventoryCard[];
  act: ReturnType<typeof filterActions>;
  onPick: (field: "keyword" | "trait") => void;
}) {
  const aspects = fieldOptions(facetCards, f, "aspects", ASPECT_UNIVERSE, f.aspects);
  const types = fieldOptions(facetCards, f, "type", TYPE_UNIVERSE, f.type);
  const arenas = fieldOptions(facetCards, f, "arena", ARENA_UNIVERSE, f.arena);
  const none = f.aspects.size === 0;
  const pickRow = (field: "keyword" | "trait", label: string) => {
    const sel = [...f[field]];
    return (
      <button
        type="button"
        className={"m-frow m-frow--b1" + (sel.length ? " m-frow--on" : "")}
        data-picker={field}
        aria-haspopup="dialog"
        aria-label={`${label}: ${sel.length ? sel.join(", ") : "any"}. Choose`}
        onClick={() => onPick(field)}
      >
        <span className="m-frow__k">{label}</span>
        <span className="m-frow__v">
          {sel.length === 0 ? "Any" : sel.length === 1 ? sel[0] : `${sel.length} selected`}
        </span>
        <MIcon name="fwd" size={18} />
      </button>
    );
  };
  return (
    <>
      <section className="m-fgroup m-fgroup--b1" data-facet="aspects" aria-label="Aspects">
        <div className="m-fgroup__label">Aspects</div>
        <div className="m-aspectpick m-aspectpick--b1">
          {aspects.map((o) => {
            const s = optionState(o, f.aspects);
            return (
              <button
                key={o.value}
                type="button"
                className={
                  "m-aspectchit m-faspect" +
                  (s.on ? " m-aspectchit--on" : "") +
                  (!none && !s.on ? " m-faspect--off" : "") +
                  (s.inert ? " m-faspect--inert" : "")
                }
                data-fv={o.value}
                aria-label={o.label}
                aria-pressed={none || s.on}
                disabled={s.blocked}
                onClick={s.blocked ? undefined : () => act.tapAspect(o.value)}
              >
                {o.value === NO_ASPECT ? (
                  <svg
                    className="m-faspect__none"
                    width="22"
                    height="22"
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                  >
                    <circle
                      cx="10"
                      cy="10"
                      r="7"
                      stroke="currentColor"
                      fill="none"
                      strokeWidth="2"
                    />
                    <path
                      d="M5.4 5.4L14.6 14.6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                ) : (
                  <AspectIcon aspect={o.value} size={30} />
                )}
              </button>
            );
          })}
        </div>
        <div
          className="m-seg m-seg--wide m-fmode"
          role="radiogroup"
          aria-label="Aspect matching mode"
        >
          {ASPECT_MATCH_MODES.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={f.aspectMode === k}
              className={"m-seg__btn" + (f.aspectMode === k ? " m-seg__btn--on" : "")}
              onClick={() => act.setAspectMode(k)}
            >
              {MODE_LABEL[k]}
            </button>
          ))}
        </div>
        <p className="m-fmeaning" aria-live="polite">
          {MODE_MEANING[f.aspectMode]}
        </p>
      </section>
      <section className="m-fgroup m-fgroup--b1" data-facet="type" aria-label="Type">
        <div className="m-fgroup__label">
          Type{f.type.size ? <span className="m-fgroup__n">{f.type.size} selected</span> : null}
        </div>
        <div className="m-chipwrap">
          {types.map((o) => (
            <FChip
              key={o.value}
              opt={o}
              selected={f.type}
              onToggle={(v) => act.toggleIn("type", v)}
            />
          ))}
        </div>
      </section>
      <div className="m-fsub" data-facet="arena">
        <div className="m-fsub__label">Arena</div>
        <div className="m-chipwrap">
          {arenas.map((o) => (
            <FChip
              key={o.value}
              opt={o}
              selected={f.arena}
              onToggle={(v) => act.toggleIn("arena", v)}
            />
          ))}
        </div>
      </div>
      {pickRow("keyword", "Keyword")}
      {pickRow("trait", "Trait")}
      <MRange k="cost" label="Cost" value={f.costRange} onChange={(r) => act.setRange("cost", r)} />
      <MRange
        k="power"
        label="Power"
        value={f.powerRange}
        onChange={(r) => act.setRange("power", r)}
      />
      <MRange k="hp" label="HP" value={f.hpRange} onChange={(r) => act.setRange("hp", r)} />
    </>
  );
}

/** rev4 MRange (desktop RangeSlider semantics): one track, two 44 px
 * thumbs, Russo One readout ("Any" at full range). A press on the track
 * moves the nearer thumb and drags it; arrow keys step a focused thumb. */
export function MRange({
  k,
  label,
  value,
  onChange,
}: {
  k: RangeField;
  label: string;
  value: [number, number];
  onChange: (next: [number, number]) => void;
}) {
  const max = RANGE_MAX[k];
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<0 | 1 | null>(null);
  const at = (x: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.max(0, Math.min(max, Math.round(((x - r.left) / r.width) * max)));
  };
  const set = (i: 0 | 1, n: number) => {
    const next: [number, number] = [value[0], value[1]];
    next[i] = i === 0 ? Math.min(n, value[1]) : Math.max(n, value[0]);
    if (next[0] !== value[0] || next[1] !== value[1]) onChange(next);
  };
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    const n = at(e.clientX);
    const i: 0 | 1 = Math.abs(n - value[0]) <= Math.abs(n - value[1]) ? (n > value[1] ? 1 : 0) : 1;
    drag.current = i;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    set(i, n);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current != null) set(drag.current, at(e.clientX));
  };
  const up = () => {
    drag.current = null;
  };
  const key = (i: 0 | 1) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const d =
      e.key === "ArrowRight" || e.key === "ArrowUp"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? -1
          : 0;
    if (!d) return;
    e.preventDefault();
    set(i, Math.max(0, Math.min(max, value[i] + d)));
  };
  const pct = (n: number) => (n / max) * 100;
  const on = value[0] !== 0 || value[1] !== max;
  return (
    <div className="m-range" data-range={k}>
      <div className="m-range__head">
        <span className="m-range__label">{label}</span>
        <span className={"m-range__read" + (on ? " m-range__read--on" : "")}>
          {on ? `${value[0]} – ${value[1]}` : "Any"}
        </span>
      </div>
      <div
        className="m-range__track"
        ref={track}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <span className="m-range__rail" aria-hidden="true" />
        <span
          className="m-range__fill"
          aria-hidden="true"
          style={{ left: pct(value[0]) + "%", right: 100 - pct(value[1]) + "%" }}
        />
        {([0, 1] as const).map((i) => (
          <button
            key={i}
            type="button"
            role="slider"
            className="m-range__thumb"
            style={{ left: pct(value[i]) + "%" }}
            aria-label={`${label} ${i ? "maximum" : "minimum"}`}
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={value[i]}
            onKeyDown={key(i)}
          >
            <span className="m-range__knob" aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="m-range__scale" aria-hidden="true">
        <span>0</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
