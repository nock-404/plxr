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

	// Gradient over the page background, 0 to 100. Drawn from the accent
	// colour, so a theme brings it along without a second decision.
	Gradient int `json:"gradient,omitempty"`

	// How much colour the page gives up so the desktop shows through, 0 to
	// 100. Only the page — panels keep their ground, and with it everything
	// that has to be readable.
	Seethrough int `json:"seethrough,omitempty"`

	// Font size of the UI and of the terminal, each overridable.
	// Empty means: the skin decides.
	Font     string `json:"font,omitempty"`
	FontSize int    `json:"fontSize,omitempty"`
	TermFont string `json:"termFont,omitempty"`
	TermSize int    `json:"termSize,omitempty"`

	// CSS is the skin itself, carried in the theme file.
	//
	// A look is more than thirteen colours, and until now a theme could carry
	// nothing else: the skins were compiled into the application, so anybody
	// bringing their own look could recolour one of four and no more. A theme
	// that brings a stylesheet is a whole look in one file — on import the
	// sheet becomes a skin of its own, named after the theme, and the theme
	// points at it. Stays out of the file when the theme only recolours a skin
	// that is already there.
	CSS string `json:"css,omitempty"`

	// Own marks a theme the user created — only those may be overwritten and
	// deleted.
	Own bool `json:"own,omitempty"`
}

// MaxCSS is as much stylesheet as a theme may carry — the same limit the skin
// route has, because it ends up in the same file.
const MaxCSS = 512 * 1024

/* checkCSS refuses a stylesheet that would reach outside the window.
 *
 * What a theme brings is somebody else's file, and a stylesheet can fetch: an
 * @import pulls in another sheet, and url() fetches a picture or a font. Both
 * would let a look phone home the moment it is applied — from a window that
 * holds every session and a token. So: no @import at all, and url() only to
 * what this daemon itself serves (a path beginning with /), never http, never
 * data. Everything else a stylesheet can do is drawing, which is the point. */
func checkCSS(css string) error {
	if len(css) > MaxCSS {
		return uierr.New("err.skin.tooLarge")
	}
	lower := strings.ToLower(css)
	if strings.Contains(lower, "@import") {
		return uierr.With("err.theme.cssReaches", "@import")
	}
	for rest := lower; ; {
		at := strings.Index(rest, "url(")
		if at < 0 {
			break
		}
		rest = rest[at+len("url("):]
		end := strings.IndexByte(rest, ')')
		if end < 0 {
			return uierr.With("err.theme.cssReaches", "url(")
		}
		target := strings.Trim(strings.TrimSpace(rest[:end]), `"'`)
		if !strings.HasPrefix(target, "/") {
			return uierr.With("err.theme.cssReaches", "url("+target+")")
		}
		rest = rest[end:]
	}
	return nil
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
		return uierr.New("err.theme.noName")
	}
	if strings.ContainsAny(t.Name, `/\.`) {
		return uierr.New("err.theme.badName")
	}
	/* A theme that brings its own stylesheet is its own skin, and need not say
	   so twice: the skin is the theme's name. Saying something else would mean
	   a file whose two halves point at different looks. */
	if t.CSS != "" {
		if err := checkCSS(t.CSS); err != nil {
			return err
		}
		if strings.TrimSpace(t.Skin) == "" {
			t.Skin = t.Name
		}
		if t.Skin != t.Name {
			return uierr.With("err.theme.skinNotOwn", t.Skin)
		}
	}
	if strings.TrimSpace(t.Skin) == "" {
		return uierr.With("err.theme.noSkin", t.Name)
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

// Skin is one entry of the list a window offers: the name it is chosen by, the
// name it is called by, and whether it came from outside.
type SkinInfo struct {
	Name  string `json:"name"`
	Label string `json:"label"`
	Own   bool   `json:"own"`
}

/* SkinList is every skin that can be chosen — the ones inside the application
 * and the ones on disk, in one list.
 *
 * The window used to hold that list itself, as four lines of its own, so a
 * skin somebody wrote could be validated by the service, served by the service
 * and never appear anywhere a person could pick it. A name on disk may carry a
 * label in skin.json beside its stylesheet; without one it is called by its
 * directory's name.
 */
func SkinList(skinFS fs.FS) []SkinInfo {
	out := []SkinInfo{}
	seen := map[string]bool{}
	if skinFS != nil {
		if entries, err := fs.ReadDir(skinFS, "."); err == nil {
			for _, e := range entries {
				if !e.IsDir() {
					continue
				}
				seen[e.Name()] = true
				out = append(out, SkinInfo{Name: e.Name(), Label: labelOfSkin(e.Name())})
			}
		}
	}
	for name := range OwnSkins() {
		if seen[name] {
			continue
		}
		out = append(out, SkinInfo{Name: name, Label: labelOfSkin(name), Own: true})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Own != out[j].Own {
			return !out[i].Own
		}
		return out[i].Label < out[j].Label
	})
	return out
}

