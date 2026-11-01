import type { CollectionToggles } from "../../vault/vaultModel";

/** The four Collection toggles in desktop's order (CardsPage pl-toggle
 * order) with the phone's labels. */
export const COLLECTION_LONG: [keyof CollectionToggles, string][] = [
  ["incomplete", "Only incomplete playsets"],
  ["owned", "Only cards I own"],
  ["unowned", "Only cards I don't own"],
  ["overcap", "Over my keep limit"],
];
