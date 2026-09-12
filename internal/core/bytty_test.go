package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"plxr/internal/session"
)

/* The hook's report finds its session through the terminal, not the process.
 *
 * The CLI runs inside the login shell, so the pid the hook sees — Claude's — is
 * a child of the session's pid and never equal to it. Matching by pid therefore
 * found nothing, and a Claude tile stayed "unknown" for its whole life, with no
 * working, no waiting and no permission prompt ever shown. The pty is what both
 * sides know: the hook records the tty Claude sits on, the session the pty it
 * was opened on.
 */

func fleetCore(t *testing.T, sess *session.Session, states ...map[string]any) *Core {
	t.Helper()
	home := t.TempDir()
	t.Setenv("PLXR_HOME", home)
	// The legacy state directory lives under HOME, and on a developer's own
	// machine it holds the reports of whatever Claude is running right now —
	// on real ttys, which is exactly what these tests use as names.
	t.Setenv("HOME", home)
	reg, err := session.NewRegistry(filepath.Join(home, "sessions"))
	if err != nil {
		t.Fatal(err)
	}
	if sess.Cwd == "" {
		sess.Cwd = t.TempDir()
	}
	reg.Put(sess)
	dir := filepath.Join(home, "state")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, st := range states {
		body, _ := json.Marshal(st)
		name := st["session_id"].(string) + ".json"
		if err := os.WriteFile(filepath.Join(dir, name), body, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return New(reg, os.DirFS("../../assets/themes"), os.DirFS("../../assets/agents"), os.DirFS("../../assets/skins"))
}

func TestAClaudeChildOfTheShellIsFoundThroughItsTerminal(t *testing.T) {
	c := fleetCore(t,
		&session.Session{ID: "s1", PID: 100, TTY: "/dev/ttys009", Alive: true,
			StartedAt: 1000, Cmd: []string{"claude"}, Name: "one"},
		map[string]any{
			"session_id": "child-1", "pid": 101, "tty": "/dev/ttys009",
			"status": "permission", "title": "child of the shell", "updated_at": 2000,
		},
	)
	tiles := c.Snapshot("")
	if len(tiles) != 1 {
		t.Fatalf("expected the one session, got %d tiles", len(tiles))
	}
	if tiles[0].Status != session.StatusPermission {
		t.Fatalf("the status is %q; the hook's report never reached the tile", tiles[0].Status)
	}
	if tiles[0].ClaudeSessionID != "child-1" {
		t.Fatalf("the tile carries %q as Claude id", tiles[0].ClaudeSessionID)
	}
}

func TestTheNewestReportOnATerminalWins(t *testing.T) {
	c := fleetCore(t,
		&session.Session{ID: "s1", PID: 100, TTY: "/dev/ttys009", Alive: true,
			StartedAt: 1000, Cmd: []string{"claude"}},
		map[string]any{"session_id": "older", "pid": 101, "tty": "/dev/ttys009", "status": "working", "updated_at": 1500},
		map[string]any{"session_id": "newer", "pid": 102, "tty": "/dev/ttys009", "status": "waiting", "updated_at": 2500},
	)
	tiles := c.Snapshot("")
	if tiles[0].ClaudeSessionID != "newer" || tiles[0].Status != session.StatusWaiting {
		t.Fatalf("got %q/%q, wanted the newer report", tiles[0].ClaudeSessionID, tiles[0].Status)
	}
}

/* A recycled pty must not hand a session someone else's conversation.
 *
 * /dev/ttys003 goes to whoever opens it next. A report a previous occupant left
 * behind is older than this session's start — and after a restart in place the
 * previous occupant was this very session's earlier life, on the same tty. */
func TestAReportFromBeforeTheSessionStartedIsNotItsOwn(t *testing.T) {
	c := fleetCore(t,
		&session.Session{ID: "s1", PID: 100, TTY: "/dev/ttys003", Alive: true,
			StartedAt: 5000, Cmd: []string{"claude"}},
		map[string]any{"session_id": "previous-life", "pid": 77, "tty": "/dev/ttys003",
			"status": "permission", "title": "not yours", "updated_at": 4000},
	)
	tiles := c.Snapshot("")
	if tiles[0].ClaudeSessionID != "" {
		t.Fatalf("inherited the previous occupant's conversation %q", tiles[0].ClaudeSessionID)
	}
	if tiles[0].Status == session.StatusPermission {
		t.Fatal("inherited the previous occupant's status")
	}
}

func TestASessionWithoutATerminalStillMatchesByPid(t *testing.T) {
	c := fleetCore(t,
		&session.Session{ID: "s1", PID: 4242, Alive: true, StartedAt: 1000, Cmd: []string{"claude"}},
		map[string]any{"session_id": "by-pid", "pid": 4242, "tty": "/dev/ttys001", "status": "working", "updated_at": 2000},
	)
	tiles := c.Snapshot("")
	if tiles[0].ClaudeSessionID != "by-pid" || tiles[0].Status != session.StatusWorking {
		t.Fatalf("got %q/%q, wanted the pid fallback", tiles[0].ClaudeSessionID, tiles[0].Status)
	}
}
