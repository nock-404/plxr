// Package archive liest die abgelegten Claude-Code-Transkripte.
//
// Claude Code legt je Konfigurationsverzeichnis einen Ordner projects/ an,
// darin je Arbeitsverzeichnis einen Ordner mit den Transkripten als .jsonl.
// Der Ordnername ist der Pfad mit / durch - ersetzt; verlässlicher ist aber
// das Feld cwd aus der Datei selbst, weil Sonderzeichen im Pfad die Umkehrung
// mehrdeutig machen.
package archive

import (
	"bufio"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"plxr/internal/accounts"
)

type Entry struct {
	ID      string `json:"id"`      // Session-ID = Dateiname ohne Endung
	Account string `json:"account"` // Kennung des Kontos
	Path    string `json:"path"`    // absolute Datei
	Cwd     string `json:"cwd"`
	Project string `json:"project"`
	Title   string `json:"title"`
	Branch  string `json:"branch"`
	Model   string `json:"model"`
	Size    int64  `json:"size"`
	Mod     int64  `json:"mod"`
	Loop    bool   `json:"loop"` // begann mit /loop — im eingebauten Picker unsichtbar

	// Accounts sind alle Konten, in denen dieses Transkript liegt. Wer mehrere
	// Zugänge parallel benutzt, hat dieselbe Session oft mehrfach auf Platte;
	// angezeigt wird sie trotzdem nur einmal.
	Accounts []string `json:"accounts"`
}

// kopf ist, was wir aus einem Transkript brauchen. Gelesen wird nur der Anfang
// und das Ende: bei 150 Dateien mit teils vielen Megabyte wäre alles zu lesen
// verschwendet, und Titel wie Verzeichnis stehen ohnehin an den Rändern.
type header struct {
	Type    string `json:"type"`
	AiTitle string `json:"aiTitle"`
	Cwd     string `json:"cwd"`
	Branch  string `json:"gitBranch"`
	Message struct {
		Model   string `json:"model"`
		Content any    `json:"content"`
	} `json:"message"`
}

const readLimit = 96 << 10

// List sammelt die Transkripte aller Konten, neueste zuerst.
func List(accs []accounts.Account, pathFilter string) []Entry {
	out := []Entry{}
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
				info, err := f.Info()
				if err != nil {
					continue
				}
				e := Entry{
					ID:      strings.TrimSuffix(f.Name(), ".jsonl"),
					Account: a.Name,
					Path:    filepath.Join(pdir, f.Name()),
					Size:    info.Size(),
					Mod:     info.ModTime().UnixMilli(),
				}
				read(&e)
				if e.Cwd == "" {
					e.Cwd = fromFolderName(d.Name())
				}
				e.Project = filepath.Base(e.Cwd)
				if pathFilter != "" && !strings.HasPrefix(e.Cwd, pathFilter) {
					continue
				}
				out = append(out, e)
			}
		}
	}
	return fold(out)
}

// falten fasst dasselbe Transkript aus mehreren Konten zu einem Eintrag
// zusammen. Führend ist die jüngste Kopie — die ist am ehesten die, in der
// zuletzt gearbeitet wurde.
func fold(in []Entry) []Entry {
	nach := map[string]*Entry{}
	reihe := []string{}
	for i := range in {
		e := in[i]
		vorh, ok := nach[e.ID]
		if !ok {
			kopie := e
			kopie.Accounts = []string{e.Account}
			nach[e.ID] = &kopie
			reihe = append(reihe, e.ID)
			continue
		}
		vorh.Accounts = append(vorh.Accounts, e.Account)
		if e.Mod > vorh.Mod {
			acc := vorh.Accounts
			*vorh = e
			vorh.Accounts = acc
		}
		// Fehlende Angaben aus der anderen Kopie ergänzen.
		if vorh.Title == "" {
			vorh.Title = e.Title
		}
		if vorh.Cwd == "" {
			vorh.Cwd = e.Cwd
		}
	}

	out := make([]Entry, 0, len(reihe))
	for _, id := range reihe {
		e := nach[id]
		sort.Strings(e.Accounts)
		out = append(out, *e)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Mod > out[j].Mod })
	return out
}

// lies zieht Titel, Verzeichnis, Branch und Modell aus der Datei.
func read(e *Entry) {
	f, err := os.Open(e.Path)
	if err != nil {
		return
	}
	defer f.Close()

	scan := func(r *bufio.Scanner) {
		r.Buffer(make([]byte, 0, 64*1024), 4<<20)
		for r.Scan() {
			line := r.Bytes()
			if len(line) == 0 || line[0] != '{' {
				continue
			}
			var k header
			if json.Unmarshal(line, &k) != nil {
				continue
			}
			if k.Type == "ai-title" && k.AiTitle != "" && e.Title == "" {
				e.Title = k.AiTitle
			}
			if k.Cwd != "" && e.Cwd == "" {
				e.Cwd = k.Cwd
			}
			if k.Branch != "" && k.Branch != "HEAD" && e.Branch == "" {
				e.Branch = k.Branch
			}
			if m := k.Message.Model; m != "" && m != "<synthetic>" && e.Model == "" {
				e.Model = m
			}
		}
	}

	// Anfang lesen: dort stehen cwd und der erste Prompt.
	scan(bufio.NewScanner(io.LimitReader(f, readLimit)))

	// Ende lesen: dort steht der zuletzt vergebene Titel.
	if e.Size > readLimit {
		if _, err := f.Seek(-readLimit, io.SeekEnd); err == nil {
			br := bufio.NewReader(f)
			br.ReadString('\n') // angeschnittene erste Zeile verwerfen
			scan(bufio.NewScanner(br))
		}
	}
}

// ausOrdnername macht aus "-Users-max-projekt" wieder "/Users/max/projekt".
// Nur ein Notnagel: Bindestriche im echten Pfad lassen sich nicht zurückholen.
func fromFolderName(n string) string {
	if !strings.HasPrefix(n, "-") {
		return n
	}
	return strings.ReplaceAll(n, "-", "/")
}

// Delete entfernt ein Transkript. Nur genau die Datei, kein Verzeichnis.
func Delete(e Entry) error { return os.Remove(e.Path) }

// Spiegeln kopiert ein Transkript in das Projektverzeichnis eines anderen
// Kontos, damit `claude --resume` es dort findet.
//
// Ohne das schlägt ein Kontowechsel fehl: Claude Code sucht Transkripte
// ausschließlich unter dem eigenen Konfigurationsverzeichnis.
func Mirror(e Entry, ziel accounts.Account) (string, error) {
	folder := filepath.Base(filepath.Dir(e.Path))
	zielDir := filepath.Join(ziel.ProjectsDir(), folder)
	if err := os.MkdirAll(zielDir, 0o755); err != nil {
		return "", err
	}
	targetPath := filepath.Join(zielDir, filepath.Base(e.Path))

	// Schon aktuell? Dann nichts tun.
	if zi, err := os.Stat(targetPath); err == nil {
		if qi, err := os.Stat(e.Path); err == nil &&
			zi.Size() == qi.Size() && !qi.ModTime().After(zi.ModTime()) {
			return targetPath, nil
		}
	}

	daten, err := os.ReadFile(e.Path)
	if err != nil {
		return "", err
	}
	tmp := targetPath + ".plxr-tmp"
	if err := os.WriteFile(tmp, daten, 0o600); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, targetPath); err != nil {
		os.Remove(tmp)
		return "", err
	}
	_ = os.Chtimes(targetPath, time.Now(), time.Now())
	return targetPath, nil
}
