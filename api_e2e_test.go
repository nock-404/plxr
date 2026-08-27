package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"plxr/internal/core"
	"plxr/internal/daemon"
	"plxr/internal/server"
	"plxr/internal/session"
)

/* The test that was missing.

   The unit tests each check one function. What nobody checked was the chain:
   UI → HTTP → daemon. That is exactly where the bug sat that left nothing
   working in the window — the page comes out of the app bundle, so every call is
   cross-origin, and the daemon never answered the preflight. In the browser it
   did not show, because there page and daemon share the same origin.

   So this test sends the window's origin along on EVERY call. Whatever passes
   here also runs in the window. */

const herkunftFenster = "wails://wails"

func aufbauen(t *testing.T) (*httptest.Server, string) {
	t.Helper()
	heim := t.TempDir()
	t.Setenv("PLXR_HOME", heim)

	reg, err := session.NewRegistry(filepath.Join(heim, "sessions"))
	if err != nil {
		t.Fatal(err)
	}
	c := core.New(reg, sub("web/themes"), sub("web/agents"), sub("web/skins"))
	srv := server.New(c, sub("web"))

	token := "test-token"
	s := httptest.NewServer(daemon.CORS(daemon.Guard(token, srv.Routes())))
	t.Cleanup(s.Close)
	return s, token
}

func ruf(t *testing.T, s *httptest.Server, token, methode, path string, koerper string) (*http.Response, []byte) {
	t.Helper()
	var r io.Reader
	if koerper != "" {
		r = strings.NewReader(koerper)
	}
	req, err := http.NewRequest(methode, s.URL+path, r)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Origin", herkunftFenster)
	if token != "" {
		req.Header.Set("X-Plxr-Token", token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", methode, path, err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res, b
}

// Every call the UI makes has to work from inside the window — that is, with an
// origin and an allowed token header.
func TestEveryViewFromTheWindow(t *testing.T) {
	s, token := aufbauen(t)

	paths := []string{
		"/api/health", "/api/sessions", "/api/themes", "/api/vorlagen",
		"/api/accounts", "/api/archive", "/api/ports", "/api/usage",
		"/api/rules", "/api/hook", "/api/tempo", "/api/shell", "/api/paths",
	}
	for _, p := range paths {
		// The preflight first, which the webview sends because of the token header.
		req, _ := http.NewRequest("OPTIONS", s.URL+p, nil)
		req.Header.Set("Origin", herkunftFenster)
		req.Header.Set("Access-Control-Request-Method", "GET")
		req.Header.Set("Access-Control-Request-Headers", "x-plxr-token")
		vor, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s: preflight: %v", p, err)
		}
		vor.Body.Close()
		if vor.StatusCode != http.StatusNoContent {
			t.Errorf("%s: preflight rejected with %d", p, vor.StatusCode)
			continue
		}
		if vor.Header.Get("Access-Control-Allow-Origin") != herkunftFenster {
			t.Errorf("%s: preflight without Allow-Origin — the webview aborts", p)
			continue
		}

		res, _ := ruf(t, s, token, "GET", p, "")
		if res.StatusCode != http.StatusOK {
			t.Errorf("%s: %d", p, res.StatusCode)
		}
		if res.Header.Get("Access-Control-Allow-Origin") != herkunftFenster {
			t.Errorf("%s: response without Allow-Origin — the webview discards it", p)
		}
	}
}

// Create a session from the UI, see it, and end it again.
func TestSessionCreateListKill(t *testing.T) {
	s, token := aufbauen(t)

	res, b := ruf(t, s, token, "POST", "/api/sessions",
		`{"cwd":"`+t.TempDir()+`","cmd":["/bin/sh","-c","sleep 20"]}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("create: %d — %s", res.StatusCode, b)
	}
	var angelegt struct {
		ID    string `json:"id"`
		Alive bool   `json:"alive"`
	}
	if err := json.Unmarshal(b, &angelegt); err != nil {
		t.Fatal(err)
	}
	if angelegt.ID == "" || !angelegt.Alive {
		t.Fatalf("session did not come up: %s", b)
	}

	_, b = ruf(t, s, token, "GET", "/api/sessions", "")
	if !strings.Contains(string(b), angelegt.ID) {
		t.Error("the created session does not show up in the list")
	}

	res, _ = ruf(t, s, token, "DELETE", "/api/sessions/"+angelegt.ID, "")
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("terminate: %d", res.StatusCode)
	}

	// Terminating follows up: politely first, then firmly.
	frist := time.Now().Add(8 * time.Second)
	for time.Now().Before(frist) {
		_, b = ruf(t, s, token, "GET", "/api/sessions", "")
		var list []struct {
			ID    string `json:"id"`
			Alive bool   `json:"alive"`
		}
		json.Unmarshal(b, &list)
		tot := true
		for _, x := range list {
			if x.ID == angelegt.ID && x.Alive {
				tot = false
			}
		}
		if tot {
			return
		}
		time.Sleep(250 * time.Millisecond)
	}
	t.Error("session kept running after being terminated")
}

// Create and delete own themes; built-in ones stay protected.
func TestThemesCreateAndDelete(t *testing.T) {
	s, token := aufbauen(t)

	res, b := ruf(t, s, token, "POST", "/api/themes",
		`{"name":"probe","label":"Probe","skin":"crt","farben":{"accent":"#ff00ff"}}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("create: %d — %s", res.StatusCode, b)
	}

	_, b = ruf(t, s, token, "GET", "/api/themes", "")
	if !strings.Contains(string(b), `"probe"`) {
		t.Fatal("own theme missing from the list")
	}

	res, _ = ruf(t, s, token, "DELETE", "/api/themes/probe", "")
	if res.StatusCode != http.StatusNoContent {
		t.Errorf("delete: %d", res.StatusCode)
	}
	res, _ = ruf(t, s, token, "DELETE", "/api/themes/crt-amber", "")
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("built-in theme could be deleted: %d", res.StatusCode)
	}
}

// Nothing gets through without a token — not even with a valid origin.
func TestNothingWithoutToken(t *testing.T) {
	s, _ := aufbauen(t)
	for _, p := range []string{"/api/sessions", "/api/themes", "/api/ports"} {
		res, _ := ruf(t, s, "", "GET", p, "")
		if res.StatusCode != http.StatusForbidden {
			t.Errorf("%s without token: %d instead of 403", p, res.StatusCode)
		}
	}
}

// The UI itself has to come without a token: a <link> cannot send a header.
func TestUIServedWithoutToken(t *testing.T) {
	s, _ := aufbauen(t)
	for _, p := range []string{"/", "/app.js", "/ui.js", "/base.css", "/skins/crt/skin.css"} {
		res, b := ruf(t, s, "", "GET", p, "")
		if res.StatusCode != http.StatusOK {
			t.Errorf("%s: %d", p, res.StatusCode)
		}
		if len(b) == 0 {
			t.Errorf("%s: served empty", p)
		}
	}
}
