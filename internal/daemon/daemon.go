// Package daemon trennt den Prozess, der die Terminals hält, von dem, der sie
// anzeigt.
//
// Das ist der Kern der Sache: solange die PTYs Kinder des Fensters sind,
// stirbt beim Schließen alles mit. Der Daemon läuft eigenständig weiter, das
// Fenster ist nur ein Client — und es dürfen mehrere sein.
//
// Kommuniziert wird über HTTP/WebSocket auf 127.0.0.1 mit zufälligem Port.
// Ein Unix-Socket wäre schöner, kann aber kein WebSocket aus einer Webview
// und existiert auf Windows so nicht. Gegen fremden Zugriff schützt ein
// Token: der Port ist nur lokal erreichbar, aber jeder lokale Prozess könnte
// sonst mitreden.
package daemon

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Info ist das, was in ~/.plxr/daemon.json steht.
type Info struct {
	Port  int    `json:"port"`
	Token string `json:"token"`
	PID   int    `json:"pid"`
	Since int64  `json:"since"`
}

func (i Info) URL() string { return fmt.Sprintf("http://127.0.0.1:%d", i.Port) }

func Root() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".plxr")
}

func infoPath() string { return filepath.Join(Root(), "daemon.json") }

func newToken() string {
	b := make([]byte, 24)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// ---- Seite des Daemons ----

// Listen öffnet einen Port, den nur diese Maschine erreicht, und hinterlegt
// die Zugangsdaten für Clients.
func Listen() (net.Listener, Info, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, Info{}, err
	}
	info := Info{
		Port:  ln.Addr().(*net.TCPAddr).Port,
		Token: newToken(),
		PID:   os.Getpid(),
		Since: time.Now().UnixMilli(),
	}
	if err := write(info); err != nil {
		ln.Close()
		return nil, Info{}, err
	}
	return ln, info, nil
}

func write(i Info) error {
	if err := os.MkdirAll(Root(), 0o755); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(i, "", "  ")
	tmp := infoPath() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil { // 0600: enthält das Token
		return err
	}
	return os.Rename(tmp, infoPath())
}

func Forget() { os.Remove(infoPath()) }

// Guard schützt alles, was Daten liefert oder Prozesse anfasst.
//
// Die Oberfläche selbst — HTML, CSS, Schriften, xterm.js — bleibt offen. Nicht
// aus Bequemlichkeit: ein <link rel="stylesheet"> kann keinen Header
// mitschicken, und die Dateien enthalten nichts, was schützenswert wäre. Alles
// unter /api und /ws braucht dagegen das Token.
func Guard(token string, next http.Handler) http.Handler {
	want := []byte(token)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if !strings.HasPrefix(p, "/api/") && !strings.HasPrefix(p, "/ws/") {
			next.ServeHTTP(w, r)
			return
		}
		got := r.Header.Get("X-Plxr-Token")
		if got == "" {
			// WebSockets können keine eigenen Header setzen.
			got = r.URL.Query().Get("token")
		}
		if subtle.ConstantTimeCompare([]byte(got), want) != 1 {
			http.Error(w, "kein gültiges Token", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ---- Seite des Clients ----

func Read() (Info, error) {
	b, err := os.ReadFile(infoPath())
	if err != nil {
		return Info{}, err
	}
	var i Info
	if err := json.Unmarshal(b, &i); err != nil {
		return Info{}, err
	}
	if i.Port == 0 || i.Token == "" {
		return Info{}, errors.New("daemon.json ist unvollständig")
	}
	return i, nil
}

// alive prüft, ob hinter den hinterlegten Daten wirklich unser Daemon sitzt.
// Nur den Port anzupingen reicht nicht — nach einem Absturz kann ihn längst
// ein anderes Programm belegen.
func alive(i Info) bool {
	req, err := http.NewRequest("GET", i.URL()+"/api/health", nil)
	if err != nil {
		return false
	}
	req.Header.Set("X-Plxr-Token", i.Token)
	c := &http.Client{Timeout: 900 * time.Millisecond}
	res, err := c.Do(req)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return false
	}
	buf := make([]byte, 16)
	n, _ := res.Body.Read(buf)
	return strings.HasPrefix(string(buf[:n]), "plxr")
}

// Ensure liefert einen laufenden Daemon: entweder den vorhandenen oder einen
// frisch gestarteten.
func Ensure() (Info, error) {
	if i, err := Read(); err == nil && alive(i) {
		return i, nil
	}

	exe, err := os.Executable()
	if err != nil {
		return Info{}, err
	}
	cmd := exec.Command(exe, "daemon")
	cmd.Stdout, cmd.Stderr = nil, nil
	detach(cmd) // eigene Prozessgruppe, damit er das Fenster überlebt
	if err := cmd.Start(); err != nil {
		return Info{}, err
	}
	_ = cmd.Process.Release()

	// Der Daemon schreibt daemon.json erst, wenn er wirklich lauscht.
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if i, err := Read(); err == nil && i.PID != 0 && alive(i) {
			return i, nil
		}
		time.Sleep(120 * time.Millisecond)
	}
	return Info{}, errors.New("Daemon ist nicht hochgekommen")
}
