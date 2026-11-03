import { SWUButton } from "../components/SWUButton";
import type { CardLink } from "./publicCatalog";
import { ctaClicked } from "./publicAnalytics";
import { localHref } from "../utils/localHref";

// The public pages' frame (design note §4 D1, D4, §7): the page bar with the
// wordmark and one bar action, the breadcrumb, the previous / next links,
// the footer, the art notice and the sign-up plate. Card pages are the first
// page type; public decks reuse the same frame later.

/** The app's front door: the set pages' and the index's bar, and the footer's
 * About & Legal. */
export const APP_URL = "/";

// On a card page every call to action opens THIS card in the app
// (`/?card=sor-005`, utils/cardParam.ts; design note §4 D4): the wordmark,
// the bar action, Create free account and Sign in. The app's card detail
// carries its own sign-in and create-account entry. Set pages and the index
// pass nothing and keep the app's front door.

export function PageBar({
  phone = false,
  appHref = APP_URL,
}: {
  phone?: boolean;
  appHref?: string;
}) {
  const href = localHref(appHref);
  const openApp = () => ctaClicked("open_app");
  return (
    <div className={"pc-bar" + (phone ? " pc-bar--phone" : "")}>
      <a className="pc-brand" href={href} onClick={openApp}>
        <span className="pc-brand__name">[HSV] Hyperspace Vault</span>
        <span className="pc-brand__tag">Unofficial Fan Project</span>
      </a>
      <a className="pc-bar__open" href={href} onClick={openApp}>
        Open HyperspaceVault
      </a>
    </div>
  );
}

export function Breadcrumbs({ crumbs }: { crumbs: { label: string; href?: string }[] }) {
  return (
    <nav className="pc-crumbs" aria-label="Breadcrumb">
      {crumbs.map((c, i) => (
        <span key={i} className="pc-crumbs__item">
          {i > 0 ? (
            <span className="pc-crumbs__sep" aria-hidden="true">
              /
            </span>
          ) : null}
          {c.href ? (
            <a href={localHref(c.href)}>{c.label}</a>
          ) : (
            <span aria-current="page">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function SetNav({ prev, next }: { prev: CardLink | null; next: CardLink | null }) {
  if (!prev && !next) return null;
  return (
    <nav className="pc-setnav" aria-label="Cards in this set">
      {prev ? (
        <a href={localHref(prev.path)} rel="prev">
          ‹ {prev.label}
        </a>
      ) : (
        <span />
      )}
      {next ? (
        <a href={localHref(next.path)} rel="next">
          {next.label} ›
        </a>
      ) : null}
    </nav>
  );
}

export function PageFooter() {
  return (
    <footer className="pc-foot">
      <a href={APP_URL}>About &amp; Legal</a>
      <span>Prices via TCGplayer</span>
      <span>HyperspaceVault · Unofficial Fan Project</span>
    </footer>
  );
}

/** Design note §5a: a printing whose 320 px rendition is not in the
 * card-images bucket gets this same-size panel instead of an <img>, so a
 * public page never triggers the backend's redirect to the official CDN. The
 * generator drops the missing renditions from the page data
 * (scripts/public-pages/lib/images.mjs). */
export function ArtPlaceholder() {
  return (
    <div className="pc-art-ph" role="img" aria-label="Card image not available yet">
      <span>Card image not available yet</span>
    </div>
  );
}

/** Design note §5a part F: visible fine print directly under the art. */
export function ArtNotice() {
  return (
    <p className="pc-notice">
      Card images and Star Wars: Unlimited game assets © Fantasy Flight Publishing Inc. and
      Lucasfilm Ltd. HyperspaceVault is an unofficial fan site, not produced or endorsed by either.
    </p>
  );
}

/** The signed-out plate as the sign-up call to action (row 10, D4): same
 * plate shape and slot, one SWUButton, a quiet "Sign in" text link. Both open
 * `appHref` (a card page passes this card's `/?card=` link). */
export function SignUpPlate({
  phone = false,
  appHref = APP_URL,
}: {
  phone?: boolean;
  appHref?: string;
}) {
  const href = localHref(appHref);
  const createAccount = () => {
    ctaClicked("create_account");
    window.location.assign(href);
  };
  return (
    <div className={"cp-plate pc-cta" + (phone ? " pc-cta--phone" : "")}>
      <div className="cp-plate__inner cp-plate__inner--signed-out pc-cta__inner">
        <span className="pc-cta__msg">Track this card in your vault</span>
        <SWUButton size={phone ? "touch" : "sm"} onClick={createAccount}>
          Create free account
        </SWUButton>
        <a className="pc-cta__signin" href={href} onClick={() => ctaClicked("sign_in")}>
          Sign in
        </a>
      </div>
    </div>
  );
}
