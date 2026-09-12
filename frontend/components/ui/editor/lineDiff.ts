/* Which lines differ between two versions of a file.
 *
 * Myers' shortest-edit-script over lines, which is what git itself uses. It
 * is asked on every keystroke, so it is cheap where it can be: the common
 * head and tail are stripped first, and the search is bounded — a buffer that
 * differs from its baseline in more than `maxD` lines is one big change, said
 * as one hunk, rather than a search that would cost the machine.
 *
 * No library: the one merge view CodeMirror offers brings a stylesheet of its
 * own, and the gutter needs the hunks, not a view.
 */

/* One stretch that differs: `oldLen` lines from `oldStart` in the baseline
   became `newLen` lines from `newStart` in the buffer. Zero-based. Either
   length may be zero — pure insertion, pure deletion — never both. */
export type Hunk = { oldStart: number; oldLen: number; newStart: number; newLen: number };

export function lineDiff(a: readonly string[], b: readonly string[], maxD = 1500): Hunk[] {
  let head = 0;
  const shortest = Math.min(a.length, b.length);
  while (head < shortest && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < shortest - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;

  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  if (midA.length === 0 && midB.length === 0) return [];
  if (midA.length === 0 || midB.length === 0) {
    return [{ oldStart: head, oldLen: midA.length, newStart: head, newLen: midB.length }];
  }
  const found = myers(midA, midB, maxD);
  if (!found) return [{ oldStart: head, oldLen: midA.length, newStart: head, newLen: midB.length }];
  for (const h of found) {
    h.oldStart += head;
    h.newStart += head;
  }
  return found;
}

type Op = { kind: "ins" | "del"; old: number; new: number };

/* The search, and the walk back through it. Null when the edit distance
   passes `maxD` — the caller has a coarser answer for that. */
function myers(a: readonly string[], b: readonly string[], maxD: number): Hunk[] | null {
  const n = a.length;
  const m = b.length;
  const limit = Math.min(n + m, maxD);
  const off = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  v[off + 1] = 0;
  const trace: Int32Array[] = [];
  let reached = -1;
  for (let d = 0; d <= limit && reached < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) x = v[off + k + 1];
      else x = v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        reached = d;
        break;
      }
    }
  }
  if (reached < 0) return null;

  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = reached; d >= 0; d--) {
    const snap = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && snap[off + k - 1] < snap[off + k + 1]) ? k + 1 : k - 1;
    const prevX = snap[off + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
    }
    if (d > 0) ops.push({ kind: x === prevX ? "ins" : "del", old: prevX, new: prevY });
    x = prevX;
    y = prevY;
  }
  ops.reverse();

  const hunks: Hunk[] = [];
  for (const op of ops) {
    const last = hunks[hunks.length - 1];
    const joins = last && last.oldStart + last.oldLen === op.old && last.newStart + last.newLen === op.new;
    if (joins) {
      if (op.kind === "del") last.oldLen++;
      else last.newLen++;
    } else if (op.kind === "del") {
      hunks.push({ oldStart: op.old, oldLen: 1, newStart: op.new, newLen: 0 });
    } else {
      hunks.push({ oldStart: op.old, oldLen: 0, newStart: op.new, newLen: 1 });
    }
  }
  return hunks;
}

/* What each buffer line wears in the gutter, from the hunks: a line that
   replaced something is `mod`, one with nothing behind it is `add`, and a
   deletion — which has no line of its own — marks the line after it (or the
   last line, when the end was cut). Keyed by zero-based buffer line. */
export type Mark = "add" | "mod" | "del";

export function marksOf(hunks: Hunk[], lines: number): Map<number, Mark> {
  const out = new Map<number, Mark>();
  for (const h of hunks) {
    if (h.newLen > 0) {
      const kind: Mark = h.oldLen > 0 ? "mod" : "add";
      for (let i = h.newStart; i < h.newStart + h.newLen; i++) out.set(i, kind);
    } else if (lines > 0) {
      const at = Math.min(h.newStart, lines - 1);
      if (!out.has(at)) out.set(at, "del");
    }
  }
  return out;
}
