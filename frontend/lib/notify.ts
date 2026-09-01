"use client";

// A session that starts waiting is the one thing worth interrupting for. The
// sound is generated, so nothing has to be shipped or fetched, and it only ever
// fires on a change — never on the state a tile is already in.
import type { Tile } from "./types";

let previous = new Map<string, string>();
let armed = false;

export function arm(): void {
  armed = true;
}

function beep(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.36);
    osc.onended = () => ctx.close();
  } catch {
    /* audio unavailable — the tile still turns colour, which is the real signal */
  }
}

// Returns the sessions that have just started waiting for an answer.
export function changed(tiles: Tile[]): Tile[] {
  const now = new Map(tiles.map((t) => [t.id, t.frozen ? "frozen" : t.status]));
  const started: Tile[] = [];
  for (const t of tiles) {
    const before = previous.get(t.id);
    const state = now.get(t.id)!;
    const waiting = state === "permission" || state === "waiting";
    const wasWaiting = before === "permission" || before === "waiting";
    if (before !== undefined && waiting && !wasWaiting) started.push(t);
  }
  previous = now;
  if (armed && started.length > 0) beep();
  return started;
}
