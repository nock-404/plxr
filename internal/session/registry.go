package session

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// Registry keeps the sessions in memory and mirrors them to ~/.plxr/sessions/.
type Registry struct {
	dir string
	mu  sync.RWMutex
	m   map[string]*Session
	/* What each session is doing right now.
	 *
	 * Kept apart from the stored Session on purpose, and never written to disk.
	 * The status is worked out on every snapshot — from the hook, or from the
	 * screen and how long it has been quiet — and Snapshot did that on the copy
	 * List hands out, so the stored Status was only ever "unknown" or "dead".
	 * Two things depended on it and neither worked: the sort below, which is
	 * meant to put a session that is waiting for somebody first and never did,
	 * and any question of the form "is an agent working in this directory".
	 *
	 * It changes several times a second and is worthless after a restart, which
	 * is exactly why it does not belong in the file. */
	live map[string]Status
}

func NewRegistry(dir string) (*Registry, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	r := &Registry{dir: dir, m: map[string]*Session{}, live: map[string]Status{}}
	return r, r.load()
}

func (r *Registry) load() error {
	entries, err := filepath.Glob(filepath.Join(r.dir, "*.json"))
	if err != nil {
		return err
	}
	for _, p := range entries {
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		var s Session
		if json.Unmarshal(b, &s) != nil || s.ID == "" {
			continue
		}
		// At startup nothing is alive that we did not start ourselves.
		//
		// If the session was last recorded as running, the daemon died and took
		// it along. Silently clearing that away would be the worst option: all
		// the person notices is that work is missing. So the entry stays,
		// marked orphaned — for Claude sessions together with the id that lets
		// the conversation be picked up again.
		if s.Alive {
			s.Alive = false
			s.Status = StatusDead
			s.Orphaned = true
			s.ExitCode = -1
			if s.EndedAt == 0 {
				s.EndedAt = time.Now().UnixMilli()
			}
			r.m[s.ID] = &s
			r.persist(&s)
			continue
		}
		os.Remove(p)
	}
	return nil
}

func (r *Registry) Put(s *Session) {
	r.mu.Lock()
	r.m[s.ID] = s
	r.mu.Unlock()
	r.persist(s)
}

func (r *Registry) Get(id string) (*Session, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	s, ok := r.m[id]
	return s, ok
}

// Update applies fn under the lock and writes to disk afterwards.
func (r *Registry) Update(id string, fn func(*Session)) {
	r.mu.Lock()
	s, ok := r.m[id]
	if ok {
		fn(s)
	}
	r.mu.Unlock()
	if ok {
		r.persist(s)
	}
}

func (r *Registry) Delete(id string) {
	r.mu.Lock()
	delete(r.m, id)
	r.mu.Unlock()
	os.Remove(filepath.Join(r.dir, id+".json"))
}

// List returns a copy, sorted: blocked ones first, then by start time.
// SetLive records what a session is doing, for this run only.
func (r *Registry) SetLive(id string, status Status) {
	if id == "" || status == "" {
		return
	}
	r.mu.Lock()
	if _, known := r.m[id]; known {
		r.live[id] = status
	}
	r.mu.Unlock()
}

// LiveStatus is what a session is doing, falling back to what was stored when
// nothing has been worked out yet — right after a restart, say.
func (r *Registry) LiveStatus(id string) Status {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if s, ok := r.live[id]; ok {
		return s
	}
	if s, ok := r.m[id]; ok {
		return s.Status
	}
	return StatusUnknown
}

// Busy lists the sessions running in a directory that are doing something —
// working, or waiting for an answer. What a branch switch has to ask about.
func (r *Registry) Busy(dir string) []Session {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := []Session{}
	for id, s := range r.m {
		if !s.Alive || s.Cwd != dir {
			continue
		}
		status := s.Status
		if live, ok := r.live[id]; ok {
			status = live
		}
		if status == StatusWorking || status.Blocking() {
			one := *s
			// The copy carries the status it was judged by. Left as stored it
			// answered "unknown" while the decision had been made on something
			// else entirely, which is a reply nobody can check.
			one.Status = status
			out = append(out, one)
		}
	}
	return out
}

func (r *Registry) List() []Session {
	r.mu.RLock()
	out := make([]Session, 0, len(r.m))
	for _, s := range r.m {
		one := *s
		// The order below is decided by what the session is doing now, not by
		// what was last written down about it.
		if live, ok := r.live[s.ID]; ok {
			one.Status = live
		}
		out = append(out, one)
	}
	r.mu.RUnlock()
	sort.Slice(out, func(i, j int) bool {
		bi, bj := out[i].Alive && out[i].Status.Blocking(), out[j].Alive && out[j].Status.Blocking()
		if bi != bj {
			return bi
		}
		if out[i].Alive != out[j].Alive {
			return out[i].Alive
		}
		return out[i].StartedAt > out[j].StartedAt
	})
	return out
}

func (r *Registry) persist(s *Session) {
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return
	}
	p := filepath.Join(r.dir, s.ID+".json")
	tmp := p + ".tmp"
	if os.WriteFile(tmp, b, 0o644) == nil {
		os.Rename(tmp, p)
	}
}
