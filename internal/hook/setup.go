package hook

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
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
func istUnserer(eintrag any) bool {
	m, _ := eintrag.(map[string]any)
	if m == nil {
		return false
	}
	hs, _ := m["hooks"].([]any)
	for _, h := range hs {
		hm, _ := h.(map[string]any)
		if hm == nil {
			continue
		}
		if filepath.Base(fmt.Sprint(hm["command"])) == "plxr" {
			return true
		}
		args, _ := hm["args"].([]any)
		for _, a := range args {
			if fmt.Sprint(a) == "hook" {
				if c := fmt.Sprint(hm["command"]); filepath.Base(c) == "plxr" {
					return true
				}
			}
		}
	}
	return false
}
