// Package template starts several sessions at once.
//
// The daily routine: three windows in three directories under three different
// accounts. That is the same set of motions every morning — a template turns
// it into one click.
//
// Templates are JSON files under ~/.plxr/templates and can be built from the
// running state: whatever is open right now becomes the template.
package template

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type Entry struct {
	Cwd     string   `json:"cwd"`
	Cmd     []string `json:"cmd,omitempty"`
	Name    string   `json:"name,omitempty"`
	Account string   `json:"account,omitempty"`
}

type Template struct {
	Name     string  `json:"name"`
	Label    string  `json:"label"`
	Sessions []Entry `json:"sessions"`
}

func Dir(root string) string { return filepath.Join(root, "templates") }

// migrate moves templates written by earlier versions, which stored them under
// the German directory name. Without this the user's saved templates would
// simply stop showing up after an update.
func migrate(root string) {
	fresh := Dir(root)
	if _, err := os.Stat(fresh); err == nil {
		return
	}
	old := filepath.Join(root, "vorlagen")
	if _, err := os.Stat(old); err != nil {
		return
	}
	_ = os.Rename(old, fresh)
}

func Load(root string) []Template {
	migrate(root)
	out := []Template{}
	paths, _ := filepath.Glob(filepath.Join(Dir(root), "*.json"))
	for _, p := range paths {
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		var t Template
		if json.Unmarshal(b, &t) != nil || t.Name == "" {
			continue
		}
		if t.Label == "" {
			t.Label = t.Name
		}
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Label < out[j].Label })
	return out
}

func Save(root string, t Template) error {
	if strings.TrimSpace(t.Name) == "" {
		return errors.New("die Vorlage braucht einen Namen")
	}
	if !ValidName(t.Name) {
		return errors.New("der Name darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten")
	}
	if len(t.Sessions) == 0 {
		return errors.New("die Vorlage enthält keine Session")
	}
	migrate(root)
	if err := os.MkdirAll(Dir(root), 0o755); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(t, "", "  ")
	return os.WriteFile(filepath.Join(Dir(root), t.Name+".json"), b, 0o644)
}

func Delete(root, name string) error {
	if !ValidName(name) {
		return errors.New("unzulässiger Name")
	}
	migrate(root)
	return os.Remove(filepath.Join(Dir(root), name+".json"))
}

// ValidName reports whether a name is fit to be a file name. Rejecting path
// separators is not enough: quotes and braces never reach anywhere they could
// do harm, but they do produce files that are near impossible to remove by
// hand afterwards.
func ValidName(name string) bool {
	if name == "" || len(name) > 64 {
		return false
	}
	for _, r := range name {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' {
			continue
		}
		return false
	}
	return true
}
