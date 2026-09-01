package ptyhost

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// The index is what makes playback possible at all. If it does not survive a
// round trip, a session can be replayed but not at the speed it actually ran.
func TestTimelineRoundTrip(t *testing.T) {
	p := filepath.Join(t.TempDir(), "x.idx")
	tl := openTimeline(p)
	if tl == nil {
		t.Fatal("index could not be opened")
	}
	start := time.Now()
	tl.mark(0, start)
	tl.mark(100, start.Add(2*time.Second))
	tl.mark(220, start.Add(5*time.Second))
	tl.close()

	marks := ReadTimeline(p)
	if len(marks) != 3 {
		t.Fatalf("%d marks instead of 3", len(marks))
	}
	if marks[0].Offset != 0 || marks[2].Offset != 220 {
		t.Errorf("offsets came back wrong: %+v", marks)
	}
	if d := marks[1].At - marks[0].At; d != 2000 {
		t.Errorf("pause is %d ms instead of 2000", d)
	}
}

// A build printing a thousand lines a second must not produce an index larger
// than the recording itself.
func TestTimelineSkipsCloseMarks(t *testing.T) {
	p := filepath.Join(t.TempDir(), "x.idx")
	tl := openTimeline(p)
	start := time.Now()
	for i := 0; i < 500; i++ {
		tl.mark(int64(i*10), start.Add(time.Duration(i)*time.Millisecond))
	}
	tl.close()

	marks := ReadTimeline(p)
	if len(marks) > 10 {
		t.Errorf("%d marks for half a second of output — too dense", len(marks))
	}
	if len(marks) == 0 {
		t.Error("not a single mark written")
	}
}

// A long burst without pauses still has to stay seekable.
func TestTimelineMarksLongBursts(t *testing.T) {
	p := filepath.Join(t.TempDir(), "x.idx")
	tl := openTimeline(p)
	now := time.Now()
	for i := 0; i < 20; i++ {
		tl.mark(int64(i)*markBytes, now) // same instant, growing offset
	}
	tl.close()
	if n := len(ReadTimeline(p)); n < 10 {
		t.Errorf("only %d marks across %d bytes — seeking would be coarse", n, 20*markBytes)
	}
}

// A recording from before the index existed must not break anything.
func TestTimelineMissingFile(t *testing.T) {
	if m := ReadTimeline(filepath.Join(t.TempDir(), "nope.idx")); m != nil {
		t.Errorf("a missing index returned %+v instead of nothing", m)
	}
}

// A truncated index — killed mid-write — must not take the reader down.
func TestTimelineTruncated(t *testing.T) {
	p := filepath.Join(t.TempDir(), "x.idx")
	os.WriteFile(p, make([]byte, 40), 0o600) // 2 entries plus 8 stray bytes
	if n := len(ReadTimeline(p)); n != 2 {
		t.Errorf("%d marks from a truncated index, expected 2", n)
	}
}

/*
A TUI that redraws its spinner produces marks for hours without the recording

	growing much. Unchecked that yields an index larger than what it indexes.
*/
func TestTimelineStaysBoundedOverHours(t *testing.T) {
	p := filepath.Join(t.TempDir(), "x.idx")
	tl := openTimeline(p)
	start := time.Now()

	// Eight hours of a session that writes a little every 120 ms.
	var offset int64
	for ms := 0; ms < 8*60*60*1000; ms += 120 {
		offset += 40 // a redrawn spinner line, not much
		tl.mark(offset, start.Add(time.Duration(ms)*time.Millisecond))
	}
	tl.close()

	info, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	// Without the brake this was 3.7 MB.
	if info.Size() > 400<<10 {
		t.Errorf("index is %d KB after eight hours — too large", info.Size()>>10)
	}
	marks := ReadTimeline(p)
	if len(marks) < 1000 {
		t.Errorf("only %d marks over eight hours — too coarse to seek", len(marks))
	}

	// The beginning has to stay fine-grained: that is where people seek.
	if len(marks) > 2 {
		first := marks[1].At - marks[0].At
		if first > 300 {
			t.Errorf("the first marks are already %d ms apart", first)
		}
	}
	// And the marks have to stay in order, otherwise seeking lands wrong.
	for i := 1; i < len(marks); i++ {
		if marks[i].At < marks[i-1].At || marks[i].Offset < marks[i-1].Offset {
			t.Fatalf("mark %d runs backwards: %+v after %+v", i, marks[i], marks[i-1])
		}
	}
}
