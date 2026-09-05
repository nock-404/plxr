package files

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// git answers with paths relative to the top of the repository. The window
// strips the folder it opened off each entry and looks that up, so the two have
// to be the same kind of path — which they are not, the moment somebody opens
// a subdirectory.
func TestStatusIsRelativeToTheFolderAsked(t *testing.T) {
	top := t.TempDir()
	git := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", top}, args...)...)
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t",
			"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v: %s", args, err, out)
		}
	}
	git("init", "-q", ".")
	sub := filepath.Join(top, "inner")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, text := range map[string]string{
		filepath.Join(top, "outside.txt"): "a\n",
		filepath.Join(sub, "inside.txt"):  "b\n",
	} {
		if err := os.WriteFile(name, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	git("add", "-A")
	git("commit", "-qm", "start")
	if err := os.WriteFile(filepath.Join(sub, "inside.txt"), []byte("changed\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Asked at the top, the path is the one git gives.
	if got := Status(top)["inner/inside.txt"]; got == "" {
		t.Fatalf("at the top: nothing known about inner/inside.txt, got %v", Status(top))
	}

	// Asked inside, it must be relative to there — not "inner/inside.txt".
	inside := Status(sub)
	if got := inside["inside.txt"]; got == "" {
		t.Fatalf("in the subdirectory: nothing known about inside.txt, got %v", inside)
	}
	if _, wrong := inside["inner/inside.txt"]; wrong {
		t.Fatalf("still answering with the path from the top: %v", inside)
	}
}
