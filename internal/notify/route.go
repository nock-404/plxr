package notify

import (
	"fmt"
	"sync"
	"time"

	"plxr/internal/daemon"
)

// Who shows a notification, and whether it is shown at all.
//
// The service is the one that notices — a session getting stuck, the spend
// going over the line — and it used to do the showing too. On macOS that is
// the wrong process: see notify_darwin.go for what was measured. There the
// service has no route of its own at all; the plxr window is the one process
// that asks the system for the permission and the one that posts, under
// plxr's name, with plxr's icon, and a click on what it posted comes back to
// it. On Linux and Windows the service's own route is sound and stays.
//
// A window that is open subscribes here, says how the permission stands in
// its process and which bundle it posts under, and exactly one window is
// handed each message: the newest that holds the permission, or else the
// newest whose permission stands refused — measured, a refusal left behind by
// a question that was never answered still lets a posted notification
// through, and whether it is shown is the system's call, not a guess made
// here. A window that has not asked yet is passed over: it would only post
// into a question nobody has put.
//
// The decision whether to say anything lives here too, once, in front of
// every route: do-not-disturb, a session that is already in front of a
// window with focus, and a ceiling on how much is said in a short time.
// Somebody with eight agents asking at once gets one line, not eight.

// Message is one notification as it crosses from the service to whoever
// shows it. SessionID is what a click leads back to; Kind is what the
// notification is about, in the words the settings use.
type Message struct {
	Title     string `json:"title"`
	Body      string `json:"body"`
	Sound     string `json:"sound"`
	SessionID string `json:"sessionId,omitempty"`
	Kind      string `json:"kind"`
	// Not a notification but a request to the window: ask the system for the
	// permission and report the answer. Sent when somebody presses ALLOW
	// NOTIFICATIONS, which is in a page that cannot ask the system itself.
	Authorize bool `json:"authorize,omitempty"`
	// Not a notification either: read the permission again and say how it
	// stands. Sent while the settings are open, so they show it as it is now
	// and not as it was when the window connected.
	Refresh bool `json:"refresh,omitempty"`
}

// How the system permission stands, as the window reports it. "unknown" is
// the state before any window has said.
const (
	PermissionUnknown  = "unknown"
	PermissionGranted  = "granted"
	PermissionDenied   = "denied"
	PermissionNotAsked = "notAsked"
	// The system's question is on screen and not answered yet.
	PermissionAsking = "asking"
)

// Outcome says what became of a message.
type Outcome string

const (
	// Handed to exactly one window, which shows it.
	ViaWindow Outcome = "window"
	// Shown by the service itself — Linux and Windows only.
	ViaLocal Outcome = "local"
	// Not shown: no window is open, and the service does not show anything
	// itself here.
	NoWindow Outcome = "none"
	// Not shown: a window is open, but plxr has not been allowed to show
	// notifications there yet.
	NotAllowed Outcome = "notAllowed"
	// Not shown: do not disturb is on.
	Quiet Outcome = "quiet"
	// Not shown: the session it is about is in front of a window that has
	// focus, so it is being looked at already.
	InFront Outcome = "front"
	// Not shown on its own: too many in a short time, and a summary went
	// out in its place.
	Summary Outcome = "summary"
	// Not shown at all: it fell inside a stretch a summary already covers.
	Folded Outcome = "folded"
)

// The ceiling: more than floodCap messages inside floodWindow and the rest
// of that stretch is said as one line.
const (
	floodCap    = 3
	floodWindow = 10 * time.Second
)

// A page's word on which session it has in front stands for frontFresh
// without being said again — it repeats it well inside that while it has
// focus, so a page that was closed without a word stops silencing anything
// soon after. frontPages bounds how many pages are remembered at once.
const (
	frontFresh = 45 * time.Second
	frontPages = 64
)

// Subscriber is one window listening for what to show.
type Subscriber struct {
	hub        *Hub
	frames     chan Message
	permission string
	bundle     string
}

// Frames is what the window has to show, in order.
func (s *Subscriber) Frames() <-chan Message { return s.frames }

// Report records what the window said about itself: how the permission
// stands in its process, and the bundle identifier it posts under. Empty
// fields leave what was said before.
func (s *Subscriber) Report(permission, bundle string) {
	s.hub.mu.Lock()
	defer s.hub.mu.Unlock()
	if permission != "" {
		s.permission = permission
		s.hub.lastPermission = permission
	}
	if bundle != "" {
		s.bundle = bundle
		s.hub.lastBundle = bundle
	}
}

// Close takes the window off the list.
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

type front struct {
	session string
	at      time.Time
}

// Hub routes each message to one window, or to the service's own route where
// there is one, and holds the line on how much is said.
type Hub struct {
	mu   sync.Mutex
	subs []*Subscriber // oldest first
	// What a window last said, kept after it closed so the settings can
	// still say "denied" and still open the right pane with the window gone.
	lastPermission string
	lastBundle     string

	local func(Message) // nil where the service shows nothing itself
	dnd   func() bool
	now   func() time.Time

	recent    []stamp
	summaryAt time.Time
	fronts    map[string]front // page → the session it has in front, while focused
}

// NewHub builds a hub. local shows a message from the service's own process
// and is nil where it must not; dnd says whether do-not-disturb is on; now is
// the clock.
func NewHub(local func(Message), dnd func() bool, now func() time.Time) *Hub {
	return &Hub{local: local, dnd: dnd, now: now, lastPermission: PermissionUnknown, fronts: map[string]front{}}
}

// Subscribe adds a window.
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

// ServiceShows says whether the service shows a notification itself when no
// window takes it — Linux and Windows, where no permission is held by any one
// process, and never macOS.
func (h *Hub) ServiceShows() bool { return h.local != nil }

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

