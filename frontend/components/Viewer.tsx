"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { openSearchPanel } from "@codemirror/search";
import { selectAll } from "@codemirror/commands";
import Ask from "@/components/ui/Ask";
import Button from "@/components/ui/Button";
import Tooltip from "@/components/ui/Tooltip";
import Editor from "@/components/ui/Editor";
import { useContextMenu, type MenuItem } from "@/components/ui/Menu";
import { api } from "@/lib/api";
import { copyText } from "@/lib/browser";
import { tr, errText } from "@/lib/i18n";
import { bindingOf, caption } from "@/lib/keymap";
import { FILES_CHANGED } from "@/lib/useChanges";
import type { Baseline, FileBody } from "@/lib/types";

/* Read and edit one file from the machine the session or folder is on.
 *
 * It fills whatever box it is put in — a dock panel beside the terminal — and
 * nothing here is positioned: it used to be an overlay that lay across the
 * terminal, so opening a file hid the very thing the file was being read next
 * to. Saving is explicit, with the key everybody already uses for it, and the
 * unsaved marker says so before anyone closes it.
 *
 * One file for the life of the component: the path is in the panel's id, so a
 * second file is a second panel with its own editor and its own undo history,
 * and no buffer is ever switched out from under unsaved edits.
 *
 * The file on disk can move under an open editor — an agent in the same tree
 * is exactly the case. That is noticed through the one live-git signal, and
 * what happens then depends on whether there is anything to lose: a buffer
 * with no edits takes the new text; one with edits is told, and offered the
 * choice, and never overwritten.
 */
