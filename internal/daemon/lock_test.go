package daemon

import (
	"errors"
	"testing"
)

// Only one daemon, even when two start in the same breath.
//
// The check that was there — read daemon.json, ask whether anybody answers,
// start one if not — has a gap in the middle. Two windows opening together
// both look, both find nothing, both start one. Two were running on this
// machine for a day, and nothing anywhere said so.
func TestOnlyOneDaemonGetsTheLock(t *testing.T) {
	t.Setenv("PLXR_HOME", t.TempDir())

	first, info, err := Listen()
	if err != nil {
		t.Fatalf("the first one could not start: %v", err)
	}
	defer first.Close()
	if info.Port == 0 {
		t.Fatal("no port")
	}

	second, _, err := Listen()
	if !errors.Is(err, ErrAlreadyRunning) {
		if second != nil {
			second.Close()
		}
		t.Fatalf("the second one started as well: %v", err)
	}
}
