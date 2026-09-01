package queue

import (
	"testing"
)

// The order is the whole point: what was typed first is what the agent sees
// first. A queue that reorders is worse than none.
func TestKeepsTheOrderItWasGiven(t *testing.T) {
	Dir = t.TempDir()
	for _, text := range []string{"first", "second", "third"} {
		if err := Add("s1", text); err != nil {
			t.Fatal(err)
		}
	}
	for _, want := range []string{"first", "second", "third"} {
		got, ok := Take("s1")
		if !ok || got.Text != want {
			t.Fatalf("expected %q, got %q (ok=%v)", want, got.Text, ok)
		}
	}
	if _, ok := Take("s1"); ok {
		t.Error("something came out of an empty queue")
	}
}

// Two sessions must not share a line.
func TestSessionsDoNotMix(t *testing.T) {
	Dir = t.TempDir()
	Add("a", "for a")
	Add("b", "for b")
	got, _ := Take("a")
	if got.Text != "for a" {
		t.Errorf("got %q from the wrong session", got.Text)
	}
	if items := Read("b"); len(items) != 1 || items[0].Text != "for b" {
		t.Errorf("the other session's queue was disturbed: %v", items)
	}
}

// Taking removes before sending, deliberately: an instruction that failed on
// its way to the agent is better lost than sent twice.
func TestTakingRemoves(t *testing.T) {
	Dir = t.TempDir()
	Add("s", "once")
	Take("s")
	if items := Read("s"); len(items) != 0 {
		t.Errorf("still there after taking: %v", items)
	}
}

// Dropping the entry somebody clicked, not the one that moved into its place.
func TestDropTakesThatOne(t *testing.T) {
	Dir = t.TempDir()
	Add("s", "keep")
	Add("s", "drop")
	Add("s", "keep too")
	if err := Drop("s", 1); err != nil {
		t.Fatal(err)
	}
	items := Read("s")
	if len(items) != 2 || items[0].Text != "keep" || items[1].Text != "keep too" {
		t.Errorf("wrong entry removed: %v", items)
	}
}

// A click on a list that has already moved on must not take the wrong entry.
func TestDropOutOfRangeIsHarmless(t *testing.T) {
	Dir = t.TempDir()
	Add("s", "only")
	if err := Drop("s", 7); err != nil {
		t.Fatal(err)
	}
	if items := Read("s"); len(items) != 1 {
		t.Errorf("the list changed anyway: %v", items)
	}
}

// The queue outlives the process that holds it — that is why it is on disk.
func TestSurvivesAcrossReads(t *testing.T) {
	Dir = t.TempDir()
	Add("s", "still here")
	if items := Read("s"); len(items) != 1 || items[0].Text != "still here" {
		t.Fatalf("not stored: %v", items)
	}
	Clear("s")
	if items := Read("s"); len(items) != 0 {
		t.Errorf("clearing left something behind: %v", items)
	}
}
