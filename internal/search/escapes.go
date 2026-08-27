package search

import "regexp"

// escapes trifft die Steuerfolgen, die in einem Rohmitschnitt stehen: OSC bis
// BEL oder ST, CSI, einzelne Escapes und die übrigen Steuerzeichen.
var escapePattern = regexp.MustCompile(
	`\x1b\][^\x07\x1b]*(\x07|\x1b\\)` +
		`|\x1b[\[\(][0-9;?]*[ -/]*[@-~]` +
		`|\x1b[@-Z\\-_]` +
		`|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]`)

func stripEscapes(s string) string { return escapePattern.ReplaceAllString(s, "") }
