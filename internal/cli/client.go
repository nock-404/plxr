// Package cli is the plxr command line.
//
// It talks to the same daemon as the window — over HTTP and WebSocket on
// 127.0.0.1. So the terminal shows exactly the same sessions as the window,
// and `plxr attach` attaches to a terminal the window is allowed to be
// attached to at the same time.
package cli

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"plxr/internal/core"
	"plxr/internal/daemon"

	"github.com/gorilla/websocket"
)

type Client struct {
	info daemon.Info
	http *http.Client
}

// Connect returns a client and starts the daemon if none is running.
func Connect() (*Client, error) {
	info, err := daemon.Ensure()
	if err != nil {
		return nil, err
	}
	return &Client{info: info, http: &http.Client{Timeout: 30 * time.Second}}, nil
}

func (c *Client) fetch(path string, target any) error {
	req, _ := http.NewRequest("GET", c.info.URL()+path, nil)
	req.Header.Set("X-Plxr-Token", c.info.Token)
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		b, _ := io.ReadAll(res.Body)
		return errors.New(strings.TrimSpace(string(b)))
	}
	return json.NewDecoder(res.Body).Decode(target)
}

func (c *Client) send(method, path string, body any, target any) error {
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, c.info.URL()+path, r)
	req.Header.Set("X-Plxr-Token", c.info.Token)
	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		b, _ := io.ReadAll(res.Body)
		return errors.New(strings.TrimSpace(string(b)))
	}
	if target != nil && res.StatusCode != http.StatusNoContent {
		return json.NewDecoder(res.Body).Decode(target)
	}
	return nil
}

func (c *Client) Sessions() ([]core.Tile, error) {
	var out []core.Tile
	return out, c.fetch("/api/sessions", &out)
}

// Find accepts short forms: the leading characters of the id, or part of a name.
func (c *Client) Find(which string) (core.Tile, error) {
	list, err := c.Sessions()
	if err != nil {
		return core.Tile{}, err
	}
	var hits []core.Tile
	for _, t := range list {
		if t.ID == which || strings.HasPrefix(t.ID, which) ||
			strings.EqualFold(t.Name, which) ||
			strings.Contains(strings.ToLower(t.Name+" "+t.Title), strings.ToLower(which)) {
			hits = append(hits, t)
		}
	}
	switch len(hits) {
	case 0:
		return core.Tile{}, fmt.Errorf("keine Session passt zu %q", which)
	case 1:
		return hits[0], nil
	default:
		var names []string
		for _, t := range hits {
			names = append(names, t.ID[:8]+" "+t.Name)
		}
		return core.Tile{}, fmt.Errorf("mehrdeutig, gemeint ist eine von:\n  %s", strings.Join(names, "\n  "))
	}
}

func (c *Client) ws(path string) (*websocket.Conn, error) {
	u := strings.Replace(c.info.URL(), "http", "ws", 1) + path
	if strings.Contains(path, "?") {
		u += "&token=" + url.QueryEscape(c.info.Token)
	} else {
		u += "?token=" + url.QueryEscape(c.info.Token)
	}
	conn, _, err := websocket.DefaultDialer.Dial(u, nil)
	return conn, err
}
