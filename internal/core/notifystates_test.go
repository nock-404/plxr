package core

import (
	"testing"

	"plxr/internal/notify"
	"plxr/internal/session"
)

/* The words that cross between the session, the notifier and the stylesheets.

   A session's status is a string. The notifier decides what to say by matching
   that string. The stylesheets colour a row by matching it again, in CSS. Three
   places, no compiler between any two of them: rename the status and the
   notifications stop, silently, while everything still builds and every other
   test still passes.

   So the crossing is pinned here, where both Go sides are in view. The CSS side
   is held by attributes.py, which reads the same words out of this package.
*/

func TestTheNotifierKnowsEveryStateASessionCanReach(t *testing.T) {
	everything := notify.Settings{
		On:   true,
		When: notify.When{NeedsYou: true, Waiting: true, Ended: true, Crashed: true},
	}

	// The two that come straight from the session's status.
	fromStatus := []session.Status{session.StatusPermission, session.StatusWaiting}
	for _, status := range fromStatus {
		if !everything.Wanted(string(status)) {
			t.Errorf("a session reports %q and the notifier has nothing to say about it", status)
		}
	}

	// The two checkEdge substitutes when the process is gone.
	for _, state := range []string{"dead", "orphaned"} {
		if !everything.Wanted(state) {
			t.Errorf("checkEdge reports %q and the notifier has nothing to say about it", state)
		}
	}

	// And the ones that must stay quiet: working away is not news.
	for _, quiet := range []session.Status{session.StatusWorking, session.StatusUnknown} {
		if everything.Wanted(string(quiet)) {
			t.Errorf("a session that is merely %q would raise a notification", quiet)
		}
	}
}

// checkEdge builds "dead" and "orphaned" by hand rather than from the status
// type. The first of them has a constant of its own, and the two have to agree.
func TestTheWordForAnEndedSessionIsTheSameInBothPlaces(t *testing.T) {
	if string(session.StatusDead) != "dead" {
		t.Fatalf("the status is %q while checkEdge and the notifier both say \"dead\"", session.StatusDead)
	}
}

func TestBlockingIsTheTwoThatNeedSomebody(t *testing.T) {
	for _, s := range []session.Status{session.StatusPermission, session.StatusWaiting} {
		if !s.Blocking() {
			t.Errorf("%q does not count as needing somebody", s)
		}
	}
	for _, s := range []session.Status{session.StatusWorking, session.StatusDead, session.StatusUnknown} {
		if s.Blocking() {
			t.Errorf("%q counts as needing somebody", s)
		}
	}
}