// writeSkinAbout puts the name a skin calls itself beside its stylesheet.
func writeSkinAbout(name, label, author string) error {
	p := SkinPath(name)
	if p == "" {
		return uierr.New("err.skin.badName")
	}
	about := struct {
		Label  string `json:"label"`
		Author string `json:"author,omitempty"`
	}{Label: strings.TrimSpace(label), Author: strings.TrimSpace(author)}
	if about.Label == "" {
		about.Label = name
	}
	b, err := json.MarshalIndent(about, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(p), "skin.json"), b, 0o644); err != nil {
		return uierr.With("err.skin.saveFailed", err.Error())
	}
	return nil
}

// labelOfSkin reads the name a skin calls itself, from skin.json beside its
// stylesheet. A skin without one is called by its directory.
func labelOfSkin(name string) string {
	p := SkinPath(name)
	if p == "" {
		return name
	}
	b, err := os.ReadFile(filepath.Join(filepath.Dir(p), "skin.json"))
	if err != nil {
		return name
	}
	var about struct {
		Label string `json:"label"`
	}
	if json.Unmarshal(b, &about) != nil || strings.TrimSpace(about.Label) == "" {
		return name
	}
	return about.Label
}

// Import validates an uploaded theme and stores it under ~/.plxr/themes.
func Import(raw []byte, skinFS fs.FS) (*Theme, error) {
	var t Theme
	if err := json.Unmarshal(raw, &t); err != nil {
		return nil, uierr.With("err.theme.badJSON", err.Error())
	}
	/* A theme that brings a stylesheet is checked against the skins it would
	   have after it is installed, not before: its own skin does not exist yet,
	   and validating against the old list would refuse every complete look on
	   its first import. */
	known := Skins(skinFS)
	if t.CSS != "" && strings.TrimSpace(t.Name) != "" {
		known[t.Name] = true
	}
	if err := t.valid(known); err != nil {
		return nil, err
	}
	if t.CSS != "" {
		if err := WriteSkin(t.Name, t.CSS); err != nil {
			return nil, err
		}
		/* And the name it is called by, beside its stylesheet. Without it the
		   picker can only print the directory: a look called "Brought Look"
		   appeared as "brought", which is the name of a folder, not of a
		   look. */
		if err := writeSkinAbout(t.Name, t.Label, t.Author); err != nil {
			return nil, err
		}
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

/* WriteSkin puts a stylesheet on disk as a skin of its own.
 *
 * The one place a skin file is written: the route the workshop saves through
 * and the import of a theme that carries its look both end here, so a brought
 * sheet is held to the same check wherever it came from. */
func WriteSkin(name, css string) error {
	p := SkinPath(name)
	if p == "" {
		return uierr.New("err.skin.badName")
	}
	if err := checkCSS(css); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return uierr.With("err.skin.saveFailed", err.Error())
	}
	if err := os.WriteFile(p, []byte(css), 0o644); err != nil {
		return uierr.With("err.skin.saveFailed", err.Error())
	}
	return nil
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
