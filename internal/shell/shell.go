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
	sh := os.Getenv("SHELL")
	if sh == "" {
		// $SHELL is missing in services and when started through LaunchServices.
		if out, err := exec.Command("dscl", ".", "-read",
			filepath.Join("/Users", os.Getenv("USER")), "UserShell").Output(); err == nil {
			if f := strings.Fields(string(out)); len(f) == 2 {
				sh = f[1]
			}
		}
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
	return []string{sh, "-l"}
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
