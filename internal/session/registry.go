package session

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"sync"
)

// Registry hält die Sessions im Speicher und spiegelt sie nach ~/.plxr/sessions/.
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
		// Beim Start lebt nichts mehr, was wir nicht selbst gestartet haben.
		// Ein toter Eintrag lässt sich nicht fortsetzen — der Prozess ist weg,
		// das Terminal auch. Also wegräumen statt als leere Kachel anzeigen.
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

// Update wendet fn unter Lock an und schreibt danach auf Platte.
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

// List gibt eine Kopie zurück, sortiert: blockierte zuerst, dann nach Start.
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
