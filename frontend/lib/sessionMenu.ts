"use client";

import type { MenuItem } from "@/components/ui/Menu";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import type { Tile } from "@/lib/types";

/* What one session offers under the right button, wherever it is met.
 *
 * The board's tile, the rail's row, a row of the session switcher and the
 * switcher itself all offer the same verbs. The list was written out twice —
 * once on the tile, once on the rail — and the two copies had already drifted
 * apart on what an ended session offers. It is written once now.
 *
 * Open it. While it runs: pause or resume it, and terminate it. Once it has
 * ended: start it again under the same id, or take it off the board. And copy
 * its folder either way. The board starts an ended session its own way — and
 * brings it to the front afterwards — so those two verbs can be handed in.
 */
export function sessionMenu(
  t: Tile,
  open: (id: string) => void,
  own: { restart?: () => void; forget?: () => void } = {},
): MenuItem[] {
  const restart = own.restart ?? (() => void api.resume(t.id).catch(() => undefined));
  const forget = own.forget ?? (() => void api.forget(t.id).catch(() => undefined));
  const running: MenuItem[] = [
    t.frozen
      ? { label: tr("tile.menuUnfreeze", "Resume"), onClick: () => void api.unfreeze(t.id).catch(() => undefined) }
      : { label: tr("tile.menuFreeze", "Pause"), onClick: () => void api.freeze(t.id).catch(() => undefined) },
    { separator: true },
    { label: tr("tile.menuTerminate", "Terminate"), danger: true, onClick: () => void api.kill(t.id).catch(() => undefined) },
  ];
  const ended: MenuItem[] = [
    { label: tr("tile.menuRestart", "Restart"), onClick: restart },
    { separator: true },
    { label: tr("tile.menuForget", "Remove from the board"), onClick: forget },
  ];
  return [
    { label: tr("tile.menuOpen", "Open"), onClick: () => open(t.id) },
    ...(t.alive ? running : ended),
    { separator: true },
    { label: tr("files.copy", "COPY PATH"), onClick: () => void navigator.clipboard?.writeText(t.cwd).catch(() => undefined) },
  ];
}
