//go:build !windows

package ptyhost

import (
	"errors"
	"strings"
	"testing"
	"time"
)

/* Reload has to reach the program and spare the shell.

   SIGHUP is what a long-running server reads as "read your configuration
   again", and it is also what a shell reads as "the terminal has gone away" —
   this package's own escalation sends it for exactly that reason. Sent to the
   whole process group it would end the session it was meant to reload, which
   is the one outcome that must not be possible.
*/

// errFound ends a stream once what was waited for has been read.
var errFound = errors.New("found")

// waitFor reads the session until the text appears, or gives up.
func waitFor(t *testing.T, h *Host, text string, within time.Duration) bool {
	t.Helper()
	v := h.Attach()
	defer v.Detach()
	seen := make(chan bool, 1)
	go func() {
		var buf strings.Builder
		stop := errFound
		v.Stream(func(b []byte) error {
			buf.Write(b)
			if strings.Contains(buf.String(), text) {
				return stop
			}
			return nil
		})
		seen <- strings.Contains(buf.String(), text)
	}()
	select {
	case ok := <-seen:
		return ok
	case <-time.After(within):
		v.Detach()
		return false
	}
}

func TestReloadReachesTheProgramAndNotTheShell(t *testing.T) {
	h, err := Start("reload", t.TempDir(), []string{"/bin/sh"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer h.Kill()

	// A shell at its prompt is its own foreground group. Reloading it would
	// end the session, so it must be refused — with a reason.
	time.Sleep(300 * time.Millisecond)
	if ok, why := h.Reload(); ok {
		t.Fatal("reloaded a shell sitting at its prompt — that ends the session")
	} else if why == "" {
		t.Fatal("refused without saying why")
	}
	if !h.Alive() {
		t.Fatal("the session did not survive being asked to reload at its prompt")
	}

	/* A program in the foreground that handles SIGHUP gets it, carries on, and
	   says so. It is its own shell rather than a trap in this one: a trap set
	   at the prompt is reset to its default in the subshell that job control
	   forks for the pipeline, so the parent's trap would never run and the
	   test would be measuring the wrong process. Nothing outside this test is
	   needed either way. */
	if _, err := h.Write([]byte("sh -c 'trap \"echo RELOADED\" HUP; echo READY; while true; do sleep 0.2; done'\n")); err != nil {
		t.Fatal(err)
	}
	if !waitFor(t, h, "READY", 5*time.Second) {
		t.Fatal("the program never started")
	}
	time.Sleep(300 * time.Millisecond)
	if ok, why := h.Reload(); !ok {
		t.Fatalf("a running program was not reloaded: %s", why)
	}
	if !waitFor(t, h, "RELOADED", 5*time.Second) {
		t.Fatal("the program did not receive the signal")
	}
	/* The one outcome that must not be possible. SIGHUP is also what a shell
	   reads as "the terminal has gone away", so a reload sent one process
	   group too wide would close the session it was meant to keep running. */
	if !h.Alive() {
		t.Fatal("the session ended — the signal reached the shell as well")
	}
}
