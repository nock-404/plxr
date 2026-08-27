// Package files provides the file tree of a session.
//
// Every access is tied to the working directory of the session. That is not a
// formality: the UI sends paths, and without a leash a "../../.ssh/id_rsa" could
// walk out of the tree. So every function checks the resolved path against the
// resolved root — after following symlinks, not before.
package files

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"
)

// MaxRead limits how much a preview reads.
const MaxRead = 512 << 10

// Noise that does not show up in the tree by default. The user can reveal it;
// the default is to hide, because node_modules drowns every tree
// unbrauchbar macht.
var noise = map[string]bool{
	".git": true, "node_modules": true, ".DS_Store": true,
	".next": true, ".nuxt": true, ".turbo": true, ".cache": true,
	"dist": true, "build": true, "target": true, "vendor": true,
	"__pycache__": true, ".venv": true, ".pytest_cache": true,
}

type Entry struct {
	Name  string `json:"name"`
	Path  string `json:"path"` // absolut
	Dir   bool   `json:"dir"`
	Size  int64  `json:"size"`
	Mod   int64  `json:"mod"`
	Noise bool   `json:"noise"` // belongs to the hidden noise
}

// resolve resolves a path and makes sure it stays below root.
func resolve(root, path string) (string, error) {
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	if path == "" {
		return realRoot, nil
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(realRoot, path)
	}
	real, err := filepath.EvalSymlinks(filepath.Clean(path))
	if err != nil {
		return "", err
	}
	// Append the separator, otherwise /project-secret passes for /project.
	if real != realRoot && !strings.HasPrefix(real, realRoot+string(filepath.Separator)) {
		return "", errors.New("Pfad liegt außerhalb der Session")
	}
	return real, nil
}

// List returns the contents of a directory: folders first, then
// alphabetisch, Rauschen ans Ende.
func List(root, dir string) ([]Entry, error) {
	real, err := resolve(root, dir)
	if err != nil {
		return nil, err
	}
	des, err := os.ReadDir(real)
	if err != nil {
		return nil, err
	}

	out := make([]Entry, 0, len(des))
	for _, de := range des {
		info, err := de.Info()
		if err != nil {
			continue
		}
		name := de.Name()
		e := Entry{
			Name: name,
			Path: filepath.Join(real, name),
			Dir:  de.IsDir(),
			Mod:  info.ModTime().UnixMilli(),
			// noise is known names plus everything starting with a dot.
			Noise: noise[name] || (strings.HasPrefix(name, ".") && name != ".env.example"),
		}
		if !e.Dir {
			e.Size = info.Size()
		}
		out = append(out, e)
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].Noise != out[j].Noise {
			return !out[i].Noise
		}
		if out[i].Dir != out[j].Dir {
			return out[i].Dir
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

type Content struct {
	Path      string `json:"path"`
	Text      string `json:"text"`
	Truncated bool   `json:"truncated"`
	Binary    bool   `json:"binary"`
	Size      int64  `json:"size"`
	Lines     int    `json:"lines"`
	// Mod is the state the text is based on. It is sent back when saving: if it
	// no longer matches, somebody else has written in the meantime and we do
	// not blindly overwrite.
	Mod int64 `json:"mod"`
}

// Read returns the beginning of a file as text.
func Read(root, path string) (*Content, error) {
	real, err := resolve(root, path)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(real)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, errors.New("das ist ein Verzeichnis")
	}

	f, err := os.Open(real)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	buf := make([]byte, MaxRead)
	n, err := io.ReadFull(f, buf)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return nil, err
	}
	buf = buf[:n]

	c := &Content{Path: real, Size: info.Size(), Truncated: info.Size() > int64(n),
		Mod: info.ModTime().UnixMilli()}

	// A null byte near the start is the usual, sufficiently reliable sign of
	// "not displayable". Invalid UTF-8 counts as well.
	if bytes.IndexByte(buf, 0) >= 0 || !utf8.Valid(buf) {
		c.Binary = true
		return c, nil
	}
	c.Text = string(buf)
	c.Lines = bytes.Count(buf, []byte{'\n'}) + 1
	return c, nil
}

// MaxWrite limits what may be written through the UI.
const MaxWrite = 4 << 20

// Write saves a file.
//
// Three safeguards, because real work can be lost here: the path has to sit
// below the session, the file has to have existed before (plxr is not a file
// manager), and the state has to be the one the text is based on — otherwise
// somebody else has written in the meantime.
//
// Writing goes through a sibling file and a rename: an interrupted write
// leaves no half-written file behind.
func Write(root, path, text string, expectedState int64) (*Content, error) {
	if len(text) > MaxWrite {
		return nil, errors.New("zu groß zum Speichern")
	}
	real, err := resolve(root, path)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(real)
	if err != nil {
		return nil, errors.New("die Datei gibt es nicht mehr")
	}
	if info.IsDir() {
		return nil, errors.New("das ist ein Verzeichnis")
	}
	if expectedState != 0 && info.ModTime().UnixMilli() != expectedState {
		return nil, errors.New("die Datei wurde inzwischen von außen geändert — neu laden und noch einmal versuchen")
	}

	tmp := real + ".plxr-tmp"
	if err := os.WriteFile(tmp, []byte(text), info.Mode().Perm()); err != nil {
		return nil, err
	}
	if err := os.Rename(tmp, real); err != nil {
		os.Remove(tmp)
		return nil, err
	}
	return Read(root, real)
}

// Vorschlaege liefert Unterverzeichnisse zu einem angetippten Pfad.
//
// Unlike the rest of this package NOT tied to a session: the point here is to
// find a directory in which no session is running yet. Only directory names are
// read — no file contents.
func Suggestions(eingabe string, max int) []string {
	if eingabe == "" {
		eingabe = "~/"
	}
	if strings.HasPrefix(eingabe, "~") {
		home, _ := os.UserHomeDir()
		eingabe = home + eingabe[1:]
	}

	// If the input ends on a separator it is the directory itself; otherwise the
	// last part is a name being typed.
	dir, rumpf := eingabe, ""
	if !strings.HasSuffix(eingabe, string(filepath.Separator)) {
		dir, rumpf = filepath.Split(eingabe)
	}
	if dir == "" {
		dir = "."
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return []string{}
	}

	small := strings.ToLower(rumpf)
	out := []string{}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		// Only show hidden entries when they are explicitly being typed.
		if strings.HasPrefix(name, ".") && !strings.HasPrefix(rumpf, ".") {
			continue
		}
		if small != "" && !strings.HasPrefix(strings.ToLower(name), small) {
			continue
		}
		out = append(out, filepath.Join(dir, name))
		if len(out) >= max {
			break
		}
	}
	sort.Strings(out)
	return out
}
