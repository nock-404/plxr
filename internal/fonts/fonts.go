// Package fonts keeps the fonts a person brings to plxr — the ones that are not
// shipped with it.
//
// A dropped or imported font file lands in a directory of plxr's own, the
// daemon serves it under /userfonts/, and the window writes the @font-face for
// it and offers it for the interface and the terminal. No foreign server is
// ever involved: what is here was put here by hand.
package fonts

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"plxr/internal/daemon"
	"plxr/internal/uierr"
)

// MaxSize is the largest font file that will be taken in. A woff2 of a whole
// family is tens of kilobytes; megabytes is a sign of the wrong file.
const MaxSize = 8 << 20

// Dir is where the brought-in fonts live, beside everything else plxr owns.
func Dir() string { return filepath.Join(daemon.Root(), "fonts") }

// A Font is one face the window can offer.
type Font struct {
	// Family is the name the window uses in font-family and shows in the list —
	// the file name without its extension.
	Family string `json:"family"`
	// File is what it is served as, under /userfonts/.
	File string `json:"file"`
}

// kinds are the file forms a browser can actually use.
var kinds = map[string]bool{".woff2": true, ".woff": true, ".ttf": true, ".otf": true}

// List returns the brought-in fonts, by family name.
func List() []Font {
	entries, err := os.ReadDir(Dir())
	if err != nil {
		return []Font{}
	}
	out := []Font{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !kinds[strings.ToLower(filepath.Ext(name))] {
			continue
		}
		out = append(out, Font{Family: familyOf(name), File: name})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Family < out[j].Family })
	return out
}

// familyOf is the file name without its extension, which is what the window
// declares the @font-face as.
func familyOf(file string) string {
	return strings.TrimSuffix(file, filepath.Ext(file))
}

// Import writes a font file into the store under a safe name and returns it.
func Import(name string, data []byte) (Font, error) {
	if len(data) == 0 {
		return Font{}, uierr.New("err.font.empty")
	}
	if len(data) > MaxSize {
		return Font{}, uierr.New("err.font.tooBig")
	}
	safe := safeName(name)
	if safe == "" || !kinds[strings.ToLower(filepath.Ext(safe))] {
		return Font{}, uierr.With("err.font.notAFont", name)
	}
	if err := os.MkdirAll(Dir(), 0o755); err != nil {
		return Font{}, err
	}
	full := filepath.Join(Dir(), safe)
	tmp := full + ".plxr-tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return Font{}, err
	}
	if err := os.Rename(tmp, full); err != nil {
		os.Remove(tmp)
		return Font{}, err
	}
	return Font{Family: familyOf(safe), File: safe}, nil
}

// Delete removes one brought-in font.
func Delete(file string) error {
	safe := safeName(file)
	if safe == "" {
		return uierr.New("err.font.notAFont")
	}
	return os.Remove(filepath.Join(Dir(), safe))
}

// Path is the file to serve for a request under /userfonts/, or "" if it is
// not a font this store holds — a name with a slash, a dot-dot, or an
// extension a browser cannot use is refused before it reaches the disk.
func Path(file string) string {
	safe := safeName(file)
	if safe == "" || !kinds[strings.ToLower(filepath.Ext(safe))] {
		return ""
	}
	full := filepath.Join(Dir(), safe)
	if _, err := os.Stat(full); err != nil {
		return ""
	}
	return full
}

// safeName reduces whatever was sent to a bare file name — no directory, no
// walking up — so nothing here can read or write outside the store.
func safeName(name string) string {
	name = strings.ReplaceAll(name, "\\", "/")
	name = filepath.Base(filepath.Clean("/" + name))
	if name == "." || name == "/" || strings.HasPrefix(name, ".") {
		return ""
	}
	return name
}
