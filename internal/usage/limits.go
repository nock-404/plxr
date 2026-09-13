package usage

/* What is left, per account — and how much of that this machine can honestly
   know.

   The old view answered a question nobody asked: what everything cost over
   thirty days, added up across three accounts, as one number. The question
   that matters is the other one — how much of the current window is gone, on
   which account, and when does it come back. Somebody ran into "you've hit
   your weekly limit" in the middle of a long run with no warning anywhere,
   and no amount of thirty-day spend would have said it was coming.

   Two sources, and they are kept apart on purpose:

   1. The limits themselves. Claude Code asks the service for the account's
      utilisation and writes the answer beside its own configuration, under
      cachedUsageUtilization: the percentage of each window that is used and
      the moment it resets. That is the same reading its own /usage screen
      shows. plxr reads it off the disk — never over the network, never
      anywhere near the credentials — and it is a cache, so it is only as
      fresh as the last time that account ran. Everything here carries the
      moment it was fetched, so the interface can say how old it is instead of
      pretending it is live.

   2. The spend. That comes out of the transcripts, the way it always has, and
      it is counted from the real start of the window rather than over some
      period of its own. Where no reset time is known the window's start is
      not known either, and the number is a plain "the last five hours" that
      says so.

   What cannot be known is said rather than guessed: on this machine the
   projects/ folders of the second and third account are links to the first
   one's, so all three read one set of transcripts and nothing in a transcript
   says which account paid for a line. The limits above are still per account —
   they come from three different files — but the tokens are the pool's, and
   the interface names the accounts sharing it.
*/

import (
	"bufio"
	"encoding/json"
	"math"
	"os"
	"path/filepath"

	"strings"
	"time"

	"plxr/internal/accounts"
)

// The three windows the reference screen leads with.
const (
	KindSession   = "session"
	KindWeek      = "week"
	KindWeekModel = "weekModel"
)

// sessionLength and weekLength are the nominal lengths of the two windows.
// They are only used where no reset time is known, to say how far back a
// measured spend reaches.
const (
	sessionLength = 5 * time.Hour
	weekLength    = 7 * 24 * time.Hour
)

// Window is one rolling allowance as far as this machine can see it.
type Window struct {
	Kind string `json:"kind"`
	// Known is whether a percentage was found on disk at all. False means the
	// account has no reading here, and the interface must say so instead of
	// drawing a bar at zero.
	Known    bool   `json:"known"`
	Percent  int    `json:"percent"`
	Severity string `json:"severity,omitempty"`
	// Model is the family a scoped weekly window applies to, as the service
	// named it.
	Model string `json:"model,omitempty"`
	// ResetsAt and StartsAt are milliseconds, 0 when unknown. The window is
	// shown in the reader's own timezone, which only the window knows.
	ResetsAt int64 `json:"resetsAt"`
	StartsAt int64 `json:"startsAt"`
	// Measured says the spend below was summed from the window's real start.
	// Without a reset time there is no real start, and the spend is over the
	// window's nominal length ending now — still true, but a different
	// sentence, and the interface says which one it is showing.
	Measured bool   `json:"measured"`
	Spend    Item   `json:"spend"`
	ByModel  []Line `json:"byModel"`
}

// Left is how much of the window is still there, for a caller that wants to
// decide something. Unknown reads as a full window: a number nobody measured
// must not be what stops somebody working.
func (w Window) Left() int {
	if !w.Known {
		return 100
	}
	if w.Percent > 100 {
		return 0
	}
	return 100 - w.Percent
}

// AccountUsage is one account's readout: what is left, when it comes back,
// and what was spent since it opened.
type AccountUsage struct {
	Name   string `json:"name"`
	Label  string `json:"label,omitempty"`
	Number int    `json:"number"`
	Short  string `json:"short"`
	// IsDefault marks the account a new session starts under.
	IsDefault bool `json:"isDefault,omitempty"`

	// Known is whether any reading was found for this account.
	Known bool `json:"known"`
	// FetchedAt is when Claude Code last got these percentages, in
	// milliseconds. 0 when nothing was found.
	FetchedAt int64 `json:"fetchedAt"`
	// Source is the file the reading came from, with the home directory
	// written as ~. Empty when there is none.
	Source string `json:"source"`

	Session   Window `json:"session"`
	Week      Window `json:"week"`
	WeekModel Window `json:"weekModel"`

	// SharedWith names the other accounts reading the same transcripts. When
	// it is not empty the token figures are the pool's and not this account's
	// share of it, because nothing on disk says who paid for a line.
	SharedWith []string `json:"sharedWith"`
	// Transcripts is the directory those figures were counted from, with the
	// home directory written as ~.
	Transcripts string `json:"transcripts"`
}

