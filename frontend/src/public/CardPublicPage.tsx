import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VariantDetail } from "../api/baseCards";
import { SectionSeparator } from "../components/SectionSeparator";
import { CardPopupView } from "../screens/cards/CardPopupView";
import { CardPopupNavLinks } from "../screens/cards/CardPopupNav";
import { CardPopupExpandedHistory } from "../screens/cards/CardPopupPriceHistory";
import type { PriceRailMode } from "../screens/cards/CardPopupRail";
import { useCardFlip } from "../screens/cards/useCardFlip";
import { CardDetailHeader } from "../mobile/card/CardDetailHeader";
import { CardPage, READ_ONLY_STEPPER } from "../mobile/card/CardPage";
import { regionGeom, setLogoSrc, starfieldSrc } from "../mobile/card/cardDetailModel";
import type { RegionGeom } from "../mobile/card/cardDetailModel";
import { useCollapse } from "../mobile/vault/useCollapse";
import { toInventoryCards } from "../utils/inventory";
import { setPath } from "./publicCatalog";
import type { CardLink, CardPageData } from "./publicCatalog";
import { ctaClicked } from "./publicAnalytics";
import { ArtNotice, Breadcrumbs, PageBar, PageFooter, SetNav, SignUpPlate } from "./PublicFrame";

// The public card page (design note §0, §4): the app's own card detail,
// rendered from the page's embedded data instead of an API fetch.
//   - Desktop: CardPopupView (the popup's view) inside the steel-ring shell,
//     in the page flow instead of a modal.
//   - Phone: the phone card detail's header and CardPage.
// Both trees are prerendered into every page; CSS shows one by width
// (767 px, the phone switch's width test) and the browser hydrates only the
// visible one (card.tsx). Everything in §4.0's delta table is applied here
// through the components' page-only props; nothing else differs.
//
// One <h1> per page: the phone tree's header title is the page's one <h1>
// element (Google indexes with a phone crawler); the desktop tree's title is
// the same text and look as a role="heading" aria-level 1 div. The markup is
// fixed per tree, not per viewport, so hydrating either tree matches.

/** The printing a page opens on: Standard, else the first (the popup's
 * pickRepresentative). */
function representative(variants: VariantDetail[]): VariantDetail | null {
  return variants.find((v) => v.finish === "Standard") ?? variants[0] ?? null;
}

/** `?v=<finish>` slug for the selected printing (D3); the canonical URL
 * carries none. */
