package workspace

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTheSameFolderOpensToTheSameID(t *testing.T) {
	home := t.TempDir()
	dir := t.TempDir()

	first, err := Open(home, dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	// The same place, spelled differently: a trailing separator and a detour
	// through the parent. A list that grows an entry for each spelling is a
	// junk drawer.
	for _, spelling := range []string{
		dir + string(os.PathSeparator),
		filepath.Join(dir, ".."), // different folder — must NOT match
	} {
		again, err := Open(home, spelling)
		if err != nil {
			t.Fatalf("Open(%q): %v", spelling, err)
		}
		same := again.ID == first.ID
		wantSame := filepath.Clean(spelling) == filepath.Clean(dir)
		if same != wantSame {
			t.Fatalf("Open(%q) gave id %q; same as first: %v, wanted %v", spelling, again.ID, same, wantSame)
		}
	}
}

func TestAMovedRootIsRefusedNotFollowed(t *testing.T) {
	home := t.TempDir()
	base := t.TempDir()
	real := filepath.Join(base, "real")
	other := filepath.Join(base, "other")
	for _, d := range []string{real, other} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	link := filepath.Join(base, "link")
	if err := os.Symlink(real, link); err != nil {
		t.Skipf("no symlinks here: %v", err)
	}

	w, err := Open(home, link)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if _, err := RootOf(home, w.ID); err != nil {
		t.Fatalf("RootOf right after opening: %v", err)
	}

	// Somebody points the link somewhere else. Following it would hand out a
	// directory nobody opened.
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(other, link); err != nil {
		t.Fatal(err)
	}
	root, err := RootOf(home, w.ID)
	if err == nil {
		t.Fatalf("a swapped link was followed to %q", root)
	}
	if !strings.HasPrefix(err.Error(), "err.workspace.moved") {
		t.Fatalf("wrong reason: %v", err)
	}
}

func TestAnUnreachableFolderIsKeptNotForgotten(t *testing.T) {
	home := t.TempDir()
	base := t.TempDir()
	dir := filepath.Join(base, "volume")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	w, err := Open(home, dir)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}

	// The volume goes away. This machine keeps its work on /Volumes/M2mini, so
	// this is the ordinary case, not an exotic one.
	if err := os.RemoveAll(dir); err != nil {
		t.Fatal(err)
	}

	list := List(home)
	if len(list) != 1 {
		t.Fatalf("the folder was forgotten: %d left", len(list))
	}
	if !list[0].Missing {
		t.Fatalf("an unreachable folder is not marked missing")
	}
	if _, err := RootOf(home, w.ID); err == nil {
		t.Fatalf("an unreachable folder handed out a root")
	} else if !strings.HasPrefix(err.Error(), "err.workspace.unreachable") {
		t.Fatalf("wrong reason: %v", err)
	}

	// And it comes back when the disk does.
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := RootOf(home, w.ID); err != nil {
		t.Fatalf("the folder did not come back: %v", err)
	}
}

func TestClosingLeavesTheFolderAlone(t *testing.T) {
	home := t.TempDir()
	dir := t.TempDir()
	inside := filepath.Join(dir, "keep.txt")
	if err := os.WriteFile(inside, []byte("still here\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	w, err := Open(home, dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := Close(home, w.ID); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if len(List(home)) != 0 {
		t.Fatalf("still listed after closing")
	}
	if _, err := os.Stat(inside); err != nil {
		t.Fatalf("closing deleted something: %v", err)
	}
	if err := Close(home, w.ID); err == nil {
		t.Fatalf("closing twice was accepted")
	}
}
