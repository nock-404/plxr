// Package git is the one place plxr runs git.
//
// It was in three: internal/marks had a wrapper of its own for taking and
// restoring marks, internal/files ran status for the tree, and nothing shared a
// timeout or a way of reading git's answers. Anything that wants git goes
// through here now.
//
// Two habits throughout. Everything that names a file uses -z, because a path
// may hold a space, a newline or a quote and git's default C-quoting then has
// to be undone by hand — badly, once, in every parser. And every call runs
// under a deadline: git on a large repository over a network mount is not
// something to wait on for ever.
package git

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"plxr/internal/sys"
	"plxr/internal/uierr"
	"strconv"
	"strings"
	"time"
)

// Timeout is how long any single git call may take.
const Timeout = 20 * time.Second

// Run calls git in a directory and hands back its output, trimmed.
func Run(dir string, args ...string) (string, error) {
	out, err := Raw(dir, args...)
	return strings.TrimSpace(string(out)), err
}

// Raw is Run without the trimming, for output where the last byte matters —
// a file without a closing newline, or anything with -z in it.
func Raw(dir string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), Timeout)
	defer cancel()
	cmd := sys.Quiet(exec.CommandContext(ctx, "git", args...))
	cmd.Dir = dir
	return cmd.Output()
}

// IsRepo reports whether this directory is inside a working tree.
func IsRepo(dir string) bool {
	out, err := Run(dir, "rev-parse", "--is-inside-work-tree")
	return err == nil && out == "true"
}

// Top is where the repository begins, resolved.
func Top(dir string) (string, error) {
	return Run(dir, "rev-parse", "--show-toplevel")
}

// Change is one file git has something to say about.
//
// Index and Work are the two letters git prints, kept apart on purpose: a file
// can be staged and changed again since, and a list that folds the two into one
// word cannot show that. Renamed carries where it came from.
type Change struct {
	Path    string `json:"path"`
	Index   string `json:"index"` // as staged: M, A, D, R, C, or a space
	Work    string `json:"work"`  // in the working tree
	Renamed string `json:"renamed,omitempty"`
	// Counted twice, because staged and unstaged are two different numbers for
	// the same file. Showing one total in both groups said the same thing about
	// a change that had been staged and a later one that had not.
	Added         int `json:"added"`
	Removed       int `json:"removed"`
	StagedAdded   int `json:"staged_added"`
	StagedRemoved int `json:"staged_removed"`
	// Binary: git counts nothing for these, and a diff of them is not text.
	Binary bool `json:"binary"`
}

// Staged says whether anything of this file is in the index.
func (c Change) Staged() bool { return c.Index != " " && c.Index != "?" && c.Index != "" }

// Untracked says whether git has never seen this file.
func (c Change) Untracked() bool { return c.Index == "?" && c.Work == "?" }

// Changes lists what differs, with how many lines.
//
// The two letters come from status --porcelain=v1, which is the form promised
// to stay stable between versions. The counts come from --numstat, asked twice
// because staged and unstaged are two different questions and one answer cannot
// carry both.
func Changes(dir string) ([]Change, error) {
	out, err := Raw(dir, "status", "--porcelain=v1", "-z", "--untracked-files=all")
	if err != nil {
		return nil, err
	}

	byPath := map[string]*Change{}
	order := []string{}
	fields := strings.Split(string(out), "\x00")
	for i := 0; i < len(fields); i++ {
		line := fields[i]
		if len(line) < 4 {
			continue
		}
		code, path := line[:2], line[3:]
		c := &Change{Path: path, Index: string(code[0]), Work: string(code[1])}
		// A rename prints the new name on this line and the old one in the next
		// field. Reading it is not optional: left in place it becomes the next
		// entry, as a path with a two-letter code chopped off its front.
		if strings.ContainsAny(code, "RC") && i+1 < len(fields) {
			i++
			c.Renamed = fields[i]
		}
		byPath[path] = c
		order = append(order, path)
	}

	for _, staged := range []bool{false, true} {
		args := []string{"diff", "--numstat", "-z"}
		if staged {
			args = append(args, "--cached")
		}
		out, err := Raw(dir, args...)
		if err != nil {
			continue // a repository with no commits yet has nothing to compare
		}
		counts(string(out), byPath, staged)
	}

	// An untracked file is in no diff at all, so git counts nothing for it —
	// and a new file reported as "+0 −0" reads as an empty one. Its own lines
	// are what it adds.
	for _, c := range byPath {
		if !c.Untracked() || c.Binary {
			continue
		}
		if n, binary := lines(dir, c.Path); binary {
			c.Binary = true
		} else {
			c.Added = n
		}
	}

	list := make([]Change, 0, len(order))
	for _, p := range order {
		list = append(list, *byPath[p])
	}
	return list, nil
}

