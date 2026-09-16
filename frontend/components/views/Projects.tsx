"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Tooltip from "@/components/ui/Tooltip";
import ToolActions from "@/components/stripes/ToolActions";
import ToolNote from "@/components/stripes/ToolNote";
import { useContextMenu, type MenuItem } from "@/components/ui/Menu";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import { projectLabel, samePath, type Project } from "@/lib/project";
import { stateOf } from "@/lib/state";
import type { Tile, Workspace } from "@/lib/types";

/* Every project there is, and the folders worked in under them.
 *
 * The project switch at the top says which project the tools follow and lets
 * one be picked, but it is a menu: it is open for as long as a pick takes and
 * says nothing while it is closed. This is the other half he asked for
 * (translated, 14.09.2026): "a project overview on the left, global. and then
 * inside a project the sub-projects again as a panel of their own" — a list
 * that stands open beside the work, with what is going on in each project on
 * it.
 *
 * A project is a folder plxr holds open, or a folder a session runs in. A
 * sub-project is a folder under one of those that a session runs in — that is
 * what a sub-project is here: somewhere work is actually happening, not every
 * directory on the disk. They stand under their project, indented, and are
 * picked the same way.
 *
 * What a row says about its project: how many sessions want an answer, how
 * many are working, how many there are. Those are the same words and colours
 * the board uses (lib/state).
 */

type Row = {
  path: string;
  name: string;
  // A folder under another project's folder is shown under it.
  under: string;
  // How many projects it lies in, which is how far in it is drawn.
  deep: number;
  workspace?: Workspace;
};

// What is going on in a folder: the sessions in it and in everything under it.
function countIn(tiles: Tile[], path: string): { total: number; asks: number; busy: number } {
  const here = path.replace(/\/+$/, "");
  const mine = tiles.filter((t) => t.cwd === here || t.cwd.startsWith(`${here}/`));
  return {
    total: mine.length,
    asks: mine.filter((t) => ["permission", "waiting"].includes(stateOf(t))).length,
    busy: mine.filter((t) => stateOf(t) === "working").length,
  };
}

/* The rows, from the folders plxr holds open and the folders sessions run in.
   A folder under another one is a sub-project of it; the longest folder that
   contains it wins, so a folder three deep stands under its nearest parent. */
export function rowsOf(places: Workspace[], tiles: Tile[]): Row[] {
  const known = new Map<string, Row>();
  const add = (path: string, workspace?: Workspace) => {
    const key = path.replace(/\/+$/, "");
    if (!key) return;
    const had = known.get(key);
    if (had) {
      if (workspace && !had.workspace) had.workspace = workspace;
      return;
    }
    known.set(key, { path: key, name: workspace?.label || projectLabel({ path: key, sessionId: "" }), under: "", deep: 0, workspace });
  };
  for (const w of [...places].sort((a, b) => b.used_at - a.used_at)) add(w.path, w);
  for (const t of tiles) if (t.cwd) add(t.cwd);

  /* A folder somebody's shell happened to stand in is not a project.
   *
   * Every folder a session ever ran in used to stand here, and a shell started
   * in the home folder or in /Volumes put those in the list — with the real
   * projects underneath them, as if the disk were the thing being worked on
   * ("and what the fuck is that supposed to be?", 15.09.2026).
   *
   * So a folder stays only when it is one of two things: one he opened himself
   * — that is what the folders plxr holds open are — or one a session is
   * actually running in, not merely above. Everything else is a parent that
   * came along for the ride and goes. */
  const sessionsIn = (path: string) => tiles.filter((t) => (t.cwd ?? "").replace(/\/+$/, "") === path).length;
  for (const row of [...known.values()]) {
    if (row.workspace || sessionsIn(row.path) > 0) continue;
    const isParent = [...known.keys()].some((other) => other !== row.path && other.startsWith(`${row.path}/`));
    if (isParent) known.delete(row.path);
  }

  const paths = [...known.keys()];
  for (const row of known.values()) {
    const parents = paths.filter((p) => p !== row.path && row.path.startsWith(`${p}/`));
    row.under = parents.sort((a, b) => b.length - a.length)[0] ?? "";
    row.deep = parents.length;
  }
  /* Projects first, each followed by what is under it. A project with a
     session waiting comes before one without, then the one used last. */
  const roots = [...known.values()].filter((r) => !r.under);
  const weight = (r: Row) => {
    const n = countIn(tiles, r.path);
    return n.asks > 0 ? 0 : n.busy > 0 ? 1 : n.total > 0 ? 2 : 3;
  };
  const used = (r: Row) => r.workspace?.used_at ?? 0;
  roots.sort((a, b) => weight(a) - weight(b) || used(b) - used(a) || a.name.localeCompare(b.name));
  const out: Row[] = [];
  for (const root of roots) {
    out.push(root);
    const kids = [...known.values()].filter((r) => r.under === root.path).sort((a, b) => a.path.localeCompare(b.path));
    out.push(...kids);
  }
  // A folder whose parent is not a project of its own still belongs somewhere.
  for (const row of known.values()) if (row.under && !out.includes(row)) out.push(row);
  return out;
}

