"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Ask from "@/components/ui/Ask";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import { useMenu, type MenuItem } from "@/components/ui/Menu";
import Logo from "@/components/ui/Logo";
import Tooltip from "@/components/ui/Tooltip";
import Keys from "@/components/Keys";
import NewSession from "@/components/NewSession";
import Meter from "@/components/Meter";
import StatusBar from "@/components/StatusBar";
import Folders from "@/components/views/Folders";
import Templates from "@/components/Templates";
import UpdateBar from "@/components/UpdateBar";
import NotifyAsk from "@/components/NotifyAsk";
import Workbench, { startCapture } from "@/components/Workbench";
import Workshop, { applyStored } from "@/components/Workshop";
import ProjectSwitch from "@/components/topbar/ProjectSwitch";
import SessionSwitch from "@/components/topbar/SessionSwitch";
import EdgeToggles from "@/components/topbar/EdgeToggles";
import BarSearch from "@/components/topbar/BarSearch";
import Dock, { ACTIVITIES, DV_MAJOR, readPresets, type Activity, type Focus, type FrontPanel, type LayoutAction, type LayoutRequest, type Preset, type ShellActions, type ShownTools } from "@/components/Dock";
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
import { chosenLanguage, loadLanguage, tr } from "@/lib/i18n";
import { freshFocus, requestedFocus } from "@/lib/focus";
import { arm, changed } from "@/lib/notify";
import { zoomWindow } from "@/lib/zoom";
import { countsLine, herdOf, roomOf } from "@/lib/state";
import { bindingOf, caption, hasModifier, matches, type Action, fromTerminal } from "@/lib/keymap";
import { CHORD_ORDER, DOCS, TOOLS, chordOf, isTool } from "@/lib/tools";
import { adoptPrefs } from "@/lib/prefs";
import { NO_PROJECT, rootIdOf, type Project } from "@/lib/project";
import { askReveal } from "@/lib/reveal";
import { announcePrefs } from "@/lib/prefsEvents";
import { adopt, apply, fitPalette, load, persistVia, rememberThemes, save, type ThemeState, installUserFonts } from "@/lib/theme";
import { ICONS_VERSION, migrateIcons } from "@/lib/iconChoice";
import { useTiles } from "@/lib/useTiles";

/* What ⌘1…9 are bound to, in the order CHORD_ORDER counts them. */
const VIEW_ACTIONS: Action[] = ["view1", "view2", "view3", "view4", "view5", "view6", "view7", "view8", "view9"];

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

/* The session that was in front last in this window, so a reload starts from
   it instead of from no project. Kept per window, like plxr.here; a folder
   picked in the project switch clears it, because the pick came later. */
function rememberFront(id: string): void {
  try {
    if (id) localStorage.setItem("plxr.front", id);
    else localStorage.removeItem("plxr.front");
  } catch {
    /* no storage — it lasts for this page only */
  }
}
function lastFront(): string {
  try {
    return localStorage.getItem("plxr.front") ?? "";
  } catch {
    return "";
  }
}

