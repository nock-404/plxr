package notify

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// A long session name with an umlaut at the cut used to come out as half a
// character, which is not text — and the system drops a notification whose
// title is not text.
func TestClippingNeverCutsACharacterInHalf(t *testing.T) {
	long := strings.Repeat("a", 119) + "\u00fc" + strings.Repeat("b", 50)
	got := clip(long)
	if !utf8.ValidString(got) {
		t.Fatalf("clipped into something that is not text: %q", got)
	}
	if n := utf8.RuneCountInString(got); n != 120 {
		t.Errorf("%d characters, want 120", n)
	}
	if got := clip("two\nlines"); got != "two lines" {
		t.Errorf("a line break survived: %q", got)
	}
}

func TestOnlyABundleIdentifierGoesIntoTheSystemURL(t *testing.T) {
	for _, ok := range []string{"dev.plxr.app", "de.nyo.plxr.notifytest.6c25d5", "com.apple.Terminal"} {
		if !validBundleID(ok) {
			t.Errorf("%q refused", ok)
		}
	}
	for _, bad := range []string{"", "dev.plxr.app&x=1", "a b", "../x", ".leading", strings.Repeat("a", 300)} {
		if validBundleID(bad) {
			t.Errorf("%q accepted", bad)
		}
	}
}
