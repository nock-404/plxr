//go:build windows

package ports

import "os"

// Kill terminates a process.
//
// Windows has no SIGTERM: TerminateProcess is always hard. A gentle shutdown
// would only be possible through a window message or a console event, and
// neither reliably reaches services or windowless processes. So here there is
// no difference between "terminate" and "hard".
func Kill(pid int, hard bool) error {
	p, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return p.Kill()
}
