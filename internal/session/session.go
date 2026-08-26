// Package session hält das Datenmodell einer Session und die Registry auf Platte.
package session

type Status string

const (
	StatusWorking    Status = "working"    // Agent arbeitet
	StatusWaiting    Status = "waiting"    // Agent wartet auf eine Eingabe
	StatusPermission Status = "permission" // Agent hängt an einer Rückfrage
	StatusDead       Status = "dead"       // Prozess beendet
	StatusUnknown    Status = "unknown"    // läuft, meldet aber nichts
)

// Blocking sagt, ob dieser Status den Menschen braucht.
func (s Status) Blocking() bool {
	return s == StatusPermission || s == StatusWaiting
}

// Session ist ein von plxr gehaltener Prozess. Die oberen Felder gehören uns,
// die unteren meldet die Session selbst über den Hook, zugeordnet über die PID.
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
	// EndedAt ist, wann der Prozess endete. Danach wird die Session noch kurz
	// angezeigt und dann verworfen.
	EndedAt int64 `json:"ended_at,omitempty"`

	Account         string `json:"account,omitempty"`     // Claude-Konto, unter dem sie läuft
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

// Label ist das, was in der Kachel oben steht.
func (s *Session) Label() string {
	if s.Title != "" {
		return s.Title
	}
	if s.Name != "" {
		return s.Name
	}
	return s.ID[:8]
}
