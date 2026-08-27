package search

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func recording(t *testing.T, dir, id, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, id+".log"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestPlaybackReturnsRawStream(t *testing.T) {
	dir := t.TempDir()
	recording(t, dir, "abc", "hello\x1b[31mworld")

	pb, err := ReadPlayback(dir, "abc", 0)
	if err != nil {
		t.Fatal(err)
	}
	// The escape sequence has to survive untouched — a terminal emulator needs
	// it to reproduce the colours.
	if string(pb.Data) != "hello\x1b[31mworld" {
		t.Errorf("stream came back altered: %q", pb.Data)
	}
	if pb.HasIdx {
		t.Error("claims a timeline although none exists")
	}
}

// Recordings from before the timeline existed have to keep playing.
func TestPlaybackWithoutTimeline(t *testing.T) {
	dir := t.TempDir()
	recording(t, dir, "alt", "was da war")
	pb, err := ReadPlayback(dir, "alt", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(pb.Marks) != 0 || pb.HasIdx {
		t.Error("a timeline appeared out of nowhere")
	}
	if string(pb.Data) != "was da war" {
		t.Error("stream missing")
	}
}

func TestPlaybackSeeks(t *testing.T) {
	dir := t.TempDir()
	recording(t, dir, "abc", "0123456789")
	pb, err := ReadPlayback(dir, "abc", 4)
	if err != nil {
		t.Fatal(err)
	}
	if string(pb.Data) != "456789" {
		t.Errorf("seek landed wrong: %q", pb.Data)
	}
	if pb.From != 4 || pb.Size != 10 {
		t.Errorf("From/Size wrong: %d/%d", pb.From, pb.Size)
	}
}

// An offset past the end must not error out — it just starts over.
func TestPlaybackOffsetOutOfRange(t *testing.T) {
	dir := t.TempDir()
	recording(t, dir, "abc", "kurz")
	for _, from := range []int64{-5, 999} {
		pb, err := ReadPlayback(dir, "abc", from)
		if err != nil {
			t.Fatalf("from=%d: %v", from, err)
		}
		if pb.From != 0 {
			t.Errorf("from=%d was not reset", from)
		}
	}
}

// The id becomes a file name. Anything with a path in it has to be refused.
func TestPlaybackRefusesPaths(t *testing.T) {
	dir := t.TempDir()
	recording(t, dir, "abc", "x")
	for _, id := range []string{"../../etc/passwd", "sub/abc", ""} {
		if _, err := ReadPlayback(dir, id, 0); err == nil {
			t.Errorf("%q was accepted", id)
		}
	}
}

// A dev server running for weeks writes up to 64 MB. Pushing that into a
// webview in one go is not playback, it is a freeze.
func TestPlaybackCapsHugeRecordings(t *testing.T) {
	dir := t.TempDir()
	recording(t, dir, "gross", strings.Repeat("x", MaxPlayback+5000))
	pb, err := ReadPlayback(dir, "gross", 0)
	if err != nil {
		t.Fatal(err)
	}
	if !pb.Cut {
		t.Error("oversized recording was not marked as cut")
	}
	if int64(len(pb.Data)) != MaxPlayback {
		t.Errorf("%d bytes instead of the cap %d", len(pb.Data), MaxPlayback)
	}
	// The caller has to be able to fetch the rest — otherwise the end of a long
	// session would be unreachable.
	if pb.Size <= int64(len(pb.Data)) {
		t.Error("Size does not reveal that more follows")
	}
}

func TestPlaybackMissingRecording(t *testing.T) {
	if _, err := ReadPlayback(t.TempDir(), "gibtsnicht", 0); err == nil {
		t.Error("a missing recording was not reported")
	}
}
