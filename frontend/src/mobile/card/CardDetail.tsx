import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, TouchEvent as ReactTouchEvent } from "react";
import { getBaseCardDetail } from "../../api/baseCards";
import type { BaseCardDetail } from "../../api/baseCards";
import { SectionSeparator } from "../../components/SectionSeparator";
import { useLimits } from "../../context/LimitsContext";
import type { InventoryCard, InventoryVariant } from "../../utils/inventory";
import { sortCardsByScope } from "../../utils/variantScope";
import { MIcon } from "../icons";
import { capturePhone } from "../phoneAnalytics";
import { usePriceKind } from "../priceKind";
import { back, go } from "../router";
import { SetLogo } from "../SetLogo";
import { prefersReducedMotion, useCollapse } from "../vault/useCollapse";
import { useVaultData } from "../vault/useVaultData";
import { AspectsSheet } from "./AspectsSheet";
import { CardPage, READ_ONLY_STEPPER } from "./CardPage";
import { navEntryVariant, regionGeom, setLogoSrc, starfieldSrc } from "./cardDetailModel";
import { FinishSheet } from "./FinishSheet";
import {
  clearHandoffs,
  navPosition,
  peekOpener,
  peekArrive,
  peekOpenSource,
  readNav,
  setArrive,
  setOpenSource,
} from "./navList";
import type { NavPosition } from "./navList";
import { useStepper } from "./useStepper";
import type { Stepper } from "./useStepper";
import "../vault/vault.css";
import "./card.css";

// BL-248 stage 2A-1 + 2A-2: the card detail screen at #/card/<id>[?v=<id>]
// (rev4 MCardDetail.jsx; desktop CardPopup.tsx is the tiebreaker). A layer
// over the Vault, which stays mounted beneath it (its filters, scope,
// scroll position and list survive the visit, as under desktop's popup).
//   - Fixed header (never collapses, never slides): the set's starfield
//     under desktop's scrim, the card's name / subtitle, the set logo. Over
//     it, the bar: a spacer left, prev / "n of m" / next centred (amber
//     "n of m" while the Vault list is narrowed, R3-8), X top-right.
//   - Opens on the printing the list showed (?v=), else the list's entry
//     printing (S2-09: scoped printing from rows, displayed printing from a
//     gallery), else the representative (R5-5).
//   - Body = CardPage: the collapsing region with the plate (the gallery
//     tile's plate scoped to the selected printing's finish, FR1-07; tap =
//     Owned by finish, S2-10), the printings rail +
//     stepper, price history (S2-07), the card text (aspects tap = Aspects
//     sheet, S2-07b).
//   - S2-08 body-slide swipe (R5 switch swipe=body; rev4 R3-9 carousel in
//     the `body` reading): the region and everything below slide as one
//     layer with the neighbour's page one width aside; release past 70 px or
//     a quick flick commits (0.2 s, transform only) and the route changes
//     when the motion ends; short of that it snaps back; at either end the
//     drag is dampened and always snaps back; the chevrons run the same
//     slide; reduced motion changes the route at once. The header's titles
//     and logo cross-dissolve (opacity only) to the neighbour's on commit.

const SLIDE_MS = 200;
const COMMIT_PX = 70;

interface Props {
  id: number;
  params: Record<string, string>;
  onRequestSignIn: () => void;
}

interface TouchState {
  x: number;
  y: number;
  lock: "x" | "y" | null;
  dx: number;
  at: number;
}

