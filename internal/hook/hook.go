// Package hook schreibt den Zustand einer Claude-Code-Session mit.
//
// Claude Code kann bei bestimmten Ereignissen ein Programm aufrufen und ihm
// den Vorgang als JSON auf die Standardeingabe legen. plxr klinkt sich dort
// ein und legt je Session eine kleine Datei ab. Das ist der Unterschied
// zwischen "wir raten aus dem Bildschirminhalt" und "die Session sagt es uns":
// ob sie arbeitet, ob sie an einer Rückfrage hängt, welches Modell läuft und
// wie voll der Kontext ist, steht dann fest statt geschätzt.
//
// Aufgerufen wird das über `plxr hook`, eingerichtet über `plxr setup-hook`.
package hook

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"plxr/internal/daemon"
	"regexp"
	"strings"
	"time"
)

// StateDir ist, wo die Zustandsdateien liegen.
func StateDir() string { return filepath.Join(daemon.Root(), "state") }

// Vorgang ist der Teil der Hook-Nachricht, den wir brauchen.
type Vorgang struct {
	SessionID  string         `json:"session_id"`
	Event      string         `json:"hook_event_name"`
	Cwd        string         `json:"cwd"`
	Transcript string         `json:"transcript_path"`
	Prompt     string         `json:"prompt"`
	ToolName   string         `json:"tool_name"`
	ToolInput  map[string]any `json:"tool_input"`
	Notif      string         `json:"notification_type"`
	Message    string         `json:"message"`
	LastText   string         `json:"last_assistant_message"`
	AgentID    string         `json:"agent_id"`
	Permission string         `json:"permission_mode"`
}

// Zustand ist, was plxr später liest.
type Zustand struct {
	SessionID   string `json:"session_id"`
	Project     string `json:"project"`
	Cwd         string `json:"cwd"`
	Title       string `json:"title"`
	Status      string `json:"status"`
	Activity    string `json:"activity"`
	Prompt      string `json:"prompt"`
	LastMessage string `json:"last_message"`
	Model       string `json:"model"`
	Effort      string `json:"effort"`
	Branch      string `json:"branch"`
	Context     int    `json:"context"`
	PID         int    `json:"pid"`
	TTY         string `json:"tty"`
	StartedAt   int64  `json:"started_at"`
	Since       int64  `json:"since"`
	UpdatedAt   int64  `json:"updated_at"`
}

var erlaubteID = regexp.MustCompile(`^[\w-]+$`)

// Lauf liest eine Hook-Nachricht und schreibt den Zustand fort.
func Lauf(r *os.File) error {
	var v Vorgang
	if err := json.NewDecoder(r).Decode(&v); err != nil {
		return err
	}
	if v.SessionID == "" || !erlaubteID.MatchString(v.SessionID) {
		return errors.New("keine brauchbare Session-ID")
	}
	// Unteragenten haben eigene Vorgänge, sind aber keine eigenen Sessions.
	if v.AgentID != "" {
		return nil
	}

	if err := os.MkdirAll(StateDir(), 0o755); err != nil {
		return err
	}
	datei := filepath.Join(StateDir(), v.SessionID+".json")

	if v.Event == "SessionEnd" {
		os.Remove(datei)
		return nil
	}

	var alt Zustand
	if b, err := os.ReadFile(datei); err == nil {
		json.Unmarshal(b, &alt)
	}

	jetzt := time.Now().UnixMilli()
	z := alt
	z.SessionID = v.SessionID
	z.Activity = alt.Activity
	z.Prompt = alt.Prompt
	z.LastMessage = alt.LastMessage

	switch v.Event {
	case "SessionStart":
		z.Status, z.Activity, z.LastMessage = "waiting", "gestartet", ""
	case "UserPromptSubmit":
		z.Status, z.Prompt, z.Activity, z.LastMessage = "working", kurz(v.Prompt, 100), "", ""
	case "PreToolUse":
		z.Status = "working"
		if a := werkzeug(v.ToolName, v.ToolInput); a != "" {
			z.Activity = a
		}
	case "Notification":
		switch v.Notif {
		case "permission_prompt", "agent_needs_input":
			z.Status = "permission"
			if m := kurz(v.Message, 80); m != "" {
				z.Activity = m
			}
		case "idle_prompt":
			z.Status = "waiting"
		default:
			return nil
		}
	case "Stop":
		z.Status, z.Activity, z.LastMessage = "waiting", "", kurz(v.LastText, 120)
	default:
		return nil
	}

	if v.Cwd != "" {
		z.Cwd = v.Cwd
		z.Project = filepath.Base(v.Cwd)
	}
	ausTranskript(v.Transcript, &z)
	if p, tty := claudeProzess(); p > 0 {
		z.PID, z.TTY = p, tty
	}
	if z.StartedAt == 0 {
		z.StartedAt = jetzt
	}
	if alt.Status != z.Status || z.Since == 0 {
		z.Since = jetzt
	}
	z.UpdatedAt = jetzt

	b, err := json.Marshal(z)
	if err != nil {
		return err
	}
	tmp := fmt.Sprintf("%s.%d.tmp", datei, os.Getpid())
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, datei)
}

func kurz(s string, max int) string {
	s = strings.Join(strings.Fields(s), " ")
	if s == "" {
		return ""
	}
	r := []rune(s)
	if len(r) > max {
		return string(r[:max-1]) + "…"
	}
	return s
}

