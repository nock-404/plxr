// Package ptyhost startet Prozesse in einem Pseudo-Terminal, das dem Daemon
// gehört statt einem Terminalfenster. Damit überlebt die Session das Schließen
// des Fensters.
//
// Die PTY-Anbindung läuft über go-pty, weil das eine API für Unix-PTYs und
// Windows-ConPTY bietet. creack/pty kann kein Windows, und os/exec allein
// reicht dort nicht: ConPTY braucht ein Prozessattribut, das os/exec nicht
// setzen kann (golang/go#62708).
package ptyhost

import (
	"bytes"
	"os"
	"os/exec"
	"plxr/internal/shell"
	"strings"
	"sync"
	"time"

	"github.com/aymanbagabas/go-pty"
)

// Scrollback pro Session. Ältere Ausgabe fällt hinten raus.
const MaxBuf = 2 << 20

// Fassung wird beim Start gesetzt und landet in TERM_PROGRAM_VERSION.
var Fassung = "dev"

// erbtNicht wird unten ergänzt: TERM und Verwandte setzen wir selbst.

type Host struct {
	ID  string
	TTY string
	PID int

	pty pty.Pty
	cmd *pty.Cmd

	mu    sync.Mutex
	buf   []byte
	subs  map[chan []byte]struct{}
	alive bool
	exit  int
	last  time.Time // letzte Ausgabe — Grundlage der Ruhe-Heuristik

	// Zwischenspeicher für die gerenderte Vorschau, siehe tailLines.
	tailLen   int
	tailCache []string

	// plattform hält, was nur ein bestimmtes System braucht — unter Windows
	// etwa das Job Object, über das die ganze Prozessgruppe endet.
	plattform any

	Done chan struct{}
}

// Start hängt argv in ein frisches PTY. cwd ist das Arbeitsverzeichnis, env
// zusätzliche Umgebungsvariablen als "NAME=wert" — darüber läuft die Wahl des
// Claude-Kontos (CLAUDE_CONFIG_DIR).
func Start(id, cwd string, argv []string, env []string) (*Host, error) {
	if len(argv) == 0 {
		argv = shell.Standard()
	}

	p, err := pty.New()
	if err != nil {
		return nil, err
	}

	c := p.Command(argv[0], argv[1:]...)
	c.Dir = cwd
	c.Env = append(sauberesEnv(), shell.Umgebung(Fassung)...)
	c.Env = append(c.Env, "PLXR=1")
	c.Env = append(c.Env, env...)

	// Größe VOR dem Start setzen: ConPTY legt sich sonst auf 80x25 fest, und
	// das CLI zeichnet seinen ersten Frame in der falschen Geometrie.
	_ = p.Resize(140, 44) // Breite, Höhe

	if err := c.Start(); err != nil {
		p.Close()
		return nil, err
	}

	h := &Host{
		ID:    id,
		TTY:   p.Name(),
		pty:   p,
		cmd:   c,
		subs:  map[chan []byte]struct{}{},
		alive: true,
		last:  time.Now(),
		Done:  make(chan struct{}),
	}
	if c.Process != nil {
		h.PID = c.Process.Pid
		h.plattform = nachStart(c.Process)
	}
	go h.pump()
	return h, nil
}

// erbtNicht sind Variablen, die eine Claude-Code-Session an ihre Kindprozesse
// weitergibt. Wird plxr aus einer solchen Session heraus gestartet, landen sie
// über os.Environ() in jeder neuen Session — und CLAUDE_CODE_CHILD_SESSION
// schaltet dort das Speichern des Transkripts ab. Die Session läuft dann zwar,
// hinterlässt aber nichts, was sich später fortsetzen ließe.
var erbtNicht = []string{
	"CLAUDECODE",
	"CLAUDE_CODE_CHILD_SESSION",
	"CLAUDE_CODE_ENTRYPOINT",
	"CLAUDE_CODE_SSE_PORT",
	"CLAUDE_CODE_SIMPLE",
	"CLAUDE_CODE_SAFE_MODE",
	"CLAUDE_JOB_DIR",
	"CLAUDE_PLUGIN_ROOT",
	"CLAUDE_SESSION_ID",
	"CLAUDE_CONFIG_DIR", // wird bewusst je Session gesetzt, nicht geerbt
	"PLXR",
}

func sauberesEnv() []string {
	alle := os.Environ()
	out := make([]string, 0, len(alle))
	for _, kv := range alle {
		name, _, _ := strings.Cut(kv, "=")
		verwerfen := false
		for _, n := range erbtNicht {
			if name == n {
				verwerfen = true
				break
			}
		}
		if !verwerfen {
			out = append(out, kv)
		}
	}
	return out
}

