"use client";

import { useState } from "react";
import Select from "@/components/ui/Select";
import Toggle from "@/components/ui/Toggle";
import { tr } from "@/lib/i18n";
import { editorPrefs, setEditorPrefs, type EditorPrefs } from "@/lib/prefs";

/* The editor's own page: which keys it answers to, whether long lines wrap,
   and how wide a tab is. Every open editor takes a change at once — the
   settings travel over THEME_CHANGED into a compartment of their own, so the
   undo history is untouched. */
export default function EditorSettings() {
  const [prefs, setPrefs] = useState<EditorPrefs>(editorPrefs);
  const keep = (patch: Partial<EditorPrefs>) => setPrefs(setEditorPrefs(patch));

  return (
    <div className="tabbody">
      <div className="field">
        <span className="fieldName">{tr("settings.editorKeymap", "keymap")}</span>
        <span className="rowInline">
          <Select
            value={prefs.keymap}
            options={[
              { value: "default", label: tr("settings.keymapDefault", "DEFAULT") },
              { value: "standard", label: tr("settings.keymapStandard", "STANDARD") },
              { value: "emacs", label: tr("settings.keymapEmacs", "EMACS") },
            ]}
            onChange={(keymap) => keep({ keymap })}
          />
          <span className="notice">
            {tr("settings.keymapHint", "Default is the full set, standard leaves out the bindings on the ⌥ key, emacs moves with Ctrl.")}
          </span>
        </span>
      </div>

      <div className="field">
        <span className="fieldName">{tr("settings.wrap", "long lines")}</span>
        <span className="rowInline">
          <Toggle on={prefs.wrap} onChange={(wrap) => keep({ wrap })}>
            {prefs.wrap ? tr("settings.wrapOn", "WRAP") : tr("settings.wrapOff", "SCROLL")}
          </Toggle>
          <span className="notice">{tr("settings.wrapHint", "Wrapped, a long line folds onto the next; otherwise the editor scrolls sideways.")}</span>
        </span>
      </div>

      <div className="field">
        <span className="fieldName">{tr("settings.tabSize", "tab width")}</span>
        <span className="rowInline">
          <Select
            value={String(prefs.tabSize)}
            options={[
              { value: "2", label: "2" },
              { value: "4", label: "4" },
              { value: "8", label: "8" },
            ]}
            onChange={(v) => keep({ tabSize: v === "8" ? 8 : v === "4" ? 4 : 2 })}
          />
          <span className="notice">{tr("settings.tabSizeHint", "How many columns a tab character takes up.")}</span>
        </span>
      </div>
    </div>
  );
}
