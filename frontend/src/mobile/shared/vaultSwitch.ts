// BL-252 S6-04 (R5-7): the bottom bar's Vault button as the switch between
// the viewer's own vault and the share. Pure state machine (tested alone);
// MobileNav holds `expanded`, MobileApp holds which vault is shown.
//   - No share name known (no session, or a fresh link still resolving /
//     invalid): the plain Vault tab -- a tap shows the own vault.
//   - A share name known: a tap on the face expands the switch; a pick
//     collapses it and shows that vault; a tap outside / Escape collapses.

export interface SwitchState {
  expanded: boolean;
  /** The shared vault is the vault shown. */
  shown: boolean;
}

export type SwitchAction =
  { type: "face"; hasName: boolean } | { type: "pick"; shared: boolean } | { type: "dismiss" };

export function switchStep(s: SwitchState, a: SwitchAction): SwitchState {
  switch (a.type) {
    case "face":
      // Without a name there is nothing to switch to: the tab goes home.
      if (!a.hasName) return { expanded: false, shown: false };
      return { ...s, expanded: !s.expanded };
    case "pick":
      return { expanded: false, shown: a.shared };
    case "dismiss":
      return s.expanded ? { ...s, expanded: false } : s;
  }
}

/** The face's look: amber with the name while the share is shown; the plain
 * Vault tab otherwise (amber = narrowed to someone else's collection only). */
export function switchFace(hasName: boolean, shown: boolean): "plain" | "own" | "shared" {
  if (!hasName) return "plain";
  return shown ? "shared" : "own";
}
