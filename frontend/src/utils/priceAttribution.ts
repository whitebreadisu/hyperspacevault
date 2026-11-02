import { formatAsOf } from "../mobile/card/priceChartModel";

// The attribution line every price surface carries (App Spec §5.10, §16.4,
// §25.2): "Prices via TCGplayer · as of {date}", plus "· N unpriced" when
// some printing has no price. The date is the newest as-of across the
// printings shown, formatted with the fixed UTC / en-US formatter so a
// server-rendered page and its hydration read the same text.

interface Priced {
  price?: { as_of?: string | null } | null;
}

/** The newest "as of" date (ISO yyyy-mm-dd) across the printings, or null
 * when none has a price. */
export function latestAsOf(variants: readonly Priced[]): string | null {
  let best: string | null = null;
  for (const v of variants) {
    const d = v.price?.as_of;
    if (d && (best == null || d > best)) best = d;
  }
  return best;
}

export function priceAttribution(variants: readonly Priced[]): string {
  const asOf = latestAsOf(variants);
  const unpriced = variants.filter((v) => v.price == null).length;
  return (
    "Prices via TCGplayer" +
    (asOf ? ` · as of ${formatAsOf(asOf)}` : "") +
    (unpriced > 0 ? ` · ${unpriced} unpriced` : "")
  );
}
