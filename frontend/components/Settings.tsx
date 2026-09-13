"use client";

import { useEffect, useState } from "react";
import Accounts from "@/components/Accounts";
import Agents from "@/components/Agents";
import EditorSettings from "@/components/EditorSettings";
import Keybindings from "@/components/Keybindings";
import LayoutSettings, { type LayoutControls } from "@/components/LayoutSettings";
import Notifications from "@/components/Notifications";
import Status from "@/components/Status";
import TerminalSettings from "@/components/TerminalSettings";
import Button from "@/components/ui/Button";
import FilePick from "@/components/ui/FilePick";
import Select from "@/components/ui/Select";
import ColourPicker from "@/components/ui/ColourPicker";
import Window from "@/components/ui/Window";
import StyleEditor from "@/components/StyleEditor";
import { api } from "@/lib/api";
import { askVersionNow, watchVersion } from "@/lib/version";
import { chosenLanguage, loadLanguage, tr, errText } from "@/lib/i18n";
import { DEFAULTS, apply, fitPalette, installUserFonts, load, rememberThemes, save, type Palette, type Skin, type ThemeState } from "@/lib/theme";
import type { Theme, UserFont, VersionInfo } from "@/lib/types";

type Tab = "skins" | "terminal" | "editor" | "keys" | "accounts" | "layouts" | "notify" | "agents" | "status";

/* The tabs, with their texts spelled out.
 *
 * This was tr(`settings.tab.${t}`, t) — a key assembled at runtime, which
 * nothing can check. Four of the five keys did not exist, and so four tabs
 * showed their own identifier. A function rather than a string, because the
 * table is loaded after this module is read. */
const TABS: { id: Tab; label: () => string }[] = [
  { id: "skins", label: () => tr("settings.tab.skins", "skins & palette") },
  { id: "terminal", label: () => tr("settings.tab.terminal", "terminal") },
  { id: "editor", label: () => tr("settings.tab.editor", "editor") },
  { id: "keys", label: () => tr("settings.tab.keys", "keys") },
  { id: "accounts", label: () => tr("settings.tab.accounts", "accounts") },
  { id: "layouts", label: () => tr("settings.tab.layouts", "layouts") },
  { id: "notify", label: () => tr("settings.tab.notify", "notify") },
  { id: "agents", label: () => tr("settings.tab.agents", "agents") },
  { id: "status", label: () => tr("settings.tab.status", "status") },
];

// The font choices: the skin's own first, then the shipped monospace family,
// then everything brought in.
function fontOptions(fonts: UserFont[], defaultLabel: string) {
  return [
    { value: "", label: defaultLabel },
    { value: "IBM Plex Mono", label: "IBM Plex Mono" },
    ...fonts.map((f) => ({ value: f.family, label: f.family })),
  ];
}

/* Every setting there is, in a window of its own.
 *
 * It was a column docked to the right of the work, which was right for
 * watching a skin change — and wrong for everything else: it took a third of
 * the window whether or not the tab open needed it, could not be moved off
 * the panel somebody was comparing against, and every setting that was not
 * about the look had to be found somewhere else. Now it is a window: opened
 * where the column stood, dragged wherever it is not in the way, and holding
 * the terminal, the editor, the keys, the accounts and the layouts as well. */
