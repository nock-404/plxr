package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"plxr/internal/session"
)

/* One loop per folder, however many are looking.
 *
 * The whole point of the watcher is that two windows on one folder do not
 * become two `git status` loops. That is not something a reader can see from
 * the code alone, so it is measured: subscribe twice, count the loops.
 */

func gitRepo(t *testing.T) string {
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
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("one\ntwo\nthree\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("init", "-q", "-b", "main", ".")
	run("add", "-A")
	run("commit", "-qm", "start")
	return dir
}

func watchCore(t *testing.T, cwd string) (*Core, string) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("PLXR_HOME", home)
	reg, err := session.NewRegistry(filepath.Join(home, "sessions"))
	if err != nil {
		t.Fatal(err)
	}
	c := New(reg, os.DirFS("../../assets/themes"), os.DirFS("../../assets/agents"), os.DirFS("../../assets/skins"))
	s := &session.Session{ID: "sess1", Cwd: cwd}
	reg.Put(s)
	return c, s.ID
}

func nextFrame(t *testing.T, sub *ChangesSub, within time.Duration) ChangesFrame {
	t.Helper()
	select {
	case f := <-sub.Frames():
		return f
	case <-time.After(within):
		t.Fatalf("no frame within %v", within)
		return ChangesFrame{}
	}
}

func TestTwoSubscribersShareOneLoop(t *testing.T) {
	dir := gitRepo(t)
	c, id := watchCore(t, dir)

	a, err := c.SubscribeChanges(id)
	if err != nil {
		t.Fatal(err)
	}
	// The same folder by another id — a workspace on the session's
	// directory — is the same watcher, not a second one.
	ws, err := c.OpenWorkspace(dir)
	if err != nil {
		t.Fatal(err)
	}
	b, err := c.SubscribeChanges(ws.ID)
	if err != nil {
		t.Fatal(err)
	}

	fa := nextFrame(t, a, 5*time.Second)
	fb := nextFrame(t, b, 5*time.Second)
	if fa.Rev == "" || fa.Rev != fb.Rev {
		t.Fatalf("the two subscribers saw different states: %q vs %q", fa.Rev, fb.Rev)
	}
	if fa.Where.Branch != "main" {
		t.Fatalf("branch: got %q", fa.Where.Branch)
	}
	if fa.Head == "" {
		t.Fatal("no head in the frame")
	}
	if len(fa.Changes) != 0 {
		t.Fatalf("a clean folder reported %d changes", len(fa.Changes))
	}

	watchers, subs, _ := c.WatchCount(dir)
	if watchers != 1 || subs != 2 {
		t.Fatalf("want 1 watcher with 2 subscribers, got %d with %d", watchers, subs)
	}

	// A change on disk reaches both, with the same rev, without asking.
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("one\nTWO\nthree\nfour\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	fa = nextFrame(t, a, 5*time.Second)
	fb = nextFrame(t, b, 5*time.Second)
	if fa.Rev != fb.Rev {
		t.Fatalf("after the write the two saw different states: %q vs %q", fa.Rev, fb.Rev)
	}
	if len(fa.Changes) != 1 || fa.Changes[0].Path != "a.txt" || fa.Changes[0].Added != 2 || fa.Changes[0].Removed != 1 {
		t.Fatalf("the change was not seen as a.txt +2 -1: %+v", fa.Changes)
	}

	// Nothing more arrives while nothing moves: the same rev is not resent.
	select {
	case f := <-a.Frames():
		t.Fatalf("a frame arrived on an idle folder: %+v", f)
	case <-time.After(2500 * time.Millisecond):
	}

	// The first to leave changes nothing; the last one out stops the loop.
	a.Close()
	if watchers, subs, _ := c.WatchCount(dir); watchers != 1 || subs != 1 {
		t.Fatalf("after one close: %d watchers, %d subscribers", watchers, subs)
	}
	b.Close()
	if watchers, _, _ := c.WatchCount(dir); watchers != 0 {
		t.Fatalf("after the last close the watcher is still there: %d", watchers)
	}
	// Closing twice is harmless.
	b.Close()
}

func TestSubscribeRefusesWhatIsNotARepo(t *testing.T) {
	plain := t.TempDir()
	c, id := watchCore(t, plain)
	if _, err := c.SubscribeChanges(id); err == nil || err.Error() != "err.git.noRepo" {
		t.Fatalf("want err.git.noRepo, got %v", err)
	}
	if _, err := c.SubscribeChanges("no-such-id"); err == nil {
		t.Fatal("an unknown id was accepted")
	}
	if watchers, _, _ := c.WatchCount(plain); watchers != 0 {
		t.Fatalf("a refused subscription left a watcher behind: %d", watchers)
	}
}

func TestBaseFile(t *testing.T) {
	dir := gitRepo(t)
	c, id := watchCore(t, dir)

	// A tracked file: HEAD's text, whatever the working tree says now.
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("changed\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	b, err := c.BaseFile(id, "a.txt")
	if err != nil {
		t.Fatal(err)
	}
	if !b.Known || b.Text != "one\ntwo\nthree\n" || b.Binary {
		t.Fatalf("baseline of a tracked file: %+v", b)
	}

	// The absolute path the tree hands the editor works as well.
	b, err = c.BaseFile(id, filepath.Join(dir, "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if !b.Known || b.Text != "one\ntwo\nthree\n" {
		t.Fatalf("baseline by absolute path: %+v", b)
	}

	// An untracked file has no baseline, and that is not an error.
	if err := os.WriteFile(filepath.Join(dir, "fresh.txt"), []byte("new\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	b, err = c.BaseFile(id, "fresh.txt")
	if err != nil {
		t.Fatal(err)
	}
	if b.Known || b.Text != "" {
		t.Fatalf("an untracked file has a baseline: %+v", b)
	}

	// Outside the folder is refused, as everywhere else.
	if _, err := c.BaseFile(id, "../"+filepath.Base(dir)+"/../"); err == nil {
		t.Fatal("a path outside the folder was read")
	}
}
