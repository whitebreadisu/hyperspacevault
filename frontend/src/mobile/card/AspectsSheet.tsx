import { AspectIcon } from "../../components/AspectIcon";
import { Sheet } from "../Sheet";

// BL-248 S2-07b: the card's aspects with their names (rev4 MSheet.jsx
// AspectsSheet). Desktop reveals an aspect's name on hover; a finger has no
// hover, so a tap on the detail's aspect icons opens this small sheet
// (the replacement idiom). X top-right (Sheet); 44 px rows; desktop's
// AspectIcon at 36 px; names in the condensed label face.

export function AspectsSheet({ aspects, onClose }: { aspects: string[]; onClose: () => void }) {
  return (
    <Sheet
      title="Aspects"
      labelId="sheet-aspects"
      className="m-sheet-layer--aspects"
      onClose={onClose}
    >
      <div className="m-aspectlist">
        {aspects.length === 0 ? (
          <div className="m-dossier__empty">No aspect</div>
        ) : (
          aspects.map((a) => (
            <div key={a} className="m-aspectlist__row" data-aspect={a}>
              <AspectIcon aspect={a} size={36} />
              <span>{a}</span>
            </div>
          ))
        )}
      </div>
    </Sheet>
  );
}
