package daemon

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

/* What the interface remembers.

   It used to live in the window's own storage, and in the window that storage
   is written nowhere: all three WebKit directories the app has ever had are
   empty. Theme, language, filter, the last directory, the chosen colours —
   every one of them was gone on the next start, and it looked like a bug in
   whatever had just been changed.

   So it lies with everything else that has to survive, in ~/.plxr. The browser
   keeps using its own storage as well; this is the copy that lasts.

   Deliberately untyped. These are the interface's own settings — it invents a
   key, uses it, drops it again, and none of that is the daemon's business. */

var prefsLock sync.Mutex

func prefsPath() string { return filepath.Join(Root(), "prefs.json") }

// Prefs never fails: no file means nothing remembered.
func ReadPrefs() map[string]any {
	prefsLock.Lock()
	defer prefsLock.Unlock()
	out := map[string]any{}
	b, err := os.ReadFile(prefsPath())
	if err != nil {
		return out
	}
	_ = json.Unmarshal(b, &out)
	return out
}

// WritePrefs merges: the interface sends what changed, not everything it knows.
// Sending the whole set would mean two windows overwriting each other's
// settings, and the one that closed last would win.
func WritePrefs(change map[string]any) error {
	prefsLock.Lock()
	defer prefsLock.Unlock()

	all := map[string]any{}
	if b, err := os.ReadFile(prefsPath()); err == nil {
		_ = json.Unmarshal(b, &all)
	}
	for k, v := range change {
		if v == nil {
			delete(all, k)
			continue
		}
		all[k] = v
	}
	b, err := json.MarshalIndent(all, "", " ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(Root(), 0o755); err != nil {
		return err
	}
	return os.WriteFile(prefsPath(), b, 0o644)
}
