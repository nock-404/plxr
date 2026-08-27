package agent

import (
	"testing"
	"time"
)

// Eine Rückfrage soll nur so lange als "braucht dich" gelten, wie sie offen
// ist. Vorher wurde über zwölf Zeilen gesucht: eine längst beantwortete Frage
// blieb dadurch im Posteingang stehen, bis die Session endete.
func TestPromptBlocksOnlyWhilePending(t *testing.T) {
	p := &Profile{
		Name:    "probe",
		Blocked: []string{`\(y/n\)`, `Do you want`, `❯\s*1\.\s*Yes`, `Enter to confirm`, `\?\s*$`},
		Working: []string{`esc to interrupt`},

		IdleSeconds: 4, IdleStatus: "unknown",
	}
	p.compile()

	faelle := []struct {
		name   string
		screen string
		will   string
	}{
		{"Frage steht offen am Prompt",
			"Welche Farbe?\n  1) rot\n  2) blau\nAuswahl> ", Permission},
		{"Frage beantwortet, Ausgabe folgt",
			"Welche Farbe?\n  1) rot\n  2) blau\nAuswahl> 2\nGEWAEHLT: 2", "unknown"},
		{"y/n steht offen",
			"rm -rf /tmp/x (y/n) ", Permission},
		{"y/n beantwortet, Shell steht am eigenen Prompt",
			"rm -rf /tmp/x (y/n) y\nweg.\nfertig.\n$ ", "unknown"},
		{"y/n beantwortet, Ausgabe ohne Prompt",
			"rm -rf /tmp/x (y/n) y\nweg.\nfertig.\nnoch etwas.", "unknown"},
		{"mehrzeiliges Dialogfeld",
			"Bearbeite Datei\n\nDo you want to proceed?\n❯ 1. Yes\n  2. No", Permission},
		{"Leerzeilen hinter der Frage zählen nicht",
			"Continue?\n\n\n", Permission},
		{"arbeitet",
			"… esc to interrupt", Working},
	}
	for _, f := range faelle {
		if got := p.Classify(f.screen, 9*time.Second); got != f.will {
			t.Errorf("%s: %q statt %q", f.name, got, f.will)
		}
	}
}

func TestWaitingAtPrompt(t *testing.T) {
	ja := []string{"Auswahl> ", "Passwort:", "Weiter?"}
	// Shell-Prompts sind der Normalzustand, keine Rückfrage.
	nein := []string{"GEWAEHLT: 2", "fertig.", "", "  2. No", "root@x:/#", "$ ", "user@host ~ %"}
	for _, s := range ja {
		if !waitingAtPrompt(s) {
			t.Errorf("%q sollte als Prompt gelten", s)
		}
	}
	for _, s := range nein {
		if waitingAtPrompt(s) {
			t.Errorf("%q sollte nicht als Prompt gelten", s)
		}
	}
}
