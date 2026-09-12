"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { tr } from "@/lib/i18n";
import { ACTIONS, KEYMAP_CHANGED, bindingOf, caption } from "@/lib/keymap";

/* A shortcut nobody can find is none — so they are written down.
 *
 * Read from the keymap, not written here by hand: this list used to be its
 * own copy and named ⌘1…5 for a handler that did not exist. Now the rows are
 * the actions the handlers actually check, with whatever key each is bound to
 * at the moment, and a key rebound in the settings shows here at once. */
export default function Keys({ onClose }: { onClose: () => void }) {
  const [, bump] = useState(0);
  useEffect(() => {
    const again = () => bump((n) => n + 1);
    window.addEventListener(KEYMAP_CHANGED, again);
    return () => window.removeEventListener(KEYMAP_CHANGED, again);
  }, []);

  const rows: { cap: string; text: string }[] = [
    ...ACTIONS.map((a) => ({ cap: caption(bindingOf(a.id)), text: tr(a.key, a.fallback) })),
    { cap: "Esc", text: tr("keys.back", "Close the dialog, leave the session") },
  ];

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <b className="cardTitle">{tr("keys.title", "keyboard")}</b>
        <div className="ruleslist">
          {rows.map((k) => (
            <div key={k.cap + k.text} className="rrow">
              <span className="keyCell">
                <span className="keyCap">{k.cap}</span>
              </span>
              <span className="rmain">
                <span className="rtitle">{k.text}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="cardButtons">
          <Button primary onClick={onClose}>
            {tr("common.close", "CLOSE")}
          </Button>
        </div>
      </div>
    </div>
  );
}
