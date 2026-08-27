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

const windowOrigin = "wails://wails"

func setup(t *testing.T) (*httptest.Server, string) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("PLXR_HOME", home)

	reg, err := session.NewRegistry(filepath.Join(home, "sessions"))
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

func call(t *testing.T, s *httptest.Server, token, method, path string, body string) (*http.Response, []byte) {
	t.Helper()
	var r io.Reader
	if body != "" {
		r = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, s.URL+path, r)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Origin", windowOrigin)
	if token != "" {
		req.Header.Set("X-Plxr-Token", token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res, b
}

// Every call the UI makes has to work from inside the window — that is, with an
// origin and an allowed token header.
func TestEveryViewFromTheWindow(t *testing.T) {
	s, token := setup(t)

	paths := []string{
		"/api/health", "/api/sessions", "/api/themes", "/api/vorlagen",
		"/api/accounts", "/api/archive", "/api/ports", "/api/usage",
		"/api/rules", "/api/hook", "/api/tempo", "/api/shell", "/api/paths",
	}
	for _, p := range paths {
		// The preflight first, which the webview sends because of the token header.
		req, _ := http.NewRequest("OPTIONS", s.URL+p, nil)
		req.Header.Set("Origin", windowOrigin)
		req.Header.Set("Access-Control-Request-Method", "GET")
		req.Header.Set("Access-Control-Request-Headers", "x-plxr-token")
		preflight, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s: preflight: %v", p, err)
		}
		preflight.Body.Close()
		if preflight.StatusCode != http.StatusNoContent {
			t.Errorf("%s: preflight rejected with %d", p, preflight.StatusCode)
			continue
		}
		if preflight.Header.Get("Access-Control-Allow-Origin") != windowOrigin {
			t.Errorf("%s: preflight without Allow-Origin — the webview aborts", p)
			continue
		}

		res, _ := call(t, s, token, "GET", p, "")
		if res.StatusCode != http.StatusOK {
			t.Errorf("%s: %d", p, res.StatusCode)
		}
		if res.Header.Get("Access-Control-Allow-Origin") != windowOrigin {
			t.Errorf("%s: response without Allow-Origin — the webview discards it", p)
		}
	}
}

// Create a session from the UI, see it, and end it again.
func TestSessionCreateListKill(t *testing.T) {
	s, token := setup(t)

	res, b := call(t, s, token, "POST", "/api/sessions",
		`{"cwd":"`+t.TempDir()+`","cmd":["/bin/sh","-c","sleep 20"]}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("create: %d — %s", res.StatusCode, b)
	}
	var created struct {
		ID    string `json:"id"`
		Alive bool   `json:"alive"`
	}
	if err := json.Unmarshal(b, &created); err != nil {
		t.Fatal(err)
	}
	if created.ID == "" || !created.Alive {
		t.Fatalf("session did not come up: %s", b)
	}

	_, b = call(t, s, token, "GET", "/api/sessions", "")
	if !strings.Contains(string(b), created.ID) {
		t.Error("the created session does not show up in the list")
	}

	res, _ = call(t, s, token, "DELETE", "/api/sessions/"+created.ID, "")
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("terminate: %d", res.StatusCode)
	}

	waitDead(t, s, token, created.ID)
}

// waitDead waits until a terminated session really has ended.
//
// DELETE answers at once, but an interactive login shell ignores SIGTERM: only
// after the grace period does SIGKILL follow, and only then does the goroutine
// waiting on h.Done write the session's final state. Whoever returns before
// that has this write land in the temp directory the test framework is already
// removing — the test then fails during cleanup, in a different test, and for
// no visible reason.
func waitDead(t *testing.T, s *httptest.Server, token, id string) {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		_, b := call(t, s, token, "GET", "/api/sessions", "")
		var list []struct {
			ID    string `json:"id"`
			Alive bool   `json:"alive"`
		}
		json.Unmarshal(b, &list)
		alive := false
		for _, x := range list {
			if x.ID == id && x.Alive {
				alive = true
			}
		}
		if !alive {
			return
		}
		time.Sleep(250 * time.Millisecond)
	}
	t.Errorf("session %s kept running after being terminated", id)
}

// Create and delete own themes; built-in ones stay protected.
func TestThemesCreateAndDelete(t *testing.T) {
	s, token := setup(t)

	res, b := call(t, s, token, "POST", "/api/themes",
		`{"name":"probe","label":"Probe","skin":"crt","farben":{"accent":"#ff00ff"}}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("create: %d — %s", res.StatusCode, b)
	}

	_, b = call(t, s, token, "GET", "/api/themes", "")
	if !strings.Contains(string(b), `"probe"`) {
		t.Fatal("own theme missing from the list")
	}

	res, _ = call(t, s, token, "DELETE", "/api/themes/probe", "")
	if res.StatusCode != http.StatusNoContent {
		t.Errorf("delete: %d", res.StatusCode)
	}
	res, _ = call(t, s, token, "DELETE", "/api/themes/crt-amber", "")
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("built-in theme could be deleted: %d", res.StatusCode)
	}
}

