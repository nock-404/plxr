package git

import (
	"os"
	"path/filepath"
	"plxr/internal/uierr"
	"strings"
)

// ---- What a branch did ----

// ReviewFile is one file the branch touched, measured from the merge-base to
// the working tree — committed, staged and unstaged all in one, because a
// review reads the branch, not the index.
type ReviewFile struct {
	Path string `json:"path"`
	// Status is git's own letter: A, M, D, R, C, T — or ? for a file git has
	// never seen, which is part of the branch's work all the same.
	Status  string `json:"status"`
	Renamed string `json:"renamed,omitempty"`
	Added   int    `json:"added"`
	Removed int    `json:"removed"`
	Binary  bool   `json:"binary"`
}

// Review is everything a branch changed against a base.
type Review struct {
	// Base is the ref the review was asked against; MergeBase the commit it
	// resolved to, which is what every diff is measured from.
	Base      string       `json:"base"`
	MergeBase string       `json:"merge_base"`
	Branch    string       `json:"branch"`
	Files     []ReviewFile `json:"files"`
	Added     int          `json:"added"`
	Removed   int          `json:"removed"`
	// Bases are the refs worth offering as a base: the local branches other
	// than this one, the upstream, and the fallback.
	Bases []string `json:"bases"`
	// Stashes ride along: the review panel lists them in its foot, and one
	// call is one round trip.
	Stashes []Stash `json:"stashes"`
}

// exists says whether git can resolve this ref to a commit.
func exists(dir, ref string) bool {
	_, err := Run(dir, "rev-parse", "--verify", "--quiet", ref+"^{commit}")
	return err == nil
}

// DefaultBase picks what a branch is most likely measured against: main or
// master when there is one, otherwise the upstream, otherwise ten commits
// back — and in a repository shorter than that, its first commit.
func DefaultBase(dir string) string {
	for _, name := range []string{"main", "master"} {
		if exists(dir, "refs/heads/"+name) {
			return name
		}
	}
	if up, err := Run(dir, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"); err == nil && up != "" {
		return up
	}
	if exists(dir, "HEAD~10") {
		return "HEAD~10"
	}
	if root, err := Run(dir, "rev-list", "--max-parents=0", "HEAD"); err == nil && root != "" {
		// More than one root is possible; the first line is enough of one.
		return strings.Fields(root)[0]
	}
	return "HEAD"
}

// MergeBase is the commit where the base and HEAD parted — what a branch
// review measures from, so commits the base gained since are not counted as
// the branch's own work.
func MergeBase(dir, base string) (string, error) {
	if strings.TrimSpace(base) == "" {
		base = DefaultBase(dir)
	}
	if !exists(dir, base) {
		return "", uierr.With("err.review.badBase", base)
	}
	out, err := Run(dir, "merge-base", base, "HEAD")
	if err != nil || out == "" {
		// Unrelated histories, or a base that is HEAD's own descendant with
		// nothing in common: the base itself is the honest answer.
		out, err = Run(dir, "rev-parse", base+"^{commit}")
		if err != nil {
			return "", uierr.With("err.review.badBase", base)
		}
	}
	return out, nil
}

// Bases lists the refs worth offering as a base: main/master first if present,
// the upstream, then every other local branch, then the fallback.
func bases(dir string) []string {
	seen := map[string]bool{}
	list := []string{}
	add := func(name string) {
		if name == "" || seen[name] {
			return
		}
		seen[name] = true
		list = append(list, name)
	}
	current, _ := Run(dir, "rev-parse", "--abbrev-ref", "HEAD")
	for _, name := range []string{"main", "master"} {
		if name != current && exists(dir, "refs/heads/"+name) {
			add(name)
		}
	}
	if up, err := Run(dir, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"); err == nil {
		add(up)
	}
	if branches, err := Branches(dir); err == nil {
		for _, b := range branches {
			if !b.Current {
				add(b.Name)
			}
		}
	}
	if exists(dir, "HEAD~10") {
		add("HEAD~10")
	}
	return list
}

