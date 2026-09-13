package notify

import (
	"testing"
	"time"
)

/* Who shows it, and whether it is shown.

   The failures this guards against are invisible either way: a message that
   went to nobody, one that was shown once per open window, one that wore
   another application's name because the service showed it, and one about the
   very session somebody was already looking at. */

type bench struct {
	hub   *Hub
	local []Message
	dnd   bool
	clock time.Time
}

// newBench is a hub the way macOS has it: the service shows nothing itself.
func newBench() *bench {
	b := &bench{clock: time.Unix(1_700_000_000, 0)}
	b.hub = NewHub(nil, func() bool { return b.dnd }, func() time.Time { return b.clock })
	return b
}

// newLocalBench is a hub the way Linux and Windows have it: the service's own
// route shows what no window takes.
func newLocalBench() *bench {
	b := &bench{clock: time.Unix(1_700_000_000, 0)}
	b.hub = NewHub(func(m Message) { b.local = append(b.local, m) }, func() bool { return b.dnd }, func() time.Time { return b.clock })
	return b
}

func (b *bench) window(permission string) *Subscriber {
	w := b.hub.Subscribe()
	w.Report(permission, "de.nyo.plxr.test")
	return w
}

func msg(id string) Message {
	return Message{Title: "session " + id, Body: "is waiting for your answer", Sound: "Ping", SessionID: id, Kind: "needsYou"}
}

func frames(ws ...*Subscriber) (total int) {
	for _, w := range ws {
		total += len(w.Frames())
	}
	return total
}

func TestSeveralWindowsOneNotification(t *testing.T) {
	b := newBench()
	one, two, three := b.window(PermissionGranted), b.window(PermissionGranted), b.window(PermissionGranted)
	defer one.Close()
	defer two.Close()
	defer three.Close()

	for i, id := range []string{"a", "b", "c"} {
		if out := b.hub.Post(msg(id)); out != ViaWindow {
			t.Fatalf("message %d: outcome %q, want %q", i, out, ViaWindow)
		}
	}
	if got := frames(one, two, three); got != 3 {
		t.Fatalf("three events reached the windows %d times, want exactly 3", got)
	}
	if len(three.Frames()) != 3 {
		t.Errorf("the newest window got %d, the others %d and %d", len(three.Frames()), len(one.Frames()), len(two.Frames()))
	}
	if len(b.local) != 0 {
		t.Errorf("the service showed some itself: %+v", b.local)
	}
}

func TestTheWindowThatHoldsThePermissionIsElectedOverANewerOne(t *testing.T) {
	b := newBench()
	able := b.window(PermissionGranted)
	defer able.Close()
	refused := b.window(PermissionDenied)
	defer refused.Close()
	asking := b.window(PermissionAsking)
	defer asking.Close()

	if out := b.hub.Post(msg("a")); out != ViaWindow {
		t.Fatalf("outcome %q, want %q", out, ViaWindow)
	}
	if len(able.Frames()) != 1 || frames(refused, asking) != 0 {
		t.Errorf("granted got %d, denied %d, asking %d", len(able.Frames()), len(refused.Frames()), len(asking.Frames()))
	}
}

// Measured: a refusal left by a question nobody answered still lets a posted
// notification through. A window in that state is handed the message — once —
// and the system decides.
func TestARefusedWindowIsStillHandedItWhenNoneHoldsThePermission(t *testing.T) {
	b := newBench()
	older := b.window(PermissionDenied)
	defer older.Close()
	newer := b.window(PermissionDenied)
	defer newer.Close()

	if out := b.hub.Post(msg("a")); out != ViaWindow {
		t.Fatalf("outcome %q, want %q", out, ViaWindow)
	}
	if len(newer.Frames()) != 1 || len(older.Frames()) != 0 {
		t.Errorf("newer got %d, older %d", len(newer.Frames()), len(older.Frames()))
	}
}

func TestAWindowThatHasNotAskedIsNotHandedAnything(t *testing.T) {
	for _, p := range []string{PermissionNotAsked, PermissionUnknown} {
		b := newBench()
		w := b.window(p)
		if out := b.hub.Post(msg("a")); out != NotAllowed {
			t.Errorf("permission %s: outcome %q, want %q", p, out, NotAllowed)
		}
		if len(w.Frames()) != 0 {
			t.Errorf("permission %s: the window was given it", p)
		}
		w.Close()
	}
}

// The fault that was shipped: with no capable window, the service posted
// itself — as Script Editor. On macOS it now shows nothing and says so.
func TestWithNoWindowTheServiceShowsNothingOnMac(t *testing.T) {
	b := newBench()
	if out := b.hub.Post(msg("a")); out != NoWindow {
		t.Fatalf("outcome %q, want %q", out, NoWindow)
	}
	w := b.window(PermissionGranted)
	w.Close()
	if out := b.hub.Post(msg("b")); out != NoWindow {
		t.Fatalf("after the window went: outcome %q, want %q", out, NoWindow)
	}
	if b.hub.Windows() != 0 {
		t.Errorf("%d windows still counted", b.hub.Windows())
	}
}

