package notify

import (
	"fmt"
	"log"
	"sync"
	"time"

	"plxr/internal/daemon"
)

/* Who shows a notification, and whether it is shown at all.

   The service is the one that notices — a session getting stuck, the spend
   going over the line — and until now it also did the showing. Measured, that
   is the wrong process for it: it is started detached from the window, has no
   run loop and is never launched by the system as an application, so macOS
   never answers its request for permission (the app is missing from the
   notification preferences after every kind of use) and refuses every
   notification it posts under its own name. Unbundled it has no name at all
   and falls back to the script, whose notifications belong to Script Editor.

   The window is a real application: foreground, bundled, launched by the
   system, with a run loop. It can hold the permission and post with the icon,
   and a click on what it posted comes back to it. So a window that is open
   subscribes here, and everything the service wants to say goes to the newest
   window instead of being shown from the service. With no window open the
   service shows it itself, exactly as before — a plain notification is still
   better than none.

   The decision whether to say anything lives here too, once, in front of both
   routes: do-not-disturb, and a ceiling on how much is said in a short time.
   Somebody with eight agents asking at once gets one line, not eight. */

// Message is one notification as it crosses from the service to whoever
// shows it. SessionID is what a click leads back to; Kind is what the
// notification is about, in the words the settings use.
type Message struct {
	Title     string `json:"title"`
	Body      string `json:"body"`
	Sound     string `json:"sound"`
	SessionID string `json:"sessionId,omitempty"`
	Kind      string `json:"kind"`
}

// How the system permission stands, as the window reports it. "unknown" is
// the state before any window has said.
const (
	PermissionUnknown  = "unknown"
	PermissionGranted  = "granted"
	PermissionDenied   = "denied"
	PermissionNotAsked = "notAsked"
)

// Outcome says what became of a message.
type Outcome string

const (
	// Handed to a window, which shows it.
	ViaWindow Outcome = "window"
	// Shown by the service itself, no window being open.
	ViaLocal Outcome = "local"
	// Not shown: do not disturb is on.
	Quiet Outcome = "quiet"
	// Not shown on its own: too many in a short time, and a summary went
	// out in its place.
	Summary Outcome = "summary"
	// Not shown at all: it fell inside a window that a summary already
	// covers.
	Folded Outcome = "folded"
)

// The ceiling: more than floodCap messages inside floodWindow and the rest
// of that window is said as one line.
const (
	floodCap    = 3
	floodWindow = 10 * time.Second
)

// Subscriber is one window listening for what to show.
type Subscriber struct {
	hub        *Hub
	frames     chan Message
	permission string
}

// Frames is what the window has to show, in order.
func (s *Subscriber) Frames() <-chan Message { return s.frames }

// SetPermission records how the system permission stands in the window's
// process. The settings panel shows it.
func (s *Subscriber) SetPermission(p string) {
	s.hub.mu.Lock()
	defer s.hub.mu.Unlock()
	s.permission = p
	s.hub.lastPermission = p
}

// Close takes the window off the list. Whatever comes next goes to the next
// newest window, or is shown by the service.
func (s *Subscriber) Close() {
	s.hub.mu.Lock()
	defer s.hub.mu.Unlock()
	for i, x := range s.hub.subs {
		if x == s {
			s.hub.subs = append(s.hub.subs[:i], s.hub.subs[i+1:]...)
			break
		}
	}
}

type stamp struct {
	at      time.Time
	session string
}

// Hub routes messages to the newest window, or to the local route when there
// is none, and holds the line on how much is said.
type Hub struct {
	mu   sync.Mutex
	subs []*Subscriber // oldest first
	// What a window last said about the permission, kept after it closed so
	// the settings can still say "denied" with the window gone.
	lastPermission string

	local func(Message)
	dnd   func() bool
	now   func() time.Time

	recent    []stamp
	summaryAt time.Time
}

