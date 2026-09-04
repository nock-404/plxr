// Package marks keeps a snapshot of the working directory before every
// instruction, so single files can be rolled back afterwards.
//
// The fear it takes away: an agent changes eleven files, one of them wrongly,
// and the only tool at hand is `git checkout .` — which takes your own work
// with it. This keeps a point in time per instruction and rolls back one file.
//
// How the snapshot works, and why it is safe:
//
//	GIT_INDEX_FILE=<temp> git add -A
//	GIT_INDEX_FILE=<temp> git write-tree
//
// A temporary index, thrown away afterwards. Your index, your working tree,
// HEAD and every branch stay untouched — only objects land in .git/objects,
// and unreferenced ones are cleaned up by git itself. Measured: 0.13 s in a
// small repo, 0.39 s in one of 197 MB.
//
// Only inside a git repository. A generic file copier would have to decide
// what to leave out, get node_modules wrong, and be slow — git already knows
// all of that from .gitignore.
package marks

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"plxr/internal/sys"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"plxr/internal/daemon"
)

// Timeout bounds every git call. The hook runs BEFORE the instruction and
// holds it up — a repository that takes seconds must cost the snapshot, not
// the work.
const Timeout = 3 * time.Second

// Mark is one recorded point in time.
type Mark struct {
	Tree   string `json:"tree"`
	At     int64  `json:"at"`
	Prompt string `json:"prompt"`
	Cwd    string `json:"cwd"`
}

// Change is one file that differs from a mark.
type Change struct {
	Status string `json:"status"` // M, A, D — as git names it
	Path   string `json:"path"`
}

// Dir is where the marks live.
func Dir() string { return filepath.Join(daemon.Root(), "marks") }

func git(dir string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), Timeout)
	defer cancel()
	cmd := sys.Quiet(exec.CommandContext(ctx, "git", args...))
	cmd.Dir = dir
	out, err := cmd.Output()
	return strings.TrimSpace(string(out)), err
}

// IsRepo reports whether marks can be kept here at all.
func IsRepo(cwd string) bool {
	out, err := git(cwd, "rev-parse", "--is-inside-work-tree")
	return err == nil && out == "true"
}

// Take makes a snapshot and returns the tree object.
func Take(cwd string) (string, error) {
	if !IsRepo(cwd) {
		return "", nil
	}
	tmp := filepath.Join(os.TempDir(), "plxr-index-"+strconv.Itoa(os.Getpid()))
	defer os.Remove(tmp)

	ctx, cancel := context.WithTimeout(context.Background(), Timeout)
	defer cancel()
	for _, args := range [][]string{{"add", "-A"}, {"write-tree"}} {
		cmd := sys.Quiet(exec.CommandContext(ctx, "git", args...))
		cmd.Dir = cwd
		cmd.Env = append(os.Environ(), "GIT_INDEX_FILE="+tmp)
		out, err := cmd.Output()
		if err != nil {
			return "", err
		}
		if args[0] == "write-tree" {
			return strings.TrimSpace(string(out)), nil
		}
	}
	return "", nil
}

