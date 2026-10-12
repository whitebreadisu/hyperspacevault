import { SET_LOGO_BOX, setLogoLayout, setLogoUrl } from "./setLogoArt";
import type { SetLogoAlign, SetLogoBoxName } from "./setLogoArt";

// BL-257 FR3-01: a set logo in a fixed logo box, its opaque artwork centred
// and sized by the equal-area rule (setLogoArt.ts). The box clips the PNG's
// transparent padding; the artwork itself never leaves the box. Every phone
// surface that draws a set logo renders this (SET_LOGO_BOX names them).
// Decorative by default: the row or button that carries it names the set.
// `label` makes it a named image instead (the card-detail header, where the
// logo stands alone). `align` "right" holds the artwork to the box's right
// edge (a logo anchored to a screen margin). A code without a measured entry
// falls back to the whole PNG fitted and centred.
export function SetLogo({
  code,
  box,
  align = "center",
  label,
  className,
  imgClassName,
}: {
  code: string;
  box: SetLogoBoxName;
  align?: SetLogoAlign;
  label?: string;
  className?: string;
  imgClassName?: string;
}) {
  const { w, h } = SET_LOGO_BOX[box];
  const lay = setLogoLayout(code, w, h, align);
  return (
    <span
      className={"m-setlogo" + (className ? " " + className : "")}
      style={{ width: w, height: h }}
      data-logo={code}
      data-logo-box={box}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <img
        className={
          (lay ? "m-setlogo__img" : "m-setlogo__img m-setlogo__img--fit") +
          (imgClassName ? " " + imgClassName : "")
        }
        src={setLogoUrl(code)}
        alt=""
        style={
          lay ? { width: lay.width, height: lay.height, left: lay.left, top: lay.top } : undefined
        }
      />
    </span>
  );
}
