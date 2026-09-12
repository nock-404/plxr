"use client";

import { useEffect, useRef, useState } from "react";
import { wsUrl } from "./token";
import type { ChangesFrame, GitChange, GitWhere } from "./types";

/* The one live-git signal, on the window side.
 *
 * Subscribes to /ws/changes/{id} — the service's watcher on the folder of a
 * session or a workspace — the way useTiles subscribes to the tiles. A frame
 * arrives only when the folder's state changed, so nothing here polls and
 * nothing redraws for the same state twice. Reconnects on a drop; re-opens
 * when the id it follows changes.
 *
 * Every frame with a new rev is also announced on the window as
 * FILES_CHANGED, the event the file tree already refreshes on, so the tree,
 * an open diff and an open editor all refresh off this one source instead of
 * each asking git themselves.
 */

// The event name the tree has always listened for; now it is also fired here.
export const FILES_CHANGED = "plxr:files-changed";

// What rides on the event: which folder moved, and to what.
export type FilesChanged = { rootId: string; rev: string; head: string };

export function announceFilesChanged(detail: FilesChanged) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<FilesChanged>(FILES_CHANGED, { detail }));
}

/* How soon to try again after the link closed.
 *
 * Closed by the service with a reason is not a dropped link. A folder git
 * does not know is not going to become one in the next second — but it may
 * after a `git init`, so it is asked again, slowly. An id the service does
 * not know yet is the restore-before-data moment: the session is a beat away,
 * so that one is asked again soon. A plain drop is retried at once. */
function retryAfter(problem: string, attempt: number): number {
  if (problem.startsWith("err.git.noRepo")) return 10000;
  if (problem.startsWith("err.session.unknown")) return 2000;
  // A plain drop backs off, 1 s doubling to 10 s, the way the terminal does:
  // with the service down, a fixed second meant a socket a second per panel
  // per window for as long as the window stayed open.
  return Math.min(1000 * 2 ** attempt, 10000);
}

export type LiveChanges = {
  /* null until the first frame for this id — "not asked yet" is not "clean". */
  changes: GitChange[] | null;
  where: GitWhere | null;
  head: string;
  rev: string;
  /* An error code from the last frame, or empty. */
  problem: string;
  connected: boolean;
};

export function useChanges(id: string | null): LiveChanges {
  const [state, setState] = useState<LiveChanges>({ changes: null, where: null, head: "", rev: "", problem: "", connected: false });
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setState({ changes: null, where: null, head: "", rev: "", problem: "", connected: false });
    if (!id) return;
    let closed = false;
    let ws: WebSocket | null = null;
    let lastRev: string | null = null;
    let lastProblem = "";
    let attempt = 0;

    function open() {
      ws = new WebSocket(wsUrl(`/ws/changes/${encodeURIComponent(id as string)}`));
      ws.onopen = () => {
        lastProblem = "";
        setState((s) => ({ ...s, connected: true }));
      };
      ws.onmessage = (e) => {
        let f: ChangesFrame;
        try {
          f = JSON.parse(e.data) as ChangesFrame;
        } catch {
          return; /* a malformed frame; the next state corrects it */
        }
        lastProblem = f.problem ?? "";
        attempt = 0; // a frame arrived: the link is good, start the backoff over
        setState({
          changes: f.changes ?? [],
          where: f.problem ? null : f.where,
          head: f.head ?? "",
          rev: f.rev,
          problem: lastProblem,
          connected: true,
        });
        // The first frame is where things stand; every later one is a move,
        // and the rest of the window is told so.
        if (lastRev !== null && lastRev !== f.rev && !f.problem) {
          announceFilesChanged({ rootId: id as string, rev: f.rev, head: f.head ?? "" });
        }
        lastRev = f.rev;
      };
      ws.onclose = () => {
        setState((s) => ({ ...s, connected: false }));
        if (!closed) timer.current = window.setTimeout(open, retryAfter(lastProblem, attempt++));
      };
      ws.onerror = () => ws?.close();
    }
    open();

    return () => {
      closed = true;
      if (timer.current) window.clearTimeout(timer.current);
      ws?.close();
    };
  }, [id]);

  return state;
}
