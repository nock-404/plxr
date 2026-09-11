package files

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

/* The git mark on a row and the row's own key have to line up through a
 * symlinked path.
 *
 * List gives each entry a Rel relative to the opened folder, and git Status is
 * keyed the same way. On macOS /tmp is a link to /private/tmp, so the folder
 * the window holds and the resolved path git answers with are two spellings —
 * and the old key, sliced off the absolute path, matched neither, so the tree
 * showed no git marks at all.
 */
func TestEntryRelMatchesGitStatusThroughALink(t *testing.T) {
	real := t.TempDir()
	// A link to the repository, the way /tmp stands in for /private/tmp.
	link := filepath.Join(t.TempDir(), "repo")
	if err := os.Symlink(real, link); err != nil {
		t.Skipf("no symlinks here: %v", err)
	}
	run := func(args ...string) {
		cmd := exec.Command("git", append([]string{"-C", real}, args...)...)
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t",
			"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Skipf("no git: %v %s", err, out)
		}
	}
	run("init", "-q", ".")
	if err := os.WriteFile(filepath.Join(real, "changed.txt"), []byte("v1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", "-A")
	run("commit", "-qm", "seed")
	if err := os.WriteFile(filepath.Join(real, "changed.txt"), []byte("v2\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Everything is asked through the LINK, as the window does.
	entries, err := List(link, "")
	if err != nil {
		t.Fatal(err)
	}
	marks := Status(link)

	var row *Entry
	for i := range entries {
		if entries[i].Name == "changed.txt" {
			row = &entries[i]
		}
	}
	if row == nil {
		t.Fatal("the changed file is not listed")
	}
	if _, ok := marks[row.Rel]; !ok {
		t.Fatalf("the row key %q is not among the git marks %v — the tree would show none", row.Rel, keysOf(marks))
	}
}

func keysOf(m map[string]State) []string {
	out := []string{}
	for k := range m {
		out = append(out, k)
	}
	return out
}

// A symlink pointing at a directory is a directory for the tree, openable.
func TestASymlinkToADirIsADir(t *testing.T) {
	root := t.TempDir()
	realDir := filepath.Join(root, "real")
	if err := os.MkdirAll(realDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(realDir, "inside.txt"), []byte("x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(realDir, filepath.Join(root, "link")); err != nil {
		t.Skipf("no symlinks here: %v", err)
	}
	entries, err := List(root, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.Name == "link" {
			if !e.Dir {
				t.Fatal("a symlink to a directory was listed as a file, so it could not be opened")
			}
			return
		}
	}
	t.Fatal("the link is not listed")
}
