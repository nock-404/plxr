package hook

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"plxr/internal/daemon"
)

/*
The waiting ledger: who waited on whom, and for how long.

The question behind it: over weeks, how long did the agents work and how long
did they wait for you. The second number is the interesting one, and nothing
in plxr could answer it — the state file holds only the current status, never
what came before it.

What gets written is one line per change of status, nothing else:

	1787812143558 20694be7 working

The hook already knows the transition — it compares old and new status before
it writes the file. Appending here costs a few dozen bytes and happens a
handful of times an hour.

Append-only and one line at a time, deliberately: the hook runs as its own
short-lived process for every event, several of them can overlap, and O_APPEND
with a write below the pipe buffer is atomic on every system we build for.
Anything cleverer would need a lock that these processes cannot share.
*/

// LedgerFile is where the transitions are collected.
func LedgerFile() string { return filepath.Join(daemon.Root(), "waiting.log") }

// Note records a change of status. Errors are swallowed on purpose: a ledger
// that cannot be written must never stop a session from running.
func Note(sessionID, status string, atMillis int64) {
	if sessionID == "" || status == "" {
		return
	}
	f, err := os.OpenFile(LedgerFile(), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, "%d %s %s\n", atMillis, sessionID, status)
}

// Span is one stretch in one status.
type Span struct {
	Session string
	Status  string
	From    int64
	To      int64
}

// ReadLedger turns the lines back into stretches.
//
// A stretch ends where the next one of the same session begins; the last one
// of each session ends at now. That is the reason the closing is done on
// reading and not on writing: a session that is still waiting has no closing
// line yet, and one that died with the daemon never gets one.
func ReadLedger(now int64) []Span {
	b, err := os.ReadFile(LedgerFile())
	if err != nil {
		return nil
	}
	open := map[string]*Span{}
	var out []Span
	for _, line := range strings.Split(string(b), "\n") {
		parts := strings.Fields(line)
		if len(parts) != 3 {
			continue
		}
		at, err := strconv.ParseInt(parts[0], 10, 64)
		if err != nil {
			continue
		}
		if prev, ok := open[parts[1]]; ok {
			prev.To = at
			out = append(out, *prev)
		}
		open[parts[1]] = &Span{Session: parts[1], Status: parts[2], From: at}
	}
	for _, s := range open {
		s.To = now
		out = append(out, *s)
	}
	return out
}

// ---- What comes out of it ----

// WaitCap is the longest a single wait may count.
//
// The number is not cosmetic, it decides whether the whole thing means
// anything. An agent that finishes at seven in the evening and is seen again
// at nine the next morning would otherwise book fourteen hours of waiting, and
// one such night buries every real number under it. After half an hour you are
// not waiting, you are away.
//
// Cut off rather than dropped: what was cut is reported separately, so the
// figure stays honest instead of quietly shrinking.
const WaitCap = 30 * 60 * 1000

// Line is one day of the ledger.
type Line struct {
	Key    string `json:"key"`
	Worked int64  `json:"worked"`
	Waited int64  `json:"waited"`
}

// Report is the waiting account.
type Report struct {
	Worked int64  `json:"worked"`
	Waited int64  `json:"waited"`
	Cut    int64  `json:"cut"`
	Cap    int64  `json:"cap"`
	ByDay  []Line `json:"byDay"`
}

// Waiting adds the ledger up over the last days; 0 means everything.
func Waiting(days int, now int64) Report {
	rep := Report{Cap: WaitCap}
	var from int64
	if days > 0 {
		from = now - int64(days)*24*60*60*1000
	}
	perDay := map[string]*Line{}

	for _, s := range ReadLedger(now) {
		if s.Status != "working" && s.Status != "waiting" {
			continue
		}
		if s.To <= from {
			continue
		}
		start := s.From
		if start < from {
			start = from
		}
		if s.Status == "waiting" && s.To-start > WaitCap {
			rep.Cut += s.To - start - WaitCap
			s.To = start + WaitCap
		}
		// A stretch across midnight belongs to both days, otherwise a night
		// shift lands entirely on the day it began.
		for cur := start; cur < s.To; {
			t := time.UnixMilli(cur)
			day := t.Format("2006-01-02")
			// Deliberately not Truncate(24h): that cuts to UTC midnight, and in
			// CET the boundary then sits at 23:00 — a night shift lands on the
			// wrong day by an hour, and in summer time by two.
			y, mo, d := t.Date()
			end := time.Date(y, mo, d+1, 0, 0, 0, 0, t.Location()).UnixMilli()
			if end > s.To {
				end = s.To
			}
			l := perDay[day]
			if l == nil {
				l = &Line{Key: day}
				perDay[day] = l
			}
			if s.Status == "working" {
				l.Worked += end - cur
				rep.Worked += end - cur
			} else {
				l.Waited += end - cur
				rep.Waited += end - cur
			}
			cur = end
		}
	}

	for _, l := range perDay {
		rep.ByDay = append(rep.ByDay, *l)
	}
	sort.Slice(rep.ByDay, func(i, j int) bool { return rep.ByDay[i].Key > rep.ByDay[j].Key })
	return rep
}
