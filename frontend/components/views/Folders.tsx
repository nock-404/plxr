"use client";

import { useCallback, useEffect, useState } from "react";
import Branches from "@/components/Branches";
import Changes from "@/components/Changes";
import Difference from "@/components/Difference";
import FileSearch from "@/components/FileSearch";
import Files from "@/components/Files";
import Viewer from "@/components/Viewer";
import Button from "@/components/ui/Button";
import Splitter from "@/components/ui/Splitter";
import FolderPick from "@/components/ui/FolderPick";
import TopStrip from "@/components/ui/TopStrip";
import { api } from "@/lib/api";
// Renamed on the way in: this view already has a load() of its own.
import { apply, load as storedLook, save, type ThemeState } from "@/lib/theme";
import { errText, tr, trN } from "@/lib/i18n";
import type { GitChange, GitWhere, Workspace } from "@/lib/types";

/* Folders plxr holds open, and what is in them.
 *
 * Everything to do with files used to hang off a session, so opening a file
 * meant starting an agent first, and closing the agent took the file with it —
 * a session is cleared away shortly after it ends. A folder here has nothing to
 * do with what is running: it is open because somebody opened it.
 */
export default function Folders() {
  // null until the answer is in: "no folder open" before the list has even
  // been read is a lie, and it is the first thing this view says. See
  // emptylies.py.
  const [folders, setFolders] = useState<Workspace[] | null>(null);
  const [here, setHere] = useState<Workspace | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [line, setLine] = useState<number | undefined>(undefined);
  /* Which of the three the left column shows: the tree, a search, or what has
     changed. One at a time, because they all want the same width and reading
     two of them at once is reading neither. */
  const [side, setSide] = useState<"tree" | "find" | "changes" | "branches">("tree");
  const [diff, setDiff] = useState<{ path: string; staged: boolean } | null>(null);
  const [picking, setPicking] = useState(false);
  const [problem, setProblem] = useState("");
  const [look, setLook] = useState<ThemeState>(storedLook);
  /* Where the folder stands with git, whichever column is open.
     It used to live inside the changes panel, so looking at the tree told you
     nothing about the branch you were on or whether anything was uncommitted. */
  const [where, setWhere] = useState<GitWhere | null>(null);
  const [changed, setChanged] = useState<GitChange[] | null>(null);

  const load = useCallback(() => {
    api
      .workspaces()
      .then((list) => {
        setFolders(list);
        // The one used last, so coming back lands where you left off.
        setHere((was) => (was ? list.find((w) => w.id === was.id) ?? null : list[0] ?? null));
      })
      .catch((e) => setProblem(errText(e)));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    if (!here || here.missing) {
      setWhere(null);
      setChanged([]);
      return;
    }
    let dropped = false;
    // Not a repository at all is an ordinary answer, not a failure to report.
    api.position(here.id).then((w) => !dropped && setWhere(w)).catch(() => !dropped && setWhere(null));
    api.changes(here.id).then((c) => !dropped && setChanged(c)).catch(() => !dropped && setChanged([]));
    return () => {
      dropped = true;
    };
  }, [here, side]);

  async function open(path: string) {
    setProblem("");
    try {
      const made = await api.openWorkspace(path);
      setFolders(await api.workspaces());
      setHere(made);
      setFile(null);
    } catch (e) {
      setProblem(errText(e));
    }
  }

  async function close(id: string) {
    setProblem("");
    try {
      await api.closeWorkspace(id);
      if (here?.id === id) {
        setHere(null);
        setFile(null);
      }
      load();
    } catch (e) {
      setProblem(errText(e));
    }
  }

  return (
    <section className="list">
      <TopStrip>
        <div className="folderbar">
          {/* Two rows, because four folders and five buttons do not fit on one.
              With them on a single line the tabs wrapped into the git line and
              the whole bar became unreadable. */}
          <div className="folderbarTop">
            <span className="prompt">{tr("folders.prompt", "folders>")}</span>
            <span className="folderTabs">
              {(folders ?? []).map((w) => (
                <Button
                  bare
                  key={w.id}
                  className={`folderTab${here?.id === w.id ? " on" : ""}`}
                  data-missing={w.missing ? "yes" : undefined}
                  title={w.missing ? tr("folders.missing", "Not reachable right now — {path}", { path: w.path }) : w.path}
                  onClick={() => {
                    setHere(w);
                    setFile(null);
                    setDiff(null);
                    setLine(undefined);
                    setSide("tree");
                  }}
                >
                  {w.path.split(/[\\/]/).filter(Boolean).pop() ?? w.path}
                </Button>
              ))}
            </span>
            <span className="spacer" />
            <Button onClick={() => setPicking(true)}>{tr("folders.open", "+ FOLDER")}</Button>
          </div>

          <div className="folderbarLow">
            {where ? (
              <span className="foldergit">
                <span className="branchname" data-on="yes">
                  {where.detached
                    ? tr("git.detached", "no branch — sitting on {hash}", { hash: where.branch })
                    : where.branch}
                </span>
                {where.ahead ? <span className="branchdist">{`+${where.ahead}`}</span> : null}
                {where.behind ? <span className="branchdist">{`−${where.behind}`}</span> : null}
                {/* A count nobody can act on is a boast. This one opens the
                    list it is counting. */}
                <Button
                  bare
                  className="branchword"
                  disabled={!changed?.length}
                  onClick={() => setSide("changes")}
                  title={changed?.length ? tr("git.showThem", "Show which ones") : undefined}
                >
                  {changed === null
                    ? tr("git.reading", "reading…")
                    : changed.length
                      ? trN("git.files", changed.length, "{n} file changed", "{n} files changed")
                      : tr("git.cleanShort", "nothing changed")}
                </Button>
              </span>
            ) : null}
            <span className="spacer" />
            {here && !here.missing ? (
              <>
                <Button on={side === "tree"} onClick={() => setSide("tree")}>
                  {tr("folders.tree", "FILES")}
                </Button>
                <Button on={side === "find"} onClick={() => setSide("find")}>
                  {tr("find.open", "FIND")}
                </Button>
                <Button on={side === "changes"} onClick={() => setSide("changes")}>
                  {tr("git.open", "CHANGES")}
                </Button>
                <Button on={side === "branches"} onClick={() => setSide("branches")}>
                  {tr("branch.open", "BRANCHES")}
                </Button>
              </>
            ) : null}
            {here ? (
              <Button
                onClick={() => void close(here.id)}
                title={tr("folders.closeTip", "Take it off the list. Nothing on disk is touched.")}
              >
                {tr("folders.close", "CLOSE")}
              </Button>
            ) : null}
          </div>
        </div>
      </TopStrip>

      {problem ? <div className="emptyNote">{problem}</div> : null}

      {folders === null ? null : !here ? (
        <div className="empty">
          <div className="emptybox">
            <p className="emptyhead">{tr("folders.emptyHead", "no folder open")}</p>
            <p>
              {tr(
                "folders.empty",
                "Open a folder to read and change its files. It stays open on its own — nothing has to be running in it.",
              )}
            </p>
          </div>
        </div>
      ) : here.missing ? (
        <div className="empty">
          <div className="emptybox">
            <p className="emptyhead">{tr("folders.goneHead", "not reachable")}</p>
            <p>{tr("folders.gone", "{path} is not there right now. It stays on the list and comes back with the disk.", { path: here.path })}</p>
          </div>
        </div>
      ) : (
        <div className="foldersbody">
          {side === "branches" ? (
            <Branches rootId={here.id} />
          ) : side === "changes" ? (
            <Changes
              rootId={here.id}
              shown={diff}
              onShow={(what) => {
                setDiff(what);
                setFile(null);
              }}
            />
          ) : side === "find" ? (
            <FileSearch
              rootId={here.id}
              onOpen={(path, at) => {
                setFile(path);
                setLine(at);
              }}
            />
          ) : (
            <Files
              rootId={here.id}
              root={here.path}
              onPick={(path) => {
                setFile(path);
                setLine(undefined);
              }}
            />
          )}

          {/* Dragged, not decreed. The column was 16.25rem in the stylesheet,
              so a path that did not fit did not fit for ever. */}
          <Splitter
            value={look.filesWidth}
            min={12}
            max={44}
            side="left"
            label={tr("folders.width", "How wide the column is")}
            onChange={(filesWidth) => {
              const next = { ...look, filesWidth };
              setLook(next);
              apply(next);
              save(next);
            }}
          />
          {diff ? (
            <Difference
              rootId={here.id}
              path={diff.path}
              staged={diff.staged}
              onClose={() => setDiff(null)}
            />
          ) : file ? (
            <Viewer sessionId={here.id} path={file} line={line} onClose={() => setFile(null)} />
          ) : (
            <div className="empty">
              <div className="emptybox">
                <p className="emptyhead">{tr("folders.pickHead", "pick a file")}</p>
                <p>{tr("folders.pick", "Choose one on the left to read or change it.")}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {picking ? (
        <FolderPick
          start={here?.path ?? ""}
          onCancel={() => setPicking(false)}
          onChoose={(path) => {
            setPicking(false);
            void open(path);
          }}
        />
      ) : null}
    </section>
  );
}
