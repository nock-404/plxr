//go:build windows

package daemon

import (
	"os/exec"
	"syscall"
)

// detach starts the daemon without a console window, detached from its parent.
func detach(c *exec.Cmd) {
	c.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x00000008 | 0x08000000, // DETACHED_PROCESS | CREATE_NO_WINDOW
	}
}
