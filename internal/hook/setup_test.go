package hook

import "testing"

// What gets written is the path of the running binary. If it is named anything
// other than "plxr" — "plxr.exe" on Windows, "plxr-test" while developing — plxr
// still has to recognise its own entry. Otherwise it permanently reports "not
// installed" and adds another entry next to it on every click.
func TestRecognisesOwnEntry(t *testing.T) {
	ours := []string{
		"/Applications/plxr.app/Contents/MacOS/plxr",
		"/usr/local/bin/plxr",
		`C:\Program Files\plxr\plxr.exe`,
		"/build/bin/plxr-test",
		"/opt/PLXR",
	}
	foreign := []string{
		"/Users/x/.claude-fleet/fleet-hook.mjs",
		"/usr/bin/node",
		"plxrtools",
		"",
	}
	for _, b := range ours {
		if !isOurCommand(b) {
			t.Errorf("%q should count as our own entry", b)
		}
	}
	for _, b := range foreign {
		if isOurCommand(b) {
			t.Errorf("%q should not count as our own entry", b)
		}
	}
}

func TestEntryRecognised(t *testing.T) {
	entry := map[string]any{
		"hooks": []any{map[string]any{
			"type": "command", "command": "/build/bin/plxr-test", "args": []any{"hook"},
		}},
	}
	if !isOurs(entry) {
		t.Error("entry with a differing file name was not recognised")
	}
	foreign := map[string]any{
		"hooks": []any{map[string]any{
			"type": "command", "command": "/Users/x/.claude-fleet/fleet-hook.mjs",
		}},
	}
	if isOurs(foreign) {
		t.Error("foreign entry was wrongly taken for our own")
	}
}
