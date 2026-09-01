"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Editor from "@/components/ui/Editor";
import { tr } from "@/lib/i18n";

// Write CSS against the running window and watch it change. Docked beside the
// interface rather than over it: an overlay would cover the very thing it is
// meant to show. What is written here rides on top of the skin, so the four
// that ship stay intact.
const KEY = "plxr.workshop";

function sheet(): HTMLStyleElement {
  let el = document.getElementById("plxr-workshop") as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = "plxr-workshop";
    document.head.append(el);
  }
  return el;
}

export function applyStored(): void {
  try {
    const css = localStorage.getItem(KEY);
    if (css) sheet().textContent = css;
  } catch {
    /* storage unavailable — the window simply starts on the plain skin */
  }
}

export default function Workshop({ onClose }: { onClose: () => void }) {
  const [css, setCss] = useState("");

  useEffect(() => {
    try {
      setCss(localStorage.getItem(KEY) ?? "");
    } catch {
      setCss("");
    }
  }, []);

  function write(next: string) {
    setCss(next);
    sheet().textContent = next;
  }

  return (
    <aside className="workbench">
      <div className="wbBar">
        <span className="overlayName">{tr("workshop.title", "Workshop")}</span>
        <span className="wbHint">{tr("workshop.live", "applies as you type")}</span>
        <span className="spacer" />
        <Button
          tiny
          onClick={() => {
            try {
              localStorage.setItem(KEY, css);
            } catch {
              /* nothing to keep it in — the live change still stands */
            }
          }}
        >
          {tr("common.save", "SAVE")}
        </Button>
        <Button
          tiny
          onClick={() => {
            write("");
            try {
              localStorage.removeItem(KEY);
            } catch {
              /* nothing stored */
            }
          }}
        >
          {tr("settings.reset", "RESET")}
        </Button>
        <Button tiny onClick={onClose}>✕</Button>
      </div>
      {/* The same editor the file viewer uses: this is CSS being written, and
          hand-written CSS with no colouring and no bracket matching is how a
          missing brace goes unnoticed until the whole window looks wrong. */}
      <Editor
        value={css}
        filename="workshop.css"
        placeholder={tr("workshop.placeholder", ".tile { border-style: dashed; }")}
        onChange={write}
      />
    </aside>
  );
}
