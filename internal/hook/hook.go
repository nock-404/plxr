// Package hook records the state of a Claude Code session.
//
// On certain events Claude Code can call a program and hand it the payload as
// JSON on standard input. plxr hooks in there and writes a small file per
// session. That is the difference between "we guess from the screen contents"
// and "the session tells us": whether it is working, whether it is stuck on a
// question, which model is running and how full the context is — all of it known
// rather than estimated.
//
// It is invoked through `plxr hook` and installed through `plxr setup-hook`.
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

// StateDir is where the state files live.
func StateDir() string { return filepath.Join(daemon.Root(), "state") }

// Payload is the part of the hook message that we need.
type Payload struct {
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

// State is what plxr reads later on.
type State struct {
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

var validID = regexp.MustCompile(`^[\w-]+$`)

// Run reads a hook message and carries the state forward.
func Run(r *os.File) error {
	var v Payload
	if err := json.NewDecoder(r).Decode(&v); err != nil {
		return err
	}
	if v.SessionID == "" || !validID.MatchString(v.SessionID) {
		return errors.New("keine brauchbare Session-ID")
	}
	// Subagents have events of their own but are not sessions of their own.
	if v.AgentID != "" {
		return nil
	}

	if err := os.MkdirAll(StateDir(), 0o755); err != nil {
		return err
	}
	file := filepath.Join(StateDir(), v.SessionID+".json")

	if v.Event == "SessionEnd" {
		os.Remove(file)
		return nil
	}

	var old State
	if b, err := os.ReadFile(file); err == nil {
		json.Unmarshal(b, &old)
	}

	now := time.Now().UnixMilli()
	z := old
	z.SessionID = v.SessionID
	z.Activity = old.Activity
	z.Prompt = old.Prompt
	z.LastMessage = old.LastMessage

	switch v.Event {
	case "SessionStart":
		z.Status, z.Activity, z.LastMessage = "waiting", "gestartet", ""
	case "UserPromptSubmit":
		z.Status, z.Prompt, z.Activity, z.LastMessage = "working", trunc(v.Prompt, 100), "", ""
	case "PreToolUse":
		z.Status = "working"
		if a := describeTool(v.ToolName, v.ToolInput); a != "" {
			z.Activity = a
		}
	case "Notification":
		switch v.Notif {
		case "permission_prompt", "agent_needs_input":
			z.Status = "permission"
			if m := trunc(v.Message, 80); m != "" {
				z.Activity = m
			}
		case "idle_prompt":
			z.Status = "waiting"
		default:
			return nil
		}
	case "Stop":
		z.Status, z.Activity, z.LastMessage = "waiting", "", trunc(v.LastText, 120)
	default:
		return nil
	}

	if v.Cwd != "" {
		z.Cwd = v.Cwd
		z.Project = filepath.Base(v.Cwd)
	}
	fromTranscript(v.Transcript, &z)
	if p, tty := claudeProcess(); p > 0 {
		z.PID, z.TTY = p, tty
	}
	if z.StartedAt == 0 {
		z.StartedAt = now
	}
	if old.Status != z.Status || z.Since == 0 {
		z.Since = now
	}
	z.UpdatedAt = now

	b, err := json.Marshal(z)
	if err != nil {
		return err
	}
	tmp := fmt.Sprintf("%s.%d.tmp", file, os.Getpid())
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, file)
}

func trunc(s string, max int) string {
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

// describeTool describes in one line what the session is doing right now.
func describeTool(name string, in map[string]any) string {
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
		return trunc("Bash: "+b, 70)
	case "Edit", "Write", "Read", "NotebookEdit":
		return trunc(name+": "+filepath.Base(str(in, "file_path")), 70)
	case "Grep":
		return trunc("Grep: "+str(in, "pattern"), 70)
	case "Glob":
		return trunc("Glob: "+str(in, "pattern"), 70)
	case "Task", "Agent":
		return trunc("Agent: "+str(in, "description"), 70)
	case "Workflow":
		return trunc("Workflow: "+str(in, "name"), 70)
	case "WebFetch":
		return trunc("Fetch: "+str(in, "url"), 70)
	case "WebSearch":
		return trunc("Suche: "+str(in, "query"), 70)
	case "Skill":
		return trunc("Skill: "+str(in, "skill"), 70)
	}
	if rest, ok := strings.CutPrefix(name, "mcp__"); ok {
		return trunc(strings.ReplaceAll(rest, "__", ": "), 70)
	}
	return trunc(name, 70)
}

// fromTranscript pulls title, branch, model and context size.
//
// Only the end is read: that is where the current values are, and a transcript
// can be many megabytes — a hook that reads everything on every tool call would
// noticeably slow the session down.
func fromTranscript(path string, z *State) {
	if path == "" {
		return
	}
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return
	}
	const window = 512 << 10
	from := info.Size() - window
	if from < 0 {
		from = 0
	}
	if _, err := f.Seek(from, 0); err != nil {
		return
	}
	br := bufio.NewReader(f)
	if from > 0 {
		br.ReadString('\n') // angeschnittene Zeile verwerfen
	}

	sc := bufio.NewScanner(br)
	sc.Buffer(make([]byte, 0, 64*1024), 4<<20)
	var lines []string
	for sc.Scan() {
		lines = append(lines, sc.Text())
	}
	// From the back: the last values win.
	for i := len(lines) - 1; i >= 0; i-- {
		var e struct {
			Type      string `json:"type"`
			AiTitle   string `json:"aiTitle"`
			GitBranch string `json:"gitBranch"`
			Message   struct {
				Model string `json:"model"`
				Usage struct {
					Input      int `json:"input_tokens"`
					Output     int `json:"output_tokens"`
					CacheWrite int `json:"cache_creation_input_tokens"`
					CacheRead  int `json:"cache_read_input_tokens"`
				} `json:"usage"`
			} `json:"message"`
		}
		if json.Unmarshal([]byte(lines[i]), &e) != nil {
			continue
		}
		if e.Type == "ai-title" && e.AiTitle != "" && z.Title == "" {
			z.Title = trunc(e.AiTitle, 60)
		}
		if e.GitBranch != "" && e.GitBranch != "HEAD" && z.Branch == "" {
			z.Branch = e.GitBranch
		}
		if e.Type == "assistant" {
			u := e.Message.Usage
			if s := u.Input + u.Output + u.CacheWrite + u.CacheRead; s > 0 && z.Context == 0 {
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

// claudeProcess looks up the tree of parents for the Claude Code process.
//
// The hook runs as a grandchild of the session; walking its own chain of
// parents finds the actual process together with its terminal. plxr uses that to
// match the state to a running session later.
func claudeProcess() (int, string) {
	pid := os.Getppid()
	for depth := 0; depth < 6 && pid > 1; depth++ {
		out, err := exec.Command("ps", "-o", "ppid=,tty=,command=", "-p", fmt.Sprint(pid)).Output()
		if err != nil {
			return 0, ""
		}
		fields := strings.Fields(strings.TrimSpace(string(out)))
		if len(fields) < 3 {
			return 0, ""
		}
		cmdline := strings.Join(fields[2:], " ")
		if isClaude(cmdline) {
			tty := fields[1]
			if tty == "??" {
				return pid, ""
			}
			return pid, "/dev/" + tty
		}
		var parent int
		fmt.Sscan(fields[0], &parent)
		pid = parent
	}
	return 0, ""
}

func isClaude(cmdline string) bool {
	first := strings.Fields(cmdline)
	if len(first) == 0 {
		return false
	}
	return filepath.Base(first[0]) == "claude"
}
