import type { CSSProperties, ReactNode, RefObject } from "react";
import { SectionSeparator } from "../../components/SectionSeparator";
import { formatMoney } from "../../utils/completion";
import { formatVersionLabel } from "../../utils/version";
import { MIcon } from "../icons";
import { SWUButton } from "../../components/SWUButton";
import { BrandLogo } from "../BrandLogo";

// The Vault's app header (App Spec §25.1). Expanded: brand stack (the
// initials logo over `Unofficial Fan Project [v#.#.#]`, the tag line carrying
// the unread cue) -- tapping it opens the title chooser -- then the text
// Feedback SWUButton and the account slot on the same row, and the
// collection panel below. Collapsed: the strip -- the initials-logo badge
// (opens the chooser; while an update is unread its box glows amber, an
// opacity-only layer), the amber funnel only when narrowed,
// completion %, ten ticks, "n cards", value without cents, chevron; a tap
// anywhere on the strip but the badge expands.
//
// Layers: `.m-vh__sky` is the STATIC starfield (clipped from below on
// collapse, never moved); `.m-vh__bg` slides up by --vh-delta and carries the
// circuit seam and the pull bar; the panel slides and fades.

const VERSION = formatVersionLabel(__APP_VERSION__);
/** The cue layer's copy of the tag line, already in its displayed casing
 * (the layer sets text-transform: none so the version stays "v2.3"). */
const TAG_CUE = `UNOFFICIAL FAN PROJECT [${VERSION}]`;

export interface StripSummary {
  /** Playset completion, 0-100. */
  pct: number;
  copies: number;
  value: number;
  /** Totals are narrowed by a filter (the amber funnel). */
  narrowed: boolean;
  /** Signed out: the readout shows em dashes and empty ticks. */
  authed?: boolean;
}

/** Another screen's strip readout in the Vault's header frame (a stash:
 * COPIES / VALUE): what the collapsed strip shows instead of the Vault's
 * completion readout, and its accessible name. */
export interface StripReadout {
  content: ReactNode;
  label: string;
}

interface Props {
  hdrRef: RefObject<HTMLElement | null>;
  topRef: RefObject<HTMLDivElement | null>;
  collapsed: boolean;
  onExpand: () => void;
  summary: StripSummary;
  unread: boolean;
  onOpenChooser: () => void;
  onOpenFeedback: () => void;
  account: ReactNode;
  panel: ReactNode;
  readout?: StripReadout;
}

export function VaultHeader({
  hdrRef,
  topRef,
  collapsed,
  onExpand,
  summary,
  unread,
  onOpenChooser,
  onOpenFeedback,
  account,
  panel,
  readout,
}: Props) {
  const authed = summary.authed !== false;
  const filled = authed ? Math.round(summary.pct / 10) : 0;
  const value = authed ? formatMoney(summary.value).replace(/\.\d\d$/, "") : "—";
  const pct = authed ? `${summary.pct}%` : "—";
  const copies = authed ? summary.copies.toLocaleString() : "—";
  return (
    <header
      ref={hdrRef}
      className="m-vh"
      style={
        {
          "--starfield": 'var(--header-starfield, url("/images/starfields/starfield_ASH.jpg"))',
        } as CSSProperties
      }
    >
      <div className="m-vh__sky" aria-hidden="true" />
      <div className="m-vh__bg" aria-hidden="true">
        <SectionSeparator className="m-vh__seam" />
        <span className="m-pullbar" />
      </div>
      <div className="m-vh__top" ref={topRef}>
        <div className="m-vh__swap">
          <div className="m-vh__brand" aria-hidden={collapsed ? true : undefined}>
            <button
              type="button"
              className="m-vh__brandtext"
              onClick={onOpenChooser}
              tabIndex={collapsed ? -1 : undefined}
              aria-label="Hyperspace Vault: About & Legal, Updates"
            >
              <BrandLogo />
              <span
                className={"m-vh__tag" + (unread ? " m-cue m-cue--tag" : "")}
                data-cue={TAG_CUE}
              >
                Unofficial Fan Project [<span className="m-vh__ver">{VERSION}</span>]
              </span>
            </button>
            <SWUButton
              size="sm"
              onClick={onOpenFeedback}
              className="m-vh__fb"
              ariaLabel="Leave Feedback"
            >
              Feedback
            </SWUButton>
          </div>
          <div className="m-vh__strip" aria-hidden={collapsed ? undefined : true}>
            <button
              type="button"
              className={"m-vh__hsv" + (unread ? " m-vh__hsv--cue" : "")}
              onClick={onOpenChooser}
              tabIndex={collapsed ? undefined : -1}
              aria-label="Hyperspace Vault: About & Legal, Updates"
            >
              <span className="m-vh__logobox">
                <BrandLogo size="badge" />
              </span>
            </button>
            <button
              type="button"
              className="m-vh__readout"
              onClick={onExpand}
              tabIndex={collapsed ? undefined : -1}
              aria-label={
                readout
                  ? `${readout.label}. Expand the header`
                  : `Collection${summary.narrowed ? ", filtered totals" : ""}: playsets ${pct}, ${copies} cards, ${value}. Expand the header`
              }
            >
              {readout ? (
                <>
                  {readout.content}
                  <MIcon name="chevdown" size={16} className="m-vh__chev" />
                </>
              ) : null}
              {readout ? null : summary.narrowed ? (
                <span className="m-vh__narrow" aria-hidden="true">
                  <MIcon name="filter" size={14} />
                </span>
              ) : null}
              {readout ? null : (
                <>
                  <span className="m-vh__pct">{pct}</span>
                  <span className="inv-summary__ticks m-vh__ticks">
                    {Array.from({ length: 10 }, (_, i) => (
                      <span
                        key={i}
                        className={
                          "inv-summary__tick" + (i < filled ? " inv-summary__tick--filled" : "")
                        }
                      />
                    ))}
                  </span>
                  <span className="m-vh__fact m-vh__fact--cards">
                    <span className="m-vh__n">{copies}</span> cards
                  </span>
                  <span className="m-vh__value">{value}</span>
                  <MIcon name="chevdown" size={16} className="m-vh__chev" />
                </>
              )}
            </button>
          </div>
        </div>
        {account}
      </div>
      <div className="m-vh__panel" aria-hidden={collapsed ? true : undefined}>
        {panel}
      </div>
    </header>
  );
}
