"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Ask from "@/components/ui/Ask";
import Button from "@/components/ui/Button";
import Tooltip from "@/components/ui/Tooltip";
import OverflowBar from "@/components/ui/OverflowBar";
import Input from "@/components/ui/Input";
import TreePick from "@/components/ui/TreePick";
import { api } from "@/lib/api";
import { errText, tr } from "@/lib/i18n";
import { useContextMenu, type MenuItem } from "@/components/ui/Menu";
import { announceFilesChanged } from "@/lib/useChanges";
import type { FileEntry } from "@/lib/types";

/* The tree beside the terminal.
 *
 * Each action carries a data-do of its own. Not decoration: it is how a check
 * finds the delete button without matching the word "delete", which is a
 * different word in every language the interface speaks — and matching it in
 * German put German into the checking code, where none is allowed.
 *
 * It could open folders and nothing else: no way to make a file, rename one or
 * throw one away, no sign of what git thought of any of it, and no way to reach
 * a row except with the mouse. The work went to a terminal, which is exactly
 * what a browser standing next to one is supposed to save.
 *
 * Everything destructive asks first, and asks with our own dialog rather than
 * the browser's — see Ask.
 */

type Pending =
  | { kind: "newFile" | "newFolder"; dir: string }
  | { kind: "rename"; entry: FileEntry }
  | { kind: "move"; entry: FileEntry }
  | { kind: "delete"; entry: FileEntry }
  | null;

/* A glyph per kind of file, so a tree can be skimmed instead of read.
 *
 * Every file used to be a dot. A folder of forty files was forty identical
 * dots, and the eye had nothing to hold on to. Text, not an icon font: this
 * window draws itself in one typeface, and a second one for pictures of files
 * would be a dependency to keep in step with four skins.
 *
 * The kind also goes on the row as an attribute, so a skin can colour the
 * glyph — a stylesheet cannot pick a character out of a string. */
const BY_EXTENSION: Record<string, [string, string]> = {
  go: ["◇", "code"],
  ts: ["◇", "code"],
  tsx: ["◇", "code"],
  js: ["◇", "code"],
  mjs: ["◇", "code"],
  jsx: ["◇", "code"],
  py: ["◇", "code"],
  rb: ["◇", "code"],
  php: ["◇", "code"],
  rs: ["◇", "code"],
  java: ["◇", "code"],
  kt: ["◇", "code"],
  swift: ["◇", "code"],
  c: ["◇", "code"],
  h: ["◇", "code"],
  m: ["◇", "code"],
  mm: ["◇", "code"],
  cpp: ["◇", "code"],
  hpp: ["◇", "code"],
  cs: ["◇", "code"],
  lua: ["◇", "code"],
  vim: ["◇", "code"],
  sh: ["▷", "script"],
  bash: ["▷", "script"],
  zsh: ["▷", "script"],
  ps1: ["▷", "script"],
  bat: ["▷", "script"],
  cmd: ["▷", "script"],
  css: ["◈", "style"],
  scss: ["◈", "style"],
  html: ["◈", "style"],
  vue: ["◈", "style"],
  json: ["≡", "data"],
  jsonl: ["≡", "data"],
  yml: ["≡", "data"],
  yaml: ["≡", "data"],
  toml: ["≡", "data"],
  ini: ["≡", "data"],
  env: ["≡", "data"],
  sql: ["≡", "data"],
  csv: ["≡", "data"],
  md: ["¶", "text"],
  txt: ["¶", "text"],
  rst: ["¶", "text"],
  png: ["▣", "image"],
  jpg: ["▣", "image"],
  jpeg: ["▣", "image"],
  gif: ["▣", "image"],
  svg: ["▣", "image"],
  webp: ["▣", "image"],
  ico: ["▣", "image"],
  zip: ["▤", "archive"],
  gz: ["▤", "archive"],
  tar: ["▤", "archive"],
  dump: ["▤", "archive"],
  lock: ["⊘", "locked"],
};

// Whole names that say more than their extension does.
const BY_NAME: Record<string, [string, string]> = {
  "package.json": ["◆", "manifest"],
  "go.mod": ["◆", "manifest"],
  "go.sum": ["⊘", "locked"],
  "package-lock.json": ["⊘", "locked"],
  "pnpm-lock.yaml": ["⊘", "locked"],
  dockerfile: ["◉", "build"],
  makefile: ["◉", "build"],
  "readme.md": ["★", "readme"],
  "claude.md": ["★", "readme"],
  ".gitignore": ["⊙", "config"],
  ".env": ["≡", "data"],
};