func TestWithNoWindowTheServiceShowsItWhereItHasARoute(t *testing.T) {
	b := newLocalBench()
	if !b.hub.ServiceShows() || newBench().hub.ServiceShows() {
		t.Fatal("ServiceShows does not say which kind of hub this is")
	}
	if out := b.hub.Post(msg("a")); out != ViaLocal {
		t.Fatalf("outcome %q, want %q", out, ViaLocal)
	}
	if len(b.local) != 1 || b.local[0] != msg("a") {
		t.Errorf("the service showed %+v", b.local)
	}
}

func TestAWindowThatStoppedReadingIsPassedOver(t *testing.T) {
	b := newBench()
	stuck := b.window(PermissionGranted)
	defer stuck.Close()
	for i := 0; i < cap(stuck.frames); i++ {
		stuck.frames <- msg("fill")
	}
	if out := b.hub.route(msg("a")); out != NoWindow {
		t.Errorf("only a full window: outcome %q, want %q", out, NoWindow)
	}
	reading := b.hub.Subscribe()
	defer reading.Close()
	reading.Report(PermissionDenied, "")
	if out := b.hub.route(msg("b")); out != ViaWindow || len(reading.Frames()) != 1 {
		t.Errorf("a reading window beside it: outcome %q, frames %d", out, len(reading.Frames()))
	}
}

func TestASessionInFrontOfAFocusedPageIsNotSaid(t *testing.T) {
	b := newBench()
	w := b.window(PermissionGranted)
	defer w.Close()

	b.hub.SetFront("page-1", "a", true)
	if out := b.hub.Post(msg("a")); out != InFront {
		t.Fatalf("the session in front: outcome %q, want %q", out, InFront)
	}
	if out := b.hub.Post(msg("b")); out != ViaWindow {
		t.Errorf("another session: outcome %q, want %q", out, ViaWindow)
	}
	if len(w.Frames()) != 1 {
		t.Errorf("the window got %d, want only the other session's", len(w.Frames()))
	}
}

func TestInFrontNeedsFocus(t *testing.T) {
	b := newBench()
	w := b.window(PermissionGranted)
	defer w.Close()

	b.hub.SetFront("page-1", "a", true)
	// The window loses focus: somebody is looking at another application.
	b.hub.SetFront("page-1", "a", false)
	if out := b.hub.Post(msg("a")); out != ViaWindow {
		t.Errorf("in front but unfocused: outcome %q, want %q", out, ViaWindow)
	}
	// Focused again, but the active panel is not a session.
	b.hub.SetFront("page-1", "", true)
	b.clock = b.clock.Add(floodWindow)
	if out := b.hub.Post(msg("a")); out != ViaWindow {
		t.Errorf("focused on something else: outcome %q, want %q", out, ViaWindow)
	}
}

func TestAPageThatWentQuietStopsSilencing(t *testing.T) {
	b := newBench()
	w := b.window(PermissionGranted)
	defer w.Close()

	b.hub.SetFront("page-1", "a", true)
	b.clock = b.clock.Add(frontFresh + time.Second)
	if out := b.hub.Post(msg("a")); out != ViaWindow {
		t.Errorf("after the page stopped saying it: outcome %q, want %q", out, ViaWindow)
	}
}

func TestTwoPagesEitherOneInFrontIsEnough(t *testing.T) {
	b := newBench()
	w := b.window(PermissionGranted)
	defer w.Close()

	b.hub.SetFront("kitchen", "a", false)
	b.hub.SetFront("desk", "a", true)
	if out := b.hub.Post(msg("a")); out != InFront {
		t.Errorf("outcome %q, want %q", out, InFront)
	}
}

func TestWhatIsInFrontDoesNotUseUpTheCeiling(t *testing.T) {
	b := newBench()
	w := b.window(PermissionGranted)
	defer w.Close()

	b.hub.SetFront("page-1", "front", true)
	for i := 0; i < 10; i++ {
		b.hub.Post(msg("front"))
	}
	for _, id := range []string{"a", "b", "c"} {
		if out := b.hub.Post(msg(id)); out != ViaWindow {
			t.Fatalf("session %s after ten held back: outcome %q, want %q", id, out, ViaWindow)
		}
	}
}

func TestTheTestButtonGoesThroughEverythingButTheRoute(t *testing.T) {
	b := newBench()
	b.dnd = true
	w := b.window(PermissionGranted)
	defer w.Close()

	if out := b.hub.Post(msg("a")); out != Quiet {
		t.Fatalf("do not disturb: outcome %q, want %q", out, Quiet)
	}
	if out := b.hub.Try("Ping"); out != ViaWindow {
		t.Errorf("the test notification: outcome %q, want %q", out, ViaWindow)
	}
	if len(w.Frames()) != 1 {
		t.Errorf("the window got %d, want the test one only", len(w.Frames()))
	}
	w.Close()
	if out := b.hub.Try("Ping"); out != NoWindow {
		t.Errorf("the test notification with no window: outcome %q, want %q", out, NoWindow)
	}
}

