package git

import (
	"testing"
)

func kinds(d Diff) (plus, minus, ctx int) {
	for _, h := range d.Hunks {
		for _, l := range h.Lines {
			switch l.Kind {
			case "+":
				plus++
			case "-":
				minus++
			case " ":
				ctx++
			}
		}
	}
	return
}

/* A file that is staged and otherwise unchanged has no unstaged difference —
 * that is "no difference", not "a whole new file".
 *
 * The empty-diff branch fell back to `diff --no-index /dev/null <file>`, which
 * presents every line as an addition. A tracked file with nothing to show in
 * the asked-for direction must come back Empty, never as one big + hunk.
 */
func TestNoUnstagedDifferenceIsEmptyNotWholeFile(t *testing.T) {
	dir := repo(t)
	commit(t, dir, "a.txt", "one\ntwo\nthree\n")
	write(t, dir, "a.txt", "one\nTWO\nthree\n")
	git(t, dir, "add", "-A") // fully staged, nothing unstaged

	d, err := Difference(dir, "a.txt", false) // the unstaged view
	if err != nil {
		t.Fatal(err)
	}
	if !d.Empty {
		p, m, _ := kinds(d)
		t.Fatalf("a fully staged file shows an unstaged diff of +%d -%d instead of nothing", p, m)
	}
}

// A genuinely untracked file is still shown whole — the fallback still has its
// real use.
func TestAnUntrackedFileIsShownWhole(t *testing.T) {
	dir := repo(t)
	write(t, dir, "new.txt", "fresh one\nfresh two\n")
	d, err := Difference(dir, "new.txt", false)
	if err != nil {
		t.Fatal(err)
	}
	if p, _, _ := kinds(d); p != 2 {
		t.Fatalf("an untracked file was not shown whole: +%d", p)
	}
}

/* The diff of a staged rename shows the move, not the whole file re-added.
 *
 * Difference limited git to the one new path, which defeats rename detection
 * (both sides must be in the pathspec), so git emitted "new file" and every
 * line as an addition — contradicting the +1 -1 the same row shows.
 */
func TestAStagedRenameDiffShowsTheMove(t *testing.T) {
	dir := repo(t)
	commit(t, dir, "a.txt", "line one\nline two\nline three\n")
	git(t, dir, "mv", "a.txt", "b.txt")
	// one line changed, so it is unmistakably a rename-with-edit
	write(t, dir, "b.txt", "line one\nline TWO\nline three\n")
	git(t, dir, "add", "-A")

	d, err := DifferenceOf(dir, "b.txt", "a.txt", true)
	if err != nil {
		t.Fatal(err)
	}
	p, m, _ := kinds(d)
	if p > 2 || m > 2 {
		t.Fatalf("the rename came back as a whole-file rewrite: +%d -%d", p, m)
	}
	if p == 0 && m == 0 {
		t.Fatalf("the rename's one changed line is not shown: %+v", d)
	}
}

/* Blank context lines must not throw the line numbers off.
 *
 * With diff.suppressBlankEmpty set, git emits a blank context line as "" and
 * not " ", the parser matched no case for it, dropped it, and never advanced
 * the line counters — so every line number after a blank line in the hunk was
 * wrong. A wrong number sends "jump to line" to the wrong place.
 */
func TestBlankContextLinesKeepTheLineNumbersRight(t *testing.T) {
	dir := repo(t)
	git(t, dir, "config", "diff.suppressBlankEmpty", "true")
	commit(t, dir, "a.txt", "one\n\ntwo\nthree\nfour\n")
	write(t, dir, "a.txt", "one\n\ntwo\nthree\nFOUR\n") // change line 5, after a blank

	d, err := Difference(dir, "a.txt", false)
	if err != nil {
		t.Fatal(err)
	}
	var changed *Line
	for i := range d.Hunks {
		for j := range d.Hunks[i].Lines {
			l := &d.Hunks[i].Lines[j]
			if l.Kind == "-" && l.Text == "four" {
				changed = l
			}
		}
	}
	if changed == nil {
		t.Fatalf("the changed line is not in the diff: %+v", d.Hunks)
	}
	if changed.Old != 5 {
		t.Fatalf("the changed line is reported at %d, not its real line 5 — a blank line was miscounted", changed.Old)
	}
}
