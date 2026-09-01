//go:build !windows

package daemon

import (
	"os"
	"syscall"
)

// Asked to go, not taken down: a daemon given the chance closes its sessions'
// recordings properly on the way out.
func end(pid int) {
	if pid <= 1 {
		return
	}
	if p, err := os.FindProcess(pid); err == nil {
		_ = p.Signal(syscall.SIGTERM)
	}
}
