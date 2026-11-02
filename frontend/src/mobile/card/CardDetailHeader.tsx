import type { CSSProperties, ReactNode } from "react";
import { SetLogo } from "../SetLogo";

// The phone card detail's fixed header (App Spec §25.2): the set's starfield
// under desktop's scrim, the card's name (the page's one h1) and subtitle,
// and the set logo. CardDetail.tsx passes the swipe's cross-fade neighbour as
// children; the public card page (src/public) renders it with none.

export function CardDetailHeader({
  starfield,
  name,
  subtitle,
  logo,
  logoLabel,
  children,
}: {
  starfield: string | null;
  name: string;
  subtitle: string | null;
  /** The set code whose logo shows, or null for none. */
  logo: string | null;
  logoLabel: string;
  children?: ReactNode;
}) {
  return (
    <header
      className="m-hdr m-hdr--detail m-hdr--detail-r3 m-hdr--detail-fixed"
      style={{ "--starfield": starfield ? `url(${starfield})` : "none" } as CSSProperties}
    >
      <div className="m-hdr__barspace" aria-hidden="true" />
      <div className="m-hdr__titles m-xfade">
        <h1 className="m-detail__title">{name}</h1>
        {subtitle ? <div className="m-detail__sub">{subtitle}</div> : null}
      </div>
      {logo ? (
        <SetLogo
          code={logo}
          box="detail"
          align="right"
          label={logoLabel}
          className="m-hdr__setlogo m-xfade"
        />
      ) : null}
      {children}
    </header>
  );
}
