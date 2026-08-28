// Package replies remembers which answer went to which question.
//
// The case it exists for: eight agents in the same monorepo ask the same thing
// all day — "Do you want to proceed?", "Edit package.json?". You answer it,
// and half an hour later you answer it again, and you cannot remember whether
// you said yes the last two times or no.
//
// So: the question, the answer, the time. And in the inbox it stands there
// before you decide, with a button to send the same thing again.
//
// Only the question decides, not the session. That is the point — the same
// question from another agent is the same decision.
package replies

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"

	"plxr/internal/daemon"
)

// Keep is how far back the memory reaches. Deliberately short: a decision from
// last week says nothing about today's branch, and an old answer offered with
// a button would be worse than none.
const Keep = 24 * time.Hour

// Reply is one answer given.
type Reply struct {
	Question string `json:"question"`
	Answer   string `json:"answer"`
	At       int64  `json:"at"`
}

func file() string { return filepath.Join(daemon.Root(), "replies.jsonl") }

// Key is what makes two questions the same one.
//
// Word for word, only whitespace normalised. Measuring similarity would be an
// invitation to an accident: "Edit src/a.go?" and "Edit src/b.go?" are not the
// same question, and an answer offered for the wrong one is worse than typing
// it again.
func Key(question string) string {
	return strings.Join(strings.Fields(question), " ")
}

// Note records an answer. Errors are swallowed: a memory that cannot be
// written must never stop an answer from going out.
func Note(question, answer string) {
	q, a := Key(question), strings.TrimSpace(answer)
	if q == "" || a == "" {
		return
	}
	f, err := os.OpenFile(file(), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	b, err := json.Marshal(Reply{Question: q, Answer: a, At: time.Now().UnixMilli()})
	if err != nil {
		return
	}
	f.Write(append(b, '\n'))
}

// For hands out what was answered to this question within Keep, newest first.
func For(question string, now int64) []Reply {
	q := Key(question)
	if q == "" {
		return nil
	}
	b, err := os.ReadFile(file())
	if err != nil {
		return nil
	}
	cutoff := now - int64(Keep/time.Millisecond)
	var out []Reply
	for _, line := range strings.Split(string(b), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var r Reply
		if json.Unmarshal([]byte(line), &r) != nil || r.Question != q || r.At < cutoff {
			continue
		}
		out = append(out, r)
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out
}
