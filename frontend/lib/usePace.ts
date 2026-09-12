"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import { PACE_LIMIT_CHANGED, paceLimit } from "./prefs";
import type { Pace } from "./types";

/* The current pace, polled.
 *
 * The service works the five-hour spend out of the transcripts on request
 * (/api/tempo) — it reads only the tail of the files that moved in the last
 * five hours, so asking every few seconds is cheap. It is asked once per
 * window, not once per reader: the status row and the usage panel both
 * subscribe here and share the one poll, the same way every window shares
 * the one revision watch in App.tsx.
 *
 * `pace` is null until the first answer, so a readout can tell "not asked
 * yet" from a real zero. `hot` is the one judgement made here: the spend is
 * past the ceiling the user set — and that ceiling is theirs, not the plan's.
 */
const EVERY = 5000;

let latest: Pace | null = null;
const readers = new Set<(p: Pace | null) => void>();
let timer: number | null = null;
let asking = false;

async function ask(): Promise<void> {
  if (asking) return;
  asking = true;
  try {
    latest = await api.tempo();
  } catch {
    /* the service will be back; the last reading stands until then */
  } finally {
    asking = false;
  }
  for (const r of readers) r(latest);
}

function subscribe(r: (p: Pace | null) => void): () => void {
  readers.add(r);
  if (timer === null) {
    void ask();
    timer = window.setInterval(() => void ask(), EVERY);
  }
  return () => {
    readers.delete(r);
    if (readers.size === 0 && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

export function usePace(): { pace: Pace | null; limit: number; hot: boolean } {
  const [pace, setPace] = useState<Pace | null>(latest);
  const [limit, setLimit] = useState<number>(paceLimit());

  useEffect(() => subscribe(setPace), []);

  useEffect(() => {
    const onLimit = () => setLimit(paceLimit());
    window.addEventListener(PACE_LIMIT_CHANGED, onLimit);
    // Read once more on mount: the service's copy may have landed in between.
    onLimit();
    return () => window.removeEventListener(PACE_LIMIT_CHANGED, onLimit);
  }, []);

  const hot = limit > 0 && pace !== null && pace.window5h > limit;
  return { pace, limit, hot };
}
