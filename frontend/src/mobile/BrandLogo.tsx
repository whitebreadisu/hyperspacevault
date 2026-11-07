import logo2x from "../assets/brand/hsv-logo-initials@2x.webp";
import logo3x from "../assets/brand/hsv-logo-initials@3x.webp";

// The phone brand mark (App Spec §25.1): the initials logo. "stack" (default)
// is 30 px tall in an 80 px box, left-aligned, in the brand stacks of the
// Vault header, More and the shared-vault status screen, above the
// `Unofficial Fan Project [v#.#.#]` tag line (header.css .m-vh__logo).
// "badge" is the collapsed strip's 24 px mark (header.css .m-vh__badgelogo);
// "heading" is the title chooser's centred 30 px heading (shell.css
// .m-chooser__logo).
const SIZES = {
  stack: { cls: "m-vh__logo", w: 80, h: 30 },
  badge: { cls: "m-vh__badgelogo", w: 64, h: 24 },
  heading: { cls: "m-chooser__logo", w: 80, h: 30 },
} as const;

export function BrandLogo({ size = "stack" }: { size?: keyof typeof SIZES }) {
  const s = SIZES[size];
  return (
    <img
      className={s.cls}
      src={logo2x}
      srcSet={`${logo2x} 2x, ${logo3x} 3x`}
      alt="Hyperspace Vault"
      width={s.w}
      height={s.h}
    />
  );
}
