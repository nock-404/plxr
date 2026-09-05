// Package workspace keeps the folders plxr has open, independently of sessions.
//
// Everything to do with files used to hang off a session: c.root(sessionID)
// read the working directory out of the session registry, so the tree, the
// editor and the git status all died with the session — and a session is
// cleared away shortly after it ends. An editor needs a folder that stays.
//
// A workspace is a folder somebody opened, given an id of our own. The id is
// what requests carry, never a path: a route that takes a directory from the
// caller is a route that reads any directory on the machine.
package workspace

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"plxr/internal/uierr"
	"runtime"
	"strings"
	"sync"
	"time"
)

// Prefix marks an id as ours, so one glance tells a workspace from a session.
const Prefix = "w-"

type Workspace struct {
	ID   string `json:"id"`
	Path string `json:"path"` // as it was opened, for showing
	// Real is Path with every symlink resolved, as it stood when opened. It is
	// the leash: if the path resolves somewhere else later, somebody has moved
	// a link underneath us and the folder is refused rather than followed.
	Real     string `json:"real"`
	Label    string `json:"label,omitempty"`
	OpenedAt int64  `json:"opened_at"`
	UsedAt   int64  `json:"used_at"`
	// Missing is worked out when the list is read, never stored. A folder on a
	// volume that is not mounted is not a folder to forget — it comes back when
	// the disk does.
	Missing bool `json:"missing"`
}

var mu sync.Mutex

func file(home string) string { return filepath.Join(home, "workspaces.json") }

// IsID says whether an id addresses a workspace rather than a session.
func IsID(id string) bool { return strings.HasPrefix(id, Prefix) }

func newID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		// Never seen in practice; a time-based id is still unique enough here
		// and beats refusing to open a folder.
		return Prefix + hex.EncodeToString([]byte(time.Now().Format("150405.000000")))
	}
	return Prefix + hex.EncodeToString(b)
}

// samePlace compares two resolved paths the way the file system does.
//
// macOS and Windows do not distinguish case here, Linux does. Getting this
// wrong means opening the same folder twice under two ids on one system and
// refusing a legitimate second folder on another.
func samePlace(a, b string) bool {
	if runtime.GOOS == "linux" {
		return a == b
	}
	return strings.EqualFold(a, b)
}

func read(home string) ([]Workspace, error) {
	b, err := os.ReadFile(file(home))
	if err != nil {
		if os.IsNotExist(err) {
			return []Workspace{}, nil
		}
		return nil, err
	}
	var out []Workspace
	if err := json.Unmarshal(b, &out); err != nil {
		// A file we cannot read is not a reason to lose the folders somebody
		// opened, so it is set aside rather than overwritten.
		_ = os.Rename(file(home), file(home)+".broken")
		return []Workspace{}, nil
	}
	return out, nil
}

func write(home string, list []Workspace) error {
	if err := os.MkdirAll(home, 0o755); err != nil {
		return uierr.With("err.workspace.notWritten", err.Error())
	}
	b, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return uierr.With("err.workspace.notWritten", err.Error())
	}
	tmp := file(home) + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return uierr.With("err.workspace.notWritten", err.Error())
	}
	if err := os.Rename(tmp, file(home)); err != nil {
		return uierr.With("err.workspace.notWritten", err.Error())
	}
	return nil
}

// List returns the open folders, newest use first, each marked with whether it
// can be reached right now.
func List(home string) []Workspace {
	mu.Lock()
	defer mu.Unlock()
	list, err := read(home)
	if err != nil {
		return []Workspace{}
	}
	for i := range list {
		info, err := os.Stat(list[i].Path)
		list[i].Missing = err != nil || !info.IsDir()
	}
	for i := 1; i < len(list); i++ {
		for j := i; j > 0 && list[j].UsedAt > list[j-1].UsedAt; j-- {
			list[j], list[j-1] = list[j-1], list[j]
		}
	}
	return list
}

// Open takes a directory and hands back the workspace for it, making one if
// this folder has not been opened before. Opening the same folder twice returns
// the same id: a list that grows a duplicate every time somebody clicks is a
// junk drawer, not a list of what is open.
func Open(home, path string) (Workspace, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return Workspace{}, uierr.New("err.workspace.noPath")
	}
	if strings.HasPrefix(path, "~") {
		h, err := os.UserHomeDir()
		if err != nil {
			return Workspace{}, err
		}
		path = h + path[1:]
	}
	path = filepath.Clean(path)
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return Workspace{}, uierr.With("err.dir.missing", path)
	}
	real, err := filepath.EvalSymlinks(path)
	if err != nil {
		return Workspace{}, uierr.With("err.dir.missing", path)
	}

	mu.Lock()
	defer mu.Unlock()
	list, err := read(home)
	if err != nil {
		return Workspace{}, uierr.With("err.workspace.notWritten", err.Error())
	}
	now := time.Now().UnixMilli()
	for i := range list {
		if samePlace(list[i].Real, real) {
			list[i].UsedAt = now
			if err := write(home, list); err != nil {
				return Workspace{}, err
			}
			return list[i], nil
		}
	}
	made := Workspace{ID: newID(), Path: path, Real: real, OpenedAt: now, UsedAt: now}
	list = append(list, made)
	if err := write(home, list); err != nil {
		return Workspace{}, err
	}
	return made, nil
}

// Get finds a workspace by id without touching the disk beyond reading.
func Get(home, id string) (Workspace, error) {
	mu.Lock()
	defer mu.Unlock()
	list, err := read(home)
	if err != nil {
		return Workspace{}, uierr.New("err.workspace.unknown")
	}
	for _, w := range list {
		if w.ID == id {
			return w, nil
		}
	}
	return Workspace{}, uierr.New("err.workspace.unknown")
}

// RootOf is the directory a request may work in, or a reason why not.
//
// Three different answers, because they need three different sentences: the id
// is not one of ours, the folder cannot be reached right now — an unmounted
// volume, which is the ordinary case on this machine — or the path resolves
// somewhere other than it did, which means a link was swapped underneath and
// following it would hand out a directory nobody opened.
func RootOf(home, id string) (string, error) {
	w, err := Get(home, id)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(w.Path)
	if err != nil || !info.IsDir() {
		return "", uierr.With("err.workspace.unreachable", w.Path)
	}
	real, err := filepath.EvalSymlinks(w.Path)
	if err != nil {
		return "", uierr.With("err.workspace.unreachable", w.Path)
	}
	if !samePlace(real, w.Real) {
		return "", uierr.With("err.workspace.moved", w.Path)
	}
	return real, nil
}

// Close takes a folder off the list. Nothing on disk is touched.
func Close(home, id string) error {
	mu.Lock()
	defer mu.Unlock()
	list, err := read(home)
	if err != nil {
		return uierr.New("err.workspace.unknown")
	}
	out := make([]Workspace, 0, len(list))
	for _, w := range list {
		if w.ID != id {
			out = append(out, w)
		}
	}
	if len(out) == len(list) {
		return uierr.New("err.workspace.unknown")
	}
	return write(home, out)
}
