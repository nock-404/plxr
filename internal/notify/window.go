package notify

import (
	"bytes"
	"encoding/json"
	"errors"
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
   comes down it, from its own process — the one the system will let post,
   with the icon. It says how the permission stands when it connects and
   again whenever that changes, so the settings panel can show it.

   The service may go and come back on another port: the address is read
   fresh before every attempt, and the attempts back off to half a minute
   rather than hammer a service that is not there. */

// Endpoint is where the service is: its base URL and the token.
type Endpoint struct {
	URL   string
	Token string
}

// FollowService keeps a window subscribed for as long as the process runs.
// find says where the service is now, show shows one message from this
// process, permission says how the system permission stands, changed wakes
// the loop when that answer changes, and authorize puts the system's
// question again when the service asks for that on somebody's behalf.
func FollowService(find func() (Endpoint, bool), show func(Message), permission func() string, changed <-chan struct{}, authorize func()) {
	wait := time.Second
	for {
		ep, ok := find()
		if ok && follow(ep, show, permission, changed, authorize) {
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
func follow(ep Endpoint, show func(Message), permission func() string, changed <-chan struct{}, authorize func()) bool {
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

	say := func() bool {
		return c.WriteJSON(map[string]string{"permission": permission()}) == nil
	}
	if !say() {
		return true
	}
	for {
		select {
		case m := <-frames:
			if m.Authorize {
				// The answer comes back on changed and is said then.
				authorize()
				continue
			}
			show(m)
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

// permissionFrame is what the window sends up the socket. Exported for the
// service's read loop, so both ends spell the field the same way.
type permissionFrame struct {
	Permission string `json:"permission"`
}

// ReadPermission picks the permission out of a frame the window sent, or ""
// when the frame was something else.
func ReadPermission(data []byte) string {
	var f permissionFrame
	if json.Unmarshal(data, &f) != nil {
		return ""
	}
	return f.Permission
}

/* A click on a notification, handed to the page.

   The window process is where the click arrives, and the page is where the
   session is opened. There is no wire from one to the other: the page loads
   the service's address, not the asset server's, so the Wails runtime is not
   in it and anything pushed with ExecJS waits for a ready that never comes.
   So the event was dispatched, nothing ran it, and the window came forward
   on whatever session it was already showing.

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

// logOnce says a thing once per process. The window has no one to say it to
// but its log, and a line per notification there is a log nobody reads.
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
	log.Printf(format, args...)
}
