package fonts

import (
	"os"
	"path/filepath"
	"testing"
)

func TestImportListServeDelete(t *testing.T) {
	t.Setenv("PLXR_HOME", t.TempDir())

	if len(List()) != 0 {
		t.Fatal("a fresh store is not empty")
	}
	f, err := Import("My Nice Font.woff2", []byte("not really a font, but bytes"))
	if err != nil {
		t.Fatal(err)
	}
	if f.Family != "My Nice Font" || f.File != "My Nice Font.woff2" {
		t.Fatalf("unexpected font: %+v", f)
	}
	if got := List(); len(got) != 1 || got[0].Family != "My Nice Font" {
		t.Fatalf("the import is not listed: %+v", got)
	}
	if Path("My Nice Font.woff2") == "" {
		t.Fatal("the imported font is not served")
	}
	if err := Delete("My Nice Font.woff2"); err != nil {
		t.Fatal(err)
	}
	if len(List()) != 0 {
		t.Fatal("the font is still listed after delete")
	}
}

// Nothing outside the store can be reached, written or read, through the name.
func TestNamesCannotEscapeTheStore(t *testing.T) {
	home := t.TempDir()
	t.Setenv("PLXR_HOME", home)
	victim := filepath.Join(home, "secret.txt")
	if err := os.WriteFile(victim, []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{"../secret.txt", "../../etc/passwd", "/etc/hosts", "a/b.woff2"} {
		if _, err := Import(bad, []byte("x")); err == nil {
			// If it "succeeded", it must have landed inside the store as a bare name.
			if Path(filepath.Base(bad)) == "" {
				t.Fatalf("%q was accepted but is not in the store — it went elsewhere", bad)
			}
		}
	}
	if Path("../secret.txt") != "" {
		t.Fatal("a dot-dot name resolved to a real file")
	}
	if b, _ := os.ReadFile(victim); string(b) != "keep" {
		t.Fatal("a file outside the store was overwritten")
	}
	// A non-font extension is refused.
	if _, err := Import("evil.sh", []byte("#!/bin/sh")); err == nil {
		t.Fatal("a non-font file was accepted")
	}
}
