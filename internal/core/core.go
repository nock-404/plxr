// Package core ist die Anwendung ohne Oberfläche.
//
// Er besitzt die PTYs, führt Registry, fleet-Zustand und Agent-Profile
// zusammen und kennt keinen Transport. Darüber liegen zwei austauschbare
// Schichten: das Desktop-Fenster (Wails) und ein HTTP-Server für den Browser.
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

// Tile ist eine Session plus dem, was die Oberfläche sonst noch anzeigt.
type Tile struct {
	session.Session
	Preview string `json:"preview"`
	// Frage ist der Teil des Bildschirms, der die Rückfrage enthält — für den
	// Posteingang, damit man antworten kann, ohne die Session zu öffnen.
	Question string `json:"frage,omitempty"`
}

// frageAus schneidet aus dem Bildschirm heraus, was nach einer Rückfrage
// aussieht.
//
// Ein Agent, der wartet, hat die Frage üblicherweise als Letztes geschrieben,
// oft mit nummerierten Antwortmöglichkeiten darunter. Wir nehmen ab der
// letzten Leerzeile vor dem ersten Fragezeichen — das trifft die üblichen
// Formen, ohne den halben Bildschirm mitzuschleppen.
func questionFromScreen(screen string) string {
	lines := strings.Split(strings.TrimRight(screen, "\n"), "\n")
	if len(lines) == 0 {
		return ""
	}
	// Von hinten die letzte Zeile mit Fragezeichen oder Auswahlmarke suchen.
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
		// Keine erkennbare Frage: die letzten Zeilen reichen als Anhaltspunkt.
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

// Create startet ein Kommando. konto wählt das Claude-Konfigurationsverzeichnis;
// leer heißt Standardkonto.
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

// totNachlauf ist, wie lange eine beendete Session noch angezeigt wird.
const totNachlauf = 90 * time.Second

// MitschnitteAufraeumen wirft weg, was zu alt oder zu viel ist.
//
// Ohne Grenze wächst das Verzeichnis endlos. 30 Tage decken die Frage
// "wo war das nochmal" ab; wer weiter zurück muss, hat ohnehin das Transkript.
func (c *Core) PruneRecordings() {
	dir := ptyhost.RecordingDir
	if dir == "" {
		return
	}
	eintraege, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	grenze := time.Now().AddDate(0, 0, -30)
	lebt := map[string]bool{}
	for _, s := range c.reg.List() {
		lebt[s.ID+".log"] = true
	}
	for _, e := range eintraege {
		if lebt[e.Name()] {
			continue
		}
		info, err := e.Info()
		if err == nil && info.ModTime().Before(grenze) {
			os.Remove(filepath.Join(dir, e.Name()))
		}
	}
}

// aufraeumen entfernt eine beendete Session samt ihrem PTY-Eintrag.
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

// Antworten schickt Text an eine Session, ohne dass ein Terminal offen ist.
//
// Der Posteingang lebt davon: acht Agenten, drei warten — man will sie
// abarbeiten, nicht jede einzeln öffnen.
func (c *Core) Answer(id, text string, roh bool) error {
	h := c.Host(id)
	if h == nil {
		return errors.New("Session läuft nicht")
	}
	// Ein Zeilenumbruch schickt die Antwort ab. Bei einer Steuertaste wie
	// Escape wäre er falsch — die soll für sich allein ankommen.
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

// ThemeLöschen entfernt ein eigenes Theme. Wer drei ausprobiert hat, will sie
// wieder loswerden — die eingebauten bleiben unantastbar.
func (c *Core) ThemeDelete(name string) error { return theme.Delete(name) }

// ---- Vorlagen ----

func (c *Core) Templates() []template.Template { return template.Load(daemon.Root()) }

// VorlageStarten öffnet alle Sessions einer Vorlage. Fehler bei einzelnen
// werden gesammelt statt abgebrochen — sieben von acht Sessions sind besser
// als keine, nur weil ein Verzeichnis verschwunden ist.
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

// VorlageAusLage macht aus dem, was gerade offen ist, eine Vorlage.
func (c *Core) TemplateFromState(name, label string) error {
	var eintraege []template.Entry
	for _, s := range c.reg.List() {
		if !s.Alive {
			continue
		}
		eintraege = append(eintraege, template.Entry{
			Cwd: s.Cwd, Cmd: s.Cmd, Name: s.Name, Account: s.Account,
		})
	}
	return template.Save(daemon.Root(), template.Template{
		Name: name, Label: label, Sessions: eintraege,
	})
}

func (c *Core) TemplateDelete(name string) error { return template.Delete(daemon.Root(), name) }

// ---- Konten und Archiv ----

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
// Sessions, die es längst nicht mehr gibt.
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

// Resume nimmt ein abgelegtes Transkript wieder auf — bei Bedarf unter einem
// anderen Konto. Dafür muss die Datei erst dorthin gespiegelt werden, weil
// Claude Code nur unter dem eigenen Konfigurationsverzeichnis sucht.
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

	ziel := toAccount
	if ziel == "" {
		ziel = e.Account
	}
	if ziel != e.Account {
		acc, ok := accounts.ByName(c.Accounts(), ziel)
		if !ok {
			return nil, errors.New("Konto gibt es nicht: " + ziel)
		}
		if _, err := archive.Mirror(e, acc); err != nil {
			return nil, errors.New("Transkript ließ sich nicht ins Zielkonto kopieren: " + err.Error())
		}
	}

	name := e.Title
	if name == "" {
		name = e.Project
	}
	return c.Create(e.Cwd, []string{"claude", "--resume", e.ID}, name, ziel)
}

// Wiederaufnehmen startet eine verwaiste Session neu.
//
// Der Prozess ist weg, aber bei Claude Code steht die Unterhaltung im
// Transkript — mit --resume geht es dort weiter, wo der Absturz war.
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
	// Kein Transkript: dann eben das Kommando erneut, im selben Verzeichnis.
	return c.Create(cwd, cmd, s.Name, account)
}