// ReviewOf lists what the working tree holds that the merge-base did not:
// `git diff --name-status <mb>` for everything git tracks, plus the untracked
// files — which are part of the branch's work even though no diff names them.
// Scoped to the folder git was asked in, the way Changes is.
func ReviewOf(dir, base string) (Review, error) {
	if strings.TrimSpace(base) == "" {
		base = DefaultBase(dir)
	}
	mb, err := MergeBase(dir, base)
	if err != nil {
		return Review{}, err
	}
	out := Review{Base: base, MergeBase: mb, Files: []ReviewFile{}, Bases: bases(dir), Stashes: []Stash{}}
	out.Branch, _ = Run(dir, "rev-parse", "--abbrev-ref", "HEAD")
	toHere, err := relatively(dir)
	if err != nil {
		return out, err
	}

	byPath := map[string]*ReviewFile{}
	order := []string{}
	raw, err := Raw(dir, "diff", "--name-status", "-z", "-M", mb, "--", ".")
	if err != nil {
		return out, uierr.With("err.git.failed", strings.TrimSpace(said(raw, err)))
	}
	fields := strings.Split(string(raw), "\x00")
	for i := 0; i < len(fields); i++ {
		code := fields[i]
		if code == "" || i+1 >= len(fields) {
			continue
		}
		i++
		path := fields[i]
		f := &ReviewFile{Status: code[:1]}
		// A rename or copy carries a score after the letter and two paths.
		if strings.HasPrefix(code, "R") || strings.HasPrefix(code, "C") {
			if i+1 >= len(fields) {
				continue
			}
			i++
			if from, ok := toHere(path); ok {
				f.Renamed = from
			} else {
				f.Renamed = path
			}
			path = fields[i]
		}
		here, inside := toHere(path)
		if !inside {
			continue
		}
		f.Path = here
		byPath[here] = f
		order = append(order, here)
	}

	// The counts, from the same range.
	if raw, err := Raw(dir, "diff", "--numstat", "-z", "-M", mb, "--", "."); err == nil {
		into := map[string]*Change{}
		for p, f := range byPath {
			into[p] = &Change{Path: f.Path}
		}
		counts(string(raw), into, false, toHere)
		for p, c := range into {
			byPath[p].Added, byPath[p].Removed, byPath[p].Binary = c.Added, c.Removed, c.Binary
		}
	}

	// Untracked files: a branch's new work that no diff has heard of yet.
	if changes, err := Changes(dir); err == nil {
		for _, c := range changes {
			if !c.Untracked() || byPath[c.Path] != nil {
				continue
			}
			f := &ReviewFile{Path: c.Path, Status: "?", Added: c.Added, Binary: c.Binary}
			byPath[c.Path] = f
			order = append(order, c.Path)
		}
	}

	for _, p := range order {
		f := byPath[p]
		out.Files = append(out.Files, *f)
		out.Added += f.Added
		out.Removed += f.Removed
	}
	if list, err := Stashes(dir); err == nil {
		out.Stashes = list
	}
	return out, nil
}

// ---- Throwing changes away ----

// Discard puts tracked files back the way the index has them and removes
// untracked ones — the working-tree half of a change, gone.
//
// `git checkout -- path` for what git tracks, never `git clean`: clean takes
// pathspecs too but also honours -x and -d in ways that reach further than
// the one file somebody named, and a deletion of one named file is a thing
// this program can do itself. The caller has already held every path to the
// folder's leash; here they are taken as they come.
func Discard(dir string, paths []string) error {
	if len(paths) == 0 {
		return uierr.New("err.git.noPaths")
	}
	known := []string{}
	fresh := []string{}
	for _, p := range paths {
		if tracked(dir, p) {
			known = append(known, p)
		} else {
			fresh = append(fresh, p)
		}
	}
	if err := each(dir, known, "checkout"); err != nil {
		return err
	}
	var firstErr error
	for _, p := range fresh {
		full := filepath.Join(dir, filepath.FromSlash(p))
		// RemoveAll, because status --untracked-files=all names files, but a
		// folder that is all new can be named by a caller as well. The leash
		// on the path is the caller's; the root itself is never a path here.
		if err := os.RemoveAll(full); err != nil && firstErr == nil {
			firstErr = uierr.With("err.git.failed", err.Error())
		}
	}
	return firstErr
}

// ---- Stashes ----

// Stash is one entry on the stash list.
type Stash struct {
	// Ref is git's own name for it — stash@{0} — which is what pop and drop
	// take.
	Ref     string `json:"ref"`
	Subject string `json:"subject"`
	When    int64  `json:"when"` // milliseconds
}

var (
	ErrNothingToStash = uierr.New("err.stash.nothing")
	ErrNoStash        = uierr.New("err.stash.none")
)

// StashPush puts every change — staged, unstaged and untracked — aside under
// a message, and leaves the tree clean.
func StashPush(dir, message string) error {
	args := []string{"stash", "push", "--include-untracked"}
	if strings.TrimSpace(message) != "" {
		args = append(args, "-m", message)
	}
	out, err := Raw(dir, args...)
	text := said(out, err)
	if err != nil {
		return uierr.With("err.git.failed", strings.TrimSpace(text))
	}
	// git exits 0 and says so when there is nothing to put aside; the window
	// should say so too, rather than reporting a stash that does not exist.
	if strings.Contains(strings.ToLower(text), "no local changes to save") {
		return ErrNothingToStash
	}
	return nil
}

// StashPop takes the newest stash back into the tree and drops it — unless
// applying it conflicts, in which case git keeps the stash and says so, and
// so does this.
func StashPop(dir string) error {
	out, err := Raw(dir, "stash", "pop")
	if err == nil {
		return nil
	}
	text := strings.TrimSpace(said(out, err))
	low := strings.ToLower(text)
	switch {
	case strings.Contains(low, "no stash entries found"):
		return ErrNoStash
	case strings.Contains(low, "conflict"):
		return uierr.With("err.stash.conflict", text)
	case strings.Contains(low, "would be overwritten"), strings.Contains(low, "local changes"):
		return uierr.With("err.stash.wouldLose", text)
	}
	return uierr.With("err.git.failed", text)
}

// Stashes lists what is put aside, newest first, as git keeps it.
func Stashes(dir string) ([]Stash, error) {
	out, err := Raw(dir, "stash", "list", "--no-color", "--format=%gd%x00%s%x00%at%x01")
	if err != nil {
		return nil, uierr.With("err.git.failed", strings.TrimSpace(said(out, err)))
	}
	list := []Stash{}
	for _, record := range strings.Split(string(out), "\x01") {
		record = strings.TrimLeft(record, "\n")
		if record == "" {
			continue
		}
		f := strings.Split(record, "\x00")
		if len(f) < 3 {
			continue
		}
		list = append(list, Stash{Ref: f[0], Subject: f[1], When: millis(f[2])})
	}
	return list, nil
}
