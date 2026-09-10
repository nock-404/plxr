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
)

const (
	MaxHits     = 500
	MaxFileSize = 1 << 20 // 1 MB: past that it is data, not source
	MaxLineLen  = 400
	MaxFiles    = 20000
	Deadline    = 5 * time.Second
	// Skipped wherever they appear. Everything else in a folder without a
	// repository is fair game.
	sniff = 8 << 10
)

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
	if q.Word {
		pattern = `\b(?:` + pattern + `)\b`
	}
	if !q.Case {
		pattern = `(?i)` + pattern
	}
	return regexp.Compile(pattern)
}

// files lists what to read. Inside a repository git decides, so what is ignored
// is ignored exactly the way the project already means it. Outside one, the
// tree is walked and the usual heaps are stepped over.
func files(ctx context.Context, root string) ([]string, bool, error) {
	cmd := git.Command(ctx, root, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
	if out, err := cmd.Output(); err == nil {
		var list []string
		for _, name := range strings.Split(string(out), "\x00") {
			if name == "" {
				continue
			}
			list = append(list, name)
		}
		return list, true, nil
	}

	var list []string
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
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

	list, _, err := files(ctx, root)
	if err != nil && len(list) == 0 {
		return report, err
	}
	if len(list) > MaxFiles {
		list = list[:MaxFiles]
		report.Capped = append(report.Capped, "files")
	}

	cap := func(what string) {
		for _, had := range report.Capped {
			if had == what {
				return
			}
		}
		report.Capped = append(report.Capped, what)
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
		if !matchesGlob(q.Glob, rel) {
			continue
		}
		full := filepath.Join(root, filepath.FromSlash(rel))
		info, err := os.Stat(full)
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
			if where == nil {
				continue
			}
			found = true
			// A very long line is cut, and the ranges with it: the window shows
			// this text, so an offset past its end would land nowhere.
			if len(text) > MaxLineLen {
				text = text[:MaxLineLen]
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
