// Package search durchsucht die abgelegten Transkripte im Volltext.
//
// Kein Index: bei ein paar tausend Dateien ist ein sequentieller Durchlauf mit
// mehreren Arbeitern schnell genug, und ein Index müsste gepflegt werden und
// wäre nach jedem Claude-Lauf veraltet. Gesucht wird bewusst nur in dem, was
// Mensch und Assistent gesagt haben — nicht in Werkzeugausgaben, sonst
// ertrinkt jeder Treffer in Dateiinhalten.
package search

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"

	"plxr/internal/accounts"
)

type Hit struct {
	SessionID string `json:"sessionId"`
	Account   string `json:"account"`
	Path      string `json:"path"`
	Cwd       string `json:"cwd"`
	Project   string `json:"project"`
	Title     string `json:"title"`
	Mod       int64  `json:"mod"`
	Rolle     string `json:"rolle"` // "user" oder "assistant"
	Auszug    string `json:"auszug"`
	Count     int    `json:"anzahl"` // Treffer in dieser Session
}

// zeile ist der Ausschnitt eines Transkripteintrags, den wir brauchen.
type line struct {
	Type    string `json:"type"`
	AiTitle string `json:"aiTitle"`
	Cwd     string `json:"cwd"`
	Message struct {
		Role    string          `json:"role"`
		Content json.RawMessage `json:"content"`
	} `json:"message"`
}

const (
	maxHits       = 200
	maxProSession = 3
	auszugKontext = 90
	maxLineLength = 2 << 20
)

// Suche durchläuft alle Transkripte aller Konten.
func Search(accs []accounts.Account, question string, nurEigene bool) []Hit {
	question = strings.TrimSpace(question)
	if len(question) < 2 {
		return []Hit{}
	}
	small := strings.ToLower(question)

	files := collect(accs)

	arbeiter := runtime.NumCPU()
	if arbeiter > 8 {
		arbeiter = 8
	}
	rein := make(chan file)
	raus := make(chan Hit)
	var wg sync.WaitGroup

	for i := 0; i < arbeiter; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for d := range rein {
				if t, ok := scan(d, small, nurEigene); ok {
					raus <- t
				}
			}
		}()
	}
	go func() {
		for _, d := range files {
			rein <- d
		}
		close(rein)
		wg.Wait()
		close(raus)
	}()

	out := []Hit{}
	for t := range raus {
		out = append(out, t)
		if len(out) >= maxHits {
			break
		}
	}
	// Kanal leerlaufen lassen, damit keine Arbeiter hängen bleiben.
	go func() {
		for range raus {
		}
	}()

	sort.Slice(out, func(i, j int) bool { return out[i].Mod > out[j].Mod })
	return out
}

type file struct {
	path    string
	account string
	mod     int64
	folder  string
}

func collect(accs []accounts.Account) []file {
	var out []file
	gesehen := map[string]bool{}
	for _, a := range accs {
		dirs, err := os.ReadDir(a.ProjectsDir())
		if err != nil {
			continue
		}
		for _, d := range dirs {
			if !d.IsDir() {
				continue
			}
			pdir := filepath.Join(a.ProjectsDir(), d.Name())
			files, err := os.ReadDir(pdir)
			if err != nil {
				continue
			}
			for _, f := range files {
				if f.IsDir() || !strings.HasSuffix(f.Name(), ".jsonl") {
					continue
				}
				// Dieselbe Session liegt in mehreren Konten — einmal reicht.
				if gesehen[f.Name()] {
					continue
				}
				gesehen[f.Name()] = true
				info, err := f.Info()
				if err != nil {
					continue
				}
				out = append(out, file{
					path: filepath.Join(pdir, f.Name()), account: a.Name,
					mod: info.ModTime().UnixMilli(), folder: d.Name(),
				})
			}
		}
	}
	return out
}

func scan(d file, small string, nurEigene bool) (Hit, bool) {
	f, err := os.Open(d.path)
	if err != nil {
		return Hit{}, false
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), maxLineLength)

	t := Hit{
		SessionID: strings.TrimSuffix(filepath.Base(d.path), ".jsonl"),
		Account:   d.account, Path: d.path, Mod: d.mod,
	}

	for sc.Scan() {
		roh := sc.Bytes()
		if len(roh) == 0 || roh[0] != '{' {
			continue
		}
		// Erst billig prüfen, ob der Begriff überhaupt vorkommt. Das JSON zu
		// entpacken ist um ein Vielfaches teurer als ein Teilstringvergleich.
		hat := strings.Contains(strings.ToLower(string(roh)), small)

		var z line
		if !hat && t.Title != "" && t.Cwd != "" {
			continue
		}
		if json.Unmarshal(roh, &z) != nil {
			continue
		}
		if z.Type == "ai-title" && z.AiTitle != "" && t.Title == "" {
			t.Title = z.AiTitle
		}
		if z.Cwd != "" && t.Cwd == "" {
			t.Cwd = z.Cwd
		}
		if !hat {
			continue
		}

		rolle := z.Message.Role
		if nurEigene && rolle != "user" {
			continue
		}
		if rolle != "user" && rolle != "assistant" {
			continue
		}
		text := textFrom(z.Message.Content)
		if text == "" {
			continue
		}
		i := strings.Index(strings.ToLower(text), small)
		if i < 0 {
			continue
		}
		t.Count++
		if t.Auszug == "" {
			t.Rolle = rolle
			t.Auszug = excerpt(text, i, len(small))
		}
		if t.Count >= maxProSession && t.Title != "" {
			break
		}
	}

	if t.Count == 0 {
		return Hit{}, false
	}
	if t.Cwd == "" {
		t.Cwd = strings.ReplaceAll(d.folder, "-", "/")
	}
	t.Project = filepath.Base(t.Cwd)
	return t, true
}

// textAus holt den lesbaren Text aus dem Inhaltsfeld, das mal ein String und
// mal eine Liste von Blöcken ist.
func textFrom(roh json.RawMessage) string {
	if len(roh) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(roh, &s) == nil {
		return s
	}
	var bloecke []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(roh, &bloecke) != nil {
		return ""
	}
	var b strings.Builder
	for _, x := range bloecke {
		if x.Type == "text" && x.Text != "" {
			if b.Len() > 0 {
				b.WriteString(" ")
			}
			b.WriteString(x.Text)
		}
	}
	return b.String()
}

func excerpt(text string, i, laenge int) string {
	r := []rune(text)
	// Byte- in Runenposition umrechnen, sonst zerschneidet der Ausschnitt Umlaute.
	start := len([]rune(text[:i]))
	von := start - auszugKontext
	if von < 0 {
		von = 0
	}
	bis := start + laenge + auszugKontext
	if bis > len(r) {
		bis = len(r)
	}
	s := strings.Join(strings.Fields(string(r[von:bis])), " ")
	if von > 0 {
		s = "… " + s
	}
	if bis < len(r) {
		s += " …"
	}
	return s
}
