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
	// The directory this Claude keeps its things in — which is to say, the
	// account it is really signed in as. Only the hook can know it; see the
	// note in internal/hook.
	ConfigDir string `json:"config_dir,omitempty"`
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

/*
Read reads every known directory, one entry per session: the more recent

	writing wins, except where it knows less than the older one.

	The exception is the whole point. Both directories may hold a file for the
	same session — plxr's hook writes one, the older standalone tool writes
	another — and only plxr's carries the config directory, because only a hook
	running inside the CLI can see it. The two are written milliseconds apart in
	whichever order, and taking the newer one wholesale meant a session whose
	account was known one moment was anonymous the next. That is what put the
	wrong account over a terminal: the reading was right, then a blind entry
	landed 67 milliseconds later and erased it.

	So an empty config directory is read as "this writer does not know", never
	as "there is no account", and the answer carries over. Nothing else is
	carried: a title, a last message or a branch that has become empty has
	genuinely become empty, and holding on to those would show work that is no
	longer there.
*/
func Read(_ string) []State {
	var paths []string
	for _, d := range Dirs() {
		p, _ := filepath.Glob(filepath.Join(d, "*.json"))
		paths = append(paths, p...)
	}
	seen := map[string]State{}
	order := []string{}
	for _, p := range paths {
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		var s State
		if json.Unmarshal(b, &s) != nil || s.SessionID == "" {
			continue
		}
		old, had := seen[s.SessionID]
		if !had {
			seen[s.SessionID] = s
			order = append(order, s.SessionID)
			continue
		}
		newer, older := s, old
		if older.UpdatedAt > newer.UpdatedAt {
			newer, older = older, newer
		}
		if newer.ConfigDir == "" {
			newer.ConfigDir = older.ConfigDir
		}
		seen[s.SessionID] = newer
	}
	out := make([]State, 0, len(order))
	for _, id := range order {
		out = append(out, seen[id])
	}
	return out
}
