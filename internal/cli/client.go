// Package cli ist die Kommandozeile von plxr.
//
// Sie redet mit demselben Daemon wie das Fenster — über HTTP und WebSocket auf
// 127.0.0.1. Dadurch sieht man im Terminal exakt dieselben Sessions wie in der
// Oberfläche, und `plxr attach` hängt sich an ein Terminal, an dem gleichzeitig
// das Fenster hängen darf.
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

// Verbinden liefert einen Client und startet den Daemon, falls keiner läuft.
func Connect() (*Client, error) {
	info, err := daemon.Ensure()
	if err != nil {
		return nil, err
	}
	return &Client{info: info, http: &http.Client{Timeout: 30 * time.Second}}, nil
}

func (c *Client) fetch(path string, ziel any) error {
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
	return json.NewDecoder(res.Body).Decode(ziel)
}

func (c *Client) send(methode, path string, koerper any, ziel any) error {
	var r io.Reader
	if koerper != nil {
		b, _ := json.Marshal(koerper)
		r = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(methode, c.info.URL()+path, r)
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
	if ziel != nil && res.StatusCode != http.StatusNoContent {
		return json.NewDecoder(res.Body).Decode(ziel)
	}
	return nil
}

func (c *Client) Sessions() ([]core.Tile, error) {
	var out []core.Tile
	return out, c.fetch("/api/sessions", &out)
}

// Finden erlaubt Kürzel: die ersten Zeichen der ID oder ein Namensteil.
func (c *Client) Find(was string) (core.Tile, error) {
	list, err := c.Sessions()
	if err != nil {
		return core.Tile{}, err
	}
	var hits []core.Tile
	for _, t := range list {
		if t.ID == was || strings.HasPrefix(t.ID, was) ||
			strings.EqualFold(t.Name, was) ||
			strings.Contains(strings.ToLower(t.Name+" "+t.Title), strings.ToLower(was)) {
			hits = append(hits, t)
		}
	}
	switch len(hits) {
	case 0:
		return core.Tile{}, fmt.Errorf("keine Session passt zu %q", was)
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
