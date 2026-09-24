/* One row per conversation, newest first, and the rest left to the archive. */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/* The types are taken off by hand rather than by pattern: a clever pattern
   over a signature is a second thing to get wrong, and this file has exactly
   one function. */
const src = readFileSync(join(HERE, "sessionsHere.ts"), "utf8")
  .replace(/^export interface[\s\S]*?^\}$/gm, "")
  .replace("export function sessionsHere<L extends LiveSession, E extends EndedSession>(\n  live: L[],\n  archive: E[],\n  shown: number,\n): { running: L[]; over: E[]; more: number } {",
    "function sessionsHere(live, archive, shown) {")
  .replace(" as string[]", "");
const { sessionsHere } = await import(
  `data:text/javascript,${encodeURIComponent(`${src}\nexport { sessionsHere };`)}`
);

const live = [
  { id: "a", claude_session_id: "conv-1" },
  { id: "b" }, // a plain shell: no conversation of its own
];
const archive = [
  { id: "conv-1", mod: 300 }, // the same conversation that is running
  { id: "conv-2", mod: 500 },
  { id: "conv-3", mod: 100 },
  { id: "conv-4", mod: 400 },
];

const got = sessionsHere(live, archive, 2);
assert.deepEqual(got.running.map((t) => t.id), ["a", "b"]);
assert.deepEqual(got.over.map((a) => a.id), ["conv-2", "conv-4"], "newest first, and the running one is not repeated");
assert.equal(got.more, 1);

// Nothing at all is not an error.
const empty = sessionsHere([], [], 6);
assert.deepEqual(empty.running, []);
assert.deepEqual(empty.over, []);
assert.equal(empty.more, 0);

console.log("sessions here: ok");
