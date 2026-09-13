// Package usage computes token spend from the transcripts.
//
// Deliberately not through an API: the spend sits in every assistant line of the
// transcript, which makes it local, complete and analysable after the fact. An
// endpoint could rate-limit, change or disappear.
//
// Because this walks thousands of files, the last result is remembered per file;
// as long as size and modification time stay the same, it is not read again.
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
	In         int64 `json:"input"`      // input_tokens
	Out        int64 `json:"output"`     // output_tokens
	CacheWrite int64 `json:"cacheWrite"` // cache_creation_input_tokens
	CacheRead  int64 `json:"cacheRead"`  // cache_read_input_tokens
	Messages   int64 `json:"messages"`
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
	Key string `json:"key"`
	Item
}

type Report struct {
	Sum       Item   `json:"sum"`
	ByDay     []Line `json:"byDay"`
	ByProject []Line `json:"byProject"`
	ByModel   []Line `json:"byModel"`
	Files     int    `json:"files"`
	Duration  string `json:"duration"`
}

// ---- The cache ----

// entry holds what came out of one file. The models are kept per hour, not as
// a grand total: otherwise a period cannot be broken down by model, and a
// window that opens at 10:50 cannot be answered at all.
type entry struct {
	Version int                        `json:"version"`
	Size    int64                      `json:"size"`
	Mod     int64                      `json:"mod"`
	Hours   map[string]map[string]Item `json:"hours"` // UTC hour "2006-01-02T15" -> model -> item
	Project string                     `json:"project"`
}

// cacheVersion invalidates older caches when the shape changes.
//
// 3: the size field was written under a German name. Renaming it means every
// cache written before now reads back a size of zero, which would silently
// count as "the file changed" for ever; bumping the version says so out loud
// and rebuilds them once.
//
// 4: the buckets moved from the day to the hour. A plan's windows do not
// start at midnight — the five-hour one opened at 10:50 this morning — so a
// day is too coarse to answer "how much since this window opened" with, and a
// cache of days cannot be refined into one of hours without reading the files
// again.
const cacheVersion = 4

// dayOf is the day a bucket belongs to. A line with no readable timestamp is
// bucketed under unknownHour, which is not a day and must not be sliced like
// one.
func dayOf(hour string) string {
	if len(hour) < 10 {
		return hour
	}
	return hour[:10]
}

// unknownHour is where a line whose timestamp cannot be read is counted. It
// belongs to no window: a spend that cannot be placed in time must not be
// added to the window somebody is deciding by.
const unknownHour = "unknown"

const hourLayout = "2006-01-02T15"

type store struct {
	mu      sync.Mutex
	File    map[string]entry `json:"file"`
	path    string
	changed bool
}

func loadCache() *store {
	p := filepath.Join(daemon.Root(), "usage-cache.json")
	s := &store{File: map[string]entry{}, path: p}
	if b, err := os.ReadFile(p); err == nil {
		json.Unmarshal(b, s)
		if s.File == nil {
			s.File = map[string]entry{}
		}
	}
	return s
}

