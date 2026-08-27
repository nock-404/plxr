// Package notify sends macOS notifications when a session gets stuck.
package notify

import (
	"os/exec"
	"strings"
)

func esc(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	if len(s) > 120 {
		s = s[:120]
	}
	return s
}

func Send(title, body string) {
	script := `display notification "` + esc(body) + `" with title "plxr" subtitle "` + esc(title) + `" sound name "Submarine"`
	_ = exec.Command("osascript", "-e", script).Run()
}
