// Package shell works out what a terminal should start with.
//
// A terminal that only starts coding agents is not a terminal. The normal case
// is the user's login shell — and starting that correctly has more pitfalls than
// it looks: the shell has to run as a login shell (otherwise PATH entries from
// .zprofile are missing), and the environment has to be right (otherwise
// programs show no colours or choke on non-ASCII characters).
package shell

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// Default returns the command for an ordinary terminal session.
func Default() []string {
	if runtime.GOOS == "windows" {
		return windowsShell()
	}
	return unixShell()
}

// unixShell starts the login shell.
//
// The leading "-" in argument zero is the traditional way of telling a shell
// that it is a login shell. Only then does it read .zprofile or .bash_profile —
// and without those the PATH entries the user has in their normal console are
// missing. go-pty passes Args through unchanged, which is why this goes through
// the argument rather than through exec.Cmd.
func unixShell() []string {
	return []string{unixShellPath(), "-l"}
}

// unixShellPath resolves the login shell binary, falling back through the ways
// $SHELL can be missing (services, desktop launch) to the shells that exist.
func unixShellPath() string {
	sh := os.Getenv("SHELL")
	if sh == "" {
		// $SHELL is missing in services and when started through the desktop
		// rather than from a terminal. Then the system is asked — and each
		// system is asked in its own way, which is why that lives next door.
		sh = loginShell()
	}
	if sh == "" {
		for _, k := range []string{"/bin/zsh", "/bin/bash", "/bin/sh"} {
			if _, err := os.Stat(k); err == nil {
				sh = k
				break
			}
		}
	}
	if sh == "" {
		sh = "/bin/sh"
	}
	return sh
}

// WrapInShell runs a CLI inside a login shell so the session behaves like a real
// terminal: the CLI (claude/codex/aider) is a child of the shell, and when it
// exits — /exit, Ctrl+D, Ctrl+C out of it, or a crash — the shell is still there
// and you land back at a live prompt in the same directory, instead of the PTY
// dying into a "this session is not running" panel.
//
// On Unix the mechanism is `exec`: `$SHELL -l -c '<cli>; exec $SHELL -l'` runs
// the CLI, and on its exit `exec` replaces the SAME process with an interactive
// login shell on the same pty — so drop-to-shell needs no respawn engine and no
// timing on stdin, and the pty host stays single-shot. On Windows there is no
// exec; -NoExit (PowerShell) and /k (cmd) keep the shell open after the CLI ends,
// which is the same effect by the platform's own means.
//
// An empty cli means a plain shell session — that is Default(), not a wrap.
func WrapInShell(cli []string) []string {
	if len(cli) == 0 {
		return Default()
	}
	if runtime.GOOS == "windows" {
		return windowsWrap(cli)
	}
	sh := unixShellPath()
	// The wrapper is the foreground process-group leader on the pty, so a ^C
	// from the terminal reaches it too — and an untrapped SIGINT kills it before
	// `exec` ever runs, taking the session with it. Ignoring INT in the wrapper
	// lets the signal do its job on the CLI alone; the CLI ends, the exec fires,
	// and you are at a shell. Measured: without the trap ^C left nothing on the
	// tty; with it the shell survives and answers.
	inner := "trap : INT; " + Quote(cli) + "; exec " + quoteArg(sh) + " -l"
	return []string{sh, "-l", "-c", inner}
}

// windowsWrap runs the CLI and then keeps the shell open, the Windows way.
func windowsWrap(cli []string) []string {
	base := windowsShell()
	cmd := strings.Join(cli, " ")
	name := strings.ToLower(Name(base))
	if name == "pwsh" || name == "powershell" {
		return []string{base[0], "-NoLogo", "-NoExit", "-Command", cmd}
	}
	return []string{base[0], "/k", cmd}
}

// quoteArg wraps a single argument so a POSIX shell reads it verbatim: single
// quotes take everything literally, and the only character that cannot appear
// inside them — a single quote — is closed, escaped and reopened: the quote
// ends the literal, a backslash-quote stands for the character, a quote opens
// the literal again.
func quoteArg(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// Quote turns an argv into one shell-safe command string. It is what lets an
// arbitrary CLI argument — a path with spaces, a resume id, a value carrying a
// quote, $ or ; — pass through the `-c '<here>'` wrapper without breaking the
// launch or running anything it should not.
func Quote(argv []string) string {
	q := make([]string, len(argv))
	for i, a := range argv {
		q[i] = quoteArg(a)
	}
	return strings.Join(q, " ")
}

// windowsShell picks the best shell available.
//
// Ordered by usefulness: PowerShell 7 before the bundled Windows PowerShell
// before cmd.exe. Windows itself would default to cmd.exe — which nobody wants
// any more.
func windowsShell() []string {
	for _, k := range []string{"pwsh.exe", "powershell.exe"} {
		if p, err := exec.LookPath(k); err == nil {
			// -NoLogo: otherwise the startup banner appears in every new session.
			return []string{p, "-NoLogo"}
		}
	}
	if p, err := exec.LookPath("cmd.exe"); err == nil {
		return []string{p}
	}
	return []string{"cmd.exe"}
}

// Environment are the variables a terminal has to set.
//
// Without TERM programs do not recognise a terminal and drop colours and line
// editing. COLORTERM=truecolor unlocks the 24-bit colours xterm.js supports.
// LANG with UTF-8 keeps accented and box-drawing characters from arriving as
// question marks — that is missing surprisingly often when a program was not
// started from a console.
func Environment(currentVersion string) []string {
	env := []string{
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
		"TERM_PROGRAM=plxr",
		"TERM_PROGRAM_VERSION=" + currentVersion,
	}
	if os.Getenv("LANG") == "" {
		env = append(env, "LANG=en_US.UTF-8")
	}
	return env
}

// Name is the display name of a command, without path and arguments.
func Name(argv []string) string {
	if len(argv) == 0 {
		return ""
	}
	return strings.TrimSuffix(filepath.Base(argv[0]), ".exe")
}
