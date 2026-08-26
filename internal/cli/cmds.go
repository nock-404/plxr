package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/term"
)

const (
	dim   = "\x1b[2m"
	fett  = "\x1b[1m"
	gelb  = "\x1b[33m"
	rot   = "\x1b[31m"
	gruen = "\x1b[32m"
	weg   = "\x1b[0m"
)

func farbe(status string) string {
	switch status {
	case "working":
		return gruen
	case "permission":
		return rot
	case "waiting":
		return gelb
	default:
		return dim
	}
}

var zeichen = map[string]string{
	"working": "●", "waiting": "○", "permission": "◉", "dead": "✕", "unknown": "·",
}

func wort(status string) string {
	switch status {
	case "working":
		return "arbeitet"
	case "waiting":
		return "wartet"
	case "permission":
		return "braucht dich"
	case "dead":
		return "beendet"
	}
	return "läuft"
}

// Ls listet die Sessions.
func Ls(c *Client) error {
	list, err := c.Sessions()
	if err != nil {
		return err
	}
	if len(list) == 0 {
		fmt.Println("keine Sessions. `plxr new <pfad>` startet eine.")
		return nil
	}
	for _, t := range list {
		name := t.Title
		if name == "" {
			name = t.Name
		}
		fmt.Printf("%s%s%s %-8s %s%-28s%s %-13s %s%s%s\n",
			farbe(string(t.Status)), zeichen[string(t.Status)], weg,
			t.ID[:8], fett, kurz(name, 28), weg,
			wort(string(t.Status)), dim, t.Cwd, weg)
	}
	return nil
}

func kurz(s string, n int) string {
	if len([]rune(s)) <= n {
		return s
	}
	return string([]rune(s)[:n-1]) + "…"
}

// New startet eine Session.
func New(c *Client, cwd string, cmd []string) error {
	if cwd == "" || cwd == "." {
		cwd, _ = os.Getwd()
	}
	abs, err := filepath.Abs(cwd)
	if err != nil {
		return err
	}
	var out struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := c.schicke("POST", "/api/sessions",
		map[string]any{"cwd": abs, "cmd": cmd}, &out); err != nil {
		return err
	}
	fmt.Printf("%s gestartet in %s\n", out.ID[:8], abs)
	fmt.Printf("%splxr attach %s%s\n", dim, out.ID[:8], weg)
	return nil
}

// Kill beendet eine Session.
func Kill(c *Client, was string) error {
	t, err := c.Finden(was)
	if err != nil {
		return err
	}
	if err := c.schicke("DELETE", "/api/sessions/"+t.ID+"?purge=1", nil, nil); err != nil {
		return err
	}
	fmt.Printf("%s beendet\n", t.Name)
	return nil
}

// Ports zeigt die belegten Ports.
func Ports(c *Client) error {
	var list []struct {
		PID     int    `json:"pid"`
		Command string `json:"command"`
		Port    int    `json:"port"`
		Addr    string `json:"addr"`
		Eigen   bool   `json:"eigen"`
	}
	if err := c.hole("/api/ports", &list); err != nil {
		return err
	}
	for _, p := range list {
		markierung := ""
		if p.Eigen {
			markierung = gruen + " · plxr" + weg
		}
		fmt.Printf("%5d  %-20s %spid %-7d %s%s%s\n", p.Port, p.Command, dim, p.PID, p.Addr, weg, markierung)
	}
	return nil
}

