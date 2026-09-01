"use client";

import { api } from "@/lib/api";
import type { VersionInfo } from "@/lib/types";

/* Whether there is a newer plxr, asked more than once.
 *
 * Both the band at the top and the line in the settings used to ask when they
 * were built and never again. A window that stays open for days — which is the
 * normal way this one is used — therefore learned about a release only if it
 * happened to be restarted afterwards. The daemon had the right answer the whole
 * time; nobody asked it a second time.
 *
 * One place asks, on a slow beat, and tells whoever is listening. Two components
 * wanting the same answer should not be two requests.
 */

let known: VersionInfo | null = null;
let timer: number | null = null;
const listeners = new Set<(v: VersionInfo | null) => void>();

// Twice an hour. A release is not an event anybody needs within seconds, and
// the daemon reaches out to GitHub for every one of these.
const BEAT = 30 * 60 * 1000;

async function ask(): Promise<void> {
  try {
    known = await api.version();
  } catch {
    known = null; // unreachable is not "up to date"
  }
  for (const tell of listeners) tell(known);
}

/* Listen for the answer. The current one arrives immediately if there is one,
   so a panel opening does not sit blank while the first request goes out. */
export function watchVersion(tell: (v: VersionInfo | null) => void): () => void {
  listeners.add(tell);
  if (known) tell(known);
  if (timer === null) {
    void ask();
    timer = window.setInterval(() => void ask(), BEAT);
  }
  return () => {
    listeners.delete(tell);
  };
}

// Ask now, whatever the beat says: opening the settings is somebody wanting to
// know, and waiting up to half an hour for that would be absurd.
export function askVersionNow(): void {
  void ask();
}
