"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Tooltip from "@/components/ui/Tooltip";
import { useMenu, type MenuItem } from "@/components/ui/Menu";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import { projectLabel, rootIdOf, samePath, type Project } from "@/lib/project";
import type { Tile, Workspace } from "@/lib/types";

// The name the window menu knows this switch's list by.
const OWNER = "project-switch";

/* The project the tools follow, and the folders it can be switched to.
 *
 * It replaces the path field, which was a place to type and nothing to read:
 * it showed what had been typed, not what the tools were following, and those
 * two were different things as soon as a session had been in front. This shows
 * the project — the session in front, or the folder picked here, whichever
 * came last — with its branch, and under it: all projects, the folders used
 * lately together with the ones sessions run in, a field to open another, and
 * the project overview.
 */
export default function ProjectSwitch({
  project,
  here,
  tiles,
  asked,
  onPick,
  onAll,
  onOverview,
}: {
  project: Project;
  /* The folder picked for the board, "" for all of them. */
  here: string;
  tiles: Tile[];
  /* Counts up each time the palette asks for the list. */
  asked: number;
  onPick: (path: string) => void;
  onAll: () => void;
  onOverview: () => void;
}) {
  const menu = useMenu();
  const button = useRef<HTMLButtonElement>(null);
  const open = menu.owner === OWNER;
  /* The folders plxr holds open, as last read. Null until the answer is in:
     the list shows no folder rows before it has asked (emptylies.py). */
  const known = useRef<Workspace[] | null>(null);

  /* The branch. A session brings its own; a folder picked on its own is asked
     about once, when it becomes the project. */
  const tile = project.sessionId ? tiles.find((t) => t.id === project.sessionId) : undefined;
  const [folderBranch, setFolderBranch] = useState<{ path: string; branch: string } | null>(null);
  useEffect(() => {
    if (project.sessionId || !project.path) return;
    let dropped = false;
    const path = project.path;
    api
      .position(rootIdOf({ path, sessionId: "" }))
      .then((w) => !dropped && setFolderBranch({ path, branch: w.detached ? "" : w.branch }))
      // Not a repository is an ordinary answer: no branch to show.
      .catch(() => !dropped && setFolderBranch({ path, branch: "" }));
    return () => {
      dropped = true;
    };
  }, [project.sessionId, project.path]);
  const branch = project.sessionId
    ? (tile?.branch ?? "")
    : folderBranch && samePath(folderBranch.path, project.path)
      ? folderBranch.branch
      : "";

  const items = (list: Workspace[] | null): MenuItem[] => {
    // The folders used lately first, then the ones sessions run in that are
    // not among them: both are places somebody has been working.
    const rows = new Map<string, { path: string; name: string; workspace?: Workspace }>();
    for (const w of [...(list ?? [])].sort((a, b) => b.used_at - a.used_at)) {
      const key = w.path.replace(/\/+$/, "");
      if (!rows.has(key)) rows.set(key, { path: w.path, name: w.label || projectLabel({ path: w.path, sessionId: "" }), workspace: w });
    }
    if (list !== null) {
      for (const t of tiles) {
        if (!t.alive || !t.cwd) continue;
        const key = t.cwd.replace(/\/+$/, "");
        if (!rows.has(key)) rows.set(key, { path: t.cwd, name: projectLabel({ path: t.cwd, sessionId: "" }) });
      }
    }
    const recent: MenuItem[] = [...rows.values()].map((r) => {
      const count = tiles.filter((t) => samePath(t.cwd, r.path)).length;
      const workspace = r.workspace;
      return {
        label: r.name || r.path,
        sub: r.path,
        hint: count > 0 ? String(count) : undefined,
        checked: project.path !== "" && samePath(r.path, project.path),
        onClick: () => onPick(r.path),
        context: () => [
          { label: tr("files.copy", "COPY PATH"), onClick: () => void navigator.clipboard?.writeText(r.path).catch(() => undefined) },
          ...(workspace
            ? [
                { separator: true as const },
                { label: tr("folders.remove", "Remove folder"), danger: true, onClick: () => void api.closeWorkspace(workspace.id).catch(() => undefined) },
              ]
            : []),
        ],
      };
    });
    return [
      { label: tr("switch.allProjects", "All projects"), checked: !here && !project.path, onClick: onAll },
      ...(recent.length ? [{ separator: true as const }, { header: true as const, label: tr("switch.recent", "Recent") }, ...recent] : []),
      { separator: true },
      { field: true, label: tr("switch.openFolder", "Open folder…"), onSubmit: onPick },
      { separator: true },
      { label: tr("switch.overview", "Project overview"), onClick: onOverview },
    ];
  };

  const toggle = () => {
    if (menu.owner === OWNER) {
      menu.close();
      return;
    }
    const el = button.current;
    if (!el) return;
    // Asked first and opened with the answer, so the rows do not arrive one
    // by one under the pointer.
    void api
      .workspaces()
      .catch(() => [] as Workspace[])
      .then((list) => {
        known.current = list ?? [];
        const r = el.getBoundingClientRect();
        menu.open(Math.round(r.left), Math.round(r.bottom + 4), items(known.current), { owner: OWNER, anchor: el });
      });
  };

  // The palette asks by counting up; the first render is not a request.
  const seen = useRef(asked);
  useEffect(() => {
    if (asked === seen.current) return;
    seen.current = asked;
    toggle();
    // Only a new request is a reason to act.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);

  // The session counts and the ticked row follow while the list is up.
  useEffect(() => {
    if (open) menu.refresh(OWNER, items(known.current));
    // The menu itself is left out: refreshing it is what changes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles, project, here]);

  const name = projectLabel(project);
  return (
    <Tooltip
      text={
        project.path
          ? tr("switch.projectTip", "The project the tools follow: {path}", { path: project.path })
          : tr("switch.projectNoneTip", "Pick the folder the tools follow")
      }
    >
      <Button
        bare
        ref={button}
        className="switch"
        data-switch="project"
        data-open={open ? "yes" : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="switchIcon">
          <Icon name="folder" />
        </span>
        <span className="switchLabel">{name || tr("switch.noProject", "No project")}</span>
        {branch ? <span className="switchBranch">{branch}</span> : null}
        <span className="switchChevron">
          <Icon name="chevron-down" />
        </span>
      </Button>
    </Tooltip>
  );
}
