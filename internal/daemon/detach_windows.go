//go:build windows

package daemon

import (
	"os/exec"
	"syscall"
)

// detach startet den Daemon ohne Konsolenfenster und abgekoppelt vom Elternteil.
func detach(c *exec.Cmd) {
	c.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x00000008 | 0x08000000, // DETACHED_PROCESS | CREATE_NO_WINDOW
	}
}
