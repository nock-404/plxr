package search

import (
	"errors"
	"io"
	"os"
	"path/filepath"

	"plxr/internal/ptyhost"
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

type Playback struct {
	ID     string         `json:"id"`
	Size   int64          `json:"groesse"`
	From   int64          `json:"ab"`
	Data   []byte         `json:"-"`
	Marks  []ptyhost.Mark `json:"marken"`
	Cut    bool           `json:"beschnitten"`
	HasIdx bool           `json:"zeitachse"`
}

// ReadPlayback returns a slice of the recording starting at from.
func ReadPlayback(dir, id string, from int64) (*Playback, error) {
	if dir == "" || id == "" {
		return nil, errors.New("keine Aufzeichnung angegeben")
	}
	// The id becomes a file name, so it must not carry a path.
	if filepath.Base(id) != id {
		return nil, errors.New("unzulässige Kennung")
	}
	logPath := filepath.Join(dir, id+".log")
	f, err := os.Open(logPath)
	if err != nil {
		return nil, errors.New("für diese Session gibt es keine Aufzeichnung")
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
		return nil, errors.New("unzulässige Kennung")
	}
	if _, err := os.Stat(filepath.Join(dir, id+".log")); err != nil {
		return nil, errors.New("für diese Session gibt es keine Aufzeichnung")
	}
	// A recording from before the timeline existed simply has none. That is not
	// an error — the caller then plays back at a constant rate.
	marks := ptyhost.ReadTimeline(filepath.Join(dir, id+".idx"))
	if marks == nil {
		marks = []ptyhost.Mark{}
	}
	return marks, nil
}
