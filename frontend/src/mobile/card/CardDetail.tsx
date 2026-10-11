import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { getBaseCardDetail } from "../../api/baseCards";
import type { BaseCardDetail } from "../../api/baseCards";
import { SectionSeparator } from "../../components/SectionSeparator";
import { useLimits } from "../../context/LimitsContext";
import { sortCardsByScope } from "../../utils/variantScope";
import { MIcon } from "../icons";
import { usePriceKind } from "../priceKind";
import { back, go } from "../router";
import { useCollapse } from "../vault/useCollapse";
import { useVaultData } from "../vault/useVaultData";
import { CardInfo } from "./CardInfo";
import { CardRegion } from "./CardRegion";
import { entryVariant, regionGeom, setLogoSrc, starfieldSrc } from "./cardDetailModel";
import { navPosition, readNav } from "./navList";
import { Printings } from "./Printings";
import { useStepper } from "./useStepper";
import "../vault/vault.css";
import "./card.css";

// BL-248 stage 2A-1: the card detail screen at #/card/<id>[?v=<variantId>]
// (rev4 MCardDetail.jsx; desktop CardPopup.tsx is the tiebreaker). A layer
// over the Vault, which stays mounted beneath it (its filters, scope,
// scroll position and list survive the visit, as under desktop's popup).
//   - Fixed header (never collapses): the set's starfield under desktop's
//     scrim, the card's name / subtitle, the set logo. Over it, the bar:
//     a spacer left, prev / "n of m" / next centred (amber "n of m" while
//     the Vault list is narrowed, R3-8), the X top-right (history back).
//   - Opens on the printing the list showed (?v=), else the scoped
//     finish's printing, else the representative (R5-5: the scope only
//     picks this default; no scope marker, no amber row edge).
//   - Body: the collapsing art region (S2-02) with the plate for the
//     selected printing (S2-03), the printings rail with the stepper
//     (S2-04 / S2-05), then the card's text and facts (S2-06).

interface Props {
  id: number;
  params: Record<string, string>;
  onRequestSignIn: () => void;
}

