"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { api } from "@/lib/api";
import { errText, tr } from "@/lib/i18n";
import type { QueueItem, Tile } from "@/lib/types";

// Instructions lined up for a session.
//
// The daemon sends the next one the moment the agent is actually waiting, so
// this list empties itself and the window does not have to be open for it. What
// it has to do here is show what is still coming and let it be taken back —
// a queue you cannot see is a promise you cannot check.
export default function Queue({ tile }: { tile: Tile }) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api
      .queue(tile.id)
      .then((q) => setItems(q ?? []))
      .catch(() => setItems([]));
  }, [tile.id]);

  useEffect(() => {
    load();
    const t = window.setInterval(load, 1500);
    return () => window.clearInterval(t);
  }, [load]);

  async function add() {
    const line = text.trim();
    if (!line) return;
    setText("");
    setError("");
    try {
      await api.queueAdd(tile.id, line);
      load();
    } catch (e) {
      setError(errText(e));
    }
  }

  return (
    <div className="queue">
      <div className="queuebar">
        <span className="prompt">{tr("queue.prompt", "next>")}</span>
        <Input
          value={text}
          placeholder={tr(
            "queue.placeholder",
            "Line up an instruction — it goes out when the agent is ready",
          )}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button onClick={add}>{tr("queue.add", "QUEUE")}</Button>
      </div>

      {error ? <p className="notice warn">{error}</p> : null}

      {items.length > 0 ? (
        <ol className="queuelist">
          {items.map((item, i) => (
            <li key={`${item.added}-${i}`} className="queuerow">
              <span className="queuenum">{i + 1}</span>
              <span className="queuetext">{item.text}</span>
              <Button
                tiny
                title={tr("queue.dropTip", "Take this one back out")}
                onClick={() => api.queueDrop(tile.id, i).then(load).catch((e) => setError(errText(e)))}
              >
                ✕
              </Button>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
