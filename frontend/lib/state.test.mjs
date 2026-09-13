/* The order sessions are listed in.
 *
 * What has to hold: a session that cannot go on without an answer comes before
 * everything else — a permission before a plain question, the one that has
 * waited longest first — then the ones at work, then the ones that are only
 * alive, then the ones that are over; and within a state the order they came
 * in is kept, so the list does not reshuffle while nothing changed.
 */
import "./resolveTs.mjs";

// i18n reaches for the page and the network when a language loads; neither is
// needed for the English words, and neither exists here.
globalThis.document = { documentElement: { setAttribute() {} } };
globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });

const { byNeed, stateOf } = await import("./state.ts");

let failed = 0;
let held = 0;
const claim = (ok, what) => {
  if (ok) {
    held++;
    return;
  }
  console.error("  " + what);
  failed++;
};
const names = (list) => list.map((t) => t.id).join(" ");
const tile = (id, over) => ({ id, name: id, cwd: "/w", cmd: [], alive: true, status: "unknown", ...over });

const herd = [
  tile("ended", { alive: false, status: "dead" }),
  tile("busy", { status: "working" }),
  tile("idle", { status: "unknown" }),
  tile("waits-new", { status: "waiting", since: 300 }),
  tile("halted", { status: "working", frozen: true }),
  tile("asks", { status: "permission", since: 500 }),
  tile("crashed", { alive: false, status: "dead", orphaned: true }),
  tile("waits-old", { status: "waiting", since: 100 }),
  tile("busy-2", { status: "working" }),
];
const got = byNeed(herd);
claim(
  names(got) === "asks waits-old waits-new busy busy-2 idle halted crashed ended",
  `the herd is listed wrong: ${names(got)}`,
);
claim(got.length === herd.length && herd[0].id === "ended", "byNeed changed or lost what it was given");
claim(stateOf(herd[4]) === "frozen" && got.indexOf(herd[4]) > got.indexOf(herd[1]), "a halted session reporting work is listed as working");

// A permission comes before a question, however long the question has waited.
const both = byNeed([tile("q", { status: "waiting", since: 1 }), tile("p", { status: "permission", since: 9 })]);
claim(names(both) === "p q", `a question came before a permission: ${names(both)}`);

// An ended session that reported waiting is over, not waiting.
const gone = byNeed([tile("over", { alive: false, status: "waiting" }), tile("run", { status: "unknown" })]);
claim(names(gone) === "run over", `an ended session was listed as waiting: ${names(gone)}`);

// Nothing changed, nothing moves: the same states in, the same order out.
const same = [tile("a", { status: "working" }), tile("b", { status: "working" }), tile("c", { status: "working" })];
claim(names(byNeed(same)) === "a b c", `sessions in one state were reshuffled: ${names(byNeed(same))}`);
claim(byNeed([]).length === 0, "an empty list is not empty");

if (failed) {
  console.error(`  ${failed} claims failed`);
  process.exit(1);
}
console.log(`  ${held} claims hold`);
