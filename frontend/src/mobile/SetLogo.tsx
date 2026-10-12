import { SET_LOGO_BOX, setLogoLayout, setLogoUrl } from "./setLogoArt";
import type { SetLogoBoxName } from "./setLogoArt";

// BL-257 FR3-01: a set logo in a fixed logo box, its opaque artwork centred
// and sized by the equal-area rule (setLogoArt.ts). The box clips the PNG's
// transparent padding; the artwork itself never leaves the box. Decorative:
// the row that carries it names the set. A code without a measured entry
// falls back to the whole PNG fitted and centred.
export function SetLogo({
  code,
  box,
  className,
  imgClassName,
}: {
  code: string;
  box: SetLogoBoxName;
  className?: string;
  imgClassName?: string;
}) {
  const { w, h } = SET_LOGO_BOX[box];
  const lay = setLogoLayout(code, w, h);
  return (
    <span
      className={"m-setlogo" + (className ? " " + className : "")}
      style={{ width: w, height: h }}
      data-logo={code}
      aria-hidden="true"
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
