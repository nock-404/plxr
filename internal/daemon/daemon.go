// Package daemon separates the process that holds the terminals from the one
// anzeigt.
//
// That is the heart of it: as long as the PTYs are children of the window,
// closing it takes everything down. The daemon keeps running on its own, the
// window is just a client — and there may be several of them.
//
// Communication runs over HTTP/WebSocket on 127.0.0.1 with a random port. A Unix
// socket would be nicer, but it cannot carry a WebSocket out of a webview and
// does not exist in that form on Windows. A token guards against foreign access:
// the port is reachable only locally, but otherwise any local process could join
// the conversation.
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

// Info is what sits in ~/.plxr/daemon.json.
type Info struct {
	Port  int    `json:"port"`
	Token string `json:"token"`
	PID   int    `json:"pid"`
	Since int64  `json:"since"`
}

func (i Info) URL() string { return fmt.Sprintf("http://127.0.0.1:%d", i.Port) }

// Root is the directory plxr stores its state in.
//
// Redirectable through PLXR_HOME. That is not a luxury: without it a development
// build and an installation share the same daemon and the same file with port
// and token — one ends the other's session, and you end up hunting bugs in files
// that are not the ones being served.
func Root() string {
	if d := os.Getenv("PLXR_HOME"); d != "" {
		return d
	}
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

// Listen opens a port only this machine can reach and leaves the credentials
// behind for clients.
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
	if err := os.WriteFile(tmp, b, 0o600); err != nil { // 0600: contains the token
		return err
	}
	return os.Rename(tmp, infoPath())
}

func Forget() { os.Remove(infoPath()) }

// Guard protects everything that serves data or touches processes.
//
// The UI itself — HTML, CSS, fonts, xterm.js — stays open. Not out of
// convenience: a <link rel="stylesheet"> cannot send a header along, and the
// files contain nothing worth protecting. Everything under /api and /ws, by
// contrast, needs the token.
/* CORS is what makes the window able to work at all.

   The Wails page is not served by the daemon but comes out of the app bundle —
   its origin reads "wails://wails" or "http://wails.localhost". Every fetch to
   the daemon is therefore a cross-origin call, and because we send the token in
   a header of our own, the webview sends an OPTIONS first. Without an answer to
   that, EVERY call from the window fails — the UI stayed empty and only reported
   "connection lost". In the browser it never showed: there it is the same origin.

   The origin is reflected back rather than set to "*", and the token remains the
   actual safeguard: the daemon listens on 127.0.0.1 only, and without a valid
   token every request comes back with 403. */
func CORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if o := r.Header.Get("Origin"); o != "" {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", o)
			h.Add("Vary", "Origin")
			h.Set("Access-Control-Allow-Headers", "X-Plxr-Token, Content-Type")
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			h.Set("Access-Control-Max-Age", "600")
		}
		// The preflight never carries a token — browsers never send custom headers
		// on OPTIONS. It therefore has to be answered before the token check,
		// otherwise it stays at 403.
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

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
			// WebSockets cannot set headers of their own.
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

// alive checks whether our daemon really sits behind the recorded details.
// Pinging the port alone is not enough — after a crash another program may long
// since have taken it.
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

// Ensure returns a running daemon: either the existing one or a
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
	detach(cmd) // a process group of its own, so it outlives the window
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
