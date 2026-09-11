package git

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func repo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t",
			"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v: %s", args, err, out)
		}
	}
	run("init", "-q", ".")
	return dir
}

func write(t *testing.T, dir, name, text string) {
	t.Helper()
	full := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func git(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t",
		"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v: %s", args, err, out)
	}
}

func find(list []Change, path string) *Change {
	for i := range list {
		if list[i].Path == path {
			return &list[i]
		}
	}
	return nil
}

func TestChangesKeepsStagedAndUnstagedApart(t *testing.T) {
	dir := repo(t)
	write(t, dir, "kept.txt", "one\ntwo\nthree\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "start")

	// Staged, then changed again since — the case a single word cannot show.
	write(t, dir, "kept.txt", "one\nTWO\nthree\n")
	git(t, dir, "add", "kept.txt")
	write(t, dir, "kept.txt", "one\nTWO\nTHREE\n")
	write(t, dir, "fresh.txt", "brand new\n")

	list, err := Changes(dir)
	if err != nil {
		t.Fatal(err)
	}
	kept := find(list, "kept.txt")
	if kept == nil {
		t.Fatalf("kept.txt missing from %+v", list)
	}
	if kept.Index != "M" || kept.Work != "M" {
		t.Fatalf("expected staged and changed again, got index %q work %q", kept.Index, kept.Work)
	}
	if !kept.Staged() {
		t.Fatalf("Staged() says no for %+v", kept)
	}
	if kept.Added == 0 {
		t.Fatalf("no line counts: %+v", kept)
	}

	fresh := find(list, "fresh.txt")
	if fresh == nil || !fresh.Untracked() {
		t.Fatalf("fresh.txt should be untracked: %+v", fresh)
	}
}

func TestAwkwardNamesSurvive(t *testing.T) {
	dir := repo(t)
	// A space, a quote and a letter outside ASCII. git C-quotes all three by
	// default, which is why everything in this package uses -z. The letter is
	// deliberately not a German one: german.py reads this file too.
	name := "a file \"quoted\" nāme.txt"
	write(t, dir, name, "hello\n")
	list, err := Changes(dir)
	if err != nil {
		t.Fatal(err)
	}
	if find(list, name) == nil {
		t.Fatalf("the name came back mangled: %+v", list)
	}
}

func TestARenameIsOneEntryNotTwo(t *testing.T) {
	dir := repo(t)
	write(t, dir, "before.txt", "same content\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "start")
	git(t, dir, "mv", "before.txt", "after.txt")

	list, err := Changes(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Fatalf("a rename became %d entries: %+v", len(list), list)
	}
	if list[0].Path != "after.txt" || list[0].Renamed != "before.txt" {
		t.Fatalf("the rename lost where it came from: %+v", list[0])
	}
}

func TestDifferenceReadsTheHunks(t *testing.T) {
	dir := repo(t)
	write(t, dir, "f.txt", "one\ntwo\nthree\nfour\nfive\nsix\nseven\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "start")
	write(t, dir, "f.txt", "one\ntwo\nCHANGED\nfour\nfive\nsix\nseven\n")

	d, err := Difference(dir, "f.txt", false)
	if err != nil {
		t.Fatal(err)
	}
	if d.Empty || len(d.Hunks) != 1 {
		t.Fatalf("expected one hunk, got %+v", d)
	}
	var added, removed, kept int
	for _, l := range d.Hunks[0].Lines {
		switch l.Kind {
		case "+":
			added++
			if l.Text != "CHANGED" {
				t.Fatalf("added line is %q", l.Text)
			}
			if l.New != 3 {
				t.Fatalf("added line numbered %d, expected 3", l.New)
			}
		case "-":
			removed++
			if l.Old != 3 {
				t.Fatalf("removed line numbered %d, expected 3", l.Old)
			}
		case " ":
			kept++
		}
	}
	if added != 1 || removed != 1 || kept == 0 {
		t.Fatalf("counted +%d -%d =%d", added, removed, kept)
	}
}

func TestAnUntrackedFileIsAllDifference(t *testing.T) {
	dir := repo(t)
	write(t, dir, "new.txt", "line one\nline two\n")
	d, err := Difference(dir, "new.txt", false)
	if err != nil {
		t.Fatal(err)
	}
	if d.Empty {
		t.Fatalf("an untracked file came back with nothing to show")
	}
	var added int
	for _, h := range d.Hunks {
		for _, l := range h.Lines {
			if l.Kind == "+" {
				added++
			}
		}
	}
	if added != 2 {
		t.Fatalf("expected both lines as added, got %d: %+v", added, d.Hunks)
	}
}

func TestBinaryIsSaidNotShown(t *testing.T) {
	dir := repo(t)
	if err := os.WriteFile(filepath.Join(dir, "b.bin"), []byte{1, 2, 0, 3}, 0o644); err != nil {
		t.Fatal(err)
	}
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "start")
	if err := os.WriteFile(filepath.Join(dir, "b.bin"), []byte{4, 5, 0, 6, 7}, 0o644); err != nil {
		t.Fatal(err)
	}
	d, err := Difference(dir, "b.bin", false)
	if err != nil {
		t.Fatal(err)
	}
	if !d.Binary {
		t.Fatalf("a binary file was not recognised: %+v", d)
	}

	list, err := Changes(dir)
	if err != nil {
		t.Fatal(err)
	}
	if b := find(list, "b.bin"); b == nil || !b.Binary {
		t.Fatalf("Changes did not mark it binary: %+v", b)
	}
}

func TestAFreshRepositoryDoesNotBreakIt(t *testing.T) {
	dir := repo(t)
	write(t, dir, "only.txt", "nothing committed yet\n")
	list, err := Changes(dir)
	if err != nil {
		t.Fatalf("Changes on a repository with no commits: %v", err)
	}
	if find(list, "only.txt") == nil {
		t.Fatalf("the one file is missing: %+v", list)
	}
	if !IsRepo(dir) {
		t.Fatalf("IsRepo said no")
	}
	if top, err := Top(dir); err != nil || !strings.HasSuffix(top, filepath.Base(dir)) {
		t.Fatalf("Top: %q %v", top, err)
	}
}

func TestStagedAndUnstagedAreCountedApart(t *testing.T) {
	dir := repo(t)
	write(t, dir, "f.txt", "one\ntwo\nthree\nfour\nfive\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "start")

	// One line changed and staged, a second changed and left alone.
	write(t, dir, "f.txt", "one\nTWO\nthree\nfour\nfive\n")
	git(t, dir, "add", "f.txt")
	write(t, dir, "f.txt", "one\nTWO\nthree\nFOUR\nfive\n")

	c := find(mustChanges(t, dir), "f.txt")
	if c == nil {
		t.Fatal("f.txt missing")
	}
	if c.StagedAdded != 1 || c.StagedRemoved != 1 {
		t.Fatalf("staged counted %d/%d, expected 1/1", c.StagedAdded, c.StagedRemoved)
	}
	// Unstaged is measured against the index, so it is the second change alone.
	if c.Added != 1 || c.Removed != 1 {
		t.Fatalf("unstaged counted %d/%d, expected 1/1", c.Added, c.Removed)
	}
}

func TestANewFileCountsItsOwnLines(t *testing.T) {
	dir := repo(t)
	write(t, dir, "fresh.txt", "one\ntwo\nthree\n")
	c := find(mustChanges(t, dir), "fresh.txt")
	if c == nil || !c.Untracked() {
		t.Fatalf("fresh.txt should be untracked: %+v", c)
	}
	// git counts nothing for an untracked file, and "+0" reads as empty.
	if c.Added != 3 {
		t.Fatalf("a new file with three lines counted %d", c.Added)
	}
	// And one without a closing newline still counts its last line.
	write(t, dir, "nonl.txt", "only line")
	if c := find(mustChanges(t, dir), "nonl.txt"); c == nil || c.Added != 1 {
		t.Fatalf("a file with no trailing newline counted %+v", c)
	}
}

func mustChanges(t *testing.T, dir string) []Change {
	t.Helper()
	list, err := Changes(dir)
	if err != nil {
		t.Fatal(err)
	}
	return list
}

// gitOut runs git and returns its output, failing on error.
func gitOut(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t",
		"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v: %s", args, err, out)
	}
	return string(out)
}

// The deadline ends the call even when git leaves a grandchild holding the pipe.
func TestTheDeadlineIsActuallyHeld(t *testing.T) {
	dir := t.TempDir()
	// A stand-in git that starts a background process inheriting stdout and
	// then blocks itself. Killing "git" does not reach the background one, so
	// the pipe stays open — which is what used to hang Output().
	fake := filepath.Join(dir, "git")
	script := "#!/bin/sh\nsleep 30 &\nsleep 30\n"
	if err := os.WriteFile(fake, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()
	start := time.Now()
	_, _ = Command(ctx, dir, "status").Output()
	if took := time.Since(start); took > 8*time.Second {
		t.Fatalf("git ran %s past a one-second deadline — the grandchild held the pipe", took)
	}
}
