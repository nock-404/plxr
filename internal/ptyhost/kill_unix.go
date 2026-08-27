//go:build !windows

package ptyhost

import (
	"os"
	"syscall"
)

// afterStart has nothing to do on Unix: go-pty starts the child with a session
// of its own, so the process group is already there.
func afterStart(*os.Process) any { return nil }

// killProcess terminates the entire process group. The group id equals the
// process id; the negative sign addresses the group. Without it the node
// grandchild of `npm run dev` survives and keeps holding its port.
func killProcess(p *os.Process, _ any) {
	if err := syscall.Kill(-p.Pid, syscall.SIGTERM); err != nil {
		// No group of its own, or already gone: then just the process.
		_ = p.Signal(syscall.SIGTERM)
	}
}

// killProcessHard does not negotiate. The group comes first here as well:
// otherwise whatever the session started survives.
func killProcessHard(p *os.Process, _ any) {
	if err := syscall.Kill(-p.Pid, syscall.SIGKILL); err != nil {
		_ = p.Signal(syscall.SIGKILL)
	}
}
