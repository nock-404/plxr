package hook

import "testing"

// Eingetragen wird der Pfad des laufenden Binärs. Heißt es anders als "plxr" —
// unter Windows "plxr.exe", beim Entwickeln "plxr-test" —, muss plxr den
// eigenen Eintrag trotzdem wiedererkennen. Sonst meldet es dauerhaft "nicht
// eingerichtet" und legt bei jedem Klick einen weiteren Eintrag daneben.
func TestEigenenEintragWiedererkennen(t *testing.T) {
	unser := []string{
		"/Applications/plxr.app/Contents/MacOS/plxr",
		"/usr/local/bin/plxr",
		`C:\Program Files\plxr\plxr.exe`,
		"/build/bin/plxr-test",
		"/opt/PLXR",
	}
	fremd := []string{
		"/Users/x/.claude-fleet/fleet-hook.mjs",
		"/usr/bin/node",
		"plxrtools",
		"",
	}
	for _, b := range unser {
		if !isOurCommand(b) {
			t.Errorf("%q sollte als eigener Eintrag gelten", b)
		}
	}
	for _, b := range fremd {
		if isOurCommand(b) {
			t.Errorf("%q sollte nicht als eigener Eintrag gelten", b)
		}
	}
}

func TestEintragErkannt(t *testing.T) {
	entry := map[string]any{
		"hooks": []any{map[string]any{
			"type": "command", "command": "/build/bin/plxr-test", "args": []any{"hook"},
		}},
	}
	if !isOurs(entry) {
		t.Error("Eintrag mit abweichendem Dateinamen wurde nicht erkannt")
	}
	fremd := map[string]any{
		"hooks": []any{map[string]any{
			"type": "command", "command": "/Users/x/.claude-fleet/fleet-hook.mjs",
		}},
	}
	if isOurs(fremd) {
		t.Error("fremder Eintrag wurde fälschlich als eigener erkannt")
	}
}
