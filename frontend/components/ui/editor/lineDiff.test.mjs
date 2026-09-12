/* The gutter's arithmetic, held to git's answers.
 *
 * A gutter that marks the wrong line is worse than none: it says "this
 * changed" about a line that did not. So the hunks are checked against what
 * git would say for the same two texts, and the marks against what the
 * operator expects to see beside each line.
 */
const { lineDiff, marksOf } = await import("./lineDiff.ts");

let failed = 0;
const claim = (ok, what) => {
  if (!ok) {
    console.error("  " + what);
    failed++;
  }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Nothing differs: nothing to say.
claim(same(lineDiff(["a", "b"], ["a", "b"]), []), "identical texts produce no hunk");
claim(same(lineDiff([], []), []), "two empty texts produce no hunk");

// A whole new file: everything added.
claim(same(lineDiff([], ["x", "y"]), [{ oldStart: 0, oldLen: 0, newStart: 0, newLen: 2 }]), "an empty baseline makes every line an addition");

// One line changed in the middle — git says -1 +1 at line 2.
const mod = lineDiff(["one", "two", "three"], ["one", "TWO", "three"]);
claim(same(mod, [{ oldStart: 1, oldLen: 1, newStart: 1, newLen: 1 }]), `a changed line is one hunk of -1 +1: ${JSON.stringify(mod)}`);
claim(same([...marksOf(mod, 3)], [[1, "mod"]]), "a changed line wears mod");

// A line added at the end.
const add = lineDiff(["one", "two"], ["one", "two", "three"]);
claim(same(add, [{ oldStart: 2, oldLen: 0, newStart: 2, newLen: 1 }]), `an appended line is +1: ${JSON.stringify(add)}`);
claim(same([...marksOf(add, 3)], [[2, "add"]]), "an appended line wears add");

// A line deleted from the middle: the line after it carries the mark.
const del = lineDiff(["one", "two", "three"], ["one", "three"]);
claim(same(del, [{ oldStart: 1, oldLen: 1, newStart: 1, newLen: 0 }]), `a removed line is -1: ${JSON.stringify(del)}`);
claim(same([...marksOf(del, 2)], [[1, "del"]]), "a deletion marks the line after it");

// A line deleted from the end: the last line carries it.
const delEnd = lineDiff(["one", "two", "three"], ["one", "two"]);
claim(same([...marksOf(delEnd, 2)], [[1, "del"]]), "a deletion at the end marks the last line");

// Two separate edits are two hunks, each in the right place.
const two = lineDiff(["a", "b", "c", "d", "e", "f"], ["a", "B", "c", "d", "e", "f", "g"]);
claim(
  same(two, [
    { oldStart: 1, oldLen: 1, newStart: 1, newLen: 1 },
    { oldStart: 6, oldLen: 0, newStart: 6, newLen: 1 },
  ]),
  `two edits are two hunks: ${JSON.stringify(two)}`,
);

// A replacement of two lines by three: one hunk, -2 +3, all three mod.
const grow = lineDiff(["a", "x", "y", "b"], ["a", "p", "q", "r", "b"]);
claim(same(grow, [{ oldStart: 1, oldLen: 2, newStart: 1, newLen: 3 }]), `-2 +3 is one hunk: ${JSON.stringify(grow)}`);
claim(same([...marksOf(grow, 5)], [[1, "mod"], [2, "mod"], [3, "mod"]]), "the three new lines all wear mod");

// Past the search bound the answer is coarse, never wrong: one hunk over
// the whole differing middle, with the untouched head and tail left alone.
const big = lineDiff(["k", "1", "2", "3", "4", "z"], ["k", "a", "b", "c", "d", "e", "z"], 1);
claim(same(big, [{ oldStart: 1, oldLen: 4, newStart: 1, newLen: 5 }]), `a bounded search says the whole middle changed: ${JSON.stringify(big)}`);

// Hunks add up: the old side spans the baseline, the new side the buffer.
const a = "the quick brown fox jumps over the lazy dog and runs away".split(" ");
const b = "the slow brown cat jumps over a lazy dog then runs far away".split(" ");
const hunks = lineDiff(a, b);
let oldTotal = a.length;
let newTotal = b.length;
for (const h of hunks) {
  oldTotal += h.newLen - h.oldLen;
}
claim(oldTotal === newTotal, `applying the hunks to the baseline yields the buffer's length (${oldTotal} vs ${newTotal})`);
// And replaying them reproduces b exactly.
let rebuilt = [...a];
for (const h of [...hunks].reverse()) rebuilt.splice(h.oldStart, h.oldLen, ...b.slice(h.newStart, h.newStart + h.newLen));
claim(same(rebuilt, b), `replaying the hunks on the baseline gives the buffer: ${rebuilt.join(" ")}`);

if (failed) {
  console.error(`  ${failed} claims failed`);
  process.exit(1);
}
console.log("  the gutter's line diff agrees with itself — 13 claims");
