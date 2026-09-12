package notify

import (
	"encoding/json"
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
// process, permission says how the system permission stands, and changed
// wakes the loop when that answer changes.
func FollowService(find func() (Endpoint, bool), show func(Message), permission func() string, changed <-chan struct{}) {
	wait := time.Second
	for {
		ep, ok := find()
		if ok && follow(ep, show, permission, changed) {
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
func follow(ep Endpoint, show func(Message), permission func() string, changed <-chan struct{}) bool {
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