// counts reads --numstat -z, whose shape is not obvious: the two numbers and a
// tab come first, then the path as its own NUL-terminated field — and for a
// rename, two of them, old and new.
// lines counts the lines of a file, and says so if it turns out not to be text.
func lines(dir, path string) (int, bool) {
	body, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(path)))
	if err != nil {
		return 0, false
	}
	if bytes.IndexByte(body, 0) >= 0 {
		return 0, true
	}
	n := bytes.Count(body, []byte("\n"))
	// A last line without a newline still counts.
	if len(body) > 0 && body[len(body)-1] != '\n' {
		n++
	}
	return n, false
}

func counts(out string, into map[string]*Change, staged bool) {
	fields := strings.Split(out, "\x00")
	for i := 0; i < len(fields); i++ {
		head := fields[i]
		if head == "" {
			continue
		}
		parts := strings.SplitN(head, "\t", 3)
		if len(parts) < 3 {
			continue
		}
		added, removed, rest := parts[0], parts[1], parts[2]
		path := rest
		if path == "" {
			// A rename: the paths are the next two fields.
			if i+2 < len(fields) {
				i += 2
				path = fields[i]
			} else {
				continue
			}
		}
		c, ok := into[path]
		if !ok {
			continue
		}
		if added == "-" || removed == "-" {
			c.Binary = true
			continue
		}
		a, _ := strconv.Atoi(added)
		r, _ := strconv.Atoi(removed)
		if staged {
			c.StagedAdded, c.StagedRemoved = a, r
		} else {
			c.Added, c.Removed = a, r
		}
	}
}

// ---- The difference itself ----

// Line is one line of a diff, with what git made of it.
type Line struct {
	// Kind: " " kept, "+" added, "-" removed, "\\" a note such as
	// "no newline at end of file".
	Kind string `json:"kind"`
	Text string `json:"text"`
	// Old and New are the line numbers on each side, 0 where there is none.
	Old int `json:"old"`
	New int `json:"new"`
}

// Hunk is one stretch of a file that differs, as git groups it.
type Hunk struct {
	Header string `json:"header"` // the @@ line, kept for what it says after it
	Lines  []Line `json:"lines"`
}

type Diff struct {
	Path   string `json:"path"`
	Staged bool   `json:"staged"`
	Hunks  []Hunk `json:"hunks"`
	Binary bool   `json:"binary"`
	// Empty means git found nothing to show — the file matches what it is
	// compared against. Said plainly rather than as an empty list, which reads
	// as "something went wrong".
	Empty bool `json:"empty"`
}

// Difference returns what changed in one file, parsed.
//
// Unified diff rather than a merge view: it is what git already produces, so
// there is one parser and no second opinion about what changed, and the colours
// come from this project's own tokens instead of a dependency's stylesheet.
func Difference(dir, path string, staged bool) (Diff, error) {
	out := Diff{Path: path, Staged: staged, Hunks: []Hunk{}}
	args := []string{"diff", "--no-color", "--no-ext-diff", "-U3"}
	if staged {
		args = append(args, "--cached")
	}
	// -- keeps a path that starts with a dash from being read as an option.
	args = append(args, "--", path)
	raw, err := Raw(dir, args...)
	if err != nil {
		return out, err
	}
	if len(raw) == 0 {
		// Untracked: there is nothing to compare against, so the whole file is
		// the difference. /dev/null on one side is how git says that itself.
		raw, err = Raw(dir, "diff", "--no-color", "--no-ext-diff", "-U3",
			"--no-index", "--", devNull, path)
		if err != nil && len(raw) == 0 {
			out.Empty = true
			return out, nil
		}
	}
	out.Hunks, out.Binary = parse(string(raw))
	out.Empty = len(out.Hunks) == 0 && !out.Binary
	return out, nil
}

