//go:build windows

package browse

import (
	"os/exec"

	"plxr/internal/sys"
)

// The handler that opens an address is asked directly, so no console window
// flashes up and nothing is parsed by a shell on the way.
func open(link string) error {
	return sys.Quiet(exec.Command("rundll32", "url.dll,FileProtocolHandler", link)).Start()
}
