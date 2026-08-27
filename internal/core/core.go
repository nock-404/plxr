// Package core is the application without a UI.
//
// It owns the PTYs, brings registry, fleet state and agent profiles
// together and knows no transport. Two interchangeable layers sit on top:
// the desktop window (Wails) and an HTTP server for the browser.
// Deshalb steht hier weder http noch wails im Import.
package core

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"plxr/internal/shell"
	"strings"
	"sync"
	"time"

	"plxr/internal/accounts"
	"plxr/internal/agent"
	"plxr/internal/archive"
	"plxr/internal/daemon"
	"plxr/internal/files"
	"plxr/internal/fleet"
	"plxr/internal/hook"
	"plxr/internal/notify"
	"plxr/internal/ports"
	"plxr/internal/ptyhost"
	"plxr/internal/rules"
	"plxr/internal/search"
	"plxr/internal/session"
	"plxr/internal/template"
	"plxr/internal/theme"
	"plxr/internal/update"
	"plxr/internal/usage"
)

// Tile is a session plus whatever else the UI displays.
type Tile struct {
	session.Session
	Preview string `json:"preview"`
	// Frozen says the session is suspended. Without it the quiet heuristic
	// would call a stopped session idle after a few seconds, and the tile
	// would look calm while nothing is moving at all.
	Frozen bool `json:"eingefroren,omitempty"`

	// Question is the part of the screen holding the pending question — for the
	// inbox, so it can be answered without opening the session.
	Question string `json:"frage,omitempty"`
}

// questionFromScreen cuts out of the screen what looks like a pending
// aussieht.
//
// An agent that is waiting has usually written the question last, often with
// numbered choices below it. We take everything from the last blank line before
// the first question mark — that catches the usual shapes without dragging half
// the screen along.
func questionFromScreen(screen string) string {
	lines := strings.Split(strings.TrimRight(screen, "\n"), "\n")
	if len(lines) == 0 {
		return ""
	}
	// From the back, find the last line with a question mark or a choice marker.
	end := len(lines)
	start := -1
	for i := len(lines) - 1; i >= 0 && i > len(lines)-18; i-- {
		l := strings.TrimSpace(lines[i])
		if l == "" {
			if start >= 0 {
				start = i + 1
				break
			}
			continue
		}
		if start < 0 && (strings.Contains(l, "?") ||
			strings.HasPrefix(l, "❯") || strings.HasPrefix(l, ">") ||
			strings.Contains(l, "[y/N]") || strings.Contains(l, "(y/n)")) {
			start = i
		}
	}
	if start < 0 {
		// No recognisable question: the last few lines serve as a hint.
		start = len(lines) - 6
		if start < 0 {
			start = 0
		}
	}
	teil := strings.Join(lines[start:end], "\n")
	if len(teil) > 900 {
		teil = teil[len(teil)-900:]
	}
	return strings.TrimSpace(teil)
}

type Core struct {
	reg    *session.Registry
	themes fs.FS
	agents fs.FS
	skins  fs.FS

	mu    sync.RWMutex
	hosts map[string]*ptyhost.Host
	// letzter gemeldeter Status je Session, um Flanken zu erkennen
	lastStatus map[string]session.Status
}

func New(reg *session.Registry, themes, agents, skins fs.FS) *Core {
	return &Core{
		reg: reg, themes: themes, agents: agents, skins: skins,
		hosts:      map[string]*ptyhost.Host{},
		lastStatus: map[string]session.Status{},
	}
}

func newID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// ---- Sessions ----

// Create starts a command. account picks the Claude configuration directory;
// empty means the default account.
func (c *Core) Create(cwd string, cmd []string, name, account string) (*session.Session, error) {
	if cwd == "" {
		cwd, _ = os.UserHomeDir()
	}
	if fi, err := os.Stat(cwd); err != nil || !fi.IsDir() {
		return nil, errors.New("Verzeichnis gibt es nicht: " + cwd)
	}
	if len(cmd) == 0 {
		cmd = shell.Default()
	}

	acc, _ := accounts.ByName(c.Accounts(), account)
	id := newID()
	h, err := ptyhost.Start(id, cwd, cmd, acc.Env())
	if err != nil {
		return nil, err
	}
	if name == "" {
		name = filepath.Base(cwd)
	}
	sess := &session.Session{
		ID: id, Name: name, Cwd: cwd, Cmd: cmd,
		PID: h.PID, TTY: h.TTY, StartedAt: time.Now().UnixMilli(),
		Alive: true, Status: session.StatusUnknown,
		Project: filepath.Base(cwd),
		Account: acc.Name,
	}
	c.reg.Put(sess)

	c.mu.Lock()
	c.hosts[id] = h
	c.mu.Unlock()

	go func() {
		<-h.Done
		c.reg.Update(id, func(x *session.Session) {
			x.Alive = false
			x.Status = session.StatusDead
			x.ExitCode = h.Exit()
			x.Activity = ""
			x.EndedAt = time.Now().UnixMilli()
		})
	}()
	return sess, nil
}

