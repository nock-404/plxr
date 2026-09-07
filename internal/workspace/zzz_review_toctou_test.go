package workspace

import (
	"os"
	"path/filepath"
	"plxr/internal/files"
	"testing"
)

// Review scratch test: does the root RootOf checked stay checked once the file
// layer resolves it again?
func TestReviewRootSwappedBetweenRootOfAndFiles(t *testing.T) {
	home := t.TempDir()
	base := t.TempDir()
	target := filepath.Join(base, "target")
	other := filepath.Join(base, "other")
	for _, d := range []string{target, other} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(target, "in-the-workspace.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(other, "not-in-the-workspace.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(base, "link")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("no symlinks here: %v", err)
	}

	w, err := Open(home, link)
	if err != nil {
		t.Fatal(err)
	}
	root, err := RootOf(home, w.ID)
	if err != nil {
		t.Fatalf("RootOf: %v", err)
	}
	t.Logf("w.Path=%q w.Real=%q RootOf=%q", w.Path, w.Real, root)

	// The swap happens here: after RootOf returned, before files resolves.
	if err := os.Rename(target, target+"-moved"); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(other, target); err != nil {
		t.Fatal(err)
	}

	list, err := files.List(root, "")
	t.Logf("files.List(root=%q, \"\") err=%v", root, err)
	for _, e := range list {
		t.Logf("  entry %q", e.Path)
	}

	// And what the very next request would say.
	root2, err2 := RootOf(home, w.ID)
	t.Logf("next RootOf: root=%q err=%v", root2, err2)

	// Read a concrete file through the same root.
	c, rerr := files.Read(root, "not-in-the-workspace.txt")
	if rerr == nil {
		t.Logf("files.Read handed out %q", c.Path)
	} else {
		t.Logf("files.Read err=%v", rerr)
	}
}
