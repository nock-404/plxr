"use client";

import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import {
  DockviewReact,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";

import { InlineStrip } from "@/components/ui/TopStrip";

import Overview from "@/components/views/Overview";
import Inbox from "@/components/views/Inbox";
import Folders from "@/components/views/Folders";
import Ports from "@/components/views/Ports";
import Usage from "@/components/views/Usage";
import Archive from "@/components/views/Archive";
import Session from "@/components/views/Session";
import { api } from "@/lib/api";
import type { Tile } from "@/lib/types";

/* The window as dockable panels.
 *
 * Every view and every session is a panel you can split, tab, drag and float,
 * and the arrangement is saved and comes back at the next start — so usage and
 * a terminal can be on screen at once, the way a real editor lays things out.
 * The rail stays as the launcher: clicking one opens or focuses its panel.
 *
 * The panels render inside DockviewReact, which keeps them in the React tree,
 * so the live data — the tiles, which folder you are in, the callbacks — comes
 * to them through a context provided just above the dock rather than through
 * dockview's own params, which are frozen at the moment a panel is made.
 */
type DockData = {
  tiles: Tile[];
  shown: Tile[];
  here: string;
  openSession: (id: string) => void;
  toOverview: () => void;
  onReplaced: (id: string) => void;
};

const Ctx = createContext<DockData | null>(null);
const useDock = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("a dock panel was rendered outside the dock");
  return v;
};

// The panels, each reading the live data from the context.
function OverviewPanel() {
  const d = useDock();
  return <Overview tiles={d.shown} onOpen={d.openSession} />;
}
function InboxPanel() {
  const d = useDock();
  return <Inbox tiles={d.tiles} onOpen={d.openSession} />;
}
function FoldersPanel() {
  const d = useDock();
  return <Folders place={d.here} />;
}
function PortsPanel() {
  return <Ports />;
}
function UsagePanel() {
  return <Usage />;
}
function ArchivePanel() {
  const d = useDock();
  return <Archive onOpen={d.openSession} />;
}
function SessionPanel(props: IDockviewPanelProps<{ id: string }>) {
  const d = useDock();
  const id = props.params.id;
  const tile = d.tiles.find((t) => t.id === id);
  if (!tile) {
    // The session ended or was cleared away: close this panel.
    props.api.close();
    return null;
  }
  return (
    <Session
      tile={tile}
      others={d.tiles.filter((t) => t.id !== id)}
      onBack={() => props.api.close()}
      onReplaced={(nextId) => {
        props.api.close();
        d.onReplaced(nextId);
      }}
    />
  );
}

const components = {
  overview: OverviewPanel,
  inbox: InboxPanel,
  folders: FoldersPanel,
  ports: PortsPanel,
  usage: UsagePanel,
  archive: ArchivePanel,
  session: SessionPanel,
};

const VIEW_TITLES: Record<string, string> = {
  overview: "Overview",
  inbox: "Inbox",
  folders: "Folders",
  ports: "Ports",
  usage: "Usage",
  archive: "Archive",
};

// A change from the rail: open or focus a view, or a session.
export type Focus = { kind: "view"; view: string } | { kind: "session"; id: string; name: string } | null;

export default function Dock({
  tiles,
  shown,
  here,
  openSession,
  toOverview,
  onReplaced,
  focus,
}: DockData & { focus: Focus }) {
  const apiRef = useRef<DockviewApi | null>(null);
  const restored = useRef(false);

  const data = useMemo<DockData>(
    () => ({ tiles, shown, here, openSession, toOverview, onReplaced }),
    [tiles, shown, here, openSession, toOverview, onReplaced],
  );

  // Open or focus whatever the rail asked for.
  useEffect(() => {
    const dv = apiRef.current;
    if (!dv || !focus) return;
    if (focus.kind === "view") {
      openOrFocus(dv, focus.view, focus.view, VIEW_TITLES[focus.view] ?? focus.view, {});
    } else {
      openOrFocus(dv, `session:${focus.id}`, "session", focus.name || focus.id, { id: focus.id });
    }
  }, [focus]);

  function onReady(event: DockviewReadyEvent) {
    apiRef.current = event.api;
    // Bring back the arrangement from last time; if there is none, or it does
    // not load, open the overview so the window is never blank.
    api
      .prefs()
      .then((p) => {
        const saved = (p as { dock?: object }).dock;
        if (saved && !restored.current) {
          try {
            event.api.fromJSON(saved as never);
            restored.current = true;
          } catch {
            /* a layout from an older shape: start fresh */
          }
        }
        if (event.api.panels.length === 0) {
          openOrFocus(event.api, "overview", "overview", VIEW_TITLES.overview, {});
        }
      })
      .catch(() => {
        if (event.api.panels.length === 0) {
          openOrFocus(event.api, "overview", "overview", VIEW_TITLES.overview, {});
        }
      });

    // Save the arrangement whenever it changes — debounced, because a drag
    // fires many times.
    let timer: number | undefined;
    event.api.onDidLayoutChange(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        try {
          void api.setPrefs({ dock: event.api.toJSON() });
        } catch {
          /* nothing to lose but the saved arrangement */
        }
      }, 400);
    });
  }

  return (
    <Ctx.Provider value={data}>
      <InlineStrip.Provider value={true}>
        <DockviewReact className="plxrDock" components={components} onReady={onReady} />
      </InlineStrip.Provider>
    </Ctx.Provider>
  );
}

// openOrFocus makes the panel if it is not there and brings it to the front.
function openOrFocus(
  dv: DockviewApi,
  id: string,
  component: string,
  title: string,
  params: object,
) {
  const existing = dv.getPanel(id);
  if (existing) {
    existing.api.setActive();
    return;
  }
  dv.addPanel({ id, component, title, params });
}
