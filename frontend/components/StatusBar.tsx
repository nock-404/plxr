"use client";

import { Fragment, useEffect, useState } from "react";
import type { ReactNode } from "react";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Tooltip from "@/components/ui/Tooltip";
import Limits from "@/components/Limits";
import Pace from "@/components/Pace";
import type { FrontPanel } from "@/components/Dock";
import { useCaret } from "@/lib/caret";
import { fileIcon } from "@/lib/fileIcons";
import { clock } from "@/lib/format";
import { tr } from "@/lib/i18n";
import type { IconName } from "@/lib/icons";
import { bindingOf, caption } from "@/lib/keymap";
import { projectLabel, rootIdOf, type Project } from "@/lib/project";
import { titleOf } from "@/lib/state";
import { useBranch } from "@/lib/useBranch";
import type { Tile } from "@/lib/types";

/* The one status line, along the foot of the window.
 *
 * There used to be two lines of status and neither said where the work was:
 * a row under the top bar with the session counts, the limits, the spend and
 * the clock, and nothing at all about the file or the terminal in front. This
 * is the line every editor has at the bottom (OFFEN.md P7, D4). On the left,
 * where the panel in front of main is: its project, the folders down to the
 * file for an editor or a diff, or the session for a terminal — each part a
 * button that does what it names. On the right, what is true about it — the
 * branch, and for an editor the cursor, the line endings and the encoding —
 * and then what the old row said about the machine.
 */

type Crumb =
  | { kind: "project"; label: string }
  | { kind: "folder" | "file"; label: string; rel: string | null; icon?: IconName }
  | { kind: "session"; label: string }
  | { kind: "doc"; label: string };

// Where the panel in front is: the root it belongs to and the parts of its path.
type Place = { rootId: string; root: string; reported: string; crumbs: Crumb[] };

const baseName = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? "";

function placeOf(front: FrontPanel, tiles: Tile[], project: Project): Place {
  const noProject = tr("switch.noProject", "No project");
  const id = front.id;
  if (id.startsWith("editor:") || id.startsWith("diff:")) {
    const rootId = String(front.params.rootId ?? "");
    const tile = tiles.find((t) => t.id === rootId);
    const root = tile?.cwd ?? (rootId.startsWith("dir:") ? rootId.slice("dir:".length) : "");
    const top = root.replace(/[\\/]+$/, "");
    let path = String(front.params.path ?? "");
    if (top && path.startsWith(`${top}/`)) path = path.slice(top.length + 1);
    /* A file above the root — the tree walked out of it — is written as the
       whole path. Its folders are named, but the Files tool, which stands on
       the root, has no row for them. */
    const outside = /^([\\/]|[A-Za-z]:)/.test(path);
    const steps = path.split(/[\\/]/).filter(Boolean);
    const crumbs: Crumb[] = [{ kind: "project", label: baseName(root) || noProject }];
    steps.forEach((name, i) => {
      const rel = outside ? null : steps.slice(0, i + 1).join("/");
      crumbs.push(i === steps.length - 1 ? { kind: "file", label: name, rel, icon: fileIcon(name) } : { kind: "folder", label: name, rel });
    });
    return { rootId, root, reported: tile?.branch ?? "", crumbs };
  }
  if (id.startsWith("session:")) {
    const sessionId = id.slice("session:".length);
    const tile = tiles.find((t) => t.id === sessionId);
    const root = tile?.cwd ?? "";
    return {
      rootId: sessionId,
      root,
      reported: tile?.branch ?? "",
      crumbs: [
        { kind: "project", label: baseName(root) || noProject },
        { kind: "session", label: tile ? titleOf(tile) : front.title || sessionId },
      ],
    };
  }
  // A document of main, or nothing: the project, and the document's name.
  const tile = project.sessionId ? tiles.find((t) => t.id === project.sessionId) : undefined;
  const crumbs: Crumb[] = [{ kind: "project", label: projectLabel(project) || noProject }];
  if (id && front.title) crumbs.push({ kind: "doc", label: front.title });
  return { rootId: rootIdOf(project), root: project.path, reported: tile?.branch ?? "", crumbs };
}

