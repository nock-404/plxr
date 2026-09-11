package accounts

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCreateDefaultRenameRemove(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("PLXR_HOME", filepath.Join(home, ".plxr"))
	// One real account to begin with.
	if err := os.MkdirAll(filepath.Join(home, ".claude", "projects"), 0o755); err != nil {
		t.Fatal(err)
	}

	// Create a fresh one — it takes the next free numbered directory.
	acc, list, err := Create("work")
	if err != nil {
		t.Fatal(err)
	}
	if acc.Dir != filepath.Join(home, ".claude2") {
		t.Fatalf("fresh account landed at %q, not .claude2", acc.Dir)
	}
	if _, err := os.Stat(filepath.Join(acc.Dir, "projects")); err != nil {
		t.Fatal("the fresh account has no projects directory to log in against")
	}
	if len(list) != 2 {
		t.Fatalf("expected two accounts, got %d", len(list))
	}

	// Make it the default.
	list, err = SetDefault("claude2")
	if err != nil {
		t.Fatal(err)
	}
	if Default(list).Name != "claude2" {
		t.Fatalf("default is %q, not claude2", Default(list).Name)
	}

	// Rename (label) — the identity underneath does not move.
	list, err = Rename("claude2", "Personal")
	if err != nil {
		t.Fatal(err)
	}
	var found *Account
	for i := range list {
		if list[i].Name == "claude2" {
			found = &list[i]
		}
	}
	if found == nil || found.Label != "Personal" {
		t.Fatalf("rename did not stick: %+v", found)
	}
	if !found.Default {
		t.Fatal("renaming lost the default flag")
	}

	// Remove — the directory stays.
	list, err = Remove("claude2")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Fatalf("expected one account after remove, got %d", len(list))
	}
	if _, err := os.Stat(filepath.Join(home, ".claude2")); err != nil {
		t.Fatal("remove deleted the directory — it must stay")
	}
}
