package accounts

/* What the Accounts page says about an account, besides its name.

   A fourth account could be added from the page and nothing on the page said
   whether it had worked: whether anybody had signed in to it, whether plxr's
   hook was in its settings, whether it read the same conversations as the
   other three, and whether Claude Code had ever fetched its usage. All four
   are on disk, and all four are read here.

   The sign-in is read as the presence of one key in Claude Code's own state
   file, and nothing more. What the key holds is the signed-in account, and it
   is none of plxr's business: it is not decoded, kept, logged or sent. The
   credentials themselves live in a file and in the keychain that this never
   opens.
*/

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// State is what the page shows about one account right now. Worked out on
// request by Describe and never saved: it describes the disk, not the list.
type State struct {
	// SignedIn is whether Claude Code has recorded a signed-in account.
	SignedIn bool `json:"signedIn"`
	// Hook is whether plxr's hook is in this account's settings.
	Hook bool `json:"hook"`
	// Projects is the directory its transcripts are really read from, every
	// link resolved, with the home directory written as ~. Empty when there is
	// none to read.
	Projects string `json:"projects"`
	// SharedWith names the other accounts in the list that read the same
	// directory. Empty means it keeps its conversations to itself.
	SharedWith []string `json:"sharedWith"`
	// UsageAt is when Claude Code last fetched this account's usage, in
	// milliseconds. 0 when it never has.
	UsageAt int64 `json:"usageAt"`
	// File is the state file all of this was read from, home written as ~ —
	// so the page can say where it looked.
	File string `json:"file"`
}

// StateFile is where Claude Code keeps its own state for an account.
//
// The default ~/.claude keeps it beside the directory, in ~/.claude.json; an
// account started through CLAUDE_CONFIG_DIR keeps it inside, in
// <dir>/.claude.json. Env is what decides which of the two an account is, so
// the file read here is the file the sessions it starts will write.
func StateFile(a Account) string {
	if len(a.Env()) == 0 {
		home, _ := os.UserHomeDir()
		return filepath.Join(home, ".claude.json")
	}
	return filepath.Join(a.Dir, ".claude.json")
}

// Describe fills in State for every account in the list. hooked says whether
// plxr's hook is in a configuration directory; it is handed in rather than
// called from here, because the hook package is not this one's to import.
func Describe(list []Account, hooked func(dir string) bool) []Account {
	real := make([]string, len(list))
	for i, a := range list {
		real[i] = resolved(a.ProjectsDir())
	}
	out := make([]Account, len(list))
	for i, a := range list {
		st := &State{SharedWith: []string{}, Projects: short(real[i]), File: short(StateFile(a))}
		for j, b := range list {
			if j != i && real[i] != "" && real[j] == real[i] {
				st.SharedWith = append(st.SharedWith, b.Name)
			}
		}
		st.SignedIn, st.UsageAt = readState(StateFile(a))
		if hooked != nil {
			st.Hook = hooked(a.Dir)
		}
		a.State = st
		out[i] = a
	}
	return out
}

// resolved is a projects directory with every link followed, or "" when
// there is no directory there to read.
func resolved(dir string) string {
	real, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return ""
	}
	if info, err := os.Stat(real); err != nil || !info.IsDir() {
		return ""
	}
	return real
}

// short writes the home directory as ~.
func short(p string) string {
	home, _ := os.UserHomeDir()
	if p == "" || home == "" || !strings.HasPrefix(p, home+string(filepath.Separator)) {
		return p
	}
	return "~" + p[len(home):]
}

// presence records that a key was in the file and nothing about what it
// held: the bytes it is handed are not looked at, copied or kept.
type presence bool

func (p *presence) UnmarshalJSON([]byte) error {
	*p = true
	return nil
}

// stateOnDisk is the little of Claude Code's state file that is read. The
// decoder skips everything else — and there is a great deal of it.
type stateOnDisk struct {
	SignedIn presence `json:"oauthAccount"`
	Usage    struct {
		FetchedAtMs float64 `json:"fetchedAtMs"`
	} `json:"cachedUsageUtilization"`
}

// seenState is one file's answer, kept against its size and time.
type seenState struct {
	size     int64
	mod      time.Time
	signedIn bool
	usageAt  int64
}

/* The page asks every few seconds while somebody is signing in, and a state
 * file on a machine that has been used for a while runs to megabytes of
 * project history. The answer is kept for as long as the file has the same
 * size and time, so asking again costs a stat. */
var (
	stateMu   sync.Mutex
	stateSeen = map[string]seenState{}
)

// readState reads whether an account is signed in and when its usage was last
// fetched. A missing or unreadable file is neither, which is the truth about
// an account Claude Code has never run under.
func readState(path string) (signedIn bool, usageAt int64) {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false, 0
	}
	stateMu.Lock()
	seen, ok := stateSeen[path]
	stateMu.Unlock()
	if ok && seen.size == info.Size() && seen.mod.Equal(info.ModTime()) {
		return seen.signedIn, seen.usageAt
	}

	b, err := os.ReadFile(path)
	if err != nil {
		return false, 0
	}
	var raw stateOnDisk
	// A field of an unexpected shape does not make the rest of the file
	// unreadable; a file cut off halfway through being written does, and that
	// answer is not kept.
	if err := json.Unmarshal(b, &raw); err != nil {
		var odd *json.UnmarshalTypeError
		if !errors.As(err, &odd) {
			return false, 0
		}
	}
	signedIn, usageAt = bool(raw.SignedIn), int64(raw.Usage.FetchedAtMs)
	stateMu.Lock()
	stateSeen[path] = seenState{size: info.Size(), mod: info.ModTime(), signedIn: signedIn, usageAt: usageAt}
	stateMu.Unlock()
	return signedIn, usageAt
}
