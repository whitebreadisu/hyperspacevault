import { useState } from "react";
import type { SyntheticEvent } from "react";
import { DECK_ART, deckArtBox } from "./deckArtModel";
import type { DeckArtImage, DeckRowArt } from "./deckArtModel";

// BL-257 FR3-03: the phone's row-size mirror of desktop's hover preview
// (screens/inventory/PreconPreviewComposition.tsx): the leader, landscape, in
// front; the deck's base behind it, raised so its name strip and a sliver of
// the card show above the leader. Twin Suns: two leaders side by side, one
// base behind and between. The Hoth box: two leader-over-base pairs. Desktop's
// component is not reused: its sizes are fixed px in AddCardsModal.css (a
// desktop stylesheet), its images carry a name and no intrinsic size, and it
// has no failed-image path. Decorative here (the row names the deck).
//
// A failed image never shows as a broken image: after the stored-URL swap
// (utils/cardImages.ts) also fails, a base is dropped and a failed leader
// removes the row's art altogether.

function Face({
  image,
  className,
  w,
  h,
  left,
  top,
  onGone,
}: {
  image: DeckArtImage;
  className: string;
  w: number;
  h: number;
  left: number;
  top: number;
  onGone: (id: number) => void;
}) {
  const onError = (e: SyntheticEvent<HTMLImageElement>) => {
    const el = e.currentTarget;
    const before = el.getAttribute("src");
    image.img.onError?.(e); // one swap to the stored URL, when there is one
    if (el.getAttribute("src") === before) onGone(image.id);
  };
  return (
    <span className={className} style={{ width: w, height: h, left, top }}>
      <img
        src={image.img.src}
        srcSet={image.img.srcSet}
        sizes={image.img.sizes}
        onError={onError}
        alt=""
        width={w}
        height={h}
        loading="lazy"
        decoding="async"
      />
    </span>
  );
}

export function DeckArt({ art }: { art: DeckRowArt }) {
  const [gone, setGone] = useState<ReadonlySet<number>>(new Set());
  if (art.kind === "none") return null;
  if (art.leaders.some((l) => gone.has(l.id))) return null;
  const onGone = (id: number) => setGone((g) => new Set(g).add(id));
  const { leaderW: lw, leaderH: lh, peek, gap, dualBase } = DECK_ART;
  const box = deckArtBox(art.kind);
  const bases = art.bases.map((b) => (b && !gone.has(b.id) ? b : null));
  const dualW = Math.round(box.w * dualBase);
  return (
    <span
      className={"m-deckart m-deckart--" + art.kind}
      style={{ width: box.w, height: box.h }}
      data-art={art.kind}
      aria-hidden="true"
    >
      {art.kind === "dual" && bases[0] ? (
        <Face
          image={bases[0]}
          className="m-deckart__base"
          w={dualW}
          h={Math.round((dualW * lh) / lw)}
          left={Math.round((box.w - dualW) / 2)}
          top={0}
          onGone={onGone}
        />
      ) : null}
      {art.kind !== "dual"
        ? bases.map((b, i) =>
            b ? (
              <Face
                key={b.id}
                image={b}
                className="m-deckart__base"
                w={lw}
                h={lh}
                left={i * (lw + gap)}
                top={0}
                onGone={onGone}
              />
            ) : null
          )
        : null}
      {art.leaders.map((l, i) => (
        <Face
          key={l.id}
          image={l}
          className="m-deckart__leader"
          w={lw}
          h={lh}
          left={i * (lw + gap)}
          top={peek}
          onGone={onGone}
        />
      ))}
    </span>
  );
}
