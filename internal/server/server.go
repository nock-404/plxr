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
	"plxr/internal/find"
	"plxr/internal/fonts"
	"plxr/internal/git"
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
	/* The way in from the network, or nil when this server was started without
	 * one. Whether it is open is asked of the door itself, never of the
	 * setting: the setting is what somebody wants, the door is what is. */
	door *daemon.Door
}

// UseDoor hands the server the network listener it may open and close.
func (s *Server) UseDoor(d *daemon.Door) { s.door = d }

// Reachable says whether plxr can be reached from the network right now.
func (s *Server) Reachable() bool { return s.door != nil && s.door.Live() }

func New(c *core.Core, web fs.FS) *Server {
	return &Server{
		c: c, web: web,
		// localhost only, so an open origin check is good enough.
		up: websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }},
	}
}

// remoteState is the one answer about reaching plxr from elsewhere: what was
// asked for, and what is actually the case.
func (s *Server) remoteState(trouble string) map[string]any {
	return map[string]any{
		"on":        daemon.RemoteWanted(),
		"live":      s.Reachable(),
		"port":      daemon.MustRead().Port,
		"addresses": daemon.Addresses(),
		"trouble":   trouble,
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

	// Fonts a person brings in themselves. Listed, imported, served and removed
	// here; the window writes the @font-face and offers them.
	mux.HandleFunc("GET /api/fonts", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, fonts.List()) })
	mux.HandleFunc("POST /api/fonts", s.importFont)
	mux.HandleFunc("DELETE /api/fonts/{file}", func(w http.ResponseWriter, r *http.Request) {
		if err := fonts.Delete(r.PathValue("file")); err != nil {
			http.Error(w, uierr.With("err.font.notRemoved", err.Error()).Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /userfonts/{file}", func(w http.ResponseWriter, r *http.Request) {
		full := fonts.Path(r.PathValue("file"))
		if full == "" {
			http.NotFound(w, r)
			return
		}
		// A brought-in font is not secret and does not change under the window,
		// so it may be cached hard.
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		http.ServeFile(w, r, full)
	})
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
	mux.HandleFunc("GET /api/accounts", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, s.c.AccountsShown()) })
	mux.HandleFunc("POST /api/accounts", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Dir   string `json:"dir"`
			Label string `json:"label"`
			// Share links the new account's projects folder to the history
			// the others read. Absent means: share when the others do.
			Share *bool `json:"share"`
		}
		_ = json.NewDecoder(io.LimitReader(r.Body, 8<<10)).Decode(&req)
		// A directory given means "take this one I already have" (option a);
		// none means "make a fresh one to sign in to" (option b).
		if strings.TrimSpace(req.Dir) != "" {
			list, err := s.c.AddAccount(req.Dir, req.Label, req.Share)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			writeJSON(w, list)
			return
		}
		acc, list, err := s.c.CreateAccount(req.Label, req.Share)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, map[string]any{"account": acc, "accounts": list})
	})
	mux.HandleFunc("PATCH /api/accounts/{name}", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Label   *string `json:"label"`
			Default *bool   `json:"default"`
		}
		if json.NewDecoder(io.LimitReader(r.Body, 8<<10)).Decode(&req) != nil {
			http.Error(w, uierr.New("err.badJSON").Error(), http.StatusBadRequest)
			return
		}
		name := r.PathValue("name")
		var list []accounts.Account
		var err error
		if req.Label != nil {
			list, err = s.c.RenameAccount(name, *req.Label)
		}
		if err == nil && req.Default != nil && *req.Default {
			list, err = s.c.SetDefaultAccount(name)
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if list == nil {
			list = s.c.AccountsShown()
		}
		writeJSON(w, list)
	})
	mux.HandleFunc("DELETE /api/accounts/{name}", func(w http.ResponseWriter, r *http.Request) {
		list, err := s.c.RemoveAccount(r.PathValue("name"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, list)
	})
	/* Joining the shared history later, for an account that was added with a
	   projects folder of its own. Refused with nothing changed while that folder
	   holds anything. */
	mux.HandleFunc("POST /api/accounts/{name}/share", func(w http.ResponseWriter, r *http.Request) {
		list, err := s.c.ShareAccountHistory(r.PathValue("name"))
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
	/* Putting the hook in and taking it out are two routes, not one route with a
	 * flag on it.
	 *
	 * It was POST with ?an=1 meaning "on", and the window has never sent that —
	 * so the button labelled INSTALL called HookSet(false), which is Install
	 * with remove set, and took the hook out of every account's settings.json.
	 * Measured: a POST the way the window sends it turned six installed events
	 * into none. The window swallowed the answer as well, so the only sign was
	 * the panel afterwards saying the hook was not installed. */
	mux.HandleFunc("POST /api/hook", func(w http.ResponseWriter, r *http.Request) {
		if err := s.c.HookSet(true); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, s.c.HookStatus())
	})
	mux.HandleFunc("DELETE /api/hook", func(w http.ResponseWriter, r *http.Request) {
		if err := s.c.HookSet(false); err != nil {
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
	// The folders to offer in the new-session dialog: where sessions ran last.
	mux.HandleFunc("GET /api/recent", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.c.RecentFolders(8))
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
		// Every window reads the permission again, so the settings, which
		// ask every two seconds while they are open, show it as it stands in
		// System Settings now and not as it stood when the window connected.
		notify.Service.Refresh()
		writeJSON(w, map[string]any{
			"settings": notify.Read(), "sounds": notify.Sounds(),
			// How the system permission stands, as the window reported it,
			// and how many windows are listening — so the settings can say
			// whether a notification can be shown at all.
			"permission": notify.Service.Permission(), "windows": notify.Service.Windows(),
			// Whether the service shows them itself, where there is no
			// permission to hold and no window needed.
			"serviceShows": notify.Service.ServiceShows(),
		})
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
	// Hearing it is the only way to choose it. Answers with where it went:
	// to one window, to nobody because no window is open or plxr is not
	// allowed yet, or — on Linux and Windows — shown by the service.
	mux.HandleFunc("POST /api/notify/try", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"via": string(notify.Service.Try(r.URL.Query().Get("sound")))})
	})
	// The page cannot ask the system for the permission: it is a page. The
	// window can, and this asks it to — the answer comes back the way the
	// permission always does, and the settings show it.
	mux.HandleFunc("POST /api/notify/authorize", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]bool{"asked": notify.Service.Authorize()})
	})
	// Where a refused permission is switched back on: System Settings on
	// plxr's own notification switches, for the bundle the window said it
	// posts under. A system URL, which a page is not allowed to follow; the
	// service runs it.
	mux.HandleFunc("POST /api/notify/system-settings", func(w http.ResponseWriter, r *http.Request) {
		if err := notify.OpenSystemSettings(notify.Service.Bundle()); err != nil {
			http.Error(w, uierr.With("err.notify.settingsNotOpened", err.Error()).Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	// Which session a page has in front, and whether the page has focus. A
	// notification about a session somebody is looking at is not one they
	// need; the hub holds it back while that stands.
	mux.HandleFunc("PUT /api/notify/front", func(w http.ResponseWriter, r *http.Request) {
		var in notifyFront
		if json.NewDecoder(r.Body).Decode(&in) != nil {
			http.Error(w, uierr.New("err.badJSON").Error(), http.StatusBadRequest)
			return
		}
		notify.Service.SetFront(in.Page, in.Session, in.Focused)
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
	/* Which file to put back, read from the body.
	 *
	 * It was a query parameter the window never sent, so the empty string went
	 * to git as "tree:" — the tree itself — and the write landed on the
	 * directory. The button in the marks panel answered "invalid argument"
	 * every time it was pressed, and had done since it was built. No path now
	 * means all of them, which is what it always meant. */
	mux.HandleFunc("POST /api/marks/{id}/{tree}/restore", func(w http.ResponseWriter, r *http.Request) {
		var req restoreReq
		if r.ContentLength > 0 && json.NewDecoder(r.Body).Decode(&req) != nil {
			http.Error(w, uierr.New("err.badJSON").Error(), http.StatusBadRequest)
			return
		}
		n, err := s.c.MarkRestore(r.PathValue("id"), r.PathValue("tree"), req.Path)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, map[string]int{"restored": n})
	})
	mux.HandleFunc("GET /api/waiting", func(w http.ResponseWriter, r *http.Request) {
		days, _ := strconv.Atoi(r.URL.Query().Get("days"))
		writeJSON(w, s.c.Waiting(days))
	})
	mux.HandleFunc("GET /api/usage", func(w http.ResponseWriter, r *http.Request) {
		days, _ := strconv.Atoi(r.URL.Query().Get("days"))
		writeJSON(w, s.c.Usage(days))
	})
	// What is left right now, per account — the figures the view leads with.
	mux.HandleFunc("GET /api/usage/accounts", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.c.UsageAccounts())
	})
	mux.HandleFunc("GET /api/tempo", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.c.Pace())
	})
	mux.HandleFunc("GET /api/ports", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, s.c.Ports()) })
	mux.HandleFunc("DELETE /api/ports/{pid}", s.killPort)
	/* Folders plxr holds open, independently of what runs in them.
	 *
	 * The file routes below take an id that is either one of these or a
	 * session — c.root reads which from the id — so none of them changed
	 * shape when this arrived. */
	mux.HandleFunc("GET /api/branches/{id}", func(w http.ResponseWriter, r *http.Request) {
		out, err := s.c.Branches(r.PathValue("id"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, out)
	})
	mux.HandleFunc("GET /api/busy/{id}", func(w http.ResponseWriter, r *http.Request) {
		out, err := s.c.BusyHere(r.PathValue("id"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, out)
	})
	mux.HandleFunc("POST /api/branches/{id}", func(w http.ResponseWriter, r *http.Request) {
		var req branchReq
		if json.NewDecoder(r.Body).Decode(&req) != nil {
			http.Error(w, uierr.New("err.badJSON").Error(), http.StatusBadRequest)
			return
		}
		if err := s.c.SwitchBranch(r.PathValue("id"), req.Name, req.Create, req.Anyway); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		out, err := s.c.Branches(r.PathValue("id"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, out)
	})
	mux.HandleFunc("DELETE /api/branches/{id}", func(w http.ResponseWriter, r *http.Request) {
		if err := s.c.DeleteBranch(r.PathValue("id"), r.URL.Query().Get("name")); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		out, err := s.c.Branches(r.PathValue("id"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, out)
	})
	mux.HandleFunc("POST /api/stage/{id}", func(w http.ResponseWriter, r *http.Request) {
		var req stageReq
		if json.NewDecoder(r.Body).Decode(&req) != nil {
			http.Error(w, uierr.New("err.badJSON").Error(), http.StatusBadRequest)
			return
		}
		if err := s.c.Stage(r.PathValue("id"), req.Paths, req.On); err != nil {
			code := http.StatusBadRequest
			if forbidden(err) {
				code = http.StatusForbidden
			}
			http.Error(w, err.Error(), code)
			return
		}
		out, err := s.c.Changes(r.PathValue("id"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, out)
	})
	mux.HandleFunc("POST /api/commit/{id}", func(w http.ResponseWriter, r *http.Request) {
		var req commitReq
		if json.NewDecoder(r.Body).Decode(&req) != nil {
			http.Error(w, uierr.New("err.badJSON").Error(), http.StatusBadRequest)
			return
		}
		hash, err := s.c.Commit(r.PathValue("id"), req.Message, req.Amend)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, map[string]string{"hash": hash})
	})
	/* One commit, read in full: what it says, who made it, and which files it
	 * touched. The history list has the subject and the age; this is what a
	 * click on one of those rows opens. No hash means HEAD. */
	mux.HandleFunc("GET /api/commit/{id}", func(w http.ResponseWriter, r *http.Request) {
		out, err := s.c.ShowCommit(r.PathValue("id"), r.URL.Query().Get("hash"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, out)
	})
	/* Everything the folder overview shows, in one answer: where the branch
	 * stands, what HEAD did, the remotes, and the plain facts of the directory
	 * itself. One route rather than eight, so the panel is never half drawn. */
	mux.HandleFunc("GET /api/folder/{id}", func(w http.ResponseWriter, r *http.Request) {
		out, err := s.c.FolderReport(r.PathValue("id"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, out)
	})
	mux.HandleFunc("GET /api/history/{id}", func(w http.ResponseWriter, r *http.Request) {
		n, _ := strconv.Atoi(r.URL.Query().Get("n"))
		out, err := s.c.History(r.PathValue("id"), n)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, out)
	})
	mux.HandleFunc("GET /api/position/{id}", func(w http.ResponseWriter, r *http.Request) {
		out, err := s.c.Position(r.PathValue("id"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, out)
	})
	mux.HandleFunc("GET /api/changes/{id}", func(w http.ResponseWriter, r *http.Request) {
		out, err := s.c.Changes(r.PathValue("id"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, out)
	})
	mux.HandleFunc("POST /api/diff/{id}", func(w http.ResponseWriter, r *http.Request) {
		var req diffReq
		if json.NewDecoder(r.Body).Decode(&req) != nil {
			http.Error(w, uierr.New("err.badJSON").Error(), http.StatusBadRequest)
			return
		}
		var out git.Diff
		var err error
		if req.Base != "" {
			out, err = s.c.DifferenceSince(r.PathValue("id"), req.Path, req.Base)
		} else {
			out, err = s.c.Difference(r.PathValue("id"), req.Path, req.Staged)
		}
		if err != nil {
			code := http.StatusBadRequest
			if forbidden(err) {
				code = http.StatusForbidden
			}
			http.Error(w, err.Error(), code)
			return
		}
		writeJSON(w, out)
	})

	/* A branch's work against a base, and the working-tree actions around
	 * it: discard, stash, unstash. Every one goes through the core's leash. */
	mux.HandleFunc("GET /api/review/{id}", func(w http.ResponseWriter, r *http.Request) {
		out, err := s.c.Review(r.PathValue("id"), r.URL.Query().Get("base"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, out)
	})
	mux.HandleFunc("POST /api/git/{id}/discard", func(w http.ResponseWriter, r *http.Request) {
		var req discardReq
		if json.NewDecoder(r.Body).Decode(&req) != nil {
			http.Error(w, uierr.New("err.badJSON").Error(), http.StatusBadRequest)
			return
		}
		if err := s.c.Discard(r.PathValue("id"), req.Paths); err != nil {
			code := http.StatusBadRequest
			if forbidden(err) {
				code = http.StatusForbidden
			}
			http.Error(w, err.Error(), code)
			return
		}
		out, err := s.c.Changes(r.PathValue("id"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, out)
	})
	mux.HandleFunc("POST /api/git/{id}/stash", func(w http.ResponseWriter, r *http.Request) {
		var req stashReq
		if json.NewDecoder(r.Body).Decode(&req) != nil {
			http.Error(w, uierr.New("err.badJSON").Error(), http.StatusBadRequest)
			return
		}
		if err := s.c.StashPush(r.PathValue("id"), req.Message); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		out, err := s.c.Stashes(r.PathValue("id"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, out)
	})
	mux.HandleFunc("POST /api/git/{id}/unstash", func(w http.ResponseWriter, r *http.Request) {
		if err := s.c.StashPop(r.PathValue("id")); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		out, err := s.c.Stashes(r.PathValue("id"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, out)
	})
	mux.HandleFunc("GET /api/git/{id}/stashes", func(w http.ResponseWriter, r *http.Request) {
		out, err := s.c.Stashes(r.PathValue("id"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, out)
	})

	/* Searching the files of a folder.
	 *
	 * A POST with a body rather than a GET with query parameters, although it
	 * only reads: the field names then travel in a shape bodies.py can hold
	 * both sides to. A query parameter the window never sends is how the
	 * account switch quietly did nothing for months. */
	mux.HandleFunc("POST /api/find/{id}", func(w http.ResponseWriter, r *http.Request) {
		var q find.Query
		if json.NewDecoder(r.Body).Decode(&q) != nil {
			http.Error(w, uierr.New("err.badJSON").Error(), http.StatusBadRequest)
			return
		}
		report, err := s.c.Find(r.PathValue("id"), q)
		if err != nil {
			code := http.StatusBadRequest
			if forbidden(err) {
				code = http.StatusForbidden
			}
			http.Error(w, err.Error(), code)
			return
		}
		writeJSON(w, report)
	})
	/* Go to file: the names under a root that match what is typed, best
	   first. A GET, because nothing changes and the palette asks again at
	   every keystroke. */
	mux.HandleFunc("GET /api/names/{id}", func(w http.ResponseWriter, r *http.Request) {
		report, err := s.c.Names(r.PathValue("id"), r.URL.Query().Get("q"))
		if err != nil {
			code := http.StatusBadRequest
			if forbidden(err) {
				code = http.StatusForbidden
			}
			http.Error(w, err.Error(), code)
			return
		}
		writeJSON(w, report)
	})
	/* Reaching plxr from another machine.
	 *
	 * Off unless it is asked for, and asking for it takes a restart: the
	 * listener is bound once, at start. The window says so rather than
	 * pretending the switch takes effect where it does not. */
	mux.HandleFunc("GET /api/remote", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.remoteState(""))
	})
	mux.HandleFunc("POST /api/remote", func(w http.ResponseWriter, r *http.Request) {
		var req remoteReq
		if json.NewDecoder(r.Body).Decode(&req) != nil {
			http.Error(w, uierr.New("err.badJSON").Error(), http.StatusBadRequest)
			return
		}
		if err := daemon.SetRemote(req.On); err != nil {
			http.Error(w, uierr.With("err.remote.notWritten", err.Error()).Error(), http.StatusBadRequest)
			return
		}
		/* And the door moves with it, now, not at some next start.
		 *
		 * Switching off has to shut it at once above all: a daemon that keeps
		 * listening while the window says OFF is the worst of both, and
		 * quitting the window does not stop the daemon. */
		trouble := ""
		if s.door != nil {
			if req.On {
				if err := s.door.Open(); err != nil {
					trouble = err.Error()
				}
			} else {
				s.door.Close()
			}
		}
		writeJSON(w, s.remoteState(trouble))
	})
	/* A code to carry to the other machine.
	 *
	 * Only while the network listener is actually up: a code for a daemon
	 * nobody can reach is a code that reads as a promise. */
	mux.HandleFunc("POST /api/remote/code", func(w http.ResponseWriter, r *http.Request) {
		if !s.Reachable() {
			http.Error(w, uierr.New("err.remote.notListening").Error(), http.StatusBadRequest)
			return
		}
		code, until := daemon.NewCode()
		if code == "" {
			http.Error(w, uierr.New("err.remote.noCode").Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, map[string]any{
			"code":  code,
			"until": until.UnixMilli(),
			"port":  daemon.MustRead().Port,
		})
	})
	mux.HandleFunc("GET /api/workspaces", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.c.Workspaces())
	})
	mux.HandleFunc("POST /api/workspaces", func(w http.ResponseWriter, r *http.Request) {
		var req workspaceReq
		if json.NewDecoder(r.Body).Decode(&req) != nil {
			http.Error(w, uierr.New("err.badJSON").Error(), http.StatusBadRequest)
			return
		}
		made, err := s.c.OpenWorkspace(req.Path)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, made)
	})
	mux.HandleFunc("DELETE /api/workspaces/{id}", func(w http.ResponseWriter, r *http.Request) {
		if err := s.c.CloseWorkspace(r.PathValue("id")); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /api/files/{id}", s.listDir)
	mux.HandleFunc("GET /api/paths", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, s.c.Suggestions(r.URL.Query().Get("q")))
	})
	mux.HandleFunc("GET /api/file/{id}", s.readFile)
	mux.HandleFunc("GET /api/base/{id}", s.baseFile)
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
	mux.HandleFunc("GET /ws/changes/{id}", s.wsChanges)
	// The window process, not the page: it subscribes here and shows what
	// the service wants said, from the one process the system lets post.
	mux.HandleFunc("GET /ws/notify", s.wsNotify)
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

type branchReq struct {
	Name   string `json:"name"`
	Create bool   `json:"create"`
	// Anyway: yes, even though an agent is at work in this folder.
	Anyway bool `json:"anyway"`
}

type stageReq struct {
	Paths []string `json:"paths"`
	On    bool     `json:"on"`
}

type commitReq struct {
	Message string `json:"message"`
	Amend   bool   `json:"amend"`
}

type diffReq struct {
	Path   string `json:"path"`
	Staged bool   `json:"staged"`
	// Base: a range diff, the working tree against the merge-base of this
	// ref. Staged is ignored then — a review reads the whole branch.
	Base string `json:"base"`
}

type discardReq struct {
	Paths []string `json:"paths"`
}

type stashReq struct {
	Message string `json:"message"`
}

type remoteReq struct {
	On bool `json:"on"`
}

type workspaceReq struct {
	Path string `json:"path"`
}

type restoreReq struct {
	Path string `json:"path"`
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

func (s *Server) importFont(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		http.Error(w, uierr.New("err.font.noName").Error(), http.StatusBadRequest)
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, fonts.MaxSize+1))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	f, err := fonts.Import(name, raw)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	writeJSON(w, f)
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
		case forbidden(err):
			code = http.StatusForbidden
		case strings.HasPrefix(err.Error(), "err.file.changedOutside"):
			code = http.StatusConflict
		}
		http.Error(w, err.Error(), code)
		return
	}
	writeJSON(w, out)
}

// forbidden says whether an error is somebody reaching outside the folder,
// which is a different answer from a mistake — 403, not 400. Kept in one place
// because it is matched by prefix in more than one handler, and a rename that
// touches only one of them leaves a check that silently never matches again.
func forbidden(err error) bool {
	return strings.HasPrefix(err.Error(), "err.file.outsideRoot")
}

func (s *Server) readFile(w http.ResponseWriter, r *http.Request) {
	out, err := s.c.ReadFile(r.PathValue("id"), r.URL.Query().Get("path"))
	if err != nil {
		code := http.StatusBadRequest
		if forbidden(err) {
			code = http.StatusForbidden
		}
		http.Error(w, err.Error(), code)
		return
	}
	writeJSON(w, out)
}

// baseFile answers with the file as HEAD has it, for the editor's gutter.
func (s *Server) baseFile(w http.ResponseWriter, r *http.Request) {
	out, err := s.c.BaseFile(r.PathValue("id"), r.URL.Query().Get("path"))
	if err != nil {
		code := http.StatusBadRequest
		if forbidden(err) {
			code = http.StatusForbidden
		}
		http.Error(w, err.Error(), code)
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
	keepAlive(c)
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
	ping := time.NewTicker(pingEvery)
	defer ping.Stop()
	for {
		if err := c.WriteJSON(s.c.Snapshot(pathFilter)); err != nil {
			return
		}
		select {
		case <-tick.C:
		case <-ping.C:
			if err := c.WriteControl(websocket.PingMessage, nil, time.Now().Add(writeWait)); err != nil {
				return
			}
		}
	}
}

/* A socket has to prove it is still there.
 *
 * A window that goes away without closing — the tab navigated, the laptop
 * asleep, a link that dropped — leaves the socket ESTABLISHED on this side, and
 * a read on it never fails. wsTiles at least writes every second and would trip
 * over a dead peer eventually; wsChanges writes nothing on a quiet folder, so
 * it never noticed, and the git poll loop it holds open ran on for ever.
 * Measured: git forked every two seconds, minutes after the page was gone.
 *
 * So every socket is pinged, and a peer that does not answer within the
 * deadline is read as gone: the read deadline expires, ReadMessage fails, and
 * the loop that was watching for exactly that ends the subscription. */
var (
	pingEvery = 20 * time.Second
	pongWait  = 60 * time.Second
	writeWait = 10 * time.Second
)

func keepAlive(c *websocket.Conn) {
	_ = c.SetReadDeadline(time.Now().Add(pongWait))
	c.SetPongHandler(func(string) error {
		return c.SetReadDeadline(time.Now().Add(pongWait))
	})
}

/* wsChanges pushes the git state of one folder, only when it changed.
 *
 * Beside wsTiles, and shaped like it: the same upgrader, a read loop to
 * notice the window going away. What differs is the pace — nothing is sent
 * on a tick where nothing moved, and the loop that does the looking is
 * shared with every other window on the same folder (core.SubscribeChanges).
 *
 * A folder that cannot be followed — the id is unknown, there is no
 * repository — is said as one frame after the upgrade and then the socket
 * is closed. Refusing the upgrade instead reads to the window as a link that
 * dropped, and it would reconnect every second for as long as the panel is
 * open. A frame with a code in it is something the panel can show. */
func (s *Server) wsChanges(w http.ResponseWriter, r *http.Request) {
	c, err := s.up.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer c.Close()

	sub, err := s.c.SubscribeChanges(r.PathValue("id"))
	if err != nil {
		c.WriteJSON(core.ProblemFrame(err))
		return
	}
	defer sub.Close()

	keepAlive(c)
	gone := make(chan struct{})
	go func() {
		defer close(gone)
		for {
			if _, _, err := c.ReadMessage(); err != nil {
				return
			}
		}
	}()

	ping := time.NewTicker(pingEvery)
	defer ping.Stop()
	for {
		select {
		case f := <-sub.Frames():
			if err := c.WriteJSON(f); err != nil {
				return
			}
		case <-ping.C:
			if err := c.WriteControl(websocket.PingMessage, nil, time.Now().Add(writeWait)); err != nil {
				return
			}
		case <-gone:
			return
		}
	}
}

// notifyFront is a page's word on what it has in front: a random id for the
// page, the session in its active panel ("" for none), and whether it has
// focus.
type notifyFront struct {
	Page    string `json:"page"`
	Session string `json:"session"`
	Focused bool   `json:"focused"`
}

/* wsNotify hands the window what to show.
 *
 * The page does not open this one — the window process does, from Go, and
 * shows each frame natively from there: it is the bundled, foreground
 * application the system will take a notification from, with the icon and a
 * click that leads back. See notify/route.go for what was measured on the
 * service's side.
 *
 * Shaped like wsChanges: keep-alive by ping, a read loop that notices the
 * window going, and on that the subscription ends. What comes up the socket
 * is the window's word on the system permission and the bundle it posts
 * under, so the settings can show the one and open System Settings on the
 * other. */
func (s *Server) wsNotify(w http.ResponseWriter, r *http.Request) {
	c, err := s.up.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer c.Close()

	sub := notify.Service.Subscribe()
	defer sub.Close()

	keepAlive(c)
	gone := make(chan struct{})
	go func() {
		defer close(gone)
		for {
			_, data, err := c.ReadMessage()
			if err != nil {
				return
			}
			if rep, ok := notify.ReadReport(data); ok {
				sub.Report(rep.Permission, rep.Bundle)
			}
		}
	}()

	ping := time.NewTicker(pingEvery)
	defer ping.Stop()
	for {
		select {
		case m := <-sub.Frames():
			if err := c.WriteJSON(m); err != nil {
				return
			}
		case <-ping.C:
			if err := c.WriteControl(websocket.PingMessage, nil, time.Now().Add(writeWait)); err != nil {
				return
			}
		case <-gone:
			return
		}
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

	// Scrollback and stream in one step, so the client is neither left staring
	// at an empty screen nor missing what was written while it attached.
	v := h.Attach()
	defer v.Detach()
	if len(v.Back) > 0 {
		c.WriteMessage(websocket.BinaryMessage, v.Back)
	}

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
					v.Resize(m.Rows, m.Cols)
				}
			}
		}
	}()

	/* When the stream ends the socket simply closes. Nothing is written into the
	   terminal about it: the window knows from the tiles whether the session
	   ended or the link merely dropped, and shows the right thing — a restart
	   panel or a reconnect — itself. A line of text printed here would be one
	   more thing on the screen the shell has to scroll past when it comes back. */
	_ = v.Stream(func(b []byte) error {
		return c.WriteMessage(websocket.BinaryMessage, b)
	})
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