func (s *store) saveCache() {
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

// ---- Working it out ----

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

// file is one transcript, as the walk found it.
type file struct {
	path      string
	size, mod int64
}

// Pool is one set of transcripts and everybody who reads it.
//
// Claude Code keeps its transcripts under the account's configuration
// directory — except that on this machine the projects/ folders of the second
// and third account are links to the first one's. Three accounts, one set of
// files. Nothing in a transcript says which account paid for the line, so a
// pool read by more than one account cannot be split between them, and the
// interface has to say so rather than divide by three.
type Pool struct {
	// Dir is the transcript directory with every link resolved — the identity
	// of the pool, so two accounts pointing at one directory land here once.
	Dir string
	// Accounts are the names of the accounts that read it, in the order they
	// were discovered.
	Accounts []string
	files    []file
}

// Shared reports whether more than one account reads these transcripts.
func (p Pool) Shared() bool { return len(p.Accounts) > 1 }

// pools groups accounts by the transcript directory they actually read, and
// lists the transcripts in each exactly once.
func pools(accs []accounts.Account) []Pool {
	var out []Pool
	at := map[string]int{}
	for _, a := range accs {
		dir := a.ProjectsDir()
		if real, err := filepath.EvalSymlinks(dir); err == nil {
			dir = real
		}
		if i, ok := at[dir]; ok {
			out[i].Accounts = append(out[i].Accounts, a.Name)
			continue
		}
		at[dir] = len(out)
		out = append(out, Pool{Dir: dir, Accounts: []string{a.Name}, files: transcripts(dir)})
	}
	return out
}

// transcripts lists every session file under a projects directory.
func transcripts(dir string) []file {
	var out []file
	sub, _ := os.ReadDir(dir)
	for _, d := range sub {
		if !d.IsDir() {
			continue
		}
		pdir := filepath.Join(dir, d.Name())
		names, _ := os.ReadDir(pdir)
		for _, f := range names {
			if f.IsDir() || !strings.HasSuffix(f.Name(), ".jsonl") {
				continue
			}
			info, err := f.Info()
			if err != nil {
				continue
			}
			out = append(out, file{filepath.Join(pdir, f.Name()), info.Size(), info.ModTime().UnixMilli()})
		}
	}
	return out
}

// read hands back the hour buckets of every file given, from the cache where
// the file has not moved and from the file itself where it has.
func read(sp *store, files []file, each func(file, entry)) {
	workers := runtime.NumCPU()
	if workers > 8 {
		workers = 8
	}
	type found struct {
		f file
		e entry
	}
	in := make(chan file)
	results := make(chan found, 64)
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range in {
				sp.mu.Lock()
				old, ok := sp.File[j.path]
				sp.mu.Unlock()
				if ok && old.Version == cacheVersion && old.Size == j.size && old.Mod == j.mod {
					results <- found{j, old}
					continue
				}
				e := readAll(j.path)
				e.Version, e.Size, e.Mod = cacheVersion, j.size, j.mod
				sp.mu.Lock()
				sp.File[j.path] = e
				sp.changed = true
				sp.mu.Unlock()
				results <- found{j, e}
			}
		}()
	}
	go func() {
		for _, j := range files {
			in <- j
		}
		close(in)
		wg.Wait()
		close(results)
	}()
	for r := range results {
		each(r.f, r.e)
	}
}

func get(m map[string]*Item, k string) *Item {
	if m[k] == nil {
		m[k] = &Item{}
	}
	return m[k]
}

// Compute evaluates all transcripts. days limits it to the last n days
// (0 = everything).
func Compute(accs []accounts.Account, days int) Report {
	start := time.Now()
	sp := loadCache()

	var all []file
	for _, p := range pools(accs) {
		all = append(all, p.files...)
	}

	cutoff := ""
	if days > 0 {
		cutoff = time.Now().AddDate(0, 0, -days).Format("2006-01-02")
	}

	b := Report{Files: len(all)}
	tag := map[string]*Item{}
	proj := map[string]*Item{}
	mod := map[string]*Item{}

	read(sp, all, func(_ file, e entry) {
		project := e.Project
		if project == "" {
			project = "(unknown)"
		}
		for hour, byModel := range e.Hours {
			day := dayOf(hour)
			if cutoff != "" && day < cutoff {
				continue
			}
			for m, p := range byModel {
				b.Sum.add(p)
				get(tag, day).add(p)
				get(proj, project).add(p)
				if m != "" {
					get(mod, m).add(p)
				}
			}
		}
	})
	sp.saveCache()

	b.ByDay = sorted(tag, true)
	b.ByProject = sorted(proj, false)
	b.ByModel = sorted(mod, false)
	b.Duration = time.Since(start).Round(time.Millisecond).String()
	return b
}

