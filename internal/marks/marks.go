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
	"strconv"
	"strings"
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
	cmd := exec.CommandContext(ctx, "git", args...)
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
		cmd := exec.CommandContext(ctx, "git", args...)
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
func Changed(cwd, tree string) []Change {
	out, err := git(cwd, "diff", "--name-status", tree)
	if err != nil || out == "" {
		return nil
	}
	var cs []Change
	for _, line := range strings.Split(out, "\n") {
		st, path, ok := strings.Cut(strings.TrimSpace(line), "\t")
		if !ok {
			continue
		}
		cs = append(cs, Change{Status: st, Path: path})
	}
	return cs
}

// Restore writes one file back the way it stood at the mark.
//
// Deliberately through `git show` and a write of our own, not through
// `git checkout <tree> -- <path>`: that one also touches the index, and an
// index changed behind your back is exactly the kind of surprise this feature
// exists to prevent.
func Restore(cwd, tree, path string) error {
	if strings.Contains(path, "..") {
		return os.ErrInvalid
	}
	// Raw, without trimming: git() trims whitespace, and a file without a
	// closing newline — or a binary one — would come back changed. In a rollback
	// that is the worst possible bug.
	ctx, cancel := context.WithTimeout(context.Background(), Timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", "show", tree+":"+path)
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
