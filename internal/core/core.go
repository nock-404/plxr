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
	"plxr/internal/files"
	"plxr/internal/fleet"
	"plxr/internal/hook"
	"plxr/internal/notify"
	"plxr/internal/ports"
	"plxr/internal/ptyhost"
	"plxr/internal/rules"
	"plxr/internal/search"
	"plxr/internal/session"
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
	Frage string `json:"frage,omitempty"`
}

// frageAus schneidet aus dem Bildschirm heraus, was nach einer Rückfrage
// aussieht.
//
// Ein Agent, der wartet, hat die Frage üblicherweise als Letztes geschrieben,
// oft mit nummerierten Antwortmöglichkeiten darunter. Wir nehmen ab der
// letzten Leerzeile vor dem ersten Fragezeichen — das trifft die üblichen
// Formen, ohne den halben Bildschirm mitzuschleppen.
func frageAus(schirm string) string {
	zeilen := strings.Split(strings.TrimRight(schirm, "\n"), "\n")
	if len(zeilen) == 0 {
		return ""
	}
	// Von hinten die letzte Zeile mit Fragezeichen oder Auswahlmarke suchen.
	ende := len(zeilen)
	start := -1
	for i := len(zeilen) - 1; i >= 0 && i > len(zeilen)-18; i-- {
		l := strings.TrimSpace(zeilen[i])
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
		start = len(zeilen) - 6
		if start < 0 {
			start = 0
		}
	}
	teil := strings.Join(zeilen[start:ende], "\n")
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
func (c *Core) Create(cwd string, cmd []string, name, konto string) (*session.Session, error) {
	if cwd == "" {
		cwd, _ = os.UserHomeDir()
	}
	if fi, err := os.Stat(cwd); err != nil || !fi.IsDir() {
		return nil, errors.New("Verzeichnis gibt es nicht: " + cwd)
	}
	if len(cmd) == 0 {
		cmd = shell.Standard()
	}

	acc, _ := accounts.ByName(c.Accounts(), konto)
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

// aufraeumen entfernt eine beendete Session samt ihrem PTY-Eintrag.
func (c *Core) aufraeumen(id string) {
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
func (c *Core) Antworten(id, text string) error {
	h := c.Host(id)
	if h == nil {
		return errors.New("Session läuft nicht")
	}
	if !strings.HasSuffix(text, "\r") && !strings.HasSuffix(text, "\n") {
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
func (c *Core) Agents() []agent.Profile                      { return agent.Load(c.agents).All() }

// ---- Konten und Archiv ----

func (c *Core) Accounts() []accounts.Account { return accounts.Discover() }

func (c *Core) Archive(pathFilter string) []archive.Entry {
	return archive.List(c.Accounts(), pathFilter)
}

func (c *Core) archiveFind(id, konto string) (archive.Entry, bool) {
	for _, e := range archive.List(c.Accounts(), "") {
		if e.ID == id && (konto == "" || e.Account == konto) {
			return e, true
		}
	}
	return archive.Entry{}, false
}

// Suche durchsucht alle Transkripte im Volltext.
func (c *Core) Suche(frage string, nurEigene bool) []search.Treffer {
	return search.Suche(c.Accounts(), frage, nurEigene)
}

func (c *Core) ArchiveDelete(id, konto string) error {
	e, ok := c.archiveFind(id, konto)
	if !ok {
		return errors.New("Transkript nicht gefunden")
	}
	return archive.Delete(e)
}

// Resume nimmt ein abgelegtes Transkript wieder auf — bei Bedarf unter einem
// anderen Konto. Dafür muss die Datei erst dorthin gespiegelt werden, weil
// Claude Code nur unter dem eigenen Konfigurationsverzeichnis sucht.
func (c *Core) Resume(id, quellKonto, zielKonto string) (*session.Session, error) {
	e, ok := c.archiveFind(id, quellKonto)
	if !ok {
		return nil, errors.New("Transkript nicht gefunden")
	}
	if e.Cwd == "" {
		return nil, errors.New("Arbeitsverzeichnis der Session unbekannt")
	}
	if _, err := os.Stat(e.Cwd); err != nil {
		return nil, errors.New("Arbeitsverzeichnis gibt es nicht mehr: " + e.Cwd)
	}

	ziel := zielKonto
	if ziel == "" {
		ziel = e.Account
	}
	if ziel != e.Account {
		acc, ok := accounts.ByName(c.Accounts(), ziel)
		if !ok {
			return nil, errors.New("Konto gibt es nicht: " + ziel)
		}
		if _, err := archive.Spiegeln(e, acc); err != nil {
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
func (c *Core) Wiederaufnehmen(sessionID string) (*session.Session, error) {
	s, ok := c.reg.Get(sessionID)
	if !ok {
		return nil, errors.New("Session gibt es nicht")
	}
	cwd, konto, cmd, claudeID := s.Cwd, s.Account, s.Cmd, s.ClaudeSessionID
	c.aufraeumen(sessionID)

	if claudeID != "" {
		return c.Create(cwd, []string{"claude", "--resume", claudeID}, s.Name, konto)
	}
	// Kein Transkript: dann eben das Kommando erneut, im selben Verzeichnis.
	return c.Create(cwd, cmd, s.Name, konto)
}

// SwitchAccount hängt eine laufende Session auf ein anderes Konto um: Prozess
// beenden, Transkript spiegeln, unter dem neuen Konto fortsetzen. Das ist der
// Weg, wenn ein Kontingent aufgebraucht ist.
func (c *Core) SwitchAccount(sessionID, zielKonto string) (*session.Session, error) {
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
	return c.Resume(claudeID, quelle, zielKonto)
}

// ---- Verbrauch ----

func (c *Core) Verbrauch(tage int) usage.Bericht { return usage.Rechnen(c.Accounts(), tage) }

// ---- Anbindung an Claude Code ----

// HookStand sagt, ob plxr dort einträgt und welches Verzeichnis gemeint ist.
func (c *Core) HookStand() map[string]any {
	acc, _ := accounts.ByName(c.Accounts(), "")
	return map[string]any{
		"eingerichtet": hook.Eingerichtet(acc.Dir),
		"dir":          acc.Dir,
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
		if _, err := hook.Einrichten(a.Dir, !an); err != nil {
			return err
		}
	}
	return nil
}

// ---- Fassung ----

// Version wird beim Start aus main gesetzt.
var Version = "dev"

func (c *Core) VersionStand() update.Stand { return update.Prüfen(Version) }

// UpdateStand ist der Fortschritt einer laufenden Aktualisierung. Die
// Oberfläche fragt ihn ab, statt auf einen Aufruf zu warten, der Minuten
// dauern kann.
type UpdateStand struct {
	Läuft   bool   `json:"laeuft"`
	Prozent int    `json:"prozent"`
	Phase   string `json:"phase"`
	Ort     string `json:"ort,omitempty"`
	Fehler  string `json:"fehler,omitempty"`
	Fertig  bool   `json:"fertig"`
}

var updateStand UpdateStand
var updateSperre sync.Mutex

func (c *Core) UpdateFortschritt() UpdateStand {
	updateSperre.Lock()
	defer updateSperre.Unlock()
	return updateStand
}

func setzeStand(fn func(*UpdateStand)) {
	updateSperre.Lock()
	fn(&updateStand)
	updateSperre.Unlock()
}

// Update startet die Aktualisierung und kehrt sofort zurück. Der Fortschritt
// läuft über UpdateFortschritt — ein Aufruf, der bis zum Ende blockiert,
// lässt die Oberfläche minutenlang tot aussehen.
func (c *Core) Update() error {
	updateSperre.Lock()
	if updateStand.Läuft {
		updateSperre.Unlock()
		return errors.New("läuft bereits")
	}
	st := update.Prüfen(Version)
	if st.Fehler != "" {
		updateSperre.Unlock()
		return errors.New(st.Fehler)
	}
	if !st.Verfügbar {
		updateSperre.Unlock()
		return errors.New("es gibt nichts Neueres")
	}
	updateStand = UpdateStand{Läuft: true, Phase: "lädt"}
	updateSperre.Unlock()

	go func() {
		ort, err := update.Anwenden(st.AssetURL, func(gelesen, gesamt int64) {
			if gesamt <= 0 {
				return
			}
			setzeStand(func(u *UpdateStand) {
				u.Prozent = int(gelesen * 100 / gesamt)
				if u.Prozent >= 100 {
					u.Phase = "tauscht aus"
				}
			})
		})
		setzeStand(func(u *UpdateStand) {
			u.Läuft = false
			u.Fertig = true
			if err != nil {
				u.Fehler = err.Error()
				u.Phase = "fehlgeschlagen"
				return
			}
			u.Ort, u.Phase, u.Prozent = ort, "fertig", 100
		})
	}()
	return nil
}

// NeuStarten startet die getauschte App und beendet diese.
//
// Der Daemon läuft weiter — er ist ein eigener Prozess, und die Sessions
// gehören ihm. Nur das Fenster kommt neu, mit der neuen Fassung. Genau
// deshalb bleibt beim Update alles beim Alten.
func (c *Core) NeuStarten() error {
	st := c.UpdateFortschritt()
	if st.Ort == "" {
		return errors.New("nichts eingesetzt")
	}
	return update.NeuStarten(st.Ort)
}

// ---- Regeln und Ports ----

// Rules löst auf, welche Anweisungsdateien in einer Session wirken. Ohne
// Session-ID gilt das übergebene Verzeichnis.
func (c *Core) Rules(sessionID, dir string) []rules.Eintrag {
	konto := ""
	if sessionID != "" {
		if s, ok := c.reg.Get(sessionID); ok {
			dir, konto = s.Cwd, s.Account
		}
	}
	if dir == "" {
		return []rules.Eintrag{}
	}
	acc, _ := accounts.ByName(c.Accounts(), konto)
	return rules.Resolve(dir, acc.Dir)
}

// Ports listet die belegten Ports und markiert, welche zu plxr-Sessions gehören.
func (c *Core) Ports() []ports.Eintrag {
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
func (c *Core) Vorschlaege(eingabe string) []string {
	return files.Vorschlaege(eingabe, 40)
}

func (c *Core) WriteFile(sessionID, path, text string, stand int64) (*files.Content, error) {
	root, err := c.root(sessionID)
	if err != nil {
		return nil, err
	}
	return files.Write(root, path, text, stand)
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
		if !sess.Alive && !sess.Verwaist && sess.EndedAt > 0 &&
			time.Since(time.UnixMilli(sess.EndedAt)) > totNachlauf {
			c.aufraeumen(sess.ID)
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
			t.Frage = frageAus(screen)
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
