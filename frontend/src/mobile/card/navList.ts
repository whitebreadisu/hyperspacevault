// BL-248 S2-01: the list a card was opened from (rev4 M.navList /
// M.navNarrowedList / M.navEntry). The Vault stays mounted under the card
// detail, so it publishes its current list here on every change; the
// detail reads it for "n of m" (amber while the Vault is narrowed, R3-8),
// prev / next, and the neighbour's entry printing (the scope only picks
// the default printing, R5-5). A plain module store: one Vault per app.

export interface NavContext {
  /** base_card_ids in the Vault's current order. */
  ids: number[];
  /** The Vault is narrowed (any facet, toggle, search or scope). */
  narrowed: boolean;
  /** The Vault's finish scope (raw finish) or null. */
  scope: string | null;
  /** S2-09: which surface the list is drawn as -- a row opens on the scoped
   * printing, a gallery cell on the printing it displays. */
  source?: "row" | "gallery";
  /** S2-09: the Finish facet's values (a gallery cell displays the lowest-
   * numbered printing carrying one, BL-201). */
  finishes?: string[];
}

let current: NavContext | null = null;

export function publishNav(ctx: NavContext): void {
  current = ctx;
}

export function readNav(): NavContext | null {
  return current;
}

/** Test seam. */
export function resetNavForTest(): void {
  current = null;
  arrive = null;
  openSource = null;
  opener = null;
}

export interface NavPosition {
  list: number[];
  pos: number;
  narrowed: boolean;
  scope: string | null;
  source: "row" | "gallery" | null;
  finishes: string[];
}

/** Where `id` sits: in the published list when it contains the card, else in
 * `fallback` (the whole catalogue in desktop's default order -- a deep link
 * or a card the current filters no longer show), never narrowed there. */
export function navPosition(id: number, ctx: NavContext | null, fallback: number[]): NavPosition {
  if (ctx && ctx.ids.includes(id))
    return {
      list: ctx.ids,
      pos: ctx.ids.indexOf(id),
      narrowed: ctx.narrowed,
      scope: ctx.scope,
      source: ctx.source ?? "row",
      finishes: ctx.finishes ?? [],
    };
  return {
    list: fallback,
    pos: fallback.indexOf(id),
    narrowed: false,
    scope: null,
    source: null,
    finishes: [],
  };
}

// S2-08 / S2-11: hand-offs to the next card's detail across a route change
// (each card mounts afresh). Read with peek in a state initialiser (React
// StrictMode runs initialisers twice) and cleared from an effect.

/** How the next detail was opened (card_popup_opened.source). */
export type OpenSource = "row" | "gallery" | "swipe" | "nav";
let openSource: OpenSource | null = null;
export function setOpenSource(s: OpenSource): void {
  openSource = s;
}
export function peekOpenSource(): OpenSource | null {
  return openSource;
}

/** A committed swipe / chevron lands in the collapse state it left (rev4
 * M.ui.swipeArrive). */
let arrive: { collapsed: boolean } | null = null;
export function setArrive(a: { collapsed: boolean }): void {
  arrive = a;
}
export function peekArrive(): { collapsed: boolean } | null {
  return arrive;
}
/** F4: the control that opened the card (captured at the tap), so closing
 * returns focus to it. Survives the neighbour remounts of a swipe / chevron
 * chain; a later tap overwrites it. */
let opener: HTMLElement | null = null;
export function setOpener(el: HTMLElement | null): void {
  opener = el;
}
export function peekOpener(): HTMLElement | null {
  return opener;
}
export function clearHandoffs(): void {
  arrive = null;
  openSource = null;
}
