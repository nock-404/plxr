"use client";

/* Which sessions have rung their bell and not been looked at since.
 *
 * A terminal's BEL is a program asking for attention. In the panel in front
 * it is a flash of the frame; in a panel behind others the flash is unseen,
 * so the mark stays on the panel's tab until that panel comes to the front.
 * One small registry, announced on a window event, so the terminal that
 * rang and the tab that shows it need not know each other. */
export const BELL_CHANGED = "plxr:bell";

const rung = new Set<string>();

function announce(): void {
  try {
    window.dispatchEvent(new CustomEvent(BELL_CHANGED));
  } catch {
    /* no window yet — nothing is drawn, so nothing needs telling */
  }
}

export function ringBell(id: string): void {
  if (rung.has(id)) return;
  rung.add(id);
  announce();
}

export function clearBell(id: string): void {
  if (!rung.delete(id)) return;
  announce();
}

export function hasBell(id: string): boolean {
  return rung.has(id);
}
