//go:build darwin

package notify

/*
#cgo CFLAGS: -x objective-c -fmodules
#cgo LDFLAGS: -framework Foundation -framework UserNotifications
#include <stdlib.h>
int plxrNotify(const char *title, const char *subtitle, const char *body, const char *sound);
*/
import "C"

import (
	"os/exec"
	"unsafe"
)

// native sends the notification as this application, so it carries its icon.
// Returns false when there is no bundle to send as — then the caller falls
// back to the script, which at least still says something.
func native(title, subtitle, body, sound string) bool {
	t, s, b, n := C.CString(title), C.CString(subtitle), C.CString(body), C.CString(sound)
	defer func() {
		C.free(unsafe.Pointer(t))
		C.free(unsafe.Pointer(s))
		C.free(unsafe.Pointer(b))
		C.free(unsafe.Pointer(n))
	}()
	return C.plxrNotify(t, s, b, n) == 1
}

// deliver posts as the application when there is a bundle to post as, so the
// notification carries the icon. Unbundled — a plain `go run` during
// development — there is no identity to post with, and the script route is
// what is left.
func deliver(title, body, sound string) {
	if native(title, "", body, sound) {
		return
	}
	script := `display notification "` + body + `" with title "` + title + `"`
	if sound != "" {
		script += ` sound name "` + sound + `"`
	}
	_ = exec.Command("osascript", "-e", script).Run()
}

// The sounds macOS ships in /System/Library/Sounds. A file picker instead would
// mean carrying somebody's chosen file around and failing once it moves.
func sounds() []string {
	return []string{
		"Basso", "Blow", "Bottle", "Frog", "Funk", "Glass", "Hero",
		"Morse", "Ping", "Pop", "Purr", "Sosumi", "Submarine", "Tink",
	}
}

// The sound to start with here.
func defaultSound() string { return "Submarine" }
