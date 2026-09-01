package ports

import "testing"

/* The list, once it has been read.
 *
 * The reading itself differs by system and needs that system to run on. What
 * does not differ is what comes out: sorted by port, never nil, and the ones
 * belonging to plxr marked as such. Those are the parts the interface builds on.
 */

func TestTheListIsSortedByPort(t *testing.T) {
	got := List(nil)
	for i := 1; i < len(got); i++ {
		if got[i-1].Port > got[i].Port {
			t.Fatalf("port %d comes before %d", got[i-1].Port, got[i].Port)
		}
	}
}

// Nothing listening is a normal state on a quiet machine, and the interface
// draws an empty list rather than checking for null first.
func TestNothingListeningIsAnEmptyListNotNothing(t *testing.T) {
	got := List(nil)
	if got == nil {
		t.Fatal("the list came back as nothing at all rather than as empty")
	}
}

// A port held by one of our own sessions is marked, so the interface can offer
// to end it differently from somebody else's.
func TestOurOwnProcessesAreMarked(t *testing.T) {
	all := List(nil)
	if len(all) == 0 {
		t.Skip("nothing is listening on this machine")
	}
	mine := map[int]bool{all[0].PID: true}
	marked := List(mine)
	for _, e := range marked {
		if e.PID == all[0].PID && !e.Own {
			t.Fatalf("pid %d was named as ours and came back unmarked", e.PID)
		}
		if e.PID != all[0].PID && e.Own {
			t.Fatalf("pid %d was not named as ours and came back marked", e.PID)
		}
	}
}
