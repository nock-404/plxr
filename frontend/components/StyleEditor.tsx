"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Slider from "@/components/ui/Slider";
import Select from "@/components/ui/Select";
import Swatch from "@/components/ui/Swatch";
import Toggle from "@/components/ui/Toggle";
import { tr } from "@/lib/i18n";
import { COLOUR_KEYS, currentColour, type ThemeState } from "@/lib/theme";

// Every colour a palette is made of, and the four switches that decide what the
// window looks through.
//
// The roles are named for what they do on screen, not for the token they set:
// "needs you" rather than `--blocked`. Somebody adjusting a colour is looking at
// the interface, not at the stylesheet.
const ROLES: { key: (typeof COLOUR_KEYS)[number]; text: string; english: string }[] = [
  { key: "bg", text: "style.bg", english: "background" },
  { key: "panel", text: "style.panel", english: "surfaces" },
  { key: "fg", text: "style.fg", english: "text" },
  { key: "dim", text: "style.dim", english: "secondary" },
  { key: "accent", text: "style.accent", english: "accent" },
  { key: "onAccent", text: "style.onAccent", english: "text on the accent" },
  { key: "line", text: "style.line", english: "lines" },
  { key: "working", text: "style.working", english: "working" },
  { key: "waiting", text: "style.waiting", english: "waiting" },
  { key: "blocked", text: "style.blocked", english: "needs you" },
  { key: "dead", text: "style.dead", english: "ended" },
  { key: "term-bg", text: "style.termBg", english: "terminal background" },
  { key: "term-fg", text: "style.termFg", english: "terminal text" },
];

export default function StyleEditor({
  state,
  change,
  reset,
}: {
  state: ThemeState;
  change: (patch: Partial<ThemeState>) => void;
  reset: () => void;
}) {
  // Read out of the running window rather than out of the state: a colour that
  // was never touched has no entry there, and an empty field is not an answer.
  const [shown, setShown] = useState<Record<string, string>>({});
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const r of ROLES) next[r.key] = state.colours?.[r.key] ?? currentColour(r.key);
    setShown(next);
  }, [state.palette, state.skin, state.colours, state.hue, state.brightness, state.saturation]);

  const setColour = (key: string, hex: string) =>
    change({ colours: { ...(state.colours ?? {}), [key]: hex } });

  return (
    <div className="tabbody">
      <div className="field">
        <span className="fieldName">{tr("settings.window", "the window")}</span>
        <div className="choice">
          <Toggle
            on={state.seethrough}
            onChange={(seethrough) => change({ seethrough })}
            title={tr("style.seethroughTip", "Frosted glass: what is behind the window shows through, blurred")}
          >
            {tr("style.seethrough", "see-through window")}
          </Toggle>
          <Toggle on={state.gradient} onChange={(gradient) => change({ gradient })}>
            {tr("style.gradient", "gradient in the background")}
          </Toggle>
          <Toggle on={state.glowOn} onChange={(glowOn) => change({ glowOn })}>
            {tr("style.glow", "glow")}
          </Toggle>
          <Toggle on={state.scanOn} onChange={(scanOn) => change({ scanOn })}>
            {tr("style.scanlines", "scan lines")}
          </Toggle>
          <Toggle
            on={state.flickerOn}
            onChange={(flickerOn) => change({ flickerOn })}
            title={tr("style.flickerWhy", "The tube's own unsteadiness. Off by default: on a dark screen it reads as a strobe, not as a tube.")}
          >
            {tr("style.flicker", "flicker")}
          </Toggle>
        </div>
      </div>

      <div className="field">
        <span className="fieldName">{tr("style.backdrop", "what is behind the window")}</span>
        <Select
          value={state.backdrop}
          onChange={(backdrop: ThemeState["backdrop"]) => change({ backdrop })}
          options={[
            { value: "frosted", label: tr("style.backdropFrosted", "FROSTED") },
            { value: "glass", label: tr("style.backdropGlass", "LIQUID GLASS") },
            { value: "clear", label: tr("style.backdropClear", "CLEAR") },
          ]}
        />
        <span className="notice">
          {tr("style.backdropWhy", "macOS draws this, not the page — so it is a choice of three, not a dial. The window picks it up straight away.")}
        </span>
      </div>

      {state.seethrough ? (
        <>
          <div className="field">
            <span className="fieldName">{tr("style.tint", "how much colour is in the glass")}</span>
            <span className="rowInline">
              <Slider value={state.tint} min={0} max={100} step={1} onChange={(tint) => change({ tint })} />
              <span className="styleNumber">{state.tint}</span>
            </span>
          </div>
          <div className="field">
            <span className="fieldName">{tr("style.windowSolid", "how solid the window is")}</span>
            <span className="rowInline">
              <Slider
                value={state.windowSolid}
                min={0}
                max={100}
                step={1}
                onChange={(windowSolid) => change({ windowSolid })}
              />
              <span className="styleNumber">{state.windowSolid}%</span>
            </span>
          </div>
          <div className="field">
            <span className="fieldName">{tr("style.panelSolid", "how solid the panels are")}</span>
            <span className="rowInline">
              <Slider
                value={state.panelSolid}
                min={0}
                max={100}
                step={1}
                onChange={(panelSolid) => change({ panelSolid })}
              />
              <span className="styleNumber">{state.panelSolid}%</span>
            </span>
          </div>
        </>
      ) : null}

      {state.gradient ? (
        <div className="field">
          <span className="fieldName">{tr("style.gradientStrength", "how strong the gradient is")}</span>
          <span className="rowInline">
            <Slider
              value={state.gradientStrength}
              min={0}
              max={100}
              step={1}
              onChange={(gradientStrength) => change({ gradientStrength })}
            />
            <span className="styleNumber">{state.gradientStrength}</span>
          </span>
        </div>
      ) : null}

      {state.glowOn ? (
        <div className="field">
          <span className="fieldName">{tr("style.glowLevel", "glow strength")}</span>
          <Slider value={state.glow} min={0} max={1} step={0.05} onChange={(glow) => change({ glow })} />
        </div>
      ) : null}

      {state.scanOn ? (
        <div className="field">
          <span className="fieldName">{tr("style.scanlines", "scan lines")}</span>
          <Slider value={state.scan} min={0} max={0.3} step={0.01} onChange={(scan) => change({ scan })} />
        </div>
      ) : null}

      <div className="field">
        <span className="fieldName">{tr("style.fontUi", "interface font size")}</span>
        <Slider value={state.size} min={0.75} max={1.25} step={0.0625} onChange={(size) => change({ size })} />
      </div>

      <div className="field">
        <span className="fieldName">{tr("style.fontTerm", "terminal font size")}</span>
        <Slider
          value={state.termSize}
          min={0.625}
          max={1.125}
          step={0.0625}
          onChange={(termSize) => change({ termSize })}
        />
      </div>

      <div className="field">
        <span className="fieldName">{tr("settings.style", "adjust the style")}</span>
        <div className="style">
          {ROLES.map((r) => (
            <Swatch key={r.key} value={shown[r.key] ?? "#000000"} onChange={(hex) => setColour(r.key, hex)}>
              {tr(r.text, r.english)}
            </Swatch>
          ))}
        </div>
        <span className="rowInline">
          <span className="notice">
            {tr("settings.themeHint", "Changes take effect at once. Reset puts the theme's own colours back.")}
          </span>
          <Button onClick={reset} title={tr("settings.resetTip", "Back to the colours of the theme — your changes are lost")}>
            {tr("settings.reset", "RESET")}
          </Button>
        </span>
      </div>
    </div>
  );
}
