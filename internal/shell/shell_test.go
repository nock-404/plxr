package shell

import (
	"os"
	"runtime"
	"strings"
	"testing"
)

/* What a plain terminal starts with.
 *
 * Getting this wrong is not a crash: it is a shell that starts without the
 * user's PATH, so half their tools are missing and nothing says why.
 */

func TestTheShellIsStartedAsALoginShell(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows has no login shell in this sense")
	}
	t.Setenv("SHELL", "/bin/zsh")

	argv := Default()
	if len(argv) < 2 {
		t.Fatalf("the command is %v, which is not a shell and a flag", argv)
	}
	if argv[0] != "/bin/zsh" {
		t.Fatalf("started %q rather than the shell in the environment", argv[0])
	}
	// Without this the shell reads no .zprofile, and the PATH somebody has in
	// their own terminal is not the one their agent gets.
	if argv[1] != "-l" {
		t.Fatalf("started with %q rather than as a login shell", argv[1])
	}
}

func TestWithNoShellInTheEnvironmentSomethingUsableComesBack(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows takes the other path")
	}
	t.Setenv("SHELL", "")

	argv := Default()
	if len(argv) == 0 || argv[0] == "" {
		t.Fatal("nothing to start at all")
	}
	if _, err := os.Stat(argv[0]); err != nil {
		t.Fatalf("fell back to %q, which is not there: %v", argv[0], err)
	}
}

// The name is what the interface writes on a tile, so it carries neither the
// path it was found at nor the extension Windows puts on everything.
func TestTheDisplayNameIsJustTheName(t *testing.T) {
	cases := map[string]string{
		"/bin/zsh":                    "zsh",
		"/usr/local/bin/bash":         "bash",
		`C:\Windows\System32\cmd.exe`: "cmd",
		"pwsh.exe":                    "pwsh",
		"claude":                      "claude",
	}
	for argv0, want := range cases {
		got := Name([]string{argv0})
		// On Unix a backslash is a legal character in a name, so the Windows
		// path only shortens where the separator means what it says.
		if runtime.GOOS != "windows" && strings.Contains(argv0, `\`) {
			continue
		}
		if got != want {
			t.Errorf("Name(%q) = %q, wanted %q", argv0, got, want)
		}
	}
}

func TestNameOfNothingIsNothing(t *testing.T) {
	if got := Name(nil); got != "" {
		t.Fatalf("Name(nil) = %q", got)
	}
	if got := Name([]string{}); got != "" {
		t.Fatalf("Name([]) = %q", got)
	}
}

/* Asking the system for the login shell is one thing done three ways.
 *
 * It used to be done one way for all of them — macOS's directory service — so on
 * Linux the call simply failed and the answer was quietly whatever existed in
 * /bin. Nobody would ever see an error; they would see a shell that was not
 * theirs.
 */
func TestAskingTheSystemAnswersOrSaysNothing(t *testing.T) {
	got := loginShell()
	if got == "" {
		return // nothing to be found here is a fair answer
	}
	if !strings.HasPrefix(got, "/") {
		t.Fatalf("the system answered %q, which is not a path", got)
	}
}
