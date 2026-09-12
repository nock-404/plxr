"use client";

import { useEffect, useState } from "react";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Slider from "@/components/ui/Slider";
import Toggle from "@/components/ui/Toggle";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import { setTerminalPrefs, terminalPrefs, type TerminalPrefs, type TerminalWeight } from "@/lib/prefs";
import type { ThemeState } from "@/lib/theme";
import type { UserFont } from "@/lib/types";

// The weights xterm can be asked for, in the words a person picks them by.
const WEIGHTS: { value: TerminalWeight; key: string; fallback: string }[] = [
  { value: "300", key: "settings.weightLight", fallback: "light" },
  { value: "normal", key: "settings.weightNormal", fallback: "normal" },
  { value: "500", key: "settings.weightMedium", fallback: "medium" },
  { value: "600", key: "settings.weightSemibold", fallback: "semibold" },
  { value: "bold", key: "settings.weightBold", fallback: "bold" },
];

// A number as the slider's readout: no trailing zeros, no bare full stop.
const tidy = (n: number) => n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");

/* The terminal's own page: its typeface, size, weight and pitch — the first
   two the look already carries — and what only the terminal has: how much
   scrollback it keeps, what its cursor looks like, its colours' floor and
   its bell. Every change reaches the running terminal at once through
   THEME_CHANGED; nothing here needs a reopen. */
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
  // The sounds the notifications offer; the bell picks from the same list.
  const [sounds, setSounds] = useState<string[]>([]);

  useEffect(() => {
    api.notify().then((n) => setSounds(n.sounds ?? [])).catch(() => setSounds([]));
  }, []);

  const keep = (patch: Partial<TerminalPrefs>): TerminalPrefs => {
    const next = setTerminalPrefs(patch);
    setPrefs(next);
    return next;
  };

  const weightOptions = WEIGHTS.map((w) => ({ value: w.value, label: tr(w.key, w.fallback) }));

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
          <span className="styleNumber">{tidy(state.termSize)}</span>
        </span>
      </div>

      <div className="field">
        <span className="fieldName">{tr("settings.termWeight", "font weight")}</span>
        <span className="rowInline">
          <Select value={prefs.fontWeight} options={weightOptions} onChange={(fontWeight) => keep({ fontWeight })} />
          <span className="notice">{tr("settings.termWeightBold", "bold weight")}</span>
          <Select value={prefs.fontWeightBold} options={weightOptions} onChange={(fontWeightBold) => keep({ fontWeightBold })} />
        </span>
      </div>

      <div className="field">
        <span className="fieldName">{tr("settings.termLineHeight", "line height")}</span>
        <span className="rowInline">
          <Slider value={prefs.lineHeight} min={1} max={2} step={0.05} onChange={(lineHeight) => keep({ lineHeight })} />
          <span className="styleNumber">{tidy(prefs.lineHeight)}</span>
        </span>
      </div>

      <div className="field">
        <span className="fieldName">{tr("settings.termLetterSpacing", "letter spacing")}</span>
        <span className="rowInline">
          <Slider value={prefs.letterSpacing} min={0} max={0.25} step={0.0125} onChange={(letterSpacing) => keep({ letterSpacing })} />
          <span className="styleNumber">{tidy(prefs.letterSpacing)}</span>
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

      <div className="field">
        <span className="fieldName">{tr("settings.cursorInactive", "cursor when not focused")}</span>
        <span className="rowInline">
          <Select
            value={prefs.cursorInactive}
            options={[
              { value: "outline", label: tr("settings.cursorOutline", "OUTLINE") },
              { value: "block", label: tr("settings.cursorBlock", "BLOCK") },
              { value: "underline", label: tr("settings.cursorUnderline", "UNDERLINE") },
              { value: "bar", label: tr("settings.cursorBar", "BAR") },
              { value: "none", label: tr("settings.cursorNone", "NONE") },
            ]}
            onChange={(cursorInactive) => keep({ cursorInactive })}
          />
        </span>
      </div>

      <div className="field">
        <span className="fieldName">{tr("settings.termContrast", "minimum contrast")}</span>
        <span className="rowInline">
          <Select
            value={String(prefs.minContrast)}
            options={[
              { value: "1", label: tr("settings.termContrastOff", "off") },
              { value: "3", label: "3 : 1" },
              { value: "4.5", label: "4.5 : 1" },
              { value: "7", label: "7 : 1" },
            ]}
            onChange={(v) => keep({ minContrast: parseFloat(v) })}
          />
          <Toggle on={prefs.boldBright} onChange={(boldBright) => keep({ boldBright })}>
            {tr("settings.termBoldBright", "bold text in the bright colours")}
          </Toggle>
        </span>
        <span className="notice">
          {tr("settings.termContrastHint", "Text is brightened until it reads against the background; off leaves the palette as the skin set it.")}
        </span>
      </div>

      <div className="field">
        <span className="fieldName">{tr("settings.termBell", "bell")}</span>
        <span className="rowInline">
          <Select
            value={prefs.bellSound}
            options={[{ value: "", label: tr("notify.silent", "silent") }, ...sounds.map((s) => ({ value: s, label: s }))]}
            onChange={(bellSound) => keep({ bellSound })}
          />
          <span className="notice">{tr("settings.termBellHint", "The frame flashes and the tab is marked either way; a sound is optional.")}</span>
        </span>
      </div>
    </div>
  );
}
