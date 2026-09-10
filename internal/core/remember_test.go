package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"plxr/internal/session"
)

/* What the hook reports has to be remembered, not written on a copy.
 *
 * Snapshot works on `c.reg.List()`, which hands out copies. The line that put
 * the Claude session id on a session therefore wrote it into a struct that was
 * thrown away at the end of the loop, and the registry never learned it. The
 * tile carried the id — so the window offered "switch account" — while the
 * daemon, asked to do it, looked the session up again, found an empty id and
 * refused. The same id is what resume needs to bring a transcript back, which
 * is why an orphaned session could not be resumed either.
 */
func TestTheReportedSessionIdIsRemembered(t *testing.T) {
	home := t.TempDir()
	t.Setenv("PLXR_HOME", home)

	reg, err := session.NewRegistry(filepath.Join(home, "sessions"))
	if err != nil {
		t.Fatal(err)
	}
	const id, pid = "s1", 424242
	reg.Put(&session.Session{ID: id, PID: pid, Alive: true, Cwd: t.TempDir(),
		Cmd: []string{"claude"}, Name: "one"})

	// What the hook leaves behind for a running Claude session.
	state := filepath.Join(home, "state")
	if err := os.MkdirAll(state, 0o755); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]any{
		"session_id": "abc-123", "pid": pid, "status": "working", "updated_at": 1,
	})
	if err := os.WriteFile(filepath.Join(state, "abc-123.json"), body, 0o644); err != nil {
		t.Fatal(err)
	}

	c := New(reg, os.DirFS("../../assets/themes"), os.DirFS("../../assets/agents"), os.DirFS("../../assets/skins"))
	tiles := c.Snapshot("")
	if len(tiles) != 1 {
		t.Fatalf("expected the one session, got %d tiles", len(tiles))
	}
	if tiles[0].ClaudeSessionID != "abc-123" {
		t.Fatalf("the tile does not carry the id either: %q", tiles[0].ClaudeSessionID)
	}

	kept, _ := reg.Get(id)
	if kept.ClaudeSessionID != "abc-123" {
		t.Fatal("the window is offered a switch the daemon will refuse: the id never reached the registry")
	}
}

/* A resume that cannot start must not take the orphan with it.
 *
 * cleanup ran before Create, and Create refuses when the folder is not there —
 * which for work on a volume that is not mounted is exactly the case in which
 * somebody presses resume. The session record and its file were already gone
 * by then, together with the Claude session id that is the only way back into
 * the conversation.
 */
func TestAFailedResumeKeepsTheOrphan(t *testing.T) {
	home := t.TempDir()
	t.Setenv("PLXR_HOME", home)
	reg, err := session.NewRegistry(filepath.Join(home, "sessions"))
	if err != nil {
		t.Fatal(err)
	}
	gone := filepath.Join(t.TempDir(), "not-mounted")
	reg.Put(&session.Session{ID: "s1", Alive: false, Orphaned: true, Cwd: gone,
		Cmd: []string{"claude"}, ClaudeSessionID: "abc-123", Name: "work"})

	c := New(reg, os.DirFS("../../assets/themes"), os.DirFS("../../assets/agents"), os.DirFS("../../assets/skins"))
	if _, err := c.ResumeOrphaned("s1"); err == nil {
		t.Fatal("a session was started in a folder that is not there")
	}
	kept, ok := reg.Get("s1")
	if !ok {
		t.Fatal("the orphan was deleted by a resume that never started anything")
	}
	if kept.ClaudeSessionID != "abc-123" {
		t.Fatalf("the id needed to pick the conversation up again is gone: %+v", kept)
	}
}
