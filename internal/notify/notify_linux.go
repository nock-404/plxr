//go:build linux

package notify

import "os/exec"

// Linux notifies through the desktop bus. `notify-send` is what practically
// every desktop ships for it; without it there is nothing to post into, and
// saying nothing is the honest outcome rather than a crash.
func deliver(title, body, sound string) {
	args := []string{"--app-name=plxr", "--icon=plxr", title, body}
	if sound != "" {
		args = append([]string{"--hint=string:sound-name:" + sound}, args...)
	}
	_ = exec.Command("notify-send", args...).Run()
}

// The freedesktop sound naming spec — the names every theme has to provide, so
// a choice made here means the same thing on any desktop.
func sounds() []string {
	return []string{
		"message", "message-new-instant", "complete", "bell",
		"dialog-information", "dialog-warning", "dialog-error",
		"device-added", "device-removed", "window-attention",
	}
}

// The sound to start with here.
func defaultSound() string { return "message" }
