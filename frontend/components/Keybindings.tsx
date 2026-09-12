"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Tooltip from "@/components/ui/Tooltip";
import { tr } from "@/lib/i18n";
import { ACTIONS, KEYMAP_CHANGED, bindingOf, boundTo, caption, chordOf, keymapOverrides, type Action } from "@/lib/keymap";
import { saveKeymap } from "@/lib/prefs";

/* Rebinding the keys.
 *
 * One row per action, the key it answers to now, and REBIND: the next key
 * pressed becomes the binding — Esc gives up. A key already taken is taken
 * from the other action and said so, rather than silently firing two things.
 * The list under "?" reads the same table, so it shows the change at once. */
export default function Keybindings() {
  const [, bump] = useState(0);
  const [capturing, setCapturing] = useState<Action | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    const again = () => bump((n) => n + 1);
    window.addEventListener(KEYMAP_CHANGED, again);
    return () => window.removeEventListener(KEYMAP_CHANGED, again);
  }, []);

  // While a row waits for its key, every keydown in the window is that key.
  useEffect(() => {
    if (!capturing) return;
    const take = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const chord = chordOf(e);
      if (chord === null) return; // a bare modifier: keep waiting
      if (chord === "Escape") {
        setCapturing(null);
        return;
      }
      const taken = boundTo(chord);
      const next = { ...keymapOverrides() };
      const shipped = ACTIONS.find((a) => a.id === capturing)?.chord;
      if (chord === shipped) delete next[capturing];
      else next[capturing] = chord;
      if (taken && taken !== capturing) {
        // The other row loses its key; an unbound row is written as "" so it
        // stays unbound rather than falling back to its shipped chord.
        next[taken] = "";
        const who = ACTIONS.find((a) => a.id === taken);
        setNote(tr("keys.tookFrom", "{key} was {action} — that row is unbound now", { key: caption(chord), action: who ? tr(who.key, who.fallback) : taken }));
      } else {
        setNote("");
      }
      saveKeymap(next);
      setCapturing(null);
    };
    window.addEventListener("keydown", take, true);
    return () => window.removeEventListener("keydown", take, true);
  }, [capturing]);

  const resetOne = (action: Action) => {
    const next = { ...keymapOverrides() };
    delete next[action];
    saveKeymap(next);
    setNote("");
  };

  const overrides = keymapOverrides();
  const changed = Object.keys(overrides).length > 0;

  return (
    <div className="tabbody">
      <div className="field">
        <span className="fieldName">{tr("settings.keys", "keyboard shortcuts")}</span>
        <span className="notice">
          {tr("settings.keysHint", "REBIND, then press the key you want. Esc keeps the old one. A key already in use moves to the row it was pressed for.")}
        </span>
        <div className="ruleslist">
          {ACTIONS.map((a) => {
            const chord = bindingOf(a.id);
            const waiting = capturing === a.id;
            return (
              <div key={a.id} className="rrow keyRow" data-waiting={waiting ? "yes" : "no"}>
                <span className="keyCell">
                  <span className="keyCap">{waiting ? tr("keys.pressNow", "press a key…") : caption(chord)}</span>
                </span>
                <span className="rmain">
                  <span className="rtitle">{tr(a.key, a.fallback)}</span>
                </span>
                <span className="keyActions">
                  <Button tiny on={waiting} data-do="rebind" onClick={() => setCapturing(waiting ? null : a.id)}>
                    {waiting ? tr("common.cancel", "CANCEL") : tr("keys.rebind", "REBIND")}
                  </Button>
                  {a.id in overrides ? (
                    <Tooltip text={tr("keys.resetOneTip", "Back to {key}", { key: caption(a.chord) })}>
                      <Button tiny data-do="reset-key" onClick={() => resetOne(a.id)}>
                        {tr("settings.reset", "RESET")}
                      </Button>
                    </Tooltip>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
        <span className="rowInline">
          {note ? <span className="notice warn">{note}</span> : null}
          <span className="spacer" />
          <Button
            disabled={!changed}
            onClick={() => {
              saveKeymap({});
              setNote("");
            }}
          >
            {tr("keys.resetAll", "RESET ALL")}
          </Button>
        </span>
      </div>
    </div>
  );
}
