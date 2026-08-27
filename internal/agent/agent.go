// Package agent detects which coding CLI runs in a session and derives the
// status from it.
//
// Claude Code can report its own state: `plxr setup-hook` hooks into its events,
// and after that the status is known rather than guessed. No other CLI has
// anything like it, so there the status is inferred from the screen contents and
// from how long the output has been quiet. Profiles are JSON (built in plus
// ~/.plxr/agents), so a new CLI needs no rebuild
// dazukommt.
package agent

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"plxr/internal/daemon"
	"regexp"
	"sort"
	"strings"
	"time"
)

type Profile struct {
	Name  string `json:"name"`
	Label string `json:"label"`
	// Source: "fleet" uses the reported state, "screen" infers from the
	// Bildschirmausgabe.
	Source string `json:"source"`
	// Match are substrings that have to match the command.
	Match []string `json:"match"`
	// Blocked recognises "waiting for a decision" in the visible text.
	Blocked []string `json:"blocked"`
	// Working erkennt "arbeitet gerade", z.B. einen Spinner.
	Working []string `json:"working"`
	// IdleSeconds: after this long without output, IdleStatus applies.
	IdleSeconds float64 `json:"idle_seconds"`
	// IdleStatus is the state while quiet. The default is "unknown", meaning
	// plainly "running": a dev server printing a line every few seconds is not
	// waiting for a person — it is simply doing its job.
	// Only tools that genuinely sit at an input prompt
	// bleiben, setzen hier "waiting".
	IdleStatus string `json:"idle_status"`

	blockedRe []*regexp.Regexp
	workingRe []*regexp.Regexp
}

func (p *Profile) compile() {
	p.blockedRe = compileAll(p.Blocked)
	p.workingRe = compileAll(p.Working)
	if p.IdleSeconds == 0 {
		p.IdleSeconds = 2
	}
	if p.IdleStatus == "" {
		p.IdleStatus = Unknown
	}
	if p.Label == "" {
		p.Label = p.Name
	}
}

func compileAll(pats []string) []*regexp.Regexp {
	out := make([]*regexp.Regexp, 0, len(pats))
	for _, s := range pats {
		if re, err := regexp.Compile("(?im)" + s); err == nil {
			out = append(out, re)
		}
	}
	return out
}

// Set is the loaded collection including the fallback profile.
type Set struct {
	profiles []Profile
	fallback Profile
}

func UserDir() string { return filepath.Join(daemon.Root(), "agents") }

func Load(builtin fs.FS) *Set {
	byName := map[string]Profile{}
	add := func(b []byte) {
		var p Profile
		if json.Unmarshal(b, &p) != nil || strings.TrimSpace(p.Name) == "" {
			return
		}
		p.compile()
		byName[p.Name] = p
	}
	if builtin != nil {
		fs.WalkDir(builtin, ".", func(path string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(path, ".json") {
				return nil
			}
			if b, e := fs.ReadFile(builtin, path); e == nil {
				add(b)
			}
			return nil
		})
	}
	paths, _ := filepath.Glob(filepath.Join(UserDir(), "*.json"))
	for _, p := range paths {
		if b, err := os.ReadFile(p); err == nil {
			add(b)
		}
	}

	s := &Set{}
	for _, p := range byName {
		if p.Name == "generic" {
			s.fallback = p
			continue
		}
		s.profiles = append(s.profiles, p)
	}
	sort.Slice(s.profiles, func(i, j int) bool { return s.profiles[i].Name < s.profiles[j].Name })
	if s.fallback.Name == "" {
		s.fallback = Profile{Name: "generic", Label: "Unbekannt", Source: "screen"}
		s.fallback.compile()
	}
	return s
}

func (s *Set) All() []Profile { return append([]Profile{s.fallback}, s.profiles...) }

// Match finds the profile for the command that was started.
func (s *Set) Match(argv []string) Profile {
	if len(argv) == 0 {
		return s.fallback
	}
	hay := strings.ToLower(filepath.Base(argv[0]) + " " + strings.Join(argv[1:], " "))
	for _, p := range s.profiles {
		for _, m := range p.Match {
			if m != "" && strings.Contains(hay, strings.ToLower(m)) {
				return p
			}
		}
	}
	return s.fallback
}

// Status is deliberately the same set the fleet hook writes.
const (
	Working    = "working"
	Waiting    = "waiting"
	Permission = "permission"
	Unknown    = "unknown"
)

// Classify derives the status from the visible text and from output quiet time.
// Order matters: a pending question beats everything, then a spinner, then
// entscheidet, wie lange nichts mehr kam.
func (p *Profile) Classify(screen string, idle time.Duration) string {
	tail := lastLines(screen, 12)

	/* A question only blocks while it is the last thing on screen: if there is
	   output below it, it has been answered. Searching across twelve lines left a
	   settled question standing as "needs you" forever — the inbox showed sessions
	   that had long moved on. Three lines are enough for multi-line dialog boxes
	   too: their choices always sit at the bottom. */
	unten := lastNonEmptyLines(screen, 3)
	amPrompt := waitingAtPrompt(screen)
	for _, re := range p.blockedRe {
		// Either the question sits right at the bottom — then it is open — or the
		// screen ends on a prompt waiting for input. The second case catches
		// "question / list of choices / input>", where the question text sits a
		// few lines above the cursor.
		if re.MatchString(unten) || (amPrompt && re.MatchString(tail)) {
			return Permission
		}
	}
	for _, re := range p.workingRe {
		if re.MatchString(tail) {
			return Working
		}
	}
	if idle.Seconds() >= p.IdleSeconds {
		return p.IdleStatus
	}
	return Working
}

// waitingAtPrompt reports whether the screen ends on an input prompt: a short
// line running out into a prompt character with nothing behind it. That is
// exactly where the cursor then sits.
func waitingAtPrompt(screen string) bool {
	last := lastNonEmptyLines(screen, 1)
	if last == "" || len(last) > 120 {
		return false
	}
	ohne := strings.TrimRight(last, " \t")
	if ohne == "" {
		return false
	}
	// Deliberately without '$', '#' and '%': those are shell prompts. A shell
	// sitting there is indeed waiting for input, but that is its normal state
	// and not a question — otherwise the inbox would report every quiet shell.
	switch ohne[len(ohne)-1] {
	case '>', ':', '?':
		return true
	}
	return false
}

// lastNonEmptyLines returns the last n lines with content. Trailing blank lines
// are dropped — otherwise a line break would push the question out of the
// window even though it is still open.
func lastNonEmptyLines(s string, n int) string {
	lines := strings.Split(s, "\n")
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

func lastLines(s string, n int) string {
	lines := strings.Split(s, "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}
