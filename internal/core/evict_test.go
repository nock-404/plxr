package core

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"plxr/internal/ptyhost"
	"plxr/internal/session"
)

/* A recycled pty must not inherit the last occupant's report.
 *
 * The hook's file is removed by Claude's own SessionEnd — when that event
 * comes. Terminated together with its shell, Claude sends none, and the file
 * said "permission" on a tty that nothing was waiting on: the ended tile kept
 * reading it, and the next session to open that pty number was one
 * millisecond away from inheriting it. So the session's end evicts every
 * report on its terminal. */
func TestTheHooksReportGoesWithTheSession(t *testing.T) {
	c := fleetCore(t,
		&session.Session{ID: "s1", Name: "one", PID: 100, TTY: "/dev/ttys009", Alive: true,
			StartedAt: 1000, Cmd: []string{"claude"}},
		map[string]any{"session_id": "mine", "pid": 101, "tty": "/dev/ttys009", "status": "permission", "updated_at": 2000},
		map[string]any{"session_id": "elsewhere", "pid": 102, "tty": "/dev/ttys004", "status": "working", "updated_at": 2000},
	)
	dir := filepath.Join(os.Getenv("PLXR_HOME"), "state")
	if _, err := os.Stat(filepath.Join(dir, "mine.json")); err != nil {
		t.Fatal("the report is not where the test put it")
	}
	if c.Snapshot("")[0].Status != session.StatusPermission {
		t.Fatal("the report did not reach the tile before the end")
	}

	evictFleet("/dev/ttys009", time.Now().UnixMilli())

	if _, err := os.Stat(filepath.Join(dir, "mine.json")); !os.IsNotExist(err) {
		t.Fatal("the report on the ended session's terminal is still there")
	}
	if _, err := os.Stat(filepath.Join(dir, "elsewhere.json")); err != nil {
		t.Fatal("a report on another terminal was evicted too")
	}
	/* The next occupant of the pty, started before the report's timestamp —
	   the race fleetStateFor's age check cannot see. Without the eviction it
	   would carry the old conversation's id and status. */
	c.reg.Put(&session.Session{ID: "s2", Name: "two", PID: 200, TTY: "/dev/ttys009", Alive: true,
		StartedAt: 1500, Cmd: []string{"claude"}, Cwd: t.TempDir()})
	for _, tile := range c.Snapshot("") {
		if tile.ID == "s2" && (tile.ClaudeSessionID != "" || tile.Status == session.StatusPermission) {
			t.Fatalf("the next session on the pty inherited %q/%q", tile.ClaudeSessionID, tile.Status)
		}
	}
}

// A report written after the end is the next occupant's and stays.
func TestANewerReportOnTheTerminalStays(t *testing.T) {
	fleetCore(t,
		&session.Session{ID: "s1", PID: 100, TTY: "/dev/ttys009", Alive: true, StartedAt: 1000},
		map[string]any{"session_id": "next", "pid": 300, "tty": "/dev/ttys009", "status": "working", "updated_at": 9000},
	)
	evictFleet("/dev/ttys009", 5000)
	if _, err := os.Stat(filepath.Join(os.Getenv("PLXR_HOME"), "state", "next.json")); err != nil {
		t.Fatal("the next occupant's report was evicted")
	}
}

// End to end: the host exits, watchEnd runs, the report is gone.
func TestTheEndOfTheHostEvictsItsTerminal(t *testing.T) {
	c := shellCore(t)
	s, err := c.Create(t.TempDir(), []string{"true"}, "", "")
	if err != nil {
		t.Skipf("no pty here: %v", err)
	}
	h := c.Host(s.ID)
	dir := filepath.Join(os.Getenv("PLXR_HOME"), "state")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	body := `{"session_id":"left-behind","pid":1,"tty":"` + s.TTY + `","status":"waiting","updated_at":` +
		itoa(time.Now().UnixMilli()) + `}`
	if err := os.WriteFile(filepath.Join(dir, "left-behind.json"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	// The shell runs `true` and then takes over; ending it ends the host.
	c.Kill(s.ID, false)
	select {
	case <-h.Done:
	case <-time.After(3 * ptyhost.KillGrace):
		t.Fatal("the host did not end")
	}
	waitFor(t, "the report to be evicted", func() bool {
		_, err := os.Stat(filepath.Join(dir, "left-behind.json"))
		return os.IsNotExist(err)
	})
	waitFor(t, "the session to be marked ended", func() bool {
		x, ok := c.reg.Get(s.ID)
		return ok && !x.Alive && x.EndedAt > 0
	})
}

func itoa(n int64) string {
	b := []byte{}
	if n == 0 {
		return "0"
	}
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}
