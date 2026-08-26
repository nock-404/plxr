// Package theme lädt Oberflächen-Themes.
//
// Ein Theme ist mehr als eine Farbpalette: es wählt einen *Skin* — eine
// vollständige visuelle Sprache mit eigenen Rahmen, Knopfformen, Schriften und
// Texturen. Der Skin liegt als CSS unter web/skins/<name>/skin.css, das Theme
// verweist nur darauf und darf die Palette überschreiben.
//
// Eingebaute Themes kommen aus web/themes, eigene aus ~/.plxr/themes.
package theme

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"plxr/internal/daemon"
	"sort"
	"strings"
)

type Theme struct {
	Name   string `json:"name"`
	Label  string `json:"label"`
	Author string `json:"author,omitempty"`

	// Skin ist der Verzeichnisname unter web/skins.
	Skin string `json:"skin"`

	// Palette überschreibt einzelne CSS-Variablen des Skins. Leer lassen heißt:
	// der Skin bringt seine eigenen Farben mit.
	Palette map[string]string `json:"palette,omitempty"`

	// Schalter, die jeder Skin respektieren darf.
	Scanlines *bool `json:"scanlines,omitempty"`
	Glow      *bool `json:"glow,omitempty"`

	// Schrift der Oberfläche und des Terminals, jeweils überschreibbar.
	// Leer heißt: der Skin entscheidet.
	Font     string `json:"font,omitempty"`
	FontSize int    `json:"fontSize,omitempty"`
	TermFont string `json:"termFont,omitempty"`
	TermSize int    `json:"termSize,omitempty"`

	// Eigen markiert ein Theme, das der Nutzer angelegt hat — nur solche
	// dürfen überschrieben und gelöscht werden.
	Eigen bool `json:"eigen,omitempty"`
}

// Erlaubt begrenzt, welche Paletteneinträge ins CSS dürfen — ein importiertes
// Theme soll keine beliebigen Eigenschaften setzen können.
//
// term-bg und term-fg sind bewusst getrennt von bg und fg: ein heller Skin
// braucht trotzdem ein dunkles, lesbares Terminal.
var Erlaubt = map[string]bool{
	"bg": true, "fg": true, "dim": true, "accent": true,
	"working": true, "waiting": true, "blocked": true, "dead": true,
	"panel": true, "line": true,
	"term-bg": true, "term-fg": true,
}

func (t *Theme) valid(skins map[string]bool) error {
	if strings.TrimSpace(t.Name) == "" {
		return errors.New(`theme braucht ein Feld "name"`)
	}
	if strings.ContainsAny(t.Name, `/\.`) {
		return errors.New("theme-name darf keine Pfadzeichen enthalten")
	}
	if strings.TrimSpace(t.Skin) == "" {
		return errors.New(`theme "` + t.Name + `" braucht ein Feld "skin"`)
	}
	if strings.ContainsAny(t.Skin, `/\.`) {
		return errors.New("skin-name darf keine Pfadzeichen enthalten")
	}
	if skins != nil && !skins[t.Skin] {
		known := make([]string, 0, len(skins))
		for k := range skins {
			known = append(known, k)
		}
		sort.Strings(known)
		return errors.New(`skin "` + t.Skin + `" gibt es nicht. Vorhanden: ` + strings.Join(known, ", "))
	}
	for k, v := range t.Palette {
		if !Erlaubt[k] {
			return errors.New(`unbekannter Paletteneintrag "` + k + `"`)
		}
		if strings.ContainsAny(v, "{};<>") {
			return errors.New(`Farbwert für "` + k + `" enthält unerlaubte Zeichen`)
		}
	}
	if t.Label == "" {
		t.Label = t.Name
	}
	return nil
}

func UserDir() string { return filepath.Join(daemon.Root(), "themes") }

// Skins listet die installierten Skins, also die Verzeichnisse unter web/skins.
func Skins(skinFS fs.FS) map[string]bool {
	out := map[string]bool{}
	if skinFS == nil {
		return out
	}
	entries, err := fs.ReadDir(skinFS, ".")
	if err != nil {
		return out
	}
	for _, e := range entries {
		if e.IsDir() {
			out[e.Name()] = true
		}
	}
	return out
}

// Load liest eingebaute und eigene Themes. Bei Namensgleichheit gewinnt das eigene.
func Load(builtin, skinFS fs.FS) []Theme {
	skins := Skins(skinFS)
	byName := map[string]Theme{}
	eigen := false

	add := func(b []byte) {
		var t Theme
		if json.Unmarshal(b, &t) != nil {
			return
		}
		if t.valid(skins) != nil {
			return
		}
		t.Eigen = eigen
		byName[t.Name] = t
	}

	if builtin != nil {
		fs.WalkDir(builtin, ".", func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(p, ".json") {
				return nil
			}
			if b, e := fs.ReadFile(builtin, p); e == nil {
				add(b)
			}
			return nil
		})
	}
	paths, _ := filepath.Glob(filepath.Join(UserDir(), "*.json"))
	for _, p := range paths {
		if b, err := os.ReadFile(p); err == nil {
			eigen = true
			add(b)
			eigen = false
		}
	}

	out := make([]Theme, 0, len(byName))
	for _, t := range byName {
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Skin != out[j].Skin {
			return out[i].Skin < out[j].Skin
		}
		return out[i].Label < out[j].Label
	})
	return out
}

// Import prüft ein hochgeladenes Theme und legt es unter ~/.plxr/themes ab.
func Import(raw []byte, skinFS fs.FS) (*Theme, error) {
	var t Theme
	if err := json.Unmarshal(raw, &t); err != nil {
		return nil, errors.New("kein gültiges JSON: " + err.Error())
	}
	if err := t.valid(Skins(skinFS)); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(UserDir(), 0o755); err != nil {
		return nil, err
	}
	b, _ := json.MarshalIndent(t, "", "  ")
	if err := os.WriteFile(filepath.Join(UserDir(), t.Name+".json"), b, 0o644); err != nil {
		return nil, err
	}
	return &t, nil
}

// Löschen entfernt ein eigenes Theme. Eingebaute bleiben unantastbar — sie
// stecken in der Anwendung und wären nach dem nächsten Update wieder da.
func Löschen(name string) error {
	if strings.ContainsAny(name, `/\.`) {
		return errors.New("unzulässiger Name")
	}
	p := filepath.Join(UserDir(), name+".json")
	if _, err := os.Stat(p); err != nil {
		return errors.New("kein eigenes Theme mit diesem Namen")
	}
	return os.Remove(p)
}
