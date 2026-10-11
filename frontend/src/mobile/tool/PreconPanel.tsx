import type { PreconEntry } from "../../data/preconDecks";
import { entryName, entryProduct } from "../../screens/inventory/AddCardsPreconBar";
import { useVaultData } from "../vault/useVaultData";
import { preconFacts, setLogoUrl } from "./padModel";

// BL-249 S3-05: the result zone while a precon deck is chosen (rev4 MPrecon
// R4-14.2 panel head): set logo, product, deck name, "N cards · M distinct"
// (desktop cardsForEntry), and Change set back to the two choosers. Stage
// 3b (S3-09) adds desktop's keep-limit radios and Add deck to batch here.

export function PreconPanel({
  entry,
  onChangeSet,
}: {
  entry: PreconEntry;
  onChangeSet: () => void;
}) {
  const { sets } = useVaultData();
  const { total, distinct } = preconFacts(entry);
  return (
    <div className="m-d2-precon" data-deck={entry.key}>
      <div className="m-d2-precon__head">
        <img className="m-choice__logo m-d2-deck__logo" src={setLogoUrl(entry.setCode)} alt="" />
        <div className="m-d2-precon__titles">
          <span className="m-d2-deck__product">{entryProduct(entry)}</span>
          <span className="m-d2-precon__name">{entryName(entry, sets)}</span>
          <span className="m-d2-precon__facts">
            {total} cards · {distinct} distinct
          </span>
        </div>
      </div>
      <div className="m-d2-precon__actions">
        <button type="button" className="m-textbtn m-d2-precon__change" onClick={onChangeSet}>
          Change set
        </button>
      </div>
    </div>
  );
}
