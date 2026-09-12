package core

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"plxr/internal/ptyhost"
	"plxr/internal/session"
)

/* A session is a terminal, and a terminal outlives the program it started.
 *
 * The CLI runs inside the login shell. When it ends — /exit, Ctrl+D, a crash —
 * the shell takes its place on the same pty, and the session is still alive
 * with a prompt in it, not a dead panel. And a session that has really ended
 * comes back under the same id, so the panel, the recording and the marks all
 * stay where they were.
 */

func shellCore(t *testing.T) *Core {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("needs a POSIX shell")
	}
	home := t.TempDir()
	t.Setenv("PLXR_HOME", home)
	t.Setenv("HOME", home)
	t.Setenv("SHELL", "/bin/sh")
	reg, err := session.NewRegistry(filepath.Join(home, "sessions"))
	if err != nil {
		t.Fatal(err)
	}
	ptyhost.RecordingDir = filepath.Join(home, "recordings")
	t.Cleanup(func() { ptyhost.RecordingDir = "" })
	return New(reg, os.DirFS("../../assets/themes"), os.DirFS("../../assets/agents"), os.DirFS("../../assets/skins"))
}

// atPrompt says the screen ends in a shell prompt. The prompt is whatever the
// machine's own login files make it, so only its last character is relied on.
func atPrompt(h *ptyhost.Host) bool {
	tail := strings.TrimSpace(h.Tail(20))
	return strings.HasSuffix(tail, "$") || strings.HasSuffix(tail, "#") || strings.HasSuffix(tail, "%")
}

func waitFor(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if ok() {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("waited in vain for %s", what)
}

func TestWhenTheCLIEndsTheSessionDropsToAShell(t *testing.T) {
	c := shellCore(t)
	dir := t.TempDir()
	s, err := c.Create(dir, []string{"sh", "-c", "echo started; exit 0"}, "", "")
	if err != nil {
		t.Fatal(err)
	}
	// The logical command is what was asked for — not the shell wrapping it.
	if strings.Join(s.Cmd, " ") != "sh -c echo started; exit 0" {
		t.Fatalf("the session's command is %q, not the intent", s.Cmd)
	}
	h := c.Host(s.ID)
	waitFor(t, "the command's output", func() bool { return strings.Contains(h.Tail(20), "started") })
	waitFor(t, "a shell prompt after the command", func() bool { return atPrompt(h) })
	kept, _ := c.reg.Get(s.ID)
	if !kept.Alive || !h.Alive() {
		t.Fatal("the session ended with the command — no drop into the shell")
	}
	// And the shell is live: it answers.
	if _, err := h.Write([]byte("echo A-LIVE-SHELL\r")); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the shell to answer", func() bool { return strings.Contains(h.Tail(20), "A-LIVE-SHELL") })
	c.Kill(s.ID, true)
}

func TestARealTerminalIsTheShellItself(t *testing.T) {
	c := shellCore(t)
	s, err := c.Create(t.TempDir(), nil, "", "")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Kill(s.ID, true)
	if strings.Join(s.Cmd, " ") != "/bin/sh -l" {
		t.Fatalf("a plain terminal's command is %q, not the login shell", s.Cmd)
	}
	h := c.Host(s.ID)
	waitFor(t, "a prompt", func() bool { return atPrompt(h) })
	if _, err := h.Write([]byte("echo A-LIVE-SHELL\r")); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the shell to answer", func() bool { return strings.Contains(h.Tail(20), "A-LIVE-SHELL") })
}

func TestAnEndedSessionRestartsInPlaceUnderTheSameId(t *testing.T) {
	c := shellCore(t)
	dir := t.TempDir()
	s, err := c.Create(dir, []string{"sh", "-c", "echo first-life"}, "", "")
	if err != nil {
		t.Fatal(err)
	}
	old := c.Host(s.ID)
	waitFor(t, "the first output", func() bool { return strings.Contains(old.Tail(20), "first-life") })

	// A running session is not restarted over.
	if _, err := c.ResumeOrphaned(s.ID); err == nil {
		t.Fatal("restarted a session that is still running")
	}

	c.Kill(s.ID, false)
	waitFor(t, "the session to end", func() bool {
		x, _ := c.reg.Get(s.ID)
		return !x.Alive
	})
	logPath := filepath.Join(ptyhost.RecordingDir, s.ID+".log")
	<-old.Done
	before, err := os.Stat(logPath)
	if err != nil {
		t.Fatal(err)
	}

	back, err := c.ResumeOrphaned(s.ID)
	if err != nil {
		t.Fatal(err)
	}
	if back.ID != s.ID {
		t.Fatalf("came back as %s, not %s", back.ID, s.ID)
	}
	if !back.Alive || back.Orphaned || back.EndedAt != 0 || back.ExitCode != 0 {
		t.Fatalf("the restarted session reads %+v", back)
	}
	fresh := c.Host(s.ID)
	if fresh == nil || fresh == old {
		t.Fatal("no fresh host under the id")
	}
	if back.PID != fresh.PID || back.TTY != fresh.TTY {
		t.Fatal("the registry does not carry the new pid and tty")
	}
	defer c.Kill(s.ID, true)
	waitFor(t, "the second life's output", func() bool { return strings.Contains(fresh.Tail(20), "first-life") })
	waitFor(t, "a prompt in the second life", func() bool { return atPrompt(fresh) })

	// The registry entry stays alive — the old host's late "ended" did not land.
	time.Sleep(200 * time.Millisecond)
	kept, _ := c.reg.Get(s.ID)
	if !kept.Alive {
		t.Fatal("the restarted session was marked ended by its previous life")
	}

	// The recording carried on: the file only grew, and the new marks point
	// past where the first life ended.
	after, err := os.Stat(logPath)
	if err != nil {
		t.Fatal(err)
	}
	if after.Size() <= before.Size() {
		t.Fatalf("the recording did not grow: %d then %d", before.Size(), after.Size())
	}
	marks, err := c.Timeline(s.ID)
	if err != nil {
		t.Fatal(err)
	}
	last := marks[len(marks)-1]
	if last.Offset < before.Size() {
		t.Fatalf("the newest mark points at %d, inside the first life (which ended at %d)", last.Offset, before.Size())
	}
	if last.Offset > after.Size() {
		t.Fatalf("the newest mark points at %d, past the end of the recording (%d)", last.Offset, after.Size())
	}
}

func TestAFailedRestartLeavesTheOrphanUntouched(t *testing.T) {
	c := shellCore(t)
	gone := filepath.Join(t.TempDir(), "unmounted")
	c.reg.Put(&session.Session{ID: "o1", Cwd: gone, Cmd: []string{"claude"}, Orphaned: true,
		ClaudeSessionID: "keep-me", EndedAt: 1, ExitCode: -1})
	if _, err := c.ResumeOrphaned("o1"); err == nil {
		t.Fatal("restarted into a folder that is not there")
	}
	kept, ok := c.reg.Get("o1")
	if !ok || !kept.Orphaned || kept.ClaudeSessionID != "keep-me" {
		t.Fatalf("the orphan was touched: %+v", kept)
	}
	if c.Host("o1") != nil {
		t.Fatal("a host was left behind for a restart that did not happen")
	}
}
