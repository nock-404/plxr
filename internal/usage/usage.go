// Package usage rechnet den Tokenverbrauch aus den Transkripten aus.
//
// Bewusst nicht über eine API: der Verbrauch steht in jeder Assistenten-Zeile
// des Transkripts, ist damit lokal, vollständig und rückwirkend auswertbar.
// Ein Endpunkt könnte begrenzen, sich ändern oder wegfallen.
//
// Weil das über tausende Dateien geht, wird je Datei gemerkt, was zuletzt
// herauskam; solange Größe und Änderungszeit gleich bleiben, wird sie nicht
// erneut gelesen.
package usage

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"plxr/internal/daemon"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"plxr/internal/accounts"
)

type Item struct {
	In         int64 `json:"ein"`        // input_tokens
	Out        int64 `json:"aus"`        // output_tokens
	CacheWrite int64 `json:"cacheNeu"`   // cache_creation_input_tokens
	CacheRead  int64 `json:"cacheLesen"` // cache_read_input_tokens
	Messages   int64 `json:"nachrichten"`
}

func (p *Item) add(o Item) {
	p.In += o.In
	p.Out += o.Out
	p.CacheWrite += o.CacheWrite
	p.CacheRead += o.CacheRead
	p.Messages += o.Messages
}

// Gesamt ist alles, was gezählt wurde — für eine grobe Größenordnung.
func (p Item) Total() int64 { return p.In + p.Out + p.CacheWrite + p.CacheRead }

type Line struct {
	Key string `json:"schluessel"`
	Item
}

type Report struct {
	Sum       Item   `json:"summe"`
	ByDay     []Line `json:"nachTag"`
	ByProject []Line `json:"nachProjekt"`
	ByModel   []Line `json:"nachModell"`
	ByAccount []Line `json:"nachKonto"`
	Files     int    `json:"dateien"`
	Dauer     string `json:"dauer"`
}

// ---- Zwischenspeicher ----

// eintrag hält, was aus einer Datei herauskam. Die Modelle liegen je Tag, nicht
// als Gesamtsumme: sonst lässt sich ein Zeitraum nicht nach Modell aufteilen.
type entry struct {
	Version int                        `json:"version"`
	Size    int64                      `json:"groesse"`
	Mod     int64                      `json:"mod"`
	Tage    map[string]map[string]Item `json:"tage"` // Tag -> Modell -> Posten
	Projekt string                     `json:"projekt"`
}

// speicherVersion invalidiert alte Zwischenspeicher, wenn sich die Form ändert.
const cacheVersion = 2

type speicher struct {
	mu      sync.Mutex
	File    map[string]entry `json:"datei"`
	path    string
	changed bool
}

func loadCache() *speicher {
	p := filepath.Join(daemon.Root(), "usage-cache.json")
	s := &speicher{File: map[string]entry{}, path: p}
	if b, err := os.ReadFile(p); err == nil {
		json.Unmarshal(b, s)
		if s.File == nil {
			s.File = map[string]entry{}
		}
	}
	return s
}

func (s *speicher) saveCache() {
	if !s.changed {
		return
	}
	b, err := json.Marshal(s)
	if err != nil {
		return
	}
	os.MkdirAll(filepath.Dir(s.path), 0o755)
	tmp := s.path + ".tmp"
	if os.WriteFile(tmp, b, 0o644) == nil {
		os.Rename(tmp, s.path)
	}
}

// ---- Auswertung ----

type rawLine struct {
	Type    string `json:"type"`
	Cwd     string `json:"cwd"`
	Message struct {
		Model string `json:"model"`
		Usage struct {
			Input      int64 `json:"input_tokens"`
			Output     int64 `json:"output_tokens"`
			CacheWrite int64 `json:"cache_creation_input_tokens"`
			CacheRead  int64 `json:"cache_read_input_tokens"`
		} `json:"usage"`
	} `json:"message"`
	Timestamp string `json:"timestamp"`
}

