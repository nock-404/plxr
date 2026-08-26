//go:build !windows

package ports

import "syscall"

// Kill beendet einen Prozess. Erst höflich mit SIGTERM, damit ein Dev-Server
// seine Aufräumarbeiten machen kann; das Nachfassen mit SIGKILL entscheidet
// der Aufrufer.
func Kill(pid int, hart bool) error {
	sig := syscall.SIGTERM
	if hart {
		sig = syscall.SIGKILL
	}
	return syscall.Kill(pid, sig)
}
