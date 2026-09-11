package marks

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func gitm(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t",
		"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v %s", args, err, out)
	}
}

func writef(t *testing.T, dir, name, body string) {
	t.Helper()
	full := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

/* A rename since the mark must not make RESTORE fail on everything.
 *
 * Changed() ran `git diff --name-status`, which detects renames as one line
 * `R100\told\tnew` — two tabs. The parser took the whole `old\tnew` as the
 * path, git show could not find it, and RestoreAll returned that error and put
 * nothing back at all.
 */
func TestARenameSinceTheMarkDoesNotBreakRestore(t *testing.T) {
	dir := repo(t)
	writef(t, dir, "keep.txt", "important\n")
	writef(t, dir, "old.txt", "one\ntwo\n")
	gitm(t, dir, "add", "-A")
	gitm(t, dir, "commit", "-qm", "seed")

	tree, err := Take(dir)
	if err != nil || tree == "" {
		t.Fatalf("take: %v", err)
	}

	// Since the mark: a rename, and an unrelated edit.
	gitm(t, dir, "mv", "old.txt", "new.txt")
	writef(t, dir, "keep.txt", "changed\n")

	n, err := RestoreAll(dir, tree)
	if err != nil {
		t.Fatalf("restore failed outright on a rename: %v", err)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "keep.txt")); string(b) != "important\n" {
		t.Fatalf("the unrelated file was not restored (n=%d): %q", n, b)
	}
	// The old name is back the way it was at the mark.
	if b, err := os.ReadFile(filepath.Join(dir, "old.txt")); err != nil || string(b) != "one\ntwo\n" {
		t.Fatalf("the renamed-away file was not put back: %v %q", err, b)
	}
}

/* Restoring a file whose directory was removed since the mark must recreate the
 * directory, and one such file must not abort the rest of the restore.
 */
func TestRestoreRecreatesAMissingDirectory(t *testing.T) {
	dir := repo(t)
	writef(t, dir, "sub/deep.txt", "one\n")
	writef(t, dir, "top.txt", "a\n")
	gitm(t, dir, "add", "-A")
	gitm(t, dir, "commit", "-qm", "seed")

	tree, err := Take(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(filepath.Join(dir, "sub")); err != nil {
		t.Fatal(err)
	}
	writef(t, dir, "top.txt", "changed\n")

	if _, err := RestoreAll(dir, tree); err != nil {
		t.Fatalf("restore aborted because a directory was gone: %v", err)
	}
	if b, err := os.ReadFile(filepath.Join(dir, "sub", "deep.txt")); err != nil || string(b) != "one\n" {
		t.Fatalf("the file in the removed directory was not put back: %v %q", err, b)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "top.txt")); string(b) != "a\n" {
		t.Fatalf("the other file was not restored: %q", b)
	}
}

/* Restore must not write through a symlink to a file outside the repository.
 */
func TestRestoreDoesNotWriteThroughALink(t *testing.T) {
	dir := repo(t)
	outside := filepath.Join(t.TempDir(), "victim.txt")
	if err := os.WriteFile(outside, []byte("do not touch\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	writef(t, dir, "a.txt", "one\n")
	gitm(t, dir, "add", "-A")
	gitm(t, dir, "commit", "-qm", "seed")
	tree, err := Take(dir)
	if err != nil {
		t.Fatal(err)
	}

	// After the mark, a.txt becomes a link pointing outside.
	os.Remove(filepath.Join(dir, "a.txt"))
	if err := os.Symlink(outside, filepath.Join(dir, "a.txt")); err != nil {
		t.Skipf("no symlinks here: %v", err)
	}

	_ = Restore(dir, tree, "a.txt")
	if b, _ := os.ReadFile(outside); string(b) != "do not touch\n" {
		t.Fatalf("restore wrote through the link and changed a file outside the repo: %q", b)
	}
}
