// Package server ist der HTTP-Transport über dem Kern.
//
// Für die Desktop-App braucht man ihn nicht — dort redet die Oberfläche direkt
// über Wails-Bindungen mit dem Kern. Er bleibt, weil sich die Oberfläche im
// normalen Browser bequemer entwickeln und debuggen lässt: `plxr --serve`.
package server

import (
	"encoding/json"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"plxr/internal/core"
	"plxr/internal/shell"

	"github.com/gorilla/websocket"
)

type Server struct {
	c   *core.Core
	web fs.FS
	up  websocket.Upgrader
}

func New(c *core.Core, web fs.FS) *Server {
	return &Server{
		c: c, web: web,
		// Nur localhost, deshalb reicht eine offene Herkunftsprüfung.
		up: websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }},
	}
}

func (s *Server) Routes() *http.ServeMux {
	mux := http.NewServeMux()
	// Kurze Kennung, damit ein Client einen fremden Prozess auf demselben Port
	// nicht für den Daemon hält.
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("plxr"))
	})
	mux.HandleFunc("GET /api/sessions", s.listSessions)
	mux.HandleFunc("POST /api/sessions", s.createSession)
	mux.HandleFunc("DELETE /api/sessions/{id}", s.killSession)
	mux.HandleFunc("POST /api/sessions/{id}/antwort", func(w http.ResponseWriter, r *http.Request) {
		b, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := s.c.Antworten(r.PathValue("id"), string(b)); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /api/shell", func(w http.ResponseWriter, r *http.Request) {
		cmd := shell.Standard()
		writeJSON(w, map[string]any{"cmd": cmd, "name": shell.Name(cmd)})
	})
	mux.HandleFunc("GET /api/agents", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, s.c.Agents()) })
	mux.HandleFunc("GET /api/themes", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, s.c.Themes()) })
	mux.HandleFunc("POST /api/themes", s.importTheme)
	mux.HandleFunc("GET /api/accounts", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, s.c.Accounts()) })
	mux.HandleFunc("GET /api/archive", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.c.Archive(r.URL.Query().Get("path")))
	})
	mux.HandleFunc("GET /api/search", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		writeJSON(w, s.c.Suche(q.Get("q"), q.Get("nur") == "eigene"))
	})
	mux.HandleFunc("DELETE /api/archive/{id}", s.archiveDelete)
	mux.HandleFunc("POST /api/archive/{id}/resume", s.archiveResume)
	mux.HandleFunc("POST /api/sessions/{id}/account", s.switchAccount)
	mux.HandleFunc("POST /api/sessions/{id}/resume", func(w http.ResponseWriter, r *http.Request) {
		sess, err := s.c.Wiederaufnehmen(r.PathValue("id"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, sess)
	})
	mux.HandleFunc("GET /api/rules", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		writeJSON(w, s.c.Rules(q.Get("session"), q.Get("dir")))
	})
	mux.HandleFunc("GET /api/hook", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.c.HookStand())
	})
	mux.HandleFunc("POST /api/hook", func(w http.ResponseWriter, r *http.Request) {
		if err := s.c.HookSetzen(r.URL.Query().Get("an") == "1"); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, s.c.HookStand())
	})
	mux.HandleFunc("GET /api/version", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.c.VersionStand())
	})
	mux.HandleFunc("POST /api/update", func(w http.ResponseWriter, r *http.Request) {
		if err := s.c.Update(); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, s.c.UpdateFortschritt())
	})
	mux.HandleFunc("GET /api/update", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.c.UpdateFortschritt())
	})
	mux.HandleFunc("POST /api/restart", func(w http.ResponseWriter, r *http.Request) {
		if err := s.c.NeuStarten(); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		// Kurz warten, damit die Antwort noch rausgeht, dann Platz machen.
		go func() { time.Sleep(700 * time.Millisecond); os.Exit(0) }()
	})
	mux.HandleFunc("GET /api/usage", func(w http.ResponseWriter, r *http.Request) {
		tage, _ := strconv.Atoi(r.URL.Query().Get("tage"))
		writeJSON(w, s.c.Verbrauch(tage))
	})
	mux.HandleFunc("GET /api/tempo", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.c.Tempo())
	})
	mux.HandleFunc("GET /api/ports", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, s.c.Ports()) })
	mux.HandleFunc("DELETE /api/ports/{pid}", s.killPort)
	mux.HandleFunc("GET /api/files/{id}", s.listDir)
	mux.HandleFunc("GET /api/paths", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.c.Vorschlaege(r.URL.Query().Get("q")))
	})
	mux.HandleFunc("GET /api/file/{id}", s.readFile)
	mux.HandleFunc("PUT /api/file/{id}", s.writeFile)
	mux.HandleFunc("GET /ws/tiles", s.wsTiles)
	mux.HandleFunc("GET /ws/session/{id}", s.wsSession)
	mux.Handle("GET /", http.FileServer(http.FS(s.web)))
	return mux
}

type createReq struct {
	Cwd     string   `json:"cwd"`
	Cmd     []string `json:"cmd"`
	Name    string   `json:"name"`
	Account string   `json:"account"`
}

