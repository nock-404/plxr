package notify

import (
	"os"
	"path/filepath"
	"testing"
)

/* Whether to say anything at all.

   Getting this wrong is not a visible fault: it is a notification that does not
   arrive, which looks exactly like nothing having happened. The one thing worse
   is the opposite — a machine that speaks up all day until the whole feature is
   switched off.

   The state names come from core, one file away, and are matched here as plain
   strings. That is a crossing no compiler watches, so the names are written out
   in full below: if one is renamed over there, this fails here.
*/

func TestNothingIsSaidWhenItIsSwitchedOff(t *testing.T) {
	off := Settings{On: false, When: When{NeedsYou: true, Waiting: true, Ended: true, Crashed: true}}
	for _, state := range []string{"permission", "waiting", "dead", "orphaned"} {
		if off.Wanted(state) {
			t.Errorf("switched off and still wants to speak about %q", state)
		}
	}
}

func TestEachOccasionIsAskedAboutSeparately(t *testing.T) {
	cases := []struct {
		state string
		on    Settings
	}{
		{"permission", Settings{On: true, When: When{NeedsYou: true}}},
		{"waiting", Settings{On: true, When: When{Waiting: true}}},
		{"dead", Settings{On: true, When: When{Ended: true}}},
		{"orphaned", Settings{On: true, When: When{Crashed: true}}},
	}
	for _, c := range cases {
		t.Run(c.state, func(t *testing.T) {
			if !c.on.Wanted(c.state) {
				t.Fatalf("%q is switched on and still says nothing", c.state)
			}
			// And only that one: switching on "an agent asks" must not also
			// bring every ending session along with it.
			for _, other := range []string{"permission", "waiting", "dead", "orphaned"} {
				if other != c.state && c.on.Wanted(other) {
					t.Fatalf("switching on %q also speaks about %q", c.state, other)
				}
			}
		})
	}
}

func TestAStateNobodyKnowsSaysNothing(t *testing.T) {
	all := Settings{On: true, When: When{NeedsYou: true, Waiting: true, Ended: true, Crashed: true}}
	for _, unknown := range []string{"", "running", "gestartet", "PERMISSION", "needs-you"} { // german-ok: a value older builds wrote, which must stay silent
		if all.Wanted(unknown) {
			t.Errorf("spoke about %q, which is not a state this knows", unknown)
		}
	}
}

/*
What is remembered, and what happens when it cannot be read.

	Settings that fail to load must come back as the defaults rather than as
	silence — a file that goes missing should not quietly switch notifications off
	and leave somebody waiting for a message that will never come.
*/
func TestSettingsSurviveBeingWrittenAndReadBack(t *testing.T) {
	t.Setenv("PLXR_HOME", t.TempDir())

	want := Settings{On: true, Sound: "Glass", When: When{NeedsYou: false, Waiting: true, Ended: true}}
	if err := Write(want); err != nil {
		t.Fatal(err)
	}
	got := Read()
	if got.Sound != want.Sound || got.When != want.When || got.On != want.On {
		t.Fatalf("wrote %+v and read back %+v", want, got)
	}
}

func TestNothingStoredMeansTheDefaults(t *testing.T) {
	t.Setenv("PLXR_HOME", t.TempDir())

	got := Read()
	if !got.On {
		t.Fatal("with nothing stored, notifications came back switched off")
	}
	if !got.When.NeedsYou {
		t.Fatal("with nothing stored, the one occasion worth being told about is off")
	}
	if got.Sound == "" {
		t.Fatal("with nothing stored, there is no sound to play")
	}
}

func TestADamagedFileDoesNotSwitchEverythingOff(t *testing.T) {
	home := t.TempDir()
	t.Setenv("PLXR_HOME", home)
	if err := os.WriteFile(filepath.Join(home, "notify.json"), []byte("{ this is not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	got := Read()
	if !got.On || !got.When.NeedsYou {
		t.Fatalf("a damaged file left notifications off: %+v", got)
	}
}

// The sound that is offered by default has to be one of the sounds on offer,
// or the picker opens on a value that is not in its own list.
func TestTheDefaultSoundIsOneThatExists(t *testing.T) {
	all := Sounds()
	if len(all) == 0 {
		t.Fatal("this system offers no sounds at all")
	}
	want := Default().Sound
	for _, s := range all {
		if s == want {
			return
		}
	}
	t.Fatalf("the default sound %q is not among the %d on offer", want, len(all))
}
