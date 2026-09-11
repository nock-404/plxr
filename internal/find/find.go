// Package find searches the files of a folder.
//
// internal/search looks through Claude transcripts; this looks through the
// project. One engine, not two: ripgrep is faster and is not everywhere, and a
// search that answers one way when rg is installed and another way when it is
// not is a search nobody can trust. Measured on the trees this is for — 263 and
// 676 tracked files, git ls-files in 29ms — the plain walk is far below the
// point where speed would be worth that.
//
// What it will not do is run forever or answer with everything: a folder can be
// a home directory. Every bound it hits is reported rather than quietly
// trimming the list, because a short answer that looks complete is worse than
// no answer.
package find

import (
	"bufio"
	"bytes"
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"plxr/internal/git"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	MaxHits     = 500
	MaxFileSize = 1 << 20 // 1 MB: past that it is data, not source
	MaxLineLen  = 400
	Deadline    = 5 * time.Second
	// Skipped wherever they appear. Everything else in a folder without a
	// repository is fair game.
	sniff = 8 << 10
)

// MaxFiles is how many files one search will read. A variable so a test can
// reach the ceiling without making twenty thousand files.
var MaxFiles = 20000

var junk = map[string]bool{
	".git": true, "node_modules": true, ".next": true, "vendor": true,
	".venv": true, "__pycache__": true, "dist": true, "build": true,
	".DS_Store": true,
}

type Query struct {
	Text  string `json:"text"`
	Regex bool   `json:"regex"`
	Case  bool   `json:"case"` // true: tell upper from lower
	Word  bool   `json:"word"`
	Glob  string `json:"glob"` // e.g. *.go, or src/*.ts
}

// Hit is one matching line, with every match on it. Per line rather than per
// match: a line with four matches is one thing to look at, not four.
type Hit struct {
	Path   string   `json:"path"` // relative to the folder searched
	Line   int      `json:"line"`
	Text   string   `json:"text"`
	Ranges [][2]int `json:"ranges"` // byte offsets into Text
}

type Report struct {
	Hits    []Hit `json:"hits"`
	Files   int   `json:"files"`   // files that had something
	Scanned int   `json:"scanned"` // files read
	// Capped names every bound that was reached, so the window can say the list
	// is short rather than pretending it is all there is.
	Capped []string `json:"capped"`
	TookMs int64    `json:"took_ms"`
}

func (q Query) compile() (*regexp.Regexp, error) {
	pattern := q.Text
	if !q.Regex {
		pattern = regexp.QuoteMeta(pattern)
	}
	// WORD is not put into the pattern: see wholeWord.
	if !q.Case {
		pattern = `(?i)` + pattern
	}
	return regexp.Compile(pattern)
}

/* wholeWord keeps the matches that stand on their own.
 *
 * It used to be `\b` in the pattern, and Go's `\b` is an ASCII word boundary:
 * a query beginning or ending in é, ñ or a bracket could not match anywhere,
 * so WORD turned "été" into "nothing found" without a word. The neighbours
 * are judged here instead, as characters — a letter, a digit or an
 * underscore on either side means it is part of something longer.
 */
func wholeWord(text string, where [][]int) [][]int {
	isWord := func(r rune) bool { return r == '_' || unicode.IsLetter(r) || unicode.IsDigit(r) }
	out := where[:0]
	for _, w := range where {
		if w[0] > 0 {
			if r, _ := utf8.DecodeLastRuneInString(text[:w[0]]); isWord(r) {
				continue
			}
		}
		if w[1] < len(text) {
			if r, _ := utf8.DecodeRuneInString(text[w[1]:]); isWord(r) {
				continue
			}
		}
		out = append(out, w)
	}
	return out
}

/* files lists what to read.
 *
 * Inside a repository git decides, so what is ignored is ignored exactly the
 * way the project already means it. Outside one, the tree is walked and the
 * usual heaps are stepped over.
 *
 * Two ways git's answer is not the answer. When git is not there, or refuses
 * — a mounted volume trips its ownership check — the walk is used and the
 * report says "ignore": the project's ignore rules were not applied, and a
 * .env in the results is the reason that has to be said. And when git
 * answers with nothing, the folder itself may be one the repository ignores
 * (build/, dist/, vendor/), which is not the same as an empty folder; the
 * walk decides then.
 */
func files(ctx context.Context, root string) (list []string, byGit bool, err error) {
	cmd := git.Command(ctx, root, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
	out, gitErr := cmd.Output()
	if gitErr == nil {
		for _, name := range strings.Split(string(out), "\x00") {
			if name == "" {
				continue
			}
			list = append(list, name)
		}
		if len(list) > 0 {
			return list, true, nil
		}
	}
	// git said nothing usable: not a repository, no git, or a folder the
	// repository ignores. The walk decides, and byGit says the rules did not.
	byGit, list = false, nil
	err = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // an unreadable corner is not a reason to stop
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		name := d.Name()
		if d.IsDir() {
			if path != root && (junk[name] || strings.HasPrefix(name, ".")) {
				return fs.SkipDir
			}
			return nil
		}
		if junk[name] {
			return nil
		}
		// Same reason as above: a fifo, a device or a socket is not something
		// to open.
		if info, err := d.Info(); err == nil && !info.Mode().IsRegular() {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return nil
		}
		list = append(list, filepath.ToSlash(rel))
		return nil
	})
	return list, false, err
}

