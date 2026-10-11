import { Sheet } from "../Sheet";
import type { FacetId } from "./FacetRows";

// BL-248 stage 2B-1: the hook a facet row opens. Stage 2B-2 (S2-17 / S2-18)
// replaces this body with the Set, Collection and Finish pickers (X
// top-right, Done, the facet in a scrolling body over Filters).

const TITLES: Record<FacetId, string> = { set: "Set", collection: "Collection", finish: "Finish" };

export function FacetPicker({ facet, onClose }: { facet: FacetId; onClose: () => void }) {
  return (
    <Sheet
      title={TITLES[facet]}
      labelId={"sheet-fpick-" + facet}
      className={"m-sheet-layer--picker m-sheet-layer--fpick m-sheet-layer--fpick-" + facet}
      onClose={onClose}
    >
      <p className="m-sheet__soon">This picker arrives with the next stage.</p>
    </Sheet>
  );
}
