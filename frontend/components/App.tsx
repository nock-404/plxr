"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Ask from "@/components/ui/Ask";
import Button from "@/components/ui/Button";
import { useMenu, type MenuItem } from "@/components/ui/Menu";
import Logo from "@/components/ui/Logo";
import PathField from "@/components/ui/PathField";
import Tooltip from "@/components/ui/Tooltip";
import Keys from "@/components/Keys";
import NewSession from "@/components/NewSession";
import Meter from "@/components/Meter";
import Pace from "@/components/Pace";
import Folders from "@/components/views/Folders";
import Settings from "@/components/Settings";
import Templates from "@/components/Templates";
import UpdateBar from "@/components/UpdateBar";
import Workbench, { startCapture } from "@/components/Workbench";
import Workshop, { applyStored } from "@/components/Workshop";
import Dock, { ACTIVITIES, DV_MAJOR, readPresets, type Activity, type Focus, type LayoutAction, type LayoutRequest, type Preset } from "@/components/Dock";
import { type Command } from "@/components/CommandPalette";
import { type LayoutControls } from "@/components/LayoutSettings";
import { titleOf } from "@/lib/state";
import Archive from "@/components/views/Archive";
import Inbox from "@/components/views/Inbox";
import Overview from "@/components/views/Overview";
import Ports from "@/components/views/Ports";
import Session from "@/components/views/Session";
import Usage from "@/components/views/Usage";
import { api } from "@/lib/api";
import { clock } from "@/lib/format";
import { chosenLanguage, loadLanguage, tr } from "@/lib/i18n";
import { arm, changed } from "@/lib/notify";
import { countsLine, herdOf, roomOf } from "@/lib/state";
import { VIEW_ORDER, bindingOf, caption, hasModifier, matches, type Action } from "@/lib/keymap";
import { adoptPrefs } from "@/lib/prefs";
import { adopt, apply, fitPalette, load, persistVia, rememberThemes, type ThemeState, installUserFonts } from "@/lib/theme";
import { useTiles } from "@/lib/useTiles";

/* The rail views as the header menu and ⌘1…8 name them — the same words the
   rail uses, spelled out so the table can be checked. In the order the
   shortcuts count them. */
const VIEW_LABELS: { view: (typeof VIEW_ORDER)[number]; key: string; fallback: string }[] = [
  { view: "overview", key: "rail.overview", fallback: "Overview" },
  { view: "inbox", key: "rail.inbox", fallback: "Inbox" },
  { view: "folders", key: "rail.folders", fallback: "Folders" },
  { view: "changes", key: "rail.changes", fallback: "Changes" },
  { view: "ports", key: "rail.ports", fallback: "Ports" },
  { view: "usage", key: "rail.usage", fallback: "Usage" },
  { view: "archive", key: "rail.archive", fallback: "Archive" },
  { view: "search", key: "rail.search", fallback: "Search" },
];
const VIEW_ACTIONS: Action[] = ["view1", "view2", "view3", "view4", "view5", "view6", "view7", "view8"];

// What each activity is called in the menu and the palette.
function activityLabel(a: Activity): string {
  switch (a) {
    case "focus":
      return tr("layouts.focus", "Focus");
    case "code":
      return tr("layouts.code", "Code");
    case "review":
      return tr("layouts.review", "Review");
    default:
      return tr("layouts.monitor", "Monitor");
  }
}