function lookup(entry: FileEntry): [string, string] {
  if (entry.dir) return ["▸", "folder"];
  const name = entry.name.toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1) : "";
  return BY_EXTENSION[ext] ?? ["·", "plain"];
}

function iconOf(entry: FileEntry): string {
  return lookup(entry)[0];
}

function kindOf(entry: FileEntry): string {
  return lookup(entry)[1];
}

// What git says, as one letter, so a row does not turn into a sentence.
const MARKS: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  untracked: "?",
  conflict: "!",
};

export default function Files({
  rootId,
  root,
  onPick,
}: {
  /* A session or a folder — the daemon reads which from the id. This was
     called sessionId, from the days when a file could only be reached through
     a running agent. */
  rootId: string;
  root: string;
  onPick: (path: string) => void;
}) {
  const sessionId = rootId;
  const [open, setOpen] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [noise, setNoise] = useState(false);
  const [filter, setFilter] = useState("");
  const [git, setGit] = useState<Record<string, string>>({});
  const [here, setHere] = useState("");
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState("");
  const tree = useRef<HTMLDivElement>(null);

  const list = useCallback(
    async (dir: string) => {
      try {
        const rows = await api.listDir(sessionId, dir);
        setOpen((o) => ({ ...o, [dir]: rows ?? [] }));
        setError((e) => (e && dir === "" ? "" : e));
      } catch (e) {
        // A directory that cannot be read — a permission wall, a volume gone —
        // used to expand to nothing, which reads as "empty". Say why instead.
        setOpen((o) => ({ ...o, [dir]: [] }));
        setError(errText(e));
      }
    },
    [sessionId],
  );

  const reload = useCallback(
    async (dir: string) => {
      await list(dir);
      setGit(await api.gitStatus(sessionId).catch(() => ({})));
    },
    [list, sessionId],
  );

  /* After something moved: every folder that has been listed is listed
     again, not only the one the change was made in. A move has two ends, a
     rename can cross folders, and a folder listed earlier and folded away
     would otherwise show the file where it no longer is the next time it is
     opened. Then the rest of the window is told, the way the live feed tells
     it — so an open diff, an editor on the file and the changes list refresh
     off the same event the tree does. */
  const reloadAll = useCallback(async () => {
    const dirs = Object.keys(open);
    await Promise.all((dirs.length ? dirs : [""]).map((d) => list(d)));
    setGit(await api.gitStatus(sessionId).catch(() => ({})));
    announceFilesChanged({ rootId: sessionId, rev: "", head: "" });
  }, [open, list, sessionId]);

  useEffect(() => {
    void reload("");
  }, [reload]);

  // Git changes while an agent works, so it is asked again now and then rather
  // than only when something is clicked — and at once when something in the
  // window changed the tree, like a mark being restored.
  useEffect(() => {
    const ask = () => api.gitStatus(sessionId).then(setGit).catch(() => undefined);
    const t = window.setInterval(ask, 4000);
    window.addEventListener("plxr:files-changed", ask);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("plxr:files-changed", ask);
    };
  }, [sessionId]);

  /* The rows as one flat list, which is what both the drawing and the keyboard
     need: a tree on screen is a list to anyone moving through it. */
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const out: { entry: FileEntry; depth: number }[] = [];
    const walk = (dir: string, depth: number) => {
      for (const e of open[dir] ?? []) {
        if (e.noise && !noise) continue;
        // While filtering, a folder only earns its place by having a hit under
        // it — which is why the filter opens folders as it goes.
        if (needle && !e.name.toLowerCase().includes(needle) && !e.dir) continue;
        out.push({ entry: e, depth });
        if (e.dir && (expanded.has(e.path) || needle)) walk(e.path, depth + 1);
      }
    };
    walk("", 0);
    return out;
  }, [open, expanded, noise, filter]);

  // Typing in the filter opens everything, so a name deep down can be found
  // without knowing where it lives.
  useEffect(() => {
    if (!filter.trim()) return;
    for (const { entry } of visible) {
      if (entry.dir && !open[entry.path]) void list(entry.path);
    }
  }, [filter, visible, open, list]);

  const parentOf = (path: string) => {
    for (const [dir, rows] of Object.entries(open)) {
      if (rows.some((r) => r.path === path)) return dir;
    }
    return "";
  };

  function toggle(entry: FileEntry) {
    setHere(entry.path);
    if (!entry.dir) {
      onPick(entry.path);
      return;
    }
    setExpanded((set) => {
      const next = new Set(set);
      if (next.has(entry.path)) next.delete(entry.path);
      else {
        next.add(entry.path);
        if (!open[entry.path]) void list(entry.path);
      }
      return next;
    });
  }

  /* Up and down move, right opens a folder, left closes it or steps out to the
     one above, Enter opens a file. The same keys every tree has had for thirty
     years, and none of them worked here. */
  function onKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const at = visible.findIndex((v) => v.entry.path === here);
    const move = (to: number) => {
      const row = visible[Math.max(0, Math.min(visible.length - 1, to))];
      if (row) setHere(row.entry.path);
      e.preventDefault();
    };
    const entry = visible[at]?.entry;
    switch (e.key) {
      case "ArrowDown":
        return move(at + 1);
      case "ArrowUp":
        return move(at < 0 ? 0 : at - 1);
      case "ArrowRight":
        if (entry?.dir && !expanded.has(entry.path)) toggle(entry);
        else move(at + 1);
        return;
      case "ArrowLeft":
        if (entry?.dir && expanded.has(entry.path)) {
          toggle(entry);
          return;
        }
        if (entry) {
          const up = parentOf(entry.path);
          if (up) setHere(up);
        }
        e.preventDefault();
        return;
      case "Enter":
        if (entry) toggle(entry);
        e.preventDefault();
        return;
      default:
    }
  }

  useEffect(() => {
    tree.current?.querySelector<HTMLElement>('[data-at="yes"]')?.scrollIntoView({ block: "nearest" });
  }, [here]);

  const selected = visible.find((v) => v.entry.path === here)?.entry ?? null;
  const dirOfSelection = selected ? (selected.dir ? selected.path : parentOf(selected.path)) : "";
  /* The path relative to the root, which is what every file operation takes.
     The entry's own `rel` is the truth — the service worked it out against
     the resolved root, so it holds through a symlinked folder (/tmp on a Mac
     is /private/tmp), where slicing the root off the absolute path does not.
     Slicing is kept for the root itself and for a directory key that is not an
     entry. */
  const relOf = (path: string) => {
    if (path === "" || path === root) return "";
    for (const rows of Object.values(open)) {
      const hit = rows.find((r) => r.path === path);
      if (hit) return hit.rel;
    }
    return path.startsWith(root) ? path.slice(root.length).replace(/^\//, "") : path;
  };

  const ctx = useContextMenu();
  // The right-click menu for one row — the same actions the toolbar offers, at
  // the pointer, and always about the row clicked (not whatever was selected).
  function rowMenu(entry: FileEntry): MenuItem[] {
    /* The folder the row lives in, as the tree keys it: the entry itself for
       a folder, the parent's key for a file — "" for the root. It used to be
       cut out of the path, which for a top-level file gave the resolved root
       path; that is no key in the tree, so a file made from the context menu
       was written to disk and never appeared. */
    const dir = entry.dir ? entry.path : parentOf(entry.path);
    return [
      {
        label: entry.dir ? tr("files.menuOpenFolder", "Open") : tr("files.menuOpen", "Open"),
        onClick: () => toggle(entry),
      },
      { separator: true },
      { label: tr("files.newFile", "+ FILE"), onClick: () => setPending({ kind: "newFile", dir }) },
      { label: tr("files.newFolder", "+ FOLDER"), onClick: () => setPending({ kind: "newFolder", dir }) },
      { separator: true },
      { label: tr("files.rename", "RENAME"), onClick: () => setPending({ kind: "rename", entry }) },
      { label: tr("files.move", "MOVE"), onClick: () => setPending({ kind: "move", entry }) },
      {
        label: tr("common.delete", "DELETE"),
        danger: true,
        onClick: () => setPending({ kind: "delete", entry }),
      },
      { separator: true },
      {
        label: tr("files.copy", "COPY PATH"),
        onClick: () => void navigator.clipboard?.writeText(entry.path).catch(() => undefined),
      },
      {
        label: tr("files.reveal", "SHOW"),
        onClick: () => void reveal(entry.path),
      },
    ];
  }

  /* The tree's own menu — on the root row at the top and on the space under
     the last row, where no row is: what the toolbar does for the root, at the
     pointer. A row stops the event, so a row's click never reaches this. */
  const rootMenu = (): MenuItem[] => [
    { label: tr("files.newFile", "+ FILE"), onClick: () => setPending({ kind: "newFile", dir: "" }) },
    { label: tr("files.newFolder", "+ FOLDER"), onClick: () => setPending({ kind: "newFolder", dir: "" }) },
    { separator: true },
    { label: tr("files.menuRefresh", "Refresh"), onClick: () => void reloadAll() },
    { separator: true },
    { label: tr("files.copy", "COPY PATH"), onClick: () => void navigator.clipboard?.writeText(root).catch(() => undefined) },
    { label: tr("files.reveal", "SHOW"), onClick: () => void reveal("") },
  ];

  // A change to the tree: do it, then read everything again and say so.
  async function run(what: () => Promise<unknown>) {
    setError("");
    try {
      await what();
      await reloadAll();
    } catch (e) {
      setError(errText(e));
    }
  }

  // Showing a file changes nothing, so nothing is read again for it.
  async function reveal(path: string) {
    setError("");
    try {
      await api.revealFile(sessionId, path);
    } catch (e) {
      setError(errText(e));
    }
  }

  // The folder a moved entry lands in is a rename to a path in that folder.
  function move(entry: FileEntry, dir: string) {
    const to = dir ? `${dir}/${entry.name}` : entry.name;
    if (to === entry.rel) return;
    void run(() => api.renameFile(sessionId, entry.rel, to));
  }

  return (
    <aside className="files">
      <div className="filesbar" onContextMenu={ctx(rootMenu())}>
        <Tooltip text={root}>
          <span className="filesroot">{root}</span>
        </Tooltip>
        <Tooltip text={tr("files.noiseTip", "Show hidden and ignored files")}>
          <Button tiny on={noise} onClick={() => setNoise((n) => !n)}>
            ·*
          </Button>
        </Tooltip>
      </div>

      <div className="filesbar">
        <Input
          value={filter}
          placeholder={tr("files.filter", "filter")}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {/* One line at any width: what does not fit moves under the ⋯, the way
          the session bar does — two rows of buttons used to wrap into three
          in a narrow tree column. */}
      <OverflowBar
        className="filesbar"
        moreTitle={tr("common.more", "More")}
        items={[
          { key: "new-file", node: (
            <Tooltip text={tr("files.newFileTip", "New file in the selected folder")}>
              <Button tiny data-do="new-file" onClick={() => setPending({ kind: "newFile", dir: dirOfSelection })}>
                {tr("files.newFile", "+ FILE")}
              </Button>
            </Tooltip>
          ) },
          { key: "new-folder", node: (
            <Tooltip text={tr("files.newFolderTip", "New folder in the selected folder")}>
              <Button tiny data-do="new-folder" onClick={() => setPending({ kind: "newFolder", dir: dirOfSelection })}>
                {tr("files.newFolder", "+ FOLDER")}
              </Button>
            </Tooltip>
          ) },
          { key: "rename", node: (
            <Tooltip text={tr("files.renameTip", "Rename the selected entry")}>
              <Button tiny disabled={!selected} data-do="rename" onClick={() => selected && setPending({ kind: "rename", entry: selected })}>
                {tr("files.rename", "RENAME")}
              </Button>
            </Tooltip>
          ) },
          { key: "move", node: (
            <Tooltip text={tr("files.moveTip", "Move the selected entry into another folder")}>
              <Button tiny disabled={!selected} data-do="move" onClick={() => selected && setPending({ kind: "move", entry: selected })}>
                {tr("files.move", "MOVE")}
              </Button>
            </Tooltip>
          ) },
          { key: "delete", node: (
            <Tooltip text={tr("files.deleteTip", "Delete the selected entry for good")}>
              <Button tiny disabled={!selected} data-do="delete" onClick={() => selected && setPending({ kind: "delete", entry: selected })}>
                {tr("common.delete", "DELETE")}
              </Button>
            </Tooltip>
          ) },
          { key: "reveal", node: (
            <Tooltip text={tr("files.revealTip", "Show it where this system shows files")}>
              <Button tiny disabled={!selected} onClick={() => selected && void reveal(selected.path)}>
                {tr("files.reveal", "SHOW")}
              </Button>
            </Tooltip>
          ) },
          { key: "copy", node: (
            <Tooltip text={tr("files.copyTip", "Copy the full path")}>
              <Button tiny disabled={!selected} onClick={() => selected && void navigator.clipboard?.writeText(selected.path).catch(() => undefined)}>
                {tr("files.copy", "COPY PATH")}
              </Button>
            </Tooltip>
          ) },
        ]}
      />

      {error ? <div className="notice warn">{error}</div> : null}

      <div className="filetree" ref={tree} tabIndex={0} onKeyDown={onKey} onContextMenu={ctx(rootMenu())}>
        {visible.map(({ entry, depth }) => {
          const mark = MARKS[git[entry.rel] ?? ""] ?? "";
          return (
            <div
              key={entry.path}
              className={`frow${entry.noise ? " noise" : ""}`}
              data-path={entry.path}
              data-at={entry.path === here ? "yes" : "no"}
              data-git={git[entry.rel] ?? ""}
              style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
              onClick={() => toggle(entry)}
              onContextMenu={ctx(rowMenu(entry))}
            >
              <span className="fchev">{entry.dir ? (expanded.has(entry.path) ? "▾" : "▸") : ""}</span>
              <span className="ficon" data-kind={kindOf(entry)}>{iconOf(entry)}</span>
              <span className="fname">{entry.name}</span>
              <span className="fgit">{mark}</span>
            </div>
          );
        })}
      </div>

      {pending?.kind === "newFile" || pending?.kind === "newFolder" ? (
        <Ask
          heading={pending.kind === "newFile" ? tr("files.newFile", "+ FILE") : tr("files.newFolder", "+ FOLDER")}
          detail={relOf(pending.dir) || root}
          field={tr("files.name", "name")}
          confirmLabel={tr("common.create", "CREATE")}
          onCancel={() => setPending(null)}
          onConfirm={(name) => {
            const dir = relOf(pending.dir);
            const path = dir ? `${dir}/${name.trim()}` : name.trim();
            setPending(null);
            if (name.trim()) void run(() => api.createFile(sessionId, path, pending.kind === "newFolder"));
          }}
        />
      ) : null}

      {pending?.kind === "rename" ? (
        <Ask
          heading={tr("files.rename", "RENAME")}
          detail={pending.entry.rel}
          field={tr("files.name", "name")}
          value={pending.entry.name}
          confirmLabel={tr("files.rename", "RENAME")}
          onCancel={() => setPending(null)}
          onConfirm={(name) => {
            const from = pending.entry.rel;
            const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
            setPending(null);
            /* A name with a slash in it is a move as well as a rename —
               "inner/notes.md" from the root lands in inner/. The service
               makes the folders on the way. */
            const to = name.trim();
            if (to && to !== pending.entry.name) {
              void run(() => api.renameFile(sessionId, from, dir ? `${dir}/${to}` : to));
            }
          }}
        />
      ) : null}

      {pending?.kind === "move" ? (
        <TreePick
          rootId={sessionId}
          root={root}
          start={pending.entry.rel.includes("/") ? pending.entry.rel.slice(0, pending.entry.rel.lastIndexOf("/")) : ""}
          exclude={pending.entry.dir ? pending.entry.rel : ""}
          onCancel={() => setPending(null)}
          onChoose={(dir) => {
            const entry = pending.entry;
            setPending(null);
            move(entry, dir);
          }}
        />
      ) : null}

      {pending?.kind === "delete" ? (
        <Ask
          heading={tr("files.deleteHead", "delete for good?")}
          detail={
            pending.entry.rel +
            (pending.entry.dir ? ` — ${tr("files.deleteFolder", "everything inside it goes too")}` : "")
          }
          confirmLabel={tr("common.delete", "DELETE")}
          danger
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const entry = pending.entry;
            setPending(null);
            void run(() => api.removeFile(sessionId, entry.rel));
          }}
        />
      ) : null}
    </aside>
  );
}