func (h *Host) pump() {
	b := make([]byte, 32*1024)
	for {
		n, err := h.pty.Read(b)
		if n > 0 {
			chunk := make([]byte, n)
			copy(chunk, b[:n])
			h.mu.Lock()
			h.last = time.Now()
			h.buf = append(h.buf, chunk...)
			if len(h.buf) > MaxBuf {
				h.buf = h.buf[len(h.buf)-MaxBuf:]
			}
			for c := range h.subs {
				select {
				case c <- chunk:
				default: // langsamer Client verliert lieber Bytes als alle zu bremsen
				}
			}
			h.mu.Unlock()
		}
		if err != nil {
			break
		}
	}

	exit := 0
	if err := h.cmd.Wait(); err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			exit = ee.ExitCode()
		} else {
			exit = -1
		}
	}

	h.mu.Lock()
	h.alive, h.exit = false, exit
	for c := range h.subs {
		close(c)
		delete(h.subs, c)
	}
	h.mu.Unlock()
	h.pty.Close()
	close(h.Done)
}

func (h *Host) Alive() bool { h.mu.Lock(); defer h.mu.Unlock(); return h.alive }
func (h *Host) Exit() int   { h.mu.Lock(); defer h.mu.Unlock(); return h.exit }

// IdleFor sagt, wie lange nichts mehr aus dem PTY kam.
func (h *Host) IdleFor() time.Duration {
	h.mu.Lock()
	defer h.mu.Unlock()
	return time.Since(h.last)
}

// Snapshot liefert den kompletten Scrollback für einen neu verbundenen Client.
func (h *Host) Snapshot() []byte {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]byte, len(h.buf))
	copy(out, h.buf)
	return out
}

// tailWindow begrenzt, wie viel Rohpuffer die Vorschau anfasst.
//
// Ohne die Grenze rendert jeder Aufruf die vollen 2 MB Scrollback. Bei einer
// Handvoll Sessions und einem Tick pro Sekunde reicht das, um den Daemon auf
// über 300 % CPU zu treiben und die Oberfläche zum Stehen zu bringen.
const tailWindow = 48 << 10

// tailLines rendert das Ende des Puffers und merkt sich das Ergebnis, solange
// nichts Neues dazugekommen ist.
func (h *Host) tailLines() []string {
	h.mu.Lock()
	if h.tailCache != nil && h.tailLen == len(h.buf) {
		out := h.tailCache
		h.mu.Unlock()
		return out
	}
	bufLen := len(h.buf)
	raw := h.buf
	if len(raw) > tailWindow {
		raw = raw[len(raw)-tailWindow:]
		// Nicht mitten in einer Escape-Sequenz anfangen, sonst fehlt deren
		// Einleitung und die Reste landen sichtbar im Text. Ein Zeilenumbruch
		// allein reicht dafür nicht: Voll-Bildschirm-Oberflächen wie Claude
		// Code schreiben ganze Frames ohne einen einzigen. Deshalb hinter dem
		// letzten ESC einsteigen, das noch vor dem Fenster begann.
		if i := bytes.IndexByte(raw, '\n'); i >= 0 && i < 4096 {
			raw = raw[i+1:]
		} else if i := bytes.IndexByte(raw, 0x1b); i >= 0 && i < 4096 {
			raw = raw[i:]
		}
	}
	src := string(raw)
	h.mu.Unlock()

	// Rendern außerhalb des Locks — es ist der teure Teil.
	lines := renderPlain(src)
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}

	h.mu.Lock()
	h.tailLen, h.tailCache = bufLen, lines
	h.mu.Unlock()
	return lines
}

// Tail liefert die letzten n Zeilen als reinen Text — für die Kachelvorschau.
func (h *Host) Tail(n int) string {
	lines := h.tailLines()
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

func (h *Host) Subscribe() chan []byte {
	c := make(chan []byte, 64)
	h.mu.Lock()
	if !h.alive {
		h.mu.Unlock()
		close(c)
		return c
	}
	h.subs[c] = struct{}{}
	h.mu.Unlock()
	return c
}

func (h *Host) Unsubscribe(c chan []byte) {
	h.mu.Lock()
	if _, ok := h.subs[c]; ok {
		delete(h.subs, c)
		close(c)
	}
	h.mu.Unlock()
}

func (h *Host) Write(p []byte) (int, error) { return h.pty.Write(p) }

// Resize nimmt Zeilen und Spalten; go-pty erwartet die andere Reihenfolge.
func (h *Host) Resize(rows, cols uint16) error {
	return h.pty.Resize(int(cols), int(rows))
}

// Kill beendet den Prozess. Auf Unix die ganze Gruppe, damit von der Session
// gestartete Kindprozesse nicht verwaist weiterlaufen.
func (h *Host) Kill() {
	if h.cmd.Process == nil {
		return
	}
	killProcess(h.cmd.Process, h.plattform)
}
