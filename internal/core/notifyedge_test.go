package core

import (
	"testing"
	"time"

	"plxr/internal/notify"
	"plxr/internal/session"
)

/* One notification per change of state, whoever asks how often.

   The snapshot is taken once a second by every open window, and checkEdge runs
   inside it. Two windows, two snapshots a second, and a session that stays
   stuck for a minute: that is a hundred and twenty looks at the same state,
   and it must come out as one notification, not a hundred and twenty. The
   edge is kept in lastStatus; this pins that nothing else re-fires. */

func TestASessionIsSaidOncePerChangeOfState(t *testing.T) {
	t.Setenv("PLXR_HOME", t.TempDir()) // the default settings: needsYou on, nothing else

	var shown []notify.Message
	was := notify.Service
	notify.Service = notify.NewHub(func(m notify.Message) { shown = append(shown, m) }, func() bool { return false }, time.Now)
	defer func() { notify.Service = was }()

	c := New(nil, nil, nil, nil)
	stuck := session.Session{ID: "abc12345", Name: "one", Alive: true, Status: session.StatusPermission,
		StartedAt: time.Now().Add(-time.Minute).UnixMilli()}

	for i := 0; i < 120; i++ {
		c.checkEdge(stuck)
	}
	if len(shown) != 1 {
		t.Fatalf("%d notifications for one stuck session, want 1", len(shown))
	}
	if shown[0].SessionID != "abc12345" || shown[0].Kind != "needsYou" {
		t.Errorf("the notification names %+v", shown[0])
	}

	// Working again, then stuck again: that is a new edge and is said again.
	working := stuck
	working.Status = session.StatusWorking
	c.checkEdge(working)
	c.checkEdge(stuck)
	if len(shown) != 2 {
		t.Errorf("%d notifications after a second edge, want 2", len(shown))
	}
}
