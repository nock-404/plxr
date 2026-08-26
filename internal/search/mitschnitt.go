package search

import (
	"bufio"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// MitschnittTreffer ist eine Fundstelle in der Terminalausgabe einer Session.
type MitschnittTreffer struct {
	SessionID string `json:"sessionId"`
	Name      string `json:"name"`
	Cwd       string `json:"cwd"`
	Mod       int64  `json:"mod"`
	Anzahl    int    `json:"anzahl"`
	Auszug    string `json:"auszug"`
}

// SucheMitschnitte durchsucht, was in den Terminals stand.
//
// Das ist die Frage, die tmux nicht beantworten kann: "wo war nochmal diese
// Fehlermeldung". tmux verliert den Scrollback beim Neustart; hier liegt er
// auf Platte, auch von Sessions, die es längst nicht mehr gibt.
//
// Gesucht wird zeilenweise auf dem Rohstrom. Escape-Sequenzen stehen mit
// drin — deshalb wird die Trefferzeile vor der Anzeige gesäubert, nicht
// vorher der ganze Strom: das wäre bei hunderten Megabyte zu teuer.
func SucheMitschnitte(dir, frage string, namen map[string]MitschnittTreffer) []MitschnittTreffer {
	frage = strings.TrimSpace(frage)
	if len(frage) < 2 || dir == "" {
		return []MitschnittTreffer{}
	}
	klein := strings.ToLower(frage)

	dateien, _ := filepath.Glob(filepath.Join(dir, "*.log"))
	out := []MitschnittTreffer{}

	for _, p := range dateien {
		info, err := os.Stat(p)
		if err != nil || info.Size() == 0 {
			continue
		}
		anzahl, auszug := durchsuchenRoh(p, klein)
		if anzahl == 0 {
			continue
		}
		id := strings.TrimSuffix(filepath.Base(p), ".log")
		t := MitschnittTreffer{SessionID: id, Mod: info.ModTime().UnixMilli(), Anzahl: anzahl, Auszug: auszug}
		if bekannt, ok := namen[id]; ok {
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

const maxZeile = 1 << 20

func durchsuchenRoh(pfad, klein string) (int, string) {
	f, err := os.Open(pfad)
	if err != nil {
		return 0, ""
	}
	defer f.Close()

	// Große Mitschnitte nur am Ende lesen: was vor Wochen durchlief, sucht
	// niemand, und es kostet sonst Sekunden je Datei.
	if info, err := f.Stat(); err == nil && info.Size() > 8<<20 {
		f.Seek(info.Size()-(8<<20), io.SeekStart)
	}

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), maxZeile)
	anzahl := 0
	auszug := ""
	for sc.Scan() {
		zeile := sc.Text()
		if !strings.Contains(strings.ToLower(zeile), klein) {
			continue
		}
		anzahl++
		if auszug == "" {
			auszug = sauber(zeile, klein)
		}
		if anzahl > 500 {
			break
		}
	}
	return anzahl, auszug
}

// sauber entfernt Steuerzeichen und schneidet um die Fundstelle herum zu.
func sauber(zeile, klein string) string {
	rein := entferneEscapes(zeile)
	i := strings.Index(strings.ToLower(rein), klein)
	if i < 0 {
		i = 0
	}
	r := []rune(rein)
	start := len([]rune(rein[:i])) - 70
	if start < 0 {
		start = 0
	}
	ende := start + 190
	if ende > len(r) {
		ende = len(r)
	}
	s := strings.Join(strings.Fields(string(r[start:ende])), " ")
	if start > 0 {
		s = "… " + s
	}
	if ende < len(r) {
		s += " …"
	}
	return s
}
