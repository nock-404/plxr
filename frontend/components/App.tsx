"use client";

import { useEffect, useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import Logo from "@/components/ui/Logo";
import PathField from "@/components/ui/PathField";
import Keys from "@/components/Keys";
import NewSession from "@/components/NewSession";
import Settings from "@/components/Settings";
import Templates from "@/components/Templates";
import UpdateBar from "@/components/UpdateBar";
import Workbench, { startCapture } from "@/components/Workbench";
import Workshop, { applyStored } from "@/components/Workshop";
import Rail, { type View } from "@/components/Rail";
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
import Splitter from "@/components/ui/Splitter";
import { adopt, apply, fitPalette, load, persistVia, rememberThemes, save, type ThemeState } from "@/lib/theme";
import { useTiles } from "@/lib/useTiles";

// The control room. Title bar, status strip, rail, content — the arrangement
// stays the same in every skin; only the dressing changes.
export default function App() {
  const { tiles, connected } = useTiles();
  const [view, setView] = useState<View>("overview");
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState(false);
  const [keys, setKeys] = useState(false);
  const [templates, setTemplates] = useState(false);
  const [bench, setBench] = useState(false);
  const [shop, setShop] = useState(false);
  const [now, setNow] = useState<string>("");
  const [ports, setPorts] = useState(0);
  const [archive, setArchive] = useState(0);
  /* The look, held rather than only applied.
     It used to be handed to apply() and forgotten, which was enough while
     nothing outside the settings panel needed to know it. The handle beside a
     docked panel does: it has to show the width it is about to change. */
  const [theme, setTheme] = useState<ThemeState>(load);

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
      .then((p) => loadLanguage(chosenLanguage(p.language as string | undefined)))
      .catch(() => loadLanguage("en"));
    // The palettes come from the daemon, so an imported theme works the same as
    // a shipped one. Applied once they are in — until then the skin's own
    // defaults are already on screen.
    apply(load());
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
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const typing = (e.target as HTMLElement | null)?.tagName === "INPUT";
      if (e.key === "Escape") {
        setCreating(false);
        setSettings(false);
        setKeys(false);
        setTemplates(false);
        return;
      }
      if (typing) return;
      if (e.key === "?") setKeys(true);
      if (e.key === "F12" || ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === "i")) {
        e.preventDefault();
        if (e.shiftKey) setShop((v) => !v);
        else setBench((b) => !b);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setCreating(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

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

  const open = tiles.find((t) => t.id === openId) ?? null;
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

  function openSession(id: string) {
    setOpenId(id);
    setView("session");
  }
  function goView(v: View) {
    setView(v);
    if (v !== "session") setOpenId(null);
  }

  return (
    <div className="app">
      <header className="bar">
        <div className="brand">
          <span className="mark"><Logo /></span>
          <span className="wordmark">plxr</span>
        </div>

        <div className="filter">
          <span className="prompt">{tr("header.pathPrompt", "path>")}</span>
          {/* Completes like the field in the start dialog: the filter is a
              path too, and typing one out by hand is no better here. */}
          <PathField
            value={filter}
            onChange={setFilter}
            placeholder={tr("header.pathPlaceholder", "Filter by path")}
          />
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
          <Button icon title={tr("keys.tip", "Keyboard shortcuts")} onClick={() => setKeys(true)}>?</Button>
          {/* The same button both ways. It only ever set the panel open, so the
              way back out was the DONE button at the bottom of a panel long
              enough to have scrolled it off the screen. */}
          <Button
            icon
            on={settings}
            aria-pressed={settings}
            title={tr("header.settingsTip", "Settings")}
            onClick={() => setSettings((open) => !open)}
          >
            ⚙
          </Button>
          <Button onClick={() => setTemplates(true)}>{tr("header.templates", "TEMPLATES")}</Button>
          <Button primary onClick={() => setCreating(true)}>{tr("header.new", "+ NEW")}</Button>
        </div>
      </header>

      <UpdateBar />

      <div className="statusrow">
        <span>
          {connected ? countsLine(herd) : tr("conn.lost", "Connection lost, trying again …")}
        </span>
        <span className="spacer" />
        <span>{now}</span>
      </div>

      <div className="body">
        <Rail
          view={view}
          tiles={shown}
          openId={openId}
          counts={{ inbox: needsAnswer, ports, archive }}
          onView={goView}
          onOpen={openSession}
        />

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
          {view === "session" && open ? (
            <Session tile={open} others={tiles.filter((t) => t.id !== open.id)} onBack={() => goView("overview")} />
          ) : view === "inbox" ? (
            <Inbox tiles={tiles} onOpen={openSession} />
          ) : view === "ports" ? (
            <Ports />
          ) : view === "usage" ? (
            <Usage />
          ) : view === "archive" ? (
            <Archive onOpen={openSession} />
          ) : (
            <Overview tiles={shown} onOpen={openSession} />
          )}
        </main>

        {settings ? (
          <>
            {/* Docked on the right, so dragging the handle leftwards widens it. */}
            <Splitter
              value={theme.settingsWidth}
              min={18}
              max={52}
              side="right"
              label={tr("settings.width", "How wide the settings are")}
              onChange={(settingsWidth) => {
                const next = { ...theme, settingsWidth };
                setTheme(next);
                apply(next);
                save(next);
              }}
            />
            <Settings onClose={() => setSettings(false)} />
          </>
        ) : null}
          </div>
        </div>
        {bench ? <Workbench onClose={() => setBench(false)} /> : null}
        {shop ? <Workshop onClose={() => setShop(false)} /> : null}
      </div>

      <div className="fx" />

      {keys ? <Keys onClose={() => setKeys(false)} /> : null}
      {templates ? <Templates onClose={() => setTemplates(false)} /> : null}

      {creating ? (
        <NewSession
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