export default function Projects({ tiles, project, onPick }: { tiles: Tile[]; project: Project; onPick: (path: string) => void }) {
  const ctx = useContextMenu();
  // Null until the service has answered: no row before there is an answer.
  const [places, setPlaces] = useState<Workspace[] | null>(null);
  const load = useCallback(() => {
    void api
      .workspaces()
      .then((list) => setPlaces(list ?? []))
      .catch(() => setPlaces([]));
  }, []);
  useEffect(() => load(), [load]);

  const rows = places === null ? [] : rowsOf(places, tiles);
  const roots = rows.filter((r) => !r.under).length;

  const menuOf = (row: Row): MenuItem[] => [
    { label: tr("projects.pick", "Follow this project"), onClick: () => onPick(row.path) },
    { separator: true },
    { label: tr("files.copy", "COPY PATH"), onClick: () => void navigator.clipboard?.writeText(row.path).catch(() => undefined) },
    ...(row.workspace
      ? [
          { separator: true as const },
          {
            label: tr("folders.remove", "Remove folder"),
            danger: true,
            onClick: () =>
              void api
                .closeWorkspace(row.workspace!.id)
                .then(load)
                .catch(() => undefined),
          },
        ]
      : []),
  ];

  return (
    <section className="list">
      <ToolNote>
        <span className="meta">{places === null ? "" : tr("projects.count", "{n} projects", { n: roots })}</span>
      </ToolNote>
      <ToolActions>
        <Tooltip text={tr("projects.reloadTip", "Ask again which folders are open")}>
          <Button icon data-do="projects-reload" aria-label={tr("common.reload", "RELOAD")} onClick={load}>
            <Icon name="reset" />
          </Button>
        </Tooltip>
      </ToolActions>
      <div className="listbody">
        {places === null ? null : rows.length === 0 ? (
          <div className="emptyNote">
            <b>{tr("projects.emptyHead", "no projects yet")}</b>
            {tr("projects.empty", "A folder opened at the top, or a session started in one, stands here.")}
          </div>
        ) : (
          rows.map((row) => {
            const n = countIn(tiles, row.path);
            const lit = project.path !== "" && samePath(row.path, project.path);
            return (
              <Tooltip key={row.path} text={row.path} place="right">
                <div
                  className="frow"
                  data-project={row.path}
                  data-at={lit ? "yes" : "no"}
                  data-under={row.under ? "yes" : "no"}
                  role="button"
                  tabIndex={0}
                  aria-pressed={lit}
                  aria-label={`${row.name} — ${row.path}`}
                  style={{ paddingLeft: `${0.5 + row.deep * 0.75}rem` }}
                  onClick={() => onPick(row.path)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPick(row.path);
                    }
                  }}
                  onContextMenu={ctx(menuOf(row))}
                >
                  <span className="fchev" />
                  <span className="ficon">
                    <Icon name="folder" />
                  </span>
                  <span className="fname">{row.name}</span>
                  {n.asks > 0 ? <span className="fgit" data-need="asks">{n.asks}</span> : null}
                  {n.total > 0 ? <span className="fgit" data-need="all">{n.total}</span> : null}
                </div>
              </Tooltip>
            );
          })
        )}
      </div>
    </section>
  );
}
