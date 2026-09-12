"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { api } from "@/lib/api";
import { errText, tr } from "@/lib/i18n";
import type { FileEntry } from "@/lib/types";

/* Choosing a folder inside one tree.
 *
 * FolderPick walks the whole disk, which is right for opening a folder and
 * wrong for moving a file: a file moved out of its project is a file the
 * service refuses to move, and a picker that lets you walk somewhere it will
 * then refuse is a picker that lies. This one lists the folders below one
 * root — the same listing the tree draws — and every path it hands back is
 * relative to that root, which is exactly what a rename inside it takes.
 *
 * What is being moved cannot be moved into itself, so a folder and everything
 * under it are left out of the walk while it is the thing on the move.
 */
export default function TreePick({
  rootId,
  root,
  start = "",
  exclude = "",
  onChoose,
  onCancel,
}: {
  /* A session or a folder — the service reads which from the id. */
  rootId: string;
  /* The root as the window shows it, for the first crumb. */
  root: string;
  /* Where the walk begins, relative to the root; "" is the root itself. */
  start?: string;
  /* A folder, relative to the root, that is not offered — nor anything in it. */
  exclude?: string;
  onChoose: (dir: string) => void;
  onCancel: () => void;
}) {
  const [here, setHere] = useState(start);
  const [folders, setFolders] = useState<FileEntry[] | null>(null);
  const [problem, setProblem] = useState("");
  const shut = (rel: string) => Boolean(exclude) && (rel === exclude || rel.startsWith(`${exclude}/`));

  useEffect(() => {
    let dropped = false;
    setFolders(null);
    setProblem("");
    api
      .listDir(rootId, here)
      .then((rows) => {
        if (dropped) return;
        // The thing on the move is not a place it can go.
        setFolders((rows ?? []).filter((e) => e.dir && !e.noise && !shut(e.rel)));
      })
      .catch((e) => {
        if (dropped) return;
        setFolders([]);
        setProblem(errText(e));
      });
    return () => {
      dropped = true;
    };
    // shut reads a prop that does not change while this is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootId, here]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const parts = here.split("/").filter(Boolean);
  const crumbs = parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join("/") }));
  const parent = parts.slice(0, -1).join("/");
  const rootName = root.split(/[\\/]/).filter(Boolean).pop() ?? root;

  return (
    <div className="backdrop" onClick={onCancel}>
      <div className="card folderpick" onClick={(e) => e.stopPropagation()}>
        <b className="cardTitle">{tr("files.moveWhere", "move where?")}</b>

        <div className="crumbs">
          <Button bare className="crumb" onClick={() => setHere("")}>
            {rootName}
          </Button>
          {crumbs.map((c) => (
            <Button bare key={c.path} className="crumb" onClick={() => setHere(c.path)}>
              {c.name}
            </Button>
          ))}
        </div>

        <div className="folderlist">
          {here ? (
            <Button bare className="folderrow folderup" onClick={() => setHere(parent)}>
              {tr("folder.up", "..")}
            </Button>
          ) : null}
          {problem ? <span className="notice warn">{problem}</span> : null}
          {folders === null ? (
            <span className="notice">{tr("common.working", "…")}</span>
          ) : folders.length === 0 && !problem ? (
            <span className="notice">{tr("folder.empty", "No folders in here.")}</span>
          ) : (
            folders.map((f) => (
              <Button bare key={f.rel} className="folderrow" data-path={f.rel} onClick={() => setHere(f.rel)}>
                {f.name}
              </Button>
            ))
          )}
        </div>

        <div className="cardButtons">
          <span className="notice">{here || rootName}</span>
          <span className="spacer" />
          <Button onClick={onCancel}>{tr("common.cancel", "CANCEL")}</Button>
          <Button primary disabled={shut(here)} data-do="move-here" onClick={() => onChoose(here)}>
            {tr("files.moveHere", "MOVE HERE")}
          </Button>
        </div>
      </div>
    </div>
  );
}
