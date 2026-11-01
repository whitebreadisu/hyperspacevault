import { capturePhone, phoneScreenViewed } from "../phoneAnalytics";

// The tool's analytics. The event names and property shapes are registered
// in App Spec §22 and match desktop AddCardsModal's call sites:
//   add_cards_committed {method, cards_added, distinct_cards}
//   add_cards_abandoned {pending_entries}
// plus `layout: "phone"` (capturePhone). ToolLayer sends
// screen_viewed {screen: "tool"} each time the layer opens on, or switches
// back to, the keypad; commit.ts and the two close guards (ToolLayer,
// VerifySheet) call the add_cards_* helpers.

export function toolScreenViewed(): void {
  phoneScreenViewed("tool");
}

/** `camera` / `camera_fast_add` are method values beside keypad and precon;
 * a camera commit also carries `fast_add` (the Fast add state of its adds).
 * The keypad and precon shapes carry no `fast_add`. */
export function toolAddCardsCommitted(
  method: "keypad" | "precon" | "camera" | "camera_fast_add",
  cardsAdded: number,
  distinctCards: number
): void {
  capturePhone("add_cards_committed", {
    method,
    cards_added: cardsAdded,
    distinct_cards: distinctCards,
    ...(method === "camera" || method === "camera_fast_add"
      ? { fast_add: method === "camera_fast_add" }
      : {}),
  });
}

/** The fold tab's two states, the `state` values of
 * pad_keypad_toggled (the state the deck is in after the tap). */
export const PAD_KEYPAD_STATES = ["compact", "full"] as const;

export function toolKeypadToggled(state: (typeof PAD_KEYPAD_STATES)[number]): void {
  capturePhone("pad_keypad_toggled", { state });
}

export function toolAddCardsAbandoned(pendingEntries: number): void {
  capturePhone("add_cards_abandoned", { pending_entries: pendingEntries });
}
