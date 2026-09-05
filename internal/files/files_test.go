package files

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

/* The boundary around a session's directory.

   Everything in this package takes a path from the interface, which means from
   whatever was typed or clicked. Creating and deleting were added to it, so a
   path that escapes the session no longer means reading the wrong file: it means
   writing or deleting somewhere on the machine that nobody asked about.

   These are the cases that boundary exists for. They are written as a table
   because the interesting part is the list itself — each line is a way out that
   somebody might find.
*/

func session(t *testing.T) (root string, outside string) {
	t.Helper()
	base := t.TempDir()
	root = filepath.Join(base, "session")
	outside = filepath.Join(base, "elsewhere")
	for _, d := range []string{root, outside} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("not yours"), 0o644); err != nil {
		t.Fatal(err)
	}
	return root, outside
}

func TestCreateStaysInsideTheSession(t *testing.T) {
	root, outside := session(t)
	if err := os.Symlink(outside, filepath.Join(root, "way-out")); err != nil {
		t.Skipf("no symlinks here: %v", err)
	}

	// Each case writes under a name of its own. Sharing one made the first
	// escape look like six: the file it left behind was still there when the
	// next case looked, and every one after it reported an escape it had not
	// made.
	ways := []struct {
		name string
		path string
	}{
		{"a step up", "../one.txt"},
		{"several steps up", "../../../two.txt"},
		{"an absolute path elsewhere", filepath.Join(outside, "three.txt")},
		{"through a symlink", "way-out/four.txt"},
		{"a step up in the middle", "sub/../../five.txt"},
		{"a sibling with the same prefix", root + "-other/six.txt"},
	}
	for _, way := range ways {
		t.Run(way.name, func(t *testing.T) {
			mine := filepath.Base(way.path)
			refused := false
			if _, err := Create(root, way.path, false); err != nil {
				refused = true
			}
			landed := ""
			for _, where := range []string{outside, filepath.Dir(root), root + "-other"} {
				if _, err := os.Stat(filepath.Join(where, mine)); err == nil {
					landed = filepath.Join(where, mine)
				}
			}
			if landed != "" {
				t.Fatalf("Create(%q) wrote to %s", way.path, landed)
			}
			if !refused {
				t.Fatalf("Create(%q) was allowed", way.path)
			}
		})
	}
}

func TestRemoveStaysInsideTheSession(t *testing.T) {
	root, outside := session(t)
	if err := Remove(root, filepath.Join(outside, "secret.txt")); err == nil {
		t.Fatal("Remove was allowed to reach outside the session")
	}
	if _, err := os.Stat(filepath.Join(outside, "secret.txt")); err != nil {
		t.Fatal("the file outside the session was deleted")
	}
}

func TestRemoveRefusesTheSessionItself(t *testing.T) {
	root, _ := session(t)
	if err := Remove(root, ""); err == nil {
		t.Fatal("the session's own directory was deleted")
	}
	if err := Remove(root, root); err == nil {
		t.Fatal("the session's own directory was deleted by its full path")
	}
	if _, err := os.Stat(root); err != nil {
		t.Fatal("the session's directory is gone")
	}
}

func TestRenameStaysInsideTheSession(t *testing.T) {
	root, outside := session(t)
	if _, err := Create(root, "here.txt", false); err != nil {
		t.Fatal(err)
	}
	if _, err := Rename(root, "here.txt", filepath.Join(outside, "there.txt")); err == nil {
		t.Fatal("Rename was allowed to move a file out of the session")
	}
	if _, err := os.Stat(filepath.Join(outside, "there.txt")); err == nil {
		t.Fatal("the file was moved out of the session")
	}
	if _, err := os.Stat(filepath.Join(root, "here.txt")); err != nil {
		t.Fatal("the file went missing on a refused rename")
	}
}

func TestCreateAndRenameDoTheirJob(t *testing.T) {
	root, _ := session(t)

	if _, err := Create(root, "notes/todo.md", false); err != nil {
		t.Fatalf("a file in a folder that does not exist yet: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "notes", "todo.md")); err != nil {
		t.Fatalf("the file was reported created and is not there: %v", err)
	}

	if _, err := Create(root, "notes/todo.md", false); err == nil {
		t.Fatal("the same name was taken twice")
	}

	if _, err := Create(root, "build", true); err != nil {
		t.Fatalf("a folder: %v", err)
	}
	st, err := os.Stat(filepath.Join(root, "build"))
	if err != nil || !st.IsDir() {
		t.Fatal("the folder is not a folder")
	}

	entry, err := Rename(root, "notes/todo.md", "notes/done.md")
	if err != nil {
		t.Fatalf("rename: %v", err)
	}
	if entry.Name != "done.md" {
		t.Fatalf("renamed to %q", entry.Name)
	}
	if _, err := os.Stat(filepath.Join(root, "notes", "todo.md")); err == nil {
		t.Fatal("the old name is still there")
	}
}

func TestRemoveTakesTheFolderWithIt(t *testing.T) {
	root, _ := session(t)
	if _, err := Create(root, "build/artefacts/thing.o", false); err != nil {
		t.Fatal(err)
	}
	if err := Remove(root, "build"); err != nil {
		t.Fatalf("remove a folder: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "build")); err == nil {
		t.Fatal("the folder is still there")
	}
}

func TestAnEmptyNameIsRefused(t *testing.T) {
	root, _ := session(t)
	if _, err := Create(root, "", false); err == nil {
		t.Fatal("something with no name was created")
	}
}

// The error a refusal carries has to name the reason, because the interface
// shows it to somebody who then has to decide what to do differently.
func TestRefusalsSayWhy(t *testing.T) {
	root, outside := session(t)
	_, err := Create(root, filepath.Join(outside, "x.txt"), false)
	if err == nil || !strings.Contains(err.Error(), "outsideRoot") {
		t.Fatalf("a refusal that does not say why: %v", err)
	}
}
