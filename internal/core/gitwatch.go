package core

import (
	"encoding/json"
	"fmt"
	"hash/fnv"
	"path/filepath"
	"sync"
	"time"

	"plxr/internal/git"
	"plxr/internal/uierr"
)

/* One live-git signal.
 *
 * The changes panel follows the session you are working in, and it has to
 * move as an agent writes — without an AGAIN button, and without every window
 * and every panel running its own `git status`. So there is one watcher per
 * folder, shared: two sessions in the same folder, or two windows looking at
 * the same one, hold one loop and one status per tick between them. The loop
 * starts with the first subscriber and stops with the last; a folder nobody
 * is looking at costs nothing.
 *
 * Polling, not fsnotify — the fleet watcher settled that: the writes that
 * matter arrive as tmp+rename, and rename is the event fsnotify is least
 * reliable about. Each tick runs the same git.Changes and git.Position the
 * REST routes run; there is no second opinion about what changed.
 *
 * Keyed by the resolved path, not by the id that asked: two ids for one
 * folder — a session and a workspace opened on its directory — are one
 * watcher, and a symlinked path and its target are the same folder. */

// PollActive is the pace while the folder is moving: a change was seen less
// than ActiveFor ago, so the next one is probably close behind.
const PollActive = time.Second

// PollIdle is the pace once the folder has been still for ActiveFor: still
// inside the two seconds an operator notices, half the processes.
const PollIdle = 2 * time.Second

// ActiveFor is how long after a change the fast pace is kept.
const ActiveFor = 20 * time.Second

// ChangesFrame is what a subscriber receives whenever the folder's state has
// a different rev than last time — and once on arrival, so a window that
// connects to a folder somebody else already watches is not left waiting
// for the next tick.
type ChangesFrame struct {
	Changes []git.Change `json:"changes"`
	Where   git.Where    `json:"where"`
	// Head is the commit HEAD sits on. The list of changes cannot say "a
	// commit landed" on its own — nothing staged and nothing changed looks
	// the same before and after — and the history only needs asking again
	// when this moves.
	Head string `json:"head"`
	// Rev is a hash of everything above. Equal revs are the same state, so
	// the transport sends nothing and the window redraws nothing.
	Rev string `json:"rev"`
	// Problem is an error code when the folder could not be read this tick —
	// it is gone, or git refused. Sent as a frame rather than closing the
	// subscription: the folder may come back, and the panel says what is
	// wrong instead of going blank.
	Problem string `json:"problem,omitempty"`
}

// ProblemFrame is the one frame a folder that cannot be followed gets: the
// code, an empty list rather than none, and a rev so it still counts as a
// state.
func ProblemFrame(err error) ChangesFrame {
	f := ChangesFrame{Changes: []git.Change{}, Problem: err.Error()}
	f.Rev = rev(f)
	return f
}

// ChangesSub is one subscriber's handle on a shared watcher.
type ChangesSub struct {
	w      *gitWatch
	frames chan ChangesFrame
	once   sync.Once
}

// Frames delivers each new state. The channel holds one frame: a subscriber
// that is slow to read gets the latest, never a backlog.
func (s *ChangesSub) Frames() <-chan ChangesFrame { return s.frames }

// Close lets go of the watcher; the last one out stops the loop.
func (s *ChangesSub) Close() {
	s.once.Do(func() { s.w.drop(s) })
}

// gitWatch is the shared loop for one resolved folder.
type gitWatch struct {
	root  string
	owner *Core

	mu   sync.Mutex
	subs map[*ChangesSub]struct{}
	last ChangesFrame
	stop chan struct{}
	// polls counts the ticks this loop has run — what a test reads to prove
	// two subscribers did not become two loops.
	polls int
}

