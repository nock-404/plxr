"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";

// The console inside the window. Without it every runtime error in a native
// webview is invisible — which is exactly how they used to go unnoticed.
type Line = { at: number; level: string; text: string };

let buffer: Line[] = [];
let started = false;

// Capture from the very first paint, not from when the panel opens.
export function startCapture(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const keep = (level: string, args: unknown[]) => {
    buffer.push({
      at: Date.now(),
      level,
      text: args
        .map((a) => {
          if (typeof a === "string") return a;
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        })
        .join(" "),
    });
    if (buffer.length > 500) buffer = buffer.slice(-500);
    shipOut(buffer[buffer.length - 1]);
  };
  for (const level of ["log", "warn", "error", "info"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      keep(level, args);
      original(...args);
    };
  }
  window.addEventListener("error", (e) => keep("error", [e.message, `${e.filename}:${e.lineno}`]));
  window.addEventListener("unhandledrejection", (e) => keep("error", ["unhandled rejection", String(e.reason)]));
  // Sent in batches rather than one request per line: a page failing in a loop
  // would otherwise spend its time talking about it.
  window.setInterval(drain, 3000);
  window.addEventListener("beforeunload", drain);
}

/* What went wrong, out to the daemon as well.
 *
 * The panel below shows these lines to whoever has the window open at that
 * moment and to nobody else — which is why every fault in here had to be found
 * by asking what was on screen. The daemon has kept a window.log the whole
 * time; nothing was ever sent to it.
 *
 * Only warnings and errors go out. A log of every console line would be noise,
 * and this one is meant to be read.
 */
function shipOut(line: Line): void {
  if (line.level !== "error" && line.level !== "warn") return;
  waiting.push(line);
}

let waiting: Line[] = [];

function drain(): void {
  if (waiting.length === 0) return;
  const text = waiting
    .map((l) => `${new Date(l.at).toISOString()} ${l.level} ${l.text}`)
    .join("\n");
  waiting = [];
  api.windowLog(text + "\n").catch(() => {
    /* the daemon is not answering — the panel still holds the lines */
  });
}

export default function Workbench({ onClose }: { onClose: () => void }) {
  const [lines, setLines] = useState<Line[]>([]);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = window.setInterval(() => setLines([...buffer]), 400);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [lines]);

  return (
    <aside className="workbench">
      <div className="wbBar">
        <span className="overlayName">{tr("workbench.title", "Workbench")}</span>
        <span className="wbHint">{lines.length}</span>
        <span className="spacer" />
        <Button
          tiny
          onClick={() => {
            buffer = [];
            setLines([]);
          }}
        >
          {tr("workbench.clear", "CLEAR")}
        </Button>
        <Button tiny onClick={onClose}>
          ✕
        </Button>
      </div>
      <div className="wbBody" ref={body}>
        {lines.length === 0 ? (
          <div className="emptyNote">
            <b>{tr("workbench.emptyHead", "quiet")}</b>
            {tr("workbench.empty", "Nothing has been logged since this window opened.")}
          </div>
        ) : (
          lines.map((l, i) => (
            <div key={`${l.at}-${i}`} className="wbLine" data-level={l.level}>
              <span className="wbTime">
                {new Date(l.at).toLocaleTimeString(undefined, { hour12: false })}
              </span>
              <span className="wbText">{l.text}</span>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
