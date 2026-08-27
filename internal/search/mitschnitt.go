package search

import (
	"bufio"
	"io"
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
}

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
		count, auszug := scanRaw(p, small)
		if count == 0 {
			continue
		}
		id := strings.TrimSuffix(filepath.Base(p), ".log")
		t := RecordingHit{SessionID: id, Mod: info.ModTime().UnixMilli(), Count: count, Auszug: auszug}
		if bekannt, ok := names[id]; ok {
			t.Name, t.Cwd = bekannt.Name, bekannt.Cwd
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

func scanRaw(path, small string) (int, string) {
	f, err := os.Open(path)
	if err != nil {
		return 0, ""
	}
	defer f.Close()

	// Read only the tail of large recordings: nobody searches for what scrolled by
	// weeks ago, and otherwise it costs seconds per file.
	if info, err := f.Stat(); err == nil && info.Size() > 8<<20 {
		f.Seek(info.Size()-(8<<20), io.SeekStart)
	}

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), maxLine)
	count := 0
	auszug := ""
	for sc.Scan() {
		line := sc.Text()
		if !strings.Contains(strings.ToLower(line), small) {
			continue
		}
		count++
		if auszug == "" {
			auszug = clean(line, small)
		}
		if count > 500 {
			break
		}
	}
	return count, auszug
}

// clean strips control characters and trims around the match.
func clean(line, small string) string {
	rein := stripEscapes(line)
	i := strings.Index(strings.ToLower(rein), small)
	if i < 0 {
		i = 0
	}
	r := []rune(rein)
	start := len([]rune(rein[:i])) - 70
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
