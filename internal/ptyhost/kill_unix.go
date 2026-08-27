//go:build !windows

package ptyhost

import (
	"os"
	"syscall"
)

// nachStart hat unter Unix nichts zu tun: go-pty startet das Kind mit eigener
// Session, damit ist die Prozessgruppe schon da.
func afterStart(*os.Process) any { return nil }

// killProcess beendet die gesamte Prozessgruppe. Die Gruppen-ID ist gleich der
// Prozess-ID; das negative Vorzeichen adressiert die Gruppe. Ohne das
// überlebt etwa der node-Enkel von `npm run dev` und hält seinen Port.
func killProcess(p *os.Process, _ any) {
	if err := syscall.Kill(-p.Pid, syscall.SIGTERM); err != nil {
		// Keine eigene Gruppe oder schon weg: dann eben nur den Prozess.
		_ = p.Signal(syscall.SIGTERM)
	}
}

// killProcessHart lässt nicht mit sich reden. Auch hier zuerst die Gruppe:
// sonst überlebt, was die Session gestartet hat.
func killProcessHard(p *os.Process, _ any) {
	if err := syscall.Kill(-p.Pid, syscall.SIGKILL); err != nil {
		_ = p.Signal(syscall.SIGKILL)
	}
}
