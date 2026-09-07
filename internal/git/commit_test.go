package git

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStageAndUnstageAndCommit(t *testing.T) {
	dir := repo(t)
	write(t, dir, "one.txt", "first\n")
	write(t, dir, "two.txt", "second\n")

	if err := Stage(dir, []string{"one.txt"}); err != nil {
		t.Fatalf("Stage: %v", err)
	}
	list := mustChanges(t, dir)
	if c := find(list, "one.txt"); c == nil || !c.Staged() {
		t.Fatalf("one.txt is not staged: %+v", c)
	}
	if c := find(list, "two.txt"); c == nil || c.Staged() {
		t.Fatalf("two.txt should not be staged: %+v", c)
	}

	hash, err := Commit(dir, "first commit\n\nwith a second paragraph and a \"quote\"", false)
	if err != nil {
		t.Fatalf("Commit: %v", err)
	}
	if hash == "" {
		t.Fatalf("no hash came back")
	}
	if l, _ := Log(dir, 5); len(l) != 1 || l[0].Subject != "first commit" {
		t.Fatalf("the log does not show it: %+v", l)
	}

	// Unstaging leaves the file where it is.
	if err := Stage(dir, []string{"two.txt"}); err != nil {
		t.Fatal(err)
	}
	if err := Unstage(dir, []string{"two.txt"}); err != nil {
		t.Fatalf("Unstage: %v", err)
	}
	if c := find(mustChanges(t, dir), "two.txt"); c == nil || c.Staged() {
		t.Fatalf("two.txt is still staged: %+v", c)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "two.txt")); string(b) != "second\n" {
		t.Fatalf("unstaging changed the file: %q", b)
	}
}

func TestTheWaysACommitRefuses(t *testing.T) {
	dir := repo(t)
	write(t, dir, "a.txt", "one\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "start")

	if _, err := Commit(dir, "   ", false); err != ErrNoMessage {
		t.Fatalf("an empty message gave %v", err)
	}
	// Nothing staged.
	if _, err := Commit(dir, "nothing here", false); err != ErrNothing {
		t.Fatalf("an empty stage gave %v", err)
	}

	// A hook that says no. Its own words are English prose, which is why the
	// window is given a code instead.
	hooks := filepath.Join(dir, ".git", "hooks")
	if err := os.MkdirAll(hooks, 0o755); err != nil {
		t.Fatal(err)
	}
	script := "#!/bin/sh\necho refused by the hook\nexit 1\n"
	if err := os.WriteFile(filepath.Join(hooks, "pre-commit"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	write(t, dir, "b.txt", "two\n")
	if err := Stage(dir, []string{"b.txt"}); err != nil {
		t.Fatal(err)
	}
	if _, err := Commit(dir, "will be refused", false); err != ErrHook {
		t.Fatalf("a refusing hook gave %v", err)
	}
}

func TestPositionReadsTheBranchAndTheDistance(t *testing.T) {
	dir := repo(t)
	write(t, dir, "a.txt", "one\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "start")

	w, err := Position(dir)
	if err != nil {
		t.Fatalf("Position: %v", err)
	}
	if w.Detached {
		t.Fatalf("said detached on a branch: %+v", w)
	}
	if w.Branch == "" || w.Branch == "HEAD" {
		t.Fatalf("no branch name: %+v", w)
	}
	// No upstream is an ordinary state and must not read as a failure.
	if w.Upstream != "" {
		t.Fatalf("invented an upstream: %+v", w)
	}

	// A second commit on a detached HEAD.
	first, _ := Run(dir, "rev-parse", "HEAD")
	write(t, dir, "a.txt", "two\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "second")
	git(t, dir, "checkout", "-q", first)
	w, err = Position(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !w.Detached {
		t.Fatalf("a detached HEAD was not noticed: %+v", w)
	}
}

func TestAheadAndBehindAgainstAnUpstream(t *testing.T) {
	origin := repo(t)
	write(t, origin, "a.txt", "one\n")
	git(t, origin, "add", "-A")
	git(t, origin, "commit", "-qm", "start")

	clone := t.TempDir()
	if out, err := Run(clone, "clone", "-q", origin, "."); err != nil {
		t.Skipf("cannot clone here: %v %s", err, out)
	}
	git(t, clone, "config", "user.email", "t@t")
	git(t, clone, "config", "user.name", "t")

	write(t, clone, "b.txt", "mine\n")
	git(t, clone, "add", "-A")
	git(t, clone, "commit", "-qm", "mine")

	w, err := Position(clone)
	if err != nil {
		t.Fatal(err)
	}
	if w.Upstream == "" {
		t.Fatalf("a clone has an upstream: %+v", w)
	}
	if w.Ahead != 1 || w.Behind != 0 {
		t.Fatalf("expected one ahead, none behind: %+v", w)
	}
}

func TestManyPathsAreStagedInBatches(t *testing.T) {
	dir := repo(t)
	names := make([]string, 0, chunk+50)
	for i := 0; i < chunk+50; i++ {
		name := filepath.Join("many", "f"+strings.Repeat("0", 3)+string(rune('a'+i%26))+strings.Repeat("x", i%7)+".txt")
		// Distinct names without a counter formatter.
		name = filepath.Join("many", "f"+strings.Repeat("i", i/26+1)+string(rune('a'+i%26))+".txt")
		write(t, dir, name, "x\n")
		names = append(names, filepath.ToSlash(name))
	}
	if err := Stage(dir, names); err != nil {
		t.Fatalf("Stage of %d paths: %v", len(names), err)
	}
	staged := 0
	for _, c := range mustChanges(t, dir) {
		if c.Staged() {
			staged++
		}
	}
	if staged < chunk+1 {
		t.Fatalf("only %d of %d were staged — the batching dropped some", staged, len(names))
	}
}
