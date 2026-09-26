package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"plxr/internal/fleet"
	"plxr/internal/hook"
	"plxr/internal/ptyhost"
	"plxr/internal/session"
)

/*
Which conversation is open in a terminal is a fact about that terminal.

	It used to be recorded only where plxr had recognised the session as an
	agent of its own. His are login shells with Claude started inside them by
	hand, so the id was never kept — and the two things that need it could not
	work: the window offered to switch account and the service, looking the
	session up again, found no id; and resuming an orphaned session started a
	bare shell instead of picking the conversation up again, which is what he
	asked for on 26.09.2026.

	Measured on his machine that day: every session, including the three that
	were plainly Claude conversations, carried an empty id.
*/
func TestTheConversationIsRememberedForAPlainShell(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("needs a POSIX shell")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("PLXR_HOME", filepath.Join(home, ".plxr"))
	t.Setenv("SHELL", "/bin/sh")
	if err := os.MkdirAll(filepath.Join(home, ".claude", "projects"), 0o755); err != nil {
		t.Fatal(err)
	}
	work := filepath.Join(home, "work")
	if err := os.MkdirAll(work, 0o755); err != nil {
		t.Fatal(err)
	}

	reg, err := session.NewRegistry(filepath.Join(home, "sessions"))
	if err != nil {
		t.Fatal(err)
	}
	ptyhost.RecordingDir = filepath.Join(home, "recordings")
	t.Cleanup(func() { ptyhost.RecordingDir = "" })
	c := New(reg, os.DirFS("../../assets/themes"), os.DirFS("../../assets/agents"), os.DirFS("../../assets/skins"))

	// A plain login shell — not something plxr recognises as an agent. This is
	// how he works: the shell is the session, Claude is started inside it.
	sess, err := c.Create(work, nil, "shell", "claude")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Kill(sess.ID, true) })

	want := "cf7c64f7-214c-405d-a010-feaff0ec089d"
	state := hook.State{
		SessionID: want,
		Cwd:       work,
		Status:    "working",
		PID:       sess.PID + 1, // the CLI is a child of the shell, never the shell
		TTY:       sess.TTY,
		StartedAt: time.Now().UnixMilli(),
		UpdatedAt: time.Now().UnixMilli(),
	}
	if err := os.MkdirAll(fleet.Dir(), 0o755); err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(state)
	if err := os.WriteFile(filepath.Join(fleet.Dir(), state.SessionID+".json"), b, 0o644); err != nil {
		t.Fatal(err)
	}

	got := ""
	for i := 0; i < 40 && got != want; i++ {
		time.Sleep(200 * time.Millisecond)
		for _, tile := range c.Snapshot("") {
			if tile.ID == sess.ID {
				got = tile.ClaudeSessionID
			}
		}
	}
	if got != want {
		t.Fatalf("the tile carries %q, wanted the conversation the hook reported", got)
	}

	/* And written through, not only shown. Resuming looks the session up in
	   the registry and replaces the command with `claude --resume <id>`; a
	   tile that knows while the registry does not is exactly the state in
	   which resume starts a bare shell. */
	stored, ok := reg.Get(sess.ID)
	if !ok {
		t.Fatal("the session vanished from the registry")
	}
	if stored.ClaudeSessionID != want {
		t.Fatalf("the registry kept %q — resume would start a bare shell", stored.ClaudeSessionID)
	}
}
