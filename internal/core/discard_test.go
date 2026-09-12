package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A discard may only ever touch what is inside the folder.
func TestDiscardRefusesPathsThatLeaveTheFolder(t *testing.T) {
	outer := t.TempDir()
	dir := filepath.Join(outer, "repo")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	gitrun(t, dir, "init", "-q", ".")
	if err := os.WriteFile(filepath.Join(dir, "kept.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitrun(t, dir, "add", "-A")
	gitrun(t, dir, "commit", "-qm", "seed")

	// Something precious outside the repository, and a link to it from inside.
	secret := filepath.Join(outer, "secret.txt")
	if err := os.WriteFile(secret, []byte("do not touch\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(secret, filepath.Join(dir, "way-out")); err != nil {
		t.Fatal(err)
	}

	c := coreOn(t, dir)
	for _, path := range []string{"../secret.txt", "way-out", "/etc/hosts", ""} {
		err := c.Discard("s", []string{path})
		if err == nil {
			t.Fatalf("%q was not refused", path)
		}
		if !strings.HasPrefix(err.Error(), "err.file.") {
			t.Fatalf("%q: refused with %v, expected a file leash error", path, err)
		}
	}
	if got, _ := os.ReadFile(secret); string(got) != "do not touch\n" {
		t.Fatalf("the file outside the folder was touched: %q", got)
	}
	if _, err := os.Lstat(filepath.Join(dir, "way-out")); err != nil {
		t.Fatalf("the link itself went: %v", err)
	}

	// An honest path inside is still discarded.
	if err := os.WriteFile(filepath.Join(dir, "kept.txt"), []byte("changed\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := c.Discard("s", []string{"kept.txt"}); err != nil {
		t.Fatalf("an ordinary discard failed: %v", err)
	}
	if got, _ := os.ReadFile(filepath.Join(dir, "kept.txt")); string(got) != "one\n" {
		t.Fatalf("kept.txt after discard: %q", got)
	}
}
