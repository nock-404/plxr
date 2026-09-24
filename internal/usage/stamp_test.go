package usage

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"plxr/internal/accounts"
)

/*
The readout has to follow the file, not the clock.

	The figures come off a file Claude Code rewrites when it runs, and the only
	thing that used to make plxr look again was a fifteen-second timer behind a
	twenty-second poll. A session window that had just come back was still shown
	as full; he wanted it live (24.09.2026). The stamp is what makes the
	difference visible without reading the file, so it has to change when the
	file changes — and stay put when it does not.
*/
func TestTheStampFollowsTheFile(t *testing.T) {
	dir := t.TempDir()
	home := filepath.Join(dir, ".claude")
	if err := os.MkdirAll(home, 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(home, ".claude.json")
	write := func(body string) {
		if err := os.WriteFile(file, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	accs := []accounts.Account{{Name: "claude", Dir: home}}

	write(`{"cachedUsageUtilization":{"fetchedAtMs":1,"utilization":{"five_hour":{"utilization":99}}}}`)
	first := ConfigStamp(accs)
	if first == "" {
		t.Fatal("a file that is there leaves no stamp")
	}
	if again := ConfigStamp(accs); again != first {
		t.Fatalf("an untouched file changed its stamp:\n%q\n%q", first, again)
	}

	// The same length with different figures: a stamp that only looked at the
	// size would call this the same file, and the window would keep the old
	// percentage on screen.
	time.Sleep(10 * time.Millisecond)
	write(`{"cachedUsageUtilization":{"fetchedAtMs":2,"utilization":{"five_hour":{"utilization":11}}}}`)
	if second := ConfigStamp(accs); second == first {
		t.Fatal("a rewritten file kept its stamp, so a reset window would stay on screen as full")
	}
}

// An account with nothing on disk must not make the stamp unreadable, and two
// accounts must not be able to hide each other's changes.
func TestTheStampKeepsAccountsApart(t *testing.T) {
	dir := t.TempDir()
	one, two := filepath.Join(dir, ".claude"), filepath.Join(dir, ".claude2")
	for _, d := range []string{one, two} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	accs := []accounts.Account{{Name: "claude", Dir: one}, {Name: "claude2", Dir: two}}
	if got := ConfigStamp(accs); got != "" {
		t.Fatalf("two empty accounts left a stamp: %q", got)
	}
	if err := os.WriteFile(filepath.Join(two, ".claude.json"), []byte(`{}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if ConfigStamp(accs) == "" {
		t.Fatal("the second account's file left no stamp")
	}
}
