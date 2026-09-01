package notify

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	"plxr/internal/daemon"
)

/* What to say something about, and how.

   The daemon decides when to notify, so the decision has to live where the
   daemon can read it — not in a window that may be closed at the moment it
   matters. It sits with the rest of the state, next to the queue and the
   sessions.
*/

// When says which changes are worth interrupting somebody for.
type When struct {
	// NeedsYou: an agent has asked a question and cannot go on. This is the one
	// that is on by default — it is the only state where nothing happens until
	// a person acts.
	NeedsYou bool `json:"needsYou"`
	// Waiting: an agent has stopped and is idle without asking.
	Waiting bool `json:"waiting"`
	// Ended: a session finished or its process died.
	Ended bool `json:"ended"`
	// Crashed: the daemon died and took a session with it.
	Crashed bool `json:"crashed"`
}

// Settings is the whole of it.
type Settings struct {
	On    bool   `json:"on"`
	Sound string `json:"sound"` // a name from Sounds(), or "" for silence
	When  When   `json:"when"`
}

// Default: say something when an agent is stuck, and nothing else. Everything
// beyond that is a choice somebody has to make on purpose — a notification for
// every ending session is a notification nobody reads.
func Default() Settings {
	return Settings{On: true, Sound: defaultSound(), When: When{NeedsYou: true}}
}

var settingsLock sync.Mutex

func settingsPath() string { return filepath.Join(daemon.Root(), "notify.json") }

// Read never fails: nothing stored is a normal state and means the defaults.
func Read() Settings {
	settingsLock.Lock()
	defer settingsLock.Unlock()
	b, err := os.ReadFile(settingsPath())
	if err != nil {
		return Default()
	}
	out := Default()
	if json.Unmarshal(b, &out) != nil {
		return Default()
	}
	return out
}

func Write(s Settings) error {
	settingsLock.Lock()
	defer settingsLock.Unlock()
	if err := os.MkdirAll(daemon.Root(), 0o755); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(s, "", "  ")
	tmp := settingsPath() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, settingsPath())
}

// Wanted reports whether this change is one somebody asked to hear about.
func (s Settings) Wanted(state string) bool {
	if !s.On {
		return false
	}
	switch state {
	case "permission":
		return s.When.NeedsYou
	case "waiting":
		return s.When.Waiting
	case "dead":
		return s.When.Ended
	case "orphaned":
		return s.When.Crashed
	}
	return false
}
