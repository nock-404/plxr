package uierr

import (
	"strings"
	"testing"
)

/* The shape of an error on its way to the window.
 *
 * Three lines of code that every failure in the daemon passes through, and the
 * other end of it is in TypeScript — so nothing between the two is checked by a
 * compiler. What is pinned here is the shape; that the window takes it apart
 * again is pinned by i18n.test.mjs, which knows the same two rules.
 */

func TestACodeOnItsOwnCarriesNothingElse(t *testing.T) {
	err := New("err.session.unknown")
	if err.Error() != "err.session.unknown" {
		t.Fatalf("a bare code came out as %q", err.Error())
	}
	if strings.Contains(err.Error(), Sep) {
		t.Fatal("a bare code carries the divider, so the window will look for a detail that is not there")
	}
}

func TestTheDetailComesAfterTheFirstDivider(t *testing.T) {
	err := With("err.dir.missing", "/tmp/x")
	if err.Error() != "err.dir.missing"+Sep+"/tmp/x" {
		t.Fatalf("got %q", err.Error())
	}
}

/* A detail that contains the divider itself.
 *
 * A bar is legal in a path and can appear in any message from underneath, so it
 * is not escaped here — it is the window's job to divide on the first one only.
 * This holds the promise this side makes: the code never contains one, so the
 * first bar is always the right place to cut.
 */
func TestADetailMayContainTheDivider(t *testing.T) {
	err := With("err.dir.missing", "/tmp/od|d/name")
	code, detail, found := strings.Cut(err.Error(), Sep)
	if !found {
		t.Fatal("no divider at all")
	}
	if code != "err.dir.missing" {
		t.Fatalf("cutting at the first divider gave the code as %q", code)
	}
	if detail != "/tmp/od|d/name" {
		t.Fatalf("the detail came back as %q, so it was cut short", detail)
	}
}

func TestAnEmptyDetailIsStillADetail(t *testing.T) {
	err := With("err.update.unreachable", "")
	if err.Error() != "err.update.unreachable"+Sep {
		t.Fatalf("got %q", err.Error())
	}
}
