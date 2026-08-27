// Package usage computes token spend from the transcripts.
//
// Deliberately not through an API: the spend sits in every assistant line of the
// transcript, which makes it local, complete and analysable after the fact. An
// endpoint could rate-limit, change or disappear.
//
// Because this walks thousands of files, the last result is remembered per file;
// as long as size and modification time stay the same, it is not
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

// Total is everything that was counted — for a rough order of magnitude.
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

// entry holds what came out of one file. The models are kept per day, not as a
// grand total: otherwise a period cannot be broken down by model.
type entry struct {
	Version int                        `json:"version"`
	Size    int64                      `json:"groesse"`
	Mod     int64                      `json:"mod"`
	Tage    map[string]map[string]Item `json:"tage"` // Tag -> Modell -> Posten
	Projekt string                     `json:"projekt"`
}

// cacheVersion invalidates older caches when the shape changes.
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

// Compute evaluates all transcripts. days limits it to the last n days
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
				// The same session sits in several accounts. Counting it twice
				// would triple the spend.
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

	cutoff := ""
	if tage > 0 {
		cutoff = time.Now().AddDate(0, 0, -tage).Format("2006-01-02")
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
			if cutoff != "" && t < cutoff {
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
	// With mirrored transcripts the split by account would be arbitrary: the
	// same session sits in several accounts and is counted at the first one.
	// Dann lieber nichts zeigen als etwas Falsches.
	b.ByAccount = sorted(account, false)
	if len(b.ByAccount) < 2 {
		b.ByAccount = []Line{}
	}
	b.Dauer = time.Since(start).Round(time.Millisecond).String()
	return b
}

// sorted emits the lines; byKey descending (for days), otherwise
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

// Pace describes how fast the allowance is being spent right now.
//
// Claude plans work in rolling windows — five hours and a week. Anyone running
// eight agents at once blows the five-hour window without seeing it coming. The
// numbers for that are in the transcripts; here they are extrapolated into a
// rate.
type Pace struct {
	// Window5h is the spend of the last five hours.
	Fenster5h int64 `json:"fenster5h"`
	// PerHour is the rate of the last hour, extrapolated.
	ProStunde int64 `json:"proStunde"`
	// Active is the number of sessions that spent something in the last hour —
	// that is what explains the rate.
	Aktive int `json:"aktive"`
	// Trend is "steigt", "faellt" or "gleich", compared with the hour before.
	Trend string `json:"trend"`
}

// ComputePace only evaluates the most recently changed transcripts — everything
// andere kann per Definition nichts zum aktuellen Tempo beitragen.
func ComputePace(accs []accounts.Account) Pace {
	jetzt := time.Now()
	cut5h := jetzt.Add(-5 * time.Hour)
	cut1h := jetzt.Add(-time.Hour)
	cut2h := jetzt.Add(-2 * time.Hour)

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
				// Anything untouched for more than five hours does not count.
				if err != nil || info.ModTime().Before(cut5h) {
					continue
				}
				gesehen[f.Name()] = true
				path := filepath.Join(pdir, f.Name())
				f5, f1, f2 := window(path, cut5h, cut1h, cut2h)
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

// window reads a file from the back and sums three periods.
func window(path string, g5, g1, g2 time.Time) (f5, f1, f2 int64) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	// Read only the end: older entries lie outside by definition.
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
		sum := int64(u.Input + u.Output + u.CacheWrite + u.CacheRead)
		f5 += sum
		if ts.After(g1) {
			f1 += sum
		} else if ts.After(g2) {
			f2 += sum
		}
	}
	return
}
