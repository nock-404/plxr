package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

/* The one answer the folder overview is drawn from.
 *
 * Six git calls and a walk of the directory, assembled into one report. What
 * is worth checking here is not each call — internal/git has those — but that
 * the assembly says the right thing about the two folders that actually turn
 * up: a repository with work in it, and a directory git has never heard of.
 */

func TestTheFolderReportReadsARepository(t *testing.T) {
	dir := t.TempDir()
	gitrun(t, dir, "init", "-q", "-b", "main", ".")
	write := func(name, text string) {
		t.Helper()
		full := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("README.md", "# the folder\n\nwhat it is for\n")
	write("main.go", "package main\n\nfunc main() {}\n")
	write("lib/one.go", "package lib\n")
	write("web/app.ts", "export const a = 1;\n")
	gitrun(t, dir, "add", "-A")
	gitrun(t, dir, "commit", "-qm", "the first one\n\nwith a body")
	gitrun(t, dir, "remote", "add", "origin", "https://example.invalid/thing.git")

	// One staged change and one that is not, so the three counts differ.
	write("main.go", "package main\n\nfunc main() { println(1) }\n")
	gitrun(t, dir, "add", "main.go")
	write("lib/one.go", "package lib\n\n// and a comment\n")
	write("fresh.txt", "never seen\n")

	c := coreOn(t, dir)
	r, err := c.FolderReport("s")
	if err != nil {
		t.Fatalf("FolderReport: %v", err)
	}
	if !r.Repo {
		t.Fatal("a repository reported itself as a plain folder")
	}
	if r.Where == nil || r.Where.Branch != "main" {
		t.Fatalf("branch: %+v", r.Where)
	}
	if r.Staged != 1 || r.Unstaged != 1 || r.Untracked != 1 || !r.Dirty {
		t.Fatalf("counts: staged %d unstaged %d untracked %d dirty %v",
			r.Staged, r.Unstaged, r.Untracked, r.Dirty)
	}
	if r.Head == nil || r.Head.Subject != "the first one" {
		t.Fatalf("head: %+v", r.Head)
	}
	if !strings.Contains(r.Head.Body, "with a body") {
		t.Fatalf("head body %q", r.Head.Body)
	}
	if len(r.Head.Files) != 4 {
		t.Fatalf("head touched %+v", r.Head.Files)
	}
	if len(r.Log) != 1 || r.Log[0].Subject != "the first one" {
		t.Fatalf("log: %+v", r.Log)
	}
	if len(r.Remotes) != 1 || r.Remotes[0].URL != "https://example.invalid/thing.git" {
		t.Fatalf("remotes: %+v", r.Remotes)
	}
	if r.Fetched != 0 {
		t.Fatalf("a repository that never fetched reported %d", r.Fetched)
	}
	if r.Stashes != 0 {
		t.Fatalf("stashes: %d", r.Stashes)
	}
	// The plain facts: five files, two directories, and a README that was read.
	if r.Facts.Files != 5 || r.Facts.Folders != 2 {
		t.Fatalf("facts: %d files, %d folders", r.Facts.Files, r.Facts.Folders)
	}
	if r.Facts.Size <= 0 || r.Facts.Touched <= 0 {
		t.Fatalf("size %d, touched %d", r.Facts.Size, r.Facts.Touched)
	}
	if !strings.HasPrefix(r.Facts.Readme, "# the folder") || r.Facts.ReadmePath != "README.md" {
		t.Fatalf("readme %q from %q", r.Facts.Readme, r.Facts.ReadmePath)
	}
	// Two .go files against one .ts and one .md: Go leads.
	if len(r.Facts.Languages) == 0 || r.Facts.Languages[0].Name != "Go" || r.Facts.Languages[0].Files != 2 {
		t.Fatalf("languages: %+v", r.Facts.Languages)
	}
	if r.Name != filepath.Base(dir) {
		t.Fatalf("name %q for %q", r.Name, dir)
	}
}

// A folder that is not a repository is an ordinary thing to have open. It gets
// the facts that apply to it and no git sections — and, above all, an answer
// rather than a failure.
func TestTheFolderReportOfAPlainDirectory(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "notes.md"), []byte("# notes\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	c := coreOn(t, dir)
	r, err := c.FolderReport("s")
	if err != nil {
		t.Fatalf("a plain folder was refused: %v", err)
	}
	if r.Repo {
		t.Fatal("a plain folder reported itself a repository")
	}
	if r.Where != nil || r.Head != nil {
		t.Fatalf("a plain folder carried git state: %+v %+v", r.Where, r.Head)
	}
	// Never nil where the window loops: a null list is a crash in the page.
	if r.Log == nil || r.Remotes == nil || r.Facts.Languages == nil || r.Facts.Ignored == nil {
		t.Fatalf("a list came back nil: %+v", r)
	}
	if r.Facts.Files != 1 {
		t.Fatalf("facts: %+v", r.Facts)
	}
}

// A repository with nothing committed in it yet: git init and nothing else.
// Every call the report makes has no answer, and the report still has to be
// one — this is the state of a folder somebody started ten seconds ago.
func TestTheFolderReportOfARepositoryWithNoCommits(t *testing.T) {
	dir := t.TempDir()
	gitrun(t, dir, "init", "-q", ".")
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	c := coreOn(t, dir)
	r, err := c.FolderReport("s")
	if err != nil {
		t.Fatalf("an empty repository was refused: %v", err)
	}
	if !r.Repo {
		t.Fatal("it is a repository")
	}
	if r.Head != nil {
		t.Fatalf("there is no commit to be on: %+v", r.Head)
	}
	if len(r.Log) != 0 {
		t.Fatalf("log: %+v", r.Log)
	}
	if r.Untracked != 1 {
		t.Fatalf("the one file is new: %+v", r)
	}
}

func TestShowCommitReachesBackThroughTheHistory(t *testing.T) {
	dir := t.TempDir()
	gitrun(t, dir, "init", "-q", ".")
	for _, one := range []struct{ text, message string }{
		{"one\n", "first"},
		{"one\ntwo\n", "second"},
		{"one\ntwo\nthree\n", "third"},
	} {
		if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte(one.text), 0o644); err != nil {
			t.Fatal(err)
		}
		gitrun(t, dir, "add", "-A")
		gitrun(t, dir, "commit", "-qm", one.message)
	}

	c := coreOn(t, dir)
	r, err := c.FolderReport("s")
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Log) != 3 {
		t.Fatalf("log: %+v", r.Log)
	}
	// The oldest of the three, reached by the hash the history handed over.
	got, err := c.ShowCommit("s", r.Log[2].Hash)
	if err != nil {
		t.Fatalf("ShowCommit: %v", err)
	}
	if got.Subject != "first" {
		t.Fatalf("subject %q", got.Subject)
	}
	if len(got.Files) != 1 || got.Files[0].Path != "a.txt" || got.Files[0].Added != 1 {
		t.Fatalf("files: %+v", got.Files)
	}
	// And the middle one, which added exactly one line.
	if middle, err := c.ShowCommit("s", r.Log[1].Hash); err != nil {
		t.Fatalf("ShowCommit: %v", err)
	} else if middle.Added != 1 || middle.Removed != 0 {
		t.Fatalf("the middle commit: +%d -%d", middle.Added, middle.Removed)
	}
}
