package daemon

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
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
	if err := SetRemote(true); err != nil {
		t.Fatal(err)
	}
	if !RemoteWanted() {
		t.Fatal("asking for the network did not take")
	}
	if err := SetRemote(false); err != nil {
		t.Fatal(err)
	}
	if RemoteWanted() {
		t.Fatalf("switching it off did not take")
	}
}

/* The switch has to work while plxr runs, in both directions.
 *
 * It used to be read once, when the listener was made, and the window said it
 * would take effect at the next start of plxr. It could not: quitting the
 * window leaves the daemon running on purpose, and the next start hands the
 * same one back — so the switch could be turned on and nothing ever happened.
 * The other direction was worse: turned off, the daemon that had been started
 * with the network listener kept it and kept letting the network in, while the
 * window said OFF.
 */
func TestTheDoorOpensAndClosesWhileItRuns(t *testing.T) {
	if len(Addresses()) == 0 {
		t.Skip("this machine has no address on a network")
	}
	served := make(chan struct{}, 8)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close() // only wanted for the number

	door := NewDoor(port, func(l net.Listener) {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			served <- struct{}{}
			c.Close()
		}
	})
	if door.Live() {
		t.Fatal("the door reports itself open before it was opened")
	}

	if err := door.Open(); err != nil {
		t.Skipf("no address could be bound here: %v", err)
	}
	if !door.Live() {
		t.Fatal("the door was opened and does not say so")
	}
	at := net.JoinHostPort(Addresses()[0], strconv.Itoa(port))
	c, err := net.DialTimeout("tcp", at, 2*time.Second)
	if err != nil {
		t.Fatalf("the open door refused a connection from the network: %v", err)
	}
	c.Close()
	select {
	case <-served:
	case <-time.After(2 * time.Second):
		t.Fatal("nothing was served through the open door")
	}

	door.Close()
	if door.Live() {
		t.Fatal("the door was closed and still says it is open")
	}
	if c, err := net.DialTimeout("tcp", at, 2*time.Second); err == nil {
		c.Close()
		t.Fatal("the network still gets in after the door was closed")
	}
}

// The --browser path must not put the token where other processes and the
// browser history can keep it: it opens a one-time /join code instead. This
// checks the shape the code relies on — a fresh code is single use.
func TestBrowserUsesASingleUseCode(t *testing.T) {
	t.Setenv("PLXR_HOME", t.TempDir())
	code, until := NewCode()
	if code == "" || !until.After(timeZero()) {
		t.Fatalf("no usable code: %q", code)
	}
	if !TakeCode(code) {
		t.Fatal("a fresh code was refused")
	}
	if TakeCode(code) {
		t.Fatal("the code was accepted a second time — it is not single use")
	}
}

func timeZero() time.Time { return time.Now().Add(-time.Second) }