// Hot reports whether any window of this account is at or past a percentage.
func (a AccountUsage) Hot(at int) (Window, bool) {
	for _, w := range []Window{a.Session, a.Week, a.WeekModel} {
		if w.Known && at > 0 && w.Percent >= at {
			return w, true
		}
	}
	return Window{}, false
}

// Totals is every account added together, underneath the per-account figures
// rather than instead of them. Percentages are deliberately absent: three
// accounts on three plans have three different allowances, and one number
// over them would mean nothing.
type Totals struct {
	Accounts int    `json:"accounts"`
	Session  Item   `json:"session"`
	Week     Item   `json:"week"`
	ByModel  []Line `json:"byModel"`
}

// AccountReport is the whole readout.
type AccountReport struct {
	Accounts []AccountUsage `json:"accounts"`
	Total    Totals         `json:"total"`
	// Pools is how many separate sets of transcripts were read. More accounts
	// than pools means some of them share, which is what SharedWith says.
	Pools int `json:"pools"`
	// Threshold is the percentage at which the service says something, as it
	// is set in the notification settings. It travels with the figures so the
	// rail and the pickers mark an account at the same point the notification
	// speaks at — two numbers would mean a colour that disagrees with a
	// notification, which is worse than either on its own. Filled in by the
	// caller, which is the one that knows the settings.
	Threshold int `json:"threshold"`
	Files     int `json:"files"`
	// ReadAt is when this was worked out, in milliseconds, and Duration how
	// long it took — the foot of the view says both.
	ReadAt   int64  `json:"readAt"`
	Duration string `json:"duration"`
}

// ---- Reading what Claude Code left on disk ----

// rawConfig is the little of Claude Code's own state file that is any of our
// business. Everything else in it — and there is a lot — is skipped by the
// decoder.
type rawConfig struct {
	Cached struct {
		FetchedAtMs float64 `json:"fetchedAtMs"`
		Utilization struct {
			Limits []rawLimit `json:"limits"`
			FiveH  *rawSimple `json:"five_hour"`
			SevenD *rawSimple `json:"seven_day"`
		} `json:"utilization"`
	} `json:"cachedUsageUtilization"`
}

type rawSimple struct {
	Utilization *float64 `json:"utilization"`
	ResetsAt    string   `json:"resets_at"`
}

type rawLimit struct {
	Kind     string   `json:"kind"`
	Group    string   `json:"group"`
	Percent  *float64 `json:"percent"`
	Severity string   `json:"severity"`
	ResetsAt string   `json:"resets_at"`
	Scope    *struct {
		Model *struct {
			DisplayName string `json:"display_name"`
		} `json:"model"`
	} `json:"scope"`
}

