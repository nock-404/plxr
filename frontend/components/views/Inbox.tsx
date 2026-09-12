"use client";

import { useEffect, useRef, useState } from "react";
import TopStrip from "@/components/ui/TopStrip";
import Ask from "@/components/ui/Ask";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { useContextMenu, type MenuItem } from "@/components/ui/Menu";
import { tr } from "@/lib/i18n";
import { api } from "@/lib/api";
import { copyText } from "@/lib/browser";
import type { Reply, Tile } from "@/lib/types";

// Everything that is waiting for an answer, answerable without opening it.
export default function Inbox({ tiles, onOpen }: { tiles: Tile[]; onOpen: (id: string) => void }) {
  const waiting = tiles.filter((t) => t.status === "permission" || t.status === "waiting");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // What was answered to this same question before. A question that comes back
  // word for word usually has the same answer, and retyping it is wasted time.
  const [memory, setMemory] = useState<Record<string, Reply[]>>({});
  // The session the menu's Terminate is asking about; nothing ends until YES.
  const [ending, setEnding] = useState<Tile | null>(null);
  // Each row's answer field, so the menu's "Answer…" can put the cursor in it.
  const fields = useRef(new Map<string, HTMLInputElement>());

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

  const ctx = useContextMenu();
  /* The row's own actions under the right button: open it, answer it here,
     pause or resume it, end it, copy its folder — what a waiting session has. */
  const rowMenu = (t: Tile): MenuItem[] => [
    { label: tr("tile.menuOpen", "Open"), onClick: () => onOpen(t.id) },
    {
      label: tr("inbox.menuAnswer", "Answer…"),
      onClick: () => {
        const field = fields.current.get(t.id);
        field?.focus();
        field?.select();
      },
    },
    t.frozen
      ? { label: tr("tile.menuUnfreeze", "Resume"), onClick: () => void api.unfreeze(t.id).catch(() => undefined) }
      : { label: tr("tile.menuFreeze", "Pause"), onClick: () => void api.freeze(t.id).catch(() => undefined) },
    { separator: true },
    { label: tr("tile.menuTerminate", "Terminate"), danger: true, onClick: () => setEnding(t) },
    { separator: true },
    { label: tr("files.copy", "COPY PATH"), onClick: () => copyText(t.cwd) },
  ];

  return (
    <section className="list">
      <TopStrip>
        <div className="listbar">
          <span className="prompt">{tr("inbox.prompt", "waiting>")}</span>
          <span className="meta">
            {waiting.length} {tr("inbox.open", "open")}
          </span>
        </div>
      </TopStrip>
      <div className="listbody">
        {waiting.length === 0 ? (
          <div className="emptyNote">
            <b>{tr("inbox.emptyHead", "nothing waiting")}</b>
            {tr("inbox.empty", "Every session is working or idle. Questions show up here the moment one appears.")}
          </div>
        ) : (
          waiting.map((t) => (
            <div key={t.id} className="row tall" data-session={t.id} onContextMenu={ctx(rowMenu(t))}>
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
                    ref={(el) => {
                      if (el) fields.current.set(t.id, el);
                      else fields.current.delete(t.id);
                    }}
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

      {ending ? (
        <Ask
          heading={tr("inbox.terminateHead", "Terminate this session?")}
          detail={tr("inbox.terminateDetail", "{name} is ended. Its transcript stays in the archive.", { name: ending.name })}
          confirmLabel={tr("tile.menuTerminate", "Terminate")}
          danger
          onCancel={() => setEnding(null)}
          onConfirm={() => {
            const id = ending.id;
            setEnding(null);
            void api.kill(id).catch(() => undefined);
          }}
        />
      ) : null}
    </section>
  );
}
