//go:build windows

package ports

import "os"

// Kill beendet einen Prozess.
//
// Windows kennt kein SIGTERM: TerminateProcess ist immer hart. Ein sanftes
// Beenden gäbe es nur über eine Fensternachricht oder ein Konsolenereignis,
// und beides trifft Dienste und fensterlose Prozesse nicht zuverlässig.
// Deshalb ist der Unterschied zwischen "beenden" und "hart" hier keiner.
func Kill(pid int, hart bool) error {
	p, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return p.Kill()
}
