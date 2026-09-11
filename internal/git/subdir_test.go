package git

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func commit(t *testing.T, dir, name, body string) {
	t.Helper()
	write(t, dir, name, body)
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-q", "-m", "seed")
}

func staged(t *testing.T, dir string) []string {
	t.Helper()
	out := gitOut(t, dir, "diff", "--cached", "--name-status")
	var lines []string
	for _, l := range strings.Split(strings.TrimSpace(out), "\n") {
		if l != "" {
			lines = append(lines, l)
		}
	}
	return lines
}

/* A commit from an opened subfolder commits that folder, not the whole tree.
 *
 * The window's list and its "N files go in" count are scoped to the folder
 * with a `-- .` pathspec; Commit ran with none, so everything staged anywhere
 * in the repository went in — an agent's staged work in a sibling folder
 * committed under the user's message, silently.
 */
func TestCommitFromASubfolderStaysInIt(t *testing.T) {
	dir := repo(t)
	commit(t, dir, "top.txt", "one\n")
	commit(t, dir, "inner/here.txt", "one\n")

	// Something staged in each place.
	write(t, dir, "top.txt", "changed at the top\n")
	write(t, dir, "inner/here.txt", "changed inside\n")
	git(t, dir, "add", "-A")

	inner := filepath.Join(dir, "inner")
	// From inner, with top.txt also staged, the commit must not sweep top.txt
	// in behind the user's back. It is refused, and nothing is committed.
	if _, err := Commit(inner, "just the inside", false); err == nil {
		t.Fatal("a commit from the subfolder took in work staged outside it")
	}
	if len(staged(t, dir)) != 2 {
		t.Fatalf("the refused commit changed the index: %v", staged(t, dir))
	}

	// With nothing staged outside, the same commit goes through and touches
	// only the folder.
	git(t, dir, "reset", "-q", "HEAD", "top.txt")
	if _, err := Commit(inner, "just the inside", false); err != nil {
		t.Fatalf("commit of the folder alone: %v", err)
	}
	if b := gitOut(t, dir, "show", "--stat", "HEAD"); strings.Contains(b, "top.txt") {
		t.Fatalf("the commit reached top.txt after all:\n%s", b)
	}
}

/* Unstaging a rename undoes both halves, even when the old name is above the
 * opened folder.
 *
 * origins() dropped the old half whenever it resolved outside the folder, so
 * Unstage reset only the new name and left "D old" staged — and because the
 * folder's own list is scoped with `-- .`, that staged deletion was nowhere on
 * screen. The next commit removed the original.
 */
func TestUnstagingARenameAcrossTheFolderEdge(t *testing.T) {
	dir := repo(t)
	commit(t, dir, "important.txt", "keep me\n")
	write(t, dir, "inner/other.txt", "x\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-q", "-m", "second")

	// git mv it down into the subfolder, staged.
	git(t, dir, "mv", "important.txt", "inner/important.txt")

	inner := filepath.Join(dir, "inner")
	if err := Unstage(inner, []string{"important.txt"}); err != nil {
		t.Fatalf("unstage: %v", err)
	}

	// Nothing about important.txt may be staged any more.
	for _, l := range staged(t, dir) {
		if strings.Contains(l, "important.txt") {
			t.Fatalf("a staged change to the original survived the unstage: %q", l)
		}
	}
	// The content is still somewhere — the working tree kept the move.
	root := filepath.Join(dir, "important.txt")
	moved := filepath.Join(dir, "inner", "important.txt")
	found := false
	for _, at := range []string{root, moved} {
		if b, err := os.ReadFile(at); err == nil && string(b) == "keep me\n" {
			found = true
		}
	}
	if !found {
		t.Fatal("the only copy of the file was lost")
	}
}

/* One path git refuses does not swallow the rest of the batch.
 *
 * The one-at-a-time retry existed so a single bad path would not take the
 * others down, and then it returned on the first genuine failure — so every
 * path after the offender was never attempted.
 */
func TestOneBadPathDoesNotStopTheOthers(t *testing.T) {
	dir := repo(t)
	commit(t, dir, "a.txt", "a\n")
	commit(t, dir, "b.txt", "b\n")
	write(t, dir, "a.txt", "a changed\n")
	write(t, dir, "b.txt", "b changed\n")

	// "nope.txt" was never known to git; between two real paths it must not
	// stop b.txt from staging.
	if err := Stage(dir, []string{"a.txt", "nope.txt", "b.txt"}); err != nil {
		// An error is allowed (the bad path), but the good ones must be done.
		_ = err
	}
	got := map[string]bool{}
	for _, l := range staged(t, dir) {
		for _, n := range []string{"a.txt", "b.txt"} {
			if strings.Contains(l, n) {
				got[n] = true
			}
		}
	}
	if !got["a.txt"] || !got["b.txt"] {
		t.Fatalf("a bad path in the middle left real ones unstaged: %v", staged(t, dir))
	}
}
