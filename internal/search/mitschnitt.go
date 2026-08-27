package search

import (
	"bufio"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// RecordingHit is a match in the terminal output of a session.
type RecordingHit struct {
	SessionID string `json:"sessionId"`
	Name      string `json:"name"`
	Cwd       string `json:"cwd"`
	Mod       int64  `json:"mod"`
	Count     int    `json:"anzahl"`
	Auszug    string `json:"auszug"`

	/* Danach ist, was nach der Fundstelle im Terminal stand.

	   Der Treffer allein hilft nicht. Dieselbe Fehlermeldung hat man schon
	   dreimal gesehen; was man sucht, ist was danach kam — der Befehl, der es
	   damals behoben hat. Der steht ein paar Zeilen weiter unten. */
	Danach []string `json:"danach,omitempty"`

	/* Offset ist, wo die erste Fundstelle im Mitschnitt beginnt.

	   Ohne die Angabe kann ein Klick auf einen Treffer die Wiedergabe nur bei
	   null starten — man findet die Fehlermeldung und darf die Session dann von
	   vorn ansehen. Mit ihr springt die Wiedergabe dorthin. */
	Offset int64 `json:"offset"`
}

// AfterLines is how much context follows a hit. Enough for a stack trace plus
// the command after it, not so much that the list becomes unreadable.
const AfterLines = 20

// SearchRecordings searches through what was on the terminals.
//
// This is the question tmux cannot answer: "where was that error message
// again". tmux loses the scrollback on restart; here it sits on disk, including
// that of sessions which are long gone.
//
// The search runs line by line over the raw stream. Escape sequences are in
// there — so the matching line is cleaned before display, rather than the
// whole stream up front: that would be far too expensive at hundreds of megabytes.
func SearchRecordings(dir, question string, names map[string]RecordingHit) []RecordingHit {
	question = strings.TrimSpace(question)
	if len(question) < 2 || dir == "" {
		return []RecordingHit{}
	}
	small := strings.ToLower(question)

	files, _ := filepath.Glob(filepath.Join(dir, "*.log"))
	out := []RecordingHit{}

	for _, p := range files {
		info, err := os.Stat(p)
		if err != nil || info.Size() == 0 {
			continue
		}
		res := scanRaw(p, small)
		if res.count == 0 {
			continue
		}
		id := strings.TrimSuffix(filepath.Base(p), ".log")
		t := RecordingHit{
			SessionID: id, Mod: info.ModTime().UnixMilli(),
			Count: res.count, Auszug: res.excerpt, Danach: res.after,
			Offset: res.offset,
		}
		if known, ok := names[id]; ok {
			t.Name, t.Cwd = known.Name, known.Cwd
		}
		if t.Name == "" {
			t.Name = "(beendete Session)"
		}
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Mod > out[j].Mod })
	return out
}

const maxLine = 1 << 20

type scanResult struct {
	count   int
	excerpt string
	after   []string
	offset  int64 // byte position where the first hit's line starts
}

/*
scanRaw reads the whole recording, not just its tail.

	It used to seek to the last 8 MB of large files, on the assumption that
	nobody searches for what scrolled by weeks ago. That assumption cost exactly
	the thing this feature is for: in a long-running session the interesting
	error is usually NOT at the end. Measured on this machine, a full pass over
	64 MB — the largest a recording can get — costs 0.16 s. That is affordable;
	losing every early hit is not.

	Read with a Reader rather than a Scanner because the byte position has to
	come out exact: Scanner strips the line ending, and terminals write \r\n,
	so counting the returned bytes would drift. The position is what lets a click
	on a hit jump the playback to that spot instead of starting over.
*/
func scanRaw(path, small string) scanResult {
	f, err := os.Open(path)
	if err != nil {
		return scanResult{}
	}
	defer f.Close()

	r := bufio.NewReaderSize(f, 64<<10)
	res := scanResult{offset: -1}
	var pos int64

	/* Keep reading after the first hit: what is searched for is the error, what
	   is needed is what came after it. Only after the FIRST — with five hundred
	   hits nobody wants five hundred blocks of context, and the first one is the
	   oldest, so the one with the story behind it. */
	collect := 0
	for {
		raw, err := r.ReadBytes('\n')
		if len(raw) == 0 && err != nil {
			break
		}
		start := pos
		pos += int64(len(raw))

		// A single line must not be allowed to eat all the memory. A terminal
		// that never sends a line break exists — a progress bar, for instance.
		if len(raw) > maxLine {
			raw = raw[:maxLine]
		}
		line := strings.TrimRight(string(raw), "\r\n")

		if collect > 0 {
			collect--
			if trimmed := strings.TrimSpace(clean(line, "")); trimmed != "" {
				res.after = append(res.after, trimmed)
			}
		}
		if strings.Contains(strings.ToLower(line), small) {
			res.count++
			if res.excerpt == "" {
				res.excerpt = clean(line, small)
				res.offset = start
				collect = AfterLines
			}
			// Counting on is cheap; searching for more context is not needed
			// once both are in hand — from there counting to the cap suffices.
			if res.count > 500 {
				break
			}
		}
		if err != nil {
			break
		}
	}
	return res
}

// clean strips control characters and trims around the match.
func clean(line, small string) string {
	trimmed := stripEscapes(line)
	i := strings.Index(strings.ToLower(trimmed), small)
	if i < 0 {
		i = 0
	}
	r := []rune(trimmed)
	start := len([]rune(trimmed[:i])) - 70
	if start < 0 {
		start = 0
	}
	end := start + 190
	if end > len(r) {
		end = len(r)
	}
	s := strings.Join(strings.Fields(string(r[start:end])), " ")
	if start > 0 {
		s = "… " + s
	}
	if end < len(r) {
		s += " …"
	}
	return s
}
