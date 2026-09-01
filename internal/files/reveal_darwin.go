//go:build darwin

package files

import "os/exec"

// -R selects the file in the Finder rather than opening it.
func reveal(full string) error { return exec.Command("open", "-R", full).Start() }
