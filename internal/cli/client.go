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
func Verbinden() (*Client, error) {
	info, err := daemon.Ensure()
	if err != nil {
		return nil, err
	}
	return &Client{info: info, http: &http.Client{Timeout: 30 * time.Second}}, nil
}

func (c *Client) hole(pfad string, ziel any) error {
	req, _ := http.NewRequest("GET", c.info.URL()+pfad, nil)
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

func (c *Client) schicke(methode, pfad string, koerper any, ziel any) error {
	var r io.Reader
	if koerper != nil {
		b, _ := json.Marshal(koerper)
		r = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(methode, c.info.URL()+pfad, r)
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
	return out, c.hole("/api/sessions", &out)
}

// Finden erlaubt Kürzel: die ersten Zeichen der ID oder ein Namensteil.
func (c *Client) Finden(was string) (core.Tile, error) {
	list, err := c.Sessions()
	if err != nil {
		return core.Tile{}, err
	}
	var treffer []core.Tile
	for _, t := range list {
		if t.ID == was || strings.HasPrefix(t.ID, was) ||
			strings.EqualFold(t.Name, was) ||
			strings.Contains(strings.ToLower(t.Name+" "+t.Title), strings.ToLower(was)) {
			treffer = append(treffer, t)
		}
	}
	switch len(treffer) {
	case 0:
		return core.Tile{}, fmt.Errorf("keine Session passt zu %q", was)
	case 1:
		return treffer[0], nil
	default:
		var namen []string
		for _, t := range treffer {
			namen = append(namen, t.ID[:8]+" "+t.Name)
		}
		return core.Tile{}, fmt.Errorf("mehrdeutig, gemeint ist eine von:\n  %s", strings.Join(namen, "\n  "))
	}
}

func (c *Client) ws(pfad string) (*websocket.Conn, error) {
	u := strings.Replace(c.info.URL(), "http", "ws", 1) + pfad
	if strings.Contains(pfad, "?") {
		u += "&token=" + url.QueryEscape(c.info.Token)
	} else {
		u += "?token=" + url.QueryEscape(c.info.Token)
	}
	conn, _, err := websocket.DefaultDialer.Dial(u, nil)
	return conn, err
}
