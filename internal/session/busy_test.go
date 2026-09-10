package session

import (
	"os"
	"path/filepath"
	"testing"
)

/* The guard in front of a branch switch has to see the agent that is working.
 *
 * It compared two strings: the session's cwd exactly as it was typed, and a
 * folder path that had been resolved through its symlinks on the way in. On
 * macOS /tmp is a link to /private/tmp, so the two spellings of the same
 * directory never matched and the guard saw nothing.
 *
 * And it asked for equality, while `git switch` rewrites the whole worktree —
 * so an agent running in a subfolder of the repository, which is the ordinary
 * layout, was invisible to it as well.
 */
func TestTheBusyGuardSeesTheAgentThroughALink(t *testing.T) {
	real := t.TempDir()
	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(real, link); err != nil {
		t.Skipf("no symlinks here: %v", err)
	}

	reg, err := NewRegistry(filepath.Join(t.TempDir(), "sessions"))
	if err != nil {
		t.Fatal(err)
	}
	reg.Put(&Session{ID: "a", Alive: true, Cwd: link, Name: "agent", Status: StatusWorking})

	if busy := reg.Busy(real); len(busy) != 1 {
		t.Fatalf("the working session was not found through the link: %d found", len(busy))
	}
}

func TestTheBusyGuardSeesTheAgentInASubfolder(t *testing.T) {
	root := t.TempDir()
	inner := filepath.Join(root, "frontend")
	if err := os.MkdirAll(inner, 0o755); err != nil {
		t.Fatal(err)
	}
	reg, err := NewRegistry(filepath.Join(t.TempDir(), "sessions"))
	if err != nil {
		t.Fatal(err)
	}
	reg.Put(&Session{ID: "a", Alive: true, Cwd: inner, Name: "agent", Status: StatusWorking})

	if busy := reg.Busy(root); len(busy) != 1 {
		t.Fatalf("an agent working below the repository was not found: %d found", len(busy))
	}
}

// A session next door is not in this repository and must not be reported.
func TestTheBusyGuardDoesNotReachSideways(t *testing.T) {
	base := t.TempDir()
	here := filepath.Join(base, "project")
	other := filepath.Join(base, "project-secret")
	for _, d := range []string{here, other} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	reg, err := NewRegistry(filepath.Join(t.TempDir(), "sessions"))
	if err != nil {
		t.Fatal(err)
	}
	reg.Put(&Session{ID: "a", Alive: true, Cwd: other, Name: "agent", Status: StatusWorking})

	if busy := reg.Busy(here); len(busy) != 0 {
		t.Fatalf("a session in a folder that only starts the same way was counted: %d", len(busy))
	}
}
