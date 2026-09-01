"use client";

import Button from "@/components/ui/Button";
import { tr } from "@/lib/i18n";

// A shortcut nobody can find is none — so they are written down.
const KEYS: { cap: string; key: string; fallback: string }[] = [
  { cap: "⌘K", key: "keys.filter", fallback: "Jump to the path filter" },
  { cap: "⌘N", key: "keys.new", fallback: "New session" },
  { cap: "⌘1…5", key: "keys.views", fallback: "Overview, inbox, ports, usage, archive" },
  { cap: "⌘F", key: "keys.find", fallback: "Find in the terminal" },
  { cap: "F12", key: "keys.workbench", fallback: "Workbench — the console inside the window" },
  { cap: "⇧F12", key: "keys.workshop", fallback: "Workshop — write CSS against the running window" },
  { cap: "Esc", key: "keys.back", fallback: "Close the dialog, leave the session" },
  { cap: "?", key: "keys.help", fallback: "This list" },
];

export default function Keys({ onClose }: { onClose: () => void }) {
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <b className="cardTitle">{tr("keys.title", "keyboard")}</b>
        <div className="ruleslist">
          {KEYS.map((k) => (
            <div key={k.cap} className="rrow">
              <span className="keyCell">
                <span className="keyCap">{k.cap}</span>
              </span>
              <span className="rmain">
                <span className="rtitle">{tr(k.key, k.fallback)}</span>
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
