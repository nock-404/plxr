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
		t.Errorf("the target holds %q", got)
	}
	for _, rest := range []string{ziel + ".alt", ziel + ".neu"} {
		if _, err := os.Stat(rest); err == nil {
			t.Errorf("%s is still lying around", filepath.Base(rest))
		}
	}
}

// If the new version cannot be put in place, the old one must not be touched —
// previously it was moved aside first.
func TestSwapLeavesOldAloneWhenSourceMissing(t *testing.T) {
	dir := t.TempDir()
	ziel := filepath.Join(dir, "plxr.app")
	bundle(t, ziel, "alt")

	if err := swap(filepath.Join(dir, "gibtesnicht.app"), ziel); err == nil {
		t.Fatal("a missing source was not reported")
	}
	if got := read(t, ziel); got != "alt" {
		t.Errorf("the old version was touched: %q", got)
	}
	if _, err := os.Stat(ziel + ".neu"); err == nil {
		t.Error("a half copy is still lying around")
	}
}

// The actual point: while the copy is running the old version has to still be at
// the target. Otherwise an abort would leave the app broken.
func TestTargetSurvivesTheCopy(t *testing.T) {
	dir := t.TempDir()
	ziel := filepath.Join(dir, "plxr.app")
	fresh := filepath.Join(dir, "quelle.app")
	bundle(t, ziel, "alt")
	bundle(t, fresh, "neu")

	// Reproduce what swap does, and look in between.
	daneben := ziel + ".neu"
	if err := copyTree(fresh, daneben); err != nil {
		t.Fatal(err)
	}
	if got := read(t, ziel); got != "alt" {
		t.Errorf("during the copy the target held %q instead of the old version", got)
	}
	os.RemoveAll(daneben)
}
