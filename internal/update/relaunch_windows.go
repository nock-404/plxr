//go:build windows

package update

import (
	"fmt"
	"os/exec"
	"plxr/internal/sys"
)

// The same wait, in the only scripting Windows is certain to have.
func relaunch(path string, oldPID int) error {
	script := fmt.Sprintf(
		"while (Get-Process -Id %d -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 200 }; Start-Process -FilePath '%s'",
		oldPID, path)
	return sys.Quiet(exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", script)).Start()
}
