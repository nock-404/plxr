//go:build windows

package core

import "os"

// Windows has no polite signal for this; the window is ended.
func askToQuit(pid int) {
	if pid <= 1 {
		return
	}
	if p, err := os.FindProcess(pid); err == nil {
		_ = p.Kill()
	}
}
