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

/* A session is on the account its Claude is signed in as.
 *
 * plxr starts the shell with CLAUDE_CONFIG_DIR set to the account that was
 * picked and then believed itself. People keep aliases for their other
 * accounts — `claude2` sets that variable for one command — so the program in
 * the terminal sits on another account than the shell around it. Measured on a
 * real machine (23.09.2026): the line over the terminal said one account while
 * the work ran on another, and the usage shown was the untouched account's,
 * which is to say empty.
 *
 * Only the hook can know: it runs inside that process. This walks the whole
 * way — a hook message arrives naming the other directory, and the session is
 * read back.
 */
func TestTheAccountComesFromTheHook(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("needs a POSIX shell")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("PLXR_HOME", filepath.Join(home, ".plxr"))
	t.Setenv("SHELL", "/bin/sh")
	for _, name := range []string{".claude", ".claude2"} {
		if err := os.MkdirAll(filepath.Join(home, name, "projects"), 0o755); err != nil {
			t.Fatal(err)
		}
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

	sess, err := c.Create(work, nil, "probe", "claude")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Kill(sess.ID, true) })
	if got := accountOfSession(c, sess.ID); got != "claude" {
		t.Fatalf("started on %q, wanted claude", got)
	}

	// The hook, from inside a Claude signed in as the other account: it writes
	// its own environment down, and the state carries the same tty the
	// session has so the two are matched.
	state := hook.State{
		SessionID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
		Cwd:       work,
		Status:    "working",
		PID:       sess.PID,
		TTY:       sess.TTY,
		StartedAt: time.Now().UnixMilli(),
		UpdatedAt: time.Now().UnixMilli(),
		ConfigDir: filepath.Join(home, ".claude2"),
	}
	if err := os.MkdirAll(fleet.Dir(), 0o755); err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(state)
	if err := os.WriteFile(filepath.Join(fleet.Dir(), state.SessionID+".json"), b, 0o644); err != nil {
		t.Fatal(err)
	}

	got := ""
	for i := 0; i < 40 && got != "claude2"; i++ {
		time.Sleep(200 * time.Millisecond)
		got = accountOfSession(c, sess.ID)
	}
	if got != "claude2" {
		t.Errorf("the session reads as %q while its Claude is signed in on .claude2", got)
	}
}

func accountOfSession(c *Core, id string) string {
	for _, tile := range c.Snapshot("") {
		if tile.ID == id {
			return tile.Account
		}
	}
	return ""
}
