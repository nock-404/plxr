package ptyhost

import (
	"encoding/binary"
	"os"
	"time"
)

/* The recording is a raw byte stream and carries no time of its own. That is
   enough to search it, but not to play it back: without knowing when something
   arrived there is no speed control and no way to skip the idle stretches — and
   those are most of a session.

   Changing the log format would be the obvious move and the wrong one. The
   search reads it line by line, and every recording written so far would become
   unreadable. So the time goes into a second file next to it: fixed 16-byte
   entries of (offset in the log, unix milliseconds). The log stays byte for byte
   what it was.

   Not every write gets a mark. A build printing a thousand lines a second would
   otherwise produce an index larger than the recording. A mark is written when
   enough time has passed to matter for playback, or when enough bytes have gone
   by that seeking would be coarse without one. */

// markInterval is how much time has to pass before a new mark is worth it.
// Below this the playback difference is not visible anyway.
const markInterval = 120 * time.Millisecond

// markBytes forces a mark after this much output even while it keeps streaming,
// so seeking stays reasonably precise inside a long burst.
const markBytes = 32 << 10

/*
markBudget is how many marks may be written before the interval doubles.

	The byte rule caps bursts. The time rule did not cap anything: a TUI that
	redraws its spinner produces marks for hours on end without the recording
	growing much. Measured out, an eight-hour Claude Code session yields 240000
	marks — a 3.7 MB index next to a recording of a few hundred kilobytes. The
	index would be larger than what it indexes.

	So the interval doubles every budget's worth of marks. A short session keeps
	its fine granularity, where it matters; a long one gets coarser exactly where
	nobody seeks to the second any more. The growth is logarithmic instead of
	linear: eight hours end up under 100 KB.
*/
const markBudget = 2048

// timeline writes the marks belonging to one recording.
type timeline struct {
	f          *os.File
	lastAt     time.Time
	lastOffset int64
	count      int
	interval   time.Duration
}

func openTimeline(path string) *timeline {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return nil
	}
	return &timeline{f: f, interval: markInterval}
}

// mark notes that the log has reached offset at time now — if it is worth it.
func (t *timeline) mark(offset int64, now time.Time) {
	if t == nil || t.f == nil {
		return
	}
	if !t.lastAt.IsZero() &&
		now.Sub(t.lastAt) < t.interval &&
		offset-t.lastOffset < markBytes {
		return
	}
	var buf [16]byte
	binary.BigEndian.PutUint64(buf[0:8], uint64(offset))
	binary.BigEndian.PutUint64(buf[8:16], uint64(now.UnixMilli()))
	if _, err := t.f.Write(buf[:]); err != nil {
		return
	}
	t.lastAt, t.lastOffset = now, offset
	t.count++
	if t.count%markBudget == 0 {
		t.interval *= 2
	}
}

func (t *timeline) close() {
	if t != nil && t.f != nil {
		t.f.Close()
		t.f = nil
	}
}

// Mark is one entry of the index.
type Mark struct {
	Offset int64 `json:"offset"`
	At     int64 `json:"at"` // unix milliseconds
}

// ReadTimeline reads the index of a recording. A recording written before this
// existed simply has none — the caller then plays back at a constant rate.
func ReadTimeline(path string) []Mark {
	b, err := os.ReadFile(path)
	if err != nil || len(b) < 16 {
		return nil
	}
	out := make([]Mark, 0, len(b)/16)
	for i := 0; i+16 <= len(b); i += 16 {
		out = append(out, Mark{
			Offset: int64(binary.BigEndian.Uint64(b[i : i+8])),
			At:     int64(binary.BigEndian.Uint64(b[i+8 : i+16])),
		})
	}
	return out
}
