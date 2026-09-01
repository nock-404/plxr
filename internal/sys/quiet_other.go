//go:build !windows

package sys

import "os/exec"

// No console is created for a child process here, so there is nothing to hide.
func quiet(*exec.Cmd) {}
