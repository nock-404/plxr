// Package core is the application without a UI.
//
// It owns the PTYs, brings registry, fleet state and agent profiles
// together and knows no transport. Two interchangeable layers sit on top:
// the desktop window (Wails) and an HTTP server for the browser.
// That is why neither http nor wails appears in the imports here.
package core

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
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
	"plxr/internal/marks"
	"plxr/internal/notify"
	"plxr/internal/ports"
	"plxr/internal/ptyhost"
	"plxr/internal/queue"
	"plxr/internal/replies"
	"plxr/internal/rules"
	"plxr/internal/search"
	"plxr/internal/session"
	"plxr/internal/template"
	"plxr/internal/theme"
	"plxr/internal/uierr"
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
	Frozen bool `json:"frozen,omitempty"`

	// Stuck is set when the agent has been changing the same files back and
	// forth for a while. The tile looks healthy in that case — green, output
	// scrolling — and that is exactly why it has to be said out loud.
	Stuck *marks.Stuck `json:"stuck,omitempty"`

	// Question is the part of the screen holding the pending question — for the
	// inbox, so it can be answered without opening the session.
	Question string `json:"question,omitempty"`
}

// englishActivity translates the one activity word older builds wrote in German.
//
// The hook is a separate program: it is whichever plxr binary is installed on
// the machine, and it can be older than the daemon reading its state. One
// leftover German word in an otherwise English interface reads as a bug — the
// same reason migrateRecordings exists.
func englishActivity(a string) string {
	if a == "gestartet" { // german-ok: the value older builds wrote
		return "started"
	}
	return a
}

// questionFromScreen cuts out of the screen what looks like a pending
// question.
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
	part := strings.Join(lines[start:end], "\n")
	if len(part) > 900 {
		part = part[len(part)-900:]
	}
	return strings.TrimSpace(part)
}

type Core struct {
	reg    *session.Registry
	themes fs.FS
	agents fs.FS
	skins  fs.FS

	mu    sync.RWMutex
	hosts map[string]*ptyhost.Host
	// last reported status per session, to spot the edges
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
		return nil, uierr.With("err.dir.missing", cwd)
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
		// Whatever was still lined up has nowhere to go now. Keeping it would
		// mean sending it into the next session that happens to reuse the id.
		queue.Clear(id)
	}()
	return sess, nil
}

// deadLinger is how long an ended session stays visible.
const deadLinger = 90 * time.Second

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
func (c *Core) Answer(id, text string, raw bool) error {
	h := c.Host(id)
	if h == nil {
		return uierr.New("err.session.notRunning")
	}
	// A line break sends the answer off. For a control key such as Escape that
	// would be wrong — it has to arrive on its own.
	if !raw && !strings.HasSuffix(text, "\r") && !strings.HasSuffix(text, "\n") {
		text += "\r"
	}
	/* Remember what went to which question — before the write, because
	   afterwards the screen has already moved on and the question is gone.
	   Only what the daemon really recognised as a question: without one there
	   is nothing to remember it by. */
	if q := questionFromScreen(h.Tail(18)); q != "" {
		replies.Note(q, text)
	}

	_, err := h.Write([]byte(text))
	return err
}

