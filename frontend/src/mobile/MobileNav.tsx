import { useEffect, useRef, useState } from "react";
import { SectionSeparator } from "../components/SectionSeparator";
import { MOBILE_CAMERA_ENABLED } from "./flags";
import { MIcon } from "./icons";
import type { IconName } from "./icons";
import { MSWUButton } from "./MSWUButton";
import { go } from "./router";
import { switchFace, switchStep } from "./shared/vaultSwitch";
import "./shared/shared.css";
import { openTool, useToolState } from "./tool/toolStore";
import type { Route } from "./router";

// BL-247 S1-04: the bottom bar (rev4 MApp.jsx:70-102, `bar=one`): Vault tab,
// the centre SWUButton (keypad | camera glyphs and a divider, behind
// MOBILE_CAMERA_ENABLED, plan A8; on since BL-253 S7-09, the lit glyph =
// the last-used mode the button opens), More tab. The circuit separator straddles
// the bar's top edge. The More tab never carries the unread cue (R5-2).
//
// BL-252 S6-04 (R5-7): while a share is held (its name known) the Vault tab
// is the switch between the viewer's own vault and the share: amber with the
// share's name in the icon's place while the share is shown; a tap expands it
// horizontally within the bar (transform + opacity, like the view toggle's
// size picker) into the own Vault button and an amber icon + full-name button;
// a pick collapses it and shows that vault. While the share is shown the bar
// is Vault + More only (no keypad -- rev4 r4-8-no-keypad-tab), re-centred.

export interface NavShare {
  /** The share's owner-chosen name (desktop's header tab text); null while unknown. */
  name: string | null;
  /** The shared vault is the vault shown. */
  shown: boolean;
  onPick: (shared: boolean) => void;
}

function Tab({
  icon,
  label,
  on,
  onClick,
}: {
  icon: IconName;
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={"m-tab" + (on ? " m-tab--on" : "")}
      onClick={onClick}
      aria-current={on ? "page" : undefined}
    >
      <MIcon name={icon} size={24} />
      <span className="m-tab__label">{label}</span>
    </button>
  );
}

function VaultSwitch({ share, on }: { share: NavShare; on: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const hasName = share.name != null;
  const face = switchFace(hasName, share.shown);
  const state = { expanded, shown: share.shown };
  const refocus = useRef(false);

  // Keyboard focus follows the expand: the pressed choice takes it; Escape or a
  // pick hands it back to the face (an outside tap leaves focus where it went).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (expanded) {
      root.querySelector<HTMLElement>('.m-vswitch__panel [aria-pressed="true"]')?.focus();
    } else if (refocus.current) {
      refocus.current = false;
      root.querySelector<HTMLElement>(".m-vswitch__face")?.focus();
    }
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return undefined;
    const outside = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setExpanded(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        refocus.current = true;
        setExpanded(false);
      }
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key);
    };
  }, [expanded]);

  const tapFace = () => {
    const next = switchStep(state, { type: "face", hasName });
    if (!hasName) {
      share.onPick(false);
      go("#/vault");
      return;
    }
    setExpanded(next.expanded);
  };
  const pick = (shared: boolean) => {
    const next = switchStep(state, { type: "pick", shared });
    refocus.current = true;
    setExpanded(next.expanded);
    share.onPick(next.shown);
    go("#/vault");
  };

  // A fresh link still resolving (or invalid) shows the plain tab, not lit:
  // the share's status screen is what is shown (desktop: no tab until named).
  if (face === "plain")
    return <Tab icon="vault" label="Vault" on={on && !share.shown} onClick={tapFace} />;

  return (
    <div className={"m-vswitch" + (expanded ? " m-vswitch--open" : "")} ref={rootRef}>
      {face === "shared" ? (
        <button
          type="button"
          className={"m-tab m-vswitch__face m-vswitch__face--shared" + (on ? " m-tab--on" : "")}
          onClick={tapFace}
          aria-expanded={expanded}
          aria-current={on ? "page" : undefined}
          aria-label={`${share.name}: switch vault`}
          tabIndex={expanded ? -1 : undefined}
        >
          <span className="m-vswitch__name">{share.name}</span>
        </button>
      ) : (
        <button
          type="button"
          className={"m-tab m-vswitch__face" + (on ? " m-tab--on" : "")}
          onClick={tapFace}
          aria-expanded={expanded}
          aria-current={on ? "page" : undefined}
          aria-label="Vault: switch vault"
          tabIndex={expanded ? -1 : undefined}
        >
          <MIcon name="vault" size={24} />
          <span className="m-tab__label">Vault</span>
        </button>
      )}
      {expanded ? (
        <div className="m-vswitch__panel" role="group" aria-label="Choose a vault">
          <button
            type="button"
            className={"m-tab m-vswitch__own" + (!share.shown ? " m-tab--on" : "")}
            onClick={() => pick(false)}
            aria-pressed={!share.shown}
            aria-label="Your vault"
          >
            <MIcon name="vault" size={24} />
            <span className="m-tab__label">Vault</span>
          </button>
          <button
            type="button"
            className="m-vswitch__share"
            onClick={() => pick(true)}
            aria-pressed={share.shown}
            aria-label={`${share.name}'s vault`}
          >
            <MIcon name="vault" size={22} />
            <span className="m-vswitch__full">{share.name}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function MobileNav({ route, share }: { route: Route; share?: NavShare | null }) {
  const a = route.segs[0];
  // BL-253 S7-09: the lit glyph is the mode the button will open.
  const cam = useToolState().mode === "camera";
  const inShare = !!share?.shown;
  const vaultOn = a === "vault";
  return (
    <nav className={"m-nav" + (inShare ? " m-nav--shared" : "")} aria-label="Main">
      <SectionSeparator className="m-nav__sep" />
      <div className={"m-nav__row" + (inShare ? " m-nav__row--shared" : "")}>
        {share ? (
          <VaultSwitch share={share} on={vaultOn} />
        ) : (
          <Tab icon="vault" label="Vault" on={vaultOn} onClick={() => go("#/vault")} />
        )}
        {inShare ? null : (
          <div className="m-nav__center">
            {MOBILE_CAMERA_ENABLED ? (
              <MSWUButton
                size="md"
                onClick={openTool}
                ariaLabel="Keypad or camera: opens the mode you used last"
              >
                <span className={"m-nav__tool" + (cam ? "" : " m-nav__tool--on")}>
                  <MIcon name="pad" size={20} />
                </span>
                <span className="m-nav__tooldiv" aria-hidden="true" />
                <span className={"m-nav__tool" + (cam ? " m-nav__tool--on" : "")}>
                  <MIcon name="camera" size={22} />
                </span>
              </MSWUButton>
            ) : (
              <MSWUButton size="md" onClick={openTool} ariaLabel="Keypad">
                <span className="m-nav__tool m-nav__tool--on">
                  <MIcon name="pad" size={20} />
                </span>
              </MSWUButton>
            )}
          </div>
        )}
        <Tab icon="more" label="More" on={a === "more"} onClick={() => go("#/more")} />
      </div>
    </nav>
  );
}