// Nothing gets through without a token — not even with a valid origin.
func TestNothingWithoutToken(t *testing.T) {
	s, _ := setup(t)
	for _, p := range []string{"/api/sessions", "/api/themes", "/api/ports"} {
		res, _ := call(t, s, "", "GET", p, "")
		if res.StatusCode != http.StatusForbidden {
			t.Errorf("%s without token: %d instead of 403", p, res.StatusCode)
		}
	}
}

// The UI itself has to come without a token: a <link> cannot send a header.
func TestUIServedWithoutToken(t *testing.T) {
	s, _ := setup(t)
	for _, p := range []string{"/", "/app.js", "/ui.js", "/base.css", "/skins/crt/skin.css"} {
		res, b := call(t, s, "", "GET", p, "")
		if res.StatusCode != http.StatusOK {
			t.Errorf("%s: %d", p, res.StatusCode)
		}
		if len(b) == 0 {
			t.Errorf("%s: served empty", p)
		}
	}
}

/*
The emergency brake. Unlike terminating, nothing may be lost here: the

	session has to still be there afterwards and carry on where it stood.
*/
func TestFreezeAndUnfreeze(t *testing.T) {
	s, token := setup(t)

	res, b := call(t, s, token, "POST", "/api/sessions",
		`{"cwd":"`+t.TempDir()+`","cmd":["/bin/sh","-c","while :; do echo tick; sleep 0.2; done"]}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("create: %d — %s", res.StatusCode, b)
	}
	var created struct {
		ID string `json:"id"`
	}
	json.Unmarshal(b, &created)
	time.Sleep(600 * time.Millisecond)

	res, b = call(t, s, token, "POST", "/api/freeze", "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("freeze: %d — %s", res.StatusCode, b)
	}
	var frozen struct {
		Frozen   int `json:"eingefroren"`
		Affected int `json:"betroffen"`
	}
	json.Unmarshal(b, &frozen)
	if frozen.Frozen < 1 || frozen.Frozen != frozen.Affected {
		t.Fatalf("froze %d of %d", frozen.Frozen, frozen.Affected)
	}

	// The session has to still be alive — frozen is not dead.
	_, b = call(t, s, token, "GET", "/api/sessions", "")
	if !strings.Contains(string(b), `"eingefroren":true`) {
		t.Error("the snapshot does not report the session as frozen")
	}
	if !strings.Contains(string(b), `"alive":true`) {
		t.Error("a frozen session must not count as ended")
	}

	res, b = call(t, s, token, "POST", "/api/unfreeze", "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unfreeze: %d — %s", res.StatusCode, b)
	}
	if !strings.Contains(string(b), `"fortgesetzt":1`) {
		t.Errorf("unfreeze reported: %s", b)
	}
	call(t, s, token, "DELETE", "/api/sessions/"+created.ID, "")
	waitDead(t, s, token, created.ID)
}
