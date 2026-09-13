"use client";

import { useCallback, useEffect, useState } from "react";
import Branches from "@/components/Branches";
import Changes from "@/components/Changes";
import Difference from "@/components/Difference";
import FileSearch from "@/components/FileSearch";
import Files from "@/components/Files";
import FolderInfo from "@/components/FolderInfo";
import Button from "@/components/ui/Button";
import Tooltip from "@/components/ui/Tooltip";
import { useContextMenu, type MenuItem } from "@/components/ui/Menu";
import OverflowBar from "@/components/ui/OverflowBar";
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
export default function Folders({
  place,
  onOpenFile,
}: {
  place?: string;
  /* A file picked in the tree or found by a search opens as an editor panel
     beside this one, at the line when there is one. The view used to hold the
     editor itself, in the column beside the tree; a panel can be put next to
     the terminal the file is about, which the column could not. */
  onOpenFile: (rootId: string, path: string, line?: number) => void;
}) {
  // null until the answer is in: "no folder open" before the list has even
  // been read is a lie, and it is the first thing this view says. See
  // emptylies.py.
  const [folders, setFolders] = useState<Workspace[] | null>(null);
  const [here, setHere] = useState<Workspace | null>(null);
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

  const ctx = useContextMenu();
  /* What a folder tab offers under the right button: look at it, copy its
     path, show it where the system shows files, or take it off the list. */
  const tabMenu = (w: Workspace): MenuItem[] => [
    {
      label: tr("tile.menuOpen", "Open"),
      onClick: () => {
        setHere(w);
        setDiff(null);
        setSide("tree");
      },
    },
    { label: tr("files.copy", "COPY PATH"), onClick: () => void navigator.clipboard?.writeText(w.path).catch(() => undefined) },
    {
      label: tr("files.reveal", "SHOW"),
      disabled: Boolean(w.missing),
      onClick: () => void api.revealFile(w.id, "").catch((e) => setProblem(errText(e))),
    },
    { separator: true },
    { label: tr("folders.remove", "Remove folder"), danger: true, onClick: () => void close(w.id) },
  ];

  const load = useCallback(() => {
    api
      .workspaces()
      .then((list) => {
        setFolders(list);
        // The place chosen at the top wins; otherwise the one used last, so
        // coming back lands where you left off.
        const same = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
        const chosen = place ? list.find((w) => same(w.path, place)) : undefined;
        setHere((was) => chosen ?? (was ? list.find((w) => w.id === was.id) ?? null : list[0] ?? null));
      })
      .catch((e) => setProblem(errText(e)));
  }, [place]);

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
    } catch (e) {
      setProblem(errText(e));
    }
  }

  async function close(id: string) {
    setProblem("");
    try {
      await api.closeWorkspace(id);
      if (here?.id === id) setHere(null);
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
                <Tooltip key={w.id} text={w.missing ? tr("folders.missing", "Not reachable right now — {path}", { path: w.path }) : w.path}>
                  <Button
                    bare
                    className={`folderTab${here?.id === w.id ? " on" : ""}`}
                    data-missing={w.missing ? "yes" : undefined}
                    onClick={() => {
                      setHere(w);
                      setDiff(null);
                      setSide("tree");
                    }}
                    onContextMenu={ctx(tabMenu(w))}
                  >
                    {w.path.split(/[\\/]/).filter(Boolean).pop() ?? w.path}
                  </Button>
                </Tooltip>
              ))}
            </span>
            <span className="spacer" />
            <Button onClick={() => setPicking(true)}>{tr("folders.open", "+ FOLDER")}</Button>
          </div>

          <OverflowBar
            className="folderbarLow"
            moreTitle={tr("common.more", "More")}
            left={
              where ? (
                /* Three readings of one thing, dressed as one thing: which
                   branch, how far ahead, how far behind. The number carries
                   the accent and the word beside it stays dim — the number is
                   the part that moves and the part somebody is looking for.
                   The two distances used to be a bare "+2" and "−2", which
                   reads as arithmetic rather than as a position. */
                <span className="foldergit">
                  <span className="branchname" data-on="yes">
                    {where.detached
                      ? tr("git.detached", "no branch — sitting on {hash}", { hash: where.branch })
                      : where.branch}
                  </span>
                  {where.ahead ? (
                    <Tooltip text={tr("git.aheadTip", "Commits here that the upstream has not got")}>
                      <span className="branchdist">
                        <span className="branchnum">{where.ahead}</span> {tr("git.aheadWord", "ahead")}
                      </span>
                    </Tooltip>
                  ) : null}
                  {where.behind ? (
                    <Tooltip text={tr("git.behindTip", "Commits on the upstream that are not here")}>
                      <span className="branchdist">
                        <span className="branchnum">{where.behind}</span> {tr("git.behindWord", "behind")}
                      </span>
                    </Tooltip>
                  ) : null}
                </span>
              ) : null
            }
            items={[
              ...(where
                ? [
                    {
                      key: "changed",
                      /* A count nobody can act on is a boast. This one opens
                       * the list it is counting.
                       *
                       * A status, not a control. It is a button because it
                       * does something — for the keyboard, and for anything
                       * reading the screen out loud — but nothing reset what
                       * the browser draws around a <button>, so it came out as
                       * the system's own grey pill, greyed out, in a bar of
                       * skinned controls. The reset is in layout.css now, with
                       * every other bare button; here the count is split off
                       * into its own span so it can wear the accent while the
                       * words beside it stay dim. */
                      node: (
                        <Tooltip text={changed?.length ? tr("git.showThem", "Show which ones") : undefined}>
                          <Button bare className="branchword" disabled={!changed?.length} onClick={() => setSide("changes")}>
                            {changed === null ? (
                              tr("git.reading", "reading…")
                            ) : changed.length ? (
                              <>
                                <span className="branchnum">{changed.length}</span>{" "}
                                {trN("git.filesWord", changed.length, "file changed", "files changed")}
                              </>
                            ) : (
                              tr("git.cleanShort", "nothing changed")
                            )}
                          </Button>
                        </Tooltip>
                      ),
                    },
                  ]
                : []),
              ...(here && !here.missing
                ? [
                    { key: "tree", node: <Button on={side === "tree"} onClick={() => setSide("tree")}>{tr("folders.tree", "FILES")}</Button> },
                    { key: "find", node: <Button on={side === "find"} onClick={() => setSide("find")}>{tr("find.open", "FIND")}</Button> },
                    { key: "changes", node: <Button on={side === "changes"} onClick={() => setSide("changes")}>{tr("git.open", "CHANGES")}</Button> },
                    { key: "branches", node: <Button on={side === "branches"} onClick={() => setSide("branches")}>{tr("branch.open", "BRANCHES")}</Button> },
                  ]
                : []),
              ...(here
                ? [
                    {
                      key: "close",
                      node: (
                        <Tooltip text={tr("folders.closeTip", "Take it off the list. Nothing on disk is touched.")}>
                          <Button onClick={() => void close(here.id)}>{tr("folders.close", "CLOSE")}</Button>
                        </Tooltip>
                      ),
                    },
                  ]
                : []),
            ]}
          />
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
              onShow={setDiff}
              onEdit={(path) => onOpenFile(here.id, path)}
            />
          ) : side === "find" ? (
            <FileSearch
              rootId={here.id}
              onOpen={(path, at) => onOpenFile(here.id, path, at)}
            />
          ) : (
            <Files
              rootId={here.id}
              root={here.path}
              onPick={(path, rootId) => onOpenFile(rootId, path)}
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
              onEdit={(path, line) => onOpenFile(here.id, path, line || undefined)}
            />
          ) : (
            /* Not an empty box.
             *
             * This half of the view used to read "pick a file — choose one on
             * the left", across half the window, about a folder it was looking
             * straight at. Everything a person looks up before touching a
             * folder was already on the machine and nothing asked for it. */
            <FolderInfo
              rootId={here.id}
              shown={diff}
              onShow={setDiff}
              onEdit={(path) => onOpenFile(here.id, path)}
              onOpenChanges={() => setSide("changes")}
              withChanges={side !== "changes"}
            />
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
