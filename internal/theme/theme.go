// Package theme loads UI themes.
//
// A theme is more than a colour palette: it picks a *skin* — a complete visual
// language with its own frames, button shapes, typefaces and textures. The skin
// lives as CSS under web/skins/<name>/skin.css; the theme only points at it and
// may override the palette.
//
// Built-in themes come from web/themes, your own from ~/.plxr/themes.
package theme

import (
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"plxr/internal/daemon"
	"plxr/internal/uierr"
	"sort"
	"strings"
)

type Theme struct {
	Name   string `json:"name"`
	Label  string `json:"label"`
	Author string `json:"author,omitempty"`

	// Skin is the directory name under web/skins.
	Skin string `json:"skin"`

	// Palette overrides individual CSS variables of the skin. Leaving it empty
	// means: the skin brings its own colours.
	Palette map[string]string `json:"palette,omitempty"`

	// Switches any skin is free to respect.
	Scanlines *bool `json:"scanlines,omitempty"`
	Glow      *bool `json:"glow,omitempty"`

	// Font size of the UI and of the terminal, each overridable.
	// Empty means: the skin decides.
	Font     string `json:"font,omitempty"`
	FontSize int    `json:"fontSize,omitempty"`
	TermFont string `json:"termFont,omitempty"`
	TermSize int    `json:"termSize,omitempty"`

	// Own marks a theme the user created — only those may be overwritten and
	// deleted.
	Own bool `json:"own,omitempty"`
}

// Allowed limits which palette entries may reach the CSS — an imported theme
// must not be able to set arbitrary properties.
//
// term-bg and term-fg are deliberately separate from bg and fg: a light skin
// still needs a dark, readable terminal.
var Allowed = map[string]bool{
	"bg": true, "fg": true, "dim": true, "accent": true,
	"working": true, "waiting": true, "blocked": true, "dead": true,
	"panel": true, "line": true,
	"term-bg": true, "term-fg": true,
	// The text that sits ON the accent surface. Hard-wired as #fff before, and
	// on a palette with a yellow accent that is 1.03:1 — white on yellow.
	"onAccent": true,
}

func (t *Theme) valid(skins map[string]bool) error {
	if strings.TrimSpace(t.Name) == "" {
		return errors.New(`theme braucht ein Feld "name"`)
	}
	if strings.ContainsAny(t.Name, `/\.`) {
		return uierr.New("err.theme.badName")
	}
	if strings.TrimSpace(t.Skin) == "" {
		return errors.New(`theme "` + t.Name + `" braucht ein Feld "skin"`)
	}
	if strings.ContainsAny(t.Skin, `/\.`) {
		return uierr.New("err.theme.badSkinName")
	}
	if skins != nil && !skins[t.Skin] {
		known := make([]string, 0, len(skins))
		for k := range skins {
			known = append(known, k)
		}
		sort.Strings(known)
		return uierr.With("err.theme.unknownSkin", t.Skin+" — "+strings.Join(known, ", "))
	}
	for k, v := range t.Palette {
		if !Allowed[k] {
			return uierr.With("err.theme.unknownPaletteKey", k)
		}
		if strings.ContainsAny(v, "{};<>") {
			return uierr.With("err.theme.badColorValue", k)
		}
	}
	if t.Label == "" {
		t.Label = t.Name
	}
	return nil
}

func UserDir() string { return filepath.Join(daemon.Root(), "themes") }

// Skins lists the installed skins, that is the directories under web/skins.
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
	// Skins of your own count too, otherwise valid() would reject a theme that
	// points at one — and the workbench could not save its first skin.
	for name := range OwnSkins() {
		out[name] = true
	}
	return out
}

// complain reports a theme that could not be read.
//
// A built-in one is our own mistake and has to be loud: it is compiled into
// the binary, so it can only be wrong because somebody wrote it wrong — and it
// vanished from the list without a word. One added palette key cost three
// themes that way, and nothing anywhere said so.
//
// One of the user's own is a different matter: their file, their typo. It is
// noted and the rest keeps working.
func complain(own bool, name string, err error) {
	if own {
		log.Printf("theme %s ignored: %v", name, err)
		return
	}
	log.Printf("BUILT-IN theme %s is broken: %v", name, err)
}

