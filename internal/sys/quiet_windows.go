//go:build windows

package sys

import (
	"os/exec"
	"syscall"
)

// CREATE_NO_WINDOW, and the flag that says so again in the older way: between
// them no console appears for a helper, whichever Windows this is.
const createNoWindow = 0x08000000

func quiet(c *exec.Cmd) {
	if c.SysProcAttr == nil {
		c.SysProcAttr = &syscall.SysProcAttr{}
	}
	c.SysProcAttr.HideWindow = true
	c.SysProcAttr.CreationFlags |= createNoWindow
}