function finishSlug(v: VariantDetail): string {
  const base = (v.finish ?? v.variant_type).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${base}-${v.source_set_code.toLowerCase()}-${v.card_number}`;
}

/** Selection shared by both trees: starts on the representative so the
 * hydrated markup equals the prerendered markup, then, after hydration,
 * honours a `?v=` from the address bar and keeps it in step. */
function usePrinting(variants: VariantDetail[]) {
  const [selectedId, setSelectedId] = useState<number | null>(
    () => representative(variants)?.variant_id ?? null
  );
  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get("v");
    const hit = slug ? variants.find((v) => finishSlug(v) === slug) : null;
    if (hit) setSelectedId(hit.variant_id);
  }, [variants]);
  const selected = useMemo(
    () => variants.find((v) => v.variant_id === selectedId) ?? representative(variants),
    [variants, selectedId]
  );
  const select = useCallback(
    (id: number) => {
      setSelectedId(id);
      const v = variants.find((x) => x.variant_id === id);
      if (!v) return;
      const url = new URL(window.location.href);
      if (v === representative(variants)) url.searchParams.delete("v");
      else url.searchParams.set("v", finishSlug(v));
      window.history.replaceState(null, "", url.toString());
    },
    [variants]
  );
  return { selected, select };
}

/** The phone region's geometry is fixed arithmetic (cardDetailModel
 * regionGeom: a 52 px caption + plate block). The page's plate slot holds
 * the notice line and the sign-up plate instead, so the region grows by the
 * difference; nothing is measured at run time. */
export const PHONE_PLATE_EXTRA = 168;

function withPlateRoom(g: RegionGeom): RegionGeom {
  return {
    ...g,
    full: g.full + PHONE_PLATE_EXTRA,
    delta: g.delta + PHONE_PLATE_EXTRA,
    flipTop: g.flipTop + PHONE_PLATE_EXTRA,
  };
}

/** The header chevrons open the previous / next card in set order inside
 * the app (design note §9 "Optional extra"): `/?card=sor-006`. */
const navLink = (l: CardLink | null) => (l ? { href: l.appHref, name: l.label } : null);
const followNav = () => ctaClicked("open_card_in_app");

function crumbsFor(data: CardPageData) {
  return [
    { label: "Cards", href: "/cards/" },
    { label: data.setName, href: setPath(data.card.set_code) },
    { label: data.card.name },
  ];
}

export function DesktopCardPage({ data }: { data: CardPageData }) {
  const { card } = data;
  const { selected, select } = usePrinting(card.variants);
  const imageWrapRef = useRef<HTMLDivElement>(null);
  const flip = useCardFlip(selected, imageWrapRef, "fixed320");
  const resetFlip = flip.reset;
  const [priceMode, setPriceMode] = useState<PriceRailMode>("market");
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const onSelect = useCallback(
    (id: number) => {
      select(id);
      resetFlip();
    },
    [select, resetFlip]
  );
  if (!selected) return null;
  return (
    <div className="pc-page">
      <PageBar />
      <Breadcrumbs crumbs={crumbsFor(data)} />
      <div className="cp-shell pc-shell">
        <div className="cp-modal pc-modal">
          <CardPopupView
            baseCardId={card.id}
            detail={card}
            variants={card.variants}
            selectedVariant={selected}
            setNameByCode={data.setNameByCode}
            isAuthenticated={false}
            priceMode={priceMode}
            onPriceModeChange={setPriceMode}
            onSelectVariant={onSelect}
            onExpandHistory={() => setHistoryExpanded(true)}
            flip={flip}
            imageWrapRef={imageWrapRef}
            headerControls={
              <div className="cp-header__controls">
                <CardPopupNavLinks
                  prev={navLink(data.prev)}
                  next={navLink(data.next)}
                  onFollow={followNav}
                />
                {/* The app's close button holds this place; kept as an empty
                    slot so the chevrons sit exactly where the app draws them. */}
                <span className="cp-close pc-close-slot" aria-hidden="true">
                  ×
                </span>
              </div>
            }
            inventorySlot={<SignUpPlate />}
            imageNote={<ArtNotice />}
            afterBody={
              historyExpanded && (
                <CardPopupExpandedHistory
                  baseCardId={card.id}
                  variant={selected}
                  onClose={() => setHistoryExpanded(false)}
                />
              )
            }
            headingLevel="aria-h1"
            baseSetLabel={data.setName}
            numberLabel={data.numberLabel}
            showAspectsRow
          />
        </div>
      </div>
      <PageFooter />
    </div>
  );
}

export function PhoneCardPage({ data }: { data: CardPageData }) {
  const { card } = data;
  const invCard = useMemo(() => toInventoryCards([card])[0], [card]);
  const { selected, select } = usePrinting(card.variants);
  const variant = invCard.variants.find((v) => v.variant_id === selected?.variant_id) ?? null;
  const [showBack, setShowBack] = useState(false);
  const [priceKind, setPriceKind] = useState<PriceRailMode>("market");
  const geom = variant
    ? withPlateRoom(regionGeom(invCard, variant, showBack && !!variant.back_image_url))
    : null;
  const { scrollEl, collapsed, expand, pull, pullStyle } = useCollapse(
    false,
    320,
    false,
    geom ? geom.delta : 0
  );
  const logoCode = (code: string) => (setLogoSrc(code) ? code : null);
  const logo = (variant && logoCode(variant.source_set_code)) ?? logoCode(card.set_code);
  if (!variant || !geom) return null;
  return (
    <div className="m-app pc-phone">
      <div className="m-screen m-detail m-detail--r3 m-cardlayer">
        <CardDetailHeader
          starfield={starfieldSrc(card.set_code)}
          name={card.name}
          subtitle={card.subtitle}
          logo={logo}
          logoLabel={`${card.set_code} logo`}
        />
        <SectionSeparator className="m-detail__sep" />
        <div className="m-detail__viewport">
          <div className="m-detail__track">
            <CardPage
              card={invCard}
              variant={variant}
              geom={geom}
              showBack={showBack}
              setShowBack={setShowBack}
              collapsed={collapsed}
              onExpand={expand}
              pulling={pull > 0}
              pullStyle={pullStyle}
              scrollRef={scrollEl}
              stepper={READ_ONLY_STEPPER}
              isAuthenticated={false}
              readOnly
              priceKind={priceKind}
              onPriceKind={setPriceKind}
              setNameByCode={data.setNameByCode}
              limits={null}
              capMode="hard"
              onRequestSignIn={() => {}}
              detail={card}
              onSelect={(id) => {
                select(id);
                setShowBack(false);
              }}
              plateSlot={
                <div className="pc-phone__plate">
                  <ArtNotice />
                  <SignUpPlate phone />
                </div>
              }
              imageMode="fixed320"
              numberLabel={data.numberLabel}
              showAspectsRow
              baseSetLabel={data.setName}
              bodyEnd={
                <div className="pc-phone__end">
                  <Breadcrumbs crumbs={crumbsFor(data)} />
                  <SetNav prev={data.prev} next={data.next} />
                  <PageFooter />
                </div>
              }
            />
          </div>
        </div>
        <div className="m-detail__bar">
          <PageBar phone />
        </div>
      </div>
    </div>
  );
}