// NewHub builds a hub. local shows a message from this process, dnd says
// whether do-not-disturb is on, now is the clock.
func NewHub(local func(Message), dnd func() bool, now func() time.Time) *Hub {
	return &Hub{local: local, dnd: dnd, now: now, lastPermission: PermissionUnknown}
}

// Subscribe adds a window. The newest one is the one that shows things.
func (h *Hub) Subscribe() *Subscriber {
	s := &Subscriber{hub: h, frames: make(chan Message, 16), permission: PermissionUnknown}
	h.mu.Lock()
	h.subs = append(h.subs, s)
	h.mu.Unlock()
	return s
}

// Windows is how many windows are listening.
func (h *Hub) Windows() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.subs)
}

// Permission is how the system permission stands: what the newest window
// says, or what the last one said before it went.
func (h *Hub) Permission() string {
	h.mu.Lock()
	defer h.mu.Unlock()
	for i := len(h.subs) - 1; i >= 0; i-- {
		if h.subs[i].permission != PermissionUnknown {
			return h.subs[i].permission
		}
	}
	return h.lastPermission
}

// route hands the message to the newest window that will take it, and to the
// local route when there is none. A window whose queue is full is one that
// has stopped reading — it is passed over, not waited for.
func (h *Hub) route(m Message) Outcome {
	h.mu.Lock()
	for i := len(h.subs) - 1; i >= 0; i-- {
		select {
		case h.subs[i].frames <- m:
			h.mu.Unlock()
			return ViaWindow
		default:
		}
	}
	h.mu.Unlock()
	h.local(m)
	return ViaLocal
}

// Post says one thing, subject to do-not-disturb and the ceiling.
func (h *Hub) Post(m Message) Outcome {
	if h.dnd() {
		return Quiet
	}
	h.mu.Lock()
	now := h.now()
	kept := h.recent[:0]
	for _, s := range h.recent {
		if now.Sub(s.at) < floodWindow {
			kept = append(kept, s)
		}
	}
	h.recent = append(kept, stamp{at: now, session: m.SessionID})
	if len(h.recent) <= floodCap {
		h.mu.Unlock()
		return h.route(m)
	}
	// Over the line. One summary per window, the rest folds into it.
	if now.Sub(h.summaryAt) < floodWindow {
		h.mu.Unlock()
		return Folded
	}
	h.summaryAt = now
	seen := map[string]bool{}
	for _, s := range h.recent {
		if s.session != "" {
			seen[s.session] = true
		}
	}
	h.mu.Unlock()
	// The service has no language: the words are the interface's business,
	// and this is the last resort when the line has to be said from here.
	body := fmt.Sprintf("%d sessions need you", len(seen))
	if len(seen) <= 1 {
		body = "a session keeps needing you"
	}
	h.route(Message{Title: "plxr", Body: body, Sound: m.Sound, Kind: "summary"})
	return Summary
}

// Try shows the test notification: past do-not-disturb and the ceiling,
// because somebody pressed the button for it, but by the same route as the
// real thing — that is what the button is there to show.
func (h *Hub) Try(sound string) Outcome {
	return h.route(Message{Title: "plxr", Body: "This is what it sounds like", Sound: sound, Kind: "test"})
}

// DoNotDisturb reads the switch from the shared settings: `dnd`, written by
// the window, read here because the service is where the saying happens.
func DoNotDisturb() bool {
	on, _ := daemon.ReadPrefs()["dnd"].(bool)
	return on
}

// Service is the hub the service uses. Tests put their own in its place.
var Service = NewHub(func(m Message) { Send(m.Title, m.Body, m.Sound) }, DoNotDisturb, time.Now)

// Post says one thing through the service's hub.
func Post(m Message) Outcome {
	out := Service.Post(m)
	if out != ViaWindow && out != ViaLocal {
		log.Printf("notify: %q not shown on its own (%s)", m.Body, out)
	}
	return out
}
