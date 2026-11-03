// The `v` printing slug (App Spec §5.3): names one printing of a base card in
// a URL, on the public card page (`/cards/sor/005/?v=hyperspace-sor-271`) and
// in the app's boot link (`/?card=sor-005&v=hyperspace-sor-271`). The slug is
// `<finish>-<source set>-<card number>`, lower case; the card's default
// printing (defaultPrinting) carries no slug in a link. The value never holds
// a database id (ids differ between environments), so a link copied on one
// environment opens the same printing on another.
//
// Unique per base card: when two printings of one card would share a slug
// (the Serialized Prestige tiers: one finish, one set, one number, told apart
// only by the image file name, App Spec §10.5), the Carbonite tier keeps the
// plain slug and the others add their tier (`-gold`, `-rose-gold`); any other
// clash adds `-2`, `-3` in image-file-name order. A slug a link names that the
// card does not carry resolves to nothing, and the caller opens the default.

export interface SluggedPrinting {
  variant_id: number;
  finish: string | null;
  variant_type: string;
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

/** The printing a card opens on with no `v`: Standard, else the first (the
 * popup's and the page's representative rule). */
export function defaultPrinting<T extends { finish: string | null }>(
  variants: readonly T[]
): T | null {
  return variants.find((v) => v.finish === "Standard") ?? variants[0] ?? null;
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function baseSlug(v: SluggedPrinting): string {
  return `${slugify(v.finish ?? v.variant_type)}-${v.source_set_code.toLowerCase()}-${v.card_number}`;
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

/** The image file name without its path, so a CDN URL and its same-origin
 * copy order alike. */
const fileName = (url: string | null) => (url ?? "").slice((url ?? "").lastIndexOf("/") + 1);

/** variant_id -> slug for every printing of one base card. */
export function printingSlugs(variants: readonly SluggedPrinting[]): Map<number, string> {
  const groups = new Map<string, SluggedPrinting[]>();
  for (const v of variants) {
    const key = baseSlug(v);
    const g = groups.get(key);
    if (g) g.push(v);
    else groups.set(key, [v]);
  }
  const out = new Map<number, string>();
  const used = new Set<string>();
  for (const [base, group] of groups) {
    if (group.length === 1) {
      out.set(group[0].variant_id, base);
      used.add(base);
      continue;
    }
    const wanted = (v: SluggedPrinting) => {
      const tier = serializedTier(v.front_image_url);
      return tier && tier !== "Carbonite" ? `${base}-${slugify(tier)}` : base;
    };
    const ordered = [...group].sort((a, b) => {
      const plain = Number(wanted(a) !== base) - Number(wanted(b) !== base);
      if (plain !== 0) return plain;
      const byName = fileName(a.front_image_url).localeCompare(fileName(b.front_image_url));
      return byName !== 0 ? byName : a.variant_id - b.variant_id;
    });
    for (const v of ordered) {
      let slug = wanted(v);
      for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
      used.add(slug);
      out.set(v.variant_id, slug);
    }
  }
  return out;
}

/** One printing's slug among its card's printings. */
export function printingSlug(variants: readonly SluggedPrinting[], v: SluggedPrinting): string {
  return printingSlugs(variants).get(v.variant_id) ?? baseSlug(v);
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
