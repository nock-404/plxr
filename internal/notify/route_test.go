package notify

import (
	"testing"
	"time"
)

/* Who shows it, and whether it is shown.

   The failure this guards against is invisible either way: a message that went
   to a window nobody has open, or one the service showed while the window was
   right there with the permission. And the other one — eight agents asking at
   once and eight banners on the screen. */

type bench struct {
	hub   *Hub
	local []Message
	dnd   bool
	clock time.Time
}

func newBench() *bench {
	b := &bench{clock: time.Unix(1_700_000_000, 0)}
	b.hub = NewHub(
		func(m Message) { b.local = append(b.local, m) },
		func() bool { return b.dnd },
		func() time.Time { return b.clock },
	)
	return b
}

func msg(id string) Message {
	return Message{Title: "session " + id, Body: "waiting for your answer", Sound: "Ping", SessionID: id, Kind: "needsYou"}
}

func TestWithAWindowOpenTheWindowShowsIt(t *testing.T) {
	b := newBench()
	w := b.hub.Subscribe()
	defer w.Close()

	if out := b.hub.Post(msg("a")); out != ViaWindow {
		t.Fatalf("outcome %q, want %q", out, ViaWindow)
	}
	select {
	case got := <-w.Frames():
		if got != msg("a") {
			t.Errorf("the window got %+v", got)
		}
	default:
		t.Fatal("nothing reached the window")
	}
	if len(b.local) != 0 {
		t.Errorf("the service showed it as well: %+v", b.local)
	}
}

func TestWithNoWindowTheServiceShowsIt(t *testing.T) {
	b := newBench()
	if out := b.hub.Post(msg("a")); out != ViaLocal {
		t.Fatalf("outcome %q, want %q", out, ViaLocal)
	}
	if len(b.local) != 1 || b.local[0] != msg("a") {
		t.Errorf("the service showed %+v", b.local)
	}
}

func TestTheNewestWindowIsTheOneThatShowsIt(t *testing.T) {
	b := newBench()
	old := b.hub.Subscribe()
	defer old.Close()
	fresh := b.hub.Subscribe()
	defer fresh.Close()

	b.hub.Post(msg("a"))
	if len(fresh.Frames()) != 1 || len(old.Frames()) != 0 {
		t.Errorf("newest got %d, oldest got %d", len(fresh.Frames()), len(old.Frames()))
	}
}

func TestWhenTheWindowGoesTheServiceTakesOverAgain(t *testing.T) {
	b := newBench()
	w := b.hub.Subscribe()
	b.hub.Post(msg("a"))
	w.Close()

	if out := b.hub.Post(msg("b")); out != ViaLocal {
		t.Fatalf("after the window went: outcome %q, want %q", out, ViaLocal)
	}
	if len(b.local) != 1 || b.local[0].SessionID != "b" {
		t.Errorf("the service showed %+v", b.local)
	}
	if b.hub.Windows() != 0 {
		t.Errorf("%d windows still counted", b.hub.Windows())
	}
}

func TestAWindowThatStoppedReadingIsPassedOver(t *testing.T) {
	b := newBench()
	w := b.hub.Subscribe()
	defer w.Close()
	for i := 0; i < cap(w.frames); i++ {
		w.frames <- msg("fill")
	}
	if out := b.hub.route(msg("a")); out != ViaLocal {
		t.Errorf("a full window: outcome %q, want %q", out, ViaLocal)
	}
}

func TestDoNotDisturbShowsNothingAnywhere(t *testing.T) {
	b := newBench()
	b.dnd = true
	w := b.hub.Subscribe()
	defer w.Close()

	if out := b.hub.Post(msg("a")); out != Quiet {
		t.Fatalf("outcome %q, want %q", out, Quiet)
	}
	if len(w.Frames()) != 0 || len(b.local) != 0 {
		t.Errorf("shown anyway: window %d, service %d", len(w.Frames()), len(b.local))
	}
	// The test button is a deliberate act and goes through.
	if out := b.hub.Try("Ping"); out != ViaWindow {
		t.Errorf("the test notification: outcome %q, want %q", out, ViaWindow)
	}
}

func TestAFloodBecomesOneLine(t *testing.T) {
	b := newBench()
	for _, id := range []string{"a", "b", "c"} {
		if out := b.hub.Post(msg(id)); out != ViaLocal {
			t.Fatalf("session %s: outcome %q, want %q", id, out, ViaLocal)
		}
		b.clock = b.clock.Add(time.Second)
	}
	// The fourth inside ten seconds is over the line: one summary instead.
	if out := b.hub.Post(msg("d")); out != Summary {
		t.Fatalf("the fourth: outcome %q, want %q", out, Summary)
	}
	if len(b.local) != 4 {
		t.Fatalf("%d shown, want three and a summary", len(b.local))
	}
	last := b.local[3]
	if last.Kind != "summary" || last.Body != "4 sessions need you" {
		t.Errorf("the summary reads %+v", last)
	}
	// Everything else inside that window folds into it.
	b.clock = b.clock.Add(time.Second)
	if out := b.hub.Post(msg("e")); out != Folded {
		t.Errorf("the fifth: outcome %q, want %q", out, Folded)
	}
	if len(b.local) != 4 {
		t.Errorf("the fifth was shown: %+v", b.local[4:])
	}
	// After a quiet stretch the line is clear and each one is said again.
	b.clock = b.clock.Add(floodWindow)
	if out := b.hub.Post(msg("f")); out != ViaLocal {
		t.Errorf("after the quiet: outcome %q, want %q", out, ViaLocal)
	}
}

func TestOneSessionAskingOverAndOverIsSaidAsSuch(t *testing.T) {
	b := newBench()
	for i := 0; i < 4; i++ {
		b.hub.Post(msg("same"))
	}
	if got := b.local[3].Body; got != "a session keeps needing you" {
		t.Errorf("the summary reads %q", got)
	}
}

func TestThePermissionIsWhatTheWindowSaid(t *testing.T) {
	b := newBench()
	if got := b.hub.Permission(); got != PermissionUnknown {
		t.Fatalf("before any window: %q", got)
	}
	w := b.hub.Subscribe()
	w.SetPermission(PermissionDenied)
	if got := b.hub.Permission(); got != PermissionDenied {
		t.Errorf("with the window: %q", got)
	}
	w.Close()
	if got := b.hub.Permission(); got != PermissionDenied {
		t.Errorf("after the window went, the last word should stand: %q", got)
	}
}