func parse(text string) ([]Hunk, bool) {
	hunks := []Hunk{}
	var here *Hunk
	oldNo, newNo := 0, 0
	for _, line := range strings.Split(text, "\n") {
		switch {
		case strings.HasPrefix(line, "Binary files") || strings.HasPrefix(line, "GIT binary patch"):
			return hunks, true
		case strings.HasPrefix(line, "@@"):
			o, n := heads(line)
			oldNo, newNo = o, n
			hunks = append(hunks, Hunk{Header: line, Lines: []Line{}})
			here = &hunks[len(hunks)-1]
		case here == nil:
			// The file header, before the first @@. Nothing to show.
			continue
		case strings.HasPrefix(line, "+"):
			here.Lines = append(here.Lines, Line{Kind: "+", Text: line[1:], New: newNo})
			newNo++
		case strings.HasPrefix(line, "-"):
			here.Lines = append(here.Lines, Line{Kind: "-", Text: line[1:], Old: oldNo})
			oldNo++
		case strings.HasPrefix(line, "\\"):
			here.Lines = append(here.Lines, Line{Kind: "\\", Text: strings.TrimSpace(line[1:])})
		case strings.HasPrefix(line, " "):
			here.Lines = append(here.Lines, Line{Kind: " ", Text: line[1:], Old: oldNo, New: newNo})
			oldNo++
			newNo++
		}
	}
	return hunks, false
}

// heads reads the two starting line numbers out of an @@ header.
func heads(line string) (int, int) {
	// @@ -12,7 +12,9 @@ optional context
	body := line
	if i := strings.Index(body[2:], "@@"); i >= 0 {
		body = body[:i+4]
	}
	old, new := 0, 0
	for _, part := range strings.Fields(strings.Trim(body, "@ ")) {
		if len(part) < 2 {
			continue
		}
		n, _ := strconv.Atoi(strings.SplitN(part[1:], ",", 2)[0])
		switch part[0] {
		case '-':
			old = n
		case '+':
			new = n
		}
	}
	if old == 0 {
		old = 1
	}
	if new == 0 {
		new = 1
	}
	return old, new
}

// ---- Staging and committing ----

// chunk is how many paths go into one git call.
//
// Not --pathspec-from-file, which arrived in git 2.25 for add and 2.26 for
// restore: plxr should not need a git from 2020. Paths go as arguments, in
// batches, because a command line has a length limit and a repository can have
// thousands of changed files.
const chunk = 200

func each(dir string, paths []string, args ...string) error {
	if len(paths) == 0 {
		return nil
	}
	for i := 0; i < len(paths); i += chunk {
		end := i + chunk
		if end > len(paths) {
			end = len(paths)
		}
		// -- so a path that begins with a dash is a path and not an option.
		call := append(append([]string{}, args...), "--")
		call = append(call, paths[i:end]...)
		if _, err := Run(dir, call...); err != nil {
			return err
		}
	}
	return nil
}

// Stage puts files into the index.
func Stage(dir string, paths []string) error { return each(dir, paths, "add", "-A") }

// Unstage takes files out of the index and leaves the working tree alone.
//
// git restore --staged is the modern spelling and needs git 2.23; reset is
// older than anything plxr will meet and does the same thing here.
func Unstage(dir string, paths []string) error { return each(dir, paths, "reset", "-q") }

// Commit records what is staged.
//
// The message travels as one argument, never through a shell, so a newline or a
// quote in it is just text. Failures are classified rather than passed on raw:
// git's own words are English prose in the middle of a translated window.
func Commit(dir, message string, amend bool) (string, error) {
	if strings.TrimSpace(message) == "" {
		return "", ErrNoMessage
	}
	args := []string{"commit", "-m", message}
	if amend {
		args = append(args, "--amend")
	}
	out, err := Raw(dir, args...)
	if err == nil {
		return Run(dir, "rev-parse", "--short", "HEAD")
	}
	said := string(out)
	if ee, ok := err.(*exec.ExitError); ok {
		said += string(ee.Stderr)
	}
	return "", classify(said)
}

/* The ways a commit refuses, as codes the window can say in either language.
 *
 * Through uierr like every other error in plxr, and not through a type of this
 * package's own: errors.py finds codes by looking for uierr.New and uierr.With,
 * so a package that mints them another way is a package the gate cannot check.
 * Mine were invisible to it until this. */
