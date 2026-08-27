package search

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func logfile(t *testing.T, dir, id, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, id+".log"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

/*
The hit alone does not help. The same error has been seen three times

	already; what is wanted is what came after it — the command that fixed it
	back then.
*/
func TestSearchReturnsWhatCameAfter(t *testing.T) {
	dir := t.TempDir()
	logfile(t, dir, "abc", strings.Join([]string{
		"$ npm run build",
		"ERROR: Cannot find module 'sharp'",
		"    at require (node:internal/modules)",
		"$ npm rebuild sharp --platform=darwin",
		"rebuilt sharp in 4.2s",
		"$ npm run build",
		"done",
	}, "\n"))

	hits := SearchRecordings(dir, "Cannot find module", nil)
	if len(hits) != 1 {
		t.Fatalf("%d hits instead of 1", len(hits))
	}
	after := strings.Join(hits[0].Danach, "\n")
	if !strings.Contains(after, "npm rebuild sharp") {
		t.Errorf("the fix is missing from the context:\n%s", after)
	}
	// The hit line itself belongs in Auszug, not in the context.
	if strings.Contains(after, "Cannot find module") {
		t.Error("the hit line was repeated in the context")
	}
}

// Only after the first hit — with five hundred hits nobody wants five hundred
// blocks of context.
func TestContextOnlyAfterFirstHit(t *testing.T) {
	dir := t.TempDir()
	var lines []string
	for i := 0; i < 5; i++ {
		lines = append(lines, "FEHLER hier", "danach-"+string(rune('a'+i)))
	}
	logfile(t, dir, "abc", strings.Join(lines, "\n"))

	hits := SearchRecordings(dir, "FEHLER", nil)
	if hits[0].Count != 5 {
		t.Errorf("counted %d hits instead of 5", hits[0].Count)
	}
	if len(hits[0].Danach) > AfterLines {
		t.Errorf("%d context lines, at most %d expected", len(hits[0].Danach), AfterLines)
	}
	// The context has to start right after the FIRST hit.
	if len(hits[0].Danach) == 0 || !strings.Contains(hits[0].Danach[0], "danach-a") {
		t.Errorf("context does not start after the first hit: %v", hits[0].Danach)
	}
}

// A hit on the very last line has no context — and must not break anything.
func TestHitOnLastLine(t *testing.T) {
	dir := t.TempDir()
	logfile(t, dir, "abc", "alles gut\nFEHLER am Ende")
	hits := SearchRecordings(dir, "FEHLER", nil)
	if len(hits) != 1 {
		t.Fatalf("%d hits", len(hits))
	}
	if len(hits[0].Danach) != 0 {
		t.Errorf("context appeared out of nowhere: %v", hits[0].Danach)
	}
}

// Escape sequences are in the raw stream. They must not reach the display.
func TestContextIsCleaned(t *testing.T) {
	dir := t.TempDir()
	logfile(t, dir, "abc", "FEHLER\n\x1b[31mrot\x1b[0m und weiter")
	hits := SearchRecordings(dir, "FEHLER", nil)
	after := strings.Join(hits[0].Danach, "\n")
	if strings.Contains(after, "\x1b") {
		t.Errorf("escape sequence reached the context: %q", after)
	}
	if !strings.Contains(after, "rot und weiter") {
		t.Errorf("text was lost in cleaning: %q", after)
	}
}

// Empty lines carry nothing and would push the useful lines out of the window.
func TestContextSkipsEmptyLines(t *testing.T) {
	dir := t.TempDir()
	logfile(t, dir, "abc", "FEHLER\n\n\n   \nendlich etwas")
	hits := SearchRecordings(dir, "FEHLER", nil)
	if len(hits[0].Danach) != 1 || !strings.Contains(hits[0].Danach[0], "endlich etwas") {
		t.Errorf("empty lines were not skipped: %v", hits[0].Danach)
	}
}
