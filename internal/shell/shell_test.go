package shell

import (
	"os"
	"os/exec"
	"path/filepath"
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

/* A CLI runs inside the login shell, and its arguments have to arrive intact.
 *
 * The wrapper hands the shell one string through -c. Anything the shell reads
 * as syntax in there — a space, a quote, a $, a ; — either breaks the launch or
 * runs something nobody asked for. So every argument is checked against what a
 * real POSIX shell reads back out of it, not against what the string looks like.
 */

func TestQuoteMatrixRoundTripsThroughARealShell(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("no POSIX shell to read the quoting back")
	}
	cases := [][]string{
		{"claude"},
		{"claude", "--resume", "e20aa197-2808-44d4-b297-04076b79623b"},
		{"aider", "--model", "gpt-4o", "/Users/me/My Projects/app"},
		{"codex", "it's a 'quoted' thing"},
		{"echo", "$HOME", "${PATH}", "`id`", "$(id)"},
		{"echo", "a; rm -rf /", "b && c", "d | e", "f > g"},
		{"echo", "back\\slash", "tab\there", "new\nline"},
		{"echo", "", "empty above", "\"double\""},
		{"/usr/local/bin/claude", "--add-dir", "/tmp/dir with spaces/and 'quotes'"},
	}
	for _, argv := range cases {
		q := Quote(argv)
		// The exact form: every argument wrapped in single quotes, joined by one
		// space, each single quote closed-escaped-reopened.
		want := make([]string, len(argv))
		for i, a := range argv {
			want[i] = "'" + strings.ReplaceAll(a, "'", `'\''`) + "'"
		}
		if q != strings.Join(want, " ") {
			t.Errorf("Quote(%q) = %q", argv, q)
		}
		// And what a shell makes of it: printf %s with a NUL between the words
		// hands the argv back exactly, expansions and all left unexpanded.
		out, err := exec.Command("/bin/sh", "-c", "printf '%s\\0' "+q).Output()
		if err != nil {
			t.Fatalf("sh could not read %q: %v", q, err)
		}
		got := strings.Split(strings.TrimSuffix(string(out), "\x00"), "\x00")
		if strings.Join(got, "\x00") != strings.Join(argv, "\x00") {
			t.Errorf("the shell read %q back as %q", argv, got)
		}
	}
}

func TestQuoteOfNothingIsNothing(t *testing.T) {
	if got := Quote(nil); got != "" {
		t.Fatalf("Quote(nil) = %q", got)
	}
}

func TestWrapInShellIsTheLoginShellRunningTheCLIThenExecingItself(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows keeps the shell open by its own means")
	}
	t.Setenv("SHELL", "/bin/zsh")
	argv := WrapInShell([]string{"claude", "--resume", "abc def"})
	if len(argv) != 4 {
		t.Fatalf("expected shell -l -c <string>, got %q", argv)
	}
	if argv[0] != "/bin/zsh" || argv[1] != "-l" || argv[2] != "-c" {
		t.Fatalf("the root is not the login shell: %q", argv)
	}
	// trap : INT first: the wrapper ignores ^C so the signal reaches the CLI
	// alone and the exec still fires — without it a ^C killed the wrapper and
	// the session with it.
	const want = `trap : INT; 'claude' '--resume' 'abc def'; exec '/bin/zsh' -l`
	if argv[3] != want {
		t.Fatalf("the -c string is\n  %q\nwanted\n  %q", argv[3], want)
	}
}

func TestWrapInShellQuotesAShellPathWithAQuoteInIt(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows keeps the shell open by its own means")
	}
	t.Setenv("SHELL", "/opt/it's/zsh")
	argv := WrapInShell([]string{"claude"})
	const want = `trap : INT; 'claude'; exec '/opt/it'\''s/zsh' -l`
	if argv[3] != want {
		t.Fatalf("the -c string is %q, wanted %q", argv[3], want)
	}
}

func TestWrapInShellOfNothingIsThePlainShell(t *testing.T) {
	t.Setenv("SHELL", "/bin/zsh")
	got := WrapInShell(nil)
	want := Default()
	if strings.Join(got, "\x00") != strings.Join(want, "\x00") {
		t.Fatalf("WrapInShell(nil) = %q, Default() = %q", got, want)
	}
	got = WrapInShell([]string{})
	if strings.Join(got, "\x00") != strings.Join(want, "\x00") {
		t.Fatalf("WrapInShell([]) = %q, Default() = %q", got, want)
	}
}

/* The drop into the shell is the whole point, and it has to fire however the
 * CLI ends — a clean exit, a non-zero one, or being killed by a signal — because
 * `;` does not care about the status of what came before it. Proven with a real
 * shell: the wrapped command ends three different ways and the exec'd shell
 * still runs, in the same directory. */
func TestTheShellTakesOverHoweverTheCLIEnds(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("no exec on Windows")
	}
	t.Setenv("SHELL", "/bin/sh")
	dir := t.TempDir()
	endings := map[string][]string{
		"clean":  {"sh", "-c", "exit 0"},
		"failed": {"sh", "-c", "exit 3"},
		"killed": {"sh", "-c", "kill -TERM $$"},
	}
	for name, cli := range endings {
		argv := WrapInShell(cli)
		// The exec'd shell reads its commands from stdin: it prints where it is
		// and leaves. Without a pty that is the only way to watch it come up.
		cmd := exec.Command(argv[0], argv[1:]...)
		cmd.Dir = dir
		cmd.Stdin = strings.NewReader("echo SHELL-ALIVE; pwd; exit 0\n")
		out, err := cmd.Output()
		if err != nil {
			t.Fatalf("%s: the exec'd shell did not come up: %v (%q)", name, err, out)
		}
		text := string(out)
		if !strings.Contains(text, "SHELL-ALIVE") {
			t.Errorf("%s: no shell after the CLI ended; output %q", name, text)
		}
		if !strings.Contains(text, dir) && !strings.Contains(text, mustEval(dir)) {
			t.Errorf("%s: the shell is not in the session's directory; output %q", name, text)
		}
	}
}

func mustEval(p string) string {
	r, err := filepath.EvalSymlinks(p)
	if err != nil {
		return p
	}
	return r
}