// Bundle is the bundle identifier the newest window posts under, or the last
// one said — what System Settings is opened on.
func (h *Hub) Bundle() string {
	h.mu.Lock()
	defer h.mu.Unlock()
	for i := len(h.subs) - 1; i >= 0; i-- {
		if h.subs[i].bundle != "" {
			return h.subs[i].bundle
		}
	}
	return h.lastBundle
}

// rank orders the windows for the one-poster election: 2 holds the
// permission, 1 may post and leaves the showing to the system, 0 is passed
// over.
func rank(permission string) int {
	switch permission {
	case PermissionGranted:
		return 2
	case PermissionDenied, PermissionAsking:
		return 1
	}
	return 0
}

// route hands the message to exactly one window: the newest of the best
// rank that is still reading. A window whose queue is full has stopped
// reading — it is passed over, not waited for. With no window to take it the
// service's own route shows it where there is one; otherwise it is not shown.
func (h *Hub) route(m Message) Outcome {
	h.mu.Lock()
	candidates := 0
	for r := 2; r >= 1; r-- {
		for i := len(h.subs) - 1; i >= 0; i-- {
			if rank(h.subs[i].permission) != r {
				continue
			}
			candidates++
			select {
			case h.subs[i].frames <- m:
				h.mu.Unlock()
				return ViaWindow
			default:
			}
		}
	}
	windows := len(h.subs)
	h.mu.Unlock()
	if h.local != nil {
		h.local(m)
		return ViaLocal
	}
	if windows > 0 && candidates == 0 {
		return NotAllowed
	}
	return NoWindow
}

// Authorize asks the newest window — one, never all of them — to put the
// system's question and report the answer. Reports whether a window was
// there to ask; the permission is not required for this, it is the way to
// get one.
func (h *Hub) Authorize() bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	for i := len(h.subs) - 1; i >= 0; i-- {
		select {
		case h.subs[i].frames <- Message{Authorize: true}:
			return true
		default:
		}
	}
	return false
}

// Refresh asks every window to read the permission again and say it. A
// window that is not reading is skipped.
func (h *Hub) Refresh() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, s := range h.subs {
		select {
		case s.frames <- Message{Refresh: true}:
		default:
		}
	}
}

// SetFront records which session a page has in front, and whether the page
// has focus. Only a focused page showing a session silences anything; any
// other word from the page takes back what it said before.
func (h *Hub) SetFront(page, session string, focused bool) {
	if page == "" {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	now := h.now()
	h.pruneFrontsLocked(now)
	if session == "" || !focused {
		delete(h.fronts, page)
		return
	}
	if _, known := h.fronts[page]; !known && len(h.fronts) >= frontPages {
		return
	}
	h.fronts[page] = front{session: session, at: now}
}

func (h *Hub) pruneFrontsLocked(now time.Time) {
	for page, f := range h.fronts {
		if now.Sub(f.at) > frontFresh {
			delete(h.fronts, page)
		}
	}
}

// inFrontLocked says whether the session is in front of a focused page.
func (h *Hub) inFrontLocked(session string, now time.Time) bool {
	if session == "" {
		return false
	}
	h.pruneFrontsLocked(now)
	for _, f := range h.fronts {
		if f.session == session {
			return true
		}
	}
	return false
}

// Post says one thing, subject to do-not-disturb, the session in front and
// the ceiling.
func (h *Hub) Post(m Message) Outcome {
	if h.dnd() {
		return Quiet
	}
	h.mu.Lock()
	now := h.now()
	// Before the ceiling is counted: what is being looked at is not said, and
	// what is not said does not use up the line.
	if h.inFrontLocked(m.SessionID, now) {
		h.mu.Unlock()
		return InFront
	}
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
	// Over the line. One summary per stretch, the rest folds into it.
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
	if out := h.route(Message{Title: "plxr", Body: body, Sound: m.Sound, Kind: "summary"}); out != ViaWindow && out != ViaLocal {
		return out
	}
	return Summary
}

// Try shows the test notification: past do-not-disturb, the session in front
// and the ceiling, because somebody pressed the button for it, but by the
// same route as the real thing — that is what the button is there to show.
func (h *Hub) Try(sound string) Outcome {
	m := Message{Title: "plxr", Body: "This is how a notification from plxr looks and sounds", Sound: sound, Kind: "test"}
	out := h.route(m)
	explain(out, m)
	return out
}

// DoNotDisturb reads the switch from the shared settings: `dnd`, written by
// the window, read here because the service is where the saying happens.
func DoNotDisturb() bool {
	on, _ := daemon.ReadPrefs()["dnd"].(bool)
	return on
}

// Service is the hub the service uses. Tests put their own in its place.
var Service = NewHub(serviceRoute(), DoNotDisturb, time.Now)

// Post says one thing through the service's hub, and says in the log why
// when it was not shown.
func Post(m Message) Outcome {
	out := Service.Post(m)
	explain(out, m)
	return out
}

// explain writes down why a message was not shown. The log is the only place
// the service can say it: a notification that does not arrive looks exactly
// like nothing having happened.
func explain(out Outcome, m Message) {
	switch out {
	case ViaWindow, ViaLocal:
	case NoWindow:
		note("notify: %q not shown - no plxr window is open, and the service does not show notifications itself", m.Body)
	case NotAllowed:
		note("notify: %q not shown - plxr has not been allowed to show notifications yet (Settings, Notifications)", m.Body)
	case InFront:
		note("notify: %q not shown - that session is in front of a window that has focus", m.Body)
	default:
		note("notify: %q not shown on its own (%s)", m.Body, out)
	}
}
