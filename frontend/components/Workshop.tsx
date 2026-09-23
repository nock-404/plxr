"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Editor from "@/components/ui/Editor";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import { keptCss, WORKSHOP_CHANGED } from "@/lib/prefs";

/* Write CSS against the running window and watch it change. Docked beside the
 * interface rather than over it: an overlay would cover the very thing it is
 * meant to show. What is written here rides on top of the skin, so the four
 * that ship stay intact.
 *
 * Kept with the daemon, not only in the window's own storage. The window is
 * served from a port the daemon picks afresh at every start, and to a browser
 * a different port is a different origin with a storage of its own — so what
 * was saved here was gone at the next start, which reads as the settings
 * having been thrown away. localStorage stays as the copy that is already
 * there on the first paint. */
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
  // And the daemon's copy the moment it has answered, which is the one that
  // outlives the window's storage.
  const take = () => {
    const css = keptCss();
    if (css) {
      sheet().textContent = css;
      try {
        localStorage.setItem(KEY, css);
      } catch {
        /* nothing to cache it in */
      }
    }
  };
  take();
  window.addEventListener(WORKSHOP_CHANGED, take);
}

export default function Workshop({ onClose }: { onClose: () => void }) {
  const [css, setCss] = useState("");

  useEffect(() => {
    const stored = (() => {
      try {
        return localStorage.getItem(KEY) ?? "";
      } catch {
        return "";
      }
    })();
    setCss(keptCss() || stored);
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
            void api.setPrefs({ workshopCss: css }).catch(() => undefined);
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
            void api.setPrefs({ workshopCss: null }).catch(() => undefined);
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
