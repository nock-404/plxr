//go:build !windows

package ptyhost

import (
	"syscall"

	"golang.org/x/sys/unix"
)

/*
reloadProcess asks whatever is running in the terminal to reload itself.

	The signal is SIGHUP, which a long-running program reads as "read your
	configuration again": puma, nginx, sshd and most things that hold a port
	all do. Nothing is lost — the process keeps its port, its connections and
	its place.

	Where it is sent matters more than what is sent. SIGHUP to the whole
	process group would reach the shell as well, and a shell reads SIGHUP as
	"the terminal has gone away" and exits — it is the second step of this
	package's own escalation when killing a session. So it goes to the
	terminal's foreground process group and nowhere else: the group the kernel
	says is currently attached to the terminal, which is the program the user
	started and not the shell that started it.

	And when nothing is running, it is not sent at all. A shell sitting at its
	prompt is its own foreground group — the leader's, whose id is the leader's
	pid — and signalling that would end the session that was meant to be
	reloaded. Then the answer is no, with a reason, rather than a terminal that
	silently closes.
*/
func reloadProcess(fd uintptr, leaderPid int) (bool, string) {
	pgrp, err := unix.IoctlGetInt(int(fd), unix.TIOCGPGRP)
	if err != nil || pgrp <= 0 {
		return false, "the terminal has no foreground program"
	}
	if pgrp == leaderPid {
		return false, "nothing is running here — the shell is at its prompt"
	}
	if err := syscall.Kill(-pgrp, syscall.SIGHUP); err != nil {
		return false, err.Error()
	}
	return true, ""
}
