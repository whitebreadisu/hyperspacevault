import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Stash } from "../api/stashes";
import "./NavPod.css";

// The desktop "Command pod" (v3.0 navigation handoff 1c, "glide" motion): a
// steel-ring pod hanging from the header's top edge with the top-level
// items Vault · Decks · [HSV] Updates (Updates only while an update is
// unread or it is the view, as the old tab). The active item's subsections unfold
// in place beside it: Header.tsx glides every part of the pod (each group's
// width, each top item, the row padding) from where it is to the measured
// target in one 320 ms step, so the pod's width moves straight from its old
// size to its new one (the pod re-centres as it grows); the sub items fade in after
// a 90 ms delay, and every underline scales from its centre. The wrapper
// clips horizontally while it moves and stops clipping 650 ms after the
// active item changes, so the Stashes menu can hang below it. Hovering
// Stashes (signed in) drops the stash menu; it stays mounted, hidden with
// opacity and pointer-events, and closes 120 ms after the pointer leaves.
// It also opens when Stashes takes keyboard focus, and Escape closes it and
// returns focus to Stashes.
// prefers-reduced-motion: no transitions (NavPod.css) and no clip phase.
//
// Amber marks a narrowed view only: in a shared vault the Vault item, its
// ring, its underline and its active sub item are amber.

export type PodTop = "vault" | "decks" | "updates" | null;

export interface PodSub {
  key: string;
  label: string;
  on: boolean;
  onClick: () => void;
  /** The Stashes entry: hovering it drops the stash menu. */
  menu?: boolean;
}

interface Props {
  top: PodTop;
  vaultSubs: PodSub[];
  decksSubs: PodSub[];
  onVault: () => void;
  onDecks: () => void;
  onUpdates: () => void;
  /** The shared vault is the pane shown: the Vault item turns amber. */
  shared: boolean;
  /** An unread release-notes entry: the Updates label pulses amber. */
  unread: boolean;
  /** The [HSV] Updates item is shown (while unread, or while it is the view:
   * it never vanishes the moment it is opened). */
  showUpdates: boolean;
  /** The stash menu's rows (signed in, own vault); null = no menu. */
  stashes: Stash[] | null;
  onOpenStash: (id: number) => void;
  onAllStashes: () => void;
  /** The menu's "New stash": opens the create dialog (Header.tsx). */
  onNewStash: () => void;
  /** The header's minimal step: the top items show their glyph alone, so
   * each carries its name as a tooltip too. */
  iconOnly?: boolean;
}

const CLIP_MS = 650;
/** The stash menu ends this far above the window's bottom. */
const MENU_MARGIN_PX = 16;
const MENU_CLOSE_MS = 120;

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function VaultGlyph() {
  return (
    <svg
      width="22"
      height="20"
      viewBox="0 0 22 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="18" height="16" rx="1" />
      <path d="M2 7h18M8 11h6" />
    </svg>
  );
}

function DecksGlyph() {
  return (
    <svg
      width="22"
      height="20"
      viewBox="0 0 22 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="7" y="2" width="11" height="15" rx="1" />
      <path d="M4 5v13h10" />
    </svg>
  );
}

