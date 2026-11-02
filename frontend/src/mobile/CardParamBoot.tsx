import { useEffect, useState } from "react";
import { clearCardParam, parseCardParam, resolveCardParam } from "../utils/cardParam";
import { useVaultData } from "../vault/useVaultData";
import { go } from "./router";

/** The phone half of the `/?card=sor-005` boot parameter (desktop: App.tsx
 * -> CardsPage; design note §9 "Optional extra"). Read once at boot, only on
 * `/` and only while the own vault is shown; once the catalogue is in, the
 * set and number resolve to the card's base_card_id through the list already
 * loaded, the parameter leaves the address bar (history.replaceState) and
 * the app navigates to `#/card/<id>`, so Back returns to the Vault. An
 * unknown card only drops the parameter; a malformed one is left alone.
 * Renders nothing. */
export function CardParamBoot({ disabled = false }: { disabled?: boolean }) {
  const { cards, loading } = useVaultData();
  // `disabled` is read at mount only: the parameter applies to the vault shown
  // at boot, and a later switch must not replay it.
  const [pending, setPending] = useState(() =>
    !disabled && window.location.pathname === "/" ? parseCardParam(window.location.search) : null
  );
  useEffect(() => {
    if (pending == null || loading) return;
    setPending(null);
    const hit = resolveCardParam(cards, pending);
    clearCardParam();
    if (hit) go(`#/card/${hit.base_card_id}`);
  }, [pending, loading, cards]);
  return null;
}
