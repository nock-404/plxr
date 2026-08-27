// Package rules resolves which instruction files take effect in a directory.
//
// At startup Claude Code collects CLAUDE.md from several levels, plus skills and
// agents. Anyone working across many repositories loses track of what is having
// a say — this package answers exactly that question.
//
// An important limitation: this is the current state of the files, not the state
// at the time an old session ran. Claude Code does not write the inlined
// CLAUDE.md block into the transcript, so the chain cannot be reconstructed
// after the fact.
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

type Entry struct {
	Art         Art    `json:"art"`
	Name        string `json:"name"`
	Path        string `json:"path"`
	Description string `json:"description"`
	Size        int64  `json:"size"`
	Ebene       int    `json:"ebene"` // 0 = global, then depth in the tree
}

const maxImportDepth = 3

// Resolve returns everything that applies in cwd — in the order Claude Code
// assembles it: global first, then from the root downwards.
func Resolve(cwd, configDir string) []Entry {
	out := []Entry{}
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
		out = append(out, Entry{
			Art: art, Name: shortName(art, p), Path: p,
			Description: describe(p), Size: info.Size(), Ebene: ebene,
		})
		for _, imp := range imports(p, 1) {
			if gesehen[imp] {
				continue
			}
			if info, err := os.Stat(imp); err == nil && !info.IsDir() {
				gesehen[imp] = true
				out = append(out, Entry{
					Art: Import, Name: filepath.Base(imp), Path: imp,
					Description: describe(imp), Size: info.Size(), Ebene: ebene,
				})
			}
		}
	}

	// 1. Global
	if configDir != "" {
		add(Global, filepath.Join(configDir, "CLAUDE.md"), 0)
	}

	// 2. From the topmost ancestor down to cwd. Collect from the bottom, then
	//    reverse — that puts the most general rule first and the most specific last.
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

	// 3. Skills and agents, local and global
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

func shortName(art Art, p string) string {
	if art == Skill {
		return filepath.Base(filepath.Dir(p))
	}
	return filepath.Base(p)
}

// imports finds @path lines with which a CLAUDE.md pulls in further files.
func imports(p string, tiefe int) []string {
	if tiefe > maxImportDepth {
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
		target := strings.Fields(line[1:])[0]
		if strings.HasPrefix(target, "~/") {
			home, _ := os.UserHomeDir()
			target = filepath.Join(home, target[2:])
		} else if !filepath.IsAbs(target) {
			target = filepath.Join(dir, target)
		}
		out = append(out, target)
	}
	return out
}

// describe takes the description field from the front matter, otherwise the
// first heading plus the first paragraph.
func describe(p string) string {
	f, err := os.Open(p)
	if err != nil {
		return ""
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 8192), 1<<20)

	var lines []string
	for i := 0; sc.Scan() && i < 60; i++ {
		lines = append(lines, sc.Text())
	}
	if len(lines) == 0 {
		return ""
	}

	if strings.TrimSpace(lines[0]) == "---" {
		for i := 1; i < len(lines); i++ {
			l := strings.TrimSpace(lines[i])
			if l == "---" {
				break
			}
			if rest, ok := strings.CutPrefix(l, "description:"); ok {
				return shorten(strings.Trim(strings.TrimSpace(rest), `"'`))
			}
		}
	}

	var header, absatz string
	for _, l := range lines {
		t := strings.TrimSpace(l)
		if t == "" || t == "---" {
			continue
		}
		if strings.HasPrefix(t, "#") && header == "" {
			header = strings.TrimSpace(strings.TrimLeft(t, "# "))
			continue
		}
		if !strings.HasPrefix(t, "#") {
			absatz = t
			break
		}
	}
	return shorten(strings.TrimSpace(header + " — " + absatz))
}

func shorten(s string) string {
	s = strings.TrimSuffix(strings.TrimSpace(s), "—")
	s = strings.TrimSpace(s)
	if len(s) > 220 {
		s = s[:219] + "…"
	}
	return s
}