// sorted emits the lines; byKey descending (for days), otherwise by size,
// biggest first.
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
	e := entry{Hours: map[string]map[string]Item{}}
	f, err := os.Open(path)
	if err != nil {
		return e
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 4<<20)
	for sc.Scan() {
		raw := sc.Bytes()
		if len(raw) == 0 || raw[0] != '{' {
			continue
		}
		var z rawLine
		if json.Unmarshal(raw, &z) != nil {
			continue
		}
		if z.Cwd != "" && e.Project == "" {
			e.Project = filepath.Base(z.Cwd)
		}
		if z.Type != "assistant" {
			continue
		}
		u := z.Message.Usage
		if u.Input == 0 && u.Output == 0 && u.CacheWrite == 0 && u.CacheRead == 0 {
			continue
		}
		p := Item{In: u.Input, Out: u.Output, CacheWrite: u.CacheWrite, CacheRead: u.CacheRead, Messages: 1}

		// The timestamps are written in UTC, so the first thirteen characters
		// are the UTC hour and the first ten the UTC day.
		tag := unknownHour
		if len(z.Timestamp) >= len(hourLayout) {
			tag = z.Timestamp[:len(hourLayout)]
		}
		model := z.Message.Model
		if model == "<synthetic>" {
			model = ""
		}
		if e.Hours[tag] == nil {
			e.Hours[tag] = map[string]Item{}
		}
		old := e.Hours[tag][model]
		old.add(p)
		e.Hours[tag][model] = old
	}
	return e
}

// ---- How fast it is going ----

// Pace describes how fast the allowance is being spent right now.
//
// Claude plans work in rolling windows — five hours and a week. Anyone running
// eight agents at once blows the five-hour window without seeing it coming. The
// numbers for that are in the transcripts; here they are extrapolated into a
// rate.
type Pace struct {
	// Window5h is the spend of the last five hours.
	Window5h int64 `json:"window5h"`
	// PerHour is the rate of the last hour, extrapolated.
	PerHour int64 `json:"perHour"`
	// Active is the number of sessions that spent something in the last hour —
	// that is what explains the rate.
	Active int `json:"active"`
	// Trend is "rising", "falling" or "flat", compared with the hour before.
	Trend string `json:"trend"`
}

// ComputePace only evaluates the most recently changed transcripts — by
// definition nothing else can contribute to the current pace.
func ComputePace(accs []accounts.Account) Pace {
	now := time.Now()
	cut5h := now.Add(-5 * time.Hour)
	cut1h := now.Add(-time.Hour)
	cut2h := now.Add(-2 * time.Hour)

	var t Pace
	var prevHour int64
	active := map[string]bool{}

	// One pass per pool of transcripts, so three accounts pointing at one
	// directory read it once instead of counting it three times.
	for _, p := range pools(accs) {
		for _, f := range p.files {
			// Anything untouched for more than five hours does not count.
			if f.mod < cut5h.UnixMilli() {
				continue
			}
			f5, f1, f2 := window(f.path, cut5h, cut1h, cut2h)
			t.Window5h += f5
			t.PerHour += f1
			prevHour += f2
			if f1 > 0 {
				active[f.path] = true
			}
		}
	}

	t.Active = len(active)
	switch {
	case prevHour == 0 && t.PerHour > 0:
		t.Trend = "rising"
	case t.PerHour > prevHour*6/5:
		t.Trend = "rising"
	case t.PerHour*6/5 < prevHour:
		t.Trend = "falling"
	default:
		t.Trend = "flat"
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
	const window = 4 << 20
	if from := info.Size() - window; from > 0 {
		f.Seek(from, 0)
	}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 4<<20)
	sc.Scan() // the partial first line

	for sc.Scan() {
		raw := sc.Bytes()
		if len(raw) == 0 || raw[0] != '{' {
			continue
		}
		var z rawLine
		if json.Unmarshal(raw, &z) != nil || z.Type != "assistant" {
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