// Load reads built-in and own themes. On a name clash the own one wins.
func Load(builtin, skinFS fs.FS) []Theme {
	skins := Skins(skinFS)
	byName := map[string]Theme{}
	custom := false

	add := func(name string, b []byte) {
		var t Theme
		if err := json.Unmarshal(b, &t); err != nil {
			complain(custom, name, err)
			return
		}
		if err := t.valid(skins); err != nil {
			complain(custom, name, err)
			return
		}
		t.Own = custom
		byName[t.Name] = t
	}

	if builtin != nil {
		fs.WalkDir(builtin, ".", func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(p, ".json") {
				return nil
			}
			if b, e := fs.ReadFile(builtin, p); e == nil {
				add(p, b)
			}
			return nil
		})
	}
	paths, _ := filepath.Glob(filepath.Join(UserDir(), "*.json"))
	for _, p := range paths {
		if b, err := os.ReadFile(p); err == nil {
			custom = true
			add(p, b)
			custom = false
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

// Import validates an uploaded theme and stores it under ~/.plxr/themes.
func Import(raw []byte, skinFS fs.FS) (*Theme, error) {
	var t Theme
	if err := json.Unmarshal(raw, &t); err != nil {
		return nil, uierr.With("err.theme.badJSON", err.Error())
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

// Delete removes an own theme. Built-in ones stay untouchable — they live
// inside the application and would be back after the next update anyway.
func Delete(name string) error {
	if strings.ContainsAny(name, `/\.`) {
		return uierr.New("err.theme.badName")
	}
	p := filepath.Join(UserDir(), name+".json")
	if _, err := os.Stat(p); err != nil {
		return uierr.New("err.theme.notOwn")
	}
	return os.Remove(p)
}

// ---- Skins of your own ----

// SkinDir is where skins written by hand live: ~/.plxr/skins/<name>/skin.css.
//
// The four built-in ones sit inside the binary and are therefore not editable —
// an update would overwrite them anyway. Anything written in the workbench
// lands here, beside them, and survives every update.
func SkinDir() string { return filepath.Join(daemon.Root(), "skins") }

// OwnSkins lists the skins on disk.
func OwnSkins() map[string]bool {
	out := map[string]bool{}
	entries, err := os.ReadDir(SkinDir())
	if err != nil {
		return out
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if _, err := os.Stat(filepath.Join(SkinDir(), e.Name(), "skin.css")); err == nil {
			out[e.Name()] = true
		}
	}
	return out
}

// SkinPath is the file of a skin of your own — empty for a name that is not
// allowed. The check is not cosmetic: the name comes out of an HTTP request and
// would otherwise reach any file on the disk through "../".
func SkinPath(name string) string {
	if name == "" || strings.ContainsAny(name, `/\.`) {
		return ""
	}
	return filepath.Join(SkinDir(), name, "skin.css")
}

// SkinHandler serves the skins on disk under /skins/<name>/skin.css and hands
// everything else to next.
//
// It hangs in two places: on the daemon for the browser, and as the fallback
// handler of the Wails asset server. Without the second one a skin of your own
// would be invisible in the window — the window serves its files out of the
// binary and would answer 404 for anything not in it.
//
// next is what keeps the built-in four working. Without it this handler
// swallows every /skins/ request, and crt, pixel, sketch and win95 — which live
// in the binary, not on disk — answer 404. The end-to-end test caught exactly
// that.
func SkinHandler(next http.Handler) http.Handler {
	if next == nil {
		next = http.NotFoundHandler()
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rest := strings.TrimPrefix(r.URL.Path, "/skins/")
		name, file, ok := strings.Cut(rest, "/")
		if !ok || file != "skin.css" {
			next.ServeHTTP(w, r)
			return
		}
		p := SkinPath(name)
		if p == "" {
			next.ServeHTTP(w, r)
			return
		}
		if _, err := os.Stat(p); err != nil {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
		// No caching: the workbench writes this file while the window is looking
		// at it, and a cached sheet would make every save look like it did nothing.
		w.Header().Set("Cache-Control", "no-store")
		http.ServeFile(w, r, p)
	})
}
