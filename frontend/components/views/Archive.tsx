"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TopStrip from "@/components/ui/TopStrip";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { tr } from "@/lib/i18n";
import { api } from "@/lib/api";
import type { ArchiveEntry, SearchHit } from "@/lib/types";

type Mode = "titles" | "conversations" | "terminals";

function day(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "2-digit" });
}

// Everything that ran before. Filtering by title is instant; the two search
// modes go through the daemon and read the transcripts themselves.
export default function Archive({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<ArchiveEntry[]>([]);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [mode, setMode] = useState<Mode>("titles");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

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
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.title.toLowerCase().includes(needle) ||
        r.project.toLowerCase().includes(needle) ||
        r.cwd.toLowerCase().includes(needle),
    );
  }, [rows, q]);

  const searching = mode !== "titles" && hits !== null;

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
          <Button
            on={mode === "conversations"}
            disabled={!q.trim()}
            title={
              q.trim()
                ? tr("archive.conversationsTip", "Search inside the conversations")
                : tr("archive.needsWords", "Type something to look for first")
            }
            onClick={() => runSearch("conversations")}
          >
            {tr("archive.conversations", "CONVERSATIONS")}
          </Button>
          <Button
            on={mode === "terminals"}
            disabled={!q.trim()}
            title={
              q.trim()
                ? tr("archive.terminalsTip", "Search inside the recorded terminals")
                : tr("archive.needsWords", "Type something to look for first")
            }
            onClick={() => runSearch("terminals")}
          >
            {tr("archive.terminals", "TERMINALS")}
          </Button>
          <span className="meta">
            {busy ? tr("common.working", "searching…") : searching ? `${hits!.length}` : `${shown.length} / ${rows.length}`}
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
              <div key={`${h.sessionId}-${i}`} className="row tall">
                <span className="hitDate">{day(h.mod)}</span>
                <span className="hitMain">
                  <span className="hitTitle">{h.title || h.project}</span>
                  <span className="hitExcerpt">{h.excerpt}</span>
                </span>
                <span className="hitSmall">{h.role}</span>
                <span className="hitAction">
                  <Button
                    tiny
                    onClick={() => api.archiveResume(h.sessionId).then((s) => onOpen(s.id)).catch(() => undefined)}
                  >
                    {tr("archive.resume", "RESUME")}
                  </Button>
                </span>
              </div>
            ))
          )
        ) : shown.length === 0 ? (
          <div className="emptyNote">
            <b>{tr("archive.emptyHead", "nothing found")}</b>
            {tr("archive.empty", "No transcript matches. Clear the field to see everything.")}
          </div>
        ) : (
          shown.map((r) => (
            <div key={r.id} className="row">
              <span className="hitDate">{day(r.mod)}</span>
              <span className="hitMain">
                <span className="hitTitle">{r.title || r.project}</span>
                <span className="hitExcerpt">{r.cwd}</span>
              </span>
              <span className="hitSmall">{r.model}</span>
              <span className="hitAction">
                <Button
                  tiny
                  onClick={() => api.archiveResume(r.id).then((s) => onOpen(s.id)).catch(() => undefined)}
                >
                  {tr("archive.resume", "RESUME")}
                </Button>
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
