import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Stash } from "../api/stashes";
import "./NavPod.css";

// The desktop "Command pod" (v3.0 navigation handoff 1c, "glide" motion): a
// steel-ring pod hanging from the header's top edge with the top-level
// items Vault · Decks · [HSV] Updates (Updates only while an update is
// unread or it is the view, as the old tab). The active item's subsections unfold
// in place beside it: the wrapper's max-width animates from 0 to its measured
// content width (the pod re-centres as it grows), the sub items fade in after
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
}

const CLIP_MS = 650;
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
}: {
  open: boolean;
  stashes: Stash[];
  onOpenStash: (id: number) => void;
  onAllStashes: () => void;
}) {
  const tab = open ? undefined : -1;
  return (
    <div
      className={"pod-menu" + (open ? " pod-menu--open" : "")}
      aria-hidden={open ? undefined : true}
      data-testid="stash-menu"
    >
      <div className="pod-menu__panel">
        <span className="pod-menu__head" aria-hidden="true">
          <span>Your stashes</span>
          <span>Copies</span>
        </span>
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
        <span className="pod-menu__rule" aria-hidden="true" />
        <button type="button" className="pod-menu__all" tabIndex={tab} onClick={onAllStashes}>
          All stashes
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
  const inner = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  // The real content width (fonts, labels, a share's name), not an estimate.
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return undefined;
    const measure = () => setWidth(Math.ceil(el.scrollWidth));
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
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
      style={{ maxWidth: open ? width || "none" : 0 }}
      aria-hidden={open ? undefined : true}
    >
      <span className="pod__subsinner" ref={inner}>
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
}: {
  id: string;
  label: string;
  glyph: ReactNode;
  on: boolean;
  amber?: boolean;
  cue?: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
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
        aria-label={id === "updates" ? "[HSV] Updates" : undefined}
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
          />
        ) : null}
      </div>
    </div>
  );
}
