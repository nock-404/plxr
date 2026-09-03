// Package server is the HTTP transport on top of the core.
//
// The desktop app does not strictly need it — there the UI talks to the core
// through Wails bindings. It stays because the UI is more comfortable to build
// and debug in an ordinary browser: `plxr --serve`.
package server

import (
	"encoding/json"
	"io"
	"io/fs"
	"log"
	"net/http"
	"plxr/internal/theme"
	"reflect"
	"strconv"
	"strings"
	"time"

	"plxr/internal/accounts"
	"plxr/internal/core"
	"plxr/internal/daemon"
	"plxr/internal/notify"
	"plxr/internal/queue"
	"plxr/internal/shell"
	"plxr/internal/uierr"

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
		// localhost only, so an open origin check is good enough.
		up: websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }},
	}
}

func (s *Server) Routes() *http.ServeMux {
	mux := http.NewServeMux()
	// A short marker, so a client does not mistake some other process on the same
	// port for the daemon.
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("plxr"))
	})
	mux.HandleFunc("GET /api/sessions", s.listSessions)
	mux.HandleFunc("POST /api/sessions", s.createSession)
	mux.HandleFunc("DELETE /api/sessions/{id}", s.killSession)
	mux.HandleFunc("POST /api/sessions/{id}/reply", func(w http.ResponseWriter, r *http.Request) {
		b, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := s.c.Answer(r.PathValue("id"), string(b), r.URL.Query().Get("raw") == "1"); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /api/shell", func(w http.ResponseWriter, r *http.Request) {
		cmd := shell.Default()
		writeJSON(w, map[string]any{"cmd": cmd, "name": shell.Name(cmd)})
	})
	mux.HandleFunc("GET /api/themes", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, s.c.Themes()) })
	mux.HandleFunc("POST /api/themes", s.importTheme)
	mux.HandleFunc("DELETE /api/themes/{name}", func(w http.ResponseWriter, r *http.Request) {
		if err := s.c.ThemeDelete(r.PathValue("name")); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /api/templates", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.c.Templates())
	})
	mux.HandleFunc("POST /api/templates/{name}/start", func(w http.ResponseWriter, r *http.Request) {
		ids, err := s.c.TemplateStart(r.PathValue("name"))
		if err != nil && len(ids) == 0 {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		answer := map[string]any{"ids": ids}
		if err != nil {
			answer["partial"] = err.Error()
		}
		writeJSON(w, answer)
	})
	mux.HandleFunc("POST /api/templates", func(w http.ResponseWriter, r *http.Request) {
		var req struct{ Name, Label string }
		if json.NewDecoder(io.LimitReader(r.Body, 8<<10)).Decode(&req) != nil {
			http.Error(w, uierr.New("err.badJSON").Error(), http.StatusBadRequest)
			return
		}
		if err := s.c.TemplateFromState(req.Name, req.Label); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, s.c.Templates())
	})
	mux.HandleFunc("DELETE /api/templates/{name}", func(w http.ResponseWriter, r *http.Request) {
		if err := s.c.TemplateDelete(r.PathValue("name")); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /api/accounts", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, s.c.Accounts()) })
	mux.HandleFunc("POST /api/accounts", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Dir   string `json:"dir"`
			Label string `json:"label"`
		}
		if json.NewDecoder(r.Body).Decode(&in) != nil {
			http.Error(w, uierr.New("err.badJSON").Error(), http.StatusBadRequest)
			return
		}
		list, err := accounts.Add(in.Dir, in.Label)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, list)
	})
	mux.HandleFunc("PATCH /api/accounts/{name}", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Label string `json:"label"`
		}
		if json.NewDecoder(r.Body).Decode(&in) != nil {
			http.Error(w, uierr.New("err.badJSON").Error(), http.StatusBadRequest)
			return
		}
		list, err := accounts.Rename(r.PathValue("name"), in.Label)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, list)
	})
	mux.HandleFunc("DELETE /api/accounts/{name}", func(w http.ResponseWriter, r *http.Request) {
		list, err := accounts.Remove(r.PathValue("name"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, list)
	})
	mux.HandleFunc("GET /api/archive", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.c.Archive(r.URL.Query().Get("path")))
	})
	/* Playback streams the raw recording. Deliberately not JSON: the bytes are a
	   terminal stream and would triple in size base64-encoded. The timeline goes
	   into headers instead, so the body stays exactly what went over the wire. */
	mux.HandleFunc("GET /api/playback/{id}", func(w http.ResponseWriter, r *http.Request) {
		from, _ := strconv.ParseInt(r.URL.Query().Get("from"), 10, 64)
		pb, err := s.c.Playback(r.PathValue("id"), from)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		h := w.Header()
		h.Set("Content-Type", "application/octet-stream")
		h.Set("X-Plxr-Size", strconv.FormatInt(pb.Size, 10))
		h.Set("X-Plxr-From", strconv.FormatInt(pb.From, 10))
		h.Set("X-Plxr-Cut", strconv.FormatBool(pb.Cut))
		// Without this the webview cannot read those headers: on a cross-origin
		// request only the handful of simple ones are visible by default.
		h.Set("Access-Control-Expose-Headers", "X-Plxr-Size, X-Plxr-From, X-Plxr-Cut")
		w.Write(pb.Data)
	})
	/* The timeline, separate from the stream.

	   It used to sit in a header. That worked for short sessions and breaks
	   from half an hour on: Chromium caps headers at around 256 KB, and half an
	   hour already yields 571 KB. Worse than the bug would have been how it
	   arrives — the UI reads a failed fetch as "daemon gone" and runs into the
	   reconnect loop.

	   Separating them has a second benefit: the stream is fetched in chunks,
	   the timeline only once. */
	mux.HandleFunc("GET /api/playback/{id}/timeline", func(w http.ResponseWriter, r *http.Request) {
		marks, err := s.c.Timeline(r.PathValue("id"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		writeJSON(w, marks)
	})
	mux.HandleFunc("GET /api/search/terminals", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.c.SearchTerminals(r.URL.Query().Get("q")))
	})
	mux.HandleFunc("GET /api/search", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		writeJSON(w, s.c.Search(q.Get("q"), q.Get("mine") == "1"))
	})
	mux.HandleFunc("DELETE /api/archive/{id}", s.archiveDelete)
	mux.HandleFunc("POST /api/archive/{id}/resume", s.archiveResume)
	/* Emergency brake. Not a DELETE: nothing is lost here, the session is only
	   suspended and carries on where it stood. */
	mux.HandleFunc("POST /api/sessions/{id}/freeze", func(w http.ResponseWriter, r *http.Request) {
		ok := s.c.Freeze(r.PathValue("id"))
		if !ok {
			http.Error(w, uierr.New("err.freeze.unsupported").Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST /api/sessions/{id}/unfreeze", func(w http.ResponseWriter, r *http.Request) {
		if !s.c.Unfreeze(r.PathValue("id")) {
			http.Error(w, uierr.New("err.unfreeze.failed").Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST /api/freeze", func(w http.ResponseWriter, r *http.Request) {
		frozen, total := s.c.FreezeAll()
		writeJSON(w, map[string]int{"frozen": frozen, "affected": total})
	})
	mux.HandleFunc("POST /api/unfreeze", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]int{"resumed": s.c.UnfreezeAll()})
	})
	mux.HandleFunc("POST /api/sessions/{id}/account", s.switchAccount)
	mux.HandleFunc("POST /api/sessions/{id}/resume", func(w http.ResponseWriter, r *http.Request) {
		sess, err := s.c.ResumeOrphaned(r.PathValue("id"))
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
		writeJSON(w, s.c.HookStatus())
	})
	mux.HandleFunc("POST /api/hook", func(w http.ResponseWriter, r *http.Request) {
		if err := s.c.HookSet(r.URL.Query().Get("an") == "1"); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, s.c.HookStatus())
	})
	mux.HandleFunc("GET /api/version", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.c.VersionStatus())
	})
	mux.HandleFunc("GET /api/running", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.c.Running())
	})
	// What the window complains about. It has no developer tools, so an error
	// inside it is visible to whoever has it open and to nobody else.
	mux.HandleFunc("POST /api/window-log", func(w http.ResponseWriter, r *http.Request) {
		b, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
		if err != nil {
			http.Error(w, uierr.With("err.prefs.unreadable", err.Error()).Error(), http.StatusBadRequest)
			return
		}
		_ = daemon.AppendWindowLog(string(b))
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /api/prefs", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, daemon.ReadPrefs())
	})
	// Small enough to ask for often: it is how a second window notices that the
	// first one changed the look.
	mux.HandleFunc("GET /api/prefs/rev", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]int64{"rev": daemon.PrefsRev()})
	})
	mux.HandleFunc("PUT /api/prefs", func(w http.ResponseWriter, r *http.Request) {
		var change map[string]any
		if err := json.NewDecoder(r.Body).Decode(&change); err != nil {
			http.Error(w, uierr.With("err.prefs.unreadable", err.Error()).Error(), http.StatusBadRequest)
			return
		}
		if err := daemon.WritePrefs(change); err != nil {
			http.Error(w, uierr.With("err.prefs.notWritten", err.Error()).Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST /api/update", func(w http.ResponseWriter, r *http.Request) {
		if err := s.c.Update(); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, s.c.UpdateProgress())
	})
	mux.HandleFunc("GET /api/update", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.c.UpdateProgress())
	})
	// Starts the new version. The daemon explicitly does NOT exit here: it owns
	// the PTYs, and exiting would kill every running session on update — the exact
	// opposite of what the dialog promises. The window bows out on its own through
	// the Wails binding.
	mux.HandleFunc("POST /api/restart", func(w http.ResponseWriter, r *http.Request) {
		if err := s.c.Restart(); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /api/agents", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.c.AgentList())
	})
	mux.HandleFunc("GET /api/agents/{name}", func(w http.ResponseWriter, r *http.Request) {
		text, err := s.c.AgentRead(r.PathValue("name"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write([]byte(text))
	})
	mux.HandleFunc("GET /api/agents/{name}/starter", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write([]byte(s.c.AgentStarter(r.PathValue("name"))))
	})
	mux.HandleFunc("PUT /api/agents/{name}", func(w http.ResponseWriter, r *http.Request) {
		b, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := s.c.AgentWrite(r.PathValue("name"), string(b)); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("DELETE /api/agents/{name}", func(w http.ResponseWriter, r *http.Request) {
		if err := s.c.AgentDelete(r.PathValue("name")); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	// What is lined up for a session, and adding to or dropping from it. The
	// sending itself is the daemon's business — see Core.WatchQueues.
	// What to be told about, and with which sound. Read by the daemon, because
	// it is the daemon that notices — a window that is closed cannot.
	mux.HandleFunc("GET /api/notify", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"settings": notify.Read(), "sounds": notify.Sounds()})
	})
	mux.HandleFunc("PUT /api/notify", func(w http.ResponseWriter, r *http.Request) {
		var in notify.Settings
		if json.NewDecoder(r.Body).Decode(&in) != nil {
			http.Error(w, uierr.New("err.badJSON").Error(), http.StatusBadRequest)
			return
		}
		if err := notify.Write(in); err != nil {
			http.Error(w, uierr.With("err.notify.notWritten", err.Error()).Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	// Hearing it is the only way to choose it.
	mux.HandleFunc("POST /api/notify/try", func(w http.ResponseWriter, r *http.Request) {
		notify.Send("plxr", "This is what it sounds like", r.URL.Query().Get("sound"))
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("GET /api/queue/{id}", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, queue.Read(r.PathValue("id")))
	})
	mux.HandleFunc("POST /api/queue/{id}", func(w http.ResponseWriter, r *http.Request) {
		b, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
		if err != nil || len(b) == 0 {
			http.Error(w, uierr.New("err.badJSON").Error(), http.StatusBadRequest)
			return
		}
		if err := queue.Add(r.PathValue("id"), string(b)); err != nil {
			http.Error(w, uierr.With("err.queue.notWritten", err.Error()).Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("DELETE /api/queue/{id}/{index}", func(w http.ResponseWriter, r *http.Request) {
		i, err := strconv.Atoi(r.PathValue("index"))
		if err != nil {
			http.Error(w, uierr.New("err.badJSON").Error(), http.StatusBadRequest)
			return
		}
		if err := queue.Drop(r.PathValue("id"), i); err != nil {
			http.Error(w, uierr.With("err.queue.notWritten", err.Error()).Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("GET /api/replies", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.c.Replies(r.URL.Query().Get("q")))
	})
	mux.HandleFunc("GET /api/marks/{id}", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.c.Marks(r.PathValue("id")))
	})
	mux.HandleFunc("GET /api/marks/{id}/{tree}", func(w http.ResponseWriter, r *http.Request) {
		changes, err := s.c.MarkChanges(r.PathValue("id"), r.PathValue("tree"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, changes)
	})
	mux.HandleFunc("POST /api/marks/{id}/{tree}/restore", func(w http.ResponseWriter, r *http.Request) {
		if err := s.c.MarkRestore(r.PathValue("id"), r.PathValue("tree"), r.URL.Query().Get("path")); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /api/waiting", func(w http.ResponseWriter, r *http.Request) {
		days, _ := strconv.Atoi(r.URL.Query().Get("days"))
		writeJSON(w, s.c.Waiting(days))
	})
	mux.HandleFunc("GET /api/usage", func(w http.ResponseWriter, r *http.Request) {
		days, _ := strconv.Atoi(r.URL.Query().Get("days"))
		writeJSON(w, s.c.Usage(days))
	})
	mux.HandleFunc("GET /api/tempo", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.c.Pace())
	})
	mux.HandleFunc("GET /api/ports", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, s.c.Ports()) })
	mux.HandleFunc("DELETE /api/ports/{pid}", s.killPort)
	mux.HandleFunc("GET /api/files/{id}", s.listDir)
	mux.HandleFunc("GET /api/paths", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.c.Suggestions(r.URL.Query().Get("q")))
	})
	mux.HandleFunc("GET /api/file/{id}", s.readFile)
	mux.HandleFunc("PUT /api/file/{id}", s.writeFile)
	mux.HandleFunc("POST /api/file/{id}", s.createFile)
	mux.HandleFunc("PATCH /api/file/{id}", s.renameFile)
	mux.HandleFunc("DELETE /api/file/{id}", s.removeFile)
	mux.HandleFunc("GET /api/git/{id}", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.c.GitStatus(r.PathValue("id")))
	})
	mux.HandleFunc("POST /api/reveal/{id}", func(w http.ResponseWriter, r *http.Request) {
		if err := s.c.RevealFile(r.PathValue("id"), r.URL.Query().Get("path")); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /ws/tiles", s.wsTiles)
	mux.HandleFunc("GET /ws/session/{id}", s.wsSession)
	// Skins of your own, from disk. Must sit before the file server, otherwise
	// the embedded tree answers first and a skin of your own would be invisible.
	mux.Handle("GET /skins/", theme.SkinHandler(http.FileServer(http.FS(s.web))))
	mux.HandleFunc("GET /api/skins/{name}", func(w http.ResponseWriter, r *http.Request) {
		css, err := s.c.SkinRead(r.PathValue("name"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write([]byte(css))
	})
	mux.HandleFunc("PUT /api/skins/{name}", func(w http.ResponseWriter, r *http.Request) {
		b, err := io.ReadAll(io.LimitReader(r.Body, 512*1024))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := s.c.SkinWrite(r.PathValue("name"), string(b)); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
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
		http.Error(w, uierr.New("err.badJSON").Error(), http.StatusBadRequest)
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

type switchReq struct {
	Account string `json:"account"`
}

/* Which account to move to, read from the body the window actually sends.
 *
 * This read r.URL.Query().Get("target") while the window has always sent
 * {"account": "..."} in the body. So the daemon received an empty target every
 * single time, Resume fell back to "the account it was already on", and
 * switching accounts killed the session and started it again on the same one.
 * It looked like nothing happened, because nothing did. The window swallowed
 * the answer as well, so there was not even a message.
 */
func (s *Server) switchAccount(w http.ResponseWriter, r *http.Request) {
	var req switchReq
	if json.NewDecoder(r.Body).Decode(&req) != nil {
		http.Error(w, uierr.New("err.badJSON").Error(), http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.Account) == "" {
		http.Error(w, uierr.New("err.account.noTarget").Error(), http.StatusBadRequest)
		return
	}
	sess, err := s.c.SwitchAccount(r.PathValue("id"), strings.TrimSpace(req.Account))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, sess)
}

func (s *Server) killPort(w http.ResponseWriter, r *http.Request) {
	pid, err := strconv.Atoi(r.PathValue("pid"))
	if err != nil {
		http.Error(w, uierr.New("err.badPID").Error(), http.StatusBadRequest)
		return
	}
	if err := s.c.KillPort(pid, r.URL.Query().Get("hard") == "1"); err != nil {
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

type writeReq struct {
	Path string `json:"path"`
	Text string `json:"text"`
	Mod  int64  `json:"mod"`
}

func (s *Server) writeFile(w http.ResponseWriter, r *http.Request) {
	var req writeReq
	if json.NewDecoder(io.LimitReader(r.Body, 8<<20)).Decode(&req) != nil {
		http.Error(w, uierr.New("err.badJSON").Error(), http.StatusBadRequest)
		return
	}
	out, err := s.c.WriteFile(r.PathValue("id"), req.Path, req.Text, req.Mod)
	if err != nil {
		// An escape attempt is not a conflict: that distinction belongs in the status
		// code, otherwise an attack looks like a slip of the hand.
		code := http.StatusBadRequest
		switch {
		/* Matched against the CODE, not against prose.
		   This used to compare the German sentences these errors carried before
		   they became codes. Since then neither branch has been reachable:
		   every one of them went out as a plain 400, and an attempt to reach
		   outside the session looked exactly like a slip of the hand. */
		case strings.HasPrefix(err.Error(), "err.file.outsideSession"):
			code = http.StatusForbidden
		case strings.HasPrefix(err.Error(), "err.file.changedOutside"):
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

type fileReq struct {
	Path string `json:"path"`
	To   string `json:"to"`
	Dir  bool   `json:"dir"`
}

func (s *Server) createFile(w http.ResponseWriter, r *http.Request) {
	var req fileReq
	if json.NewDecoder(r.Body).Decode(&req) != nil {
		http.Error(w, uierr.New("err.badJSON").Error(), http.StatusBadRequest)
		return
	}
	out, err := s.c.CreateFile(r.PathValue("id"), req.Path, req.Dir)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, out)
}

func (s *Server) renameFile(w http.ResponseWriter, r *http.Request) {
	var req fileReq
	if json.NewDecoder(r.Body).Decode(&req) != nil {
		http.Error(w, uierr.New("err.badJSON").Error(), http.StatusBadRequest)
		return
	}
	out, err := s.c.RenameFile(r.PathValue("id"), req.Path, req.To)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, out)
}

func (s *Server) removeFile(w http.ResponseWriter, r *http.Request) {
	if err := s.c.RemoveFile(r.PathValue("id"), r.URL.Query().Get("path")); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// wsTiles pushes the whole state out once per second.
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

// wsSession is the real terminal: output out, keystrokes in.
func (s *Server) wsSession(w http.ResponseWriter, r *http.Request) {
	h := s.c.Host(r.PathValue("id"))
	if h == nil {
		http.Error(w, uierr.New("err.noRunningSession").Error(), http.StatusNotFound)
		return
	}
	c, err := s.up.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer c.Close()

	// Scrollback first, so the client is not left staring at an empty screen.
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
	c.WriteMessage(websocket.TextMessage, []byte("\r\n[plxr] process ended.\r\n"))
}

// writeJSON answers with v as JSON — and never with a bare null.
//
// Go marshals a nil slice to `null`, not to `[]`. The interface does not see
// the difference until it reads a length: `list.length` on null throws, the
// call itself succeeded, so no catch fires and the view stays empty without a
// word. That is exactly how the marks pane swallowed its own empty state — a
// session without marks showed nothing at all instead of "no marks yet".
//
// It is fixed here rather than at the 37 call sites, because the next handler
// to be written would have the same hole and nobody would notice.
/* Answer with the thing, or say that it could not be turned into an answer.
 *
 * This used to write the header, fail to encode, log a line nobody reads, and
 * leave the caller holding a 200 with an empty body — which reads as "there is
 * nothing", not as "something is wrong". One route handed it a function instead
 * of the list that function returns, and for as long as that lasted the
 * notification settings simply had no sounds to offer, silently.
 *
 * Encoded first, into memory. Only once that has worked does anything go out,
 * so a failure can still be reported as one.
 */
func writeJSON(w http.ResponseWriter, v any) {
	body, err := json.Marshal(emptyNotNull(v))
	if err != nil {
		log.Println("json:", err)
		http.Error(w, uierr.With("err.notEncodable", err.Error()).Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(append(body, '\n'))
}

// emptyNotNull turns a nil slice into an empty one and a nil map into an empty
// map. Everything else is passed through untouched: a nil pointer stays null,
// because there the interface really is meant to see "nothing there".
func emptyNotNull(v any) any {
	if v == nil {
		return v
	}
	rv := reflect.ValueOf(v)
	// The kind has to be settled BEFORE IsNil — on a struct, and usage returns
	// one, IsNil panics outright.
	switch rv.Kind() {
	case reflect.Slice:
		if rv.IsNil() {
			return reflect.MakeSlice(rv.Type(), 0, 0).Interface()
		}
	case reflect.Map:
		if rv.IsNil() {
			return reflect.MakeMap(rv.Type()).Interface()
		}
	}
	return v
}
