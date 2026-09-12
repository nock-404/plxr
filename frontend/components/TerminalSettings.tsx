"use client";

import { useState } from "react";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Slider from "@/components/ui/Slider";
import Toggle from "@/components/ui/Toggle";
import { tr } from "@/lib/i18n";
import { setTerminalPrefs, terminalPrefs, type TerminalPrefs } from "@/lib/prefs";
import type { ThemeState } from "@/lib/theme";
import type { UserFont } from "@/lib/types";

/* The terminal's own page: its typeface and size — the same two the look
   already carries — and what only the terminal has: how much scrollback it
   keeps, and what its cursor looks like. Every change reaches the running
   terminal at once through THEME_CHANGED; nothing here needs a reopen. */
export default function TerminalSettings({
  state,
  change,
  fonts,
}: {
  state: ThemeState;
  change: (patch: Partial<ThemeState>) => void;
  fonts: UserFont[];
}) {
  const [prefs, setPrefs] = useState<TerminalPrefs>(terminalPrefs);
  const [scrollbackText, setScrollbackText] = useState(String(prefs.scrollback));

  const keep = (patch: Partial<TerminalPrefs>): TerminalPrefs => {
    const next = setTerminalPrefs(patch);
    setPrefs(next);
    return next;
  };

  return (
    <div className="tabbody">
      <div className="field">
        <span className="fieldName">{tr("settings.termFont", "terminal font")}</span>
        <span className="rowInline">
          <Select
            value={state.termFont}
            options={[
              { value: "", label: tr("settings.fontDefault", "skin default") },
              { value: "IBM Plex Mono", label: "IBM Plex Mono" },
              ...fonts.map((f) => ({ value: f.family, label: f.family })),
            ]}
            onChange={(termFont) => change({ termFont })}
            tip={tr("settings.termFontTip", "The font of the terminal — pick a monospace one, or its columns will not line up")}
          />
          <span className="notice">{tr("settings.termFontHint", "Fonts are brought in under skins & palette.")}</span>
        </span>
      </div>

      <div className="field">
        <span className="fieldName">{tr("style.fontTerm", "terminal font size")}</span>
        <span className="rowInline">
          <Slider value={state.termSize} min={0.625} max={1.125} step={0.0625} onChange={(termSize) => change({ termSize })} />
          <span className="styleNumber">{state.termSize.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}</span>
        </span>
      </div>

      <div className="field">
        <span className="fieldName">{tr("settings.scrollback", "scrollback")}</span>
        <span className="rowInline">
          <Input
            className="short"
            inputMode="numeric"
            value={scrollbackText}
            onChange={(e) => setScrollbackText(e.target.value)}
            onBlur={() => {
              const n = parseInt(scrollbackText, 10);
              const next = Number.isFinite(n) ? keep({ scrollback: n }) : prefs;
              setScrollbackText(String(next.scrollback));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
            }}
          />
          <span className="notice">
            {tr("settings.scrollbackHint", "Lines kept above the screen. More costs memory per open terminal; 10000 is the default.")}
          </span>
        </span>
      </div>

      <div className="field">
        <span className="fieldName">{tr("settings.cursor", "cursor")}</span>
        <span className="rowInline">
          <Select
            value={prefs.cursorStyle}
            options={[
              { value: "block", label: tr("settings.cursorBlock", "BLOCK") },
              { value: "underline", label: tr("settings.cursorUnderline", "UNDERLINE") },
              { value: "bar", label: tr("settings.cursorBar", "BAR") },
            ]}
            onChange={(cursorStyle) => keep({ cursorStyle })}
          />
          <Toggle on={prefs.cursorBlink} onChange={(cursorBlink) => keep({ cursorBlink })}>
            {tr("settings.cursorBlink", "blinking")}
          </Toggle>
        </span>
      </div>
    </div>
  );
}
