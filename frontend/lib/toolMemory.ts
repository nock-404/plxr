"use client";

import { useEffect, useRef, useState } from "react";
import { useToolShown } from "./toolShown";

/* What a tool had on screen, kept for as long as the window is open.
 *
 * A tool's body is taken down more often than it looks. A hidden tool that
 * polls is not rendered at all, and every time an arrangement is loaded — a
 * reset, a preset applied, the layout brought back — dockview makes every
 * panel again, the tree and the notes with them. A search typed and put away
 * came back empty; a tree came back at the folder it was given, folded, with
 * its filter gone and scrolled to the top. What a body wants back is kept
 * here under a key of its own and is where its state starts when the body is
 * made again.
 *
 * A Map in this module and nothing more: it belongs to this window, goes with
 * it, and is written nowhere. */
const kept = new Map<string, unknown>();

type Update<T> = T | ((was: T) => T);

/* The same store for what is not state: a mark one body leaves for the body
   made in its place. */
export function remember(key: string, value: unknown): void {
  kept.set(key, value);
}
export function recall<T>(key: string): T | undefined {
  return kept.get(key) as T | undefined;
}

/* useToolMemory is useState whose value outlives the component. The value last
   set under `key` is where the state starts; every change is kept. A key that
   changes while the component stands — the tree handed another project — is
   another thing remembered, and its own value comes back in the same render.
   An empty key keeps nothing: a body shown somewhere no tool is. */
export function useToolMemory<T>(key: string, initial: T): [T, (next: Update<T>) => void] {
  // The first value asked for is the one a key with nothing kept starts from.
  const first = useRef(initial);
  const recall = (k: string): T => (k && kept.has(k) ? (kept.get(k) as T) : first.current);
  const [held, setHeld] = useState<{ key: string; value: T }>(() => ({ key, value: recall(key) }));
  /* One setter per key for the life of the component, so a callback or an
     effect that lists it is not made again on every render. */
  const setters = useRef(new Map<string, (next: Update<T>) => void>());
  let set = setters.current.get(key);
  if (!set) {
    const k = key;
    set = (next: Update<T>) =>
      setHeld((was) => {
        const base = was.key === k ? was.value : recall(k);
        const value = typeof next === "function" ? (next as (v: T) => T)(base) : next;
        if (k) kept.set(k, value);
        // A late answer for a key this component has moved on from is kept
        // for that key and leaves what is on screen alone.
        return was.key === k ? { key: k, value } : was;
      });
    setters.current.set(k, set);
  }
  if (held.key !== key) {
    // Derived during render, so no frame shows one key's value under another.
    const next = { key, value: recall(key) };
    setHeld(next);
    return [next.value, set];
  }
  return [held.value, set];
}

/* How long a position waits for the content that can hold it: a tree reads
   its folders one listing at a time, an archive its rows after it is asked. */
const OWED_FOR_MS = 3000;

/* useScrollMemory keeps where a scrolling box in a tool stood, and puts it
   back when the box is made again or its tool comes back on screen — once
   there is enough in the box to stand there, which is why `content` is passed:
   whatever grows the box (its rows) is when to try again. A hand on the box
   before that — the wheel, a press, a key — wins over the kept position. A box
   with no height or no width is behind a hidden edge — the bottom edge hides by
   its height, a side edge by its width — and what it reports is not written:
   the notes' editor behind a hidden right edge, 756 px high and 0 wide, wraps
   every line and moves its own scroll from 400 to 4600. */
export function useScrollMemory(key: string, box: () => HTMLElement | null, content: unknown): void {
  const shown = useToolShown();
  const owed = useRef<{ top: number; until: number } | null>(null);
  const find = useRef(box);
  find.current = box;
  const name = key ? `scroll:${key}` : "";

  useEffect(() => {
    if (!name || !shown) return;
    const top = kept.get(name);
    owed.current = typeof top === "number" && top > 0 ? { top, until: performance.now() + OWED_FOR_MS } : null;
  }, [name, shown]);

  useEffect(() => {
    const el = find.current();
    if (!el || !owed.current) return;
    let frames = 0;
    let frame = 0;
    const pay = () => {
      const due = owed.current;
      if (!due) return;
      if (performance.now() > due.until) {
        owed.current = null;
        return;
      }
      if (el.clientHeight > 0 && el.clientWidth > 0) {
        const room = el.scrollHeight - el.clientHeight;
        el.scrollTop = Math.min(due.top, room);
        // Once it stands there it is held for the rest of its time (see the
        // scroll listener below), not let go: an editor shown again lays its
        // lines out anew a moment later and moves its own scroll with them —
        // measured, from 400 to 190 three milliseconds after it was put back.
        if (room >= due.top) return;
      }
      // Just shown, the box may not be laid out yet: a few frames, no more.
      if (++frames < 20) frame = window.requestAnimationFrame(pay);
    };
    pay();
    return () => window.cancelAnimationFrame(frame);
  }, [name, shown, content]);

  useEffect(() => {
    const el = find.current();
    if (!el || !name) return;
    const note = () => {
      if (el.clientHeight === 0 || el.clientWidth === 0) return;
      const due = owed.current;
      if (due && performance.now() <= due.until) {
        // Owed: the box moved its own scroll, so it is put back where it stood.
        if (el.scrollHeight - el.clientHeight >= due.top && Math.abs(el.scrollTop - due.top) > 1) el.scrollTop = due.top;
        return;
      }
      owed.current = null;
      kept.set(name, el.scrollTop);
    };
    const hand = () => {
      owed.current = null;
    };
    el.addEventListener("scroll", note, { passive: true });
    el.addEventListener("wheel", hand, { passive: true });
    el.addEventListener("pointerdown", hand);
    el.addEventListener("keydown", hand);
    return () => {
      el.removeEventListener("scroll", note);
      el.removeEventListener("wheel", hand);
      el.removeEventListener("pointerdown", hand);
      el.removeEventListener("keydown", hand);
    };
    // The box is looked up again when what it shows changes: a body that
    // draws its scroller later (the notes' editor) is found then.
  }, [name, content]);
}