// deadLinger is how long an ended session stays visible.
const totNachlauf = 90 * time.Second

// PruneRecordings throws away what is too old or too much.
//
// Without a limit the directory grows without end. 30 days cover the "where was
// that again" question; anyone who needs to go further back has the transcript.
func (c *Core) PruneRecordings() {
	dir := ptyhost.RecordingDir
	if dir == "" {
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	cutoff := time.Now().AddDate(0, 0, -30)
	// A live session keeps both its recording and its timeline index. Guarding
	// only the .log would delete the index out from under a session that has
	// been running for over a month — and playback would lose its timing for
	// exactly the long sessions where it matters most.
	alive := map[string]bool{}
	for _, s := range c.reg.List() {
		alive[s.ID+".log"] = true
		alive[s.ID+".idx"] = true
	}
	for _, e := range entries {
		if alive[e.Name()] {
			continue
		}
		info, err := e.Info()
		if err == nil && info.ModTime().Before(cutoff) {
			os.Remove(filepath.Join(dir, e.Name()))
		}
	}
}

// cleanup removes an ended session together with its PTY entry.
func (c *Core) cleanup(id string) {
	c.reg.Delete(id)
	c.mu.Lock()
	delete(c.hosts, id)
	delete(c.lastStatus, id)
	c.mu.Unlock()
}

func (c *Core) Kill(id string, purge bool) {
	c.mu.Lock()
	h := c.hosts[id]
	c.mu.Unlock()
	if h != nil {
		h.Kill()
	}
	if purge {
		c.reg.Delete(id)
		c.mu.Lock()
		delete(c.hosts, id)
		c.mu.Unlock()
	}
}

// Answer sends text to a session without a terminal being open.
//
// The inbox lives off this: eight agents, three waiting — you want to work
// through them, not open each one separately.
func (c *Core) Answer(id, text string, roh bool) error {
	h := c.Host(id)
	if h == nil {
		return errors.New("Session läuft nicht")
	}
	// A line break sends the answer off. For a control key such as Escape that
	// would be wrong — it has to arrive on its own.
	if !roh && !strings.HasSuffix(text, "\r") && !strings.HasSuffix(text, "\n") {
		text += "\r"
	}
	_, err := h.Write([]byte(text))
	return err
}

func (c *Core) Host(id string) *ptyhost.Host {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.hosts[id]
}

// ---- Themes, Skins, Agenten ----

func (c *Core) Themes() []theme.Theme                        { return theme.Load(c.themes, c.skins) }
func (c *Core) ImportTheme(raw []byte) (*theme.Theme, error) { return theme.Import(raw, c.skins) }

// ThemeDelete removes an own theme. Anyone who tried three of them wants to be
// rid of them again — the built-in ones stay untouchable.
func (c *Core) ThemeDelete(name string) error { return theme.Delete(name) }

// ---- Vorlagen ----

func (c *Core) Templates() []template.Template { return template.Load(daemon.Root()) }

// TemplateStart opens every session of a template. Failures on individual
// werden gesammelt statt abgebrochen — sieben von acht Sessions sind besser
// than none just because one directory has gone.
func (c *Core) TemplateStart(name string) ([]string, error) {
	for _, v := range c.Templates() {
		if v.Name != name {
			continue
		}
		var ids []string
		var fehler []string
		for _, e := range v.Sessions {
			s, err := c.Create(e.Cwd, e.Cmd, e.Name, e.Account)
			if err != nil {
				fehler = append(fehler, e.Cwd+": "+err.Error())
				continue
			}
			ids = append(ids, s.ID)
		}
		if len(fehler) > 0 {
			return ids, errors.New(strings.Join(fehler, "; "))
		}
		return ids, nil
	}
	return nil, errors.New("keine Vorlage mit diesem Namen")
}

// TemplateFromState turns whatever is open right now into a template.
func (c *Core) TemplateFromState(name, label string) error {
	var entries []template.Entry
	for _, s := range c.reg.List() {
		if !s.Alive {
			continue
		}
		entries = append(entries, template.Entry{
			Cwd: s.Cwd, Cmd: s.Cmd, Name: s.Name, Account: s.Account,
		})
	}
	return template.Save(daemon.Root(), template.Template{
		Name: name, Label: label, Sessions: entries,
	})
}

func (c *Core) TemplateDelete(name string) error { return template.Delete(daemon.Root(), name) }

// ---- Accounts and archive ----

func (c *Core) Accounts() []accounts.Account { return accounts.Discover() }

func (c *Core) Archive(pathFilter string) []archive.Entry {
	return archive.List(c.Accounts(), pathFilter)
}

func (c *Core) archiveFind(id, account string) (archive.Entry, bool) {
	for _, e := range archive.List(c.Accounts(), "") {
		if e.ID == id && (account == "" || e.Account == account) {
			return e, true
		}
	}
	return archive.Entry{}, false
}

// Suche durchsucht alle Transkripte im Volltext.
func (c *Core) Search(question string, nurEigene bool) []search.Hit {
	return search.Search(c.Accounts(), question, nurEigene)
}

// SucheTerminals durchsucht, was je in einem Terminal stand — auch in
// sessions that are long gone.
func (c *Core) SucheTerminals(question string) []search.RecordingHit {
	names := map[string]search.RecordingHit{}
	for _, s := range c.reg.List() {
		names[s.ID] = search.RecordingHit{Name: s.Label(), Cwd: s.Cwd}
	}
	return search.SearchRecordings(ptyhost.RecordingDir, question, names)
}

func (c *Core) ArchiveDelete(id, account string) error {
	e, ok := c.archiveFind(id, account)
	if !ok {
		return errors.New("Transkript nicht gefunden")
	}
	return archive.Delete(e)
}

// Resume picks an archived transcript back up — under a different account if
// needed. For that the file has to be mirrored there first, because Claude Code
// only looks below its own configuration directory.
func (c *Core) Resume(id, fromAccount, toAccount string) (*session.Session, error) {
	e, ok := c.archiveFind(id, fromAccount)
	if !ok {
		return nil, errors.New("Transkript nicht gefunden")
	}
	if e.Cwd == "" {
		return nil, errors.New("Arbeitsverzeichnis der Session unbekannt")
	}
	if _, err := os.Stat(e.Cwd); err != nil {
		return nil, errors.New("Arbeitsverzeichnis gibt es nicht mehr: " + e.Cwd)
	}

	target := toAccount
	if target == "" {
		target = e.Account
	}
	if target != e.Account {
		acc, ok := accounts.ByName(c.Accounts(), target)
		if !ok {
			return nil, errors.New("Konto gibt es nicht: " + target)
		}
		if _, err := archive.Mirror(e, acc); err != nil {
			return nil, errors.New("Transkript ließ sich nicht ins Zielkonto kopieren: " + err.Error())
		}
	}

	name := e.Title
	if name == "" {
		name = e.Project
	}
	return c.Create(e.Cwd, []string{"claude", "--resume", e.ID}, name, target)
}

// ResumeOrphaned restarts an orphaned session.
//
// The process is gone, but with Claude Code the conversation is in the
// transcript — with --resume it carries on where the crash happened.
func (c *Core) ResumeOrphaned(sessionID string) (*session.Session, error) {
	s, ok := c.reg.Get(sessionID)
	if !ok {
		return nil, errors.New("Session gibt es nicht")
	}
	cwd, account, cmd, claudeID := s.Cwd, s.Account, s.Cmd, s.ClaudeSessionID
	c.cleanup(sessionID)

	if claudeID != "" {
		return c.Create(cwd, []string{"claude", "--resume", claudeID}, s.Name, account)
	}
	// No transcript: then simply the command again, in the same directory.
	return c.Create(cwd, cmd, s.Name, account)
}

// SwitchAccount moves a running session over to another account: end the
// process, mirror the transcript, carry on under the new account. That is the
// way out when an allowance has run dry.
func (c *Core) SwitchAccount(sessionID, toAccount string) (*session.Session, error) {
	s, ok := c.reg.Get(sessionID)
	if !ok {
		return nil, errors.New("Session gibt es nicht")
	}
	claudeID := s.ClaudeSessionID
	if claudeID == "" {
		return nil, errors.New("für diese Session ist keine Claude-Session-ID bekannt — läuft dort überhaupt Claude Code?")
	}
	source := s.Account
	c.Kill(sessionID, true)
	return c.Resume(claudeID, source, toAccount)
}

// ---- Verbrauch ----

func (c *Core) Verbrauch(tage int) usage.Report { return usage.Compute(c.Accounts(), tage) }

// ---- Anbindung an Claude Code ----

// HookStatus says whether plxr registers there and which directory is meant.
// HookStatus reports whether all accounts are connected — not just the first.
// HookSet registers in all of them; checking only the first would mean showing
// "installed" while two accounts stay silent.
func (c *Core) HookStatus() map[string]any {
	konten := c.Accounts()
	acc, _ := accounts.ByName(konten, "")
	fehlen := []string{}
	for _, a := range konten {
		if !hook.Installed(a.Dir) {
			fehlen = append(fehlen, a.Label)
		}
	}
	return map[string]any{
		"eingerichtet": len(konten) > 0 && len(fehlen) == 0,
		"dir":          acc.Dir,
		"konten":       len(konten),
		"fehlen":       fehlen,
	}
}

// HookSet registers or unregisters plxr — in every account found, because anyone
// running several of them wants to see the state from all.
func (c *Core) HookSetzen(an bool) error {
	konten := c.Accounts()
	if len(konten) == 0 {
		return errors.New("kein Claude-Code-Verzeichnis gefunden")
	}
	for _, a := range konten {
		if _, err := hook.Install(a.Dir, !an); err != nil {
			return err
		}
	}
	return nil
}

// ---- Verbrauchstempo ----

func (c *Core) Pace() usage.Pace { return usage.ComputePace(c.Accounts()) }

// ---- Fassung ----

// Version is set at startup from main.
var Version = "dev"

// After an update Version points at what sits on disk — not at what this process
// was started with. The daemon deliberately keeps running, it owns the sessions;
// but it still has to report what is installed. Otherwise the "new version"
// notice would stay up and would download
// dasselbe Paket immer wieder.
var versionMu sync.RWMutex

func currentVersion() string {
	versionMu.RLock()
	defer versionMu.RUnlock()
	return Version
}

func (c *Core) VersionStatus() update.Status { return update.Check(currentVersion()) }

// UpdateStatus is the progress of a running update. The UI polls it instead of
// waiting on a call that can take minutes
// dauern kann.
type UpdateStatus struct {
	Running bool   `json:"laeuft"`
	Percent int    `json:"prozent"`
	Phase   string `json:"phase"`
	Path    string `json:"ort,omitempty"`
	Error   string `json:"fehler,omitempty"`
	Done    bool   `json:"fertig"`
}

var updateStatus UpdateStatus
var updateMu sync.Mutex

func (c *Core) UpdateFortschritt() UpdateStatus {
	updateMu.Lock()
	defer updateMu.Unlock()
	return updateStatus
}

func setStatus(fn func(*UpdateStatus)) {
	updateMu.Lock()
	fn(&updateStatus)
	updateMu.Unlock()
}

// Update starts the update and returns immediately. Progress goes through
// UpdateProgress — a call that blocks until the end makes the UI look dead for
// minutes.
func (c *Core) Update() error {
	updateMu.Lock()
	if updateStatus.Running {
		updateMu.Unlock()
		return errors.New("läuft bereits")
	}
	st := update.Check(Version)
	if st.Error != "" {
		updateMu.Unlock()
		return errors.New(st.Error)
	}
	if !st.Available {
		updateMu.Unlock()
		return errors.New("es gibt nichts Neueres")
	}
	updateStatus = UpdateStatus{Running: true, Phase: "lädt"}
	updateMu.Unlock()

	go func() {
		ort, err := update.Apply(st.AssetURL, func(read, total int64) {
			if total <= 0 {
				return
			}
			setStatus(func(u *UpdateStatus) {
				u.Percent = int(read * 100 / total)
				if u.Percent >= 100 {
					u.Phase = "tauscht aus"
				}
			})
		})
		setStatus(func(u *UpdateStatus) {
			u.Running = false
			u.Done = true
			if err != nil {
				u.Error = err.Error()
				u.Phase = "fehlgeschlagen"
				return
			}
			u.Path, u.Phase, u.Percent = ort, "fertig", 100
		})
		versionMu.Lock()
		Version = st.Latest
		versionMu.Unlock()
	}()
	return nil
}

// Restart starts the swapped-in app and ends this one.
//
// The daemon keeps running — it is a process of its own, and the sessions belong
// to it. Only the window comes back new, with the new version. That is exactly
// deshalb bleibt beim Update alles beim Alten.
func (c *Core) Restart() error {
	st := c.UpdateFortschritt()
	if st.Path == "" {
		return errors.New("nichts eingesetzt")
	}
	return update.Restart(st.Path)
}

// Playback hands out a recording plus its timeline, so the UI can replay a
// session — including sessions that no longer exist. The recording is the raw
// terminal stream; a terminal emulator reproduces it exactly.
func (c *Core) Playback(id string, from int64) (*search.Playback, error) {
	return search.ReadPlayback(ptyhost.RecordingDir, id, from)
}

/*
Freeze and Resume, one session or all of them.

	FreezeAll is the emergency brake: something appears in a tile that must not
	run, and there is no time to work out which of four sessions it belongs to.
	One grab stops all of them; afterwards there is time to look.

	Returns how many were actually stopped — a UI that reports "all frozen" while
	two kept running would be worse than none at all.
*/
func (c *Core) Freeze(id string) bool {
	if h := c.Host(id); h != nil {
		return h.Freeze()
	}
	return false
}

func (c *Core) Unfreeze(id string) bool {
	if h := c.Host(id); h != nil {
		return h.Resume()
	}
	return false
}

func (c *Core) FreezeAll() (frozen, total int) {
	c.mu.Lock()
	hosts := make([]*ptyhost.Host, 0, len(c.hosts))
	for _, h := range c.hosts {
		hosts = append(hosts, h)
	}
	c.mu.Unlock()
	for _, h := range hosts {
		if !h.Alive() || h.Frozen() {
			continue
		}
		total++
		if h.Freeze() {
			frozen++
		}
	}
	return
}

func (c *Core) UnfreezeAll() (resumed int) {
	c.mu.Lock()
	hosts := make([]*ptyhost.Host, 0, len(c.hosts))
	for _, h := range c.hosts {
		hosts = append(hosts, h)
	}
	c.mu.Unlock()
	for _, h := range hosts {
		if h.Frozen() && h.Resume() {
			resumed++
		}
	}
	return
}

// ---- Rules and ports ----

// Rules resolves which instruction files take effect in a session. Without a
// session id the directory passed in applies.
func (c *Core) Rules(sessionID, dir string) []rules.Entry {
	account := ""
	if sessionID != "" {
		if s, ok := c.reg.Get(sessionID); ok {
			dir, account = s.Cwd, s.Account
		}
	}
	if dir == "" {
		return []rules.Entry{}
	}
	acc, _ := accounts.ByName(c.Accounts(), account)
	return rules.Resolve(dir, acc.Dir)
}

// Ports lists the occupied ports and marks which belong to plxr sessions.
func (c *Core) Ports() []ports.Entry {
	eigene := map[int]bool{}
	for _, s := range c.reg.List() {
		if s.Alive && s.PID > 0 {
			eigene[s.PID] = true
		}
	}
	return ports.List(eigene)
}

func (c *Core) KillPort(pid int, hart bool) error {
	if pid <= 1 {
		return errors.New("unsinnige Prozess-ID")
	}
	if pid == os.Getpid() {
		return errors.New("das wäre plxr selbst")
	}
	return ports.Kill(pid, hart)
}

// ---- Dateien ----

// root returns the working directory of a session. Every file path the UI sends
// is checked against it.
func (c *Core) root(sessionID string) (string, error) {
	s, ok := c.reg.Get(sessionID)
	if !ok {
		return "", errors.New("Session gibt es nicht")
	}
	return s.Cwd, nil
}

func (c *Core) ListDir(sessionID, dir string) ([]files.Entry, error) {
	root, err := c.root(sessionID)
	if err != nil {
		return nil, err
	}
	return files.List(root, dir)
}

func (c *Core) ReadFile(sessionID, path string) (*files.Content, error) {
	root, err := c.root(sessionID)
	if err != nil {
		return nil, err
	}
	return files.Read(root, path)
}

// Vorschlaege hilft beim Eintippen eines Pfades. Bewusst ohne Sessionbezug:
// what is being looked for is a directory with no session running in it yet.
func (c *Core) Suggestions(eingabe string) []string {
	return files.Suggestions(eingabe, 40)
}

func (c *Core) WriteFile(sessionID, path, text string, status int64) (*files.Content, error) {
	root, err := c.root(sessionID)
	if err != nil {
		return nil, err
	}
	return files.Write(root, path, text, status)
}

// ---- Merging the state ----

// Snapshot marries registry, running PTYs and the fleet state.
func (c *Core) Snapshot(pathFilter string) []Tile {
	agents := agent.Load(c.agents)
	states := fleet.Read(fleet.Dir())

	byPID := map[int]fleet.State{}
	for _, st := range states {
		// Keep only the most recent entry per PID.
		if old, ok := byPID[st.PID]; !ok || st.UpdatedAt > old.UpdatedAt {
			byPID[st.PID] = st
		}
	}

	out := []Tile{}
	for _, sess := range c.reg.List() {
		if pathFilter != "" && !strings.HasPrefix(sess.Cwd, pathFilter) {
			continue
		}
		// Leave ended sessions up briefly so the exit code can still be seen,
		// then clear them away. Orphaned ones stay: they stand for work nobody
		// meant to end, and only disappear once somebody clicks them away or
		// resumes them.
		if !sess.Alive && !sess.Orphaned && sess.EndedAt > 0 &&
			time.Since(time.UnixMilli(sess.EndedAt)) > totNachlauf {
			c.cleanup(sess.ID)
			continue
		}

		h := c.Host(sess.ID)
		prof := agents.Match(sess.Cmd)
		sess.Agent, sess.AgentLabel = prof.Name, prof.Label

		st, matched := byPID[sess.PID]
		useFleet := matched && sess.Alive && prof.Source == "fleet"

		// Render once, use twice — preview and status detection.
		screen := ""
		if h != nil {
			screen = h.Tail(18)
		}
		frozen := h != nil && h.Frozen()
		if sess.Alive && !useFleet && h != nil && !frozen {
			// No self-reporting hook: derive the status from screen and quiet time.
			sess.Status = session.Status(prof.Classify(screen, h.IdleFor()))
		}
		if useFleet {
			sess.ClaudeSessionID = st.SessionID
			sess.Status = session.Status(st.Status)
			sess.Title = st.Title
			sess.Activity = st.Activity
			sess.Model = st.Model
			sess.Effort = st.Effort
			sess.Context = st.Context
			sess.LastMessage = st.LastMessage
			sess.Since = st.Since
			if st.Branch != "" {
				sess.Branch = st.Branch
			}
			if st.Project != "" {
				sess.Project = st.Project
			}
		}

		t := Tile{Session: sess, Preview: screen, Frozen: frozen}
		if sess.Alive && sess.Status == session.StatusPermission {
			t.Question = questionFromScreen(screen)
		}
		out = append(out, t)
		c.checkEdge(sess)
	}
	return out
}

// checkEdge fires a notification when a session becomes newly blocked.
//
// What gets compared is "blocked yes/no", not the status itself: otherwise every
// switch between waiting and permission would notify again. And a session never
// seen before counts as previously unblocked — if an agent starts straight into
// a question, the first observation would otherwise be swallowed and no
// notification would ever arrive.
func (c *Core) checkEdge(sess session.Session) {
	jetzt := sess.Alive && sess.Status == session.StatusPermission

	c.mu.Lock()
	before, gesehen := c.lastStatus[sess.ID]
	c.lastStatus[sess.ID] = sess.Status
	c.mu.Unlock()

	wasBefore := gesehen && before == session.StatusPermission
	if !jetzt || wasBefore {
		return
	}
	// Ganz frisch gestartete Sessions kurz in Ruhe lassen: Claude Code zeigt
	// sometimes shows a trust dialog on first start that has nothing to do with
	// eigentlichen Arbeit zu tun hat.
	if time.Since(time.UnixMilli(sess.StartedAt)) < 3*time.Second {
		return
	}

	body := sess.Activity
	if body == "" {
		body = "wartet auf deine Antwort"
	}
	notify.Send(sess.Label(), body)
}
