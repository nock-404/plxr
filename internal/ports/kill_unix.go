//go:build !windows

package ports

import "syscall"

// Kill terminates a process. Politely with SIGTERM first, so a dev server gets
// to run its cleanup; whether to follow up with SIGKILL is the caller's call.
func Kill(pid int, hard bool) error {
	sig := syscall.SIGTERM
	if hard {
		sig = syscall.SIGKILL
	}
	return syscall.Kill(pid, sig)
}
