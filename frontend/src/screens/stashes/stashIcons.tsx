// The Stashes page's inline 24 px stroke icons (both layouts). The pencil
// and box are the card detail's (CardPopupStashes.tsx).
import type { ReactNode } from "react";

export { BoxIcon, PencilIcon } from "../cards/CardPopupStashes";

function Svg({
  size,
  width = 1.8,
  children,
}: {
  size: number;
  width?: number;
  children: ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function TrashIcon({ size = 14 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 11v5.5M14 11v5.5" />
    </Svg>
  );
}

export function CheckIcon({ size = 18, width = 2.4 }: { size?: number; width?: number }) {
  return (
    <Svg size={size} width={width}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  );
}

/** The phone row's resting Return button (never − / +). */
export function ReturnIcon({ size = 18 }: { size?: number }) {
  return (
    <Svg size={size} width={1.9}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-4" />
    </Svg>
  );
}

/** The share-link mark (the card window's copy-link glyph, CardPopupLink):
 * the stash Share buttons, the rail / list marks and the "Link on" lines. */
export function LinkIcon({ size = 13, width = 2.4 }: { size?: number; width?: number }) {
  return (
    <Svg size={size} width={width}>
      <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L11.6 6" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.6-1.6" />
    </Svg>
  );
}
