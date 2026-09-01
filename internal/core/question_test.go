package core

import (
	"strings"
	"testing"
)

/* What the interface shows when an agent is waiting.

   This text ends up in the inbox and in the notification, so it is the whole of
   what somebody sees before deciding whether to go and look. Cutting it wrong
   costs either the question itself or half a screen of noise around it.

   The screens below are the shapes the CLIs actually produce.
*/

func TestTheQuestionIsWhatIsCutOut(t *testing.T) {
	cases := []struct {
		name    string
		screen  string
		wants   []string
		unwants []string
	}{
		{
			name: "a question with numbered choices",
			screen: strings.Join([]string{
				"Reading src/main.go",
				"Reading src/util.go",
				"",
				"Do you want me to rewrite the parser?",
				"  1. Yes",
				"  2. No, explain first",
			}, "\n"),
			wants:   []string{"rewrite the parser?", "1. Yes", "2. No"},
			unwants: []string{"Reading src/main.go"},
		},
		{
			name: "a yes-or-no prompt",
			screen: strings.Join([]string{
				"ran 42 tests",
				"",
				"Apply these changes? [y/N]",
			}, "\n"),
			wants:   []string{"Apply these changes? [y/N]"},
			unwants: []string{"ran 42 tests"},
		},
		{
			name: "a chooser with the arrow marker",
			screen: strings.Join([]string{
				"thinking",
				"",
				"❯ 1. Keep going",
				"  2. Stop here",
			}, "\n"),
			wants:   []string{"Keep going", "Stop here"},
			unwants: []string{"thinking"},
		},
		{
			name:    "no question at all falls back to the last lines",
			screen:  strings.Join([]string{"one", "two", "three", "four", "five", "six", "seven"}, "\n"),
			wants:   []string{"seven"},
			unwants: []string{"one"},
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := questionFromScreen(c.screen)
			for _, want := range c.wants {
				if !strings.Contains(got, want) {
					t.Errorf("the question lost %q\n--- what was cut out ---\n%s", want, got)
				}
			}
			for _, unwanted := range c.unwants {
				if strings.Contains(got, unwanted) {
					t.Errorf("the question dragged %q along\n--- what was cut out ---\n%s", unwanted, got)
				}
			}
		})
	}
}

func TestNothingOnScreenGivesNothing(t *testing.T) {
	for _, screen := range []string{"", "\n", "\n\n\n", "   \n  \n"} {
		if got := questionFromScreen(screen); got != "" {
			t.Errorf("an empty screen produced %q", got)
		}
	}
}

// A screen is whatever the agent wrote, and some of them write a great deal.
// The cut has to stay small enough to put in a notification.
func TestALongScreenIsCutDown(t *testing.T) {
	long := strings.Repeat("a line of output that goes on\n", 400) + "\nWhat now?"
	got := questionFromScreen(long)
	if len(got) > 900 {
		t.Fatalf("cut out %d characters; that is a screen, not a question", len(got))
	}
	if !strings.Contains(got, "What now?") {
		t.Fatal("the question itself was cut away")
	}
}

// Older builds wrote this one value in German. It is the only one, and it has to
// keep being translated for as long as those recordings exist.
func TestTheOldGermanActivityIsTranslated(t *testing.T) {
	if got := englishActivity("gestartet"); got != "started" { // german-ok: the stored value
		t.Fatalf("got %q", got)
	}
	for _, same := range []string{"started", "waiting", "", "anything else"} {
		if got := englishActivity(same); got != same {
			t.Fatalf("englishActivity(%q) changed it to %q", same, got)
		}
	}
}