// SwitchAccount hängt eine laufende Session auf ein anderes Konto um: Prozess
// beenden, Transkript spiegeln, unter dem neuen Konto fortsetzen. Das ist der
// Weg, wenn ein Kontingent aufgebraucht ist.
func (c *Core) SwitchAccount(sessionID, toAccount string) (*session.Session, error) {
	s, ok := c.reg.Get(sessionID)
	if !ok {
		return nil, errors.New("Session gibt es nicht")
	}
	claudeID := s.ClaudeSessionID
	if claudeID == "" {
		return nil, errors.New("für diese Session ist keine Claude-Session-ID bekannt — läuft dort überhaupt Claude Code?")
	}
	quelle := s.Account
	c.Kill(sessionID, true)
	return c.Resume(claudeID, quelle, toAccount)
}

// ---- Verbrauch ----

func (c *Core) Verbrauch(tage int) usage.Report { return usage.Compute(c.Accounts(), tage) }

// ---- Anbindung an Claude Code ----

// HookStand sagt, ob plxr dort einträgt und welches Verzeichnis gemeint ist.
// HookStand meldet, ob alle Konten angebunden sind — nicht nur das erste.
// HookSetzen trägt in alle ein; nur das erste zu prüfen hieße "eingerichtet"
// anzuzeigen, während zwei Konten stumm bleiben.
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

// HookSetzen trägt plxr ein oder aus — in allen gefundenen Konten, denn wer
// mehrere Zugänge fährt, will den Zustand aus allen sehen.
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

// Version wird beim Start aus main gesetzt.
var Version = "dev"

// Nach einem Update zeigt Version auf die Fassung, die auf der Platte liegt —
// nicht auf die, mit der dieser Prozess gestartet ist. Der Daemon läuft
// bewusst weiter, ihm gehören die Sessions; melden muss er trotzdem, was
// installiert ist. Sonst bliebe der Hinweis "neue Fassung" stehen und lüde
// dasselbe Paket immer wieder.
var versionMu sync.RWMutex

func currentVersion() string {
	versionMu.RLock()
	defer versionMu.RUnlock()
	return Version
}

func (c *Core) VersionStatus() update.Status { return update.Check(currentVersion()) }

// UpdateStand ist der Fortschritt einer laufenden Aktualisierung. Die
// Oberfläche fragt ihn ab, statt auf einen Aufruf zu warten, der Minuten
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

