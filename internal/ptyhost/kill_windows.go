//go:build windows

package ptyhost

import "os"

// killProcess beendet den Prozess.
//
// ACHTUNG, bekannte Lücke: Windows kennt keine Prozessgruppen im Unix-Sinn.
// os.Process.Kill() ist TerminateProcess auf genau eine PID — startet die
// Session etwa `npm run dev`, überlebt der node-Enkel und hält seinen Port.
// Sauber wäre CreateJobObject + AssignProcessToJobObject beim Start und
// TerminateJobObject hier. Das ist bewusst noch nicht gebaut, weil es sich
// ohne echte Windows-Maschine nicht verifizieren lässt; der CI-Build prüft
// nur, dass es kompiliert.
//
// Ebenfalls nicht möglich: ein sanftes Beenden. Es gibt kein SIGTERM. Der
// weiche Weg wäre 0x03 (Ctrl+C) in die Eingabe-Pipe zu schreiben.
func killProcess(p *os.Process) {
	_ = p.Kill()
}
