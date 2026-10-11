import { useEffect, useState } from "react";

/** BL-247 S1-03: the phone app's hash router (port of rev4 MApp.jsx:20-45).
 * Routes are `#/<path>?<params>`; the first segment picks the screen. */
export interface Route {
  path: string;
  segs: string[];
  params: Record<string, string>;
  /** Canonical hash for this route (`#/path?k=v`). */
  hash: string;
}

/** First segments the phone app has a screen (or a ComingSoon) for. Anything
 * else normalises to the Vault (rev4 step old-new-route-redirects). */
const KNOWN_ROOTS = new Set(["vault", "card", "more", "pad", "camera", "about"]);

export function parseHash(h: string | null | undefined): Route {
  const stripped = (h ?? "").replace(/^#\/?/, "") || "vault";
  const [path0, qs] = stripped.split("?");
  let path = path0.replace(/\/+$/, "");
  const params: Record<string, string> = {};
  new URLSearchParams(qs ?? "").forEach((v, k) => {
    params[k] = v;
  });
  // Retired routes from earlier prototype revisions: Home / New fold into the
  // Vault, Decks into More.
  if (path === "home" || path === "new" || path === "") path = "vault";
  if (path === "decks") path = "more";
  const segs = path.split("/");
  if (!KNOWN_ROOTS.has(segs[0])) {
    // Unknown route: land on the plain Vault (params dropped with it).
    return { path: "vault", segs: ["vault"], params: {}, hash: "#/vault" };
  }
  const q = new URLSearchParams(params).toString();
  return { path, segs, params, hash: "#/" + path + (q ? "?" + q : "") };
}

const parse = () => parseHash(window.location.hash);

/** Forward navigations made through go() since load; back() only walks history
 * while there is something of ours to walk back to. */
let depth = 0;

/** Where the tool layer (keypad) returns to when closed. */
let bgRoute = "#/vault";
export const getBgRoute = () => bgRoute;
export const setBgRoute = (hash: string) => {
  bgRoute = hash;
};

export function go(hash: string, replace?: boolean): void {
  if (replace) {
    window.history.replaceState(null, "", hash);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    depth++;
    window.location.hash = hash;
  }
}

/** BL-253 S7-09: forward navigations of ours left to walk back (the camera's
 * close decides between an in-document back and the hop back to `/`). */
export const navDepth = (): number => depth;

export function back(): void {
  backOr("#/vault");
}

/** History back while there is something of ours to walk back to, else
 * `fallback` (BL-250 S4-05: a More sub-page's back chevron falls back to
 * `#/more`). */
export function backOr(fallback: string): void {
  if (depth > 0) {
    depth--;
    window.history.back();
  } else {
    go(fallback);
  }
}

/** Test seam: forget navigation depth between tests. */
export function resetRouterForTest(): void {
  depth = 0;
  bgRoute = "#/vault";
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);

  useEffect(() => {
    const on = () => {
      const r = parse();
      // Canonicalise an unknown / empty / oddly spelled hash in place (no history entry).
      if (window.location.hash !== r.hash) window.history.replaceState(null, "", r.hash);
      setRoute(r);
    };
    on();
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  return route;
}
