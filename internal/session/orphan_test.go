package session

import (
	"path/filepath"
	"testing"
)

/* An orphan stands for work nobody meant to end, and it stays until somebody
 * has seen it.
 *
 * load() kept every entry that was still marked alive — the daemon died and
 * took the session with it — and deleted everything else. An orphan written by
 * the previous run is not alive any more, so the very next start swept it out:
 * the tiles were there once and gone the time after, without a word. Applying
 * an update takes the daemon down on purpose, so the way to lose them was to
 * install a new version.
 */
func TestAnOrphanSurvivesMoreThanOneStart(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "sessions")

	first, err := NewRegistry(dir)
	if err != nil {
		t.Fatal(err)
	}
	first.Put(&Session{ID: "s1", Alive: true, Cwd: "/tmp", Name: "work"})

	// The daemon dies and comes back: the session becomes an orphan.
	second, err := NewRegistry(dir)
	if err != nil {
		t.Fatal(err)
	}
	s, ok := second.Get("s1")
	if !ok || !s.Orphaned {
		t.Fatalf("the session did not survive the first restart as an orphan: %+v", s)
	}

	// And again, without anybody having clicked it away.
	third, err := NewRegistry(dir)
	if err != nil {
		t.Fatal(err)
	}
	again, ok := third.Get("s1")
	if !ok {
		t.Fatal("the orphan was thrown away on the second start — the record of work nobody meant to end is gone")
	}
	if !again.Orphaned {
		t.Fatalf("it is no longer marked as an orphan: %+v", again)
	}
}

// A session that ended properly and was seen does not stay for ever.
func TestAnEndedSessionIsNotKeptForEver(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "sessions")
	first, err := NewRegistry(dir)
	if err != nil {
		t.Fatal(err)
	}
	first.Put(&Session{ID: "s2", Alive: false, EndedAt: 1, Cwd: "/tmp"})

	second, err := NewRegistry(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := second.Get("s2"); ok {
		t.Fatal("an ended session was carried into the next start")
	}
}
