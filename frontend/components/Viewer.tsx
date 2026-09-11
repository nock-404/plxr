"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Editor from "@/components/ui/Editor";
import Ask from "@/components/ui/Ask";
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
  /* The file this viewer actually has open, which is not always the one the
   * parent last asked for. Clicking another file in the tree changes `path`,
   * and if the open one has unsaved edits, switching straight to the new file
   * threw them away without a word. So the load follows `shown`, not `path`,
   * and a change of `path` while there are unsaved edits asks first. */
  const [shown, setShown] = useState(path);
  const [body, setBody] = useState<FileBody | null>(null);
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  // The file waiting behind an unsaved one, while the question stands.
  const [pending, setPending] = useState<string | null>(null);

  // The parent asked for a different file.
  useEffect(() => {
    if (path === shown) return;
    if (dirty) {
      setPending(path);
    } else {
      setShown(path);
    }
  }, [path, shown, dirty]);

  useEffect(() => {
    setError("");
    api
      .readFile(sessionId, shown)
      .then((b) => {
        setBody(b);
        setText(b.text);
        setDirty(false);
      })
      .catch((e) => setError(errText(e)));
  }, [sessionId, shown]);

  async function save() {
    setError("");
    try {
      /* The timestamp this window last read goes with it: the daemon refuses
         the write when the file has changed on disk since — an agent working
         in the same tree is exactly the case this is for. The answer carries
         the new timestamp, so a second save is measured against the right one. */
      const fresh = await api.writeFile(sessionId, shown, text, body?.mod ?? 0);
      setBody(fresh);
      setDirty(false);
    } catch (e) {
      setError(errText(e));
    }
  }

  const name = shown.split("/").pop() ?? shown;

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
        <span className="notice">{tr("viewer.keys", "⌘S save · ⌘F find")}</span>
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
            /* One editor per file, by its whole path — not its name.
               Keyed on the basename, two files called index.ts anywhere in the
               tree shared one editor, and with it one undo history: an undo in
               the second could reach back into edits made in the first. */
            key={shown}
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

      {pending ? (
        <Ask
          title={tr("viewer.unsavedHead", "Unsaved changes")}
          detail={tr(
            "viewer.unsavedSwitch",
            "{name} has changes you have not saved. Leave it and lose them?",
            { name },
          )}
          confirmLabel={tr("viewer.discard", "Discard and switch")}
          danger
          onConfirm={() => {
            setDirty(false);
            setShown(pending);
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </div>
  );
}
