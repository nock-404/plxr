package marks

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// Putting a whole mark back, which is what the button in the panel means.
//
// A file changed since the mark goes back. A file made since the mark stays:
// "restore" does not promise to delete somebody's new work, and there is
// nothing in the tree to put in its place.
func TestRestoreAll(t *testing.T) {
	dir := t.TempDir()
	git := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t",
			"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v: %s", args, err, out)
		}
	}
	write := func(name, text string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	read := func(name string) string {
		t.Helper()
		b, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return ""
		}
		return string(b)
	}

	git("init", "-q", ".")
	write("a.txt", "one\n")
	write("b.txt", "two\n")
	git("add", "-A")
	git("commit", "-qm", "start")

	tree, err := Take(dir)
	if err != nil || tree == "" {
		t.Fatalf("Take: %v (%q)", err, tree)
	}

	write("a.txt", "CHANGED\n")
	write("b.txt", "ALSO\n")
	write("c.txt", "made after the mark\n")

	n, err := RestoreAll(dir, tree)
	if err != nil {
		t.Fatalf("RestoreAll: %v", err)
	}
	if n != 2 {
		t.Fatalf("expected two files put back, got %d", n)
	}
	if got := read("a.txt"); got != "one\n" {
		t.Fatalf("a.txt: want %q, got %q", "one\n", got)
	}
	if got := read("b.txt"); got != "two\n" {
		t.Fatalf("b.txt: want %q, got %q", "two\n", got)
	}
	if got := read("c.txt"); got != "made after the mark\n" {
		t.Fatalf("c.txt should have been left alone, got %q", got)
	}
}
