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

/* Der Test, der gefehlt hat.

   Die Einzeltests prüfen je eine Funktion. Was niemand geprüft hat, war die
   Kette: Oberfläche → HTTP → Daemon. Genau dort saß der Fehler, an dem im
   Fenster gar nichts mehr ging — die Seite kommt aus dem App-Bündel, also ist
   jeder Aufruf Cross-Origin, und der Daemon hat den Vorabflug nie beantwortet.
   Im Browser fiel das nicht auf, weil dort Seite und Daemon dieselbe Herkunft
   haben.

   Deshalb schickt dieser Test bei JEDEM Aufruf die Herkunft des Fensters mit.
   Was hier durchläuft, läuft auch im Fenster. */

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

// Jeder Aufruf, den die Oberfläche macht, muss aus dem Fenster heraus gehen —
// also mit Herkunft und erlaubter Token-Kopfzeile.
func TestAlleAnsichtenAusDemFenster(t *testing.T) {
	s, token := aufbauen(t)

	paths := []string{
		"/api/health", "/api/sessions", "/api/themes", "/api/vorlagen",
		"/api/accounts", "/api/archive", "/api/ports", "/api/usage",
		"/api/rules", "/api/hook", "/api/tempo", "/api/shell", "/api/paths",
	}
	for _, p := range paths {
		// Erst der Vorabflug, den die Webview wegen der Token-Kopfzeile schickt.
		req, _ := http.NewRequest("OPTIONS", s.URL+p, nil)
		req.Header.Set("Origin", herkunftFenster)
		req.Header.Set("Access-Control-Request-Method", "GET")
		req.Header.Set("Access-Control-Request-Headers", "x-plxr-token")
		vor, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s: Vorabflug: %v", p, err)
		}
		vor.Body.Close()
		if vor.StatusCode != http.StatusNoContent {
			t.Errorf("%s: Vorabflug mit %d abgelehnt", p, vor.StatusCode)
			continue
		}
		if vor.Header.Get("Access-Control-Allow-Origin") != herkunftFenster {
			t.Errorf("%s: Vorabflug ohne Allow-Origin — die Webview bricht ab", p)
			continue
		}

		res, _ := ruf(t, s, token, "GET", p, "")
		if res.StatusCode != http.StatusOK {
			t.Errorf("%s: %d", p, res.StatusCode)
		}
		if res.Header.Get("Access-Control-Allow-Origin") != herkunftFenster {
			t.Errorf("%s: Antwort ohne Allow-Origin — die Webview verwirft sie", p)
		}
	}
}

// Eine Session von der Oberfläche aus anlegen, sehen und wieder beenden.
func TestSessionAnlegenSehenBeenden(t *testing.T) {
	s, token := aufbauen(t)

	res, b := ruf(t, s, token, "POST", "/api/sessions",
		`{"cwd":"`+t.TempDir()+`","cmd":["/bin/sh","-c","sleep 20"]}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("anlegen: %d — %s", res.StatusCode, b)
	}
	var angelegt struct {
		ID    string `json:"id"`
		Alive bool   `json:"alive"`
	}
	if err := json.Unmarshal(b, &angelegt); err != nil {
		t.Fatal(err)
	}
	if angelegt.ID == "" || !angelegt.Alive {
		t.Fatalf("Session kam nicht hoch: %s", b)
	}

	_, b = ruf(t, s, token, "GET", "/api/sessions", "")
	if !strings.Contains(string(b), angelegt.ID) {
		t.Error("die angelegte Session taucht in der Liste nicht auf")
	}

	res, _ = ruf(t, s, token, "DELETE", "/api/sessions/"+angelegt.ID, "")
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("beenden: %d", res.StatusCode)
	}

	// Beenden fasst nach: erst freundlich, dann bestimmt.
	frist := time.Now().Add(8 * time.Second)
	for time.Now().Before(frist) {
		_, b = ruf(t, s, token, "GET", "/api/sessions", "")
		var liste []struct {
			ID    string `json:"id"`
			Alive bool   `json:"alive"`
		}
		json.Unmarshal(b, &liste)
		tot := true
		for _, x := range liste {
			if x.ID == angelegt.ID && x.Alive {
				tot = false
			}
		}
		if tot {
			return
		}
		time.Sleep(250 * time.Millisecond)
	}
	t.Error("Session lief nach dem Beenden weiter")
}

// Eigene Themes anlegen und löschen, eingebaute bleiben geschützt.
func TestThemesAnlegenUndLoeschen(t *testing.T) {
	s, token := aufbauen(t)

	res, b := ruf(t, s, token, "POST", "/api/themes",
		`{"name":"probe","label":"Probe","skin":"crt","farben":{"accent":"#ff00ff"}}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("anlegen: %d — %s", res.StatusCode, b)
	}

	_, b = ruf(t, s, token, "GET", "/api/themes", "")
	if !strings.Contains(string(b), `"probe"`) {
		t.Fatal("eigenes Theme fehlt in der Liste")
	}

	res, _ = ruf(t, s, token, "DELETE", "/api/themes/probe", "")
	if res.StatusCode != http.StatusNoContent {
		t.Errorf("löschen: %d", res.StatusCode)
	}
	res, _ = ruf(t, s, token, "DELETE", "/api/themes/crt-amber", "")
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("eingebautes Theme ließ sich löschen: %d", res.StatusCode)
	}
}

// Ohne Token kommt nichts durch — auch nicht mit gültiger Herkunft.
func TestOhneTokenNichts(t *testing.T) {
	s, _ := aufbauen(t)
	for _, p := range []string{"/api/sessions", "/api/themes", "/api/ports"} {
		res, _ := ruf(t, s, "", "GET", p, "")
		if res.StatusCode != http.StatusForbidden {
			t.Errorf("%s ohne Token: %d statt 403", p, res.StatusCode)
		}
	}
}

// Die Oberfläche selbst muss ohne Token kommen: ein <link> kann keine
// Kopfzeile mitschicken.
func TestOberflaecheOhneTokenAusgeliefert(t *testing.T) {
	s, _ := aufbauen(t)
	for _, p := range []string{"/", "/app.js", "/ui.js", "/base.css", "/skins/crt/skin.css"} {
		res, b := ruf(t, s, "", "GET", p, "")
		if res.StatusCode != http.StatusOK {
			t.Errorf("%s: %d", p, res.StatusCode)
		}
		if len(b) == 0 {
			t.Errorf("%s: leer ausgeliefert", p)
		}
	}
}