func (s *Server) createSession(w http.ResponseWriter, r *http.Request) {
	var req createReq
	if json.NewDecoder(r.Body).Decode(&req) != nil {
		http.Error(w, "kaputtes JSON", http.StatusBadRequest)
		return
	}
	sess, err := s.c.Create(req.Cwd, req.Cmd, req.Name, req.Account)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, sess)
}

func (s *Server) listSessions(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.c.Snapshot(r.URL.Query().Get("path")))
}

func (s *Server) killSession(w http.ResponseWriter, r *http.Request) {
	s.c.Kill(r.PathValue("id"), r.URL.Query().Get("purge") == "1")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) archiveDelete(w http.ResponseWriter, r *http.Request) {
	if err := s.c.ArchiveDelete(r.PathValue("id"), r.URL.Query().Get("account")); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) archiveResume(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	sess, err := s.c.Resume(r.PathValue("id"), q.Get("account"), q.Get("target"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, sess)
}

func (s *Server) switchAccount(w http.ResponseWriter, r *http.Request) {
	sess, err := s.c.SwitchAccount(r.PathValue("id"), r.URL.Query().Get("target"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, sess)
}

func (s *Server) killPort(w http.ResponseWriter, r *http.Request) {
	pid, err := strconv.Atoi(r.PathValue("pid"))
	if err != nil {
		http.Error(w, "keine gültige Prozess-ID", http.StatusBadRequest)
		return
	}
	if err := s.c.KillPort(pid, r.URL.Query().Get("hart") == "1"); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) importTheme(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	t, err := s.c.ImportTheme(raw)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, t)
}

func (s *Server) listDir(w http.ResponseWriter, r *http.Request) {
	out, err := s.c.ListDir(r.PathValue("id"), r.URL.Query().Get("dir"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, out)
}

type schreibReq struct {
	Path string `json:"path"`
	Text string `json:"text"`
	Mod  int64  `json:"mod"`
}

func (s *Server) writeFile(w http.ResponseWriter, r *http.Request) {
	var req schreibReq
	if json.NewDecoder(io.LimitReader(r.Body, 8<<20)).Decode(&req) != nil {
		http.Error(w, "kaputtes JSON", http.StatusBadRequest)
		return
	}
	out, err := s.c.WriteFile(r.PathValue("id"), req.Path, req.Text, req.Mod)
	if err != nil {
		// Ein Ausbruchsversuch ist kein Konflikt: die Unterscheidung gehört in
		// den Statuscode, sonst sieht ein Angriff aus wie ein Bedienfehler.
		code := http.StatusBadRequest
		switch {
		case strings.Contains(err.Error(), "außerhalb der Session"):
			code = http.StatusForbidden
		case strings.Contains(err.Error(), "inzwischen von außen geändert"):
			code = http.StatusConflict
		}
		http.Error(w, err.Error(), code)
		return
	}
	writeJSON(w, out)
}

func (s *Server) readFile(w http.ResponseWriter, r *http.Request) {
	out, err := s.c.ReadFile(r.PathValue("id"), r.URL.Query().Get("path"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, out)
}

// wsTiles schiebt einmal pro Sekunde den Gesamtzustand raus.
func (s *Server) wsTiles(w http.ResponseWriter, r *http.Request) {
	c, err := s.up.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer c.Close()

	pathFilter := r.URL.Query().Get("path")
	go func() {
		for {
			if _, _, err := c.ReadMessage(); err != nil {
				c.Close()
				return
			}
		}
	}()

	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		if err := c.WriteJSON(s.c.Snapshot(pathFilter)); err != nil {
			return
		}
		<-tick.C
	}
}

type inMsg struct {
	Type string `json:"type"` // "in" | "resize"
	Data string `json:"data"`
	Rows uint16 `json:"rows"`
	Cols uint16 `json:"cols"`
}

// wsSession ist das echte Terminal: Ausgabe raus, Tasten rein.
func (s *Server) wsSession(w http.ResponseWriter, r *http.Request) {
	h := s.c.Host(r.PathValue("id"))
	if h == nil {
		http.Error(w, "keine laufende Session", http.StatusNotFound)
		return
	}
	c, err := s.up.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer c.Close()

	// Scrollback zuerst, damit der Client nicht auf leerem Schirm sitzt.
	if snap := h.Snapshot(); len(snap) > 0 {
		c.WriteMessage(websocket.BinaryMessage, snap)
	}

	sub := h.Subscribe()
	defer h.Unsubscribe(sub)

	go func() {
		for {
			_, data, err := c.ReadMessage()
			if err != nil {
				c.Close()
				return
			}
			var m inMsg
			if json.Unmarshal(data, &m) != nil {
				continue
			}
			switch m.Type {
			case "in":
				h.Write([]byte(m.Data))
			case "resize":
				if m.Rows > 0 && m.Cols > 0 {
					h.Resize(m.Rows, m.Cols)
				}
			}
		}
	}()

	for chunk := range sub {
		if err := c.WriteMessage(websocket.BinaryMessage, chunk); err != nil {
			return
		}
	}
	c.WriteMessage(websocket.TextMessage, []byte("\r\n[plxr] Prozess beendet.\r\n"))
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Println("json:", err)
	}
}
