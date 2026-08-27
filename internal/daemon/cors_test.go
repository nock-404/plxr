package daemon

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// The window loads its page out of the app bundle, not from the daemon. Every
// call is therefore cross-origin with a preflight. Without an answer to that,
// nothing in the window works — and in the browser it does not show, because
// there page and daemon share the same origin. That is exactly how it slipped
// through once.
func TestPreflightIsAnswered(t *testing.T) {
	h := CORS(Guard("geheim", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("plxr"))
	})))

	for _, herkunft := range []string{"wails://wails", "http://wails.localhost"} {
		r := httptest.NewRequest("OPTIONS", "/api/sessions", nil)
		r.Header.Set("Origin", herkunft)
		r.Header.Set("Access-Control-Request-Method", "GET")
		r.Header.Set("Access-Control-Request-Headers", "x-plxr-token")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)

		if w.Code != http.StatusNoContent {
			t.Errorf("%s: preflight answered with %d, expected 204", herkunft, w.Code)
		}
		if got := w.Header().Get("Access-Control-Allow-Origin"); got != herkunft {
			t.Errorf("%s: Allow-Origin is %q", herkunft, got)
		}
		if got := w.Header().Get("Access-Control-Allow-Headers"); got == "" {
			t.Errorf("%s: without Allow-Headers the webview rejects the token", herkunft)
		}
	}
}

// The preflight may be answered without it opening the gate.
func TestPreflightDoesNotOpenTheDoor(t *testing.T) {
	h := CORS(Guard("geheim", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("a request without a token got through")
	})))

	r := httptest.NewRequest("GET", "/api/sessions", nil)
	r.Header.Set("Origin", "https://beliebige-seite.example")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Errorf("without a token %d came back, expected 403", w.Code)
	}
}

// Static files stay open — a <link> cannot send a header along.
func TestStaticFilesStayReachable(t *testing.T) {
	h := CORS(Guard("geheim", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("css"))
	})))
	r := httptest.NewRequest("GET", "/base.css", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Errorf("static file came back with %d", w.Code)
	}
}
