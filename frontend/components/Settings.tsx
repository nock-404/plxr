"use client";

import { useEffect, useRef, useState } from "react";
import Agents from "@/components/Agents";
import Notifications from "@/components/Notifications";
import Status from "@/components/Status";
import Button from "@/components/ui/Button";
import FilePick from "@/components/ui/FilePick";
import Select from "@/components/ui/Select";
import ColourPicker from "@/components/ui/ColourPicker";
import StyleEditor from "@/components/StyleEditor";
import { api } from "@/lib/api";
import { tr, errText } from "@/lib/i18n";
import { DEFAULTS, apply, fitPalette, load, rememberThemes, save, type Palette, type Skin, type ThemeState } from "@/lib/theme";
import type { Theme, VersionInfo } from "@/lib/types";

type Tab = "look" | "colours" | "notify" | "agents" | "status";

// Everything adjustable about the look, plus what is actually running.
export default function Settings({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("look");
  // The one place a raw input is unavoidable: a file picker has no other way in.
  const [state, setState] = useState<ThemeState>(DEFAULTS);
  const [version, setVersion] = useState<VersionInfo | null>(null);

  /* What the foot of the panel says about this build.
   *
   * It used to say "plxr dev" and nothing else — a version with no statement
   * about it, which reads as if the update feature were missing. It is not: the
   * daemon asks GitHub on every open. What it cannot do is offer an update to a
   * build called "dev", because that one came from source and replacing it with
   * a release would throw the source away. That is a decision worth saying out
   * loud rather than leaving as silence. */
  function versionLine(): string {
    if (!version?.current) return "";
    const name = `plxr ${version.current}`;
    if (version.current === "dev") {
      /* Not "updates off", which reads as a switch somebody threw. This build
         came from the source tree, and replacing it with a release would throw
         that tree's work away — so it declines, and says which release it would
         otherwise have offered. */
      return `${name} — ${tr("settings.fromSource", "built from source, so it will not replace itself")}` +
        (version.latest ? ` (${tr("settings.released", "newest release")}: ${version.latest})` : "");
    }
    if (version.available) return `${name} — ${tr("settings.updateReady", "version {v} is out")}`.replace("{v}", version.latest);
    if (version.latest) return `${name} — ${tr("settings.upToDate", "up to date")}`;
    return `${name} — ${tr("settings.checkFailed", "could not reach the release page")}`;
  }
  const [themes, setThemes] = useState<Theme[]>([]);
  const [note, setNote] = useState("");

  useEffect(() => {
    setState(load());
    api.version().then(setVersion).catch(() => setVersion(null));
    api.themes().then((t) => setThemes(t ?? [])).catch(() => setThemes([]));
  }, []);

  const reloadThemes = () =>
    api
      .themes()
      .then((t) => {
        setThemes(t ?? []);
        rememberThemes(t ?? []);
        apply(load());
      })
      .catch(() => undefined);

  // A theme is a small JSON file. Importing one is how a look moves between
  // machines, and it lands beside the shipped ones.
  async function importTheme(file: File) {
    setNote("");
    try {
      await api.themeImport(await file.text());
      await reloadThemes();
      setNote(tr("theme.imported", "{name} imported", { name: file.name }));
    } catch (e) {
      setNote(errText(e));
    }
  }

  function change(patch: Partial<ThemeState>) {
    const next = { ...state, ...patch };
    // A palette belongs to a skin. Changing the skin without changing the
    // palette used to leave the old one applied, which read as a broken theme.
    if (patch.skin && patch.skin !== state.skin) {
      next.palette =
        patch.skin === "crt" ? "green" : (themes.find((t) => t.skin === patch.skin)?.name ?? "custom");
    }
    setState(next);
    apply(next);
    save(next);
  }

  return (
    /* Docked beside the window rather than laid over it.
       Every control in here changes how the window looks, and a panel that
       covers the window hides the one thing it is for: the change had to be
       made, the panel closed, the result judged, the panel opened again. Now
       both are on screen at once and a switch can be watched as it is thrown. */
    <aside className="settingspanel">
      <div className="settingsbody">
        <b className="cardTitle">{tr("settings.title", "settings")}</b>

        <div className="tabs" role="tablist">
          {(["look", "colours", "notify", "agents", "status"] as Tab[]).map((t) => (
            <Button
              bare
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`tab${tab === t ? " on" : ""}`}
              onClick={() => setTab(t)}
            >
              {tr(`settings.tab.${t}`, t)}
            </Button>
          ))}
        </div>

        {tab === "look" ? (
          <div className="tabbody">
            <div className="field">
              <span className="fieldName">{tr("settings.appearance", "appearance")}</span>
              <span className="rowInline">
                <Select
                  value={state.skin}
                  onChange={(skin: Skin) => change(fitPalette({ ...state, skin }))}
                  options={[
                    { value: "crt", label: "CRT" },
                    { value: "win95", label: "Windows 95" },
                    { value: "sketch", label: "Sketch" },
                    { value: "pixel", label: "Pixel" },
                  ]}
                />
                <Select
                  value={state.palette}
                  onChange={(palette: Palette) => change({ palette })}
                  options={[
                    // The two the skin brings itself, then whatever the daemon
                    // serves for this skin — an imported theme lands here too.
                    ...(state.skin === "crt"
                      ? [
                          { value: "green", label: tr("theme.green", "Green") },
                          { value: "amber", label: tr("theme.amber", "Amber") },
                        ]
                      : []),
                    ...themes
                      .filter((t) => t.skin === state.skin && t.name !== "crt")
                      .map((t) => ({ value: t.name, label: t.label })),
                    { value: "custom", label: tr("theme.custom", "Own colour") },
                  ]}
                />
              </span>
            </div>
            {state.palette === "custom" ? (
              <>
                <div className="field">
                  <span className="fieldName">{tr("settings.phosphor", "phosphor")}</span>
                  <ColourPicker
                    hue={state.hue}
                    saturation={state.saturation}
                    brightness={state.brightness}
                    onChange={change}
                    label={tr("settings.phosphorPick", "Phosphor colour: across for saturation, down for brightness")}
                  />
                  <span className="notice">
                    {tr("settings.phosphorHint", "The picked colour is the text; every other role sits at a fixed share of its brightness. Down goes to black, left goes to grey.")}
                  </span>
                </div>
              </>
            ) : null}

            <div className="field">
              <span className="fieldName">{tr("settings.themeFile", "theme file")}</span>
              <span className="rowInline">
                <span className="notice">
                  {note || tr("settings.importHint", "A theme is one JSON file: a skin plus a palette.")}
                </span>
                <FilePick
                  accept=".json,application/json"
                  label={tr("settings.import", "IMPORT")}
                  onPick={importTheme}
                />
                {themes.find((t) => t.name === state.palette) ? (
                  <Button
                    onClick={async () => {
                      await api.themeDelete(state.palette).catch(() => undefined);
                      change({ palette: state.skin === "crt" ? "green" : "custom" });
                      await reloadThemes();
                    }}
                  >
                    {tr("common.delete", "DELETE")}
                  </Button>
                ) : null}
              </span>
            </div>

          </div>
        ) : null}

        {tab === "colours" ? (
          <StyleEditor
            state={state}
            change={change}
            reset={() => {
              // Only the hand-picked colours go; the skin, the palette and the
              // switches are choices of their own and stay where they are.
              const next = { ...state, colours: {} };
              setState(next);
              apply(next);
              save(next);
            }}
          />
        ) : null}

        {tab === "notify" ? <Notifications /> : null}
        {tab === "agents" ? <Agents /> : null}
        {tab === "status" ? <Status /> : null}

        <div className="dialogFoot">
          <span className="notice">{versionLine()}</span>
          <span className="spacer" />
          <Button primary onClick={onClose}>
            {tr("common.done", "DONE")}
          </Button>
        </div>
      </div>
    </aside>
  );
}
