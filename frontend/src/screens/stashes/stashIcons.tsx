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
