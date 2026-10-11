import { readFileSync } from "node:fs";
import type { BaseCardCatalogWithQuantity } from "../../src/api/baseCards";
import type { CardSet } from "../../src/api/sets";
import type { SetMeta } from "../../src/utils/completion";
import { orderSetCodes } from "../../src/utils/catalog";
import { toInventoryCards } from "../../src/utils/inventory";
import type { InventoryCard } from "../../src/utils/inventory";

// BL-247 stage 1c: the fixture catalogue as the app sees it (desktop
// toInventoryCards over the merged quantities), so the header / by-set specs
// assert against desktop's own math (computePanelMetrics, buildSetBreakdown).

const read = <T>(f: string) => JSON.parse(readFileSync(`e2e/mobile/fixtures/${f}`, "utf8")) as T;

export const SETS = read<CardSet[]>("sets.json");
const QTY = new Map(
  read<{ variant_id: number; quantity: number }[]>("quantities.json").map((q) => [
    q.variant_id,
    q.quantity,
  ])
);
const SET_ORDER: Record<string, string | null> = Object.fromEntries(
  SETS.map((s) => [s.code, s.release_date])
);

export function inventoryCards(signedIn = true): InventoryCard[] {
  const raw = read<BaseCardCatalogWithQuantity[]>("base-cards.json").map((c) => ({
    ...c,
    variants: c.variants.map((v) => ({
      ...v,
      quantity: signedIn ? (QTY.get(v.variant_id) ?? 0) : 0,
    })),
  }));
  return toInventoryCards(raw, SET_ORDER);
}

export const BASE_SET_CODES = new Set(SETS.filter((s) => s.is_base_set).map((s) => s.code));

export const ORDERED_BASE_SETS: SetMeta[] = orderSetCodes([...BASE_SET_CODES], SET_ORDER).map(
  (code) => ({ code, name: SETS.find((s) => s.code === code)?.name ?? code })
);

/** Header money: desktop formatMoney without the cents (the app's wholeMoney). */
export function whole(value: number): string {
  const s = value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return ("$" + s).replace(/\.\d\d$/, "");
}
