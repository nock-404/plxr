// Package session holds the data model of a session and the on-disk registry.
package session

type Status string

const (
	StatusWorking    Status = "working"    // Agent arbeitet
	StatusWaiting    Status = "waiting"    // agent is waiting for input
	StatusPermission Status = "permission" // agent is stuck on a question
	StatusDead       Status = "dead"       // Prozess beendet
	StatusUnknown    Status = "unknown"    // running, but reporting nothing
)

// Blocking reports whether this status needs a person.
func (s Status) Blocking() bool {
	return s == StatusPermission || s == StatusWaiting
}

// Session is a process held by plxr. The upper fields are ours; the lower ones
// the session reports about itself through the hook, matched up by PID.
type Session struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Cwd       string   `json:"cwd"`
	Cmd       []string `json:"cmd"`
	PID       int      `json:"pid"`
	TTY       string   `json:"tty"`
	StartedAt int64    `json:"started_at"`
	Alive     bool     `json:"alive"`
	ExitCode  int      `json:"exit_code"`
	// EndedAt is when the process ended. The session stays visible for a short
	// while after that and is then dropped.
	EndedAt int64 `json:"ended_at,omitempty"`
	// Orphaned means: the daemon died and took the session with it. Unlike a
	// normal exit this is not something anyone wanted — so the entry stays
	// until it has been seen.
	Orphaned bool `json:"verwaist,omitempty"`

	Account         string `json:"account,omitempty"`     // Claude account it runs under
	Agent           string `json:"agent,omitempty"`       // erkanntes CLI, z.B. "claude"
	AgentLabel      string `json:"agent_label,omitempty"` // Anzeigename dazu
	ClaudeSessionID string `json:"claude_session_id,omitempty"`
	Status          Status `json:"status"`
	Title           string `json:"title,omitempty"`
	Activity        string `json:"activity,omitempty"`
	Project         string `json:"project,omitempty"`
	Branch          string `json:"branch,omitempty"`
	Model           string `json:"model,omitempty"`
	Effort          string `json:"effort,omitempty"`
	Context         int    `json:"context,omitempty"`
	LastMessage     string `json:"last_message,omitempty"`
	Since           int64  `json:"since,omitempty"`
}

// Label is what the tile shows at the top.
func (s *Session) Label() string {
	if s.Title != "" {
		return s.Title
	}
	if s.Name != "" {
		return s.Name
	}
	return s.ID[:8]
}
