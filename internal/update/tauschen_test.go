package update

import (
	"os"
	"path/filepath"
	"testing"
)

func bündel(t *testing.T, pfad, inhalt string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(pfad, "Contents", "MacOS"), 0o755); err != nil {
		t.Fatal(err)
	}
	f := filepath.Join(pfad, "Contents", "MacOS", "plxr")
	if err := os.WriteFile(f, []byte(inhalt), 0o755); err != nil {
		t.Fatal(err)
	}
}

func lies(t *testing.T, pfad string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(pfad, "Contents", "MacOS", "plxr"))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestTauschErsetztUndRaeumtAuf(t *testing.T) {
	dir := t.TempDir()
	ziel := filepath.Join(dir, "plxr.app")
	neu := filepath.Join(dir, "quelle.app")
	bündel(t, ziel, "alt")
	bündel(t, neu, "neu")

	if err := tauschen(neu, ziel); err != nil {
		t.Fatal(err)
	}
	if got := lies(t, ziel); got != "neu" {
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
func TestTauschLaesstAlteInRuheWennQuelleFehlt(t *testing.T) {
	dir := t.TempDir()
	ziel := filepath.Join(dir, "plxr.app")
	bündel(t, ziel, "alt")

	if err := tauschen(filepath.Join(dir, "gibtesnicht.app"), ziel); err == nil {
		t.Fatal("fehlende Quelle wurde nicht gemeldet")
	}
	if got := lies(t, ziel); got != "alt" {
		t.Errorf("die alte Fassung wurde angetastet: %q", got)
	}
	if _, err := os.Stat(ziel + ".neu"); err == nil {
		t.Error("halbe Kopie liegt noch herum")
	}
}

// Der eigentliche Punkt: solange kopiert wird, muss am Zielort noch die alte
// Fassung stehen. Sonst wäre die App bei einem Abbruch kaputt.
func TestZielortBleibtWaehrendDesKopierensBestehen(t *testing.T) {
	dir := t.TempDir()
	ziel := filepath.Join(dir, "plxr.app")
	neu := filepath.Join(dir, "quelle.app")
	bündel(t, ziel, "alt")
	bündel(t, neu, "neu")

	// Nachbilden, was tauschen tut, und dazwischen nachsehen.
	daneben := ziel + ".neu"
	if err := kopieren(neu, daneben); err != nil {
		t.Fatal(err)
	}
	if got := lies(t, ziel); got != "alt" {
		t.Errorf("während des Kopierens stand am Zielort %q statt der alten Fassung", got)
	}
	os.RemoveAll(daneben)
}
