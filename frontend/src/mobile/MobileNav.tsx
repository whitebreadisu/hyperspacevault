import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Stash } from "../api/stashes";
import { useStashes } from "../stashes/StashContext";
import { SectionSeparator } from "../components/SectionSeparator";
import { MOBILE_CAMERA_ENABLED } from "./flags";
import { MIcon } from "./icons";
import type { IconName } from "./icons";
import { SWUButton } from "../components/SWUButton";
import { go } from "./router";
import { switchFace, switchStep } from "./shared/vaultSwitch";
import "./shared/shared.css";
import { openTool, useToolState } from "./tool/toolStore";
import type { Route } from "./router";

// The bottom bar (App Spec §25.1): Vault tab, the centre SWUButton (keypad |
// camera glyphs and a divider, behind MOBILE_CAMERA_ENABLED; the lit glyph =
// the last-used mode the button opens), More tab. The circuit separator
// straddles the bar's top edge. The More tab never carries the unread cue
// (App Spec §25.4).
//
// While a share is held (its name known) the Vault tab
// is the switch between the viewer's own vault and the share: amber with the
// share's name in the icon's place while the share is shown; a tap expands it
// horizontally within the bar (transform + opacity, like the view toggle's
// size picker) into the own Vault button and an amber icon + full-name button;
// a pick collapses it and shows that vault. While the share is shown the bar
// is Vault + More only (no keypad), re-centred.
//
// Tapping the Vault tab again while it is lit (the Collection or the Stashes
// page) opens its menu above the bar: Collection · Stashes, then the stash
// list ("Your stashes ... Cards"), over a scrim that dims the screen. A tap
// outside or on a choice closes it, as do Escape (focus back on the tab) and
// any route change. It is a plain list of buttons (no menu role); focus
// moves to the current entry when it opens.
// Signed out, and while the shared vault is shown, there is no menu: no
// Stashes entries or names there. With a share held but the own vault shown,
// the lit vault switch opens this menu, the share as one more row.

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
  expanded,
}: {
  icon: IconName;
  label: string;
  on: boolean;
  onClick: () => void;
  /** The tab opens a menu when tapped while lit: its open state. */
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      className={"m-tab" + (on ? " m-tab--on" : "")}
      onClick={onClick}
      aria-current={on ? "page" : undefined}
      aria-expanded={expanded}
      // The feature tour's target for Stashes, which live under Vault.
      data-tour={icon === "vault" ? "nav-stashes" : undefined}
      data-tour-place={icon === "vault" ? "above" : undefined}
    >
      <MIcon name={icon} size={24} />
      <span className="m-tab__label">{label}</span>
    </button>
  );
}

