"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Ask from "@/components/ui/Ask";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { api } from "@/lib/api";
import { errText, tr } from "@/lib/i18n";
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
  | { kind: "delete"; entry: FileEntry }
  | null;

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
      const rows = await api.listDir(sessionId, dir).catch(() => [] as FileEntry[]);
      setOpen((o) => ({ ...o, [dir]: rows ?? [] }));
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

  useEffect(() => {
    void reload("");
  }, [reload]);

  // Git changes while an agent works, so it is asked again now and then rather
  // than only when something is clicked.
  useEffect(() => {
    const t = window.setInterval(() => {
      api.gitStatus(sessionId).then(setGit).catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(t);
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
  const relative = (path: string) => (path.startsWith(root) ? path.slice(root.length).replace(/^\//, "") : path);

  async function run(what: () => Promise<unknown>, refresh: string) {
    setError("");
    try {
      await what();
      await reload(refresh);
    } catch (e) {
      setError(errText(e));
    }
  }

  return (
    <aside className="files">
      <div className="filesbar">
        <span className="filesroot">{root}</span>
        <Button
          tiny
          on={noise}
          title={tr("files.noiseTip", "Show hidden and ignored files")}
          onClick={() => setNoise((n) => !n)}
        >
          ·*
        </Button>
      </div>

      <div className="filesbar">
        <Input
          value={filter}
          placeholder={tr("files.filter", "filter")}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="filesbar">
        <Button tiny title={tr("files.newFileTip", "New file in the selected folder")} data-do="new-file" onClick={() => setPending({ kind: "newFile", dir: dirOfSelection })}>
          {tr("files.newFile", "+ FILE")}
        </Button>
        <Button tiny title={tr("files.newFolderTip", "New folder in the selected folder")} data-do="new-folder" onClick={() => setPending({ kind: "newFolder", dir: dirOfSelection })}>
          {tr("files.newFolder", "+ FOLDER")}
        </Button>
        <span className="spacer" />
        <Button tiny disabled={!selected} title={tr("files.renameTip", "Rename the selected entry")} data-do="rename" onClick={() => selected && setPending({ kind: "rename", entry: selected })}>
          {tr("files.rename", "RENAME")}
        </Button>
        <Button tiny disabled={!selected} title={tr("files.deleteTip", "Delete the selected entry for good")} data-do="delete" onClick={() => selected && setPending({ kind: "delete", entry: selected })}>
          {tr("common.delete", "DELETE")}
        </Button>
      </div>

      <div className="filesbar">
        <Button
          tiny
          disabled={!selected}
          title={tr("files.revealTip", "Show it where this system shows files")}
          onClick={() => selected && void run(() => api.revealFile(sessionId, selected.path), dirOfSelection)}
        >
          {tr("files.reveal", "SHOW")}
        </Button>
        <Button
          tiny
          disabled={!selected}
          title={tr("files.copyTip", "Copy the full path")}
          onClick={() => selected && void navigator.clipboard?.writeText(selected.path).catch(() => undefined)}
        >
          {tr("files.copy", "COPY PATH")}
        </Button>
      </div>

      {error ? <div className="notice warn">{error}</div> : null}

      <div className="filetree" ref={tree} tabIndex={0} onKeyDown={onKey}>
        {visible.map(({ entry, depth }) => {
          const mark = MARKS[git[relative(entry.path)] ?? ""] ?? "";
          return (
            <div
              key={entry.path}
              className={`frow${entry.noise ? " noise" : ""}`}
              data-at={entry.path === here ? "yes" : "no"}
              data-git={git[relative(entry.path)] ?? ""}
              style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
              onClick={() => toggle(entry)}
            >
              <span className="fchev">{entry.dir ? (expanded.has(entry.path) ? "▾" : "▸") : ""}</span>
              <span className="ficon">{entry.dir ? "▸" : "·"}</span>
              <span className="fname">{entry.name}</span>
              <span className="fgit">{mark}</span>
            </div>
          );
        })}
      </div>

      {pending?.kind === "newFile" || pending?.kind === "newFolder" ? (
        <Ask
          title={pending.kind === "newFile" ? tr("files.newFile", "+ FILE") : tr("files.newFolder", "+ FOLDER")}
          detail={pending.dir ? relative(pending.dir) || root : root}
          field={tr("files.name", "name")}
          confirmLabel={tr("common.create", "CREATE")}
          onCancel={() => setPending(null)}
          onConfirm={(name) => {
            const dir = pending.dir ? relative(pending.dir) : "";
            const path = dir ? `${dir}/${name}` : name;
            setPending(null);
            if (name.trim()) void run(() => api.createFile(sessionId, path, pending.kind === "newFolder"), pending.dir);
          }}
        />
      ) : null}

      {pending?.kind === "rename" ? (
        <Ask
          title={tr("files.rename", "RENAME")}
          detail={relative(pending.entry.path)}
          field={tr("files.name", "name")}
          value={pending.entry.name}
          confirmLabel={tr("files.rename", "RENAME")}
          onCancel={() => setPending(null)}
          onConfirm={(name) => {
            const from = relative(pending.entry.path);
            const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
            setPending(null);
            if (name.trim() && name !== pending.entry.name) {
              void run(() => api.renameFile(sessionId, from, dir ? `${dir}/${name}` : name), parentOf(pending.entry.path));
            }
          }}
        />
      ) : null}

      {pending?.kind === "delete" ? (
        <Ask
          title={tr("files.deleteHead", "delete for good?")}
          detail={
            relative(pending.entry.path) +
            (pending.entry.dir ? ` — ${tr("files.deleteFolder", "everything inside it goes too")}` : "")
          }
          confirmLabel={tr("common.delete", "DELETE")}
          danger
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const parent = parentOf(pending.entry.path);
            setPending(null);
            void run(() => api.removeFile(sessionId, relative(pending.entry.path)), parent);
          }}
        />
      ) : null}
    </aside>
  );
}