// The control room. Title bar, status strip, the dock with its stripes — the
// arrangement stays the same in every skin; only the dressing changes.
export default function App() {
  const { tiles, connected } = useTiles();
  // Navigation lives in the dock: its stripes and its panels drive it through
  // the dock's own actions. App keeps what reaches the dock from outside it —
  // the switches, the header, the keys, a freshly created session.
  /* The place you are.
   *
   * It used to be a filter for the overview and nothing else: a folder chosen
   * here narrowed the tiles, and then + NEW asked for the same folder again,
   * and FOLDERS did not know about it either. Now it is the one folder the
   * window is about — it narrows the overview, it is where a new session
   * starts, and it is the folder open in FOLDERS. Remembered across starts. */
  const [here, setHere] = useState<string>(() => {
    try {
      return localStorage.getItem("plxr.here") ?? "";
    } catch {
      return "";
    }
  });
  const goHere = useCallback((path: string) => {
    const p = path.trim().replace(/\/+$/, "");
    setHere(p);
    try {
      if (p) localStorage.setItem("plxr.here", p);
      else localStorage.removeItem("plxr.here");
    } catch {
      /* no storage — it lasts for this window only */
    }
    if (p) api.openWorkspace(p).catch(() => {/* not a folder, or not there: the overview still filters by it */});
  }, []);
  /* The project the tools follow — see lib/project.ts. A folder picked in the
     project switch, or a session coming to the front: the later one wins, so a
     pick holds until the next session comes to the front. It starts as the
     folder remembered from last time, and as soon as the sessions are known,
     from the session that was in front last (the effect below). */
  const [chosen, setChosen] = useState<Project>(() => ({ path: here, sessionId: "" }));
  // The session that came to the front last, which the session switch names.
  const [frontSession, setFrontSession] = useState("");
  // Whether a pick or a session has set the project since this page loaded.
  const projectSet = useRef(false);
  const pickProject = useCallback(
    (path: string) => {
      const p = path.trim().replace(/\/+$/, "");
      projectSet.current = true;
      rememberFront("");
      goHere(p);
      setChosen({ path: p, sessionId: "" });
    },
    [goHere],
  );
  /* All projects: the board shows every session again. A folder that was
     picked goes with it; a session in front stays the project. */
  const allProjects = useCallback(() => {
    projectSet.current = true;
    goHere("");
    setChosen((p) => (p.sessionId ? p : NO_PROJECT));
  }, [goHere]);
  const tilesNow = useRef(tiles);
  tilesNow.current = tiles;
  const sessionFront = useCallback((id: string) => {
    projectSet.current = true;
    rememberFront(id);
    setFrontSession(id);
    setChosen((p) => (p.sessionId === id ? p : { path: tilesNow.current.find((t) => t.id === id)?.cwd ?? "", sessionId: id }));
  }, []);
  /* After a reload no session is in front — the dock brings the board back —
     so the project read "No project" and the Files tool showed nothing until a
     session was clicked. So once the sessions are known, and nothing has set
     the project yet, it is the session that was in front last in this window
     while that one is still there; else the folder picked last; else the only
     session, or the first one running. A session the dock brings to the front
     later still wins. */
  useEffect(() => {
    if (projectSet.current || tiles.length === 0) return;
    projectSet.current = true;
    const last = lastFront();
    const front = tiles.find((t) => t.id === last) ?? (here ? undefined : (tiles.find((t) => t.alive) ?? tiles[0]));
    if (!front) return;
    setFrontSession(front.id);
    setChosen({ path: front.cwd, sessionId: front.id });
  }, [tiles, here]);
  // A session is followed by its id and its folder read off the tiles, so a
  // session that is not known yet when it comes to the front gets its folder
  // as soon as it is.
  const followedCwd = chosen.sessionId ? tiles.find((t) => t.id === chosen.sessionId)?.cwd : undefined;
  const project = useMemo<Project>(
    () => (followedCwd && followedCwd !== chosen.path ? { ...chosen, path: followedCwd } : chosen),
    [chosen, followedCwd],
  );
  const [creating, setCreating] = useState(false);
  /* The settings used to be a window of its own on the body, which is why it
     could not be docked anywhere — "why can I grab the settings and dock them
     nowhere?". It is a panel in the dock like everything else now, and the
     shell only asks for it. */
  const openSettings = useCallback(() => setFocus({ kind: "doc", id: "settings" }), []);
  // The readout is off unless somebody asked for it: a frame loop that is
  // always running is a measuring instrument that changes what it measures.
  const [meter, setMeter] = useState(false);
  /* Do not disturb, from the shared settings: the service says nothing while
     it is on, and the status row says so, because silence that is not shown
     looks like notifications that broke. */
  const [dnd, setDnd] = useState(false);
  // The seq of the last click on a notification this page has acted on or
  // started with; the revision watch opens a session when it changes.
  const focusSeen = useRef<number | undefined>(undefined);
  // openSession, as the revision watch — started once — reaches it.
  const openRef = useRef<(id: string) => void>(() => undefined);
  const [keys, setKeys] = useState(false);
  const [templates, setTemplates] = useState(false);
  const [bench, setBench] = useState(false);
  const [shop, setShop] = useState(false);
  /* Whether the ⌘K palette is up. Held here, not in the dock, because the
     keyboard is handled here — with the guard that keeps a shortcut from
     firing while a field is being typed in. */
  const [paletteOpen, setPaletteOpen] = useState(false);
  /* What the palette opens on: what was typed into the search field in the
     top bar, and nothing when it is asked for any other way. */
  const [paletteText, setPaletteText] = useState("");
  const openPalette = useCallback((text: string) => {
    setPaletteText(text);
    setPaletteOpen(true);
  }, []);
  /* The two switches at the top are asked to open their lists by counting
     up: ⌘E and the palette live here, the lists under the switches — and the
     breadcrumb in the status bar, whose project and session name them. */
  const [sessionAsk, setSessionAsk] = useState(0);
  const [projectAsk, setProjectAsk] = useState(0);
  // The panel in front of main, as the dock reports it, for the status bar.
  const [front, setFront] = useState<FrontPanel>({ id: "", title: "", params: {} });
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
        setDnd(Boolean(p.dnd));
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
        // The last click on a notification is remembered, not acted on: a
        // page that has just started has nothing to bring forward yet.
        focusSeen.current ??= requestedFocus(prefs)?.seq;
        const kept = (prefs as { theme?: Partial<ThemeState> }).theme;
        // Fitted only now: which palettes belong to which skin is not known
        // until the daemon has said what it serves, one line above. A look the
        // daemon kept from before the skins brought their packs follows the
        // skin from now on, and is kept that way once (lib/iconChoice.ts).
        const state = fitPalette(kept ? { ...load(), ...migrateIcons(kept) } : load());
        if (kept && kept.iconsVersion !== ICONS_VERSION) save(state);
        else adopt(state);
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
              // The panels that keep a key of their own in the blob — the
              // notes, the overview's density — follow the same revision.
              announcePrefs(prefs as Record<string, unknown>);
              setDnd(Boolean((prefs as { dnd?: unknown }).dnd));
              // A click on a notification: the plxr window wrote which
              // session it was about, and this is the page's cue to open it.
              const wanted = freshFocus(prefs, focusSeen.current);
              if (wanted) {
                focusSeen.current = wanted.seq;
                openRef.current(wanted.id);
              }
              if (prefs.theme) {
                const state = fitPalette({ ...load(), ...migrateIcons(prefs.theme) });
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
   * Two guards. A field being typed in — the project switch's folder, the palette's own
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
        // Esc in the terminal is the terminal's — vi, less and every TUI
        // read it — and never closes a window sitting somewhere else.
        if (fromTerminal(e)) return;
        if (keys) setKeys(false);
        else if (templates) setTemplates(false);
        else if (creating) setCreating(false);
        else if (document.querySelector(".backdrop, .paletteScrim")) return;
        else return;
        return;
      }
      const fire = (action: Action, run: () => void) => {
        if (!matches(e, action)) return false;
        if (editing && !hasModifier(bindingOf(action))) return false;
        e.preventDefault();
        run();
        return true;
      };
      /* ⌘1…9 and the review's key: the board by the first, a tool by each
         other — shown and given the keyboard, given the keyboard back, or put
         away when it already has it. From a field inside a tool window they
         still reach the tools: the press that puts a window away is made from
         inside it. Every other key stays the field's. */
      const chords = () => {
        for (let i = 0; i < VIEW_ACTIONS.length; i++) {
          const id = CHORD_ORDER[i];
          if (fire(VIEW_ACTIONS[i], () => setFocus(isTool(id) ? { kind: "tool", id, how: "chord" } : { kind: "doc", id }))) return true;
        }
        return fire("toolReview", () => setFocus({ kind: "tool", id: "review", how: "chord" }));
      };
      if (typing) {
        if (target?.closest?.(".toolWindow")) chords();
        return;
      }
      if (fire("help", () => setKeys(true))) return;
      if (
        fire("palette", () => {
          setPaletteText("");
          setPaletteOpen((v) => !v);
        })
      )
        return;
      if (fire("workbench", () => setBench((b) => !b))) return;
      if (fire("workshop", () => setShop((v) => !v))) return;
      if (fire("newSession", () => setCreating(true))) return;
      if (fire("newShell", () => direct({ type: "newShell" }))) return;
      if (fire("settings", openSettings)) return;
      // Not from a text area being written in; the terminal reads its keys
      // through one too, and from there the switch is wanted most.
      if (!(target?.tagName === "TEXTAREA" && !fromTerminal(e)) && fire("sessionSwitch", () => setSessionAsk((n) => n + 1))) return;
      if (chords()) return;
    }
    // On window, where the palette's ⌘K always listened: a key pressed
    // anywhere reaches it, and the checks that dispatch to window reach it too.
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `direct` is declared further down and never changes (useCallback, no
    // deps); it is read when a key is pressed, long after the render that
    // declared it. Listing it here would read it before its declaration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, templates, creating]);

  const shown = useMemo(() => {
    const needle = here.trim().toLowerCase();
    if (!needle) return tiles;
    return tiles.filter((t) => t.cwd.toLowerCase().includes(needle) || t.name.toLowerCase().includes(needle));
  }, [tiles, here]);

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
  // Which tool shows at each edge, as the dock reports it, for the MENU's ticks.
  const [openTools, setOpenTools] = useState<ShownTools>({ left: null, right: null, bottom: null });
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
    (preset: Preset) => {
      const kept = presets.filter((p) => p.name !== preset.name);
      writePresets([...kept, preset]);
      setCurrentPreset(preset.name);
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
      direct({ type: "apply", arg: p });
    },
    [direct],
  );

  /* The LAYOUTS menu, at the button. The same entries the palette offers,
     under the pointer: arrange for an activity, bring back a saved
     arrangement, keep the current one, rename or drop the one in use. */
  const layoutItems = useCallback((): MenuItem[] => {
    const items: MenuItem[] = ACTIVITIES.map((a) => ({
      label: tr("layouts.arrange", "Arrange for {activity}", { activity: activityLabel(a) }),
      do: `arrange-${a}`,
      onClick: () => direct({ type: "activity", arg: a }),
    }));
    items.push({ separator: true });
    if (presets.length === 0) {
      items.push({ label: tr("layouts.none", "no saved layouts yet"), onClick: () => undefined, disabled: true });
    } else {
      for (const p of presets) {
        items.push({ label: tr("layouts.apply", "Apply {name}", { name: p.name }), do: "apply-layout", onClick: () => applyPreset(p) });
      }
    }
    items.push({ separator: true });
    items.push({ label: tr("layouts.saveAs", "Save current as…"), do: "save-layout", onClick: () => setLayoutAsk("save") });
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
    items.push({ label: tr("palette.resetLayout", "Reset the panel layout"), do: "reset-layout", onClick: () => direct({ type: "reset" }) });
    // A saved layout moves tools as well; this puts every one back where it started.
    items.push({ label: tr("tool.reset", "Reset tool positions"), do: "reset-tools", onClick: () => direct({ type: "resetTools" }) });
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
     session — its tile, its row in the session switch, its title. */
  const menuItems = useCallback((): MenuItem[] => {
    const items: MenuItem[] = [
      { label: tr("menu.search", "Search commands…"), hint: caption(bindingOf("palette")), onClick: () => openPalette("") },
      { separator: true },
      { header: true, label: tr("menu.actions", "Actions") },
      { label: tr("palette.newSession", "New session"), hint: caption(bindingOf("newSession")), onClick: () => setCreating(true) },
      { label: tr("palette.newShell", "New shell here"), hint: caption(bindingOf("newShell")), onClick: () => direct({ type: "newShell" }) },
      { label: tr("palette.sessionGrid", "Session grid"), onClick: () => direct({ type: "grid" }) },
      { label: tr("palette.templates", "Templates"), onClick: () => setTemplates(true) },
      { label: tr("palette.settings", "Settings"), hint: caption(bindingOf("settings")), onClick: openSettings },
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
      /* The tools and the documents are two groups, because they are two
         things: a tool is shown and hidden — ticked while it shows, and the
         same row puts it away — and a document is opened in main. */
      { header: true, label: tr("menu.toolWindows", "Tool windows") },
      ...TOOLS.map((t) => ({
        label: tr(t.key, t.fallback),
        hint: (t.id === "review" ? (bindingOf("toolReview") ? caption(bindingOf("toolReview")) : "") : chordOf(t.id)) || undefined,
        checked: Object.values(openTools).includes(t.id),
        onClick: () => setFocus({ kind: "tool", id: t.id, how: "toggle" }),
      })),
      { separator: true },
      { header: true, label: tr("menu.documents", "Documents") },
      { label: tr(DOCS.overview.key, DOCS.overview.fallback), hint: chordOf("overview") || undefined, do: "doc-overview", onClick: () => setFocus({ kind: "doc", id: "overview" }) },
      { label: tr("switch.overview", "Project overview"), do: "doc-folders", onClick: () => setFocus({ kind: "doc", id: "folders" }) },
      { label: tr(DOCS.settings.key, DOCS.settings.fallback), hint: caption(bindingOf("settings")), do: "doc-settings", onClick: openSettings },
      { separator: true },
      { header: true, label: tr("menu.help", "Help") },
      { label: tr("keys.title", "Keyboard"), hint: caption(bindingOf("help")), onClick: () => setKeys(true) },
    ];
    return items;
  }, [herd.halted, bench, shop, meter, direct, toggleMeter, openTools, openSettings, openPalette]);

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
      { id: "cmd:newshell", group: tr("palette.action", "Action"), label: tr("palette.newShell", "New shell here"), hint: caption(bindingOf("newShell")), run: () => direct({ type: "newShell" }) },
      { id: "cmd:switchsession", group: tr("palette.action", "Action"), label: tr("palette.switchSession", "Switch session…"), hint: caption(bindingOf("sessionSwitch")), run: () => setSessionAsk((n) => n + 1) },
      { id: "cmd:switchproject", group: tr("palette.action", "Action"), label: tr("palette.switchProject", "Switch project…"), run: () => setProjectAsk((n) => n + 1) },
      { id: "cmd:grid", group: tr("palette.action", "Action"), label: tr("palette.sessionGrid", "Session grid"), run: () => direct({ type: "grid" }) },
      { id: "cmd:settings", group: tr("palette.action", "Action"), label: tr("palette.settings", "Settings"), run: openSettings },
      { id: "cmd:templates", group: tr("palette.action", "Action"), label: tr("palette.templates", "Templates"), run: () => setTemplates(true) },
      { id: "cmd:reset", group: tr("palette.action", "Action"), label: tr("palette.resetLayout", "Reset the panel layout"), run: () => direct({ type: "reset" }) },
      { id: "cmd:resettools", group: tr("palette.action", "Action"), label: tr("tool.reset", "Reset tool positions"), run: () => direct({ type: "resetTools" }) },
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
      resetTools: () => direct({ type: "resetTools" }),
    }),
    [presets, currentPreset, direct, applyPreset],
  );
  /* What the board's and the stripes' own menus can ask of the shell: the same
     verbs the header MENU has. A new shell starts in the project's folder —
     the home folder when there is no project — and lands where a new session
     lands; if the service refuses, the start dialog says why. */
  const shell = useMemo<ShellActions>(
    () => ({
      newSession: () => setCreating(true),
      newShell: () =>
        void api
          .create(project.path, [])
          .then((s) => setFocus({ kind: "session", id: s.id, name: s.name || s.id }))
          .catch(() => setCreating(true)),
      templates: () => setTemplates(true),
      resetLayout: () => direct({ type: "reset" }),
    }),
    [project.path, direct],
  );
  // Opening a session from outside the dock — a new one just created, a row of
  // the session switch — asks the dock to bring it up; inside the dock the
  // tiles call the dock directly.
  function openSession(id: string) {
    const t = tiles.find((x) => x.id === id);
    // Asked for by name, it is the project now — even when its panel is
    // already the one in front, which dockview does not report again.
    sessionFront(id);
    setFocus({ kind: "session", id, name: t ? titleOf(t) : id });
  }

  /* A click on a notification.
   *
   * The plxr window posts the notifications from its own process, and a click
   * there reaches this page through the settings — {focusSession} on the
   * revision watch above, see lib/focus.ts. Read through a ref so the watch,
   * started once, opens against the current tiles. */
  openRef.current = openSession;

  /* A folder or the file named in the status bar, shown in the Files tool.
     The tool follows the project, so a place under another root makes that
     root the project first — its session, or its folder — and the tree takes
     the request once it stands on that root. */
  function revealInFiles(rootId: string, root: string, rel: string) {
    if (rootId && rootId !== rootIdOf(project)) {
      if (rootId.startsWith("dir:")) pickProject(root);
      else sessionFront(rootId);
    }
    askReveal(root, rel);
    setFocus({ kind: "tool", id: "files", how: "reveal" });
  }

  // What the pause button says it does, in the tooltip and to a screen reader.
  const brakeName = herd.halted ? tr("header.resumeAll", "Resume all sessions") : tr("header.pauseAll", "Pause all sessions");

  return (
    <div className="app">
      <header className="bar" onDoubleClick={(event) => zoomWindow(event.target)}>
        <div className="brand">
          <span className="mark"><Logo /></span>
          <span className="wordmark">plxr</span>
        </div>

        {/* The project the tools follow and the session in front, each a
            switch with its list under it. They replace the path field. */}
        <ProjectSwitch
          project={project}
          here={here}
          tiles={tiles}
          asked={projectAsk}
          onPick={pickProject}
          onAll={allProjects}
          onOverview={() => setFocus({ kind: "doc", id: "folders" })}
        />
        <SessionSwitch
          tiles={tiles}
          project={project}
          front={frontSession}
          waiting={needsAnswer}
          asked={sessionAsk}
          onOpen={openSession}
          onBoard={() => setFocus({ kind: "doc", id: "overview" })}
          onNew={() => setCreating(true)}
          onNewShell={() => direct({ type: "newShell" })}
        />

        <div className="draghandle" />

        {/* The search in the middle of the bar, with its chord in it: what is
            typed opens the palette on it. */}
        <BarSearch onOpen={openPalette} />

        <div className="draghandle" />

        {/* Icons, each with a tooltip naming what it does and its key; only
            + NEW keeps its word, at the top right where new things start. */}
        <div className="tools">
          {herd.running > 0 || herd.halted ? (
            <Tooltip text={herd.halted ? brakeName : tr("header.brakeTip", "Pause every session at once — nothing is lost, they carry on where they stopped")}>
              <Button
                icon
                on={herd.halted}
                data-do="pause-all"
                aria-pressed={herd.halted}
                aria-label={brakeName}
                onClick={() => (herd.halted ? api.releaseBrake() : api.emergencyBrake())}
              >
                <Icon name={herd.halted ? "play" : "pause"} />
              </Button>
            </Tooltip>
          ) : null}
          {/* The three edges of the dock, shown and hidden the way ⌘B ⌥⌘B ⌘J do. */}
          <EdgeToggles shown={openTools} onToggle={(edge) => direct({ type: "toggleEdge", arg: edge })} />
          <Tooltip text={tr("header.resetLayout", "Reset the panel layout to the default")}>
            <Button
              icon
              data-do="reset-layout"
              aria-label={tr("header.resetLayout", "Reset the panel layout to the default")}
              onClick={() => direct({ type: "reset" })}
            >
              <Icon name="reset" />
            </Button>
          </Tooltip>
          {/* Opens under the button: the pointer is where the eye is, and the
              same menu serves the right-click everywhere else. */}
          <Tooltip text={`${tr("header.layoutsName", "Layouts")} — ${tr("header.layoutsTip", "Arrange the panels: for an activity, or as you saved them")}`}>
            <Button
              icon
              data-do="layouts"
              aria-haspopup="menu"
              aria-label={tr("header.layoutsName", "Layouts")}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                menu.open(Math.round(r.left), Math.round(r.bottom + 4), layoutItems());
              }}
            >
              <Icon name="layout" />
            </Button>
          </Tooltip>
          <Tooltip text={tr("keys.tip", "Keyboard shortcuts")}>
            <Button icon data-do="keys" aria-label={tr("keys.tip", "Keyboard shortcuts")} onClick={() => setKeys(true)}>
              <Icon name="help" />
            </Button>
          </Tooltip>
          {/* The same button both ways. It only ever set the panel open, so the
              way back out was the DONE button at the bottom of a panel long
              enough to have scrolled it off the screen. */}
          <Tooltip text={bindingOf("settings") ? `${tr("header.settingsTip", "Settings")} ${caption(bindingOf("settings"))}` : tr("header.settingsTip", "Settings")}>
            <Button icon data-do="settings" aria-label={tr("header.settingsTip", "Settings")} onClick={openSettings}>
              <Icon name="settings" />
            </Button>
          </Tooltip>
          {/* Everything, under one button. The tools were reachable by F12 and
              nothing else; the views by one column beside the work. */}
          <Tooltip text={`${tr("header.menuName", "Menu")} — ${tr("header.menuTip", "Every action and setting, grouped")}`}>
            <Button
              icon
              data-do="menu"
              aria-haspopup="menu"
              aria-label={tr("header.menuName", "Menu")}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                menu.open(Math.round(r.left), Math.round(r.bottom + 4), menuItems());
              }}
            >
              <Icon name="menu" />
            </Button>
          </Tooltip>
          <Tooltip text={`${tr("palette.templates", "Templates")} — ${tr("header.templatesTip", "Saved working sets")}`}>
            <Button icon data-do="templates" aria-label={tr("palette.templates", "Templates")} onClick={() => setTemplates(true)}>
              <Icon name="templates" />
            </Button>
          </Tooltip>
          <Tooltip text={bindingOf("newSession") ? `${tr("palette.newSession", "New session")} ${caption(bindingOf("newSession"))}` : tr("palette.newSession", "New session")}>
            <Button primary data-do="new-session" onClick={() => setCreating(true)}>
              <Icon name="plus" />
              {tr("header.new", "NEW")}
            </Button>
          </Tooltip>
        </div>
      </header>

      <UpdateBar />
      <NotifyAsk />

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
            project={project}
            onSessionFront={sessionFront}
            onToolsChanged={setOpenTools}
            connected={connected}
            counts={{ inbox: needsAnswer }}
            openSession={openSession}
            onReplaced={openSession}
            shell={shell}
            layouts={layoutControls}
            focus={focus}
            layoutAction={layoutAction}
            onLayoutSaved={savePreset}
            appCommands={appCommands}
            paletteOpen={paletteOpen}
            paletteText={paletteText}
            onClosePalette={() => setPaletteOpen(false)}
            onOpenPalette={() => openPalette("")}
            onFront={setFront}
          />
        </main>
          </div>
        </div>
        {bench ? <Workbench onClose={() => setBench(false)} /> : null}
        {shop ? <Workshop onClose={() => setShop(false)} /> : null}
      </div>

      {/* The one status line, under the bottom stripe: where the work in
          front is, and what is true about it and about the machine. */}
      <StatusBar
        front={front}
        tiles={tiles}
        project={project}
        dnd={dnd}
        counts={
          connected ? (
            <>
              {countsLine(herd)}
              {shown.length !== tiles.length ? (
                <span className="hiding">
                  {" · "}
                  {tr("header.filtered", "{shown} of {total} shown", { shown: shown.length, total: tiles.length })}
                </span>
              ) : null}
            </>
          ) : (
            tr("conn.lost", "Connection lost, trying again …")
          )
        }
        onProject={() => setProjectAsk((n) => n + 1)}
        onSession={() => setSessionAsk((n) => n + 1)}
        onReveal={revealInFiles}
        onUsage={() => setFocus({ kind: "tool", id: "usage", how: "reveal" })}
      />

      {meter ? <Meter /> : null}

      <div className="fx" />

      {/* A window of its own on the body — see ui/Window — not a column
          beside the work: it is dragged where it is not in the way. */}
      {keys ? <Keys onClose={() => setKeys(false)} /> : null}
      {templates ? <Templates onClose={() => setTemplates(false)} /> : null}

      {layoutAsk === "save" ? (
        <Ask
          heading={tr("layouts.saveHead", "Save this arrangement")}
          detail={tr("layouts.saveDetail", "The panels as they stand now, with the tool windows, their sizes and where each tool stands, under a name of your own. Saving under a name already in the list replaces it.")}
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
