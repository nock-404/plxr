package daemon

import (
	"encoding/json"
	"log"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
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

// ReadPrefs never fails on a missing file — nothing remembered is a normal
// state. A file that cannot be read is NOT: it is said out loud and the file is
// put aside rather than treated as empty.
//
// Swallowing that error was the dangerous half: a damaged file read as "no
// settings", the interface came up on defaults, and the next change wrote the
// file anew from that empty state. A read error turned into permanent loss
// without a word anywhere.
func ReadPrefs() map[string]any {
	prefsLock.Lock()
	defer prefsLock.Unlock()
	out, err := readPrefs()
	if err != nil {
		log.Printf("prefs: %v", err)
	}
	return out
}

func readPrefs() (map[string]any, error) {
	out := map[string]any{}
	b, err := os.ReadFile(prefsPath())
	if err != nil {
		return out, nil // no file, nothing remembered
	}
	if err := json.Unmarshal(b, &out); err != nil {
		return out, err
	}
	return out, nil
}

// WritePrefs merges: the interface sends what changed, not everything it knows.
// Sending the whole set would mean two windows overwriting each other's
// settings, and the one that closed last would win.
func WritePrefs(change map[string]any) error {
	prefsLock.Lock()
	defer prefsLock.Unlock()

	all := map[string]any{}
	if b, err := os.ReadFile(prefsPath()); err == nil {
		if err := json.Unmarshal(b, &all); err != nil {
			/* Not overwritten. What is there cannot be read, and writing over
			   it would turn a read error into a loss — everything except the
			   one key just changed would be gone for good. It is put aside,
			   so it can still be looked at. */
			aside := prefsPath() + ".broken"
			log.Printf("prefs: unreadable, kept as %s: %v", aside, err)
			_ = os.Rename(prefsPath(), aside)
			all = map[string]any{}
		}
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
	/* Written beside it and then moved into place.
	   A direct write leaves a half-finished file behind if the machine goes
	   down in the middle of it, and a half-finished file reads as no settings
	   at all — after which the next change writes it anew from nothing. The
	   rest of this repository has been doing it this way for a while; here it
	   was missed. */
	tmp := prefsPath() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, prefsPath())
}

/* The one setting the service reads for itself.

   The ceiling on the five-hour spend rides the same blob as everything else —
   `paceLimit`, a number of tokens, written by the usage panel through the same
   PUT and picked up by every other window through the revision watch. It is
   read here because the crossing has to be noticed with no window open: the
   window shows the readout, the service says the one word when the line is
   crossed. Zero or absent means no ceiling was set. */

// PaceLimit is the self-set ceiling for the five-hour spend, in tokens; zero
// when none is set. A number that arrived as text counts too — a field is where
// it gets typed.
func PaceLimit() int64 {
	return paceLimitOf(ReadPrefs()["paceLimit"])
}

func paceLimitOf(raw any) int64 {
	var n float64
	switch v := raw.(type) {
	case float64:
		n = v
	case string:
		n, _ = strconv.ParseFloat(strings.TrimSpace(v), 64)
	default:
		return 0
	}
	if n <= 0 || n != n || n > math.MaxInt64/2 {
		return 0
	}
	return int64(n)
}

/* What the window complains about, written where it can be read.

   The window has no developer tools. An error inside it — a script that did
   not load, a call that went out too early, a handler that threw — leaves no
   trace anywhere outside it. The workbench shows it to whoever has the window
   open and nobody else, so every one of them had to be found by asking the
   user what he saw.

   So it is sent here and appended to ~/.plxr/window.log. Capped, because a
   window that fails in a loop must not fill the disk. */

const windowLogCap = 200 * 1024

func windowLogPath() string { return filepath.Join(Root(), "window.log") }

func AppendWindowLog(lines string) error {
	if lines == "" {
		return nil
	}
	if err := os.MkdirAll(Root(), 0o755); err != nil {
		return err
	}
	path := windowLogPath()
	if st, err := os.Stat(path); err == nil && st.Size() > windowLogCap {
		// Half away rather than all: what is left is the older half of the
		// story, and the newest lines are about to be appended anyway.
		if b, err := os.ReadFile(path); err == nil {
			_ = os.WriteFile(path, b[len(b)/2:], 0o644)
		}
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.WriteString(lines)
	return err
}

/* Which version of the settings this is.
 *
 * Two windows on the same control room each read the settings once, when they
 * start, and never again. So a skin changed in one of them left the other on
 * what it happened to have; both then wrote the whole set back, and whichever
 * was last won — silently, with no way to tell which that had been.
 *
 * The file's own modification time is the version. Nothing to keep in step,
 * nothing to reset when the daemon restarts, and it changes on every write
 * because a write is an atomic rename.
 */
func PrefsRev() int64 {
	st, err := os.Stat(prefsPath())
	if err != nil {
		return 0
	}
	return st.ModTime().UnixNano()
}
