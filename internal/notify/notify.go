// Package notify says one thing, once, on whichever system it is running on.
//
// Three systems, three ways of putting a message on a screen, and no shared
// one: macOS has a notification centre an application posts into, Linux has a
// desktop bus that `notify-send` speaks, Windows has toasts. What they have in
// common is the decision — whether to say something and with which sound — and
// that lives here. How it reaches the screen lives in the file for that system.
package notify

import "strings"

// esc keeps a title or a body from breaking out of whatever quoting the system
// underneath uses, and keeps it short enough to be read at a glance.
func esc(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	s = strings.ReplaceAll(s, "\n", " ")
	if len(s) > 120 {
		s = s[:120]
	}
	return s
}

// Send shows one notification. A sound of "" means show it silently.
func Send(title, body, sound string) {
	deliver(esc(title), esc(body), sound)
}

// Sounds are the ones this system can play, for the interface to offer.
func Sounds() []string { return sounds() }
