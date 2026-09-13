package core

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"plxr/internal/uierr"
)

/* The id that is a plain directory: what the tree walks up into.
 *
 * It is the one root that is not checked against anything the user opened —
 * walking above the folder is what it exists for. So what it does check has to
 * hold: an absolute path, there, and a directory.
 */
func TestADirectoryIDResolvesToThatDirectory(t *testing.T) {
	dir := t.TempDir()
	// The same resolution every other root goes through: on a Mac the temp
	// directory is reached through a symlink, and a root that is not resolved
	// makes every path under it look like an escape.
	want, err := filepath.EvalSymlinks(dir)
	if err != nil {
		t.Fatal(err)
	}
	got, err := dirRoot(DirPrefix + dir)
	if err != nil {
		t.Fatalf("%s was refused: %v", dir, err)
	}
	if got != want {
		t.Fatalf("resolved to %q, expected %q", got, want)
	}
}

func TestADirectoryIDIsRefusedWhenItIsNotOne(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(file, []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// The codes are made the way every code is made, so the gate that holds
	// them against the two language files can see them here too.
	for _, bad := range []struct {
		id   string
		want error
	}{
		{DirPrefix, uierr.New("err.dir.notAbsolute")},
		{DirPrefix + "relative/path", uierr.New("err.dir.notAbsolute")},
		{DirPrefix + filepath.Join(dir, "never-made"), uierr.New("err.dir.unreachable")},
		{DirPrefix + file, uierr.New("err.dir.notADirectory")},
	} {
		_, err := dirRoot(bad.id)
		if err == nil {
			t.Fatalf("%q was not refused", bad.id)
		}
		// The path travels after the divider; what is being checked is the code.
		if code, _, _ := strings.Cut(err.Error(), uierr.Sep); code != bad.want.Error() {
			t.Fatalf("%q: refused with %v, expected %v", bad.id, err, bad.want)
		}
	}
}

// The tree above a folder is read through the ordinary route, so the listing
// has to come back for a directory nobody ever opened.
func TestTheTreeListsADirectoryNobodyOpened(t *testing.T) {
	outer := t.TempDir()
	inner := filepath.Join(outer, "project")
	if err := os.MkdirAll(inner, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outer, "beside.txt"), []byte("one\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	c := coreOn(t, inner)
	rows, err := c.ListDir(DirPrefix+outer, "")
	if err != nil {
		t.Fatalf("the folder above was not listed: %v", err)
	}
	var names []string
	for _, e := range rows {
		names = append(names, e.Name)
	}
	if !slices.Contains(names, "beside.txt") || !slices.Contains(names, "project") {
		t.Fatalf("the folder above lists %v, expected beside.txt and project", names)
	}
}