// inRepo says whether git would have had a say here at all. It decides whether
// a walk means "the ignore rules were skipped" or simply "there are none".
func inRepo(ctx context.Context, root string) bool {
	out, err := git.Command(ctx, root, "rev-parse", "--is-inside-work-tree").Output()
	return err == nil && strings.TrimSpace(string(out)) == "true"
}

// hasGitDir looks for a .git up the tree without asking git — for the report
// line that says the rules were skipped, when git itself is what is missing.
func hasGitDir(root string) bool {
	for dir := root; ; dir = filepath.Dir(dir) {
		if _, err := os.Lstat(filepath.Join(dir, ".git")); err == nil {
			return true
		}
		if filepath.Dir(dir) == dir {
			return false
		}
	}
}

func matchesGlob(glob, rel string) bool {
	if glob == "" {
		return true
	}
	target := filepath.Base(rel)
	if strings.ContainsAny(glob, "/\\") {
		target = rel
	}
	ok, err := filepath.Match(glob, target)
	return err == nil && ok
}

// Search reads the folder and returns what it found, plus what it did not get
// to.
func Search(root string, q Query) (Report, error) {
	started := time.Now()
	report := Report{Hits: []Hit{}, Capped: []string{}}
	if strings.TrimSpace(q.Text) == "" {
		return report, nil
	}
	re, err := q.compile()
	if err != nil {
		return report, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), Deadline)
	defer cancel()

	cap := func(what string) {
		for _, had := range report.Capped {
			if had == what {
				return
			}
		}
		report.Capped = append(report.Capped, what)
	}

	list, byGit, err := files(ctx, root)
	if err != nil && len(list) == 0 {
		if ctx.Err() != nil {
			// The time went on listing. That is a short answer, not a fault.
			cap("time")
			report.TookMs = time.Since(started).Milliseconds()
			return report, nil
		}
		return report, err
	}
	if !byGit && len(list) > 0 && (hasGitDir(root) || inRepo(ctx, root)) {
		cap("ignore")
	}

	/* The glob first, the ceiling second.
	 *
	 * The other way round a glob that selects one file among twenty-five
	 * thousand found nothing: the list was cut at twenty thousand before the
	 * glob had looked, and the notice said "the first 20000 files only" about
	 * a search that never reached the file it was for. */
	if q.Glob != "" {
		kept := list[:0]
		for _, rel := range list {
			if matchesGlob(q.Glob, rel) {
				kept = append(kept, rel)
			}
		}
		list = kept
	}
	if len(list) > MaxFiles {
		list = list[:MaxFiles]
		cap("files")
	}

	for _, rel := range list {
		if ctx.Err() != nil {
			cap("time")
			break
		}
		if len(report.Hits) >= MaxHits {
			cap("hits")
			break
		}
		full := filepath.Join(root, filepath.FromSlash(rel))
		/* Lstat, not Stat: a link is not followed.
		 *
		 * git lists links as files, and a repository can contain
		 * `key -> ~/.ssh/id_rsa`. Followed, that file's lines came back as
		 * hits — content from outside the folder, shown in the window, and
		 * over the network when remote access is on. What a link points at
		 * is searched where it lives, if it lives in this folder at all. */
		info, err := os.Lstat(full)
		if err != nil || info.IsDir() {
			continue
		}
		/* Only ordinary files are read.
		 *
		 * A named pipe in the folder hung the whole search for ever: os.Open on
		 * a fifo blocks until somebody writes to it, and the deadline here is a
		 * context, which os.Open never consults. The request never came back and
		 * each repeat left another goroutine stuck. Measured — fifteen seconds
		 * of waiting and no answer. Devices and sockets are the same shape of
		 * trap, and none of them is a file anybody meant to search. */
		if !info.Mode().IsRegular() {
			continue
		}
		if info.Size() > MaxFileSize {
			cap("size")
			continue
		}
		f, err := os.Open(full)
		if err != nil {
			continue
		}
		head := make([]byte, sniff)
		n, _ := f.Read(head)
		if bytes.IndexByte(head[:n], 0) >= 0 {
			f.Close()
			continue // binary
		}
		if _, err := f.Seek(0, 0); err != nil {
			f.Close()
			continue
		}
		report.Scanned++

		found := false
		scanner := bufio.NewScanner(f)
		scanner.Buffer(make([]byte, 0, 64<<10), MaxFileSize)
		for line := 1; scanner.Scan(); line++ {
			if len(report.Hits) >= MaxHits {
				cap("hits")
				break
			}
			text := scanner.Text()
			where := re.FindAllStringIndex(text, -1)
			if q.Word {
				where = wholeWord(text, where)
			}
			if len(where) == 0 {
				continue
			}
			found = true
			// A very long line is cut, and the ranges with it: the window shows
			// this text, so an offset past its end would land nowhere. Cut
			// between characters — inside one it would show as garbage.
			if len(text) > MaxLineLen {
				end := MaxLineLen
				for end > 0 && !utf8.RuneStart(text[end]) {
					end--
				}
				text = text[:end]
				cap("line")
			}
			ranges := make([][2]int, 0, len(where))
			for _, w := range where {
				if w[0] >= len(text) {
					continue
				}
				end := w[1]
				if end > len(text) {
					end = len(text)
				}
				ranges = append(ranges, [2]int{w[0], end})
			}
			report.Hits = append(report.Hits, Hit{Path: rel, Line: line, Text: text, Ranges: ranges})
		}
		f.Close()
		if found {
			report.Files++
		}
	}
	report.TookMs = time.Since(started).Milliseconds()
	return report, nil
}
