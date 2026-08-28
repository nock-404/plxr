package replies

import (
	"testing"
	"time"
)

func TestOnlyWordForWordCountsAsTheSame(t *testing.T) {
	t.Setenv("PLXR_HOME", t.TempDir())
	Note("Edit src/a.go?", "yes")

	now := time.Now().UnixMilli()
	if got := For("Edit src/a.go?", now); len(got) != 1 || got[0].Answer != "yes" {
		t.Errorf("the same question was not found: %+v", got)
	}
	// One file name apart is a different decision. An answer offered for the
	// wrong question is worse than typing it again.
	if got := For("Edit src/b.go?", now); len(got) != 0 {
		t.Errorf("a different question matched: %+v", got)
	}
	// Whitespace is not a difference.
	if got := For("Edit   src/a.go?\n", now); len(got) != 1 {
		t.Errorf("whitespace made it a different question: %+v", got)
	}
}

func TestOldAnswersDropOut(t *testing.T) {
	t.Setenv("PLXR_HOME", t.TempDir())
	Note("Proceed?", "yes")
	// A decision from last week says nothing about today's branch.
	later := time.Now().Add(Keep + time.Hour).UnixMilli()
	if got := For("Proceed?", later); len(got) != 0 {
		t.Errorf("an expired answer was offered: %+v", got)
	}
}

func TestNewestFirst(t *testing.T) {
	t.Setenv("PLXR_HOME", t.TempDir())
	Note("Proceed?", "no")
	time.Sleep(2 * time.Millisecond)
	Note("Proceed?", "yes")
	got := For("Proceed?", time.Now().UnixMilli())
	if len(got) != 2 || got[0].Answer != "yes" {
		t.Errorf("order wrong: %+v", got)
	}
}
