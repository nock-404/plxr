package usage

import (
	"os"
	"path/filepath"
	"testing"
)

/* An empty file must not answer for a full one.
 *
 * Claude Code keeps the default account's state in ~/.claude.json, beside the
 * directory rather than in it — and on a real machine (24.09.2026) there was
 * an empty ~/.claude/.claude.json as well. plxr took the first file it found
 * to exist, which was the empty one, and reported that it knew nothing about
 * the account somebody had been working on all day: 34% of the five-hour
 * window and 68% of the week, sitting unread in the file next to it.
 */
func TestTheFileWithSomethingInItWins(t *testing.T) {
	home := t.TempDir()
	dir := filepath.Join(home, ".claude")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	// There, and empty — as it was found.
	if err := os.WriteFile(filepath.Join(dir, ".claude.json"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	full := `{"cachedUsageUtilization":{"fetchedAtMs":1790000000000,"utilization":{` +
		`"five_hour":{"utilization":34,"resets_at":"2026-09-24T11:50:00Z"},` +
		`"seven_day":{"utilization":68,"resets_at":"2026-09-26T11:00:00Z"}}}}`
	if err := os.WriteFile(dir+".json", []byte(full), 0o644); err != nil {
		t.Fatal(err)
	}

	session, week, _, fetched, source := Limits(dir)
	if source != dir+".json" {
		t.Errorf("read %q, wanted the file beside the directory", source)
	}
	if !session.Known || session.Percent != 34 {
		t.Errorf("session window: known=%v percent=%d", session.Known, session.Percent)
	}
	if !week.Known || week.Percent != 68 {
		t.Errorf("week window: known=%v percent=%d", week.Known, week.Percent)
	}
	if fetched == 0 {
		t.Error("the reading has no time on it")
	}

	// And with nothing anywhere, nothing is invented.
	empty := t.TempDir()
	if _, _, _, _, src := Limits(filepath.Join(empty, ".claude")); src != "" {
		t.Errorf("an account with no state answered with %q", src)
	}
}
