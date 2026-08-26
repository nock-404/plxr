//go:build windows

package cli

import (
	"time"

	"golang.org/x/term"
)

// groessenWache meldet Größenänderungen weiter.
//
// Windows kennt kein SIGWINCH — die Konsole benachrichtigt nur über
// Fensterereignisse, die ein angehängter Prozess nicht ohne Weiteres bekommt.
// Deshalb wird nachgesehen. Zweimal pro Sekunde ist billig genug und schnell
// genug, dass es beim Ziehen am Fensterrand nicht auffällt.
func groessenWache(fd int, melden func(rows, cols int)) func() {
	ende := make(chan struct{})
	go func() {
		t := time.NewTicker(500 * time.Millisecond)
		defer t.Stop()
		letztW, letztH := 0, 0
		for {
			select {
			case <-ende:
				return
			case <-t.C:
				w, h, err := term.GetSize(fd)
				if err != nil || (w == letztW && h == letztH) {
					continue
				}
				letztW, letztH = w, h
				melden(h, w)
			}
		}
	}()
	return func() { close(ende) }
}