function StashMenu({
  open,
  stashes,
  onOpenStash,
  onAllStashes,
  onNewStash,
}: {
  open: boolean;
  stashes: Stash[];
  onOpenStash: (id: number) => void;
  onAllStashes: () => void;
  onNewStash: () => void;
}) {
  const tab = open ? undefined : -1;
  // A long list (the owner has 50 stashes) must end above the window's
  // bottom: the panel is capped to the room below it (16 px margin) and
  // only the stash list scrolls; the heading and "All stashes" stay put.
  const panel = useRef<HTMLDivElement>(null);
  const [maxH, setMaxH] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!open) return undefined;
    const fit = () => {
      const el = panel.current;
      const menu = el?.parentElement;
      const anchor = menu?.parentElement;
      if (!el || !menu || !anchor) return;
      // Where the panel rests (the menu hangs from its anchor's bottom, then
      // its own top padding), not where the opening slide has it right now.
      const top =
        anchor.getBoundingClientRect().bottom + parseFloat(getComputedStyle(menu).paddingTop);
      // The measured room, even when small: the list scrolls rather than
      // the panel running past the window's margin.
      setMaxH(Math.max(0, Math.floor(window.innerHeight - top - MENU_MARGIN_PX)));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [open]);
  return (
    <div
      className={"pod-menu" + (open ? " pod-menu--open" : "")}
      aria-hidden={open ? undefined : true}
      data-testid="stash-menu"
    >
      <div
        className="pod-menu__panel"
        ref={panel}
        style={maxH != null ? { maxHeight: maxH } : undefined}
      >
        <span className="pod-menu__head" aria-hidden="true">
          <span>Your stashes</span>
          <span>Copies</span>
        </span>
        <div className="pod-menu__list">
          {stashes.map((s) => (
            <button
              key={s.id}
              type="button"
              className="pod-menu__row"
              tabIndex={tab}
              onClick={() => onOpenStash(s.id)}
              aria-label={`${s.name}, ${s.copies} ${s.copies === 1 ? "copy" : "copies"}`}
            >
              <span className="pod-menu__name">{s.name}</span>
              <span className="pod-menu__count">{s.copies}</span>
            </button>
          ))}
        </div>
        <span className="pod-menu__rule" aria-hidden="true" />
        <button type="button" className="pod-menu__all" tabIndex={tab} onClick={onAllStashes}>
          All stashes
        </button>
        {/* Pinned last, as the Stashes page's rail ends in "+ New stash"
            (owner 2026-11-09); opens the page's own create dialog. */}
        <button
          type="button"
          className="pod-menu__all pod-menu__new"
          tabIndex={tab}
          onClick={onNewStash}
        >
          <span className="pod-menu__plus" aria-hidden="true">
            +
          </span>
          New stash
        </button>
      </div>
    </div>
  );
}

function Subs({
  open,
  subs,
  clip,
  menuOpen,
  setMenuOpen,
  menu,
}: {
  open: boolean;
  subs: PodSub[];
  clip: boolean;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  menu: ((open: boolean) => ReactNode) | null;
}) {
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const enter = useCallback(() => {
    clearTimeout(closeTimer.current);
    setMenuOpen(true);
  }, [setMenuOpen]);
  const leave = useCallback(() => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setMenuOpen(false), MENU_CLOSE_MS);
  }, [setMenuOpen]);

  return (
    <span
      className={"pod__subs" + (open ? " pod__subs--open" : "") + (clip ? " pod__subs--clip" : "")}
      aria-hidden={open ? undefined : true}
    >
      <span className="pod__subsinner">
        <span className="pod__divider" aria-hidden="true" />
        {subs.map((s) => (
          <span
            key={s.key}
            className="pod__subwrap"
            onMouseEnter={s.menu && menu ? enter : undefined}
            onMouseLeave={s.menu && menu ? leave : undefined}
            onFocus={
              s.menu && menu
                ? (e) => {
                    const pod = e.currentTarget.closest<HTMLElement>(".pod");
                    if (pod?.dataset.escaped) {
                      delete pod.dataset.escaped;
                      return;
                    }
                    enter();
                  }
                : undefined
            }
            onBlur={
              s.menu && menu
                ? (e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) leave();
                  }
                : undefined
            }
          >
            <button
              type="button"
              className={"pod__sub" + (s.on ? " pod__sub--on" : "")}
              onClick={() => {
                setMenuOpen(false);
                s.onClick();
              }}
              tabIndex={open ? undefined : -1}
              aria-current={s.on ? "page" : undefined}
              aria-haspopup={s.menu && menu ? "true" : undefined}
              aria-expanded={s.menu && menu ? menuOpen : undefined}
              data-sub={s.key}
            >
              {s.label}
              <span className="pod__subbar" aria-hidden="true" />
            </button>
            {s.menu && menu ? menu(open && menuOpen) : null}
          </span>
        ))}
        <span className="pod__trail" aria-hidden="true" />
      </span>
    </span>
  );
}

