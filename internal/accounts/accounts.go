// Package accounts manages several Claude Code accounts on one machine.
//
// Claude Code legt alles unter einem Konfigurationsverzeichnis ab — normal
// ~/.claude, redirectable via CLAUDE_CONFIG_DIR. Anyone with several accounts
// therefore starts with different directories. This package finds them.
package accounts

import (
	"encoding/json"
	"os"
	"path/filepath"
	"plxr/internal/daemon"
	"sort"
	"strings"
)

type Account struct {
	Name     string `json:"name"`  // Kennung, z.B. "claude2"
	Label    string `json:"label"` // Anzeigename
	Dir      string `json:"dir"`   // absolutes Konfigurationsverzeichnis
	Sessions int    `json:"sessions"`
}

// Env returns the environment variable that makes a process use this account.
// For the default directory nothing is set, so that Claude Code behaves exactly
// as it does when started by hand.
func (a Account) Env() []string {
	home, _ := os.UserHomeDir()
	if a.Dir == filepath.Join(home, ".claude") {
		return nil
	}
	return []string{"CLAUDE_CONFIG_DIR=" + a.Dir}
}

func (a Account) ProjectsDir() string { return filepath.Join(a.Dir, "projects") }

func configPath() string { return filepath.Join(daemon.Root(), "accounts.json") }

// Discover finds accounts: our own list first, otherwise ~/.claude and the
// durchnummerierten Geschwister daneben.
func Discover() []Account {
	if list, err := load(); err == nil && len(list) > 0 {
		return count(list)
	}

	home, _ := os.UserHomeDir()
	entries, _ := os.ReadDir(home)
	var out []Account
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		n := e.Name()
		// ".claude", ".claude2", ".claude3" — but nothing with a hyphen,
		// etwa Hilfsverzeichnisse anderer Werkzeuge.
		if !strings.HasPrefix(n, ".claude") || strings.Contains(n, "-") {
			continue
		}
		rest := strings.TrimPrefix(n, ".claude")
		if rest != "" && !isNumber(rest) {
			continue
		}
		dir := filepath.Join(home, n)
		if _, err := os.Stat(filepath.Join(dir, "projects")); err != nil {
			continue
		}
		label := "Konto 1"
		if rest != "" {
			label = "Konto " + rest
		}
		out = append(out, Account{Name: n[1:], Label: label, Dir: dir})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Dir < out[j].Dir })
	return count(out)
}

func isNumber(s string) bool {
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return len(s) > 0
}

// count counts the transcripts per account — only the top-level ones, not those
// of subagents and workflows.
func count(list []Account) []Account {
	for i := range list {
		n := 0
		dirs, _ := os.ReadDir(list[i].ProjectsDir())
		for _, d := range dirs {
			if !d.IsDir() {
				continue
			}
			files, _ := os.ReadDir(filepath.Join(list[i].ProjectsDir(), d.Name()))
			for _, f := range files {
				if !f.IsDir() && strings.HasSuffix(f.Name(), ".jsonl") {
					n++
				}
			}
		}
		list[i].Sessions = n
	}
	return list
}

func load() ([]Account, error) {
	b, err := os.ReadFile(configPath())
	if err != nil {
		return nil, err
	}
	var list []Account
	if err := json.Unmarshal(b, &list); err != nil {
		return nil, err
	}
	return list, nil
}

func Save(list []Account) error {
	if err := os.MkdirAll(filepath.Dir(configPath()), 0o755); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(list, "", "  ")
	return os.WriteFile(configPath(), b, 0o644)
}

// ByName looks up an account; with no match the first one comes back.
func ByName(list []Account, name string) (Account, bool) {
	for _, a := range list {
		if a.Name == name {
			return a, true
		}
	}
	if len(list) > 0 {
		return list[0], false
	}
	return Account{}, false
}
