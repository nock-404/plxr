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
	dim    = "\x1b[2m"
	bold   = "\x1b[1m"
	yellow = "\x1b[33m"
	red    = "\x1b[31m"
	green  = "\x1b[32m"
	reset  = "\x1b[0m"
)

func color(status string) string {
	switch status {
	case "working":
		return green
	case "permission":
		return red
	case "waiting":
		return yellow
	default:
		return dim
	}
}

var glyph = map[string]string{
	"working": "●", "waiting": "○", "permission": "◉", "dead": "✕", "unknown": "·",
}

func word(status string) string {
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

// Ls lists the sessions.
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
			color(string(t.Status)), glyph[string(t.Status)], reset,
			t.ID[:8], bold, trunc(name, 28), reset,
			word(string(t.Status)), dim, t.Cwd, reset)
	}
	return nil
}

func trunc(s string, n int) string {
	if len([]rune(s)) <= n {
		return s
	}
	return string([]rune(s)[:n-1]) + "…"
}

// New starts a session.
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
	if err := c.send("POST", "/api/sessions",
		map[string]any{"cwd": abs, "cmd": cmd}, &out); err != nil {
		return err
	}
	fmt.Printf("%s gestartet in %s\n", out.ID[:8], abs)
	fmt.Printf("%splxr attach %s%s\n", dim, out.ID[:8], reset)
	return nil
}

// Kill terminates a session.
func Kill(c *Client, which string) error {
	t, err := c.Find(which)
	if err != nil {
		return err
	}
	if err := c.send("DELETE", "/api/sessions/"+t.ID+"?purge=1", nil, nil); err != nil {
		return err
	}
	fmt.Printf("%s beendet\n", t.Name)
	return nil
}

// Ports shows the occupied ports.
func Ports(c *Client) error {
	var list []struct {
		PID     int    `json:"pid"`
		Command string `json:"command"`
		Port    int    `json:"port"`
		Addr    string `json:"addr"`
		Eigen   bool   `json:"eigen"`
	}
	if err := c.fetch("/api/ports", &list); err != nil {
		return err
	}
	for _, p := range list {
		marker := ""
		if p.Eigen {
			marker = green + " · plxr" + reset
		}
		fmt.Printf("%5d  %-20s %spid %-7d %s%s%s\n", p.Port, p.Command, dim, p.PID, p.Addr, reset, marker)
	}
	return nil
}

// Attach attaches the calling terminal to a session.
//
// The local screen goes into raw mode for that: keystrokes have to be passed
// through unchanged, otherwise Ctrl-C would never reach the session
// an, sondern beendet plxr.
func Attach(c *Client, which string) error {
	t, err := c.Find(which)
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

	// gorilla/websocket tolerates exactly one writer. Three goroutines write
	// here: resize reporting, keyboard input and the setup. Without this latch
	// it is enough to drag the window while typing — and the panic takes the
	// process with it before the terminal has been restored.
	var writeMu sync.Mutex
	write := func(v any) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteJSON(v)
	}

	fd := int(os.Stdin.Fd())
	var old *term.State
	if term.IsTerminal(fd) {
		if old, err = term.MakeRaw(fd); err != nil {
			return err
		}
		// Guarded twice: the defer for the orderly path, the recover for the
		// disorderly one. A shell left behind in raw mode is worse for the user
		// than any error that caused it — it no longer shows anything they type.
		defer term.Restore(fd, old)
		defer func() {
			if r := recover(); r != nil {
				term.Restore(fd, old)
				fmt.Fprintf(os.Stderr, "\r\nplxr: abgebrochen (%v)\r\n", r)
				os.Exit(1)
			}
		}()
	}

	report := func(rows, cols int) {
		_ = write(map[string]any{"type": "resize", "rows": rows, "cols": cols})
	}
	if w, h, err := term.GetSize(fd); err == nil {
		report(h, w)
	}

	// Forward size changes of the local window.
	stop := watchResize(fd, report)
	defer stop()

	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			os.Stdout.Write(data)
		}
	}()

	// Feed input in. Ctrl-Q twice in a row detaches the terminal from the
	// session again — which keeps running.
	go func() {
		buf := make([]byte, 4096)
		last := time.Time{}
		for {
			n, err := os.Stdin.Read(buf)
			if err != nil {
				return
			}
			if n == 1 && buf[0] == 0x11 { // Strg-Q
				if time.Since(last) < time.Second {
					conn.Close()
					return
				}
				last = time.Now()
				continue
			}
			last = time.Time{}
			if write(map[string]any{"type": "in", "data": string(buf[:n])}) != nil {
				return
			}
		}
	}()

	<-done
	if old != nil {
		term.Restore(fd, old)
	}
	fmt.Printf("\r\n%sabgehängt — %s läuft weiter%s\r\n", dim, t.Name, reset)
	return nil
}

// Help describes the commands.
func Help() {
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
