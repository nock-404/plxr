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

	cases := []struct {
		name   string
		screen string
		want   string
	}{
		{"question is open at the prompt",
			"Welche Farbe?\n  1) rot\n  2) blau\nAuswahl> ", Permission},
		{"question answered, output follows",
			"Welche Farbe?\n  1) rot\n  2) blau\nAuswahl> 2\nGEWAEHLT: 2", "unknown"},
		{"y/n is open",
			"rm -rf /tmp/x (y/n) ", Permission},
		{"y/n answered, shell sits at its own prompt",
			"rm -rf /tmp/x (y/n) y\ndone.\nfinished.\n$ ", "unknown"},
		{"y/n answered, output without a prompt",
			"rm -rf /tmp/x (y/n) y\ndone.\nfinished.\nmore output.", "unknown"},
		{"multi-line dialog box",
			"Editing file\n\nDo you want to proceed?\n❯ 1. Yes\n  2. No", Permission},
		{"blank lines after the question do not count",
			"Continue?\n\n\n", Permission},
		{"working",
			"… esc to interrupt", Working},
	}
	for _, f := range cases {
		if got := p.Classify(f.screen, 9*time.Second); got != f.want {
			t.Errorf("%s: %q instead of %q", f.name, got, f.want)
		}
	}
}

func TestWaitingAtPrompt(t *testing.T) {
	yes := []string{"Choose> ", "Password:", "Continue?"}
	// Shell prompts are the normal state, not a question.
	no := []string{"GEWAEHLT: 2", "fertig.", "", "  2. No", "root@x:/#", "$ ", "user@host ~ %"}
	for _, s := range yes {
		if !waitingAtPrompt(s) {
			t.Errorf("%q should count as a prompt", s)
		}
	}
	for _, s := range no {
		if waitingAtPrompt(s) {
			t.Errorf("%q should not count as a prompt", s)
		}
	}
}

// A shell at its prompt is idle, not working: it has just printed the prompt,
// so the idle timer has not run yet, and every quiet shell used to be counted
// among the busy ones for idle_seconds after each command.
func TestShellAtItsPromptIsNotWorking(t *testing.T) {
	p := Profile{Name: "generic", Source: "screen", IdleSeconds: 4, IdleStatus: Unknown, Blocked: []string{"Do you want"}}
	p.compile()
	for _, screen := range []string{
		"plxr $ ",
		"user@box ~/work %",
		"root@box:/srv#",
		"$ ls\nBUILD.md  README.md\nplxr $",
	} {
		if got := p.Classify(screen, 0); got != Unknown {
			t.Errorf("a shell at its prompt reads %q, want %q:\n%s", got, Unknown, screen)
		}
	}
	// What is not a prompt still follows the idle timer.
	if got := p.Classify("building the frontend", 0); got != Working {
		t.Errorf("output that is not a prompt reads %q, want %q", got, Working)
	}
	// A question still beats it: the prompt below a question is where the answer goes.
	if got := p.Classify("Do you want to continue?\nplxr $", 0); got != Permission {
		t.Errorf("a question above the prompt reads %q, want %q", got, Permission)
	}
}
