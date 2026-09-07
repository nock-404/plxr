package git

import (
	"strings"
	"testing"
)

// The folder somebody opens need not be the top of the repository.
//
// git status answers with paths relative to the top, so a folder one level down
// came back with the way down to it in front of every path. The window then
// asked to stage or diff that path, and the daemon resolved it against the
// folder — one level too deep. Everything to do with git was broken for anybody
// who opened a subdirectory, which is the ordinary case in a monorepo.
func TestChangesInASubdirectoryAreRelativeToIt(t *testing.T) {
	top := repo(t)
	write(t, top, "outside.txt", "a\n")
	write(t, top, "inner/inside.txt", "b\n")
	git(t, top, "add", "-A")
	git(t, top, "commit", "-qm", "start")
	write(t, top, "inner/inside.txt", "changed\n")
	write(t, top, "inner/fresh.txt", "new\n")

	sub := top + "/inner"
	list, err := Changes(sub)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range list {
		if strings.HasPrefix(c.Path, "inner/") {
			t.Fatalf("a path still carries the way down from the top: %q", c.Path)
		}
	}
	if find(list, "inside.txt") == nil {
		t.Fatalf("the changed file is missing: %+v", list)
	}
	if find(list, "fresh.txt") == nil {
		t.Fatalf("the new file is missing: %+v", list)
	}
	// And nothing from above the folder leaks in.
	if find(list, "outside.txt") != nil {
		t.Fatalf("a file above the folder was listed: %+v", list)
	}

	// The diff has to work with the same kind of path the list handed out.
	d, err := Difference(sub, "inside.txt", false)
	if err != nil {
		t.Fatalf("Difference in a subdirectory: %v", err)
	}
	if d.Empty || len(d.Hunks) == 0 {
		t.Fatalf("no difference found for a file that changed: %+v", d)
	}

	// Staging, with the path as the list gives it.
	if err := Stage(sub, []string{"inside.txt"}); err != nil {
		t.Fatalf("Stage in a subdirectory: %v", err)
	}
	if c := find(mustChanges(t, sub), "inside.txt"); c == nil || !c.Staged() {
		t.Fatalf("staging did not take: %+v", c)
	}
	if err := Unstage(sub, []string{"inside.txt"}); err != nil {
		t.Fatalf("Unstage in a subdirectory: %v", err)
	}
	if c := find(mustChanges(t, sub), "inside.txt"); c == nil || c.Staged() {
		t.Fatalf("unstaging did not take: %+v", c)
	}
}
