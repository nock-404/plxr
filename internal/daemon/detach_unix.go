//go:build !windows

package daemon

import (
	"os/exec"
	"syscall"
)

// detach hängt den Daemon in eine eigene Session. Ohne das bekäme er das
// SIGHUP mit, wenn das startende Terminal verschwindet — und damit wäre der
// ganze Zweck dahin.
func detach(c *exec.Cmd) {
	c.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
}
