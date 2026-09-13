package git

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

/* The folder overview's half of git, against repositories built here.
 *
 * Everything below was written because the overview claims things on screen —
 * "this commit touched four files", "2 ahead", "nothing is put aside" — and a
 * claim nobody measured is a claim that reads exactly the same when it is
 * wrong.
 */

func TestShowReadsTheCommitInFull(t *testing.T) {
	dir := repo(t)
	write(t, dir, "one.txt", "first\n")
	write(t, dir, "two.txt", "a\nb\nc\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "start")

	write(t, dir, "two.txt", "a\nB\nc\nd\n")
	write(t, dir, "three.txt", "new\n")
	git(t, dir, "rm", "-q", "one.txt")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "the second one\n\nwith a body that has\ntwo lines in it")

	c, err := Show(dir, "HEAD")
	if err != nil {
		t.Fatalf("Show: %v", err)
	}
	if c.Subject != "the second one" {
		t.Fatalf("subject %q", c.Subject)
	}
	if !strings.Contains(c.Body, "two lines in it") {
		t.Fatalf("body %q", c.Body)
	}
	if c.Author != "t" || c.Email != "t@t" {
		t.Fatalf("author %q <%q>", c.Author, c.Email)
	}
	if c.Hash == "" || len(c.Full) != 40 || !strings.HasPrefix(c.Full, c.Hash) {
		t.Fatalf("hashes: short %q full %q", c.Hash, c.Full)
	}
	// The time is a number, not git's own wording, and it is roughly now.
	if delta := time.Since(time.UnixMilli(c.When)); delta < 0 || delta > time.Hour {
		t.Fatalf("when %d is %v ago", c.When, delta)
	}

	seen := map[string]CommitFile{}
	for _, f := range c.Files {
		seen[f.Path] = f
	}
	if len(seen) != 3 {
		t.Fatalf("files: %+v", c.Files)
	}
	if got := seen["two.txt"]; got.Status != "M" || got.Added != 2 || got.Removed != 1 {
		t.Fatalf("two.txt: %+v", got)
	}
	if got := seen["three.txt"]; got.Status != "A" || got.Added != 1 {
		t.Fatalf("three.txt: %+v", got)
	}
	if got := seen["one.txt"]; got.Status != "D" || got.Removed != 1 {
		t.Fatalf("one.txt: %+v", got)
	}
	if c.Added != 3 || c.Removed != 2 {
		t.Fatalf("totals +%d -%d", c.Added, c.Removed)
	}
}

