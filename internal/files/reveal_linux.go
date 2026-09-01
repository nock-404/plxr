//go:build linux

package files

import (
	"os/exec"
	"path/filepath"
)

// The desktop bus knows which file manager is set, and its ShowItems method
// selects the file. Where that call fails there is still xdg-open, which can
// only open the folder — less, but better than nothing happening.
func reveal(full string) error {
	dbus := exec.Command("dbus-send", "--session", "--print-reply",
		"--dest=org.freedesktop.FileManager1", "/org/freedesktop/FileManager1",
		"org.freedesktop.FileManager1.ShowItems",
		"array:string:file://"+full, "string:")
	if dbus.Run() == nil {
		return nil
	}
	return exec.Command("xdg-open", filepath.Dir(full)).Start()
}