func TestAFloodBecomesOneLine(t *testing.T) {
	b := newLocalBench()
	for _, id := range []string{"a", "b", "c"} {
		if out := b.hub.Post(msg(id)); out != ViaLocal {
			t.Fatalf("session %s: outcome %q, want %q", id, out, ViaLocal)
		}
		b.clock = b.clock.Add(time.Second)
	}
	if out := b.hub.Post(msg("d")); out != Summary {
		t.Fatalf("the fourth: outcome %q, want %q", out, Summary)
	}
	if len(b.local) != 4 {
		t.Fatalf("%d shown, want three and a summary", len(b.local))
	}
	if last := b.local[3]; last.Kind != "summary" || last.Body != "4 sessions need you" {
		t.Errorf("the summary reads %+v", last)
	}
	b.clock = b.clock.Add(time.Second)
	if out := b.hub.Post(msg("e")); out != Folded {
		t.Errorf("the fifth: outcome %q, want %q", out, Folded)
	}
	b.clock = b.clock.Add(floodWindow)
	if out := b.hub.Post(msg("f")); out != ViaLocal {
		t.Errorf("after the quiet: outcome %q, want %q", out, ViaLocal)
	}
}

func TestOneSessionAskingOverAndOverIsSaidAsSuch(t *testing.T) {
	b := newLocalBench()
	for i := 0; i < 4; i++ {
		b.hub.Post(msg("same"))
	}
	if got := b.local[3].Body; got != "a session keeps needing you" {
		t.Errorf("the summary reads %q", got)
	}
}

// A summary nobody can be shown is reported as what it is, not as a summary
// that went out.
func TestASummaryWithNoWindowSaysNoWindow(t *testing.T) {
	b := newBench()
	for _, id := range []string{"a", "b", "c"} {
		b.hub.Post(msg(id))
	}
	if out := b.hub.Post(msg("d")); out != NoWindow {
		t.Errorf("outcome %q, want %q", out, NoWindow)
	}
}

func TestThePermissionAndTheBundleAreWhatTheNewestWindowSaid(t *testing.T) {
	b := newBench()
	if got := b.hub.Permission(); got != PermissionUnknown {
		t.Fatalf("before any window: %q", got)
	}
	old := b.hub.Subscribe()
	old.Report(PermissionGranted, "dev.plxr.app")
	fresh := b.hub.Subscribe()
	fresh.Report(PermissionDenied, "de.nyo.plxr.other")
	if got := b.hub.Permission(); got != PermissionDenied {
		t.Errorf("permission %q, want the newest window's", got)
	}
	if got := b.hub.Bundle(); got != "de.nyo.plxr.other" {
		t.Errorf("bundle %q, want the newest window's", got)
	}
	fresh.Close()
	old.Close()
	// The last word said stands with the windows gone, so the settings can
	// still say "denied" and still open the right pane.
	if got, bundle := b.hub.Permission(), b.hub.Bundle(); got != PermissionDenied || bundle != "de.nyo.plxr.other" {
		t.Errorf("after the windows went: %q %q", got, bundle)
	}
}

func TestOnlyTheNewestWindowIsAskedToAuthorize(t *testing.T) {
	b := newBench()
	if b.hub.Authorize() {
		t.Fatal("with no window there is nobody to ask")
	}
	old := b.window(PermissionNotAsked)
	defer old.Close()
	fresh := b.window(PermissionNotAsked)
	defer fresh.Close()
	if !b.hub.Authorize() {
		t.Fatal("the window was not asked")
	}
	if len(old.Frames()) != 0 {
		t.Errorf("the older window was asked too — two questions on screen")
	}
	select {
	case got := <-fresh.Frames():
		if !got.Authorize || got.Body != "" {
			t.Errorf("the window got %+v, want a bare authorize frame", got)
		}
	default:
		t.Fatal("nothing reached the newest window")
	}
}

func TestRefreshAsksEveryWindow(t *testing.T) {
	b := newBench()
	one, two := b.window(PermissionDenied), b.window(PermissionNotAsked)
	defer one.Close()
	defer two.Close()
	b.hub.Refresh()
	for i, w := range []*Subscriber{one, two} {
		select {
		case got := <-w.Frames():
			if !got.Refresh || got.Authorize || got.Body != "" {
				t.Errorf("window %d got %+v, want a bare refresh frame", i, got)
			}
		default:
			t.Errorf("window %d was not asked", i)
		}
	}
}

func TestAPageWithoutAnIdSilencesNothing(t *testing.T) {
	b := newBench()
	w := b.window(PermissionGranted)
	defer w.Close()
	b.hub.SetFront("", "a", true)
	if out := b.hub.Post(msg("a")); out != ViaWindow {
		t.Errorf("outcome %q, want %q", out, ViaWindow)
	}
}

func TestPagesAreRememberedUpToALimit(t *testing.T) {
	b := newBench()
	for i := 0; i < frontPages+10; i++ {
		b.hub.SetFront(time.Duration(i).String(), "s", true)
	}
	if len(b.hub.fronts) != frontPages {
		t.Errorf("%d pages remembered, want at most %d", len(b.hub.fronts), frontPages)
	}
}