// Replies hands out what was answered to this question before.
func (c *Core) Replies(question string) []replies.Reply {
	return replies.For(question, time.Now().UnixMilli())
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

// ---- Templates ----

func (c *Core) Templates() []template.Template { return template.Load(daemon.Root()) }

// TemplateStart opens every session of a template. Failures on individual ones
// are collected rather than aborted on — seven out of eight sessions are better
// than none just because one directory has gone.
func (c *Core) TemplateStart(name string) ([]string, error) {
	for _, v := range c.Templates() {
		if v.Name != name {
			continue
		}
		var ids []string
		var failed []string
		for _, e := range v.Sessions {
			s, err := c.Create(e.Cwd, e.Cmd, e.Name, e.Account)
			if err != nil {
				failed = append(failed, e.Cwd+": "+err.Error())
				continue
			}
			ids = append(ids, s.ID)
		}
		if len(failed) > 0 {
			return ids, errors.New(strings.Join(failed, "; "))
		}
		return ids, nil
	}
	return nil, uierr.New("err.template.unknown")
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

// Search runs a full-text search across every transcript.
func (c *Core) Search(question string, ownOnly bool) []search.Hit {
	return search.Search(c.Accounts(), question, ownOnly)
}

// SearchTerminals searches whatever once stood in a terminal — including in
// sessions that are long gone.
func (c *Core) SearchTerminals(question string) []search.RecordingHit {
	names := map[string]search.RecordingHit{}
	for _, s := range c.reg.List() {
		names[s.ID] = search.RecordingHit{Name: s.Label(), Cwd: s.Cwd}
	}
	return search.SearchRecordings(ptyhost.RecordingDir, question, names)
}

func (c *Core) ArchiveDelete(id, account string) error {
	e, ok := c.archiveFind(id, account)
	if !ok {
		return uierr.New("err.transcript.missing")
	}
	return archive.Delete(e)
}

// Resume picks an archived transcript back up — under a different account if
// needed. For that the file has to be mirrored there first, because Claude Code
// only looks below its own configuration directory.
func (c *Core) Resume(id, fromAccount, toAccount string) (*session.Session, error) {
	e, ok := c.archiveFind(id, fromAccount)
	if !ok {
		return nil, uierr.New("err.transcript.missing")
	}
	if e.Cwd == "" {
		return nil, uierr.New("err.session.noCwd")
	}
	if _, err := os.Stat(e.Cwd); err != nil {
		return nil, uierr.With("err.cwd.gone", e.Cwd)
	}

	target := toAccount
	if target == "" {
		target = e.Account
	}
	if target != e.Account {
		acc, ok := accounts.ByName(c.Accounts(), target)
		if !ok {
			return nil, uierr.With("err.account.unknown", target)
		}
		if _, err := archive.Mirror(e, acc); err != nil {
			return nil, uierr.With("err.transcript.copyFailed", err.Error())
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
		return nil, uierr.New("err.session.unknown")
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
		return nil, uierr.New("err.session.unknown")
	}
	claudeID := s.ClaudeSessionID
	if claudeID == "" {
		return nil, uierr.New("err.session.noClaudeID")
	}
	source := s.Account
	if toAccount == source {
		return nil, uierr.With("err.account.sameOne", toAccount)
	}
	// Checked before anything is killed. The old order took the session away
	// first and only then found out whether the move could happen at all — and
	// a refusal after that point left nothing to go back to.
	if _, ok := accounts.ByName(c.Accounts(), toAccount); !ok {
		return nil, uierr.With("err.account.unknown", toAccount)
	}
	if _, found := c.archiveFind(claudeID, source); !found {
		return nil, uierr.New("err.transcript.missing")
	}
	c.Kill(sessionID, true)
	return c.Resume(claudeID, source, toAccount)
}

// ---- What has been used up ----

func (c *Core) Usage(days int) usage.Report { return usage.Compute(c.Accounts(), days) }

// ---- Where Claude Code is hooked into ----

// HookStatus says whether plxr registers there and which directory is meant.
// HookStatus reports whether all accounts are connected — not just the first.
// HookSet registers in all of them; checking only the first would mean showing
// "installed" while two accounts stay silent.
func (c *Core) HookStatus() map[string]any {
	all := c.Accounts()
	acc, _ := accounts.ByName(all, "")
	// The numbers, not a label: what these are called is the interface's
	// business, and building the name here put German into the backend.
	missing := []int{}
	for _, a := range all {
		if !hook.Installed(a.Dir) {
			missing = append(missing, a.Number)
		}
	}
	return map[string]any{
		"installed": len(all) > 0 && len(missing) == 0,
		"dir":       acc.Dir,
		"accounts":  len(all),
		"missing":   missing,
	}
}

// HookSet registers or unregisters plxr — in every account found, because anyone
// running several of them wants to see the state from all.
func (c *Core) HookSet(on bool) error {
	all := c.Accounts()
	if len(all) == 0 {
		return uierr.New("err.hook.noConfigDir")
	}
	for _, a := range all {
		if _, err := hook.Install(a.Dir, !on); err != nil {
			return err
		}
	}
	return nil
}

// ---- Verbrauchstempo ----

func (c *Core) Pace() usage.Pace { return usage.ComputePace(c.Accounts()) }

// ---- Versions ----

// Version is what this process is, set at startup from main. It is never
// changed afterwards — see below.
var Version = "dev"

/* What is running and what is installed are two different numbers.
 *
 * Version used to be overwritten with the new one as soon as an update
 * finished, so that the "a new version is out" band would go away. The daemon
 * keeps running through an update, so from then on it reported a version it was
 * not — and a daemon that misreports itself makes everything after it
 * unexplainable. It says it is current; the interface it serves is the old one;
 * the restart button refers to a swap that happened in some other lifetime. It
 * cost hours to untangle from the outside, twice.
 *
 * So both are kept. The band is driven by what is installed, so it does not
 * come back after installing; and when the two differ the interface can say the
 * one useful thing there is to say: restart to pick it up.
 */
var (
	versionMu sync.RWMutex
	installed string
)

func installedVersion() string {
	versionMu.RLock()
	defer versionMu.RUnlock()
	if installed == "" {
		return Version
	}
	return installed
}

func (c *Core) VersionStatus() update.Status {
	st := update.Check(installedVersion())
	st.Current = Version
	st.Installed = installedVersion()
	return st
}

// Running is what is actually running right now.
//
// Written because it could not be seen. The window and the daemon are two
// programs and can be two different versions — an update by hand replaces the
// files, the daemon keeps going as the process it already was. What the
// interface showed was one number, the daemon's, labelled as if it were the
// application's. Anyone looking for the reason something behaves oddly had to
// take somebody's word for it.
type Running struct {
	Daemon   string `json:"daemon"`
	PtyHost  string `json:"ptyHost"`
	PID      int    `json:"pid"`
	Since    int64  `json:"since"`
	Sessions int    `json:"sessions"`
	Home     string `json:"home"`
}

func (c *Core) Running() Running {
	info, _ := daemon.Read()
	alive := 0
	for _, t := range c.Snapshot("") {
		if t.Alive {
			alive++
		}
	}
	return Running{
		// What this process is, not what lies on disk: this whole struct exists
		// so somebody can see the two apart.
		Daemon:   Version,
		PtyHost:  ptyhost.Version,
		PID:      info.PID,
		Since:    info.Since,
		Sessions: alive,
		Home:     daemon.Root(),
	}
}

// UpdateStatus is the progress of a running update. The UI polls it instead of
// waiting on a call that can take minutes.
type UpdateStatus struct {
	Running bool   `json:"running"`
	Percent int    `json:"percent"`
	Phase   string `json:"phase"`
	Path    string `json:"path,omitempty"`
	Error   string `json:"error,omitempty"`
	Done    bool   `json:"done"`
}

var updateStatus UpdateStatus
var updateMu sync.Mutex

func (c *Core) UpdateProgress() UpdateStatus {
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
		return uierr.New("err.update.running")
	}
	st := update.Check(Version)
	if st.Error != "" {
		updateMu.Unlock()
		return errors.New(st.Error)
	}
	if !st.Available {
		updateMu.Unlock()
		return uierr.New("err.update.upToDate")
	}
	/* A code, not a word.
	   The interface compared this against its own TRANSLATED text — with the
	   interface in English the comparison never matched, so the percentage
	   never appeared and the German phase stood on screen instead. */
	updateStatus = UpdateStatus{Running: true, Phase: "loading"}
	updateMu.Unlock()

	go func() {
		path, err := update.Apply(st.AssetURL, func(read, total int64) {
			if total <= 0 {
				return
			}
			setStatus(func(u *UpdateStatus) {
				u.Percent = int(read * 100 / total)
				if u.Percent >= 100 {
					u.Phase = "swapping"
				}
			})
		})
		setStatus(func(u *UpdateStatus) {
			u.Running = false
			u.Done = true
			if err != nil {
				u.Error = err.Error()
				u.Phase = "failed"
				return
			}
			u.Path, u.Phase, u.Percent = path, "done", 100
		})
		versionMu.Lock()
		installed = st.Latest
		versionMu.Unlock()
	}()
	return nil
}

// Restart starts the swapped-in app and ends this one — the daemon included.
//
// The daemon used to stay deliberately: it owns the sessions, and only the
// window came back new. That was wrong, and it cost a whole evening.
//
// The reason: the daemon does not only hold the sessions, it also answers for
// the interface. After an update a new window talked to an old daemon — one
// out of a bundle the swap had already deleted. Everything the new version
// brought along was missing there: the language files came back 404, the
// interface stood unstyled, and nothing said why. Two versions that only have
// to agree on names will disagree sooner or later, and there is no way to see
// it from outside.
//
// So both go. What it costs is bounded and foreseen: registry.load() marks
// sessions that were running as orphaned and keeps the Claude id, so the
// conversation carries on with --resume. What it saves is an app in which
// nothing works and nobody can tell why.
/* Restart brings the whole application back, daemon included.
 *
 * Keeping the daemon alive and replacing only the window is the obvious idea and
 * it is wrong — the comment below this one records the evening it cost. The
 * daemon does not only hold the sessions; it also serves the interface out of
 * its own binary. After a swap that binary belongs to a bundle which no longer
 * exists, so a fresh window talking to it gets a half-missing interface and no
 * explanation. Both have to be the new version or neither.
 *
 * What was genuinely broken here was the order and the waiting, not this. The
 * new version used to be started while the old one still held the single-window
 * place, so it handed itself over and left; and the wait afterwards watched with
 * kill -0, which succeeds on a process that has exited without being reaped.
 *
 * Sessions end with the daemon. That is the price, it is why the dialog asks
 * first, and the dialog now says so instead of promising the opposite.
 */
func (c *Core) Restart() error {
	// Whatever this daemon happens to remember, what gets started is what is
	// installed. Remembering was the only way before, and it made the button
	// refuse whenever the swap had happened in some other lifetime.
	path := c.UpdateProgress().Path
	if path == "" {
		found, err := update.InstalledPath()
		if err != nil {
			return uierr.With("err.update.nothingSwapped", err.Error())
		}
		path = found
	}
	/* Which process is the window.
	 *
	 * Not this one's parent: the daemon detaches at start so that it outlives
	 * the window, and from then on its parent is the system's first process.
	 * Asking for it returned 1, so the relaunch waited for process 1 to end —
	 * for the machine to be switched off — while the daemon closed as planned.
	 * What was left was a window with nothing behind it, saying the connection
	 * was lost. The window announces itself instead.
	 */
	window := daemon.WindowPID()
	if window == 0 {
		// No window said so: plxr is being used through a browser, and there is
		// nothing to wait for but this daemon itself.
		window = os.Getpid()
	}
	if err := update.Restart(path, window); err != nil {
		return err
	}
	go func() {
		// The answer to /api/restart still has to get out.
		time.Sleep(700 * time.Millisecond)
		askToQuit(window)
		c.endSessions()
		os.Exit(0)
	}()
	return nil
}

// endSessions ends every session before the daemon goes.
//
// Without this the shells would survive their owner: the operating system
// hands them to init, and they keep running with nobody attached — invisible,
// and holding on to the working directory and the ports.
func (c *Core) endSessions() {
	c.mu.Lock()
	hosts := make([]*ptyhost.Host, 0, len(c.hosts))
	for _, h := range c.hosts {
		hosts = append(hosts, h)
	}
	c.mu.Unlock()
	for _, h := range hosts {
		h.Kill()
	}
	if len(hosts) > 0 {
		// Kill() asks politely first and follows up after the grace period.
		time.Sleep(ptyhost.KillGrace + 500*time.Millisecond)
	}
}

// Timeline hands out only the marks of a recording. Separate from Playback,
// because the stream is fetched in chunks while the timeline is needed once.
func (c *Core) Timeline(id string) ([]ptyhost.Mark, error) {
	return search.ReadTimeline(ptyhost.RecordingDir, id)
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
	own := map[int]bool{}
	for _, s := range c.reg.List() {
		if s.Alive && s.PID > 0 {
			own[s.PID] = true
		}
	}
	return ports.List(own)
}

func (c *Core) KillPort(pid int, hard bool) error {
	if pid <= 1 {
		return uierr.New("err.port.badPID")
	}
	if pid == os.Getpid() {
		return uierr.New("err.port.wouldBeUs")
	}
	return ports.Kill(pid, hard)
}

// ---- Dateien ----

// root returns the working directory of a session. Every file path the UI sends
// is checked against it.
func (c *Core) root(sessionID string) (string, error) {
	s, ok := c.reg.Get(sessionID)
	if !ok {
		return "", uierr.New("err.session.unknown")
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

// Suggestions helps while a path is being typed. Deliberately unrelated to any
// session: what is being looked for is a directory with no session in it yet.
func (c *Core) Suggestions(input string) []string {
	return files.Suggestions(input, 40)
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
			time.Since(time.UnixMilli(sess.EndedAt)) > deadLinger {
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
			sess.Activity = englishActivity(st.Activity)
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
		// Only while it is running: a loop in a session that ended is history,
		// not a warning. IsStuck caches by the newest mark, so this costs
		// nothing on the ticks where nothing has changed.
		if sess.Alive {
			t.Stuck = marks.IsStuck(sess.ClaudeSessionID)
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
	settings := notify.Read()

	// Which state this session is in now, in the same words the interface uses.
	state := string(sess.Status)
	if sess.Orphaned {
		state = "orphaned"
	} else if !sess.Alive {
		state = "dead"
	}

	c.mu.Lock()
	before, seen := c.lastStatus[sess.ID]
	c.lastStatus[sess.ID] = session.Status(state)
	c.mu.Unlock()

	// Only the moment it changes into that state, never while it stays there.
	if !settings.Wanted(state) || (seen && string(before) == state) {
		return
	}
	// Leave freshly started sessions alone for a moment: on first start Claude
	// Code sometimes shows a trust dialog that has nothing to do with the
	// actual work.
	if time.Since(time.UnixMilli(sess.StartedAt)) < 3*time.Second {
		return
	}

	body := sess.Activity
	if body == "" {
		// The daemon has no language. What a notification says in words is the
		// interface's business — this is the last resort when the session gave
		// no activity line of its own.
		body = "waiting for your answer"
	}
	notify.Send(sess.Label(), body, settings.Sound)
}

/*
---- The queue ----

	One instruction is sent when the agent is actually waiting for one, and not
	before. The check runs on its own clock rather than off the snapshot: the
	snapshot is what a window asks for, and the queue has to keep moving with
	every window closed — that is the whole reason the daemon exists.

	Frozen sessions are skipped. A halted agent is waiting in the sense that it
	writes nothing, and feeding it there would queue up input it can only read
	once somebody lets it run again.
*/
func (c *Core) drainQueues() {
	for _, sess := range c.reg.List() {
		if !sess.Alive {
			continue
		}
		h := c.Host(sess.ID)
		if h == nil || h.Frozen() {
			continue
		}
		/* Ready means two different things, and both count.
		   An agent says so: it asks a question and the status is blocking.
		   A shell says nothing at all — it sits at its prompt and reads as
		   "unknown". Waiting for a shell to ask would mean waiting forever, so
		   quiet counts too, but only quiet: anything still writing is working,
		   and dropping a line into that is how instructions get lost. */
		ready := sess.Status.Blocking() ||
			(sess.Status != session.StatusWorking && h.IdleFor() > 2*time.Second)
		if !ready {
			continue
		}
		item, ok := queue.Take(sess.ID)
		if !ok {
			continue
		}
		if err := c.Answer(sess.ID, item.Text, false); err != nil {
			log.Printf("queue: %s could not be sent to %s: %v", item.Text, sess.ID[:8], err)
		}
	}
}

// WatchQueues sends what is lined up, once a second, for as long as the daemon
// runs.
func (c *Core) WatchQueues() {
	for range time.Tick(time.Second) {
		c.drainQueues()
	}
}

// ---- Workbench: skins of your own ----

// SkinRead hands out the CSS of a skin of your own. A built-in one is read out
// of the binary instead, so the workbench can start from it rather than from an
// empty page — nobody writes a whole visual language from nothing.
func (c *Core) SkinRead(name string) (string, error) {
	if p := theme.SkinPath(name); p != "" {
		if b, err := os.ReadFile(p); err == nil {
			return string(b), nil
		}
	}
	if c.skins == nil {
		return "", uierr.New("err.skin.unknown")
	}
	b, err := fs.ReadFile(c.skins, name+"/skin.css")
	if err != nil {
		return "", uierr.New("err.skin.unknown")
	}
	return string(b), nil
}

// SkinWrite saves a skin of your own.
//
// Deliberately no CSS check: a stylesheet that is half written is the normal
// state while writing one, and a save that refuses because a brace is still
// open would make the workbench unusable. A broken sheet costs the look, not
// the data.
func (c *Core) SkinWrite(name, css string) error {
	p := theme.SkinPath(name)
	if p == "" {
		return uierr.New("err.skin.badName")
	}
	if len(css) > 512*1024 {
		return uierr.New("err.skin.tooLarge")
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return uierr.With("err.skin.saveFailed", err.Error())
	}
	if err := os.WriteFile(p, []byte(css), 0o644); err != nil {
		return uierr.With("err.skin.saveFailed", err.Error())
	}
	return nil
}

// Waiting is the waiting account: how long the agents worked and how long they
// waited for you. See internal/hook/ledger.go for why a single wait is capped.
func (c *Core) Waiting(days int) hook.Report {
	return hook.Waiting(days, time.Now().UnixMilli())
}

// ---- Marks: a snapshot before every instruction ----

// Marks lists the recorded points of a session.
func (c *Core) Marks(sessionID string) []marks.Mark { return marks.List(sessionID) }

// MarkChanges says what has moved since a mark.
//
// A mark that is not there and a git that could not be asked are two different
// answers, and both used to come back as an empty list — which the interface
// reads as "nothing has changed since".
func (c *Core) MarkChanges(sessionID, tree string) ([]marks.Change, error) {
	for _, m := range marks.List(sessionID) {
		if m.Tree == tree {
			return marks.Changed(m.Cwd, tree)
		}
	}
	return nil, uierr.New("err.marks.unknown")
}

// MarkRestore puts one file back the way it stood at the mark.
//
// The tree is looked up among the marks of this session rather than taken from
// the request: otherwise any tree object in any repository could be written
// into any directory.
func (c *Core) MarkRestore(sessionID, tree, path string) error {
	for _, m := range marks.List(sessionID) {
		if m.Tree == tree {
			if err := marks.Restore(m.Cwd, tree, path); err != nil {
				return uierr.With("err.mark.restoreFailed", err.Error())
			}
			return nil
		}
	}
	return uierr.New("err.mark.unknown")
}

// ---- Agent profiles ----

// AgentList names every profile and where it comes from.
func (c *Core) AgentList() []agent.Listed { return agent.Load(c.agents).List() }

// AgentRead hands out the JSON of a profile. A built-in one comes out of the
// binary, so a new one can start from it rather than from an empty page.
func (c *Core) AgentRead(name string) (string, error) {
	if p := agent.ProfilePath(name); p != "" {
		if b, err := os.ReadFile(p); err == nil {
			return string(b), nil
		}
	}
	if c.agents != nil {
		if b, err := fs.ReadFile(c.agents, name+".json"); err == nil {
			return string(b), nil
		}
	}
	return "", uierr.New("err.agent.unknown")
}

// AgentWrite saves a profile of your own.
//
// The JSON is checked, unlike the skin in the workbench: a broken stylesheet
// costs the look, a broken profile costs the status of every session that
// matches it — and silently, because a profile that will not parse is simply
// skipped.
func (c *Core) AgentWrite(name, text string) error {
	p := agent.ProfilePath(name)
	if p == "" {
		return uierr.New("err.agent.badName")
	}
	var probe map[string]any
	if err := json.Unmarshal([]byte(text), &probe); err != nil {
		return uierr.With("err.agent.badJSON", err.Error())
	}
	if s, _ := probe["name"].(string); strings.TrimSpace(s) == "" {
		return uierr.New("err.agent.noName")
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return uierr.With("err.agent.saveFailed", err.Error())
	}
	if err := os.WriteFile(p, []byte(text), 0o644); err != nil {
		return uierr.With("err.agent.saveFailed", err.Error())
	}
	return nil
}

// AgentDelete removes a profile of your own. Built-in ones stay — they live in
// the binary and would be back after the next update anyway.
func (c *Core) AgentDelete(name string) error {
	p := agent.ProfilePath(name)
	if p == "" {
		return uierr.New("err.agent.badName")
	}
	if err := os.Remove(p); err != nil {
		return uierr.New("err.agent.notOwn")
	}
	return nil
}

// AgentStarter is what a new profile begins as.
func (c *Core) AgentStarter(name string) string {
	return fmt.Sprintf(agent.Starter, name, name, name)
}

// ---- Changing files, not only reading them ----

// CreateFile makes a new file or folder inside a session's tree.
func (c *Core) CreateFile(sessionID, path string, dir bool) (*files.Entry, error) {
	root, err := c.root(sessionID)
	if err != nil {
		return nil, err
	}
	return files.Create(root, path, dir)
}

// RenameFile moves something inside a session's tree; both ends stay inside it.
func (c *Core) RenameFile(sessionID, from, to string) (*files.Entry, error) {
	root, err := c.root(sessionID)
	if err != nil {
		return nil, err
	}
	return files.Rename(root, from, to)
}

// RemoveFile deletes for good. Nothing here asks whether that was meant — the
// interface does that, before it calls.
func (c *Core) RemoveFile(sessionID, path string) error {
	root, err := c.root(sessionID)
	if err != nil {
		return err
	}
	return files.Remove(root, path)
}

// GitStatus is what git says about the session's tree, keyed by path relative
// to it. An empty answer means there is nothing to say — including when the
// directory is not a repository at all.
func (c *Core) GitStatus(sessionID string) map[string]files.State {
	root, err := c.root(sessionID)
	if err != nil {
		return map[string]files.State{}
	}
	return files.Status(root)
}

// RevealFile shows a path in whatever this system uses to show files.
func (c *Core) RevealFile(sessionID, path string) error {
	root, err := c.root(sessionID)
	if err != nil {
		return err
	}
	return files.Reveal(root, path)
}
