// Package queue lines instructions up for a session instead of sending them at
// once.
//
// Typing three things while an agent is busy means three things arriving in the
// middle of its work, where the first is read and the rest land in whatever
// prompt happens to be open. Lining them up sends the next one only when the
// agent is actually waiting.
//
// It lives in the daemon and on disk, not in the window: the point of the whole
// separation is that work carries on with the window closed, and a queue that
// forgets itself on restart would be a promise it cannot keep.
package queue

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Item is one instruction waiting its turn.
type Item struct {
	Text  string `json:"text"`
	Added int64  `json:"added"`
}

var mu sync.Mutex

// Dir is where the queues live. Set by the daemon at startup, next to the rest
// of its state.
var Dir string

func path(sessionID string) string { return filepath.Join(Dir, sessionID+".json") }

// Read returns what is waiting for this session, oldest first.
func Read(sessionID string) []Item {
	mu.Lock()
	defer mu.Unlock()
	return read(sessionID)
}

func read(sessionID string) []Item {
	if Dir == "" {
		return nil
	}
	b, err := os.ReadFile(path(sessionID))
	if err != nil {
		return nil
	}
	var out []Item
	if json.Unmarshal(b, &out) != nil {
		return nil
	}
	return out
}

func write(sessionID string, items []Item) error {
	if Dir == "" {
		return nil
	}
	if err := os.MkdirAll(Dir, 0o755); err != nil {
		return err
	}
	if len(items) == 0 {
		// An empty file and no file mean the same thing; the second is tidier.
		os.Remove(path(sessionID))
		return nil
	}
	b, _ := json.MarshalIndent(items, "", "  ")
	tmp := path(sessionID) + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path(sessionID))
}

// Add puts one instruction at the end of the line.
func Add(sessionID, text string) error {
	mu.Lock()
	defer mu.Unlock()
	return write(sessionID, append(read(sessionID), Item{Text: text, Added: time.Now().UnixMilli()}))
}

// Drop removes the entry at that position. Out of range is not an error: the
// list may have moved on between reading it and clicking.
func Drop(sessionID string, index int) error {
	mu.Lock()
	defer mu.Unlock()
	items := read(sessionID)
	if index < 0 || index >= len(items) {
		return nil
	}
	return write(sessionID, append(items[:index:index], items[index+1:]...))
}

// Clear empties the line, for a session that has ended or been taken over.
func Clear(sessionID string) {
	mu.Lock()
	defer mu.Unlock()
	write(sessionID, nil)
}

// Take removes the first entry and returns it, or false when nothing waits.
// Removing before sending is deliberate: an instruction that failed to reach
// the agent is better lost than sent twice.
func Take(sessionID string) (Item, bool) {
	mu.Lock()
	defer mu.Unlock()
	items := read(sessionID)
	if len(items) == 0 {
		return Item{}, false
	}
	first := items[0]
	write(sessionID, items[1:])
	return first, true
}
