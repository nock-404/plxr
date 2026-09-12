"use client";

import { useEffect, useRef, useState } from "react";
import Ask from "@/components/ui/Ask";
import Button from "@/components/ui/Button";
import Editor from "@/components/ui/Editor";
import Tooltip from "@/components/ui/Tooltip";
import { api } from "@/lib/api";
import { tr, trN } from "@/lib/i18n";
import { PREFS_CHANGED } from "@/lib/prefsEvents";

/* A scratchpad beside the work.
 *
 * One document, markdown, kept in the prefs blob under `notes` — so it is
 * there in every window and after every restart, and nothing new had to be
 * built on the service for it. The editor is the same one the files open in;
 * what it writes is saved half a second after the last keystroke, and a change
 * made in another window arrives through the prefs revision the shell already
 * watches (lib/prefsEvents).
 *
 * An edit in flight is never overwritten by what comes back over that wire:
 * while a save is pending, the copy here is the newer one. */

const FILENAME = "notes.md";
const SAVE_AFTER_MS = 500;

function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export default function Notes() {
  const [text, setText] = useState("");
  const [asking, setAsking] = useState(false);
  // The text as this panel holds it, readable from the listeners without a
  // rebuild — and whether a save is still on its way.
  const held = useRef("");
  const pending = useRef<number | undefined>(undefined);
  held.current = text;

  const write = (next: string) => {
    void api.setPrefs({ notes: next }).catch(() => undefined);
  };

  const schedule = (next: string) => {
    window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => {
      pending.current = undefined;
      write(next);
    }, SAVE_AFTER_MS);
  };

  useEffect(() => {
    let live = true;
    api
      .prefs()
      .then((p) => {
        if (live && typeof p.notes === "string" && pending.current === undefined) setText(p.notes);
      })
      .catch(() => undefined);
    const follow = (e: Event) => {
      const prefs = (e as CustomEvent).detail as Record<string, unknown> | undefined;
      const theirs = prefs?.notes;
      if (typeof theirs !== "string") return;
      // An edit is still on its way: this window's copy is the newer one.
      if (pending.current !== undefined) return;
      if (theirs !== held.current) setText(theirs);
    };
    window.addEventListener(PREFS_CHANGED, follow);
    return () => {
      live = false;
      window.removeEventListener(PREFS_CHANGED, follow);
      // Closing the panel must not lose the last half second of typing.
      if (pending.current !== undefined) {
        window.clearTimeout(pending.current);
        pending.current = undefined;
        write(held.current);
      }
    };
  }, []);

  const change = (next: string) => {
    setText(next);
    held.current = next;
    schedule(next);
  };

  const clear = () => {
    setAsking(false);
    window.clearTimeout(pending.current);
    pending.current = undefined;
    setText("");
    held.current = "";
    write("");
  };

  const words = wordCount(text);

  return (
    <div className="notesPanel">
      <div className="overlayBar">
        <span className="overlayName">{FILENAME}</span>
        <span className="meta">{trN("notes.words", words, "{n} word", "{n} words")}</span>
        <span className="spacer" />
        <Tooltip text={tr("notes.clearTip", "Empty the notes, in every window")}>
          <Button data-do="clear-notes" disabled={!text} onClick={() => setAsking(true)}>
            {tr("notes.clear", "CLEAR")}
          </Button>
        </Tooltip>
      </div>
      <div className="viewerwrap">
        <Editor
          value={text}
          filename={FILENAME}
          placeholder={tr("notes.placeholder", "Notes beside the work — kept across windows and restarts.")}
          onChange={change}
        />
      </div>
      {asking ? (
        <Ask
          heading={tr("notes.clearHead", "Clear the notes?")}
          detail={tr("notes.clearDetail", "Everything written here is dropped, in every window. There is no way back.")}
          confirmLabel={tr("notes.clear", "CLEAR")}
          danger
          onCancel={() => setAsking(false)}
          onConfirm={clear}
        />
      ) : null}
    </div>
  );
}
