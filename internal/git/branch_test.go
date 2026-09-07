package git

import (
	"strings"
	"testing"
)

func TestBranchesListsWithTheCurrentFirst(t *testing.T) {
	dir := repo(t)
	write(t, dir, "a.txt", "one\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "first")
	git(t, dir, "branch", "older")
	git(t, dir, "checkout", "-q", "-b", "newer")
	write(t, dir, "b.txt", "two\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "second")
	git(t, dir, "checkout", "-q", "older")

	list, err := Branches(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) < 3 {
		t.Fatalf("expected at least three branches, got %+v", list)
	}
	// The one you are on leads, even though its last commit is older.
	if !list[0].Current || list[0].Name != "older" {
		t.Fatalf("the current branch is not first: %+v", list)
	}
	for _, b := range list[1:] {
		if b.Current {
			t.Fatalf("two branches claim to be current: %+v", list)
		}
	}
	// The subject comes along, so a branch can be told apart by what it did.
	if list[0].Subject == "" {
		t.Fatalf("no subject on %+v", list[0])
	}
}

func TestSwitchAndCreate(t *testing.T) {
	dir := repo(t)
	write(t, dir, "a.txt", "one\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "first")

	if err := Switch(dir, "fresh", true); err != nil {
		t.Fatalf("Switch with create: %v", err)
	}
	if w, _ := Position(dir); w.Branch != "fresh" {
		t.Fatalf("did not land on the new branch: %+v", w)
	}
	// Making the same one twice is refused with a reason, not with git's prose.
	if err := Switch(dir, "fresh", true); err == nil {
		t.Fatalf("creating an existing branch was accepted")
	} else if !strings.HasPrefix(err.Error(), "err.branch.exists") {
		t.Fatalf("wrong reason: %v", err)
	}
	if err := Switch(dir, "nope-not-here", false); err == nil {
		t.Fatalf("switching to nothing was accepted")
	}
	if err := Switch(dir, "  ", false); err == nil {
		t.Fatalf("an empty name was accepted")
	}
}

// git carries uncommitted work across a switch whenever it can. Being stricter
// than git here would refuse the ordinary way of working.
func TestADirtyTreeDoesNotBlockASwitch(t *testing.T) {
	dir := repo(t)
	write(t, dir, "kept.txt", "one\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "first")
	git(t, dir, "branch", "second")

	write(t, dir, "kept.txt", "changed but not committed\n")
	if err := Switch(dir, "second", false); err != nil {
		t.Fatalf("git would have allowed this: %v", err)
	}
	// And the change came along.
	if c := find(mustChanges(t, dir), "kept.txt"); c == nil {
		t.Fatalf("the uncommitted change was lost")
	}
}

func TestDeleteRefusesWhatWouldLoseWork(t *testing.T) {
	dir := repo(t)
	write(t, dir, "a.txt", "one\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "first")
	git(t, dir, "checkout", "-q", "-b", "side")
	write(t, dir, "only-here.txt", "work that exists nowhere else\n")
	git(t, dir, "add", "-A")
	git(t, dir, "commit", "-qm", "side work")

	// The branch you are on cannot go.
	if err := Delete(dir, "side"); err == nil {
		t.Fatalf("deleted the branch that is checked out")
	} else if !strings.HasPrefix(err.Error(), "err.branch.isCurrent") {
		t.Fatalf("wrong reason: %v", err)
	}

	first, _ := Run(dir, "rev-parse", "--abbrev-ref", "HEAD")
	_ = first
	git(t, dir, "checkout", "-q", "-")
	// Unmerged work is not thrown away by a button.
	if err := Delete(dir, "side"); err == nil {
		t.Fatalf("deleted a branch with work nowhere else")
	} else if !strings.HasPrefix(err.Error(), "err.branch.notMerged") {
		t.Fatalf("wrong reason: %v", err)
	}

	// One that is merged goes without argument.
	git(t, dir, "branch", "spare")
	if err := Delete(dir, "spare"); err != nil {
		t.Fatalf("a merged branch should go: %v", err)
	}
	if err := Delete(dir, "spare"); err == nil {
		t.Fatalf("deleting it twice was accepted")
	}
}
