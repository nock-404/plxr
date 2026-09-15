"use client";

import { useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ToolNoteSlot } from "@/lib/toolShown";

/* A tool's one line about itself, in its window's header beside its name.
 *
 * "9 listening" had a strip of its own under the header — a whole row of a
 * window that is never tall enough, for one short phrase. It reads the same
 * beside the name and costs nothing. Outside a tool window it is not drawn:
 * there the view has a bar of its own to say it in. */
export default function ToolNote({ children }: { children: ReactNode }) {
  const slot = useContext(ToolNoteSlot);
  return slot ? createPortal(children, slot) : null;
}
