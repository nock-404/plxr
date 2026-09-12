package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"plxr/internal/notify"

	"github.com/gorilla/websocket"
)

/* The socket the window listens on.

   What is pinned: a window that is connected gets the frame and the service
   shows nothing itself; a window that stopped answering — the laptop shut, the
   process killed without a close — is found out by the ping and the service
   shows things itself again. The second one is the case that stays invisible
   otherwise: the socket looks open on this side for ever, every notification
   goes into it, and nothing is ever seen. */

type recorder struct {
	mu    sync.Mutex
	shown []notify.Message
}

func (r *recorder) show(m notify.Message) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.shown = append(r.shown, m)
}

func (r *recorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.shown)
}

func bench(t *testing.T) (*recorder, *httptest.Server) {
	t.Helper()
	rec := &recorder{}
	was := notify.Service
	notify.Service = notify.NewHub(rec.show, func() bool { return false }, time.Now)
	t.Cleanup(func() { notify.Service = was })

	s := New(nil, nil)
	srv := httptest.NewServer(s.Routes())
	t.Cleanup(srv.Close)
	return rec, srv
}

func dial(t *testing.T, srv *httptest.Server) *websocket.Conn {
	t.Helper()
	u := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/notify"
	c, _, err := websocket.DefaultDialer.Dial(u, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	return c
}

func waitFor(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if ok() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("waited 3 s for %s", what)
}

func TestAConnectedWindowGetsTheFrameAndTheServiceStaysQuiet(t *testing.T) {
	rec, srv := bench(t)
	c := dial(t, srv)
	defer c.Close()
	waitFor(t, "the subscription", func() bool { return notify.Service.Windows() == 1 })

	if err := c.WriteJSON(map[string]string{"permission": notify.PermissionGranted}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the permission to arrive", func() bool { return notify.Service.Permission() == notify.PermissionGranted })

	out := notify.Service.Post(notify.Message{Title: "one", Body: "waiting for your answer", SessionID: "abc", Kind: "needsYou"})
	if out != notify.ViaWindow {
		t.Fatalf("outcome %q, want %q", out, notify.ViaWindow)
	}
	_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
	var got notify.Message
	if err := c.ReadJSON(&got); err != nil {
		t.Fatalf("the window read nothing: %v", err)
	}
	if got.SessionID != "abc" || got.Kind != "needsYou" || got.Title != "one" {
		t.Errorf("the window got %+v", got)
	}
	if rec.count() != 0 {
		t.Errorf("the service showed %d itself", rec.count())
	}
}

func TestAWindowThatStopsAnsweringIsDroppedAndTheServiceTakesOver(t *testing.T) {
	// Short enough to wait for in a test; the real values are twenty and sixty
	// seconds.
	pingWas, pongWas := pingEvery, pongWait
	pingEvery, pongWait = 50*time.Millisecond, 200*time.Millisecond
	defer func() { pingEvery, pongWait = pingWas, pongWas }()

	rec, srv := bench(t)
	c := dial(t, srv)
	defer c.Close()
	waitFor(t, "the subscription", func() bool { return notify.Service.Windows() == 1 })

	// The window never reads, so it never answers a ping. The service is not
	// told it went; it has to notice.
	waitFor(t, "the silent window to be dropped", func() bool { return notify.Service.Windows() == 0 })

	if out := notify.Service.Post(notify.Message{Title: "one", Body: "still waiting", SessionID: "abc"}); out != notify.ViaLocal {
		t.Fatalf("after the drop: outcome %q, want %q", out, notify.ViaLocal)
	}
	if rec.count() != 1 {
		t.Errorf("the service showed %d, want 1", rec.count())
	}
}

func TestAWindowThatClosesHandsBackToTheService(t *testing.T) {
	rec, srv := bench(t)
	c := dial(t, srv)
	waitFor(t, "the subscription", func() bool { return notify.Service.Windows() == 1 })
	c.Close()
	waitFor(t, "the window to be gone", func() bool { return notify.Service.Windows() == 0 })

	if out := notify.Service.Post(notify.Message{Title: "one", Body: "still waiting"}); out != notify.ViaLocal {
		t.Fatalf("after the close: outcome %q, want %q", out, notify.ViaLocal)
	}
	if rec.count() != 1 {
		t.Errorf("the service showed %d, want 1", rec.count())
	}
}

// The window's own client, against the real route: what the service posts
// reaches the window's process, and the permission it reports is what the
// settings then show.
func TestTheWindowClientReceivesWhatTheServicePosts(t *testing.T) {
	rec, srv := bench(t)

	var mu sync.Mutex
	var shown []notify.Message
	go notify.FollowService(
		func() (notify.Endpoint, bool) { return notify.Endpoint{URL: srv.URL, Token: "t"}, true },
		func(m notify.Message) {
			mu.Lock()
			defer mu.Unlock()
			shown = append(shown, m)
		},
		func() string { return notify.PermissionGranted },
		make(chan struct{}),
		func() {},
	)
	waitFor(t, "the window client to subscribe", func() bool { return notify.Service.Windows() == 1 })
	waitFor(t, "the permission to be reported", func() bool { return notify.Service.Permission() == notify.PermissionGranted })

	if out := notify.Service.Post(notify.Message{Title: "one", Body: "waiting for your answer", SessionID: "abc", Kind: "needsYou"}); out != notify.ViaWindow {
		t.Fatalf("outcome %q, want %q", out, notify.ViaWindow)
	}
	waitFor(t, "the window to show it", func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(shown) == 1 && shown[0].SessionID == "abc"
	})
	if rec.count() != 0 {
		t.Errorf("the service showed %d itself", rec.count())
	}
}

// A window that is connected but may not post: the service shows it
// itself, so that the refusal is not silence. And ALLOW NOTIFICATIONS: the
// route hands the window an authorize frame, the window asks the system,
// and the answer it then gives is what the settings show.
func TestAWindowWithoutThePermissionLeavesTheShowingToTheService(t *testing.T) {
	rec, srv := bench(t)

	var mu sync.Mutex
	var shown []notify.Message
	permission := notify.PermissionNotAsked
	asked := 0
	changed := make(chan struct{}, 1)
	go notify.FollowService(
		func() (notify.Endpoint, bool) { return notify.Endpoint{URL: srv.URL, Token: "t"}, true },
		func(m notify.Message) {
			mu.Lock()
			defer mu.Unlock()
			shown = append(shown, m)
		},
		func() string {
			mu.Lock()
			defer mu.Unlock()
			return permission
		},
		changed,
		func() {
			// What the window does on the frame: puts the system's question
			// and, when it is answered, reports the new standing.
			mu.Lock()
			asked++
			permission = notify.PermissionGranted
			mu.Unlock()
			changed <- struct{}{}
		},
	)
	waitFor(t, "the window client to subscribe", func() bool { return notify.Service.Windows() == 1 })
	waitFor(t, "the permission to be reported", func() bool { return notify.Service.Permission() == notify.PermissionNotAsked })

	if out := notify.Service.Post(notify.Message{Title: "one", Body: "waiting for your answer", SessionID: "abc", Kind: "needsYou"}); out != notify.ViaLocal {
		t.Fatalf("with the permission not asked: outcome %q, want %q", out, notify.ViaLocal)
	}
	if rec.count() != 1 {
		t.Errorf("the service showed %d, want 1", rec.count())
	}

	res, err := http.Post(srv.URL+"/api/notify/authorize", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	var reply struct{ Asked bool }
	if err := json.NewDecoder(res.Body).Decode(&reply); err != nil || !reply.Asked {
		t.Fatalf("authorize answered %+v, %v — want asked", reply, err)
	}
	res.Body.Close()
	waitFor(t, "the window to be asked and to report granted", func() bool {
		mu.Lock()
		defer mu.Unlock()
		return asked == 1 && notify.Service.Permission() == notify.PermissionGranted
	})
	mu.Lock()
	if len(shown) != 0 {
		t.Errorf("the authorize frame was shown as a notification: %+v", shown)
	}
	mu.Unlock()

	// Now it holds the permission, and the next one is its to show.
	if out := notify.Service.Post(notify.Message{Title: "two", Body: "still waiting", SessionID: "abc", Kind: "needsYou"}); out != notify.ViaWindow {
		t.Fatalf("once granted: outcome %q, want %q", out, notify.ViaWindow)
	}
	waitFor(t, "the window to show it", func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(shown) == 1 && shown[0].Title == "two"
	})
	if rec.count() != 1 {
		t.Errorf("the service showed %d, want still 1", rec.count())
	}
}
