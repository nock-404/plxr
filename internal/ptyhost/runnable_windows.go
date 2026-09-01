//go:build windows

package ptyhost

import (
	"os/exec"
	"path/filepath"
	"strings"
)

/*
What Windows can actually start.

	On this system most command-line tools installed through npm are not programs
	at all: `claude` is a claude.cmd, a few lines of batch that call node. Handing
	that name to CreateProcess fails — it can start an .exe and nothing else — so
	plxr reported that it could not find claude while claude was plainly on the
	PATH and worked in any console.

	So the name is resolved the way a console resolves it, honouring PATHEXT, and
	whatever comes back is wrapped in the thing that can run it.
*/
func runnable(argv []string) []string {
	if len(argv) == 0 {
		return argv
	}
	full, err := exec.LookPath(argv[0])
	if err != nil {
		return argv // let the start fail with its own message
	}
	rest := argv[1:]
	switch strings.ToLower(filepath.Ext(full)) {
	case ".cmd", ".bat":
		// /c: run it and stop. The quoting is cmd's own, which is why the path
		// goes through as one argument rather than being pasted into a line.
		return append([]string{"cmd.exe", "/c", full}, rest...)
	case ".ps1":
		return append([]string{
			"powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", full,
		}, rest...)
	default:
		return append([]string{full}, rest...)
	}
}
