import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SWUButton } from "./SWUButton";
import { UserMenu } from "./UserMenu";
import { formatVersionLabel } from "../utils/version";
import logoFull2x from "../assets/brand/hsv-logo-full@2x.webp";
import logoFull3x from "../assets/brand/hsv-logo-full@3x.webp";
import { TitleChooser } from "../mobile/TitleChooser";
import { useStashes } from "../stashes/StashContext";
import { NavPod } from "./NavPod";
import { createGlide } from "./podGlide";
import type { PodGeom } from "./podGlide";
import type { PodSub, PodTop } from "./NavPod";

const VERSION = formatVersionLabel(__APP_VERSION__);

type Density = "full" | "compact" | "tight" | "minimal";
const DENSITIES: Density[] = ["full", "compact", "tight", "minimal"];
/** The narrowest a sub item gets at the minimal step's last resort. */
const SUB_FLOOR_PX = 24;

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function geomOf(root: HTMLElement, natural: boolean): PodGeom | null {
  const row = root.querySelector<HTMLElement>(".pod__row");
  if (!row) return null;
  const cs = getComputedStyle(row);
  const w = (n: Element | null) => (n ? n.getBoundingClientRect().width : 0);
  return {
    padL: parseFloat(cs.paddingLeft) || 0,
    padR: parseFloat(cs.paddingRight) || 0,
    tops: Array.from(root.querySelectorAll(".pod__top")).map(w),
    subs: Array.from(root.querySelectorAll(".pod__subs")).map((g) =>
      natural
        ? g.classList.contains("pod__subs--open")
          ? w(g.querySelector(".pod__subsinner"))
          : 0
        : w(g)
    ),
  };
}

/** Write the geometry inline on the live pod; `moving` clips each group's
 * content to its gliding width (at rest an open group lets the stash menu
 * hang out of it). */
function writeGeom(pod: HTMLElement, g: PodGeom, moving: boolean) {
  const row = pod.querySelector<HTMLElement>(".pod__row");
  if (!row) return;
  row.style.paddingLeft = `${g.padL}px`;
  row.style.paddingRight = `${g.padR}px`;
  pod.querySelectorAll<HTMLElement>(".pod__top").forEach((t, i) => {
    t.style.width = `${g.tops[i]}px`;
  });
  pod.querySelectorAll<HTMLElement>(".pod__subs").forEach((s, i) => {
    s.style.width = `${g.subs[i]}px`;
    s.style.maxWidth = "none";
    s.style.overflowX = moving ? "clip" : "";
  });
}

// The views the shell shows (App.tsx). "cards" is the Vault's Collection and
// "stashes" the Vault's Stashes page (signed in, own vault only);
// "deck-check" sits under Decks; "new-arrivals" is [HSV] Updates; "shared"
// is the viewer-mode Vault for a shared link (App Spec §19.1). "settings"
// and "import-export" are reached from the avatar menu and the Vault's
// Import / Export button; no pod item is lit on them.
export type AppView =
  "cards" | "stashes" | "deck-check" | "settings" | "import-export" | "new-arrivals" | "shared";

interface Props {
  userEmail: string | null;
  onLogout: () => void;
  onSignIn: () => void;
  onChangePassword: () => void;
  onOpenSettings: () => void;
  /** Opens the About & Legal modal. The header has two of its openers: the
   * brand chooser's About & Legal button (the logo and tag line open the
   * chooser; anonymous + signed-in alike) and the UserMenu's
   * "About & Legal" item (signed-in only); the release-notes page's chip is
   * the third (App Spec §5.8). App owns the modal state either way, same as
   * onSignIn/onChangePassword above. */
  onOpenAbout: () => void;
  /** Opens the Leave Feedback modal. Visible for both anonymous
   * and signed-in visitors (rendered unconditionally below, unlike the
   * Sign In/UserMenu split it sits next to) -- App owns the modal state,
   * same pattern as onOpenAbout. */
  onOpenFeedback: () => void;
  /** Which App pane is active: it decides the pod's lit item and sub item
   * (NavPod.tsx). Defaults to "cards". */
  view?: AppView;
  /** Switches to the Vault's Collection (the Vault item, Collection, My vault). */
  onNavigateCards?: () => void;
  /** Opens the Stashes page, on one stash or (null) the page's default.
   * Signed in on the own vault only: the Stashes entries exist only while
   * the stash context is on (StashContext `enabled`). */
  onNavigateStashes?: (stashId: number | null) => void;
  /** Switches to the Deck Check pane (Decks and its Deck Check sub item).
   * Visible to anonymous visitors too -- DeckCheckPage itself gates the
   * auth-only content behind a sign-in prompt. Optional. */
  onNavigateDeckCheck?: () => void;
  /** Threaded straight through to UserMenu -- see its own doc comment.
   * Optional; when omitted, UserMenu's own default of `true` applies. */
  hasPasswordProvider?: boolean;
  /** Opens the "new-arrivals" release-notes view -- the brand chooser's
   * Updates button and the pod's [HSV] Updates item. Optional. */
  onOpenNotes?: () => void;
  /** Drives the [HSV] Updates item (shown while unread or the view) and its amber cue, plus the cream cue on the
   * brand tag line and the chooser's Updates button
   * (utils/releaseNotesSeen.ts's hasUnread()) -- App computes this once and
   * passes it down. Defaults to false. */
  hasUnread?: boolean;
  /** The active share's owner-chosen name (App Spec §19.1): while non-null
   * the Vault item lists it as a sub item. App derives it from
   * sessionStorage (utils/shareSession.ts) and only sets it once a resolve
   * has succeeded. Optional; null lists no share. */
  shareName?: string | null;
  /** Switches to the shared-vault pane. Optional, matching
   * onNavigateDeckCheck's shape. */
  onNavigateShared?: () => void;
}

