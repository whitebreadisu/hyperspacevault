import logo2x from "../assets/brand/hsv-logo-initials@2x.webp";
import logo3x from "../assets/brand/hsv-logo-initials@3x.webp";

// The phone brand mark (App Spec §25.1): the initials logo, 30 px tall in an
// 80 px box, left-aligned. It sits in the brand stacks of the Vault header,
// More and the shared-vault status screen, above the
// `Unofficial Fan Project [v#.#.#]` tag line (header.css .m-vh__logo).
export function BrandLogo() {
  return (
    <img
      className="m-vh__logo"
      src={logo2x}
      srcSet={`${logo2x} 2x, ${logo3x} 3x`}
      alt="Hyperspace Vault"
      width={80}
      height={30}
    />
  );
}
