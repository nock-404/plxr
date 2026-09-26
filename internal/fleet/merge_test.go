package fleet

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

/* Two writers, one session, and only one of them can see the account.

   plxr's own hook runs inside the CLI and records the configuration directory
   it was started with — which is to say the account the work is billed to.
   The older standalone tool writes a file for the same session and has never
   heard of it. The two land milliseconds apart in whichever order.

   Taking the more recent one wholesale put the wrong account over a terminal:
   a session signed in as one account was labelled another, because a blind
   entry arrived 67 milliseconds after the one that knew (26.09.2026).
*/

func write(t *testing.T, dir, name string, s State) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, name+".json"), b, 0o600); err != nil {
		t.Fatal(err)
	}
}

// readFrom points the reader at one directory of this test's own.
func readFrom(t *testing.T, home string) []State {
	t.Helper()
	t.Setenv("HOME", home)
	t.Setenv("PLXR_HOME", filepath.Join(home, ".plxr"))
	return Read("")
}

func TestANewerEntryDoesNotEraseTheAccount(t *testing.T) {
	home := t.TempDir()
	ours := filepath.Join(home, ".plxr", "state")
	theirs := filepath.Join(home, ".claude-fleet", "sessions")

	id := "cf7c64f7"
	write(t, ours, id, State{SessionID: id, PID: 5179, TTY: "/dev/ttys002", UpdatedAt: 1000, ConfigDir: "/home/.claude4"})
	// The blind writer, a moment later.
	write(t, theirs, id, State{SessionID: id, PID: 5179, TTY: "/dev/ttys002", UpdatedAt: 1067})

	got := readFrom(t, home)
	if len(got) != 1 {
		t.Fatalf("one session left %d entries — they must be merged, not both kept", len(got))
	}
	if got[0].UpdatedAt != 1067 {
		t.Fatalf("the older writing won: updated %d", got[0].UpdatedAt)
	}
	if got[0].ConfigDir != "/home/.claude4" {
		t.Fatalf("the account was erased by a writer that cannot see it: %q", got[0].ConfigDir)
	}
}

// And the other order, because which file lands last is not ours to decide.
func TestTheOlderEntryDoesNotOverrideTheNewer(t *testing.T) {
	home := t.TempDir()
	ours := filepath.Join(home, ".plxr", "state")
	theirs := filepath.Join(home, ".claude-fleet", "sessions")

	id := "cc7627ee"
	write(t, ours, id, State{SessionID: id, UpdatedAt: 2000, ConfigDir: "/home/.claude4", Status: "working"})
	write(t, theirs, id, State{SessionID: id, UpdatedAt: 1000, Status: "waiting"})

	got := readFrom(t, home)
	if len(got) != 1 {
		t.Fatalf("one session left %d entries", len(got))
	}
	if got[0].Status != "working" || got[0].ConfigDir != "/home/.claude4" {
		t.Fatalf("the older writing won: status %q, account %q", got[0].Status, got[0].ConfigDir)
	}
}
