package update

import (
	"os"
	"path/filepath"
	"testing"
)

func bundle(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(path, "Contents", "MacOS"), 0o755); err != nil {
		t.Fatal(err)
	}
	f := filepath.Join(path, "Contents", "MacOS", "plxr")
	if err := os.WriteFile(f, []byte(content), 0o755); err != nil {
		t.Fatal(err)
	}
}

func read(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(path, "Contents", "MacOS", "plxr"))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestSwapReplacesAndCleansUp(t *testing.T) {
	dir := t.TempDir()
	ziel := filepath.Join(dir, "plxr.app")
	fresh := filepath.Join(dir, "quelle.app")
	bundle(t, ziel, "alt")
	bundle(t, fresh, "neu")

	if err := swap(fresh, ziel); err != nil {
		t.Fatal(err)
	}
	if got := read(t, ziel); got != "neu" {
		t.Errorf("am Zielort steht %q", got)
	}
	for _, rest := range []string{ziel + ".alt", ziel + ".neu"} {
		if _, err := os.Stat(rest); err == nil {
			t.Errorf("%s liegt noch herum", filepath.Base(rest))
		}
	}
}

// Wenn die neue Fassung nicht abgelegt werden kann, darf die alte nicht
// angetastet werden — vorher wurde sie zuerst beiseitegeschoben.
func TestSwapLeavesOldAloneWhenSourceMissing(t *testing.T) {
	dir := t.TempDir()
	ziel := filepath.Join(dir, "plxr.app")
	bundle(t, ziel, "alt")

	if err := swap(filepath.Join(dir, "gibtesnicht.app"), ziel); err == nil {
		t.Fatal("fehlende Quelle wurde nicht gemeldet")
	}
	if got := read(t, ziel); got != "alt" {
		t.Errorf("die alte Fassung wurde angetastet: %q", got)
	}
	if _, err := os.Stat(ziel + ".neu"); err == nil {
		t.Error("halbe Kopie liegt noch herum")
	}
}

// Der eigentliche Punkt: solange kopiert wird, muss am Zielort noch die alte
// Fassung stehen. Sonst wäre die App bei einem Abbruch kaputt.
func TestTargetSurvivesTheCopy(t *testing.T) {
	dir := t.TempDir()
	ziel := filepath.Join(dir, "plxr.app")
	fresh := filepath.Join(dir, "quelle.app")
	bundle(t, ziel, "alt")
	bundle(t, fresh, "neu")

	// Nachbilden, was tauschen tut, und dazwischen nachsehen.
	daneben := ziel + ".neu"
	if err := copyTree(fresh, daneben); err != nil {
		t.Fatal(err)
	}
	if got := read(t, ziel); got != "alt" {
		t.Errorf("während des Kopierens stand am Zielort %q statt der alten Fassung", got)
	}
	os.RemoveAll(daneben)
}