func str(m map[string]any, k string) string {
	if v, ok := m[k].(string); ok {
		return v
	}
	return ""
}

// werkzeug beschreibt in einer Zeile, was die Session gerade tut.
func werkzeug(name string, in map[string]any) string {
	if name == "" {
		return ""
	}
	if in == nil {
		in = map[string]any{}
	}
	switch name {
	case "Bash":
		b := str(in, "description")
		if b == "" {
			b = strings.SplitN(str(in, "command"), "\n", 2)[0]
		}
		return kurz("Bash: "+b, 70)
	case "Edit", "Write", "Read", "NotebookEdit":
		return kurz(name+": "+filepath.Base(str(in, "file_path")), 70)
	case "Grep":
		return kurz("Grep: "+str(in, "pattern"), 70)
	case "Glob":
		return kurz("Glob: "+str(in, "pattern"), 70)
	case "Task", "Agent":
		return kurz("Agent: "+str(in, "description"), 70)
	case "Workflow":
		return kurz("Workflow: "+str(in, "name"), 70)
	case "WebFetch":
		return kurz("Fetch: "+str(in, "url"), 70)
	case "WebSearch":
		return kurz("Suche: "+str(in, "query"), 70)
	case "Skill":
		return kurz("Skill: "+str(in, "skill"), 70)
	}
	if rest, ok := strings.CutPrefix(name, "mcp__"); ok {
		return kurz(strings.ReplaceAll(rest, "__", ": "), 70)
	}
	return kurz(name, 70)
}

// ausTranskript holt Titel, Branch, Modell und Kontextgröße.
//
// Gelesen wird nur das Ende: dort stehen die jeweils aktuellen Werte, und ein
// Transkript kann viele Megabyte groß sein — ein Hook, der bei jedem
// Werkzeugaufruf alles liest, würde die Session spürbar bremsen.
func ausTranskript(pfad string, z *Zustand) {
	if pfad == "" {
		return
	}
	f, err := os.Open(pfad)
	if err != nil {
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return
	}
	const fenster = 512 << 10
	von := info.Size() - fenster
	if von < 0 {
		von = 0
	}
	if _, err := f.Seek(von, 0); err != nil {
		return
	}
	br := bufio.NewReader(f)
	if von > 0 {
		br.ReadString('\n') // angeschnittene Zeile verwerfen
	}

	sc := bufio.NewScanner(br)
	sc.Buffer(make([]byte, 0, 64*1024), 4<<20)
	var zeilen []string
	for sc.Scan() {
		zeilen = append(zeilen, sc.Text())
	}
	// Von hinten: die letzten Werte gelten.
	for i := len(zeilen) - 1; i >= 0; i-- {
		var e struct {
			Type      string `json:"type"`
			AiTitle   string `json:"aiTitle"`
			GitBranch string `json:"gitBranch"`
			Message   struct {
				Model string `json:"model"`
				Usage struct {
					Input      int `json:"input_tokens"`
					Output     int `json:"output_tokens"`
					CacheNeu   int `json:"cache_creation_input_tokens"`
					CacheLesen int `json:"cache_read_input_tokens"`
				} `json:"usage"`
			} `json:"message"`
		}
		if json.Unmarshal([]byte(zeilen[i]), &e) != nil {
			continue
		}
		if e.Type == "ai-title" && e.AiTitle != "" && z.Title == "" {
			z.Title = kurz(e.AiTitle, 60)
		}
		if e.GitBranch != "" && e.GitBranch != "HEAD" && z.Branch == "" {
			z.Branch = e.GitBranch
		}
		if e.Type == "assistant" {
			u := e.Message.Usage
			if s := u.Input + u.Output + u.CacheNeu + u.CacheLesen; s > 0 && z.Context == 0 {
				z.Context = s
			}
			if m := e.Message.Model; m != "" && m != "<synthetic>" && z.Model == "" {
				z.Model = m
			}
		}
		if z.Title != "" && z.Branch != "" && z.Model != "" && z.Context != 0 {
			break
		}
	}
}

// claudeProzess sucht im Elternbaum den Claude-Code-Prozess.
//
// Der Hook läuft als Enkel der Session; über die eigene Elternkette findet
// sich der eigentliche Prozess samt Terminal. Darüber ordnet plxr den Zustand
// später einer laufenden Session zu.
func claudeProzess() (int, string) {
	pid := os.Getppid()
	for tiefe := 0; tiefe < 6 && pid > 1; tiefe++ {
		out, err := exec.Command("ps", "-o", "ppid=,tty=,command=", "-p", fmt.Sprint(pid)).Output()
		if err != nil {
			return 0, ""
		}
		felder := strings.Fields(strings.TrimSpace(string(out)))
		if len(felder) < 3 {
			return 0, ""
		}
		befehl := strings.Join(felder[2:], " ")
		if istClaude(befehl) {
			tty := felder[1]
			if tty == "??" {
				return pid, ""
			}
			return pid, "/dev/" + tty
		}
		var eltern int
		fmt.Sscan(felder[0], &eltern)
		pid = eltern
	}
	return 0, ""
}

func istClaude(befehl string) bool {
	erst := strings.Fields(befehl)
	if len(erst) == 0 {
		return false
	}
	return filepath.Base(erst[0]) == "claude"
}
