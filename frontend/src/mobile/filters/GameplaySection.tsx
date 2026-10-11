import type { ReactNode } from "react";
import { MIcon } from "../icons";

// BL-248 (R4-2; rev4 MFilters.jsx GameplayFacet head): the Gameplay
// disclosure, collapsed by default (local state, so every fresh open starts
// collapsed). Head = the label in the rows' 86 px column, "· n active" by the
// badge rule (one per group), a one-line hint while closed, the chevron.
// Stage 2B-1 builds the head and the disclosure; stage 2B-2 (S2-19) fills the
// body (Aspects + mode, Type, Arena, Keyword, Trait, Cost, Power, HP).

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
