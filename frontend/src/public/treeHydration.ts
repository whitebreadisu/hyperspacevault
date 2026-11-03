// The page's two layout trees (design note §4 D3): hydrate the tree the
// width shows now, and each other tree the first time a width change shows
// it -- once per tree, however often the viewport crosses back and forth.

/** Calls `hydrateTree(phone)` for the visible tree now and on each reveal of
 * a tree not hydrated yet. Returns the trees hydrated so far (for tests). */
export function hydrateTreesOnReveal(
  query: MediaQueryList,
  hydrateTree: (phone: boolean) => void
): Set<boolean> {
  const done = new Set<boolean>();
  const onChange = () => {
    const phone = query.matches;
    if (done.has(phone)) return;
    done.add(phone);
    hydrateTree(phone);
  };
  onChange();
  listen(query, onChange);
  return done;
}

/** Safari before 14 has only the legacy addListener; a failure here must not
 * stop the page script (its view event comes after). */
function listen(query: MediaQueryList, fn: () => void) {
  try {
    if (typeof query.addEventListener === "function") query.addEventListener("change", fn);
    else query.addListener(fn);
  } catch {
    /* the first tree stays hydrated; the other stays static */
  }
}
