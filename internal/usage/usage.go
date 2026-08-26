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
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"plxr/internal/accounts"
)

type Posten struct {
	Ein         int64 `json:"ein"`        // input_tokens
	Aus         int64 `json:"aus"`        // output_tokens
	CacheNeu    int64 `json:"cacheNeu"`   // cache_creation_input_tokens
	CacheLesen  int64 `json:"cacheLesen"` // cache_read_input_tokens
	Nachrichten int64 `json:"nachrichten"`
}

func (p *Posten) plus(o Posten) {
	p.Ein += o.Ein
	p.Aus += o.Aus
	p.CacheNeu += o.CacheNeu
	p.CacheLesen += o.CacheLesen
	p.Nachrichten += o.Nachrichten
}

// Gesamt ist alles, was gezählt wurde — für eine grobe Größenordnung.
func (p Posten) Gesamt() int64 { return p.Ein + p.Aus + p.CacheNeu + p.CacheLesen }

type Zeile struct {
	Schlüssel string `json:"schluessel"`
	Posten
}

type Bericht struct {
	Summe       Posten  `json:"summe"`
	NachTag     []Zeile `json:"nachTag"`
	NachProjekt []Zeile `json:"nachProjekt"`
	NachModell  []Zeile `json:"nachModell"`
	NachKonto   []Zeile `json:"nachKonto"`
	Dateien     int     `json:"dateien"`
	Dauer       string  `json:"dauer"`
}

// ---- Zwischenspeicher ----

// eintrag hält, was aus einer Datei herauskam. Die Modelle liegen je Tag, nicht
// als Gesamtsumme: sonst lässt sich ein Zeitraum nicht nach Modell aufteilen.
type eintrag struct {
	Version int                          `json:"version"`
	Größe   int64                        `json:"groesse"`
	Mod     int64                        `json:"mod"`
	Tage    map[string]map[string]Posten `json:"tage"` // Tag -> Modell -> Posten
	Projekt string                       `json:"projekt"`
}

// speicherVersion invalidiert alte Zwischenspeicher, wenn sich die Form ändert.
const speicherVersion = 2

type speicher struct {
	mu       sync.Mutex
	Datei    map[string]eintrag `json:"datei"`
	pfad     string
	geändert bool
}

func ladeSpeicher() *speicher {
	home, _ := os.UserHomeDir()
	p := filepath.Join(home, ".plxr", "usage-cache.json")
	s := &speicher{Datei: map[string]eintrag{}, pfad: p}
	if b, err := os.ReadFile(p); err == nil {
		json.Unmarshal(b, s)
		if s.Datei == nil {
			s.Datei = map[string]eintrag{}
		}
	}
	return s
}

func (s *speicher) sichern() {
	if !s.geändert {
		return
	}
	b, err := json.Marshal(s)
	if err != nil {
		return
	}
	os.MkdirAll(filepath.Dir(s.pfad), 0o755)
	tmp := s.pfad + ".tmp"
	if os.WriteFile(tmp, b, 0o644) == nil {
		os.Rename(tmp, s.pfad)
	}
}

// ---- Auswertung ----

type zeileRoh struct {
	Type    string `json:"type"`
	Cwd     string `json:"cwd"`
	Message struct {
		Model string `json:"model"`
		Usage struct {
			Input      int64 `json:"input_tokens"`
			Output     int64 `json:"output_tokens"`
			CacheNeu   int64 `json:"cache_creation_input_tokens"`
			CacheLesen int64 `json:"cache_read_input_tokens"`
		} `json:"usage"`
	} `json:"message"`
	Timestamp string `json:"timestamp"`
}

// Rechnen wertet alle Transkripte aus. tage begrenzt auf die letzten n Tage
// (0 = alles).
func Rechnen(accs []accounts.Account, tage int) Bericht {
	start := time.Now()
	sp := ladeSpeicher()

	type job struct {
		pfad, konto string
		größe, mod  int64
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
		konto string
		e     eintrag
	}
	raus := make(chan erg, 64)
	var wg sync.WaitGroup
	for i := 0; i < arbeiter; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range rein {
				sp.mu.Lock()
				alt, ok := sp.Datei[j.pfad]
				sp.mu.Unlock()
				if ok && alt.Version == speicherVersion && alt.Größe == j.größe && alt.Mod == j.mod {
					raus <- erg{j.konto, alt}
					continue
				}
				e := lesen(j.pfad)
				e.Version, e.Größe, e.Mod = speicherVersion, j.größe, j.mod
				sp.mu.Lock()
				sp.Datei[j.pfad] = e
				sp.geändert = true
				sp.mu.Unlock()
				raus <- erg{j.konto, e}
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

	b := Bericht{Dateien: len(jobs)}
	tag := map[string]*Posten{}
	proj := map[string]*Posten{}
	mod := map[string]*Posten{}
	konto := map[string]*Posten{}
	hol := func(m map[string]*Posten, k string) *Posten {
		if m[k] == nil {
			m[k] = &Posten{}
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
				b.Summe.plus(p)
				hol(tag, t).plus(p)
				hol(proj, projekt).plus(p)
				hol(konto, r.konto).plus(p)
				if m != "" {
					hol(mod, m).plus(p)
				}
			}
		}
	}
	sp.sichern()

	b.NachTag = sortiert(tag, true)
	b.NachProjekt = sortiert(proj, false)
	b.NachModell = sortiert(mod, false)
	// Bei gespiegelten Transkripten wäre die Kontoaufteilung Zufall: dieselbe
	// Session liegt in mehreren Konten, gezählt wird sie beim erstbesten.
	// Dann lieber nichts zeigen als etwas Falsches.
	b.NachKonto = sortiert(konto, false)
	if len(b.NachKonto) < 2 {
		b.NachKonto = []Zeile{}
	}
	b.Dauer = time.Since(start).Round(time.Millisecond).String()
	return b
}

// sortiert gibt die Zeilen aus; nachSchlüssel absteigend (für Tage), sonst
// nach Menge absteigend.
func sortiert(m map[string]*Posten, nachSchlüssel bool) []Zeile {
	out := make([]Zeile, 0, len(m))
	for k, p := range m {
		out = append(out, Zeile{Schlüssel: k, Posten: *p})
	}
	if nachSchlüssel {
		sort.Slice(out, func(i, j int) bool { return out[i].Schlüssel > out[j].Schlüssel })
	} else {
		sort.Slice(out, func(i, j int) bool { return out[i].Gesamt() > out[j].Gesamt() })
	}
	return out
}

func lesen(pfad string) eintrag {
	e := eintrag{Tage: map[string]map[string]Posten{}}
	f, err := os.Open(pfad)
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
		var z zeileRoh
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
		if u.Input == 0 && u.Output == 0 && u.CacheNeu == 0 && u.CacheLesen == 0 {
			continue
		}
		p := Posten{Ein: u.Input, Aus: u.Output, CacheNeu: u.CacheNeu, CacheLesen: u.CacheLesen, Nachrichten: 1}

		tag := "unbekannt"
		if len(z.Timestamp) >= 10 {
			tag = z.Timestamp[:10]
		}
		modell := z.Message.Model
		if modell == "<synthetic>" {
			modell = ""
		}
		if e.Tage[tag] == nil {
			e.Tage[tag] = map[string]Posten{}
		}
		alt := e.Tage[tag][modell]
		alt.plus(p)
		e.Tage[tag][modell] = alt
	}
	return e
}
