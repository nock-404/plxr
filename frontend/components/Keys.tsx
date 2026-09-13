"use client";

import { Fragment, useEffect, useState } from "react";
import Window from "@/components/ui/Window";
import { tr } from "@/lib/i18n";
import { ACTIONS, KEYMAP_CHANGED, bindingOf, caption, type Action } from "@/lib/keymap";

/* A shortcut nobody can find is none — so they are written down.
 *
 * Read from the keymap, not written here by hand: this list used to be its
 * own copy and named ⌘1…5 for a handler that did not exist. Now the rows are
 * the actions the handlers actually check, with whatever key each is bound to
 * at the moment, and a key rebound in the settings shows here at once.
 *
 * In a window of its own. It was a card on a backdrop as tall as its rows —
 * 1275 px on a 900 px screen, the region toggles below the bottom edge and
 * nothing that scrolled them into view — with no title bar to close it by or
 * move it with. ui/Window gives it the frame every plxr window has; fit sizes
 * it to its rows, stops at the screen, and the body scrolls the rest.
 *
 * Grouped the way the header MENU groups its rows. A group names actions by
 * id; an action no group names is listed at the end, so a key added to the
 * table shows here before anybody has decided where it belongs. */
type Entry = Action | "escape";

const GROUPS: { key: string; fallback: string; entries: Entry[] }[] = [
  {
    key: "keys.groupPanels",
    fallback: "Panels and windows",
    entries: ["newSession", "newShell", "closePanel", "reopenPanel", "escape", "toggleLeft", "toggleRight", "toggleBottom", "settings"],
  },
  {
    key: "keys.groupNavigation",
    fallback: "Navigation",
    entries: ["palette", "sessionSwitch", "view1", "view2", "view3", "view4", "view5", "view6", "view7", "view8", "view9", "panelPrev", "panelNext", "groupPrev", "groupNext", "historyBack", "historyForward"],
  },
  { key: "keys.groupWork", fallback: "Terminal and editor", entries: ["find", "filesUp"] },
  { key: "keys.groupOther", fallback: "Other", entries: ["workbench", "workshop", "help"] },
];

type Row = { id: string; cap: string; text: string };

function rowOf(entry: Entry): Row | null {
  if (entry === "escape") return { id: entry, cap: "Esc", text: tr("keys.back", "Close the dialog, leave the session") };
  const action = ACTIONS.find((a) => a.id === entry);
  return action ? { id: action.id, cap: caption(bindingOf(action.id)), text: tr(action.key, action.fallback) } : null;
}

export default function Keys({ onClose }: { onClose: () => void }) {
  const [, bump] = useState(0);
  useEffect(() => {
    const again = () => bump((n) => n + 1);
    window.addEventListener(KEYMAP_CHANGED, again);
    return () => window.removeEventListener(KEYMAP_CHANGED, again);
  }, []);

  const placed = new Set<string>(GROUPS.flatMap((g) => g.entries));
  const unplaced = ACTIONS.filter((a) => !placed.has(a.id)).map((a) => a.id);
  const sections = GROUPS.map((g, i) => ({
    key: g.key,
    heading: tr(g.key, g.fallback),
    rows: [...g.entries, ...(i === GROUPS.length - 1 ? unplaced : [])].map(rowOf).filter((r): r is Row => r !== null),
  }));

  return (
    <Window id="keys" heading={tr("keys.title", "keyboard")} onClose={onClose} fit>
      <div className="keysList">
        {sections.map((s) => (
          <Fragment key={s.key}>
            <div className="keysGroup" role="heading" aria-level={3}>
              {s.heading}
            </div>
            {s.rows.map((r) => (
              <div key={r.id} className="keysRow" data-action={r.id}>
                <span className="keyCap">{r.cap}</span>
                <span className="keysText">{r.text}</span>
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </Window>
  );
}
