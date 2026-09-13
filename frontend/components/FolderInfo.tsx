"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Changes, { word } from "@/components/Changes";
import Tooltip from "@/components/ui/Tooltip";
import { useContextMenu, type MenuItem } from "@/components/ui/Menu";
import { api } from "@/lib/api";
import { copyText } from "@/lib/browser";
import { ago, bytes, stamp } from "@/lib/format";
import { errText, tr, trN } from "@/lib/i18n";
import { FILES_CHANGED } from "@/lib/useChanges";
import type { FolderReport, GitCommitDetail, GitCommitFile } from "@/lib/types";

/* What an open folder is, in the half of the view that used to say nothing.
 *
 * The wide half of FOLDERS held an empty box reading "pick a file / Choose one
 * on the left to read or change it" across half the window — half a screen
 * saying nothing at all about the folder it was looking straight at. Every
 * fact a person looks up before touching a folder was already on the machine
 * and none of it was asked for: where the branch stands against its upstream,
 * which commit HEAD sits on and what that commit did, what is uncommitted
 * right now, where the remote is, how big the thing is and what it is written
 * in, and what its README says.
 *
 * It says nothing before it knows. `report` is null until the answer is in,
 * and no section renders until then: a panel that says "no remote" while it is
 * still asking is a panel nobody can trust the second time. See emptylies.py.
 *
 * A folder that is not a repository is an ordinary thing to have open, not a
 * failure — it gets the facts that apply to it and none of the git sections.
 */
