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
  line,
  onClose,
}: {
  sessionId: string;
  path: string;
  /* Where to land, when the file was reached from a search hit. */
  line?: number;
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
    setError("");
    try {
      /* The timestamp this window last read goes with it: the daemon refuses
         the write when the file has changed on disk since — an agent working
         in the same tree is exactly the case this is for. The answer carries
         the new timestamp, so a second save is measured against the right one. */
      const fresh = await api.writeFile(sessionId, path, text, body?.mod ?? 0);
      setBody(fresh);
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
                  body.truncated
                    ? ` · ${tr("viewer.tooBig", "too big to edit — showing the first part")}`
                    : ""
                }`
              : "")}
        </span>
        <span className="spacer" />
        {dirty ? <span className="dirty">{tr("viewer.dirty", "unsaved")}</span> : null}
        {dirty && !body?.truncated ? <Button onClick={save}>{tr("common.save", "SAVE")}</Button> : null}
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
            goToLine={line}
            /* Only as much of a big file is loaded as the daemon will hand out.
               Editing what was loaded and saving it would write the first half
               over the whole — so a file that arrived cut off can be read here
               and not changed. The daemon refuses such a write as well; this is
               so nobody types a page into it first. */
            readOnly={body?.truncated}
            /* Unsaved means different, not touched.
               Putting the loaded text into the editor is a change as far as
               CodeMirror is concerned, so every file said "unsaved" the moment
               it opened — and offered a SAVE for a file nobody had altered. */
            onChange={(next) => {
              setText(next);
              setDirty(next !== (body?.text ?? ""));
            }}
            onSave={save}
          />
        )}
      </div>
    </div>
  );
}
