package daemon

import (
	"path/filepath"
	"testing"
)

/* A build can be given a lane of its own, so a new one can be tried while the
 * one holding the day's work goes on running. The lane is a name, never a
 * path: it is read out of the environment, and an environment is not a thing
 * to be trusted with a file location.
 */
func TestAChannelKeepsItsOwnHome(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("PLXR_HOME", "")

	t.Setenv("PLXR_CHANNEL", "")
	if got, want := Root(), filepath.Join(home, ".plxr"); got != want {
		t.Errorf("without a channel: %s, want %s", got, want)
	}

	t.Setenv("PLXR_CHANNEL", "beta")
	if got, want := Root(), filepath.Join(home, ".plxr-beta"); got != want {
		t.Errorf("with a channel: %s, want %s", got, want)
	}

	// Said outright, PLXR_HOME still decides — that is what the checks use.
	t.Setenv("PLXR_HOME", filepath.Join(home, "elsewhere"))
	if got, want := Root(), filepath.Join(home, "elsewhere"); got != want {
		t.Errorf("with a home named outright: %s, want %s", got, want)
	}
	t.Setenv("PLXR_HOME", "")

	for _, bad := range []struct{ in, want string }{
		{"../../etc", "etc"},
		{"/tmp/x", "tmpx"},
		{"BETA", "beta"},
		{"beta.2", "beta2"},
		{"...", ""},
		{"-", ""},
	} {
		t.Setenv("PLXR_CHANNEL", bad.in)
		if got := Channel(); got != bad.want {
			t.Errorf("channel %q read as %q, want %q", bad.in, got, bad.want)
		}
	}
}
