// Package accounts manages several Claude Code accounts on one machine.
//
// Claude Code keeps everything under one config directory — normally
// ~/.claude, redirectable via CLAUDE_CONFIG_DIR. Anyone with several accounts
// therefore starts with different directories. This package finds them.
package accounts

import (
	"encoding/json"
	"os"
	"path/filepath"
	"plxr/internal/daemon"
	"plxr/internal/uierr"
	"sort"
	"strconv"
	"strings"
)

type Account struct {
	Name string `json:"name"` // identifier, e.g. "claude2"
	// Number is what the interface builds its label from. The label itself used
	// to be assembled here — account 1 — which put German into the backend and
	// left the English interface saying it too.
	Number int    `json:"number"`
	Dir    string `json:"dir"` // absolute configuration directory
	// Label is what somebody called it. Separate from Name, which is the
	// identity: sessions are recorded against the name, so renaming what is
	// shown must not rename what they point at.
	Label string `json:"label,omitempty"`
	// Short is Dir with the home directory written as ~. Only for reading: the
	// window shows it instead of the full path, which is otherwise so long that
	// three accounts all read "/Users/matthiasgiesse…" and tell nobody apart.
	Short    string `json:"short"`
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
// numbered siblings beside it.
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
		// ".claude", ".claude2", ".claude3" — but nothing with a hyphen, which is
		// how other tools name their helper directories.
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
		number := 1
		if rest != "" {
			number, _ = strconv.Atoi(rest)
		}
		out = append(out, Account{Name: n[1:], Number: number, Dir: dir})
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
	home, _ := os.UserHomeDir()
	for i := range list {
		list[i].Short = list[i].Dir
		if home != "" && strings.HasPrefix(list[i].Dir, home+string(filepath.Separator)) {
			list[i].Short = "~" + list[i].Dir[len(home):]
		}
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

/* Adding, renaming and letting go of accounts.
 *
 * Until now the list could only be looked at: it was worked out from the
 * directories that happened to be beside ~/.claude and there was no way to add
 * one, call it something, or take one out of the list again. Anybody with a
 * second account had to create the directory by hand and hope plxr noticed.
 *
 * Removing takes an account out of the list and leaves its directory alone. It
 * holds every transcript that account ever made, and a list is not the place to
 * decide that they should go.
 */

// Add takes a directory into the list. The directory is made if it is not there
// yet, along with the projects folder inside it, because a configuration
// directory without one is not one Claude Code will use.
func Add(dir, label string) ([]Account, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return nil, uierr.New("err.account.noDir")
	}
	// "~/.claude4" is what somebody types, and it is not an absolute path. Left
	// alone it was joined onto the home directory as a literal tilde, so the
	// account pointed at ~/~/.claude4 and the refusal it produced named the
	// wrong thing.
	if strings.HasPrefix(dir, "~") {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, err
		}
		dir = home + dir[1:]
	}
	if !filepath.IsAbs(dir) {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, err
		}
		dir = filepath.Join(home, dir)
	}
	dir = filepath.Clean(dir)

	list := Discover()
	for _, a := range list {
		if a.Dir == dir {
			return nil, uierr.With("err.account.exists", dir)
		}
	}
	// Both refusals come before anything is created. The other way round, a
	// name that is already taken left a directory behind that nobody asked for.
	name := strings.TrimPrefix(filepath.Base(dir), ".")
	for _, a := range list {
		if a.Name == name {
			return nil, uierr.With("err.account.exists", a.Dir)
		}
	}
	if err := os.MkdirAll(filepath.Join(dir, "projects"), 0o755); err != nil {
		return nil, uierr.With("err.account.notCreated", err.Error())
	}

	list = append(list, Account{
		Name:   name,
		Number: len(list) + 1,
		Dir:    dir,
		Label:  strings.TrimSpace(label),
	})
	if err := Save(list); err != nil {
		return nil, err
	}
	return count(list), nil
}

// Rename changes what an account is called on screen. What it is called
// underneath does not move: sessions are recorded against that.
func Rename(name, label string) ([]Account, error) {
	list := Discover()
	found := false
	for i := range list {
		if list[i].Name == name {
			list[i].Label = strings.TrimSpace(label)
			found = true
		}
	}
	if !found {
		return nil, uierr.With("err.account.unknown", name)
	}
	if err := Save(list); err != nil {
		return nil, err
	}
	return count(list), nil
}

// Remove takes an account out of the list. Its directory stays where it is,
// with everything in it.
func Remove(name string) ([]Account, error) {
	list := Discover()
	out := make([]Account, 0, len(list))
	for _, a := range list {
		if a.Name != name {
			out = append(out, a)
		}
	}
	if len(out) == len(list) {
		return nil, uierr.With("err.account.unknown", name)
	}
	if len(out) == 0 {
		return nil, uierr.New("err.account.lastOne")
	}
	for i := range out {
		out[i].Number = i + 1
	}
	if err := Save(out); err != nil {
		return nil, err
	}
	return count(out), nil
}
