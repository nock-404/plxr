"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { tr } from "@/lib/i18n";
import { api } from "@/lib/api";
import type { Reply, Tile } from "@/lib/types";

// Everything that is waiting for an answer, answerable without opening it.
export default function Inbox({ tiles, onOpen }: { tiles: Tile[]; onOpen: (id: string) => void }) {
  const waiting = tiles.filter((t) => t.status === "permission" || t.status === "waiting");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // What was answered to this same question before. A question that comes back
  // word for word usually has the same answer, and retyping it is wasted time.
  const [memory, setMemory] = useState<Record<string, Reply[]>>({});

  useEffect(() => {
    for (const t of waiting) {
      const q = (t.question || "").trim();
      if (!q || memory[t.id] !== undefined) continue;
      api
        .replies(q.slice(0, 120))
        .then((r) => setMemory((m) => ({ ...m, [t.id]: r ?? [] })))
        .catch(() => setMemory((m) => ({ ...m, [t.id]: [] })));
    }
  }, [waiting, memory]);

  async function send(id: string) {
    const text = (drafts[id] ?? "").trim();
    if (!text) return;
    setDrafts((d) => ({ ...d, [id]: "" }));
    await api.reply(id, text).catch(() => undefined);
  }

  return (
    <section className="list">
      <div className="listbar">
        <span className="prompt">{tr("inbox.prompt", "waiting>")}</span>
        <span className="meta">
          {waiting.length} {tr("inbox.open", "open")}
        </span>
      </div>
      <div className="listbody">
        {waiting.length === 0 ? (
          <div className="emptyNote">
            <b>{tr("inbox.emptyHead", "nothing waiting")}</b>
            {tr("inbox.empty", "Every session is working or idle. Questions show up here the moment one appears.")}
          </div>
        ) : (
          waiting.map((t) => (
            <div key={t.id} className="row tall">
              <div className="hitMain">
                <span className="hitTitle" onClick={() => onOpen(t.id)}>
                  {t.name}
                </span>
                <span className="hitExcerpt">{t.question || t.preview}</span>
                {memory[t.id]?.length ? (
                  <span className="memoryHead">
                    {tr("memory.before", "answered before:")}{" "}
                    {memory[t.id].slice(0, 2).map((r) => r.answer).join(" · ")}
                  </span>
                ) : null}
                <span className="rowInline">
                  <Input
                    value={drafts[t.id] ?? ""}
                    placeholder={tr("inbox.replyPlaceholder", "Answer…")}
                    onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        send(t.id);
                      }
                    }}
                  />
                  <Button onClick={() => send(t.id)}>{tr("common.send", "SEND")}</Button>
                </span>
              </div>
              <span className="hitProject">{t.cwd}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