// SubscribeChanges starts following the folder of a session or a workspace.
//
// The id is resolved once, here, the way every git route resolves it; a
// session that ends while it is followed keeps its folder, because the folder
// is what was subscribed to.
func (c *Core) SubscribeChanges(id string) (*ChangesSub, error) {
	root, err := c.root(id)
	if err != nil {
		return nil, err
	}
	if !git.IsRepo(root) {
		return nil, uierr.New("err.git.noRepo")
	}
	key := root
	if r, err := filepath.EvalSymlinks(root); err == nil {
		key = r
	}

	// Found and joined under the one lock. Joined after letting go of it, a
	// watcher whose last subscriber left in between would be joined just as
	// its loop stopped — a subscription that never delivers anything.
	c.watchMu.Lock()
	defer c.watchMu.Unlock()
	w, ok := c.watches[key]
	if !ok {
		w = &gitWatch{root: root, owner: c, subs: map[*ChangesSub]struct{}{}, stop: make(chan struct{})}
		c.watches[key] = w
		go w.run()
	}

	sub := &ChangesSub{w: w, frames: make(chan ChangesFrame, 1)}
	w.mu.Lock()
	w.subs[sub] = struct{}{}
	// Whatever the loop last saw goes out at once. A loop that has not
	// ticked yet has nothing, and its first tick reaches this subscriber
	// like every other.
	if w.last.Rev != "" {
		sub.frames <- w.last
	}
	w.mu.Unlock()
	return sub, nil
}

// WatchCount says how many folders are being followed, and how many
// subscribers one of them has — for tests, which have to prove the sharing.
func (c *Core) WatchCount(root string) (watchers, subscribers, polls int) {
	key := root
	if r, err := filepath.EvalSymlinks(root); err == nil {
		key = r
	}
	c.watchMu.Lock()
	defer c.watchMu.Unlock()
	if w, ok := c.watches[key]; ok {
		w.mu.Lock()
		subscribers, polls = len(w.subs), w.polls
		w.mu.Unlock()
	}
	return len(c.watches), subscribers, polls
}

func (w *gitWatch) drop(sub *ChangesSub) {
	c := w.owner
	c.watchMu.Lock()
	w.mu.Lock()
	delete(w.subs, sub)
	empty := len(w.subs) == 0
	if empty {
		// Taken off the map under the same lock that adds to it, so a
		// subscriber arriving now starts a fresh loop rather than joining
		// one that is about to stop.
		for key, other := range c.watches {
			if other == w {
				delete(c.watches, key)
			}
		}
		close(w.stop)
	}
	w.mu.Unlock()
	c.watchMu.Unlock()
}

// run is the loop: read, compare, tell everyone, wait.
func (w *gitWatch) run() {
	lastChange := time.Now()
	for {
		frame := w.read()
		w.mu.Lock()
		w.polls++
		moved := frame.Rev != w.last.Rev
		if moved {
			w.last = frame
			for sub := range w.subs {
				// The one slot holds the latest: a stale frame nobody read
				// yet is replaced, never queued behind.
				select {
				case sub.frames <- frame:
				default:
					select {
					case <-sub.frames:
					default:
					}
					sub.frames <- frame
				}
			}
		}
		w.mu.Unlock()
		if moved {
			lastChange = time.Now()
		}
		pace := PollIdle
		if time.Since(lastChange) < ActiveFor {
			pace = PollActive
		}
		select {
		case <-w.stop:
			return
		case <-time.After(pace):
		}
	}
}

// read is one tick: the same calls the routes make, and a rev over them.
func (w *gitWatch) read() ChangesFrame {
	f := ChangesFrame{Changes: []git.Change{}}
	changes, err := git.Changes(w.root)
	if err != nil {
		f.Problem = uierr.With("err.git.failed", err.Error()).Error()
		f.Rev = rev(f)
		return f
	}
	f.Changes = changes
	if where, err := git.Position(w.root); err == nil {
		f.Where = where
	}
	f.Head = git.Head(w.root)
	f.Rev = rev(f)
	return f
}

// rev hashes a frame's content. Sixty-four bits of FNV over the JSON: not
// cryptographic, and it does not need to be — two different states of one
// folder within a session colliding is not a risk worth a slower hash on
// every tick.
func rev(f ChangesFrame) string {
	h := fnv.New64a()
	b, _ := json.Marshal(f.Changes)
	h.Write(b)
	b, _ = json.Marshal(f.Where)
	h.Write(b)
	h.Write([]byte(f.Head))
	h.Write([]byte(f.Problem))
	return fmt.Sprintf("%016x", h.Sum64())
}
