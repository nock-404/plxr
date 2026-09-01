//go:build windows

package files

import (
	"os/exec"

	"plxr/internal/sys"
)

// Explorer selects the file when it is given /select.
func reveal(full string) error { return sys.Quiet(exec.Command("explorer", "/select,"+full)).Start() }
