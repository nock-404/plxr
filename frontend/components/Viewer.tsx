"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Editor from "@/components/ui/Editor";
import { api } from "@/lib/api";
import { tr, errText } from "@/lib/i18n";
import type { FileBody } from "@/lib/types";

// Read and edit a file from the session's own machine. Saving is explicit — with
// the key everybody already uses for it — and the unsaved marker says so before
// anyone closes it.
export default function Viewer({
  sessionId,
  path,
  onClose,
}: {
  sessionId: string;
  path: string;
  onClose: () => void;
}) {
  const [body, setBody] = useState<FileBody | null>(null);
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    api
      .readFile(sessionId, path)
      .then((b) => {
        setBody(b);
        setText(b.text);
        setDirty(false);
      })
      .catch((e) => setError(errText(e)));
  }, [sessionId, path]);

  async function save() {
    try {
      await api.writeFile(sessionId, path, text);
      setDirty(false);
    } catch (e) {
      setError(errText(e));
    }
  }

  const name = path.split("/").pop() ?? path;

  return (
    <div className="overlay viewer">
      <div className="overlayBar">
        <span className="overlayName">{name}</span>
        <span className="meta">
          {error ||
            (body
              ? `${body.lines} ${tr("viewer.lines", "lines")} · ${Math.round(body.size / 1024)} kB${
                  body.truncated ? ` · ${tr("viewer.truncated", "truncated")}` : ""
                }`
              : "")}
        </span>
        <span className="spacer" />
        {dirty ? <span className="dirty">{tr("viewer.dirty", "unsaved")}</span> : null}
        {dirty ? <Button onClick={save}>{tr("common.save", "SAVE")}</Button> : null}
        <span className="notice">{tr("viewer.keys", "\u2318S save \u00b7 \u2318F find")}</span>
        <Button onClick={onClose}>{tr("common.back", "BACK")}</Button>
      </div>
      <div className="viewerwrap">
        {body?.binary ? (
          <div className="emptyNote">
            <b>{tr("viewer.binaryHead", "not text")}</b>
            {tr("viewer.binary", "This file is binary, so there is nothing sensible to show or edit here.")}
          </div>
        ) : (
          <Editor
            value={text}
            filename={name}
            onChange={(next) => {
              setText(next);
              setDirty(true);
            }}
            onSave={save}
          />
        )}
      </div>
    </div>
  );
}
