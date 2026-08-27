// Package fleet reads the state that the plxr hook writes out per session.
// That saves plxr from guessing the status out of the terminal output.
package fleet

import (
	"encoding/json"
	"os"
	"path/filepath"
	"plxr/internal/daemon"
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

// Dirs are the directories that may hold state files.
//
// Ours comes first: that is where `plxr hook` writes. The second is a
// concession to an older, standalone take on the same idea — anyone still
// running it should not have to change anything.
func Dirs() []string {
	home, _ := os.UserHomeDir()
	return []string{
		filepath.Join(daemon.Root(), "state"),
		filepath.Join(home, ".claude-fleet", "sessions"),
	}
}

// Dir is the directory plxr itself writes to.
func Dir() string { return Dirs()[0] }

// Watch polls the directory. Polling rather than fsnotify, because the hook
// writes atomically via tmp+rename — rename events are the less reliable
// signal there.
func Watch(dir string, every time.Duration, fn func([]State)) {
	for {
		fn(Read(dir))
		time.Sleep(every)
	}
}

// Read liest alle bekannten Verzeichnisse. Liegt dieselbe Session mehrfach
// twice, the more recent entry wins.
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
