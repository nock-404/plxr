// Package fleet liest den Zustand, den der plxr-Hook je Session ablegt.
// Dadurch muss plxr den Status nicht aus der Terminalausgabe raten.
package fleet

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

type State struct {
	SessionID      string `json:"session_id"`
	Project        string `json:"project"`
	Cwd            string `json:"cwd"`
	Title          string `json:"title"`
	Status         string `json:"status"`
	Activity       string `json:"activity"`
	Prompt         string `json:"prompt"`
	LastMessage    string `json:"last_message"`
	Model          string `json:"model"`
	Effort         string `json:"effort"`
	PermissionMode string `json:"permission_mode"`
	Branch         string `json:"branch"`
	Context        int    `json:"context"`
	PID            int    `json:"pid"`
	TTY            string `json:"tty"`
	StartedAt      int64  `json:"started_at"`
	Since          int64  `json:"since"`
	UpdatedAt      int64  `json:"updated_at"`
}

// Dirs sind die Verzeichnisse, in denen Zustandsdateien liegen können.
//
// Zuerst das eigene: dort schreibt `plxr hook`. Das zweite ist ein Zugeständnis
// an eine ältere, eigenständige Fassung derselben Idee — wer die noch laufen
// hat, soll nichts umstellen müssen.
func Dirs() []string {
	home, _ := os.UserHomeDir()
	return []string{
		filepath.Join(home, ".plxr", "state"),
		filepath.Join(home, ".claude-fleet", "sessions"),
	}
}

// Dir ist das Verzeichnis, in das plxr selbst schreibt.
func Dir() string { return Dirs()[0] }

// Watch pollt das Verzeichnis. Gepollt statt fsnotify, weil der Hook atomar
// über tmp+rename schreibt — da sind Rename-Events die unzuverlässigere Quelle.
func Watch(dir string, every time.Duration, fn func([]State)) {
	for {
		fn(Read(dir))
		time.Sleep(every)
	}
}

// Read liest alle bekannten Verzeichnisse. Liegt dieselbe Session mehrfach
// vor, gewinnt der jüngere Eintrag.
func Read(_ string) []State {
	var paths []string
	for _, d := range Dirs() {
		p, _ := filepath.Glob(filepath.Join(d, "*.json"))
		paths = append(paths, p...)
	}
	out := make([]State, 0, len(paths))
	for _, p := range paths {
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		var s State
		if json.Unmarshal(b, &s) != nil || s.SessionID == "" {
			continue
		}
		out = append(out, s)
	}
	return out
}
