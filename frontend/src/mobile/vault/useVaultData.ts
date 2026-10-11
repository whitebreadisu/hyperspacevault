import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { getBaseCardsList } from "../../api/baseCards";
import type { BaseCardCatalog, BaseCardCatalogWithQuantity } from "../../api/baseCards";
import { getQuantities } from "../../api/inventory";
import { getSharedQuantities } from "../../api/sharedView";
import { getSets } from "../../api/sets";
import type { CardSet } from "../../api/sets";
import type { SetOrderMap } from "../../utils/catalog";
import { toInventoryCards } from "../../utils/inventory";
import type { InventoryCard } from "../../utils/inventory";

// BL-247 S1-12: the phone's one shared catalogue + quantities instance. Same
// fetches and merge as desktop CardsPage.tsx:334-410 -- the publicly cached
// list (getBaseCardsList), the caller's sparse quantities (getQuantities,
// signed in only; anonymous = every quantity 0, no fetch), the sets
// (getSets -> setOrder / setNameByCode / sets) -- then toInventoryCards
// (utils/inventory.ts). MobileApp owns ONE provider so the Vault (S1),
// card detail (S2) and the tool (S3) read and refresh the same data.

export interface VaultData {
  /** Every base card, merged with the caller's quantities (0 when anonymous). */
  cards: InventoryCard[];
  /** BL-252 S6-05: the share's data (desktop CardsPage `readOnly`): the
   * quantities are the share owner's, nothing here may mutate them. */
  readOnly: boolean;
  sets: CardSet[];
  setOrder: SetOrderMap;
  setNameByCode: Record<string, string>;
  /** Quantities are real (desktop CardsPage `hasData` = signed in OR a
   * share): true for the share's instance whoever is viewing. */
  isAuthenticated: boolean;
  /** Catalogue or (signed-in) quantities still in flight. */
  loading: boolean;
  error: string | null;
  /** Re-reads the caller's quantities (after a mutation; S2/S3). */
  refreshQuantities: () => Promise<void>;
  /** BL-248 S2-05: writes one variant's server-confirmed quantity (the
   * adjust endpoint's returned `quantity`) into the shared map, so every
   * screen re-renders from it without a full re-fetch. */
  patchQuantity: (variantId: number, quantity: number) => void;
}

/** The desktop merge (CardsPage.tsx `baseCards`): slim catalogue variants +
 * quantity, 0 for anything absent from the sparse map. */
export function mergeQuantities(
  catalog: BaseCardCatalog[],
  quantities: Record<number, number>
): BaseCardCatalogWithQuantity[] {
  return catalog.map((base) => ({
    ...base,
    variants: base.variants.map((v) => ({ ...v, quantity: quantities[v.variant_id] ?? 0 })),
  }));
}

/** `shareToken` (BL-252 S6-01): the shared vault's own instance -- desktop's
 * SharedVaultPage mounts a second CardsPage with `shareToken`, which reads
 * the share owner's quantities (GET /api/shared/{token}/quantities, plain
 * fetch, no auth) and is read-only. The catalogue and sets are fetched per
 * instance, as desktop's two CardsPage panes do. */
export function useVaultDataSource(
  isAuthenticated: boolean,
  shareToken: string | null = null
): VaultData {
  const readOnly = shareToken != null;
  const hasData = isAuthenticated || readOnly;
  const [catalog, setCatalog] = useState<BaseCardCatalog[]>([]);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [quantitiesLoading, setQuantitiesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sets, setSets] = useState<CardSet[]>([]);

  useEffect(() => {
    let live = true;
    getBaseCardsList()
      .then((c) => {
        if (live) setCatalog(c);
      })
      .catch((err) => {
        if (live) setError(String(err));
      })
      .finally(() => {
        if (live) setCatalogLoading(false);
      });
    getSets()
      .then((s) => {
        if (live) setSets(s);
      })
      .catch(() => {
        /* desktop logs and carries on with release-order fallbacks */
      });
    return () => {
      live = false;
    };
  }, []);

  const refreshQuantities = useCallback(async () => {
    // Desktop CardsPage: shareToken wins outright, checked before auth.
    if (!readOnly && !isAuthenticated) {
      setQuantities({});
      return;
    }
    const rows = readOnly ? await getSharedQuantities(shareToken!) : await getQuantities();
    const map: Record<number, number> = {};
    for (const r of rows) map[r.variant_id] = r.quantity;
    setQuantities(map);
  }, [isAuthenticated, readOnly, shareToken]);

  useEffect(() => {
    let live = true;
    setQuantitiesLoading(hasData);
    refreshQuantities()
      .catch((err) => {
        if (live) setError(String(err));
      })
      .finally(() => {
        if (live) setQuantitiesLoading(false);
      });
    return () => {
      live = false;
    };
  }, [refreshQuantities, hasData]);

  const patchQuantity = useCallback((variantId: number, quantity: number) => {
    setQuantities((prev) =>
      prev[variantId] === quantity ? prev : { ...prev, [variantId]: quantity }
    );
  }, []);

  const { setOrder, setNameByCode } = useMemo(() => {
    const order: SetOrderMap = {};
    const names: Record<string, string> = {};
    for (const s of sets) {
      order[s.code] = s.release_date;
      names[s.code] = s.name;
    }
    return { setOrder: order, setNameByCode: names };
  }, [sets]);

  const cards = useMemo(
    () => toInventoryCards(mergeQuantities(catalog, quantities), setOrder),
    [catalog, quantities, setOrder]
  );

  return {
    cards,
    sets,
    setOrder,
    setNameByCode,
    readOnly,
    isAuthenticated: hasData,
    loading: catalogLoading || quantitiesLoading,
    error,
    refreshQuantities,
    patchQuantity,
  };
}

const VaultDataContext = createContext<VaultData | null>(null);

export function VaultDataProvider({
  isAuthenticated,
  children,
}: {
  isAuthenticated: boolean;
  children: ReactNode;
}) {
  const value = useVaultDataSource(isAuthenticated);
  return createElement(VaultDataContext.Provider, { value }, children);
}

/** BL-252 S6-01: provides an already-built instance (the shared vault's,
 * built once in MobileApp's share scope and read by its pane, card layer and
 * Owned-by-finish host). */
export function VaultDataValue({ value, children }: { value: VaultData; children: ReactNode }) {
  return createElement(VaultDataContext.Provider, { value }, children);
}

export function useVaultData(): VaultData {
  const v = useContext(VaultDataContext);
  if (!v) throw new Error("useVaultData outside VaultDataProvider");
  return v;
}
