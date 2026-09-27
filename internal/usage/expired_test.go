package usage

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

/*
A reading only counts for the window it was taken in.

	The figures are a cache Claude Code writes when it runs, so an account that
	has not run on this machine for a day still has yesterday's on disk. plxr
	showed them as the current state. Measured on his machine (27.09.2026): one
	account's five-hour window had ended thirty-two hours earlier and its week
	thirty-four hours earlier, and the view had them at 87% and 100% used —
	"nearly out" on a week that had come back the day before.

	Past its reset the window has rolled over. What is left of the new one is
	not knowable here, and that is what has to be said.
*/
func writeReading(t *testing.T, dir string, sessionResets, weekResets time.Time) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	body := `{"cachedUsageUtilization":{"fetchedAtMs":1790000000000,"utilization":{` +
		`"five_hour":{"utilization":87,"resets_at":"` + sessionResets.UTC().Format(time.RFC3339) + `"},` +
		`"seven_day":{"utilization":100,"resets_at":"` + weekResets.UTC().Format(time.RFC3339) + `"}}}}`
	if err := os.WriteFile(filepath.Join(dir, ".claude.json"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestAWindowThatHasComeBackIsNotAReading(t *testing.T) {
	dir := filepath.Join(t.TempDir(), ".claude")
	// Both ended yesterday, which is exactly what was on his disk.
	writeReading(t, dir, time.Now().Add(-32*time.Hour), time.Now().Add(-34*time.Hour))

	session, week, _, _, _ := Limits(dir)
	for _, w := range []Window{session, week} {
		if w.Known {
			t.Errorf("%s window still reads as a reading at %d%% although it came back %s ago",
				w.Kind, w.Percent, time.Since(time.UnixMilli(w.ResetsAt)).Round(time.Hour))
		}
		if !w.Over {
			t.Errorf("%s window does not say it has come back, so the view cannot say it either", w.Kind)
		}
		if w.Percent != 0 {
			t.Errorf("%s window kept the old window's %d%%", w.Kind, w.Percent)
		}
	}
	// And nothing that decides anything may read it as a full window.
	if _, hot := (AccountUsage{Session: session, Week: week}).Hot(80); hot {
		t.Error("an account is called nearly out on windows that came back yesterday")
	}
	if session.Left() != 100 {
		t.Errorf("a window nobody can measure left %d%%, which would stop work for no reason", session.Left())
	}
}

// And a window that is still open is untouched: the rule must not throw away
// the readings that are true.
func TestAnOpenWindowIsLeftAlone(t *testing.T) {
	dir := filepath.Join(t.TempDir(), ".claude")
	writeReading(t, dir, time.Now().Add(2*time.Hour), time.Now().Add(72*time.Hour))

	session, week, _, _, _ := Limits(dir)
	if !session.Known || session.Percent != 87 || session.Over {
		t.Errorf("session window: known=%v percent=%d over=%v", session.Known, session.Percent, session.Over)
	}
	if !week.Known || week.Percent != 100 || week.Over {
		t.Errorf("week window: known=%v percent=%d over=%v", week.Known, week.Percent, week.Over)
	}
}

// The spend keeps its own honesty: a window that has come back has no start
// we know, so the figure is over the nominal length and says so.
func TestTheSpendOfAWindowThatCameBackIsNotCountedFromIt(t *testing.T) {
	over := Window{Kind: KindSession, Over: true, ResetsAt: time.Now().Add(-32 * time.Hour).UnixMilli()}
	now := time.Now()
	start, measured := startOf(over, now, sessionLength)
	if measured {
		t.Error("the spend claims to be counted from the window's own start, which ended yesterday")
	}
	if want := now.Add(-sessionLength).UnixMilli(); start != want {
		t.Errorf("counted from %d, wanted the last five hours (%d)", start, want)
	}
}
