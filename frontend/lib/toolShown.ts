"use client";

import { createContext, useContext } from "react";

/* Whether the tool a body belongs to is on screen.
 *
 * A tool window that is put away — its edge hidden, or another tool in front
 * of it on the same edge — keeps its panel, and the tree and the notes keep
 * their body mounted as well, so what they had open is there when they come
 * back. A body that asks the service on a beat has to know it is not being
 * looked at, or the tree goes on reading git every four seconds for a window
 * nobody can see. ToolWindow says so here. Anything rendered outside a tool
 * window — the tree in the folders view — is on screen as far as this goes. */
export const ToolShown = createContext(true);

export function useToolShown(): boolean {
  return useContext(ToolShown);
}

/* Where a tool's own actions go: the slot in its window's header, beside the
   ⋮ and the —. Undefined outside a tool window, null for the moment before
   the header is on the page (components/stripes/ToolActions). */
export const ToolActionSlot = createContext<HTMLElement | null | undefined>(undefined);