// The control room. Title bar, status strip, rail, content — the arrangement
// stays the same in every skin; only the dressing changes.
export default function App() {
  const { tiles, connected } = useTiles();
  // Navigation lives in the dock now — the rail is a panel like any other and
  // drives it through the dock's own actions. App keeps only what opens a panel
  // from outside the dock: a freshly created session.
  /* The place you are.
   *
   * It used to be a filter for the overview and nothing else: a folder chosen
   * here narrowed the tiles, and then + NEW asked for the same folder again,
   * and FOLDERS did not know about it either. Now it is the one folder the
   * window is about — it narrows the overview, it is where a new session
   * starts, and it is the folder open in FOLDERS. Remembered across starts. */
  const [filter, setFilter] = useState(() => {
    try {
      return localStorage.getItem("plxr.here") ?? "";
    } catch {
      return "";
    }
  });
  /* Taken as a folder only when committed — Enter, or a pick from the list —
     never while it is being typed: half a path is not a place. */
  const [here, setHere] = useState<string>(() => {
    try {
      return localStorage.getItem("plxr.here") ?? "";
    } catch {
      return "";
    }
  });
  const goHere = useCallback((path: string) => {
    const p = path.trim().replace(/\/+$/, "");
    setFilter(p);
    setHere(p);
    try {
      if (p) localStorage.setItem("plxr.here", p);
      else localStorage.removeItem("plxr.here");
    } catch {
      /* no storage — it lasts for this window only */
    }
    if (p) api.openWorkspace(p).catch(() => {/* not a folder, or not there: the overview still filters by it */});
  }, []);
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState(false);
  // The readout is off unless somebody asked for it: a frame loop that is
  // always running is a measuring instrument that changes what it measures.
  const [meter, setMeter] = useState(false);
  const [keys, setKeys] = useState(false);
  const [templates, setTemplates] = useState(false);
  const [bench, setBench] = useState(false);
  const [shop, setShop] = useState(false);
  /* Whether the ⌘K palette is up. Held here, not in the dock, because the
     keyboard is handled here — with the guard that keeps a shortcut from
     firing while a field is being typed in. */
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [now, setNow] = useState<string>("");
  const [ports, setPorts] = useState(0);
  const [archive, setArchive] = useState(0);
  /* The look, held rather than only applied.
     It used to be handed to apply() and forgotten, which was enough while
     nothing outside the settings panel needed to know it. The handle beside a
     docked panel does: it has to show the width it is about to change. */
  const [theme, setTheme] = useState<ThemeState>(load);
  /* The named arrangements, as saved under prefs.dockPresets. Kept here
     because the menu that lists them is here; the dock only ever hands back a
     snapshot of the panels when asked to save one. */
  const [presets, setPresets] = useState<Preset[]>([]);
  // The preset applied or saved last: the one Rename and Delete act on.
  const [currentPreset, setCurrentPreset] = useState<string>("");
  const menu = useMenu();

  useEffect(() => {
    startCapture();
    applyStored();
    /* The language, from the setting.
     *
     * This line read loadLanguage("en"), with no way to reach anything else:
     * no switch anywhere, language() called by nobody. The daemon served
     * de.json, a gate kept German out of the code so that file would stay the
     * only place it lives, and 580 translated strings were never once shown to
     * anybody. */
    void api
      .prefs()
      .then((p) => {
        setMeter(Boolean(p.meter));
        setPresets(readPresets(p));
        // The terminal's, the editor's and the keyboard's own settings.
        adoptPrefs(p);
        return loadLanguage(chosenLanguage(p.language as string | undefined));
      })
      .catch(() => loadLanguage("en"));
    const onMeter = (e: Event) => setMeter(Boolean((e as CustomEvent).detail));
    window.addEventListener("METER_CHANGED", onMeter);
    // The palettes come from the daemon, so an imported theme works the same as
    // a shipped one. Applied once they are in — until then the skin's own
    // defaults are already on screen.
    apply(load());
    // The brought-in fonts have to be declared before a chosen one can render,
    // so the @font-face are installed at startup, not only when the settings
    // are opened.
    api.fonts().then((f) => installUserFonts(f ?? [])).catch(() => undefined);
    persistVia(async (state) => {
      await api.setPrefs({ theme: state }).catch(() => undefined);
    });
    // The daemon's copy wins over this window's: it is the one that survives a
    // restart, and it is what a second window sees.
    Promise.all([api.themes().catch(() => []), api.prefs().catch(() => ({}))]).then(
      ([themes, prefs]) => {
        rememberThemes(themes ?? []);
        const kept = (prefs as { theme?: Partial<ThemeState> }).theme;
        // Fitted only now: which palettes belong to which skin is not known
        // until the daemon has said what it serves, one line above.
        const state = fitPalette(kept ? { ...load(), ...kept } : load());
        adopt(state);
        apply(state);
        setTheme(state);
      },
    );

    /* Two windows, one look.
     *
     * Each window read the settings once, when it started, and never again. So
     * a skin changed in one of them left the other on whatever it happened to
     * have, and both then wrote their whole set back — whichever wrote last
     * won, silently, with no way to tell which that had been.
     *
     * The daemon stamps the settings with a version, and every window watches
     * it. A version this window did not cause means somebody else changed
     * something, so it takes their copy. The last change wins, as before, but
     * now it wins everywhere and visibly.
     */
    let mine = 0;
    let live = true;
    const follow = async () => {
      while (live) {
        try {
          const { rev } = await api.prefsRev();
          if (rev && rev !== mine) {
            if (mine !== 0) {
              const prefs = (await api.prefs()) as { theme?: Partial<ThemeState> };
              // The saved layouts are shared the same way: a preset saved in
              // one window is in the other's menu without a restart — and so
              // are the terminal, editor and keyboard settings.
              setPresets(readPresets(prefs));
              adoptPrefs(prefs);
              setMeter(Boolean((prefs as { meter?: unknown }).meter));
              if (prefs.theme) {
                const state = fitPalette({ ...load(), ...prefs.theme });
                adopt(state);
                apply(state);
                setTheme(state);
              }
            }
            mine = rev;
          }
        } catch {
          /* the daemon will be back; nothing to change in the meantime */
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    };
    void follow();
    // macOS draws its traffic lights over the content with an inset title bar.
    if (navigator.userAgent.includes("Mac")) {
      document.documentElement.setAttribute("data-titlebar-inset", "yes");
    }
    return () => {
      live = false;
      window.removeEventListener("METER_CHANGED", onMeter);
    };
  }, []);

  /* The keyboard, read against the keymap.
   *
   * Two guards. A field being typed in — the path filter, the palette's own
   * box — takes every key, so nothing fires from there: ⌘K must not fold the
   * palette while somebody is typing into it. A terminal or an editor is
   * typed in too, but it does not take ⌘K, ⌘N or ⌘1: those reach the shell
   * from there. What must not reach it from a terminal is a bare key — "?"
   * typed into a shell is a question mark, not the help. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT";
      const editing = typing || target?.tagName === "TEXTAREA" || Boolean(target?.isContentEditable);
      /* Esc closes the topmost thing, and only that. It used to close
         everything at once, so Esc in a dialog asked from the settings took
         the settings window with it. The palette and a dialog answer their
         own Esc; a dialog on screen is left to it. */
      if (e.key === "Escape") {
        if (keys) setKeys(false);
        else if (templates) setTemplates(false);
        else if (creating) setCreating(false);
        else if (document.querySelector(".backdrop, .paletteScrim")) return;
        else setSettings(false);
        return;
      }
      if (typing) return;
      const fire = (action: Action, run: () => void) => {
        if (!matches(e, action)) return false;
        if (editing && !hasModifier(bindingOf(action))) return false;
        e.preventDefault();
        run();
        return true;
      };
      if (fire("help", () => setKeys(true))) return;
      if (fire("palette", () => setPaletteOpen((v) => !v))) return;
      if (fire("workbench", () => setBench((b) => !b))) return;
      if (fire("workshop", () => setShop((v) => !v))) return;
      if (fire("newSession", () => setCreating(true))) return;
      if (fire("settings", () => setSettings((v) => !v))) return;
      for (let i = 0; i < VIEW_ACTIONS.length; i++) {
        const view = VIEW_ORDER[i];
        if (fire(VIEW_ACTIONS[i], () => setFocus({ kind: "view", view }))) return;
      }
    }
    // On window, where the palette's ⌘K always listened: a key pressed
    // anywhere reaches it, and the checks that dispatch to window reach it too.
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keys, templates, creating]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(clock(new Date())), 1000);
    setNow(clock(new Date()));
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    api.ports().then((p) => setPorts(p?.length ?? 0)).catch(() => undefined);
    api.archive().then((a) => setArchive(a?.length ?? 0)).catch(() => undefined);
  }, []);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return tiles;
    return tiles.filter((t) => t.cwd.toLowerCase().includes(needle) || t.name.toLowerCase().includes(needle));
  }, [tiles, filter]);

  // One reading for the counter, the brake, the room state and the inbox badge.
  const herd = herdOf(tiles);
  const room = roomOf(herd);
  // The inbox holds anything that cannot go on without an answer.
  const needsAnswer = tiles.filter(
    (t) => t.alive && (t.status === "permission" || t.status === "waiting"),
  ).length;

  useEffect(() => {
    document.documentElement.setAttribute("data-room", room);
  }, [room]);

  // Sound needs a gesture before a browser will allow it; the first click is it.
  useEffect(() => {
    const once = () => arm();
    document.addEventListener("pointerdown", once, { once: true });
    return () => document.removeEventListener("pointerdown", once);
  }, []);

  useEffect(() => {
    changed(tiles);
  }, [tiles]);

  const [focus, setFocus] = useState<Focus>(null);
  /* What the dock is asked to do with its arrangement. One channel, one
     request at a time, each new by its seq — a reset, a preset to apply, a
     name to save under, an activity to arrange for. */
  const [layoutAction, setLayoutAction] = useState<LayoutAction | null>(null);
  const seq = useRef(0);
  const direct = useCallback((request: LayoutRequest) => {
    seq.current += 1;
    setLayoutAction({ ...request, seq: seq.current });
  }, []);
  // The question standing about a layout: a name to save under, a new name,
  // or whether to delete. Asked with our own dialog, never the browser's.
  const [layoutAsk, setLayoutAsk] = useState<"save" | "rename" | "delete" | null>(null);

  /* The list is written whole. prefs merges by key, and dockPresets is one
     key, so every change is the whole list under the dockview major it was
     saved with — the guard readPresets applies when it comes back. */
  const writePresets = useCallback((items: Preset[]) => {
    setPresets(items);
    void api.setPrefs({ dockPresets: { dvMajor: DV_MAJOR, items } }).catch(() => undefined);
  }, []);
  const savePreset = useCallback(
    (name: string, layout: object) => {
      const kept = presets.filter((p) => p.name !== name);
      writePresets([...kept, { name, layout }]);
      setCurrentPreset(name);
    },
    [presets, writePresets],
  );
  const renamePreset = useCallback(
    (from: string, to: string) => {
      if (!to || to === from) return;
      writePresets(presets.filter((p) => p.name !== to).map((p) => (p.name === from ? { ...p, name: to } : p)));
      setCurrentPreset(to);
    },
    [presets, writePresets],
  );
  const deletePreset = useCallback(
    (name: string) => {
      writePresets(presets.filter((p) => p.name !== name));
      setCurrentPreset("");
    },
    [presets, writePresets],
  );
  const applyPreset = useCallback(
    (p: Preset) => {
      setCurrentPreset(p.name);
      direct({ type: "apply", arg: p.layout });
    },
    [direct],
  );

  /* The LAYOUTS menu, at the button. The same entries the palette offers,
     under the pointer: arrange for an activity, bring back a saved
     arrangement, keep the current one, rename or drop the one in use. */
  const layoutItems = useCallback((): MenuItem[] => {
    const items: MenuItem[] = ACTIVITIES.map((a) => ({
      label: tr("layouts.arrange", "Arrange for {activity}", { activity: activityLabel(a) }),
      onClick: () => direct({ type: "activity", arg: a }),
    }));
    items.push({ separator: true });
    if (presets.length === 0) {
      items.push({ label: tr("layouts.none", "no saved layouts yet"), onClick: () => undefined, disabled: true });
    } else {
      for (const p of presets) {
        items.push({ label: tr("layouts.apply", "Apply {name}", { name: p.name }), onClick: () => applyPreset(p) });
      }
    }
    items.push({ separator: true });
    items.push({ label: tr("layouts.saveAs", "Save current as…"), onClick: () => setLayoutAsk("save") });
    // Rename and Delete act on the preset in use; with none they say so and
    // wait, rather than naming nothing.
    items.push({
      label: currentPreset ? tr("layouts.rename", "Rename {name}…", { name: currentPreset }) : tr("layouts.renameNone", "Rename…"),
      onClick: () => setLayoutAsk("rename"),
      disabled: !currentPreset,
    });
    items.push({
      label: currentPreset ? tr("layouts.delete", "Delete {name}…", { name: currentPreset }) : tr("layouts.deleteNone", "Delete…"),
      onClick: () => setLayoutAsk("delete"),
      disabled: !currentPreset,
      danger: true,
    });
    items.push({ separator: true });
    items.push({ label: tr("palette.resetLayout", "Reset the panel layout"), onClick: () => direct({ type: "reset" }) });
    return items;
  }, [presets, currentPreset, direct, applyPreset]);

  /* The frame-rate readout, switched from the menu as well as from the status
     tab: one preference, announced so both places follow. */
  const toggleMeter = useCallback(() => {
    setMeter((was) => {
      const on = !was;
      void api.setPrefs({ meter: on }).catch(() => undefined);
      window.dispatchEvent(new CustomEvent("METER_CHANGED", { detail: on }));
      return on;
    });
  }, []);

  /* The MENU, under the button: every action the shell has, grouped, with
     the key each answers to. The palette offers the same rows to the
     keyboard; the menu offers them to the pointer, so nothing in plxr is
     reachable only by knowing a key. What acts on one session stays with the
     session — its tile, its rail entry, its title. */
  const menuItems = useCallback((): MenuItem[] => {
    const items: MenuItem[] = [
      { label: tr("menu.search", "Search commands…"), hint: caption(bindingOf("palette")), onClick: () => setPaletteOpen(true) },
      { separator: true },
      { header: true, label: tr("menu.actions", "Actions") },
      { label: tr("palette.newSession", "New session"), hint: caption(bindingOf("newSession")), onClick: () => setCreating(true) },
      { label: tr("palette.templates", "Templates"), onClick: () => setTemplates(true) },
      { label: tr("palette.settings", "Settings"), hint: caption(bindingOf("settings")), onClick: () => setSettings(true) },
      {
        label: herd.halted ? tr("header.brakeRelease", "RESUME ALL") : tr("header.brake", "PAUSE ALL"),
        onClick: () => void (herd.halted ? api.releaseBrake() : api.emergencyBrake()).catch(() => undefined),
      },
      { label: tr("palette.resetLayout", "Reset the panel layout"), onClick: () => direct({ type: "reset" }) },
      { separator: true },
      { header: true, label: tr("menu.tools", "Tools") },
      { label: tr("workbench.title", "Workbench"), hint: caption(bindingOf("workbench")), checked: bench, onClick: () => setBench((b) => !b) },
      { label: tr("workshop.title", "Workshop"), hint: caption(bindingOf("workshop")), checked: shop, onClick: () => setShop((v) => !v) },
      { label: tr("meter.show", "frame-rate readout"), checked: meter, onClick: toggleMeter },
      { separator: true },
      { header: true, label: tr("menu.views", "Views") },
      ...VIEW_LABELS.map((v, i) => ({
        label: tr(v.key, v.fallback),
        hint: caption(bindingOf(VIEW_ACTIONS[i])),
        onClick: () => setFocus({ kind: "view", view: v.view }),
      })),
      { separator: true },
      { header: true, label: tr("menu.help", "Help") },
      { label: tr("keys.title", "Keyboard"), hint: caption(bindingOf("help")), onClick: () => setKeys(true) },
    ];
    return items;
  }, [herd.halted, bench, shop, meter, direct, toggleMeter]);

  // The actions that belong to the shell, not to any panel — offered in the
  // command palette (⌘K) alongside the views and sessions.
  const appCommands = useMemo<Command[]>(() => {
    const layouts: Command[] = ACTIVITIES.map((a) => ({
      id: `layout:${a}`,
      group: tr("palette.layout", "Layout"),
      label: tr("layouts.arrange", "Arrange for {activity}", { activity: activityLabel(a) }),
      run: () => direct({ type: "activity", arg: a }),
    }));
    for (const p of presets) {
      layouts.push({
        id: `preset:${p.name}`,
        group: tr("palette.layout", "Layout"),
        label: tr("layouts.apply", "Apply {name}", { name: p.name }),
        run: () => applyPreset(p),
      });
    }
    layouts.push({ id: "layout:save", group: tr("palette.layout", "Layout"), label: tr("layouts.saveAs", "Save current as…"), run: () => setLayoutAsk("save") });
    if (currentPreset) {
      layouts.push({
        id: "layout:rename",
        group: tr("palette.layout", "Layout"),
        label: tr("layouts.rename", "Rename {name}…", { name: currentPreset }),
        run: () => setLayoutAsk("rename"),
      });
      layouts.push({
        id: "layout:delete",
        group: tr("palette.layout", "Layout"),
        label: tr("layouts.delete", "Delete {name}…", { name: currentPreset }),
        run: () => setLayoutAsk("delete"),
      });
    }
    return [
      { id: "cmd:new", group: tr("palette.action", "Action"), label: tr("palette.newSession", "New session"), run: () => setCreating(true) },
      { id: "cmd:settings", group: tr("palette.action", "Action"), label: tr("palette.settings", "Settings"), run: () => setSettings(true) },
      { id: "cmd:templates", group: tr("palette.action", "Action"), label: tr("palette.templates", "Templates"), run: () => setTemplates(true) },
      { id: "cmd:reset", group: tr("palette.action", "Action"), label: tr("palette.resetLayout", "Reset the panel layout"), run: () => direct({ type: "reset" }) },
      {
        id: "cmd:pauseall",
        group: tr("palette.action", "Action"),
        label: herd.halted ? tr("header.brakeRelease", "RESUME ALL") : tr("header.brake", "PAUSE ALL"),
        run: () => void (herd.halted ? api.releaseBrake() : api.emergencyBrake()).catch(() => undefined),
      },
      { id: "cmd:keys", group: tr("palette.action", "Action"), label: tr("keys.title", "Keyboard"), hint: caption(bindingOf("help")), run: () => setKeys(true) },
      { id: "tool:workbench", group: tr("menu.tools", "Tools"), label: tr("workbench.title", "Workbench"), hint: caption(bindingOf("workbench")), run: () => setBench((b) => !b) },
      { id: "tool:workshop", group: tr("menu.tools", "Tools"), label: tr("workshop.title", "Workshop"), hint: caption(bindingOf("workshop")), run: () => setShop((v) => !v) },
      { id: "tool:meter", group: tr("menu.tools", "Tools"), label: tr("meter.show", "frame-rate readout"), run: toggleMeter },
      ...layouts,
    ];
  }, [herd.halted, presets, currentPreset, direct, applyPreset, toggleMeter]);

  // What the layouts page in the settings can do: the same verbs as the
  // LAYOUTS button, with the shell's own dialogs behind them.
  const layoutControls = useMemo<LayoutControls>(
    () => ({
      presets,
      current: currentPreset,
      activityLabel,
      arrange: (a) => direct({ type: "activity", arg: a }),
      apply: applyPreset,
      saveAs: () => setLayoutAsk("save"),
      rename: () => setLayoutAsk("rename"),
      remove: () => setLayoutAsk("delete"),
      reset: () => direct({ type: "reset" }),
    }),
    [presets, currentPreset, direct, applyPreset],
  );
  // Opening a session from outside the dock — a new one just created — asks the
  // dock to bring it up; inside the dock the rail and the tiles call the dock
  // directly.
  function openSession(id: string) {
    const t = tiles.find((x) => x.id === id);
    setFocus({ kind: "session", id, name: t ? titleOf(t) : id });
  }

  return (
    <div className="app">
      <header className="bar">
        <div className="brand">
          <span className="mark"><Logo /></span>
          <span className="wordmark">plxr</span>
        </div>

        <div className="filter" data-on={filter.trim() ? "yes" : "no"}>
          <span className="prompt">{tr("header.pathPrompt", "path>")}</span>
          {/* Completes like the field in the start dialog: the filter is a
              path too, and typing one out by hand is no better here. */}
          <PathField
            value={filter}
            onChange={setFilter}
            onSubmit={() => goHere(filter)}
            placeholder={tr("header.pathPlaceholder", "the folder you are working in")}
          />
          {/* A filter that hides things without saying so is a window that lies.
              This one hid the session somebody was talking to, in a list of two
              where there were five, with nothing on screen to explain it. */}
          {/* Typed but not yet taken: Enter, or this, makes it the place. A
              pick from the list keeps the list open on purpose — that is how
              you walk down into a folder — so the pick alone does not commit. */}
          {filter.trim() && filter.trim().replace(/\/+$/, "") !== here ? (
            <Tooltip text={tr("header.go", "Make this the folder you are working in")}>
              <Button bare className="filtergo" onClick={() => goHere(filter)}>
                ↵
              </Button>
            </Tooltip>
          ) : null}
          {filter.trim() ? (
            <Tooltip text={tr("header.filterClear", "Show everything again")}>
              <Button bare className="filterclear" onClick={() => goHere("")}>
                ✕
              </Button>
            </Tooltip>
          ) : null}
        </div>

        <div className="draghandle" />

        <div className="tools">
          {herd.running > 0 || herd.halted ? (
            <Button
              on={herd.halted}
              onClick={() => (herd.halted ? api.releaseBrake() : api.emergencyBrake())}
            >
              {herd.halted ? tr("header.brakeRelease", "RESUME ALL") : tr("header.brake", "PAUSE ALL")}
            </Button>
          ) : null}
          <Tooltip text={tr("header.resetLayout", "Reset the panel layout to the default")}>
            <Button icon onClick={() => direct({ type: "reset" })}>
              ⟲
            </Button>
          </Tooltip>
          {/* Opens under the button: the pointer is where the eye is, and the
              same menu serves the right-click everywhere else. */}
          <Tooltip text={tr("header.layoutsTip", "Arrange the panels: for an activity, or as you saved them")}>
            <Button
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                menu.open(Math.round(r.left), Math.round(r.bottom + 4), layoutItems());
              }}
            >
              {tr("header.layouts", "LAYOUTS")}
            </Button>
          </Tooltip>
          <Tooltip text={tr("keys.tip", "Keyboard shortcuts")}>
            <Button icon onClick={() => setKeys(true)}>?</Button>
          </Tooltip>
          {/* The same button both ways. It only ever set the panel open, so the
              way back out was the DONE button at the bottom of a panel long
              enough to have scrolled it off the screen. */}
          <Tooltip text={tr("header.settingsTip", "Settings")}>
            <Button icon on={settings} aria-pressed={settings} onClick={() => setSettings((open) => !open)}>
              ⚙
            </Button>
          </Tooltip>
          {/* Everything, under one word. The tools were reachable by F12 and
              nothing else; the views by the rail alone. */}
          <Tooltip text={tr("header.menuTip", "Every action and setting, grouped")}>
            <Button
              data-do="menu"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                menu.open(Math.round(r.left), Math.round(r.bottom + 4), menuItems());
              }}
            >
              {tr("header.menu", "MENU")}
            </Button>
          </Tooltip>
          <Button onClick={() => setTemplates(true)}>{tr("header.templates", "TEMPLATES")}</Button>
          <Button primary onClick={() => setCreating(true)}>{tr("header.new", "+ NEW")}</Button>
        </div>
      </header>

      <UpdateBar />

      <div className="statusrow">
        <span>
          {connected ? countsLine(herd) : tr("conn.lost", "Connection lost, trying again …")}
          {connected && shown.length !== tiles.length ? (
            <span className="hiding">
              {" · "}
              {tr("header.filtered", "{shown} of {total} shown", {
                shown: shown.length,
                total: tiles.length,
              })}
            </span>
          ) : null}
        </span>
        <span className="spacer" />
        {/* The spend, always in view — between the counts and the clock. */}
        <Pace />
        <span>{now}</span>
      </div>

      <div className="body">
        {/* The view's own bar, lifted out of the view.
            It used to sit inside, which put it beside the settings panel
            rather than above it: with the panel open the bar lost 280px, its
            buttons did not fit, and through a see-through panel they read as
            the settings lying on top of the toolbar. Views render into this
            through TopStrip; the overview has no bar and it collapses. */}
        <div className="work">
          <div className="workstrip" id="view-strip" />
          <div className="workrow">

        <main className="content">
          <Dock
            tiles={tiles}
            shown={shown}
            here={here}
            connected={connected}
            counts={{ inbox: needsAnswer, ports, archive }}
            openSession={openSession}
            onReplaced={openSession}
            focus={focus}
            layoutAction={layoutAction}
            onLayoutSaved={savePreset}
            appCommands={appCommands}
            paletteOpen={paletteOpen}
            onClosePalette={() => setPaletteOpen(false)}
          />
        </main>
          </div>
        </div>
        {bench ? <Workbench onClose={() => setBench(false)} /> : null}
        {shop ? <Workshop onClose={() => setShop(false)} /> : null}
      </div>

      {meter ? <Meter /> : null}

      <div className="fx" />

      {/* A window of its own on the body — see ui/Window — not a column
          beside the work: it is dragged where it is not in the way. */}
      {settings ? <Settings onClose={() => setSettings(false)} layouts={layoutControls} /> : null}
      {keys ? <Keys onClose={() => setKeys(false)} /> : null}
      {templates ? <Templates onClose={() => setTemplates(false)} /> : null}

      {layoutAsk === "save" ? (
        <Ask
          heading={tr("layouts.saveHead", "Save this arrangement")}
          detail={tr("layouts.saveDetail", "The panels as they stand now, under a name of your own. Saving under a name already in the list replaces it.")}
          field={tr("layouts.name", "name")}
          value={currentPreset}
          confirmLabel={tr("common.save", "SAVE")}
          onCancel={() => setLayoutAsk(null)}
          onConfirm={(name) => {
            setLayoutAsk(null);
            const clean = name.trim();
            if (clean) direct({ type: "save", arg: clean });
          }}
        />
      ) : null}
      {layoutAsk === "rename" && currentPreset ? (
        <Ask
          heading={tr("layouts.renameHead", "Rename this arrangement")}
          field={tr("layouts.name", "name")}
          value={currentPreset}
          confirmLabel={tr("layouts.renameDo", "RENAME")}
          onCancel={() => setLayoutAsk(null)}
          onConfirm={(name) => {
            setLayoutAsk(null);
            renamePreset(currentPreset, name.trim());
          }}
        />
      ) : null}
      {layoutAsk === "delete" && currentPreset ? (
        <Ask
          heading={tr("layouts.deleteHead", "Delete this arrangement")}
          detail={tr("layouts.deleteDetail", "{name} is taken off the list. The panels on screen stay as they are.", { name: currentPreset })}
          confirmLabel={tr("common.delete", "DELETE")}
          danger
          onCancel={() => setLayoutAsk(null)}
          onConfirm={() => {
            setLayoutAsk(null);
            deletePreset(currentPreset);
          }}
        />
      ) : null}

      {creating ? (
        <NewSession
          here={here}
          running={tiles}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            openSession(id);
          }}
        />
      ) : null}
    </div>
  );
}