// Rechnen wertet alle Transkripte aus. tage begrenzt auf die letzten n Tage
// (0 = alles).
func Compute(accs []accounts.Account, tage int) Report {
	start := time.Now()
	sp := loadCache()

	type job struct {
		path, account string
		size, mod     int64
	}
	var jobs []job
	gesehen := map[string]bool{}
	for _, a := range accs {
		dirs, _ := os.ReadDir(a.ProjectsDir())
		for _, d := range dirs {
			if !d.IsDir() {
				continue
			}
			pdir := filepath.Join(a.ProjectsDir(), d.Name())
			files, _ := os.ReadDir(pdir)
			for _, f := range files {
				if f.IsDir() || !strings.HasSuffix(f.Name(), ".jsonl") {
					continue
				}
				// Dieselbe Session liegt in mehreren Konten. Doppelt zählen
				// würde den Verbrauch verdreifachen.
				if gesehen[f.Name()] {
					continue
				}
				gesehen[f.Name()] = true
				info, err := f.Info()
				if err != nil {
					continue
				}
				jobs = append(jobs, job{filepath.Join(pdir, f.Name()), a.Name, info.Size(), info.ModTime().UnixMilli()})
			}
		}
	}

	arbeiter := runtime.NumCPU()
	if arbeiter > 8 {
		arbeiter = 8
	}
	rein := make(chan job)
	type erg struct {
		account string
		e       entry
	}
	raus := make(chan erg, 64)
	var wg sync.WaitGroup
	for i := 0; i < arbeiter; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range rein {
				sp.mu.Lock()
				old, ok := sp.File[j.path]
				sp.mu.Unlock()
				if ok && old.Version == cacheVersion && old.Size == j.size && old.Mod == j.mod {
					raus <- erg{j.account, old}
					continue
				}
				e := readAll(j.path)
				e.Version, e.Size, e.Mod = cacheVersion, j.size, j.mod
				sp.mu.Lock()
				sp.File[j.path] = e
				sp.changed = true
				sp.mu.Unlock()
				raus <- erg{j.account, e}
			}
		}()
	}
	go func() {
		for _, j := range jobs {
			rein <- j
		}
		close(rein)
		wg.Wait()
		close(raus)
	}()

	grenze := ""
	if tage > 0 {
		grenze = time.Now().AddDate(0, 0, -tage).Format("2006-01-02")
	}

	b := Report{Files: len(jobs)}
	tag := map[string]*Item{}
	proj := map[string]*Item{}
	mod := map[string]*Item{}
	account := map[string]*Item{}
	hol := func(m map[string]*Item, k string) *Item {
		if m[k] == nil {
			m[k] = &Item{}
		}
		return m[k]
	}

	for r := range raus {
		projekt := r.e.Projekt
		if projekt == "" {
			projekt = "(unbekannt)"
		}
		for t, nachModell := range r.e.Tage {
			if grenze != "" && t < grenze {
				continue
			}
			for m, p := range nachModell {
				b.Sum.add(p)
				hol(tag, t).add(p)
				hol(proj, projekt).add(p)
				hol(account, r.account).add(p)
				if m != "" {
					hol(mod, m).add(p)
				}
			}
		}
	}
	sp.saveCache()

	b.ByDay = sorted(tag, true)
	b.ByProject = sorted(proj, false)
	b.ByModel = sorted(mod, false)
	// Bei gespiegelten Transkripten wäre die Kontoaufteilung Zufall: dieselbe
	// Session liegt in mehreren Konten, gezählt wird sie beim erstbesten.
	// Dann lieber nichts zeigen als etwas Falsches.
	b.ByAccount = sorted(account, false)
	if len(b.ByAccount) < 2 {
		b.ByAccount = []Line{}
	}
	b.Dauer = time.Since(start).Round(time.Millisecond).String()
	return b
}

// sortiert gibt die Zeilen aus; nachSchlüssel absteigend (für Tage), sonst
// nach Menge absteigend.
func sorted(m map[string]*Item, byKey bool) []Line {
	out := make([]Line, 0, len(m))
	for k, p := range m {
		out = append(out, Line{Key: k, Item: *p})
	}
	if byKey {
		sort.Slice(out, func(i, j int) bool { return out[i].Key > out[j].Key })
	} else {
		sort.Slice(out, func(i, j int) bool { return out[i].Total() > out[j].Total() })
	}
	return out
}

func readAll(path string) entry {
	e := entry{Tage: map[string]map[string]Item{}}
	f, err := os.Open(path)
	if err != nil {
		return e
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 4<<20)
	for sc.Scan() {
		roh := sc.Bytes()
		if len(roh) == 0 || roh[0] != '{' {
			continue
		}
		var z rawLine
		if json.Unmarshal(roh, &z) != nil {
			continue
		}
		if z.Cwd != "" && e.Projekt == "" {
			e.Projekt = filepath.Base(z.Cwd)
		}
		if z.Type != "assistant" {
			continue
		}
		u := z.Message.Usage
		if u.Input == 0 && u.Output == 0 && u.CacheWrite == 0 && u.CacheRead == 0 {
			continue
		}
		p := Item{In: u.Input, Out: u.Output, CacheWrite: u.CacheWrite, CacheRead: u.CacheRead, Messages: 1}

		tag := "unbekannt"
		if len(z.Timestamp) >= 10 {
			tag = z.Timestamp[:10]
		}
		modell := z.Message.Model
		if modell == "<synthetic>" {
			modell = ""
		}
		if e.Tage[tag] == nil {
			e.Tage[tag] = map[string]Item{}
		}
		old := e.Tage[tag][modell]
		old.add(p)
		e.Tage[tag][modell] = old
	}
	return e
}