/** The app header: brand column, the Command pod (NavPod.tsx), and
 * the top-right account slot. The account slot shows Sign In when
 * anonymous, replaced by the avatar dropdown menu once authenticated.
 * onLogout, onChangePassword, onOpenSettings and onOpenAbout all thread
 * through to UserMenu, so the menu's item list stays App-driven rather than
 * owning modal or pane state itself -- App owns the pane switch the way it
 * owns the modals. Delete Account is triggered from the Settings pane's
 * danger zone (SettingsPage), not from Header or UserMenu. */
export function Header({
  userEmail,
  onLogout,
  onSignIn,
  onChangePassword,
  onOpenSettings,
  onOpenAbout,
  onOpenFeedback,
  view = "cards",
  onNavigateCards,
  onNavigateStashes,
  onNavigateDeckCheck,
  hasPasswordProvider,
  onOpenNotes,
  hasUnread = false,
  shareName = null,
  onNavigateShared,
}: Props) {
  // Stash entries (the Stashes sub item, its menu): signed in, own vault.
  const stash = useStashes();
  const stashesOn = stash.enabled && !!userEmail && onNavigateStashes != null;
  const inShared = view === "shared";
  const top: PodTop =
    view === "cards" || view === "stashes" || view === "shared"
      ? "vault"
      : view === "deck-check"
        ? "decks"
        : view === "new-arrivals"
          ? "updates"
          : null;
  const toCards = () => onNavigateCards?.();
  const vaultSubs: PodSub[] = [];
  if (inShared) {
    // The shared vault shown: My vault · the share's name, amber.
    vaultSubs.push({ key: "own", label: "My vault", on: false, onClick: toCards });
  } else {
    vaultSubs.push({
      key: "collection",
      label: "Collection",
      on: view === "cards",
      onClick: toCards,
    });
    if (stashesOn)
      vaultSubs.push({
        key: "stashes",
        label: "Stashes",
        on: view === "stashes",
        onClick: () => onNavigateStashes?.(null),
        menu: true,
      });
  }
  if (shareName != null)
    vaultSubs.push({
      key: "shared",
      label: shareName,
      on: inShared,
      onClick: () => onNavigateShared?.(),
    });
  const decksSubs: PodSub[] = [
    {
      key: "deck-check",
      label: "Deck Check",
      on: view === "deck-check",
      onClick: () => onNavigateDeckCheck?.(),
    },
  ];
  const [chooser, setChooser] = useState(false);
  const closeChooser = useCallback(() => setChooser(false), []);

  // Header density (index.css): the roomiest step -- full, compact, tight,
  // minimal -- whose content fits the bar on one row. Measured, not a fixed
  // width, so a share's name, [HSV] Updates or the signed-out account slot
  // move the step. Measured on a copy of the pod in its final state, so the
  // result never depends on the step shown or on a glide in progress.
  // Re-measured whenever the bar, the brand, the pod or the account slot
  // changes size, and when what the pod holds changes.
  const headerRef = useRef<HTMLElement>(null);
  // The step shown, for what renders differently in it (the minimal step's
  // tooltips); the CSS reads the attribute written below.
  const [density, setDensity] = useState<Density>("full");
  const fitRef = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return undefined;
    // The row's width at the step being tried, measured on a detached copy
    // of the pod laid out in its final state (open groups at full width,
    // closed ones at none, no transitions): the live pod may be mid-glide,
    // and nothing here touches it, so a measure never disturbs an animation
    // and never depends on how far one has got.
    const brandOf = () => el.querySelector<HTMLElement>(".app-header__brand");
    const accountOf = () => el.querySelector<HTMLElement>(".app-header__account");
    let clone: HTMLElement | null = null;
    // The sum below is the grid's own fit only because (index.css): the
    // brand and the account slot are pinned to their content width
    // (justify-self start / end, so their box is their max-content), the
    // nav wrapper has no padding, and the header has no horizontal padding
    // of its own. r1-01-header-widths.spec.ts asserts these.
    const over = () => {
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
      const w = (n: HTMLElement | null) => (n ? n.getBoundingClientRect().width : 0);
      return w(brandOf()) + w(accountOf()) + w(clone) + 2 * gap - el.clientWidth;
    };
    const overflows = () => over() > 0.5;
    // The boxes watched for a change, and their sizes when the last fit ended.
    let observed: HTMLElement[] = [];
    const settled = new WeakMap<Element, string>();
    const sizeOf = (n: HTMLElement) => `${n.offsetWidth}x${n.offsetHeight}`;
    // The glide (podGlide.ts). When one ends, the header re-fits once:
    // reports that came in while it ran were set aside (every box changes
    // each frame by design), so a real change meanwhile -- a web font
    // loading, the account slot or the brand changing -- is measured then.
    const glide = createGlide({
      read: () => {
        const pod = el.querySelector<HTMLElement>(".pod");
        return pod ? geomOf(pod, false) : null;
      },
      write: (g, moving) => {
        const pod = el.querySelector<HTMLElement>(".pod");
        if (pod) writeGeom(pod, g, moving);
      },
      reduced: reducedMotion,
      onEnd: () => later(),
      raf: (cb) => requestAnimationFrame(cb),
      caf: (id) => cancelAnimationFrame(id),
      now: () => performance.now(),
    });
    const apply = (target: PodGeom, animate: boolean) => glide.apply(target, animate);
    const fit = (animate = false) => {
      const pod = el.querySelector<HTMLElement>(".pod");
      if (pod) {
        clone = pod.cloneNode(true) as HTMLElement;
        clone.classList.add("pod--measure");
        clone.removeAttribute("data-testid");
        clone.setAttribute("aria-hidden", "true");
        // The copy lays out at its natural (final) sizes, not the live
        // pod's glide values.
        for (const n of Array.from(
          clone.querySelectorAll<HTMLElement>(".pod__row, .pod__top, .pod__subs")
        ))
          n.removeAttribute("style");
        el.appendChild(clone);
      }
      el.style.removeProperty("--pod-sub-max");
      let chosen: Density = "minimal";
      for (const d of DENSITIES) {
        el.setAttribute("data-density", d);
        if (!overflows()) {
          chosen = d;
          break;
        }
      }
      el.setAttribute("data-density", chosen);
      // The last resort (NavPod.css): still too wide at the minimal step --
      // wider font metrics than ours, a long share name -- so cap every sub
      // item at the widest width that fits (binary search, whole pixels),
      // down to a 24 px floor.
      if (chosen === "minimal" && overflows() && clone) {
        const subs = Array.from(clone.querySelectorAll<HTMLElement>(".pod__subs--open .pod__sub"));
        let hi = Math.max(0, ...subs.map((s) => Math.ceil(s.getBoundingClientRect().width)));
        let lo = SUB_FLOOR_PX;
        const at = (px: number) => el.style.setProperty("--pod-sub-max", `${px}px`);
        if (hi > lo) {
          at(lo);
          if (!overflows()) {
            while (hi - lo > 1) {
              const mid = Math.floor((lo + hi) / 2);
              at(mid);
              if (overflows()) hi = mid;
              else lo = mid;
            }
          }
          at(lo);
        }
      }
      const target = clone ? geomOf(clone, true) : null;
      clone?.remove();
      clone = null;
      setDensity(chosen);
      if (target) apply(target, animate);
      // What the fit left behind: an observer report of exactly these
      // sizes is the fit's own doing, not a change to measure again.
      for (const node of observed) settled.set(node, sizeOf(node));
    };
    // A step change resizes the observed boxes: re-fit on the next frame,
    // never inside the observer's own delivery (which would loop). The
    // window's resize is watched too, for a browser without ResizeObserver,
    // and the header's subtree: an item or a whole pod replaced (sign-in,
    // a share) is observed again.
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fit(false));
    };
    window.addEventListener("resize", later);
    // A report is acted on only when a box's size differs from the one the
    // last fit left: the fit's own step and cap writes settle in one pass.
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            // Mid-glide every box changes each frame by design; the glide's
            // end re-fits once instead.
            if (glide.running()) return;
            const changed = entries.some(
              (e) => settled.get(e.target) !== sizeOf(e.target as HTMLElement)
            );
            if (changed) later();
          });
    const observeAll = () => {
      observed = [
        el,
        ...Array.from(el.children),
        ...Array.from(el.querySelectorAll(".pod, .pod__item, .pod__subsinner")),
      ] as HTMLElement[];
      if (!ro) return;
      ro.disconnect();
      for (const node of observed) ro.observe(node);
    };
    observeAll();
    fit();
    fitRef.current = () => fit(true);
    const mo =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver((records) => {
            // The fit's own measuring copy coming and going is not a change.
            const isCopy = (n: Node) =>
              n instanceof HTMLElement && n.classList.contains("pod--measure");
            const real = records.some(
              (r) =>
                ![...Array.from(r.addedNodes), ...Array.from(r.removedNodes)].every(isCopy) ||
                (r.addedNodes.length === 0 && r.removedNodes.length === 0)
            );
            if (!real) return;
            observeAll();
            later();
          });
    mo?.observe(el, { childList: true, subtree: true });
    return () => {
      fitRef.current = null;
      glide.cancel();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", later);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, []);

  // A change of what the pod holds (the view, a share, Updates, sign-in)
  // is measured in the same frame, before paint: the step for the new state
  // is chosen as its glide starts, never part-way through it.
  useLayoutEffect(() => {
    fitRef.current?.();
  }, [view, shareName, hasUnread, stashesOn, userEmail]);

  return (
    <header className="app-header" ref={headerRef}>
      <div className="app-header__brand">
        {/* The logo and the one-line tag under it are one button that opens
            the brand chooser (About & Legal / [HSV] Updates), as the phone's
            brand stack does: the header's only About entry for a signed-out
            visitor, and the permanent re-entry to Updates once the nav tab
            is gone. The tag line carries the unread cue. */}
        <button
          type="button"
          className="app-header__brand-link app-header__brand-btn"
          onClick={() => setChooser(true)}
          aria-haspopup="dialog"
          aria-label={`Hyperspace Vault, Unofficial Fan Project ${VERSION} - About & Legal and Updates`}
        >
          <img
            className="app-header__logo"
            src={logoFull2x}
            srcSet={`${logoFull2x} 2x, ${logoFull3x} 3x`}
            alt="Hyperspace Vault"
            width={158}
            height={46}
          />
          <span
            className={`app-header__brand-tag app-header__brand-line${
              hasUnread ? " app-header__brand-line--cue" : ""
            }`}
          >
            Unofficial Fan Project <span className="app-header__version">{VERSION}</span>
          </span>
        </button>
        {/* Portalled to <body>: the brand column's uppercase / text-shadow
            styling must not reach the dialog. */}
        {chooser
          ? createPortal(
              <TitleChooser
                desktop
                unread={hasUnread}
                onClose={closeChooser}
                onAbout={() => {
                  setChooser(false);
                  onOpenAbout();
                }}
                onUpdates={() => {
                  setChooser(false);
                  onOpenNotes?.();
                }}
              />,
              document.body
            )
          : null}
      </div>

      <nav className="app-header__nav" aria-label="Main">
        <NavPod
          top={top}
          vaultSubs={vaultSubs}
          decksSubs={decksSubs}
          onVault={inShared ? () => onNavigateShared?.() : toCards}
          onDecks={() => onNavigateDeckCheck?.()}
          onUpdates={() => onOpenNotes?.()}
          shared={inShared}
          unread={hasUnread}
          showUpdates={hasUnread || view === "new-arrivals"}
          stashes={stashesOn && !inShared ? stash.stashes : null}
          onOpenStash={(id) => onNavigateStashes?.(id)}
          onAllStashes={() => onNavigateStashes?.(null)}
          iconOnly={density === "minimal"}
        />
      </nav>

      <div className="app-header__account">
        {/* The app's standard SWUButton, same size="sm" as Sign In below, so
            there is exactly one button treatment in this slot (an accented
            fill would read as a second competing CTA next to Sign In). */}
        <SWUButton size="sm" onClick={onOpenFeedback} ariaLabel="Leave Feedback">
          {/* "Leave " drops below 900 px (index.css header density). */}
          <span className="app-header__fb-long">{"Leave "}</span>Feedback
        </SWUButton>
        {userEmail ? (
          <UserMenu
            userEmail={userEmail}
            onLogout={onLogout}
            onChangePassword={onChangePassword}
            onOpenSettings={onOpenSettings}
            onOpenAbout={onOpenAbout}
            hasPasswordProvider={hasPasswordProvider}
          />
        ) : (
          <SWUButton size="sm" onClick={onSignIn}>
            Sign In
          </SWUButton>
        )}
      </div>
    </header>
  );
}