function Item({
  id,
  label,
  glyph,
  on,
  amber,
  cue,
  onClick,
  children,
  iconOnly = false,
}: {
  id: string;
  label: string;
  glyph: ReactNode;
  on: boolean;
  amber?: boolean;
  cue?: boolean;
  onClick: () => void;
  children?: ReactNode;
  iconOnly?: boolean;
}) {
  const name = id === "updates" ? "[HSV] Updates" : label;
  return (
    <div
      className={
        "pod__item pod__item--" +
        id +
        (on ? " pod__item--on" : "") +
        (amber ? " pod__item--amber" : "")
      }
    >
      <button
        type="button"
        className="pod__top"
        onClick={onClick}
        aria-current={on && !children ? "page" : undefined}
        // The name stays the accessible name when the header's minimal step
        // hides the label (index.css header density).
        aria-label={name}
        title={iconOnly ? name : undefined}
        data-top={id}
      >
        {glyph}
        <span className={"pod__label" + (cue ? " nav-tab--cue pod__label--cue" : "")}>{label}</span>
        <span className="pod__bar" aria-hidden="true" />
      </button>
      {children}
    </div>
  );
}

export function NavPod({
  top,
  vaultSubs,
  decksSubs,
  onVault,
  onDecks,
  onUpdates,
  shared,
  unread,
  showUpdates,
  stashes,
  onOpenStash,
  onAllStashes,
  onNewStash,
  iconOnly = false,
}: Props) {
  // The clip phase: on while the subsections move, lifted CLIP_MS after the
  // active item (or the sub item lit) changes.
  const routeKey = top + "|" + vaultSubs.map((s) => s.key + (s.on ? "*" : "")).join(",");
  const [clip, setClip] = useState(false);
  const [lastKey, setLastKey] = useState(routeKey);
  if (lastKey !== routeKey) {
    setLastKey(routeKey);
    if (!reducedMotion()) setClip(true);
  }
  useEffect(() => {
    if (!clip) return undefined;
    const t = setTimeout(() => setClip(false), CLIP_MS);
    return () => clearTimeout(t);
  }, [clip, routeKey]);

  const [menuOpen, setMenuOpen] = useState(false);
  // Escape closes the stash menu and hands focus back to Stashes.
  const podRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      const pod = podRef.current;
      // Focus moves only when it is in the pod (the menu or Stashes): an
      // Escape typed elsewhere closes the menu and leaves focus alone.
      if (!pod || !pod.contains(document.activeElement)) return;
      const stashes = pod.querySelector<HTMLElement>('[data-sub="stashes"]');
      if (!stashes || document.activeElement === stashes) return;
      // The focus below must not reopen the menu (the sub item's onFocus);
      // set only when a focus event will follow and clear it.
      pod.dataset.escaped = "1";
      stashes.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  const pick = (fn: () => void) => () => {
    setMenuOpen(false);
    fn();
  };
  const menu = stashes
    ? (open: boolean) => (
        <StashMenu
          open={open}
          stashes={stashes}
          onOpenStash={(id) => {
            setMenuOpen(false);
            onOpenStash(id);
          }}
          onAllStashes={() => {
            setMenuOpen(false);
            onAllStashes();
          }}
          onNewStash={() => {
            setMenuOpen(false);
            onNewStash();
          }}
        />
      )
    : null;

  return (
    <div className={"pod" + (shared ? " pod--shared" : "")} data-testid="nav-pod" ref={podRef}>
      <div className="pod__row">
        <Item
          id="vault"
          label="Vault"
          glyph={<VaultGlyph />}
          on={top === "vault"}
          amber={shared}
          onClick={pick(onVault)}
          iconOnly={iconOnly}
        >
          <Subs
            open={top === "vault"}
            subs={vaultSubs}
            clip={clip}
            menuOpen={menuOpen}
            setMenuOpen={setMenuOpen}
            menu={menu}
          />
        </Item>
        <Item
          id="decks"
          label="Decks"
          glyph={<DecksGlyph />}
          on={top === "decks"}
          onClick={pick(onDecks)}
          iconOnly={iconOnly}
        >
          <Subs
            open={top === "decks"}
            subs={decksSubs}
            clip={clip}
            menuOpen={false}
            setMenuOpen={() => {}}
            menu={null}
          />
        </Item>
        {showUpdates ? (
          <Item
            id="updates"
            label="Updates"
            glyph={<span className="pod__hsv">[HSV]</span>}
            on={top === "updates"}
            cue={unread}
            onClick={pick(onUpdates)}
            iconOnly={iconOnly}
          />
        ) : null}
      </div>
    </div>
  );
}