export function CardDetail({ id, params, onRequestSignIn }: Props) {
  const { cards, setOrder, setNameByCode, isAuthenticated, loading, patchQuantity } =
    useVaultData();
  const { limits, capMode } = useLimits();
  const [priceKind, setPriceKind] = usePriceKind();
  const card = useMemo(() => cards.find((c) => c.base_card_id === id) ?? null, [cards, id]);
  const fallback = useMemo(
    () => sortCardsByScope(cards, setOrder, null).map((c) => c.base_card_id),
    [cards, setOrder]
  );
  const nav = navPosition(id, readNav(), fallback);

  // Rules text, artist and set name live only on the detail payload.
  const [detail, setDetail] = useState<BaseCardDetail | null>(null);
  useEffect(() => {
    let live = true;
    getBaseCardDetail(id)
      .then((d) => {
        if (live) setDetail(d);
      })
      .catch(() => {
        /* the catalogue row still renders; the text panel stays absent */
      });
    return () => {
      live = false;
    };
  }, [id]);

  const [sel, setSel] = useState<number | null>(null);
  const [showBack, setShowBack] = useState(false);
  const entry = card
    ? entryVariant(card, { v: params.v ? Number(params.v) : null, scope: nav.scope })
    : null;
  const variant = (card && sel != null && card.variants.find((v) => v.variant_id === sel)) || entry;
  const geom =
    card && variant ? regionGeom(card, variant, showBack && !!variant.back_image_url) : null;

  // The body's translate adds --d-delta of scroll room while expanded; the
  // collapse rule must not count it (rev4 deltaRef).
  const { scrollEl, collapsed, expand, pull, pullStyle } = useCollapse(
    params.collapsed === "1",
    320,
    false,
    geom ? geom.delta : 0
  );
  const stepper = useStepper(patchQuantity);

  const select = (variantId: number) => {
    setSel(variantId);
    setShowBack(false);
  };
  const step = (d: -1 | 1) => {
    const n = nav.list[nav.pos + d];
    if (n != null) go("#/card/" + n, true);
  };

  const starfield = card ? starfieldSrc(card.set_code) : null;
  const logo = card
    ? ((variant && setLogoSrc(variant.source_set_code)) ?? setLogoSrc(card.set_code))
    : null;
  const pageStyle = {
    "--d-full": (geom?.full ?? 0) + "px",
    "--d-delta": (geom?.delta ?? 0) + "px",
    ...pullStyle,
  } as CSSProperties;

  return (
    <div className="m-screen m-detail m-detail--r3 m-cardlayer" data-card={id}>
      <header
        className="m-hdr m-hdr--detail m-hdr--detail-r3 m-hdr--detail-fixed"
        style={{ "--starfield": starfield ? `url(${starfield})` : "none" } as CSSProperties}
      >
        <div className="m-hdr__barspace" aria-hidden="true" />
        <div className="m-hdr__titles">
          <h1 className="m-detail__title">{card?.name ?? ""}</h1>
          {card?.subtitle ? <div className="m-detail__sub">{card.subtitle}</div> : null}
        </div>
        {logo && card ? (
          <img className="m-hdr__setlogo" src={logo} alt={`${card.set_code} logo`} />
        ) : null}
      </header>
      <SectionSeparator className="m-detail__sep" />
      <div className="m-detail__viewport">
        <div className="m-detail__track">
          {card && variant && geom ? (
            <div
              className={
                "m-page" + (collapsed ? " m-page--collapsed" : "") + (pull > 0 ? " m-pulling" : "")
              }
              style={pageStyle}
            >
              <div className="m-scroll m-detail__scroll m-detail__scroll--r3" ref={scrollEl}>
                <CardRegion
                  card={card}
                  variant={variant}
                  geom={geom}
                  showBack={showBack}
                  setShowBack={setShowBack}
                  collapsed={collapsed}
                  onExpand={expand}
                  qty={stepper.qtyOf(variant)}
                  isAuthenticated={isAuthenticated}
                  priceKind={priceKind}
                  onPriceKind={setPriceKind}
                />
                <div className="m-detail__body">
                  <Printings
                    card={card}
                    setNameByCode={setNameByCode}
                    selectedId={variant.variant_id}
                    onSelect={select}
                    priceKind={priceKind}
                    onPriceKind={setPriceKind}
                    isAuthenticated={isAuthenticated}
                    stepper={stepper}
                    limits={limits}
                    capMode={capMode}
                    onRequestSignIn={onRequestSignIn}
                  />
                  <CardInfo
                    card={card}
                    detail={detail}
                    setName={setNameByCode[card.set_code] ?? card.set_code}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="m-empty">
              <p>{loading ? "Loading…" : "This card is not in the catalogue."}</p>
            </div>
          )}
        </div>
      </div>
      <div className="m-detail__bar">
        <div className="m-hdr__bar m-hdr__bar--r2">
          <span className="m-hdr__balance" aria-hidden="true" />
          <span className="m-hdr__nav">
            <button
              type="button"
              className="m-iconbtn m-hdr__step"
              onClick={() => step(-1)}
              disabled={nav.pos <= 0}
              aria-label="Previous card"
            >
              <MIcon name="back" size={20} />
            </button>
            <span className={"m-hdr__pos" + (nav.narrowed ? " m-hdr__pos--narrowed" : "")}>
              {nav.pos >= 0 ? `${nav.pos + 1} of ${nav.list.length}` : ""}
            </span>
            <button
              type="button"
              className="m-iconbtn m-hdr__step"
              onClick={() => step(1)}
              disabled={nav.pos < 0 || nav.pos >= nav.list.length - 1}
              aria-label="Next card"
            >
              <MIcon name="fwd" size={20} />
            </button>
          </span>
          <button
            type="button"
            className="m-iconbtn m-hdr__close"
            onClick={back}
            aria-label="Close card"
          >
            <MIcon name="close" />
          </button>
        </div>
      </div>
    </div>
  );
}
