// Imported (not referenced by public/ URL) so the bundler owns these assets:
// the real app gets content-hashed files, and the Claude Design bundle inlines
// them as data-URIs — both render without depending on a /images/ server path.
import Command from "../assets/aspects/SWH_Aspects_Command.png";
import Aggression from "../assets/aspects/SWH_Aspects_Aggression.png";
import Cunning from "../assets/aspects/SWH_Aspects_Cunning.png";
import Vigilance from "../assets/aspects/SWH_Aspects_Vigilance.png";
import Heroism from "../assets/aspects/SWH_Aspects_Heroism.png";
import Villainy from "../assets/aspects/SWH_Aspects_Villainy.png";

const ASPECT_IMAGES: Record<string, string> = {
  Command,
  Aggression,
  Cunning,
  Vigilance,
  Heroism,
  Villainy,
};

import "./AspectIcon.css";

interface Props {
  aspect: string;
  size?: number;
  /** Owner dev review 2026-07-26 (round 4): opt-in design-aligned hover
   * tooltip with the aspect name (Cards table + CardPopup) -- replaces the
   * native title bubble at those call sites. Callers that don't opt in
   * (FilterPanel's aspect picker) keep the native title unchanged. */
  tooltip?: boolean;
}

export function AspectIcon({ aspect, size = 24, tooltip = false }: Props) {
  const src = ASPECT_IMAGES[aspect];
  if (!src) return null;

  const img = (
    <img
      src={src}
      alt={aspect}
      title={tooltip ? undefined : aspect}
      width={size}
      height={size}
      style={{ display: "inline-block", verticalAlign: "middle" }}
    />
  );

  if (!tooltip) return img;

  return (
    <span className="aspect-tip">
      {img}
      {/* Two layers, dossier-style (round 5): the outer bubble is the steel
          ring + shadow, the inner carries the tile fill and the text. */}
      <span className="aspect-tip__bubble" role="tooltip">
        <span className="aspect-tip__bubble-inner">{aspect}</span>
      </span>
    </span>
  );
}
