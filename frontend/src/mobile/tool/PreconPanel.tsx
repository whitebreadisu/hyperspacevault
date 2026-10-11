import { useState } from "react";
import type { CapHandling } from "../../api/inventoryImportExport";
import type { PreconEntry } from "../../data/preconDecks";
import { useLimits } from "../../context/LimitsContext";
import { entryName, entryProduct } from "../../screens/inventory/AddCardsPreconBar";
import { SWUButton } from "../../components/SWUButton";
import { useVaultData } from "../vault/useVaultData";
import { addDeck } from "./batch";
import { preconFacts, setLogoUrl } from "./padModel";
import { setPreconAdded, useToolState } from "./toolStore";

// BL-249 S3-05 / S3-09: the result zone while a precon deck is chosen (rev4
// MPrecon R4-14.2 panel): set logo, product, deck name, "N cards · M
// distinct" (desktop cardsForEntry), desktop's two keep-limit radios for
// hard-cap users (copy verbatim from AddCardsModal.tsx), Change set, and
// "Add deck to batch". Add writes every deck copy into the batch, one row
// per copy, `force` set when a hard-cap user chose "Add the full deck, even
// above my keep-limits" (the batch view, not this panel, decides what the
// cap lets in -- the Verify cards sheet lists the rest as not added).

export function PreconPanel({
  entry,
  onChangeSet,
  onRequestSignIn,
}: {
  entry: PreconEntry;
  onChangeSet: () => void;
  onRequestSignIn: () => void;
}) {
  const { sets, cards, isAuthenticated } = useVaultData();
  const { capMode } = useLimits();
  const st = useToolState();
  // Desktop default: "Don't add copies above my keep-limits" (trim).
  const [cap, setCap] = useState<CapHandling>("trim");
  const { total, distinct } = preconFacts(entry);
  const hard = capMode === "hard";
  const added = st.preconAdded && st.preconAdded.key === entry.key ? st.preconAdded : null;

  const add = () => {
    if (!isAuthenticated) {
      onRequestSignIn();
      return;
    }
    const n = addDeck(entry, cards, hard && cap === "add_above");
    setPreconAdded(entry.key, n);
  };

  const radio = (value: CapHandling, title: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={cap === value}
      className={"ie-radio-option m-d2-radio" + (cap === value ? " m-d1-radio--on" : "")}
      onClick={() => setCap(value)}
    >
      <span className="m-d1-radio__dot" aria-hidden="true" />
      <span className="ie-radio-option__text">
        <span className="ie-radio-option__title">{title}</span>
      </span>
    </button>
  );

  return (
    <div className="m-d2-precon" data-deck={entry.key}>
      <div className="m-d2-precon__head">
        <img className="m-choice__logo m-d2-deck__logo" src={setLogoUrl(entry.setCode)} alt="" />
        <div className="m-d2-precon__titles">
          <span className="m-d2-deck__product">{entryProduct(entry)}</span>
          <span className="m-d2-precon__name">{entryName(entry, sets)}</span>
        </div>
      </div>
      <div className="m-d2-precon__facts">
        {total} cards · {distinct} distinct
      </div>
      {hard ? (
        <div
          className="ie-radio-group m-d2-precon__radios"
          role="radiogroup"
          aria-label="Keep-limit handling"
        >
          {radio("trim", "Don't add copies above my keep-limits")}
          {radio("add_above", "Add the full deck, even above my keep-limits")}
        </div>
      ) : null}
      {added ? (
        <p className="m-d2-precon__done" role="status">
          {added.n} {added.n === 1 ? "card" : "cards"} in the batch. Verify them before they reach
          your vault.
        </p>
      ) : null}
      <div className="m-d2-precon__actions">
        <button type="button" className="m-textbtn m-d2-precon__change" onClick={onChangeSet}>
          Change set
        </button>
        <SWUButton size="md" active onClick={add} className="m-d2-precon__add">
          Add deck to batch
        </SWUButton>
      </div>
    </div>
  );
}
