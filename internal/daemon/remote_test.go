package daemon

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestACodeWorksOnceAndThenNotAgain(t *testing.T) {
	t.Setenv("PLXR_HOME", t.TempDir())
	code, until := NewCode()
	if code == "" || len(code) != 9 || code[4] != '-' {
		t.Fatalf("odd code: %q", code)
	}
	if time.Until(until) > CodeLife+time.Second {
		t.Fatalf("a code that lives too long: %v", until)
	}
	if !TakeCode(code) {
		t.Fatalf("a fresh code was refused")
	}
	// A code left on a screen must stop being a key once it has been used.
	if TakeCode(code) {
		t.Fatalf("the same code was accepted twice")
	}
	if TakeCode("ZZZZ-ZZZZ") {
		t.Fatalf("a made-up code was accepted")
	}
	// Typed the way somebody types it.
	other, _ := NewCode()
	if !TakeCode("  " + lower(other) + "  ") {
		t.Fatalf("a code with different case or spaces was refused: %q", other)
	}
}

func lower(s string) string {
	out := []rune(s)
	for i, r := range out {
		if r >= 'A' && r <= 'Z' {
			out[i] = r + 32
		}
	}
	return string(out)
}

func TestJoinHandsOverTheTokenAndOnlyAgainstACode(t *testing.T) {
	t.Setenv("PLXR_HOME", t.TempDir())
	reached := false
	h := Guard("the-token", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
		w.WriteHeader(http.StatusOK)
	}))

	// Without a code, nothing.
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/join/NOPE-NOPE", nil))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("a made-up code got %d", rec.Code)
	}

	code, _ := NewCode()
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/join/"+code, nil))
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("joining with a good code got %d", rec.Code)
	}
	var cookie *http.Cookie
	for _, c := range rec.Result().Cookies() {
		if c.Name == "plxr" {
			cookie = c
		}
	}
	if cookie == nil || cookie.Value != "the-token" {
		t.Fatalf("no token in the cookie: %+v", rec.Result().Cookies())
	}

	// And the cookie is enough for the guarded paths afterwards.
	req := httptest.NewRequest("GET", "/api/sessions", nil)
	req.AddCookie(cookie)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if !reached || rec.Code != http.StatusOK {
		t.Fatalf("the cookie did not get through: %d", rec.Code)
	}

	// Without it, still nothing.
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/sessions", nil))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("an unguarded request got %d", rec.Code)
	}
}

func TestTheNetworkIsOffUnlessAskedFor(t *testing.T) {
	t.Setenv("PLXR_HOME", t.TempDir())
	if RemoteWanted() {
		t.Fatalf("the network was on with nothing asking for it")
	}
	if got := bindAddress(); got != "127.0.0.1:0" {
		t.Fatalf("bound to %q with remote off", got)
	}
	if err := SetRemote(true); err != nil {
		t.Fatal(err)
	}
	if !RemoteWanted() || bindAddress() != ":0" {
		t.Fatalf("asked for the network and got %q", bindAddress())
	}
	if err := SetRemote(false); err != nil {
		t.Fatal(err)
	}
	if RemoteWanted() {
		t.Fatalf("switching it off did not take")
	}
}
