"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { api } from "@/lib/api";
import { tr, errText } from "@/lib/i18n";
import type { Template } from "@/lib/types";

// Several sessions in one go: save the current set, start it again later.
export default function Templates({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Template[]>([]);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    api.templates().then((t) => setRows(t ?? [])).catch(() => setRows([]));
  }, []);

  useEffect(load, [load]);

  async function saveCurrent() {
    const label = name.trim();
    if (!label) return;
    setNote("");
    try {
      await api.templateAdd(label.toLowerCase().replace(/\s+/g, "-"), label);
      setName("");
      load();
    } catch (e) {
      setNote(errText(e));
    }
  }

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <b className="cardTitle">{tr("templates.title", "templates")}</b>
        <p className="notice">
          {tr("templates.explain", "A template remembers a set of folders and what runs in them.")}
        </p>

        <div className="splitList">
          {rows.length === 0 ? (
            <div className="emptyNote">
              <b>{tr("templates.emptyHead", "nothing saved")}</b>
              {tr("templates.empty", "Start the sessions you want, then save the current set below.")}
            </div>
          ) : (
            rows.map((t) => (
              <div key={t.name} className="splitRow">
                <span className="hitTitle">{t.label || t.name}</span>
                <span className="meta">{t.entries}</span>
                <span className="spacer" />
                <Button tiny onClick={() => api.templateStart(t.name).then(onClose)}>
                  {tr("common.start", "START")}
                </Button>
                <Button tiny onClick={() => api.templateDelete(t.name).then(load)}>
                  {tr("common.delete", "DELETE")}
                </Button>
              </div>
            ))
          )}
        </div>

        {note ? <p className="notice">{note}</p> : null}

        <div className="field">
          <span className="fieldName">{tr("templates.saveState", "save current set")}</span>
          <span className="rowInline">
            <Input
              value={name}
              placeholder={tr("templates.namePlaceholder", "Name for this set…")}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveCurrent();
                }
              }}
            />
            <Button onClick={saveCurrent}>{tr("common.save", "SAVE")}</Button>
          </span>
        </div>

        <div className="cardButtons">
          <Button primary onClick={onClose}>
            {tr("common.close", "CLOSE")}
          </Button>
        </div>
      </div>
    </div>
  );
}