function VaultSwitch({
  share,
  on,
  menu,
}: {
  share: NavShare;
  on: boolean;
  /** Signed in with the own vault lit: a tap on the face opens the Vault
   * menu (with the share as a row) instead of expanding; `open` is its state. */
  menu?: { open: boolean; toggle: () => void } | null;
}) {
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
    if (menu && face === "own" && on) {
      menu.toggle();
      return;
    }
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
          aria-expanded={menu && on ? menu.open : expanded}
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

/** The Vault menu stops this far below the screen's header... */
const MENU_GAP_PX = 8;

/** The Vault tab's menu: a plain list of buttons (no menu role). Focus moves
 * to the current entry on open; Escape closes it and returns focus to the
 * tab (`onClose(true)`). */
function VaultMenu({
  onStashes,
  stashes,
  onClose,
  share,
}: {
  onStashes: boolean;
  stashes: Stash[];
  onClose: (refocus?: boolean) => void;
  /** A held share (own vault shown): one more row that switches to it. */
  share?: NavShare | null;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  // The menu grows up from the bar and must stop below the screen's header
  // (owner 2026-11-08: with 50 stashes "Collection" sat behind it): it is
  // capped to the room between its anchor and the header's bottom, and only
  // the stash list scrolls; Collection and Stashes stay put.
  const [maxH, setMaxH] = useState<number | null>(null);
  useLayoutEffect(() => {
    const fit = () => {
      const menu = listRef.current;
      if (!menu) return;
      const head = document.querySelector<HTMLElement>(
        ".m-app__screen:not(.m-app__screen--parked) .m-vh, " +
          ".m-app__screen:not(.m-app__screen--parked) .m-shell__head"
      );
      const top = head ? head.getBoundingClientRect().bottom : 0;
      // Where the menu rests (10 px above its bar, shell.css), not where
      // its opening slide has it right now.
      const bar = menu.offsetParent;
      const bottom = bar
        ? bar.getBoundingClientRect().top -
          parseFloat(getComputedStyle(menu).bottom) +
          bar.getBoundingClientRect().height
        : menu.getBoundingClientRect().bottom;
      // The measured room, even when small: the list scrolls rather than
      // the menu running into the header.
      setMaxH(Math.max(0, Math.floor(bottom - top - MENU_GAP_PX)));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
  }, []);
  const pick = (hash: string) => () => {
    onClose();
    go(hash);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(true);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <>
      <div className="m-navmenu-scrim" onClick={() => onClose()} aria-hidden="true" />
      <div
        className="m-navmenu"
        role="group"
        aria-label="Vault menu"
        ref={listRef}
        data-tour-busy=""
      >
        <div className="m-navmenu__inner" style={maxH != null ? { maxHeight: maxH } : undefined}>
          <button
            type="button"
            className={"m-navmenu__head" + (onStashes ? "" : " m-navmenu__head--on")}
            aria-current={onStashes ? undefined : "page"}
            onClick={pick("#/vault")}
          >
            <span className="m-navmenu__headtext">Collection</span>
          </button>
          <button
            type="button"
            className={"m-navmenu__head" + (onStashes ? " m-navmenu__head--on" : "")}
            aria-current={onStashes ? "page" : undefined}
            onClick={pick("#/stashes")}
          >
            <span className="m-navmenu__headtext">Stashes</span>
          </button>
          {share?.name ? (
            <button
              type="button"
              className="m-navmenu__head m-navmenu__share"
              aria-label={`${share.name}'s vault`}
              onClick={() => {
                onClose();
                share.onPick(true);
                go("#/vault");
              }}
            >
              <span className="m-navmenu__sharename">{share.name}</span>
            </button>
          ) : null}
          {stashes.length ? (
            <>
              <span className="m-navmenu__rule" aria-hidden="true" />
              <span className="m-navmenu__label" aria-hidden="true">
                <span>Your stashes</span>
                <span>Cards</span>
              </span>
              <div className="m-navmenu__list">
                {stashes.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="m-navmenu__row"
                    onClick={pick("#/stashes/" + s.id)}
                    aria-label={`${s.name}, ${s.copies} ${s.copies === 1 ? "card" : "cards"}`}
                  >
                    <span className="m-navmenu__name">{s.name}</span>
                    <span className="m-navmenu__count">{s.copies}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}

export function MobileNav({ route, share }: { route: Route; share?: NavShare | null }) {
  const a = route.segs[0];
  // The lit glyph is the mode the button will open.
  const cam = useToolState().mode === "camera";
  const inShare = !!share?.shown;
  const vaultOn = a === "vault" || a === "stashes";
  // The Vault menu: signed in on the own vault only (the stash context is
  // off signed out and while a share is shown).
  const stash = useStashes();
  // While a share is held but the own vault is shown, the lit switch opens
  // the same menu with the share as one more row; while the share is shown
  // the switch keeps its own behaviour.
  const menuable = stash.enabled && !inShare;
  const [menu, setMenu] = useState(false);
  const [menuRoute, setMenuRoute] = useState(route.hash);
  if (menuRoute !== route.hash) {
    setMenuRoute(route.hash);
    if (menu) setMenu(false);
  }
  const navRef = useRef<HTMLElement>(null);
  const closeMenu = (refocus?: boolean) => {
    setMenu(false);
    if (refocus) navRef.current?.querySelector<HTMLElement>(".m-nav__row .m-tab")?.focus();
  };
  return (
    <nav className={"m-nav" + (inShare ? " m-nav--shared" : "")} aria-label="Main" ref={navRef}>
      <SectionSeparator className="m-nav__sep" />
      {menu && menuable ? (
        <VaultMenu
          onStashes={a === "stashes"}
          stashes={stash.stashes}
          onClose={closeMenu}
          share={share}
        />
      ) : null}
      <div className={"m-nav__row" + (inShare ? " m-nav__row--shared" : "")}>
        {share ? (
          <VaultSwitch
            share={share}
            on={vaultOn}
            menu={menuable ? { open: menu, toggle: () => setMenu(!menu) } : null}
          />
        ) : (
          <Tab
            icon="vault"
            label="Vault"
            on={vaultOn}
            expanded={menuable && vaultOn ? menu : undefined}
            onClick={() => {
              if (menuable && vaultOn) setMenu(!menu);
              else go("#/vault");
            }}
          />
        )}
        {inShare ? null : (
          <div className="m-nav__center">
            {MOBILE_CAMERA_ENABLED ? (
              <SWUButton
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
              </SWUButton>
            ) : (
              <SWUButton size="md" onClick={openTool} ariaLabel="Keypad">
                <span className="m-nav__tool m-nav__tool--on">
                  <MIcon name="pad" size={20} />
                </span>
              </SWUButton>
            )}
          </div>
        )}
        <Tab icon="more" label="More" on={a === "more"} onClick={() => go("#/more")} />
      </div>
    </nav>
  );
}
