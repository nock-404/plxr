package core

import (
	"testing"
	"time"

	"plxr/internal/notify"
	"plxr/internal/usage"
)

/* Said before the wall, and said once.

   The thing that cost hours was a weekly limit arriving with no warning. The
   thing that would cost the feature is the opposite: the same sentence every
   minute until somebody switches notifications off altogether. So a crossing
   is said once per window, and the next window — a different reset time — is
   allowed to say its own piece.
*/

func window(kind string, percent int, resets time.Time) usage.Window {
	return usage.Window{Kind: kind, Known: true, Percent: percent, ResetsAt: resets.UnixMilli()}
}

func TestAWindowIsSaidOnceAndTheNextOneIsAllowedToSpeak(t *testing.T) {
	c := &Core{limitSaid: map[string]bool{}}
	week := time.Now().Add(24 * time.Hour)
	next := week.Add(7 * 24 * time.Hour)

	steps := []struct {
		account string
		w       usage.Window
		fire    bool
		why     string
	}{
		{"claude", window(usage.KindWeek, 82, week), true, "first crossing of this window"},
		{"claude", window(usage.KindWeek, 90, week), false, "further along the same window: already said"},
		{"claude", window(usage.KindWeek, 100, week), false, "at the wall of the same window: still said"},
		{"claude", window(usage.KindSession, 95, week), true, "a different window of the same account"},
		{"claude2", window(usage.KindWeek, 82, week), true, "a different account, same window"},
		{"claude", window(usage.KindWeek, 85, next), true, "the window came back and filled again: a new window"},
		{"claude", window(usage.KindWeek, 99, next), false, "and that one is only said once too"},
	}
	for i, s := range steps {
		if got := c.limitCrossed(s.account, s.w); got != s.fire {
			t.Errorf("step %d (%s): fired=%v, want %v", i, s.why, got, s.fire)
		}
	}
}

/*
What is remembered about a window that has already come back is of no

	further use, and the map is the thing that would otherwise grow for the
	life of the service.
*/
func TestWhatIsRememberedAboutAWindowGoesWhenTheWindowDoes(t *testing.T) {
	c := &Core{limitSaid: map[string]bool{}}
	gone := time.Now().Add(-time.Hour)
	here := time.Now().Add(time.Hour)

	// Every crossing sweeps what has already come back, so the entry for the
	// window that is gone does not survive the next one.
	c.limitCrossed("claude", window(usage.KindWeek, 90, gone))
	c.limitCrossed("claude", window(usage.KindSession, 90, here))
	if len(c.limitSaid) != 1 {
		t.Fatalf("%d entries remain, wanted only the window that has not come back yet: %v", len(c.limitSaid), c.limitSaid)
	}
	c.limitCrossed("claude2", window(usage.KindWeek, 90, here))
	if len(c.limitSaid) != 2 {
		t.Fatalf("%d entries remain, wanted the two live ones: %v", len(c.limitSaid), c.limitSaid)
	}
	// The window that is still open stays said; it must not speak twice.
	if c.limitCrossed("claude", window(usage.KindSession, 95, here)) {
		t.Error("a window that has not come back yet said its piece a second time")
	}
	// And a window that has already reset may be said about again.
	if !c.limitCrossed("claude", window(usage.KindWeek, 90, gone)) {
		t.Error("a window that has already reset was still remembered as said")
	}
}

// A window with no reset time is still worth one warning, and still only one.
func TestAWindowWithNoResetTimeIsSaidOnce(t *testing.T) {
	c := &Core{limitSaid: map[string]bool{}}
	w := usage.Window{Kind: usage.KindWeek, Known: true, Percent: 91}
	if !c.limitCrossed("claude", w) {
		t.Fatal("nothing was said about a window with no reset time")
	}
	if c.limitCrossed("claude", w) {
		t.Fatal("it was said twice")
	}
}

/*
The words of the notification, which nothing else watches.

	The body has to carry the three things somebody can act on: which account,
	how far along, and when it comes back — in this machine's own timezone.
*/
func TestTheWarningNamesTheWindowAndWhenItComesBack(t *testing.T) {
	at := time.Date(2026, 9, 19, 13, 0, 0, 0, time.Local)
	cases := []struct {
		kind string
		word string
	}{
		{usage.KindSession, "five-hour window"},
		{usage.KindWeek, "weekly window"},
		{usage.KindWeekModel, "weekly window for one model"},
		{"something new", "something new"},
	}
	for _, c := range cases {
		if got := windowWord(c.kind); got != c.word {
			t.Errorf("%q is called %q, wanted %q", c.kind, got, c.word)
		}
	}
	if got := backAt(usage.Window{ResetsAt: at.UnixMilli()}); got != at.Format("Mon 15:04") {
		t.Errorf("the reset reads %q, wanted %q", got, at.Format("Mon 15:04"))
	}
	if got := backAt(usage.Window{}); got == "" || got == time.UnixMilli(0).Local().Format("Mon 15:04") {
		t.Errorf("an unknown reset reads %q — it must say unknown, not 1970", got)
	}
}

/*
Switched off is switched off.

	checkLimits reads the settings before it reads anything else; a service
	that measured first and asked afterwards would still be walking every
	transcript for somebody who has notifications off.
*/
func TestNothingIsSaidWhenTheWarningIsSwitchedOff(t *testing.T) {
	cases := []struct {
		s    notify.Settings
		want bool
		why  string
	}{
		{notify.Settings{On: false, When: notify.When{Limit: true}}, false, "notifications off"},
		{notify.Settings{On: true, When: notify.When{Limit: false}}, false, "this warning off"},
		{notify.Settings{On: true, When: notify.When{Limit: true}}, true, "both on"},
	}
	for _, c := range cases {
		if got := c.s.On && c.s.Wanted("limit"); got != c.want {
			t.Errorf("%s: would speak=%v, wanted %v", c.why, got, c.want)
		}
	}
}

// An account is hot at the threshold the user set, not at one built in here.
func TestTheThresholdIsTheOneThatWasSet(t *testing.T) {
	a := usage.AccountUsage{Week: usage.Window{Kind: usage.KindWeek, Known: true, Percent: 55}}
	for _, at := range []int{50, 55} {
		if _, hot := a.Hot(at); !hot {
			t.Errorf("55%% used is not hot at a threshold of %d%%", at)
		}
	}
	for _, at := range []int{56, 80, 100} {
		if _, hot := a.Hot(at); hot {
			t.Errorf("55%% used is hot at a threshold of %d%%", at)
		}
	}
}
