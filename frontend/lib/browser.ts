"use client";

/* Sending a page to the real browser from a menu row.
 *
 * The window sandbox blocks a script-driven window.open of a foreign origin;
 * a real anchor with target="_blank" is what gets through — see ui/LinkButton,
 * which is that anchor for a toolbar. A context-menu row has no anchor to be,
 * so it makes one for the moment of the click and lets it go again. The click
 * happens inside the user's own gesture, the same as on the button.
 */
export function openInBrowser(url: string): void {
  if (!url) return;
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noreferrer";
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* The clipboard, with the refusal swallowed: a menu row that copies has no
   place to report one, and the native window's clipboard is not Chrome's. */
export function copyText(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}
