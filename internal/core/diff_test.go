package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"plxr/internal/session"
)

func gitrun(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t",
		"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("no git: %v %s", err, out)
	}
}

func coreOn(t *testing.T, cwd string) *Core {
	t.Helper()
	home := t.TempDir()
	t.Setenv("PLXR_HOME", home)
	reg, err := session.NewRegistry(filepath.Join(home, "sessions"))
	if err != nil {
		t.Fatal(err)
	}
	reg.Put(&session.Session{ID: "s", Alive: true, Cwd: cwd, Cmd: []string{"sh"}})
	return New(reg, os.DirFS("../../assets/themes"), os.DirFS("../../assets/agents"), os.DirFS("../../assets/skins"))
}

// The diff of a deleted file opens instead of erroring on the missing path.
func TestTheDiffOfADeletedFileOpens(t *testing.T) {
	dir := t.TempDir()
	gitrun(t, dir, "init", "-q", ".")
	if err := os.WriteFile(filepath.Join(dir, "gone.txt"), []byte("one\ntwo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitrun(t, dir, "add", "-A")
	gitrun(t, dir, "commit", "-qm", "seed")
	if err := os.Remove(filepath.Join(dir, "gone.txt")); err != nil {
		t.Fatal(err)
	}

	c := coreOn(t, dir)
	d, err := c.Difference("s", "gone.txt", false)
	if err != nil {
		t.Fatalf("the diff of a deleted file was refused: %v", err)
	}
	if d.Empty {
		t.Fatal("the deletion shows no difference at all")
	}
}
