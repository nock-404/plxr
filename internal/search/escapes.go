package search

import "regexp"

// escapePattern matches the control sequences found in a raw recording: OSC up
// to BEL or ST, CSI, lone escapes and the remaining control characters.
var escapePattern = regexp.MustCompile(
	`\x1b\][^\x07\x1b]*(\x07|\x1b\\)` +
		`|\x1b[\[\(][0-9;?]*[ -/]*[@-~]` +
		`|\x1b[@-Z\\-_]` +
		`|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]`)

func stripEscapes(s string) string { return escapePattern.ReplaceAllString(s, "") }