export default function Settings({
  onClose,
  layouts,
  framed = true,
  openSession,
}: {
  onClose: () => void;
  layouts: LayoutControls;
  framed?: boolean;
  /* Brings a session to the front of the dock — the accounts tab opens the
     sign-in session of a new account with it. */
  openSession?: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("skins");
  // "en", to match what happens with no setting at all. Showing "System" here
  // while an unset plxr in fact speaks English would be the picker telling one
  // story and the window another.
  const [lang, setLang] = useState("en");

  useEffect(() => {
    void api
      .prefs()
      .then((p) => setLang((p.language as string) || "en"))
      .catch(() => undefined);
  }, []);
  const [state, setState] = useState<ThemeState>(DEFAULTS);
  const [version, setVersion] = useState<VersionInfo | null>(null);

  /* What the foot of the window says about this build.
   *
   * It used to say "plxr dev" and nothing else — a version with no statement
   * about it, which reads as if the update feature were missing. It is not: the
   * service asks GitHub on every open. What it cannot do is offer an update to
   * a build called "dev", because that one came from source and replacing it
   * with a release would throw the source away. */
  function versionLine(): string {
    if (!version?.current) return "";
    const name = `plxr ${version.current}`;
    if (version.current === "dev") {
      return `${name} — ${tr("settings.fromSource", "built from source, so it will not replace itself")}` +
        (version.latest ? ` (${tr("settings.released", "newest release")}: ${version.latest})` : "");
    }
    if (version.available) return `${name} — ${tr("settings.updateReady", "version {v} is out")}`.replace("{v}", version.latest);
    if (version.latest) return `${name} — ${tr("settings.upToDate", "up to date")}`;
    return `${name} — ${tr("settings.checkFailed", "could not reach the release page")}`;
  }
  const [themes, setThemes] = useState<Theme[]>([]);
  const [fonts, setFonts] = useState<UserFont[]>([]);
  const [note, setNote] = useState("");

  useEffect(() => watchVersion(setVersion), []);

  useEffect(() => {
    setState(load());
    // Opening the settings is somebody asking, so it is asked again now rather
    // than showing whatever the last beat happened to find.
    askVersionNow();
    api.themes().then((t) => setThemes(t ?? [])).catch(() => setThemes([]));
    reloadFonts();
  }, []);

  // The brought-in fonts, and the @font-face for each so the choices resolve.
  const reloadFonts = () =>
    api
      .fonts()
      .then((f) => {
        setFonts(f ?? []);
        installUserFonts(f ?? []);
      })
      .catch(() => setFonts([]));

  // A font file the person picked. Read as bytes and sent to the service,
  // which stores it beside everything else plxr owns and serves it under
  // /userfonts/.
  async function importFont(file: File) {
    setNote("");
    try {
      await api.fontImport(file.name, await file.arrayBuffer());
      await reloadFonts();
      setNote(tr("font.imported", "{name} imported", { name: file.name }));
    } catch (e) {
      setNote(errText(e));
    }
  }

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

  /* The same settings, either in a window of its own or filling a dock panel.
     It was only ever a window, which is why it could be dragged and docked
     nowhere; as a panel it is moved, split and tabbed like everything else,
     and the window is what is left for anyone who liked it floating. */
  const body = (
      <div className="settingsbody">
        <div className="tabs" role="tablist">
          {TABS.map(({ id, label }) => (
            <Button
              bare
              key={id}
              role="tab"
              aria-selected={tab === id}
              data-tab={id}
              className={`tab${tab === id ? " on" : ""}`}
              onClick={() => setTab(id)}
            >
              {label()}
            </Button>
          ))}
        </div>

        {tab === "skins" ? (
          <>
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
                      // The two the skin brings itself, then whatever the
                      // service serves for this skin — an imported theme
                      // lands here too.
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
              <div className="field">
                <span className="fieldName">{tr("settings.language", "language")}</span>
                <span className="rowInline">
                  <Select
                    value={lang}
                    onChange={(next: string) => {
                      setLang(next);
                      void api.setPrefs({ language: next });
                      /* Reloaded rather than swapped in place. tr() reads a
                         module-level table, so a component that has already
                         rendered keeps the words it was given until something
                         makes it render again. */
                      void loadLanguage(chosenLanguage(next)).then(() => window.location.reload());
                    }}
                    options={[
                      { value: "system", label: tr("settings.langSystem", "System") },
                      { value: "en", label: "English" },
                      { value: "de", label: "Deutsch" },
                    ]}
                  />
                  <span className="notice">
                    {tr("settings.langHint", "The window is reloaded so every view speaks it.")}
                  </span>
                </span>
              </div>
              {state.palette === "custom" ? (
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

              <div className="field">
                <span className="fieldName">{tr("settings.fonts", "fonts")}</span>
                <span className="rowInline">
                  <Select
                    value={state.uiFont}
                    options={fontOptions(fonts, tr("settings.fontDefault", "skin default"))}
                    onChange={(uiFont) => change({ uiFont })}
                    tip={tr("settings.uiFontTip", "The font of the interface")}
                  />
                  <FilePick
                    accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf"
                    label={tr("settings.import", "IMPORT")}
                    onPick={importFont}
                  />
                </span>
                <span className="notice">
                  {tr("settings.fontsHint", "Bring in a .woff2, .otf or .ttf and choose it for the interface or the terminal. Nothing is downloaded — the file you pick is served from this machine.")}
                </span>
              </div>
            </div>

            {/* The colours and the switches, unchanged, under the same tab:
                a skin, its palette and its knobs are one decision. */}
            <StyleEditor
              state={state}
              change={change}
              reset={() => {
                // Only the hand-picked colours go; the skin, the palette and
                // the switches are choices of their own and stay where they are.
                const next = { ...state, colours: {} };
                setState(next);
                apply(next);
                save(next);
              }}
            />
          </>
        ) : null}

        {tab === "terminal" ? <TerminalSettings state={state} change={change} fonts={fonts} /> : null}
        {tab === "editor" ? <EditorSettings /> : null}
        {tab === "keys" ? <Keybindings /> : null}
        {tab === "accounts" ? <Accounts openSession={openSession} /> : null}
        {tab === "layouts" ? <LayoutSettings layouts={layouts} /> : null}
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
  );
  if (!framed) return <div className="settingsPanel">{body}</div>;
  return (
    <Window id="settings" heading={tr("settings.title", "settings")} onClose={onClose}>
      {body}
    </Window>
  );
}
