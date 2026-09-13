package git

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"plxr/internal/uierr"
)

/* What a folder's repository is, beyond what has changed in it right now.
 *
 * The window used to be able to say two things about an open folder: the
 * branch it is on, and the files that differ. Everything else a person looks
 * up before touching a folder — which commit HEAD sits on and what it did,
 * where the remote is, when it last spoke to it — was not asked for anywhere,
 * so half the view had nothing to put on screen and said "pick a file".
 */

// Remote is one remote and where it points.
type Remote struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// Remotes lists the remotes with their fetch URLs, in git's own order.
//
// `remote -v` prints each remote twice — once for fetch, once for push — and
// the two are usually the same address; listing both would fill the panel with
// the same line written out twice. The fetch URL is the one that says where
// the folder came from, so that is the one kept.
func Remotes(dir string) ([]Remote, error) {
	out, err := Run(dir, "remote", "-v")
	if err != nil {
		return nil, uierr.With("err.git.failed", err.Error())
	}
	list := []Remote{}
	seen := map[string]bool{}
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 || fields[2] != "(fetch)" || seen[fields[0]] {
			continue
		}
		seen[fields[0]] = true
		list = append(list, Remote{Name: fields[0], URL: fields[1]})
	}
	return list, nil
}

// Fetched is when this repository last heard from a remote, in milliseconds.
//
// Read off FETCH_HEAD's own timestamp rather than from any log: git writes
// that file on every fetch and pull, including one that brought nothing back,
// which is exactly the question — "have I looked lately", not "did anything
// arrive". Zero means it has never fetched.
func Fetched(dir string) int64 {
	gitDir, err := Run(dir, "rev-parse", "--absolute-git-dir")
	if err != nil || gitDir == "" {
		return 0
	}
	info, err := os.Stat(filepath.Join(gitDir, "FETCH_HEAD"))
	if err != nil {
		return 0
	}
	return info.ModTime().UnixMilli()
}

// CommitFile is one file a commit touched.
type CommitFile struct {
	Path string `json:"path"`
	// Status is git's own letter: A, M, D, R, C, T.
	Status  string `json:"status"`
	Renamed string `json:"renamed,omitempty"`
	Added   int    `json:"added"`
	Removed int    `json:"removed"`
	Binary  bool   `json:"binary"`
}

// CommitDetail is one commit read in full, with what it did to the files.
// Named apart from Commit, which is the verb in this package: the function
// that records what is staged.
//
// Hash is the short form the history lists and Full the whole one, because the
// short form is what a person reads and the long one is what they paste into
// another program.
type CommitDetail struct {
	Hash    string `json:"hash"`
	Full    string `json:"full"`
	Subject string `json:"subject"`
	Body    string `json:"body"`
	Author  string `json:"author"`
	Email   string `json:"email"`
	// When the commit was made, in milliseconds. Never git's own wording: git
	// says "3 days ago" in the language it was asked in, and this program asks
	// it in one fixed language so it can read its answers. A number has no
	// language; the window says it in its own.
	When int64 `json:"when"`
	// Refs is what points at this commit — branches and tags, as git's %D
	// writes them. Empty for a commit nothing names.
	Refs    string       `json:"refs"`
	Files   []CommitFile `json:"files"`
	Added   int          `json:"added"`
	Removed int          `json:"removed"`
}

// Show reads one commit in full. An empty ref means HEAD.
//
// Three calls rather than one clever one: the metadata, the status letters and
// the line counts come out of git in three shapes that cannot be interleaved
// safely in a single format string. --first-parent is there for merges, which
// `git show` otherwise reports as having touched nothing at all, and it does
// the right thing for a root commit, where diff-tree reports nothing either.
func Show(dir, ref string) (CommitDetail, error) {
	if strings.TrimSpace(ref) == "" {
		ref = "HEAD"
	}
	// A ref is the one argument here that comes from outside. Anything that
	// starts with a dash would be read as an option by git.
	if strings.HasPrefix(ref, "-") {
		return CommitDetail{}, uierr.With("err.git.badRef", ref)
	}
	c := CommitDetail{Files: []CommitFile{}}
	out, err := Raw(dir, "log", "-1", "--no-color", ref,
		"--format=%h%x00%H%x00%s%x00%b%x00%an%x00%ae%x00%at%x00%D")
	if err != nil {
		return c, uierr.With("err.git.noCommit", ref)
	}
	f := strings.Split(strings.TrimRight(string(out), "\n"), "\x00")
	if len(f) < 8 {
		return c, uierr.With("err.git.noCommit", ref)
	}
	c.Hash, c.Full, c.Subject = f[0], f[1], f[2]
	c.Body = strings.TrimSpace(f[3])
	c.Author, c.Email, c.When, c.Refs = f[4], f[5], millis(f[6]), f[7]

	toHere, err := relatively(dir)
	if err != nil {
		return c, err
	}

	byPath := map[string]*CommitFile{}
	order := []string{}
	raw, err := Raw(dir, "show", "--no-color", "--format=", "--name-status", "-z",
		"-M", "--first-parent", ref, "--", ".")
	if err != nil {
		// A commit whose diff cannot be read is still a commit worth showing.
		return c, nil
	}
	fields := strings.Split(string(raw), "\x00")
	for i := 0; i < len(fields); i++ {
		code := fields[i]
		if code == "" || i+1 >= len(fields) {
			continue
		}
		i++
		path := fields[i]
		one := &CommitFile{Status: code[:1]}
		// A rename or copy carries a score after the letter and two paths.
		if strings.HasPrefix(code, "R") || strings.HasPrefix(code, "C") {
			if i+1 >= len(fields) {
				continue
			}
			i++
			if from, ok := toHere(path); ok {
				one.Renamed = from
			} else {
				one.Renamed = path
			}
			path = fields[i]
		}
		here, inside := toHere(path)
		if !inside {
			continue
		}
		one.Path = here
		byPath[here] = one
		order = append(order, here)
	}

	if raw, err := Raw(dir, "show", "--no-color", "--format=", "--numstat", "-z",
		"-M", "--first-parent", ref, "--", "."); err == nil {
		into := map[string]*Change{}
		for p := range byPath {
			into[p] = &Change{Path: p}
		}
		counts(string(raw), into, false, toHere)
		for p, got := range into {
			byPath[p].Added, byPath[p].Removed, byPath[p].Binary = got.Added, got.Removed, got.Binary
		}
	}

	for _, p := range order {
		one := byPath[p]
		c.Files = append(c.Files, *one)
		c.Added += one.Added
		c.Removed += one.Removed
	}
	return c, nil
}

// StashCount is how many things are put aside, without reading them all.
func StashCount(dir string) int {
	out, err := Run(dir, "rev-list", "--walk-reflogs", "--count", "refs/stash")
	if err != nil {
		return 0
	}
	n, err := strconv.Atoi(strings.TrimSpace(out))
	if err != nil {
		return 0
	}
	return n
}
