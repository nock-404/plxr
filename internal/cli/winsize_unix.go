//go:build !windows

package cli

import (
	"os"
	"os/signal"
	"syscall"

	"golang.org/x/term"
)

// groessenWache meldet jede Größenänderung des lokalen Terminals weiter.
// Unix schickt dafür SIGWINCH.
func groessenWache(fd int, melden func(rows, cols int)) func() {
	winch := make(chan os.Signal, 1)
	signal.Notify(winch, syscall.SIGWINCH)
	go func() {
		for range winch {
			if w, h, err := term.GetSize(fd); err == nil {
				melden(h, w)
			}
		}
	}()
	return func() { signal.Stop(winch) }
}
