// Package agent erkennt, welches Coding-CLI in einer Session läuft, und leitet
// daraus den Status ab.
//
// Claude Code kann seinen Zustand selbst melden: `plxr setup-hook` klinkt sich
// in dessen Ereignisse ein, und der Status steht danach fest statt geraten.
// Jedes andere CLI hat so etwas nicht, deshalb wird dort aus dem
// Bildschirminhalt und der Ausgabe-Ruhe geschlossen. Profile liegen als JSON
// vor (eingebaut plus ~/.plxr/agents), damit ein neues CLI ohne Neubau
// dazukommt.
package agent

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

type Profile struct {
	Name  string `json:"name"`
	Label string `json:"label"`
	// Source: "fleet" nutzt den gemeldeten Zustand, "screen" schließt aus der
	// Bildschirmausgabe.
	Source string `json:"source"`
	// Match sind Teilstrings, die auf das Kommando passen müssen.
	Match []string `json:"match"`
	// Blocked erkennt "wartet auf eine Entscheidung" im sichtbaren Text.
	Blocked []string `json:"blocked"`
	// Working erkennt "arbeitet gerade", z.B. einen Spinner.
	Working []string `json:"working"`
	// IdleSeconds: so lange keine Ausgabe, dann gilt IdleStatus.
	IdleSeconds float64 `json:"idle_seconds"`
	// IdleStatus ist der Zustand bei Ruhe. Voreinstellung ist "unknown", also
	// schlicht "läuft": ein Dev-Server, der alle paar Sekunden eine Zeile
	// ausgibt, wartet nicht auf den Menschen — er tut einfach seine Arbeit.
	// Nur Werkzeuge, die tatsächlich an einer Eingabeaufforderung stehen
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

// Set ist die geladene Sammlung inklusive Rückfallprofil.
type Set struct {
	profiles []Profile
	fallback Profile
}

func UserDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".plxr", "agents")
}

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

// Match sucht das Profil zum gestarteten Kommando.
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

// Status ist bewusst dieselbe Menge, die auch der fleet-Hook schreibt.
const (
	Working    = "working"
	Waiting    = "waiting"
	Permission = "permission"
	Unknown    = "unknown"
)

// Classify leitet den Status aus dem sichtbaren Text und der Ausgabe-Ruhe ab.
// Reihenfolge zählt: eine Rückfrage schlägt alles, danach ein Spinner, dann
// entscheidet, wie lange nichts mehr kam.
func (p *Profile) Classify(screen string, idle time.Duration) string {
	tail := lastLines(screen, 12)
	for _, re := range p.blockedRe {
		if re.MatchString(tail) {
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

func lastLines(s string, n int) string {
	lines := strings.Split(s, "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}
