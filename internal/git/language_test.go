package git

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

/* git speaks the language of the machine, and this program reads its answers.
 *
 * "nothing to commit", "did not match any files" — plxr decides what happened
 * by looking for those words. On a machine set to another language git says
 * the same thing in that language, and every one of those checks quietly
 * stops matching: a commit with nothing staged reports an unknown error
 * instead of saying so, and unstaging a path that git no longer knows takes
 * the whole batch down.
 *
 * The fix is not to translate the patterns — there are dozens of languages.
 * It is to pin git's own language for the calls plxr makes. That is what this
 * checks, without needing a German git installed: a stand-in on the PATH
 * writes down the environment it was called with.
 */

// fakeGit puts a script named git first on the PATH, which records its
// environment and says nothing else.
func fakeGit(t *testing.T) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("the stand-in is a shell script")
	}
	dir := t.TempDir()
	log := filepath.Join(dir, "env.txt")
	script := "#!/bin/sh\nenv > " + log + "\nexit 0\n"
	if err := os.WriteFile(filepath.Join(dir, "git"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	return log
}

func envOf(t *testing.T, log string) map[string]string {
	t.Helper()
	raw, err := os.ReadFile(log)
	if err != nil {
		t.Fatalf("git was never called: %v", err)
	}
	seen := map[string]string{}
	for _, line := range strings.Split(string(raw), "\n") {
		if k, v, ok := strings.Cut(line, "="); ok {
			seen[k] = v
		}
	}
	return seen
}

func TestGitIsAskedInALanguageWeCanRead(t *testing.T) {
	// The machine this runs on is German, as the user's is.
	t.Setenv("LC_ALL", "de_DE.UTF-8")
	t.Setenv("LANG", "de_DE.UTF-8")
	t.Setenv("LANGUAGE", "de")
	log := fakeGit(t)

	if _, err := Run(t.TempDir(), "status"); err != nil {
		t.Fatalf("the stand-in did not run: %v", err)
	}
	seen := envOf(t, log)
	for _, name := range []string{"LC_ALL", "LANG"} {
		if seen[name] != "C" {
			t.Errorf("git was called with %s=%q — it will answer in German and nothing will match", name, seen[name])
		}
	}
	if seen["LANGUAGE"] != "" {
		t.Errorf("git was called with LANGUAGE=%q, which outranks the rest", seen["LANGUAGE"])
	}
}

// Everything else about the environment has to survive — the PATH above all,
// because git itself starts programs.
func TestPinningTheLanguageKeepsTheRest(t *testing.T) {
	t.Setenv("PLXR_SOMETHING", "kept")
	log := fakeGit(t)
	if _, err := Run(t.TempDir(), "status"); err != nil {
		t.Fatalf("the stand-in did not run: %v", err)
	}
	seen := envOf(t, log)
	if seen["PLXR_SOMETHING"] != "kept" {
		t.Error("the environment was replaced instead of extended")
	}
	if seen["PATH"] == "" {
		t.Error("git was left without a PATH")
	}
}

// The other packages that run git go through the same door.
func TestEveryCallerIsPinned(t *testing.T) {
	t.Setenv("LC_ALL", "de_DE.UTF-8")
	log := fakeGit(t)
	cmd := Command(context.Background(), t.TempDir(), "ls-files")
	if err := cmd.Run(); err != nil {
		t.Fatalf("the stand-in did not run: %v", err)
	}
	if envOf(t, log)["LC_ALL"] != "C" {
		t.Error("Command hands out a call that will answer in the machine's language")
	}
}

/* The age of a commit is a number, not a sentence.
 *
 * It used to arrive from git already worded — "3 days ago", in the language of
 * the machine — and was put on the screen as it came. That was the one string
 * in the window that could not be translated, and with git now pinned to one
 * language it would have been English in a German window for good.
 */
func TestCommitAgesComeAsNumbers(t *testing.T) {
	dir := t.TempDir()
	for _, args := range [][]string{
		{"init", "-q", "-b", "main", "."},
		{"-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "one"},
	} {
		if out, err := Command(context.Background(), dir, args...).CombinedOutput(); err != nil {
			t.Skipf("no usable git here: %v %s", err, out)
		}
	}

	now := time.Now().UnixMilli()
	log, err := Log(dir, 5)
	if err != nil || len(log) == 0 {
		t.Fatalf("no history: %v", err)
	}
	if log[0].When < now-10*60*1000 || log[0].When > now+10*60*1000 {
		t.Errorf("the commit is dated %d, which is not a moment ago in milliseconds", log[0].When)
	}

	branches, err := Branches(dir)
	if err != nil || len(branches) == 0 {
		t.Fatalf("no branches: %v", err)
	}
	if branches[0].When < now-10*60*1000 || branches[0].When > now+10*60*1000 {
		t.Errorf("the branch is dated %d, which is not a moment ago in milliseconds", branches[0].When)
	}
}
