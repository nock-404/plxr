//go:build windows

package cli

import (
	"time"

	"golang.org/x/term"
)

// watchResize forwards size changes.
//
// Windows has no SIGWINCH — the console only reports window events, which an
// attached process does not readily receive. So it polls instead. Twice a
// second is cheap enough and quick enough to go unnoticed while dragging the
// window edge.
func watchResize(fd int, report func(rows, cols int)) func() {
	end := make(chan struct{})
	go func() {
		t := time.NewTicker(500 * time.Millisecond)
		defer t.Stop()
		lastW, lastH := 0, 0
		for {
			select {
			case <-end:
				return
			case <-t.C:
				w, h, err := term.GetSize(fd)
				if err != nil || (w == lastW && h == lastH) {
					continue
				}
				lastW, lastH = w, h
				report(h, w)
			}
		}
	}()
	return func() { close(end) }
}
