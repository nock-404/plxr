package core

import "testing"

/* The ceiling is said once, on the way up.
 *
 * A tick above the line must not say it again, and a ceiling that is not set
 * must not remember anything — otherwise setting one later would either be
 * silent on the first crossing or fire at once without any crossing at all.
 */
func TestTheCeilingIsSaidOnceOnTheWayUp(t *testing.T) {
	c := &Core{}
	steps := []struct {
		window, limit int64
		fire          bool
		why           string
	}{
		{500, 1000, false, "under the ceiling, nothing to say"},
		{1200, 1000, true, "crossed upwards: said once"},
		{1300, 1000, false, "still over: not said again"},
		{1000, 1000, false, "exactly at the ceiling counts as under"},
		{1400, 1000, true, "crossed again: a new crossing"},
		{1400, 0, false, "the ceiling was cleared: nothing to cross"},
		{1400, 2000, false, "a higher ceiling: under it"},
		{1400, 1000, true, "the ceiling was lowered under the spend: that is a crossing"},
		{1400, 0, false, "cleared while over"},
		{1400, 1000, true, "set again while over: said again, the memory was cleared"},
	}
	for i, s := range steps {
		if got := c.paceCrossed(s.window, s.limit); got != s.fire {
			t.Errorf("step %d (%s): fired=%v, want %v", i, s.why, got, s.fire)
		}
	}
}

// The notification and the readout name the same number the same way.
func TestTheCompactNumberMatchesTheWindow(t *testing.T) {
	cases := map[int64]string{0: "0", 999: "999", 1000: "1.0k", 850000: "850.0k", 1234567: "1.2M", 2500000000: "2.5B"}
	for n, want := range cases {
		if got := compact(n); got != want {
			t.Errorf("compact(%d) = %q, want %q", n, got, want)
		}
	}
}