var (
	ErrNoMessage = uierr.New("err.commit.noMessage")
	ErrNothing   = uierr.New("err.commit.nothing")
	ErrNoIdent   = uierr.New("err.commit.noIdentity")
	ErrHook      = uierr.New("err.commit.hookRefused")
)

// classify reads git's answer.
//
// Deliberately after the fact rather than before. A pre-check with
// `git var GIT_AUTHOR_IDENT` looks right and is not: it exits 0 with an ident
// guessed from the account name and the hostname, so it says yes exactly when
// the commit will later say no.
func classify(said string) error {
	low := strings.ToLower(said)
	switch {
	case strings.Contains(low, "nothing to commit"),
		strings.Contains(low, "no changes added to commit"),
		strings.Contains(low, "nothing added to commit"):
		return ErrNothing
	case strings.Contains(low, "please tell me who you are"),
		strings.Contains(low, "unable to auto-detect email address"),
		strings.Contains(low, "empty ident name"):
		return ErrNoIdent
	case strings.Contains(low, "hook"):
		return ErrHook
	}
	return uierr.With("err.git.failed", strings.TrimSpace(said))
}

// Entry is one commit, as the history list shows it.
type Entry struct {
	Hash    string `json:"hash"`
	Subject string `json:"subject"`
	Author  string `json:"author"`
	When    string `json:"when"` // relative, as git words it
}

// Log returns the last commits.
func Log(dir string, n int) ([]Entry, error) {
	if n <= 0 {
		n = 20
	}
	// %x00 between the fields and %x01 between records: neither appears in a
	// commit message, and a subject may hold anything else including tabs.
	out, err := Raw(dir, "log", "--no-color", "-n", strconv.Itoa(n),
		"--format=%h%x00%s%x00%an%x00%ar%x01")
	if err != nil {
		// A repository with no commits has no log, and that is not a fault.
		return []Entry{}, nil
	}
	list := []Entry{}
	for _, record := range strings.Split(string(out), "\x01") {
		record = strings.TrimLeft(record, "\n")
		if record == "" {
			continue
		}
		f := strings.Split(record, "\x00")
		if len(f) < 4 {
			continue
		}
		list = append(list, Entry{Hash: f[0], Subject: f[1], Author: f[2], When: f[3]})
	}
	return list, nil
}

// Where says which branch this is and how it stands against its upstream.
type Where struct {
	Branch   string `json:"branch"`
	Upstream string `json:"upstream,omitempty"`
	Ahead    int    `json:"ahead"`
	Behind   int    `json:"behind"`
	// Detached: no branch, just a commit. Committing here is not wrong but it
	// is easy to lose, so the window says so.
	Detached bool `json:"detached"`
}

