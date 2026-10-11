import { SectionSeparator } from "../components/SectionSeparator";
import { MOBILE_CAMERA_ENABLED } from "./flags";
import { MIcon } from "./icons";
import type { IconName } from "./icons";
import { MSWUButton } from "./MSWUButton";
import { go } from "./router";
import type { Route } from "./router";

// BL-247 S1-04: the bottom bar (rev4 MApp.jsx:70-102, `bar=one`): Vault tab,
// the centre SWUButton (keypad; the camera glyph and divider wait behind
// MOBILE_CAMERA_ENABLED, plan A8), More tab. The circuit separator straddles
// the bar's top edge. The More tab never carries the unread cue (R5-2).

function Tab({
  icon,
  label,
  on,
  onClick,
}: {
  icon: IconName;
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={"m-tab" + (on ? " m-tab--on" : "")}
      onClick={onClick}
      aria-current={on ? "page" : undefined}
    >
      <MIcon name={icon} size={24} />
      <span className="m-tab__label">{label}</span>
    </button>
  );
}

export function MobileNav({ route }: { route: Route }) {
  const a = route.segs[0];
  return (
    <nav className="m-nav" aria-label="Main">
      <SectionSeparator className="m-nav__sep" />
      <div className="m-nav__row">
        <Tab icon="vault" label="Vault" on={a === "vault"} onClick={() => go("#/vault")} />
        <div className="m-nav__center">
          {MOBILE_CAMERA_ENABLED ? (
            <MSWUButton
              size="md"
              onClick={() => go("#/pad")}
              ariaLabel="Keypad or camera: opens the mode you used last"
            >
              <span className="m-nav__tool m-nav__tool--on">
                <MIcon name="pad" size={20} />
              </span>
              <span className="m-nav__tooldiv" aria-hidden="true" />
              <span className="m-nav__tool">
                <MIcon name="camera" size={22} />
              </span>
            </MSWUButton>
          ) : (
            <MSWUButton size="md" onClick={() => go("#/pad")} ariaLabel="Keypad">
              <span className="m-nav__tool m-nav__tool--on">
                <MIcon name="pad" size={20} />
              </span>
            </MSWUButton>
          )}
        </div>
        <Tab icon="more" label="More" on={a === "more"} onClick={() => go("#/more")} />
      </div>
    </nav>
  );
}
