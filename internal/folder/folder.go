// Package folder reads the plain facts about a directory: how much is in it,
// what it is written in, when it was last touched, and what its README says.
//
// None of this is git's business — a folder that was never a repository has
// all of it just the same — so it lives beside internal/git rather than in it.
package folder

import (
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

/* What the walk refuses to count.
 *
 * Not an optimisation. A folder with node_modules in it is four fifths
 * somebody else's JavaScript, and a survey that counts it answers "what is
 * this folder written in" with "JavaScript" for a Go project. The same goes
 * for build output, which is the project written out twice. The window says
 * out loud that these are left out, so the number is a number somebody can
 * check rather than one they have to trust.
 */
var skipped = map[string]bool{
	".git": true, "node_modules": true, ".next": true, ".nuxt": true,
	".turbo": true, ".cache": true, "dist": true, "build": true,
	"target": true, "vendor": true, "__pycache__": true, ".venv": true,
	".pytest_cache": true, "out": true, ".gradle": true, ".idea": true,
}

// Ceiling is how many entries the walk will look at before it stops and says
// so. A folder large enough to pass it is one where the exact count was never
// the point, and a panel that takes ten seconds to draw is a panel nobody
// opens twice.
const Ceiling = 40000

// Budget is how long the walk may take, whatever it has counted by then.
const Budget = 3 * time.Second

// ReadmeMax is how much of a README is read. The overview shows the beginning
// of it; anybody who wants the rest opens the file.
const ReadmeMax = 8 << 10

// Language is one language, counted by how many files are written in it.
type Language struct {
	Name  string `json:"name"`
	Files int    `json:"files"`
	// Share is the percentage of the counted files, rounded. By files and not
	// by bytes on purpose: one generated 40,000-line file would otherwise make
	// a project "JSON".
	Share int `json:"share"`
}

// Facts is everything this package can say about a directory.
type Facts struct {
	Files   int   `json:"files"`
	Folders int   `json:"folders"`
	Size    int64 `json:"size"`
	// Touched is the newest modification time under the folder, in
	// milliseconds — when somebody last changed anything in it.
	Touched int64 `json:"touched"`
	// Partial says the walk stopped early, so the numbers are a floor and not
	// a total. Said out loud rather than passed off as the answer.
	Partial   bool       `json:"partial"`
	Languages []Language `json:"languages"`
	// Ignored names the directories the walk did not enter, so the counts can
	// be read for what they are.
	Ignored []string `json:"ignored"`
	// Readme is the beginning of the folder's README, as text. Empty when
	// there is none.
	Readme     string `json:"readme"`
	ReadmePath string `json:"readme_path"`
	ReadmeMore bool   `json:"readme_more"`
}

// byExtension maps a file's ending to the language it is written in. Only
// endings that say something: a .txt file is text in any project.
var byExtension = map[string]string{
	".go": "Go", ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript",
	".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
	".py": "Python", ".rb": "Ruby", ".rs": "Rust", ".java": "Java",
	".kt": "Kotlin", ".swift": "Swift", ".c": "C", ".h": "C", ".cc": "C++",
	".cpp": "C++", ".hpp": "C++", ".cs": "C#", ".php": "PHP", ".lua": "Lua",
	".sh": "Shell", ".bash": "Shell", ".zsh": "Shell", ".fish": "Shell",
	".ps1": "PowerShell", ".sql": "SQL", ".css": "CSS", ".scss": "CSS",
	".sass": "CSS", ".less": "CSS", ".html": "HTML", ".htm": "HTML",
	".vue": "Vue", ".svelte": "Svelte", ".md": "Markdown", ".mdx": "Markdown",
	".json": "JSON", ".yaml": "YAML", ".yml": "YAML", ".toml": "TOML",
	".xml": "XML", ".m": "Objective-C", ".mm": "Objective-C", ".pl": "Perl",
	".r": "R", ".ex": "Elixir", ".exs": "Elixir", ".erl": "Erlang",
	".hs": "Haskell", ".scala": "Scala", ".dart": "Dart", ".zig": "Zig",
	".proto": "Protobuf", ".tf": "Terraform", ".gradle": "Gradle",
}

// Survey walks a directory and reports what is in it.
//
// It never fails: a directory that cannot be read in full is still a directory
// worth saying something about, and an overview that refuses to draw because
// one subfolder was unreadable is worse than one that counts what it could.
func Survey(dir string) Facts {
	f := Facts{Languages: []Language{}, Ignored: []string{}}
	deadline := time.Now().Add(Budget)
	seen := 0
	perLanguage := map[string]int{}
	ignored := map[string]bool{}

	_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			// An unreadable entry is skipped, not fatal.
			if d != nil && d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if path == dir {
			return nil
		}
		if d.IsDir() {
			if skipped[d.Name()] {
				if d.Name() != ".git" {
					ignored[d.Name()] = true
				}
				return filepath.SkipDir
			}
			f.Folders++
		}
		seen++
		if seen > Ceiling || time.Now().After(deadline) {
			f.Partial = true
			return filepath.SkipAll
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		// Only regular files carry a size worth adding up; a socket or a
		// device node has one that means something else entirely.
		if !info.Mode().IsRegular() {
			return nil
		}
		f.Files++
		f.Size += info.Size()
		if when := info.ModTime().UnixMilli(); when > f.Touched {
			f.Touched = when
		}
		if name, ok := byExtension[strings.ToLower(filepath.Ext(d.Name()))]; ok {
			perLanguage[name]++
		}
		return nil
	})

	total := 0
	for _, n := range perLanguage {
		total += n
	}
	for name, n := range perLanguage {
		f.Languages = append(f.Languages, Language{Name: name, Files: n, Share: percent(n, total)})
	}
	// Most files first; an equal count is settled by name so the order does
	// not shuffle between two readings of the same folder.
	sort.Slice(f.Languages, func(i, j int) bool {
		if f.Languages[i].Files != f.Languages[j].Files {
			return f.Languages[i].Files > f.Languages[j].Files
		}
		return f.Languages[i].Name < f.Languages[j].Name
	})
	for name := range ignored {
		f.Ignored = append(f.Ignored, name)
	}
	sort.Strings(f.Ignored)

	f.Readme, f.ReadmePath, f.ReadmeMore = readme(dir)
	return f
}

