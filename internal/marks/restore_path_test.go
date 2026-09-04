package marks

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// What the window actually sends.
//
// POST /api/marks/{id}/{tree}/restore reads the file to put back from ?path=,
// and api.markRestore has never sent it. This asks what Restore does with the
// empty string it therefore always receives.
func TestRestoreWithNoPath(t *testing.T) {
	dir := t.TempDir()
	run := func(args ...string) {
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
	run("init", "-q", ".")
	file := filepath.Join(dir, "one.txt")
	if err := os.WriteFile(file, []byte("first\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", "-A")
	run("commit", "-qm", "start")

	// The mark is taken BEFORE the change, which is what plxr does before every
	// instruction: Take writes a tree of the working copy as it stands.
	tree, err := Take(dir)
	if err != nil || tree == "" {
		t.Fatalf("Take: %v (%q)", err, tree)
	}
	if err := os.WriteFile(file, []byte("second\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// The whole point: this is the call the button makes.
	err = Restore(dir, tree, "")
	back, _ := os.ReadFile(file)
	t.Logf("Restore(dir, tree, \"\") -> %v; file is now %q", err, back)
	if err == nil && string(back) == "first\n" {
		t.Fatalf("unexpectedly restored — the empty path now means something")
	}
	if err == nil {
		t.Fatalf("no error, and nothing restored: %q", back)
	}

	// And with the path it was always meant to have.
	if err := Restore(dir, tree, "one.txt"); err != nil {
		t.Fatalf("Restore with a path: %v", err)
	}
	back, _ = os.ReadFile(file)
	if string(back) != "first\n" {
		t.Fatalf("with a path it should have gone back to %q, got %q", "first\n", back)
	}
}
