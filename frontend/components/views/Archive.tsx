"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TopStrip from "@/components/ui/TopStrip";
import Ask from "@/components/ui/Ask";
import Button from "@/components/ui/Button";
import Tooltip from "@/components/ui/Tooltip";
import Input from "@/components/ui/Input";
import { useContextMenu, type MenuItem } from "@/components/ui/Menu";
import { errText, tr } from "@/lib/i18n";
import { api } from "@/lib/api";
import { copyText } from "@/lib/browser";
import type { ArchiveEntry, SearchHit } from "@/lib/types";

type Mode = "titles" | "conversations" | "terminals";

function day(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "2-digit" });
}

// Everything that ran before. Filtering by title is instant; the two search
// modes go through the daemon and read the transcripts themselves.
export default function Archive({ onOpen }: { onOpen: (id: string) => void }) {
  // null until the answer is in — see emptylies.py.
  const [rows, setRows] = useState<ArchiveEntry[] | null>(null);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [mode, setMode] = useState<Mode>("titles");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  // The transcript the menu's Delete is asking about; nothing goes until YES.
  const [doomed, setDoomed] = useState<ArchiveEntry | null>(null);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    api.archive().then((r) => setRows(r ?? [])).catch(() => setRows([]));
  }, []);

  const runSearch = useCallback(
    async (which: Mode) => {
      const needle = q.trim();
      if (!needle) return;
      setBusy(true);
      setMode(which);
      try {
        const r = which === "terminals" ? await api.searchTerminals(needle) : await api.search(needle);
        setHits(r ?? []);
      } catch {
        setHits([]);
      }
      setBusy(false);
    },
    [q],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows ?? [];
    return (rows ?? []).filter(
      (r) =>
        r.title.toLowerCase().includes(needle) ||
        r.project.toLowerCase().includes(needle) ||
        r.cwd.toLowerCase().includes(needle),
    );
  }, [rows, q]);

  const searching = mode !== "titles" && hits !== null;

  const resume = (id: string) => api.archiveResume(id).then((s) => onOpen(s.id)).catch((e) => setProblem(errText(e)));

  const ctx = useContextMenu();
  /* A transcript under the right button: pick it up again, take its id or
     its folder along, or throw it away — the one thing here that asks first. */
  const rowMenu = (r: ArchiveEntry): MenuItem[] => [
    { label: tr("archive.menuResume", "Resume"), onClick: () => void resume(r.id) },
    { label: tr("archive.menuCopyId", "Copy id"), onClick: () => copyText(r.id) },
    { label: tr("files.copy", "COPY PATH"), onClick: () => copyText(r.cwd) },
    { separator: true },
    { label: tr("archive.menuDelete", "Delete transcript"), danger: true, onClick: () => setDoomed(r) },
  ];
  // A search hit knows its session and no more; the row it came from is the
  // one to delete, and that row is in the list behind the search.
  const hitMenu = (h: SearchHit): MenuItem[] => [
    { label: tr("archive.menuResume", "Resume"), onClick: () => void resume(h.sessionId) },
    { label: tr("archive.menuCopyId", "Copy id"), onClick: () => copyText(h.sessionId) },
  ];

  return (
    <section className="list">
      <TopStrip>
        <div className="listbar">
          <span className="prompt">{tr("archive.prompt", "search>")}</span>
          <Input
            value={q}
            placeholder={tr("archive.placeholder", "Title, project or path…")}
            onChange={(e) => {
              setQ(e.target.value);
              setHits(null);
              setMode("titles");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runSearch("conversations");
              }
            }}
          />
{/* Searching every transcript for nothing would return every transcript, so
              with an empty field these say why they are not available instead of
              doing nothing when clicked. */}
          <Tooltip
            text={
              q.trim()
                ? tr("archive.conversationsTip", "Search inside the conversations")
                : tr("archive.needsWords", "Type something to look for first")
            }
          >
            <Button on={mode === "conversations"} disabled={!q.trim()} onClick={() => runSearch("conversations")}>
              {tr("archive.conversations", "CONVERSATIONS")}
            </Button>
          </Tooltip>
          <Tooltip
            text={
              q.trim()
                ? tr("archive.terminalsTip", "Search inside the recorded terminals")
                : tr("archive.needsWords", "Type something to look for first")
            }
          >
            <Button on={mode === "terminals"} disabled={!q.trim()} onClick={() => runSearch("terminals")}>
              {tr("archive.terminals", "TERMINALS")}
            </Button>
          </Tooltip>
          <span className="meta">
            {problem
              ? problem
              : busy
                ? tr("common.working", "searching…")
                : searching
                  ? `${hits!.length}`
                  : `${shown.length} / ${rows?.length ?? 0}`}
          </span>
        </div>
      </TopStrip>

      <div className="listbody">
        {searching ? (
          hits!.length === 0 ? (
            <div className="emptyNote">
              <b>{tr("archive.noHitsHead", "nothing found")}</b>
              {tr("archive.noHits", "No transcript contains that. Try the other mode, or fewer words.")}
            </div>
          ) : (
            hits!.map((h, i) => (
              <div key={`${h.sessionId}-${i}`} className="row tall" onContextMenu={ctx(hitMenu(h))}>
                <span className="hitDate">{day(h.mod)}</span>
                <span className="hitMain">
                  <span className="hitTitle">{h.title || h.project}</span>
                  <span className="hitExcerpt">{h.excerpt}</span>
                </span>
                <span className="hitSmall">{h.role}</span>
                <span className="hitAction">
                  <Button tiny onClick={() => void resume(h.sessionId)}>
                    {tr("archive.resume", "RESUME")}
                  </Button>
                </span>
              </div>
            ))
          )
        ) : rows === null ? null : shown.length === 0 ? (
          <div className="emptyNote">
            <b>{tr("archive.emptyHead", "nothing found")}</b>
            {tr("archive.empty", "No transcript matches. Clear the field to see everything.")}
          </div>
        ) : (
          shown.map((r) => (
            <div key={r.id} className="row" onContextMenu={ctx(rowMenu(r))}>
              <span className="hitDate">{day(r.mod)}</span>
              <span className="hitMain">
                <span className="hitTitle">{r.title || r.project}</span>
                <span className="hitExcerpt">{r.cwd}</span>
              </span>
              <span className="hitSmall">{r.model}</span>
              <span className="hitAction">
                <Button tiny onClick={() => void resume(r.id)}>
                  {tr("archive.resume", "RESUME")}
                </Button>
              </span>
            </div>
          ))
        )}
      </div>

      {doomed ? (
        <Ask
          heading={tr("archive.deleteAsk", "Delete transcript?")}
          detail={tr("archive.deleteDetail", "{title} is removed from disk. A session that is still running keeps its own copy until it ends.", {
            title: doomed.title || doomed.project,
          })}
          confirmLabel={tr("common.delete", "DELETE")}
          danger
          onCancel={() => setDoomed(null)}
          onConfirm={() => {
            const gone = doomed;
            setDoomed(null);
            setProblem("");
            api
              .archiveDelete(gone.id, gone.account)
              .then(() => setRows((all) => (all ?? []).filter((r) => r.id !== gone.id)))
              .catch((e) => setProblem(`${tr("archive.deleteFailed", "Delete failed")}: ${errText(e)}`));
          }}
        />
      ) : null}
    </section>
  );
}