func percent(n, total int) int {
	if total <= 0 {
		return 0
	}
	return int((float64(n)/float64(total))*100 + 0.5)
}

// readme finds the folder's README and reads the beginning of it.
//
// Whatever it is called: README.md, readme.txt, README with no ending at all.
// The directory is read once and matched case-insensitively rather than a list
// of spellings being tried in turn, because the list is never complete.
func readme(dir string) (string, string, bool) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", "", false
	}
	best := ""
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		low := strings.ToLower(e.Name())
		if low != "readme" && !strings.HasPrefix(low, "readme.") {
			continue
		}
		// A markdown one wins over a bare or .txt one: it is the one people
		// actually write.
		if best == "" || strings.HasSuffix(low, ".md") {
			best = e.Name()
		}
	}
	if best == "" {
		return "", "", false
	}
	file, err := os.Open(filepath.Join(dir, best))
	if err != nil {
		return "", "", false
	}
	defer file.Close()
	buf := make([]byte, ReadmeMax)
	n, err := io.ReadFull(file, buf)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return "", "", false
	}
	buf = buf[:n]
	more := n == ReadmeMax
	// A README that is not text is not a README worth putting on screen.
	if !utf8.Valid(buf) {
		// Cut in the middle of a character is not the same as binary: the last
		// few bytes go before the question is asked.
		for i := 0; i < utf8.UTFMax-1 && len(buf) > 0 && !utf8.Valid(buf); i++ {
			buf = buf[:len(buf)-1]
		}
		if !utf8.Valid(buf) {
			return "", "", false
		}
	}
	return string(buf), best, more
}
