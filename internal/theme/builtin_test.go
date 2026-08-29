package theme

import (
	"os"
	"path/filepath"
	"testing"
)

// Every theme shipped in web/themes has to arrive in the list.
//
// This is written because three of them silently disappeared. `onAccent` was
// added to their palettes, the loader rejects a palette key it does not know,
// and a rejected theme was simply skipped — no error, no log line, no gap
// anybody could see. The interface just offered seven entries instead of ten,
// and only counting them showed it.
func TestEveryBuiltinThemeLoads(t *testing.T) {
	dir := filepath.Join("..", "..", "web", "themes")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("web/themes cannot be read: %v", err)
	}

	onDisk := map[string]bool{}
	for _, e := range entries {
		if filepath.Ext(e.Name()) == ".json" {
			onDisk[e.Name()] = true
		}
	}
	if len(onDisk) == 0 {
		t.Fatal("no theme found — the path is wrong, and then this test proves nothing")
	}

	// web/themes, not web: the app hands in exactly this subtree. Given the
	// whole tree the loader also finds the agent profiles and reports each of
	// them as a broken theme — noise that says nothing about themes.
	loaded := Load(os.DirFS(dir), os.DirFS(filepath.Join("..", "..", "web", "skins")))

	byName := map[string]bool{}
	for _, th := range loaded {
		byName[th.Name] = true
	}

	for file := range onDisk {
		name := file[:len(file)-len(".json")]
		if !byName[name] {
			t.Errorf("theme %q is on disk but not in the list", name)
		}
	}
	if len(loaded) != len(onDisk) {
		t.Errorf("%d themes on disk, %d loaded", len(onDisk), len(loaded))
	}
}
