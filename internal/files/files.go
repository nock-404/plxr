// Package files liefert den Dateibaum einer Session.
//
// Jeder Zugriff ist an das Arbeitsverzeichnis der Session gebunden. Das ist
// keine Formalie: die Oberfläche schickt Pfade, und ohne Fessel könnte ein
// „../../.ssh/id_rsa" den Baum verlassen. Deshalb prüft jede Funktion den
// aufgelösten Pfad gegen die aufgelöste Wurzel — nach Symlinks, nicht davor.
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

// MaxRead begrenzt, wie viel eine Vorschau liest.
const MaxRead = 512 << 10

// Rauschen, das im Baum standardmäßig nicht auftaucht. Der Nutzer kann es
// einblenden; Voreinstellung ist ausblenden, weil node_modules jeden Baum
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
	Noise bool   `json:"noise"` // gehört zum ausgeblendeten Rauschen
}

// resolve löst einen Pfad auf und stellt sicher, dass er unter root bleibt.
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
	// Trennzeichen anhängen, sonst passiert /projekt-geheim auf /projekt.
	if real != realRoot && !strings.HasPrefix(real, realRoot+string(filepath.Separator)) {
		return "", errors.New("Pfad liegt außerhalb der Session")
	}
	return real, nil
}

// List gibt den Inhalt eines Verzeichnisses zurück: Ordner zuerst, dann
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
			// Rauschen sind bekannte Namen plus alles, was mit Punkt anfängt.
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
	// Mod ist der Stand, auf dem der Text beruht. Beim Speichern wird er
	// zurückgeschickt: stimmt er nicht mehr, hat inzwischen jemand anderes
	// geschrieben und wir überschreiben nicht blind.
	Mod int64 `json:"mod"`
}

// Read liefert den Anfang einer Datei als Text.
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

	// Ein Nullbyte im Anfang ist das übliche, ausreichend zuverlässige Zeichen
	// für „nicht anzeigbar". Ungültiges UTF-8 zählt auch.
	if bytes.IndexByte(buf, 0) >= 0 || !utf8.Valid(buf) {
		c.Binary = true
		return c, nil
	}
	c.Text = string(buf)
	c.Lines = bytes.Count(buf, []byte{'\n'}) + 1
	return c, nil
}

// MaxWrite begrenzt, was über die Oberfläche geschrieben werden darf.
const MaxWrite = 4 << 20

// Write speichert eine Datei.
//
// Drei Sicherungen, weil hier echte Arbeit verloren gehen kann:
// der Pfad muss unter der Session liegen, die Datei muss vorher schon
// existiert haben (plxr ist kein Dateimanager), und der Stand muss der sein,
// auf dem der Text beruht — sonst hat inzwischen jemand anderes geschrieben.
//
// Geschrieben wird über eine Nebendatei und Umbenennen: ein abgebrochener
// Schreibvorgang hinterlässt so keine halbe Datei.
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
// Anders als der Rest dieses Pakets NICHT an eine Session gefesselt: hier geht
// es darum, ein Verzeichnis zu finden, in dem noch gar keine Session läuft.
// Gelesen werden ausschließlich Verzeichnisnamen — keine Dateiinhalte.
func Suggestions(eingabe string, max int) []string {
	if eingabe == "" {
		eingabe = "~/"
	}
	if strings.HasPrefix(eingabe, "~") {
		home, _ := os.UserHomeDir()
		eingabe = home + eingabe[1:]
	}

	// Endet die Eingabe auf einem Trenner, ist sie selbst das Verzeichnis;
	// sonst ist der letzte Teil ein angefangener Name.
	dir, rumpf := eingabe, ""
	if !strings.HasSuffix(eingabe, string(filepath.Separator)) {
		dir, rumpf = filepath.Split(eingabe)
	}
	if dir == "" {
		dir = "."
	}

	eintraege, err := os.ReadDir(dir)
	if err != nil {
		return []string{}
	}

	small := strings.ToLower(rumpf)
	out := []string{}
	for _, e := range eintraege {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		// Versteckte nur zeigen, wenn ausdrücklich danach getippt wird.
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
