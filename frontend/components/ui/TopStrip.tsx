"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";

/* The bar at the top of a view.
 *
 * Every view but the overview begins with a strip of controls. Which side of
 * the window that strip belongs on depends on where the view is shown:
 *
 * In the classic shell a view fills the whole content area, and its strip used
 * to sit inside it — which put it beside the settings panel rather than above
 * it, losing 280px and reading as the settings lying on top of the toolbar. So
 * there it is lifted into the frame, above the row the panel is in.
 *
 * In the dock a view is one panel among several, so its strip has to live
 * inside that panel, not in a single strip the whole window shares. The dock
 * turns Inline on for its subtree and the strip renders in place.
 */
export const InlineStrip = createContext(false);

export default function TopStrip({ children }: { children: React.ReactNode }) {
  const inline = useContext(InlineStrip);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!inline) setSlot(document.getElementById("view-strip"));
  }, [inline]);

  if (inline) return <div className="viewstrip">{children}</div>;
  return slot ? createPortal(children, slot) : null;
}
