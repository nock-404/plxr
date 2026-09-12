package daemon

import (
	"os"
	"path/filepath"
	"testing"
)

// A damaged settings file must not become a lost one.
//
// Reading it swallowed the error and gave back "nothing remembered". The
// interface then came up on defaults, and the next change wrote the file anew
// from that empty state — a read error turned into permanent loss, without a
// word anywhere.
func TestBrokenPrefsAreKeptNotOverwritten(t *testing.T) {
	home := t.TempDir()
	t.Setenv("PLXR_HOME", home)

	if err := WritePrefs(map[string]any{"plxr.theme": "crt", "plxr.lang": "de"}); err != nil {
		t.Fatalf("could not write: %v", err)
	}
	if got := ReadPrefs()["plxr.theme"]; got != "crt" {
		t.Fatalf("theme did not come back: %v", got)
	}

	// Half a file, exactly what an interrupted write leaves behind.
	if err := os.WriteFile(filepath.Join(home, "prefs.json"), []byte(`{"plxr.theme": "c`), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := WritePrefs(map[string]any{"plxr.filter": "x"}); err != nil {
		t.Fatalf("could not write: %v", err)
	}

	aside := filepath.Join(home, "prefs.json.broken")
	if _, err := os.Stat(aside); err != nil {
		t.Errorf("the damaged file was not kept: %v", err)
	}
	if b, err := os.ReadFile(aside); err == nil && string(b) != `{"plxr.theme": "c` {
		t.Errorf("what was kept is not the damaged file: %s", b)
	}
	if got := ReadPrefs()["plxr.filter"]; got != "x" {
		t.Errorf("the new setting is missing: %v", got)
	}
}

// Written beside it and moved into place, so an interrupted write cannot leave
// half a file behind.
func TestPrefsAreWrittenAtomically(t *testing.T) {
	home := t.TempDir()
	t.Setenv("PLXR_HOME", home)
	if err := WritePrefs(map[string]any{"a": "1"}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(home, "prefs.json.tmp")); !os.IsNotExist(err) {
		t.Error("the temporary file is still lying there")
	}
}

// The ceiling rides the same blob as everything else and is read back as a
// number of tokens — whether it was written as one, typed as text, or never
// set at all.
func TestTheCeilingRidesThePrefsBlob(t *testing.T) {
	home := t.TempDir()
	t.Setenv("PLXR_HOME", home)

	if got := PaceLimit(); got != 0 {
		t.Fatalf("nothing set, but a ceiling of %d came back", got)
	}
	if err := WritePrefs(map[string]any{"paceLimit": 1500000.0, "theme": map[string]any{"skin": "crt"}}); err != nil {
		t.Fatal(err)
	}
	if got := PaceLimit(); got != 1500000 {
		t.Fatalf("ceiling written as a number came back as %d", got)
	}
	// Clearing it removes the key and leaves the rest alone.
	if err := WritePrefs(map[string]any{"paceLimit": nil}); err != nil {
		t.Fatal(err)
	}
	if got := PaceLimit(); got != 0 {
		t.Fatalf("ceiling cleared, but %d came back", got)
	}
	if _, ok := ReadPrefs()["theme"]; !ok {
		t.Fatal("clearing the ceiling took the theme with it")
	}

	cases := map[any]int64{"250000": 250000, " 12 ": 12, "x": 0, -5.0: 0, 0.0: 0, true: 0}
	for raw, want := range cases {
		if got := paceLimitOf(raw); got != want {
			t.Errorf("paceLimitOf(%v) = %d, want %d", raw, got, want)
		}
	}
}
