package notify

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

/* The window's side of the wire.

   The window opens a socket to the service's /ws/notify and shows whatever
   comes down it, from its own process — the one the system lets post, with
   the icon. It says how the permission stands and which bundle it posts
   under when it connects, whenever the permission changes, and whenever the
   service asks it to look again.

   The service may go and come back on another port: the address is read
   fresh before every attempt, and the attempts back off to half a minute
   rather than hammer a service that is not there. */

// Endpoint is where the service is: its base URL and the token.
type Endpoint struct {
	URL   string
	Token string
}

// Report is what the window sends up the socket about itself.
type Report struct {
	Permission string `json:"permission"`
	Bundle     string `json:"bundle,omitempty"`
}

// ReadReport picks the window's report out of a frame it sent, and says
// whether the frame was one.
func ReadReport(data []byte) (Report, bool) {
	var r Report
	if json.Unmarshal(data, &r) != nil || r.Permission == "" {
		return Report{}, false
	}
	return r, true
}

// permissionOf turns the system's authorization status — the number
// UNAuthorizationStatus carries — into the words the settings use. asking is
// whether this process has put the question and not heard back yet: while it
// is on screen the system already reports it as refused, and telling
// somebody to go to System Settings while the question is in front of them
// would be wrong.
func permissionOf(status int, asking bool) string {
	switch status {
	case 2, 3, 4: // authorized, provisional, ephemeral
		return PermissionGranted
	case 1:
		if asking {
			return PermissionAsking
		}
		return PermissionDenied
	case 0:
		if asking {
			return PermissionAsking
		}
		return PermissionNotAsked
	}
	return PermissionUnknown
}

// FollowService keeps a window subscribed for as long as the process runs.
// find says where the service is now, show shows one message from this
// process, report says how the permission stands and which bundle this is,
// changed wakes the loop when the permission changes, and authorize puts the
// system's question when the service asks for that on somebody's behalf.
func FollowService(find func() (Endpoint, bool), show func(Message), report func() Report, changed <-chan struct{}, authorize func()) {
	wait := time.Second
	for {
		ep, ok := find()
		if ok && follow(ep, show, report, changed, authorize) {
			wait = time.Second // it was up: start fresh on the next drop
		}
		time.Sleep(wait)
		if wait < 30*time.Second {
			wait *= 2
		}
	}
}

// follow holds one connection until it drops. Reports whether it connected
// at all, so the caller can tell a service that is gone from one that is
// merely busy.
func follow(ep Endpoint, show func(Message), report func() Report, changed <-chan struct{}, authorize func()) bool {
	u, err := url.Parse(ep.URL)
	if err != nil {
		return false
	}
	u.Scheme = strings.Replace(u.Scheme, "http", "ws", 1)
	u.Path = "/ws/notify"
	u.RawQuery = "token=" + url.QueryEscape(ep.Token)

	c, _, err := websocket.DefaultDialer.Dial(u.String(), http.Header{})
	if err != nil {
		return false
	}
	defer c.Close()

	// The service pings; a stretch without one means it is gone, whatever
	// the socket says.
	_ = c.SetReadDeadline(time.Now().Add(pongWait))
	pong := c.PingHandler()
	c.SetPingHandler(func(s string) error {
		_ = c.SetReadDeadline(time.Now().Add(pongWait))
		return pong(s)
	})

	frames := make(chan Message, 16)
	gone := make(chan struct{})
	done := make(chan struct{})
	defer close(done)
	go func() {
		defer close(gone)
		for {
			var m Message
			if err := c.ReadJSON(&m); err != nil {
				return
			}
			select {
			case frames <- m:
			case <-done:
				return
			}
		}
	}()

	say := func() bool { return c.WriteJSON(report()) == nil }
	if !say() {
		return true
	}
	for {
		select {
		case m := <-frames:
			switch {
			case m.Authorize:
				// The answer comes back on changed and is said then.
				authorize()
				if !say() {
					return true
				}
			case m.Refresh:
				if !say() {
					return true
				}
			default:
				show(m)
			}
		case <-changed:
			if !say() {
				return true
			}
		case <-gone:
			return true
		}
	}
}

// pongWait mirrors the service's: it pings every 20 s and gives up on a
// silent peer after 60 s, and the window gives up on a silent service after
// the same stretch.
const pongWait = 60 * time.Second

/* A click on a notification, handed to the page.

   The window process is where the click arrives, and the page is where the
   session is opened. There is no wire from one to the other: the page loads
   the service's address, not the asset server's, so the Wails runtime is not
   in it and anything pushed with ExecJS waits for a ready that never comes.

   What does join the two is the service. The settings blob is written over
   the service's API and every page watches its revision, so the request is
   written there: {focusSession: {id, seq}}. The page opens the session when
   the seq changes, and remembers the seq so that a reload does not open it
   again. The seq is the clock, so it rises across restarts of the window. */

// FocusRequest is what a click writes into the settings under focusSession.
type FocusRequest struct {
	ID  string `json:"id"`
	Seq int64  `json:"seq"`
}

// RequestFocus asks every page on the service to open the session, by
// writing the request into the settings.
func RequestFocus(ep Endpoint, sessionID string) error {
	if sessionID == "" {
		return errors.New("no session named")
	}
	body, err := json.Marshal(map[string]any{"focusSession": FocusRequest{ID: sessionID, Seq: time.Now().UnixNano()}})
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPut, strings.TrimRight(ep.URL, "/")+"/api/prefs", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("X-Plxr-Token", ep.Token)
	req.Header.Set("Content-Type", "application/json")
	res, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode/100 != 2 {
		return errors.New("the service answered " + res.Status)
	}
	return nil
}

// note writes one line about notifications to the process's log and to the
// system log. The process's own output goes nowhere once plxr is started from
// the Dock — the service is started with its output discarded, and so is an
// application launched by the system — and a notification that was not shown
// looks exactly like nothing having happened. The system log keeps it:
//
//	log show --last 1h --predicate 'process == "plxr" AND composedMessage CONTAINS "notif"'
func note(format string, args ...any) {
	line := fmt.Sprintf(format, args...)
	log.Print(line)
	systemLog(line)
}

// logOnce says a thing once per process. A line per notification is a log
// nobody reads.
var (
	saidMu sync.Mutex
	said   = map[string]bool{}
)

func logOnce(key, format string, args ...any) {
	saidMu.Lock()
	defer saidMu.Unlock()
	if said[key] {
		return
	}
	said[key] = true
	note(format, args...)
}
