package daemon

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

/*
Das Fenster lädt seine Seite aus dem App-Bündel, nicht vom Daemon. Jeder

	Aufruf ist deshalb Cross-Origin mit Vorabflug. Fehlt die Antwort darauf,
	geht im Fenster gar nichts — und im Browser fällt es nicht auf, weil dort
	Seite und Daemon dieselbe Herkunft haben. Genau so ist es einmal
	durchgerutscht.
*/
func TestVorabflugWirdBeantwortet(t *testing.T) {
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
			t.Errorf("%s: Vorabflug mit %d beantwortet, erwartet 204", herkunft, w.Code)
		}
		if got := w.Header().Get("Access-Control-Allow-Origin"); got != herkunft {
			t.Errorf("%s: Allow-Origin ist %q", herkunft, got)
		}
		if got := w.Header().Get("Access-Control-Allow-Headers"); got == "" {
			t.Errorf("%s: ohne Allow-Headers lehnt die Webview das Token ab", herkunft)
		}
	}
}

// Der Vorabflug darf beantwortet werden, ohne dass er das Tor öffnet.
func TestVorabflugOeffnetNichtDieTuer(t *testing.T) {
	h := CORS(Guard("geheim", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("Anfrage ohne Token ist durchgekommen")
	})))

	r := httptest.NewRequest("GET", "/api/sessions", nil)
	r.Header.Set("Origin", "https://beliebige-seite.example")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Errorf("ohne Token kam %d zurück, erwartet 403", w.Code)
	}
}

// Statische Dateien bleiben offen — ein <link> kann keine Kopfzeile mitschicken.
func TestStatischesBleibtErreichbar(t *testing.T) {
	h := CORS(Guard("geheim", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("css"))
	})))
	r := httptest.NewRequest("GET", "/base.css", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Errorf("statische Datei kam mit %d zurück", w.Code)
	}
}