// Attach hängt das aufrufende Terminal an eine Session.
//
// Der lokale Bildschirm geht dafür in den Rohmodus: Tastendrücke müssen
// unverändert durchgereicht werden, sonst käme etwa Strg-C bei der Session nie
// an, sondern beendet plxr.
func Attach(c *Client, was string) error {
	t, err := c.Finden(was)
	if err != nil {
		return err
	}
	if !t.Alive {
		return fmt.Errorf("%s läuft nicht mehr", t.Name)
	}

	conn, err := c.ws("/ws/session/" + t.ID)
	if err != nil {
		return err
	}
	defer conn.Close()

	// gorilla/websocket verträgt genau einen Schreiber. Hier schreiben drei
	// Goroutinen: Größenmeldung, Tastatureingabe und der Aufbau. Ohne diesen
	// Riegel reicht es, das Fenster zu ziehen während man tippt — und der
	// Panic reißt den Prozess mit, bevor das Terminal wiederhergestellt ist.
	var schreibSperre sync.Mutex
	schreiben := func(v any) error {
		schreibSperre.Lock()
		defer schreibSperre.Unlock()
		return conn.WriteJSON(v)
	}

	fd := int(os.Stdin.Fd())
	var alt *term.State
	if term.IsTerminal(fd) {
		if alt, err = term.MakeRaw(fd); err != nil {
			return err
		}
		// Zweifach abgesichert: das defer für den geordneten Weg, das recover
		// für den ungeordneten. Eine Shell, die im Rohmodus zurückbleibt, ist
		// für den Nutzer schlimmer als jeder Fehler darin — sie zeigt nichts
		// mehr an, was er tippt.
		defer term.Restore(fd, alt)
		defer func() {
			if r := recover(); r != nil {
				term.Restore(fd, alt)
				fmt.Fprintf(os.Stderr, "\r\nplxr: abgebrochen (%v)\r\n", r)
				os.Exit(1)
			}
		}()
	}

	melden := func(rows, cols int) {
		_ = schreiben(map[string]any{"type": "resize", "rows": rows, "cols": cols})
	}
	if w, h, err := term.GetSize(fd); err == nil {
		melden(h, w)
	}

	// Größenänderungen des lokalen Fensters weiterreichen.
	stopp := groessenWache(fd, melden)
	defer stopp()

	fertig := make(chan struct{})
	go func() {
		defer close(fertig)
		for {
			_, daten, err := conn.ReadMessage()
			if err != nil {
				return
			}
			os.Stdout.Write(daten)
		}
	}()

	// Eingabe hineinreichen. Strg-Q zweimal hintereinander löst das Terminal
	// wieder von der Session — die läuft weiter.
	go func() {
		buf := make([]byte, 4096)
		letztes := time.Time{}
		for {
			n, err := os.Stdin.Read(buf)
			if err != nil {
				return
			}
			if n == 1 && buf[0] == 0x11 { // Strg-Q
				if time.Since(letztes) < time.Second {
					conn.Close()
					return
				}
				letztes = time.Now()
				continue
			}
			letztes = time.Time{}
			if schreiben(map[string]any{"type": "in", "data": string(buf[:n])}) != nil {
				return
			}
		}
	}()

	<-fertig
	if alt != nil {
		term.Restore(fd, alt)
	}
	fmt.Printf("\r\n%sabgehängt — %s läuft weiter%s\r\n", dim, t.Name, weg)
	return nil
}

// Hilfe beschreibt die Kommandos.
func Hilfe() {
	fmt.Print(`plxr — Leitstand für Coding-CLI-Sessions

  plxr                    Fenster öffnen
  plxr ls                 laufende Sessions
  plxr new [pfad] [-- kommando …]
                          Session starten (Standard: claude im aktuellen Ordner)
  plxr attach <was>       Terminal an eine Session hängen (Strg-Q zweimal löst)
  plxr kill <was>         Session beenden
  plxr ports              belegte Ports
  plxr setup-hook [dir]   Claude Code beibringen, seinen Zustand zu melden
                          (ohne Angabe ~/.claude; unsetup-hook nimmt es zurück)
  plxr update             auf die neueste Fassung bringen
  plxr daemon             Daemon im Vordergrund (macht plxr sonst selbst)

<was> ist der Anfang der ID oder ein Teil des Namens.
`)
}

var _ = strings.TrimSpace
