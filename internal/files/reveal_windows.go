//go:build windows

package files

import "os/exec"

// Explorer selects the file when it is given /select.
func reveal(full string) error { return exec.Command("explorer", "/select,"+full).Start() }
