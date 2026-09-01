//go:build !windows

package core

import (
	"os"
	"syscall"
)

// Ask, rather than tell: a window given the chance to close itself takes its
// webview down in order, and what is being replaced here is a program somebody
// is looking at.
func askToQuit(pid int) {
	if pid <= 1 {
		return
	}
	if p, err := os.FindProcess(pid); err == nil {
		_ = p.Signal(syscall.SIGTERM)
	}
}