// A repository's first commit has no parent, and the naive way of asking what
// a commit changed — diff-tree against the parent — reports nothing at all for
// it. In a folder somebody has just started, that is every commit there is.
func TestShowHandlesTheFirstCommit(t *testing.T) {
	dir := repo(t)
	write(t, dir, "a.txt", "one\ntwo\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "the very first")

	c, err := Show(dir, "HEAD")
	if err != nil {
		t.Fatalf("Show: %v", err)
	}
	if len(c.Files) != 1 || c.Files[0].Path != "a.txt" || c.Files[0].Status != "A" {
		t.Fatalf("the root commit shows %+v", c.Files)
	}
	if c.Files[0].Added != 2 {
		t.Fatalf("counts: %+v", c.Files[0])
	}
}

// A merge has two parents, and `git show` prints no diff for one by default —
// so a history with merges in it would open onto nothing, which is the shape
// this project has more of than most.
func TestShowReadsAMergeAgainstItsFirstParent(t *testing.T) {
	dir := repo(t)
	write(t, dir, "a.txt", "one\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "start")
	git(t, dir, "checkout", "-q", "-b", "side")
	write(t, dir, "side.txt", "from the side\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "on the side")
	git(t, dir, "checkout", "-q", "-")
	git(t, dir, "merge", "-q", "--no-ff", "-m", "merged side", "side")

	c, err := Show(dir, "HEAD")
	if err != nil {
		t.Fatalf("Show: %v", err)
	}
	if c.Subject != "merged side" {
		t.Fatalf("subject %q", c.Subject)
	}
	if len(c.Files) != 1 || c.Files[0].Path != "side.txt" {
		t.Fatalf("a merge showed %+v", c.Files)
	}
}

// A rename carries two paths and a score, and the count belongs to the new one.
func TestShowFollowsARename(t *testing.T) {
	dir := repo(t)
	write(t, dir, "before.txt", "one\ntwo\nthree\nfour\nfive\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "start")
	git(t, dir, "mv", "before.txt", "after.txt")
	git(t, dir, "commit", "-qm", "renamed it")

	c, err := Show(dir, "HEAD")
	if err != nil {
		t.Fatalf("Show: %v", err)
	}
	if len(c.Files) != 1 {
		t.Fatalf("files %+v", c.Files)
	}
	if c.Files[0].Path != "after.txt" || c.Files[0].Renamed != "before.txt" {
		t.Fatalf("rename read as %+v", c.Files[0])
	}
	if c.Files[0].Status != "R" {
		t.Fatalf("status %q", c.Files[0].Status)
	}
}

// The paths a subdirectory is handed are its own, and a commit that touched
// nothing inside it touched nothing as far as that folder is concerned.
func TestShowNamesPathsFromTheFolderItWasAskedIn(t *testing.T) {
	dir := repo(t)
	write(t, dir, "top.txt", "top\n")
	write(t, dir, "sub/inside.txt", "inside\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "start")
	write(t, dir, "sub/inside.txt", "inside, changed\n")
	write(t, dir, "top.txt", "top, changed\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "both")

	c, err := Show(filepath.Join(dir, "sub"), "HEAD")
	if err != nil {
		t.Fatalf("Show: %v", err)
	}
	if len(c.Files) != 1 || c.Files[0].Path != "inside.txt" {
		t.Fatalf("from the subdirectory: %+v", c.Files)
	}
}

func TestShowRefusesWhatGitCannotResolve(t *testing.T) {
	dir := repo(t)
	write(t, dir, "a.txt", "one\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "start")

	if _, err := Show(dir, "nosuchcommit"); err == nil {
		t.Fatalf("an unknown ref was accepted")
	} else if !strings.HasPrefix(err.Error(), "err.git.noCommit") {
		t.Fatalf("unknown ref gave %v", err)
	}
	// A ref is the one argument here that comes from outside the program.
	if _, err := Show(dir, "--output=/tmp/written-by-a-ref"); err == nil {
		t.Fatalf("an option was accepted as a ref")
	} else if !strings.HasPrefix(err.Error(), "err.git.badRef") {
		t.Fatalf("an option gave %v", err)
	}
}

func TestShowWithNoRefMeansHead(t *testing.T) {
	dir := repo(t)
	write(t, dir, "a.txt", "one\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "only one")

	c, err := Show(dir, "")
	if err != nil {
		t.Fatalf("Show: %v", err)
	}
	if c.Subject != "only one" {
		t.Fatalf("subject %q", c.Subject)
	}
}

func TestRemotesListsEachOneOnce(t *testing.T) {
	dir := repo(t)
	write(t, dir, "a.txt", "one\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "start")

	if list, err := Remotes(dir); err != nil || len(list) != 0 {
		t.Fatalf("a repository with no remote gave %+v, %v", list, err)
	}
	git(t, dir, "remote", "add", "origin", "https://example.invalid/one.git")
	git(t, dir, "remote", "add", "backup", "/somewhere/else.git")

	list, err := Remotes(dir)
	if err != nil {
		t.Fatalf("Remotes: %v", err)
	}
	// Once each, not once per direction: `git remote -v` prints fetch and push.
	if len(list) != 2 {
		t.Fatalf("remotes: %+v", list)
	}
	byName := map[string]string{}
	for _, r := range list {
		byName[r.Name] = r.URL
	}
	if byName["origin"] != "https://example.invalid/one.git" || byName["backup"] != "/somewhere/else.git" {
		t.Fatalf("remotes read as %+v", byName)
	}
}

func TestStashCountCountsWhatIsPutAside(t *testing.T) {
	dir := repo(t)
	write(t, dir, "a.txt", "one\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "start")

	if n := StashCount(dir); n != 0 {
		t.Fatalf("an empty stash counted %d", n)
	}
	write(t, dir, "a.txt", "two\n")
	if err := StashPush(dir, "first aside"); err != nil {
		t.Fatalf("StashPush: %v", err)
	}
	write(t, dir, "a.txt", "three\n")
	if err := StashPush(dir, "second aside"); err != nil {
		t.Fatalf("StashPush: %v", err)
	}
	if n := StashCount(dir); n != 2 {
		t.Fatalf("two stashes counted %d", n)
	}
	if err := StashPop(dir); err != nil {
		t.Fatalf("StashPop: %v", err)
	}
	if n := StashCount(dir); n != 1 {
		t.Fatalf("after a pop, %d", n)
	}
}

func TestFetchedIsZeroUntilSomethingIsFetched(t *testing.T) {
	dir := repo(t)
	write(t, dir, "a.txt", "one\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "start")

	if got := Fetched(dir); got != 0 {
		t.Fatalf("a repository that never fetched reported %d", got)
	}

	// A fetch from a second repository on disk — no network in a test.
	other := repo(t)
	write(t, other, "b.txt", "two\n")
	git(t, other, "add", "-A")
	git(t, other, "commit", "-qm", "elsewhere")
	git(t, dir, "remote", "add", "other", other)
	git(t, dir, "fetch", "-q", "other")

	got := Fetched(dir)
	if got == 0 {
		t.Fatalf("after a fetch it still reported never")
	}
	if delta := time.Since(time.UnixMilli(got)); delta < 0 || delta > time.Hour {
		t.Fatalf("the fetch time %d is %v ago", got, delta)
	}
}

// The history carries what points at each commit. Without it the list is a
// column of sentences with nothing to hold on to.
func TestLogCarriesWhatPointsAtACommit(t *testing.T) {
	dir := repo(t)
	write(t, dir, "a.txt", "one\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "start")
	git(t, dir, "tag", "v1")
	write(t, dir, "a.txt", "two\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "second")

	list, err := Log(dir, 5)
	if err != nil {
		t.Fatalf("Log: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("log: %+v", list)
	}
	if list[0].Subject != "second" || list[1].Subject != "start" {
		t.Fatalf("order: %+v", list)
	}
	if !strings.Contains(list[1].Refs, "tag: v1") {
		t.Fatalf("the tagged commit carries refs %q", list[1].Refs)
	}
	if !strings.Contains(list[0].Refs, "HEAD") {
		t.Fatalf("the newest commit carries refs %q", list[0].Refs)
	}
	// The fields that were there before are still there.
	if list[0].Author != "t" || list[0].When == 0 || list[0].Hash == "" {
		t.Fatalf("a log entry lost a field: %+v", list[0])
	}
}

// A folder git has never been told about is an ordinary folder, and the
// overview asks these calls about it all the same.
func TestTheFolderCallsSayNoRatherThanCrash(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if IsRepo(dir) {
		t.Fatalf("a plain directory reported itself a repository")
	}
	if n := StashCount(dir); n != 0 {
		t.Fatalf("StashCount: %d", n)
	}
	if got := Fetched(dir); got != 0 {
		t.Fatalf("Fetched: %d", got)
	}
	if _, err := Show(dir, "HEAD"); err == nil {
		t.Fatalf("Show found a commit in a plain directory")
	}
}
