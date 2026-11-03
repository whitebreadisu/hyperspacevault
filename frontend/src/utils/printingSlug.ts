// The `v` printing slug (App Spec §5.3): names one printing of a base card in
// a URL, on the public card page (`/cards/sor/005/?v=hyperspace-sor-271`) and
// in the app's boot link (`/?card=sor-005&v=hyperspace-sor-271`). The slug is
// `<finish>-<source set>-<card number>`, lower case; the card's default
// printing (defaultPrinting) carries no slug in a link. The value never holds
// a database id (ids differ between environments), so a link copied on one
// environment opens the same printing on another.
//
// Unique per base card, and stable across catalogue refreshes (a link keeps
// naming the same printing):
//   - every part goes through one slugify, so a slug is always [a-z0-9-];
//   - a Serialized Prestige tier other than Carbonite always carries its tier
//     (`-gold`, `-rose-gold`), read from the image file name (App Spec
//     §10.5), whether or not its sibling tiers are in the catalogue;
//   - every other printing's natural slug is reserved first; printings whose
//     natural slugs clash each add a short token hashed from the printing's
//     own identity (variant type, channel and image file stem, the same on
//     every environment and independent of the other printings), checked
//     against every slug of the card, so a suffixed slug never equals another
//     printing's natural slug.
// A slug a link names that the card does not carry resolves to nothing, and
// the caller opens the default.

export interface SluggedPrinting {
  variant_id: number;
  finish: string | null;
  variant_type: string;
  channel: string;
  source_set_code: string;
  card_number: string;
  front_image_url: string | null;
}

/** Characters a slug can hold; anything else in a `v` value is not a slug.
 * The source string also goes to the card page's inline head script. */
export const SLUG_PATTERN = "^[a-z0-9-]{1,80}$";
const SLUG = new RegExp(SLUG_PATTERN);

/** True when `raw` has a slug's shape (it may still name no printing). */
export function isSlugShaped(raw: string | null | undefined): raw is string {
  return raw != null && SLUG.test(raw);
}

/** The printing a card opens on with no `v`: the Standard printing with the
 * lowest variant_id, else the lowest variant_id overall (the popup's and the
 * page's representative rule; independent of the order the API returns). */
export function defaultPrinting<T extends { finish: string | null; variant_id: number }>(
  variants: readonly T[]
): T | null {
  let best: T | null = null;
  for (const v of variants) {
    if (!best) {
      best = v;
      continue;
    }
    const vStd = v.finish === "Standard";
    const bStd = best.finish === "Standard";
    if (vStd !== bStd ? vStd : v.variant_id < best.variant_id) best = v;
  }
  return best;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

function baseSlug(v: SluggedPrinting): string {
  return [v.finish ?? v.variant_type, v.source_set_code, v.card_number]
    .map(slugify)
    .filter(Boolean)
    .join("-");
}

export type SerializedTier = "Carbonite" | "Gold" | "Rose Gold";

/** A Serialized Prestige printing's tier from its image file name
 * (`..._Carb_C_<hash>` = Carbonite, `..._Carb_C_Gold_<hash>`,
 * `..._Carb_C_Rose_Gold_<hash>`), or null when the name carries none. */
export function serializedTier(url: string | null | undefined): SerializedTier | null {
  const m = /_Carb_C(_Rose_Gold|_Gold)?_[0-9a-f]+\.[a-z]+$/i.exec(url ?? "");
  if (!m) return null;
  return m[1] === "_Rose_Gold" ? "Rose Gold" : m[1] === "_Gold" ? "Gold" : "Carbonite";
}

/** The image file name without its path and extension, so a CDN URL and
 * its same-origin copy (`/images/cards/<stem>.png`) read alike. */
function fileStem(url: string | null): string {
  const name = (url ?? "").slice((url ?? "").lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** The slug a printing has on its own, before any clash. */
function naturalSlug(v: SluggedPrinting): string {
  const tier = serializedTier(v.front_image_url);
  const base = baseSlug(v);
  return tier && tier !== "Carbonite" ? `${base}-${slugify(tier)}` : base;
}

/** FNV-1a over the printing's own identity, base 36. */
function identityToken(v: SluggedPrinting): string {
  const key = `${v.variant_type}|${v.channel}|${fileStem(v.front_image_url)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, "0");
}

/** variant_id -> slug for every printing of one base card. */
export function printingSlugs(variants: readonly SluggedPrinting[]): Map<number, string> {
  const natural = new Map<number, string>();
  const count = new Map<string, number>();
  for (const v of variants) {
    const n = naturalSlug(v);
    natural.set(v.variant_id, n);
    count.set(n, (count.get(n) ?? 0) + 1);
  }
  // Every natural slug is reserved, clashing or not.
  const used = new Set(count.keys());
  const out = new Map<number, string>();
  for (const v of variants) {
    const n = natural.get(v.variant_id)!;
    if (count.get(n) === 1) out.set(v.variant_id, n);
  }
  // Clashing printings in a fixed order of their identity, so the result does
  // not depend on the order the printings arrive in.
  const clashing = variants
    .filter((v) => count.get(natural.get(v.variant_id)!)! > 1)
    .map((v) => ({ v, token: identityToken(v) }))
    .sort((a, b) => (a.token < b.token ? -1 : a.token > b.token ? 1 : 0));
  for (const { v, token } of clashing) {
    let slug = `${natural.get(v.variant_id)}-${token}`;
    // Only printings with identical identity data share a token; they are
    // told apart by a further letter, in the fixed order above.
    for (let k = 0; used.has(slug); k++)
      slug = `${natural.get(v.variant_id)}-${token}${k.toString(36)}`;
    used.add(slug);
    out.set(v.variant_id, slug);
  }
  return out;
}

/** One printing's slug among its card's printings. */
export function printingSlug(variants: readonly SluggedPrinting[], v: SluggedPrinting): string {
  return printingSlugs(variants).get(v.variant_id) ?? naturalSlug(v);
}

/** The printing a slug names, or null (unknown, or no slug). */
export function findPrintingBySlug<T extends SluggedPrinting>(
  variants: readonly T[],
  slug: string | null | undefined
): T | null {
  if (!slug) return null;
  const slugs = printingSlugs(variants);
  return variants.find((v) => slugs.get(v.variant_id) === slug) ?? null;
}

/** The `v` a link carries for this printing: null for the card's default
 * printing (a link without `v` opens it). */
export function linkSlug(variants: readonly SluggedPrinting[], v: SluggedPrinting): string | null {
  const d = defaultPrinting(variants);
  if (d && d.variant_id === v.variant_id) return null;
  return printingSlug(variants, v);
}
