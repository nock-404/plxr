"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Ask from "@/components/ui/Ask";
import Button from "@/components/ui/Button";
import Tooltip from "@/components/ui/Tooltip";
import OverflowBar from "@/components/ui/OverflowBar";
import Input from "@/components/ui/Input";
import TreePick from "@/components/ui/TreePick";
import { api } from "@/lib/api";
import { errText, tr, trN } from "@/lib/i18n";
import { bindingOf, caption, matches } from "@/lib/keymap";
import { atTop, parent, segments } from "@/lib/paths";
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
 *
 * And it only ever went downwards. Asked how to reach the folder above the
 * one it was showing, there was no answer: the root was the session's folder
 * or the one somebody opened, the line at the top was a dead ellipsised
 * string, and the only way out of it was to open another folder somewhere
 * else. Now the top line is the path itself, every step of it a place to
 * stand, with one control and one key for the step up. Above the folder it was
 * given, the tree addresses the service by the directory itself — see
 * core.root and DirPrefix. */

/* What was unfolded last time.
 *
 * A tree that forgets which folders were open the moment its panel is closed
 * makes you walk down through four levels again to get back to where you were
 * working. In the browser's own store: it is a convenience of this window, not
 * state the service has any business holding.
 *
 * Written as the folders themselves — whole paths — and not as a list under
 * the root they were opened from. A folder belongs to exactly one root anyway,
 * so this is per root without saying so, and it survives the two things a root
 * key does not: the same folder reached from two roots, and the same root
 * spelled two ways. The second is not hypothetical. The window holds a folder
 * as the user gave it and the service answers with the resolved path — on a
 * Mac /var/… and /private/var/… are the same directory — so a tree re-rooted
 * from a row and then reopened looked up a key nobody had ever written. */
const OPEN_KEY = "plxr.tree.open";
// A cap, so a month of opening folders cannot grow without end in a store that
// is shared with everything else the window keeps.
const OPEN_MAX = 400;

function keptOpen(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    // No store, nothing in it, or something else entirely — including a page
    // being rendered where there is no browser at all. An empty tree is the
    // honest start.
    return [];
  }
}

function keepOpen(paths: Set<string>): void {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify([...paths].slice(-OPEN_MAX)));
  } catch {
    /* a store that refuses to be written to costs the memory, nothing else */
  }
}

// The same folder, whatever a trailing separator says about it.
const samePlace = (a: string, b: string) => a.replace(/[\\/]+$/, "") === b.replace(/[\\/]+$/, "");

/* How a directory that is neither a session nor a folder somebody opened is
   addressed: "dir:/Users/me/work". The same prefix the service reads it by —
   DirPrefix in internal/core, where it is also checked for being an absolute
   path that is there and is a directory. */
