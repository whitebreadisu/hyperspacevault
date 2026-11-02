import { epicActionDisplay } from "../utils/epicAction";

/** The epic-action paragraph of a card's rules-text panel (.cp-text), shared
 * by desktop CardPopupView and phone CardInfo: "Epic Action:" exactly once,
 * or no label when the text carries its own keyword (BL-326,
 * utils/epicAction.ts). Renders nothing for an empty or absent field. */
export function EpicActionText({ text }: { text: string | null | undefined }) {
  const d = epicActionDisplay(text);
  if (!d) return null;
  return (
    <p className="cp-text__body">
      {d.label ? <span className="cp-text__epic-label">{d.label}</span> : null}
      {d.text}
    </p>
  );
}
