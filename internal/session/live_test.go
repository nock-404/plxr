package session

import (
	"testing"
)

// The order the rail is drawn in, which never worked.
//
// List sorts "whoever is waiting comes first" by Status, and Status in the
// stored session is only ever set to dead: the live one is worked out on each
// snapshot, on the copy List itself hands out. So a session waiting for an
// answer sorted behind one that was merely running, every time.
func TestWaitingComesFirst(t *testing.T) {
	r, err := NewRegistry(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	// The busy one is newer, so without the status it would sort first.
	waiting := &Session{ID: "a", Cwd: "/w", Alive: true, StartedAt: 1000}
	working := &Session{ID: "b", Cwd: "/w", Alive: true, StartedAt: 2000}
	r.Put(waiting)
	r.Put(working)

	if got := r.List()[0].ID; got != "b" {
		t.Fatalf("without a live status the newest should lead, got %q", got)
	}

	r.SetLive("a", StatusWaiting)
	r.SetLive("b", StatusWorking)
	if got := r.List()[0].ID; got != "a" {
		t.Fatalf("the session waiting for somebody should lead, got %q", got)
	}
	if got := r.LiveStatus("a"); got != StatusWaiting {
		t.Fatalf("LiveStatus: %q", got)
	}
	// Nothing of this reaches the file: it is worthless after a restart.
	again, err := NewRegistry(r.dir)
	if err != nil {
		t.Fatal(err)
	}
	if again.LiveStatus("a") == StatusWaiting {
		t.Fatalf("a live status survived a restart, which it must not")
	}
}

func TestBusyOnlyCountsWhatIsActuallyBusy(t *testing.T) {
	r, err := NewRegistry(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	r.Put(&Session{ID: "work", Cwd: "/here", Alive: true})
	r.Put(&Session{ID: "idle", Cwd: "/here", Alive: true})
	r.Put(&Session{ID: "dead", Cwd: "/here", Alive: false})
	r.Put(&Session{ID: "other", Cwd: "/elsewhere", Alive: true})
	r.SetLive("work", StatusWorking)
	r.SetLive("idle", StatusUnknown)
	r.SetLive("dead", StatusWorking) // alive is what counts, not the label
	r.SetLive("other", StatusWorking)

	busy := r.Busy("/here")
	if len(busy) != 1 || busy[0].ID != "work" {
		t.Fatalf("expected only the working one here, got %+v", busy)
	}
	if len(r.Busy("/nothing")) != 0 {
		t.Fatalf("a directory with nothing in it came back busy")
	}
}
