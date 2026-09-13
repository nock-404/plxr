// Package notify says one thing, once, on whichever system it is running on.
//
// Three systems, three ways of putting a message on a screen, and no shared
// one: macOS has a notification centre an application posts into, Linux has a
// desktop bus that `notify-send` speaks, Windows has toasts. What they have in
// common is the decision — whether to say something, to whom, and with which
// sound — and that lives here. How it reaches the screen lives in the file for
// that system.
package notify

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// clip keeps a title or a body to one line that can be read at a glance. It
// cuts between characters, never inside one: a session name cut between the
// two bytes of an umlaut is no longer text, and a system that is handed
// something that is not text drops it without a word.
func clip(s string) string {
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	if utf8.RuneCountInString(s) <= 120 {
		return s
	}
	return string([]rune(s)[:120])
}

// esc keeps a title or a body from breaking out of whatever quoting the
// command underneath uses, and clips it.
func esc(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	return clip(s)
}

// bundleShape is what a bundle identifier looks like. Anything else is not
// put into a system URL.
var bundleShape = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9.-]{0,254}$`)

func validBundleID(id string) bool { return bundleShape.MatchString(id) }

// Sounds are the ones this system can play, for the interface to offer.
func Sounds() []string { return sounds() }
