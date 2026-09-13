package server

import (
	"bytes"
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

/* The socket the window listens on, and the page's word on what is in front.

   What is pinned: a connected window gets the frame and nothing else shows
   it; a window that stopped answering — the laptop shut, the process killed
   without a close — is found out by the ping and dropped, after which nothing
   is shown and the outcome says so; the window's report of the permission and
   its bundle arrives; ALLOW reaches the window; and a session a focused page
   has in front is not said. */

func bench(t *testing.T) *httptest.Server {
	t.Helper()
	was := notify.Service
	// The macOS shape: the service has no route of its own.
	notify.Service = notify.NewHub(nil, func() bool { return false }, time.Now)
	t.Cleanup(func() { notify.Service = was })

	s := New(nil, nil)
	srv := httptest.NewServer(s.Routes())
	t.Cleanup(srv.Close)
	return srv
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

func TestAConnectedWindowGetsTheFrame(t *testing.T) {
	srv := bench(t)
	c := dial(t, srv)
	defer c.Close()
	waitFor(t, "the subscription", func() bool { return notify.Service.Windows() == 1 })

	if err := c.WriteJSON(notify.Report{Permission: notify.PermissionGranted, Bundle: "de.nyo.plxr.test"}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the report to arrive", func() bool {
		return notify.Service.Permission() == notify.PermissionGranted && notify.Service.Bundle() == "de.nyo.plxr.test"
	})

	out := notify.Service.Post(notify.Message{Title: "one", Body: "is waiting for your answer", SessionID: "abc", Kind: "needsYou"})
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
}

func TestAWindowThatStopsAnsweringIsDroppedAndNothingIsShown(t *testing.T) {
	pingWas, pongWas := pingEvery, pongWait
	pingEvery, pongWait = 50*time.Millisecond, 200*time.Millisecond
	defer func() { pingEvery, pongWait = pingWas, pongWas }()

	srv := bench(t)
	c := dial(t, srv)
	defer c.Close()
	waitFor(t, "the subscription", func() bool { return notify.Service.Windows() == 1 })
	// The window never reads, so it never answers a ping.
	waitFor(t, "the silent window to be dropped", func() bool { return notify.Service.Windows() == 0 })

	if out := notify.Service.Post(notify.Message{Title: "one", Body: "still waiting", SessionID: "abc"}); out != notify.NoWindow {
		t.Fatalf("after the drop: outcome %q, want %q", out, notify.NoWindow)
	}
}

// The window's own client, against the real route: what the service posts
// reaches the window's process, ALLOW reaches it as a question, a refresh
// makes it say the permission again, and none of those is shown as a
// notification.
func TestTheWindowClientShowsAsksAndReports(t *testing.T) {
	srv := bench(t)

	var mu sync.Mutex
	var shown []notify.Message
	permission := notify.PermissionNotAsked
	asked, reported := 0, 0
	changed := make(chan struct{}, 1)
	go notify.FollowService(
		func() (notify.Endpoint, bool) { return notify.Endpoint{URL: srv.URL, Token: "t"}, true },
		func(m notify.Message) {
			mu.Lock()
			defer mu.Unlock()
			shown = append(shown, m)
		},
		func() notify.Report {
			mu.Lock()
			defer mu.Unlock()
			reported++
			return notify.Report{Permission: permission, Bundle: "de.nyo.plxr.test"}
		},
		changed,
		func() {
			mu.Lock()
			asked++
			permission = notify.PermissionGranted
			mu.Unlock()
			changed <- struct{}{}
		},
	)
	waitFor(t, "the window client to subscribe", func() bool { return notify.Service.Windows() == 1 })
	waitFor(t, "the permission to be reported", func() bool { return notify.Service.Permission() == notify.PermissionNotAsked })

	if out := notify.Service.Post(notify.Message{Title: "one", Body: "is waiting for your answer", SessionID: "abc"}); out != notify.NotAllowed {
		t.Fatalf("not asked yet: outcome %q, want %q", out, notify.NotAllowed)
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
	before := reported
	mu.Unlock()
	res, err = http.Get(srv.URL + "/api/notify")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	waitFor(t, "the settings' look to make the window report again", func() bool {
		mu.Lock()
		defer mu.Unlock()
		return reported > before
	})

	if out := notify.Service.Post(notify.Message{Title: "two", Body: "still waiting", SessionID: "abc"}); out != notify.ViaWindow {
		t.Fatalf("once granted: outcome %q, want %q", out, notify.ViaWindow)
	}
	waitFor(t, "the window to show it", func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(shown) == 1 && shown[0].Title == "two"
	})
}

func TestAFocusedPageHoldsBackItsOwnSession(t *testing.T) {
	srv := bench(t)
	c := dial(t, srv)
	defer c.Close()
	if err := c.WriteJSON(notify.Report{Permission: notify.PermissionGranted}); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "the report", func() bool { return notify.Service.Permission() == notify.PermissionGranted })

	put := func(body string) {
		t.Helper()
		req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/notify/front", bytes.NewBufferString(body))
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusNoContent {
			t.Fatalf("%s answered %d", body, res.StatusCode)
		}
	}
	put(`{"page":"p1","session":"abc","focused":true}`)
	if out := notify.Service.Post(notify.Message{Title: "one", Body: "is waiting", SessionID: "abc"}); out != notify.InFront {
		t.Errorf("the session in front: outcome %q, want %q", out, notify.InFront)
	}
	put(`{"page":"p1","session":"abc","focused":false}`)
	if out := notify.Service.Post(notify.Message{Title: "one", Body: "is waiting", SessionID: "abc"}); out != notify.ViaWindow {
		t.Errorf("the window lost focus: outcome %q, want %q", out, notify.ViaWindow)
	}

	req, _ := http.NewRequest(http.MethodPut, srv.URL+"/api/notify/front", bytes.NewBufferString("not json"))
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Errorf("a body that is not JSON answered %d", res.StatusCode)
	}
}
