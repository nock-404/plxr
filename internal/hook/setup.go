package hook

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Ereignisse sind die Hook-Punkte, an denen plxr mitschreibt.
var Ereignisse = []string{
	"SessionStart", "UserPromptSubmit", "PreToolUse", "Notification", "Stop", "SessionEnd",
}

// Einrichten trägt plxr in die Einstellungen von Claude Code ein.
//
// Vorhandene Hooks bleiben stehen: die Datei gehört dem Nutzer, und wer dort
// schon etwas eingerichtet hat, würde es zu Recht übelnehmen, wenn ein
// fremdes Programm sie überschreibt. Ergänzt wird nur, was fehlt.
func Einrichten(configDir string, entfernen bool) (string, error) {
	if configDir == "" {
		home, _ := os.UserHomeDir()
		configDir = filepath.Join(home, ".claude")
	}
	if _, err := os.Stat(configDir); err != nil {
		return "", errors.New("kein Claude-Code-Verzeichnis: " + configDir)
	}
	pfad := filepath.Join(configDir, "settings.json")

	einst := map[string]any{}
	if b, err := os.ReadFile(pfad); err == nil && len(b) > 0 {
		if err := json.Unmarshal(b, &einst); err != nil {
			return "", errors.New(pfad + " ist kein gültiges JSON: " + err.Error())
		}
	}

	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	exe, _ = filepath.EvalSymlinks(exe)

	hooks, _ := einst["hooks"].(map[string]any)
	if hooks == nil {
		hooks = map[string]any{}
	}

	geändert := false
	for _, ev := range Ereignisse {
		liste, _ := hooks[ev].([]any)
		neu := make([]any, 0, len(liste))
		vorhanden := false
		for _, eintrag := range liste {
			if istUnserer(eintrag) {
				geändert = true
				if entfernen {
					continue // fällt weg
				}
				vorhanden = true
			}
			neu = append(neu, eintrag)
		}
		if !entfernen && !vorhanden {
			neu = append(neu, map[string]any{
				"hooks": []any{map[string]any{
					"type":    "command",
					"command": exe,
					"args":    []any{"hook"},
					// Ohne async würde jeder Werkzeugaufruf auf uns warten.
					"async": ev != "SessionEnd",
				}},
			})
			geändert = true
		}
		if len(neu) == 0 {
			delete(hooks, ev)
		} else {
			hooks[ev] = neu
		}
	}

	if !geändert {
		return pfad, nil
	}
	if len(hooks) == 0 {
		delete(einst, "hooks")
	} else {
		einst["hooks"] = hooks
	}

	b, err := json.MarshalIndent(einst, "", "  ")
	if err != nil {
		return "", err
	}
	// Vor dem Schreiben eine Sicherung: das ist die Konfigurationsdatei des
	// Nutzers, nicht unsere.
	if alt, err := os.ReadFile(pfad); err == nil {
		os.WriteFile(pfad+".vor-plxr", alt, 0o644)
	}
	tmp := fmt.Sprintf("%s.%d.tmp", pfad, os.Getpid())
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return "", err
	}
	return pfad, os.Rename(tmp, pfad)
}

// istUnserer erkennt einen von plxr angelegten Eintrag.
/* istUnserer erkennt einen Eintrag am Dateinamen des Befehls — und zwar am
   Anfang, nicht auf's Zeichen genau. Eingetragen wird der Pfad des gerade
   laufenden Binärs; das heißt unter Windows "plxr.exe" und beim Entwickeln
   auch mal anders. Auf Gleichheit zu prüfen hieße: plxr erkennt den eigenen
   Eintrag nicht wieder, meldet weiter "nicht eingerichtet" und legt bei jedem
   Klick einen weiteren daneben. */
func istUnserer(eintrag any) bool {
	m, _ := eintrag.(map[string]any)
	if m == nil {
		return false
	}
	for _, h := range m["hooks"].([]any) {
		hm, _ := h.(map[string]any)
		if hm == nil {
			continue
		}
		if unserBefehl(fmt.Sprint(hm["command"])) {
			return true
		}
	}
	return false
}

func unserBefehl(befehl string) bool {
	// Auch am Backslash trennen: die Einstellungsdatei kann von einem anderen
	// System stammen, etwa aus einem mitgenommenen Profil, und filepath.Base
	// kennt unter Unix nur den Schrägstrich.
	name := befehl
	if i := strings.LastIndexAny(name, `/\`); i >= 0 {
		name = name[i+1:]
	}
	name = strings.TrimSuffix(strings.ToLower(name), ".exe")
	return name == "plxr" || strings.HasPrefix(name, "plxr-")
}

// Eingerichtet sagt, ob plxr in den Einstellungen von Claude Code steht.
func Eingerichtet(configDir string) bool {
	if configDir == "" {
		home, _ := os.UserHomeDir()
		configDir = filepath.Join(home, ".claude")
	}
	b, err := os.ReadFile(filepath.Join(configDir, "settings.json"))
	if err != nil {
		return false
	}
	var einst map[string]any
	if json.Unmarshal(b, &einst) != nil {
		return false
	}
	hooks, _ := einst["hooks"].(map[string]any)
	for _, ev := range Ereignisse {
		liste, _ := hooks[ev].([]any)
		gefunden := false
		for _, e := range liste {
			if istUnserer(e) {
				gefunden = true
				break
			}
		}
		if !gefunden {
			return false
		}
	}
	return true
}
