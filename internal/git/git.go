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

/* Command builds a git call: quiet, in the right directory, and in a language
 * this program can read.
 *
 * git speaks the language of the machine. plxr decides what happened by
 * reading git's own words — "nothing to commit", "did not match any files" —
 * and on a German machine none of them match: a commit with nothing staged
 * reports an unknown error instead of saying so. Translating the patterns
 * would mean keeping up with every language git has, so git is asked in one
 * instead. LANGUAGE is emptied as well: for gettext it outranks LC_ALL.
 *
 * Every git call in plxr comes through here, including the ones in marks,
 * files and find — gitcalls.py holds them to it.
 */
func Command(ctx context.Context, dir string, args ...string) *exec.Cmd {
	cmd := sys.Quiet(exec.CommandContext(ctx, "git", args...))
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "LC_ALL=C", "LANG=C", "LANGUAGE=")
	/* The deadline has to actually end the call.
	 *
	 * CommandContext kills git when the context fires, but Output()'s Wait
	 * then blocks on the goroutine copying stdout, and that goroutine waits
	 * for every process still holding the write end of the pipe — git's
	 * grandchildren, a credential helper or a filter git started, which the
	 * kill did not reach. Measured a 20 s deadline outlived by forty seconds.
	 * WaitDelay bounds that wait: a short grace after the process is gone,
	 * then the pipes are closed and the call returns. */
	cmd.WaitDelay = 3 * time.Second
	return cmd
}

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
	return Command(ctx, dir, args...).Output()
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
	/* Only this folder, and named the way this folder names things.
	 *
	 * git answers with paths relative to the top of the repository, and the
	 * folder somebody opened need not be the top — in a monorepo it usually is
	 * not. Without the pathspec, a folder one level down was handed every
	 * change in the whole repository; without the rewriting below, each path
	 * arrived with the way down from the top in front of it, and the window
	 * then asked to stage or diff a path the daemon resolved one level too deep.
	 * Everything to do with git was broken for anybody who opened a
	 * subdirectory.
	 *
	 * "." is the pathspec for "at or below where git was asked", which is dir. */
	out, err := Raw(dir, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ".")
	if err != nil {
		return nil, err
	}
	toHere, err := relatively(dir)
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
		here, inside := toHere(path)
		if !inside {
			continue
		}
		c := &Change{Path: here, Index: string(code[0]), Work: string(code[1])}
		// A rename prints the new name on this line and the old one in the next
		// field. Reading it is not optional: left in place it becomes the next
		// entry, as a path with a two-letter code chopped off its front.
		if strings.ContainsAny(code, "RC") && i+1 < len(fields) {
			i++
			// Where it came from, in the same terms. Outside the folder it is
			// still worth saying, so the full path is kept in that case.
			if from, ok := toHere(fields[i]); ok {
				c.Renamed = from
			} else {
				c.Renamed = fields[i]
			}
		}
		byPath[c.Path] = c
		order = append(order, c.Path)
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
		counts(string(out), byPath, staged, toHere)
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
	f, err := os.Open(filepath.Join(dir, filepath.FromSlash(path)))
	if err != nil {
		return 0, false
	}
	defer f.Close()
	/* Streamed, never read whole into memory.
	 *
	 * This runs for every untracked file a status lists, only to count its
	 * newlines — os.ReadFile on a multi-gigabyte log to learn how many lines
	 * it has is the kind of thing that makes opening a folder cost the machine.
	 * A 64 KB window is enough to count and to spot a NUL. */
	buf := make([]byte, 64<<10)
	n := 0
	var last byte
	any := false
	for {
		read, err := f.Read(buf)
		if read > 0 {
			any = true
			chunk := buf[:read]
			if bytes.IndexByte(chunk, 0) >= 0 {
				return 0, true
			}
			n += bytes.Count(chunk, []byte("\n"))
			last = chunk[read-1]
		}
		if err != nil {
			break
		}
	}
	// A last line without a newline still counts.
	if any && last != '\n' {
		n++
	}
	return n, false
}

