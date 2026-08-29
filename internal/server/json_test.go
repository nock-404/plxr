package server

import (
	"net/http/httptest"
	"strings"
	"testing"
)

// The case this was written for: a session without marks. Go turns the nil
// slice into `null`, the interface reads `list.length` on it, throws, and the
// pane stays empty without a word. Found by clicking, not by any gate.
func TestWriteJSONNeverNullList(t *testing.T) {
	type mark struct {
		Tree string `json:"tree"`
	}
	var empty []mark
	var byName map[string]int

	cases := []struct {
		name string
		in   any
		want string
	}{
		{"nil slice becomes []", empty, "[]"},
		{"nil map becomes {}", byName, "{}"},
		{"filled slice stays", []mark{{Tree: "abc"}}, `[{"tree":"abc"}]`},
		{"empty non-nil slice stays", []mark{}, "[]"},
		// Counter-tests: what is genuinely meant to be nothing has to stay nothing.
		{"nil pointer stays null", (*mark)(nil), "null"},
		{"untyped nil stays null", nil, "null"},
		// A struct must not panic — usage hands one over.
		{"struct passes through", struct {
			N int `json:"n"`
		}{3}, `{"n":3}`},
		{"number passes through", 42, "42"},
		{"string passes through", "hi", `"hi"`},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			writeJSON(w, c.in)
			if got := strings.TrimSpace(w.Body.String()); got != c.want {
				t.Fatalf("got %s, want %s", got, c.want)
			}
			if ct := w.Header().Get("Content-Type"); ct != "application/json" {
				t.Fatalf("content type %q", ct)
			}
		})
	}
}
