"use client";

import { useEffect, useState } from "react";
import TopStrip from "@/components/ui/TopStrip";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { tr, trN } from "@/lib/i18n";
import { api } from "@/lib/api";
import type { Reply, Tile } from "@/lib/types";

/* The rows, grouped the way the herd is read: by account, and within an
   account by project. Twelve questions in a flat list are twelve questions;
   the same twelve under three headings say which account is stuck and which
   project it is stuck on. Within a group a permission prompt comes before a
   plain question, and the one that has waited longest comes first — the
   order they should be answered in. */
type Group = { account: string; projects: { project: string; rows: Tile[] }[]; count: number };

const rank = (t: Tile) => (t.status === "permission" ? 0 : 1);

function groupRows(waiting: Tile[]): Group[] {
  const byAccount = new Map<string, Map<string, Tile[]>>();
  for (const t of waiting) {
    const account = t.account || "";
    const project = t.project || t.name || t.cwd;
    if (!byAccount.has(account)) byAccount.set(account, new Map());
    const projects = byAccount.get(account)!;
    if (!projects.has(project)) projects.set(project, []);
    projects.get(project)!.push(t);
  }
  const out: Group[] = [];
  for (const [account, projects] of byAccount) {
    const list = [...projects].map(([project, rows]) => ({
      project,
      rows: rows.slice().sort((a, b) => rank(a) - rank(b) || (a.since ?? 0) - (b.since ?? 0)),
    }));
    out.push({ account, projects: list, count: list.reduce((n, p) => n + p.rows.length, 0) });
  }
  return out;
}

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

  const groups = groupRows(waiting);

  const row = (t: Tile) => (
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
  );

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
            <b>{tr("inbox.nobodyNeedsYou", "nothing needs you")}</b>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.account} className="inboxGroup">
              <div className="inboxHead">
                <span className="uhead">{g.account || tr("inbox.defaultAccount", "default account")}</span>
                <span className="meta">{trN("inbox.groupCount", g.count, "{n} session", "{n} sessions")}</span>
              </div>
              {g.projects.map((p) => (
                <div key={p.project} className="inboxProject">
                  <div className="inboxHead inboxSub">
                    <span className="uhead">{p.project}</span>
                    <span className="meta">{trN("inbox.groupCount", p.rows.length, "{n} session", "{n} sessions")}</span>
                  </div>
                  {p.rows.map(row)}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