// Update startet die Aktualisierung und kehrt sofort zurück. Der Fortschritt
// läuft über UpdateFortschritt — ein Aufruf, der bis zum Ende blockiert,
// lässt die Oberfläche minutenlang tot aussehen.
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
		ort, err := update.Apply(st.AssetURL, func(read, gesamt int64) {
			if gesamt <= 0 {
				return
			}
			setStatus(func(u *UpdateStatus) {
				u.Percent = int(read * 100 / gesamt)
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

// NeuStarten startet die getauschte App und beendet diese.
//
// Der Daemon läuft weiter — er ist ein eigener Prozess, und die Sessions
// gehören ihm. Nur das Fenster kommt neu, mit der neuen Fassung. Genau
// deshalb bleibt beim Update alles beim Alten.
func (c *Core) Restart() error {
	st := c.UpdateFortschritt()
	if st.Path == "" {
		return errors.New("nichts eingesetzt")
	}
	return update.Restart(st.Path)
}

// ---- Regeln und Ports ----

// Rules löst auf, welche Anweisungsdateien in einer Session wirken. Ohne
// Session-ID gilt das übergebene Verzeichnis.
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

// Ports listet die belegten Ports und markiert, welche zu plxr-Sessions gehören.
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

// root liefert das Arbeitsverzeichnis einer Session. Alles, was die Oberfläche
// an Dateipfaden schickt, wird dagegen geprüft.
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
// gesucht wird ein Verzeichnis, in dem noch keine Session läuft.
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

// ---- Zustand zusammenführen ----

// Snapshot verheiratet Registry, laufende PTYs und den fleet-Zustand.
func (c *Core) Snapshot(pathFilter string) []Tile {
	agents := agent.Load(c.agents)
	states := fleet.Read(fleet.Dir())

	byPID := map[int]fleet.State{}
	for _, st := range states {
		// Nur den jüngsten Eintrag je PID behalten.
		if old, ok := byPID[st.PID]; !ok || st.UpdatedAt > old.UpdatedAt {
			byPID[st.PID] = st
		}
	}

	out := []Tile{}
	for _, sess := range c.reg.List() {
		if pathFilter != "" && !strings.HasPrefix(sess.Cwd, pathFilter) {
			continue
		}
		// Beendete Sessions kurz stehen lassen, damit man den Exit-Code noch
		// sieht, dann wegräumen. Verwaiste bleiben: sie stehen für Arbeit, die
		// niemand beenden wollte, und verschwinden erst, wenn jemand sie
		// wegklickt oder fortsetzt.
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

		// Einmal rendern, zweimal verwenden — Vorschau und Statuserkennung.
		screen := ""
		if h != nil {
			screen = h.Tail(18)
		}
		if sess.Alive && !useFleet && h != nil {
			// Kein Selbstauskunft-Hook: Status aus Bildschirm und Ruhe ableiten.
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

		t := Tile{Session: sess, Preview: screen}
		if sess.Alive && sess.Status == session.StatusPermission {
			t.Question = questionFromScreen(screen)
		}
		out = append(out, t)
		c.checkEdge(sess)
	}
	return out
}

// checkEdge feuert eine Benachrichtigung, wenn eine Session neu blockiert.
//
// Verglichen wird "blockiert ja/nein", nicht der Status selbst: sonst meldet
// jeder Wechsel zwischen waiting und permission erneut. Und eine noch nie
// gesehene Session gilt als vorher nicht blockiert — startet ein Agent sofort
// mit einer Rückfrage, wäre die erste Beobachtung sonst verschluckt und es
// käme nie eine Meldung.
func (c *Core) checkEdge(sess session.Session) {
	jetzt := sess.Alive && sess.Status == session.StatusPermission

	c.mu.Lock()
	vorher, gesehen := c.lastStatus[sess.ID]
	c.lastStatus[sess.ID] = sess.Status
	c.mu.Unlock()

	warVorher := gesehen && vorher == session.StatusPermission
	if !jetzt || warVorher {
		return
	}
	// Ganz frisch gestartete Sessions kurz in Ruhe lassen: Claude Code zeigt
	// beim ersten Start manchmal einen Vertrauensdialog, der nichts mit der
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
