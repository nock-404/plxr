"use client";

import { tr, trN } from "./i18n";
import type { Tile } from "./types";

/* One state, one word.
 *
 * A session has exactly one state, and it is named the same in every place it
 * appears: the rail, the tile, the dot's colour and the counter in the status
 * strip. Two of those once said "waiting" and "started" about the same session,
 * which reads as a contradiction even when both are technically true.
 *
 * The state is the word. Anything longer — what the agent is doing right now,
 * why a crashed session is still worth a click — is detail, and detail belongs
 * where it has room: after the word, or in the tooltip.
 */

// Frozen beats any reported status: a halted session writes nothing more, so
// the hook keeps saying "working" and the quiet heuristic says "unknown", and
// both would be a lie. A daemon crash beats everything else.
export function stateOf(t: Tile): string {
  if (t.orphaned) return "orphaned";
  if (t.frozen) return "frozen";
  if (!t.alive) return "dead";
  return t.status || "unknown";
}

// "unknown" is not a word for a person: it is what the daemon reports for a
// session that is alive but says nothing about itself — no hook, or a CLI it
// does not recognise. That is "running", because that is what it is.
const WORD: Record<string, [key: string, english: string]> = {
  working: ["state.working", "working"],
  waiting: ["state.waiting", "waiting"],
  permission: ["state.needsYou", "needs you"],
  unknown: ["state.running", "running"],
  frozen: ["state.frozen", "halted"],
  dead: ["state.ended", "ended"],
  orphaned: ["state.orphaned", "orphaned"],
};

export function stateWord(state: string): string {
  const [key, english] = WORD[state] ?? WORD.unknown;
  return tr(key, english);
}

// The sentence behind the word: only where there is room for it, never instead
// of the word. Truncating a sentence into a one-line field with an ellipsis is
// not a way of saying it.
export function detailOf(t: Tile): string {
  if (t.orphaned) {
    return tr("tile.crashedHint", "Daemon crashed — a click picks the conversation back up");
  }
  if (t.stuck) {
    const files = (t.stuck.files ?? []).slice(0, 2).join(", ");
    return tr("tile.stuck", "going in circles: {files}", { files });
  }
  return t.activity || t.last_message || "";
}

// The name to show. A Claude session carries the conversation title; without
// one the folder name is what identifies it.
export function titleOf(t: Tile): string {
  return t.title || t.name || t.id.slice(0, 8);
}

// A session started with its permission prompts turned off runs without ever
// asking. That is a decision only the person starting it can make — plxr never
// makes it — but it has to be visible afterwards, because the tile otherwise
// looks like every other one while nothing can stop it.
export function unattended(t: Tile): boolean {
  return (t.cmd ?? []).some((a) => /^--dangerously-skip-permissions\b/.test(a));
}

// The CLI, named only when one was actually recognised. "generic" is the
// profile for everything else — printing it says nothing and reads as an error.
export function agentOf(t: Tile): string {
  if (!t.agent || t.agent === "generic") return "";
  return t.agent_label || t.agent;
}

/* The one line each place shows. Every one of them starts with the same word. */

// Rail: the state, and what is doing it.
export function railLine(t: Tile): string {
  return [stateWord(stateOf(t)), agentOf(t)].filter(Boolean).join(" · ");
}

// Tile: the state, and what it is doing right now when that is known. Never
// empty — an empty field is a hole, not a state.
export function tileLine(t: Tile): string {
  const detail = detailOf(t);
  const word = stateWord(stateOf(t));
  // A crash explains itself in the tooltip; in the line it stays one word.
  if (t.orphaned) return word;
  return [word, detail].filter(Boolean).join(" · ");
}

/* One reading of the herd, so the counter, the brake and the room state can
   never disagree with each other or with the tiles. Every session is counted
   once, under its own state — overlapping counts were what made the strip say
   "2 running" while nothing looked like it was running. */

export interface Herd {
  total: number;
  byState: { state: string; n: number }[];
  waiting: number;
  running: number;
  halted: boolean;
}

// The order states are listed in: what needs you first, what is merely alive
// after it, what is over at the end.
const ORDER = ["permission", "waiting", "working", "unknown", "frozen", "orphaned", "dead"];

export function herdOf(tiles: Tile[]): Herd {
  const counted = new Map<string, number>();
  for (const t of tiles) {
    const s = stateOf(t);
    counted.set(s, (counted.get(s) ?? 0) + 1);
  }
  return {
    total: tiles.length,
    byState: ORDER.filter((s) => counted.has(s)).map((s) => ({ state: s, n: counted.get(s)! })),
    waiting: (counted.get("permission") ?? 0) + (counted.get("waiting") ?? 0),
    running: tiles.filter((t) => t.alive).length,
    halted: tiles.some((t) => t.alive && t.frozen),
  };
}

export function countsLine(h: Herd): string {
  const total = trN("counts.session", h.total, "{n} session", "{n} sessions");
  return [total, ...h.byState.map((b) => `${b.n} ${stateWord(b.state)}`)].join(" · ");
}

export function roomOf(h: Herd): string {
  if (h.waiting > 0) return "waiting";
  if (h.running > 0) return "working";
  return "idle";
}
