import { useEffect, useRef } from "react";
import { SectionSeparator } from "../../components/SectionSeparator";
import { publishNav } from "../card/navList";
import { MOBILE_CAMERA_ENABLED } from "../flags";
import { MIcon } from "../icons";
import { back, go } from "../router";
import { Pad } from "./Pad";
import { chooseSet, getToolState, setToolMode, setToolState, useToolState } from "./toolStore";
import { toolScreenViewed } from "./toolAnalytics";
import "./tool.css";

// BL-249 S3-01: the tool layer at #/pad (rev4 MTool.jsx). A layer over the
// current screen, like the card layer: the screen beneath stays mounted
// (the Vault keeps its state), the bottom bar is covered and inert. Header =
// title + sub, the mode toggle (only behind MOBILE_CAMERA_ENABLED, plan
// A8), X top-right. The X closes back to the screen the tool opened over;
// the close guard for a non-empty batch is stage 3c (S3-14). The keypad
// ignores the Vault's finish scope: nothing here reads it, and Card details
// opens the S2 card layer on the resolved printing with no scope (S3-06).

export interface ToolLayerProps {
  params: Record<string, string>;
  /** The card layer is over the tool (S3-06): the tool stays mounted, inert. */
  covered: boolean;
  onRequestSignIn: () => void;
  onClose?: () => void;
}

export function ToolLayer({ params, covered, onRequestSignIn, onClose }: ToolLayerProps) {
  const st = useToolState();

  // S3-07: screen_viewed {screen: "tool"} once per open.
  useEffect(() => {
    toolScreenViewed();
  }, []);

  // Review deep link (as rev4's #/pad?set=&num=, kept like the Vault's and
  // the detail's review params): lock a set and type a number.
  const pSet = params.set;
  const pNum = params.num;
  // Applied once per distinct link: the card layer over the tool (S3-06)
  // and its return must not re-type a number the user has since changed.
  const applied = useRef<string | null>(null);
  useEffect(() => {
    if (covered) return;
    const sig = (pSet ?? "") + "|" + (pNum ?? "");
    if (applied.current === sig) return;
    applied.current = sig;
    const t = getToolState();
    if (pSet && /^[A-Z0-9]{2,5}$/.test(pSet) && (t.setCode !== pSet || t.preconKey))
      chooseSet(pSet);
    if (pNum && /^\d{1,4}$/.test(pNum)) setToolState({ num: pNum.replace(/^0+(?=\d)/, "") });
  }, [pSet, pNum, covered]);

  const close = onClose ?? back;
  return (
    <div
      className="m-padlayer m-tool"
      role="dialog"
      aria-modal="true"
      aria-label="Keypad"
      inert={covered}
    >
      <header className="m-padlayer__head m-tool__head">
        <div className="m-tool__titles">
          <h1 className="m-padlayer__title">Keypad</h1>
          <span className="m-padlayer__sub">Look up or add by number</span>
        </div>
        {MOBILE_CAMERA_ENABLED ? (
          <span className="m-seg m-tool__mode" role="group" aria-label="Tool mode">
            <button
              type="button"
              className={"m-seg__btn" + (st.mode === "keypad" ? " m-seg__btn--on" : "")}
              aria-pressed={st.mode === "keypad"}
              onClick={() => setToolMode("keypad")}
              aria-label="Keypad mode"
            >
              <MIcon name="pad" size={20} />
            </button>
            <button
              type="button"
              className={"m-seg__btn" + (st.mode === "camera" ? " m-seg__btn--on" : "")}
              aria-pressed={st.mode === "camera"}
              onClick={() => {
                setToolMode("camera");
                go("#/camera", true);
              }}
              aria-label="Camera mode"
            >
              <MIcon name="camera" size={22} />
            </button>
          </span>
        ) : null}
        <button
          type="button"
          className="m-iconbtn m-tool__close"
          onClick={close}
          aria-label="Close keypad"
        >
          <MIcon name="close" />
        </button>
      </header>
      <SectionSeparator className="m-tool__sep" />
      <Pad
        onRequestSignIn={onRequestSignIn}
        onOpenCard={(card, variant) => {
          // S3-06: no scope, a one-card list; the batch is untouched.
          publishNav({ ids: [card.base_card_id], narrowed: false, scope: null });
          go("#/card/" + card.base_card_id + "?v=" + variant.variant_id);
        }}
        onOpenVerify={() => {
          /* S3-12 (stage 3c): the Verify cards sheet. */
        }}
      />
    </div>
  );
}