// configFile is where Claude Code keeps its own state for this account.
//
// Under CLAUDE_CONFIG_DIR it sits inside the directory. The default account is
// the exception: ~/.claude keeps its state in ~/.claude.json, beside the
// directory rather than in it. Both are tried, in that order, and nothing is
// invented when neither is there.
func configFile(dir string) string {
	for _, p := range []string{filepath.Join(dir, ".claude.json"), dir + ".json"} {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

// Limits reads one account's three windows off the disk. The zero value is a
// perfectly good answer: it means nothing was found, and Known says so.
func Limits(dir string) (session, week, weekModel Window, fetchedAt int64, source string) {
	session = Window{Kind: KindSession}
	week = Window{Kind: KindWeek}
	weekModel = Window{Kind: KindWeekModel}

	path := configFile(dir)
	if path == "" {
		return
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var raw rawConfig
	if json.Unmarshal(b, &raw) != nil {
		return
	}
	source = path
	fetchedAt = int64(raw.Cached.FetchedAtMs)

	// The limits array is what the reference screen reads, so it is read
	// first; the older five_hour / seven_day fields stand in where an account
	// has not been refreshed since they were the only shape.
	for _, l := range raw.Cached.Utilization.Limits {
		w := Window{
			Known:    l.Percent != nil,
			Severity: l.Severity,
			ResetsAt: millis(l.ResetsAt),
		}
		if l.Percent != nil {
			w.Percent = int(math.Round(*l.Percent))
		}
		switch {
		case l.Kind == "session" || l.Group == "session":
			w.Kind = KindSession
			session = w
		case l.Kind == "weekly_all":
			w.Kind = KindWeek
			week = w
		case l.Kind == "weekly_scoped":
			w.Kind = KindWeekModel
			if l.Scope != nil && l.Scope.Model != nil {
				w.Model = l.Scope.Model.DisplayName
			}
			// Several scoped windows can be reported. The one furthest along
			// is the one that will stop the work first.
			if !weekModel.Known || w.Percent > weekModel.Percent {
				weekModel = w
			}
		}
	}
	fill := func(w *Window, s *rawSimple) {
		if w.Known || s == nil || s.Utilization == nil {
			return
		}
		w.Known = true
		w.Percent = int(math.Round(*s.Utilization))
		w.ResetsAt = millis(s.ResetsAt)
	}
	fill(&session, raw.Cached.Utilization.FiveH)
	fill(&week, raw.Cached.Utilization.SevenD)
	return
}

// millis turns a reset time into milliseconds. An unreadable or absent one is
// 0, which every reader treats as "not known" rather than as 1970.
func millis(s string) int64 {
	if s == "" {
		return 0
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return 0
	}
	return t.UnixMilli()
}

// ---- Putting the two together ----

// Accounts works out the whole readout: the limits per account, the spend per
// window, and the total underneath.
func Accounts(accs []accounts.Account) AccountReport {
	began := time.Now()
	now := began
	out := AccountReport{Accounts: []AccountUsage{}, ReadAt: now.UnixMilli()}

	ps := pools(accs)
	out.Pools = len(ps)
	poolOf := map[string]int{}
	for i, p := range ps {
		out.Files += len(p.files)
		for _, name := range p.Accounts {
			poolOf[name] = i
		}
	}

	// The total underneath is over two periods that need no explaining —
	// the last five hours and the last seven days, ending now. Adding three
	// accounts' own windows together would be adding up three periods that
	// start at three different moments, and calling the result a total.
	lastSession := now.Add(-sessionLength).UnixMilli()
	lastWeek := now.Add(-weekLength).UnixMilli()

	// Every window that has to be summed, so each pool is walked once no
	// matter how many accounts and windows point into it.
	rows := make([]AccountUsage, 0, len(accs))
	wanted := make([]map[int64]bool, len(ps))
	for i := range wanted {
		wanted[i] = map[int64]bool{lastSession: true, lastWeek: true}
	}
	for _, a := range accs {
		row := AccountUsage{
			Name: a.Name, Label: a.Label, Number: a.Number,
			Short: a.Short, IsDefault: a.Default, SharedWith: []string{},
		}
		session, week, weekModel, fetched, source := Limits(a.Dir)
		row.Session, row.Week, row.WeekModel = session, week, weekModel
		row.FetchedAt, row.Source = fetched, tilde(source)
		row.Known = source != "" && (session.Known || week.Known || weekModel.Known)
		row.Session.StartsAt, row.Session.Measured = startOf(row.Session, now, sessionLength)
		row.Week.StartsAt, row.Week.Measured = startOf(row.Week, now, weekLength)
		row.WeekModel.StartsAt, row.WeekModel.Measured = startOf(row.WeekModel, now, weekLength)

		if i, ok := poolOf[a.Name]; ok {
			row.Transcripts = tilde(ps[i].Dir)
			for _, other := range ps[i].Accounts {
				if other != a.Name {
					row.SharedWith = append(row.SharedWith, other)
				}
			}
			wanted[i][row.Session.StartsAt] = true
			wanted[i][row.Week.StartsAt] = true
		}
		rows = append(rows, row)
	}

	// One walk per pool, answering every window start it was asked for.
	sp := loadCache()
	sums := make([]map[int64]sum, len(ps))
	for i, p := range ps {
		sums[i] = p.spend(sp, wanted[i], now)
	}
	sp.saveCache()

	for i := range rows {
		p, ok := poolOf[rows[i].Name]
		if !ok {
			continue
		}
		put := func(w *Window) {
			s := sums[p][w.StartsAt]
			w.Spend, w.ByModel = s.total, sorted(s.byModel, false)
		}
		put(&rows[i].Session)
		put(&rows[i].Week)
		// A scoped weekly window covers one model family, and which lines
		// belong to it is not something a transcript says. Its percentage is
		// real; its token figure would be a guess, so there is none.
		rows[i].WeekModel.Spend, rows[i].WeekModel.ByModel = Item{}, []Line{}
	}

	// A pool three accounts share is added into the total once.
	totalModel := map[string]*Item{}
	for i := range ps {
		out.Total.Session.add(sums[i][lastSession].total)
		week := sums[i][lastWeek]
		out.Total.Week.add(week.total)
		for m, it := range week.byModel {
			get(totalModel, m).add(*it)
		}
	}
	out.Total.Accounts = len(rows)
	out.Total.ByModel = sorted(totalModel, false)
	out.Accounts = rows
	out.Duration = time.Since(began).Round(time.Millisecond).String()
	return out
}

// startOf says when a window opened and whether that is the real start.
//
// With a reset time the start is exactly one window length before it. Without
// one there is no start to know, so the figure is over the window's nominal
// length ending now and Measured is false — which is what the interface says
// out loud rather than dressing a guess up as a window.
func startOf(w Window, now time.Time, length time.Duration) (int64, bool) {
	if w.ResetsAt == 0 {
		return now.Add(-length).UnixMilli(), false
	}
	return time.UnixMilli(w.ResetsAt).Add(-length).UnixMilli(), true
}

// tilde writes the home directory as ~, so three paths under one home can be
// told apart by their ends rather than by their identical beginnings.
func tilde(p string) string {
	if p == "" {
		return ""
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" || !strings.HasPrefix(p, home+string(filepath.Separator)) {
		return p
	}
	return "~" + p[len(home):]
}

// ---- Summing a window out of the transcripts ----

// sum is one window's spend out of one pool.
type sum struct {
	total   Item
	byModel map[string]*Item
}

// spend answers every window start it is given in one pass over the pool.
//
// The hour buckets in the cache answer all of it but the first, partial hour
// of each window: a window that opened at 10:50 wants ten minutes of the ten
// o'clock hour, not the hour. So the whole hours are added from the cache and
// that one hour is read out of the files that actually have it — usually one
// or two — with the timestamps compared exactly.
func (p Pool) spend(sp *store, starts map[int64]bool, now time.Time) map[int64]sum {
	out := map[int64]sum{}
	for at := range starts {
		out[at] = sum{byModel: map[string]*Item{}}
	}
	if len(starts) == 0 {
		return out
	}

	// The oldest window decides how far back anything has to be read at all.
	earliest := now
	for at := range starts {
		if t := time.UnixMilli(at); t.Before(earliest) {
			earliest = t
		}
	}
	// The buckets are UTC hours, so the comparison is between UTC hour tags,
	// which sort the same way as the times they name.
	fullFrom := map[int64]string{}
	edge := map[int64]string{}
	for at := range starts {
		t := time.UnixMilli(at).UTC()
		top := t.Truncate(time.Hour)
		if top.Equal(t) {
			fullFrom[at] = t.Format(hourLayout)
			continue
		}
		// The window opened inside an hour: the whole hours start with the
		// next one, and this one is read exactly.
		fullFrom[at] = top.Add(time.Hour).Format(hourLayout)
		edge[at] = top.Format(hourLayout)
	}

	want := make([]file, 0, len(p.files))
	for _, f := range p.files {
		// A file untouched since before the oldest window began cannot hold a
		// line inside any of them.
		if f.mod >= earliest.UnixMilli() {
			want = append(want, f)
		}
	}

	type job struct {
		path     string
		at       int64
		from, to time.Time
	}
	var edges []job
	read(sp, want, func(f file, en entry) {
		for hour, byModel := range en.Hours {
			if hour == unknownHour {
				continue
			}
			for at := range starts {
				if hour >= fullFrom[at] {
					s := out[at]
					for m, it := range byModel {
						s.total.add(it)
						if m != "" {
							get(s.byModel, m).add(it)
						}
					}
					out[at] = s
					continue
				}
				if tag, ok := edge[at]; ok && hour == tag {
					top := time.UnixMilli(at).UTC().Truncate(time.Hour)
					edges = append(edges, job{f.path, at, time.UnixMilli(at), top.Add(time.Hour)})
				}
			}
		}
	})

	for _, j := range edges {
		s := out[j.at]
		for m, it := range partial(j.path, j.from, j.to) {
			s.total.add(it)
			if m != "" {
				get(s.byModel, m).add(it)
			}
		}
		out[j.at] = s
	}
	return out
}

// partial sums one file's lines between two moments, exactly. Only ever asked
// for the single hour a window opened in, so it reads the end of the file and
// no more.
func partial(path string, from, to time.Time) map[string]Item {
	out := map[string]Item{}
	f, err := os.Open(path)
	if err != nil {
		return out
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return out
	}
	const tail = 16 << 20
	if at := info.Size() - tail; at > 0 {
		f.Seek(at, 0)
	}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 4<<20)
	if info.Size() > tail {
		sc.Scan() // the half line the seek landed in
	}
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
		if err != nil || ts.Before(from) || !ts.Before(to) {
			continue
		}
		u := z.Message.Usage
		if u.Input == 0 && u.Output == 0 && u.CacheWrite == 0 && u.CacheRead == 0 {
			continue
		}
		model := z.Message.Model
		if model == "<synthetic>" {
			model = ""
		}
		it := out[model]
		it.add(Item{In: u.Input, Out: u.Output, CacheWrite: u.CacheWrite, CacheRead: u.CacheRead, Messages: 1})
		out[model] = it
	}
	return out
}
