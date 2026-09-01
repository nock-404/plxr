//go:build !windows

package cli

import (
	"os"
	"os/signal"
	"syscall"

	"golang.org/x/term"
)

// watchResize forwards every size change of the local terminal.
// Unix signals this with SIGWINCH.
func watchResize(fd int, report func(rows, cols int)) func() {
	winch := make(chan os.Signal, 1)
	signal.Notify(winch, syscall.SIGWINCH)
	go func() {
		for range winch {
			if w, h, err := term.GetSize(fd); err == nil {
				report(h, w)
			}
		}
	}()
	return func() { signal.Stop(winch) }
}
