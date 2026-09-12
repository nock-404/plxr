package git

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// branched builds a repository with main and a feature branch that changed
// one file, added one, deleted one, and has staged and untracked work on top.
func branched(t *testing.T) string {
	t.Helper()
	dir := repo(t)
	git(t, dir, "checkout", "-q", "-b", "main")
	write(t, dir, "kept.txt", "one\ntwo\nthree\n")
	write(t, dir, "gone.txt", "bye\n")
	write(t, dir, "same.txt", "still\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "start")
	git(t, dir, "checkout", "-q", "-b", "feature")
	write(t, dir, "kept.txt", "one\nTWO\nthree\nfour\n")
	write(t, dir, "made.txt", "new on the branch\n")
	if err := os.Remove(filepath.Join(dir, "gone.txt")); err != nil {
		t.Fatal(err)
	}
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "branch work")
	// main moves on: a review must not count this as the branch's work.
	git(t, dir, "checkout", "-q", "main")
	write(t, dir, "same.txt", "still\nbut main changed it\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "main moved")
	git(t, dir, "checkout", "-q", "feature")
	// Staged but not committed, and untracked, on top.
	write(t, dir, "staged.txt", "staged only\n")
	git(t, dir, "add", "staged.txt")
	write(t, dir, "loose.txt", "never added\n")
	return dir
}

func TestMergeBaseIsWhereTheBranchLeftMain(t *testing.T) {
	dir := branched(t)
	mb, err := MergeBase(dir, "main")
	if err != nil {
		t.Fatal(err)
	}
	// The first commit is where feature parted from main.
	first, _ := Run(dir, "rev-list", "--max-parents=0", "HEAD")
	if mb != first {
		t.Fatalf("merge-base %s, expected the first commit %s", mb, first)
	}
	if DefaultBase(dir) != "main" {
		t.Fatalf("default base %q, expected main", DefaultBase(dir))
	}
	if _, err := MergeBase(dir, "no-such-ref"); err == nil || !strings.HasPrefix(err.Error(), "err.review.badBase") {
		t.Fatalf("a bad base was not refused: %v", err)
	}
}

func TestReviewListsWhatTheBranchDidAndNotWhatMainDid(t *testing.T) {
	dir := branched(t)
	r, err := ReviewOf(dir, "")
	if err != nil {
		t.Fatal(err)
	}
	if r.Base != "main" || r.Branch != "feature" {
		t.Fatalf("base %q branch %q", r.Base, r.Branch)
	}
	status := map[string]string{}
	for _, f := range r.Files {
		status[f.Path] = f.Status
	}
	want := map[string]string{"kept.txt": "M", "made.txt": "A", "gone.txt": "D", "staged.txt": "A", "loose.txt": "?"}
	for path, letter := range want {
		if status[path] != letter {
			t.Errorf("%s: status %q, expected %q (files: %+v)", path, status[path], letter, r.Files)
		}
	}
	if _, listed := status["same.txt"]; listed {
		t.Fatalf("same.txt was changed by main, not by the branch, yet it is listed: %+v", r.Files)
	}
	if len(r.Bases) == 0 || r.Bases[0] != "main" {
		t.Fatalf("bases %v, expected main first", r.Bases)
	}
	var kept *ReviewFile
	for i := range r.Files {
		if r.Files[i].Path == "kept.txt" {
			kept = &r.Files[i]
		}
	}
	if kept == nil || kept.Added != 2 || kept.Removed != 1 {
		t.Fatalf("kept.txt counts %+v, expected +2 -1", kept)
	}
}

func TestRangeDiffMatchesGitDiffAgainstTheMergeBase(t *testing.T) {
	dir := branched(t)
	mb, _ := MergeBase(dir, "main")
	d, err := DifferenceSince(dir, "kept.txt", "", mb)
	if err != nil {
		t.Fatal(err)
	}
	if d.Since != mb || d.Staged {
		t.Fatalf("diff says since=%q staged=%v", d.Since, d.Staged)
	}
	// The same call git makes, by hand: the hunk headers must be the same.
	cmd := exec.Command("git", "-C", dir, "diff", "--no-color", "-U3", mb, "--", "kept.txt")
	cmd.Env = append(os.Environ(), "LC_ALL=C")
	raw, err := cmd.Output()
	if err != nil {
		t.Fatal(err)
	}
	heads := []string{}
	for _, l := range strings.Split(string(raw), "\n") {
		if strings.HasPrefix(l, "@@") {
			heads = append(heads, l)
		}
	}
	if len(d.Hunks) != len(heads) {
		t.Fatalf("%d hunks parsed, git printed %d", len(d.Hunks), len(heads))
	}
	for i, h := range d.Hunks {
		if h.Header != heads[i] {
			t.Fatalf("hunk %d header %q, git printed %q", i, h.Header, heads[i])
		}
	}
	added, removed := 0, 0
	for _, h := range d.Hunks {
		for _, l := range h.Lines {
			switch l.Kind {
			case "+":
				added++
			case "-":
				removed++
			}
		}
	}
	if added != 2 || removed != 1 {
		t.Fatalf("+%d -%d, expected +2 -1", added, removed)
	}

	// An untracked file in range mode is the whole file, added.
	loose, err := DifferenceSince(dir, "loose.txt", "", mb)
	if err != nil {
		t.Fatal(err)
	}
	if loose.Empty || len(loose.Hunks) != 1 || loose.Hunks[0].Lines[0].Kind != "+" {
		t.Fatalf("an untracked file's range diff: %+v", loose)
	}
	// A file main changed and the branch did not is the same as the merge-base.
	same, err := DifferenceSince(dir, "same.txt", "", mb)
	if err != nil {
		t.Fatal(err)
	}
	if !same.Empty {
		t.Fatalf("same.txt differs from the merge-base: %+v", same)
	}
}

func TestDiscardRestoresTrackedAndRemovesUntracked(t *testing.T) {
	dir := repo(t)
	write(t, dir, "kept.txt", "one\ntwo\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "start")
	write(t, dir, "kept.txt", "one\nCHANGED\n")
	write(t, dir, "loose.txt", "never added\n")
	if err := os.Remove(filepath.Join(dir, "kept.txt")); err == nil {
		// Deleted in the working tree — discard has to bring it back too.
	}

	if err := Discard(dir, []string{"kept.txt", "loose.txt"}); err != nil {
		t.Fatal(err)
	}
	back, err := os.ReadFile(filepath.Join(dir, "kept.txt"))
	if err != nil || string(back) != "one\ntwo\n" {
		t.Fatalf("kept.txt after discard: %q, %v", back, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "loose.txt")); !os.IsNotExist(err) {
		t.Fatalf("loose.txt is still there: %v", err)
	}
	list, err := Changes(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Fatalf("status is not clean after discard: %+v", list)
	}
}

func TestStashRoundTrips(t *testing.T) {
	dir := repo(t)
	write(t, dir, "kept.txt", "one\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "start")

	if err := StashPush(dir, "nothing here"); err != ErrNothingToStash {
		t.Fatalf("stashing a clean tree: %v", err)
	}
	if err := StashPop(dir); err != ErrNoStash {
		t.Fatalf("popping with no stash: %v", err)
	}

	write(t, dir, "kept.txt", "one\ntwo\n")
	write(t, dir, "loose.txt", "aside\n")
	if err := StashPush(dir, "half done"); err != nil {
		t.Fatal(err)
	}
	if list, _ := Changes(dir); len(list) != 0 {
		t.Fatalf("the tree is not clean after the stash: %+v", list)
	}
	stashes, err := Stashes(dir)
	if err != nil || len(stashes) != 1 {
		t.Fatalf("stashes %+v, %v", stashes, err)
	}
	if !strings.Contains(stashes[0].Subject, "half done") || stashes[0].Ref != "stash@{0}" || stashes[0].When == 0 {
		t.Fatalf("the stash reads as %+v", stashes[0])
	}
	if err := StashPop(dir); err != nil {
		t.Fatal(err)
	}
	back, _ := os.ReadFile(filepath.Join(dir, "kept.txt"))
	loose, err := os.ReadFile(filepath.Join(dir, "loose.txt"))
	if string(back) != "one\ntwo\n" || err != nil || string(loose) != "aside\n" {
		t.Fatalf("after pop: kept=%q loose=%q %v", back, loose, err)
	}
	if stashes, _ := Stashes(dir); len(stashes) != 0 {
		t.Fatalf("the stash is still listed after pop: %+v", stashes)
	}
}