export default function FolderInfo({
  rootId,
  shown,
  onShow,
  onEdit,
  onOpenChanges,
  withChanges = true,
}: {
  rootId: string;
  /* Which difference is open, so the changes list can light the row it is
     showing — the same pair the left column passes. */
  shown: { path: string; staged: boolean } | null;
  onShow: (what: { path: string; staged: boolean } | null) => void;
  onEdit?: (path: string) => void;
  /* The full changes panel in the left column, from the section that is a
     shortened version of it. */
  onOpenChanges?: () => void;
  /* False while the column on the left is already showing the changes list.
     The same list twice, side by side, is not twice as much information. */
  withChanges?: boolean;
}) {
  const [report, setReport] = useState<FolderReport | null>(null);
  const [problem, setProblem] = useState("");
  /* Which commit of the history is open, and what it did. Kept apart: the
     hash lights the row the moment it is clicked, the detail arrives after. */
  const [openHash, setOpenHash] = useState("");
  const [detail, setDetail] = useState<GitCommitDetail | null>(null);
  const ctx = useContextMenu();

  const load = useCallback(() => {
    let dropped = false;
    api
      .folder(rootId)
      .then((r) => {
        if (dropped) return;
        setReport(r);
        setProblem("");
      })
      .catch((e) => !dropped && setProblem(errText(e)));
    return () => {
      dropped = true;
    };
  }, [rootId]);

  useEffect(load, [load]);

  /* The folder moves under it: the changes feed fires FILES_CHANGED whenever
     the folder's state moved, and a commit made in the terminal beside this
     panel changes every second thing on it. The old report stays on screen
     until the new one is in — a flash of nothing on every keystroke of an
     agent would make it unreadable. */
  useEffect(() => {
    let drop = () => {};
    const again = () => {
      drop();
      drop = load();
    };
    window.addEventListener(FILES_CHANGED, again);
    return () => {
      drop();
      window.removeEventListener(FILES_CHANGED, again);
    };
  }, [load]);

  // A commit whose files are on screen, and the same one clicked again closes.
  function openCommit(hash: string) {
    if (openHash === hash) {
      setOpenHash("");
      setDetail(null);
      return;
    }
    setOpenHash(hash);
    setDetail(null);
    api
      .commitDetail(rootId, hash)
      .then((d) => setDetail(d))
      .catch((e) => setProblem(errText(e)));
  }

  const panelMenu = (): MenuItem[] => [
    { label: tr("git.menuRefresh", "Refresh"), onClick: () => void load() },
    ...(report ? [{ label: tr("files.copy", "COPY PATH"), onClick: () => copyText(report.path) }] : []),
  ];

  const fact = (name: string, value: string) => (
    <>
      <span className="infoname">{name}</span>
      <span className="infovalue">{value}</span>
    </>
  );

  const files = (list: GitCommitFile[]) => (
    <div className="commitfiles">
      {list.map((f) => (
        <div key={f.path} className="commitfile">
          <span className="commitpath">{f.path}</span>
          <span className="changeword">{word(f.status)}</span>
          {f.binary ? (
            <span className="changecount">{tr("git.binary", "binary")}</span>
          ) : (
            <span className="changecount">
              <span className="plus">+{f.added}</span> <span className="minus">−{f.removed}</span>
            </span>
          )}
        </div>
      ))}
    </div>
  );

  if (problem && !report) return <div className="emptyNote">{problem}</div>;
  // Nothing is claimed before the answer is in — not even that there is
  // nothing to claim.
  if (!report) return <div className="folderinfo" />;

  const f = report.facts;
  const w = report.where;

  return (
    <div className="folderinfo" onContextMenu={ctx(panelMenu())}>
      {problem ? <span className="notice warn">{problem}</span> : null}

      {/* ---- the folder itself ---- */}
      <div className="infoblock">
        <span className="infohead">{report.name}</span>
        <div className="infofacts">
          {fact(tr("folders.labelPath", "path"), report.path)}
          {fact(
            tr("folders.labelSize", "size"),
            report.facts.partial
              ? tr("folders.sizeFloor", "more than {size}", { size: bytes(f.size) })
              : bytes(f.size),
          )}
          {fact(
            tr("folders.labelHolds", "holds"),
            trN("folders.fileCount", f.files, "{n} file", "{n} files") +
              " · " +
              trN("folders.folderCount", f.folders, "{n} folder", "{n} folders"),
          )}
          {f.touched ? fact(tr("folders.labelTouched", "last touched"), `${ago(f.touched)} · ${stamp(f.touched)}`) : null}
          {f.ignored.length
            ? fact(tr("folders.labelWithout", "not counted"), f.ignored.join(", ") + (f.ignored.includes(".git") ? "" : ", .git"))
            : fact(tr("folders.labelWithout", "not counted"), ".git")}
        </div>
        {f.partial ? (
          <span className="notice">
            {tr("folders.partial", "This folder is larger than the overview walks — the counts above are a floor, not a total.")}
          </span>
        ) : null}
        {!report.repo ? (
          <span className="notice">{tr("folders.plain", "No git repository here — the rest of this page is about repositories.")}</span>
        ) : null}
      </div>

      {/* ---- languages ---- */}
      {f.languages.length ? (
        <div className="infoblock">
          <span className="infohead">{tr("folders.languagesHead", "written in")}</span>
          {f.languages.slice(0, 6).map((l) => (
            <div key={l.name} className="urow">
              <span className="ukey">{l.name}</span>
              <span className="ubar">
                <span className="ufill" style={{ width: `${l.share}%` }} />
              </span>
              <span className="uval">{`${l.share}% · ${l.files}`}</span>
            </div>
          ))}
        </div>
      ) : null}

      {/* ---- where the folder stands ---- */}
      {report.repo && w ? (
        <div className="infoblock">
          <span className="infohead">{tr("folders.standingHead", "where it stands")}</span>
          <div className="infofacts">
            {fact(
              tr("folders.labelBranch", "branch"),
              w.detached ? tr("git.detached", "no branch — sitting on {hash}", { hash: w.branch }) : w.branch,
            )}
            {fact(tr("folders.labelUpstream", "upstream"), w.upstream || tr("folders.noUpstream", "none — this branch is only here"))}
            {fact(
              tr("folders.labelDistance", "distance"),
              w.ahead || w.behind
                ? [
                    w.ahead ? tr("git.ahead", "{n} ahead", { n: w.ahead }) : "",
                    w.behind ? tr("git.behind", "{n} behind", { n: w.behind }) : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : tr("folders.level", "level with it"),
            )}
            {fact(
              tr("folders.labelTree", "working tree"),
              report.dirty
                ? [
                    report.staged ? trN("folders.stagedCount", report.staged, "{n} staged", "{n} staged") : "",
                    report.unstaged ? trN("folders.unstagedCount", report.unstaged, "{n} not staged", "{n} not staged") : "",
                    report.untracked ? trN("folders.untrackedCount", report.untracked, "{n} new", "{n} new") : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : tr("folders.treeClean", "clean"),
            )}
            {fact(
              tr("folders.labelStashes", "put aside"),
              report.stashes
                ? trN("folders.stashCount", report.stashes, "{n} stash", "{n} stashes")
                : tr("folders.noStashes", "nothing"),
            )}
            {fact(
              tr("folders.labelFetch", "last fetch"),
              report.fetched ? `${ago(report.fetched)} · ${stamp(report.fetched)}` : tr("folders.neverFetched", "never — nothing has been fetched into this copy"),
            )}
          </div>
        </div>
      ) : null}

      {/* ---- the commit HEAD sits on ---- */}
      {report.repo && report.head ? (
        <div className="infoblock">
          <span className="infohead">{tr("folders.headHead", "the commit you are on")}</span>
          <span className="infosubject">{report.head.subject}</span>
          <div className="infofacts">
            {fact(tr("folders.labelCommit", "commit"), `${report.head.hash} · ${report.head.full}`)}
            {fact(tr("folders.labelAuthor", "author"), `${report.head.author} <${report.head.email}>`)}
            {fact(tr("folders.labelMade", "made"), `${ago(report.head.when)} · ${stamp(report.head.when)}`)}
            {report.head.refs ? fact(tr("folders.labelRefs", "pointed at by"), report.head.refs) : null}
            {fact(
              tr("folders.labelTouches", "touched"),
              trN("folders.touchCount", report.head.files.length, "{n} file", "{n} files") +
                ` · +${report.head.added} −${report.head.removed}`,
            )}
          </div>
          {report.head.body ? <p className="infotext">{report.head.body}</p> : null}
          {report.head.files.length ? files(report.head.files) : null}
        </div>
      ) : null}

      {/* ---- what it has been doing ---- */}
      {report.repo && report.log.length ? (
        <div className="infoblock">
          <span className="infohead">{tr("git.recent", "lately")}</span>
          {report.log.map((c) => (
            <div key={c.hash}>
              <Tooltip text={tr("folders.commitTip", "What this commit changed")}>
                <Button
                  bare
                  className={`commitrow${openHash === c.hash ? " on" : ""}`}
                  onClick={() => openCommit(c.hash)}
                >
                  <span className="commithash">{c.hash}</span>
                  <span className="commitwhen">{ago(c.when)}</span>
                  <span className="commitsubject">{c.subject}</span>
                  <span className="commitmeta">
                    <span className="commitwhen">{c.author}</span>
                    {c.refs ? <span className="commitrefs">{c.refs}</span> : null}
                  </span>
                </Button>
              </Tooltip>
              {openHash === c.hash ? (
                detail ? (
                  detail.files.length ? (
                    files(detail.files)
                  ) : (
                    <div className="commitfiles">
                      <span className="notice">{tr("folders.commitNoFiles", "This commit changed no file inside this folder.")}</span>
                    </div>
                  )
                ) : (
                  <div className="commitfiles">
                    <span className="notice">{tr("git.reading", "reading…")}</span>
                  </div>
                )
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* ---- what has changed right now ----
          The changes list itself, not a second copy of it: the same component
          the left column shows, without the branch line and the history it
          would print twice on this page. A file clicked here opens the same
          Difference the left column opens. */}
      {report.repo && withChanges ? (
        <div className="infoblock">
          <span className="infohead">
            {tr("folders.changesHead", "what has changed")}
            {onOpenChanges ? (
              <Tooltip text={tr("folders.changesTip", "The same list in the column on the left")}>
                <Button tiny onClick={onOpenChanges}>
                  {tr("git.open", "CHANGES")}
                </Button>
              </Tooltip>
            ) : null}
          </span>
          <Changes rootId={rootId} shown={shown} onShow={onShow} onEdit={onEdit} compact />
        </div>
      ) : null}

      {/* ---- where it came from ---- */}
      {report.repo ? (
        <div className="infoblock">
          <span className="infohead">{tr("folders.remotesHead", "remotes")}</span>
          <div className="infofacts">
            {report.remotes.length
              ? report.remotes.map((r) => <Fragment key={r.name}>{fact(r.name, r.url)}</Fragment>)
              : fact(tr("folders.labelRemote", "remote"), tr("folders.noRemote", "none — this repository is only on this machine"))}
          </div>
        </div>
      ) : null}

      {/* ---- the README ---- */}
      {f.readme ? (
        <div className="infoblock">
          <span className="infohead">{f.readme_path}</span>
          <p className="infotext">{f.readme}</p>
          {f.readme_more ? (
            <span className="notice">{tr("folders.readmeMore", "The beginning of it — open the file for the rest.")}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
