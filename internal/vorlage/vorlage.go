// Package vorlage startet mehrere Sessions auf einen Schlag.
//
// Der Alltag: morgens drei Fenster in drei Verzeichnissen mit drei
// verschiedenen Konten. Das ist jeden Tag dieselbe Handbewegung — eine
// Vorlage macht daraus einen Klick.
//
// Vorlagen sind JSON unter ~/.plxr/vorlagen und lassen sich aus dem
// laufenden Zustand erzeugen: was gerade offen ist, wird zur Vorlage.
package vorlage

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type Eintrag struct {
	Cwd     string   `json:"cwd"`
	Cmd     []string `json:"cmd,omitempty"`
	Name    string   `json:"name,omitempty"`
	Account string   `json:"account,omitempty"`
}

type Vorlage struct {
	Name     string    `json:"name"`
	Label    string    `json:"label"`
	Sessions []Eintrag `json:"sessions"`
}

func Dir(wurzel string) string { return filepath.Join(wurzel, "vorlagen") }

func Laden(wurzel string) []Vorlage {
	out := []Vorlage{}
	paths, _ := filepath.Glob(filepath.Join(Dir(wurzel), "*.json"))
	for _, p := range paths {
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		var v Vorlage
		if json.Unmarshal(b, &v) != nil || v.Name == "" {
			continue
		}
		if v.Label == "" {
			v.Label = v.Name
		}
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Label < out[j].Label })
	return out
}

func Speichern(wurzel string, v Vorlage) error {
	if strings.TrimSpace(v.Name) == "" {
		return errors.New("die Vorlage braucht einen Namen")
	}
	if !NameOk(v.Name) {
		return errors.New("der Name darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten")
	}
	if len(v.Sessions) == 0 {
		return errors.New("die Vorlage enthält keine Session")
	}
	if err := os.MkdirAll(Dir(wurzel), 0o755); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(v, "", "  ")
	return os.WriteFile(filepath.Join(Dir(wurzel), v.Name+".json"), b, 0o644)
}

func Löschen(wurzel, name string) error {
	if !NameOk(name) {
		return errors.New("unzulässiger Name")
	}
	return os.Remove(filepath.Join(Dir(wurzel), name+".json"))
}

// NameOk sagt, ob ein Name als Dateiname taugen soll. Pfadzeichen abzuweisen
// reicht nicht: Anführungszeichen und Klammern kommen zwar nirgendwo hin, wo
// sie schaden, ergeben aber Dateien, die man von Hand kaum wieder loswird.
func NameOk(name string) bool {
	if name == "" || len(name) > 64 {
		return false
	}
	for _, r := range name {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' {
			continue
		}
		return false
	}
	return true
}
