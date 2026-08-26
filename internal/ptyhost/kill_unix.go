//go:build !windows

package ptyhost

import (
	"os"
	"syscall"
)

// killProcess beendet die gesamte Prozessgruppe. go-pty startet das Kind mit
// eigener Session, deshalb ist die Gruppen-ID gleich der Prozess-ID; das
// negative Vorzeichen adressiert die Gruppe.
func killProcess(p *os.Process) {
	if err := syscall.Kill(-p.Pid, syscall.SIGTERM); err != nil {
		// Keine eigene Gruppe (oder schon weg): dann eben nur den Prozess.
		_ = p.Signal(syscall.SIGTERM)
	}
}
