package core

import (
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"

	"plxr/internal/ptyhost"
	"plxr/internal/session"
	"plxr/internal/uierr"
)

/* Three accounts, one transcript store, and the session that would not move.
 *
 * ~/.claude2/projects and ~/.claude3/projects pointed at ~/.claude/projects, so
 * every account read the same files. Picking another account from a session's
 * menu answered "Transcript not found" — about a conversation that was open in
 * front of him. The lookup asked whether the transcript's account was the one
 * being asked about, and the transcript's account is whichever of the three
 * happened to lead after folding; the other two were refused.
 */

// sharedStoreCore builds a home with three accounts whose projects folders are
// one directory, one transcript in it, and a stub `claude` that records the
// configuration directory it was started with. It answers with the core, the
// transcript id, its working directory and the file the stub writes.
func sharedStoreCore(t *testing.T) (*Core, string, string, string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("needs a POSIX shell and symlinks")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("PLXR_HOME", filepath.Join(home, ".plxr"))
	t.Setenv("SHELL", "/bin/sh")

	cwd := filepath.Join(home, "work")
	if err := os.MkdirAll(cwd, 0o755); err != nil {
		t.Fatal(err)
	}
	folder := strings.ReplaceAll(cwd, string(filepath.Separator), "-")
	first := filepath.Join(home, ".claude", "projects")
	if err := os.MkdirAll(filepath.Join(first, folder), 0o755); err != nil {
		t.Fatal(err)
	}
	id := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	body := `{"type":"user","cwd":"` + cwd + `","gitBranch":"main","message":{"model":"opus","content":"hi"}}` + "\n"
	if err := os.WriteFile(filepath.Join(first, folder, id+".jsonl"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, n := range []string{".claude2", ".claude3"} {
		dir := filepath.Join(home, n)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(first, filepath.Join(dir, "projects")); err != nil {
			t.Fatal(err)
		}
	}

	/* A claude of our own, so that what reaches the process can be read.
	 *
	 * The session is started as `sh -l -c "claude --resume …"`, and a login
	 * shell rebuilds PATH from the system's own files — so the stub is put on
	 * the path the one way that survives that: the profile of the home this
	 * test runs in.
	 */
	bin := filepath.Join(home, "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	record := filepath.Join(home, "started.txt")
	stub := "#!/bin/sh\n" +
		"printf '%s\\n' \"dir=${CLAUDE_CONFIG_DIR-none}\" \"args=$*\" >" + record + "\n" +
		"sleep 30\n"
	if err := os.WriteFile(filepath.Join(bin, "claude"), []byte(stub), 0o755); err != nil {
		t.Fatal(err)
	}
	profile := "PATH=" + bin + ":$PATH\nexport PATH\n"
	if err := os.WriteFile(filepath.Join(home, ".profile"), []byte(profile), 0o600); err != nil {
		t.Fatal(err)
	}

	reg, err := session.NewRegistry(filepath.Join(home, "sessions"))
	if err != nil {
		t.Fatal(err)
	}
	ptyhost.RecordingDir = filepath.Join(home, "recordings")
	t.Cleanup(func() { ptyhost.RecordingDir = "" })
	c := New(reg, os.DirFS("../../assets/themes"), os.DirFS("../../assets/agents"), os.DirFS("../../assets/skins"))

	names := []string{}
	for _, a := range c.Accounts() {
		names = append(names, a.Name)
	}
	if !slices.Equal(names, []string{"claude", "claude2", "claude3"}) {
		t.Fatalf("the three accounts were not found: %v", names)
	}
	return c, id, cwd, record
}

func TestATranscriptIsFoundForEveryAccountThatCanReadIt(t *testing.T) {
	c, id, _, _ := sharedStoreCore(t)

	for _, name := range []string{"", "claude", "claude2", "claude3"} {
		e, ok := c.archiveFind(id, name)
		if !ok {
			t.Fatalf("account %q reads the file and was told there is no transcript", name)
		}
		if e.ID != id {
			t.Fatalf("account %q was given transcript %q", name, e.ID)
		}
	}
	// Strictness is kept where it means something: a name that holds nothing
	// still finds nothing.
	if _, ok := c.archiveFind(id, "claude9"); ok {
		t.Fatal("an account with no such transcript was given one")
	}
	if _, ok := c.archiveFind("no-such-id", ""); ok {
		t.Fatal("a transcript that does not exist was found")
	}
}

// The refusal that is left says which conversation and which account, because
// "Transcript not found" on its own sends somebody through three home
// directories looking for a name they were never told.
func TestTheRefusalNamesTheAccountAndTheTranscript(t *testing.T) {
	c, _, _, _ := sharedStoreCore(t)

	c.reg.Put(&session.Session{
		ID: "gone", Cwd: t.TempDir(), Cmd: []string{"claude"},
		Account: "claude2", ClaudeSessionID: "99999999-0000-0000-0000-000000000000",
		Alive: true,
	})
	if _, e := c.SwitchAccount("gone", "claude3"); e == nil {
		t.Fatal("a session whose transcript is nowhere was moved all the same")
	} else {
		code, detail, found := strings.Cut(e.Error(), uierr.Sep)
		if code != "err.transcript.notInAccount" || !found {
			t.Fatalf("the refusal came back as %q", e.Error())
		}
		if !strings.Contains(detail, "99999999") || !strings.Contains(detail, "claude2") {
			t.Fatalf("the detail says %q, which names neither the transcript nor the account", detail)
		}
	}
}

/* The move itself: the session ends and comes back under the other account.
 *
 * Measured rather than assumed — the stub CLI writes down the configuration
 * directory it was handed, so this says the process really did start under
 * account 2's directory and really was told to resume that conversation.
 */
func TestSwitchingAccountResumesUnderTheTargetsConfigDir(t *testing.T) {
	c, id, cwd, record := sharedStoreCore(t)

	c.reg.Put(&session.Session{
		ID: "s1", Name: "work", Cwd: cwd, Cmd: []string{"claude"},
		Account: "claude3", ClaudeSessionID: id, Alive: true,
	})

	sess, err := c.SwitchAccount("s1", "claude2")
	if err != nil {
		t.Fatalf("the session would not move: %v", err)
	}
	t.Cleanup(func() { c.Kill(sess.ID, true) })

	if _, still := c.reg.Get("s1"); still {
		t.Fatal("the old session is still in the register, so it was never ended")
	}
	if sess.Account != "claude2" {
		t.Fatalf("it came back under %q", sess.Account)
	}
	want := []string{"claude", "--resume", id}
	if !slices.Equal(sess.Cmd, want) {
		t.Fatalf("it was started as %v instead of %v", sess.Cmd, want)
	}

	waitFor(t, "the CLI to be started", func() bool {
		b, err := os.ReadFile(record)
		return err == nil && strings.Contains(string(b), "args=")
	})
	b, err := os.ReadFile(record)
	if err != nil {
		t.Fatal(err)
	}
	got := string(b)
	home, _ := os.UserHomeDir()
	if !strings.Contains(got, "dir="+filepath.Join(home, ".claude2")+"\n") {
		t.Fatalf("the CLI was started with %q, not under account 2's configuration directory", got)
	}
	if !strings.Contains(got, "args=--resume "+id) {
		t.Fatalf("the CLI was started with %q, so it is not resuming that conversation", got)
	}
}

// Moving to the account it is already on is refused, and says so.
func TestSwitchingToTheSameAccountIsRefused(t *testing.T) {
	c, id, cwd, _ := sharedStoreCore(t)

	c.reg.Put(&session.Session{
		ID: "s2", Cwd: cwd, Cmd: []string{"claude"},
		Account: "claude3", ClaudeSessionID: id, Alive: true,
	})
	_, err := c.SwitchAccount("s2", "claude3")
	if err == nil || !strings.HasPrefix(err.Error(), "err.account.sameOne") {
		t.Fatalf("moving a session onto its own account answered %v", err)
	}
	if _, still := c.reg.Get("s2"); !still {
		t.Fatal("the session was ended over a move that was refused")
	}
}
