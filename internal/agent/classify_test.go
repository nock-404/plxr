package agent

import (
	"testing"
	"time"
)

// A question should only count as "needs you" while it is actually open. The
// search used to span twelve lines, which left a long-answered question standing
// in the inbox until the session ended.
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
		{"question is open at the prompt",
			"Welche Farbe?\n  1) rot\n  2) blau\nAuswahl> ", Permission},
		{"question answered, output follows",
			"Welche Farbe?\n  1) rot\n  2) blau\nAuswahl> 2\nGEWAEHLT: 2", "unknown"},
		{"y/n is open",
			"rm -rf /tmp/x (y/n) ", Permission},
		{"y/n answered, shell sits at its own prompt",
			"rm -rf /tmp/x (y/n) y\nweg.\nfertig.\n$ ", "unknown"},
		{"y/n answered, output without a prompt",
			"rm -rf /tmp/x (y/n) y\nweg.\nfertig.\nnoch etwas.", "unknown"},
		{"multi-line dialog box",
			"Bearbeite Datei\n\nDo you want to proceed?\n❯ 1. Yes\n  2. No", Permission},
		{"blank lines after the question do not count",
			"Continue?\n\n\n", Permission},
		{"working",
			"… esc to interrupt", Working},
	}
	for _, f := range faelle {
		if got := p.Classify(f.screen, 9*time.Second); got != f.will {
			t.Errorf("%s: %q instead of %q", f.name, got, f.will)
		}
	}
}

func TestWaitingAtPrompt(t *testing.T) {
	ja := []string{"Auswahl> ", "Passwort:", "Weiter?"}
	// Shell prompts are the normal state, not a question.
	nein := []string{"GEWAEHLT: 2", "fertig.", "", "  2. No", "root@x:/#", "$ ", "user@host ~ %"}
	for _, s := range ja {
		if !waitingAtPrompt(s) {
			t.Errorf("%q should count as a prompt", s)
		}
	}
	for _, s := range nein {
		if waitingAtPrompt(s) {
			t.Errorf("%q should not count as a prompt", s)
		}
	}
}
