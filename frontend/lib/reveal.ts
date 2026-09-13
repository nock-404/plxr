"use client";

/* A place in the project, asked to be shown in the Files tool.
 *
 * The status bar's breadcrumb names the folders a file lives in, and a click
 * on one has to unfold the tree down to it. The tree may not be on screen yet
 * when that is asked — the tool is shown by the same click — and it may still
 * be following another project for a render. So the request is kept here until
 * a tree of that root takes it, rather than fired as an event nobody hears.
 */
export type RevealRequest = {
  // The folder the path is relative to: the root the tree has to stand on.
  root: string;
  // The folder or file to show, relative to the root, "/" between the steps.
  rel: string;
  seq: number;
};

export const REVEAL_ASKED = "plxr:reveal-in-files";

let asked: RevealRequest | null = null;

// askReveal asks the Files tool to unfold down to rel under root and select it.
export function askReveal(root: string, rel: string): void {
  asked = { root, rel: rel.split(/[\\/]/).filter(Boolean).join("/"), seq: (asked?.seq ?? 0) + 1 };
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(REVEAL_ASKED));
}

// revealAsked is the request standing now, or null.
export function revealAsked(): RevealRequest | null {
  return asked;
}

// revealTaken marks a request as handled, so a tree made later does not act on it again.
export function revealTaken(seq: number): void {
  if (asked && asked.seq === seq) asked = null;
}