// ---- Verbrauchstempo ----

// Tempo beschreibt, wie schnell gerade Kontingent verbraucht wird.
//
// Claude-Abos rechnen in rollenden Fenstern — fünf Stunden und eine Woche.
// Wer acht Agenten gleichzeitig fährt, reißt das Fünf-Stunden-Fenster, ohne
// es kommen zu sehen. Die Zahlen dafür stehen in den Transkripten; hier
// werden sie auf ein Tempo hochgerechnet.
type Pace struct {
	// Fenster5h ist der Verbrauch der letzten fünf Stunden.
	Fenster5h int64 `json:"fenster5h"`
	// ProStunde ist das Tempo der letzten Stunde, hochgerechnet.
	ProStunde int64 `json:"proStunde"`
	// Aktive ist die Zahl der Sessions, die in der letzten Stunde etwas
	// verbraucht haben — das erklärt das Tempo.
	Aktive int `json:"aktive"`
	// Trend ist "steigt", "faellt" oder "gleich", verglichen mit der Stunde davor.
	Trend string `json:"trend"`
}

// TempoRechnen wertet nur die zuletzt geänderten Transkripte aus — alles
// andere kann per Definition nichts zum aktuellen Tempo beitragen.
func ComputePace(accs []accounts.Account) Pace {
	jetzt := time.Now()
	grenze5h := jetzt.Add(-5 * time.Hour)
	grenze1h := jetzt.Add(-time.Hour)
	grenze2h := jetzt.Add(-2 * time.Hour)

	var t Pace
	var vorstunde int64
	aktive := map[string]bool{}
	gesehen := map[string]bool{}

	for _, a := range accs {
		dirs, _ := os.ReadDir(a.ProjectsDir())
		for _, d := range dirs {
			if !d.IsDir() {
				continue
			}
			pdir := filepath.Join(a.ProjectsDir(), d.Name())
			files, _ := os.ReadDir(pdir)
			for _, f := range files {
				if f.IsDir() || !strings.HasSuffix(f.Name(), ".jsonl") || gesehen[f.Name()] {
					continue
				}
				info, err := f.Info()
				// Wer seit über fünf Stunden nicht angefasst wurde, zählt nicht.
				if err != nil || info.ModTime().Before(grenze5h) {
					continue
				}
				gesehen[f.Name()] = true
				path := filepath.Join(pdir, f.Name())
				f5, f1, f2 := window(path, grenze5h, grenze1h, grenze2h)
				t.Fenster5h += f5
				t.ProStunde += f1
				vorstunde += f2
				if f1 > 0 {
					aktive[f.Name()] = true
				}
			}
		}
	}

	t.Aktive = len(aktive)
	switch {
	case vorstunde == 0 && t.ProStunde > 0:
		t.Trend = "steigt"
	case t.ProStunde > vorstunde*6/5:
		t.Trend = "steigt"
	case t.ProStunde*6/5 < vorstunde:
		t.Trend = "faellt"
	default:
		t.Trend = "gleich"
	}
	return t
}

// zeitfenster liest eine Datei von hinten und summiert drei Zeiträume.
func window(path string, g5, g1, g2 time.Time) (f5, f1, f2 int64) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	// Nur das Ende lesen: ältere Einträge liegen per Definition außerhalb.
	info, err := f.Stat()
	if err != nil {
		return
	}
	const fenster = 4 << 20
	if von := info.Size() - fenster; von > 0 {
		f.Seek(von, 0)
	}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 4<<20)
	sc.Scan() // angeschnittene erste Zeile

	for sc.Scan() {
		roh := sc.Bytes()
		if len(roh) == 0 || roh[0] != '{' {
			continue
		}
		var z rawLine
		if json.Unmarshal(roh, &z) != nil || z.Type != "assistant" {
			continue
		}
		ts, err := time.Parse(time.RFC3339, z.Timestamp)
		if err != nil || ts.Before(g5) {
			continue
		}
		u := z.Message.Usage
		summe := int64(u.Input + u.Output + u.CacheWrite + u.CacheRead)
		f5 += summe
		if ts.After(g1) {
			f1 += summe
		} else if ts.After(g2) {
			f2 += summe
		}
	}
	return
}