export default function StatusBar({
  front,
  tiles,
  project,
  counts,
  dnd,
  onProject,
  onSession,
  onReveal,
  onUsage,
}: {
  front: FrontPanel;
  tiles: Tile[];
  project: Project;
  /* The session counts, or that the connection is lost. */
  counts: ReactNode;
  dnd: boolean;
  onProject: () => void;
  onSession: () => void;
  /* A folder or the file, shown in the Files tool: the root it is under, and
     its path relative to that root. */
  onReveal: (rootId: string, root: string, rel: string) => void;
  onUsage: () => void;
}) {
  const place = placeOf(front, tiles, project);
  const branch = useBranch(place.rootId, place.reported);
  const caret = useCaret(front.id);
  const [now, setNow] = useState("");
  useEffect(() => {
    setNow(clock(new Date()));
    const t = window.setInterval(() => setNow(clock(new Date())), 1000);
    return () => window.clearInterval(t);
  }, []);

  const sessionChord = bindingOf("sessionSwitch");
  const crumb = (c: Crumb): ReactNode => {
    switch (c.kind) {
      case "project":
        return (
          <Tooltip text={tr("status.projectTip", "Switch project")}>
            <Button bare className="statusCrumb" data-crumb="project" onClick={onProject}>
              <span className="statusCrumbIcon">
                <Icon name="folder" />
              </span>
              <span className="statusCrumbName">{c.label}</span>
            </Button>
          </Tooltip>
        );
      case "session":
        return (
          <Tooltip text={sessionChord ? `${tr("status.sessionTip", "Switch session")} ${caption(sessionChord)}` : tr("status.sessionTip", "Switch session")}>
            <Button bare className="statusCrumb" data-crumb="session" onClick={onSession}>
              <span className="statusCrumbIcon">
                <Icon name="terminal" />
              </span>
              <span className="statusCrumbName">{c.label}</span>
            </Button>
          </Tooltip>
        );
      case "folder":
      case "file": {
        const rel = c.rel;
        const inner = (
          <>
            {c.icon ? (
              <span className="statusCrumbIcon">
                <Icon name={c.icon} />
              </span>
            ) : null}
            <span className="statusCrumbName">{c.label}</span>
          </>
        );
        if (rel === null) {
          return (
            <span className="statusCrumb" data-crumb={c.kind}>
              {inner}
            </span>
          );
        }
        return (
          <Tooltip text={tr("status.revealTip", "Show {name} in the Files tool", { name: c.label })}>
            <Button bare className="statusCrumb" data-crumb={c.kind} onClick={() => onReveal(place.rootId, place.root, rel)}>
              {inner}
            </Button>
          </Tooltip>
        );
      }
      default:
        return (
          <span className="statusCrumb" data-crumb="doc">
            <span className="statusCrumbName">{c.label}</span>
          </span>
        );
    }
  };

  return (
    <div className="statusbar">
      <div className="statusCrumbs" role="navigation" aria-label={tr("status.crumbs", "Where the work in front is")}>
        {place.crumbs.map((c, i) => (
          <Fragment key={`${i}:${c.kind}:${c.label}`}>
            {i > 0 ? (
              <span className="statusCrumbSep" aria-hidden="true">
                <Icon name="chevron-right" />
              </span>
            ) : null}
            {crumb(c)}
          </Fragment>
        ))}
      </div>
      <span className="spacer" />
      <div className="statusFacts">
        {branch ? (
          <Tooltip text={tr("status.branchTip", "The branch this is on")}>
            <span className="statusItem" data-status-item="branch">
              <Icon name="git-branch" />
              <span className="statusCrumbName">{branch}</span>
            </span>
          </Tooltip>
        ) : null}
        {caret ? (
          <>
            <Tooltip text={tr("status.caretTip", "Line {line}, column {col}", { line: caret.line, col: caret.col })}>
              <span className="statusItem" data-status-item="caret">
                {caret.line}:{caret.col}
              </span>
            </Tooltip>
            <Tooltip text={tr("status.eolTip", "Line endings")}>
              <span className="statusItem" data-status-item="eol">
                {caret.eol}
              </span>
            </Tooltip>
            <Tooltip text={tr("status.encodingTip", "Encoding")}>
              <span className="statusItem" data-status-item="encoding">
                {caret.encoding}
              </span>
            </Tooltip>
          </>
        ) : null}
      </div>
      <span className="statusDivider" aria-hidden="true" />
      <span className="statusItem" data-status-item="counts">
        {counts}
      </span>
      {dnd ? <span className="dnd">{tr("notify.dndOn", "do not disturb")}</span> : null}
      {/* Every account's limits, then the spend, then the clock. */}
      <Limits onOpen={onUsage} />
      <Pace />
      <span className="statusItem" data-status-item="clock">
        {now}
      </span>
    </div>
  );
}
