package ptyhost

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
)

// The child of these tests is this test binary itself: that works on Windows
// too, where there is no sh to write a loop in.
const floodLines = 4000

func TestHelperFlood(t *testing.T) {
	if os.Getenv("PLXR_FLOOD") == "" {
		t.Skip("helper process, started by the tests below")
	}
	pad := strings.Repeat("x", 180)
	for i := 0; i < floodLines; i++ {
		os.Stdout.WriteString("L" + itoa6(i) + " " + pad + "\n")
	}
}

func itoa6(i int) string {
	s := strconv.Itoa(i)
	for len(s) < 6 {
		s = "0" + s
	}
	return s
}

func flooding(t *testing.T) *Host {
	t.Helper()
	h, err := Start("t-"+t.Name(), t.TempDir(),
		[]string{os.Args[0], "-test.run=TestHelperFlood"},
		[]string{"PLXR_FLOOD=1"})
	if err != nil {
		t.Skipf("no pty here: %v", err)
	}
	t.Cleanup(h.Kill)
	return h
}

// A window that stops reading — a laptop that went to sleep, a stalled Wi-Fi
// link — must not stop the session for everybody else.
func TestSlowViewerDoesNotFreezeTheSession(t *testing.T) {
	h := flooding(t)

	asleep := h.Attach() // attached, but nobody ever calls Stream on it
	defer asleep.Detach()
	awake := h.Attach()
	defer awake.Detach()

	// The awake window has to see the session through to its last line.
	got := make(chan int, 1)
	go func() {
		last := -1
		stop := errors.New("stop")
		awake.Stream(func(b []byte) error {
			for _, n := range numbers(b) {
				if n > last {
					last = n
				}
			}
			if last == floodLines-1 {
				return stop
			}
			return nil
		})
		got <- last
	}()

	select {
	case last := <-got:
		if last != floodLines-1 {
			t.Fatalf("the second window got as far as line %d of %d", last, floodLines-1)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the second window stopped receiving because the first one is not reading")
	}

	done := make(chan struct{})
	go func() { h.Snapshot(); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the session is locked up: Snapshot waits on a window that is not reading")
	}
}

var lineNo = regexp.MustCompile(`L(\d{6}) `)

func numbers(b []byte) []int {
	var out []int
	for _, m := range lineNo.FindAllSubmatch(b, -1) {
		n, _ := strconv.Atoi(string(m[1]))
		out = append(out, n)
	}
	return out
}

// contiguous attaches, follows the session to its end and reports the first
// hole in the line numbers.
func contiguous(t *testing.T, h *Host, attach func() *Viewer) error {
	t.Helper()
	v := attach()
	defer v.Detach()

	// Everything is collected as one run of bytes and only counted at the
	// end: a chunk boundary can fall inside a line, and a line cut in half is
	// not a lost line.
	all := append([]byte{}, v.Back...)
	final := []byte("L" + itoa6(floodLines-1) + " ")
	done := errors.New("done")
	deadline := time.Now().Add(5 * time.Second)
	v.Stream(func(b []byte) error {
		all = append(all, b...)
		if bytes.Contains(all, final) || time.Now().After(deadline) {
			return done
		}
		return nil
	})

	if len(all) == 0 {
		return errors.New("nothing arrived at all")
	}
	// Lines may repeat — a window that fell behind is served the whole screen
	// again, and then sees what it already had a second time. None of them may
	// be missing, and none may arrive after something newer.
	seen := numbers(all)
	last := seen[0] - 1
	for _, n := range seen {
		switch {
		case n <= last: // seen before, part of a catch-up
		case n == last+1:
			last = n
		default:
			return fmt.Errorf("line %d follows line %d — %d lines went missing",
				n, last, n-last-1)
		}
	}
	return nil
}

// twoStep is how attaching used to work: fetch the scrollback, send it out
// over the network, and only then ask for the stream. It is kept here as the
// defect the test below has to catch — a check for a hole that cannot see a
// hole would pass for ever without meaning anything.
func twoStep(h *Host) func() *Viewer {
	return func() *Viewer {
		back := h.Snapshot()
		time.Sleep(2 * time.Millisecond) // the scrollback going over the wire
		v := h.Attach()
		v.Back = back
		return v
	}
}

// Attaching must not lose what is written in the very moment of attaching:
// scrollback and stream have to be taken in one step.
func TestAttachLosesNothingInBetween(t *testing.T) {
	for round := 0; round < 15; round++ {
		h := flooding(t)
		time.Sleep(time.Duration(round) * time.Millisecond)
		if err := contiguous(t, h, h.Attach); err != nil {
			t.Fatalf("round %d: %v", round, err)
		}
		h.Kill()
	}
}

// And the check above has to be able to see that happening.
func TestTheGapWouldBeSeen(t *testing.T) {
	for round := 0; round < 15; round++ {
		h := flooding(t)
		time.Sleep(time.Duration(round) * time.Millisecond)
		err := contiguous(t, h, twoStep(h))
		h.Kill()
		if err != nil {
			return // the two-step attach loses output, as it must
		}
	}
	t.Fatal("the two-step attach lost nothing in 15 tries — this check proves nothing")
}

// Two windows of different size share one terminal. The output has to fit into
// both of them, so the smaller one sets the width.
func TestTheSmallerWindowSetsTheSize(t *testing.T) {
	h := flooding(t)
	big, small := h.Attach(), h.Attach()
	defer big.Detach()
	defer small.Detach()

	small.Resize(24, 80)
	big.Resize(60, 200) // the later, larger window must not win
	if r, c := h.Size(); r != 24 || c != 80 {
		t.Fatalf("with a 24x80 window attached the terminal is %dx%d", r, c)
	}

	// The small window goes away — the big one gets its room back.
	small.Detach()
	if r, c := h.Size(); r != 60 || c != 200 {
		t.Fatalf("after the small window left the terminal is %dx%d, not 60x200", r, c)
	}
}
