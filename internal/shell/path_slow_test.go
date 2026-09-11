//go:build !windows

package shell

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

/* A slow profile must not cost the user their PATH.
 *
 * The interactive login shell is the only form that reads .zshrc, which is
 * where ~/.local/bin — and with it claude — comes from. On the machine this
 * was written for that shell takes 5.6 seconds to start, because of the
 * prompt it draws. It was given four, was killed, and what remained was a
 * PATH without the directory that matters: plxr then said it could not find
 * claude on a machine where claude works in every terminal.
 *
 * The stand-in below is that shell, slowed down on purpose.
 */
func slowShell(t *testing.T, delay time.Duration) {
	t.Helper()
	dir := t.TempDir()
	sh := filepath.Join(dir, "slowsh")
	// -i is the interactive form and the only one that knows the good
	// directory; every other form answers at once, and poorly.
	script := `#!/bin/sh
for a in "$@"; do
  case "$a" in
    -i) sleep ` + strconv.Itoa(int(delay.Seconds())) + `
        printf 'PLXR-PATH:%s\n' "/the/good/bin:/usr/bin"
        exit 0 ;;
  esac
done
printf 'PLXR-PATH:%s\n' "/usr/bin"
`
	if err := os.WriteFile(sh, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("SHELL", sh)
}

func TestASlowProfileStillGivesItsPath(t *testing.T) {
	slowShell(t, 6*time.Second)
	got := askLoginShell()
	if !strings.Contains(got, "/the/good/bin") {
		t.Fatalf("the slow shell was given up on: %q", got)
	}
}

// And all the forms together may not take as long as they do one after the
// other: three shells that need six seconds each are eighteen seconds of
// somebody waiting for their window.
func TestTheFormsAreAskedTogether(t *testing.T) {
	slowShell(t, 6*time.Second)
	start := time.Now()
	askLoginShell()
	if took := time.Since(start); took > 12*time.Second {
		t.Fatalf("asking the shell took %s — the forms are being asked one after another", took)
	}
}

// The second start does not pay for the first one's shell again.
func TestTheAnswerIsKept(t *testing.T) {
	slowShell(t, 6*time.Second)
	Remembered = filepath.Join(t.TempDir(), "path")
	defer func() { Remembered = "" }()

	first := time.Now()
	if got := rememberedOrAsked(); !strings.Contains(got, "/the/good/bin") {
		t.Fatalf("the first answer is wrong: %q", got)
	}
	slow := time.Since(first)

	second := time.Now()
	got := rememberedOrAsked()
	quick := time.Since(second)
	if !strings.Contains(got, "/the/good/bin") {
		t.Fatalf("the kept answer is wrong: %q", got)
	}
	if quick > slow/2 {
		t.Fatalf("the second start took %s against the first %s — nothing was kept", quick, slow)
	}
}

// An empty answer is never kept: a shell that failed once must not be
// remembered as a machine without a PATH.
func TestAFailureIsNotKept(t *testing.T) {
	Remembered = filepath.Join(t.TempDir(), "path")
	defer func() { Remembered = "" }()
	writeRemembered("/the/good/bin")
	writeRemembered("")
	if got := readRemembered(); got != "/the/good/bin" {
		t.Fatalf("the good answer was overwritten with nothing: %q", got)
	}
}

// The daemon's start must not wait for the shell; only the first session does.
func TestPreparingDoesNotWait(t *testing.T) {
	slowShell(t, 6*time.Second)
	start := time.Now()
	Prepare()
	if took := time.Since(start); took > time.Second {
		t.Fatalf("Prepare waited %s — the listener, and the window behind it, wait with it", took)
	}
}

// A poor fresh answer must not throw away a good kept one.
func TestTheRefreshNeverShrinksTheAnswer(t *testing.T) {
	Remembered = filepath.Join(t.TempDir(), "state", "path") // the directory does not exist yet
	defer func() { Remembered = "" }()
	writeRemembered("/the/good/bin:/usr/bin")
	if got := readRemembered(); got != "/the/good/bin:/usr/bin" {
		t.Fatalf("the first answer was not kept on a fresh machine: %q", got)
	}
	if got := joined("/usr/bin", "/the/good/bin:/usr/bin"); !strings.Contains(got, "/the/good/bin") {
		t.Fatalf("a fresh answer without the good directory lost it: %q", got)
	}
}
