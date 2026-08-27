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

/*
freezeProcess suspends the whole group, resumeProcess lets it go again.

	The emergency brake: `prisma migrate reset --force` appears in a tile and
	there are two seconds to react. Terminating would lose the session, and
	Ctrl-C only reaches whatever currently reads from the terminal — not the
	grandchild that is already writing. SIGSTOP cannot be caught, ignored or
	handled, and it reaches everything in the group at once.

	The stopped process stays alive with everything it holds open. It carries on
	exactly where it was on SIGCONT.
*/
func freezeProcess(p *os.Process) bool {
	if err := syscall.Kill(-p.Pid, syscall.SIGSTOP); err != nil {
		return p.Signal(syscall.SIGSTOP) == nil
	}
	return true
}

func resumeProcess(p *os.Process) bool {
	if err := syscall.Kill(-p.Pid, syscall.SIGCONT); err != nil {
		return p.Signal(syscall.SIGCONT) == nil
	}
	return true
}