export function CardDetail({ id, params, onRequestSignIn }: Props) {
  const { cards, setOrder, setNameByCode, isAuthenticated, loading, patchQuantity, readOnly } =
    useVaultData();
  const { limits, capMode } = useLimits();
  const [priceKind, setPriceKind] = usePriceKind();
  const byId = useMemo(() => new Map(cards.map((c) => [c.base_card_id, c])), [cards]);
  const card = byId.get(id) ?? null;
  const fallback = useMemo(
    () => sortCardsByScope(cards, setOrder, null).map((c) => c.base_card_id),
    [cards, setOrder]
  );
  const nav: NavPosition = navPosition(id, readNav(), fallback);

  // Hand-offs from the previous card (a committed swipe / chevron) and the
  // opener (S2-11 source); peeked in initialisers, cleared after mount.
  const [arrive] = useState(peekArrive);
  const [source] = useState(peekOpenSource);
  useEffect(() => clearHandoffs(), []);

  // Rules text, artist and set name live only on the detail payload.
  const [detail, setDetail] = useState<BaseCardDetail | null>(null);
  useEffect(() => {
    let live = true;
    if (!(id > 0)) return undefined;
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

  // S2-11: card_popup_opened once per card visit (desktop fires it per
  // detail load, CardPopup.tsx:255), with how it was opened.
  const sent = useRef(false);
  const setCode = card?.set_code;
  useEffect(() => {
    if (sent.current || !setCode) return;
    sent.current = true;
    capturePhone("card_popup_opened", { source: source ?? "nav", set_code: setCode });
  }, [setCode, source]);

  const [sel, setSel] = useState<number | null>(null);
  const [showBack, setShowBack] = useState(false);
  const entry = card ? navEntryVariant(card, nav, params.v ? Number(params.v) : null) : null;
  const variant = (card && sel != null && card.variants.find((v) => v.variant_id === sel)) || entry;
  const geom =
    card && variant ? regionGeom(card, variant, showBack && !!variant.back_image_url) : null;

  // The body's translate adds --d-delta of scroll room while expanded; the
  // collapse rule must not count it (rev4 deltaRef).
  const { scrollEl, collapsed, expand, pull, pullStyle } = useCollapse(
    params.collapsed === "1" || !!arrive?.collapsed,
    320,
    false,
    geom ? geom.delta : 0
  );
  const rawStepper = useStepper(patchQuantity);
  // S2-11: quantity_changed as desktop's popup (CardPopupInventory.tsx:347).
  const stepper: Stepper = {
    ...rawStepper,
    increment: (v) => {
      capturePhone("quantity_changed", { direction: "increment", surface: "detail" });
      rawStepper.increment(v);
    },
    decrement: (v) => {
      capturePhone("quantity_changed", { direction: "decrement", surface: "detail" });
      rawStepper.decrement(v);
    },
  };
  const chartEngage = useCallback(() => capturePhone("price_history_opened", {}), []);

  const [sheet, setSheet] = useState<
    { kind: "finish" } | { kind: "aspects"; aspects: string[] } | null
  >(null);
  const closeSheet = useCallback(() => setSheet(null), []);

  const select = (variantId: number) => {
    setSel(variantId);
    setShowBack(false);
  };

  // ── S2-08: the swipe ────────────────────────────────────────────────────
  const trackRef = useRef<HTMLDivElement>(null);
  const t = useRef<TouchState | null>(null);
  const busy = useRef(false);
  // F1: false once the layer is gone, so a slide's pending finish (timer /
  // transitionend) can never route to the neighbour after a close.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // F4: focus moves to the close control on open; on a real close (not a
  // swipe / chevron hand-off to the neighbour, which sets `arrive`) it
  // returns to the control that opened the card.
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (peekArrive()) return;
      const o = peekOpener();
      if (o && o.isConnected) o.focus({ preventScroll: true });
    };
  }, []);
  const [ghostDir, setGhostDir] = useState<0 | 1 | -1>(0);
  const [pending, setPending] = useState<0 | 1 | -1>(0);
  const [xf, setXf] = useState<0 | 1 | -1>(0);
  const neighbour = (d: number): InventoryCard | null => {
    const i = nav.pos + d;
    if (nav.pos < 0 || i < 0 || i >= nav.list.length) return null;
    return byId.get(nav.list[i]) ?? null;
  };
  const setTrack = (x: number | string, animate: boolean) => {
    const tr = trackRef.current;
    if (!tr) return;
    tr.style.transition = animate
      ? `transform ${SLIDE_MS}ms cubic-bezier(0.2, 0.7, 0.2, 1)`
      : "none";
    tr.style.transform = `translate3d(${typeof x === "number" ? x + "px" : x}, 0, 0)`;
  };
  const afterSlide = (fn: () => void) => {
    const tr = trackRef.current;
    let done = false;
    const onEnd = (e: TransitionEvent) => {
      if (e.target === tr && e.propertyName === "transform") finish();
    };
    const finish = () => {
      if (!alive.current || done) return;
      done = true;
      tr?.removeEventListener("transitionend", onEnd);
      fn();
    };
    tr?.addEventListener("transitionend", onEnd);
    setTimeout(finish, SLIDE_MS + 120);
  };
  const arriveAt = (n: InventoryCard, how: "swipe" | "nav") => {
    setArrive({ collapsed });
    setOpenSource(how);
    capturePhone("popup_card_navigated", { method: how === "swipe" ? "swipe" : "prev_next" });
    go("#/card/" + n.base_card_id, true);
  };
  const slideTo = (d: 1 | -1, how: "swipe" | "nav") => {
    const n = neighbour(d);
    if (!n) return;
    setXf(d);
    setTrack(d > 0 ? "-100%" : "100%", true);
    afterSlide(() => arriveAt(n, how));
  };
  const snapBack = () => {
    setTrack(0, true);
    afterSlide(() => setGhostDir(0));
  };
  // Chevrons: mount the neighbour first, then run the same slide.
  const goTo = (d: 1 | -1) => {
    const n = neighbour(d);
    if (busy.current || !n) return;
    if (prefersReducedMotion()) {
      arriveAt(n, "nav");
      return;
    }
    busy.current = true;
    setGhostDir(d);
    setPending(d);
  };
  const slideRef = useRef(slideTo);
  useEffect(() => {
    slideRef.current = slideTo;
  });
  useEffect(() => {
    if (!pending) return undefined;
    const d = pending;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => slideRef.current(d, "nav"));
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, [pending]);

  const ts = (e: ReactTouchEvent) => {
    const target = e.target as HTMLElement;
    if (
      busy.current ||
      e.touches.length !== 1 ||
      sheet ||
      target.closest?.(".m-chart__svg, .m-detail__bar")
    ) {
      t.current = null;
      return;
    }
    const p = e.touches[0];
    t.current = { x: p.clientX, y: p.clientY, lock: null, dx: 0, at: Date.now() };
  };
  const tm = (e: ReactTouchEvent) => {
    const s = t.current;
    if (!s) return;
    const p = e.touches[0];
    const ddx = p.clientX - s.x;
    const ddy = p.clientY - s.y;
    if (!s.lock && (Math.abs(ddx) > 10 || Math.abs(ddy) > 10))
      s.lock = Math.abs(ddx) > Math.abs(ddy) * 1.3 ? "x" : "y";
    if (s.lock !== "x") return;
    s.dx = ddx;
    const d = ddx < 0 ? 1 : -1;
    const has = !!neighbour(d);
    if (has && ghostDir !== d) setGhostDir(d);
    setTrack(has ? ddx : ddx * 0.25, false);
  };
  const te = () => {
    const s = t.current;
    t.current = null;
    if (!s || s.lock !== "x") return;
    const d: 1 | -1 = s.dx < 0 ? 1 : -1;
    const fast = Math.abs(s.dx) > 30 && Date.now() - s.at < 220;
    const n = neighbour(d);
    if ((Math.abs(s.dx) > COMMIT_PX || fast) && n) {
      if (prefersReducedMotion()) {
        arriveAt(n, "swipe");
        return;
      }
      busy.current = true;
      slideTo(d, "swipe");
    } else snapBack();
  };

  const ghost = ghostDir ? neighbour(ghostDir) : null;
  const ghostVariant: InventoryVariant | null = ghost ? navEntryVariant(ghost, nav) : null;
  const xn = xf ? neighbour(xf) : null;

  const starfield = card ? starfieldSrc(card.set_code) : null;
  // The set whose logo shows (desktop CardPopup's rule: the printing's source
  // set when it has a logo, else the card's set). BL-257: drawn by SetLogo.
  const hasLogo = (code: string) => (setLogoSrc(code) ? code : null);
  const logo = card
    ? ((variant && hasLogo(variant.source_set_code)) ?? hasLogo(card.set_code))
    : null;
  const xnLogo = xn ? hasLogo(xn.set_code) : null;

  const common = {
    isAuthenticated,
    readOnly,
    priceKind,
    onPriceKind: setPriceKind,
    setNameByCode,
    limits,
    capMode,
    onRequestSignIn,
  };

  return (
    <div
      className={
        "m-screen m-detail m-detail--r3 m-detail--swipe-body m-cardlayer" +
        (xn ? " m-detail--xout" : "")
      }
      data-card={id}
      onTouchStart={ts}
      onTouchMove={tm}
      onTouchEnd={te}
      onTouchCancel={te}
    >
      <header
        className="m-hdr m-hdr--detail m-hdr--detail-r3 m-hdr--detail-fixed"
        style={{ "--starfield": starfield ? `url(${starfield})` : "none" } as CSSProperties}
      >
        <div className="m-hdr__barspace" aria-hidden="true" />
        <div className="m-hdr__titles m-xfade">
          <h1 className="m-detail__title">{card?.name ?? ""}</h1>
          {card?.subtitle ? <div className="m-detail__sub">{card.subtitle}</div> : null}
        </div>
        {logo && card ? (
          <SetLogo
            code={logo}
            box="detail"
            align="right"
            label={`${card.set_code} logo`}
            className="m-hdr__setlogo m-xfade"
          />
        ) : null}
        {xn ? (
          <div className="m-hdr__titles m-xfade m-xfade--in" aria-hidden="true">
            <div className="m-detail__title">{xn.name}</div>
            {xn.subtitle ? <div className="m-detail__sub">{xn.subtitle}</div> : null}
          </div>
        ) : null}
        {xnLogo ? (
          <SetLogo
            code={xnLogo}
            box="detail"
            align="right"
            className="m-hdr__setlogo m-xfade m-xfade--in"
          />
        ) : null}
      </header>
      <SectionSeparator className="m-detail__sep" />
      <div className="m-detail__viewport">
        <div className="m-detail__track" ref={trackRef}>
          {card && variant && geom ? (
            <CardPage
              card={card}
              variant={variant}
              geom={geom}
              showBack={showBack}
              setShowBack={setShowBack}
              collapsed={collapsed}
              onExpand={expand}
              pulling={pull > 0}
              pullStyle={pullStyle}
              scrollRef={scrollEl}
              stepper={stepper}
              detail={detail}
              onSelect={select}
              onOpenFinish={isAuthenticated ? () => setSheet({ kind: "finish" }) : undefined}
              onOpenAspects={(aspects) => setSheet({ kind: "aspects", aspects })}
              onChartEngage={chartEngage}
              {...common}
            />
          ) : (
            <div className="m-empty">
              <p>{loading ? "Loading…" : "This card is not in the catalogue."}</p>
            </div>
          )}
          {ghost && ghostVariant ? (
            <CardPage
              key={"g" + ghost.base_card_id}
              card={ghost}
              variant={ghostVariant}
              geom={regionGeom(ghost, ghostVariant, false)}
              showBack={false}
              setShowBack={() => {}}
              collapsed={collapsed}
              ghost={ghostDir > 0 ? "next" : "prev"}
              stepper={READ_ONLY_STEPPER}
              detail={null}
              onSelect={() => {}}
              {...common}
            />
          ) : null}
        </div>
      </div>
      <div className="m-detail__bar">
        <div className="m-hdr__bar m-hdr__bar--r2">
          <span className="m-hdr__balance" aria-hidden="true" />
          <span className="m-hdr__nav">
            <button
              type="button"
              className="m-iconbtn m-hdr__step"
              onClick={() => goTo(-1)}
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
              onClick={() => goTo(1)}
              disabled={nav.pos < 0 || nav.pos >= nav.list.length - 1}
              aria-label="Next card"
            >
              <MIcon name="fwd" size={20} />
            </button>
          </span>
          <button
            type="button"
            className="m-iconbtn m-hdr__close"
            ref={closeRef}
            onClick={back}
            aria-label="Close card"
          >
            <MIcon name="close" />
          </button>
        </div>
      </div>
      {sheet?.kind === "finish" && card ? (
        <FinishSheet card={card} qtyOf={stepper.qtyOf} onClose={closeSheet} />
      ) : null}
      {sheet?.kind === "aspects" ? (
        <AspectsSheet aspects={sheet.aspects} onClose={closeSheet} />
      ) : null}
    </div>
  );
}
