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
}

export interface NavPosition {
  list: number[];
  pos: number;
  narrowed: boolean;
  scope: string | null;
}

/** Where `id` sits: in the published list when it contains the card, else in
 * `fallback` (the whole catalogue in desktop's default order -- a deep link
 * or a card the current filters no longer show), never narrowed there. */
export function navPosition(id: number, ctx: NavContext | null, fallback: number[]): NavPosition {
  if (ctx && ctx.ids.includes(id))
    return { list: ctx.ids, pos: ctx.ids.indexOf(id), narrowed: ctx.narrowed, scope: ctx.scope };
  return { list: fallback, pos: fallback.indexOf(id), narrowed: false, scope: null };
}
