package search

import (
	"io"
	"os"
	"path/filepath"

	"plxr/internal/ptyhost"
	"plxr/internal/uierr"
)

/* Playback hands out a recording together with its timeline.

   The recording itself stays what it always was: the raw byte stream that went
   over the terminal. Feeding it into a terminal emulator reproduces the session
   exactly, including colours and redrawn frames — that is why nothing is parsed
   here.

   What the raw stream cannot say is when anything arrived. That comes from the
   index next to it. A recording written before the index existed simply has
   none; the caller then plays back at a constant rate rather than not at all. */

// MaxPlayback caps what a single request hands out. A dev server left running
// for weeks writes up to MaxRecording, and pushing 64 MB into a webview at once
// is not playback, it is a freeze.
const MaxPlayback = 8 << 20

// Playback never goes out as JSON: /api/playback answers with the raw byte
// stream and puts the numbers into headers, because base64 would treble the
// size of a terminal recording. The json tags this struct used to carry
// promised a contract that did not exist — and made every field look like an
// unread one to the field check.
type Playback struct {
	ID     string
	Size   int64
	From   int64
	Data   []byte
	Marks  []ptyhost.Mark
	Cut    bool
	HasIdx bool
}

// ReadPlayback returns a slice of the recording starting at from.
func ReadPlayback(dir, id string, from int64) (*Playback, error) {
	if dir == "" || id == "" {
		return nil, uierr.New("err.playback.noID")
	}
	// The id becomes a file name, so it must not carry a path.
	if filepath.Base(id) != id {
		return nil, uierr.New("err.playback.badID")
	}
	logPath := filepath.Join(dir, id+".log")
	f, err := os.Open(logPath)
	if err != nil {
		return nil, uierr.New("err.playback.missing")
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if from < 0 || from > info.Size() {
		from = 0
	}
	if _, err := f.Seek(from, io.SeekStart); err != nil {
		return nil, err
	}

	rest := info.Size() - from
	cut := rest > MaxPlayback
	if cut {
		rest = MaxPlayback
	}
	buf := make([]byte, rest)
	n, _ := io.ReadFull(f, buf)

	marks := ptyhost.ReadTimeline(filepath.Join(dir, id+".idx"))
	return &Playback{
		ID:     id,
		Size:   info.Size(),
		From:   from,
		Data:   buf[:n],
		Marks:  marks,
		Cut:    cut,
		HasIdx: len(marks) > 0,
	}, nil
}

// ReadTimeline hands out the marks of a recording on their own.
func ReadTimeline(dir, id string) ([]ptyhost.Mark, error) {
	if dir == "" || filepath.Base(id) != id || id == "" {
		return nil, uierr.New("err.playback.badID")
	}
	if _, err := os.Stat(filepath.Join(dir, id+".log")); err != nil {
		return nil, uierr.New("err.playback.missing")
	}
	// A recording from before the timeline existed simply has none. That is not
	// an error — the caller then plays back at a constant rate.
	marks := ptyhost.ReadTimeline(filepath.Join(dir, id+".idx"))
	if marks == nil {
		marks = []ptyhost.Mark{}
	}
	return marks, nil
}