export default function Viewer({
  rootId,
  path,
  line,
  jump = 0,
  onClose,
  onDirty,
}: {
  /* A session or a folder — the service reads which from the id. */
  rootId: string;
  path: string;
  /* Where to land, when the file was reached from a search hit. */
  line?: number;
  /* Changes when the same line is asked for again, so the cursor moves again. */
  jump?: number;
  onClose: () => void;
  /* Told whenever the buffer gains or loses unsaved edits, so whatever holds
     this editor — its tab — can refuse to close over them. */
  onDirty?: (dirty: boolean) => void;
}) {
  const [body, setBody] = useState<FileBody | null>(null);
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  /* The file as HEAD has it — what the gutter measures the buffer against.
     Undefined until asked; null when there is nothing to measure. */
  const [baseline, setBaseline] = useState<string | null | undefined>(undefined);
  /* A newer file on disk than the buffer was read from, held here rather
     than put into the editor, because the buffer has edits in it. */
  const [onDisk, setOnDisk] = useState<FileBody | null>(null);
  /* CLOSE was pressed on a buffer with edits: the bar now asks, and nothing
     closes until DISCARD is chosen. Cleared the moment the edits are saved. */
  const [confirmClose, setConfirmClose] = useState(false);
  useEffect(() => {
    onDirty?.(dirty);
    if (!dirty) setConfirmClose(false);
  }, [dirty, onDirty]);
  // What the handlers below need to know without being rebuilt for it.
  const latest = useRef({ body, dirty });
  latest.current = { body, dirty };

  const readBaseline = useCallback(() => {
    api
      .baseFile(rootId, path)
      .then((b: Baseline) => setBaseline(b.binary || b.truncated ? null : b.text))
      .catch(() => setBaseline(null));
  }, [rootId, path]);

  useEffect(() => {
    setError("");
    setOnDisk(null);
    setBaseline(undefined);
    api
      .readFile(rootId, path)
      .then((b) => {
        setBody(b);
        setText(b.text);
        setDirty(false);
        if (b.binary || b.truncated) setBaseline(null);
        else readBaseline();
      })
      .catch((e) => {
        setBody(null);
        setText("");
        setDirty(false);
        setError(errText(e));
      });
  }, [rootId, path, readBaseline]);

  /* The folder moved. Whether this file did is asked of the service — the
     timestamp it hands back is the same one the save guard is measured
     against — and only then does anything happen here. */
  useEffect(() => {
    const look = () => {
      const { body: was, dirty: edited } = latest.current;
      if (!was) return;
      api
        .readFile(rootId, path)
        .then((fresh) => {
          if (fresh.mod === was.mod) return;
          if (edited) {
            setOnDisk(fresh);
          } else {
            setBody(fresh);
            setText(fresh.text);
            setOnDisk(null);
          }
        })
        .catch(() => undefined);
      readBaseline();
    };
    window.addEventListener(FILES_CHANGED, look);
    return () => window.removeEventListener(FILES_CHANGED, look);
  }, [rootId, path, readBaseline]);

  // Take the file as it is on disk, letting the edits go — asked for, never done.
  function reload() {
    if (!onDisk) return;
    setBody(onDisk);
    setText(onDisk.text);
    setDirty(false);
    setOnDisk(null);
  }

  async function save() {
    setError("");
    try {
      /* The timestamp this window last read goes with it: the service refuses
         the write when the file has changed on disk since — an agent working
         in the same tree is exactly the case this is for. The answer carries
         the new timestamp, so a second save is measured against the right one. */
      const fresh = await api.writeFile(rootId, path, text, body?.mod ?? 0);
      setBody(fresh);
      setDirty(false);
      setOnDisk(null);
    } catch (e) {
      setError(errText(e));
    }
  }

  const name = path.split("/").pop() ?? path;

  /* The editor under the right button.
   *
   * The live CodeMirror view is found from its own element rather than
   * threaded out of ui/Editor: the editor stays a closed box, and the menu
   * reads the selection at the moment of the click — whether Cut and Copy
   * have anything to act on is decided then, not at render. */
  const host = useRef<HTMLDivElement>(null);
  const [askLine, setAskLine] = useState(false);
  const ctx = useContextMenu();
  const view = (): EditorView | null => {
    const el = host.current?.querySelector<HTMLElement>(".cm-editor");
    return el ? EditorView.findFromDOM(el) : null;
  };
  const editorMenu = (): MenuItem[] => {
    const v = view();
    const sel = v?.state.selection.main;
    const hasSelection = Boolean(sel && !sel.empty);
    const selected = () => (v && sel ? v.state.sliceDoc(sel.from, sel.to) : "");
    const locked = Boolean(body?.truncated);
    return [
      {
        label: tr("editor.cut", "Cut"),
        hint: caption("Mod+X"),
        disabled: !hasSelection || locked,
        onClick: () => {
          if (!v) return;
          copyText(selected());
          v.dispatch(v.state.replaceSelection(""));
          v.focus();
        },
      },
      { label: tr("term.copy", "Copy"), hint: caption("Mod+C"), disabled: !hasSelection, onClick: () => copyText(selected()) },
      {
        label: tr("term.paste", "Paste"),
        hint: caption("Mod+V"),
        disabled: !v || locked,
        onClick: () => {
          void navigator.clipboard?.readText()
            .then((text) => {
              const now = view();
              if (!now || !text) return;
              now.dispatch(now.state.replaceSelection(text));
              now.focus();
            })
            .catch(() => undefined);
        },
      },
      {
        label: tr("term.selectAll", "Select all"),
        hint: caption("Mod+A"),
        disabled: !v,
        onClick: () => {
          if (!v) return;
          selectAll(v);
          v.focus();
        },
      },
      { separator: true },
      {
        label: tr("term.find", "Find…"),
        hint: caption(bindingOf("find")),
        disabled: !v,
        onClick: () => {
          if (!v) return;
          v.focus();
          openSearchPanel(v);
        },
      },
      { label: tr("editor.goToLine", "Go to line…"), disabled: !v, onClick: () => setAskLine(true) },
      { separator: true },
      { label: tr("common.save", "SAVE"), hint: caption("Mod+S"), disabled: !dirty || locked, onClick: () => void save() },
      { label: tr("common.close", "CLOSE"), onClick: () => (dirty ? setConfirmClose(true) : onClose()) },
    ];
  };
  // The line asked for, put under the cursor and into view.
  const goToLine = (answer: string) => {
    const v = view();
    const n = parseInt(answer.trim(), 10);
    if (!v || !Number.isFinite(n) || n < 1) return;
    const at = v.state.doc.line(Math.min(n, v.state.doc.lines));
    v.dispatch({ selection: { anchor: at.from }, effects: EditorView.scrollIntoView(at.from, { y: "center" }) });
    v.focus();
  };

  return (
    <div className="editorBody" ref={host} onContextMenu={(e) => ctx(editorMenu())(e)}>
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
        {onDisk ? (
          <>
            <span className="notice warn">{tr("viewer.changedOnDisk", "changed on disk")}</span>
            <Tooltip text={tr("viewer.reloadTip", "Take the file as it is on disk; the edits here are lost")}>
              <Button onClick={reload}>{tr("viewer.reload", "RELOAD")}</Button>
            </Tooltip>
            <Tooltip text={tr("viewer.keepTip", "Keep what is in the editor; saving will refuse until it is reloaded")}>
              <Button onClick={() => setOnDisk(null)}>{tr("viewer.keep", "KEEP MINE")}</Button>
            </Tooltip>
          </>
        ) : null}
        {dirty ? <span className="dirty">{tr("viewer.dirty", "unsaved")}</span> : null}
        {dirty && !body?.truncated ? <Button onClick={save}>{tr("common.save", "SAVE")}</Button> : null}
        <span className="notice">{tr("viewer.keys", "⌘S save · ⌘F find")}</span>
        {confirmClose ? (
          <>
            <span className="notice warn">{tr("viewer.closeUnsaved", "unsaved edits — close anyway?")}</span>
            <Button danger onClick={onClose}>
              {tr("viewer.discard", "DISCARD")}
            </Button>
            <Button onClick={() => setConfirmClose(false)}>{tr("common.cancel", "CANCEL")}</Button>
          </>
        ) : (
          <Button onClick={() => (dirty ? setConfirmClose(true) : onClose())}>{tr("common.close", "CLOSE")}</Button>
        )}
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
            key={path}
            value={text}
            filename={name}
            goToLine={line}
            jump={jump}
            baseline={baseline}
            /* Only as much of a big file is loaded as the service will hand out.
               Editing what was loaded and saving it would write the first half
               over the whole — so a file that arrived cut off can be read here
               and not changed. The service refuses such a write as well; this
               is so nobody types a page into it first. */
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

      {askLine ? (
        <Ask
          heading={tr("editor.goToLine", "Go to line…")}
          detail={body ? tr("editor.goToLineDetail", "1 to {n}", { n: body.lines }) : undefined}
          field={tr("editor.line", "line")}
          confirmLabel={tr("editor.go", "GO")}
          onCancel={() => setAskLine(false)}
          onConfirm={(answer) => {
            setAskLine(false);
            goToLine(answer);
          }}
        />
      ) : null}
    </div>
  );
}