func Position(dir string) (Where, error) {
	w := Where{}
	branch, err := Run(dir, "rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return w, uierr.With("err.git.failed", err.Error())
	}
	if branch == "HEAD" {
		w.Detached = true
		w.Branch, _ = Run(dir, "rev-parse", "--short", "HEAD")
		return w, nil
	}
	w.Branch = branch
	up, err := Run(dir, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
	if err != nil {
		return w, nil // no upstream is an ordinary state, not a failure
	}
	w.Upstream = up
	counts, err := Run(dir, "rev-list", "--left-right", "--count", up+"...HEAD")
	if err != nil {
		return w, nil
	}
	parts := strings.Fields(counts)
	if len(parts) == 2 {
		w.Behind, _ = strconv.Atoi(parts[0])
		w.Ahead, _ = strconv.Atoi(parts[1])
	}
	return w, nil
}

// ---- Branches ----

// Branch is one branch, with where it stands.
type Branch struct {
	Name     string `json:"name"`
	Current  bool   `json:"current"`
	Upstream string `json:"upstream,omitempty"`
	Ahead    int    `json:"ahead"`
	Behind   int    `json:"behind"`
	Subject  string `json:"subject"` // what its last commit says
	When     string `json:"when"`
}

// Branches lists the local branches, the current one first.
//
// One call with a format of our own rather than parsing `git branch`, whose
// output is meant for reading: the asterisk, the arrow for a worktree, the
// bracketed distance — all of it is prose that changes between versions.
// %(HEAD) says which one is checked out; the two counts come from
// %(upstream:track), which is prose too, so they are asked for separately.
func Branches(dir string) ([]Branch, error) {
	/* The separators are written by git, not by us.
	 *
	 * A real NUL cannot go in an argument — exec refuses it outright, which is
	 * what "fork/exec: invalid argument" turned out to mean — but for-each-ref
	 * understands %xx in its format and emits the byte itself. So the argument
	 * stays printable ASCII and the output is still split on bytes that cannot
	 * appear in a branch name or a commit subject. */
	out, err := Raw(dir, "for-each-ref", "--sort=-committerdate",
		"--format=%(HEAD)%00%(refname:short)%00%(upstream:short)%00"+
			"%(contents:subject)%00%(committerdate:relative)%01",
		"refs/heads")
	if err != nil {
		return nil, uierr.With("err.git.failed", err.Error())
	}
	list := []Branch{}
	for _, record := range strings.Split(string(out), "\x01") {
		record = strings.Trim(record, "\n")
		if record == "" {
			continue
		}
		f := strings.Split(record, "\x00")
		if len(f) < 5 {
			continue
		}
		b := Branch{
			Name:     f[1],
			Current:  strings.TrimSpace(f[0]) == "*",
			Upstream: f[2],
			Subject:  f[3],
			When:     f[4],
		}
		if b.Upstream != "" {
			if counts, err := Run(dir, "rev-list", "--left-right", "--count",
				b.Upstream+"..."+b.Name); err == nil {
				parts := strings.Fields(counts)
				if len(parts) == 2 {
					b.Behind, _ = strconv.Atoi(parts[0])
					b.Ahead, _ = strconv.Atoi(parts[1])
				}
			}
		}
		list = append(list, b)
	}
	// The one you are on belongs at the top, whatever its last commit's date.
	for i := range list {
		if list[i].Current && i != 0 {
			one := list[i]
			list = append(list[:i], list[i+1:]...)
			list = append([]Branch{one}, list...)
			break
		}
	}
	return list, nil
}

// Switch changes branch, and makes a new one when asked.
//
// Deliberately not stricter than git. Refusing whenever the tree is dirty was
// the first idea and it is wrong: git carries uncommitted changes across a
// switch whenever it can, which is the ordinary way of working. When it cannot,
// git says so and that refusal is passed on.
func Switch(dir, name string, create bool) error {
	if strings.TrimSpace(name) == "" {
		return uierr.New("err.branch.noName")
	}
	args := []string{"switch"}
	if create {
		args = append(args, "-c")
	}
	args = append(args, name)
	out, err := Raw(dir, args...)
	if err == nil {
		return nil
	}
	said := string(out)
	if ee, ok := err.(*exec.ExitError); ok {
		said += string(ee.Stderr)
	}
	low := strings.ToLower(said)
	switch {
	case strings.Contains(low, "already exists"):
		return uierr.With("err.branch.exists", name)
	case strings.Contains(low, "invalid reference"), strings.Contains(low, "not a valid"):
		return uierr.With("err.branch.badName", name)
	case strings.Contains(low, "would be overwritten"), strings.Contains(low, "local changes"):
		return uierr.New("err.branch.wouldLose")
	case strings.Contains(low, "is already used by worktree"),
		strings.Contains(low, "already checked out"):
		return uierr.With("err.branch.elsewhere", name)
	}
	return uierr.With("err.git.failed", strings.TrimSpace(said))
}

// Delete removes a branch. Never the one that is checked out, and never with
// force: losing commits is not something a button should be able to do.
func Delete(dir, name string) error {
	if strings.TrimSpace(name) == "" {
		return uierr.New("err.branch.noName")
	}
	out, err := Raw(dir, "branch", "-d", name)
	if err == nil {
		return nil
	}
	said := string(out)
	if ee, ok := err.(*exec.ExitError); ok {
		said += string(ee.Stderr)
	}
	low := strings.ToLower(said)
	switch {
	case strings.Contains(low, "not fully merged"):
		return uierr.With("err.branch.notMerged", name)
	case strings.Contains(low, "checked out"), strings.Contains(low, "used by worktree"):
		return uierr.With("err.branch.isCurrent", name)
	case strings.Contains(low, "not found"):
		return uierr.With("err.branch.unknown", name)
	}
	return uierr.With("err.git.failed", strings.TrimSpace(said))
}