// Note records a mark. Errors are swallowed: a mark that cannot be written
// must never stop an instruction.
func Note(sessionID string, m Mark) {
	if sessionID == "" || m.Tree == "" {
		return
	}
	if os.MkdirAll(Dir(), 0o755) != nil {
		return
	}
	f, err := os.OpenFile(filepath.Join(Dir(), sessionID+".jsonl"),
		os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	b, err := json.Marshal(m)
	if err != nil {
		return
	}
	f.Write(append(b, '\n'))
}

// List hands out the marks of a session, newest first.
func List(sessionID string) []Mark {
	b, err := os.ReadFile(filepath.Join(Dir(), sessionID+".jsonl"))
	if err != nil {
		return nil
	}
	var out []Mark
	for _, line := range strings.Split(string(b), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var m Mark
		if json.Unmarshal([]byte(line), &m) == nil {
			out = append(out, m)
		}
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}

// Changed lists what differs between a mark and the working tree right now.
//
// The error is handed back rather than swallowed. It used to return nil for
// both "nothing has changed" and "git could not be asked", and the interface
// said "nothing changed since" to either — a repository that had been moved,
// a mark whose tree object was gone, a git that is not installed at all, every
// one of them read as an all-clear.
func Changed(cwd, tree string) ([]Change, error) {
	out, err := git(cwd, "diff", "--name-status", tree)
	if err != nil {
		return nil, err
	}
	if out == "" {
		return []Change{}, nil
	}
	var cs []Change
	for _, line := range strings.Split(out, "\n") {
		st, path, ok := strings.Cut(strings.TrimSpace(line), "\t")
		if !ok {
			continue
		}
		cs = append(cs, Change{Status: st, Path: path})
	}
	return cs, nil
}

// Restore writes one file back the way it stood at the mark.
//
// Deliberately through `git show` and a write of our own, not through
// `git checkout <tree> -- <path>`: that one also touches the index, and an
// index changed behind your back is exactly the kind of surprise this feature
// exists to prevent.
// RestoreAll puts every file that differs from the mark back the way it was.
//
// Restore takes one path, and the window never sent one — it asked to restore
// with the path left empty, which git reads as the tree itself: the write went
// to the directory and came back as "invalid argument". So the button in the
// marks panel could not work, and never had. Putting everything back is what it
// always meant; a single file is now a deliberate second thing.
func RestoreAll(cwd, tree string) (int, error) {
	changes, err := Changed(cwd, tree)
	if err != nil {
		return 0, err
	}
	done := 0
	for _, c := range changes {
		// Added since the mark: there is nothing in the tree to put back, and
		// deleting somebody's new file is not what "restore" promises.
		if c.Status == "A" {
			continue
		}
		if err := Restore(cwd, tree, c.Path); err != nil {
			return done, err
		}
		done++
	}
	return done, nil
}

func Restore(cwd, tree, path string) error {
	if path == "" {
		// Reached only by a caller that meant RestoreAll. Said plainly rather
		// than handed to git, which answers a tree listing and then writes it
		// over the directory.
		return os.ErrInvalid
	}
	if strings.Contains(path, "..") {
		return os.ErrInvalid
	}
	// Raw, without trimming: git() trims whitespace, and a file without a
	// closing newline — or a binary one — would come back changed. In a rollback
	// that is the worst possible bug.
	ctx, cancel := context.WithTimeout(context.Background(), Timeout)
	defer cancel()
	cmd := sys.Quiet(exec.CommandContext(ctx, "git", "show", tree+":"+path))
	cmd.Dir = cwd
	content, err := cmd.Output()
	if err != nil {
		return err
	}
	target := filepath.Join(cwd, filepath.Clean(path))
	if !strings.HasPrefix(target, filepath.Clean(cwd)+string(os.PathSeparator)) {
		return os.ErrInvalid
	}
	return os.WriteFile(target, content, 0o644)
}

// ---- Stuck: going round in circles ----

/*
An agent in a loop looks healthy from outside. The tile is green, something is
happening, output is scrolling — and it has been changing the same two files
back and forth for 45 minutes.

The marks already hold what is needed: one tree per instruction. Comparing two
consecutive ones says which files that instruction touched. A file that keeps
coming back across many instructions is the signal.

The numbers are chosen so that normal work does not trip it. Iterating twice on
one file is work, not a loop; that is why it takes at least StuckRuns
instructions, and they have to span StuckSpan — an agent that changes the same
file five times in two minutes is simply fast.
*/
const (
	StuckRuns = 5                // at least this many instructions in a row
	StuckHits = 4                // and the file in at least this many of them
	StuckSpan = 15 * time.Minute // spanning at least this long
	StuckLook = 8                // never compare more than this many marks
)

// Stuck says whether a session is going in circles.
type Stuck struct {
	Files []string `json:"files"`
	Runs  int      `json:"runs"`
	Since int64    `json:"since"`
}

var (
	stuckMu    sync.Mutex
	stuckCache = map[string]stuckEntry{}
)

type stuckEntry struct {
	newest string
	count  int
	result *Stuck
}

// IsStuck compares the last marks of a session.
//
// Cached by the newest mark AND how many there are. The tree alone is not
// enough: a revert leads back to a tree that was already there, and the answer
// would come out of the cache although the history has moved on.
//
// Cached at all because the tiles refresh every second, and a git diff per
// session per second would be a fire the feature is not worth. Marks only
// change on a new instruction — so the cache invalidates itself exactly then.
func IsStuck(sessionID string) *Stuck {
	all := List(sessionID)
	if len(all) < StuckRuns+1 {
		return nil
	}
	if len(all) > StuckLook {
		all = all[:StuckLook]
	}

	stuckMu.Lock()
	if e, ok := stuckCache[sessionID]; ok && e.newest == all[0].Tree && e.count == len(all) {
		stuckMu.Unlock()
		return e.result
	}
	stuckMu.Unlock()

	seen := map[string]int{}
	for i := 0; i+1 < len(all); i++ {
		out, err := git(all[i].Cwd, "diff", "--name-only", all[i+1].Tree, all[i].Tree)
		if err != nil {
			continue
		}
		for _, f := range strings.Split(out, "\n") {
			if f = strings.TrimSpace(f); f != "" {
				seen[f]++
			}
		}
	}

	var files []string
	for f, n := range seen {
		if n >= StuckHits {
			files = append(files, f)
		}
	}
	span := time.Duration(all[0].At-all[len(all)-1].At) * time.Millisecond

	var res *Stuck
	if len(files) > 0 && span >= StuckSpan {
		sort.Strings(files)
		res = &Stuck{Files: files, Runs: len(all) - 1, Since: all[len(all)-1].At}
	}

	stuckMu.Lock()
	stuckCache[sessionID] = stuckEntry{newest: all[0].Tree, count: len(all), result: res}
	stuckMu.Unlock()
	return res
}
