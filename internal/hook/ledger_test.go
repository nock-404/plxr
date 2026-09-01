package hook

import (
	"fmt"
	"os"
	"testing"
	"time"
)

func write(t *testing.T, lines string) {
	t.Helper()
	t.Setenv("PLXR_HOME", t.TempDir())
	if err := os.WriteFile(LedgerFile(), []byte(lines), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestSpansCloseOnTheNextLine(t *testing.T) {
	write(t, "1000 a working\n4000 a waiting\n")
	spans := ReadLedger(9000)
	if len(spans) != 2 {
		t.Fatalf("%d stretches", len(spans))
	}
	if spans[0].Status != "working" || spans[0].From != 1000 || spans[0].To != 4000 {
		t.Errorf("first stretch %+v", spans[0])
	}
	// The last one has no closing line — it ends at now. That is the whole
	// reason closing happens on reading: a session that is still waiting never
	// writes one, and one that died with the daemon never will.
	if spans[1].To != 9000 {
		t.Errorf("open stretch ends at %d instead of now", spans[1].To)
	}
}

func TestSessionsDoNotMix(t *testing.T) {
	write(t, "1000 a working\n1500 b waiting\n3000 a waiting\n")
	spans := ReadLedger(5000)
	var aWork, bWait int64
	for _, s := range spans {
		if s.Session == "a" && s.Status == "working" {
			aWork = s.To - s.From
		}
		if s.Session == "b" && s.Status == "waiting" {
			bWait = s.To - s.From
		}
	}
	if aWork != 2000 {
		t.Errorf("a worked %d instead of 2000", aWork)
	}
	if bWait != 3500 {
		t.Errorf("b waited %d instead of 3500", bWait)
	}
}

// A broken line must not take the rest of the file with it: the hook appends
// from several processes at once, and a crash in the middle of a write is the
// normal case, not the exception.
//
// What is NOT checked here is a truncated status — "2000 a wai" is a
// syntactically fine line and the reader cannot tell it from a real one. It
// does no harm either: an unknown status matches neither working nor waiting
// and drops out of every sum.
func TestBrokenLinesAreSkipped(t *testing.T) {
	write(t, "1000 a working\nrubbish\n\nnotanumber a waiting\n2000 a waiting\n")
	spans := ReadLedger(3000)
	if len(spans) != 2 {
		t.Fatalf("%d stretches instead of 2", len(spans))
	}
	if spans[0].To != 2000 {
		t.Errorf("the good line did not close the first stretch: %+v", spans[0])
	}
}

func TestWaitingIsCapped(t *testing.T) {
	// One night: finished at 19:00, seen again at 09:00. Without the cap that
	// is fourteen hours of waiting and buries every real number under it.
	abend := time.Date(2026, 3, 1, 19, 0, 0, 0, time.Local).UnixMilli()
	morgen := time.Date(2026, 3, 2, 9, 0, 0, 0, time.Local).UnixMilli()
	write(t, "")
	os.WriteFile(LedgerFile(), []byte(
		fmt.Sprintf("%d a waiting\n%d a working\n", abend, morgen)), 0o644)

	rep := Waiting(0, morgen+1000)
	if rep.Waited != WaitCap {
		t.Errorf("waited %d instead of the cap %d", rep.Waited, WaitCap)
	}
	if rep.Cut != morgen-abend-WaitCap {
		t.Errorf("cut %d, expected %d", rep.Cut, morgen-abend-WaitCap)
	}
}

func TestNightShiftLandsOnBothDays(t *testing.T) {
	// 23:50 to 00:20 — half an hour of work, split across two days. Whoever
	// books it whole onto the starting day makes every night look like an
	// empty morning.
	von := time.Date(2026, 3, 1, 23, 50, 0, 0, time.Local).UnixMilli()
	bis := time.Date(2026, 3, 2, 0, 20, 0, 0, time.Local).UnixMilli()
	write(t, "")
	os.WriteFile(LedgerFile(), []byte(
		fmt.Sprintf("%d a working\n%d a waiting\n", von, bis)), 0o644)

	rep := Waiting(0, bis+1000)
	if len(rep.ByDay) < 2 {
		t.Fatalf("%d day(s), expected 2", len(rep.ByDay))
	}
	if rep.Worked != bis-von {
		t.Errorf("worked %d instead of %d", rep.Worked, bis-von)
	}
	var erster, zweiter int64
	for _, l := range rep.ByDay {
		if l.Key == "2026-03-01" {
			erster = l.Worked
		}
		if l.Key == "2026-03-02" {
			zweiter = l.Worked
		}
	}
	if erster != 10*60*1000 || zweiter != 20*60*1000 {
		t.Errorf("split %d / %d instead of 10 / 20 minutes", erster/60000, zweiter/60000)
	}
}
