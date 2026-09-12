//go:build !windows

package ptyhost

import (
	"bytes"
	"errors"
	"os"
	"os/exec"
	"os/signal"
	"regexp"
	"strconv"
	"syscall"
	"testing"
	"time"
)

/* Terminate ends everything the session started — not only the root.
 *
 * The child of these tests is this test binary itself. It plays a program that
 * ignores SIGTERM the way a shell or Claude Code does, and it starts a `sleep`
 * in a session of its own — the `setsid sleep 300` that used to survive a
 * terminate and keep the pty open, so the tile said "running" with nobody in
 * it. In "hup" mode it goes on SIGHUP, in "hard" mode only SIGKILL ends it.
 */

func TestHelperStray(t *testing.T) {
	mode := os.Getenv("PLXR_STRAY")
	if mode == "" {
		t.Skip("helper process, started by the tests below")
	}
	// Notified, not ignored: an ignored signal leaves nothing to wait on and
	// the runtime calls that a deadlock. "hard" reads the hangup and stays.
	signal.Ignore(syscall.SIGTERM)
	hup := make(chan os.Signal, 1)
	signal.Notify(hup, syscall.SIGHUP)
	child := exec.Command("sleep", "300")
	child.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	child.Stdin, child.Stdout, child.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err := child.Start(); err != nil {
		os.Stdout.WriteString("no child: " + err.Error() + "\n")
		os.Exit(3)
	}
	os.Stdout.WriteString("child " + strconv.Itoa(child.Process.Pid) + "\n")
	for range hup {
		if mode != "hard" {
			os.Exit(0)
		}
	}
}

var childLine = regexp.MustCompile(`child (\d+)`)

func gone(pid int) bool {
	err := syscall.Kill(pid, 0)
	return errors.Is(err, syscall.ESRCH)
}

func TestTerminateReachesStrays(t *testing.T) {
	for _, mode := range []string{"hup", "hard"} {
		t.Run(mode, func(t *testing.T) {
			old := KillGrace
			KillGrace = 300 * time.Millisecond
			t.Cleanup(func() { KillGrace = old })

			h, err := Start("t-stray-"+mode, t.TempDir(),
				[]string{os.Args[0], "-test.run=TestHelperStray"},
				[]string{"PLXR_STRAY=" + mode})
			if err != nil {
				t.Skipf("no pty here: %v", err)
			}
			t.Cleanup(h.Kill)

			var child int
			deadline := time.Now().Add(8 * time.Second)
			for child == 0 && time.Now().Before(deadline) {
				if m := childLine.FindStringSubmatch(h.Tail(5)); m != nil {
					child, _ = strconv.Atoi(m[1])
				}
				time.Sleep(50 * time.Millisecond)
			}
			if child == 0 {
				t.Fatalf("the helper never reported its child; screen: %q", h.Tail(5))
			}
			// The child sits in a session of its own, so the group signal
			// cannot reach it; the mark in its environment is what finds it.
			found := false
			for _, pid := range h.Strays() {
				if pid == child {
					found = true
				}
			}
			if !found {
				t.Fatalf("stray %d is not found by its mark; strays: %v", child, h.Strays())
			}

			started := time.Now()
			h.Kill()
			select {
			case <-h.Done:
			case <-time.After(6 * time.Second):
				t.Fatal("the session did not end")
			}
			took := time.Since(started)
			deadline = time.Now().Add(2 * time.Second)
			for !gone(child) && time.Now().Before(deadline) {
				time.Sleep(50 * time.Millisecond)
			}
			if !gone(child) {
				ps, _ := exec.Command("ps", "-o", "pid=,stat=,ppid=,pgid=,command=", "-p", strconv.Itoa(child)).CombinedOutput()
				t.Fatalf("the setsid child %d survived the terminate: %s", child, ps)
			}
			if left := h.Strays(); len(left) != 0 {
				t.Fatalf("strays left after terminate: %v", left)
			}
			switch mode {
			case "hup":
				// SIGTERM was ignored, so a clean exit proves the SIGHUP step
				// ran — and only after the grace.
				if h.Exit() != 0 {
					t.Fatalf("expected the helper to leave on SIGHUP with 0, got %d", h.Exit())
				}
				if took < KillGrace {
					t.Fatalf("SIGHUP came before the grace: %v", took)
				}
			case "hard":
				// Both ignored: only the third step can have ended it.
				if h.Exit() == 0 {
					t.Fatal("the helper ignored TERM and HUP and still exited cleanly?")
				}
				if took < 2*KillGrace {
					t.Fatalf("SIGKILL came before two graces: %v", took)
				}
			}
		})
	}
}

// The second TERMINATE joins the first rather than starting an escalation of
// its own.
func TestKillTwiceIsOneEscalation(t *testing.T) {
	old := KillGrace
	KillGrace = 200 * time.Millisecond
	t.Cleanup(func() { KillGrace = old })
	h, err := Start("t-twice", t.TempDir(), []string{"sleep", "30"}, nil)
	if err != nil {
		t.Skipf("no pty here: %v", err)
	}
	h.Kill()
	h.Kill()
	select {
	case <-h.Done:
	case <-time.After(3 * time.Second):
		t.Fatal("the session did not end")
	}
}

func TestMarkNeedsTheWholeId(t *testing.T) {
	env := []byte("HOME=/x\x00" + SessionMark + "=abc123\x00TERM=xterm")
	if !carriesMark(env, "abc123") {
		t.Fatal("the mark is not seen")
	}
	if carriesMark(env, "abc") {
		t.Fatal("a prefix of the id must not match")
	}
	if carriesMark([]byte("X="+SessionMark+"=abc123\x00"), "abc123") {
		t.Fatal("the mark inside another value must not match")
	}
	if !carriesMark([]byte(SessionMark+"=abc123"), "abc123") {
		t.Fatal("a block that is nothing but the mark must match")
	}
}

// A viewer that fell behind is served the screen afresh, not the ring on top
// of what it already has: the catch-up begins with a terminal reset.
func TestCatchUpStartsWithAReset(t *testing.T) {
	h := flooding(t)
	v := h.Attach() // nobody reads until the flood is over
	select {
	case <-h.Done:
	case <-time.After(10 * time.Second):
		t.Fatal("the flood never ended")
	}
	var writes [][]byte
	v.Stream(func(b []byte) error {
		writes = append(writes, append([]byte{}, b...))
		return nil
	})
	if len(writes) == 0 {
		t.Fatal("nothing streamed")
	}
	last := writes[len(writes)-1]
	if !bytes.HasPrefix(last, []byte(resync)) {
		t.Fatalf("the catch-up does not begin with a reset: %q", last[:min(len(last), 12)])
	}
	if !bytes.Equal(last[len(resync):], h.Snapshot()) {
		t.Fatal("the catch-up is not the ring")
	}
	for _, w := range writes[:len(writes)-1] {
		if bytes.HasPrefix(w, []byte(resync)) {
			t.Fatal("a plain chunk carries the reset")
		}
	}
}
