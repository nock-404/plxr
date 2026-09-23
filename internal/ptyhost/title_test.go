package ptyhost

import "testing"

// The title a terminal shows is the one the program sets, and plxr reads it the
// same way — otherwise a shell that has Claude running in it goes on being
// called after its folder.
func TestTheTitleIsReadOutOfTheStream(t *testing.T) {
	for _, c := range []struct {
		what  string
		feed  []string
		title string
	}{
		{"a plain OSC 0 with a bell", []string{"\x1b]0;claude — plxr3\x07"}, "claude — plxr3"},
		{"OSC 2, which sets the same thing", []string{"\x1b]2;a title\x07"}, "a title"},
		{"ended with ESC backslash instead of a bell", []string{"\x1b]0;other\x1b\\"}, "other"},
		{"the newest of several in one burst", []string{"\x1b]0;first\x07text\x1b]0;second\x07"}, "second"},
		{"cut in half by the end of a read", []string{"\x1b]0;half", " a title\x07"}, "half a title"},
		{"around the ordinary output", []string{"$ ls\r\n", "\x1b]0;claude\x07", "a  b  c\r\n"}, "claude"},
		{"an empty title leaves the old one", []string{"\x1b]0;kept\x07", "\x1b]0;\x07"}, "kept"},
		{"a colour sequence is not a title", []string{"\x1b]4;1;#ff0000\x07"}, ""},
	} {
		h := &Host{}
		for _, part := range c.feed {
			h.noteTitle([]byte(part))
		}
		if h.title != c.title {
			t.Errorf("%s: read %q, want %q", c.what, h.title, c.title)
		}
	}
}

// What no program ever sends must not be kept for ever: a sequence that never
// ends is dropped rather than growing the buffer.
func TestAnUnfinishedTitleIsNotKeptForEver(t *testing.T) {
	h := &Host{}
	h.noteTitle(append([]byte("\x1b]0;"), make([]byte, 4096)...))
	if len(h.titleCarry) != 0 {
		t.Errorf("kept %d bytes of an unfinished title", len(h.titleCarry))
	}
}
