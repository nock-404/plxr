package hook

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Events are the hook points plxr records at.
var Events = []string{
	"SessionStart", "UserPromptSubmit", "PreToolUse", "Notification", "Stop", "SessionEnd",
}

// Install registers plxr in the Claude Code settings.
//
// Existing hooks are left alone: the file belongs to the user, and anyone who
// has already set something up there would rightly resent a foreign program
// overwriting it. Only what is missing gets added.
func Install(configDir string, entfernen bool) (string, error) {
	if configDir == "" {
		home, _ := os.UserHomeDir()
		configDir = filepath.Join(home, ".claude")
	}
	if _, err := os.Stat(configDir); err != nil {
		return "", errors.New("kein Claude-Code-Verzeichnis: " + configDir)
	}
	path := filepath.Join(configDir, "settings.json")

	einst := map[string]any{}
	if b, err := os.ReadFile(path); err == nil && len(b) > 0 {
		if err := json.Unmarshal(b, &einst); err != nil {
			return "", errors.New(path + " ist kein gültiges JSON: " + err.Error())
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

	changed := false
	for _, ev := range Events {
		liste, _ := hooks[ev].([]any)
		fresh := make([]any, 0, len(liste))
		vorhanden := false
		for _, entry := range liste {
			if isOurs(entry) {
				changed = true
				if entfernen {
					continue // gets dropped
				}
				vorhanden = true
			}
			fresh = append(fresh, entry)
		}
		if !entfernen && !vorhanden {
			fresh = append(fresh, map[string]any{
				"hooks": []any{map[string]any{
					"type":    "command",
					"command": exe,
					"args":    []any{"hook"},
					// Without async every tool call would wait on us.
					"async": ev != "SessionEnd",
				}},
			})
			changed = true
		}
		if len(fresh) == 0 {
			delete(hooks, ev)
		} else {
			hooks[ev] = fresh
		}
	}

	if !changed {
		return path, nil
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
	// A backup before writing: this is the user's configuration file, not
	// ours.
	if old, err := os.ReadFile(path); err == nil {
		os.WriteFile(path+".vor-plxr", old, 0o644)
	}
	tmp := fmt.Sprintf("%s.%d.tmp", path, os.Getpid())
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return "", err
	}
	return path, os.Rename(tmp, path)
}

// istUnserer erkennt einen von plxr angelegten Eintrag.
/* isOurs recognises an entry by the file name of its command — by its start,
   not character for character. What gets written is the path of the currently
   running binary; on Windows that is "plxr.exe", and while developing it may be
   something else again. Comparing for equality would mean: plxr no longer
   recognises its own entry, keeps reporting "not installed", and adds another
   one next to it on every click. */
func isOurs(entry any) bool {
	m, _ := entry.(map[string]any)
	if m == nil {
		return false
	}
	for _, h := range m["hooks"].([]any) {
		hm, _ := h.(map[string]any)
		if hm == nil {
			continue
		}
		if isOurCommand(fmt.Sprint(hm["command"])) {
			return true
		}
	}
	return false
}

func isOurCommand(befehl string) bool {
	// Split on the backslash as well: the settings file may come from another
	// system, say from a profile carried over, and filepath.Base only knows the
	// forward slash on Unix.
	name := befehl
	if i := strings.LastIndexAny(name, `/\`); i >= 0 {
		name = name[i+1:]
	}
	name = strings.TrimSuffix(strings.ToLower(name), ".exe")
	return name == "plxr" || strings.HasPrefix(name, "plxr-")
}

// Installed reports whether plxr is present in the Claude Code settings.
func Installed(configDir string) bool {
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
	for _, ev := range Events {
		liste, _ := hooks[ev].([]any)
		gefunden := false
		for _, e := range liste {
			if isOurs(e) {
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