// relatively turns a path as git reports it — from the top of the repository —
// into one relative to the directory git was asked in, and says whether it is
// below that directory at all.
func relatively(dir string) (func(string) (string, bool), error) {
	here := dir
	if r, err := filepath.EvalSymlinks(dir); err == nil {
		here = r
	}
	top := here
	if t, err := Run(dir, "rev-parse", "--show-toplevel"); err == nil && t != "" {
		top = t
		if r, err := filepath.EvalSymlinks(t); err == nil {
			top = r
		}
	}
	return func(path string) (string, bool) {
		rel, err := filepath.Rel(here, filepath.Join(top, filepath.FromSlash(path)))
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return path, false
		}
		return filepath.ToSlash(rel), true
	}, nil
}

func counts(out string, into map[string]*Change, staged bool, toHere func(string) (string, bool)) {
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
		here, inside := toHere(path)
		if !inside {
			continue
		}
		c, ok := into[here]
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
	return DifferenceOf(dir, path, "", staged)
}

// DifferenceOf is Difference that also knows the file's old name, for a
// rename. Both names go into the pathspec so git can pair them; with only the
// new one it cannot see the deletion of the old, calls it a new file, and
// marks every line an addition — a whole-file rewrite where the row said +1 -1.
func DifferenceOf(dir, path, was string, staged bool) (Diff, error) {
	out := Diff{Path: path, Staged: staged, Hunks: []Hunk{}}
	// diff.suppressBlankEmpty, if the user has it set, makes git print a blank
	// context line as "" rather than " " — which the parser cannot tell from
	// the header gap and miscounts, throwing every later line number off. Held
	// off for this one call.
	args := []string{"-c", "diff.suppressBlankEmpty=false",
		"diff", "--no-color", "--no-ext-diff", "-M", "-U3"}
	if staged {
		args = append(args, "--cached")
	}
	// -- keeps a path that starts with a dash from being read as an option.
	args = append(args, "--", path)
	if was != "" && was != path {
		args = append(args, was)
	}
	raw, err := Raw(dir, args...)
	if err != nil {
		return out, err
	}
	if len(raw) == 0 {
		/* Nothing in this direction. For an untracked file that means the
		 * whole file is the difference — /dev/null on one side, which is how
		 * git says it. For a tracked file it means exactly what it says:
		 * nothing. Telling the two apart matters, because the /dev/null
		 * fallback on a tracked file with no unstaged change presented the
		 * entire file as freshly added. */
		if tracked(dir, path) {
			out.Empty = true
			return out, nil
		}
		raw, err = Raw(dir, "-c", "diff.suppressBlankEmpty=false",
			"diff", "--no-color", "--no-ext-diff", "-U3",
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

// tracked says whether git already knows this path — the difference between
// "no change" and "a brand new file".
func tracked(dir, path string) bool {
	out, err := Raw(dir, "ls-files", "--error-unmatch", "-z", "--", path)
	return err == nil && len(out) > 0
}

// AtHead is the file as the last commit has it — the baseline an editor
// gutter measures the buffer against.
//
// The path is relative to dir, not to the top of the repository: "HEAD:./x"
// is how git is told that, and it is what makes this work from a folder that
// is not the top. A path HEAD does not know — untracked, freshly renamed, a
// submodule — is not a fault here: the caller gets nothing and treats the
// whole buffer as new, which is what it is as far as HEAD is concerned.
func AtHead(dir, path string) ([]byte, bool) {
	out, err := Raw(dir, "show", "HEAD:./"+filepath.ToSlash(path))
	if err != nil {
		return nil, false
	}
	return out, true
}

// Head is the commit HEAD points at, or empty in a repository with none yet.
// It is the one thing that says "HEAD moved" — a branch name does not change
// when a commit lands on it.
func Head(dir string) string {
	out, err := Run(dir, "rev-parse", "HEAD")
	if err != nil {
		return ""
	}
	return out
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

/* alreadyDone is git saying there is nothing here left to do.
 *
 * "pathspec 'x' did not match any files" is what git answers for a deletion
 * that is already staged — the file is gone and the index already knows. The
 * window can perfectly well send it again, and it did: pressing IN twice on a
 * removed file, or sending a batch that contained one, failed the whole call
 * and nothing could be staged at all.
 *
 * git gives the same sentence for a path that never existed, so the sentence
 * alone is not enough. The index cannot tell them apart either — staging a
 * deletion takes the path out of the index, so ls-files refuses both. status
 * can: it reports the staged deletion and says nothing about a name somebody
 * made up. */
func alreadyDone(dir, path, said string) bool {
	if !strings.Contains(said, "did not match any files") {
		return false
	}
	out, err := Raw(dir, "status", "--porcelain=v1", "-z", "--", path)
	return err == nil && len(strings.TrimSpace(string(out))) > 0
}

func said(out []byte, err error) string {
	text := string(out)
	if ee, ok := err.(*exec.ExitError); ok {
		text += string(ee.Stderr)
	}
	return text
}

func each(dir string, paths []string, args ...string) error {
	if len(paths) == 0 {
		return nil
	}
	var firstErr error
	one := func(path string) error {
		// -- so a path that begins with a dash is a path and not an option.
		call := append(append([]string{}, args...), "--", path)
		out, err := Raw(dir, call...)
		if err == nil || alreadyDone(dir, path, said(out, err)) {
			return nil
		}
		return uierr.With("err.git.failed", strings.TrimSpace(said(out, err)))
	}
	for i := 0; i < len(paths); i += chunk {
		end := i + chunk
		if end > len(paths) {
			end = len(paths)
		}
		batch := paths[i:end]
		call := append(append([]string{}, args...), "--")
		call = append(call, batch...)
		if _, err := Raw(dir, call...); err == nil {
			continue
		}
		/* One path git will not take must not refuse the rest.
		 *
		 * git stops at the first pathspec it does not like and stages nothing,
		 * so a single already-staged deletion in a batch of forty meant forty
		 * files went nowhere. Retried one at a time, and only a path git
		 * genuinely objects to is reported. */
		for _, path := range batch {
			if e := one(path); e != nil && firstErr == nil {
				// Remembered, not returned: the point of going one at a time is
				// that a single path git will not take does not stop the rest.
				// Returning here undid exactly that — everything after the
				// offender was never attempted.
				firstErr = e
			}
		}
	}
	return firstErr
}

// Stage puts files into the index.
func Stage(dir string, paths []string) error { return each(dir, paths, "add", "-A") }

// Unstage takes files out of the index and leaves the working tree alone.
//
// git restore --staged is the modern spelling and needs git 2.23; reset is
// older than anything plxr will meet and does the same thing here.
//
// A staged rename is two halves, and the list only shows one of them. Resetting
// the new name alone left the deletion of the old one staged: the state became
// "D old-name" plus an untracked new file, and the next commit deleted the
// original. Measured, on a repository built for it. So the other half comes
// along.
func Unstage(dir string, paths []string) error {
	return each(dir, append(paths, origins(dir, paths)...), "reset", "-q")
}

// origins finds the old names of any staged renames among these paths.
func origins(dir string, paths []string) []string {
	want := map[string]bool{}
	for _, p := range paths {
		want[p] = true
	}
	out, err := Raw(dir, "status", "--porcelain=v1", "-z", "--untracked-files=no")
	if err != nil {
		return nil
	}
	extra := []string{}
	fields := strings.Split(string(out), "\x00")
	toHere, err := relatively(dir)
	if err != nil {
		return nil
	}
	for i := 0; i < len(fields); i++ {
		line := fields[i]
		if len(line) < 4 {
			continue
		}
		code, path := line[:2], line[3:]
		if !strings.ContainsAny(code, "RC") || i+1 >= len(fields) {
			continue
		}
		i++
		from := fields[i]
		here, inside := toHere(path)
		if !inside || !want[here] {
			continue
		}
		/* The other half of the rename, wherever it is.
		 *
		 * A rename staged from outside the folder — git mv important.txt
		 * inner/important.txt, folder opened on inner — has its old name above
		 * the folder. toHere then says "outside" and the old half was dropped,
		 * so Unstage reset only the new name and left "D important.txt" staged;
		 * the next commit removed the original. The reset has to reach it, so
		 * the path is taken relative to the folder even when that means going
		 * up, which git reset accepts. */
		if old := relToFolder(dir, from); old != "" && !want[old] {
			extra = append(extra, old)
		}
	}
	return extra
}

// relToFolder gives a repo path as it is named from the opened folder, even
// when that is a step up (../old). "" if it cannot be worked out.
func relToFolder(dir, repoPath string) string {
	here := dir
	if r, err := filepath.EvalSymlinks(dir); err == nil {
		here = r
	}
	top := here
	if t, err := Run(dir, "rev-parse", "--show-toplevel"); err == nil && t != "" {
		top = t
		if r, err := filepath.EvalSymlinks(t); err == nil {
			top = r
		}
	}
	rel, err := filepath.Rel(here, filepath.Join(top, filepath.FromSlash(repoPath)))
	if err != nil {
		return ""
	}
	return filepath.ToSlash(rel)
}

// stagedOutside says whether the index holds staged changes above or beside the
// opened folder — work a commit would sweep in that the folder never showed.
func stagedOutside(dir string) (bool, error) {
	all, err := Raw(dir, "diff", "--cached", "--name-only")
	if err != nil {
		return false, err
	}
	here, err := Raw(dir, "diff", "--cached", "--name-only", "--", ".")
	if err != nil {
		return false, err
	}
	count := func(b []byte) int {
		n := 0
		for _, l := range strings.Split(strings.TrimSpace(string(b)), "\n") {
			if strings.TrimSpace(l) != "" {
				n++
			}
		}
		return n
	}
	return count(all) > count(here), nil
}

// Commit records what is staged.
//
// The message travels as one argument, never through a shell, so a newline or a
// quote in it is just text. Failures are classified rather than passed on raw:
// git's own words are English prose in the middle of a translated window.
func Commit(dir, message string, amend bool) (string, error) {
	if strings.TrimSpace(message) == "" {
		return "", ErrNoMessage
	}
	/* Nothing may go in that this folder does not show.
	 *
	 * git commit with no pathspec commits the whole index, and the window's
	 * list is scoped to the opened folder with `-- .`. A subfolder open with
	 * an agent staging work in a sibling folder would commit that work too,
	 * under the user's message, with nothing on screen to show it. `commit
	 * -- .` is not the fix: with a pathspec git takes the working-tree content
	 * of those paths and ignores the index, so it would commit unstaged
	 * changes and skip staged ones — the opposite of what plxr promises. So
	 * the commit stays an index commit, and it is refused when the index holds
	 * staged work this folder cannot see. At the repository root there is no
	 * outside, so the ordinary case never meets this. */
	if outside, err := stagedOutside(dir); err == nil && outside {
		return "", ErrOutsideStaged
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
	// Something is staged outside the opened folder — a commit from here would
	// have swept it in without the folder ever showing it.
	ErrOutsideStaged = uierr.New("err.commit.outsideStaged")
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

// millis turns git's unix seconds into what the window counts in. An
// unreadable one becomes zero, which the window shows as no age at all rather
// than as 1970.
func millis(unix string) int64 {
	n, err := strconv.ParseInt(strings.TrimSpace(unix), 10, 64)
	if err != nil || n <= 0 {
		return 0
	}
	return n * 1000
}

// Entry is one commit, as the history list shows it.
type Entry struct {
	Hash    string `json:"hash"`
	Subject string `json:"subject"`
	Author  string `json:"author"`

	/* When the commit was made, in milliseconds.
	 *
	 * Not git's own wording. git says "3 days ago" in the language of the
	 * machine, and that is the one string in the window nobody could
	 * translate — it arrived already worded. Since plxr now asks git in a
	 * fixed language so it can read the answers, the wording would be
	 * English in a German window. A number has no language; the window says
	 * it in its own. */
	When int64 `json:"when"`
}

// Log returns the last commits.
func Log(dir string, n int) ([]Entry, error) {
	if n <= 0 {
		n = 20
	}
	// %x00 between the fields and %x01 between records: neither appears in a
	// commit message, and a subject may hold anything else including tabs.
	out, err := Raw(dir, "log", "--no-color", "-n", strconv.Itoa(n),
		"--format=%h%x00%s%x00%an%x00%at%x01")
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
		list = append(list, Entry{Hash: f[0], Subject: f[1], Author: f[2], When: millis(f[3])})
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
	When     int64  `json:"when"`    // of its last commit, in milliseconds
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
			"%(contents:subject)%00%(committerdate:unix)%01",
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
			When:     millis(f[4]),
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
