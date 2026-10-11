import type { CSSProperties, ReactElement } from "react";

// BL-247 S1-04: the phone glyph set (port of rev4 MPrimitives.jsx:216-259).
// 24 px grid, 1.6 stroke, mitred -- console, not rounded. Only the glyphs the
// built slices use are carried; later slices add theirs here.
const P: Record<string, ReactElement> = {
  vault: (
    <g>
      <path d="M5 7h14v12H5z" />
      <path d="M7.5 4.5h9" />
      <path d="M9 12.5h6" />
    </g>
  ),
  pad: (
    <g>
      <path d="M5 4.5h3v3H5zM10.5 4.5h3v3h-3zM16 4.5h3v3h-3zM5 10.5h3v3H5zM10.5 10.5h3v3h-3zM16 10.5h3v3h-3zM5 16.5h3v3H5zM10.5 16.5h3v3h-3zM16 16.5h3v3h-3z" />
    </g>
  ),
  more: (
    <g>
      <path d="M4.5 7h15M4.5 12h15M4.5 17h15" />
    </g>
  ),
  camera: (
    <g>
      <path d="M3.5 8h4l1.5-2.5h6L16.5 8h4v11h-17z" />
      <circle cx="12" cy="13" r="3.4" />
    </g>
  ),
  back: (
    <g>
      <path d="M14.5 5.5 8 12l6.5 6.5" />
    </g>
  ),
  fwd: (
    <g>
      <path d="M9.5 5.5 16 12l-6.5 6.5" />
    </g>
  ),
  close: (
    <g>
      <path d="M6 6l12 12M18 6 6 18" />
    </g>
  ),
  filter: (
    <g>
      <path d="M4 5.5h16l-6 7.5v5.5l-4 2v-7.5z" />
    </g>
  ),
  chevdown: (
    <g>
      <path d="m6 9.5 6 6 6-6" />
    </g>
  ),
  // S1-14 .. S1-18 (status rows, sort, view toggle, sheets).
  search: (
    <g>
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="m14.5 14.5 5 5" />
    </g>
  ),
  sort: (
    <g>
      <path d="M8 5v14M4.5 15.5 8 19l3.5-3.5M16 19V5M12.5 8.5 16 5l3.5 3.5" />
    </g>
  ),
  rows: (
    <g>
      <path d="M4 6h3M4 12h3M4 18h3M10 6h10M10 12h10M10 18h10" />
    </g>
  ),
  grid: (
    <g>
      <path d="M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z" />
    </g>
  ),
  check: (
    <g>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </g>
  ),
  // BL-248 S2-02: the leader flip (rev4 MPrimitives.jsx `flip`).
  flip: (
    <g>
      <path d="M5 12a7 7 0 0 1 12-4.9L19 9" />
      <path d="M19 4.5V9h-4.5" />
      <path d="M19 12a7 7 0 0 1-12 4.9L5 15" />
      <path d="M5 19.5V15h4.5" />
    </g>
  ),
  chevup: (
    <g>
      <path d="m6 14.5 6-6 6 6" />
    </g>
  ),
  // BL-249 S3-02: the keypad's delete-digit key (rev4 MPrimitives.jsx `bksp`).
  bksp: (
    <g>
      <path d="M9 5.5h11v13H9L3.5 12z" />
      <path d="m12 9.5 5 5M17 9.5l-5 5" />
    </g>
  ),
  sz0: (
    <g>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </g>
  ),
  sz1: (
    <g>
      <path d="M4 5.5h3v4H4zM4 14.5h3v4H4z" />
      <path d="M10 7.5h10M10 16.5h10" />
    </g>
  ),
  sz2: (
    <g>
      <path d="M4 4.5h5.5v7H4zM4 13h5.5v7H4z" />
      <path d="M12.5 8h8M12.5 16.5h8" />
    </g>
  ),
  sz3: (
    <g>
      <path d="M3.5 4h9v13h-9z" />
      <path d="M15.5 7h5M15.5 11h5M15.5 15h3.5" />
    </g>
  ),
  g1: (
    <g>
      <path d="M7 3.5h10v17H7z" />
    </g>
  ),
  g2: (
    <g>
      <path d="M3.5 5.5h7.5v13H3.5zM13 5.5h7.5v13H13z" />
    </g>
  ),
  g3: (
    <g>
      <path d="M2.5 7h5.2v10H2.5zM9.4 7h5.2v10H9.4zM16.3 7h5.2v10h-5.2z" />
    </g>
  ),
};

export type IconName = keyof typeof P;

export function MIcon({
  name,
  size = 22,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      className={"m-icon" + (className ? " " + className : "")}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="miter"
      strokeLinecap="square"
      aria-hidden="true"
      style={style}
    >
      {P[name]}
    </svg>
  );
}
