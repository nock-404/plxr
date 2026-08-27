//go:build !windows

package daemon

import (
	"os/exec"
	"syscall"
)

// detach puts the daemon into a session of its own. Without that it would
// receive the SIGHUP when the launching terminal goes away — which would
// defeat the entire point of it.
func detach(c *exec.Cmd) {
	c.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}
