//go:build windows

package daemon

import "os"

// Windows has no polite signal for a process that is not a console application.
func end(pid int) {
	if pid <= 1 {
		return
	}
	if p, err := os.FindProcess(pid); err == nil {
		_ = p.Kill()
	}
}
