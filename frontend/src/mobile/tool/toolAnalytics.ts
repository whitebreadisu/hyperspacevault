import { capturePhone, phoneScreenViewed } from "../phoneAnalytics";

// BL-249 S3-07 (BL-244, additive): the tool's analytics. The events and
// property shapes are desktop AddCardsModal's call sites (BL-235):
//   add_cards_committed {method, cards_added, distinct_cards}
//   add_cards_abandoned {pending_entries}
// plus `layout: "phone"` (capturePhone). The tool layer sends
// screen_viewed {screen: "tool"} once per open. Stage 3c's commit and close
// guard are the call sites of the two add_cards_* helpers (S3-16).

export function toolScreenViewed(): void {
  phoneScreenViewed("tool");
}

export function toolAddCardsCommitted(
  method: "keypad" | "precon",
  cardsAdded: number,
  distinctCards: number
): void {
  capturePhone("add_cards_committed", {
    method,
    cards_added: cardsAdded,
    distinct_cards: distinctCards,
  });
}

export function toolAddCardsAbandoned(pendingEntries: number): void {
  capturePhone("add_cards_abandoned", { pending_entries: pendingEntries });
}
