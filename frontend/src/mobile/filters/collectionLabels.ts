import type { CollectionToggles } from "../vault/vaultModel";

/** rev4 CollectionFacet: the four Collection toggles in desktop's order with
 * the phone's labels (desktop CardsPage pl-toggle order; rev4 wording). */
export const COLLECTION_LONG: [keyof CollectionToggles, string][] = [
  ["incomplete", "Only incomplete playsets"],
  ["owned", "Only cards I own"],
  ["unowned", "Only cards I don't own"],
  ["overcap", "Over my keep limit"],
];
