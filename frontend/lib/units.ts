"use client";

/* remToPx turns a rem length into the pixels the browser positions in — the
   one place a pixel is allowed, and it is computed, not written. Resolved
   against the root's font size, the same way the terminal and the dock resolve
   theirs. */
export function remToPx(rem: string | number): number {
  const root = typeof document === "undefined" ? 16 : parseFloat(getComputedStyle(document.documentElement).fontSize || "16");
  return parseFloat(String(rem)) * root;
}

// A named token from the root, as a rem string — "" when it is not set.
export function rootToken(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
