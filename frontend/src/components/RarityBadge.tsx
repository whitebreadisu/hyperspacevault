// BL-161: rarity symbol image + colored label, shared by the Cards table's
// Rarity column (this slice) and (a follow-up slice, per the Definition's
// build-routing note -- BL-155 decomposes CardPopup before landing its
// rarity line) the unified CardPopup's rarity line. Gallery tiles show no
// rarity today and are out of scope (verified,
// specification_documents/planning/Definition_CosmeticsBatch_2026-07-26.md
// §1).
//
// Assets imported (not referenced by a public/ URL) so the bundler owns
// them -- same convention as components/AspectIcon.tsx's aspect icons and
// components/StatBadge.tsx's stat badges: the real app gets content-hashed
// files, and nothing depends on a runtime /images/ server path. Extracted
// 2026-07-26 from the Claude Design "SWU Inventory Manager — Synced"
// project's templates/rarity-symbols/img/*.webp (byte-identical copies).
import common from "../assets/rarity/common.webp";
import uncommon from "../assets/rarity/uncommon.webp";
import rare from "../assets/rarity/rare.webp";
import legendary from "../assets/rarity/legendary.webp";
import special from "../assets/rarity/special.webp";
import { getRarityLabel } from "../utils/variants";
import "./RarityBadge.css";

export interface RarityMeta {
  image: string;
  /** CSS modifier suffix (RarityBadge.css's `.rarity-badge__label--<key>`). */
  key: string;
}

/** Keyed by the SPELLED-OUT label (getRarityLabel()'s output), not the
 * catalog's raw rarity code -- swuapi's live data already ships full words
 * ("Common".."Special"); the single-letter codes RARITY_LABELS translates
 * (utils/variants.ts) are a legacy/fixture form getRarityLabel already
 * normalizes. Keying here off the same label every rarity display already
 * computes means this map is correct for either input shape without knowing
 * which one it got. */
export const RARITY_META: Record<string, RarityMeta> = {
  Common: { image: common, key: "common" },
  Uncommon: { image: uncommon, key: "uncommon" },
  Rare: { image: rare, key: "rare" },
  Legendary: { image: legendary, key: "legendary" },
  Special: { image: special, key: "special" },
};

interface Props {
  /** Raw catalog rarity value (code or full word -- see RARITY_META's doc
   * comment) -- the same value every existing caller already passes to
   * getRarityLabel(). */
  rarity: string;
  /** Symbol size in px (raritySize owner default: 20). Label font-size is
   * fixed at 14px (rarityTextSize) via RarityBadge.css, not exposed as a
   * prop -- the Definition's owner-saved tweaks are hardcoded, not ported as
   * runtime options (the design canvas's window.__SWU_TABLE_TWEAKS knobs are
   * exploration machinery, not a shipped feature). */
  size?: number;
  /** Owner dev review 2026-07-26 (round 2): CardPopup's set plate splits the
   * badge -- a large symbol anchored left of the two-line set/rarity text
   * stack (iconOnly), with the colored label rendered separately inline in
   * the meta line (labelOnly). An unrecognized rarity has no symbol, so
   * iconOnly renders nothing for it (the labelOnly half still shows the raw
   * string, preserving the defensive contract below). */
  iconOnly?: boolean;
  labelOnly?: boolean;
}

/** A rarity with no entry in RARITY_META (unrecognized code) renders the
 * label alone, uncolored -- same defensive "still show something" contract
 * getRarityLabel itself already has (falls back to the raw string). */
export function RarityBadge({ rarity, size = 20, iconOnly = false, labelOnly = false }: Props) {
  const label = getRarityLabel(rarity);
  const meta = RARITY_META[label];

  const icon = meta && !labelOnly && (
    <img className="rarity-badge__icon" src={meta.image} width={size} height={size} alt="" />
  );
  const text = !iconOnly && (
    <span className={`rarity-badge__label${meta ? ` rarity-badge__label--${meta.key}` : ""}`}>
      {label}
    </span>
  );
  if (iconOnly && !icon) return null;

  return (
    <span className="rarity-badge">
      {icon}
      {text}
    </span>
  );
}
