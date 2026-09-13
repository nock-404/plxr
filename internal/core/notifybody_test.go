package core

import "testing"

// The body under the session's name says what happened. A session that ended
// used to say "waiting for your answer" whenever it had no activity line, and
// one that ended with an old activity line still in place said that instead.
func TestTheBodySaysWhatHappened(t *testing.T) {
	cases := []struct{ state, activity, want string }{
		{"permission", "Bash wants to run make", "Bash wants to run make"},
		{"permission", "", "is waiting for your answer"},
		{"waiting", "", "has stopped and is waiting"},
		{"dead", "Editing main.go", "has ended"},
		{"orphaned", "", "was lost when the service stopped"},
	}
	for _, c := range cases {
		if got := whatHappened(c.state, c.activity); got != c.want {
			t.Errorf("%s with %q: %q, want %q", c.state, c.activity, got, c.want)
		}
	}
}