const DIR_ID = "dir:";

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
  /* The file, and the root it has to be read through: walking up leaves the
     session or the folder behind, and an editor opened on a file above them
     would ask the wrong root for it and be refused. */
  onPick: (path: string, rootId: string) => void;
}) {
  /* The folder the tree has walked to, and the root that walk belongs to. The
     two are held together on purpose: handed another session or another folder,
     this is that folder's tree again at once — with the walk remembered as
     state of the root it was made in, there is no render in between where the
     new folder is read through the old one's directory. */
  const [at, setAt] = useState<{ of: string; dir: string }>({ of: "", dir: "" });
  const [open, setOpen] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [noise, setNoise] = useState(false);
  const [filter, setFilter] = useState("");
  const [git, setGit] = useState<Record<string, string>>({});
  const [here, setHere] = useState("");
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState("");
  const tree = useRef<HTMLDivElement>(null);
  // Read once, when this tree is built, and kept in step with every fold and
  // unfold from then on.
  const remembered = useRef<Set<string> | null>(null);
  if (remembered.current === null) remembered.current = new Set(keptOpen());

  /* Where the tree stands, and who the service knows that by.
     Back at the folder it was given, it is that folder's own id again — so a
     session's tree stays a session's tree, with everything that hangs off the
     id, and only a tree that has actually walked out addresses a bare
     directory. */
  const walked = at.of === rootId ? at.dir : "";
  const base = walked || root;
  const baseId = walked ? DIR_ID + walked : rootId;

  const list = useCallback(
    async (dir: string) => {
      try {
        const rows = await api.listDir(baseId, dir);
        setOpen((o) => ({ ...o, [dir]: rows ?? [] }));
        setError((e) => (e && dir === "" ? "" : e));
      } catch (e) {
        // A directory that cannot be read — a permission wall, a volume gone —
        // used to expand to nothing, which reads as "empty". Say why instead.
        setOpen((o) => ({ ...o, [dir]: [] }));
        setError(errText(e));
      }
    },
    [baseId],
  );

  const reload = useCallback(
    async (dir: string) => {
      await list(dir);
      setGit(await api.gitStatus(baseId).catch(() => ({})));
    },
    [list, baseId],
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
    setGit(await api.gitStatus(baseId).catch(() => ({})));
    // Announced under the root this tree was given, not the one it is standing
    // on: an editor, a diff and the changes list are open on that one, and it
    // is what they listen for.
    announceFilesChanged({ rootId, rev: "", head: "" });
  }, [open, list, baseId, rootId]);

  /* A root, from the beginning.
   *
   * It runs for the folder the tree was given and again for every folder it
   * walks into: nothing of the last root may survive the step. The listing
   * starts empty, and the git marks are read again for this folder — going up
   * used to be the one way to end up with the marks of the folder below still
   * on the rows. */
  useEffect(() => {
    setOpen({});
    setExpanded(new Set());
    setHere("");
    setError("");
    void reload("");
  }, [base, reload]);

  /* And the folders that were open unfold themselves again, as the listing
     that holds them arrives. Driven by what came back rather than by the root,
     so a folder three levels down comes back too: unfolding it reads it, and
     reading it unfolds whatever was open inside it. */
  useEffect(() => {
    const back: string[] = [];
    for (const rows of Object.values(open)) {
      for (const r of rows) if (r.dir && remembered.current?.has(r.path) && !expanded.has(r.path)) back.push(r.path);
    }
    if (!back.length) return;
    setExpanded((set) => new Set([...set, ...back]));
    for (const dir of back) if (!open[dir]) void list(dir);
  }, [open, expanded, list]);

  // Git changes while an agent works, so it is asked again now and then rather
  // than only when something is clicked — and at once when something in the
  // window changed the tree, like a mark being restored.
  useEffect(() => {
    const ask = () => api.gitStatus(baseId).then(setGit).catch(() => undefined);
    const t = window.setInterval(ask, 4000);
    window.addEventListener("plxr:files-changed", ask);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("plxr:files-changed", ask);
    };
  }, [baseId]);

  /* Standing somewhere else. The folder it was given keeps its own id, so
     coming back down to it is a session's tree again rather than a directory
     that happens to be in the same place. */
  const reroot = useCallback(
    (dir: string) => {
      if (!dir) return;
      setAt({ of: rootId, dir: samePlace(dir, root) ? "" : dir });
    },
    [root, rootId],
  );
  const upOne = useCallback(() => {
    if (!atTop(base)) reroot(parent(base));
  }, [base, reroot]);

  const needle = filter.trim().toLowerCase();

  /* The rows as one flat list, which is what both the drawing and the keyboard
     need: a tree on screen is a list to anyone moving through it. */
  const visible = useMemo(() => {
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
  }, [open, expanded, noise, needle]);

  /* How many rows the filter found.
   *
   * A filter that matches nothing used to leave an empty box under the field
   * and say nothing at all, which reads as "this folder is empty" rather than
   * "nothing here is called that" — and a filter that matched four things out
   * of nine hundred said no more. The folders on the way to a hit are on
   * screen too and are not hits, so they are not counted. */
  const found = useMemo(
    () => (needle ? visible.filter((v) => v.entry.name.toLowerCase().includes(needle)).length : 0),
    [visible, needle],
  );

  // Typing in the filter opens everything, so a name deep down can be found
  // without knowing where it lives.
  useEffect(() => {
    if (!needle) return;
    for (const { entry } of visible) {
      if (entry.dir && !open[entry.path]) void list(entry.path);
    }
  }, [needle, visible, open, list]);

  const parentOf = (path: string) => {
    for (const [dir, rows] of Object.entries(open)) {
      if (rows.some((r) => r.path === path)) return dir;
    }
    return "";
  };

  function toggle(entry: FileEntry) {
    setHere(entry.path);
    if (!entry.dir) {
      onPick(entry.path, baseId);
      return;
    }
    const next = new Set(expanded);
    if (next.has(entry.path)) next.delete(entry.path);
    else {
      next.add(entry.path);
      if (!open[entry.path]) void list(entry.path);
    }
    setExpanded(next);
    /* Written here rather than watched from an effect: this is the one place a
       folder is folded or unfolded by hand, and a hand is the only thing worth
       remembering. Folding one forgets it — otherwise it would unfold itself
       again the next time its parent is read, which is the same defect the
       other way round. */
    if (remembered.current) {
      if (next.has(entry.path)) remembered.current.add(entry.path);
      else remembered.current.delete(entry.path);
      keepOpen(remembered.current);
    }
  }

  /* Up and down move, right opens a folder, left closes it or steps out to the
     one above, Enter opens a file. The same keys every tree has had for thirty
     years, and none of them worked here. And one chord out of the window's own
     table, read here rather than by the window: ⌘↑ re-roots to the folder
     above. Several trees can be open at once, so the one that answers is the
     one holding the keyboard. */
  function onKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (matches(e.nativeEvent, "filesUp")) {
      upOne();
      e.preventDefault();
      return;
    }
    const cursor = visible.findIndex((v) => v.entry.path === here);
    const move = (to: number) => {
      const row = visible[Math.max(0, Math.min(visible.length - 1, to))];
      if (row) setHere(row.entry.path);
      e.preventDefault();
    };
    const entry = visible[cursor]?.entry;
    switch (e.key) {
      case "ArrowDown":
        return move(cursor + 1);
      case "ArrowUp":
        return move(cursor < 0 ? 0 : cursor - 1);
      case "ArrowRight":
        if (entry?.dir && !expanded.has(entry.path)) toggle(entry);
        else move(cursor + 1);
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

  /* The selected row stays on screen — not only when it is moved to.
   *
   * It ran on the selection alone, so anything that redrew the list around a
   * standing selection left it wherever it had been pushed: unfolding a folder
   * above it, a file appearing from an agent's work, the whole listing being
   * read again after a rename. `nearest` means this does nothing at all while
   * the row is in view, so it is not a fight with the scrollbar — and `visible`
   * only changes when the rows themselves do, not on every git poll. */
  useEffect(() => {
    tree.current?.querySelector<HTMLElement>('[data-at="yes"]')?.scrollIntoView({ block: "nearest" });
  }, [here, visible]);

  const selected = visible.find((v) => v.entry.path === here)?.entry ?? null;
  const dirOfSelection = selected ? (selected.dir ? selected.path : parentOf(selected.path)) : "";
  /* The path relative to the root, which is what every file operation takes.
     The entry's own `rel` is the truth — the service worked it out against
     the resolved root, so it holds through a symlinked folder (/tmp on a Mac
     is /private/tmp), where slicing the root off the absolute path does not.
     Slicing is kept for the root itself and for a directory key that is not an
     entry. */
  const relOf = (path: string) => {
    if (path === "" || path === base) return "";
    for (const rows of Object.values(open)) {
      const hit = rows.find((r) => r.path === path);
      if (hit) return hit.rel;
    }
    return path.startsWith(base) ? path.slice(base.length).replace(/^\//, "") : path;
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
      /* The way back down. The crumbs and the control above them only lead
         upwards, and from four folders up there was no way back into the one
         you came from other than unfolding the whole path again. */
      ...(entry.dir ? [{ label: tr("files.rootHere", "Show only this folder"), onClick: () => reroot(entry.path) }] : []),
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
    // The same step the control at the top takes, at the pointer — including
    // from the empty space under the last row, where there is no control.
    { label: tr("files.upFolder", "Up one folder"), disabled: atTop(base), onClick: upOne },
    { separator: true },
    { label: tr("files.menuRefresh", "Refresh"), onClick: () => void reloadAll() },
    { separator: true },
    { label: tr("files.copy", "COPY PATH"), onClick: () => void navigator.clipboard?.writeText(base).catch(() => undefined) },
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
      await api.revealFile(baseId, path);
    } catch (e) {
      setError(errText(e));
    }
  }

  // Every step of the path the tree stands on, each of them a root to re-root to.
  const crumbs = segments(base);

  // The folder a moved entry lands in is a rename to a path in that folder.
  function move(entry: FileEntry, dir: string) {
    const to = dir ? `${dir}/${entry.name}` : entry.name;
    if (to === entry.rel) return;
    void run(() => api.renameFile(baseId, entry.rel, to));
  }

  return (
    <aside className="files">
      <div className="filesbar" onContextMenu={ctx(rootMenu())}>
        {/* Where the tree stands, as a place rather than as a caption: every
            step of the path is a root to stand on, and the step above it has a
            control of its own because it is the one that was missing. The
            whole path is still in the tooltip — the column is too narrow to
            hold a real one, so the crumbs run off to the left and the deepest
            folders, which are the ones being worked in, stay on screen. */}
        <Tooltip text={tr("files.upTip", "Up one folder — {key}", { key: caption(bindingOf("filesUp")) })}>
          <Button tiny data-do="files-up" disabled={atTop(base)} onClick={upOne}>
            ↑
          </Button>
        </Tooltip>
        <Tooltip text={base}>
          <span className="crumbs">
            {/* The unix root is a place you can click to; a Windows drive is
                already the first crumb. Same reasoning as the folder picker. */}
            {!/^[A-Za-z]:/.test(crumbs[0]?.path ?? "") ? (
              <Button bare className="crumb" data-do="crumb" onClick={() => reroot("/")}>
                /
              </Button>
            ) : null}
            {crumbs.map((c) => (
              <Button bare key={c.path} className="crumb" data-do="crumb" onClick={() => reroot(c.path)}>
                {c.name}
              </Button>
            ))}
          </span>
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
        {/* What the filter did, in the bar it was typed into. Nothing at all
            was said before, so a filter that matched nothing and a folder that
            is empty looked exactly alike. */}
        {needle ? <span className="notice">{trN("files.found", found, "{n} match", "{n} matches")}</span> : null}
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
          detail={relOf(pending.dir) || base}
          field={tr("files.name", "name")}
          confirmLabel={tr("common.create", "CREATE")}
          onCancel={() => setPending(null)}
          onConfirm={(name) => {
            const dir = relOf(pending.dir);
            const path = dir ? `${dir}/${name.trim()}` : name.trim();
            setPending(null);
            if (name.trim()) void run(() => api.createFile(baseId, path, pending.kind === "newFolder"));
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
              void run(() => api.renameFile(baseId, from, dir ? `${dir}/${to}` : to));
            }
          }}
        />
      ) : null}

      {pending?.kind === "move" ? (
        <TreePick
          rootId={baseId}
          root={base}
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
            void run(() => api.removeFile(baseId, entry.rel));
          }}
        />
      ) : null}
    </aside>
  );
}
