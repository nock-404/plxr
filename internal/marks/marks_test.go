package marks

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func repo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	for _, args := range [][]string{
		{"init", "-q"},
		{"config", "user.email", "t@t"},
		{"config", "user.name", "t"},
	} {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		if err := cmd.Run(); err != nil {
			t.Skip("no git here")
		}
	}
	return dir
}

func TestSnapshotLeavesIndexAndTreeAlone(t *testing.T) {
	dir := repo(t)
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("one"), 0o644)

	tree, err := Take(dir)
	if err != nil || tree == "" {
		t.Fatalf("Take: %v %q", err, tree)
	}
	// The real index must not have seen anything: git status still reports the
	// file as untracked, not as staged.
	cmd := exec.Command("git", "status", "--porcelain")
	cmd.Dir = dir
	out, _ := cmd.Output()
	if string(out) != "?? a.txt\n" {
		t.Errorf("the index was touched: %q", out)
	}
}

// The point of the whole thing: one file back, everything else untouched.
func TestRollBackOneFileOnly(t *testing.T) {
	dir := repo(t)
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("before"), 0o644)
	os.WriteFile(filepath.Join(dir, "b.txt"), []byte("mine"), 0o644)
	tree, err := Take(dir)
	if err != nil {
		t.Fatal(err)
	}

	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("the agent broke this"), 0o644)
	os.WriteFile(filepath.Join(dir, "b.txt"), []byte("my own work"), 0o644)

	if err := Restore(dir, tree, "a.txt"); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "a.txt")); string(b) != "before" {
		t.Errorf("a.txt is %q", b)
	}
	// This is the difference from `git checkout .`, and the reason it exists.
	if b, _ := os.ReadFile(filepath.Join(dir, "b.txt")); string(b) != "my own work" {
		t.Errorf("own work lost: %q", b)
	}
}

// A file without a closing newline must come back byte for byte.
func TestContentSurvivesExactly(t *testing.T) {
	dir := repo(t)
	raw := []byte("no newline at the end")
	os.WriteFile(filepath.Join(dir, "x"), raw, 0o644)
	tree, _ := Take(dir)
	os.WriteFile(filepath.Join(dir, "x"), []byte("something else"), 0o644)
	if err := Restore(dir, tree, "x"); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "x")); string(b) != string(raw) {
		t.Errorf("came back as %q instead of %q", b, raw)
	}
}

func TestChangedListsWhatMoved(t *testing.T) {
	dir := repo(t)
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("one"), 0o644)
	tree, _ := Take(dir)
	os.WriteFile(filepath.Join(dir, "a.txt"), []byte("two"), 0o644)
	cs := Changed(dir, tree)
	if len(cs) != 1 || cs[0].Path != "a.txt" {
		t.Fatalf("%+v", cs)
	}
}

func TestOutsideARepoIsNoError(t *testing.T) {
	tree, err := Take(t.TempDir())
	if err != nil || tree != "" {
		t.Errorf("outside a repo: %q %v", tree, err)
	}
}
