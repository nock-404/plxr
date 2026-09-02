"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";

/* Choosing a folder by looking at folders.
 *
 * Until this there was only a field that completed what you typed. That is a
 * fine way to reach a path you already know and a poor way to find one: it asks
 * you to remember the name before it will show it to you, and the list it drops
 * down is a list of matches, not a place you can walk around in.
 *
 * The system's own picker is not available — a page can only be handed a file
 * somebody pointed at, never a directory to browse. So this walks the daemon's
 * directory listing instead, which is the same one the completion uses.
 *
 * Typing still works, for a path that is pasted or already known. It is the
 * second way in, not the only one.
 */
function parent(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const cut = trimmed.lastIndexOf("/");
  return cut <= 0 ? "/" : trimmed.slice(0, cut);
}

function segments(path: string): { name: string; path: string }[] {
  const parts = path.split("/").filter(Boolean);
  const out: { name: string; path: string }[] = [];
  let here = "";
  for (const part of parts) {
    here += `/${part}`;
    out.push({ name: part, path: here });
  }
  return out;
}

export default function FolderPick({
  start,
  onChoose,
  onCancel,
}: {
  start: string;
  onChoose: (path: string) => void;
  onCancel: () => void;
}) {
  const [here, setHere] = useState(start || "~/");
  const [typed, setTyped] = useState("");
  const [folders, setFolders] = useState<string[] | null>(null);

  /* Where "~" actually is.
   *
   * Asked without a trailing separator, the daemon answers with the directory
   * itself rather than its contents — so "~" comes back as the home directory,
   * and from then on every path here is absolute. Working it out from the first
   * entry of a listing instead would land a level too deep the moment that
   * entry is a folder somebody happened to name early in the alphabet. */
  useEffect(() => {
    if (!here.startsWith("~")) return;
    let dropped = false;
    api
      .paths(here.replace(/\/+$/, ""))
      .then((list) => {
        const home = (list ?? [])[0];
        if (!dropped && home) setHere(home);
      })
      .catch(() => undefined);
    return () => {
      dropped = true;
    };
  }, [here]);

  useEffect(() => {
    if (here.startsWith("~")) return;
    let dropped = false;
    setFolders(null);
    api
      .paths(here.endsWith("/") ? here : `${here}/`)
      .then((list) => !dropped && setFolders(list ?? []))
      .catch(() => !dropped && setFolders([]));
    return () => {
      dropped = true;
    };
  }, [here]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const crumbs = segments(here);

  return (
    <div className="backdrop" onClick={onCancel}>
      <div className="card folderpick" onClick={(e) => e.stopPropagation()}>
        <b className="cardTitle">{tr("folder.title", "choose a folder")}</b>

        <div className="crumbs">
          <Button bare className="crumb" onClick={() => setHere("/")}>
            /
          </Button>
          {crumbs.map((c) => (
            <Button bare key={c.path} className="crumb" onClick={() => setHere(c.path)}>
              {c.name}
            </Button>
          ))}
        </div>

        <div className="folderlist">
          {here !== "/" ? (
            <Button bare className="folderrow folderup" onClick={() => setHere(parent(here))}>
              {tr("folder.up", "up one")}
            </Button>
          ) : null}
          {folders === null ? (
            <span className="notice">{tr("common.working", "…")}</span>
          ) : folders.length === 0 ? (
            <span className="notice">{tr("folder.empty", "No folders in here.")}</span>
          ) : (
            folders.map((path) => (
              <Button bare key={path} className="folderrow" onClick={() => setHere(path)}>
                {path.slice(path.lastIndexOf("/") + 1)}
              </Button>
            ))
          )}
        </div>

        <label className="field">
          <span className="fieldName">{tr("folder.orType", "or type a path")}</span>
          <Input
            value={typed}
            placeholder={here}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (typed.trim()) setHere(typed.trim());
            }}
          />
        </label>

        <div className="cardButtons">
          <span className="spacer" />
          <Button onClick={onCancel}>{tr("common.cancel", "CANCEL")}</Button>
          <Button primary onClick={() => onChoose(typed.trim() || here)}>
            {tr("folder.use", "USE THIS ONE")}
          </Button>
        </div>
      </div>
    </div>
  );
}
