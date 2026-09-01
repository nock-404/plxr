// plxr — a control room, four sessions.
//
// Frame, hub, four spokes on the diagonals, four solid corner triangles. The
// points are calculated, not eyeballed: radius times 0.7071 for the 45 degrees,
// hence the odd numbers. Exactly symmetric four ways.
//
// currentColor throughout — every skin tints it itself, and the same shape
// serves the header as well as the docs.
//
// Butt caps on purpose: round caps take the hard phosphor edge off the mark,
// and at 16 pixels they close up into dots anyway.
export default function Logo() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="2.8" y="2.8" width="26.4" height="26.4" rx="6.6" stroke="currentColor" strokeWidth="2.5" />

      {/* Hub. Solid rather than a ring: a hole of 0.6 units would be smaller
          than a pixel at 16 and would fill in regardless. */}
      <circle cx="16" cy="16" r="1.8" fill="currentColor" />

      {/* Spokes: from the hub's edge (r=1.8) out to r=6.6, so 16 ± 1.273 to
          16 ± 4.667. They stop well short of the triangles. */}
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="butt">
        <path d="M14.727 14.727 L11.333 11.333" />
        <path d="M17.273 14.727 L20.667 11.333" />
        <path d="M14.727 17.273 L11.333 20.667" />
        <path d="M17.273 17.273 L20.667 20.667" />
      </g>

      {/* Corner triangles: right angle in the corner, hypotenuse facing the
          middle. Legs of 6.2 units, inset 6.4 from the edge. */}
      <g fill="currentColor" stroke="none">
        <path d="M6.4 6.4 L12.6 6.4 L6.4 12.6 Z" />
        <path d="M25.6 6.4 L19.4 6.4 L25.6 12.6 Z" />
        <path d="M6.4 25.6 L12.6 25.6 L6.4 19.4 Z" />
        <path d="M25.6 25.6 L19.4 25.6 L25.6 19.4 Z" />
      </g>
    </svg>
  );
}
