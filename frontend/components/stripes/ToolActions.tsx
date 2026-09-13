"use client";

import { useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ToolActionSlot } from "@/lib/toolShown";

/* A tool's own actions, in its window's header.
 *
 * What acts on the whole tool — read the tree again, ask for the ports again,
 * read the usage again — stood in a strip inside the body behind a prompt,
 * or only in a right-click menu, while the header above it carried nothing but
 * the tool's name. The header is where a tool window keeps them, the way every
 * editor draws one: the tool writes its actions where it writes everything
 * else, and they are drawn into the header's slot. Fields and their modes stay
 * in the tool's own bar under it; the header has no room for a field.
 *
 * Outside a tool window they are not drawn: the tree in the folders view has
 * the same verbs in its own menus. */
export default function ToolActions({ children }: { children: ReactNode }) {
  const slot = useContext(ToolActionSlot);
  return slot ? createPortal(children, slot) : null;
}
