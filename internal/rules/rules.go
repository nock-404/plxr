// Package rules löst auf, welche Anweisungsdateien in einem Verzeichnis wirken.
//
// Claude Code sammelt beim Start CLAUDE.md aus mehreren Ebenen, dazu Skills und
// Agenten. Wer in vielen Repos arbeitet, verliert den Überblick, was gerade
// alles mitredet — genau die Frage beantwortet dieses Paket.
//
// Wichtige Einschränkung: das ist der IST-Zustand der Dateien, nicht der
// Zustand zur Laufzeit einer alten Session. Claude Code schreibt den
// eingefügten CLAUDE.md-Block nicht ins Transkript, historisch ist die Kette
// also nicht rekonstruierbar.
package rules

import (
	"bufio"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type Art string

const (
	Global  Art = "global"  // ~/.claude/CLAUDE.md
	Projekt Art = "projekt" // CLAUDE.md im Baum
	Lokal   Art = "lokal"   // CLAUDE.local.md
	Import  Art = "import"  // per @pfad eingebunden
	Skill   Art = "skill"
	Agent   Art = "agent"
)

type Eintrag struct {
	Art         Art    `json:"art"`
	Name        string `json:"name"`
	Path        string `json:"path"`
	Description string `json:"description"`
	Size        int64  `json:"size"`
	Ebene       int    `json:"ebene"` // 0 = global, dann Tiefe im Baum
}

const maxImportTiefe = 3

// Resolve liefert alles, was in cwd wirkt — in der Reihenfolge, in der Claude
// Code es zusammenträgt: global zuerst, dann von der Wurzel abwärts.
func Resolve(cwd, configDir string) []Eintrag {
	out := []Eintrag{}
	gesehen := map[string]bool{}

	add := func(art Art, p string, ebene int) {
		p = filepath.Clean(p)
		if gesehen[p] {
			return
		}
		info, err := os.Stat(p)
		if err != nil || info.IsDir() {
			return
		}
		gesehen[p] = true
		out = append(out, Eintrag{
			Art: art, Name: kurzName(art, p), Path: p,
			Description: beschreibung(p), Size: info.Size(), Ebene: ebene,
		})
		for _, imp := range importe(p, 1) {
			if gesehen[imp] {
				continue
			}
			if info, err := os.Stat(imp); err == nil && !info.IsDir() {
				gesehen[imp] = true
				out = append(out, Eintrag{
					Art: Import, Name: filepath.Base(imp), Path: imp,
					Description: beschreibung(imp), Size: info.Size(), Ebene: ebene,
				})
			}
		}
	}

	// 1. Global
	if configDir != "" {
		add(Global, filepath.Join(configDir, "CLAUDE.md"), 0)
	}

	// 2. Vom obersten Vorfahren abwärts bis cwd. Von unten sammeln, dann drehen
	//    — so steht die allgemeinste Regel oben und die speziellste unten.
	var kette []string
	for d := filepath.Clean(cwd); ; {
		kette = append(kette, d)
		parent := filepath.Dir(d)
		if parent == d || parent == "/" || parent == filepath.Dir(os.Getenv("HOME")) {
			break
		}
		d = parent
	}
	for i, j := 0, len(kette)-1; i < j; i, j = i+1, j-1 {
		kette[i], kette[j] = kette[j], kette[i]
	}
	for ebene, d := range kette {
		add(Projekt, filepath.Join(d, "CLAUDE.md"), ebene+1)
		add(Projekt, filepath.Join(d, ".claude", "CLAUDE.md"), ebene+1)
		add(Lokal, filepath.Join(d, "CLAUDE.local.md"), ebene+1)
	}

	// 3. Skills und Agenten, lokal und global
	for _, basis := range []string{filepath.Join(cwd, ".claude"), configDir} {
		if basis == "" {
			continue
		}
		ebene := 0
		if basis != configDir {
			ebene = len(kette)
		}
		for _, s := range glob(filepath.Join(basis, "skills", "*", "SKILL.md")) {
			add(Skill, s, ebene)
		}
		for _, a := range glob(filepath.Join(basis, "agents", "*.md")) {
			add(Agent, a, ebene)
		}
	}

	sort.SliceStable(out, func(i, j int) bool { return out[i].Ebene < out[j].Ebene })
	return out
}

func glob(p string) []string { m, _ := filepath.Glob(p); sort.Strings(m); return m }

func kurzName(art Art, p string) string {
	if art == Skill {
		return filepath.Base(filepath.Dir(p))
	}
	return filepath.Base(p)
}

// importe findet @pfad-Zeilen, mit denen eine CLAUDE.md weitere Dateien einbindet.
func importe(p string, tiefe int) []string {
	if tiefe > maxImportTiefe {
		return nil
	}
	f, err := os.Open(p)
	if err != nil {
		return nil
	}
	defer f.Close()

	var out []string
	dir := filepath.Dir(p)
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if !strings.HasPrefix(line, "@") || len(line) < 2 {
			continue
		}
		ziel := strings.Fields(line[1:])[0]
		if strings.HasPrefix(ziel, "~/") {
			home, _ := os.UserHomeDir()
			ziel = filepath.Join(home, ziel[2:])
		} else if !filepath.IsAbs(ziel) {
			ziel = filepath.Join(dir, ziel)
		}
		out = append(out, ziel)
	}
	return out
}

// beschreibung nimmt das Feld description aus dem Frontmatter, sonst die erste
// Überschrift plus den ersten Absatz.
func beschreibung(p string) string {
	f, err := os.Open(p)
	if err != nil {
		return ""
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 8192), 1<<20)

	var zeilen []string
	for i := 0; sc.Scan() && i < 60; i++ {
		zeilen = append(zeilen, sc.Text())
	}
	if len(zeilen) == 0 {
		return ""
	}

	if strings.TrimSpace(zeilen[0]) == "---" {
		for i := 1; i < len(zeilen); i++ {
			l := strings.TrimSpace(zeilen[i])
			if l == "---" {
				break
			}
			if rest, ok := strings.CutPrefix(l, "description:"); ok {
				return kuerzen(strings.Trim(strings.TrimSpace(rest), `"'`))
			}
		}
	}

	var kopf, absatz string
	for _, l := range zeilen {
		t := strings.TrimSpace(l)
		if t == "" || t == "---" {
			continue
		}
		if strings.HasPrefix(t, "#") && kopf == "" {
			kopf = strings.TrimSpace(strings.TrimLeft(t, "# "))
			continue
		}
		if !strings.HasPrefix(t, "#") {
			absatz = t
			break
		}
	}
	return kuerzen(strings.TrimSpace(kopf + " — " + absatz))
}

func kuerzen(s string) string {
	s = strings.TrimSuffix(strings.TrimSpace(s), "—")
	s = strings.TrimSpace(s)
	if len(s) > 220 {
		s = s[:219] + "…"
	}
	return s
}
