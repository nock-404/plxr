package files

import "testing"

// A one-line file was showing "2 lines" in the viewer: the trailing newline
// closes the last line, it does not open a new one.
func TestCountLines(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{"", 0},
		{"hallo\n", 1},
		{"hallo", 1},
		{"a\nb\n", 2},
		{"a\nb", 2},
		{"\n", 1},
		{"\n\n", 2},
		{"a\n\n", 2},
	}
	for _, c := range cases {
		if got := countLines([]byte(c.in)); got != c.want {
			t.Errorf("countLines(%q) = %d, want %d", c.in, got, c.want)
		}
	}
}
