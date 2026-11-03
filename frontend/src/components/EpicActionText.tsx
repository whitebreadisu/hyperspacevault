import { epicActionDisplay } from "../utils/epicAction";
import { CardText } from "./CardText";

/** The epic-action paragraph of a card's rules-text panel (.cp-text), shared
 * by desktop CardPopupView and phone CardInfo: "Epic Action:" exactly once
 * when the source text carried it, else no label (App Spec §10,
 * utils/epicAction.ts). Renders nothing for an empty or absent field. The
 * text goes through the shared CardText (its markup tokens, App Spec §10). */
export function EpicActionText({ text }: { text: string | null | undefined }) {
  const d = epicActionDisplay(text);
  if (!d) return null;
  return (
    <CardText
      text={d.text}
      label={d.label ? <span className="cp-text__epic-label">{d.label}</span> : null}
    />
  );
}
