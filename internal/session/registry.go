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
}

func NewRegistry(dir string) (*Registry, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	r := &Registry{dir: dir, m: map[string]*Session{}}
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
func (r *Registry) List() []Session {
	r.mu.RLock()
	out := make([]Session, 0, len(r.m))
	for _, s := range r.m {
		out = append(out, *s)
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
