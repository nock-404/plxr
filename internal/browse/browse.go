// Package browse hands a link to whatever the machine opens links with.
//
// The window is a web view of its own, and window.open in it opens nothing:
// there is no browser around it to make a tab in. So a URL clicked in a
// terminal did exactly nothing, in a window whose whole purpose is to watch
// programs that print URLs.
//
// What arrives here is text a program printed, so it is not trusted: only http,
// https and mailto are opened, the address is handed to the opener as one
// argument and never through a shell, and anything else is refused by name.
package browse

import (
	"net/url"
	"strings"

	"plxr/internal/uierr"
)

// Allowed says whether this is an address plxr will open, and hands back the
// address as it will be handed to the opener. Apart from Open so that what is
// refused can be checked without a browser opening on somebody's screen.
func Allowed(raw string) (string, error) {
	link := strings.TrimSpace(raw)
	if link == "" {
		return "", uierr.New("err.link.empty")
	}
	parsed, err := url.Parse(link)
	if err != nil {
		return "", uierr.With("err.link.bad", link)
	}
	switch strings.ToLower(parsed.Scheme) {
	case "http", "https", "mailto":
	default:
		return "", uierr.With("err.link.scheme", parsed.Scheme)
	}
	if parsed.Scheme != "mailto" && parsed.Host == "" {
		return "", uierr.With("err.link.bad", link)
	}
	return link, nil
}

// Open shows the address in the machine's own browser.
func Open(raw string) error {
	link, err := Allowed(raw)
	if err != nil {
		return err
	}
	return open(link)
}
