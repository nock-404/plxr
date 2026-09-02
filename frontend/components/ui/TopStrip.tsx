"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/* The bar at the top of a view, lifted into the window frame.
 *
 * Every view but the overview begins with a strip of controls, and each one
 * used to sit inside its view — which put it beside the settings panel rather
 * than above it. The panel is a full-height column, so with it open the strip
 * lost 280px, its buttons did not fit, and through a see-through panel they
 * read as the settings lying on top of the toolbar.
 *
 * A view still writes its own strip; it just renders where the window says, and
 * that is above the row the panel is in. Nothing is duplicated and no view knows
 * about the settings.
 *
 * The target is rendered by the shell above this, so on the very first pass it
 * is not there yet. Waiting a render is deliberate: an empty strip for one
 * frame beats reaching for a node that does not exist.
 */
export default function TopStrip({ children }: { children: React.ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setSlot(document.getElementById("view-strip"));
  }, []);

  return slot ? createPortal(children, slot) : null;
}
