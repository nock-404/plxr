// Package archive reads the archived Claude Code transcripts.
//
// Claude Code legt je Konfigurationsverzeichnis einen Ordner projects/ an,
// with one folder per working directory holding the transcripts as .jsonl.
// The folder name is the path with / replaced by -; more reliable however is
// the cwd field from the file itself, because special characters in the path
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
	Loop    bool   `json:"loop"` // started with /loop — invisible in the built-in picker

	// Accounts are all accounts this transcript sits in. Anyone using several
	// accounts in parallel often has the same session on disk several times; it
	// is still shown only once.
	Accounts []string `json:"accounts"`
}

// header is what we need out of a transcript. Only the start and the end are
// read: with 150 files, some of them many megabytes, reading everything would be
// wasted, and both title and directory sit at the edges anyway.
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

// List collects the transcripts of all accounts, newest first.
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
// together. The most recent copy leads — that is most likely the one in which
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
		// Fill in missing details from the other copy.
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

// read pulls title, directory, branch and model out of the file.
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

	// Read the start: cwd and the first prompt are there.
	scan(bufio.NewScanner(io.LimitReader(f, readLimit)))

	// Read the end: the most recently assigned title is there.
	if e.Size > readLimit {
		if _, err := f.Seek(-readLimit, io.SeekEnd); err == nil {
			br := bufio.NewReader(f)
			br.ReadString('\n') // angeschnittene erste Zeile verwerfen
			scan(bufio.NewScanner(br))
		}
	}
}

// ausOrdnername macht aus "-Users-max-projekt" wieder "/Users/max/projekt".
// A last resort only: hyphens in the real path cannot be recovered.
func fromFolderName(n string) string {
	if !strings.HasPrefix(n, "-") {
		return n
	}
	return strings.ReplaceAll(n, "-", "/")
}

// Delete removes a transcript. Only that exact file, no directory.
func Delete(e Entry) error { return os.Remove(e.Path) }

// Mirror copies a transcript into the project directory of another account so
// that `claude --resume` finds it there.
//
// Without this an account switch fails: Claude Code looks for transcripts only
// below its own configuration directory.
func Mirror(e Entry, target accounts.Account) (string, error) {
	folder := filepath.Base(filepath.Dir(e.Path))
	targetDir := filepath.Join(target.ProjectsDir(), folder)
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return "", err
	}
	targetPath := filepath.Join(targetDir, filepath.Base(e.Path))

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
